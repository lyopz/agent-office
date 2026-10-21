// Types for the parts of origin-runner.mjs the tests use.
export function costOf(model: string, usage: Record<string, unknown>): number | null;
export function loadState(file?: string): Record<string, unknown>;
export function runOnce(trigger: 'manual' | 'schedule' | 'focus', deps?: { fetch: typeof fetch; file: string; key?: string; only?: string[] }):
  Promise<{ ok: false; reason: string } | { ok: true; run: { status: string; costUsd: number; searches: number } }>;
export function budgetWatch(task: { spentUsd?: number; runCosts?: number[]; budgetUsd?: number }, now?: Date): string | null;
export function ask(question: string, deps?: { fetch: typeof fetch; file: string; key?: string }):
  Promise<{ ok: false; reason: string } | { ok: true; answer: string; costUsd: number | null; taskTitle: string | null; approved?: string[] | null; by?: string }>;
export function nextTask(s: { tasks: { status: string; kind?: string; by?: string; id?: string }[] }): { status: string; kind?: string; id?: string } | null;
export function parseConsent(text: string): Record<string, unknown> | null;
export function applyConsent(s: Record<string, unknown>, c: Record<string, unknown>): string[] | null;
export function pruneGone(s: Record<string, unknown>, at: string): number;
export function dailyAllowance(s: Record<string, unknown>, now?: Date): { allowanceUsd: number; spentTodayUsd: number };
export function pickTasks(s: Record<string, unknown>, n?: number, only?: string[] | null): Record<string, unknown>[];
export function itemCount(text: string): number | null;
export function addFocusTask(s: Record<string, unknown>, t: { title: string; detail?: string; agentId?: string | null; budgetUsd?: number | null; count?: number | null }): Record<string, unknown> | null;
export function syncSales(deps?: { file?: string; listOrders?: () => Promise<unknown[]> }): Promise<{ ok: boolean; error: string | null; orders: number }>;
export function resolveAgents(s: Record<string, unknown>, refs: string[] | string): { ids: string[]; unknown: string[] };
export function queueSkills(s: Record<string, unknown>, req: { files?: string[]; bank?: { name: string; description?: string; agents?: string[] }[] }): { files: string[]; bank: string[]; unknown: string[] };
export function parseSkills(text: string): Record<string, unknown> | null;
export function runSkills(trigger?: string, deps?: { fetch: typeof fetch; file: string; key?: string }): Promise<{ ok: false; reason: string } | { ok: true; run: { status: string; costUsd: number; summary: string; skillsWritten: string[] } }>;
