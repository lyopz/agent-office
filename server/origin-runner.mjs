#!/usr/bin/env node
// ORIGIN's real work windows. Runs the main agent on a live model every
// ORIGIN_EVERY_MIN minutes for at most ORIGIN_MAX_MIN minutes, plus manual runs
// from the app's "Run 10 min" button, and never spends past the monthly cap.
// ORIGIN works on one owner-approved task per run, oldest first; with none
// approved it only reviews its notes and proposes a task, without web searches.
// It can also propose one new agent per run (with skills from the owner's
// skill bank); the owner approves it in the app, which creates it.
//
//   ANTHROPIC_API_KEY=sk-... npm run origin        (listens on 127.0.0.1:8788)
//   ORIGIN_MODEL=claude-haiku-5-5 ORIGIN_MONTHLY_CAP_USD=15 ORIGIN_EVERY_MIN=120 ORIGIN_MAX_MIN=10 ORIGIN_SCHEDULE=on
//
// State (instructions synced from the app, tasks, ORIGIN's notes, the cost
// ledger) is kept in origin-data/state.json next to the app. The key lives only
// in this process's environment and is never written to disk or logged.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const PORT = Number(process.env.ORIGIN_PORT || 8788);
const MODEL = process.env.ORIGIN_MODEL || 'claude-haiku-5-5';
const KEY = process.env.ANTHROPIC_API_KEY;
const CAP = Number(process.env.ORIGIN_MONTHLY_CAP_USD || 15);
const EVERY_MIN = Number(process.env.ORIGIN_EVERY_MIN || 120);
const MAX_MIN = Number(process.env.ORIGIN_MAX_MIN || 10);
const SCHEDULE = (process.env.ORIGIN_SCHEDULE || 'on') !== 'off';
const DIR = path.resolve(process.env.ORIGIN_DATA_DIR || 'origin-data');
const FILE = path.join(DIR, 'state.json');
const MAX_BODY = 512 * 1024;
const MAX_INSTRUCTIONS = 200_000;

/** Most a single run may spend, and what must be left in the month before a run starts. */
const RUN_LIMIT_USD = Number(process.env.ORIGIN_RUN_LIMIT_USD || 0.5);
const MAX_CALLS = 8;
/** A generous ceiling on one model call (8K output, a large prompt, five searches); a call starts only if this still fits. */
const CALL_WORST_USD = 0.2;
const MAX_SEARCHES = 5;

// USD per million tokens; prompts over 100K tokens use the higher card. Web search: $10 per 1,000.
const PRICES = {
  'claude-haiku-5-5': { small: [0.10, 0.50], large: [0.50, 2.50], threshold: 100_000 },
  'claude-sonnet-5-5': { small: [2, 10], large: [2, 10], threshold: Infinity },
  'claude-opus-5-5': { small: [4, 20], large: [4, 20], threshold: Infinity },
};
const SEARCH_USD = 0.01;

/** A task's default budget: a tenth of the monthly cap. ORIGIN stops a task on its own when its spend pattern would pass it. */
const TASK_BUDGET_USD = Number(process.env.ORIGIN_TASK_BUDGET_USD || CAP / 10);
/** Runs a task gets before ORIGIN projects its long-run cost from the pattern. */
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
  return { instructions: '', memory: '', nextAction: '', tasks: [], agentProposals: [], ledger: { month: month(), spentUsd: 0, unknownCostRuns: 0, byAgent: {} }, runs: [], lastScheduledAt: null };
}
export function loadState(file = FILE) {
  try { return { ...emptyState(), ...JSON.parse(fs.readFileSync(file, 'utf8')) }; } catch { return emptyState(); }
}
function saveState(s, file = FILE) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(s, null, 2));
  fs.renameSync(tmp, file);
}
/** A new month starts a new budget; the old month's total stays in the run history. */
function rollMonth(s) { if (s.ledger.month !== month()) s.ledger = { month: month(), spentUsd: 0, unknownCostRuns: 0, byAgent: {} }; s.ledger.byAgent ??= {}; }

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
  const projected = spent + avg * runsLeftThisMonth(now);
  if (projected > budget * 2) return `at $${avg.toFixed(3)} a run it would reach about $${projected.toFixed(2)} by month end, past its $${budget.toFixed(2)} budget`;
  const last3 = costs.slice(-3);
  if (last3[0] < last3[1] && last3[1] < last3[2] && last3[2] > 2 * last3[0] && spent > budget / 2) return `each run costs more than the last ($${last3.map((c) => c.toFixed(3)).join(', ')}) and it has used over half its budget`;
  return null;
}
function stopTask(task, reason, at) { task.status = 'stopped'; task.stopReason = reason; task.stoppedAt = at; }
const remaining = (s) => Math.max(0, CAP - s.ledger.spentUsd);

