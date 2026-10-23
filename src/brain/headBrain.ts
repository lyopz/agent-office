// JARVIS's head brain: the brain in the middle that builds and oversees every other brain. Each
// other brain is one business or task with its own agents. JARVIS designs a brain's layout from the
// owner's ask (agents, the library skills each carries, what to keep researching), the owner says
// Yes, and the app builds it here. A venture that grew up inside the head brain (the Etsy store)
// moves out into a brain of its own, still run by JARVIS until the owner hooks up another agent.
import { applyOps } from '../engine/ops';
import type { BrainPlan, OfficeDoc } from '../model/types';
import { CREATOR_BRAIN_ID, creatorBrain } from '../model/sample';
import { ORIGIN_ID, VENTURE_TEAM, branchAgentOps, suggestedWindow } from './opportunity';
import { skillFileId } from './originSkillFile';

export const newBrainId = () => `brain_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

/** Which brain is JARVIS's head: one already marked, else the original brain, else the one with the most agents (never a brain JARVIS built). */
export function pickHeadId(docs: Pick<OfficeDoc, 'id' | 'head' | 'plan' | 'agents'>[]): string | null {
  const marked = docs.find((d) => d.head);
  if (marked) return marked.id;
  const free = docs.filter((d) => !d.plan);
  return (free.find((d) => d.id === CREATOR_BRAIN_ID) ?? [...free].sort((a, b) => Object.keys(b.agents).length - Object.keys(a.agents).length)[0])?.id ?? null;
}

const STORE = /etsy|store|shop|merch|shirt|\btees?\b|apparel|print/i;
/** The store venture in a brain, the Etsy one first; null when there is none. */
export function storeVentureIn(doc: OfficeDoc): string | null {
  const ventures = Object.values(doc.agents).filter((a) => a.branch?.kind === 'venture');
  const text = (a: (typeof ventures)[number]) => `${a.identity.name} ${a.identity.title} ${a.identity.bio}`;
  return (ventures.find((a) => /etsy/i.test(text(a))) ?? ventures.find((a) => STORE.test(text(a))))?.id ?? null;
}

/** A venture and the skill agents that work for it. */
export function ventureTeam(doc: OfficeDoc, ventureId: string): string[] {
  if (doc.agents[ventureId]?.branch?.kind !== 'venture') return [];
  return [ventureId, ...Object.values(doc.agents).filter((a) => a.branch?.kind === 'skill' && a.branch.ventureId === ventureId).map((a) => a.id)];
}

/** An empty brain with the head brain's JARVIS (same instructions), its look and the built-in playbooks. */
function blankBrain(head: OfficeDoc, id: string, name: string, plan: BrainPlan): OfficeDoc {
  const base = clone(creatorBrain());
  const look = clone(head.appearance);
  delete look.brainColors.main; // each brain picks its own colour in the brain universe
  return { ...base, id, name: name.trim().slice(0, 80) || 'New brain', head: false, plan, appearance: look, agents: { [ORIGIN_ID]: clone(head.agents[ORIGIN_ID] ?? base.agents[ORIGIN_ID]) } };
}

/**
 * Move a venture and its skill agents out of the head brain into a new brain of their own. The
 * agents keep their ids, instructions, SKILL.md and bank skills, so the runner's tasks, designs and
 * sales stay theirs. JARVIS runs the new brain until the owner hooks up another agent.
 */
export function splitVenture(head: OfficeDoc, ventureId: string, opts: { id?: string; name?: string; at?: string } = {}): { brain: OfficeDoc; head: OfficeDoc } | { error: string } {
  const team = ventureTeam(head, ventureId);
  if (!team.length) return { error: 'That is not a venture in this brain.' };
  const v = head.agents[ventureId];
  const at = opts.at ?? new Date().toISOString();
  const brain = blankBrain(head, opts.id ?? newBrainId(), opts.name ?? v.identity.name, {
    purpose: (v.identity.bio || v.identity.title).slice(0, 1000), lead: 'jarvis', createdBy: 'jarvis', createdAt: at, fromVenture: ventureId,
    research: [], history: [{ at, note: `Moved out of ${head.name} with ${team.length} agents; JARVIS runs it until the owner hooks up another agent.` }],
  });
  const ids = new Set(team);
  for (const id of team) brain.agents[id] = clone(head.agents[id]);
  // the skills they use come with them; their own SKILL.md files leave the head brain
  const used = new Set(team.flatMap((id) => head.agents[id].bankSkills ?? []));
  for (const k of head.skillBank) if (used.has(k.id) && !brain.skillBank.some((x) => x.id === k.id)) brain.skillBank.push(clone(k));
  brain.skillRequests = clone(head.skillRequests.filter((r) => r.ventureId === ventureId));
  for (const [pid, p] of Object.entries(head.projects)) if (p.ownerAgentId && ids.has(p.ownerAgentId)) brain.projects[pid] = clone(p);
  for (const [kid, e] of Object.entries(head.library)) if (e.authorAgentId && ids.has(e.authorAgentId)) brain.library[kid] = clone(e);
  const own = new Set(team.map(skillFileId));
  const left = clone(head);
  for (const id of team) delete left.agents[id];
  left.skillBank = left.skillBank.filter((k) => !own.has(k.id));
  left.skillRequests = left.skillRequests.filter((r) => r.ventureId !== ventureId);
  for (const pid of Object.keys(brain.projects)) delete left.projects[pid];
  left.head = true;
  return { brain, head: left };
}

/** Put a brain's agents and skills back into the head brain (the way to undo a move). */
export function mergeIntoHead(head: OfficeDoc, brain: OfficeDoc): OfficeDoc {
  const out = clone(head);
  for (const [id, a] of Object.entries(brain.agents)) if (id !== ORIGIN_ID) out.agents[id] = clone(a);
  for (const k of brain.skillBank) if (!out.skillBank.some((x) => x.id === k.id)) out.skillBank.push(clone(k));
  for (const r of brain.skillRequests) if (!out.skillRequests.some((x) => x.id === r.id)) out.skillRequests.push(clone(r));
  for (const [pid, p] of Object.entries(brain.projects)) out.projects[pid] ??= clone(p);
  for (const [kid, e] of Object.entries(brain.library)) out.library[kid] ??= clone(e);
  return out;
}

/** An agent in a layout JARVIS designed (see server/brains.mjs). */
export interface PlannedAgent { name: string; specialty: string; skill: string; purpose: string; degenSkills: string[]; everyMinutes: number; maxMinutes: number }
/** A layout waiting for the owner: a new brain, or a change to one. */
export interface BrainProposal {
  id: string; kind: 'new' | 'change'; status: 'proposed' | 'approved' | 'rejected'; createdAt: string; taskId?: string;
  name: string; purpose?: string; research?: string[]; reason?: string; ask?: string; note?: string;
  agents?: PlannedAgent[]; firstTasks?: { title: string; detail: string; agent: string }[];
  brainId?: string; addAgents?: PlannedAgent[]; addDegenSkills?: { skill: string; agents: string[] }[];
}

const agentId = (name: string) => `agent_${name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 30) || 'new'}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
const windowOf = (a: PlannedAgent) => ({ everyMinutes: a.everyMinutes, maxMinutes: a.maxMinutes, setBy: 'origin' as const, reason: 'From the brain layout JARVIS designed and the owner approved.' });

