// Types for the parts of origin-runner.mjs the tests use.
export function costOf(model: string, usage: Record<string, unknown>): number | null;
export function loadState(file?: string): Record<string, unknown>;
export function runOnce(trigger: 'manual' | 'schedule', deps?: { fetch: typeof fetch; file: string; key?: string }):
  Promise<{ ok: false; reason: string } | { ok: true; run: { status: string; costUsd: number; searches: number } }>;
