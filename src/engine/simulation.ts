// Agent simulation: task-driven movement over the navigation graph. Pure
// functions over (doc, runtime) so the loop is testable without a browser.
// Everything produced here is labelled `simulated` — no model is called.
import type { ActivityEvent, Agent, AgentRuntime, OfficeDoc, Point, RuntimeState, Task } from '../model/types';
import { uid } from '../model/defaults';
import { key, manhattan, rectContains } from './geometry';
import { buildNav, canStep, findPath, roomSpot, workstationSpot, type NavGraph } from './navigation';
import { pickHub } from './validate';
import { escalateAlerts, raiseAlert } from './alerts';
import { recordUsage, requestAction } from './governance';
import { stepCapsules } from './tubes';
import { searchLibrary } from './library';

export const SPEED = 0.2; // cells per tick at animation speed 1
const PRIORITY = { critical: 0, high: 1, normal: 2, low: 3 } as const;

export function emptyRuntime(): RuntimeState { return { agents: {}, tasks: {}, events: [], tick: 0, usage: [], approvals: {}, alerts: {}, capsules: {} }; }

export function log(rt: RuntimeState, e: Omit<ActivityEvent, 'id' | 'at' | 'level' | 'simulated'> & Partial<Pick<ActivityEvent, 'level' | 'simulated'>>) {
  rt.events.push({ id: uid('evt'), at: new Date().toISOString(), level: 'info', simulated: true, ...e });
  if (rt.events.length > 600) rt.events.splice(0, rt.events.length - 600);
}

function cellOf(p: Point): Point { return { x: Math.round(p.x), y: Math.round(p.y) }; }

function roomIdAt(doc: OfficeDoc, p: Point): string | null {
  const c = cellOf(p);
  for (const r of Object.values(doc.rooms)) if (rectContains(r, c)) return r.id;
  return null;
}

function nearestWalkable(nav: NavGraph, p: Point): Point | null {
  const c = cellOf(p);
  if (nav.walkable.has(key(c.x, c.y))) return c;
  for (let r = 1; r < 30; r++) for (let dx = -r; dx <= r; dx++) for (let dy = -r; dy <= r; dy++) {
    if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
    if (nav.walkable.has(key(c.x + dx, c.y + dy))) return { x: c.x + dx, y: c.y + dy };
  }
  return null;
}

export function homeSpot(doc: OfficeDoc, nav: NavGraph, a: Agent): { cell: Point; roomId: string | null; workstationId: string | null } | null {
  const wsId = a.schedule.preferredWorkstationId;
  const ws = wsId ? doc.furniture[wsId] : undefined;
  if (ws) { const s = workstationSpot(doc, nav, ws); if (s) return { cell: s, roomId: ws.roomId, workstationId: ws.id }; }
  const room = (a.schedule.assignedRoomId && doc.rooms[a.schedule.assignedRoomId]) || pickHub(doc);
  if (!room) return null;
  const s = roomSpot(nav, room);
  return s ? { cell: s, roomId: room.id, workstationId: null } : null;
}

export function initAgentRuntime(doc: OfficeDoc, nav: NavGraph, a: Agent): AgentRuntime {
  const home = homeSpot(doc, nav, a);
  const pos = home?.cell ?? { x: 0, y: 0 };
  return { pos, roomId: home?.roomId ?? null, status: a.enabled ? 'idle' : 'paused', path: [], destination: null, heading: a.appearance.facing, energy: 80 + Math.random() * 20, currentTaskId: null, waitTicks: 0 };
}

/** Ensure every agent has runtime state and nobody is standing inside a wall. */
export function syncRuntime(doc: OfficeDoc, rt: RuntimeState, nav: NavGraph) {
  for (const a of Object.values(doc.agents)) if (!rt.agents[a.id]) rt.agents[a.id] = initAgentRuntime(doc, nav, a);
  for (const id of Object.keys(rt.agents)) if (!doc.agents[id]) delete rt.agents[id];
  for (const [id, r] of Object.entries(rt.agents)) {
    const c = cellOf(r.pos);
    if (!nav.walkable.has(key(c.x, c.y)) && r.status !== 'walking') {
      const n = nearestWalkable(nav, r.pos); if (n) r.pos = n;
    }
    if (!doc.agents[id].enabled) r.status = 'paused';
  }
}

