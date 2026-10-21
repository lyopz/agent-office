#!/usr/bin/env node
// JARVIS's real work windows. Runs the main agent on a live model every
// ORIGIN_EVERY_MIN minutes for at most ORIGIN_MAX_MIN minutes, plus manual runs
// from the app's "Run 10 min" button, and never spends past the monthly cap.
// JARVIS works on one owner-approved task per run, oldest first; with none
// approved it only reviews its notes and proposes a task, without web searches.
// It can also propose one new agent per run (with skills from the owner's
// skill bank); the owner approves it in the app, which creates it.
//
//   npm run set-key   (once: saves the key on this PC, outside the app folder)
//   npm run origin    (listens on 127.0.0.1:8788; ANTHROPIC_API_KEY in the environment wins if set)
//   ORIGIN_MODEL=claude-haiku-5-5 ORIGIN_MONTHLY_CAP_USD=15 ORIGIN_EVERY_MIN=30 ORIGIN_MAX_MIN=10 ORIGIN_PARALLEL=3 ORIGIN_ROUNDS=3 ORIGIN_SCHEDULE=on
//
// State (instructions synced from the app, tasks, JARVIS's notes, the cost
// ledger) is kept in origin-data/state.json next to the app. The key lives only
// in this process's environment and is never written to disk or logged.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { readKey } from './key-file.mjs';
import { ETSY_TOOLS, authUrl, etsyPublic, finishAuth, runEtsyTool } from './etsy.mjs';
import { PRINTIFY_TOOLS, printifyConfig, printifyPublic, listOrders, productPreview, publishProduct, runPrintifyTool, uploadImage } from './printify.mjs';
import { moneyByAgent, salesFromOrders } from './money.mjs';
import { IMAGE_TOOL, generateImage, imageWorstUsd, openaiPublic } from './openai-images.mjs';
import { voicePublic, voiceRoute } from './openai-voice.mjs';

const PORT = Number(process.env.ORIGIN_PORT || 8788);
const MODEL = process.env.ORIGIN_MODEL || 'claude-haiku-5-5';
const { key: KEY, from: KEY_FROM } = readKey();
const CAP = Number(process.env.ORIGIN_MONTHLY_CAP_USD || 15);
const EVERY_MIN = Number(process.env.ORIGIN_EVERY_MIN || 30);
/** Agents working at once in one run (each on its own task), and work rounds per task in one run. */
const PARALLEL = Number(process.env.ORIGIN_PARALLEL || 3);
const MAX_ROUNDS = Number(process.env.ORIGIN_ROUNDS || 3);
/** A task the owner typed in the command center is the focus: worked first, more rounds a run, and runs every FOCUS_EVERY_MIN until it is done. */
const FOCUS_EVERY_MIN = Number(process.env.ORIGIN_FOCUS_EVERY_MIN || 10);
const FOCUS_MAX_ITEMS = 10;
/** Design images are billed to the owner's OpenAI account, outside the Anthropic cap, so they get their own monthly cap (the owner sets it in the app). */
const IMAGE_CAP_USD = Number(process.env.ORIGIN_IMAGE_CAP_USD || 5);
const IMAGE_LOG_KEEP = 200;
const roundsFor = (task) => (task?.focus ? MAX_ROUNDS * 2 : MAX_ROUNDS);
const MAX_MIN = Number(process.env.ORIGIN_MAX_MIN || 10);
const SCHEDULE = (process.env.ORIGIN_SCHEDULE || 'on') !== 'off';
const DIR = path.resolve(process.env.ORIGIN_DATA_DIR || 'origin-data');
const FILE = path.join(DIR, 'state.json');
const MAX_BODY = 2 * 1024 * 1024;
const MAX_INSTRUCTIONS = 200_000;

/** Most a single run may spend, and what must be left in the month before a run starts. */
const RUN_LIMIT_USD = Number(process.env.ORIGIN_RUN_LIMIT_USD || 0.5);
const MAX_CALLS = 8;
/** A generous ceiling on one model call (8K output, a large prompt, five searches); a call starts only if this still fits. */
const CALL_WORST_USD = 0.2;
const MAX_SEARCHES = 5;
/** Pages a run may read in full with web fetch (no fee beyond tokens), and the most of one page it reads. */
const MAX_FETCHES = 5, FETCH_TOKENS = 20_000;

// USD per million tokens; prompts over 100K tokens use the higher card. Web search: $10 per 1,000.
const PRICES = {
  'claude-haiku-5-5': { small: [0.10, 0.50], large: [0.50, 2.50], threshold: 100_000 },
  'claude-sonnet-5-5': { small: [2, 10], large: [2, 10], threshold: Infinity },
  'claude-opus-5-5': { small: [4, 20], large: [4, 20], threshold: Infinity },
};
const SEARCH_USD = 0.01;

/** A task's default budget: a tenth of the monthly cap. JARVIS stops a task on its own when its spend pattern would pass it. */
const TASK_BUDGET_USD = Number(process.env.ORIGIN_TASK_BUDGET_USD || CAP / 10);
/** Runs a task gets before JARVIS projects its long-run cost from the pattern. */
const WATCH_AFTER_RUNS = 3;
const AGENT_ID = 'agent_origin';

/** Cost of one response from its usage block. Cache writes are priced at 1.25x input, cache reads at 0.1x. */
export function costOf(model, usage) {
  const p = PRICES[model];
  if (!p) return null; // unknown model: cost unknown, never zero
  const prompt = (usage.input_tokens || 0) + (usage.cache_creation_input_tokens || 0) + (usage.cache_read_input_tokens || 0);
  const [inp, out] = prompt > p.threshold ? p.large : p.small;
  const searches = usage.server_tool_use?.web_search_requests || 0;
  return ((usage.input_tokens || 0) * inp + (usage.cache_creation_input_tokens || 0) * inp * 1.25 + (usage.cache_read_input_tokens || 0) * inp * 0.1 + (usage.output_tokens || 0) * out) / 1e6 + searches * SEARCH_USD;
}

const month = () => new Date().toISOString().slice(0, 7);
function emptyState() {
  return { instructions: '', memory: '', nextAction: '', tasks: [], agentProposals: [], skillFiles: [], progressLog: [], autoAgents: true, autoTasks: true, ledger: { month: month(), spentUsd: 0, unknownCostRuns: 0, byAgent: {} }, runs: [], lastScheduledAt: null };
}
export function loadState(file = FILE) {
  let s;
  try { s = { ...emptyState(), ...JSON.parse(fs.readFileSync(file, 'utf8')) }; } catch { return emptyState(); }
  // an early app version sent SKILL.md requests as plain tasks; the app asks again in the proper form
  for (const t of s.tasks) if (!t.kind && t.status === 'approved' && /^Write .+'s SKILL\.md( in full detail)?$/.test(t.title)) t.status = 'done';
  return s;
}
function saveState(s, file = FILE) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(s, null, 2));
  fs.renameSync(tmp, file);
}
/** A new month starts a new budget; the old month's total stays in the run history. */
function rollMonth(s) { if (s.ledger.month !== month()) s.ledger = { month: month(), spentUsd: 0, unknownCostRuns: 0, byAgent: {}, byDay: {} }; s.ledger.byAgent ??= {}; s.ledger.byDay ??= {}; }
const today = () => new Date().toISOString().slice(0, 10);
const round6 = (n) => Math.round(n * 1e6) / 1e6;
/** Add a cost to the month, the day and the agent it was for. */
/** All-time spend per agent (the monthly ledger starts over each month); started from what the ledger already had. */
function ensureTotals(s) {
  if (s.totals) return s.totals;
  const images = {};
  for (const e of s.imageLog || []) images[e.agentId] = round6((images[e.agentId] || 0) + e.usd);
  return (s.totals = { claude: { ...(s.ledger?.byAgent || {}) }, images });
}
function charge(s, agentId, usd) {
  const t = ensureTotals(s);
  t.claude[agentId] = round6((t.claude[agentId] || 0) + usd);
  const ledger = s.ledger;
  ledger.spentUsd = round6(ledger.spentUsd + usd);
  ledger.byAgent[agentId] = round6((ledger.byAgent[agentId] || 0) + usd);
  ledger.byDay ??= {};
  ledger.byDay[today()] = round6((ledger.byDay[today()] || 0) + usd);
}

/** Today's share of what is left of the monthly cap, so a fast schedule never runs the month out early. */
export function dailyAllowance(s, now = new Date()) {
  const end = Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1);
  const daysLeft = Math.max(1, Math.ceil((end - now.getTime()) / 86_400_000));
  const spentToday = s.ledger.byDay?.[now.toISOString().slice(0, 10)] || 0;
  return { allowanceUsd: round6((remaining(s) + spentToday) / daysLeft), spentTodayUsd: spentToday };
}

/** Runs left this month on the schedule, for projecting a task that keeps running. */
function runsLeftThisMonth(now = new Date()) {
  const end = Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1);
  return Math.max(0, Math.floor((end - now.getTime()) / (EVERY_MIN * 60_000)));
}

/**
 * Budget watch: whether a task's spend pattern means it should stop, and why.
 * It stops when the task has used its budget, when its average cost per run
 * would pass the budget if it kept running to the end of the month, or when its
 * runs are getting steadily more expensive and it is already past half its budget.
 */
export function budgetWatch(task, now = new Date()) {
  const budget = task.budgetUsd ?? TASK_BUDGET_USD;
  const spent = task.spentUsd || 0, costs = task.runCosts || [];
  if (spent >= budget) return `it used its $${budget.toFixed(2)} budget ($${spent.toFixed(2)} over ${costs.length} runs)`;
  if (costs.length < WATCH_AFTER_RUNS) return null;
  const avg = costs.reduce((x, c) => x + c, 0) / costs.length;
  // a task with a plan needs about one run per few open steps; without one, judge it over its next 30 runs at most
  const open = (task.steps || []).filter((x) => !x.done).length;
  const runsAhead = task.steps?.length ? Math.ceil(open / MAX_ROUNDS) * 2 : Math.min(runsLeftThisMonth(now), 30);
  const projected = spent + avg * runsAhead;
  if (projected > budget * 2) return `at $${avg.toFixed(3)} a run it would reach about $${projected.toFixed(2)} by month end, past its $${budget.toFixed(2)} budget`;
  const last3 = costs.slice(-3);
  if (last3[0] < last3[1] && last3[1] < last3[2] && last3[2] > 2 * last3[0] && spent > budget / 2) return `each run costs more than the last ($${last3.map((c) => c.toFixed(3)).join(', ')}) and it has used over half its budget`;
  return null;
}
function stopTask(task, reason, at) { task.status = 'stopped'; task.stopReason = reason; task.stoppedAt = at; }
const remaining = (s) => Math.max(0, CAP - s.ledger.spentUsd);

const newId = (p) => `${p}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 5)}`;
/** Empire mode (the owner's choice, on by default): JARVIS approves its own research tasks, a few at a time, each within its task budget and the monthly cap. */
const SELF_TASKS_OPEN = 3;
const selfTasksOpen = (s) => s.tasks.filter((t) => t.status === 'approved' && t.by === 'origin').length;
const canSelfApprove = (s) => s.autoTasks !== false && selfTasksOpen(s) < SELF_TASKS_OPEN;
/** The owner's command-center tasks that are still open. While one is, JARVIS works only on them. */
const focusOpen = (s) => s.tasks.filter((t) => t.focus && t.status === 'approved');
/** How many things the owner asked for ("5 items for my etsy store"), when they gave a number. */
export function itemCount(text) {
  const m = String(text || '').match(/\b(\d{1,2}|one|two|three|four|five|six|seven|eight|nine|ten)\s+(?:new\s+|more\s+|\w+\s+)?(?:items?|products?|designs?|listings?|shirts?|t-shirts?|tees?|mugs?|posters?|prints?|hoodies?|stickers?|totes?|bags?|hats?|cases?)\b/i);
  if (!m) return null;
  const words = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };
  const n = words[m[1].toLowerCase()] ?? Number(m[1]);
  return n > 0 ? Math.min(n, FOCUS_MAX_ITEMS) : null;
}
/** A task the owner gave in the command center: approved, and JARVIS's focus until it is done. */
export function addFocusTask(s, { title, detail = '', agentId = null, budgetUsd = null, count = null }) {
  const t = String(title || '').trim().slice(0, 160);
  if (!t) return null;
  const open = s.tasks.find((x) => x.status === 'approved' && x.title.toLowerCase() === t.toLowerCase());
  if (open) { open.focus = true; return open; }
  const task = { id: newId('task'), title: t, detail: String(detail || '').slice(0, 4000), status: 'approved', by: 'owner', via: 'console', focus: true, createdAt: new Date().toISOString() };
  if (typeof agentId === 'string' && (s.agents || []).some((a) => a.id === agentId)) task.agentId = agentId;
  const usd = Number(budgetUsd);
  if (usd > 0) task.budgetUsd = Math.min(usd, CAP);
  const n = Number(count) > 0 ? Math.min(Math.round(Number(count)), FOCUS_MAX_ITEMS) : itemCount(`${t} ${task.detail}`);
  if (n) task.count = n;
  s.tasks.push(task);
  for (const x of s.tasks) delete x.waitingOnOwner;
  return task;
}

