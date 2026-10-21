#!/usr/bin/env node
// ORIGIN's real work windows. Runs the main agent on a live model every
// ORIGIN_EVERY_MIN minutes for at most ORIGIN_MAX_MIN minutes, plus manual runs
// from the app's "Run 10 min" button, and never spends past the monthly cap.
// ORIGIN only works on tasks the owner approved; with none approved it only
// reviews its notes and proposes tasks, without web searches.
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
const MAX_BODY = 256 * 1024;

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
  return { instructions: '', memory: '', nextAction: '', tasks: [], ledger: { month: month(), spentUsd: 0, unknownCostRuns: 0 }, runs: [], lastScheduledAt: null };
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
function rollMonth(s) { if (s.ledger.month !== month()) s.ledger = { month: month(), spentUsd: 0, unknownCostRuns: 0 }; }
const remaining = (s) => Math.max(0, CAP - s.ledger.spentUsd);

function briefFor(s, approved, deadline) {
  return [
    `Current time: ${new Date().toISOString()}. This work window ends at ${deadline.toISOString()} (${MAX_MIN} minutes). Model: ${MODEL}.`,
    `Budget: $${s.ledger.spentUsd.toFixed(2)} of the owner's $${CAP} monthly cap spent this month; this run may spend at most $${Math.min(RUN_LIMIT_USD, remaining(s)).toFixed(2)}. Approved spending covers only these runs on the tasks below. Ask before anything else that costs money.`,
    `Your notes from earlier runs:\n${s.memory || '(none yet: this is your first real run)'}`,
    `Next action you recorded: ${s.nextAction || '(none)'}`,
    approved.length
      ? `Tasks the owner approved (work only on these, highest value first):\n${approved.map((t) => `- [${t.id}] ${t.title}: ${t.detail}`).join('\n')}`
      : 'The owner has not approved any task yet. Do not research. Review your notes and propose up to 3 specific, cheap tasks for the owner to approve.',
    `Waiting for approval already: ${s.tasks.filter((t) => t.status === 'proposed').map((t) => t.title).join('; ') || 'none'}`,
    'Finish with exactly one JSON object in a ```json block: {"memory": "your updated notes, under 4000 characters, with sources and dates", "nextAction": "...", "proposedTasks": [{"title": "...", "detail": "..."}], "completedTaskIds": ["..."], "notifyOwner": "a short notification or null", "summary": "one line on what this run did"}',
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
  const approved = s.tasks.filter((t) => t.status === 'approved');
  const start = new Date(), deadline = new Date(start.getTime() + MAX_MIN * 60_000);
  const runLimit = Math.min(RUN_LIMIT_USD, remaining(s));
  const record = { id: `run_${start.getTime().toString(36)}`, trigger, model: MODEL, startedAt: start.toISOString(), endedAt: null, costUsd: 0, costKnown: true, calls: 0, searches: 0, status: 'running', summary: '' };
  running = record;
  const messages = [{ role: 'user', content: briefFor(s, approved, deadline) }];
  const tools = approved.length ? [{ type: 'web_search_20250305', name: 'web_search', max_uses: MAX_SEARCHES }] : [];
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
    for (const t of (Array.isArray(out.proposedTasks) ? out.proposedTasks : []).slice(0, 3)) {
      if (t?.title) s.tasks.push({ id: `task_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 5)}`, title: String(t.title).slice(0, 160), detail: String(t.detail || '').slice(0, 1000), status: 'proposed', by: 'origin', createdAt: record.endedAt });
    }
    for (const id of Array.isArray(out.completedTaskIds) ? out.completedTaskIds : []) { const t = s.tasks.find((x) => x.id === id && x.status === 'approved'); if (t) t.status = 'done'; }
    record.summary = String(out.summary || '').slice(0, 300);
    record.notify = out.notifyOwner ? String(out.notifyOwner).slice(0, 500) : null;
  } else if (record.status === 'done') record.status = 'no-result';
  s.ledger.spentUsd = Math.round((s.ledger.spentUsd + record.costUsd) * 1e6) / 1e6;
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
    spentUsd: s.ledger.spentUsd, unknownCostRuns: s.ledger.unknownCostRuns, month: s.ledger.month, running: running ? running.startedAt : null,
    synced: Boolean(s.instructions), memory: s.memory, nextAction: s.nextAction, tasks: s.tasks, runs: s.runs.slice(0, 10),
    nextScheduledAt: SCHEDULE ? new Date((s.lastScheduledAt ? Date.parse(s.lastScheduledAt) : Date.now()) + EVERY_MIN * 60_000).toISOString() : null,
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
    if (typeof body.instructions !== 'string' || body.instructions.length < 100 || body.instructions.length > 60_000) return send(req, res, 400, { error: 'instructions required' });
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
      const next = { approve: 'approved', reject: 'rejected', done: 'done' }[body.action];
      if (!t || !next) return send(req, res, 400, { error: 'unknown task or action' });
      t.status = next;
    }
    saveState(s);
    return send(req, res, 200, { ok: true, tasks: s.tasks });
  }
  return send(req, res, 404, { error: 'not found' });
}

function tick() {
  if (!SCHEDULE || running) return;
  const s = loadState();
  const last = s.lastScheduledAt ? Date.parse(s.lastScheduledAt) : 0;
  if (Date.now() - last < EVERY_MIN * 60_000) return;
  runOnce('schedule').then((r) => console.log(`[origin] scheduled run: ${r.ok ? `${r.run.status}, $${r.run.costUsd.toFixed(4)}` : r.reason}`));
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('origin-runner.mjs')) {
  http.createServer((req, res) => { handle(req, res).catch((e) => { console.error(`[origin] ${e.name}`); send(req, res, 500, { error: 'runner error' }); }); })
    .listen(PORT, '127.0.0.1', () => console.log(`[origin] listening on 127.0.0.1:${PORT} model=${MODEL} cap=$${CAP}/month window=${MAX_MIN} min every ${EVERY_MIN} min schedule=${SCHEDULE ? 'on' : 'off'} key=${KEY ? 'set' : 'MISSING'}`));
  setInterval(tick, 60_000);
  setTimeout(tick, 5_000);
}
