// Department control: what a department switch actually does to the work.
//
// Pausing a department stops new task starts, freezes its agents (no movement,
// no animation, skipped by the simulation loop) and holds active tasks with
// their progress. Jobs that can't pause safely follow the department's render
// policy; saves always finish. The state shown to the owner is derived from
// what the agents are doing, so "paused" only appears once nothing is running.
import type { Agent, Department, DepartmentState, OfficeDoc, RuntimeState, Task } from '../model/types';
import { departmentId, departmentList, makeDepartment } from '../model/control';
import { log } from './simulation';
import { raiseAlert } from './alerts';

export type HoldReason = 'emergency' | 'department';

export interface ControlFrame {
  dept: (a: Agent) => Department;
  hold: (a: Agent) => HoldReason | null;
  activeByDept: Map<string, number>;
  renderActive: boolean;
  backgroundActive: number;
}

const DEFAULT_CHECKPOINT = 25; // deferred renders restart from the last 25% boundary

export function controlFrame(doc: OfficeDoc, rt: RuntimeState): ControlFrame {
  const cache = new Map<string, Department>();
  const dept = (a: Agent) => {
    const name = a.identity.department || 'General';
    let d = cache.get(name);
    if (!d) { d = doc.departments[departmentId(name)] ?? makeDepartment(name); cache.set(name, d); }
    return d;
  };
  const activeByDept = new Map<string, number>();
  let renderActive = false, backgroundActive = 0;
  for (const t of Object.values(rt.tasks)) {
    if (t.status !== 'active' || !t.agentId || !doc.agents[t.agentId]) continue;
    const d = dept(doc.agents[t.agentId]);
    activeByDept.set(d.id, (activeByDept.get(d.id) ?? 0) + 1);
    if (t.jobKind === 'render') renderActive = true; else backgroundActive++;
  }
  const hold = (a: Agent): HoldReason | null => {
    if (doc.control.emergencyStop) return 'emergency';
    const d = dept(a);
    return d.mode === 'paused' && !d.excludedAgentIds.includes(a.id) ? 'department' : null;
  };
  return { dept, hold, activeByDept, renderActive, backgroundActive };
}

/**
 * Apply a hold to one agent. Returns true when the agent is frozen for this
 * tick; false when it may keep going to finish work that can't stop safely.
 */
export function holdAgent(rt: RuntimeState, a: Agent, reason: HoldReason, d: Department): boolean {
  const r = rt.agents[a.id];
  const t = r.currentTaskId ? rt.tasks[r.currentTaskId] : undefined;
  if (t && t.status === 'active') {
    if (t.jobKind === 'save') return false; // critical saves always finish
    if (t.jobKind === 'render' && reason === 'department' && d.renderPolicy === 'finish') return false;
    if (t.jobKind === 'render' && reason === 'department' && d.renderPolicy === 'cancel') {
      rt.tasks[t.id] = { ...t, status: 'cancelled', heldBy: null };
      log(rt, { kind: 'department', agentId: a.id, simulated: t.simulated, level: 'warn', message: `${d.name} paused: cancelled render “${t.name}” at ${Math.round(t.progress)}% (render policy: cancel)` });
    } else if (t.jobKind === 'render') {
      const checkpoint = Math.floor(t.progress / DEFAULT_CHECKPOINT) * DEFAULT_CHECKPOINT;
      rt.tasks[t.id] = { ...t, status: 'paused', heldBy: reason, checkpoint, progress: checkpoint };
      log(rt, { kind: 'department', agentId: a.id, simulated: t.simulated, level: 'warn', message: `Deferred render “${t.name}”: it can't pause mid-frame, so it restarts from ${checkpoint}% on resume` });
    } else {
      rt.tasks[t.id] = { ...t, status: 'paused', heldBy: reason };
      log(rt, { kind: 'pause', agentId: a.id, simulated: t.simulated, message: `${a.identity.name} paused “${t.name}” at ${Math.round(t.progress)}% (${reason === 'emergency' ? 'emergency pause' : `${d.name} paused`})` });
    }
  }
  if (r.status !== 'paused') {
    r.currentTaskId = null; r.destination = null; r.path = []; r.waitTicks = 0;
    r.status = 'paused'; r.statusMessage = reason === 'emergency' ? 'Emergency pause' : `${d.name} paused`;
  }
  return true;
}

/** Tasks held by a control whose agent is no longer held go back to the queue, progress intact. */
export function releaseHolds(doc: OfficeDoc, rt: RuntimeState, frame: ControlFrame) {
  for (const t of Object.values(rt.tasks)) {
    if (!t.heldBy || t.status !== 'paused' || !t.agentId) continue;
    const a = doc.agents[t.agentId];
    if (!a || frame.hold(a)) continue;
    rt.tasks[t.id] = { ...t, status: 'queued', heldBy: null };
    const r = rt.agents[a.id];
    if (r?.status === 'paused') { r.status = 'idle'; r.statusMessage = undefined; }
  }
}

/** Can this agent start another task right now? Returns the reason when not. */
export function startBlocked(doc: OfficeDoc, rt: RuntimeState, frame: ControlFrame, a: Agent, t: Task): string | null {
  const d = frame.dept(a);
  if (rt.policyHeld.includes(d.id)) return 'Held by resource policy while rendering';
  if (d.maxConcurrent != null && (frame.activeByDept.get(d.id) ?? 0) >= d.maxConcurrent) return `${d.name} is at its limit of ${d.maxConcurrent} tasks`;
  const p = doc.control.policy;
  if (p.prioritizeRendering && frame.renderActive && t.jobKind !== 'render' && frame.backgroundActive >= p.backgroundLimit) return 'Waiting: rendering has priority';
  return null;
}

