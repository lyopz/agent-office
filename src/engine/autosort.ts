// Auto Sort: rearrange rooms so teams that work together sit together.
// Affinity between two rooms comes from shared teams, agent interactions
// (handoffs, visits, supervision, shared projects) and shared resources (tube
// stations, the break room, servers). Rooms are placed greedily, strongest
// links first, then hallways are rerouted with the rooms in one undoable step.
import type { Corridor, OfficeDoc, Point, Room, RuntimeState } from '../model/types';
import type { DocOp } from './ops';
import { applyOps } from './ops';
import { doorFacing, manhattan, rectsOverlap, roomCenter } from './geometry';
import { effectiveRouting, resolveEndpoint, routeBetween } from './routing';
import { stationFor, tubeStations } from './tubes';

export interface Link { score: number; reasons: Map<string, number> }
export interface AutoSortMove { roomId: string; name: string; from: Point; to: Point; reason: string }
export interface AutoSortPlan {
  ops: DocOp[];
  moves: AutoSortMove[];
  groups: { name: string; roomIds: string[] }[];
  before: number;          // collaboration distance: Σ affinity × distance between room centres
  after: number;
  preset: OfficeDoc['settings']['layoutPreset'];
  message: string;
}

const pair = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);

function roomOfAgent(doc: OfficeDoc, rt: RuntimeState | null, id: string | null | undefined): string | null {
  if (!id) return null;
  const a = doc.agents[id];
  const r = a?.schedule.assignedRoomId ?? rt?.agents[id]?.roomId ?? null;
  return r && doc.rooms[r] ? r : null;
}

/** The team a room mostly hosts, or a name for its function when nobody is assigned. */
export function roomTeam(doc: OfficeDoc, room: Room): string {
  const counts = new Map<string, number>();
  for (const a of Object.values(doc.agents)) if (a.schedule.assignedRoomId === room.id) counts.set(a.identity.department, (counts.get(a.identity.department) ?? 0) + 1);
  const top = [...counts.entries()].sort((p, q) => q[1] - p[1])[0];
  if (top) return top[0];
  return SHARED_TYPES.has(room.type) ? 'Shared services' : room.name;
}
const SHARED_TYPES = new Set<Room['type']>(['break', 'reception', 'storage', 'security', 'meeting', 'server', 'library']);

export function roomAffinity(doc: OfficeDoc, rt: RuntimeState | null): Map<string, Link> {
  const links = new Map<string, Link>();
  const add = (a: string | null, b: string | null, score: number, reason: string) => {
    if (!a || !b || a === b || !doc.rooms[a] || !doc.rooms[b]) return;
    const k = pair(a, b);
    const l = links.get(k) ?? { score: 0, reasons: new Map() };
    l.score += score; l.reasons.set(reason, (l.reasons.get(reason) ?? 0) + 1);
    links.set(k, l);
  };
  const rooms = Object.values(doc.rooms);
  // teams: rooms that host the same department belong together
  const byDept = new Map<string, Set<string>>();
  for (const a of Object.values(doc.agents)) {
    const r = a.schedule.assignedRoomId; if (!r || !doc.rooms[r]) continue;
    (byDept.get(a.identity.department) ?? byDept.set(a.identity.department, new Set()).get(a.identity.department)!).add(r);
  }
  for (const [dept, set] of byDept) { const ids = [...set]; for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) add(ids[i], ids[j], 4, `same team (${dept})`); }
  // supervision
  for (const a of Object.values(doc.agents)) if (a.skills.supervisorId) add(roomOfAgent(doc, rt, a.id), roomOfAgent(doc, rt, a.skills.supervisorId), 1.5, 'reports to a lead there');
  // interactions from live work: handoffs, visits to other rooms, shared projects
  const projRooms = new Map<string, Set<string>>();
  for (const t of Object.values(rt?.tasks ?? {})) {
    const home = roomOfAgent(doc, rt, t.agentId);
    if (t.handoff?.fromAgentId) add(home, roomOfAgent(doc, rt, t.handoff.fromAgentId), 1, 'handoff');
    if (t.destination.roomId) add(home, t.destination.roomId, 0.6, 'work visit');
    if (t.projectId && home) (projRooms.get(t.projectId) ?? projRooms.set(t.projectId, new Set()).get(t.projectId)!).add(home);
  }
  for (const p of Object.values(doc.projects)) {
    const owner = roomOfAgent(doc, rt, p.ownerAgentId);
    if (owner) (projRooms.get(p.id) ?? projRooms.set(p.id, new Set()).get(p.id)!).add(owner);
  }
  for (const [pid, set] of projRooms) { const ids = [...set]; for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) add(ids[i], ids[j], 1, `same project (${doc.projects[pid]?.name ?? 'project'})`); }
  // shared resources: the tube station a room relies on, break rooms and servers serve everyone
  if (tubeStations(doc).length) for (const r of rooms) {
    const someone = Object.values(doc.agents).find((a) => a.schedule.assignedRoomId === r.id);
    const st = someone ? stationFor(doc, someone.id) : null;
    if (st && st.roomId !== r.id) add(r.id, st.roomId, 1.2, 'shares its tube station');
  }
  const staffed = rooms.filter((r) => r.assignedAgentIds.length || Object.values(doc.agents).some((a) => a.schedule.assignedRoomId === r.id));
  for (const hub of rooms.filter((r) => r.type === 'break' || r.type === 'server')) for (const r of staffed) add(r.id, hub.id, 0.25, hub.type === 'break' ? 'uses the break room' : 'runs on its servers');
  // existing hallways: keep connected rooms close so the plan stays familiar
  for (const c of Object.values(doc.corridors)) if (c.start.kind === 'door' && c.end.kind === 'door') add(c.start.roomId, c.end.roomId, 0.8, 'already linked by a hallway');
  return links;
}

