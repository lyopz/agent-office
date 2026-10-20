// Pure scene description for the 3D headquarters. Turns the live OfficeDoc into
// plain descriptors (floors, walls with doorway gaps, bubble shells, signs,
// display slots, transport tubes) so the layout logic is testable without a GL
// context. One grid cell = one world unit; cell x → world x, cell y → world z.
import type { Corridor, CorridorEndpoint, Door, OfficeDoc, Point, Rect, Room, Side } from '../model/types';
import { FURNITURE_META, ROOM_META } from '../model/catalog';
import { boundsOf, doorAnchor, simplify } from '../engine/geometry';
import { furnitureWorldRect, roomSpot, type NavGraph } from '../engine/navigation';
import { nearestWalkableWorld } from './collision';

export interface XZ { x: number; z: number }

/** What a room is for, inferred from its type, name and purpose. Drives wall displays, lighting mood and signage. */
export const ROOM_THEMES = ['royal', 'dev', 'research', 'gamedesign', 'model3d', 'type', 'building', 'ads', 'ops', 'server', 'lounge', 'generic'] as const;
export type RoomTheme = (typeof ROOM_THEMES)[number];

export interface ThemeInfo { label: string; tagline: string; displays: string[] }
export const THEME_INFO: Record<RoomTheme, ThemeInfo> = {
  royal: { label: 'Command throne room', tagline: 'Headquarters command centre', displays: ['Command overview', 'Team status'] },
  dev: { label: 'Roblox development', tagline: 'Scripts, builds and live previews', displays: ['Code editor', 'Live build preview'] },
  research: { label: 'Research', tagline: 'References, notes and connected findings', displays: ['Findings board', 'Reference search'] },
  gamedesign: { label: 'Game design', tagline: 'Levels, loops and mechanics', displays: ['Level layout', 'Gameplay loop'] },
  model3d: { label: '3D design', tagline: 'Blueprints, wireframes and materials', displays: ['Blueprint', 'Material samples'] },
  type: { label: 'Typography and fonts', tagline: 'Type specimens and in-game previews', displays: ['Font comparison', 'Game UI preview'] },
  building: { label: 'Roblox building', tagline: 'Modular parts, terrain and build plans', displays: ['Build plan', 'Parts and scale'] },
  ads: { label: 'Advertising and creative', tagline: 'Campaigns, drafts and final assets', displays: ['Campaign board', 'Image drafts'] },
  ops: { label: 'Operations', tagline: 'Task flow and coordination', displays: ['Task board', 'Throughput'] },
  server: { label: 'Infrastructure', tagline: 'Compute and system health', displays: ['System health'] },
  lounge: { label: 'Lounge', tagline: 'Rest and recharge', displays: ['Welcome'] },
  generic: { label: 'Team room', tagline: 'Shared workspace', displays: ['Team board'] },
};

const THEME_RULES: [RegExp, RoomTheme][] = [
  [/royal|throne|king|queen|crown|command cent/, 'royal'],
  [/typograph|font|lettering|type studio|type-studio/, 'type'],
  [/advert|campaign|marketing|\bads?\b|imagery|creative image|brand/, 'ads'],
  [/\b3d\b|3d-|model|blender|sculpt|render/, 'model3d'],
  [/build|construct|terrain/, 'building'],
  [/game design|game-design|level|mechanic|gameplay|product design|\bdesign\b/, 'gamedesign'],
  [/research|library|market|intel|knowledge|archive/, 'research'],
  [/develop|\bdev\b|engineer|code|script|roblox|program|arcade/, 'dev'],
  [/server|infra|compute/, 'server'],
  [/break|lounge|rest/, 'lounge'],
  [/operation|ops|reception|security|finance|executive|office|meeting|workshop|storage/, 'ops'],
];

/** Room types with a fixed theme (including the Roblox HQ types; keyed by string so they compile either way). */
const TYPE_THEME: Record<string, RoomTheme> = {
  'throne-room': 'royal', 'royal-lounge': 'royal', 'roblox-dev': 'dev', 'game-design': 'gamedesign', '3d-design': 'model3d',
  typography: 'type', 'roblox-build': 'building', 'ad-studio': 'ads', research: 'research', library: 'research', market: 'research',
  'blender-studio': 'model3d', studio: 'ads', design: 'gamedesign', engineering: 'dev', arcade: 'dev', server: 'server', break: 'lounge',
};

