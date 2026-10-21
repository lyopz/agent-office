// The app's link to server/origin-runner.mjs, which runs ORIGIN on a live model
// within the owner's monthly cap. When the runner isn't running, every call
// returns null and the app stays in simulation.
import type { OfficeDoc } from '../model/types';
import { ORIGIN_ID, agentPrompt, branchKind } from './opportunity';

export interface RunnerTask {
  id: string; title: string; detail: string; status: 'proposed' | 'approved' | 'rejected' | 'done' | 'stopped'; by: 'owner' | 'origin'; createdAt: string;
  spentUsd?: number; runCosts?: number[]; budgetUsd?: number; stopReason?: string; progress?: number; steps?: { text: string; done: boolean }[]; notes?: string; waitingOnOwner?: boolean;
  /** Typed in the command center: worked first and alone until done. count is how many items the owner asked for. */
  focus?: boolean; count?: number; via?: string;
  kind?: 'skill-file'; agentId?: string; agentName?: string; version?: number;
}
/** A product an agent made in Printify and asked the owner to publish. */
export interface PublishRequest { id: string; productId: string; title: string; why: string; agentName: string; taskId?: string | null; taskTitle?: string | null; image?: string; priceUsd?: number; status: 'waiting' | 'published' | 'rejected'; at: string }
/** One line of progress, filed under the agent the work was for. */
export interface ProgressEntry { id: string; at: string; runId?: string; agentId: string; agentName: string; taskId: string | null; taskTitle: string | null; pct: number | null; note: string }
/** A SKILL.md ORIGIN wrote for one agent, waiting for the app to save it to the bank. */
export interface SkillFile { id: string; agentId: string; agentName: string; agentIds?: string[]; agentNames?: string[]; version?: number; name: string; description: string; body: string; status: 'new' | 'imported'; createdAt: string }
export interface AgentProposal {
  id: string; parentId: string; name: string; specialty: string; purpose: string; skill: string; bankSkillIds: string[];
  everyMinutes: number; maxMinutes: number; reason: string; skillFile?: { name: string; description: string; body: string } | null; auto?: boolean; status: 'proposed' | 'approved' | 'rejected'; createdAt: string; agentId?: string | null;
}
export interface RunnerWorker { taskId: string | null; agentId: string; agentName: string; title: string | null; costUsd: number; status: string; rounds: number; summary?: string }
export interface RunnerRun { workers?: RunnerWorker[]; id: string; agentId?: string; taskId?: string | null; skillFileFor?: string; trigger: 'manual' | 'schedule' | 'focus'; startedAt: string; endedAt: string | null; costUsd: number; costKnown: boolean; searches: number; fetches?: number; etsyCalls?: number; printifyCalls?: number; status: string; summary: string; notify?: string | null }
export interface RunnerStatus {
  configured: boolean; model: string; capUsd: number; everyMinutes: number; maxMinutes: number; schedule: boolean;
  spentUsd: number; spentByAgent?: Record<string, number>; allowanceUsd?: number; spentTodayUsd?: number; parallel?: number; rounds?: number; taskBudgetUsd?: number; unknownCostRuns: number; month: string; running: string | null; synced: boolean;
  memory: string; nextAction: string; tasks: RunnerTask[]; agentProposals?: AgentProposal[]; autoAgents?: boolean; autoTasks?: boolean; etsy?: { configured: boolean; connected: boolean; shopName: string | null }; printify?: { configured: boolean; shopId: number | null; shopTitle: string | null; channel: string | null }; publishRequests?: PublishRequest[]; progressLog?: ProgressEntry[]; skillFiles?: SkillFile[]; asks?: OriginAsk[]; runs: RunnerRun[]; nextScheduledAt: string | null; focusEveryMinutes?: number;
}

// in the browser the dev server forwards /api/origin; the desktop app talks to the runner directly
const BASE = typeof location !== 'undefined' && /^https?:$/.test(location.protocol) ? '/api/origin' : 'http://127.0.0.1:8788/api/origin';

async function call<T>(path: string, body?: unknown, timeoutMs = 4000): Promise<{ status: number; data: T } | null> {
  try {
    const r = await fetch(`${BASE}${path}`, body === undefined ? { signal: AbortSignal.timeout(timeoutMs) } : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(timeoutMs) });
    if (r.status === 404 && !(r.headers.get('content-type') ?? '').includes('json')) return null; // no runner behind the dev server
    return { status: r.status, data: await r.json() as T };
  } catch { return null; }
}

export const runnerStatus = async () => (await call<RunnerStatus>('/status'))?.data ?? null;