/** Proposals the owner still has to decide. With autoAgents on, agents are created without asking, so only tasks wait. */
const pendingCount = (s) => s.tasks.filter((t) => t.status === 'proposed').length + (s.autoAgents === false ? s.agentProposals.filter((a) => a.status === 'proposed').length : 0);
/** How many agents JARVIS may create (or propose) in one run. */
const agentsPerRun = (s) => (s.autoAgents === false ? 1 : 3);
/** The current SKILL.md format (the full ten-section playbook); the app rewrites files older than this. */
const SKILL_FILE_VERSION = 2;
/** Agents with the same job share one SKILL.md: their request with the agent's own name taken out. */
const roleOf = (t) => t.detail.split(t.agentName || '\u0000').join('').replace(/,? created by [^.,]+/, '').replace(/\s+/g, ' ').trim();

/** What a SKILL.md for one agent must contain. JARVIS writes one for every agent it or the owner creates. */
const SKILL_FILE_RULES = `A SKILL.md is the full, detailed playbook for one agent's job: specific to that agent and its business, never generic, and complete enough that the agent can do excellent work from it alone. Write it in Markdown, between 6,000 and 18,000 characters, with these sections:
1. Mission: the outcome it owns, who it serves, and what "done" and "excellent" look like, with measurable targets.
2. Scope: what it does and explicitly does not do; who it hands work to and receives work from.
3. Recurring workflows: each one as numbered steps with decision points (if X then Y), the order of work, and how long each step should take within its work window.
4. Methods and techniques: the specific frameworks, formulas, checklists or tactics an expert in this role uses, with short worked examples for this business.
5. Inputs and sources: where it gets information, how to judge each source's reliability and freshness, and what to do when sources disagree.
6. Deliverables: the exact format of each output (headings, fields, length), with a filled-in example.
7. Quality bar: a checklist it runs before handing work back, and common mistakes to avoid.
8. Costs and limits: what each kind of work costs in tokens, searches or money, its budget habits, and when to stop.
9. Approvals and escalation: what needs the owner's approval, what goes to its venture or to JARVIS, and how to write that request.
10. Improving: what it records after each task so the next run is better.`;
const cleanSkillFile = (f) => (f && typeof f === 'object' && String(f.body || '').trim().length >= 200
  ? { name: String(f.name || '').slice(0, 80), description: String(f.description || '').slice(0, 1000), body: String(f.body).slice(0, 20_000) }
  : null);

/**
 * One task at a time: the owner's oldest approved task, and SKILL.md writing only when none is ready.
 * A task waiting on the owner's decision (a proposal it made) steps aside until that decision, so it
 * never holds up the rest.
 */
export function nextTask(s) {
  // a SKILL.md request for an agent that isn't in the open brain waits until that brain is open again
  const known = (t) => t.kind !== 'skill-file' || !(s.agents || []).length || s.agents.some((a) => a.id === t.agentId);
  const ready = (t) => t.status === 'approved' && !(t.waitingOnOwner && pendingCount(s)) && known(t);
  // the owner's own tasks come before the ones JARVIS set itself
  return s.tasks.find((t) => ready(t) && !isSkillTask(t) && t.by !== 'origin') || s.tasks.find((t) => ready(t) && !isSkillTask(t)) || s.tasks.find((t) => ready(t) && t.kind === 'skill-file') || null;
}

/** An agent's instructions and SKILL.md, as the app last synced them. */
function agentBrief(s, agentId) { return (s.agents || []).find((a) => a.id === agentId)?.prompt || ''; }
/** The agent a task was given to: by id, or by a title that starts with its name. */
function taskAgent(s, task) {
  return (s.agents || []).find((a) => a.id === task.agentId) || (s.agents || []).find((a) => task.title.startsWith(`${a.name}: `)) || null;
}
function workAs(s, task) {
  const a = taskAgent(s, task);
  return a ? `\n\nWORK THIS TASK AS ${a.name}. Follow its instructions and SKILL.md below exactly: its workflow, methods, deliverable format and quality bar. Hand back what its SKILL.md says to hand back.\n--- ${a.name} ---\n${a.prompt}\n--- end of ${a.name} ---` : '';
}

/** Close open work for agents that are no longer in the brain the app synced, so it never spends the cap on them. */
export function pruneGone(s, at) {
  const here = new Set([AGENT_ID, ...(s.agents || []).map((a) => a.id)]);
  const gone = 'agent no longer in the brain';
  let n = 0;
  for (const t of s.tasks) {
    if ((t.status === 'approved' || t.status === 'proposed') && t.agentId && !here.has(t.agentId)) { Object.assign(t, { status: 'stopped', stopReason: gone, stoppedAt: at }); delete t.waitingOnOwner; n++; }
  }
  for (const p of s.agentProposals || []) {
    if (p.status === 'proposed' && !here.has(p.parentId)) { Object.assign(p, { status: 'rejected', reason: `${p.reason ? `${p.reason} ` : ''}(${gone})` }); n++; }
  }
  for (const f of s.skillFiles || []) {
    if (f.status === 'new' && !(f.agentIds ?? [f.agentId]).some((id) => here.has(id))) { f.status = 'imported'; n++; }
  }
  return n;
}

/** Every design an agent makes is kept on this PC and shown in the app, whether or not it goes to Printify. */
const DESIGN_TOOL = {
  name: 'design_save',
  description: "Save a finished design to the owner's design gallery in the app, where they see it right away. Write the artwork yourself as complete SVG markup (typography, badges, vector illustration, patterns; size it for print, e.g. viewBox 0 0 4500 5400 for shirts, 2700 1100 for mugs, transparent background unless the product needs one). Free. Designs you upload with printify_upload_design are saved here automatically, so use this one when Printify is not set up or for drafts and variations.",
  input_schema: { type: 'object', properties: { file_name: { type: 'string' }, svg: { type: 'string' }, title: { type: 'string', description: 'what the design is, e.g. "Jersey Avenue retro script, cream on navy"' } }, required: ['svg'] },
};
const DESIGNS_KEEP = 300;
const designDir = () => path.join(DIR, 'designs');
/** Save one design (SVG text or PNG base64) and record it for the gallery. */
function saveDesign(s, task, { file_name, svg, png, title, imageId }, w) {
  const kind = png ? 'png' : 'svg';
  const data = png ? Buffer.from(String(png), 'base64') : Buffer.from(String(svg || ''), 'utf8');
  if (kind === 'svg' && !/<svg[\s>]/i.test(String(svg || ''))) return { content: 'Give the full SVG markup in svg.', isError: true };
  if (data.length > 8_000_000) return { content: 'That design is too large (over 8 MB).', isError: true };
  const id = newId('design');
  fs.mkdirSync(designDir(), { recursive: true });
  fs.writeFileSync(path.join(designDir(), `${id}.${kind}`), data);
  const agent = task ? taskAgent(s, task) : null;
  const name = String(file_name || title || 'design').replace(/[^\w .-]/g, '_').slice(0, 80);
  s.designs = [...(s.designs || []), { id, kind, fileName: name.endsWith(`.${kind}`) ? name : `${name}.${kind}`, title: String(title || name).slice(0, 140), agentId: agent?.id ?? AGENT_ID, agentName: agent?.name ?? 'JARVIS', taskId: task?.id ?? null, taskTitle: task?.title ?? null, imageId: imageId ?? null, at: new Date().toISOString() }].slice(-DESIGNS_KEEP);
  if (w) w.designs = (w.designs || 0) + 1;
  return { content: JSON.stringify({ saved: true, design_id: id, note: 'The owner can see it in the design gallery now.' }), isError: false };
}

/** The tools agents get in task runs, from whatever the owner has set up. */
function agentTools() {
  const printify = printifyPublic().configured;
  // images go straight into Printify as designs, so the image tool needs both
  // images are uploaded to Printify when it is set up, and always saved in the app's design gallery
  const images = openaiPublic().configured;
  const list = [DESIGN_TOOL, ...(etsyPublic().configured ? ETSY_TOOLS : []), ...(printify ? PRINTIFY_TOOLS : []), ...(images ? [IMAGE_TOOL] : [])];
  return {
    tools: list,
    run: (name, input) => (name.startsWith('etsy_') ? runEtsyTool(name, input) : runPrintifyTool(name, input)),
    preview: (id) => productPreview(id),
    image: async (input) => {
      const g = await generateImage(input);
      const up = printify ? await uploadImage(input.file_name || 'design.png', g.b64).catch((e) => ({ upload_error: e.message })) : { note: 'Printify is not set up; the image is saved in the owner\'s design gallery only.' };
      return { ...up, b64: g.b64, usd: g.usd, model: g.model, quality: g.quality, size: g.size, estimated: g.estimated };
    },
  };
}

/** This month's image spend; a new month starts at zero. */
function rollImages(s) { const m = month(); if (s.images?.month !== m) s.images = { month: m, spentUsd: 0 }; return s.images; }
const imageCap = (s) => (Number.isFinite(s.imageCapUsd) ? s.imageCapUsd : IMAGE_CAP_USD);

/** An agent makes a design image: within the owner's image cap, logged with its cost, uploaded to Printify. */
async function makeImage(s, task, input, w, tools) {
  const spent = rollImages(s);
  const q = ['low', 'medium', 'high'].includes(input?.quality) ? input.quality : 'medium';
  if (!tools?.image) return { content: 'The image generator is not set up.', isError: true };
  if (spent.spentUsd + imageWorstUsd(q) > imageCap(s)) return { content: `The owner's image cap for this month ($${imageCap(s).toFixed(2)}) is reached. Make this design as SVG with printify_upload_design instead, and tell the owner in notifyOwner.`, isError: true };
  try {
    const g = await tools.image({ ...input, quality: q });
    saveDesign(s, task, { file_name: input.file_name || 'image', png: g.b64, title: String(input.prompt || '').slice(0, 140), imageId: g.image_id }, w);
    delete g.b64;
    const agent = task ? taskAgent(s, task) : null;
    const e = { id: newId('img'), at: new Date().toISOString(), model: g.model, quality: g.quality, size: g.size, usd: g.usd, estimated: !!g.estimated, prompt: String(input.prompt || '').slice(0, 300), agentId: agent?.id ?? AGENT_ID, agentName: agent?.name ?? 'JARVIS', taskId: task?.id ?? null, taskTitle: task?.title ?? null, imageId: g.image_id };
    s.imageLog = [...(s.imageLog || []), e].slice(-IMAGE_LOG_KEEP);
    spent.spentUsd = round6(spent.spentUsd + g.usd);
    w.images = (w.images || 0) + 1; w.imageUsd = round6((w.imageUsd || 0) + g.usd);
    return { content: JSON.stringify({ image_id: g.image_id ?? null, ...(g.upload_error ? { upload_error: g.upload_error } : {}), ...(g.note ? { note: g.note } : {}), width: g.width, height: g.height, preview: g.preview, cost_usd: g.usd, saved_to_gallery: true, image_budget_left_usd: round6(imageCap(s) - spent.spentUsd) }), isError: false };
  } catch (err) {
    return { content: String(err.message || err).slice(0, 400), isError: true };
  }
}

/** An agent asks the owner to publish a Printify product: recorded for the owner's Publish button, never published here. */
async function requestPublish(s, task, input, record, tools = null) {
  const productId = String(input?.product_id || '').slice(0, 64);
  if (!productId) return { content: 'Give the product_id from printify_create_product.', isError: true };
  s.publishRequests = s.publishRequests || [];
  if (s.publishRequests.some((r) => r.productId === productId && r.status === 'waiting')) return { content: 'Already waiting for the owner.', isError: false };
  const agent = taskAgent(s, task || { title: '' });
  // a mockup and the price, so the owner can judge it in the list without opening Printify
  const look = (await tools?.preview?.(productId).catch(() => null)) || {};
  s.publishRequests.push({ id: newId('pub'), productId, shopId: printifyConfig()?.shopId ?? null, title: String(input.title || 'Product').slice(0, 140), why: String(input.why || '').slice(0, 400), agentId: agent?.id ?? AGENT_ID, agentName: agent?.name ?? 'JARVIS', taskId: task?.id ?? null, taskTitle: task?.title ?? null, ...(look.image ? { image: look.image } : {}), ...(look.priceUsd ? { priceUsd: look.priceUsd } : {}), status: 'waiting', at: new Date().toISOString() });
  record.publishAsks = (record.publishAsks || 0) + 1; // the worker that asked
  return { content: 'Sent to the owner. It goes live only when they press Publish.', isError: false };
}

const PROGRESS_KEEP = 300;
/** One line in the progress log, filed under the agent the work was for (JARVIS when none). */
function logProgress(s, task, e) {
  const agentId = e.agentId || task?.agentId || AGENT_ID;
  const name = (s.agents || []).find((a) => a.id === agentId)?.name || (agentId === AGENT_ID ? 'JARVIS' : task?.agentName || agentId);
  s.progressLog = [...(s.progressLog || []), { id: newId('prog'), at: e.at, runId: e.runId, agentId, agentName: name, taskId: task?.id ?? null, taskTitle: task?.title ?? null, pct: e.pct ?? null, note: e.note }].slice(-PROGRESS_KEEP);
}

