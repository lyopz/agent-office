// Hallway routing: orthogonal A* over the cell grid. Corridors connect real
// doorways (or join another corridor for T-junctions / crossings) and are
// rerouted when the rooms they serve move.
import type { Corridor, CorridorEndpoint, OfficeDoc, Point, Room } from '../model/types';
import {
  bandCells, boundsOf, doorAnchor, isOrthogonal, key, manhattan, polylineCells, simplify,
} from './geometry';

export interface ResolvedEndpoint {
  targets: Point[];          // acceptable centerline cells
  anchor: Point | null;      // exact attachment cell (door endpoints)
  room: Room | null;
  error?: string;
}

export function resolveEndpoint(doc: OfficeDoc, ep: CorridorEndpoint): ResolvedEndpoint {
  if (ep.kind === 'door') {
    const room = doc.rooms[ep.roomId];
    if (!room) return { targets: [], anchor: null, room: null, error: 'Endpoint room no longer exists' };
    const door = room.doors.find((d) => d.id === ep.doorId);
    if (!door) return { targets: [], anchor: null, room, error: `Door on ${room.name} no longer exists` };
    const a = doorAnchor(room, door);
    return { targets: [a], anchor: a, room };
  }
  const c = doc.corridors[ep.corridorId];
  if (!c || c.points.length === 0) return { targets: [], anchor: null, room: null, error: 'Joined corridor no longer exists' };
  return { targets: polylineCells(c.points), anchor: null, room: null };
}

function roomCellSet(doc: OfficeDoc): Map<string, string> {
  const m = new Map<string, string>();
  for (const r of Object.values(doc.rooms)) {
    for (let x = r.x; x < r.x + r.w; x++) for (let y = r.y; y < r.y + r.h; y++) m.set(key(x, y), r.id);
  }
  return m;
}

function corridorCellSet(doc: OfficeDoc, exclude: string): Set<string> {
  const s = new Set<string>();
  for (const c of Object.values(doc.corridors)) {
    if (c.id === exclude) continue;
    for (const p of polylineCells(c.points)) s.add(key(p.x, p.y));
  }
  return s;
}

const DIRS: Point[] = [{ x: 1, y: 0 }, { x: -1, y: 0 }, { x: 0, y: 1 }, { x: 0, y: -1 }];

// Small binary heap keyed by f-score.
class Heap<T> {
  private a: { f: number; v: T }[] = [];
  get size() { return this.a.length; }
  push(f: number, v: T) {
    const a = this.a; a.push({ f, v });
    let i = a.length - 1;
    while (i > 0) { const p = (i - 1) >> 1; if (a[p].f <= a[i].f) break; [a[p], a[i]] = [a[i], a[p]]; i = p; }
  }
  pop(): T {
    const a = this.a; const top = a[0]; const last = a.pop()!;
    if (a.length) {
      a[0] = last; let i = 0;
      for (;;) {
        const l = i * 2 + 1, r = l + 1; let m = i;
        if (l < a.length && a[l].f < a[m].f) m = l;
        if (r < a.length && a[r].f < a[m].f) m = r;
        if (m === i) break; [a[m], a[i]] = [a[i], a[m]]; i = m;
      }
    }
    return top.v;
  }
}

export interface RouteResult { points: Point[]; ok: boolean; message?: string }