/**
 * Called after any layout change: carry agents along with moved rooms, then
 * recompute every in-flight path on the new navigation graph.
 */
export function reconcileLayout(prev: OfficeDoc, doc: OfficeDoc, rt: RuntimeState): NavGraph {
  const nav = buildNav(doc);
  for (const r of Object.values(rt.agents)) {
    const was = r.roomId ? prev.rooms[r.roomId] : undefined;
    const now = r.roomId ? doc.rooms[r.roomId] : undefined;
    if (was && now && (was.x !== now.x || was.y !== now.y)) {
      const dx = now.x - was.x, dy = now.y - was.y;
      r.pos = { x: r.pos.x + dx, y: r.pos.y + dy };
      r.path = r.path.map((p) => ({ x: p.x + dx, y: p.y + dy }));
    }
    if (now) { r.pos = { x: Math.min(Math.max(r.pos.x, now.x), now.x + now.w - 1), y: Math.min(Math.max(r.pos.y, now.y), now.y + now.h - 1) }; }
    if (r.roomId && !now) r.roomId = roomIdAt(doc, r.pos);
  }
  syncRuntime(doc, rt, nav);
  for (const [id, r] of Object.entries(rt.agents)) {
    if (r.destination) {
      // destination may have moved with its room
      const fresh = resolveDestination(doc, nav, doc.agents[id], r.destination.roomId, r.destination.workstationId);
      if (fresh) r.destination = fresh;
      replan(doc, rt, nav, id);
    }
  }
  return nav;
}

export function resolveDestination(doc: OfficeDoc, nav: NavGraph, a: Agent, roomId: string | null, workstationId: string | null) {
  if (workstationId && doc.furniture[workstationId]) {
    const s = workstationSpot(doc, nav, doc.furniture[workstationId]);
    if (s) return { roomId: doc.furniture[workstationId].roomId, workstationId, cell: s };
  }
  if (roomId && doc.rooms[roomId]) {
    // prefer the agent's own workstation if it's in that room
    const own = a.schedule.preferredWorkstationId ? doc.furniture[a.schedule.preferredWorkstationId] : undefined;
    if (own && own.roomId === roomId) { const s = workstationSpot(doc, nav, own); if (s) return { roomId, workstationId: own.id, cell: s }; }
    const s = roomSpot(nav, doc.rooms[roomId]);
    if (s) return { roomId, workstationId: null, cell: s };
  }
  return null;
}

function replan(doc: OfficeDoc, rt: RuntimeState, nav: NavGraph, agentId: string): boolean {
  const r = rt.agents[agentId];
  if (!r.destination) return true;
  const from = cellOf(r.pos);
  const path = findPath(nav, from, r.destination.cell);
  const name = doc.agents[agentId]?.identity.name ?? agentId;
  const target = r.destination.roomId ? doc.rooms[r.destination.roomId]?.name : 'destination';
  if (!path) {
    if (r.status !== 'error') {
      log(rt, { kind: 'error', agentId, level: 'error', simulated: false, message: `${name}: no route to ${target} — path blocked` });
      raiseAlert(doc, rt, { key: `route:${agentId}`, severity: 'warning', category: 'operational', title: `${name} can't reach ${target}`, description: 'Every route to the destination is blocked.', recommended: 'Open the room and clear a doorway or hallway.', agentId, roomId: r.destination.roomId, taskId: r.currentTaskId, evidence: [{ kind: 'log', id: rt.events[rt.events.length - 1]?.id ?? '', label: `no route to ${target}` }] });
    }
    r.status = 'error'; r.statusMessage = `No route to ${target}`; r.path = [];
    return false;
  }
  if (r.status === 'error') log(rt, { kind: 'system', agentId, simulated: false, message: `${name}: found a new route to ${target}` });
  r.path = path; r.statusMessage = undefined;
  r.status = path.length ? 'walking' : r.currentTaskId ? 'working' : 'idle';
  return true;
}