export function roomTheme(room: Pick<Room, 'type' | 'name' | 'purpose'>, furnitureTypes: readonly string[] = []): RoomTheme {
  if (furnitureTypes.includes('throne') || furnitureTypes.includes('devil-bubble')) return 'royal';
  const fixed = TYPE_THEME[room.type as string];
  if (fixed) return fixed;
  const s = `${room.type} ${room.name} ${room.purpose ?? ''}`.toLowerCase();
  for (const [re, t] of THEME_RULES) if (re.test(s)) return t;
  return 'generic';
}

/** Team label for signage: the most common department among the room's agents, else the room type's label. */
export function roomTeam(doc: OfficeDoc, room: Room): string {
  const count = new Map<string, number>();
  for (const id of room.assignedAgentIds) {
    const d = doc.agents[id]?.identity.department;
    if (d) count.set(d, (count.get(d) ?? 0) + 1);
  }
  let best = ''; let n = 0;
  for (const [d, c] of count) if (c > n) { best = d; n = c; }
  return best || (ROOM_META as Record<string, { label: string } | undefined>)[room.type]?.label || THEME_INFO[roomTheme(room)].label;
}

export interface WallSeg { side: Side; x1: number; z1: number; x2: number; z2: number }
export interface DoorDesc { id: string; side: Side; x: number; z: number; width: number; normal: XZ }
export interface DisplaySlot { x: number; y: number; z: number; w: number; h: number; rotY: number; side: Side; index: number }
export interface RoomDesc {
  id: string; name: string; team: string; theme: RoomTheme; purpose: string;
  x: number; z: number; w: number; d: number; cx: number; cz: number;
  bubble: boolean;
  walls: WallSeg[];
  doors: DoorDesc[];
  wallHeight: number;
  dome: { a: number; b: number; height: number } | null;
  sign: { x: number; y: number; z: number };
  displays: DisplaySlot[];
  accent: string; floorColor: string | null; lighting: number;
}

export const WALL_HEIGHT = 1.7;
export const DISPLAY_Y = 2.55;

export const sideNormal: Record<Side, XZ> = { n: { x: 0, z: -1 }, s: { x: 0, z: 1 }, w: { x: -1, z: 0 }, e: { x: 1, z: 0 } };
/** rotation.y that turns a +z-facing plane to face into the room from a wall on this side. */
export const inwardRotY: Record<Side, number> = { n: 0, s: Math.PI, w: Math.PI / 2, e: -Math.PI / 2 };

export function doorMid(room: Rect, d: Door): XZ {
  const m = d.offset + d.width / 2;
  switch (d.side) {
    case 'n': return { x: room.x + m, z: room.y };
    case 's': return { x: room.x + m, z: room.y + room.h };
    case 'w': return { x: room.x, z: room.y + m };
    case 'e': return { x: room.x + room.w, z: room.y + m };
  }
}

function sideLine(r: Rect, side: Side) {
  switch (side) {
    case 'n': return { x1: r.x, z1: r.y, x2: r.x + r.w, z2: r.y };
    case 's': return { x1: r.x, z1: r.y + r.h, x2: r.x + r.w, z2: r.y + r.h };
    case 'w': return { x1: r.x, z1: r.y, x2: r.x, z2: r.y + r.h };
    case 'e': return { x1: r.x + r.w, z1: r.y, x2: r.x + r.w, z2: r.y + r.h };
  }
}

/** Wall segments along every side with gaps where doors are. */
export function wallSegments(room: Room): WallSeg[] {
  const out: WallSeg[] = [];
  for (const side of ['n', 's', 'w', 'e'] as Side[]) {
    const len = side === 'n' || side === 's' ? room.w : room.h;
    const gaps = room.doors.filter((d) => d.side === side).map((d) => [d.offset, d.offset + d.width] as const).sort((a, b) => a[0] - b[0]);
    const line = sideLine(room, side);
    let t = 0;
    const push = (a: number, b: number) => {
      if (b - a <= 1e-6) return;
      const horiz = side === 'n' || side === 's';
      out.push(horiz ? { side, x1: line.x1 + a, z1: line.z1, x2: line.x1 + b, z2: line.z1 } : { side, x1: line.x1, z1: line.z1 + a, x2: line.x1, z2: line.z1 + b });
    };
    for (const [a, b] of gaps) { push(t, Math.max(t, a)); t = Math.max(t, b); }
    push(t, len);
  }
  return out;
}

