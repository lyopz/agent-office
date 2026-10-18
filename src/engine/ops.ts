// Structured operations: the only way the office document changes. Manual UI
// edits and AI commands both produce `DocOp[]`, which are applied atomically,
// followed by door/furniture clamping and corridor rerouting.
import { produce, type Draft } from 'immer';
import type {
  Agent, Corridor, CorridorEndpoint, Door, Furniture, FurnitureType, OfficeDoc, OfficeSettings, OutfitTemplate, Point, Rect, Room, RoomTemplate, RoomType,
} from '../model/types';
import { furniturePreset, makeAgent, makeFurniture, makeRoom, uid } from '../model/defaults';
import { clampDoor, doorFacing, manhattan, polylineCells, rectsOverlap, roomCenter } from './geometry';
import { updateCorridors } from './routing';

export type DeepPartial<T> = { [K in keyof T]?: T[K] extends (infer _U)[] ? T[K] : T[K] extends object ? DeepPartial<T[K]> : T[K] };

export type RoomPatch = Partial<Pick<Room, 'name' | 'type' | 'x' | 'y' | 'w' | 'h' | 'purpose' | 'special'>> & {
  appearance?: Partial<Room['appearance']>; walls?: Partial<Room['walls']>;
};

export type DocOp =
  | { op: 'room.create'; type: RoomType; x: number; y: number; w: number; h: number; name?: string; id?: string; preset?: boolean; templateId?: string }
  | { op: 'room.update'; id: string; patch: RoomPatch }
  | { op: 'room.delete'; id: string; cascade?: boolean }
  | { op: 'room.duplicate'; id: string; x?: number; y?: number; newId?: string }
  | { op: 'door.add'; roomId: string; side: Door['side']; offset: number; width?: number; id?: string }
  | { op: 'door.update'; roomId: string; doorId: string; patch: Partial<Omit<Door, 'id'>> }
  | { op: 'door.delete'; roomId: string; doorId: string; cascade?: boolean }
  | { op: 'corridor.create'; start: CorridorEndpoint; end: CorridorEndpoint; width?: number; name?: string; id?: string; isMain?: boolean }
  | { op: 'corridor.update'; id: string; patch: Partial<Pick<Corridor, 'name' | 'width' | 'routing' | 'isMain' | 'blocked' | 'points'>> }
  | { op: 'corridor.delete'; id: string }
  | { op: 'corridor.setEndpoint'; id: string; which: 'start' | 'end'; endpoint: CorridorEndpoint }
  | { op: 'corridors.realign' }
  | { op: 'rooms.connect'; a: string; b: string; width?: number; id?: string }
  | { op: 'room.connectToCorridor'; roomId: string; corridorId: string; width?: number; id?: string }
  | { op: 'furniture.add'; roomId: string; type: FurnitureType; x: number; y: number; id?: string; workstationName?: string }
  | { op: 'furniture.update'; id: string; patch: Partial<Omit<Furniture, 'id' | 'workstation'>> & { workstation?: Partial<NonNullable<Furniture['workstation']>> | null } }
  | { op: 'furniture.delete'; id: string }
  | { op: 'agent.create'; name: string; title?: string; department?: string; id?: string; roomId?: string | null }
  | { op: 'agent.update'; id: string; patch: DeepPartial<Omit<Agent, 'id'>> }
  | { op: 'agent.delete'; id: string }
  | { op: 'agent.duplicate'; id: string; newId?: string }
  | { op: 'agent.assignRoom'; agentId: string; roomId: string | null }
  | { op: 'workstation.assign'; furnitureId: string; agentId: string | null }
  | { op: 'settings.update'; patch: Partial<OfficeSettings> }
  | { op: 'office.rename'; name: string }
  | { op: 'template.saveRoom'; template: RoomTemplate }
  | { op: 'template.saveOutfit'; template: OutfitTemplate }
  | { op: 'template.delete'; id: string };

export interface ApplyResult { doc: OfficeDoc; summary: string[]; errors: string[] }

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Recursive merge: only keys present in the patch change; arrays are replaced. */
export function deepMerge<T>(target: T, patch: unknown): void {
  if (!isPlainObject(patch)) return;
  const t = target as Record<string, unknown>;
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined) continue;
    if (isPlainObject(v) && isPlainObject(t[k])) deepMerge(t[k], v);
    else t[k] = Array.isArray(v) ? [...v] : v;
  }
}

