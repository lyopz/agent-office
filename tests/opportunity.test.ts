// ORIGIN as the Opportunity Research and Builder Agent, nested branches and per-branch work windows.
import { describe, expect, test } from 'vitest';
import { creatorBrain } from '../src/model/sample';
import { applyOps } from '../src/engine/ops';
import { buildNerveTree } from '../src/brain/nerveTree';
import { OPPORTUNITY_PROMPT, branchKind, describeWindow, growKind, isOpportunityOrigin, opportunityOriginOps, ventureOf } from '../src/brain/opportunity';
import { exportOffice, parseOffice } from '../src/model/schema';
import type { OfficeDoc } from '../src/model/types';

const grow = (doc: OfficeDoc, id: string, parent: string) => {
  const kind = growKind(doc, parent);
  expect(kind).not.toBeNull();
  const r = applyOps(doc, [{ op: 'agent.createFromArchetype', archetype: 'custom', name: id.toUpperCase(), id }]);
  const u = applyOps(r.doc, [{ op: 'agent.update', id, patch: { branch: { kind: kind!, ventureId: kind === 'venture' ? id : parent }, skills: { supervisorId: parent }, schedule: { runWindow: { everyMinutes: 300, maxMinutes: 10, setBy: 'origin', reason: 'test' } } } }]);
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

  test('only ORIGIN starts ventures, a venture adds skills, and each grows the nerve map', () => {
    let doc = creatorBrain();
    expect(branchKind(doc, 'agent_origin')).toBe('root');
    expect(growKind(doc, 'agent_origin')).toBe('venture');
    // ORIGIN's starter staff can't grow branches
    expect(growKind(doc, 'agent_scout')).toBeNull();
    doc = grow(doc, 'agent_roblox', 'agent_origin');
    expect(growKind(doc, 'agent_roblox')).toBe('skill');
    doc = grow(doc, 'agent_3d', 'agent_roblox');
    doc = grow(doc, 'agent_ads', 'agent_roblox');
    // a skill agent can't add anyone, so it can't spin off another business
    expect(growKind(doc, 'agent_3d')).toBeNull();
    expect(ventureOf(doc, 'agent_3d')).toBe('agent_roblox');
    expect(ventureOf(doc, 'agent_roblox')).toBe('agent_roblox');
    const t = tree(doc);
    expect(t.nodes.agent_3d.parentId).toBe('agent_roblox');
    expect(t.nodes.agent_3d.depth).toBe(2);
    expect(t.bundles.some((b) => b.from === 'agent_roblox' && b.to === 'agent_ads')).toBe(true);
  });

  test('branch records and work windows survive save and load', () => {
    let doc = grow(creatorBrain(), 'agent_roblox', 'agent_origin');
    doc = grow(doc, 'agent_3d', 'agent_roblox');
    const loaded = parseOffice(JSON.parse(exportOffice(doc)));
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    expect(loaded.doc.agents.agent_3d.branch).toEqual({ kind: 'skill', ventureId: 'agent_roblox' });
    expect(growKind(loaded.doc, 'agent_3d')).toBeNull();
    expect(loaded.doc.agents.agent_3d.schedule.runWindow?.everyMinutes).toBe(300);
  });
});
