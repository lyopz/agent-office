// The brain shows only ORIGIN and the branches it grew; the other agents stay in the office.
import { describe, expect, test } from 'vitest';
import { creatorBrain } from '../src/model/sample';
import { brainAgents, treeOf } from '../src/brain/BrainScene';
import { teamsOf } from '../src/brain/connectome';

describe('brain agents', () => {
  test('only ORIGIN shows while it has no ventures, and no agent is removed', () => {
    const doc = creatorBrain();
    const before = Object.keys(doc.agents).length;
    expect(before).toBeGreaterThan(1);
    expect(brainAgents(doc.agents).map((a) => a.id)).toEqual(['agent_origin']);
    expect(Object.keys(treeOf(doc.agents, teamsOf(doc)).nodes)).toEqual(['agent_origin']);
    expect(Object.keys(doc.agents)).toHaveLength(before);
  });

  test('ventures and their skill agents grow as branches', () => {
    const doc = structuredClone(creatorBrain());
    const [a, b] = Object.values(doc.agents).filter((x) => x.id !== 'agent_origin');
    a.branch = { kind: 'venture', ventureId: a.id }; a.skills.supervisorId = 'agent_origin';
    b.branch = { kind: 'skill', ventureId: a.id }; b.skills.supervisorId = a.id;
    const tree = treeOf(doc.agents, teamsOf(doc));
    expect(Object.keys(tree.nodes).sort()).toEqual(['agent_origin', a.id, b.id].sort());
    expect(tree.nodes[b.id].parentId).toBe(a.id);
  });
});
