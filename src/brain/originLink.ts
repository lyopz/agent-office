// The app's link to server/origin-runner.mjs, which runs ORIGIN on a live model
// within the owner's monthly cap. When the runner isn't running, every call
// returns null and the app stays in simulation.
import type { OfficeDoc } from '../model/types';
import { ORIGIN_ID, agentPrompt, branchKind } from './opportunity';

export interface RunnerTask {
  id: string; title: string; detail: string; status: 'proposed' | 'approved' | 'rejected' | 'done' | 'stopped'; by: 'owner' | 'origin'; createdAt: string;
  spentUsd?: number; runCosts?: number[]; budgetUsd?: number; stopReason?: string;
  kind?: 'skill-file'; agentId?: string; agentName?: string;
}
/** A SKILL.md ORIGIN wrote for one agent, waiting for the app to save it to the bank. */
export interface SkillFile { id: string; agentId: string; agentName: string; name: string; description: string; body: string; status: 'new' | 'imported'; createdAt: string }
export interface AgentProposal {
  id: string; parentId: string; name: string; specialty: string; purpose: string; skill: string; bankSkillIds: string[];
  everyMinutes: number; maxMinutes: number; reason: string; skillFile?: { name: string; description: string; body: string } | null; status: 'proposed' | 'approved' | 'rejected'; createdAt: string; agentId?: string | null;
}
export interface RunnerRun { id: string; agentId?: string; taskId?: string | null; trigger: 'manual' | 'schedule'; startedAt: string; endedAt: string | null; costUsd: number; costKnown: boolean; searches: number; status: string; summary: string; notify?: string | null }
export interface RunnerStatus {
  configured: boolean; model: string; capUsd: number; everyMinutes: number; maxMinutes: number; schedule: boolean;
  spentUsd: number; spentByAgent?: Record<string, number>; taskBudgetUsd?: number; unknownCostRuns: number; month: string; running: string | null; synced: boolean;
  memory: string; nextAction: string; tasks: RunnerTask[]; agentProposals?: AgentProposal[]; skillFiles?: SkillFile[]; asks?: OriginAsk[]; runs: RunnerRun[]; nextScheduledAt: string | null;
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
  return !!(await call('/sync', { instructions: `${agentPrompt(doc, ORIGIN_ID)}\n\n${brainMap(doc)}` }));
}

/** Start a manual work window; resolves when it ends (up to the window length). */
export async function runOrigin(doc: OfficeDoc, maxMinutes: number) {
  await syncOrigin(doc);
  return call<{ ok: boolean; reason?: string; run?: RunnerRun }>('/run', {}, (maxMinutes + 1) * 60_000);
}

export interface OriginAsk { at: string; q: string; a: string; costUsd: number | null }

/** Ask ORIGIN a question from the console; it answers right away, any time, against the same cap. */
export async function askOrigin(question: string) {
  const r = await call<{ ok: true; answer: string; costUsd: number | null; taskTitle: string | null } | { ok: false; reason: string }>('/ask', { question }, 70_000);
  if (!r) return null;
  // an older runner without /ask answers 404
  if (!r.data.ok && !('reason' in r.data && r.data.reason)) return { ok: false as const, reason: "ORIGIN's runner is out of date. Stop it and start it again with npm.cmd run origin." };
  return r.data;
}

export async function agentProposalAction(body: { action: 'approve' | 'reject'; id: string; agentId?: string }) {
  return (await call<{ ok: boolean; agentProposals: AgentProposal[] }>('/agents', body))?.data ?? null;
}

export async function skillFileImported(id: string) {
  return !!(await call('/skillfiles', { action: 'imported', id }));
}

export async function taskAction(body: { action: 'add'; title: string; detail?: string; kind?: 'skill-file'; agentId?: string; agentName?: string } | { action: 'approve' | 'reject' | 'done' | 'stop'; id: string }) {
  return (await call<{ ok: boolean; tasks: RunnerTask[] }>('/tasks', body))?.data ?? null;
}
