// JARVIS's head brain and the brains it builds. The head brain sits in the middle and oversees
// every other brain: each one is a business or task with its own agents, and JARVIS works their
// approved tasks whichever brain the owner has open. JARVIS designs a new brain's layout (its
// agents, the owner's library skills each gets, what to keep researching, first tasks) and keeps
// every brain growing through research, but nothing is built or changed until the owner says Yes.
const JARVIS = 'agent_origin';
export const BRAIN_PLAN_KIND = 'brain-plan';
export const BRAIN_EVOLVE_KIND = 'brain-evolve';
/** A brain is reviewed for growth at most once a day, so evolving never eats the monthly cap. */
export const EVOLVE_EVERY_MS = 24 * 3_600_000;
const SKILL_NAME = /^[a-z0-9][a-z0-9-]{0,60}$/;
const str = (v, n) => String(v ?? '').trim().slice(0, n);
const num = (v, lo, hi, d) => (Number.isFinite(Number(v)) ? Math.min(hi, Math.max(lo, Math.round(Number(v)))) : d);

const okAgent = (a) => a && typeof a.id === 'string' && typeof a.name === 'string';
/** An agent as the app sent it, tagged with the brain it lives in. */
export function cleanAgent(a, brainId, promptMax = 40_000) {
  return { id: a.id.slice(0, 80), name: a.name.slice(0, 80), title: str(a.title, 120), kind: String(a.kind || 'core'), ventureId: a.ventureId ? String(a.ventureId).slice(0, 80) : null, hasSkillFile: !!a.hasSkillFile, prompt: String(a.prompt || '').slice(0, promptMax), brainId: brainId || null };
}
const brainInfo = (b) => ({ name: str(b.brainName ?? b.name, 80) || 'Brain', head: b.head === true, lead: str(b.lead, 80) || 'jarvis', purpose: str(b.purpose, 600) });

/**
 * The app's check-in: the open brain's agents, plus every other brain's (body.brains), so JARVIS
 * can work a task in any brain. Open work follows its agent when the agent moved to another brain.
 */
export function syncBrains(s, body, at = new Date().toISOString()) {
  s.brains = { ...(s.brains || {}) };
  const openId = s.brainId || null;
  if (openId) s.brains[openId] = { ...(s.brains[openId] || {}), ...brainInfo(body), syncedAt: at };
  if (!Array.isArray(body.agents)) return;
  const open = body.agents.filter(okAgent).slice(0, 100).map((a) => cleanAgent(a, openId));
  if (openId) s.brains[openId].agents = open.filter((a) => a.id !== JARVIS).map((a) => ({ id: a.id, name: a.name }));
  let all = open;
  if (Array.isArray(body.brains)) {
    const keep = new Set(openId ? [openId] : []);
    for (const b of body.brains.slice(0, 30)) {
      if (!b || typeof b.id !== 'string' || !b.id || b.id === openId) continue;
      const id = b.id.slice(0, 80);
      keep.add(id);
      const agents = (Array.isArray(b.agents) ? b.agents : []).filter(okAgent).slice(0, 100).map((a) => cleanAgent(a, id, 20_000));
      s.brains[id] = { ...(s.brains[id] || {}), ...brainInfo(b), agents: agents.filter((a) => a.id !== JARVIS).map((a) => ({ id: a.id, name: a.name })), syncedAt: at };
      all = [...all, ...agents.filter((a) => a.id !== JARVIS && !all.some((x) => x.id === a.id))];
    }
    // a brain the owner deleted is gone, and so is its waiting work
    for (const id of Object.keys(s.brains)) if (!keep.has(id)) delete s.brains[id];
  }
  s.agents = all;
  const home = new Map(all.map((a) => [a.id, a.brainId]));
  for (const t of s.tasks || []) {
    const h = t.agentId ? home.get(t.agentId) : null;
    if (h && t.brainId !== h && ['approved', 'proposed'].includes(t.status)) t.brainId = h;
  }
}

