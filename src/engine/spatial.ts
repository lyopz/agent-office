// Spatial index for objects. A uniform bucket grid keeps collision checks
// proportional to the objects near a point, not to every object in the office.
import type { Furniture, FurnitureType, OfficeDoc, Rect, Room } from '../model/types';
import { FURNITURE_META } from '../model/catalog';
import { doorInsideCells, rectsOverlap } from './geometry';

const B = 8; // bucket size in cells

export class SpatialGrid<T extends { id: string }> {
  private buckets = new Map<string, T[]>();
  private rects = new Map<string, Rect>();
  insert(item: T, r: Rect) {
    this.rects.set(item.id, r);
    for (let bx = Math.floor(r.x / B); bx <= Math.floor((r.x + r.w - 1) / B); bx++)
      for (let by = Math.floor(r.y / B); by <= Math.floor((r.y + r.h - 1) / B); by++) {
        const k = `${bx},${by}`; const list = this.buckets.get(k);
        if (list) list.push(item); else this.buckets.set(k, [item]);
      }
  }
  query(r: Rect): T[] {
    const out = new Map<string, T>();
    for (let bx = Math.floor(r.x / B); bx <= Math.floor((r.x + r.w - 1) / B); bx++)
      for (let by = Math.floor(r.y / B); by <= Math.floor((r.y + r.h - 1) / B); by++)
        for (const it of this.buckets.get(`${bx},${by}`) ?? []) if (rectsOverlap(this.rects.get(it.id)!, r)) out.set(it.id, it);
    return [...out.values()];
  }
  rectOf(id: string) { return this.rects.get(id); }
}

export function footprint(f: Pick<Furniture, 'w' | 'h' | 'rotation'>) {
  const rot = f.rotation === 90 || f.rotation === 270;
  return { w: rot ? f.h : f.w, h: rot ? f.w : f.h };
}

export function worldRect(room: Rect, f: Pick<Furniture, 'x' | 'y' | 'w' | 'h' | 'rotation'>): Rect {
  const fp = footprint(f);
  return { x: room.x + f.x, y: room.y + f.y, w: fp.w, h: fp.h };
}

const indexCache = new WeakMap<object, { rooms: unknown; grid: SpatialGrid<Furniture> }>();

/** Index of all objects in world coordinates, cached per furniture map. */
export function objectIndex(doc: OfficeDoc): SpatialGrid<Furniture> {
  const hit = indexCache.get(doc.furniture);
  if (hit && hit.rooms === doc.rooms) return hit.grid;
  const grid = new SpatialGrid<Furniture>();
  for (const f of Object.values(doc.furniture)) {
    const r = doc.rooms[f.roomId]; if (!r) continue;
    grid.insert(f, worldRect(r, f));
  }
  indexCache.set(doc.furniture, { rooms: doc.rooms, grid });
  return grid;
}

export interface PlacementCheck { ok: boolean; outside: boolean; overlaps: string[]; blocksDoor: boolean; rect: Rect }

/** Can an object of this footprint sit at (x, y) in the room? Used by the placement preview and the AI. */
export function checkPlacement(doc: OfficeDoc, room: Room, f: { x: number; y: number; w: number; h: number; rotation: Furniture['rotation']; blocking: boolean }, ignore: Set<string> = new Set()): PlacementCheck {
  const rect = worldRect(room, f);
  const outside = f.x < 0 || f.y < 0 || rect.x + rect.w > room.x + room.w || rect.y + rect.h > room.y + room.h;
  const overlaps = objectIndex(doc).query(rect).filter((o) => !ignore.has(o.id) && o.roomId === room.id && (o.blocking || f.blocking)).map((o) => o.id);
  const blocksDoor = f.blocking && room.doors.some((d) => doorInsideCells(room, d).some((c) => c.x >= rect.x && c.x < rect.x + rect.w && c.y >= rect.y && c.y < rect.y + rect.h));
  return { ok: !outside && !overlaps.length && !blocksDoor, outside, overlaps, blocksDoor, rect };
}

/** Nearest free spot in a room for an object type, optionally preferring a wall or a point. */
export function findObjectSpot(doc: OfficeDoc, room: Room, type: FurnitureType, opts: { near?: { x: number; y: number }; wall?: 'n' | 's' | 'e' | 'w'; rotation?: Furniture['rotation']; ignore?: Set<string>; w?: number; h?: number } = {}) {
  const meta = FURNITURE_META[type];
  const rotation = opts.rotation ?? 0;
  const base = { w: opts.w ?? meta.w, h: opts.h ?? meta.h, rotation, blocking: meta.blocking };
  const fp = footprint(base);
  const cands: { x: number; y: number; d: number }[] = [];
  for (let x = 0; x <= room.w - fp.w; x++) for (let y = 0; y <= room.h - fp.h; y++) {
    if (opts.wall === 'n' && y !== 0) continue;
    if (opts.wall === 's' && y !== room.h - fp.h) continue;
    if (opts.wall === 'w' && x !== 0) continue;
    if (opts.wall === 'e' && x !== room.w - fp.w) continue;
    const near = opts.near ?? { x: Math.floor(room.w / 2), y: Math.floor(room.h / 2) };
    cands.push({ x, y, d: Math.abs(x - near.x) + Math.abs(y - near.y) });
  }
  cands.sort((a, b) => a.d - b.d);
  for (const c of cands) {
    if (checkPlacement(doc, room, { ...base, x: c.x, y: c.y }, opts.ignore).ok) return { x: c.x, y: c.y, rotation };
  }
  return null;
}
