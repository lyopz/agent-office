#!/usr/bin/env node
// ORIGIN's real work windows. Runs the main agent on a live model every
// ORIGIN_EVERY_MIN minutes for at most ORIGIN_MAX_MIN minutes, plus manual runs
// from the app's "Run 10 min" button, and never spends past the monthly cap.
// ORIGIN works on one owner-approved task per run, oldest first; with none
// approved it only reviews its notes and proposes a task, without web searches.
// It can also propose one new agent per run (with skills from the owner's
// skill bank); the owner approves it in the app, which creates it.
//
//   npm run set-key   (once: saves the key on this PC, outside the app folder)
//   npm run origin    (listens on 127.0.0.1:8788; ANTHROPIC_API_KEY in the environment wins if set)
//   ORIGIN_MODEL=claude-haiku-5-5 ORIGIN_MONTHLY_CAP_USD=15 ORIGIN_EVERY_MIN=120 ORIGIN_MAX_MIN=10 ORIGIN_SCHEDULE=on
//
// State (instructions synced from the app, tasks, ORIGIN's notes, the cost
// ledger) is kept in origin-data/state.json next to the app. The key lives only
// in this process's environment and is never written to disk or logged.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { readKey } from './key-file.mjs';

const PORT = Number(process.env.ORIGIN_PORT || 8788);
const MODEL = process.env.ORIGIN_MODEL || 'claude-haiku-5-5';
const { key: KEY, from: KEY_FROM } = readKey();
const CAP = Number(process.env.ORIGIN_MONTHLY_CAP_USD || 15);
const EVERY_MIN = Number(process.env.ORIGIN_EVERY_MIN || 120);
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
  return { instructions: '', memory: '', nextAction: '', tasks: [], agentProposals: [], skillFiles: [], autoAgents: true, ledger: { month: month(), spentUsd: 0, unknownCostRuns: 0, byAgent: {} }, runs: [], lastScheduledAt: null };
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
/** Proposals the owner still has to decide. With autoAgents on, agents are created without asking, so only tasks wait. */
const pendingCount = (s) => s.tasks.filter((t) => t.status === 'proposed').length + (s.autoAgents === false ? s.agentProposals.filter((a) => a.status === 'proposed').length : 0);
/** How many agents ORIGIN may create (or propose) in one run. */
const agentsPerRun = (s) => (s.autoAgents === false ? 1 : 3);
/** The current SKILL.md format (the full ten-section playbook); the app rewrites files older than this. */
const SKILL_FILE_VERSION = 2;
/** Agents with the same job share one SKILL.md: their request with the agent's own name taken out. */
const roleOf = (t) => t.detail.split(t.agentName || '\u0000').join('').replace(/,? created by [^.,]+/, '').replace(/\s+/g, ' ').trim();

/** What a SKILL.md for one agent must contain. ORIGIN writes one for every agent it or the owner creates. */
const SKILL_FILE_RULES = `A SKILL.md is the full, detailed playbook for one agent's job: specific to that agent and its business, never generic, and complete enough that the agent can do excellent work from it alone. Write it in Markdown, between 6,000 and 18,000 characters, with these sections:
1. Mission: the outcome it owns, who it serves, and what "done" and "excellent" look like, with measurable targets.
2. Scope: what it does and explicitly does not do; who it hands work to and receives work from.
3. Recurring workflows: each one as numbered steps with decision points (if X then Y), the order of work, and how long each step should take within its work window.
4. Methods and techniques: the specific frameworks, formulas, checklists or tactics an expert in this role uses, with short worked examples for this business.
5. Inputs and sources: where it gets information, how to judge each source's reliability and freshness, and what to do when sources disagree.
6. Deliverables: the exact format of each output (headings, fields, length), with a filled-in example.
7. Quality bar: a checklist it runs before handing work back, and common mistakes to avoid.
8. Costs and limits: what each kind of work costs in tokens, searches or money, its budget habits, and when to stop.
9. Approvals and escalation: what needs the owner's approval, what goes to its venture or to ORIGIN, and how to write that request.
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
  return s.tasks.find((t) => ready(t) && t.kind !== 'skill-file') || s.tasks.find(ready) || null;
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

/** Every agent in the owner's brain as the app last synced it. This, not ORIGIN's notes, is what exists. */
function roster(s) {
  const all = s.agents || [];
  if (!all.length) return 'AGENTS IN THE BRAIN: the app has not sent the list yet.';
  const name = (id) => all.find((a) => a.id === id)?.name ?? (id === AGENT_ID ? 'ORIGIN' : id);
  return `AGENTS IN THE BRAIN NOW (${all.length} besides you; they are real records in the owner's app, and this list is the truth even where your notes disagree):\n${all.map((a) => `- [${a.id}] ${a.name}: ${a.title || 'agent'}${a.kind === 'venture' ? ' (venture)' : a.kind === 'skill' ? ` (skill agent for ${name(a.ventureId)})` : ''}${a.hasSkillFile ? '' : ' (SKILL.md not written yet)'}`).join('\n')}`;
}

