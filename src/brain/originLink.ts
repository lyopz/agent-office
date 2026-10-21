// The app's link to server/origin-runner.mjs, which runs ORIGIN on a live model
// within the owner's monthly cap. When the runner isn't running, every call
// returns null and the app stays in simulation.
import type { OfficeDoc } from '../model/types';
import { ORIGIN_ID } from './opportunity';

export interface RunnerTask { id: string; title: string; detail: string; status: 'proposed' | 'approved' | 'rejected' | 'done'; by: 'owner' | 'origin'; createdAt: string }
export interface RunnerRun { id: string; trigger: 'manual' | 'schedule'; startedAt: string; endedAt: string | null; costUsd: number; costKnown: boolean; searches: number; status: string; summary: string; notify?: string | null }
export interface RunnerStatus {
  configured: boolean; model: string; capUsd: number; everyMinutes: number; maxMinutes: number; schedule: boolean;
  spentUsd: number; unknownCostRuns: number; month: string; running: string | null; synced: boolean;
  memory: string; nextAction: string; tasks: RunnerTask[]; runs: RunnerRun[]; nextScheduledAt: string | null;
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

/** Send ORIGIN's current instructions so scheduled runs use them. */
export async function syncOrigin(doc: OfficeDoc) {
  const instructions = doc.agents[ORIGIN_ID]?.ai.systemInstructions;
  return instructions ? !!(await call('/sync', { instructions })) : false;
}

/** Start a manual work window; resolves when it ends (up to the window length). */
export async function runOrigin(doc: OfficeDoc, maxMinutes: number) {
  await syncOrigin(doc);
  return call<{ ok: boolean; reason?: string; run?: RunnerRun }>('/run', {}, (maxMinutes + 1) * 60_000);
}

export async function taskAction(body: { action: 'add'; title: string; detail?: string } | { action: 'approve' | 'reject' | 'done'; id: string }) {
  return (await call<{ ok: boolean; tasks: RunnerTask[] }>('/tasks', body))?.data ?? null;
}