export function routeBetween(
  doc: OfficeDoc, start: ResolvedEndpoint, end: ResolvedEndpoint, width: number, selfId: string,
): RouteResult {
  if (start.error || end.error) return { points: [], ok: false, message: start.error ?? end.error };
  if (!start.targets.length || !end.targets.length) return { points: [], ok: false, message: 'Missing endpoint' };
  const rooms = roomCellSet(doc);
  const reuse = corridorCellSet(doc, selfId);
  const all = Object.values(doc.rooms);
  const b = boundsOf(all, 12);
  const endSet = new Set(end.targets.map((p) => key(p.x, p.y)));
  const endpointRooms = new Set([start.room?.id, end.room?.id].filter(Boolean) as string[]);
  const anchors = [start.anchor, end.anchor].filter(Boolean) as Point[];

  const centerOk = (c: Point): boolean => {
    if (c.x < b.x || c.y < b.y || c.x >= b.x + b.w || c.y >= b.y + b.h) return false;
    if (rooms.has(key(c.x, c.y))) return false;
    if (width <= 1) return true;
    // wide corridors: band must stay clear of rooms, except right at a doorway
    const near = anchors.some((a) => manhattan(a, c) < width);
    for (const p of bandCells([c], width)) {
      const rid = rooms.get(key(p.x, p.y));
      if (rid && !(near && endpointRooms.has(rid))) return false;
    }
    return true;
  };

  const h = (p: Point) => {
    if (end.targets.length === 1) return manhattan(p, end.targets[0]);
    let m = Infinity;
    for (let i = 0; i < end.targets.length; i += 2) m = Math.min(m, manhattan(p, end.targets[i]));
    return m;
  };

  type Node = { p: Point; d: number };
  const g = new Map<string, number>();
  const prev = new Map<string, string>();
  const heap = new Heap<Node>();
  for (const s of start.targets) {
    if (!centerOk(s)) continue;
    const sk = `${key(s.x, s.y)}|4`;
    g.set(sk, 0);
    heap.push(h(s), { p: s, d: 4 });
  }
  if (!heap.size) return { points: [], ok: false, message: 'Doorway exit is blocked by another room' };

  let found: string | null = null;
  let guard = 0;
  while (heap.size && guard++ < 200000) {
    const n = heap.pop();
    const nk = `${key(n.p.x, n.p.y)}|${n.d}`;
    const gn = g.get(nk)!;
    if (endSet.has(key(n.p.x, n.p.y))) { found = nk; break; }
    for (let d = 0; d < 4; d++) {
      const q = { x: n.p.x + DIRS[d].x, y: n.p.y + DIRS[d].y };
      if (!centerOk(q) && !endSet.has(key(q.x, q.y))) continue;
      const turn = n.d !== 4 && n.d !== d ? 3 : 0;
      const step = reuse.has(key(q.x, q.y)) ? 0.7 : 1;
      const qk = `${key(q.x, q.y)}|${d}`;
      const ng = gn + step + turn;
      if (ng < (g.get(qk) ?? Infinity)) {
        g.set(qk, ng); prev.set(qk, nk);
        heap.push(ng + h(q), { p: q, d });
      }
    }
  }
  if (!found) return { points: [], ok: false, message: 'No clear route between endpoints' };
  const cells: Point[] = [];
  let cur: string | undefined = found;
  while (cur) {
    const [xy] = cur.split('|');
    const [x, y] = xy.split(',').map(Number);
    cells.push({ x, y });
    cur = prev.get(cur);
  }
  cells.reverse();
  return { points: simplify(cells), ok: true };
}

/** Keep a manually routed corridor attached: pin its ends to the current anchors. */
export function pinManual(doc: OfficeDoc, c: Corridor): Point[] {
  if (c.points.length < 2) return c.points;
  const pts = c.points.map((p) => ({ ...p }));
  const s = resolveEndpoint(doc, c.start);
  const e = resolveEndpoint(doc, c.end);
  const attach = (pts: Point[], r: ResolvedEndpoint, ep: CorridorEndpoint, atStart: boolean) => {
    if (!r.targets.length) return pts;
    const idx = atStart ? 0 : pts.length - 1;
    const nb = atStart ? pts[1] : pts[pts.length - 2];
    let target = r.anchor;
    if (!target) {
      // joining a corridor: nearest cell on it to the current end
      target = r.targets.reduce((best, t) => (manhattan(t, pts[idx]) < manhattan(best, pts[idx]) ? t : best), r.targets[0]);
    }
    pts[idx] = { ...target };
    if (nb.x !== target.x && nb.y !== target.y) {
      // insert an elbow, preferring to leave the doorway straight out
      const elbow = { x: target.x, y: nb.y };
      if (r.anchor && r.room) {
        const door = ep.kind === 'door' ? r.room.doors.find((d) => d.id === ep.doorId) : undefined;
        if (door && (door.side === 'e' || door.side === 'w')) { elbow.x = nb.x; elbow.y = target.y; }
      }
      if (atStart) pts.splice(1, 0, elbow); else pts.splice(pts.length - 1, 0, elbow);
    }
    return pts;
  };
  let out = attach(pts, s, c.start, true);
  out = attach(out, e, c.end, false);
  return simplify(dedupe(out));
}