/** One file for every agent with the same job; their requests are done too. */
function saveSkillFile(s, task, file, at) {
  const same = s.tasks.filter((x) => x.kind === 'skill-file' && x.status === 'approved' && (x === task || roleOf(x) === roleOf(task)));
  for (const x of same) x.status = 'done';
  s.skillFiles.push({ id: newId('skillfile'), agentId: task.agentId, agentName: task.agentName, agentIds: same.map((x) => x.agentId), agentNames: same.map((x) => x.agentName), version: SKILL_FILE_VERSION, ...file, status: 'new', createdAt: at });
}

/** What ORIGIN needs to write one agent's SKILL.md. */
function skillFileBrief(s, task) {
  return `Write the SKILL.md for the agent "${task.agentName}" (id ${task.agentId})${task.sharedWith?.length ? `. ${task.sharedWith.length} other agents do exactly the same job (${task.sharedWith.join(', ')}) and will share this file, so write it for the role, not the one name` : ''}. What the owner and the agent's creator said about it:\n${task.detail}${agentBrief(s, task.agentId) ? `\n\nIts current instructions:\n${agentBrief(s, task.agentId)}` : ''}\n\n${SKILL_FILE_RULES}`;
}

function briefFor(s, task, deadline) {
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
      ? `Your one task this run (the owner approved it; work only on this): [${task.id}] ${task.title}: ${task.detail}${workAs(s, task)}\nIf you finish it, list its id in completedTaskIds. If not, record in your notes exactly where you stopped; the next run continues it.\nBUDGET WATCH: this task has cost $${(task.spentUsd || 0).toFixed(3)} over ${(task.runCosts || []).length} earlier runs (per run: ${(task.runCosts || []).slice(-5).map((c) => `$${c.toFixed(3)}`).join(', ') || 'none yet'}); its budget is $${(task.budgetUsd ?? TASK_BUDGET_USD).toFixed(2)}. If the pattern shows it will cost far more than it is worth over time, stop it yourself without asking: put its id in stopTaskIds with the reason in stopReason, and say so in notifyOwner. The runner also stops it automatically when it passes its budget.`
      : 'No approved task is ready. Do not research. Review your notes, make sure each venture has the skill agents it needs (below), and propose the single most valuable, cheap task for the owner to approve.',
    `Waiting for the owner's approval already: ${[...s.tasks.filter((t) => t.status === 'proposed').map((t) => `task "${t.title}"`), ...s.agentProposals.filter((a) => a.status === 'proposed').map((a) => `agent "${a.name}"`)].join('; ') || 'nothing'}`,
    s.autoAgents === false
      ? (pendingCount(s)
        ? 'Something is already waiting for the owner, so propose nothing new this run (leave proposedTasks and proposedAgents empty). If your task cannot continue until the owner decides, set "waitingOnOwner": true and the runner moves on to other work.'
        : `You may propose at most one new task, or one new agent if the work clearly needs a lasting specialist (follow HOW TO CREATE AN AGENT and the branch rules; parentId is your own id for a venture, or an existing venture's id for a skill agent working for it). Give it a clear purpose of two or three sentences; its SKILL.md is written in full in a later run.`)
      : `GROWING THE BRAIN: the owner lets you create agents without asking; they exist as soon as you list them, cost nothing until they are given work, and the owner can delete any. Each venture should have the skill agents it needs to make money (for an Etsy store, for example: product research, listing copy and SEO, design or mockups, pricing, and ads). In proposedAgents, create up to ${agentsPerRun(s)} agents this run that a venture clearly needs and does not have yet; parentId is the venture's id (from AGENTS IN THE BRAIN NOW) for its skill agents, or your own id for a new venture (a new venture needs a business the owner already asked for or approved). Never duplicate an agent that already exists. Give each a clear purpose of two or three sentences; do not write its SKILL.md here, because the runner has you write each one in full in a later run.${pendingCount(s) ? ' A task proposal is waiting for the owner, so propose no new task this run.' : ' You may also propose one new task for the owner to approve.'}`,
    'Finish with exactly one JSON object in a ```json block: {"memory": "your updated notes, under 4000 characters, with sources and dates", "nextAction": "...", "proposedTasks": [{"title": "...", "detail": "..."}], "proposedAgents": [{"parentId": "...", "name": "...", "specialty": "...", "purpose": "...", "skill": "a team such as Research", "bankSkillIds": ["..."], "everyMinutes": 120, "maxMinutes": 5, "reason": "why this window"}], "waitingOnOwner": false, "skillFile": "only for a SKILL.md task, else null", "completedTaskIds": ["..."], "stopTaskIds": [], "stopReason": "...", "notifyOwner": "only a result the owner must see, else null", "summary": "one line on what this run did"}',
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
  if (!KEY && !deps.key) return { ok: false, reason: 'No API key. In the app folder run npm.cmd run set-key once, then restart the runner.' };
  if (!s.instructions) return { ok: false, reason: 'Open the app once with the runner on so it can send ORIGIN\'s instructions.' };
  if (remaining(s) < CALL_WORST_USD) {
    return { ok: false, reason: `The $${CAP} monthly cap is reached ($${s.ledger.spentUsd.toFixed(2)} spent). Runs stop until next month or a new approved cap.` };
  }
  const task = nextTask(s);
  // agents with the same job as this SKILL.md request share its file
  if (task?.kind === 'skill-file') task.sharedWith = s.tasks.filter((x) => x !== task && x.kind === 'skill-file' && x.status === 'approved' && roleOf(x) === roleOf(task)).map((x) => x.agentName);
  const start = new Date(), deadline = new Date(start.getTime() + MAX_MIN * 60_000);
  const runLimit = Math.min(RUN_LIMIT_USD, remaining(s));
  const record = { id: `run_${start.getTime().toString(36)}`, trigger, model: MODEL, startedAt: start.toISOString(), endedAt: null, costUsd: 0, costKnown: true, calls: 0, searches: 0, status: 'running', summary: '' };
  running = record;
  const messages = [{ role: 'user', content: briefFor(s, task, deadline) }];
  const tools = task ? [{ type: 'web_search_20250305', name: 'web_search', max_uses: MAX_SEARCHES }] : [];
  let text = '', stopReason = null;
  try {
    while (record.calls < MAX_CALLS) {
      if (Date.now() > deadline.getTime() - 15_000) { record.status = 'window-ended'; break; }
      if (record.costUsd + CALL_WORST_USD > runLimit) { record.status = record.calls ? 'run-budget-reached' : 'cap-reached'; break; }
      const r = await deps.fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-api-key': deps.key || KEY, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({ model: MODEL, max_tokens: 16000, system: s.instructions, messages, ...(tools.length ? { tools } : {}) }),
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
      stopReason = data.stop_reason;
      break;
    }
  } catch (e) {
    record.status = e.name === 'TimeoutError' ? 'window-ended' : 'error';
    console.error(`[origin] ${e.name}: ${e.message}`);
  } finally {
    running = null;
  }
  if (record.status === 'done' && stopReason === 'max_tokens') record.status = 'cut-off';
  // Every run also writes one SKILL.md in its own call, so the files get written even while
  // the owner's tasks keep the main work busy. It needs time and budget left over.
  const extra = task?.kind === 'skill-file' ? null : nextTask({ ...s, tasks: s.tasks.filter((t) => t.kind === 'skill-file') });
  if (extra && Date.now() < deadline.getTime() - 60_000 && record.costUsd + CALL_WORST_USD <= runLimit) {
    try {
      running = record;
      extra.sharedWith = s.tasks.filter((x) => x !== extra && x.kind === 'skill-file' && x.status === 'approved' && roleOf(x) === roleOf(extra)).map((x) => x.agentName);
      const prompt = [roster(s), skillFileBrief(s, extra), 'Reply with only one JSON object in a ```json block: {"skillFile": {"name": "a short skill name", "description": "one line on when this agent uses it", "body": "the full Markdown"}}'].join('\n\n');
      const r = await deps.fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-api-key': deps.key || KEY, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({ model: MODEL, max_tokens: 16000, system: s.instructions, messages: [{ role: 'user', content: prompt }] }),
        signal: AbortSignal.timeout(Math.max(5_000, deadline.getTime() - Date.now())),
      });
      record.calls++;
      if (r.ok) {
        const data = await r.json();
        const c = costOf(MODEL, data.usage || {});
        if (c == null) record.costKnown = false; else record.costUsd += c;
        const file = cleanSkillFile(parseResult((data.content || []).filter((b) => b.type === 'text').map((b) => b.text).join(''))?.skillFile);
        if (file) { saveSkillFile(s, extra, file, new Date().toISOString()); record.skillFileFor = extra.agentName; }
      } else console.error(`[origin] SKILL.md call answered ${r.status}`);
    } catch (e) {
      console.error(`[origin] SKILL.md call: ${e.name}`);
    } finally {
      running = null;
    }
  }
  record.endedAt = new Date().toISOString();
  const out = parseResult(text);
  if (out) {
    if (typeof out.memory === 'string') s.memory = out.memory.slice(0, 8000);
    if (typeof out.nextAction === 'string') s.nextAction = out.nextAction.slice(0, 1000);
    // at most one new task proposal per run, none while the owner still has one to decide; agents up to agentsPerRun
    const t = Array.isArray(out.proposedTasks) ? out.proposedTasks[0] : null;
    const agents = [...(Array.isArray(out.proposedAgents) ? out.proposedAgents : []), ...(out.proposedAgent && typeof out.proposedAgent === 'object' ? [out.proposedAgent] : [])]
      .filter((a) => a && typeof a === 'object' && a.name && a.parentId)
      .filter((a, i, all) => all.findIndex((b) => String(b.name).toLowerCase() === String(a.name).toLowerCase()) === i)
      .slice(0, agentsPerRun(s));
    const wasPending = pendingCount(s);
    if (!wasPending && t?.title) s.tasks.push({ id: newId('task'), title: String(t.title).slice(0, 160), detail: String(t.detail || '').slice(0, 1000), status: 'proposed', by: 'origin', createdAt: record.endedAt });
    if (s.autoAgents !== false || (!wasPending && !t?.title)) {
      for (const a of agents) {
        const num = (v, lo, hi, d) => (Number.isFinite(Number(v)) ? Math.min(hi, Math.max(lo, Math.round(Number(v)))) : d);
        s.agentProposals.push({
          id: newId('agentp'), parentId: String(a.parentId).slice(0, 80), name: String(a.name).slice(0, 60), specialty: String(a.specialty || '').slice(0, 200),
          purpose: String(a.purpose || '').slice(0, 1000), skill: String(a.skill || 'Research').slice(0, 40),
          bankSkillIds: (Array.isArray(a.bankSkillIds) ? a.bankSkillIds : []).map(String).slice(0, 10),
          everyMinutes: num(a.everyMinutes, 15, 10_080, 240), maxMinutes: num(a.maxMinutes, 1, 60, 5), reason: String(a.reason || '').slice(0, 300),
          skillFile: cleanSkillFile(a.skillFile), auto: s.autoAgents !== false, status: 'proposed', createdAt: record.endedAt,
        });
      }
    }
    // a task that can't go on until the owner decides steps aside instead of holding every run
    if (task && task.kind !== 'skill-file' && (out.waitingOnOwner === true || (pendingCount(s) > wasPending && !(out.completedTaskIds || []).includes(task.id)))) task.waitingOnOwner = true;
    const file = task?.kind === 'skill-file' ? cleanSkillFile(out.skillFile) : null;
    if (file) saveSkillFile(s, task, file, record.endedAt);
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
  // The owner (and console questions) may have changed the state while the run worked:
  // merge this run's results into the current file instead of overwriting it.
  const now = loadState(deps.file);
  rollMonth(now);
  now.memory = s.memory; now.nextAction = s.nextAction;
  for (const t of s.tasks) {
    const cur = now.tasks.find((x) => x.id === t.id);
    if (!cur) now.tasks.push(t);
    else if (t.id === task?.id) {
      Object.assign(cur, { spentUsd: t.spentUsd, runCosts: t.runCosts });
      if (cur.status === 'approved' && t.status === 'done') cur.status = 'done';
      if (cur.status === 'approved' && t.status !== 'approved') Object.assign(cur, { status: t.status, stopReason: t.stopReason, stoppedAt: t.stoppedAt });
      if (t.waitingOnOwner) cur.waitingOnOwner = true;
    } else if (t.kind === 'skill-file' && t.status === 'done' && cur.status === 'approved') cur.status = 'done'; // shared SKILL.md
  }
  for (const a of s.agentProposals) if (!now.agentProposals.some((x) => x.id === a.id)) now.agentProposals.push(a);
  for (const f of s.skillFiles) if (!now.skillFiles.some((x) => x.id === f.id)) now.skillFiles.push(f);
  now.ledger.spentUsd = round(now.ledger.spentUsd + record.costUsd);
  now.ledger.byAgent[AGENT_ID] = round((now.ledger.byAgent[AGENT_ID] || 0) + record.costUsd);
  if (!record.costKnown) now.ledger.unknownCostRuns++;
  now.runs = [record, ...now.runs].slice(0, 50);
  if (trigger === 'schedule') now.lastScheduledAt = record.startedAt;
  saveState(now, deps.file);
  return { ok: true, run: record };
}