/** Every agent in the owner's brain as the app last synced it. This, not JARVIS's notes, is what exists. */
function roster(s) {
  const all = s.agents || [];
  if (!all.length) return 'AGENTS IN THE BRAIN: the app has not sent the list yet.';
  const name = (id) => all.find((a) => a.id === id)?.name ?? (id === AGENT_ID ? 'JARVIS' : id);
  return `AGENTS IN THE BRAIN NOW (${all.length} besides you; they are real records in the owner's app, and this list is the truth even where your notes disagree):\n${all.map((a) => `- [${a.id}] ${a.name}: ${a.title || 'agent'}${a.kind === 'venture' ? ' (venture)' : a.kind === 'skill' ? ` (skill agent for ${name(a.ventureId)})` : ''}${a.hasSkillFile ? '' : ' (SKILL.md not written yet)'}`).join('\n')}`;
}

/** One file for every agent with the same job; their requests are done too. */
function saveSkillFile(s, task, file, at) {
  const same = s.tasks.filter((x) => x.kind === 'skill-file' && x.status === 'approved' && (x === task || roleOf(x) === roleOf(task)));
  for (const x of same) x.status = 'done';
  s.skillFiles.push({ id: newId('skillfile'), agentId: task.agentId, agentName: task.agentName, agentIds: same.map((x) => x.agentId), agentNames: same.map((x) => x.agentName), version: SKILL_FILE_VERSION, ...file, status: 'new', createdAt: at });
}

/** A shared skill for the owner's bank, given to the agents named; the app saves it and attaches it. */
function saveBankSkill(s, task, file, at) {
  task.status = 'done';
  s.skillFiles.push({ id: newId('skillfile'), bank: true, skillKey: task.skillKey, skillName: task.skillName, agentId: task.agentIds[0] ?? AGENT_ID, agentName: task.skillName, agentIds: task.agentIds, agentNames: task.agentNames, version: SKILL_FILE_VERSION, ...file, name: task.skillName, status: 'new', createdAt: at });
}

/** What JARVIS needs to write one shared bank skill. */
function bankSkillBrief(s, task) {
  const who = task.agentIds.map((id) => (s.agents || []).find((a) => a.id === id)).filter(Boolean);
  return `Write a skill for the owner's skill bank called "${task.skillName}". ${task.detail ? `What it is for: ${task.detail}. ` : ''}It will be given to ${who.map((a) => `${a.name} (${a.title || 'agent'})`).join(', ') || 'agents that need it'}, so write it for that work and this business, never generic. It is a SKILL.md like an agent's own, but for one capability any of them can use.\n\n${SKILL_FILE_RULES}`;
}

/** Turn names the owner or JARVIS used ("Mockup and Design", "all", "STORE team") into agent ids from the live roster. */
export function resolveAgents(s, refs) {
  const all = (s.agents || []);
  const norm = (x) => String(x || '').toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ').trim();
  const ids = new Set(), unknown = [];
  for (const raw of (Array.isArray(refs) ? refs : [refs]).map(String).slice(0, 100)) {
    const ref = norm(raw);
    if (!ref) continue;
    if (ref === 'all' || ref === 'all agents' || ref === 'everyone') { all.forEach((a) => ids.add(a.id)); continue; }
    const team = ref.replace(/\s*(team|branch|and its agents|agents)$/, '');
    const byId = all.find((a) => a.id === raw.trim());
    const exact = byId || all.find((a) => norm(a.name) === ref) || all.find((a) => norm(a.name) === team);
    const loose = exact || all.find((a) => norm(a.name).includes(ref) || (ref.length > 3 && ref.includes(norm(a.name))));
    if (!loose) { unknown.push(raw); continue; }
    ids.add(loose.id);
    // a venture named as a team brings every agent working for it
    if (team !== ref || /team|branch/.test(ref)) all.filter((a) => a.ventureId === loose.id).forEach((a) => ids.add(a.id));
  }
  return { ids: [...ids], unknown };
}

/**
 * The owner's request for skills: a SKILL.md for each agent named, and shared skills for the bank
 * given to the agents named. Queued as requested work that runs right away (see runSkills).
 */
export function queueSkills(s, req) {
  const at = new Date().toISOString();
  const out = { files: [], bank: [], unknown: [] };
  const nameOf = (id) => (s.agents || []).find((a) => a.id === id)?.name ?? id;
  const files = resolveAgents(s, req?.files ?? []);
  out.unknown.push(...files.unknown);
  for (const id of files.ids) {
    const open = s.tasks.find((t) => t.kind === 'skill-file' && t.agentId === id && t.status === 'approved');
    if (open) open.requested = true;
    else s.tasks.push({ id: newId('task'), kind: 'skill-file', version: SKILL_FILE_VERSION, agentId: id, agentName: nameOf(id), title: `Write ${nameOf(id)}'s SKILL.md in full detail`, detail: `${nameOf(id)}: ${(s.agents || []).find((a) => a.id === id)?.title || 'agent'}.`, status: 'approved', by: 'owner', requested: true, createdAt: at });
    out.files.push(nameOf(id));
  }
  for (const b of Array.isArray(req?.bank) ? req.bank.slice(0, 20) : []) {
    const name = String(b?.name || '').trim().slice(0, 60);
    if (!name) continue;
    const key = name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 40);
    const who = resolveAgents(s, b.agents ?? []);
    out.unknown.push(...who.unknown);
    const open = s.tasks.find((t) => t.kind === 'bank-skill' && t.skillKey === key && t.status === 'approved');
    if (open) { open.agentIds = [...new Set([...open.agentIds, ...who.ids])]; open.agentNames = open.agentIds.map(nameOf); open.requested = true; }
    else s.tasks.push({ id: newId('task'), kind: 'bank-skill', skillKey: key, skillName: name, agentIds: who.ids, agentNames: who.ids.map(nameOf), title: `Write the "${name}" skill${who.ids.length ? ` for ${who.ids.map(nameOf).join(', ')}` : ''}`.slice(0, 160), detail: String(b.description || '').slice(0, 600), status: 'approved', by: 'owner', requested: true, createdAt: at });
    out.bank.push(name);
  }
  return out;
}
const isSkillTask = (t) => t.kind === 'skill-file' || t.kind === 'bank-skill';
const requestedSkills = (s) => s.tasks.filter((t) => isSkillTask(t) && t.status === 'approved' && t.requested && (t.kind === 'bank-skill' || !(s.agents || []).length || s.agents.some((a) => a.id === t.agentId)));

/** What JARVIS needs to write one agent's SKILL.md. */
function skillFileBrief(s, task) {
  return `Write the SKILL.md for the agent "${task.agentName}" (id ${task.agentId})${task.sharedWith?.length ? `. ${task.sharedWith.length} other agents do exactly the same job (${task.sharedWith.join(', ')}) and will share this file, so write it for the role, not the one name` : ''}. What the owner and the agent's creator said about it:\n${task.detail}${agentBrief(s, task.agentId) ? `\n\nIts current instructions:\n${agentBrief(s, task.agentId)}` : ''}\n\n${SKILL_FILE_RULES}`;
}

/** What a command-center task asks of the agent working it. */
function focusBrief(s, task, etsy) {
  const made = (s.publishRequests || []).filter((r) => r.taskId === task.id).length;
  const printify = etsy?.tools.some((t) => t.name === 'printify_create_product');
  return `FOCUS: the owner gave you this task in the command center. It is your one job until it is done: do the work yourself now, with your tools, from start to finish. The owner's request comes before any scope limit in your SKILL.md (for example digital-only): do what they asked. Do not create agents, start ventures or set yourself other tasks while it is open, unless it truly cannot be done without a specialist that does not exist yet (then at most one).${task.count ? ` The owner asked for ${task.count} items; ${made} already sent to them. ${printify ? `Make each one completely in Printify (design, product, researched price, SEO title, full description, 13 tags) and send each finished one with printify_request_publish, so the owner can go through the list and approve or reject them one by one. Make your plan one step per item (after at most one research step), and keep going until all ${task.count} are sent.` : 'Printify is not connected, so you cannot make the products: write each item in full in taskNotes (title, description, 13 tags, price, design) and tell the owner in notifyOwner to run npm.cmd run set-printify once.'}` : ''}`;
}

function briefFor(s, task, deadline, etsy = null) {
  const perRun = task?.count ? Math.max(1, task.count - (s.publishRequests || []).filter((r) => r.taskId === task.id).length) : 3;
  return [
    `Current time: ${new Date().toISOString()}. This work window ends at ${deadline.toISOString()} (${MAX_MIN} minutes). Model: ${MODEL}.`,
    `Budget: $${s.ledger.spentUsd.toFixed(2)} of the owner's $${CAP} monthly cap spent this month; this run may spend at most $${Math.min(RUN_LIMIT_USD, remaining(s)).toFixed(2)}. Approved spending covers only these runs on the tasks below. Ask before anything else that costs money.`,
    roster(s),
    'Approval: every task listed as approved below is approved by the owner, including ones they gave in plain words in the console. Do not ask for it again, in other words, or for an exact scope. Old runs that failed with a 401 or "no API key" were before the owner set their key; it works now. If your notes say otherwise, correct them this run.',
    `Your notes from earlier runs (check them against the list above):\n${s.memory || '(none yet: this is your first real run)'}`,
    `Next action you recorded: ${s.nextAction || '(none)'}`,
    task?.kind === 'skill-file'
      ? `Your one task this run (the owner approved it): [${task.id}] write the SKILL.md for the agent "${task.agentName}" (id ${task.agentId})${task.sharedWith?.length ? `. ${task.sharedWith.length} other agents do exactly the same job (${task.sharedWith.join(', ')}) and will share this file, so write it for the role, not the one name` : ''}. What the owner and the agent's creator said about it:\n${task.detail}${agentBrief(s, task.agentId) ? `\n\nIts current instructions${task.version > 1 ? ' and its earlier, thinner SKILL.md (replace it with a much more detailed one)' : ''}:\n${agentBrief(s, task.agentId)}` : ''}\n\n${SKILL_FILE_RULES}\nResearch only if it makes the playbook more specific (for example current platform rules or prices). Return it as "skillFile": {"name": "a short skill name", "description": "one line on when this agent uses it", "body": "the full Markdown"} and list the task id in completedTaskIds.`
      : task
      ? `Your one task this run (the owner approved it; work only on this): [${task.id}] ${task.title}: ${task.detail}${workAs(s, task)}${task.focus ? `\n${focusBrief(s, task, etsy)}` : ''}\nPLAN AND STEPS: work the task from start to finish through an ordered plan. ${task.steps?.length ? `Your plan so far:\n${task.steps.map((x, i) => `${i + 1}. [${x.done ? 'x' : ' '}] ${x.text}`).join('\n')}\nDo the first unchecked step now.` : 'This is the first run on it: write a plan of 3 to 8 concrete, ordered steps that end in a finished deliverable, then do step 1 now.'}${task.notes ? `\nWhere it stood after the last run: ${task.notes}` : ''}\nReturn the whole plan in "steps" with each finished step marked done, and in "taskNotes" exactly where the task stands (findings so far, sources, what is next). You get up to ${roundsFor(task)} rounds this run: after each reply you may be asked to continue with the next step. When every step is done, list the task id in completedTaskIds and put the deliverable in taskNotes and notifyOwner.\nRESEARCH TOOLS: web_search finds sources ($0.01 a search, at most ${MAX_SEARCHES} a run); web_fetch reads a page from the results in full (no fee beyond tokens, at most ${MAX_FETCHES}). Use them for real evidence of what buyers want: best-seller and trending lists, reviews and the complaints in them, search suggestions, prices and sales counts, and cite each source with its date. ${etsy?.tools.some((t) => t.name === 'etsy_search') ? `ETSY (read-only, free): etsy_search shows real active listings with prices, favorites, views and tags; use it to measure demand, competition and price ranges. ${etsyPublic().connected ? "etsy_my_shop shows the owner's own shop and its numbers." : ''} ` : ''}${etsy?.tools.some((t) => t.name === 'printify_create_product') ? `PRINTIFY (the owner's shop "${printifyPublic().shopTitle || 'shop'}", ${printifyPublic().channel || 'connected store'}): you can make products to sell. Find a product type (printify_find_product_type), a provider and variants, upload a design (write it yourself as clean SVG, typography or simple vector art, sized for print), then printify_create_product with a researched price, SEO title, full description and 13 tags. ${etsy?.tools.some((t) => t.name === IMAGE_TOOL.name) ? `For illustrated or photo-style art, design_generate_image makes it with the owner's ChatGPT image model and uploads it for you ($${Math.max(0, imageCap(s) - rollImages(s).spentUsd).toFixed(2)} of the $${imageCap(s).toFixed(2)} monthly image budget left); text-only designs are better as SVG. ` : ''}Products stay unpublished in Printify (no cost). When one is finished and your research supports it, call printify_request_publish: the owner approves each one before it goes live on their store, where the store charges its listing fee. At most ${perRun} product${perRun === 1 ? '' : 's'} this run. ` : ''}DESIGNS: you can make real artwork yourself. Write it as complete SVG (lettering, badges, retro and vintage type, icons, patterns, simple illustration) sized for the product, and save it with design_save so the owner sees it in the app${etsy?.tools.some((t) => t.name === IMAGE_TOOL.name) ? '; for illustrated or photo-style art use design_generate_image' : ''}${etsy?.tools.some((t) => t.name === 'printify_create_product') ? '; then turn each finished design into a Printify product as above' : ''}. Never answer that you have no design tool. You cannot publish, buy or contact anyone yourself; for that, say what you need in notifyOwner. SKILLS: if the task is (or needs) SKILL.md files or bank skills for agents, do not write them here: list them in "skillRequests" ({"files": ["agent names"], "bank": [{"name": "...", "description": "...", "agents": ["agent names"]}]}) and the runner writes each one in full right after this run, saves it to the bank and attaches it; count that step as done.\nPROGRESS: report how far along the whole task is now in "progress": {"percent": 0-100, "note": "one or two sentences on what this run got done"}. Be honest: 100 only when it is done.${task.progress != null ? ` Last run you were at ${task.progress}%.` : ''}\nBUDGET WATCH: this task has cost $${(task.spentUsd || 0).toFixed(3)} over ${(task.runCosts || []).length} earlier runs (per run: ${(task.runCosts || []).slice(-5).map((c) => `$${c.toFixed(3)}`).join(', ') || 'none yet'}); its budget is $${(task.budgetUsd ?? TASK_BUDGET_USD).toFixed(2)}. If the pattern shows it will cost far more than it is worth over time, stop it yourself without asking: put its id in stopTaskIds with the reason in stopReason, and say so in notifyOwner. The runner also stops it automatically when it passes its budget.`
      : canSelfApprove(s)
      ? 'No task is ready. Do not research this run. Review your notes, make sure each venture has the skill agents it needs (below), and set the single most valuable next task in proposedTasks; in empire mode it is approved at once and worked next run.'
      : 'No approved task is ready. Do not research. Review your notes, make sure each venture has the skill agents it needs (below), and propose the single most valuable, cheap task for the owner to approve.',
    s.autoTasks !== false && !task?.focus ? `EMPIRE MODE: the owner wants you to build them an empire and lets you do it as you see fit: choose the ventures with the best evidence of demand and profit, start new ventures yourself (parentId your own id), give them the agents they need, and set your own research tasks, which are approved at once (at most ${SELF_TASKS_OPEN} of your own open at a time; ${selfTasksOpen(s)} open now). Every task still has its own budget and the $${CAP} monthly cap is hard. Never log in to the owner's accounts, publish or list anything, spend money, sign up for services, or contact anyone without asking: put that in notifyOwner as one clear request with the cost.` : '',
    `Waiting for the owner's approval already: ${[...s.tasks.filter((t) => t.status === 'proposed').map((t) => `task "${t.title}"`), ...s.agentProposals.filter((a) => a.status === 'proposed').map((a) => `agent "${a.name}"`)].join('; ') || 'nothing'}`,
    task?.focus
      ? 'Leave proposedTasks and proposedAgents empty this run unless the focus task cannot be done without them.'
      : s.autoAgents === false
      ? (pendingCount(s)
        ? 'Something is already waiting for the owner, so propose nothing new this run (leave proposedTasks and proposedAgents empty). If your task cannot continue until the owner decides, set "waitingOnOwner": true and the runner moves on to other work.'
        : `You may propose at most one new task, or one new agent if the work clearly needs a lasting specialist (follow HOW TO CREATE AN AGENT and the branch rules; parentId is your own id for a venture, or an existing venture's id for a skill agent working for it). Give it a clear purpose of two or three sentences; its SKILL.md is written in full in a later run.`)
      : `GROWING THE BRAIN: the owner lets you create agents without asking; they exist as soon as you list them, cost nothing until they are given work, and the owner can delete any. Each venture should have the skill agents it needs to make money (for an Etsy store, for example: product research, listing copy and SEO, design or mockups, pricing, and ads). In proposedAgents, create up to ${agentsPerRun(s)} agents this run that a venture clearly needs and does not have yet; parentId is the venture's id (from AGENTS IN THE BRAIN NOW) for its skill agents, or your own id for a new venture ${s.autoTasks !== false ? '(start a new venture when your research shows real demand)' : '(a new venture needs a business the owner already asked for or approved)'}. Never duplicate an agent that already exists. Give each a clear purpose of two or three sentences; do not write its SKILL.md here, because the runner has you write each one in full in a later run.${canSelfApprove(s) ? ' You may also set one new task in proposedTasks; it is approved at once.' : pendingCount(s) ? ' A task proposal is waiting for the owner, so propose no new task this run.' : ' You may also propose one new task for the owner to approve.'}`,
    'Finish with exactly one JSON object in a ```json block: {"memory": "your updated notes, under 4000 characters, with sources and dates", "nextAction": "...", "proposedTasks": [{"title": "...", "detail": "...", "agentId": "the agent who should do it, or null"}], "proposedAgents": [{"parentId": "...", "name": "...", "specialty": "...", "purpose": "...", "skill": "a team such as Research", "bankSkillIds": ["..."], "everyMinutes": 120, "maxMinutes": 5, "reason": "why this window"}], "waitingOnOwner": false, "skillFile": "only for a SKILL.md task, else null", "steps": [{"text": "...", "done": true}], "taskNotes": "where this task stands", "progress": {"percent": 40, "note": "..."}, "completedTaskIds": ["..."], "skillRequests": null, "stopTaskIds": [], "stopReason": "...", "notifyOwner": "only a result the owner must see, else null", "summary": "one line on what this run did"}',
  ].filter(Boolean).join('\n\n');
}

