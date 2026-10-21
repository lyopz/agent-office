// ORIGIN as the Opportunity Research and Builder Agent, nested branches and per-branch work windows.
import { describe, expect, test } from 'vitest';
import { creatorBrain } from '../src/model/sample';
import { applyOps } from '../src/engine/ops';
import { buildNerveTree } from '../src/brain/nerveTree';
import { AGENT_BLUEPRINT, OPPORTUNITY_PROMPT, branchAgentOps, branchKind, describeWindow, growKind, isOpportunityOrigin, opportunityOriginOps, ventureOf } from '../src/brain/opportunity';
import { exportOffice, parseOffice } from '../src/model/schema';
import type { OfficeDoc } from '../src/model/types';

const grow = (doc: OfficeDoc, id: string, parent: string, skill = 'Research') => {
  const { ops, error } = branchAgentOps(doc, parent, { id, name: id.toUpperCase(), specialty: `${id} work`, purpose: 'help', skill, window: { everyMinutes: 300, maxMinutes: 10, setBy: 'origin', reason: 'test' } });
  expect(error).toBeNull();
  const r = applyOps(doc, ops);
  expect(r.errors).toEqual([]);
  return r.doc;
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

  test('ORIGIN and its ventures know how to create agents; skill agents only know how to ask', () => {
    let doc = grow(creatorBrain(), 'agent_roblox', 'agent_origin');
    doc = grow(doc, 'agent_3d', 'agent_roblox', '3D Design');
    expect(doc.agents.agent_origin.ai.agentInstructions).toContain(AGENT_BLUEPRINT);
    expect(doc.agents.agent_roblox.ai.agentInstructions).toContain(AGENT_BLUEPRINT);
    expect(doc.agents.agent_roblox.ai.agentInstructions).toMatch(/REVIEWING SKILL REQUESTS/);
    expect(doc.agents.agent_3d.ai.agentInstructions).not.toContain(AGENT_BLUEPRINT);
    expect(doc.agents.agent_3d.ai.agentInstructions).toMatch(/cannot create agents/);
    expect(branchAgentOps(doc, 'agent_3d', { id: 'x', name: 'X', specialty: 'x', purpose: 'x', skill: 'Research', window: { everyMinutes: 60, maxMinutes: 5, setBy: 'owner', reason: '' } }).error).not.toBeNull();
  });

  test('a skill request goes to its venture for relevance, then to the owner, and approval grows the skill', () => {
    let doc = grow(creatorBrain(), 'agent_roblox', 'agent_origin');
    doc = grow(doc, 'agent_3d', 'agent_roblox', '3D Design');
    // only skill agents file requests
    expect(applyOps(doc, [{ op: 'skillRequest.create', request: { id: 'r0', fromAgentId: 'agent_roblox', name: 'X', skill: 'Research', specialty: 'x', purpose: 'x' } }]).errors).not.toEqual([]);
    const file = (id: string) => applyOps(doc, [{ op: 'skillRequest.create', request: { id, fromAgentId: 'agent_3d', name: 'RIGGER', skill: '3D Design', specialty: 'Rigging', purpose: 'Rig the characters' } }]).doc;
    doc = file('r1');
    expect(doc.skillRequests[0]).toMatchObject({ ventureId: 'agent_roblox', status: 'venture-review' });
    // the owner can't decide before the venture has reviewed it
    expect(applyOps(doc, [{ op: 'skillRequest.decide', id: 'r1', approve: false }]).errors).not.toEqual([]);
    doc = applyOps(doc, [{ op: 'skillRequest.review', id: 'r1', relevant: true, note: 'Characters need rigs' }]).doc;
    expect(doc.skillRequests[0].status).toBe('owner-review');
    const { ops } = branchAgentOps(doc, 'agent_roblox', { id: 'agent_rigger', name: 'RIGGER', specialty: 'Rigging', purpose: 'Rig the characters', skill: '3D Design', window: { everyMinutes: 120, maxMinutes: 10, setBy: 'origin', reason: '' } });
    const r = applyOps(doc, [...ops, { op: 'skillRequest.decide', id: 'r1', approve: true, agentId: 'agent_rigger' }]);
    expect(r.errors).toEqual([]);
    expect(r.doc.skillRequests[0]).toMatchObject({ status: 'approved', agentId: 'agent_rigger' });
    expect(r.doc.agents.agent_rigger.skills.supervisorId).toBe('agent_roblox');
    expect(tree(r.doc).nodes.agent_rigger.parentId).toBe('agent_roblox');
    // a request judged not relevant never reaches the owner
    doc = file('r2');
    doc = applyOps(doc, [{ op: 'skillRequest.review', id: 'r2', relevant: false, note: 'That is an Amazon store, not Roblox' }]).doc;
    expect(doc.skillRequests.find((x) => x.id === 'r2')!.status).toBe('not-relevant');
    expect(applyOps(doc, [{ op: 'skillRequest.decide', id: 'r2', approve: true, agentId: 'agent_rigger' }]).errors).not.toEqual([]);
    // requests survive save and load
    const loaded = parseOffice(JSON.parse(exportOffice(r.doc)));
    expect(loaded.ok && loaded.doc.skillRequests[0].status).toBe('approved');
  });
});