/** Most one console answer may cost: a short reply with ORIGIN's prompt, no tools. */
const ASK_WORST_USD = 0.05;

/** The APPROVE line ORIGIN adds when the owner's words in the console approve work. */
export function parseConsent(text) {
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
  const title = typeof c.title === 'string' ? c.title.trim().slice(0, 160) : '';
  if (title && !s.tasks.some((t) => t.status === 'approved' && t.title.toLowerCase() === title.toLowerCase())) {
    const task = { id: newId('task'), title, detail: String(c.detail || '').slice(0, 4000), status: 'approved', by: 'owner', via: 'console', createdAt: new Date().toISOString() };
    if (typeof c.agentId === 'string' && (s.agents || []).some((a) => a.id === c.agentId)) task.agentId = c.agentId;
    const usd = Number(c.budgetUsd);
    if (usd > 0) task.budgetUsd = Math.min(usd, CAP);
    // the owner's own words: it goes first, ahead of SKILL.md writing
    s.tasks.push(task);
    for (const x of s.tasks) delete x.waitingOnOwner;
    done.push(title);
  }
  return done.length ? done : null;
}

/**
 * The owner's question from the console, answered by ORIGIN right away, any time,
 * without approval. It costs one model call against the same monthly cap, uses no
 * tools and changes nothing but the ledger and the question log.
 */
