// The hourly briefing: a pure summary of the last hour of work, read by the
// briefing board in the Royal Lounge. Nothing here mutates the document or
// runtime; the board calls it again on every refresh.
//
// Buckets:
//   done    – status 'done' with a completion time inside the window
//   active  – 'active' or 'in-transit' (handed over through a tube), agent not stuck
//   blocked – 'waiting-approval', 'paused' (held), 'failed' (inside the window),
//             queued behind a failed/cancelled dependency, or active while the
//             agent is in an error/blocked state
//   queued  – 'queued' and free to start
// Cancelled tasks, done tasks outside the window and tasks created after `now`
// are left out. Active, blocked and queued work is the current state at `now`.
import type { AgentStatus, ID, OfficeDoc, RuntimeState, Task, TaskStatus } from '../model/types';

export const BRIEFING_BUCKETS = ['done', 'active', 'blocked', 'queued'] as const;
export type BriefingBucket = (typeof BRIEFING_BUCKETS)[number];
export type BriefingGrouping = 'team' | 'project';
export type BucketCounts = Record<BriefingBucket, number>;

export interface BriefingItem {
  taskId: ID;
  taskName: string;
  agentId: ID | null;
  agentName: string;              // 'Unassigned' when nobody owns it
  team: string;                   // the agent's department
  projectId: ID | null;
  projectName: string;            // 'No project' when unlinked
  bucket: BriefingBucket;
  status: TaskStatus;
  priority: Task['priority'];
  progress: number;
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
  failedAt?: string;
  deadline?: string;
  /** Estimated completion for active work: from observed progress rate when possible. */
  eta?: string;
  etaBasis?: 'observed' | 'estimate';
  /** Why the item is blocked. Only set for the blocked bucket. */
  blockedReason?: string;
  overdue: boolean;
  agentStatus?: AgentStatus;
  simulated: boolean;
}

export interface BriefingGroup { key: string; label: string; counts: BucketCounts; items: BriefingItem[] }

export interface AttentionItem {
  kind: 'blocked' | 'overdue' | 'agent-error';
  severity: 'high' | 'medium';
  message: string;
  taskId?: ID;
  agentId?: ID | null;
  since?: string;
}

export interface IdleAgent { agentId: ID; name: string; team: string; roomId: ID | null; lastCompletedAt?: string }

export interface Briefing {
  generatedAt: string;
  windowStart: string;
  windowEnd: string;
  windowMinutes: number;
  counts: BucketCounts;
  items: BriefingItem[];
  byTeam: BriefingGroup[];
  byProject: BriefingGroup[];
  attention: AttentionItem[];
  idleAgents: IdleAgent[];
  teams: string[];
  projects: { id: ID | null; name: string }[];
}

export interface BriefingOptions {
  windowMinutes?: number;   // default 60
  /** Wall-clock milliseconds per simulation tick, for ETAs with no observed progress yet. Default 100 (1× speed). */
  msPerTick?: number;
}

export const UNASSIGNED = 'Unassigned';
export const NO_PROJECT = 'No project';
const BUCKET_ORDER: Record<BriefingBucket, number> = { blocked: 0, active: 1, queued: 2, done: 3 };
const PRIORITY_ORDER: Record<Task['priority'], number> = { critical: 0, high: 1, normal: 2, low: 3 };

const toMs = (t: Date | number | string) => (t instanceof Date ? t.getTime() : typeof t === 'number' ? t : Date.parse(t));
const ms = (iso: string | undefined) => (iso ? Date.parse(iso) : NaN);
export const emptyCounts = (): BucketCounts => ({ done: 0, active: 0, blocked: 0, queued: 0 });

/** Latest 'task-failed' event naming this task, if any. */
function failureTime(rt: RuntimeState, t: Task): string | undefined {
  const tag = `“${t.name}”`;
  for (let i = rt.events.length - 1; i >= 0; i--) {
    const e = rt.events[i];
    if (e.at < t.createdAt) break; // older lines belong to an earlier task with the same name
    if (e.kind === 'task-failed' && e.message.includes(tag) && (!t.agentId || !e.agentId || e.agentId === t.agentId)) return e.at;
  }
  return undefined;
}

