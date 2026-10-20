// Fast travel through the tube network: a walkable route (A* over the same
// navigation graph agents use) from the avatar to a room, simplified to corners
// so the glide is smooth. Pure and testable.
import type { OfficeDoc } from '../model/types';
import { key, simplify } from '../engine/geometry';
import { findPath, roomSpot, type NavGraph } from '../engine/navigation';
import { cellOf, nearestWalkableWorld } from './collision';
import { polylineLength, type XZ } from './layout';

export interface TravelRoute { points: XZ[]; length: number; viaTubes: boolean; tubeCells: number; target: XZ }

export function fastTravelRoute(doc: OfficeDoc, nav: NavGraph, from: XZ, roomId: string): TravelRoute | null {
  const room = doc.rooms[roomId];
  if (!room) return null;
  const startW = nearestWalkableWorld(nav, from);
  const spot = roomSpot(nav, room);
  if (!startW || !spot) return null;
  const start = cellOf(startW.x, startW.z);
  const path = findPath(nav, start, spot);
  if (!path) return null;
  const cells = [start, ...path];
  const tubeCells = cells.filter((c) => nav.region.get(key(c.x, c.y)) === '').length;
  const corners = simplify(cells).map((c) => ({ x: c.x + 0.5, z: c.y + 0.5 }));
  const points = [{ x: from.x, z: from.z }, ...corners];
  return { points, length: polylineLength(points), viaTubes: tubeCells > 0, tubeCells, target: { x: spot.x + 0.5, z: spot.y + 0.5 } };
}

/** Point and heading at distance d along a route. */
export function sampleRoute(points: XZ[], d: number): { p: XZ; dir: XZ; done: boolean } {
  let left = Math.max(0, d);
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1], b = points[i];
    const len = Math.hypot(b.x - a.x, b.z - a.z);
    if (len < 1e-9) continue;
    if (left <= len) {
      const t = left / len;
      return { p: { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t }, dir: { x: (b.x - a.x) / len, z: (b.z - a.z) / len }, done: false };
    }
    left -= len;
  }
  const n = points.length;
  const a = points[Math.max(0, n - 2)], b = points[n - 1];
  const len = Math.hypot(b.x - a.x, b.z - a.z) || 1;
  return { p: { ...b }, dir: { x: (b.x - a.x) / len, z: (b.z - a.z) / len }, done: true };
}

/** Glide speed scales with distance so long trips stay quick (about 1.2–3.5 s). */
export function glideSpeed(length: number): number { return Math.max(9, Math.min(40, length / 2.2)); }
