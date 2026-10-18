// Agent navigation graph. Walkable cells are room interiors (minus blocking
// furniture) and corridor bands (minus blocked corridors). Crossing a room wall
// is only allowed through a doorway edge, so agents never walk through walls.
import type { Furniture, OfficeDoc, Point, Room } from '../model/types';
import { bandCells, doorInsideCells, key, manhattan, polylineCells, rectContains, sideDelta } from './geometry';

export interface NavGraph {
  walkable: Set<string>;
  region: Map<string, string>;   // cell -> room id, or '' for corridor space
  doorEdges: Set<string>;        // "a|b" both directions
  version: number;
}

let navVersion = 0;

export function furnitureWorldRect(doc: OfficeDoc, f: Furniture) {
  const r = doc.rooms[f.roomId];
  const rot = f.rotation === 90 || f.rotation === 270;
  return { x: (r?.x ?? 0) + f.x, y: (r?.y ?? 0) + f.y, w: rot ? f.h : f.w, h: rot ? f.w : f.h };
}

// Small cache keyed on the layout slices' identities. Immer keeps unchanged
// slices identical, so profile edits, theme changes and simulation ticks reuse
// the graph instead of rebuilding it.
const navCache: { rooms: unknown; corridors: unknown; furniture: unknown; nav: NavGraph }[] = [];

export function buildNav(doc: OfficeDoc): NavGraph {
  const hit = navCache.find((c) => c.rooms === doc.rooms && c.corridors === doc.corridors && c.furniture === doc.furniture);
  if (hit) return hit.nav;
  const nav = buildNavUncached(doc);
  navCache.unshift({ rooms: doc.rooms, corridors: doc.corridors, furniture: doc.furniture, nav });
  navCache.length = Math.min(navCache.length, 4);
  return nav;
}

function buildNavUncached(doc: OfficeDoc): NavGraph {
  const walkable = new Set<string>();
  const region = new Map<string, string>();
  const doorEdges = new Set<string>();
  const roomCells = new Map<string, string>();
  for (const r of Object.values(doc.rooms)) {
    for (let x = r.x; x < r.x + r.w; x++) for (let y = r.y; y < r.y + r.h; y++) {
      const k = key(x, y); roomCells.set(k, r.id); region.set(k, r.id); walkable.add(k);
    }
  }
  for (const f of Object.values(doc.furniture)) {
    if (!f.blocking || !doc.rooms[f.roomId]) continue;
    const fr = furnitureWorldRect(doc, f);
    for (let x = fr.x; x < fr.x + fr.w; x++) for (let y = fr.y; y < fr.y + fr.h; y++) walkable.delete(key(x, y));
  }
  const blocked = new Set<string>();
  for (const c of Object.values(doc.corridors)) {
    const cells = bandCells(polylineCells(c.points), c.width);
    for (const p of cells) {
      const k = key(p.x, p.y);
      if (roomCells.has(k)) continue;
      if (c.blocked) { blocked.add(k); continue; }
      walkable.add(k); region.set(k, '');
    }
  }
  for (const k of blocked) { walkable.delete(k); }
  for (const r of Object.values(doc.rooms)) {
    for (const d of r.doors) {
      const dd = sideDelta[d.side];
      for (const c of doorInsideCells(r, d)) {
        const a = key(c.x, c.y), b = key(c.x + dd.x, c.y + dd.y);
        doorEdges.add(`${a}|${b}`); doorEdges.add(`${b}|${a}`);
      }
    }
  }
  return { walkable, region, doorEdges, version: ++navVersion };
}

export function canStep(nav: NavGraph, a: Point, b: Point): boolean {
  const ka = key(a.x, a.y), kb = key(b.x, b.y);
  if (!nav.walkable.has(kb)) return false;
  const ra = nav.region.get(ka) ?? '', rb = nav.region.get(kb) ?? '';
  if (ra === rb) return true;
  return nav.doorEdges.has(`${ka}|${kb}`);
}

const DIRS: Point[] = [{ x: 1, y: 0 }, { x: -1, y: 0 }, { x: 0, y: 1 }, { x: 0, y: -1 }];