/** Which bucket a task belongs in right now, and why it's blocked; null = leave it out. */
export function classifyTask(rt: RuntimeState, t: Task, windowStartMs: number, nowMs: number): { bucket: BriefingBucket; reason?: string; failedAt?: string } | null {
  if (ms(t.createdAt) > nowMs) return null;
  const ar = t.agentId ? rt.agents[t.agentId] : undefined;
  switch (t.status) {
    case 'cancelled': return null;
    case 'done': {
      const c = ms(t.completedAt);
      return c >= windowStartMs && c <= nowMs ? { bucket: 'done' } : null;
    }
    case 'failed': {
      const failedAt = failureTime(rt, t);
      const last = ms(failedAt ?? t.completedAt ?? t.startedAt ?? t.createdAt);
      if (!(last >= windowStartMs && last <= nowMs)) return null;
      return { bucket: 'blocked', failedAt, reason: `Failed${t.failures ? ` after ${t.failures} attempt${t.failures > 1 ? 's' : ''}` : ''}` };
    }
    case 'waiting-approval': {
      const ap = Object.values(rt.approvals).find((a) => a.taskId === t.id && a.status === 'pending');
      return { bucket: 'blocked', reason: ap ? `Waiting for owner approval: ${ap.detail}` : 'Waiting for owner approval' };
    }
    case 'paused':
      return { bucket: 'blocked', reason: t.heldBy === 'emergency' ? 'Held by the emergency stop' : t.heldBy === 'department' ? 'Held: department paused' : 'Paused' };
    case 'active': case 'in-transit': {
      if (ar && ar.currentTaskId === t.id && (ar.status === 'error' || ar.status === 'blocked')) return { bucket: 'blocked', reason: ar.statusMessage || `Agent is ${ar.status}` };
      return { bucket: 'active' };
    }
    case 'queued': {
      const bad = t.dependencies.map((d) => rt.tasks[d]).find((d) => d && (d.status === 'failed' || d.status === 'cancelled'));
      if (bad) return { bucket: 'blocked', reason: `Depends on ${bad.status} task “${bad.name}”` };
      return { bucket: 'queued' };
    }
    default: return null;
  }
}

function etaFor(t: Task, nowMs: number, msPerTick: number): { eta?: string; etaBasis?: BriefingItem['etaBasis'] } {
  const started = ms(t.startedAt);
  if (t.progress >= 1 && t.progress < 100 && started < nowMs) {
    const rate = t.progress / (nowMs - started); // percent per ms
    return { eta: new Date(nowMs + (100 - t.progress) / rate).toISOString(), etaBasis: 'observed' };
  }
  const remaining = Math.max(0, t.workUnits * (1 - t.progress / 100));
  return { eta: new Date(nowMs + remaining * msPerTick).toISOString(), etaBasis: 'estimate' };
}

function sortItems(items: BriefingItem[]) {
  const time = (i: BriefingItem) => ms(i.completedAt ?? i.failedAt ?? i.startedAt ?? i.createdAt) || 0;
  return items.sort((a, b) => BUCKET_ORDER[a.bucket] - BUCKET_ORDER[b.bucket] || PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority]
    || (a.bucket === 'done' ? time(b) - time(a) : time(a) - time(b)) || a.taskId.localeCompare(b.taskId));
}

/** Group items by team or project. Groups are alphabetical with the catch-all group last. */
export function groupItems(items: BriefingItem[], by: BriefingGrouping): BriefingGroup[] {
  const map = new Map<string, BriefingGroup>();
  for (const it of items) {
    const key = by === 'team' ? it.team : it.projectId ?? '';
    const label = by === 'team' ? it.team : it.projectName;
    let g = map.get(key);
    if (!g) { g = { key, label, counts: emptyCounts(), items: [] }; map.set(key, g); }
    g.counts[it.bucket]++; g.items.push(it);
  }
  const last = by === 'team' ? UNASSIGNED : '';
  return [...map.values()].sort((a, b) => Number(a.key === last) - Number(b.key === last) || a.label.localeCompare(b.label));
}

export interface BriefingFilter { team?: string | null; projectId?: ID | null | 'none'; bucket?: BriefingBucket | null }
/** Filter items; `projectId: 'none'` keeps work with no project. Empty/undefined fields match everything. */
export function filterItems(items: BriefingItem[], f: BriefingFilter): BriefingItem[] {
  return items.filter((i) => (!f.team || i.team === f.team)
    && (f.projectId === undefined || f.projectId === null || (f.projectId === 'none' ? i.projectId === null : i.projectId === f.projectId))
    && (!f.bucket || i.bucket === f.bucket));
}

export function countBuckets(items: BriefingItem[]): BucketCounts {
  const c = emptyCounts();
  for (const i of items) c[i.bucket]++;
  return c;
}