/** Where to hang the room's own wall displays: the side with fewest doors, between doors and wall-mounted objects. */
export function displaySlots(room: Room, bubble: boolean, tall: Rect[] = []): DisplaySlot[] {
  const order: Side[] = ['n', 'e', 'w', 's'];
  const doorsOn = (s: Side) => room.doors.filter((d) => d.side === s).length;
  const side = order.slice().sort((a, b) => doorsOn(a) - doorsOn(b) || order.indexOf(a) - order.indexOf(b))[0];
  const horiz = side === 'n' || side === 's';
  const len = horiz ? room.w : room.h;
  if (len < 4) return [];
  // occupied intervals along that wall: doors (+ margin)
  const blocked: [number, number][] = room.doors.filter((d) => d.side === side).map((d) => [d.offset - 0.6, d.offset + d.width + 0.6]);
  // tall wall-mounted objects already on that wall (briefing boards, render walls) keep their space
  for (const r of tall) {
    const near = side === 'n' ? r.y - room.y : side === 's' ? room.y + room.h - (r.y + r.h) : side === 'w' ? r.x - room.x : room.x + room.w - (r.x + r.w);
    if (near > 1.2) continue;
    const a = horiz ? r.x - room.x : r.y - room.y, len2 = horiz ? r.w : r.h;
    blocked.push([a - 0.3, a + len2 + 0.3]);
  }
  const count = len >= 13 ? 2 : 1;
  const w = Math.min(4.6, Math.max(2.4, (len - 2) / count - 0.8));
  const h = Math.min(2, w * 0.56);
  const slots: DisplaySlot[] = [];
  const free = (a: number) => a >= 0.4 && a + w <= len - 0.4 && blocked.every(([b0, b1]) => a + w <= b0 || a >= b1);
  const want = count === 1 ? [len / 2 - w / 2] : [len * 0.3 - w / 2, len * 0.7 - w / 2];
  for (const a0 of want) {
    let a: number | null = null;
    for (let k = 0; k <= len * 2 && a === null; k++) {
      for (const s of [1, -1]) { const c = a0 + s * k * 0.5; if (free(c) && slots.every((sl) => Math.abs(sl.index - c) >= w + 0.3)) { a = c; break; } }
    }
    if (a === null) continue;
    const inset = bubble ? 0.35 : 0.12;
    const line = sideLine(room, side);
    const n = sideNormal[side];
    const along = a + w / 2;
    const x = horiz ? line.x1 + along : line.x1 - n.x * inset;
    const z = horiz ? line.z1 - n.z * inset : line.z1 + along;
    slots.push({ x, y: DISPLAY_Y, z, w, h, rotY: inwardRotY[side], side, index: a });
  }
  return slots;
}

export function describeRoom(doc: OfficeDoc, room: Room): RoomDesc {
  const bubble = doc.settings.layoutPreset === 'bubble';
  const furnTypes = room.furnitureIds.map((id) => doc.furniture[id]?.type).filter(Boolean) as string[];
  const theme = roomTheme(room, furnTypes);
  const cx = room.x + room.w / 2, cz = room.y + room.h / 2;
  const domeH = Math.min(7, Math.max(3.6, Math.min(room.w, room.h) * 0.5 + 1.2));
  const dome = bubble ? { a: room.w / 2 * 1.08 + 0.55, b: room.h / 2 * 1.08 + 0.55, height: domeH } : null;
  return {
    id: room.id, name: room.name, team: roomTeam(doc, room), theme, purpose: room.purpose,
    x: room.x, z: room.y, w: room.w, d: room.h, cx, cz, bubble,
    walls: bubble ? [] : wallSegments(room),
    doors: room.doors.map((d) => ({ id: d.id, side: d.side, width: d.width, normal: sideNormal[d.side], ...doorMid(room, d) })),
    wallHeight: WALL_HEIGHT,
    dome,
    sign: { x: cx, y: (dome ? dome.height : WALL_HEIGHT + 2.3) + 0.9, z: cz },
    displays: displaySlots(room, bubble, room.furnitureIds.map((id) => doc.furniture[id]).filter((f) => f && (f.type === 'briefing-board' || f.type === 'render-wall' || f.type === 'window' || f.type === 'monitors')).map((f) => furnitureWorldRect(doc, f))),
    accent: room.appearance.accent, floorColor: room.appearance.floorColor ?? null, lighting: room.appearance.lighting,
  };
}

