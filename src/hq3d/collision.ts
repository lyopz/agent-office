// Continuous movement against the navigation grid: the avatar is a small circle
// that can only cross between regions (room ↔ tube) through doorway edges, and
// slides along walls instead of stopping dead. Pure, so it is tested in node.
import type { Point } from '../model/types';
import { key } from '../engine/geometry';
import { canStep, type NavGraph } from '../engine/navigation';
import type { XZ } from './layout';

export const PLAYER_RADIUS = 0.28;

export const cellOf = (x: number, z: number): Point => ({ x: Math.floor(x), y: Math.floor(z) });
const same = (a: Point, b: Point) => a.x === b.x && a.y === b.y;
const walk = (nav: NavGraph, c: Point) => nav.walkable.has(key(c.x, c.y));

/** Can you get from cell a to cell b (equal, orthogonal neighbours, or diagonal via either corner)? */
export function linked(nav: NavGraph, a: Point, b: Point): boolean {
  if (same(a, b)) return true;
  const dx = b.x - a.x, dy = b.y - a.y;
  if (Math.abs(dx) + Math.abs(dy) === 1) return canStep(nav, a, b);
  if (Math.abs(dx) === 1 && Math.abs(dy) === 1) {
    const c1 = { x: b.x, y: a.y }, c2 = { x: a.x, y: b.y };
    return (canStep(nav, a, c1) && canStep(nav, c1, b)) || (canStep(nav, a, c2) && canStep(nav, c2, b));
  }
  return false;
}

/** Is a circle of radius r at (x, z) a legal position for something currently standing in cell `from`? */
export function isPosValid(nav: NavGraph, from: Point, x: number, z: number, r = PLAYER_RADIUS): boolean {
  const c = cellOf(x, z);
  if (!walk(nav, from)) return walk(nav, c); // stuck somewhere odd: let them out onto any walkable cell
  if (!linked(nav, from, c)) return false;
  const d = r * 0.72;
  const probes: [number, number][] = [[x + r, z], [x - r, z], [x, z + r], [x, z - r], [x + d, z + d], [x - d, z + d], [x + d, z - d], [x - d, z - d]];
  for (const [px, pz] of probes) {
    const pc = cellOf(px, pz);
    if (!linked(nav, c, pc)) return false;
  }
  return true;
}

export interface MoveResult extends XZ { blocked: boolean }

/** Move by (dx, dz), sliding along walls. Sub-steps keep fast movement from tunnelling. */
export function moveWithCollision(nav: NavGraph, pos: XZ, dx: number, dz: number, r = PLAYER_RADIUS): MoveResult {
  const steps = Math.max(1, Math.ceil(Math.max(Math.abs(dx), Math.abs(dz)) / 0.2));
  const sx = dx / steps, sz = dz / steps;
  let x = pos.x, z = pos.z, blocked = false;
  for (let i = 0; i < steps; i++) {
    const from = cellOf(x, z);
    if (isPosValid(nav, from, x + sx, z + sz, r)) { x += sx; z += sz; continue; }
    blocked = true;
    if (sx && isPosValid(nav, from, x + sx, z, r)) { x += sx; continue; }
    if (sz && isPosValid(nav, from, x, z + sz, r)) { z += sz; continue; }
  }
  return { x, z, blocked };
}

/** Nearest walkable cell centre to a world point (spawn and recovery after layout edits). */
export function nearestWalkableWorld(nav: NavGraph, p: XZ, maxR = 40): XZ | null {
  const c = cellOf(p.x, p.z);
  if (walk(nav, c)) return { x: c.x + 0.5, z: c.y + 0.5 };
  for (let r = 1; r < maxR; r++) for (let dx = -r; dx <= r; dx++) for (let dy = -r; dy <= r; dy++) {
    if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
    const q = { x: c.x + dx, y: c.y + dy };
    if (walk(nav, q)) return { x: q.x + 0.5, z: q.y + 0.5 };
  }
  return null;
}

/** True when the position is inside a tube (corridor space) rather than a room. */
export function inTube(nav: NavGraph, p: XZ): boolean {
  const k = key(Math.floor(p.x), Math.floor(p.z));
  return nav.walkable.has(k) && nav.region.get(k) === '';
}