function parseResult(text) {
  const m = text.match(/```json\s*([\s\S]*?)```/) || text.match(/(\{[\s\S]*\})\s*$/);
  if (!m) return null;
  try { return JSON.parse(m[1]); } catch { return null; }
}

let running = null;

/**
 * The tasks for one run: one per agent, up to PARALLEL agents working side by side.
 * A command-center task (focus) goes first and alone; otherwise the owner's tasks come first, then ones JARVIS set itself, oldest first.
 */
export function pickTasks(s, n = PARALLEL, only = null) {
  const known = (t) => !(s.agents || []).length || !t.agentId || s.agents.some((a) => a.id === t.agentId);
  // a branch's own run: only the tasks of the agents in that branch
  const inBranch = (t) => !only || only.includes(t.agentId || AGENT_ID);
  const ready = (t) => t.status === 'approved' && !isSkillTask(t) && !(t.waitingOnOwner && pendingCount(s)) && known(t) && inBranch(t);
  // the owner's command-center tasks come before everything else, and while one is open nothing else runs
  const focus = s.tasks.filter((t) => ready(t) && t.focus);
  const work = (focus.length ? focus : s.tasks.filter(ready)).map((t, i) => [t, i]).sort((a, b) => (Number(a[0].by === 'origin') - Number(b[0].by === 'origin')) || a[1] - b[1]).map(([t]) => t);
  const seen = new Set(), out = [];
  for (const t of work) {
    const who = t.agentId || AGENT_ID;
    if (seen.has(who)) continue;
    seen.add(who); out.push(t);
    if (out.length >= n) break;
  }
  return out;
}

const CONTINUE = 'Good. Now do the next step of your plan right away, in this same work window, using your tools. Then reply again with the same JSON object, updated: steps (mark what is done), progress, taskNotes, and completedTaskIds if the whole task is finished.';

/** Later rounds of the same task update the result; lists from every round are kept. */
function mergeOut(a, b) {
  if (!a) return b;
  const list = (k) => [...(Array.isArray(a[k]) ? a[k] : []), ...(Array.isArray(b[k]) ? b[k] : [])];
  return { ...a, ...b, proposedTasks: list('proposedTasks'), proposedAgents: list('proposedAgents'), completedTaskIds: list('completedTaskIds'), stopTaskIds: list('stopTaskIds') };
}

/** One agent working one task (or JARVIS planning when there is none): several rounds, tools included. Changes nothing in the state. */
async function work(s, task, ctx) {
  const { deps, deadline, limit, etsy, record } = ctx;
  const agent = task ? taskAgent(s, task) : null;
  const w = { taskId: task?.id ?? null, agentId: task?.agentId || AGENT_ID, agentName: agent?.name ?? 'JARVIS', title: task?.title ?? null, costUsd: 0, costKnown: true, calls: 0, searches: 0, fetches: 0, rounds: 0, status: 'running', publishAsks: 0 };
  const messages = [{ role: 'user', content: briefFor(s, task, deadline, etsy) }];
  // research tools: search to find sources, fetch to read a page in full, plus the owner's connected services
  const tools = task ? [{ type: 'web_search_20250305', name: 'web_search', max_uses: MAX_SEARCHES }, { type: 'web_fetch_20250910', name: 'web_fetch', max_uses: MAX_FETCHES, max_content_tokens: FETCH_TOKENS }, ...(etsy ? etsy.tools : [])] : [];
  let out = null, stopReason = null;
  try {
    while (w.calls < MAX_CALLS * roundsFor(task)) {
      if (Date.now() > deadline.getTime() - 15_000) { w.status = 'window-ended'; break; }
      if (w.costUsd + CALL_WORST_USD > limit) { w.status = w.calls ? 'run-budget-reached' : 'cap-reached'; break; }
      const r = await deps.fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-api-key': deps.key || KEY, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({ model: MODEL, max_tokens: 16000, system: s.instructions, messages, ...(tools.length ? { tools } : {}) }),
        signal: AbortSignal.timeout(Math.max(5_000, deadline.getTime() - Date.now())),
      });
      w.calls++;
      if (!r.ok) { w.status = `upstream-${r.status}`; break; }
      const data = await r.json();
      const c = costOf(MODEL, data.usage || {});
      if (c == null) w.costKnown = false; else w.costUsd += c;
      w.searches += data.usage?.server_tool_use?.web_search_requests || 0;
      w.fetches += data.usage?.server_tool_use?.web_fetch_requests || 0;
      if (data.stop_reason === 'pause_turn') { messages.push({ role: 'assistant', content: data.content }); continue; }
      // the agents' own tools (Etsy, Printify): run each call here and hand back the results
      const calls = (data.content || []).filter((b) => b.type === 'tool_use');
      if (data.stop_reason === 'tool_use' && calls.length && etsy) {
        messages.push({ role: 'assistant', content: data.content });
        const results = [];
        for (const tc of calls) {
          const res = tc.name === 'printify_request_publish' ? await requestPublish(s, task, tc.input, w, etsy)
            : tc.name === IMAGE_TOOL.name ? await makeImage(s, task, tc.input, w, etsy)
            : tc.name === DESIGN_TOOL.name ? saveDesign(s, task, tc.input || {}, w)
            : await etsy.run(tc.name, tc.input);
          // an SVG sent to Printify is kept in the gallery too
          if (tc.name === 'printify_upload_design' && tc.input?.svg && !res.isError) { try { saveDesign(s, task, { file_name: tc.input.file_name, svg: tc.input.svg, imageId: JSON.parse(res.content).image_id }, w); } catch { /* the upload still counts */ } }
          if (tc.name.startsWith('etsy_')) record.etsyCalls = (record.etsyCalls || 0) + 1;
          else if (tc.name.startsWith('printify_')) record.printifyCalls = (record.printifyCalls || 0) + 1;
          else if (tc.name === DESIGN_TOOL.name) record.designs = (record.designs || 0) + 1;
          results.push({ type: 'tool_result', tool_use_id: tc.id, content: res.content, ...(res.isError ? { is_error: true } : {}) });
        }
        messages.push({ role: 'user', content: results });
        continue;
      }
      stopReason = data.stop_reason;
      w.status = data.stop_reason === 'refusal' ? 'refused' : data.stop_reason === 'max_tokens' ? 'cut-off' : 'done';
      w.rounds++;
      const parsed = parseResult((data.content || []).filter((b) => b.type === 'text').map((b) => b.text).join(''));
      if (parsed) out = mergeOut(out, parsed);
      // keep going through the plan while the task is unfinished and there is time and budget
      const pct = Number(parsed?.progress?.percent);
      const finished = !parsed || (parsed.completedTaskIds || []).includes(task?.id) || (parsed.stopTaskIds || []).includes(task?.id) || parsed.waitingOnOwner === true;
      if (task && task.kind !== 'skill-file' && w.status === 'done' && !finished && Number.isFinite(pct) && pct < 100 && w.rounds < roundsFor(task)
        && Date.now() < deadline.getTime() - 90_000 && w.costUsd + CALL_WORST_USD <= limit) {
        messages.push({ role: 'assistant', content: data.content }, { role: 'user', content: CONTINUE });
        continue;
      }
      break;
    }
  } catch (e) {
    w.status = e.name === 'TimeoutError' ? 'window-ended' : 'error';
    console.error(`[origin] ${w.agentName}: ${e.name}: ${e.message}`);
  }
  if (w.status === 'done' && !out) w.status = 'no-result';
  return { task, w, out, stopReason };
}

