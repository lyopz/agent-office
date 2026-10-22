// The app's link to server/origin-runner.mjs, which runs JARVIS on a live model
// within the owner's monthly cap. When the runner isn't running, every call
// returns null and the app stays in simulation.
import type { OfficeDoc } from '../model/types';
import { ORIGIN_ID, agentPrompt, branchKind } from './opportunity';

/** Another brain the owner started, as the runner knows it. */
export interface OtherBrain { id: string; name: string; agents: number; openTasks: number }
export interface RunnerTask { brainId?: string; everyMinutes?: number; repeats?: number; designId?: string; doneAt?: string;
  id: string; title: string; detail: string; status: 'proposed' | 'approved' | 'rejected' | 'done' | 'stopped'; by: 'owner' | 'origin'; createdAt: string;
  spentUsd?: number; runCosts?: number[]; budgetUsd?: number; stopReason?: string; progress?: number; steps?: { text: string; done: boolean }[]; notes?: string; waitingOnOwner?: boolean;
  /** Typed in the command center: worked first and alone until done. count is how many items the owner asked for. */
  focus?: boolean; count?: number; via?: string;
  kind?: 'skill-file' | 'bank-skill'; agentId?: string; agentName?: string; version?: number;
  /** A shared bank skill JARVIS writes for these agents; requested = the owner asked, so it is written right away. */
  skillName?: string; agentIds?: string[]; agentNames?: string[]; requested?: boolean;
}
/** A product an agent made in Printify and asked the owner to publish. */
export interface PublishRequest { printify?: string; designId?: string; id: string; productId: string; title: string; why: string; agentName: string; taskId?: string | null; taskTitle?: string | null; image?: string; priceUsd?: number; status: 'waiting' | 'published' | 'rejected' | 'deleted'; decidedAt?: string; publishedAt?: string; at: string }
/** Spent and earned for one agent (all time). Revenue is only real sales or the owner's own entries; sale fees are estimates. */
export interface MoneyRow { claudeUsd: number; imageUsd: number; listingFeesUsd: number; productionUsd: number; saleFeesEstUsd: number; revenueUsd: number; manualIncomeUsd: number; manualExpenseUsd: number; orders: number; itemsSold: number; unpricedItems: number; listed: number }
/** One ad an agent wrote for an approved, listed product; the owner approves it in the Ads tab and posts it themselves. */
export type AdChannel = 'tiktok' | 'instagram_reels' | 'instagram_post' | 'pinterest' | 'etsy_ads' | 'facebook_ads' | 'other';
export interface AdEntry { id: string; productId: string; productTitle: string; designId: string | null; image: string | null; title: string; channel: AdChannel; format: string | null; headline: string; primaryText: string; hashtags: string[]; cta: string; script: string; costNote: string; why: string; agentId: string; agentName: string; taskId: string | null; taskTitle: string | null; status: 'waiting' | 'approved' | 'rejected'; at: string; decidedAt?: string; file?: string }
/** A design-source folder on the owner's PC (memez, or one they linked) and what is in it. */
export interface SourceFile { ref: string; folder: string; name: string; bytes: number; kind: 'png' | 'jpg'; usable: 'print' | 'reference' | 'owner'; title: string | null; page: string | null; licence: string; savedBy: string | null; at: string; note: string | null }
export interface SourceFolderInfo { id: string; label: string; path: string; builtin: boolean; exists: boolean; files: number; printable: number; reference: number; notes?: number; recent: SourceFile[] }
/** Which trend sources this PC offers (never a token). */
export interface TokenLife { expiresAt?: string | null; renews?: boolean; refreshedAt?: string | null; refreshError?: string | null }
export interface TrendSources { google: boolean; memes: boolean; instagram: TokenLife & { configured: boolean; kind?: 'instagram' | 'facebook' | null; hashtags?: boolean; username: string | null; hashtagsLeft: number | null }; pinterest: TokenLife & { configured: boolean; username: string | null; board?: string | null; canSave?: boolean } }
export interface MoneyEntry { id: string; agentId: string; kind: 'income' | 'expense'; usd: number; note: string; at: string }
export interface SaleLine { id: string; orderId: string; at: string; status: string; productId: string; title: string; quantity: number; revenueUsd: number | null; costUsd: number; agentId: string | null; agentName: string | null }
/** A design an agent made, kept on the owner's PC: SVG it wrote or a PNG from the image model. */
export interface CanvaEntry { id: string; at: string; tool: string; agentId: string; agentName: string; taskId: string; taskTitle: string; ok: boolean; ai: boolean; files?: number; error?: string }
export type DesignStatus = 'waiting' | 'approved' | 'rejected' | 'published';
export interface BranchBudget { id: string; budgetUsd: number | null; spentUsd: number }
export interface BudgetChange { id: string; at: string; what: string; from: number | null; to: number | null }
export interface Budgets { capUsd: number; defaultCapUsd: number; imageCapUsd: number; canvaAiLimit: number; voiceCapUsd: number | null; listingFeeUsd: number; branches: BranchBudget[]; log: BudgetChange[] }
export interface DesignEntry { id: string; kind: 'svg' | 'png' | 'jpg'; source?: 'canva' | 'caption'; sourceFile?: string; assets?: { title: string; page: string; licence: string }[]; status?: DesignStatus; productId?: string; decidedAt?: string; publishedAt?: string; printify?: string; fileName: string; title: string; agentId: string; agentName: string; taskId: string | null; taskTitle: string | null; imageId: string | null; at: string }
/** One design image an agent made with the owner's OpenAI key, and what it cost. */
export interface ImageEntry { id: string; at: string; model: string; quality: string; size: string; usd: number; estimated?: boolean; prompt: string; agentId: string; agentName: string; taskId: string | null; taskTitle: string | null; imageId: string }
/** One line of progress, filed under the agent the work was for. */
export interface ProgressEntry { id: string; at: string; runId?: string; agentId: string; agentName: string; taskId: string | null; taskTitle: string | null; pct: number | null; note: string }
/** A SKILL.md JARVIS wrote for one agent, waiting for the app to save it to the bank. */
export interface SkillFile { id: string; agentId: string; agentName: string; agentIds?: string[]; agentNames?: string[]; version?: number; bank?: boolean; skillKey?: string; skillName?: string; name: string; description: string; body: string; status: 'new' | 'imported'; createdAt: string }
export interface AgentProposal {
  id: string; parentId: string; name: string; specialty: string; purpose: string; skill: string; bankSkillIds: string[];
  everyMinutes: number; maxMinutes: number; reason: string; skillFile?: { name: string; description: string; body: string } | null; auto?: boolean; status: 'proposed' | 'approved' | 'rejected'; createdAt: string; agentId?: string | null;
}
export interface RunnerWorker { taskId: string | null; agentId: string; agentName: string; title: string | null; costUsd: number; status: string; rounds: number; summary?: string }
export interface RunnerRun { workers?: RunnerWorker[]; id: string; agentId?: string; taskId?: string | null; skillFileFor?: string; trigger: 'manual' | 'schedule' | 'focus'; startedAt: string; endedAt: string | null; costUsd: number; costKnown: boolean; searches: number; fetches?: number; etsyCalls?: number; printifyCalls?: number; trendCalls?: number; images?: number; imageUsd?: number; status: string; summary: string; notify?: string | null }
export interface RunnerStatus {
  configured: boolean; model: string; capUsd: number; everyMinutes: number; maxMinutes: number; schedule: boolean;
  spentUsd: number; spentByAgent?: Record<string, number>; allowanceUsd?: number; spentTodayUsd?: number; parallel?: number; rounds?: number; taskBudgetUsd?: number; unknownCostRuns: number; month: string; running: string | null; synced: boolean;
  memory: string; nextAction: string; tasks: RunnerTask[]; agentProposals?: AgentProposal[]; autoAgents?: boolean; autoTasks?: boolean; etsy?: { configured: boolean; connected: boolean; shopName: string | null }; printify?: { configured: boolean; shopId: number | null; shopTitle: string | null; channel: string | null }; publishRequests?: PublishRequest[]; openai?: { configured: boolean; model: string }; budgets?: Budgets; brain?: { id: string | null; others: OtherBrain[] }; ads?: AdEntry[]; sources?: SourceFolderInfo[]; trends?: TrendSources; degen?: { from: 'local' | 'github'; skills: number; given: number } | null; designStyle?: { guide: string; note: string; at: string | null }; canva?: { configured: boolean; connectedAt: string | null; connecting?: { url: string; startedAt: number } | null; month: string; aiCalls: number; exports: number; limit: number; log: CanvaEntry[] }; designs?: DesignEntry[]; images?: { month: string; spentUsd: number; capUsd: number; log: ImageEntry[] }; money?: { byAgent: Record<string, MoneyRow>; entries: MoneyEntry[]; sales: SaleLine[]; salesSync: { at: string; error: string | null; orders: number | null } | null }; progressLog?: ProgressEntry[]; skillFiles?: SkillFile[]; asks?: OriginAsk[]; runs: RunnerRun[]; nextScheduledAt: string | null; focusEveryMinutes?: number;
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

/** The ventures and their skill agents, by id, so JARVIS can name a parent when it proposes an agent. */
export function brainMap(doc: OfficeDoc): string {
  const ventures = Object.values(doc.agents).filter((a) => branchKind(doc, a.id) === 'venture');
  if (!ventures.length) return `THE BRAIN NOW\nYou are ${ORIGIN_ID}. No ventures yet.`;
  return `THE BRAIN NOW\nYou are ${ORIGIN_ID}. Ventures:\n${ventures.map((v) => {
    const skills = Object.values(doc.agents).filter((a) => a.branch?.kind === 'skill' && a.branch.ventureId === v.id).map((a) => a.identity.name);
    return `- [${v.id}] ${v.identity.name}: ${v.identity.title}${skills.length ? ` (skill agents: ${skills.join(', ')})` : ''}`;
  }).join('\n')}`;
}

/** Send JARVIS's current instructions, bank skills and brain map so scheduled runs use them. */
export async function syncOrigin(doc: OfficeDoc) {
  if (!doc.agents[ORIGIN_ID]?.ai.systemInstructions) return false;
  // every other agent's instructions and SKILL.md, so JARVIS can work a task as that agent
  const agents = Object.values(doc.agents).filter((a) => a.id !== ORIGIN_ID).map((a) => ({
    id: a.id, name: a.identity.name, title: a.identity.title, kind: branchKind(doc, a.id), ventureId: a.branch?.ventureId ?? null,
    hasSkillFile: doc.skillBank.some((k) => k.id === `skill_file_${a.id}`), prompt: agentPrompt(doc, a.id),
  }));
  return !!(await call('/sync', { instructions: `${agentPrompt(doc, ORIGIN_ID)}\n\n${brainMap(doc)}`, agents, brainId: doc.id, brainName: doc.name }, 10_000));
}

/** Start a manual work window; resolves when it ends (up to the window length). */
export async function runOrigin(doc: OfficeDoc, maxMinutes: number, branch?: { agentId: string; agentIds: string[] }) {
  await syncOrigin(doc);
  return call<{ ok: boolean; reason?: string; run?: RunnerRun }>('/run', branch ?? {}, (maxMinutes + 1) * 60_000);
}

export interface OriginAsk { at: string; q: string; a: string; costUsd: number | null; agentId?: string | null; by?: string }

/** Ask JARVIS a question from the console; it answers right away, any time, against the same cap. */
export async function askOrigin(question: string) {
  const r = await call<{ ok: true; answer: string; costUsd: number | null; taskTitle: string | null; approved?: string[] | null; skills?: { files: string[]; bank: string[]; unknown: string[] } | null; skillsStarted?: boolean; by?: string; started?: boolean } | { ok: false; reason: string }>('/ask', { question }, 70_000);
  if (!r) return null;
  // an older runner without /ask answers 404
  if (!r.data.ok && !('reason' in r.data && r.data.reason)) return { ok: false as const, reason: "JARVIS's runner is out of date. Stop it and start it again with npm.cmd run origin." };
  return r.data;
}

/** Give JARVIS a task from the command center: approved by your words, its focus until done, and started right away. */
export async function giveTask(text: string) {
  const r = await call<{ ok: true; task: RunnerTask; started: boolean } | { ok: false; reason: string }>('/focus', { text }, 10_000);
  if (!r) return null;
  if (!r.data.ok && !('reason' in r.data && r.data.reason)) return { ok: false as const, reason: "JARVIS's runner is out of date. Restart the app (or npm.cmd run origin)." };
  return r.data;
}

/** A design from the gallery, fetched through the runner and shown as a local blob. */
export async function designUrl(id: string) {
  try {
    const r = await fetch(`${BASE}/design?id=${encodeURIComponent(id)}`, { signal: AbortSignal.timeout(25_000) });
    if (!r.ok || !(r.headers.get('content-type') || '').startsWith('image/')) return null;
    return URL.createObjectURL(await r.blob());
  } catch { return null; }
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

/** Whether JARVIS and its ventures create agents without asking. */
export async function setAutoAgents(autoAgents: boolean) {
  return !!(await call('/settings', { autoAgents }));
}
/** Empire mode: JARVIS approves its own research tasks (a few at a time, each within its budget and the cap). */
export async function setAutoTasks(autoTasks: boolean) {
  return !!(await call('/settings', { autoTasks }));
}

/** Add or remove one of the owner's own money lines for a branch, or pull the latest sales from Printify. */
export async function moneyAction(body: { action: 'add'; agentId: string; kind: 'income' | 'expense'; usd: number; note?: string } | { action: 'remove'; id: string } | { action: 'sync' }) {
  const r = await call<{ ok: boolean; error?: string | null }>('/money', body, 60_000);
  return r ? r.data : null;
}

/** The owner's monthly limit on design images, billed to their OpenAI account. */
export async function setImageCap(imageCapUsd: number) {
  return !!(await call('/settings', { imageCapUsd }));
}

/** The owner's monthly limit on Canva AI designs and images (they use their Canva AI credits). */
export async function setCanvaLimit(canvaAiLimit: number) {
  return !!(await call('/settings', { canvaAiLimit }));
}

export async function skillFileImported(id: string) {
  return !!(await call('/skillfiles', { action: 'imported', id }));
}

export async function taskAction(body: { action: 'add'; title: string; detail?: string; kind?: 'skill-file'; version?: number; requested?: boolean; agentId?: string; agentName?: string } | { action: 'approve' | 'reject' | 'done' | 'stop'; id: string } | { action: 'repeat'; id: string; everyMinutes: number | null }) {
  return (await call<{ ok: boolean; tasks: RunnerTask[] }>('/tasks', body))?.data ?? null;
}

/** Connect (or disconnect) the owner's Canva from the app: the runner opens Canva's sign-in in their browser and keeps the answer. */
export async function connectCanva(action: 'connect' | 'forget' = 'connect') {
  const r = await call<{ ok: boolean; url?: string; reason?: string }>('/canva/connect', { action }, 40_000);
  return r ? r.data : null;
}

/** The owner's Yes or No on a design in Approvals. Yes makes the agent build the Printify product and publishes it. */
export async function designDecision(id: string, action: 'approve' | 'reject') {
  const r = await call<{ ok: boolean; reason?: string; note?: string; taskId?: string; printify?: string }>('/designs', { id, action }, 90_000);
  return r ? r.data : null;
}

/** The owner's budgets: the monthly cap (or funds added to it), the image, Canva and voice limits, and per-branch budgets. */
/** The owner's own design notes, added to the style guide every agent gets. */
export async function setDesignStyle(note: string) {
  const r = await call<{ ok: boolean }>('/settings', { designStyle: note }, 20_000);
  return r ? r.data : null;
}
export async function setBudgets(b: { capUsd?: number; addFundsUsd?: number; imageCapUsd?: number; canvaAiLimit?: number; voiceCapUsd?: number; branchBudgets?: Record<string, number | null> }) {
  const r = await call<{ ok: boolean; budgets: Budgets }>('/settings', b);
  return r ? r.data : null;
}

/** The owner's decision on a product: publish sends it live to their store through Printify. */
export async function publishDecision(id: string, action: 'publish' | 'reject') {
  const r = await call<{ ok: boolean; reason?: string; printify?: string }>('/printify/publish', { id, action }, 60_000);
  return r ? r.data : null;
}

/** The owner's Yes or No on an ad in the Ads tab. Yes keeps it as a file on their PC to post from; nothing is posted by the app. */
export async function adDecision(id: string, action: 'approve' | 'reject') {
  const r = await call<{ ok: boolean; error?: string; ad?: AdEntry }>('/ads', { id, action }, 20_000);
  return r ? r.data : null;
}
/** Ask for ads for approved, listed products (all of them, or the ones named): a focus task for the ads agent, or JARVIS. */
export async function makeAds(productIds: string[] = [], agentId?: string | null) {
  const r = await call<{ ok: boolean; error?: string; task?: RunnerTask }>('/ads', { action: 'make', productIds, ...(agentId ? { agentId } : {}) }, 20_000);
  return r ? r.data : null;
}
/** The owner's skill library (lyopz/degen-skill): list it, or hand every agent the skills its role fits. */
export async function degenAction(action: 'list' | 'distribute') {
  const r = await call<{ ok: boolean; error?: string; from?: 'local' | 'github'; dir?: string | null; skills?: { name: string; description: string; chars: number; roles: string[] }[]; given?: { skill: string; agents: string[]; already: number }[]; errors?: string[] }>('/degen', { action }, 60_000);
  return r ? r.data : null;
}

/** The owner's design sources: link a folder on their PC, unlink one, or delete one image an agent saved. */
export async function sourceAction(body: { action: 'add'; path: string; label?: string } | { action: 'remove'; id: string } | { action: 'delete'; file: string }) {
  const r = await call<{ ok: boolean; error?: string; sources?: SourceFolderInfo[] }>('/sources', body, 20_000);
  return r ? r.data : null;
}