const label = (doc: Draft<OfficeDoc>, id: string) => doc.rooms[id]?.name ?? doc.agents[id]?.identity.name ?? doc.corridors[id]?.name ?? id;

function corridorsTouchingRoom(doc: Draft<OfficeDoc>, roomId: string, doorId?: string) {
  return Object.values(doc.corridors).filter((c) =>
    [c.start, c.end].some((e) => e.kind === 'door' && e.roomId === roomId && (!doorId || e.doorId === doorId)));
}

function corridorsJoining(doc: Draft<OfficeDoc>, corridorId: string) {
  return Object.values(doc.corridors).filter((c) => [c.start, c.end].some((e) => e.kind === 'corridor' && e.corridorId === corridorId));
}

function ensureDoorToward(doc: Draft<OfficeDoc>, room: Draft<Room>, target: Point, width = 2): Door {
  const want = doorFacing(room, target, width);
  const existing = room.doors.find((d) => d.side === want.side);
  if (existing) return existing as Door;
  const door: Door = { ...want, id: uid('door') };
  room.doors.push(door);
  void doc;
  return door;
}

/** Aim doors at the shared span of two rooms when they face each other, so hallways run straight. */
function alignTarget(from: Rect, to: Rect): Point {
  const c = roomCenter(to);
  const x0 = Math.max(from.x, to.x) + 1, x1 = Math.min(from.x + from.w, to.x + to.w) - 1;
  const y0 = Math.max(from.y, to.y) + 1, y1 = Math.min(from.y + from.h, to.y + to.h) - 1;
  const side = doorFacing(from, c).side;
  if ((side === 'e' || side === 'w') && y1 - y0 >= 2) return { x: c.x, y: Math.floor((y0 + y1) / 2) + 1 };
  if ((side === 'n' || side === 's') && x1 - x0 >= 2) return { x: Math.floor((x0 + x1) / 2) + 1, y: c.y };
  return c;
}

function removeCorridor(doc: Draft<OfficeDoc>, id: string, summary: string[]) {
  const name = doc.corridors[id]?.name;
  // branches joined onto this corridor are removed with it, never left dangling
  for (const j of corridorsJoining(doc, id)) if (j.id !== id) removeCorridor(doc, j.id, summary);
  if (doc.corridors[id]) { delete doc.corridors[id]; summary.push(`Removed hallway ${name}`); }
}

function nextCorridorName(doc: Draft<OfficeDoc>) {
  return `Hallway ${Object.keys(doc.corridors).length + 1}`;
}