/** The skill agents of a layout, added under a venture; ids by lowercase name for the runner. */
function addAgents(doc: OfficeDoc, ventureId: string, agents: PlannedAgent[]): { doc: OfficeDoc; ids: Record<string, string>; errors: string[] } {
  const ids: Record<string, string> = {};
  const errors: string[] = [];
  let d = doc;
  for (const a of agents) {
    if (Object.values(d.agents).some((x) => x.identity.name.toLowerCase() === a.name.toLowerCase())) { errors.push(`${a.name} is already in the brain`); continue; }
    const id = agentId(a.name);
    const { ops, error } = branchAgentOps(d, ventureId, { id, name: a.name, specialty: a.specialty, purpose: a.purpose, skill: a.skill, window: windowOf(a) });
    const r = error ? null : applyOps(d, ops);
    if (!r || r.errors.length) { errors.push(`${a.name}: ${error ?? r?.errors.join('; ')}`); continue; }
    d = r.doc; ids[a.name.toLowerCase()] = id;
  }
  return { doc: d, ids, errors };
}

/** Build the brain an approved layout describes: JARVIS, a venture for the brain itself, and its skill agents. */
export function buildPlannedBrain(head: OfficeDoc, p: BrainProposal, opts: { id?: string; at?: string } = {}): { doc: OfficeDoc; agentIds: Record<string, string>; errors: string[] } {
  const at = opts.at ?? new Date().toISOString();
  const doc = blankBrain(head, opts.id ?? newBrainId(), p.name, {
    purpose: (p.purpose || p.ask || p.name).slice(0, 1000), lead: 'jarvis', createdBy: 'jarvis', createdAt: at, research: (p.research ?? []).slice(0, 20),
    history: [{ at, note: `JARVIS designed it${p.ask ? ` for "${p.ask.slice(0, 200)}"` : ''}; the owner approved ${p.agents?.length ?? 0} agents.` }],
  });
  const ventureId = agentId(p.name);
  const v = branchAgentOps(doc, ORIGIN_ID, { id: ventureId, name: p.name, specialty: (p.purpose || p.name).slice(0, 120), purpose: p.purpose || p.name, skill: VENTURE_TEAM, window: suggestedWindow(VENTURE_TEAM) });
  const r = v.error ? null : applyOps(doc, v.ops);
  if (!r || r.errors.length) return { doc, agentIds: {}, errors: [v.error ?? r?.errors.join('; ') ?? 'could not add the venture'] };
  const out = addAgents(r.doc, ventureId, p.agents ?? []);
  return { doc: out.doc, agentIds: { [p.name.toLowerCase()]: ventureId, ...out.ids }, errors: out.errors };
}