// ---------- tubes ----------

export interface TubeEnd { x: number; z: number; dir: XZ; roomId: string | null; label: string; kind: CorridorEndpoint['kind'] }
export interface TubeDesc {
  id: string; name: string; radius: number; centerY: number; floorWidth: number;
  points: XZ[];          // smoothable orthogonal centreline, including door stubs
  ends: TubeEnd[];
  blocked: boolean; status: Corridor['status'];
}

/** Tube cross-section: wider than the corridor band so avatars and agents fit comfortably. */
export function tubeSize(width: number) {
  const radius = Math.max(1.45, width / 2 + 0.55);
  const centerY = radius * 0.6;
  const floorWidth = 2 * Math.sqrt(radius * radius - centerY * centerY);
  return { radius, centerY, floorWidth };
}

/** Offset from a corridor's centreline cell to the centre of its band. */
export function bandCentreOffset(width: number): number {
  const lo = -Math.floor((width - 1) / 2), hi = Math.ceil((width - 1) / 2);
  return 0.5 + (lo + hi) / 2;
}

function endInfo(doc: OfficeDoc, e: CorridorEndpoint, p: XZ): { stub: XZ | null; end: TubeEnd } {
  if (e.kind === 'door') {
    const room = doc.rooms[e.roomId];
    const door = room?.doors.find((d) => d.id === e.doorId);
    if (room && door) {
      const n = sideNormal[door.side];
      const mid = doorMid(room, door);
      // project the band centre onto the wall line so the tube meets the doorway square-on
      const stub = n.x !== 0 ? { x: mid.x, z: p.z } : { x: p.x, z: mid.z };
      return { stub, end: { ...stub, dir: { x: -n.x, z: -n.z }, roomId: room.id, label: room.name, kind: 'door' } };
    }
  }
  return { stub: null, end: { ...p, dir: { x: 0, z: 0 }, roomId: null, label: 'Junction', kind: 'corridor' } };
}

export function describeTube(doc: OfficeDoc, c: Corridor): TubeDesc | null {
  if (c.points.length < 2) return null;
  const off = bandCentreOffset(c.width);
  const pts = simplify(c.points).map((p: Point) => ({ x: p.x + off, z: p.y + off }));
  const a = endInfo(doc, c.start, pts[0]);
  const b = endInfo(doc, c.end, pts[pts.length - 1]);
  const points = [...(a.stub ? [a.stub] : []), ...pts, ...(b.stub ? [b.stub] : [])];
  // drop duplicates and collinear interior points
  const clean: XZ[] = [];
  for (const p of points) {
    const q = clean[clean.length - 1];
    if (q && Math.abs(q.x - p.x) < 1e-6 && Math.abs(q.z - p.z) < 1e-6) continue;
    clean.push(p);
  }
  const out: XZ[] = [];
  for (let i = 0; i < clean.length; i++) {
    const p = clean[i], prev = out[out.length - 1], next = clean[i + 1];
    if (prev && next) {
      const cross = (p.x - prev.x) * (next.z - p.z) - (p.z - prev.z) * (next.x - p.x);
      const dot = (p.x - prev.x) * (next.x - p.x) + (p.z - prev.z) * (next.z - p.z);
      if (Math.abs(cross) < 1e-6 && dot > 0) continue;
    }
    out.push(p);
  }
  if (out.length < 2) return null;
  // ends: direction points out of the tube, into the room
  const endA = a.end.kind === 'door' ? a.end : { ...a.end, x: out[0].x, z: out[0].z };
  const endB = b.end.kind === 'door' ? b.end : { ...b.end, x: out[out.length - 1].x, z: out[out.length - 1].z };
  return { id: c.id, name: c.name, ...tubeSize(c.width), points: out, ends: [endA, endB], blocked: c.blocked, status: c.status };
}

export interface SceneDesc { rooms: RoomDesc[]; tubes: TubeDesc[]; bounds: Rect; bubble: boolean }