function applyOne(doc: Draft<OfficeDoc>, o: DocOp, summary: string[], errors: string[]) {
  switch (o.op) {
    case 'room.create': {
      if (o.w < 3 || o.h < 3) { errors.push('Rooms must be at least 3×3 cells'); return; }
      const tpl = o.templateId ? doc.roomTemplates.find((t) => t.id === o.templateId) : undefined;
      const room = makeRoom(tpl?.type ?? o.type, Math.round(o.x), Math.round(o.y), Math.round(o.w), Math.round(o.h), o.name ?? tpl?.name);
      if (o.id) room.id = o.id;
      if (tpl) room.appearance = { ...tpl.appearance };
      doc.rooms[room.id] = room;
      const items = tpl ? tpl.furniture : o.preset !== false ? furniturePreset(room.type, room.w, room.h) : [];
      for (const it of items) {
        const f: Furniture = { ...JSON.parse(JSON.stringify(it)), id: uid('fur'), roomId: room.id };
        if (f.x + f.w > room.w || f.y + f.h > room.h) continue;
        doc.furniture[f.id] = f; room.furnitureIds.push(f.id);
      }
      summary.push(`Created room ${room.name}`);
      return;
    }
    case 'room.update': {
      const r = doc.rooms[o.id];
      if (!r) { errors.push(`Room ${o.id} not found`); return; }
      const { appearance, walls, ...rest } = o.patch;
      const before = { x: r.x, y: r.y, w: r.w, h: r.h };
      Object.assign(r, rest);
      if (appearance) Object.assign(r.appearance, appearance);
      if (walls) Object.assign(r.walls, walls);
      r.x = Math.round(r.x); r.y = Math.round(r.y); r.w = Math.round(r.w); r.h = Math.round(r.h);
      if (r.w < 3 || r.h < 3) { errors.push(`${r.name}: rooms must be at least 3×3 cells`); return; }
      if (before.x !== r.x || before.y !== r.y) summary.push(`Moved ${r.name} to (${r.x}, ${r.y})`);
      if (before.w !== r.w || before.h !== r.h) summary.push(`Resized ${r.name} to ${r.w}×${r.h}`);
      if (o.patch.name) summary.push(`Renamed room to ${o.patch.name}`);
      if (appearance || walls || o.patch.type || o.patch.purpose) summary.push(`Updated ${r.name}`);
      return;
    }
    case 'room.delete': {
      const r = doc.rooms[o.id];
      if (!r) { errors.push(`Room ${o.id} not found`); return; }
      const cs = corridorsTouchingRoom(doc, r.id);
      if (cs.length && !o.cascade) { errors.push(`${r.name} has ${cs.length} connected hallway(s); confirm to remove them too`); return; }
      for (const c of cs) removeCorridor(doc, c.id, summary);
      for (const fid of r.furnitureIds) delete doc.furniture[fid];
      for (const a of Object.values(doc.agents)) {
        if (a.schedule.assignedRoomId === r.id) a.schedule.assignedRoomId = null;
        if (a.schedule.preferredWorkstationId && !doc.furniture[a.schedule.preferredWorkstationId]) a.schedule.preferredWorkstationId = null;
      }
      delete doc.rooms[r.id];
      summary.push(`Deleted room ${r.name} with ${r.furnitureIds.length} furniture item(s)`);
      return;
    }
    case 'room.duplicate': {
      const r = doc.rooms[o.id];
      if (!r) { errors.push(`Room ${o.id} not found`); return; }
      const copy: Room = JSON.parse(JSON.stringify(r));
      copy.id = o.newId ?? uid('room'); copy.name = `${r.name} copy`; copy.assignedAgentIds = [];
      const pos = o.x !== undefined && o.y !== undefined ? { x: o.x, y: o.y } : findFreeSpot(doc as OfficeDoc, { ...r, x: r.x + r.w + 3 }, r.id);
      copy.x = pos.x; copy.y = pos.y;
      copy.doors = r.doors.map((d) => ({ ...d, id: uid('door') }));
      copy.furnitureIds = [];
      for (const fid of r.furnitureIds) {
        const f = doc.furniture[fid]; if (!f) continue;
        const nf: Furniture = JSON.parse(JSON.stringify(f));
        nf.id = uid('fur'); nf.roomId = copy.id; if (nf.workstation) nf.workstation.assignedAgentId = null;
        doc.furniture[nf.id] = nf; copy.furnitureIds.push(nf.id);
      }
      doc.rooms[copy.id] = copy;
      summary.push(`Duplicated ${r.name}`);
      return;
    }
    case 'door.add': {
      const r = doc.rooms[o.roomId];
      if (!r) { errors.push(`Room ${o.roomId} not found`); return; }
      const d = clampDoor(r, { id: o.id ?? uid('door'), side: o.side, offset: o.offset, width: o.width ?? 2 });
      r.doors.push(d);
      summary.push(`Added door on ${r.name} (${o.side})`);
      return;
    }
    case 'door.update': {
      const r = doc.rooms[o.roomId]; const d = r?.doors.find((x) => x.id === o.doorId);
      if (!r || !d) { errors.push('Door not found'); return; }
      Object.assign(d, o.patch);
      summary.push(`Updated door on ${r.name}`);
      return;
    }
    case 'door.delete': {
      const r = doc.rooms[o.roomId];
      if (!r) { errors.push('Room not found'); return; }
      const cs = corridorsTouchingRoom(doc, r.id, o.doorId);
      if (cs.length && !o.cascade) { errors.push(`That door is used by ${cs.map((c) => c.name).join(', ')}; confirm to remove the hallway too`); return; }
      for (const c of cs) removeCorridor(doc, c.id, summary);
      r.doors = r.doors.filter((d) => d.id !== o.doorId);
      summary.push(`Removed door from ${r.name}`);
      return;
    }
    case 'corridor.create': {
      const c: Corridor = {
        id: o.id ?? uid('hall'), name: o.name ?? nextCorridorName(doc), width: o.width ?? doc.settings.defaultCorridorWidth,
        points: [], start: o.start, end: o.end, routing: 'auto', isMain: !!o.isMain, blocked: false, status: 'ok',
      };
      doc.corridors[c.id] = c;
      summary.push(`Created ${c.name}`);
      return;
    }
    case 'corridor.update': {
      const c = doc.corridors[o.id];
      if (!c) { errors.push(`Hallway ${o.id} not found`); return; }
      const p = o.patch;
      if (p.width !== undefined && p.width < doc.settings.minCorridorWidth) { errors.push(`Minimum hallway width is ${doc.settings.minCorridorWidth}`); return; }
      if (p.points) { c.points = p.points.map((q) => ({ x: Math.round(q.x), y: Math.round(q.y) })); c.routing = p.routing ?? 'manual'; }
      if (p.width !== undefined) c.width = Math.round(p.width);
      if (p.name !== undefined) c.name = p.name;
      if (p.isMain !== undefined) c.isMain = p.isMain;
      if (p.blocked !== undefined) c.blocked = p.blocked;
      if (p.routing !== undefined && !p.points) { c.routing = p.routing; if (p.routing === 'auto') c.points = []; }
      summary.push(`Updated ${c.name}${p.width ? ` (width ${p.width})` : ''}${p.blocked !== undefined ? (p.blocked ? ' (blocked)' : ' (reopened)') : ''}`);
      return;
    }
    case 'corridor.delete': {
      if (!doc.corridors[o.id]) { errors.push('Hallway not found'); return; }
      removeCorridor(doc, o.id, summary);
      return;
    }
    case 'corridor.setEndpoint': {
      const c = doc.corridors[o.id];
      if (!c) { errors.push('Hallway not found'); return; }
      if (o.endpoint.kind === 'door') {
        const r = doc.rooms[o.endpoint.roomId];
        if (!r || !r.doors.some((d) => d.id === (o.endpoint as { doorId: string }).doorId)) { errors.push('Target door not found'); return; }
      } else if (!doc.corridors[o.endpoint.corridorId] || o.endpoint.corridorId === c.id) { errors.push('Target hallway not found'); return; }
      c[o.which] = o.endpoint;
      c.points = [];
      if (c.routing === 'manual') c.routing = 'auto';
      summary.push(`Re-attached ${c.name} ${o.which} to ${o.endpoint.kind === 'door' ? doc.rooms[o.endpoint.roomId].name : doc.corridors[o.endpoint.corridorId].name}`);
      return;
    }
    case 'corridors.realign':
      // handled after all ops (forced reroute)
      summary.push('Realigned all hallways');
      return;
    case 'rooms.connect': {
      const a = doc.rooms[o.a], b = doc.rooms[o.b];
      if (!a || !b) { errors.push('Both rooms must exist to connect them'); return; }
      const da = ensureDoorToward(doc, a, alignTarget(a, b));
      const db = ensureDoorToward(doc, b, alignTarget(b, a));
      const exists = Object.values(doc.corridors).some((c) =>
        (c.start.kind === 'door' && c.end.kind === 'door') &&
        ((c.start.doorId === da.id && c.end.doorId === db.id) || (c.start.doorId === db.id && c.end.doorId === da.id)));
      if (exists) { summary.push(`${a.name} and ${b.name} are already connected`); return; }
      applyOne(doc, { op: 'corridor.create', id: o.id, width: o.width, start: { kind: 'door', roomId: a.id, doorId: da.id }, end: { kind: 'door', roomId: b.id, doorId: db.id } }, summary, errors);
      summary.push(`Connected ${a.name} ↔ ${b.name}`);
      return;
    }
    case 'room.connectToCorridor': {
      const r = doc.rooms[o.roomId], c = doc.corridors[o.corridorId];
      if (!r || !c) { errors.push('Room and hallway must exist'); return; }
      const cells = polylineCells(c.points);
      const center = roomCenter(r);
      const nearest = cells.reduce((best, p) => (manhattan(p, center) < manhattan(best, center) ? p : best), cells[0] ?? center);
      const d = ensureDoorToward(doc, r, nearest);
      applyOne(doc, { op: 'corridor.create', id: o.id, width: o.width ?? c.width, start: { kind: 'door', roomId: r.id, doorId: d.id }, end: { kind: 'corridor', corridorId: c.id } }, summary, errors);
      return;
    }
    case 'furniture.add': {
      const r = doc.rooms[o.roomId];
      if (!r) { errors.push('Room not found'); return; }
      const f = makeFurniture(o.type, r.id, Math.round(o.x), Math.round(o.y), o.id ? { id: o.id } : {});
      if (o.workstationName || o.type === 'desk' || o.type === 'workbench') {
        f.workstation = { name: o.workstationName ?? `${r.name} Station`, assignedAgentId: null, equipment: ['terminal'], status: 'online', services: [] };
      }
      doc.furniture[f.id] = f; r.furnitureIds.push(f.id);
      summary.push(`Added ${f.workstation ? 'workstation' : o.type} to ${r.name}`);
      return;
    }
    case 'furniture.update': {
      const f = doc.furniture[o.id];
      if (!f) { errors.push('Furniture not found'); return; }
      const { workstation, roomId, ...rest } = o.patch;
      Object.assign(f, rest);
      if (roomId && roomId !== f.roomId && doc.rooms[roomId]) {
        const old = doc.rooms[f.roomId]; if (old) old.furnitureIds = old.furnitureIds.filter((x) => x !== f.id);
        doc.rooms[roomId].furnitureIds.push(f.id); f.roomId = roomId;
      }
      if (workstation === null) delete f.workstation;
      else if (workstation) f.workstation = { name: 'Workstation', assignedAgentId: null, equipment: [], status: 'online', services: [], ...f.workstation, ...workstation };
      summary.push(`Updated ${f.workstation?.name ?? f.type}`);
      return;
    }
    case 'furniture.delete': {
      const f = doc.furniture[o.id];
      if (!f) { errors.push('Furniture not found'); return; }
      const r = doc.rooms[f.roomId]; if (r) r.furnitureIds = r.furnitureIds.filter((x) => x !== f.id);
      for (const a of Object.values(doc.agents)) if (a.schedule.preferredWorkstationId === f.id) a.schedule.preferredWorkstationId = null;
      delete doc.furniture[o.id];
      summary.push(`Removed ${f.workstation?.name ?? f.type}`);
      return;
    }
    case 'agent.create': {
      const a = makeAgent(o.name, o.title ?? 'Generalist', o.department ?? 'Operations');
      if (o.id) a.id = o.id;
      doc.agents[a.id] = a;
      if (o.roomId) applyOne(doc, { op: 'agent.assignRoom', agentId: a.id, roomId: o.roomId }, summary, errors);
      summary.push(`Created agent ${a.identity.name}`);
      return;
    }
    case 'agent.update': {
      const a = doc.agents[o.id];
      if (!a) { errors.push(`Agent ${o.id} not found`); return; }
      const p = o.patch as Record<string, unknown>;
      if ('id' in p) { errors.push('Agent IDs are immutable'); return; }
      deepMerge(a, p);
      summary.push(`Updated ${a.identity.name}: ${Object.keys(p).join(', ')}`);
      return;
    }
    case 'agent.delete': {
      const a = doc.agents[o.id];
      if (!a) { errors.push('Agent not found'); return; }
      for (const r of Object.values(doc.rooms)) r.assignedAgentIds = r.assignedAgentIds.filter((x) => x !== a.id);
      for (const f of Object.values(doc.furniture)) if (f.workstation?.assignedAgentId === a.id) f.workstation.assignedAgentId = null;
      for (const other of Object.values(doc.agents)) if (other.skills.supervisorId === a.id) other.skills.supervisorId = null;
      delete doc.agents[a.id];
      summary.push(`Deleted agent ${a.identity.name}`);
      return;
    }
    case 'agent.duplicate': {
      const a = doc.agents[o.id];
      if (!a) { errors.push('Agent not found'); return; }
      const copy: Agent = JSON.parse(JSON.stringify(a));
      copy.id = o.newId ?? uid('agent'); copy.identity.name = `${a.identity.name} (copy)`; copy.identity.createdAt = new Date().toISOString();
      copy.schedule.preferredWorkstationId = null; copy.memory = copy.memory.filter((m) => m.persistent);
      doc.agents[copy.id] = copy;
      if (copy.schedule.assignedRoomId && doc.rooms[copy.schedule.assignedRoomId]) doc.rooms[copy.schedule.assignedRoomId].assignedAgentIds.push(copy.id);
      summary.push(`Duplicated ${a.identity.name}`);
      return;
    }
    case 'agent.assignRoom': {
      const a = doc.agents[o.agentId];
      if (!a) { errors.push('Agent not found'); return; }
      if (o.roomId && !doc.rooms[o.roomId]) { errors.push('Room not found'); return; }
      for (const r of Object.values(doc.rooms)) r.assignedAgentIds = r.assignedAgentIds.filter((x) => x !== a.id);
      a.schedule.assignedRoomId = o.roomId;
      if (o.roomId) doc.rooms[o.roomId].assignedAgentIds.push(a.id);
      summary.push(`Assigned ${a.identity.name} to ${o.roomId ? doc.rooms[o.roomId].name : 'no room'}`);
      return;
    }
    case 'workstation.assign': {
      const f = doc.furniture[o.furnitureId];
      if (!f?.workstation) { errors.push('Workstation not found'); return; }
      for (const g of Object.values(doc.furniture)) if (g.workstation && g.workstation.assignedAgentId === o.agentId && o.agentId) g.workstation.assignedAgentId = null;
      const prev = f.workstation.assignedAgentId;
      if (prev && doc.agents[prev]) doc.agents[prev].schedule.preferredWorkstationId = null;
      f.workstation.assignedAgentId = o.agentId;
      if (o.agentId) {
        const a = doc.agents[o.agentId];
        if (!a) { errors.push('Agent not found'); return; }
        a.schedule.preferredWorkstationId = f.id;
        applyOne(doc, { op: 'agent.assignRoom', agentId: a.id, roomId: f.roomId }, summary, errors);
      }
      summary.push(`${f.workstation.name} → ${o.agentId ? label(doc, o.agentId) : 'unassigned'}`);
      return;
    }
    case 'settings.update':
      Object.assign(doc.settings, o.patch);
      summary.push('Updated office settings');
      return;
    case 'office.rename':
      doc.name = o.name; summary.push(`Renamed office to ${o.name}`);
      return;
    case 'template.saveRoom':
      doc.roomTemplates.push(o.template); summary.push(`Saved room template ${o.template.name}`);
      return;
    case 'template.saveOutfit':
      doc.outfitTemplates.push(o.template); summary.push(`Saved outfit ${o.template.name}`);
      return;
    case 'template.delete':
      doc.roomTemplates = doc.roomTemplates.filter((t) => t.id !== o.id);
      doc.outfitTemplates = doc.outfitTemplates.filter((t) => t.id !== o.id);
      summary.push('Deleted template');
      return;
  }
}