const newId = (p) => `${p}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 5)}`;
const pendingCount = (s) => s.tasks.filter((t) => t.status === 'proposed').length + s.agentProposals.filter((a) => a.status === 'proposed').length;

function briefFor(s, task, deadline) {
  return [
    `Current time: ${new Date().toISOString()}. This work window ends at ${deadline.toISOString()} (${MAX_MIN} minutes). Model: ${MODEL}.`,
    `Budget: $${s.ledger.spentUsd.toFixed(2)} of the owner's $${CAP} monthly cap spent this month; this run may spend at most $${Math.min(RUN_LIMIT_USD, remaining(s)).toFixed(2)}. Approved spending covers only these runs on the tasks below. Ask before anything else that costs money.`,
    `Your notes from earlier runs:\n${s.memory || '(none yet: this is your first real run)'}`,
    `Next action you recorded: ${s.nextAction || '(none)'}`,
    task
      ? `Your one task this run (the owner approved it; work only on this): [${task.id}] ${task.title}: ${task.detail}\nIf you finish it, list its id in completedTaskIds. If not, record in your notes exactly where you stopped; the next run continues it.\nBUDGET WATCH: this task has cost $${(task.spentUsd || 0).toFixed(3)} over ${(task.runCosts || []).length} earlier runs (per run: ${(task.runCosts || []).slice(-5).map((c) => `$${c.toFixed(3)}`).join(', ') || 'none yet'}); its budget is $${(task.budgetUsd ?? TASK_BUDGET_USD).toFixed(2)}. If the pattern shows it will cost far more than it is worth over time, stop it yourself without asking: put its id in stopTaskIds with the reason in stopReason, and say so in notifyOwner. The runner also stops it automatically when it passes its budget.`
      : 'The owner has not approved any task yet. Do not research. Review your notes and propose the single most valuable, cheap task for the owner to approve.',
    `Waiting for the owner's approval already: ${[...s.tasks.filter((t) => t.status === 'proposed').map((t) => `task "${t.title}"`), ...s.agentProposals.filter((a) => a.status === 'proposed').map((a) => `agent "${a.name}"`)].join('; ') || 'nothing'}`,
    pendingCount(s)
      ? 'Something is already waiting for the owner, so propose nothing new this run (leave proposedTasks and proposedAgent empty).'
      : 'You may propose at most one new task, or one new agent if the work clearly needs a lasting specialist (follow HOW TO CREATE AN AGENT and the branch rules; parentId is your own id for a venture, or an existing venture\'s id for a skill agent working for it).',
    'Finish with exactly one JSON object in a ```json block: {"memory": "your updated notes, under 4000 characters, with sources and dates", "nextAction": "...", "proposedTasks": [{"title": "...", "detail": "..."}], "proposedAgent": null or {"parentId": "...", "name": "...", "specialty": "...", "purpose": "...", "skill": "a team such as Research", "bankSkillIds": ["..."], "everyMinutes": 120, "maxMinutes": 5, "reason": "why this window"}, "completedTaskIds": ["..."], "stopTaskIds": [], "stopReason": "...", "notifyOwner": "only a result the owner must see, else null", "summary": "one line on what this run did"}',
  ].join('\n\n');
}