/** Write one SKILL.md in its own call. */
async function writeSkillFile(s, extra, ctx) {
  const { deps, deadline, record } = ctx;
  const bank = extra.kind === 'bank-skill';
  if (!bank) extra.sharedWith = s.tasks.filter((x) => x !== extra && x.kind === 'skill-file' && x.status === 'approved' && roleOf(x) === roleOf(extra)).map((x) => x.agentName);
  const prompt = [roster(s), bank ? bankSkillBrief(s, extra) : skillFileBrief(s, extra), `Reply with only one JSON object in a \`\`\`json block: {"skillFile": {"name": "${bank ? 'the skill name' : 'a short skill name'}", "description": "one line on when ${bank ? 'an agent' : 'this agent'} uses it", "body": "the full Markdown"}}`].join('\n\n');
  try {
    const r = await deps.fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': deps.key || KEY, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: MODEL, max_tokens: 16000, system: s.instructions, messages: [{ role: 'user', content: prompt }] }),
      signal: AbortSignal.timeout(Math.max(5_000, deadline.getTime() - Date.now())),
    });
    record.calls++;
    if (!r.ok) { console.error(`[origin] SKILL.md call answered ${r.status}`); return 0; }
    const data = await r.json();
    const c = costOf(MODEL, data.usage || {});
    if (c == null) record.costKnown = false;
    const file = cleanSkillFile(parseResult((data.content || []).filter((b) => b.type === 'text').map((b) => b.text).join(''))?.skillFile);
    if (file && bank) { saveBankSkill(s, extra, file, new Date().toISOString()); record.skillFileFor = extra.skillName; logProgress(s, extra, { at: new Date().toISOString(), runId: record.id, pct: 100, note: `JARVIS wrote the "${extra.skillName}" skill for ${extra.agentNames.join(', ')}.` }); }
    else if (file) { saveSkillFile(s, extra, file, new Date().toISOString()); record.skillFileFor = extra.agentName; logProgress(s, extra, { at: new Date().toISOString(), runId: record.id, pct: 100, note: `JARVIS wrote ${extra.agentName}'s SKILL.md.` }); }
    return c ?? 0;
  } catch (e) {
    console.error(`[origin] SKILL.md call: ${e.name}`);
    return 0;
  }
}

/** Apply what one worker reported to the in-memory state. */
function applyOut(s, { task, w, out }, at, record, lead) {
  if (!out) return;
  if (lead) {
    if (typeof out.memory === 'string' && out.memory.trim()) s.memory = out.memory.slice(0, 8000);
    if (typeof out.nextAction === 'string') s.nextAction = out.nextAction.slice(0, 1000);
  }
  // a command-center task is worked, not grown: no new tasks from it, and at most one agent it truly needs
  const t = Array.isArray(out.proposedTasks) && !task?.focus ? out.proposedTasks[0] : null;
  const taken = new Set([...(s.agents || []).map((a) => a.name.toLowerCase()), ...s.agentProposals.filter((a) => a.status !== 'rejected').map((a) => a.name.toLowerCase())]);
  const agents = [...(Array.isArray(out.proposedAgents) ? out.proposedAgents : []), ...(out.proposedAgent && typeof out.proposedAgent === 'object' ? [out.proposedAgent] : [])]
    .filter((a) => a && typeof a === 'object' && a.name && a.parentId)
    .filter((a, i, all) => all.findIndex((b) => String(b.name).toLowerCase() === String(a.name).toLowerCase()) === i)
    .filter((a) => s.autoAgents === false || !taken.has(String(a.name).toLowerCase()))
    .slice(0, task?.focus ? 1 : agentsPerRun(s));
  const wasPending = pendingCount(s);
  const self = canSelfApprove(s);
  if ((self || !wasPending) && t?.title && !s.tasks.some((x) => x.title.toLowerCase() === String(t.title).toLowerCase() && ['approved', 'proposed'].includes(x.status))) {
    s.tasks.push({ id: newId('task'), title: String(t.title).slice(0, 160), detail: String(t.detail || '').slice(0, 1000), status: self ? 'approved' : 'proposed', by: 'origin', createdAt: at, ...(typeof t.agentId === 'string' && (s.agents || []).some((a) => a.id === t.agentId) ? { agentId: t.agentId } : {}) });
    if (self) logProgress(s, null, { at, runId: record.id, note: `JARVIS set itself a task: ${String(t.title).slice(0, 160)}.` });
  }
  if (s.autoAgents !== false || (!wasPending && !t?.title)) {
    for (const a of agents) {
      const num = (v, lo, hi, d) => (Number.isFinite(Number(v)) ? Math.min(hi, Math.max(lo, Math.round(Number(v)))) : d);
      s.agentProposals.push({
        id: newId('agentp'), parentId: String(a.parentId).slice(0, 80), name: String(a.name).slice(0, 60), specialty: String(a.specialty || '').slice(0, 200),
        purpose: String(a.purpose || '').slice(0, 1000), skill: String(a.skill || 'Research').slice(0, 40),
        bankSkillIds: (Array.isArray(a.bankSkillIds) ? a.bankSkillIds : []).map(String).slice(0, 10),
        everyMinutes: num(a.everyMinutes, 15, 10_080, 240), maxMinutes: num(a.maxMinutes, 1, 60, 5), reason: String(a.reason || '').slice(0, 300),
        skillFile: cleanSkillFile(a.skillFile), auto: s.autoAgents !== false, status: 'proposed', createdAt: at,
      });
      logProgress(s, null, { at, runId: record.id, agentId: String(a.parentId).slice(0, 80), note: `${s.autoAgents !== false ? 'Created' : 'Proposed'} a new agent: ${String(a.name).slice(0, 60)}.` });
    }
  }
  // a task that can't go on until the owner decides steps aside instead of holding every run
  if (task && task.kind !== 'skill-file' && (out.waitingOnOwner === true || (pendingCount(s) > wasPending && !(out.completedTaskIds || []).includes(task.id)))) task.waitingOnOwner = true;
  const file = task?.kind === 'skill-file' ? cleanSkillFile(out.skillFile) : null;
  if (file) { saveSkillFile(s, task, file, at); logProgress(s, task, { at, runId: record.id, pct: 100, note: `JARVIS wrote ${task.agentName}'s SKILL.md.` }); }
  // SKILL.md files and bank skills the work needs: written right after this run
  if (out.skillRequests && typeof out.skillRequests === 'object') {
    const q = queueSkills(s, out.skillRequests);
    if (q.files.length || q.bank.length) logProgress(s, task, { at, runId: record.id, note: `Asked for ${[...q.files.map((n) => `${n}'s SKILL.md`), ...q.bank.map((n) => `the "${n}" skill`)].join(', ')}.` });
  }
  // only the task this worker had can be completed or stopped by it
  if (task && Array.isArray(out.completedTaskIds) && out.completedTaskIds.includes(task.id)) task.status = 'done';
  if (task && task.status === 'approved' && Array.isArray(out.stopTaskIds) && out.stopTaskIds.includes(task.id)) {
    stopTask(task, `JARVIS stopped it: ${String(out.stopReason || 'its spend pattern was too high for its value').slice(0, 300)}`, at);
  }
  if (task && task.kind !== 'skill-file') {
    // the plan: ordered steps, checked off as the task moves from start to finish
    if (Array.isArray(out.steps) && out.steps.length) task.steps = out.steps.filter((x) => x && (x.text || typeof x === 'string')).slice(0, 12).map((x) => ({ text: String(x.text ?? x).slice(0, 160), done: x.done === true }));
    if (typeof out.taskNotes === 'string' && out.taskNotes.trim()) task.notes = out.taskNotes.slice(0, 3000);
    const fromSteps = task.steps?.length ? Math.round((task.steps.filter((x) => x.done).length / task.steps.length) * 100) : NaN;
    const pct = task.status === 'done' ? 100 : Number.isFinite(fromSteps) ? fromSteps : Number(out.progress?.percent);
    const note = String(out.progress?.note || out.summary || '').slice(0, 400);
    if (Number.isFinite(pct)) task.progress = Math.max(0, Math.min(100, Math.round(pct)));
    if (note || Number.isFinite(pct)) logProgress(s, task, { at, runId: record.id, pct: task.progress ?? null, note });
  }
  w.summary = String(out.summary || '').slice(0, 300);
  w.notify = out.notifyOwner ? String(out.notifyOwner).slice(0, 500) : null;
}

/** One work window: up to PARALLEL agents each work their own task at the same time. The state file is saved before it returns. */
export async function runOnce(trigger, deps = { fetch: globalThis.fetch, file: FILE }) {
  if (running) return { ok: false, reason: 'A run is already in progress.' };
  const s = loadState(deps.file);
  rollMonth(s);
  if (!KEY && !deps.key) return { ok: false, reason: 'No API key. In the app folder run npm.cmd run set-key once, then restart the runner.' };
  if (!s.instructions) return { ok: false, reason: 'Open the app once with the runner on so it can send JARVIS\'s instructions.' };
  if (remaining(s) < CALL_WORST_USD) {
    return { ok: false, reason: `The $${CAP} monthly cap is reached ($${s.ledger.spentUsd.toFixed(2)} spent). Runs stop until next month or a new approved cap.` };
  }
  const only = Array.isArray(deps.only) && deps.only.length ? deps.only : null;
  let picks = pickTasks(s, deps.parallel ?? PARALLEL, only);
  if (only && !picks.length) return { ok: false, reason: 'That branch has no approved work ready.' };
  // with no work of its own, a SKILL.md request is the task (as before); with none at all, JARVIS plans
  const skillTask = picks.length ? null : nextTask(s);
  if (skillTask?.kind === 'skill-file') skillTask.sharedWith = s.tasks.filter((x) => x !== skillTask && x.kind === 'skill-file' && x.status === 'approved' && roleOf(x) === roleOf(skillTask)).map((x) => x.agentName);
  if (!picks.length) picks = [skillTask];
  const start = new Date(), deadline = new Date(start.getTime() + MAX_MIN * 60_000);
  // a command-center task gets twice the usual spend a run, so it can finish several items in one window
  const focus = picks.some((t) => t?.focus);
  const runLimit = Math.min(RUN_LIMIT_USD * Math.max(1, picks.length) * (focus ? 2 : 1), remaining(s));
  const record = { id: `run_${start.getTime().toString(36)}`, trigger, model: MODEL, startedAt: start.toISOString(), endedAt: null, costUsd: 0, costKnown: true, calls: 0, searches: 0, fetches: 0, status: 'running', summary: '' };
  running = record;
  const etsy = 'etsy' in deps ? deps.etsy : agentTools();
  const ctx = { deps, deadline, limit: runLimit / picks.length, etsy, record };
  let results;
  try {
    results = await Promise.all(picks.map((t) => work(s, t, ctx)));
    // one SKILL.md every run, so the files get written while the agents work their tasks (not while the owner's focus task runs)
    const extra = picks[0]?.kind === 'skill-file' || focus || only ? null : requestedSkills(s)[0] || nextTask({ ...s, tasks: s.tasks.filter((t) => t.kind === 'skill-file') });
    const used = results.reduce((x, r) => x + r.w.costUsd, 0);
    if (extra && Date.now() < deadline.getTime() - 60_000 && used + CALL_WORST_USD <= runLimit) {
      const c = await writeSkillFile(s, extra, ctx);
      record.costUsd += c;
      record.skillCostUsd = c;
    }
  } finally {
    running = null;
  }
  record.endedAt = new Date().toISOString();
  const lead = results.find((r) => !r.task?.agentId) ?? results[0];
  for (const r of results) applyOut(s, r, record.endedAt, record, r === lead);
  // per task: spend, budget watch
  for (const { task, w } of results) {
    if (!task) continue;
    task.spentUsd = round6((task.spentUsd || 0) + w.costUsd);
    task.runCosts = [...(task.runCosts || []), round6(w.costUsd)].slice(-50);
    const why = task.status === 'approved' ? budgetWatch(task) : null;
    if (why) stopTask(task, `Budget watch stopped it: ${why}`, record.endedAt);
    if (task.status === 'stopped') w.notify = `Stopped "${task.title}". ${task.stopReason}`;
  }
  const ws = results.map((r) => r.w);
  record.workers = ws.map(({ taskId, agentId, agentName, title, costUsd, status, rounds, summary }) => ({ taskId, agentId, agentName, title, costUsd: round6(costUsd), status, rounds, summary }));
  record.costUsd = round6(record.costUsd + ws.reduce((x, w) => x + w.costUsd, 0));
  record.costKnown = record.costKnown && ws.every((w) => w.costKnown);
  record.calls += ws.reduce((x, w) => x + w.calls, 0);
  record.searches = ws.reduce((x, w) => x + w.searches, 0);
  record.fetches = ws.reduce((x, w) => x + w.fetches, 0);
  record.status = ws.length === 1 ? ws[0].status : ws.some((w) => w.status === 'done') ? 'done' : ws[0].status;
  record.summary = ws.length === 1 ? (ws[0].summary || '') : ws.filter((w) => w.summary).map((w) => `${w.agentName}: ${w.summary}`).join(' · ').slice(0, 600);
  const publishAsks = ws.reduce((x, w) => x + (w.publishAsks || 0), 0);
  record.images = ws.reduce((x, w) => x + (w.images || 0), 0);
  record.imageUsd = round6(ws.reduce((x, w) => x + (w.imageUsd || 0), 0));
  const notes = [...ws.map((w) => w.notify).filter(Boolean), ...(publishAsks ? [`${publishAsks} product${publishAsks === 1 ? '' : 's'} ready for you to publish in JARVIS runs.`] : [])];
  record.notify = notes.length ? notes.join(' ').slice(0, 800) : null;
  record.agentId = ws[0].agentId;
  record.taskId = ws[0].taskId;
  // The owner (and console questions) may have changed the state while the run worked:
  // merge this run's results into the current file instead of overwriting it.
  const now = loadState(deps.file);
  rollMonth(now);
  now.memory = s.memory; now.nextAction = s.nextAction;
  const worked = new Set(results.map((r) => r.task?.id).filter(Boolean));
  for (const t of s.tasks) {
    const cur = now.tasks.find((x) => x.id === t.id);
    if (!cur) now.tasks.push(t);
    else if (worked.has(t.id)) {
      Object.assign(cur, { spentUsd: t.spentUsd, runCosts: t.runCosts, ...(t.progress != null ? { progress: t.progress } : {}), ...(t.steps ? { steps: t.steps } : {}), ...(t.notes ? { notes: t.notes } : {}) });
      if (cur.status === 'approved' && t.status === 'done') cur.status = 'done';
      if (cur.status === 'approved' && t.status !== 'approved') Object.assign(cur, { status: t.status, stopReason: t.stopReason, stoppedAt: t.stoppedAt });
      if (t.waitingOnOwner) cur.waitingOnOwner = true;
    } else if (isSkillTask(t) && t.status === 'done' && cur.status === 'approved') cur.status = 'done'; // written this run (or shared)
    else if (isSkillTask(t) && t.requested && cur.status === 'approved') Object.assign(cur, { requested: true, ...(t.agentIds ? { agentIds: t.agentIds, agentNames: t.agentNames } : {}) }); // asked for again this run
  }
  for (const a of s.agentProposals) if (!now.agentProposals.some((x) => x.id === a.id)) now.agentProposals.push(a);
  for (const f of s.skillFiles) if (!now.skillFiles.some((x) => x.id === f.id)) now.skillFiles.push(f);
  for (const r of s.publishRequests || []) if (!(now.publishRequests || []).some((x) => x.id === r.id)) now.publishRequests = [...(now.publishRequests || []), r].slice(-100);
  for (const e of s.progressLog || []) if (!(now.progressLog || []).some((x) => x.id === e.id)) now.progressLog = [...(now.progressLog || []), e].slice(-PROGRESS_KEEP);
  for (const d of s.designs || []) if (!(now.designs || []).some((x) => x.id === d.id)) now.designs = [...(now.designs || []), d].slice(-DESIGNS_KEEP);
  // images made this run: their log lines and their cost on the image cap (never on the Anthropic ledger)
  ensureTotals(now);
  for (const e of s.imageLog || []) {
    if ((now.imageLog || []).some((x) => x.id === e.id)) continue;
    now.totals.images[e.agentId] = round6((now.totals.images[e.agentId] || 0) + e.usd);
    now.imageLog = [...(now.imageLog || []), e].slice(-IMAGE_LOG_KEEP);
    if (e.at.slice(0, 7) === month()) { const m = rollImages(now); m.spentUsd = round6(m.spentUsd + e.usd); }
  }
  // spend goes to the agent each worker was; SKILL.md writing is JARVIS's
  for (const w of ws) charge(now, w.agentId, w.costUsd);
  if (record.skillCostUsd) charge(now, AGENT_ID, record.skillCostUsd);
  if (!record.costKnown) now.ledger.unknownCostRuns++;
  now.runs = [record, ...now.runs].slice(0, 50);
  if (trigger === 'schedule' || trigger === 'focus') now.lastScheduledAt = record.startedAt;
  saveState(now, deps.file);
  return { ok: true, run: record };
}

/**
 * A run that only writes skills: the SKILL.md files and bank skills the owner asked for (then any
 * other waiting SKILL.md), up to PARALLEL at a time, within the window and the cap. It starts right
 * after the request, so the files reach the app in minutes instead of one per run.
 */
export async function runSkills(trigger = 'skills', deps = { fetch: globalThis.fetch, file: FILE }) {
  if (running) return { ok: false, reason: 'A run is already in progress.' };
  const s = loadState(deps.file);
  rollMonth(s);
  if (!KEY && !deps.key) return { ok: false, reason: 'No API key.' };
  if (!s.instructions) return { ok: false, reason: 'Open the app once with the runner on so it can send JARVIS\'s instructions.' };
  if (remaining(s) < CALL_WORST_USD) return { ok: false, reason: `The $${CAP} monthly cap is reached.` };
  const known = (t) => t.kind === 'bank-skill' || !(s.agents || []).length || s.agents.some((a) => a.id === t.agentId);
  const queue = [...requestedSkills(s), ...s.tasks.filter((t) => t.kind === 'skill-file' && t.status === 'approved' && !t.requested)].filter(known);
  if (!queue.length) return { ok: false, reason: 'No skills waiting to be written.' };
  const start = new Date(), deadline = new Date(start.getTime() + MAX_MIN * 60_000);
  const limit = Math.min(RUN_LIMIT_USD * PARALLEL, remaining(s));
  const record = { id: `run_${start.getTime().toString(36)}`, trigger, model: MODEL, startedAt: start.toISOString(), endedAt: null, costUsd: 0, costKnown: true, calls: 0, searches: 0, fetches: 0, status: 'running', summary: '', skillsWritten: [] };
  running = record;
  const ctx = { deps, deadline, record };
  try {
    // a few writers at once, each taking the next file until the window, the budget or the queue runs out
    const writer = async () => {
      for (;;) {
        const t = queue.find((x) => x.status === 'approved' && !x.taking);
        if (!t || Date.now() > deadline.getTime() - 60_000 || record.costUsd + CALL_WORST_USD > limit) return;
        t.taking = true;
        record.costUsd = round6(record.costUsd + await writeSkillFile(s, t, ctx));
        delete t.taking;
        if (t.status === 'done') record.skillsWritten.push(t.kind === 'bank-skill' ? t.skillName : `${t.agentName}'s SKILL.md`);
        else if (t.status === 'approved') {
          // two failed tries: it goes back to the normal pace (one SKILL.md a run) instead of holding this run
          t.tries = (t.tries || 0) + 1;
          if (t.tries >= 2) t.requested = false;
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(PARALLEL, queue.length) }, writer));
  } finally {
    running = null;
  }
  record.endedAt = new Date().toISOString();
  const left = queue.filter((t) => t.status === 'approved').length;
  record.status = record.skillsWritten.length ? 'done' : 'no-result';
  record.summary = `Wrote ${record.skillsWritten.length ? record.skillsWritten.join(', ') : 'nothing'}${left ? `; ${left} still to write` : ''}.`;
  record.notify = record.skillsWritten.length ? `${record.skillsWritten.length} skill file${record.skillsWritten.length === 1 ? '' : 's'} written and added to your agents.` : null;
  const now = loadState(deps.file);
  rollMonth(now);
  for (const t of s.tasks) {
    const cur = now.tasks.find((x) => x.id === t.id);
    if (!cur) now.tasks.push(t);
    else if (isSkillTask(t) && cur.status === 'approved') Object.assign(cur, { status: t.status, requested: t.requested, ...(t.tries ? { tries: t.tries } : {}) });
  }
  for (const f of s.skillFiles) if (!now.skillFiles.some((x) => x.id === f.id)) now.skillFiles.push(f);
  for (const e of s.progressLog || []) if (!(now.progressLog || []).some((x) => x.id === e.id)) now.progressLog = [...(now.progressLog || []), e].slice(-PROGRESS_KEEP);
  charge(now, AGENT_ID, record.costUsd);
  if (!record.costKnown) now.ledger.unknownCostRuns++;
  record.workers = [{ taskId: null, agentId: AGENT_ID, agentName: 'JARVIS', title: 'Skills', costUsd: record.costUsd, status: record.status, rounds: record.skillsWritten.length, summary: record.summary }];
  now.runs = [record, ...now.runs].slice(0, 50);
  saveState(now, deps.file);
  return { ok: true, run: record };
}

/** Most one console answer may cost: a short reply with JARVIS's prompt, no tools. */
const ASK_WORST_USD = 0.05;

/** The APPROVE line JARVIS adds when the owner's words in the console approve work. */
/** One action line JARVIS ends a console answer with: `WORD {json}` on its own line. */
function actionLine(text, word) {
  const line = String(text || '').split('\n').find((l) => l.trim().startsWith(`${word} {`) || l.trim().startsWith(`${word}{`));
  if (!line) return null;
  try { const o = JSON.parse(line.trim().slice(word.length).trim()); return o && typeof o === 'object' ? o : null; } catch { return null; }
}
/** The SKILLS line: SKILL.md files and bank skills the owner asked for. */
export const parseSkills = (text) => actionLine(text, 'SKILLS');

export function parseConsent(text) {
  const one = actionLine(text, 'APPROVE');
  if (one) return one;
  const m = String(text || '').match(/^\s*APPROVE\s*(\{.*\})\s*$/ms);
  if (!m) return null;
  try { const o = JSON.parse(m[1]); return o && typeof o === 'object' ? o : null; } catch { return null; }
}

/** Turn the owner's consent into approved work: waiting proposals they named, and the task they asked for. */
export function applyConsent(s, c) {
  const done = [];
  for (const id of Array.isArray(c.approveIds) ? c.approveIds : []) {
    const t = s.tasks.find((x) => x.id === id && x.status === 'proposed');
    if (t) { t.status = 'approved'; done.push(t.title); }
  }
  if (done.length) for (const x of s.tasks) delete x.waitingOnOwner;
  // the owner's own words in the command center: it becomes the focus, ahead of everything else
  const task = typeof c.title === 'string' ? addFocusTask(s, { title: c.title, detail: c.detail, agentId: c.agentId, budgetUsd: c.budgetUsd, count: c.count }) : null;
  if (task) done.push(task.title);
  return done.length ? done : null;
}

/**
 * The owner's question from the console, answered by JARVIS right away, any time,
 * without approval. It costs one model call against the same monthly cap, uses no
 * tools and changes nothing but the ledger and the question log.
 */
/** An agent the owner named in the question ("ask the etsy store…"); the longest matching name wins. */
export function namedAgent(s, q) {
  const text = q.toLowerCase();
  return (s.agents || []).filter((a) => a.name && a.name.length > 2 && text.includes(a.name.toLowerCase())).sort((a, b) => b.name.length - a.name.length)[0] || null;
}

/** Which agent should answer: one the owner named, else a tiny model call picks the best suited (JARVIS when none fits). */
async function routeQuestion(s, q, deps) {
  const all = s.agents || [];
  if (!all.length) return { agent: null, cost: 0 };
  const named = namedAgent(s, q);
  if (named) return { agent: named, cost: 0 };
  try {
    const r = await deps.fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': deps.key || KEY, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: MODEL, max_tokens: 400, output_config: { effort: 'low' }, system: 'You route the owner\'s question to the one agent best suited to answer it. Reply with only that agent\'s id, or "origin" for general questions, approvals, budget, or anything about the whole brain.', messages: [{ role: 'user', content: `Agents:\n${all.map((a) => `${a.id}: ${a.name}, ${a.title || 'agent'}`).join('\n')}\n\nQuestion: ${q}` }] }),
      signal: AbortSignal.timeout(20_000),
    });
    if (!r.ok) return { agent: null, cost: 0 };
    const data = await r.json();
    const text = (data.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('');
    return { agent: all.find((a) => text.includes(a.id)) || null, cost: costOf(MODEL, data.usage || {}) ?? 0 };
  } catch { return { agent: null, cost: 0 }; }
}