/** The brain an agent lives in, or null. */
export const brainOfAgent = (s, agentId) => (s.agents || []).find((a) => a.id === agentId)?.brainId ?? null;
/** The head brain's id (JARVIS's), or null before the app has said which it is. */
export const headBrainId = (s) => Object.entries(s.brains || {}).find(([, b]) => b.head)?.[0] ?? null;

/** What JARVIS oversees, for every brief: each brain, what it is for, who runs it and how busy it is. */
export function brainsBrief(s) {
  const list = Object.entries(s.brains || {});
  if (list.length < 2 && !list.some(([, b]) => b.head)) return '';
  const nameOf = (id) => (s.agents || []).find((a) => a.id === id)?.name ?? id;
  const lines = list.sort(([, a], [, b]) => Number(!!b.head) - Number(!!a.head)).map(([id, b]) => {
    const open = (s.tasks || []).filter((t) => t.brainId === id && t.status === 'approved').length;
    return `- [${id}] ${b.name}${b.head ? ' (YOUR HEAD BRAIN, in the middle)' : ''}: ${b.purpose || 'no purpose written yet'}. ${b.head ? 'You run it.' : b.lead && b.lead !== 'jarvis' ? `Run by ${nameOf(b.lead)}; you oversee it.` : 'Run by you (JARVIS) until the owner hooks up another agent.'} ${(b.agents || []).length} agents, ${open} open tasks${s.brainId === id ? ', open in the app now' : ''}.`;
  });
  return `BRAINS YOU OVERSEE: you are JARVIS, the head brain in the middle. Each other brain is one business or task with its own agents, and you work its approved tasks whichever brain is open. You hold the owner's whole skill library and pass each brain only the skills that fit it. A new brain, or a new agent or skill for one, is built only after the owner says Yes to its layout.\n${lines.join('\n')}`;
}

/** The brain whose tasks an agent-less task is worked as: the brain's lead when the owner hooked one up, else JARVIS. */
export function leadOf(s, task) {
  const b = task?.brainId ? s.brains?.[task.brainId] : null;
  return b && b.lead && b.lead !== 'jarvis' ? (s.agents || []).find((a) => a.id === b.lead) ?? null : null;
}

const AGENT_SHAPE = '{"name": "...", "specialty": "its role in a few words", "skill": "a team: Research, Creative, Advertising, Engineering, Product, Quality, Finance or Community", "purpose": "two or three sentences", "degenSkills": ["library skill names that fit its job"], "everyMinutes": 240, "maxMinutes": 5}';
const libraryLine = (cat) => cat?.skills?.length ? `THE OWNER'S SKILL LIBRARY (lyopz/degen-skill, ${cat.skills.length} skills; you hold them all, give each agent only the ones that fit its job): ${cat.skills.map((k) => k.name).join(', ')}.` : 'The owner\'s skill library is not reachable right now; leave degenSkills empty.';

