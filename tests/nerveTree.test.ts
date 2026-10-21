// The 3D brain: the nerve tree that grows from the main agent, and the brain mesh.
import { describe, expect, test } from 'vitest';
import { creatorBrain, sampleOffice } from '../src/model/sample';
import { CORE, buildNerveTree, insideCerebrum, pathToRoot, route, subtree, type TreeAgent } from '../src/brain/nerveTree';
import { buildBrainGeometry } from '../src/brain/brainMesh';
import type { OfficeDoc } from '../src/model/types';

const agentsOf = (doc: OfficeDoc): TreeAgent[] => Object.values(doc.agents).map((a) => ({
  id: a.id, name: a.identity.name, supervisorId: a.skills.supervisorId ?? null, teamId: a.identity.department, color: '#7cf0ff',
}));

describe('nerve tree', () => {
  test('the main agent sits at the core and every other agent is a bundle from the agent that made it', () => {
    const agents = agentsOf(creatorBrain());
    const tree = buildNerveTree(agents);
    expect(tree.rootId).toBe('agent_origin');
    expect(tree.nodes.agent_origin.pos).toEqual(CORE);
    expect(Object.keys(tree.nodes).sort()).toEqual(agents.map((a) => a.id).sort());
    expect(tree.bundles.filter((b) => b.id === 'trunk')).toHaveLength(1);
    for (const a of agents) {
      if (a.id === tree.rootId) continue;
      const b = tree.bundles.find((x) => x.id === a.id)!;
      expect(b.from).toBe(tree.nodes[a.id].parentId);
      if (a.supervisorId) expect(b.from).toBe(a.supervisorId);
      expect(b.strands.length).toBeGreaterThanOrEqual(3);
      expect(tree.nodes[a.id].depth).toBe(tree.nodes[b.from!].depth + 1);
    }
    expect(tree.maxDepth).toBeGreaterThanOrEqual(3);
  });

  test('a new agent grows a new branch off its creator and leaves the rest in place', () => {
    const agents = agentsOf(creatorBrain());
    const before = buildNerveTree(agents);
    const parent = agents.find((a) => a.id !== 'agent_origin')!;
    const after = buildNerveTree([...agents, { id: 'agent_new', name: 'NEW', supervisorId: parent.id, teamId: parent.teamId, color: '#ffffff' }]);
    expect(after.nodes.agent_new.parentId).toBe(parent.id);
    expect(after.nodes[parent.id].childIds).toContain('agent_new');
    expect(after.bundles).toHaveLength(before.bundles.length + 1);
  });

  test('the same agents always give the same tree, and every node stays inside the brain', () => {
    for (const doc of [creatorBrain(), sampleOffice()]) {
      const a = buildNerveTree(agentsOf(doc)), b = buildNerveTree(agentsOf(doc));
      expect(JSON.stringify(a)).toBe(JSON.stringify(b));
      for (const n of Object.values(a.nodes)) expect(insideCerebrum(n.pos)).toBeLessThan(1);
    }
  });

  test('cycles and missing supervisors are cut, and stray top-level agents hang off the root', () => {
    const tree = buildNerveTree([
      { id: 'agent_origin', name: 'ORIGIN', supervisorId: null, teamId: 't', color: '#fff' },
      { id: 'a', name: 'A', supervisorId: 'b', teamId: 't', color: '#fff' },
      { id: 'b', name: 'B', supervisorId: 'a', teamId: 't', color: '#fff' },
      { id: 'c', name: 'C', supervisorId: 'ghost', teamId: 't', color: '#fff' },
    ]);
    expect(tree.rootId).toBe('agent_origin');
    for (const id of ['a', 'b', 'c']) expect(pathToRoot(tree, id).at(-1)).toBe('agent_origin');
    expect(buildNerveTree([]).rootId).toBeNull();
  });

  test('paths, subtrees and handoff routes follow the tree', () => {
    const tree = buildNerveTree(agentsOf(creatorBrain()));
    const deep = Object.values(tree.nodes).sort((x, y) => y.depth - x.depth)[0];
    const path = pathToRoot(tree, deep.id);
    expect(path[0]).toBe(deep.id); expect(path.at(-1)).toBe('agent_origin');
    expect(subtree(tree, 'agent_origin').size).toBe(Object.keys(tree.nodes).length);
    const other = Object.values(tree.nodes).find((n) => n.depth >= 2 && !path.includes(n.id) && !path.includes(n.parentId!))!;
    const r = route(tree, deep.id, other.id);
    expect(r[0]).toBe(deep.id); expect(r.at(-1)).toBe(other.id);
    for (let i = 1; i < r.length; i++) {
      const [x, y] = [tree.nodes[r[i - 1]], tree.nodes[r[i]]];
      expect(x.parentId === y.id || y.parentId === x.id).toBe(true);
    }
  });
});

describe('brain mesh', () => {
  test('builds one smooth indexed mesh with a fold value per vertex', () => {
    const g = buildBrainGeometry(12);
    const pos = g.getAttribute('position'), fold = g.getAttribute('fold');
    expect(g.index).not.toBeNull();
    expect(pos.count).toBeGreaterThan(1000);
    expect(fold.count).toBe(pos.count);
    for (let i = 0; i < fold.count; i += 97) expect(Number.isFinite(fold.getX(i))).toBe(true);
  });
});

describe('brain regions', () => {
  test('every vertex carries a region colour from the atlas', async () => {
    const { REGIONS } = await import('../src/brain/brainMesh');
    const g = buildBrainGeometry(12);
    const tint = g.getAttribute('tint');
    expect(tint.count).toBe(g.getAttribute('position').count);
    expect(REGIONS.map((r) => r.id)).toEqual(['frontal', 'parietal', 'temporal', 'occipital', 'cerebellum', 'brainstem']);
    for (let i = 0; i < tint.count; i += 53) for (const v of [tint.getX(i), tint.getY(i), tint.getZ(i)]) { expect(v).toBeGreaterThanOrEqual(0); expect(v).toBeLessThanOrEqual(1); }
  });
});
