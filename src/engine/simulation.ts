// The task loop: agents take their queued tasks one at a time, check the
// library first, ask the owner before spending over their limit, and record
// usage when work finishes. Pure functions over (doc, runtime) so the loop is
// testable without a browser. Work started here is labelled `simulated`
// unless a live integration ran it.
import type { ActivityEvent, Agent, AgentRuntime, OfficeDoc, RuntimeState, Task } from '../model/types';
import { uid } from '../model/defaults';
import { escalateAlerts } from './alerts';
import { recordUsage, requestAction } from './governance';
import { searchLibrary } from './library';

const PRIORITY = { critical: 0, high: 1, normal: 2, low: 3 } as const;

export function emptyRuntime(): RuntimeState { return { agents: {}, tasks: {}, events: [], tick: 0, usage: [], approvals: {}, alerts: {} }; }

export function log(rt: RuntimeState, e: Omit<ActivityEvent, 'id' | 'at' | 'level' | 'simulated'> & Partial<Pick<ActivityEvent, 'level' | 'simulated'>>) {
  rt.events.push({ id: uid('evt'), at: new Date().toISOString(), level: 'info', simulated: true, ...e });
  if (rt.events.length > 600) rt.events.splice(0, rt.events.length - 600);
}

export function initAgentRuntime(a: Agent): AgentRuntime {
  return { status: a.enabled ? 'idle' : 'paused', currentTaskId: null, waitTicks: 0 };
}

/** Ensure every agent has runtime state, and drop state for agents that are gone. */
export function syncRuntime(doc: OfficeDoc, rt: RuntimeState) {
  for (const a of Object.values(doc.agents)) if (!rt.agents[a.id]) rt.agents[a.id] = initAgentRuntime(a);
  for (const id of Object.keys(rt.agents)) if (!doc.agents[id]) delete rt.agents[id];
  for (const [id, r] of Object.entries(rt.agents)) if (!doc.agents[id].enabled) r.status = 'paused';
}

export function createTask(rt: RuntimeState, t: Partial<Task> & { name: string }): Task {
  const task: Task = {
    id: uid('task'), description: '', agentId: null, priority: 'normal', status: 'queued', dependencies: [],
    progress: 0, workUnits: 80, createdAt: new Date().toISOString(), simulated: true, ...t,
  };
  rt.tasks[task.id] = task;
  return task;
}

export function nextTask(rt: RuntimeState, agentId: string): Task | undefined {
  return Object.values(rt.tasks)
    .filter((t) => t.agentId === agentId && t.status === 'queued' && t.dependencies.every((d) => !rt.tasks[d] || rt.tasks[d].status === 'done'))
    .sort((a, b) => PRIORITY[a.priority] - PRIORITY[b.priority] || a.createdAt.localeCompare(b.createdAt))[0];
}

export function step(doc: OfficeDoc, rt: RuntimeState) {
  rt.tick++;
  if (rt.tick % 20 === 0) escalateAlerts(doc, rt);
  const stopped = doc.control.emergencyStop;

  for (const a of Object.values(doc.agents)) {
    const r = rt.agents[a.id];
    if (!r) continue;
    if (!a.enabled || a.identity.status !== 'active') { r.status = 'paused'; continue; }
    if (stopped) {
      // frozen: running work keeps its progress and resumes when the stop is lifted
      const t = r.currentTaskId ? rt.tasks[r.currentTaskId] : undefined;
      if (t && t.status === 'active') rt.tasks[t.id] = { ...t, status: 'paused', heldBy: 'emergency' };
      r.status = 'paused'; r.statusMessage = 'Emergency pause';
      continue;
    }
    if (r.status === 'paused') {
      r.status = 'idle'; r.statusMessage = undefined;
      const t = r.currentTaskId ? rt.tasks[r.currentTaskId] : undefined;
      if (t?.heldBy === 'emergency') { rt.tasks[t.id] = { ...t, status: 'active', heldBy: null }; r.status = 'working'; }
    }
    const task = r.currentTaskId ? rt.tasks[r.currentTaskId] : undefined;
    if (r.currentTaskId && (!task || task.status === 'cancelled' || task.status === 'paused' || task.agentId !== a.id)) {
      r.currentTaskId = null; r.status = 'idle';
    }

    switch (r.status) {
      case 'thinking':
      case 'communicating': {
        if (--r.waitTicks <= 0) r.status = r.currentTaskId ? 'working' : 'idle';
        break;
      }
      case 'working': {
        const t = r.currentTaskId ? rt.tasks[r.currentTaskId] : undefined;
        if (!t) { r.status = 'idle'; break; }
        t.progress = Math.min(100, t.progress + 100 / Math.max(1, t.workUnits));
        if (t.progress >= 100) {
          t.status = 'done'; t.completedAt = new Date().toISOString();
          if (t.costPerUnit) recordUsage(doc, rt, { agentId: a.id, projectId: t.projectId ?? null, taskId: t.id, credits: +(t.costPerUnit * t.workUnits).toFixed(2), kind: 'model', simulated: t.simulated });
          log(rt, { kind: 'task-complete', agentId: a.id, simulated: t.simulated, message: `${a.identity.name} completed “${t.name}”${t.simulated ? ' (simulated)' : ''}` });
          r.currentTaskId = null; r.status = 'idle'; r.waitTicks = 15;
        }
        break;
      }
      case 'idle':
      case 'waiting': {
        if (r.waitTicks > 0) { r.waitTicks--; break; }
        const t = nextTask(rt, a.id);
        if (!t) break;
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
        r.currentTaskId = t.id; r.status = 'thinking'; r.waitTicks = 6; r.statusMessage = undefined;
        log(rt, { kind: 'task-start', agentId: a.id, simulated: t.simulated, message: `${a.identity.name} started “${t.name}”${t.simulated ? ' (simulated)' : ''}` });
        break;
      }
    }
  }
}
