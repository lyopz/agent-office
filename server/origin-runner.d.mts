// Types for the parts of origin-runner.mjs the tests use.
export function costOf(model: string, usage: Record<string, unknown>): number | null;
export function loadState(file?: string): Record<string, unknown>;
export function runOnce(trigger: 'manual' | 'schedule', deps?: { fetch: typeof fetch; file: string; key?: string }):
  Promise<{ ok: false; reason: string } | { ok: true; run: { status: string; costUsd: number; searches: number } }>;
export function budgetWatch(task: { spentUsd?: number; runCosts?: number[]; budgetUsd?: number }, now?: Date): string | null;
export function ask(question: string, deps?: { fetch: typeof fetch; file: string; key?: string }):
  Promise<{ ok: false; reason: string } | { ok: true; answer: string; costUsd: number | null; taskTitle: string | null }>;