export async function ask(question, deps = { fetch: globalThis.fetch, file: FILE }) {
  const q = String(question || '').trim().slice(0, 2000);
  if (!q) return { ok: false, reason: 'Type a question.' };
  if (!KEY && !deps.key) return { ok: false, reason: 'No API key. In the app folder run npm.cmd run set-key once, then restart the runner.' };
  const s = loadState(deps.file);
  rollMonth(s);
  if (!s.instructions) return { ok: false, reason: 'Open the app once with the runner on so it can send JARVIS\'s instructions.' };
  if (remaining(s) < ASK_WORST_USD) return { ok: false, reason: `The $${CAP} monthly cap is reached, so JARVIS can't answer until next month.` };
  const { agent, cost: routeCost } = await routeQuestion(s, q, deps);
  const task = agent ? s.tasks.find((t) => t.status === 'approved' && t.agentId === agent.id && t.kind !== 'skill-file') || null : nextTask(s);
  const progress = (s.progressLog || []).filter((e) => !agent || e.agentId === agent.id).slice(-8);
  const recent = (s.asks || []).filter((a) => (a.agentId || null) === (agent?.id || null)).slice(0, 4).reverse().flatMap((a) => [{ role: 'user', content: a.q }, { role: 'assistant', content: a.a }]);
  const context = [
    agent
      ? `You are ${agent.name}${agent.title ? `, ${agent.title}` : ''}, an agent in the owner's brain working under JARVIS. The owner asked you this in the console because you are the agent best suited to it. Answer as ${agent.name}, from your own job and work, directly and briefly; you have no tools here and this is not a work run.`
      : 'The owner is asking you a question in the console, outside your work window. Answer directly and briefly from what you know; you have no tools here and this does not count as a run. Do not propose tasks or agents here.',
    `Recent progress${agent ? ` on your work` : ''}:\n${progress.map((e) => `- ${e.at.slice(0, 16)} ${e.agentName}${e.taskTitle ? ` on "${e.taskTitle}"` : ''}${e.pct != null ? ` (${e.pct}%)` : ''}: ${e.note}`).join('\n') || '(none yet)'}`,
    `OWNER CONSENT: the owner's plain words are approval, inside the $${CAP} monthly cap and the per-task budget. "allow etsy store to run", "go ahead", "yes do it", "1 dollar approval" all count; never ask them to repeat it in exact wording or to restate a scope. A request to do something ("make 5 items for my etsy store", "find me 3 trending niches") is approval of that work too. When their message approves or asks for work, say in one sentence what you will do, then end your answer with one line exactly like this: APPROVE {"title": "short task title", "detail": "what to do and what a good result looks like, in the owner's words", "agentId": "id from AGENTS IN THE BRAIN NOW of the agent who should do it, or null for you", "count": how many items they asked for or null, "budgetUsd": the dollar amount they named or null, "approveIds": ["ids of waiting proposals they approved"]}. It becomes your focus: worked first, right away, before anything else. Write that line only when they approved or asked for work. Ventures create the skill agents they need without asking; that never needs approval.`,
    `WHAT YOUR AGENTS CAN DO IN THEIR WORK RUNS (not here): web search and reading pages; make real artwork as SVG (lettering, logos, badges, vector art) saved to the owner's design gallery${openaiPublic().configured ? "; illustrated or photo-style art with the owner's ChatGPT image model" : ''}${printifyPublic().configured ? `; turn designs into products in the owner's Printify shop "${printifyPublic().shopTitle || 'shop'}" (shirts, mugs, posters and more) that the owner approves one by one before they go live` : ''}. So when the owner asks for designs, products or any other work, never say you or an agent can't, and never refuse because it is outside an agent's usual scope: approve it as a task with the APPROVE line (it becomes the focus and starts right away), give it to the best agent, and say what they will get and where. If what they asked for is unclear (for example a brand or name you don't know), still approve it, put what you know in detail, and ask one short question in your answer.`,
    `SKILLS: you can write skills yourself; never tell the owner you can't, and never ask them for agent ids (the runner finds agents by name). A SKILL.md is an agent's own detailed playbook; a bank skill is a shared skill in the owner's skill bank given to the agents that need it. When the owner asks for SKILL.md files or skills (or names skills an agent is missing), say in one sentence what you will write, then end your answer with one line exactly like this: SKILLS {"files": ["agent names, a venture name + \" team\" for its whole team, or \"all\""], "bank": [{"name": "Web research", "description": "one line on what it covers", "agents": ["agent names, \"<venture> team\", or \"all\""]}]}. Writing starts right away and each file is saved to the bank and attached to its agents automatically. You may write both an APPROVE line and a SKILLS line.`,
    'Old runs that failed with a 401 or "no API key" were before the owner set their key. The key works now (this answer proves it), so never say it is broken.',
    `Your current task: ${task ? `${task.title}: ${task.detail}${task.progress != null ? ` (${task.progress}% done)` : ''} (cost so far $${(task.spentUsd || 0).toFixed(3)} over ${(task.runCosts || []).length} runs)` : 'none approved yet'}.`,
    `Queued after it: ${s.tasks.filter((t) => t.status === 'approved' && t !== task).map((t) => t.title).join('; ') || 'nothing'}.`,
    `Waiting for the owner's approval: ${s.tasks.filter((t) => t.status === 'proposed').map((t) => `[${t.id}] ${t.title}`).join('; ') || 'nothing'}.`,
    roster(s),
    `Your notes (check them against the list above):\n${s.memory || '(none yet)'}`,
    `Next action you recorded: ${s.nextAction || '(none)'}`,
    `Last run: ${s.runs[0] ? `${s.runs[0].startedAt}, ${s.runs[0].status}: ${s.runs[0].summary}` : 'none yet'}.`,
    `Spent this month: $${s.ledger.spentUsd.toFixed(2)} of $${CAP}.`,
  ].join('\n\n');
  let data;
  try {
    const r = await deps.fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': deps.key || KEY, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: MODEL, max_tokens: 1500, system: `${agent?.prompt || s.instructions}\n\n${context}`, messages: [...recent, { role: 'user', content: q }] }),
      signal: AbortSignal.timeout(60_000),
    });
    if (!r.ok) return { ok: false, reason: `The model service answered ${r.status}.` };
    data = await r.json();
  } catch (e) {
    return { ok: false, reason: e.name === 'TimeoutError' ? 'JARVIS took too long to answer.' : 'Could not reach the model service.' };
  }
  const raw = (data.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('').trim();
  const consent = parseConsent(raw);
  const skillsAsk = parseSkills(raw);
  const answer = raw.split('\n').filter((l) => !/^\s*(APPROVE|SKILLS)\s*\{/.test(l)).join('\n').replace(/^\s*APPROVE\s*\{.*$/ms, '').trim() || (consent ? 'Approved. I will start on it in my next run.' : skillsAsk ? 'On it: writing those skills now.' : '(no answer)');
  const answerCost = costOf(MODEL, data.usage || {});
  const cost = answerCost == null ? null : answerCost + routeCost;
  // no await between this load and save, so a run in progress can't lose it
  const now = loadState(deps.file);
  rollMonth(now);
  if (cost == null) now.ledger.unknownCostRuns++;
  else charge(now, agent?.id ?? AGENT_ID, cost);
  const approved = consent ? applyConsent(now, consent) : null;
  const skills = skillsAsk ? queueSkills(now, skillsAsk) : null;
  now.asks = [{ at: new Date().toISOString(), q, a: answer.slice(0, 4000), costUsd: cost, approved, skills, agentId: agent?.id ?? null, by: agent?.name ?? 'JARVIS' }, ...(now.asks || [])].slice(0, 20);
  saveState(now, deps.file);
  return { ok: true, answer, costUsd: cost, taskTitle: task?.title ?? null, approved, skills, by: agent?.name ?? 'JARVIS' };
}

function publicState() {
  const s = loadState(); rollMonth(s);
  return {
    configured: Boolean(KEY), model: MODEL, capUsd: CAP, everyMinutes: EVERY_MIN, maxMinutes: MAX_MIN, schedule: SCHEDULE,
    spentUsd: s.ledger.spentUsd, spentByAgent: s.ledger.byAgent, ...dailyAllowance(s), parallel: PARALLEL, rounds: MAX_ROUNDS, taskBudgetUsd: TASK_BUDGET_USD, unknownCostRuns: s.ledger.unknownCostRuns, month: s.ledger.month, running: running ? running.startedAt : null,
    synced: Boolean(s.instructions), asks: (s.asks || []).slice(0, 10), memory: s.memory, nextAction: s.nextAction, tasks: s.tasks, agentProposals: s.agentProposals, progressLog: (s.progressLog || []).slice(-150), autoAgents: s.autoAgents !== false, autoTasks: s.autoTasks !== false, etsy: etsyPublic(), printify: printifyPublic(), openai: openaiPublic(), designs: (s.designs || []).slice(-40).reverse(), voice: voicePublic(DIR), money: { byAgent: moneyByAgent({ ...s, totals: s.totals ?? { claude: { ...s.ledger.byAgent }, images: {} } }), entries: (s.moneyEntries || []).slice(-50).reverse(), sales: (s.sales || []).slice(0, 50), salesSync: s.salesSync ?? null }, images: { month: rollImages(s).month, spentUsd: s.images.spentUsd, capUsd: imageCap(s), log: (s.imageLog || []).slice(-30).reverse() }, publishRequests: (s.publishRequests || []).slice(-30), skillFiles: s.skillFiles.filter((f) => f.status === 'new'), runs: s.runs.slice(0, 10),
    // with no scheduled run yet, the next one starts within a minute
    nextScheduledAt: SCHEDULE ? new Date(s.lastScheduledAt ? Math.max(Date.now(), Date.parse(s.lastScheduledAt) + (pickTasks(s).some((t) => t.focus) ? Math.min(FOCUS_EVERY_MIN, EVERY_MIN) : EVERY_MIN) * 60_000) : Date.now() + 60_000).toISOString() : null,
    focusEveryMinutes: Math.min(FOCUS_EVERY_MIN, EVERY_MIN),
  };
}

const ETSY_REDIRECT = `http://localhost:${PORT}/api/origin/etsy/callback`;
function page(res, status, text) {
  res.writeHead(status, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
  res.end(`<!doctype html><meta charset="utf-8"><title>The Brain · Etsy</title><body style="font:16px system-ui;padding:40px;background:#0b1220;color:#e9f1fc"><p>${text.replace(/[<>&]/g, '')}</p>`);
}

function send(req, res, status, body) {
  const origin = req.headers.origin;
  const allow = origin && /^(app:\/\/campus|https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?)$/.test(origin) ? origin : '';
  res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store', ...(allow ? { 'access-control-allow-origin': allow, 'access-control-allow-headers': 'content-type', 'access-control-allow-methods': 'GET, POST' } : {}) });
  res.end(JSON.stringify(body));
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', (c) => { size += c.length; if (size > MAX_BODY) { reject(new Error('too large')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')); } catch (e) { reject(e); } });
    req.on('error', reject);
  });
}