export function describeScene(doc: OfficeDoc): SceneDesc {
  const rooms = Object.values(doc.rooms).map((r) => describeRoom(doc, r));
  const tubes = Object.values(doc.corridors).map((c) => describeTube(doc, c)).filter((t): t is TubeDesc => !!t);
  return { rooms, tubes, bounds: boundsOf(Object.values(doc.rooms), 6), bubble: doc.settings.layoutPreset === 'bubble' };
}

/** Length of a polyline. */
export function polylineLength(pts: XZ[]): number {
  let n = 0;
  for (let i = 1; i < pts.length; i++) n += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].z - pts[i - 1].z);
  return n;
}

// ---------- spawn ----------

/** The throne room: a royal lounge, or the room holding a throne. */
export function throneRoom(doc: OfficeDoc): Room | null {
  const rooms = Object.values(doc.rooms);
  return rooms.find((r) => (r.type as string) === 'throne-room')
    ?? rooms.find((r) => r.type === 'royal-lounge')
    ?? rooms.find((r) => r.furnitureIds.some((id) => doc.furniture[id]?.type === 'throne'))
    ?? rooms.find((r) => roomTheme(r) === 'royal')
    ?? null;
}

/** Where the avatar appears: the last room visited, else the throne room, else the first room. */
export function spawnRoom(doc: OfficeDoc): Room | null {
  const last = doc.player?.lastRoomId ? doc.rooms[doc.player.lastRoomId] : undefined;
  return last ?? throneRoom(doc) ?? Object.values(doc.rooms)[0] ?? null;
}

/** Spawn point: in the throne room a few steps in front of the throne, looking at it; elsewhere the room centre. */
export function spawnPoint(doc: OfficeDoc, nav: NavGraph): { pos: XZ; yaw: number; roomId: string | null } {
  const room = spawnRoom(doc);
  if (!room) return { pos: { x: 0.5, z: 0.5 }, yaw: 0, roomId: null };
  const throne = room.furnitureIds.map((id) => doc.furniture[id]).find((f) => f?.type === 'throne');
  if (throne) {
    const cx = room.x + throne.x + throne.w / 2, cz = room.y + throne.y + throne.h / 2;
    const want = { x: cx, z: Math.min(room.y + room.h - 1.5, cz + 5) };
    const p = nearestWalkableWorld(nav, want);
    if (p && roomAtWorld(doc, p.x, p.z)?.id === room.id) return { pos: p, yaw: Math.atan2(-(cx - p.x), -(cz - p.z)), roomId: room.id };
  }
  const s = roomSpot(nav, room);
  return { pos: s ? { x: s.x + 0.5, z: s.y + 0.5 } : { x: room.x + room.w / 2, z: room.y + room.h / 2 }, yaw: 0, roomId: room.id };
}

/** Room containing a world position (x, z), if any. */
export function roomAtWorld(doc: OfficeDoc, x: number, z: number): Room | null {
  const cx = Math.floor(x), cz = Math.floor(z);
  for (const r of Object.values(doc.rooms)) if (cx >= r.x && cx < r.x + r.w && cz >= r.y && cz < r.y + r.h) return r;
  return null;
}

/** Furniture footprint in world units with its height class, for collision-free decoration and tests. */
export function furnitureFootprint(doc: OfficeDoc, id: string) {
  const f = doc.furniture[id];
  if (!f) return null;
  const r = furnitureWorldRect(doc, f);
  const meta = (FURNITURE_META as Record<string, (typeof FURNITURE_META)[keyof typeof FURNITURE_META] | undefined>)[f.type];
  return { ...r, wall: !!meta?.wall, fn: meta?.fn ?? 'none', blocking: f.blocking };
}

/** Which wall a wall-mounted object sits against: the nearest side of its room. */
export function nearestWall(room: Rect, r: Rect): Side {
  const d: [Side, number][] = [
    ['n', r.y - room.y], ['s', room.y + room.h - (r.y + r.h)], ['w', r.x - room.x], ['e', room.x + room.w - (r.x + r.w)],
  ];
  return d.sort((a, b) => a[1] - b[1])[0][0];
}

/** Entrances for a door anchor cell, used by tests and the tube map. */
export function doorAnchorWorld(room: Room, d: Door): XZ { const a = doorAnchor(room, d); return { x: a.x + 0.5, z: a.y + 0.5 }; }