function parseResult(text) {
  const m = text.match(/```json\s*([\s\S]*?)```/) || text.match(/(\{[\s\S]*\})\s*$/);
  if (!m) return null;
  try { return JSON.parse(m[1]); } catch { return null; }
}

let running = null;

/** One work window. Resolves with the run record; the state file is saved before it returns. */
export async function runOnce(trigger, deps = { fetch: globalThis.fetch, file: FILE }) {
  if (running) return { ok: false, reason: 'A run is already in progress.' };
  const s = loadState(deps.file);
  rollMonth(s);
  if (!KEY && !deps.key) return { ok: false, reason: 'ANTHROPIC_API_KEY is not set for the runner.' };
  if (!s.instructions) return { ok: false, reason: 'Open the app once with the runner on so it can send ORIGIN\'s instructions.' };
  if (remaining(s) < CALL_WORST_USD) {
    return { ok: false, reason: `The $${CAP} monthly cap is reached ($${s.ledger.spentUsd.toFixed(2)} spent). Runs stop until next month or a new approved cap.` };
  }
  // one task at a time: the oldest approved task
  const task = s.tasks.find((t) => t.status === 'approved') || null;
  const start = new Date(), deadline = new Date(start.getTime() + MAX_MIN * 60_000);
  const runLimit = Math.min(RUN_LIMIT_USD, remaining(s));
  const record = { id: `run_${start.getTime().toString(36)}`, trigger, model: MODEL, startedAt: start.toISOString(), endedAt: null, costUsd: 0, costKnown: true, calls: 0, searches: 0, status: 'running', summary: '' };
  running = record;
  const messages = [{ role: 'user', content: briefFor(s, task, deadline) }];
  const tools = task ? [{ type: 'web_search_20250305', name: 'web_search', max_uses: MAX_SEARCHES }] : [];
  let text = '';
  try {
    while (record.calls < MAX_CALLS) {
      if (Date.now() > deadline.getTime() - 15_000) { record.status = 'window-ended'; break; }
      if (record.costUsd + CALL_WORST_USD > runLimit) { record.status = record.calls ? 'run-budget-reached' : 'cap-reached'; break; }
      const r = await deps.fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-api-key': deps.key || KEY, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({ model: MODEL, max_tokens: 8000, system: s.instructions, messages, ...(tools.length ? { tools } : {}) }),
        signal: AbortSignal.timeout(Math.max(5_000, deadline.getTime() - Date.now())),
      });
      record.calls++;
      if (!r.ok) { record.status = `upstream-${r.status}`; break; }
      const data = await r.json();
      const c = costOf(MODEL, data.usage || {});
      if (c == null) record.costKnown = false; else record.costUsd += c;
      record.searches += data.usage?.server_tool_use?.web_search_requests || 0;
      text = (data.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('');
      if (data.stop_reason === 'pause_turn') { messages.push({ role: 'assistant', content: data.content }); continue; }
      record.status = data.stop_reason === 'refusal' ? 'refused' : 'done';
      break;
    }
  } catch (e) {
    record.status = e.name === 'TimeoutError' ? 'window-ended' : 'error';
    console.error(`[origin] ${e.name}: ${e.message}`);
  } finally {
    running = null;
  }
  record.endedAt = new Date().toISOString();
  const out = parseResult(text);
  if (out) {
    if (typeof out.memory === 'string') s.memory = out.memory.slice(0, 8000);
    if (typeof out.nextAction === 'string') s.nextAction = out.nextAction.slice(0, 1000);
    // at most one new proposal per run, and none while the owner still has one to decide
    const t = Array.isArray(out.proposedTasks) ? out.proposedTasks[0] : null;
    const a = out.proposedAgent && typeof out.proposedAgent === 'object' ? out.proposedAgent : null;
    if (!pendingCount(s)) {
      if (t?.title) s.tasks.push({ id: newId('task'), title: String(t.title).slice(0, 160), detail: String(t.detail || '').slice(0, 1000), status: 'proposed', by: 'origin', createdAt: record.endedAt });
      else if (a?.name && a?.parentId) {
        const num = (v, lo, hi, d) => (Number.isFinite(Number(v)) ? Math.min(hi, Math.max(lo, Math.round(Number(v)))) : d);
        s.agentProposals.push({
          id: newId('agentp'), parentId: String(a.parentId).slice(0, 80), name: String(a.name).slice(0, 60), specialty: String(a.specialty || '').slice(0, 200),
          purpose: String(a.purpose || '').slice(0, 1000), skill: String(a.skill || 'Research').slice(0, 40),
          bankSkillIds: (Array.isArray(a.bankSkillIds) ? a.bankSkillIds : []).map(String).slice(0, 10),
          everyMinutes: num(a.everyMinutes, 15, 10_080, 240), maxMinutes: num(a.maxMinutes, 1, 60, 5), reason: String(a.reason || '').slice(0, 300),
          status: 'proposed', createdAt: record.endedAt,
        });
      }
    }
    // only the task this run worked on can be completed or stopped by it
    if (task && Array.isArray(out.completedTaskIds) && out.completedTaskIds.includes(task.id)) task.status = 'done';
    if (task && task.status === 'approved' && Array.isArray(out.stopTaskIds) && out.stopTaskIds.includes(task.id)) {
      stopTask(task, `ORIGIN stopped it: ${String(out.stopReason || 'its spend pattern was too high for its value').slice(0, 300)}`, record.endedAt);
    }
    record.summary = String(out.summary || '').slice(0, 300);
    record.notify = out.notifyOwner ? String(out.notifyOwner).slice(0, 500) : null;
  } else if (record.status === 'done') record.status = 'no-result';
  const round = (n) => Math.round(n * 1e6) / 1e6;
  record.agentId = AGENT_ID;
  record.taskId = task?.id ?? null;
  if (task) {
    task.spentUsd = round((task.spentUsd || 0) + record.costUsd);
    task.runCosts = [...(task.runCosts || []), round(record.costUsd)].slice(-50);
    const why = task.status === 'approved' ? budgetWatch(task) : null;
    if (why) stopTask(task, `Budget watch stopped it: ${why}`, record.endedAt);
    if (task.status === 'stopped') record.notify = `Stopped "${task.title}". ${task.stopReason}`;
  }
  s.ledger.spentUsd = round(s.ledger.spentUsd + record.costUsd);
  s.ledger.byAgent[AGENT_ID] = round((s.ledger.byAgent[AGENT_ID] || 0) + record.costUsd);
  if (!record.costKnown) s.ledger.unknownCostRuns++;
  s.runs = [record, ...s.runs].slice(0, 50);
  if (trigger === 'schedule') s.lastScheduledAt = record.startedAt;
  saveState(s, deps.file);
  return { ok: true, run: record };
}