/** Resource policies, evaluated every few ticks. They hold new work only; nothing running is ever stopped. */
export function applyPolicies(doc: OfficeDoc, rt: RuntimeState, frame: ControlFrame) {
  const p = doc.control.policy;
  const before = rt.policyHeld.join('|');
  if (p.pauseNonessential && frame.renderActive) {
    const rendering = new Set<string>();
    for (const t of Object.values(rt.tasks)) if (t.status === 'active' && t.jobKind === 'render' && t.agentId && doc.agents[t.agentId]) rendering.add(frame.dept(doc.agents[t.agentId]).id);
    const held = departmentList(doc).filter((d) => !d.essential && !rendering.has(d.id) && d.mode === 'running').map((d) => d.id);
    rt.policyHeld = [...new Set([...rt.policyHeld, ...held])];
  } else if (!frame.renderActive && p.autoResume) {
    rt.policyHeld = [];
  } else if (!p.pauseNonessential) {
    rt.policyHeld = [];
  }
  const after = rt.policyHeld.join('|');
  if (after !== before) {
    const names = rt.policyHeld.map((id) => departmentList(doc).find((d) => d.id === id)?.name ?? id);
    log(rt, { kind: 'policy', agentId: null, simulated: false, message: names.length ? `Resource policy: holding new work in ${names.join(', ')} while rendering` : 'Resource policy: released held departments' });
    if (names.length) raiseAlert(doc, rt, { key: 'policy:hold', severity: 'info', category: 'operational', title: 'Departments held for rendering', description: `${names.join(', ')} won't start new work until rendering finishes. Running work continues.`, recommended: 'Resume them from Executive control if needed.' });
  }
}

export interface DepartmentStats {
  dept: Department; state: DepartmentState; agents: number; active: number; paused: number; excluded: number;
  tasks: number; activeTasks: number; renders: number; workload: number; heldByPolicy: boolean; note: string;
}

/** What each department is actually doing, for the control dashboard. */
export function departmentStats(doc: OfficeDoc, rt: RuntimeState): DepartmentStats[] {
  const frame = controlFrame(doc, rt);
  const byDept = new Map<string, DepartmentStats>();
  for (const d of departmentList(doc)) byDept.set(d.id, { dept: d, state: 'running', agents: 0, active: 0, paused: 0, excluded: 0, tasks: 0, activeTasks: 0, renders: 0, workload: 0, heldByPolicy: rt.policyHeld.includes(d.id), note: '' });
  const errors = new Map<string, number>(), blocked = new Map<string, number>(), working = new Map<string, number>();
  for (const a of Object.values(doc.agents)) {
    const s = byDept.get(frame.dept(a).id); if (!s) continue;
    const r = rt.agents[a.id];
    s.agents++;
    if (s.dept.excludedAgentIds.includes(a.id)) s.excluded++;
    if (!a.enabled || a.identity.status !== 'active' || r?.status === 'paused') s.paused++; else s.active++;
    if (r?.status === 'error') errors.set(s.dept.id, (errors.get(s.dept.id) ?? 0) + 1);
    if (r?.status === 'blocked' || r?.status === 'waiting') blocked.set(s.dept.id, (blocked.get(s.dept.id) ?? 0) + 1);
    if (r && ['working', 'walking', 'thinking', 'communicating', 'researching'].includes(r.status)) working.set(s.dept.id, (working.get(s.dept.id) ?? 0) + 1);
  }
  for (const t of Object.values(rt.tasks)) {
    if (!t.agentId || !doc.agents[t.agentId] || t.status === 'done' || t.status === 'cancelled') continue;
    const s = byDept.get(frame.dept(doc.agents[t.agentId]).id); if (!s) continue;
    s.tasks++;
    if (t.status === 'active') { s.activeTasks++; if (t.jobKind === 'render') s.renders++; }
    if (t.status === 'waiting-approval' || t.status === 'failed') blocked.set(s.dept.id, (blocked.get(s.dept.id) ?? 0) + 1);
  }
  for (const s of byDept.values()) {
    s.workload = s.agents ? Math.round(((working.get(s.dept.id) ?? 0) / s.agents) * 100) : 0;
    const halted = doc.control.emergencyStop || s.dept.mode === 'paused';
    const finishing = halted && Object.values(doc.agents).some((a) => frame.dept(a).id === s.dept.id && frame.hold(a) && rt.agents[a.id]?.status !== 'paused' && rt.agents[a.id]?.currentTaskId);
    if (halted) { s.state = finishing ? 'pausing' : 'paused'; s.note = finishing ? 'Finishing work that can’t stop safely' : doc.control.emergencyStop ? 'Emergency pause' : s.excluded ? `${s.excluded} excluded agent${s.excluded > 1 ? 's' : ''} still running` : 'No new work starts'; }
    else if (errors.get(s.dept.id)) { s.state = 'error'; s.note = `${errors.get(s.dept.id)} agent${errors.get(s.dept.id)! > 1 ? 's' : ''} need attention`; }
    else if (blocked.get(s.dept.id)) { s.state = 'blocked'; s.note = `${blocked.get(s.dept.id)} waiting on approval or a dependency`; }
    else if (s.heldByPolicy) { s.state = 'pausing'; s.note = 'Held by resource policy: running work continues, no new starts'; }
    else s.note = s.activeTasks ? `${s.activeTasks} task${s.activeTasks > 1 ? 's' : ''} running` : 'Idle';
  }
  return [...byDept.values()].filter((s) => s.agents > 0 || doc.departments[s.dept.id]);
}