export function collaborationDistance(rooms: Record<string, Pick<Room, 'x' | 'y' | 'w' | 'h'>>, links: Map<string, Link>): number {
  let t = 0;
  for (const [k, l] of links) { const [a, b] = k.split('|'); if (rooms[a] && rooms[b]) t += l.score * manhattan(roomCenter(rooms[a]), roomCenter(rooms[b])); }
  return Math.round(t);
}

function describe(l: Link): string {
  return [...l.reasons.entries()].sort((p, q) => q[1] - p[1]).slice(0, 2).map(([r, n]) => (n > 1 && !r.startsWith('same') ? `${n} ${r}s` : r)).join(', ');
}

/**
 * Plan a new arrangement. Pure: returns the ops (room moves, door re-aiming,
 * rerouted hallways) and a short explanation; nothing changes until they're committed.
 */
export function planAutoSort(doc: OfficeDoc, rt: RuntimeState | null): AutoSortPlan {
  const preset = doc.settings.layoutPreset ?? 'grid';
  const rooms = Object.values(doc.rooms);
  const links = roomAffinity(doc, rt);
  const before = collaborationDistance(doc.rooms, links);
  const empty = (message: string): AutoSortPlan => ({ ops: [], moves: [], groups: [], before, after: before, preset, message });
  if (rooms.length < 2) return empty('Add at least two rooms to sort.');

  const aff = (a: string, b: string) => links.get(pair(a, b))?.score ?? 0;
  const team = new Map(rooms.map((r) => [r.id, roomTeam(doc, r)]));
  // bubble pods float further apart, with a wider gap between different teams
  const gapFor = (a: string, b: string) => preset === 'bubble' ? (team.get(a) === team.get(b) ? 4 : 6) : (team.get(a) === team.get(b) ? 3 : 4);
  const total = new Map(rooms.map((r) => [r.id, rooms.reduce((t, o) => t + aff(r.id, o.id), 0)]));

  const placed = new Map<string, { x: number; y: number; w: number; h: number }>();
  const order = rooms.slice().sort((p, q) => (total.get(q.id)! - total.get(p.id)!) || p.id.localeCompare(q.id));
  const first = order[0];
  placed.set(first.id, { x: 0, y: 0, w: first.w, h: first.h });
  const left = new Set(order.slice(1).map((r) => r.id));

  while (left.size) {
    // next: the room most attached to what's already placed
    let next: Room | null = null; let best = -1;
    for (const id of left) {
      const s = [...placed.keys()].reduce((t, p) => t + aff(id, p), 0) * 10 + total.get(id)!;
      if (s > best || (s === best && next && id < next.id)) { best = s; next = doc.rooms[id]; }
    }
    const r = next!;
    let pick: { x: number; y: number } | null = null; let pickCost = Infinity;
    for (const [pid, p] of placed) {
      const gap = gapFor(r.id, pid);
      const along = preset === 'bubble'
        ? [p.x + (p.w - r.w) / 2, p.x + (p.w - r.w) / 2 - r.w / 2, p.x + (p.w - r.w) / 2 + r.w / 2]
        : [p.x, p.x + p.w - r.w, p.x + (p.w - r.w) / 2];
      const alongY = preset === 'bubble'
        ? [p.y + (p.h - r.h) / 2, p.y + (p.h - r.h) / 2 - r.h / 2, p.y + (p.h - r.h) / 2 + r.h / 2]
        : [p.y, p.y + p.h - r.h, p.y + (p.h - r.h) / 2];
      const cands: { x: number; y: number }[] = [];
      for (const x of along) { cands.push({ x, y: p.y - gap - r.h }); cands.push({ x, y: p.y + p.h + gap }); }
      for (const y of alongY) { cands.push({ x: p.x - gap - r.w, y }); cands.push({ x: p.x + p.w + gap, y }); }
      for (const c0 of cands) {
        const c = { x: Math.round(c0.x), y: Math.round(c0.y), w: r.w, h: r.h };
        let clash = false;
        for (const [oid, o] of placed) if (rectsOverlap(c, o, gapFor(r.id, oid) - 1)) { clash = true; break; }
        if (clash) continue;
        let cost = 0;
        const cc = roomCenter(c);
        let minX = c.x, minY = c.y, maxX = c.x + c.w, maxY = c.y + c.h;
        for (const [oid, o] of placed) {
          cost += aff(r.id, oid) * manhattan(cc, roomCenter(o));
          minX = Math.min(minX, o.x); minY = Math.min(minY, o.y); maxX = Math.max(maxX, o.x + o.w); maxY = Math.max(maxY, o.y + o.h);
        }
        // stay compact and roughly landscape, like a screen
        cost += 0.6 * ((maxX - minX) + (maxY - minY) * 1.5);
        if (cost < pickCost) { pickCost = cost; pick = { x: c.x, y: c.y }; }
      }
    }
    placed.set(r.id, { x: pick!.x, y: pick!.y, w: r.w, h: r.h });
    left.delete(r.id);
  }

  // keep the campus where it was: align the new layout's top-left with the old one
  const oldMin = { x: Math.min(...rooms.map((r) => r.x)), y: Math.min(...rooms.map((r) => r.y)) };
  const vals = [...placed.values()];
  const newMin = { x: Math.min(...vals.map((r) => r.x)), y: Math.min(...vals.map((r) => r.y)) };
  for (const v of vals) { v.x += oldMin.x - newMin.x; v.y += oldMin.y - newMin.y; }
  if (doc.settings.bounds) {
    const b = doc.settings.bounds;
    if (vals.some((v) => v.x < b.x || v.y < b.y || v.x + v.w > b.x + b.w || v.y + v.h > b.y + b.h)) return empty('The sorted campus would not fit inside the permitted layout area. Enlarge or clear the bounds in Settings, then try again.');
  }
  const after = collaborationDistance(Object.fromEntries(placed), links);
  if (after >= before * 0.97) return { ...empty('Already well arranged: no layout found that brings collaborating rooms meaningfully closer.'), after };

  const moves: AutoSortMove[] = [];
  const ops: DocOp[] = [];
  for (const r of rooms) {
    const to = placed.get(r.id)!;
    if (to.x === r.x && to.y === r.y) continue;
    const partner = rooms.filter((o) => o.id !== r.id).sort((p, q) => aff(r.id, q.id) - aff(r.id, p.id))[0];
    const l = partner && links.get(pair(r.id, partner.id));
    moves.push({ roomId: r.id, name: r.name, from: { x: r.x, y: r.y }, to: { x: to.x, y: to.y }, reason: l ? `next to ${partner.name}: ${describe(l)}` : 'packed in to keep the campus compact' });
    ops.push({ op: 'room.update', id: r.id, patch: { x: to.x, y: to.y } });
  }
  // aim each single-hallway door at the room it now leads to, so tubes stay short
  const moved = Object.fromEntries(rooms.map((r) => [r.id, { ...r, ...placed.get(r.id)! }]));
  const doorUse = new Map<string, Corridor[]>();
  for (const c of Object.values(doc.corridors)) for (const ep of [c.start, c.end]) if (ep.kind === 'door') (doorUse.get(ep.doorId) ?? doorUse.set(ep.doorId, []).get(ep.doorId)!).push(c);
  for (const c of Object.values(doc.corridors)) {
    if (c.start.kind !== 'door' || c.end.kind !== 'door') continue;
    for (const [me, other] of [[c.start, c.end], [c.end, c.start]] as const) {
      if (me.kind !== 'door' || other.kind !== 'door' || (doorUse.get(me.doorId)?.length ?? 0) !== 1) continue;
      const room = moved[me.roomId], target = moved[other.roomId]; if (!room || !target) continue;
      const door = room.doors.find((d) => d.id === me.doorId); if (!door) continue;
      const want = doorFacing(room, roomCenter(target), door.width);
      if (want.side !== door.side) ops.push({ op: 'door.update', roomId: room.id, doorId: door.id, patch: { side: want.side, offset: want.offset } });
    }
  }
  // hand-routed hallways keep their manual setting but get a fresh route for the new positions
  const trial = applyOps(doc, ops);
  if (trial.errors.length) return { ...empty(`Auto Sort could not build a valid layout: ${trial.errors[0]}`), after };
  for (const c of Object.values(trial.doc.corridors)) {
    if (effectiveRouting(trial.doc, c) !== 'manual') continue;
    const s = resolveEndpoint(trial.doc, c.start), e = resolveEndpoint(trial.doc, c.end);
    if (s.error || e.error) continue;
    const route = routeBetween(trial.doc, s, e, c.width, c.id);
    if (route.ok) ops.push({ op: 'corridor.update', id: c.id, patch: { points: route.points } });
  }
  ops.push({ op: 'corridors.realign' });

  const groupMap = new Map<string, string[]>();
  for (const r of rooms) (groupMap.get(team.get(r.id)!) ?? groupMap.set(team.get(r.id)!, []).get(team.get(r.id)!)!).push(r.id);
  const groups = [...groupMap.entries()].map(([name, roomIds]) => ({ name, roomIds })).sort((p, q) => q.roomIds.length - p.roomIds.length);
  const pct = Math.round((1 - after / Math.max(1, before)) * 100);
  return { ops, moves, groups, before, after, preset, message: `${moves.length} room${moves.length === 1 ? '' : 's'} move; collaborating rooms end up ${pct}% closer.` };
}