function publicState() {
  const s = loadState(); rollMonth(s);
  return {
    configured: Boolean(KEY), model: MODEL, capUsd: CAP, everyMinutes: EVERY_MIN, maxMinutes: MAX_MIN, schedule: SCHEDULE,
    spentUsd: s.ledger.spentUsd, spentByAgent: s.ledger.byAgent, taskBudgetUsd: TASK_BUDGET_USD, unknownCostRuns: s.ledger.unknownCostRuns, month: s.ledger.month, running: running ? running.startedAt : null,
    synced: Boolean(s.instructions), memory: s.memory, nextAction: s.nextAction, tasks: s.tasks, agentProposals: s.agentProposals, runs: s.runs.slice(0, 10),
    // with no scheduled run yet, the next one starts within a minute
    nextScheduledAt: SCHEDULE ? new Date(s.lastScheduledAt ? Math.max(Date.now(), Date.parse(s.lastScheduledAt) + EVERY_MIN * 60_000) : Date.now() + 60_000).toISOString() : null,
  };
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
  if (req.method !== 'POST') return send(req, res, 404, { error: 'not found' });
  let body;
  try { body = await readBody(req); } catch { return send(req, res, 400, { error: 'invalid request body' }); }
  if (url === '/api/origin/sync') {
    if (typeof body.instructions !== 'string' || body.instructions.length < 100 || body.instructions.length > MAX_INSTRUCTIONS) return send(req, res, 400, { error: 'instructions required' });
    const s = loadState(); s.instructions = body.instructions; saveState(s);
    return send(req, res, 200, { ok: true });
  }
  if (url === '/api/origin/run') {
    const r = await runOnce('manual');
    return send(req, res, r.ok ? 200 : 409, r);
  }
  if (url === '/api/origin/tasks') {
    const s = loadState();
    if (body.action === 'add' && typeof body.title === 'string' && body.title.trim()) {
      // the owner adding a task is approving it
      s.tasks.push({ id: `task_${Date.now().toString(36)}`, title: body.title.trim().slice(0, 160), detail: String(body.detail || '').slice(0, 1000), status: 'approved', by: 'owner', createdAt: new Date().toISOString() });
    } else {
      const t = s.tasks.find((x) => x.id === body.id);
      const next = { approve: 'approved', reject: 'rejected', done: 'done', stop: 'stopped' }[body.action];
      if (!t || !next) return send(req, res, 400, { error: 'unknown task or action' });
      // approving a stopped task restarts it with a fresh budget on top of what it already spent
      if (next === 'approved' && t.status === 'stopped') { t.budgetUsd = (t.spentUsd || 0) + TASK_BUDGET_USD; t.runCosts = []; delete t.stopReason; }
      if (next === 'stopped') t.stopReason = 'You stopped it.';
      t.status = next;
    }
    saveState(s);
    return send(req, res, 200, { ok: true, tasks: s.tasks });
  }
  if (url === '/api/origin/agents') {
    // the app creates the agent on approval (it owns the brain); this records the owner's decision
    const s = loadState();
    const p = s.agentProposals.find((x) => x.id === body.id);
    const next = { approve: 'approved', reject: 'rejected' }[body.action];
    if (!p || !next || p.status !== 'proposed') return send(req, res, 400, { error: 'unknown proposal or action' });
    p.status = next; p.agentId = typeof body.agentId === 'string' ? body.agentId : null;
    saveState(s);
    return send(req, res, 200, { ok: true, agentProposals: s.agentProposals });
  }
  return send(req, res, 404, { error: 'not found' });
}