/** The extra brief for a build-a-brain or evolve task. */
export function brainTaskBrief(s, task, cat) {
  if (task?.kind === BRAIN_PLAN_KIND) return `\nBUILD A BRAIN (the owner asked for it): design a new brain for: ${task.ask || task.title}. Research what this business or task needs to earn money or get done now (current sources with dates). The brain gets one venture agent for itself, named after it; you design its skill agents (2 to 6, only what the work truly needs, no two doing the same job), which library skills each one carries, what the brain should keep researching so it gets better over time, and 1 to 3 first tasks. ${libraryLine(cat)}\nNothing is created until the owner says Yes, so do not create agents or tasks this run: return the layout in the JSON as "brainPlan": {"name": "a short brain name", "purpose": "two sentences: what it does and how it earns or saves", "research": ["what to keep researching"], "agents": [${AGENT_SHAPE}], "firstTasks": [{"title": "...", "detail": "...", "agent": "one of your agent names"}], "reason": "one sentence on what it earns or saves, with the evidence"}, and list this task in completedTaskIds.`;
  if (task?.kind === BRAIN_EVOLVE_KIND) {
    const b = s.brains?.[task.brainId];
    if (!b) return '';
    const team = (s.agents || []).filter((a) => a.brainId === task.brainId && a.id !== JARVIS);
    const done = (s.tasks || []).filter((t) => t.brainId === task.brainId && t.status === 'done' && t.id !== task.id).slice(-8);
    return `\nEVOLVE THE "${b.name}" BRAIN: ${b.purpose || '(no purpose written yet)'}. Its agents: ${team.map((a) => `${a.name} (${a.title || 'agent'})`).join('; ') || 'none yet'}. Recent finished work: ${done.map((t) => `"${t.title}"${t.notes ? `: ${String(t.notes).slice(0, 200)}` : ''}`).join('; ') || 'none yet'}. Research (current sources with dates) what would make this brain earn more or work better now: a missing skill agent, a library skill an agent should carry, something to research next. Propose only what clearly pays off; an empty change is a fine answer. ${libraryLine(cat)}\nReturn in the JSON "brainChange": {"brainId": "${task.brainId}", "note": "what you found, with sources and dates", "addAgents": [${AGENT_SHAPE}] (at most 2), "addDegenSkills": [{"skill": "library skill name", "agents": ["agent names in this brain"]}], "research": ["the updated research list"]}, and list this task in completedTaskIds. The owner says Yes or No to it; nothing changes before that.`;
  }
  return '';
}

function cleanAgents(list, max) {
  return (Array.isArray(list) ? list : []).filter((a) => a && typeof a === 'object' && str(a.name, 60)).slice(0, max).map((a) => ({
    name: str(a.name, 60), specialty: str(a.specialty, 200) || str(a.skill, 40) || 'Research', skill: str(a.skill, 40) || 'Research', purpose: str(a.purpose, 1000),
    degenSkills: (Array.isArray(a.degenSkills) ? a.degenSkills : []).map((k) => String(k).trim().toLowerCase()).filter((k) => SKILL_NAME.test(k)).slice(0, 8),
    everyMinutes: num(a.everyMinutes, 15, 10_080, 240), maxMinutes: num(a.maxMinutes, 1, 60, 5),
  })).filter((a, i, all) => all.findIndex((b) => b.name.toLowerCase() === a.name.toLowerCase()) === i);
}

/** A layout JARVIS returned for a brain task, saved for the owner's Yes or No. */
export function takeBrainOutput(s, task, out, at = new Date().toISOString()) {
  if (!task || !out) return null;
  s.brainProposals ??= [];
  let p = null;
  if (task.kind === BRAIN_PLAN_KIND && out.brainPlan && typeof out.brainPlan === 'object') {
    const b = out.brainPlan;
    const agents = cleanAgents(b.agents, 6);
    if (!str(b.name, 60) || !agents.length) return null;
    p = { id: `brainp_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, kind: 'new', taskId: task.id, name: str(b.name, 60), purpose: str(b.purpose, 1000), research: (Array.isArray(b.research) ? b.research : []).map((x) => str(x, 300)).filter(Boolean).slice(0, 8), agents,
      firstTasks: (Array.isArray(b.firstTasks) ? b.firstTasks : []).filter((t) => t && str(t.title, 160)).slice(0, 3).map((t) => ({ title: str(t.title, 160), detail: str(t.detail, 1000), agent: str(t.agent, 60) })),
      reason: str(b.reason, 400), ask: task.ask || '', status: 'proposed', createdAt: at };
  } else if (task.kind === BRAIN_EVOLVE_KIND && out.brainChange && typeof out.brainChange === 'object') {
    const c = out.brainChange;
    const brain = s.brains?.[task.brainId];
    const addAgents = cleanAgents(c.addAgents, 2);
    const addDegenSkills = (Array.isArray(c.addDegenSkills) ? c.addDegenSkills : []).filter((x) => x && SKILL_NAME.test(String(x.skill || '').toLowerCase())).slice(0, 6).map((x) => ({ skill: String(x.skill).toLowerCase(), agents: (Array.isArray(x.agents) ? x.agents : []).map((n) => str(n, 60)).filter(Boolean).slice(0, 10) }));
    if (brain) {
      brain.research = (Array.isArray(c.research) ? c.research : brain.research || []).map((x) => str(x, 300)).filter(Boolean).slice(0, 8);
      brain.lastNote = str(c.note, 1000);
    }
    if (!brain || (!addAgents.length && !addDegenSkills.length)) return null;
    p = { id: `brainp_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, kind: 'change', taskId: task.id, brainId: task.brainId, name: brain.name, note: str(c.note, 1000), research: brain.research, addAgents, addDegenSkills, status: 'proposed', createdAt: at };
  }
  if (!p) return null;
  s.brainProposals.push(p);
  s.brainProposals = s.brainProposals.slice(-40);
  task.status = 'done'; task.doneAt = at;
  return p;
}