async function handle(req, res) {
  if (req.method === 'OPTIONS') return send(req, res, 204, {});
  const url = req.url.split('?')[0];
  if (req.method === 'GET' && url === '/api/origin/status') return send(req, res, 200, publicState());
  // the owner connects their Etsy shop in their browser; the tokens stay in the runner
  if (req.method === 'GET' && url === '/api/origin/etsy/connect') {
    const to = authUrl(ETSY_REDIRECT);
    if (!to) return page(res, 400, 'Etsy is not set up yet. In the app folder run npm.cmd run set-etsy first.');
    res.writeHead(302, { location: to, 'cache-control': 'no-store' }); return res.end();
  }
  if (req.method === 'GET' && url === '/api/origin/etsy/callback') {
    const q = new URL(req.url, 'http://127.0.0.1').searchParams;
    if (q.get('error')) return page(res, 400, 'Etsy sign-in was cancelled. Nothing changed.');
    try { const name = await finishAuth(String(q.get('code') || ''), String(q.get('state') || '')); return page(res, 200, `Connected${name ? ` to ${name}` : ''}. JARVIS's agents can now read your shop (read-only). You can close this tab.`); }
    catch (e) { return page(res, 400, e.message); }
  }
  if (req.method === 'GET' && url === '/api/origin/design') {
    // one design from the gallery, as an image for the app (SVG shown through an <img>, so its scripts never run)
    const id = new URL(req.url, 'http://127.0.0.1').searchParams.get('id');
    const d = (loadState().designs || []).find((x) => x.id === id);
    if (!d || !/^design_[\w]+$/.test(d.id)) return send(req, res, 404, { error: 'no design' });
    let bytes;
    try { bytes = fs.readFileSync(path.join(designDir(), `${d.id}.${d.kind}`)); } catch { return send(req, res, 404, { error: 'file missing' }); }
    const origin = req.headers.origin;
    const allow = origin && /^(app:\/\/campus|https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?)$/.test(origin) ? origin : '';
    res.writeHead(200, { 'content-type': d.kind === 'png' ? 'image/png' : 'image/svg+xml', 'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; img-src data:", 'x-content-type-options': 'nosniff', 'cache-control': 'max-age=86400', ...(allow ? { 'access-control-allow-origin': allow } : {}) });
    return res.end(bytes);
  }
  if (req.method === 'GET' && url === '/api/origin/printify/image') {
    // a product's mockup for the owner's approval list, passed through so the app never loads outside images itself
    const id = new URL(req.url, 'http://127.0.0.1').searchParams.get('id');
    const r = (loadState().publishRequests || []).find((x) => x.id === id);
    let src;
    try { src = r?.image ? new URL(r.image) : null; } catch { src = null; }
    if (!src || src.protocol !== 'https:' || !/(^|\.)printify\.(com|me)$/.test(src.hostname)) return send(req, res, 404, { error: 'no image' });
    try {
      const img = await fetch(src, { signal: AbortSignal.timeout(20_000) });
      const type = img.headers.get('content-type') || '';
      if (!img.ok || !type.startsWith('image/')) return send(req, res, 502, { error: 'image unavailable' });
      const bytes = Buffer.from(await img.arrayBuffer());
      const origin = req.headers.origin;
      const allow = origin && /^(app:\/\/campus|https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?)$/.test(origin) ? origin : '';
      res.writeHead(200, { 'content-type': type, 'cache-control': 'max-age=3600', 'x-content-type-options': 'nosniff', ...(allow ? { 'access-control-allow-origin': allow } : {}) });
      return res.end(bytes);
    } catch { return send(req, res, 502, { error: 'image unavailable' }); }
  }
  if (req.method !== 'POST') return send(req, res, 404, { error: 'not found' });
  let body;
  try { body = await readBody(req); } catch { return send(req, res, 400, { error: 'invalid request body' }); }
  if (url.startsWith('/api/origin/voice/')) { const [code, out] = await voiceRoute(url, body, DIR); return send(req, res, code, out); }
  if (url === '/api/origin/sync') {
    if (typeof body.instructions !== 'string' || body.instructions.length < 100 || body.instructions.length > MAX_INSTRUCTIONS) return send(req, res, 400, { error: 'instructions required' });
    const s = loadState(); s.instructions = body.instructions;
    // the other agents' instructions and SKILL.md, so JARVIS can work a task as one of them
    if (Array.isArray(body.agents)) {
      s.agents = body.agents.filter((a) => a && typeof a.id === 'string' && typeof a.name === 'string').slice(0, 100)
        .map((a) => ({ id: a.id.slice(0, 80), name: a.name.slice(0, 80), title: String(a.title || '').slice(0, 120), kind: String(a.kind || 'core'), ventureId: a.ventureId ? String(a.ventureId).slice(0, 80) : null, hasSkillFile: !!a.hasSkillFile, prompt: String(a.prompt || '').slice(0, 40_000) }));
      pruneGone(s, new Date().toISOString());
    }
    saveState(s);
    return send(req, res, 200, { ok: true });
  }
  if (url === '/api/origin/run') {
    // a branch's Run button: that branch's agents work their own tasks for one window
    const ids = Array.isArray(body.agentIds) ? body.agentIds.filter((x) => typeof x === 'string').slice(0, 100) : null;
    if (ids?.length) {
      const s = loadState();
      const lead = typeof body.agentId === 'string' ? body.agentId : ids[0];
      const a = (s.agents || []).find((x) => x.id === lead);
      // pressing Run approves a next step for a branch with nothing to do
      if (a && !pickTasks(s, PARALLEL, ids).length) {
        s.tasks.push({ id: newId('task'), title: `${a.name}: next step`, detail: `Work as ${a.name}. Take the next concrete step toward its goal (${a.title || 'its job'}): pick the most valuable piece of real work its SKILL.md calls for, do it, and report what you found or made, with sources.`, status: 'approved', by: 'owner', via: 'run-button', agentId: a.id, createdAt: new Date().toISOString() });
        saveState(s);
      }
    }
    const r = await runOnce('manual', { fetch: globalThis.fetch, file: FILE, ...(ids?.length ? { only: ids } : {}) });
    return send(req, res, r.ok ? 200 : 409, r);
  }
  if (url === '/api/origin/tasks') {
    const s = loadState();
    if (body.action === 'add' && typeof body.title === 'string' && body.title.trim()) {
      // the owner adding a task is approving it
      const task = { id: newId('task'), title: body.title.trim().slice(0, 160), detail: String(body.detail || '').slice(0, 4000), status: 'approved', by: 'owner', createdAt: new Date().toISOString() };
      // a SKILL.md request for one agent; only one open request per agent
      if (body.kind === 'skill-file' && typeof body.agentId === 'string') {
        if (s.tasks.some((t) => t.kind === 'skill-file' && t.agentId === body.agentId && t.status === 'approved')) return send(req, res, 200, { ok: true, tasks: s.tasks });
        Object.assign(task, { kind: 'skill-file', agentId: body.agentId.slice(0, 80), agentName: String(body.agentName || body.agentId).slice(0, 80), version: Number(body.version) || 1, ...(body.requested === true ? { requested: true } : {}) });
      } else if (typeof body.agentId === 'string') task.agentId = body.agentId.slice(0, 80);
      s.tasks.push(task);
    } else {
      const t = s.tasks.find((x) => x.id === body.id);
      const next = { approve: 'approved', reject: 'rejected', done: 'done', stop: 'stopped' }[body.action];
      if (!t || !next) return send(req, res, 400, { error: 'unknown task or action' });
      // approving a stopped task restarts it with a fresh budget on top of what it already spent
      if (next === 'approved' && t.status === 'stopped') { t.budgetUsd = (t.spentUsd || 0) + TASK_BUDGET_USD; t.runCosts = []; delete t.stopReason; }
      if (next === 'stopped') t.stopReason = 'You stopped it.';
      t.status = next;
      if (t.by === 'origin') for (const x of s.tasks) delete x.waitingOnOwner; // a proposal decided
    }
    saveState(s);
    return send(req, res, 200, { ok: true, tasks: s.tasks });
  }
  if (url === '/api/origin/ask') {
    const r = await ask(body.question);
    // the owner's words approved work: start on it now instead of at the next scheduled run
    if (r.ok && (r.skills?.files.length || r.skills?.bank.length)) r.skillsStarted = startSkills();
    else if (r.ok && r.approved?.length) r.started = startFocus();
    return send(req, res, r.ok ? 200 : 409, r);
  }
  if (url === '/api/origin/focus') {
    // a task typed in the command center: approved by the owner's own words, and JARVIS's focus from now on
    const s = loadState();
    const task = addFocusTask(s, { title: body.title ?? body.text, detail: body.detail ?? body.text, agentId: body.agentId, count: body.count });
    if (!task) return send(req, res, 400, { ok: false, reason: 'Type the task.' });
    saveState(s);
    return send(req, res, 200, { ok: true, task, started: startFocus() });
  }
  if (url === '/api/origin/printify/publish') {
    // the owner's decision on one product an agent made; Publish sends it live to their store
    const s = loadState();
    const r = (s.publishRequests || []).find((x) => x.id === body.id && x.status === 'waiting');
    if (!r) return send(req, res, 404, { error: 'not waiting' });
    if (body.action === 'reject') { r.status = 'rejected'; saveState(s); return send(req, res, 200, { ok: true }); }
    if (body.action !== 'publish') return send(req, res, 400, { error: 'unknown action' });
    try {
      await publishProduct(r.shopId ?? printifyConfig()?.shopId, r.productId);
      const now = loadState();
      const cur = (now.publishRequests || []).find((x) => x.id === r.id);
      if (cur) Object.assign(cur, { status: 'published', publishedAt: new Date().toISOString() });
      logProgress(now, now.tasks.find((t) => t.id === r.taskId) ?? null, { at: new Date().toISOString(), agentId: r.agentId, note: `The owner published "${r.title}" to their store.` });
      saveState(now);
      return send(req, res, 200, { ok: true });
    } catch (e) { return send(req, res, 502, { ok: false, reason: e.message }); }
  }
  if (url === '/api/origin/money') {
    // the owner's own money lines for a branch (income the shop data doesn't show, or other costs), and a fresh sales pull
    if (body.action === 'sync') { const r = await syncSales(); return send(req, res, r.ok ? 200 : 502, r); }
    const s = loadState();
    if (body.action === 'add') {
      const usd = Number(body.usd);
      if (!(usd > 0) || usd > 1_000_000 || !['income', 'expense'].includes(body.kind)) return send(req, res, 400, { error: 'amount and kind needed' });
      s.moneyEntries = [...(s.moneyEntries || []), { id: newId('money'), agentId: typeof body.agentId === 'string' ? body.agentId.slice(0, 80) : AGENT_ID, kind: body.kind, usd: Math.round(usd * 100) / 100, note: String(body.note || '').slice(0, 200), at: new Date().toISOString() }].slice(-500);
    } else if (body.action === 'remove') {
      s.moneyEntries = (s.moneyEntries || []).filter((m) => m.id !== body.id);
    } else return send(req, res, 400, { error: 'unknown action' });
    saveState(s);
    return send(req, res, 200, { ok: true });
  }
  if (url === '/api/origin/settings') {
    // whether JARVIS and its ventures create agents without asking (the owner's choice)
    const s = loadState();
    if (typeof body.autoAgents === 'boolean') s.autoAgents = body.autoAgents;
    if (typeof body.autoTasks === 'boolean') s.autoTasks = body.autoTasks;
    // the owner's monthly limit on design images (billed to their OpenAI account)
    if (Number.isFinite(body.imageCapUsd) && body.imageCapUsd >= 0) s.imageCapUsd = Math.min(100, Math.round(body.imageCapUsd * 100) / 100);
    saveState(s);
    return send(req, res, 200, { ok: true, autoAgents: s.autoAgents, autoTasks: s.autoTasks !== false, imageCapUsd: imageCap(s) });
  }
  if (url === '/api/origin/skillfiles') {
    // the app saved the file to the skill bank and gave it to the agent
    const s = loadState();
    const f = s.skillFiles.find((x) => x.id === body.id);
    if (!f || body.action !== 'imported') return send(req, res, 400, { error: 'unknown skill file or action' });
    f.status = 'imported';
    saveState(s);
    return send(req, res, 200, { ok: true });
  }
  if (url === '/api/origin/agents') {
    // the app creates the agent on approval (it owns the brain); this records the owner's decision
    const s = loadState();
    const p = s.agentProposals.find((x) => x.id === body.id);
    const next = { approve: 'approved', reject: 'rejected' }[body.action];
    if (!p || !next || p.status !== 'proposed') return send(req, res, 400, { error: 'unknown proposal or action' });
    p.status = next; p.agentId = typeof body.agentId === 'string' ? body.agentId : null;
    for (const t of s.tasks) delete t.waitingOnOwner; // the owner decided: blocked tasks can go on
    saveState(s);
    return send(req, res, 200, { ok: true, agentProposals: s.agentProposals });
  }
  return send(req, res, 404, { error: 'not found' });
}

const SALES_EVERY_MIN = 60;
let salesSyncing = null;
/** Pull the shop's orders from Printify and file each sale under the agent that made the product. */
export async function syncSales(deps = {}) {
  if (salesSyncing) return salesSyncing;
  salesSyncing = (async () => {
    const before = loadState(deps.file);
    let orders, error = null;
    try { orders = await (deps.listOrders ?? listOrders)(); } catch (e) { error = String(e.message || e).slice(0, 300); }
    // the owner may have changed things while the orders loaded: write into the current file
    const now = loadState(deps.file);
    if (orders) now.sales = salesFromOrders(orders, now.publishRequests || before.publishRequests || []);
    now.salesSync = { at: new Date().toISOString(), error, orders: orders?.length ?? null };
    saveState(now, deps.file);
    return { ok: !error, error, orders: orders?.length ?? 0 };
  })().finally(() => { salesSyncing = null; });
  return salesSyncing;
}

/** Start writing requested skills in the background; false when a run is going (they are written right after it). */
function startSkills() {
  if (running || !KEY) return false;
  runSkills('skills').then((r) => console.log(`[origin] skills run: ${r.ok ? r.run.summary : r.reason}`));
  return true;
}

/** Owner requests dropped as files in origin-data/inbox (for example by a setup step): applied once, then removed. */
function readInbox() {
  const dir = path.join(DIR, 'inbox');
  let names = [];
  try { names = fs.readdirSync(dir).filter((f) => f.endsWith('.json')); } catch { return; }
  for (const f of names) {
    const file = path.join(dir, f);
    try {
      const req = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (req?.type === 'skills') { const s = loadState(); const r = queueSkills(s, req); saveState(s); console.log(`[origin] inbox ${f}: ${r.files.length} SKILL.md, ${r.bank.length} bank skills${r.unknown.length ? `; not found: ${r.unknown.join(', ')}` : ''}`); }
    } catch (e) { console.error(`[origin] inbox ${f}: ${e.message}`); }
    try { fs.renameSync(file, `${file}.done`); } catch { /* leave it */ }
  }
}

/** Start a run in the background for the owner's focus task; false when one is already running (it is picked up next). */
function startFocus() {
  if (running || !KEY) return false;
  runOnce('focus').then((r) => console.log(`[origin] focus run: ${r.ok ? `${r.run.status}, $${r.run.costUsd.toFixed(4)}` : r.reason}`));
  return true;
}

let lastSkip = '';
function tick() {
  readInbox();
  const s0 = loadState();
  // skills the owner asked for are written right away, between other runs
  if (!running && KEY && requestedSkills(s0).length && remaining(s0) >= CALL_WORST_USD) { startSkills(); return; }
  if (printifyPublic().configured && (!s0.salesSync?.at || Date.now() - Date.parse(s0.salesSync.at) > SALES_EVERY_MIN * 60_000)) void syncSales().catch(() => {});
  if (!SCHEDULE || running) return;
  const s = loadState();
  const last = s.lastScheduledAt ? Date.parse(s.lastScheduledAt) : 0;
  // the owner's command-center task runs back to back until it is done; it is theirs, so daily pacing does not hold it
  const focus = pickTasks(s).some((t) => t.focus);
  if (Date.now() - last < (focus ? Math.min(FOCUS_EVERY_MIN, EVERY_MIN) : EVERY_MIN) * 60_000) return;
  // pacing: scheduled runs stop for the day once today's share of the cap is used (manual runs still work)
  rollMonth(s);
  const day = dailyAllowance(s);
  if (!focus && day.spentTodayUsd >= day.allowanceUsd) {
    const why = `today's share of the cap ($${day.allowanceUsd.toFixed(2)}) is used; scheduled runs resume tomorrow`;
    if (why !== lastSkip) console.log(`[origin] scheduled run skipped: ${why}`);
    lastSkip = why;
    return;
  }
  runOnce('schedule').then((r) => {
    // a run that can't start is retried every minute; say why once, not every minute
    const line = `[origin] scheduled run: ${r.ok ? `${r.run.status}, $${r.run.costUsd.toFixed(4)}` : r.reason}`;
    if (r.ok || r.reason !== lastSkip) console.log(line);
    lastSkip = r.ok ? '' : r.reason;
  });
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('origin-runner.mjs')) {
  http.createServer((req, res) => { handle(req, res).catch((e) => { console.error(`[origin] ${e.name}`); send(req, res, 500, { error: 'runner error' }); }); })
    .listen(PORT, '127.0.0.1', () => console.log(`[origin] listening on 127.0.0.1:${PORT} model=${MODEL} cap=$${CAP}/month window=${MAX_MIN} min every ${EVERY_MIN} min schedule=${SCHEDULE ? 'on' : 'off'} key=${KEY ? `set (${KEY_FROM})` : 'MISSING: run npm.cmd run set-key once, then start this again'}`));
  setInterval(tick, 60_000);
  setTimeout(tick, 5_000);
}