let lastSkip = '';
function tick() {
  if (!SCHEDULE || running) return;
  const s = loadState();
  const last = s.lastScheduledAt ? Date.parse(s.lastScheduledAt) : 0;
  if (Date.now() - last < EVERY_MIN * 60_000) return;
  runOnce('schedule').then((r) => {
    // a run that can't start is retried every minute; say why once, not every minute
    const line = `[origin] scheduled run: ${r.ok ? `${r.run.status}, $${r.run.costUsd.toFixed(4)}` : r.reason}`;
    if (r.ok || r.reason !== lastSkip) console.log(line);
    lastSkip = r.ok ? '' : r.reason;
  });
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('origin-runner.mjs')) {
  http.createServer((req, res) => { handle(req, res).catch((e) => { console.error(`[origin] ${e.name}`); send(req, res, 500, { error: 'runner error' }); }); })
    .listen(PORT, '127.0.0.1', () => console.log(`[origin] listening on 127.0.0.1:${PORT} model=${MODEL} cap=$${CAP}/month window=${MAX_MIN} min every ${EVERY_MIN} min schedule=${SCHEDULE ? 'on' : 'off'} key=${KEY ? 'set' : 'MISSING'}`));
  setInterval(tick, 60_000);
  setTimeout(tick, 5_000);
}
