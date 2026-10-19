// Pneumatic tube network: tasks travel as capsules between tube stations and
// are acknowledged by the agent who receives them. Tubes run overhead, so a
// capsule follows an L-shaped duct between stations rather than the floor.
import type { Capsule, Furniture, OfficeDoc, Point, RuntimeState } from '../model/types';
import { FURNITURE_META } from '../model/catalog';
import { uid } from '../model/defaults';
import { log } from './simulation';
import { raiseAlert } from './alerts';
import { worldRect } from './spatial';

export const CAPSULE_SPEED = 0.8; // cells per tick
export const CAPSULE_LINGER = 24;  // ticks a delivered capsule stays on screen showing its delivery status

export function tubeStations(doc: OfficeDoc): Furniture[] {
  return Object.values(doc.furniture).filter((f) => FURNITURE_META[f.type]?.fn === 'tube');
}

export function stationCenter(doc: OfficeDoc, f: Furniture): Point {
  const r = worldRect(doc.rooms[f.roomId], f);
  return { x: r.x + r.w / 2, y: r.y + r.h / 2 };
}

/** The station serving an agent: in their room, else nearest to it. */
export function stationFor(doc: OfficeDoc, agentId: string, rtRoomId?: string | null): Furniture | null {
  const a = doc.agents[agentId]; if (!a) return null;
  const roomId = a.schedule.assignedRoomId ?? rtRoomId ?? null;
  const all = tubeStations(doc); if (!all.length) return null;
  const inRoom = all.find((s) => s.roomId === roomId); if (inRoom) return inRoom;
  const room = roomId ? doc.rooms[roomId] : undefined; if (!room) return all[0];
  const c = { x: room.x + room.w / 2, y: room.y + room.h / 2 };
  return all.slice().sort((p, q) => dist(stationCenter(doc, p), c) - dist(stationCenter(doc, q), c))[0];
}
const dist = (a: Point, b: Point) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y);

function duct(a: Point, b: Point): Point[] {
  const pts: Point[] = [a];
  const corner = { x: b.x, y: a.y };
  const seg = (p: Point, q: Point) => { const n = Math.max(1, Math.ceil(dist(p, q))); for (let i = 1; i <= n; i++) pts.push({ x: p.x + ((q.x - p.x) * i) / n, y: p.y + ((q.y - p.y) * i) / n }); };
  seg(a, corner); seg(corner, b);
  return pts;
}

/**
 * The dedicated mail network: every station has a spoke to a central routing
 * hub (a Routing Hub object if there is one, else the stations' centre).
 * Capsules ride spoke → hub → spoke, separate from the tubes agents travel in.
 */
export function mailHub(doc: OfficeDoc): Point | null {
  const hub = Object.values(doc.furniture).find((f) => f.type === 'routing-hub' && doc.rooms[f.roomId]);
  if (hub) return stationCenter(doc, hub);
  const st = tubeStations(doc); if (!st.length) return null;
  const cs = st.map((f) => stationCenter(doc, f));
  return { x: Math.round(cs.reduce((t, c) => t + c.x, 0) / cs.length), y: Math.round(cs.reduce((t, c) => t + c.y, 0) / cs.length) };
}

export function mailNetwork(doc: OfficeDoc): { hub: Point; spokes: { stationId: string; points: Point[] }[] } | null {
  const hub = mailHub(doc); if (!hub) return null;
  return { hub, spokes: tubeStations(doc).map((f) => ({ stationId: f.id, points: duct(stationCenter(doc, f), hub) })) };
}

function mailRoute(doc: OfficeDoc, from: Furniture, to: Furniture): Point[] {
  const a = stationCenter(doc, from), b = stationCenter(doc, to);
  const hub = mailHub(doc);
  if (from.id === to.id || !hub) return duct(a, b);
  const out = duct(a, hub);
  const back = duct(b, hub).reverse();
  return [...out, ...back.slice(1)];
}

