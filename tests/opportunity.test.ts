// ORIGIN as the Opportunity Research and Builder Agent, nested branches and per-branch work windows.
import { describe, expect, test } from 'vitest';
import { creatorBrain } from '../src/model/sample';
import { applyOps } from '../src/engine/ops';
import { buildNerveTree } from '../src/brain/nerveTree';
import { OPPORTUNITY_PROMPT, branchDepth, canGrowFrom, describeWindow, isOpportunityOrigin, opportunityOriginOps } from '../src/brain/opportunity';
import { exportOffice, parseOffice } from '../src/model/schema';
import type { OfficeDoc } from '../src/model/types';

const grow = (doc: OfficeDoc, id: string, parent: string) => {
  const r = applyOps(doc, [{ op: 'agent.createFromArchetype', archetype: 'custom', name: id.toUpperCase(), id }]);
  const u = applyOps(r.doc, [{ op: 'agent.update', id, patch: { skills: { supervisorId: parent }, schedule: { runWindow: { everyMinutes: 300, maxMinutes: 10, setBy: 'origin', reason: 'test' } } } }]);
  expect(u.errors).toEqual([]);
  return u.doc;
};
const tree = (doc: OfficeDoc) => buildNerveTree(Object.values(doc.agents).map((a) => ({ id: a.id, name: a.identity.name, supervisorId: a.skills.supervisorId, teamId: a.identity.department, color: '#fff' })));

describe('opportunity agent', () => {
  test('ORIGIN carries the owner prompt, its own hourly 10-minute window and an honest starting memory', () => {
    const doc = creatorBrain();
    const o = doc.agents.agent_origin;
    expect(isOpportunityOrigin(doc)).toBe(true);
    expect(o.identity.title).toBe('Opportunity Research & Builder Agent');
    expect(o.ai.agentInstructions.startsWith(OPPORTUNITY_PROMPT)).toBe(true);
    expect(o.ai.provider).toBe('simulated');
    expect(o.schedule.runWindow).toMatchObject({ everyMinutes: 60, maxMinutes: 10 });
    expect(doc.library.kb_opp_status.summary).toMatch(/allowance: none approved/i);
    expect(doc.library.kb_opp_ledger.summary).toMatch(/unknown/);
    // specialists get windows sized to their team
    expect(doc.agents.agent_scout.schedule.runWindow).toMatchObject({ everyMinutes: 300, maxMinutes: 10, setBy: 'origin' });
    expect(describeWindow(doc.agents.agent_scout.schedule.runWindow)).toBe('10 min every 5 h');
  });

  test('setting up an older save keeps what ORIGIN already recorded', () => {
    const doc = creatorBrain();
    const edited = applyOps(doc, [{ op: 'library.upsert', entry: { ...doc.library.kb_opp_backlog, summary: 'idea A' } }]).doc;
    const again = applyOps(edited, opportunityOriginOps(edited)).doc;
    expect(again.library.kb_opp_backlog.summary).toBe('idea A');
  });

  test('branches nest under any agent and each grows the nerve map', () => {
    let doc = creatorBrain();
    const deepest = Math.max(...Object.keys(doc.agents).map((id) => branchDepth(doc, id)));
    doc = grow(doc, 'agent_a', 'agent_origin');
    doc = grow(doc, 'agent_b', 'agent_a');
    doc = grow(doc, 'agent_c', 'agent_b');
    const t = tree(doc);
    expect(t.nodes.agent_c.parentId).toBe('agent_b');
    expect(t.nodes.agent_c.depth).toBe(3);
    expect(t.bundles.some((b) => b.from === 'agent_b' && b.to === 'agent_c')).toBe(true);
    expect(deepest).toBeGreaterThanOrEqual(3);
  });

  test('the branch depth limit decides where a new branch may grow, and survives save and load', () => {
    let doc = grow(creatorBrain(), 'agent_a', 'agent_origin');
    expect(doc.control.maxBranchDepth).toBeNull();
    expect(canGrowFrom(doc, 'agent_a')).toBe(true);
    doc = applyOps(doc, [{ op: 'control.update', patch: { maxBranchDepth: 1 } }]).doc;
    expect(canGrowFrom(doc, 'agent_origin')).toBe(true);
    expect(canGrowFrom(doc, 'agent_a')).toBe(false);
    const loaded = parseOffice(JSON.parse(exportOffice(doc)));
    expect(loaded.ok && loaded.doc.control.maxBranchDepth).toBe(1);
    expect(loaded.ok && loaded.doc.agents.agent_a.schedule.runWindow?.everyMinutes).toBe(300);
  });
});