/** The owner asked JARVIS to build a brain: a task JARVIS works next, which ends in a layout to approve. */
export function planBrainTask(s, ask, at = new Date().toISOString()) {
  const text = str(ask, 600);
  if (!text) return null;
  const open = (s.tasks || []).find((t) => t.kind === BRAIN_PLAN_KIND && t.status === 'approved' && t.ask === text);
  if (open) return open;
  const headId = headBrainId(s);
  const task = { id: `task_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, kind: BRAIN_PLAN_KIND, ask: text, title: `Design a brain for: ${text}`.slice(0, 160), detail: 'Research and design the layout; the owner approves it before anything is built.', status: 'approved', by: 'owner', via: 'brains', focus: true, createdAt: at, ...(headId ? { brainId: headId } : {}) };
  s.tasks.push(task);
  return task;
}

/** Once a day per brain: JARVIS researches how one brain could grow (the brain reviewed longest ago goes first). */
export function queueEvolve(s, { approve, now = Date.now(), brainId = null, by = 'origin' } = {}) {
  if ((s.tasks || []).some((t) => t.kind === BRAIN_EVOLVE_KIND && ['approved', 'proposed'].includes(t.status) && (!brainId || t.brainId === brainId))) return null;
  const due = Object.entries(s.brains || {})
    .filter(([id, b]) => !b.head && (brainId ? id === brainId : now - Date.parse(b.evolvedAt || 0) >= EVOLVE_EVERY_MS))
    .sort(([, a], [, b]) => String(a.evolvedAt || '').localeCompare(String(b.evolvedAt || '')));
  if (!due.length) return null;
  const [id, b] = due[0];
  b.evolvedAt = new Date(now).toISOString();
  const task = { id: `task_${now.toString(36)}${Math.random().toString(36).slice(2, 6)}`, kind: BRAIN_EVOLVE_KIND, brainId: id, title: `Evolve the ${b.name} brain`, detail: 'Research what would make this brain earn more or work better, and propose changes for the owner to approve.', status: approve ? 'approved' : 'proposed', by, createdAt: new Date(now).toISOString() };
  s.tasks.push(task);
  return task;
}

/** What the app shows about the brains: the open one, the others, and the layouts waiting for a Yes. */
export function brainsPublic(s) {
  return {
    id: s.brainId || null,
    head: headBrainId(s),
    others: Object.entries(s.brains || {}).filter(([id]) => id !== s.brainId).map(([id, b]) => ({ id, name: b.name, head: !!b.head, lead: b.lead || 'jarvis', purpose: b.purpose || '', agents: (b.agents || []).length, openTasks: (s.tasks || []).filter((t) => t.brainId === id && t.status === 'approved').length, evolvedAt: b.evolvedAt || null, lastNote: b.lastNote || '' })),
  };
}