export function capsulePos(c: Capsule): Point {
  const i = Math.min(c.path.length - 1, Math.floor(c.progress)); const f = c.progress - i;
  const p = c.path[i], q = c.path[Math.min(c.path.length - 1, i + 1)];
  return { x: p.x + (q.x - p.x) * f, y: p.y + (q.y - p.y) * f };
}

/** Send a task to its assigned agent by tube. Returns null with a reason when no route exists. */
export function dispatchViaTube(doc: OfficeDoc, rt: RuntimeState, taskId: string, fromAgentId: string | null, fromStationId?: string): { capsule: Capsule | null; message: string } {
  const t = rt.tasks[taskId]; if (!t) return { capsule: null, message: 'Task not found' };
  if (!t.agentId) return { capsule: null, message: 'Task has no receiving agent' };
  const to = stationFor(doc, t.agentId, rt.agents[t.agentId]?.roomId);
  const from = (fromStationId && doc.furniture[fromStationId]) || (fromAgentId ? stationFor(doc, fromAgentId, rt.agents[fromAgentId]?.roomId) : null) || tubeStations(doc)[0];
  if (!to || !from) return { capsule: null, message: 'No tube stations in the office — add one from the object library' };
  const cap: Capsule = { id: uid('cap'), taskId, fromId: from.id, toId: to.id, path: mailRoute(doc, from, to), progress: 0, status: 'in-transit', recipientId: t.agentId };
  rt.capsules = { ...rt.capsules, [cap.id]: cap };
  rt.tasks[taskId] = { ...t, status: 'in-transit', deliveredVia: 'tube', handoff: t.handoff ? { ...t.handoff, fromAgentId } : t.handoff };
  const name = doc.agents[t.agentId]?.identity.name ?? 'agent';
  log(rt, { kind: 'tube', agentId: fromAgentId, simulated: false, message: `Capsule dispatched: “${t.name}” ${from.tube?.stationName ?? 'station'} → ${to.tube?.stationName ?? 'station'} for ${name}` });
  return { capsule: cap, message: `Sent “${t.name}” to ${name} by tube` };
}

/** Advance capsules; on arrival the recipient acknowledges and the task joins their queue. */
export function stepCapsules(doc: OfficeDoc, rt: RuntimeState, speed = 1, now = new Date()) {
  let changed = false;
  for (const c0 of Object.values(rt.capsules)) {
    if (c0.status !== 'in-transit') {
      if (rt.tick - (c0.deliveredTick ?? -Infinity) > CAPSULE_LINGER) { delete rt.capsules[c0.id]; changed = true; }
      continue;
    }
    const c = { ...c0, progress: c0.progress + CAPSULE_SPEED * speed };
    changed = true;
    if (c.progress < c.path.length - 1) { rt.capsules[c.id] = c; continue; }
    c.progress = c.path.length - 1; c.status = 'delivered'; c.deliveredTick = rt.tick;
    rt.capsules[c.id] = c;
    const t = rt.tasks[c.taskId]; if (!t) continue;
    const a = c.recipientId ? doc.agents[c.recipientId] : undefined;
    c.acknowledged = !!(a && a.enabled && a.identity.status === 'active');
    if (c.acknowledged && a) {
      rt.tasks[t.id] = { ...t, status: 'queued', acknowledgedBy: a.id, acknowledgedAt: now.toISOString() };
      log(rt, { kind: 'tube', agentId: a.id, simulated: false, message: `${a.identity.name} acknowledged capsule “${t.name}”` });
    } else {
      rt.tasks[t.id] = { ...t, status: 'queued' };
      raiseAlert(doc, rt, { key: `tube-unacked:${t.id}`, severity: t.priority === 'critical' ? 'critical' : 'high', category: 'operational', title: `Capsule not acknowledged: ${t.name}`, description: `${a?.identity.name ?? 'The recipient'} is paused or unavailable.`, recommended: 'Reassign the task or resume the agent.', agentId: a?.id ?? null, taskId: t.id, evidence: [{ kind: 'task', id: t.id, label: t.name }] }, now);
    }
  }
  return changed;
}