/** A* path from `from` to `to` (inclusive of `to`, exclusive of `from`). null = unreachable. */
export function findPath(nav: NavGraph, from: Point, to: Point, limit = 60000): Point[] | null {
  const fk = key(from.x, from.y), tk = key(to.x, to.y);
  if (fk === tk) return [];
  if (!nav.walkable.has(tk)) return null;
  const g = new Map<string, number>([[fk, 0]]);
  const prev = new Map<string, string>();
  const open: { f: number; p: Point }[] = [{ f: manhattan(from, to), p: from }];
  const closed = new Set<string>();
  let n = 0;
  while (open.length && n++ < limit) {
    // small graphs: linear min-scan keeps this dependency-free and fast enough
    let bi = 0;
    for (let i = 1; i < open.length; i++) if (open[i].f < open[bi].f) bi = i;
    const { p } = open[bi]; open[bi] = open[open.length - 1]; open.pop();
    const pk = key(p.x, p.y);
    if (closed.has(pk)) continue;
    if (pk === tk) break;
    closed.add(pk);
    for (const d of DIRS) {
      const q = { x: p.x + d.x, y: p.y + d.y };
      const qk = key(q.x, q.y);
      if (closed.has(qk) || !canStep(nav, p, q)) continue;
      const ng = g.get(pk)! + 1;
      if (ng < (g.get(qk) ?? Infinity)) { g.set(qk, ng); prev.set(qk, pk); open.push({ f: ng + manhattan(q, to), p: q }); }
    }
  }
  if (!prev.has(tk)) return null;
  const path: Point[] = [];
  let cur: string | undefined = tk;
  while (cur && cur !== fk) { const [x, y] = cur.split(',').map(Number); path.push({ x, y }); cur = prev.get(cur); }
  return path.reverse();
}

/** Cell an agent stands on to use a workstation. */
export function workstationSpot(doc: OfficeDoc, nav: NavGraph, f: Furniture): Point | null {
  const r = furnitureWorldRect(doc, f);
  const room = doc.rooms[f.roomId];
  const cand: Point[] = [];
  for (let x = r.x; x < r.x + r.w; x++) cand.push({ x, y: r.y + r.h });       // in front (south)
  for (let x = r.x; x < r.x + r.w; x++) cand.push({ x, y: r.y - 1 });
  for (let y = r.y; y < r.y + r.h; y++) cand.push({ x: r.x - 1, y }, { x: r.x + r.w, y });
  return cand.find((c) => room && rectContains(room, c) && nav.walkable.has(key(c.x, c.y))) ?? null;
}

/** A free cell in a room, preferring the centre and avoiding occupied cells. */
export function roomSpot(nav: NavGraph, room: Room, occupied: Set<string> = new Set()): Point | null {
  const cx = room.x + Math.floor(room.w / 2), cy = room.y + Math.floor(room.h / 2);
  const cells: Point[] = [];
  for (let x = room.x; x < room.x + room.w; x++) for (let y = room.y; y < room.y + room.h; y++) cells.push({ x, y });
  cells.sort((a, b) => manhattan(a, { x: cx, y: cy }) - manhattan(b, { x: cx, y: cy }));
  return cells.find((c) => nav.walkable.has(key(c.x, c.y)) && !occupied.has(key(c.x, c.y)))
    ?? cells.find((c) => nav.walkable.has(key(c.x, c.y))) ?? null;
}

/** Rooms reachable from a cell; used by validation. */
export function reachableRooms(nav: NavGraph, from: Point): Set<string> {
  const seen = new Set<string>([key(from.x, from.y)]);
  const q = [from];
  const rooms = new Set<string>();
  while (q.length) {
    const p = q.shift()!;
    const r = nav.region.get(key(p.x, p.y)); if (r) rooms.add(r);
    for (const d of DIRS) {
      const n = { x: p.x + d.x, y: p.y + d.y }; const k = key(n.x, n.y);
      if (!seen.has(k) && canStep(nav, p, n)) { seen.add(k); q.push(n); }
    }
  }
  return rooms;
}