/** The ventures and their skill agents, by id, so ORIGIN can name a parent when it proposes an agent. */
export function brainMap(doc: OfficeDoc): string {
  const ventures = Object.values(doc.agents).filter((a) => branchKind(doc, a.id) === 'venture');
  if (!ventures.length) return `THE BRAIN NOW\nYou are ${ORIGIN_ID}. No ventures yet.`;
  return `THE BRAIN NOW\nYou are ${ORIGIN_ID}. Ventures:\n${ventures.map((v) => {
    const skills = Object.values(doc.agents).filter((a) => a.branch?.kind === 'skill' && a.branch.ventureId === v.id).map((a) => a.identity.name);
    return `- [${v.id}] ${v.identity.name}: ${v.identity.title}${skills.length ? ` (skill agents: ${skills.join(', ')})` : ''}`;
  }).join('\n')}`;
}

/** Send ORIGIN's current instructions, bank skills and brain map so scheduled runs use them. */
export async function syncOrigin(doc: OfficeDoc) {
  if (!doc.agents[ORIGIN_ID]?.ai.systemInstructions) return false;
  // every other agent's instructions and SKILL.md, so ORIGIN can work a task as that agent
  const agents = Object.values(doc.agents).filter((a) => a.id !== ORIGIN_ID).map((a) => ({
    id: a.id, name: a.identity.name, title: a.identity.title, kind: branchKind(doc, a.id), ventureId: a.branch?.ventureId ?? null,
    hasSkillFile: doc.skillBank.some((k) => k.id === `skill_file_${a.id}`), prompt: agentPrompt(doc, a.id),
  }));
  return !!(await call('/sync', { instructions: `${agentPrompt(doc, ORIGIN_ID)}\n\n${brainMap(doc)}`, agents }, 10_000));
}

/** Start a manual work window; resolves when it ends (up to the window length). */
export async function runOrigin(doc: OfficeDoc, maxMinutes: number) {
  await syncOrigin(doc);
  return call<{ ok: boolean; reason?: string; run?: RunnerRun }>('/run', {}, (maxMinutes + 1) * 60_000);
}

export interface OriginAsk { at: string; q: string; a: string; costUsd: number | null; agentId?: string | null; by?: string }

/** Ask ORIGIN a question from the console; it answers right away, any time, against the same cap. */
export async function askOrigin(question: string) {
  const r = await call<{ ok: true; answer: string; costUsd: number | null; taskTitle: string | null; approved?: string[] | null; by?: string; started?: boolean } | { ok: false; reason: string }>('/ask', { question }, 70_000);
  if (!r) return null;
  // an older runner without /ask answers 404
  if (!r.data.ok && !('reason' in r.data && r.data.reason)) return { ok: false as const, reason: "ORIGIN's runner is out of date. Stop it and start it again with npm.cmd run origin." };
  return r.data;
}

/** Give ORIGIN a task from the command center: approved by your words, its focus until done, and started right away. */
export async function giveTask(text: string) {
  const r = await call<{ ok: true; task: RunnerTask; started: boolean } | { ok: false; reason: string }>('/focus', { text }, 10_000);
  if (!r) return null;
  if (!r.data.ok && !('reason' in r.data && r.data.reason)) return { ok: false as const, reason: "ORIGIN's runner is out of date. Restart the app (or npm.cmd run origin)." };
  return r.data;
}

/** A product mockup, fetched through the runner and shown as a local blob (the app loads no outside images). */
export async function mockupUrl(id: string) {
  try {
    const r = await fetch(`${BASE}/printify/image?id=${encodeURIComponent(id)}`, { signal: AbortSignal.timeout(25_000) });
    if (!r.ok || !(r.headers.get('content-type') || '').startsWith('image/')) return null;
    return URL.createObjectURL(await r.blob());
  } catch { return null; }
}

export async function agentProposalAction(body: { action: 'approve' | 'reject'; id: string; agentId?: string }) {
  return (await call<{ ok: boolean; agentProposals: AgentProposal[] }>('/agents', body))?.data ?? null;
}

/** Whether ORIGIN and its ventures create agents without asking. */
export async function setAutoAgents(autoAgents: boolean) {
  return !!(await call('/settings', { autoAgents }));
}
/** Empire mode: ORIGIN approves its own research tasks (a few at a time, each within its budget and the cap). */
export async function setAutoTasks(autoTasks: boolean) {
  return !!(await call('/settings', { autoTasks }));
}

export async function skillFileImported(id: string) {
  return !!(await call('/skillfiles', { action: 'imported', id }));
}

export async function taskAction(body: { action: 'add'; title: string; detail?: string; kind?: 'skill-file'; version?: number; agentId?: string; agentName?: string } | { action: 'approve' | 'reject' | 'done' | 'stop'; id: string }) {
  return (await call<{ ok: boolean; tasks: RunnerTask[] }>('/tasks', body))?.data ?? null;
}

/** The owner's decision on a product: publish sends it live to their store through Printify. */
export async function publishDecision(id: string, action: 'publish' | 'reject') {
  const r = await call<{ ok: boolean; reason?: string }>('/printify/publish', { id, action }, 60_000);
  return r ? r.data : null;
}
