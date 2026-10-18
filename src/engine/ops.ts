// Structured operations: the only way the office document changes. Manual UI
// edits and AI commands both produce `DocOp[]`, which are applied atomically,
// followed by door/furniture clamping and corridor rerouting.
import { produce, type Draft } from 'immer';
import type {
  Agent, AlertSettings, Appearance, AppearanceSettings, CorridorEndpoint, Corridor, CosmeticItem, Door, Furniture, FurnitureMaterial, FurnitureType,
  KnowledgeEntry, OfficeDoc, OfficeSettings, OutfitTemplate, Point, Project, Rect, Room, RoomAppearance, RoomTemplate, RoomType, ThemeDef,
} from '../model/types';
import { agentFromArchetype, furniturePreset, makeAgent, makeFurniture, makeRoom, uid, withAppearance } from '../model/defaults';
import { FURNITURE_META } from '../model/catalog';
import { ACCESSORY, ARCHETYPE, OUTFIT_FIELDS } from '../model/cosmetics';
import { ROOM_PALETTES } from '../model/themes';
import { checkPlacement, findObjectSpot, footprint } from './spatial';
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
  | { op: 'furniture.add'; roomId: string; type: FurnitureType; x: number; y: number; id?: string; workstationName?: string; rotation?: Furniture['rotation']; w?: number; h?: number; color?: string; material?: FurnitureMaterial; label?: string; groupId?: string; strict?: boolean }
  | { op: 'furniture.moveMany'; ids: string[]; dx: number; dy: number }
  | { op: 'furniture.duplicateMany'; ids: string[]; dx?: number; dy?: number; newIds?: string[] }
  | { op: 'furniture.group'; ids: string[]; groupId?: string }
  | { op: 'furniture.ungroup'; ids: string[] }
  | { op: 'furniture.copyStyle'; fromId: string; toIds: string[] }
  | { op: 'furniture.arrange'; ids: string[]; rows: number; gap?: number; margin?: number }
  | { op: 'furniture.align'; ids: string[]; mode: 'left' | 'right' | 'top' | 'bottom' | 'center-x' | 'center-y' | 'distribute-x' | 'distribute-y' }
  | { op: 'room.applyPalette'; roomIds: string[]; paletteId?: string; patch?: Partial<RoomAppearance> }
  | { op: 'agent.createFromArchetype'; archetype: string; name: string; id?: string; roomId?: string | null; workstationId?: string }
  | { op: 'agent.restoreAppearance'; id: string }
  | { op: 'cosmetic.upsert'; item: CosmeticItem }
  | { op: 'cosmetic.delete'; id: string }
  | { op: 'cosmetic.apply'; itemId: string; agentIds: string[] }
  | { op: 'cosmetic.remove'; itemId: string; agentId: string }
  | { op: 'outfit.save'; id?: string; name: string; fromAgentId: string; kind?: 'outfit' | 'uniform'; department?: string; occasion?: string; approved?: boolean }
  | { op: 'outfit.update'; id: string; patch: Partial<OutfitTemplate> }
  | { op: 'outfit.duplicate'; id: string; newId?: string }
  | { op: 'outfit.apply'; outfitId: string; agentIds: string[] }
  | { op: 'uniform.applyDepartment'; outfitId: string; department: string }
  | { op: 'appearance.update'; patch: Partial<Pick<AppearanceSettings, 'mode' | 'themeId'>> }
  | { op: 'theme.upsert'; theme: ThemeDef }
  | { op: 'theme.delete'; id: string }
  | { op: 'alerts.update'; patch: DeepPartial<AlertSettings> }
  | { op: 'project.upsert'; project: Project }
  | { op: 'project.delete'; id: string }
  | { op: 'library.upsert'; entry: KnowledgeEntry }
  | { op: 'library.delete'; id: string }
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
      const extra: Partial<Furniture> = {};
      if (o.id) extra.id = o.id;
      if (o.rotation) extra.rotation = o.rotation;
      if (o.w) extra.w = Math.max(1, Math.round(o.w));
      if (o.h) extra.h = Math.max(1, Math.round(o.h));
      if (o.color) extra.color = o.color;
      if (o.material) extra.material = o.material;
      if (o.label) extra.label = o.label;
      if (o.groupId) extra.groupId = o.groupId;
      const f = makeFurniture(o.type, r.id, Math.round(o.x), Math.round(o.y), extra);
      if (o.strict || doc.settings.collisionRule === 'prevent') {
        const chk = checkPlacement(doc as OfficeDoc, r as Room, f);
        if (!chk.ok) { errors.push(`Can't place ${FURNITURE_META[o.type].label} there: ${chk.outside ? 'outside the room' : chk.blocksDoor ? 'it would block a door' : 'it overlaps another object'}`); return; }
      }
      if (o.workstationName || FURNITURE_META[o.type].fn === 'workstation') {
        f.workstation = { name: o.workstationName ?? `${r.name} ${FURNITURE_META[o.type].label}`, assignedAgentId: null, equipment: ['terminal'], status: 'online', services: [] };
      }
      doc.furniture[f.id] = f; r.furnitureIds.push(f.id);
      summary.push(`Added ${f.workstation ? `workstation (${FURNITURE_META[o.type].label})` : FURNITURE_META[o.type].label} to ${r.name}`);
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
    case 'furniture.moveMany': {
      const items = o.ids.map((id) => doc.furniture[id]).filter(Boolean);
      if (!items.length) { errors.push('Nothing to move'); return; }
      // keep the group's spacing: clamp the shared offset so every item stays inside its room
      let dx = Math.round(o.dx), dy = Math.round(o.dy);
      for (const f of items) {
        const r = doc.rooms[f.roomId]; if (!r) continue;
        const fp = footprint(f);
        dx = Math.max(-f.x, Math.min(dx, r.w - fp.w - f.x));
        dy = Math.max(-f.y, Math.min(dy, r.h - fp.h - f.y));
      }
      for (const f of items) { f.x += dx; f.y += dy; }
      summary.push(`Moved ${items.length} object${items.length > 1 ? 's' : ''} by (${dx}, ${dy})`);
      return;
    }
    case 'furniture.duplicateMany': {
      const groupMap = new Map<string, string>();
      o.ids.forEach((id, i) => {
        const f = doc.furniture[id]; if (!f) return;
        const nf: Furniture = JSON.parse(JSON.stringify(f));
        nf.id = o.newIds?.[i] ?? uid('fur'); nf.x = f.x + (o.dx ?? 1); nf.y = f.y + (o.dy ?? 1);
        if (nf.workstation) { nf.workstation.assignedAgentId = null; nf.workstation.name = `${nf.workstation.name} (copy)`; }
        if (f.groupId) { if (!groupMap.has(f.groupId)) groupMap.set(f.groupId, uid('grp')); nf.groupId = groupMap.get(f.groupId); }
        doc.furniture[nf.id] = nf; doc.rooms[nf.roomId]?.furnitureIds.push(nf.id);
      });
      summary.push(`Duplicated ${o.ids.length} object(s)`);
      return;
    }
    case 'furniture.group': {
      const g = o.groupId ?? uid('grp');
      for (const id of o.ids) if (doc.furniture[id]) doc.furniture[id].groupId = g;
      summary.push(`Grouped ${o.ids.length} objects`);
      return;
    }
    case 'furniture.ungroup':
      for (const id of o.ids) if (doc.furniture[id]) delete doc.furniture[id].groupId;
      summary.push(`Ungrouped ${o.ids.length} objects`);
      return;
    case 'furniture.copyStyle': {
      const src = doc.furniture[o.fromId];
      if (!src) { errors.push('Source object not found'); return; }
      for (const id of o.toIds) { const f = doc.furniture[id]; if (f && f.id !== src.id) { f.color = src.color; f.material = src.material; } }
      summary.push(`Copied style to ${o.toIds.length} object(s)`);
      return;
    }
    case 'furniture.arrange': {
      const items = o.ids.map((id) => doc.furniture[id]).filter(Boolean);
      if (!items.length) { errors.push('Nothing to arrange'); return; }
      const roomId = items[0].roomId;
      if (items.some((f) => f.roomId !== roomId)) { errors.push('Arrange works on objects in one room at a time'); return; }
      const r = doc.rooms[roomId];
      const rows = Math.max(1, Math.min(o.rows, items.length));
      const perRow = Math.ceil(items.length / rows);
      const gap = o.gap ?? 1, margin = o.margin ?? 1;
      const cw = Math.max(...items.map((f) => footprint(f).w)), ch = Math.max(...items.map((f) => footprint(f).h));
      const rowGap = Math.max(gap, 1) + 1; // leave a walkway in front of every desk
      const needW = perRow * cw + (perRow - 1) * gap, needH = rows * ch + (rows - 1) * rowGap;
      if (needW > r.w - margin * 2 + 2 || needH > r.h - margin) { errors.push(`${r.name} is too small for ${items.length} objects in ${rows} rows`); return; }
      const x0 = Math.max(0, Math.floor((r.w - needW) / 2)), y0 = Math.max(0, Math.min(margin, r.h - needH));
      // stable order: current reading order
      [...items].sort((a, b) => a.y - b.y || a.x - b.x).forEach((f, i) => {
        const row = Math.floor(i / perRow), col = i % perRow;
        f.x = x0 + col * (cw + gap); f.y = y0 + row * (ch + rowGap);
      });
      summary.push(`Arranged ${items.length} objects in ${rows} aligned row${rows > 1 ? 's' : ''} in ${r.name}`);
      return;
    }
    case 'furniture.align': {
      const items = o.ids.map((id) => doc.furniture[id]).filter(Boolean);
      if (items.length < 2) { errors.push('Select at least two objects to align'); return; }
      const fp = (f: Furniture) => footprint(f);
      const minX = Math.min(...items.map((f) => f.x)), maxX = Math.max(...items.map((f) => f.x + fp(f).w));
      const minY = Math.min(...items.map((f) => f.y)), maxY = Math.max(...items.map((f) => f.y + fp(f).h));
      if (o.mode === 'left') items.forEach((f) => { f.x = minX; });
      if (o.mode === 'right') items.forEach((f) => { f.x = maxX - fp(f).w; });
      if (o.mode === 'top') items.forEach((f) => { f.y = minY; });
      if (o.mode === 'bottom') items.forEach((f) => { f.y = maxY - fp(f).h; });
      if (o.mode === 'center-x') { const c = Math.round((minX + maxX) / 2); items.forEach((f) => { f.x = c - Math.floor(fp(f).w / 2); }); }
      if (o.mode === 'center-y') { const c = Math.round((minY + maxY) / 2); items.forEach((f) => { f.y = c - Math.floor(fp(f).h / 2); }); }
      if (o.mode === 'distribute-x' || o.mode === 'distribute-y') {
        const horiz = o.mode === 'distribute-x';
        const sorted = [...items].sort((a, b) => (horiz ? a.x - b.x : a.y - b.y));
        const total = sorted.reduce((t, f) => t + (horiz ? fp(f).w : fp(f).h), 0);
        const span = horiz ? maxX - minX : maxY - minY;
        const gap = Math.max(0, Math.floor((span - total) / (sorted.length - 1)));
        let cur = horiz ? minX : minY;
        for (const f of sorted) { if (horiz) f.x = cur; else f.y = cur; cur += (horiz ? fp(f).w : fp(f).h) + gap; }
      }
      summary.push(`Aligned ${items.length} objects (${o.mode})`);
      return;
    }
    case 'room.applyPalette': {
      const pal = o.paletteId ? ROOM_PALETTES.find((p) => p.id === o.paletteId) : undefined;
      const patch = { ...(pal?.patch ?? {}), ...(o.patch ?? {}), ...(pal ? { theme: pal.name } : {}) };
      if (!Object.keys(patch).length) { errors.push('Choose a palette'); return; }
      for (const id of o.roomIds) {
        const r = doc.rooms[id]; if (!r) { errors.push(`Room ${id} not found`); return; }
        Object.assign(r.appearance, patch);
        if (patch.furnitureMaterial) for (const fid of r.furnitureIds) { const f = doc.furniture[fid]; if (f && !f.material) f.material = undefined; }
      }
      summary.push(`Applied ${pal ? pal.name : 'room colours'} to ${o.roomIds.map((id) => doc.rooms[id].name).join(', ')}`);
      return;
    }
    case 'agent.createFromArchetype': {
      if (!ARCHETYPE[o.archetype]) { errors.push(`Unknown archetype ${o.archetype}`); return; }
      const a = agentFromArchetype(o.archetype, o.name);
      if (o.id) a.id = o.id;
      doc.agents[a.id] = a;
      summary.push(`Created ${ARCHETYPE[o.archetype].label} ${a.identity.name}`);
      if (o.roomId) {
        const r = doc.rooms[o.roomId];
        if (!r) { errors.push('Room not found'); return; }
        // reuse a free workstation of the right kind, otherwise place one
        const t = ARCHETYPE[o.archetype];
        let ws = Object.values(doc.furniture).find((f) => f.roomId === r.id && f.workstation && !f.workstation.assignedAgentId && f.type === t.workstation);
        if (!ws) {
          const spot = findObjectSpot(doc as OfficeDoc, r as Room, t.workstation);
          if (!spot) { errors.push(`No free space for a ${FURNITURE_META[t.workstation].label} in ${r.name}`); return; }
          applyOne(doc, { op: 'furniture.add', roomId: r.id, type: t.workstation, x: spot.x, y: spot.y, id: o.workstationId, workstationName: `${a.identity.name} · ${t.workstationName}` }, summary, errors);
          ws = doc.furniture[o.workstationId ?? r.furnitureIds[r.furnitureIds.length - 1]];
        }
        if (ws) applyOne(doc, { op: 'workstation.assign', furnitureId: ws.id, agentId: a.id }, summary, errors);
      }
      return;
    }
    case 'agent.restoreAppearance': {
      const a = doc.agents[o.id];
      if (!a) { errors.push('Agent not found'); return; }
      a.appearance = withAppearance(a.defaultAppearance ?? a.appearance);
      stripUnauthorisedEquipment(a, summary);
      summary.push(`Restored ${a.identity.name}'s default appearance`);
      return;
    }
    case 'cosmetic.upsert': {
      const i = doc.cosmetics.findIndex((c) => c.id === o.item.id);
      if (i >= 0) doc.cosmetics[i] = o.item; else doc.cosmetics.push(o.item);
      summary.push(`${i >= 0 ? 'Updated' : 'Added'} cosmetic ${o.item.name}`);
      return;
    }
    case 'cosmetic.delete':
      doc.cosmetics = doc.cosmetics.filter((c) => c.id !== o.id);
      summary.push('Removed cosmetic item from the inventory');
      return;
    case 'cosmetic.apply': {
      const it = doc.cosmetics.find((c) => c.id === o.itemId);
      if (!it) { errors.push('Cosmetic item not found'); return; }
      for (const id of o.agentIds) {
        const a = doc.agents[id]; if (!a) { errors.push('Agent not found'); return; }
        const tool = it.functionalTool ?? (it.accessoryId ? ACCESSORY[it.accessoryId]?.functionalTool : undefined);
        if (tool && !a.permissions.allowedTools.includes(tool)) {
          errors.push(`${it.name} represents the “${tool}” tool, which ${a.identity.name} isn't allowed to use. Grant it in Permissions first, or pick a decorative item.`);
          return;
        }
        if (it.accessoryId) { if (!a.appearance.accessories.includes(it.accessoryId)) a.appearance.accessories.push(it.accessoryId); }
        if (it.patch) a.appearance = withAppearance(a.appearance as Appearance, JSON.parse(JSON.stringify(it.patch)));
      }
      summary.push(`Applied ${it.name} to ${o.agentIds.map((id) => doc.agents[id].identity.name).join(', ')}`);
      return;
    }
    case 'cosmetic.remove': {
      const it = doc.cosmetics.find((c) => c.id === o.itemId); const a = doc.agents[o.agentId];
      if (!it || !a) { errors.push('Item or agent not found'); return; }
      const def = a.defaultAppearance ?? a.appearance;
      if (it.accessoryId) a.appearance.accessories = a.appearance.accessories.filter((x) => x !== it.accessoryId);
      for (const k of Object.keys(it.patch ?? {}) as (keyof Appearance)[]) {
        if (k === 'effects') { for (const e of Object.keys(it.patch!.effects ?? {}) as (keyof Appearance['effects'])[]) if (e !== 'intensity') (a.appearance.effects as unknown as Record<string, unknown>)[e] = false; }
        else (a.appearance as unknown as Record<string, unknown>)[k] = JSON.parse(JSON.stringify((def as unknown as Record<string, unknown>)[k]));
      }
      summary.push(`Removed ${it.name} from ${a.identity.name}`);
      return;
    }
    case 'outfit.save': {
      const a = doc.agents[o.fromAgentId];
      if (!a) { errors.push('Agent not found'); return; }
      const patch: Partial<Appearance> = {};
      for (const k of OUTFIT_FIELDS) (patch as Record<string, unknown>)[k] = JSON.parse(JSON.stringify(a.appearance[k]));
      const t: OutfitTemplate = { id: o.id ?? uid('outfit'), name: o.name, patch, kind: o.kind ?? 'outfit', department: o.department, occasion: o.occasion, approved: o.approved ?? (o.kind !== 'uniform') };
      doc.outfitTemplates.push(t);
      summary.push(`Saved ${t.kind} “${t.name}” from ${a.identity.name}`);
      return;
    }
    case 'outfit.update': {
      const t = doc.outfitTemplates.find((x) => x.id === o.id);
      if (!t) { errors.push('Outfit not found'); return; }
      Object.assign(t, o.patch, { id: t.id });
      summary.push(`Updated outfit ${t.name}`);
      return;
    }
    case 'outfit.duplicate': {
      const t = doc.outfitTemplates.find((x) => x.id === o.id);
      if (!t) { errors.push('Outfit not found'); return; }
      doc.outfitTemplates.push({ ...JSON.parse(JSON.stringify(t)), id: o.newId ?? uid('outfit'), name: `${t.name} copy` });
      summary.push(`Duplicated outfit ${t.name}`);
      return;
    }
    case 'outfit.apply': {
      const t = doc.outfitTemplates.find((x) => x.id === o.outfitId);
      if (!t) { errors.push('Outfit not found'); return; }
      for (const id of o.agentIds) {
        const a = doc.agents[id]; if (!a) { errors.push('Agent not found'); return; }
        // only outfit fields are applied; face, body and identity are never touched
        const patch: Partial<Appearance> = {};
        for (const k of OUTFIT_FIELDS) if (k in t.patch) (patch as Record<string, unknown>)[k] = JSON.parse(JSON.stringify((t.patch as Record<string, unknown>)[k]));
        const missing = (patch.accessories ?? []).map((x) => ACCESSORY[x]).filter((d) => d?.functionalTool && !a.permissions.allowedTools.includes(d.functionalTool));
        if (missing.length) {
          // functional equipment the agent can't use is left off rather than faked
          patch.accessories = (patch.accessories ?? []).filter((x) => !missing.some((d) => d.id === x));
          summary.push(`${a.identity.name}: left off ${missing.map((d) => d.label).join(', ')} (needs the ${missing.map((d) => d.functionalTool).join(', ')} tool)`);
        }
        a.appearance = withAppearance(a.appearance as Appearance, patch);
      }
      summary.push(`Applied outfit “${t.name}” to ${o.agentIds.map((id) => doc.agents[id].identity.name).join(', ')}`);
      return;
    }
    case 'uniform.applyDepartment': {
      const t = doc.outfitTemplates.find((x) => x.id === o.outfitId);
      if (!t) { errors.push('Uniform not found'); return; }
      if (t.kind === 'uniform' && !t.approved) { errors.push(`Uniform “${t.name}” hasn't been approved yet`); return; }
      const ids = Object.values(doc.agents).filter((a) => a.identity.department === o.department).map((a) => a.id);
      if (!ids.length) { errors.push(`No agents in ${o.department}`); return; }
      applyOne(doc, { op: 'outfit.apply', outfitId: t.id, agentIds: ids }, summary, errors);
      return;
    }
    case 'appearance.update':
      if (o.patch.themeId && !doc.appearance.themes.some((t) => t.id === o.patch.themeId)) { errors.push('Theme not found'); return; }
      Object.assign(doc.appearance, o.patch);
      summary.push(o.patch.mode ? `Interface mode: ${o.patch.mode}` : 'Changed interface theme');
      return;
    case 'theme.upsert': {
      const i = doc.appearance.themes.findIndex((t) => t.id === o.theme.id);
      if (i >= 0) doc.appearance.themes[i] = o.theme; else doc.appearance.themes.push(o.theme);
      summary.push(`${i >= 0 ? 'Updated' : 'Saved'} theme ${o.theme.name}`);
      return;
    }
    case 'theme.delete': {
      const t = doc.appearance.themes.find((x) => x.id === o.id);
      if (!t) { errors.push('Theme not found'); return; }
      if (doc.appearance.themes.length <= 1) { errors.push('Keep at least one theme'); return; }
      doc.appearance.themes = doc.appearance.themes.filter((x) => x.id !== o.id);
      if (doc.appearance.themeId === o.id) doc.appearance.themeId = doc.appearance.themes[0].id;
      summary.push(`Deleted theme ${t.name}`);
      return;
    }
    case 'alerts.update':
      deepMerge(doc.alertSettings, o.patch);
      summary.push('Updated alert settings');
      return;
    case 'project.upsert':
      doc.projects[o.project.id] = o.project; summary.push(`Saved project ${o.project.name}`);
      return;
    case 'project.delete':
      if (!doc.projects[o.id]) { errors.push('Project not found'); return; }
      summary.push(`Deleted project ${doc.projects[o.id].name}`); delete doc.projects[o.id];
      return;
    case 'library.upsert':
      doc.library[o.entry.id] = o.entry; summary.push(`Filed “${o.entry.title}” in the library`);
      return;
    case 'library.delete':
      if (!doc.library[o.id]) { errors.push('Library entry not found'); return; }
      summary.push(`Removed “${doc.library[o.id].title}” from the library`); delete doc.library[o.id];
      return;
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
      const before = new Set(a.appearance.accessories);
      deepMerge(a, p);
      const added = a.appearance.accessories.filter((x) => !before.has(x)).map((x) => ACCESSORY[x]).filter((d) => d?.functionalTool && !a.permissions.allowedTools.includes(d.functionalTool));
      if (added.length) { errors.push(`${added[0].label} represents the “${added[0].functionalTool}” tool, which ${a.identity.name} isn't allowed to use`); return; }
      stripUnauthorisedEquipment(a, summary);
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

/** Functional equipment must match real permissions: drop items whose tool was revoked. */
function stripUnauthorisedEquipment(a: Draft<Agent>, summary: string[]) {
  const keep = a.appearance.accessories.filter((x) => { const t = ACCESSORY[x]?.functionalTool; return !t || a.permissions.allowedTools.includes(t); });
  if (keep.length !== a.appearance.accessories.length) {
    const gone = a.appearance.accessories.filter((x) => !keep.includes(x)).map((x) => ACCESSORY[x]?.label ?? x);
    a.appearance.accessories = keep;
    summary.push(`${a.identity.name} no longer shows ${gone.join(', ')} (tool permission removed)`);
  }
}

const LAYOUT_OP = /^(room|door|corridor|rooms|furniture|settings|agent\.createFromArchetype|corridors)/;

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
    // profile, cosmetic, theme and alert edits don't touch geometry: skip the layout pass
    if (!ops.some((o) => LAYOUT_OP.test(o.op))) return;
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