export function buildBriefing(doc: OfficeDoc, rt: RuntimeState, now: Date | number | string, opts: BriefingOptions = {}): Briefing {
  const windowMinutes = opts.windowMinutes ?? 60;
  const msPerTick = opts.msPerTick ?? 100;
  const nowMs = toMs(now);
  const startMs = nowMs - windowMinutes * 60_000;
  const items: BriefingItem[] = [];

  for (const t of Object.values(rt.tasks)) {
    const c = classifyTask(rt, t, startMs, nowMs);
    if (!c) continue;
    const agent = t.agentId ? doc.agents[t.agentId] : undefined;
    const project = t.projectId ? doc.projects[t.projectId] : undefined;
    const overdue = c.bucket !== 'done' && !!t.deadline && ms(t.deadline) < nowMs;
    items.push({
      taskId: t.id, taskName: t.name,
      agentId: t.agentId, agentName: agent?.identity.name ?? (t.agentId ? t.agentId : UNASSIGNED),
      team: agent?.identity.department || UNASSIGNED,
      projectId: project ? project.id : null, projectName: project?.name ?? NO_PROJECT,
      bucket: c.bucket, status: t.status, priority: t.priority, progress: Math.round(t.progress),
      createdAt: t.createdAt, startedAt: t.startedAt, completedAt: t.completedAt, failedAt: c.failedAt, deadline: t.deadline,
      ...(c.bucket === 'active' ? etaFor(t, nowMs, msPerTick) : {}),
      blockedReason: c.reason, overdue,
      agentStatus: t.agentId ? rt.agents[t.agentId]?.status : undefined,
      simulated: t.simulated,
    });
  }
  sortItems(items);

  const attention: AttentionItem[] = [];
  for (const i of items) {
    if (i.bucket === 'blocked') attention.push({ kind: 'blocked', severity: i.status === 'failed' || i.priority === 'critical' || i.priority === 'high' ? 'high' : 'medium', message: `${i.taskName} (${i.agentName}): ${i.blockedReason}`, taskId: i.taskId, agentId: i.agentId, since: i.failedAt ?? i.startedAt ?? i.createdAt });
    else if (i.overdue) attention.push({ kind: 'overdue', severity: 'medium', message: `${i.taskName} (${i.agentName}) is past its deadline`, taskId: i.taskId, agentId: i.agentId, since: i.deadline });
  }
  const blockedTaskAgents = new Set(items.filter((i) => i.bucket === 'blocked' && i.agentId && rt.agents[i.agentId]?.currentTaskId === i.taskId).map((i) => i.agentId));
  for (const a of Object.values(doc.agents)) {
    const r = rt.agents[a.id];
    if (!r || (r.status !== 'error' && r.status !== 'blocked') || blockedTaskAgents.has(a.id)) continue;
    attention.push({ kind: 'agent-error', severity: 'high', message: `${a.identity.name}: ${r.statusMessage || `agent is ${r.status}`}`, agentId: a.id });
  }
  attention.sort((a, b) => Number(a.severity !== 'high') - Number(b.severity !== 'high'));

  const busy = new Set(Object.values(rt.tasks).filter((t) => t.agentId && (t.status === 'active' || t.status === 'queued' || t.status === 'in-transit' || t.status === 'waiting-approval')).map((t) => t.agentId));
  const lastDone = new Map<ID, string>();
  for (const t of Object.values(rt.tasks)) if (t.agentId && t.status === 'done' && t.completedAt && ms(t.completedAt) <= nowMs && (!lastDone.has(t.agentId) || t.completedAt > lastDone.get(t.agentId)!)) lastDone.set(t.agentId, t.completedAt);
  const idleAgents: IdleAgent[] = Object.values(doc.agents)
    .filter((a) => a.enabled && a.identity.status === 'active' && !busy.has(a.id) && !rt.agents[a.id]?.currentTaskId && (rt.agents[a.id]?.status ?? 'idle') === 'idle')
    .map((a) => ({ agentId: a.id, name: a.identity.name, team: a.identity.department || UNASSIGNED, roomId: rt.agents[a.id]?.roomId ?? null, lastCompletedAt: lastDone.get(a.id) }))
    .sort((a, b) => a.team.localeCompare(b.team) || a.name.localeCompare(b.name));

  const teams = [...new Set(items.map((i) => i.team))].sort();
  const projects = groupItems(items, 'project').map((g) => ({ id: g.key || null, name: g.label }));
  return {
    generatedAt: new Date(nowMs).toISOString(), windowStart: new Date(startMs).toISOString(), windowEnd: new Date(nowMs).toISOString(), windowMinutes,
    counts: countBuckets(items), items, byTeam: groupItems(items, 'team'), byProject: groupItems(items, 'project'),
    attention, idleAgents, teams, projects,
  };
}

export interface HistoryEntry { at: string; label: string; source: 'task' | 'approval' | 'event' }

/** What the model knows about a task over time: its own timestamps, approvals and log lines naming it. */
export function taskHistory(rt: RuntimeState, taskId: ID): HistoryEntry[] {
  const t = rt.tasks[taskId];
  if (!t) return [];
  const out: HistoryEntry[] = [{ at: t.createdAt, label: 'Created', source: 'task' }];
  if (t.startedAt) out.push({ at: t.startedAt, label: 'Started', source: 'task' });
  if (t.acknowledgedAt) out.push({ at: t.acknowledgedAt, label: `Delivery acknowledged${t.deliveredVia === 'tube' ? ' (tube)' : ''}`, source: 'task' });
  if (t.completedAt) out.push({ at: t.completedAt, label: 'Completed', source: 'task' });
  for (const a of Object.values(rt.approvals)) if (a.taskId === taskId) {
    out.push({ at: a.at, label: `Approval requested: ${a.detail}`, source: 'approval' });
    if (a.decidedAt) out.push({ at: a.decidedAt, label: `Approval ${a.status}`, source: 'approval' });
  }
  const tag = `“${t.name}”`;
  const end = t.completedAt ?? '\uffff';
  for (const e of rt.events) if (e.at >= t.createdAt && e.at <= end && e.message.includes(tag) && (!t.agentId || !e.agentId || e.agentId === t.agentId) && e.kind !== 'task-start' && e.kind !== 'task-complete') out.push({ at: e.at, label: e.message, source: 'event' });
  return out.sort((a, b) => a.at.localeCompare(b.at));
}
