// Ideas grow the brain: open ideas sprout buds, and growing one adds an agent under the main agent.
import { describe, expect, test } from 'vitest';
import { creatorBrain } from '../src/model/sample';
import { applyOps } from '../src/engine/ops';
import { buildNerveTree, ideaSprouts, insideCerebrum } from '../src/brain/nerveTree';
import { GROWN, growIdeaOps, ideaAgentName, openIdeas, ownerIdeaOps, suggestIdeaOps, treeIdeas } from '../src/brain/ideas';
import type { OfficeDoc } from '../src/model/types';

const tree = (doc: OfficeDoc) => buildNerveTree(Object.values(doc.agents).map((a) => ({ id: a.id, name: a.identity.name, supervisorId: a.skills.supervisorId ?? null, teamId: a.identity.department, color: '#fff' })));
const run = (doc: OfficeDoc, ops: Parameters<typeof applyOps>[1]) => { const r = applyOps(doc, ops); expect(r.errors).toEqual([]); return r.doc; };

describe('ideas', () => {
  test('owner and suggested ideas become open ideas with a bud on the brain', () => {
    let doc = creatorBrain();
    const before = openIdeas(doc).length;
    doc = run(doc, ownerIdeaOps('A Roblox obby kit that creators can reskin', 'agent_origin'));
    doc = run(doc, suggestIdeaOps(doc, 'agent_origin'));
    const open = openIdeas(doc);
    expect(open).toHaveLength(before + 2);
    const suggested = open.find((e) => e.tags.includes('agent-proposed'))!;
    expect(suggested.tags).toContain('simulated');
    expect(suggested.summary).toMatch(/simulated suggestion/i);
    const buds = ideaSprouts(tree(doc), treeIdeas(doc));
    expect(buds).toHaveLength(open.length);
    for (const b of buds) { expect(b.from).toBe('agent_origin'); expect(insideCerebrum(b.pos)).toBeLessThan(0.95); expect(b.strands.length).toBeGreaterThan(0); }
    expect(JSON.stringify(ideaSprouts(tree(doc), treeIdeas(doc)))).toBe(JSON.stringify(buds));
  });

  test('growing an idea adds an agent under the main agent and closes the idea', () => {
    let doc = creatorBrain();
    doc = run(doc, ownerIdeaOps('A sourced weekly trend brief', 'agent_origin'));
    const idea = openIdeas(doc).at(-1)!;
    const { agentId, name, ops } = growIdeaOps(doc, idea, 'agent_origin');
    doc = run(doc, ops);
    expect(doc.agents[agentId].identity.name).toBe(name);
    expect(doc.agents[agentId].skills.supervisorId).toBe('agent_origin');
    expect(doc.agents[agentId].ai.provider).toBe('simulated');
    expect(doc.library[idea.id].tags).toContain(`${GROWN}${agentId}`);
    expect(openIdeas(doc).some((e) => e.id === idea.id)).toBe(false);
    expect(tree(doc).nodes[agentId].parentId).toBe('agent_origin');
  });

  test('agent names come from the idea and never repeat', () => {
    expect(ideaAgentName('A sourced weekly trend brief', new Set())).toBe('SOURCED');
    expect(ideaAgentName('A sourced weekly trend brief', new Set(['SOURCED']))).toBe('SOURCED-2');
    expect(ideaAgentName('!!', new Set())).toBe('SPARK');
  });
});
