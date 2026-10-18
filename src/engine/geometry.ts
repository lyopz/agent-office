import type { Door, Point, Rect, Room, Side } from '../model/types';

export const key = (x: number, y: number) => `${x},${y}`;
export const parseKey = (k: string): Point => {
  const [x, y] = k.split(',').map(Number);
  return { x, y };
};

export function rectsOverlap(a: Rect, b: Rect, gap = 0): boolean {
  return a.x < b.x + b.w + gap && b.x < a.x + a.w + gap && a.y < b.y + b.h + gap && b.y < a.y + a.h + gap;
}

export function rectContains(r: Rect, p: Point): boolean {
  return p.x >= r.x && p.x < r.x + r.w && p.y >= r.y && p.y < r.y + r.h;
}

export function snap(v: number, enabled: boolean, step = 1): number {
  return enabled ? Math.round(v / step) * step : Math.round(v);
}

export function wallLength(room: Rect, side: Side): number {
  return side === 'n' || side === 's' ? room.w : room.h;
}

/** Clamp a door so it always sits fully on its wall, away from corners. */
export function clampDoor(room: Rect, door: Door): Door {
  const len = wallLength(room, door.side);
  const width = Math.max(1, Math.min(door.width, Math.max(1, len - 2)));
  const offset = Math.max(len > 2 ? 1 : 0, Math.min(door.offset, len - width - (len > 2 ? 1 : 0)));
  return { ...door, width, offset };
}

/** Wall cells (inside the room) covered by the door. */
export function doorInsideCells(room: Rect, door: Door): Point[] {
  const cells: Point[] = [];
  for (let i = 0; i < door.width; i++) {
    const o = door.offset + i;
    if (door.side === 'n') cells.push({ x: room.x + o, y: room.y });
    if (door.side === 's') cells.push({ x: room.x + o, y: room.y + room.h - 1 });
    if (door.side === 'w') cells.push({ x: room.x, y: room.y + o });
    if (door.side === 'e') cells.push({ x: room.x + room.w - 1, y: room.y + o });
  }
  return cells;
}

export const sideDelta: Record<Side, Point> = {
  n: { x: 0, y: -1 }, s: { x: 0, y: 1 }, w: { x: -1, y: 0 }, e: { x: 1, y: 0 },
};

/** Cells immediately outside the door. */
export function doorOutsideCells(room: Rect, door: Door): Point[] {
  const d = sideDelta[door.side];
  return doorInsideCells(room, door).map((c) => ({ x: c.x + d.x, y: c.y + d.y }));
}

/** The single centre cell just outside a door; corridors attach here. */
export function doorAnchor(room: Rect, door: Door): Point {
  const outs = doorOutsideCells(room, door);
  return outs[Math.floor((outs.length - 1) / 2)];
}

/** Door opening segment in cell-edge coordinates, for rendering. */
export function doorSegment(room: Rect, door: Door): { a: Point; b: Point } {
  const s = door.offset, e = door.offset + door.width;
  switch (door.side) {
    case 'n': return { a: { x: room.x + s, y: room.y }, b: { x: room.x + e, y: room.y } };
    case 's': return { a: { x: room.x + s, y: room.y + room.h }, b: { x: room.x + e, y: room.y + room.h } };
    case 'w': return { a: { x: room.x, y: room.y + s }, b: { x: room.x, y: room.y + e } };
    case 'e': return { a: { x: room.x + room.w, y: room.y + s }, b: { x: room.x + room.w, y: room.y + e } };
  }
}

/** Pick the wall facing a target point, and a door offset nearest that point. */
export function doorFacing(room: Rect, target: Point, width = 2): Pick<Door, 'side' | 'offset' | 'width'> {
  const cx = room.x + room.w / 2, cy = room.y + room.h / 2;
  const dx = target.x - cx, dy = target.y - cy;
  let side: Side;
  if (Math.abs(dx) / room.w > Math.abs(dy) / room.h) side = dx > 0 ? 'e' : 'w';
  else side = dy > 0 ? 's' : 'n';
  const along = side === 'n' || side === 's' ? target.x - room.x : target.y - room.y;
  const offset = Math.round(along - width / 2);
  return clampDoor(room, { id: '', side, offset, width });
}

export function roomCenter(r: Rect): Point {
  return { x: r.x + r.w / 2, y: r.y + r.h / 2 };
}

export function roomAt(rooms: Room[], p: Point): Room | undefined {
  return rooms.find((r) => rectContains(r, p));
}

export function manhattan(a: Point, b: Point) {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
}

/** Expand an orthogonal polyline into every grid cell along it. */
export function polylineCells(points: Point[]): Point[] {
  const out: Point[] = [];
  const seen = new Set<string>();
  const push = (p: Point) => { const k = key(p.x, p.y); if (!seen.has(k)) { seen.add(k); out.push(p); } };
  for (let i = 0; i < points.length; i++) {
    const a = points[i];
    if (i === 0) push(a);
    if (i === points.length - 1) break;
    const b = points[i + 1];
    const sx = Math.sign(b.x - a.x), sy = Math.sign(b.y - a.y);
    let x = a.x, y = a.y;
    // non-orthogonal segments step x first, then y (keeps cells connected)
    while (x !== b.x) { x += sx; push({ x, y }); }
    while (y !== b.y) { y += sy; push({ x, y }); }
  }
  return out;
}

/** Cells covered by a corridor of the given width around its centerline cells. */
export function bandCells(center: Point[], width: number): Point[] {
  if (width <= 1) return center;
  const lo = -Math.floor((width - 1) / 2), hi = Math.ceil((width - 1) / 2);
  const seen = new Set<string>();
  const out: Point[] = [];
  for (const c of center) {
    for (let dx = lo; dx <= hi; dx++) for (let dy = lo; dy <= hi; dy++) {
      const k = key(c.x + dx, c.y + dy);
      if (!seen.has(k)) { seen.add(k); out.push({ x: c.x + dx, y: c.y + dy }); }
    }
  }
  return out;
}

/** Collapse collinear points so only corners remain. */
export function simplify(points: Point[]): Point[] {
  if (points.length <= 2) return points.slice();
  const out = [points[0]];
  for (let i = 1; i < points.length - 1; i++) {
    const a = out[out.length - 1], b = points[i], c = points[i + 1];
    const collinear = (a.x === b.x && b.x === c.x) || (a.y === b.y && b.y === c.y);
    if (!collinear) out.push(b);
  }
  out.push(points[points.length - 1]);
  return out;
}

export function isOrthogonal(points: Point[]): boolean {
  for (let i = 1; i < points.length; i++) {
    if (points[i].x !== points[i - 1].x && points[i].y !== points[i - 1].y) return false;
  }
  return true;
}

export function boundsOf(rects: Rect[], pad = 0): Rect {
  if (!rects.length) return { x: 0, y: 0, w: 40, h: 30 };
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const r of rects) { x0 = Math.min(x0, r.x); y0 = Math.min(y0, r.y); x1 = Math.max(x1, r.x + r.w); y1 = Math.max(y1, r.y + r.h); }
  return { x: x0 - pad, y: y0 - pad, w: x1 - x0 + pad * 2, h: y1 - y0 + pad * 2 };
}
