// Ideas are how the main agent grows. An idea is a library entry tagged
// `idea` (or `idea-review`, from the Creator Desk), either the owner's or one
// the main agent proposes. Each open idea sprouts a bud on the brain; growing
// it (with the owner's approval) creates a new agent under the main agent,
// and the bud becomes a full nerve branch.
import type { DocOp } from '../engine/ops';
import type { KnowledgeEntry, OfficeDoc } from '../model/types';
import type { TreeIdea } from './nerveTree';

export const GROWN = 'grown:';
const isIdea = (e: KnowledgeEntry) => e.tags.includes('idea') || e.tags.includes('idea-review');

/** Open ideas (not yet grown into an agent), oldest first. Sensitive entries are left out. */
export function openIdeas(doc: Pick<OfficeDoc, 'library'>): KnowledgeEntry[] {
  return Object.values(doc.library)
    .filter((e) => isIdea(e) && !e.sensitive && !e.tags.some((t) => t.startsWith(GROWN)))
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
}

export const byOwner = (e: KnowledgeEntry) => e.tags.includes('owner-submitted');
export function treeIdeas(doc: Pick<OfficeDoc, 'library'>): TreeIdea[] {
  return openIdeas(doc).map((e) => ({ id: e.id, title: e.title, authorId: byOwner(e) ? null : e.authorAgentId, byOwner: byOwner(e) }));
}

const entry = (id: string, title: string, summary: string, tags: string[], authorAgentId: string | null): KnowledgeEntry => ({
  id, title, summary, topic: 'ideas', tags, sources: [], createdAt: new Date().toISOString(), authorAgentId, projectId: null,
  confidence: 0, verification: 'unverified', sensitive: false, allowedAgentIds: [],
});
const newId = () => `idea_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;

/** The owner's idea, attached to the main agent. */
export function ownerIdeaOps(text: string, rootId: string | null): DocOp[] {
  const t = text.trim();
  const title = t.length > 64 ? `${t.slice(0, 61).trimEnd()}…` : t;
  return [{ op: 'library.upsert', entry: entry(newId(), title, t, ['idea', 'owner-submitted'], rootId) }];
}

const SEEDS = [
  ['A sourced weekly trend brief', 'for a niche the research team already covers'],
  ['A starter template pack', 'built from the work the creative team keeps repeating'],
  ['A checklist tool', 'that turns the quality team’s review steps into something people can reuse'],
  ['A small paid newsletter', 'on the topics the library holds the most notes about'],
  ['An onboarding guide', 'for the workflow the operations lead routes most often'],
  ['A comparison page', 'for the tools the engineering team evaluates'],
  ['A feedback digest', 'that turns community notes into product fixes'],
  ['A cost calculator', 'from the assumptions the finance team already tracks'],
];

/**
 * An idea the main agent proposes. With no live model connected this is a
 * simulated suggestion picked from starter patterns, and it says so.
 */
export function suggestIdeaOps(doc: Pick<OfficeDoc, 'library' | 'agents'>, rootId: string): DocOp[] {
  const taken = new Set(Object.values(doc.library).map((e) => e.title));
  const name = doc.agents[rootId]?.identity.name ?? 'The main agent';
  const pick = SEEDS.find(([t]) => !taken.has(t)) ?? SEEDS[Object.keys(doc.library).length % SEEDS.length];
  const summary = `${name} suggests: ${pick[0].toLowerCase()} ${pick[1]}. This is a simulated suggestion from a starter pattern, not market research. Research demand, competitors and costs before treating it as an opportunity.`;
  return [{ op: 'library.upsert', entry: entry(newId(), taken.has(pick[0]) ? `${pick[0]} (${taken.size + 1})` : pick[0], summary, ['idea', 'agent-proposed', 'simulated'], rootId) }];
}

/** A short agent name from an idea title, e.g. "A sourced weekly trend brief" → "TREND". */
export function ideaAgentName(title: string, taken: Set<string>) {
  const words = title.toUpperCase().replace(/[^A-Z0-9 ]/g, ' ').split(/\s+/).filter((w) => w.length > 3 && !['WITH', 'FROM', 'THAT', 'THIS', 'INTO', 'YOUR', 'SMALL', 'STARTER'].includes(w));
  const base = (words.sort((a, b) => b.length - a.length)[0] ?? 'SPARK').slice(0, 10);
  let name = base, i = 2;
  while (taken.has(name)) name = `${base}-${i++}`;
  return name;
}

/** Grow an idea into a new agent under `parentId`; the idea is marked grown so its bud becomes the branch. */
export function growIdeaOps(doc: Pick<OfficeDoc, 'agents'>, idea: KnowledgeEntry, parentId: string): { agentId: string; name: string; ops: DocOp[] } {
  const agentId = `agent_idea_${idea.id.replace(/[^a-z0-9]/gi, '').slice(-10)}`;
  const name = ideaAgentName(idea.title, new Set(Object.values(doc.agents).map((a) => a.identity.name)));
  const parent = doc.agents[parentId];
  const brief = `Own this idea: ${idea.summary}\n\nStart with research: current demand, competitors, costs and the smallest cheap test. Cite sources with dates. Never spend, publish, contact people externally or create accounts without owner approval.`;
  return {
    agentId, name,
    ops: [
      { op: 'agent.createFromArchetype', archetype: 'custom', name, id: agentId },
      { op: 'agent.update', id: agentId, patch: {
        identity: { title: `Idea lead: ${idea.title}`, department: parent?.identity.department ?? 'Command', bio: idea.summary, roleDescription: brief },
        skills: { primaryRole: 'Idea lead', supervisorId: parentId, skills: ['idea research', 'experiment design'], tools: ['web-research', 'library-search', 'reports'], taskPermissions: ['draft', 'research', 'recommend'] },
        permissions: { allowedTools: ['web-research', 'library-search', 'reports'], requireApprovalFor: ['spend', 'publish', 'external-message', 'create-account', 'delete'] },
        ai: { provider: 'simulated', executionMode: 'manual-approval', agentInstructions: brief },
      } },
      { op: 'library.upsert', entry: { ...idea, tags: [...idea.tags, `${GROWN}${agentId}`] } },
    ],
  };
}