/** Keep doors on their walls and furniture inside its room after geometry changes. */
export function normalize(doc: Draft<OfficeDoc>) {
  for (const r of Object.values(doc.rooms)) {
    r.doors = r.doors.map((d) => clampDoor(r, d));
    for (const fid of r.furnitureIds) {
      const f = doc.furniture[fid]; if (!f) continue;
      const rot = f.rotation === 90 || f.rotation === 270;
      const fw = rot ? f.h : f.w, fh = rot ? f.w : f.h;
      f.x = Math.max(0, Math.min(Math.round(f.x), r.w - fw));
      f.y = Math.max(0, Math.min(Math.round(f.y), r.h - fh));
    }
    r.furnitureIds = r.furnitureIds.filter((id) => doc.furniture[id]);
  }
}

export function applyOps(doc: OfficeDoc, ops: DocOp[]): ApplyResult {
  const summary: string[] = []; const errors: string[] = [];
  const next = produce(doc, (d) => {
    for (const o of ops) { applyOne(d, o, summary, errors); if (errors.length) return; }
    normalize(d);
    updateCorridors(d as OfficeDoc, ops.some((o) => o.op === 'corridors.realign'));
  });
  if (errors.length) return { doc, summary: [], errors };
  return { doc: next, summary, errors };
}