export function goTo(doc: OfficeDoc, rt: RuntimeState, nav: NavGraph, agentId: string, roomId: string | null, workstationId: string | null = null): { ok: boolean; message: string } {
  const a = doc.agents[agentId]; const r = rt.agents[agentId];
  if (!a || !r) return { ok: false, message: 'Agent not found' };
  const dest = resolveDestination(doc, nav, a, roomId, workstationId);
  if (!dest) return { ok: false, message: 'That destination has no free floor space' };
  r.destination = dest;
  const ok = replan(doc, rt, nav, agentId);
  const target = dest.roomId ? doc.rooms[dest.roomId]?.name : 'destination';
  if (ok) log(rt, { kind: 'room-change', agentId, simulated: false, message: `${a.identity.name} heading to ${target} (${r.path.length} cells)` });
  return ok ? { ok, message: `${a.identity.name} is walking to ${target}` } : { ok, message: `No route from ${a.identity.name} to ${target}` };
}

export function createTask(rt: RuntimeState, t: Partial<Task> & { name: string }): Task {
  const task: Task = {
    id: uid('task'), description: '', agentId: null, priority: 'normal', status: 'queued', dependencies: [],
    destination: { roomId: null, workstationId: null }, progress: 0, workUnits: 80, createdAt: new Date().toISOString(), simulated: true, ...t,
  };
  rt.tasks[task.id] = task;
  return task;
}

export function nextTask(rt: RuntimeState, agentId: string): Task | undefined {
  return Object.values(rt.tasks)
    .filter((t) => t.agentId === agentId && t.status === 'queued' && t.dependencies.every((d) => !rt.tasks[d] || rt.tasks[d].status === 'done'))
    .sort((a, b) => PRIORITY[a.priority] - PRIORITY[b.priority] || a.createdAt.localeCompare(b.createdAt))[0];
}

const DEMO_TASKS: Record<string, string[]> = {
  Command: ['Review task board', 'Prepare daily briefing', 'Rebalance workloads'],
  Research: ['Summarise new papers', 'Run benchmark batch', 'Annotate dataset'],
  Infrastructure: ['Rotate logs', 'Patch rack firmware', 'Check cooling telemetry'],
  Product: ['Sketch dashboard layout', 'Accessibility audit', 'Update icon set'],
  Facilities: ['Service HVAC unit', 'Repair door actuator', 'Inventory spare parts'],
  'Front Office': ['Triage inbound requests', 'Schedule visitor', 'Relay messages'],
};

function demoTask(doc: OfficeDoc, rt: RuntimeState, a: Agent, rand: () => number) {
  const r = rt.agents[a.id];
  const breakRoom = Object.values(doc.rooms).find((x) => x.type === 'break');
  if (r.energy < 30 && breakRoom) {
    return createTask(rt, { name: 'Recharge break', agentId: a.id, destination: { roomId: breakRoom.id, workstationId: null }, workUnits: 60, description: 'Energy is low.' });
  }
  if (rand() < 0.15) {
    const meet = Object.values(doc.rooms).find((x) => x.type === 'meeting');
    if (meet) return createTask(rt, { name: 'Sync meeting', agentId: a.id, destination: { roomId: meet.id, workstationId: null }, workUnits: 70 });
  }
  const pool = DEMO_TASKS[a.identity.department] ?? ['General upkeep', 'Write status report'];
  const project = Object.values(doc.projects).find((p) => p.ownerAgentId === a.id && p.status === 'active');
  return createTask(rt, {
    projectId: project?.id ?? null, costPerUnit: 0.02,
    name: pool[Math.floor(rand() * pool.length)], agentId: a.id, workUnits: 60 + Math.floor(rand() * 80),
    destination: { roomId: a.schedule.assignedRoomId, workstationId: a.schedule.preferredWorkstationId },
  });
}