function dedupe(pts: Point[]) {
  return pts.filter((p, i) => i === 0 || p.x !== pts[i - 1].x || p.y !== pts[i - 1].y);
}

export function effectiveRouting(doc: OfficeDoc, c: Corridor): 'auto' | 'manual' {
  const mode = doc.settings.hallwayMode;
  if (mode === 'automatic') return 'auto';
  if (mode === 'manual') return 'manual';
  return c.isMain ? 'manual' : c.routing;
}

function needsReroute(doc: OfficeDoc, c: Corridor, rooms: Map<string, string>): boolean {
  if (c.points.length < 2 || c.status === 'broken') return true;
  const s = resolveEndpoint(doc, c.start), e = resolveEndpoint(doc, c.end);
  const first = c.points[0], last = c.points[c.points.length - 1];
  const onTarget = (p: Point, r: ResolvedEndpoint) => r.targets.some((t) => t.x === p.x && t.y === p.y);
  if (!onTarget(first, s) || !onTarget(last, e)) return true;
  for (const p of polylineCells(c.points)) if (rooms.has(key(p.x, p.y))) return true;
  return false;
}

function orderCorridors(doc: OfficeDoc): Corridor[] {
  const list = Object.values(doc.corridors);
  const done = new Set<string>();
  const out: Corridor[] = [];
  const visit = (c: Corridor, stack: Set<string>) => {
    if (done.has(c.id) || stack.has(c.id)) return;
    stack.add(c.id);
    for (const ep of [c.start, c.end]) if (ep.kind === 'corridor' && doc.corridors[ep.corridorId]) visit(doc.corridors[ep.corridorId], stack);
    done.add(c.id); out.push(c);
  };
  for (const c of list) visit(c, new Set());
  return out;
}

/**
 * Bring every corridor in line with the current room geometry. Mutates `doc`
 * (call inside an immer producer). `force` reroutes all automatic corridors
 * ("Realign Hallways"); otherwise only corridors whose ends moved or that now
 * cut through a room are rerouted, so unrelated hallways keep their shape.
 */
export function updateCorridors(doc: OfficeDoc, force = false): void {
  const rooms = roomCellSet(doc);
  for (const c0 of orderCorridors(doc)) {
    const c = doc.corridors[c0.id];
    const s = resolveEndpoint(doc, c.start), e = resolveEndpoint(doc, c.end);
    if (s.error || e.error) { c.status = 'broken'; c.statusMessage = s.error ?? e.error; continue; }
    if (effectiveRouting(doc, c) === 'auto') {
      if (!force && !needsReroute(doc, c, rooms)) { c.status = 'ok'; c.statusMessage = undefined; continue; }
      const r = routeBetween(doc, s, e, c.width, c.id);
      if (r.ok) { c.points = r.points; c.status = 'ok'; c.statusMessage = undefined; }
      else { c.status = 'broken'; c.statusMessage = r.message; }
    } else {
      c.points = pinManual(doc, c);
      const through = polylineCells(c.points).some((p) => rooms.has(key(p.x, p.y)));
      if (!isOrthogonal(c.points)) { c.status = 'warning'; c.statusMessage = 'Manual route has a diagonal segment'; }
      else if (through) { c.status = 'warning'; c.statusMessage = 'Manual route passes through a room wall'; }
      else { c.status = 'ok'; c.statusMessage = undefined; }
    }
  }
}