/** Nearest position for `rect` that doesn't overlap any other room (with a 2-cell hallway gap). */
export function findFreeSpot(doc: OfficeDoc, rect: Rect, ignoreId?: string, gap = 2): Point {
  const others = Object.values(doc.rooms).filter((r) => r.id !== ignoreId);
  const fits = (x: number, y: number) => {
    if (doc.settings.bounds) {
      const b = doc.settings.bounds;
      if (x < b.x || y < b.y || x + rect.w > b.x + b.w || y + rect.h > b.y + b.h) return false;
    }
    return !others.some((o) => rectsOverlap({ x, y, w: rect.w, h: rect.h }, o, gap));
  };
  if (fits(rect.x, rect.y)) return { x: rect.x, y: rect.y };
  for (let radius = 1; radius < 80; radius++) {
    let best: Point | null = null; let bestD = Infinity;
    for (let dx = -radius; dx <= radius; dx++) for (let dy = -radius; dy <= radius; dy++) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) !== radius) continue;
      const x = rect.x + dx, y = rect.y + dy;
      if (fits(x, y)) { const d = Math.abs(dx) + Math.abs(dy); if (d < bestD) { bestD = d; best = { x, y }; } }
    }
    if (best) return best;
  }
  return { x: rect.x, y: rect.y };
}