export interface StepOptions { demoTasks: boolean; rand?: () => number }

export function step(doc: OfficeDoc, rt: RuntimeState, nav: NavGraph, opts: StepOptions) {
  const rand = opts.rand ?? Math.random;
  rt.tick++;
  if (Object.keys(rt.capsules).length) stepCapsules(doc, rt);
  if (rt.tick % 20 === 0) escalateAlerts(doc, rt);
  const occupied = new Map<string, string>();
  for (const [id, r] of Object.entries(rt.agents)) occupied.set(key(Math.round(r.pos.x), Math.round(r.pos.y)), id);

  for (const a of Object.values(doc.agents)) {
    const r = rt.agents[a.id];
    if (!r) continue;
    if (!a.enabled || a.identity.status !== 'active') { r.status = 'paused'; continue; }
    if (r.status === 'paused') r.status = 'idle';
    const task = r.currentTaskId ? rt.tasks[r.currentTaskId] : undefined;
    if (task && (task.status === 'cancelled' || task.status === 'paused' || task.agentId !== a.id)) {
      r.currentTaskId = null; r.destination = null; r.path = []; r.status = 'idle';
    }

    switch (r.status) {
      case 'error': {
        if (rt.tick % 20 === 0) replan(doc, rt, nav, a.id); // keep looking for an alternative route
        break;
      }
      case 'walking': {
        const next = r.path[0];
        if (!next) { arrive(doc, rt, a); break; }
        const cur = cellOf(r.pos);
        const atCell = Math.abs(r.pos.x - cur.x) < 1e-6 && Math.abs(r.pos.y - cur.y) < 1e-6;
        if (atCell) {
          if (!canStep(nav, cur, next)) { replan(doc, rt, nav, a.id); break; }
          const who = occupied.get(key(next.x, next.y));
          if (who && who !== a.id && rt.agents[who]?.status !== 'walking' && r.path.length > 1 && r.waitTicks < 6) { r.waitTicks++; break; }
        }
        r.waitTicks = 0;
        const sp = SPEED * a.appearance.animationSpeed * (a.appearance.walkPose === 'brisk' ? 1.3 : a.appearance.walkPose === 'casual' ? 0.8 : 1);
        const dx = next.x - r.pos.x, dy = next.y - r.pos.y;
        const dist = Math.hypot(dx, dy);
        if (Math.abs(dx) > 1e-6) r.heading = dx > 0 ? 'right' : 'left';
        else if (Math.abs(dy) > 1e-6) r.heading = dy > 0 ? 'down' : 'up';
        if (dist <= sp) {
          r.pos = { ...next }; r.path.shift();
          const rid = roomIdAt(doc, r.pos);
          if (rid !== r.roomId) {
            if (rid) log(rt, { kind: 'room-change', agentId: a.id, message: `${a.identity.name} entered ${doc.rooms[rid].name}` });
            r.roomId = rid;
          }
          if (!r.path.length) arrive(doc, rt, a);
        } else {
          r.pos = { x: r.pos.x + (dx / dist) * sp, y: r.pos.y + (dy / dist) * sp };
        }
        break;
      }
      case 'thinking': {
        if (--r.waitTicks <= 0) {
          const t = r.currentTaskId ? rt.tasks[r.currentTaskId] : undefined;
          if (!t) { r.status = 'idle'; break; }
          const dest = resolveDestination(doc, nav, a, t.destination.roomId ?? a.schedule.assignedRoomId, t.destination.workstationId);
          if (!dest) { r.status = 'working'; break; } // work in place
          r.destination = dest;
          replan(doc, rt, nav, a.id);
        }
        break;
      }
      case 'working': {
        const t = r.currentTaskId ? rt.tasks[r.currentTaskId] : undefined;
        if (!t) { r.status = 'idle'; break; }
        const inBreak = r.roomId && doc.rooms[r.roomId]?.special === 'restores-energy';
        r.energy = Math.max(0, Math.min(100, r.energy + (inBreak ? 0.6 : -0.04)));
        t.progress = Math.min(100, t.progress + 100 / Math.max(1, t.workUnits));
        if (t.progress >= 100) {
          t.status = 'done'; t.completedAt = new Date().toISOString();
          if (t.costPerUnit) recordUsage(doc, rt, { agentId: a.id, projectId: t.projectId ?? null, taskId: t.id, credits: +(t.costPerUnit * t.workUnits).toFixed(2), kind: 'model', simulated: t.simulated });
          log(rt, { kind: 'task-complete', agentId: a.id, simulated: t.simulated, message: `${a.identity.name} completed “${t.name}”${t.simulated ? ' (simulated)' : ''}` });
          r.currentTaskId = null; r.destination = null; r.status = 'idle'; r.waitTicks = 15;
        }
        break;
      }
      case 'communicating': {
        if (--r.waitTicks <= 0) r.status = r.currentTaskId ? 'working' : 'idle';
        break;
      }
      case 'idle': {
        if (r.waitTicks > 0) { r.waitTicks--; break; }
        const t = nextTask(rt, a.id) ?? (opts.demoTasks && rand() < 0.03 ? demoTask(doc, rt, a, rand) : undefined);
        if (t) {
          const estimate = (t.costPerUnit ?? 0) * t.workUnits;
          const cleared = Object.values(rt.approvals).some((x) => x.taskId === t.id && x.status === 'approved');
          if (!cleared && estimate > a.budget.approvalAbove) { // routine spend under the agent's limit never bothers the owner
            const res = requestAction(doc, rt, { agentId: a.id, action: 'spend', detail: `Start “${t.name}” (est. ${estimate.toFixed(0)} credits)`, amount: Math.round(estimate), projectId: t.projectId, taskId: t.id });
            if (!res.allowed) break;
          }
          if (!t.libraryRefs) {
            const prior = searchLibrary(doc, `${t.name} ${t.description}`, a.id, 3);
            t.libraryRefs = prior.map((p) => p.entry.id);
            if (prior.length) log(rt, { kind: 'library', agentId: a.id, simulated: t.simulated, message: `${a.identity.name} checked the library first: found “${prior[0].entry.title}”` });
          }
          t.status = 'active'; t.startedAt = new Date().toISOString();
          r.currentTaskId = t.id; r.status = 'thinking'; r.waitTicks = 6;
          log(rt, { kind: 'task-start', agentId: a.id, simulated: t.simulated, message: `${a.identity.name} started “${t.name}”${t.simulated ? ' (simulated)' : ''}` });
        } else if (opts.demoTasks && rand() < 0.004) {
          const peer = Object.values(doc.agents).find((b) => b.id !== a.id && rt.agents[b.id]?.roomId === r.roomId && rt.agents[b.id]?.status === 'idle');
          if (peer) {
            r.status = 'communicating'; r.waitTicks = 25;
            const pr = rt.agents[peer.id]; pr.status = 'communicating'; pr.waitTicks = 25;
            log(rt, { kind: 'comms', agentId: a.id, message: `${a.identity.name} → ${peer.identity.name}: status sync (simulated)` });
          }
        }
        break;
      }
    }
  }
}

function arrive(doc: OfficeDoc, rt: RuntimeState, a: Agent) {
  const r = rt.agents[a.id];
  r.path = [];
  const t = r.currentTaskId ? rt.tasks[r.currentTaskId] : undefined;
  r.status = t ? 'working' : 'idle';
  if (r.destination?.workstationId) r.heading = 'up';
  const place = r.destination?.roomId ? doc.rooms[r.destination.roomId]?.name : 'destination';
  log(rt, { kind: 'room-change', agentId: a.id, message: `${a.identity.name} arrived at ${place}${t ? ` — working on “${t.name}”` : ''}` });
  r.destination = null;
}

export function distanceToDest(r: AgentRuntime) { return r.destination ? manhattan(cellOf(r.pos), r.destination.cell) : 0; }
