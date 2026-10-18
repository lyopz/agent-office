// Spatial validation. Returns issues with suggested fixes; never mutates.
import type { OfficeDoc, Room } from '../model/types';
import type { DocOp } from './ops';
import { findFreeSpot } from './ops';
import { bandCells, doorAnchor, doorInsideCells, key, polylineCells, rectsOverlap } from './geometry';
import { buildNav, furnitureWorldRect, reachableRooms, roomSpot } from './navigation';
import { findObjectSpot, objectIndex } from './spatial';
import { ACCESSORY } from '../model/cosmetics';
import { FURNITURE_META } from '../model/catalog';

export type Severity = 'error' | 'warning';
export interface Issue {
  id: string;
  severity: Severity;
  code:
    | 'room-overlap' | 'room-size' | 'out-of-bounds' | 'corridor-through-room' | 'corridor-broken'
    | 'corridor-width' | 'door-dead-end' | 'door-blocked' | 'unreachable-room' | 'furniture-outside'
    | 'furniture-overlap' | 'corridor-blocked' | 'equipment-unauthorised';
  message: string;
  objectIds: string[];
  fix?: { label: string; ops: DocOp[] };
}

export function validate(doc: OfficeDoc): Issue[] {
  const issues: Issue[] = [];
  const rooms = Object.values(doc.rooms);
  const roomCells = new Map<string, string>();
  for (const r of rooms) for (let x = r.x; x < r.x + r.w; x++) for (let y = r.y; y < r.y + r.h; y++) roomCells.set(key(x, y), r.id);

  for (let i = 0; i < rooms.length; i++) {
    const a = rooms[i];
    if (a.w < 3 || a.h < 3) issues.push({ id: `size:${a.id}`, severity: 'error', code: 'room-size', message: `${a.name} is smaller than 3×3`, objectIds: [a.id] });
    for (let j = i + 1; j < rooms.length; j++) {
      const b = rooms[j];
      if (rectsOverlap(a, b)) {
        const spot = findFreeSpot(doc, b, b.id);
        issues.push({
          id: `overlap:${a.id}:${b.id}`, severity: 'error', code: 'room-overlap',
          message: `${a.name} overlaps ${b.name}`, objectIds: [a.id, b.id],
          fix: { label: `Move ${b.name} to (${spot.x}, ${spot.y})`, ops: [{ op: 'room.update', id: b.id, patch: { x: spot.x, y: spot.y } }] },
        });
      }
    }
    const bnd = doc.settings.bounds;
    if (bnd && (a.x < bnd.x || a.y < bnd.y || a.x + a.w > bnd.x + bnd.w || a.y + a.h > bnd.y + bnd.h)) {
      issues.push({ id: `bounds:${a.id}`, severity: 'error', code: 'out-of-bounds', message: `${a.name} is outside the layout boundary`, objectIds: [a.id] });
    }
  }

  const corridorCells = new Set<string>();
  for (const c of Object.values(doc.corridors)) {
    const center = polylineCells(c.points);
    for (const p of bandCells(center, c.width)) corridorCells.add(key(p.x, p.y));
    if (c.status === 'broken') {
      issues.push({ id: `broken:${c.id}`, severity: 'error', code: 'corridor-broken', message: `${c.name}: ${c.statusMessage ?? 'disconnected'}`, objectIds: [c.id],
        fix: { label: 'Realign hallways', ops: [{ op: 'corridors.realign' }] } });
    }
    const hit = new Set<string>();
    for (const p of center) { const rid = roomCells.get(key(p.x, p.y)); if (rid) hit.add(rid); }
    if (hit.size) {
      issues.push({ id: `through:${c.id}`, severity: 'error', code: 'corridor-through-room',
        message: `${c.name} passes through ${[...hit].map((id) => doc.rooms[id].name).join(', ')}`, objectIds: [c.id, ...hit],
        fix: c.routing === 'manual' ? { label: 'Switch to automatic routing', ops: [{ op: 'corridor.update', id: c.id, patch: { routing: 'auto' } }] } : { label: 'Realign hallways', ops: [{ op: 'corridors.realign' }] } });
    }
    if (c.width < doc.settings.minCorridorWidth) {
      issues.push({ id: `width:${c.id}`, severity: 'error', code: 'corridor-width', message: `${c.name} is narrower than the minimum (${doc.settings.minCorridorWidth})`, objectIds: [c.id],
        fix: { label: `Widen to ${doc.settings.minCorridorWidth}`, ops: [{ op: 'corridor.update', id: c.id, patch: { width: doc.settings.minCorridorWidth } }] } });
    }
    if (c.blocked) issues.push({ id: `blocked:${c.id}`, severity: 'warning', code: 'corridor-blocked', message: `${c.name} is blocked; agents must route around it`, objectIds: [c.id],
      fix: { label: 'Reopen hallway', ops: [{ op: 'corridor.update', id: c.id, patch: { blocked: false } }] } });
  }

  for (const r of rooms) {
    for (const d of r.doors) {
      const a = doorAnchor(r, d);
      const outside = key(a.x, a.y);
      const leadsSomewhere = corridorCells.has(outside) || (roomCells.has(outside) && roomCells.get(outside) !== r.id);
      if (!leadsSomewhere) issues.push({ id: `deadend:${d.id}`, severity: 'warning', code: 'door-dead-end', message: `A door on ${r.name} (${d.side}) leads nowhere`, objectIds: [r.id, d.id] });
    }
  }

  for (const f of Object.values(doc.furniture)) {
    const r = doc.rooms[f.roomId];
    if (!r) continue;
    const fr = furnitureWorldRect(doc, f);
    if (fr.w > r.w || fr.h > r.h || f.x < 0 || f.y < 0 || f.x + fr.w > r.w || f.y + fr.h > r.h) {
      issues.push({ id: `fout:${f.id}`, severity: 'error', code: 'furniture-outside', message: `${f.workstation?.name ?? f.type} doesn't fit inside ${r.name}`, objectIds: [f.id, r.id],
        fix: { label: `Remove ${f.type}`, ops: [{ op: 'furniture.delete', id: f.id }] } });
    }
    if (f.blocking) {
      for (const d of r.doors) {
        const blocked = doorInsideCells(r, d).some((c) => c.x >= fr.x && c.x < fr.x + fr.w && c.y >= fr.y && c.y < fr.y + fr.h);
        if (blocked) issues.push({ id: `dblock:${f.id}:${d.id}`, severity: 'warning', code: 'door-blocked', message: `${f.workstation?.name ?? f.type} blocks a door in ${r.name}`, objectIds: [f.id, r.id] });
      }
    }
  }

  // overlapping objects, found through the spatial index (each pair reported once)
  const index = objectIndex(doc);
  for (const f of Object.values(doc.furniture)) {
    const r = doc.rooms[f.roomId]; if (!r || !f.blocking) continue;
    const fr = furnitureWorldRect(doc, f);
    for (const o of index.query(fr)) {
      if (o.id <= f.id || !o.blocking || o.roomId !== f.roomId) continue;
      const spot = findObjectSpot(doc, r, o.type, { near: { x: o.x, y: o.y }, rotation: o.rotation, w: o.w, h: o.h, ignore: new Set([o.id]) });
      const name = (x: typeof f) => x.label ?? x.workstation?.name ?? FURNITURE_META[x.type]?.label ?? x.type;
      issues.push({ id: `fover:${f.id}:${o.id}`, severity: 'warning', code: 'furniture-overlap', message: `${name(f)} overlaps ${name(o)} in ${r.name}`, objectIds: [f.id, o.id],
        fix: spot ? { label: `Move ${name(o)} to a free spot`, ops: [{ op: 'furniture.update', id: o.id, patch: { x: spot.x, y: spot.y } }] } : undefined });
    }
  }

  // functional equipment must be backed by a real tool permission
  for (const a of Object.values(doc.agents)) {
    const tools = new Set([...a.skills.tools, ...a.permissions.allowedTools]);
    for (const id of a.appearance.accessories ?? []) {
      const acc = ACCESSORY[id];
      if (acc?.functionalTool && !tools.has(acc.functionalTool)) issues.push({ id: `equip:${a.id}:${id}`, severity: 'warning', code: 'equipment-unauthorised', message: `${a.identity.name} wears ${acc.label} but lacks the “${acc.functionalTool}” tool`, objectIds: [a.id],
        fix: { label: `Remove ${acc.label}`, ops: [{ op: 'agent.update', id: a.id, patch: { appearance: { ...a.appearance, accessories: a.appearance.accessories.filter((x) => x !== id) } } }] } });
    }
  }

  // reachability from the main room (the operations room, or the most connected one)
  const hub = pickHub(doc);
  if (hub && rooms.length > 1) {
    const nav = buildNav(doc);
    const start = roomSpot(nav, hub);
    if (start) {
      const reach = reachableRooms(nav, start);
      for (const r of rooms) if (!reach.has(r.id)) {
        issues.push({ id: `unreach:${r.id}`, severity: 'warning', code: 'unreachable-room', message: `${r.name} can't be reached on foot from ${hub.name}`, objectIds: [r.id],
          fix: { label: `Connect ${r.name} to ${hub.name}`, ops: [{ op: 'rooms.connect', a: hub.id, b: r.id }] } });
      }
    }
  }
  return issues;
}

export function pickHub(doc: OfficeDoc): Room | undefined {
  const rooms = Object.values(doc.rooms);
  return rooms.find((r) => r.type === 'operations') ?? rooms.sort((a, b) => b.doors.length - a.doors.length)[0];
}

/** Errors present in `after` that weren't in `before` — a change introducing these needs confirmation. */
export function newErrors(before: Issue[], after: Issue[]): Issue[] {
  const ids = new Set(before.map((i) => i.id));
  return after.filter((i) => i.severity === 'error' && !ids.has(i.id));
}