/** Apply an approved change to a brain: new skill agents under its lead venture (or its first venture). */
export function applyBrainChange(doc: OfficeDoc, p: BrainProposal, at = new Date().toISOString()): { doc: OfficeDoc; agentIds: Record<string, string>; errors: string[] } {
  const lead = doc.plan?.lead && doc.agents[doc.plan.lead]?.branch?.kind === 'venture' ? doc.plan.lead : Object.values(doc.agents).find((a) => a.branch?.kind === 'venture')?.id;
  if ((p.addAgents ?? []).length && !lead) return { doc, agentIds: {}, errors: ['This brain has no venture to add agents to.'] };
  const out = lead ? addAgents(doc, lead, p.addAgents ?? []) : { doc, ids: {}, errors: [] };
  const d = clone(out.doc);
  if (d.plan) {
    if (p.research?.length) d.plan.research = p.research.slice(0, 20);
    d.plan.history = [...d.plan.history, { at, note: `Grew: ${[...(p.addAgents ?? []).map((a) => `new agent ${a.name}`), ...(p.addDegenSkills ?? []).map((g) => `${g.skill} for ${g.agents.join(', ')}`)].join('; ') || 'research updated'}.` }].slice(-200);
  }
  return { doc: d, agentIds: out.ids, errors: out.errors };
}

/** The brain handed to one of its agents, or back to JARVIS. */
export function withLead(doc: OfficeDoc, lead: string): { doc: OfficeDoc } | { error: string } {
  if (!doc.plan) return { error: doc.head ? 'JARVIS always runs its head brain.' : 'This brain has no plan yet.' };
  if (lead !== 'jarvis' && (!doc.agents[lead] || lead === ORIGIN_ID)) return { error: 'Pick one of this brain\'s agents.' };
  const d = clone(doc);
  const at = new Date().toISOString();
  d.plan!.lead = lead === ORIGIN_ID ? 'jarvis' : lead;
  d.plan!.history = [...d.plan!.history, { at, note: lead === 'jarvis' ? 'JARVIS runs it again.' : `${doc.agents[lead].identity.name} runs it now; JARVIS oversees.` }].slice(-200);
  return { doc: d };
}