export async function ask(question, deps = { fetch: globalThis.fetch, file: FILE }) {
  const q = String(question || '').trim().slice(0, 2000);
  if (!q) return { ok: false, reason: 'Type a question.' };
  if (!KEY && !deps.key) return { ok: false, reason: 'No API key. In the app folder run npm.cmd run set-key once, then restart the runner.' };
  const s = loadState(deps.file);
  rollMonth(s);
  if (!s.instructions) return { ok: false, reason: 'Open the app once with the runner on so it can send ORIGIN\'s instructions.' };
  if (remaining(s) < ASK_WORST_USD) return { ok: false, reason: `The $${CAP} monthly cap is reached, so ORIGIN can't answer until next month.` };
  const task = nextTask(s);
  const recent = (s.asks || []).slice(0, 4).reverse().flatMap((a) => [{ role: 'user', content: a.q }, { role: 'assistant', content: a.a }]);
  const context = [
    'The owner is asking you a question in the console, outside your work window. Answer directly and briefly from what you know; you have no tools here and this does not count as a run. Do not propose tasks or agents here.',
    `OWNER CONSENT: the owner's plain words are approval, inside the $${CAP} monthly cap and the per-task budget. "allow etsy store to run", "go ahead", "yes do it", "1 dollar approval" all count; never ask them to repeat it in exact wording or to restate a scope. When their message approves work, say in one sentence what you will do, then end your answer with one line exactly like this: APPROVE {"title": "short task title", "detail": "what to do and what a good result looks like", "agentId": "id from AGENTS IN THE BRAIN NOW of the agent who should do it, or null for you", "budgetUsd": the dollar amount they named or null, "approveIds": ["ids of waiting proposals they approved"]}. Write that line only when they approved something. Ventures create the skill agents they need without asking; that never needs approval.`,
    'Old runs that failed with a 401 or "no API key" were before the owner set their key. The key works now (this answer proves it), so never say it is broken.',
    `Your current task: ${task ? `${task.title}: ${task.detail} (cost so far $${(task.spentUsd || 0).toFixed(3)} over ${(task.runCosts || []).length} runs)` : 'none approved yet'}.`,
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
      body: JSON.stringify({ model: MODEL, max_tokens: 1500, system: `${s.instructions}\n\n${context}`, messages: [...recent, { role: 'user', content: q }] }),
      signal: AbortSignal.timeout(60_000),
    });
    if (!r.ok) return { ok: false, reason: `The model service answered ${r.status}.` };
    data = await r.json();
  } catch (e) {
    return { ok: false, reason: e.name === 'TimeoutError' ? 'ORIGIN took too long to answer.' : 'Could not reach the model service.' };
  }
  const raw = (data.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('').trim();
  const consent = parseConsent(raw);
  const answer = raw.replace(/^\s*APPROVE\s*\{.*$/ms, '').trim() || (consent ? 'Approved. I will start on it in my next run.' : '(no answer)');
  const cost = costOf(MODEL, data.usage || {});
  // no await between this load and save, so a run in progress can't lose it
  const now = loadState(deps.file);
  rollMonth(now);
  const round = (n) => Math.round(n * 1e6) / 1e6;
  if (cost == null) now.ledger.unknownCostRuns++;
  else { now.ledger.spentUsd = round(now.ledger.spentUsd + cost); now.ledger.byAgent[AGENT_ID] = round((now.ledger.byAgent[AGENT_ID] || 0) + cost); }
  const approved = consent ? applyConsent(now, consent) : null;
  now.asks = [{ at: new Date().toISOString(), q, a: answer.slice(0, 4000), costUsd: cost, approved }, ...(now.asks || [])].slice(0, 20);
  saveState(now, deps.file);
  return { ok: true, answer, costUsd: cost, taskTitle: task?.title ?? null, approved };
}

function publicState() {
  const s = loadState(); rollMonth(s);
  return {
    configured: Boolean(KEY), model: MODEL, capUsd: CAP, everyMinutes: EVERY_MIN, maxMinutes: MAX_MIN, schedule: SCHEDULE,
    spentUsd: s.ledger.spentUsd, spentByAgent: s.ledger.byAgent, taskBudgetUsd: TASK_BUDGET_USD, unknownCostRuns: s.ledger.unknownCostRuns, month: s.ledger.month, running: running ? running.startedAt : null,
    synced: Boolean(s.instructions), asks: (s.asks || []).slice(0, 10), memory: s.memory, nextAction: s.nextAction, tasks: s.tasks, agentProposals: s.agentProposals, autoAgents: s.autoAgents !== false, skillFiles: s.skillFiles.filter((f) => f.status === 'new'), runs: s.runs.slice(0, 10),
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
    const s = loadState(); s.instructions = body.instructions;
    // the other agents' instructions and SKILL.md, so ORIGIN can work a task as one of them
    if (Array.isArray(body.agents)) {
      s.agents = body.agents.filter((a) => a && typeof a.id === 'string' && typeof a.name === 'string').slice(0, 100)
        .map((a) => ({ id: a.id.slice(0, 80), name: a.name.slice(0, 80), title: String(a.title || '').slice(0, 120), kind: String(a.kind || 'core'), ventureId: a.ventureId ? String(a.ventureId).slice(0, 80) : null, hasSkillFile: !!a.hasSkillFile, prompt: String(a.prompt || '').slice(0, 40_000) }));
    }
    saveState(s);
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
      const task = { id: newId('task'), title: body.title.trim().slice(0, 160), detail: String(body.detail || '').slice(0, 4000), status: 'approved', by: 'owner', createdAt: new Date().toISOString() };
      // a SKILL.md request for one agent; only one open request per agent
      if (body.kind === 'skill-file' && typeof body.agentId === 'string') {
        if (s.tasks.some((t) => t.kind === 'skill-file' && t.agentId === body.agentId && t.status === 'approved')) return send(req, res, 200, { ok: true, tasks: s.tasks });
        Object.assign(task, { kind: 'skill-file', agentId: body.agentId.slice(0, 80), agentName: String(body.agentName || body.agentId).slice(0, 80), version: Number(body.version) || 1 });
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
    return send(req, res, r.ok ? 200 : 409, r);
  }
  if (url === '/api/origin/settings') {
    // whether ORIGIN and its ventures create agents without asking (the owner's choice)
    const s = loadState();
    if (typeof body.autoAgents === 'boolean') s.autoAgents = body.autoAgents;
    saveState(s);
    return send(req, res, 200, { ok: true, autoAgents: s.autoAgents });
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
    .listen(PORT, '127.0.0.1', () => console.log(`[origin] listening on 127.0.0.1:${PORT} model=${MODEL} cap=$${CAP}/month window=${MAX_MIN} min every ${EVERY_MIN} min schedule=${SCHEDULE ? 'on' : 'off'} key=${KEY ? `set (${KEY_FROM})` : 'MISSING: run npm.cmd run set-key once, then start this again'}`));
  setInterval(tick, 60_000);
  setTimeout(tick, 5_000);
}
