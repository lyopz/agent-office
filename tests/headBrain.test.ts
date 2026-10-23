// JARVIS's head brain: it sits in the middle, the store venture moves into a brain of its own, and
// JARVIS builds and grows brains from layouts the owner approved.
import { describe, expect, test } from 'vitest';
import { creatorBrain } from '../src/model/sample';
import { applyOps } from '../src/engine/ops';
import { ORIGIN_ID, branchAgentOps, VENTURE_TEAM } from '../src/brain/opportunity';
import { applyBrainChange, buildPlannedBrain, mergeIntoHead, pickHeadId, splitVenture, storeVentureIn, ventureTeam, withLead, type BrainProposal } from '../src/brain/headBrain';
import { brainPlaces, headFirst } from '../src/brain/brainUniverse';
import { summarize } from '../src/persistence/brains';
import { parseOffice } from '../src/model/schema';
import { skillFileId } from '../src/brain/originSkillFile';
import type { OfficeDoc } from '../src/model/types';

const win = { everyMinutes: 240, maxMinutes: 5, setBy: 'origin' as const, reason: 'test' };
const grow = (doc: OfficeDoc, parent: string, id: string, name: string, specialty: string, skill: string) => {
  const b = branchAgentOps(doc, parent, { id, name, specialty, purpose: `${name} work`, skill, window: win });
  expect(b.error).toBeNull();
  const r = applyOps(doc, b.ops);
  expect(r.errors).toEqual([]);
  return r.doc;
};
/** The owner's brain today: JARVIS with an Etsy store venture (two skill agents with SKILL.md files) and a music venture. */
function ownersBrain(): OfficeDoc {
  let d = creatorBrain();
  d = grow(d, ORIGIN_ID, 'v_store', 'Meme Tee Store', 'Etsy shirt store', VENTURE_TEAM);
  d = grow(d, 'v_store', 'a_scout', 'Meme Scout', 'Trend scout', 'Research');
  d = grow(d, 'v_store', 'a_design', 'Shirt Designer', 'Designer', 'Creative');
  d = grow(d, ORIGIN_ID, 'v_music', 'Beat Lab', 'Music production', VENTURE_TEAM);
  const r = applyOps(d, [
    { op: 'skillBank.upsert', skill: { id: skillFileId('a_scout'), name: 'Scout playbook', description: 'd', instructions: 'Find memes.', tags: ['skill-file'] } },
    { op: 'agent.setBankSkills', id: 'a_scout', skillIds: [skillFileId('a_scout')] },
    { op: 'project.upsert', project: { id: 'p_store', name: 'Store', ownerAgentId: 'v_store', budget: 0, forecastSpend: 0, status: 'active', description: '' } },
  ]);
  expect(r.errors).toEqual([]);
  return r.doc;
}

describe('head brain', () => {
  test('the original brain (or the biggest one the owner started) is the head; a brain JARVIS built never is', () => {
    const main = ownersBrain();
    const other = { ...creatorBrain(), id: 'b2' };
    expect(pickHeadId([other, main])).toBe(main.id);
    expect(pickHeadId([{ ...other, head: true }, main])).toBe('b2');
    const built = { ...creatorBrain(), id: 'b3', plan: { purpose: 'x', lead: 'jarvis', createdBy: 'jarvis' as const, createdAt: '', research: [], history: [] } };
    expect(pickHeadId([built, { ...other, agents: main.agents }])).toBe('b2');
  });

  test('the head brain sits in the middle of the ring even when another brain is open', () => {
    const head = summarize({ ...ownersBrain(), head: true }, '', false);
    const store = summarize({ ...creatorBrain(), id: 'b_store', name: 'Store' }, '', true);
    expect(headFirst([store, head])[0].id).toBe(head.id);
    expect(brainPlaces([store, head])[head.id]).toEqual([0, 0, 0]);
    expect(head.head).toBe(true);
  });

  test('the Etsy store moves into its own brain with its agents, SKILL.md and projects; the head keeps the rest', () => {
    const main = ownersBrain();
    const v = storeVentureIn(main);
    expect(v).toBe('v_store');
    expect(ventureTeam(main, 'v_store').sort()).toEqual(['a_design', 'a_scout', 'v_store']);
    const r = splitVenture(main, 'v_store', { id: 'b_store', at: '2026-10-23T00:00:00Z' });
    if ('error' in r) throw new Error(r.error);
    expect(Object.keys(r.brain.agents).sort()).toEqual(['a_design', 'a_scout', ORIGIN_ID, 'v_store'].sort());
    expect(r.brain.plan).toMatchObject({ lead: 'jarvis', createdBy: 'jarvis', fromVenture: 'v_store' });
    expect(r.brain.head).toBe(false);
    expect(r.brain.skillBank.some((k) => k.id === skillFileId('a_scout'))).toBe(true);
    expect(r.brain.projects.p_store).toBeTruthy();
    // the agents keep their ids, so the runner's tasks, designs and sales stay theirs
    expect(r.brain.agents.a_scout.bankSkills).toContain(skillFileId('a_scout'));
    expect(Object.keys(r.head.agents).sort()).toEqual(['v_music', ORIGIN_ID].sort());
    expect(r.head.skillBank.some((k) => k.id === skillFileId('a_scout'))).toBe(false);
    expect(r.head.head).toBe(true);
    // both still load as valid saves
    expect(parseOffice(JSON.parse(JSON.stringify(r.brain))).ok).toBe(true);
    expect(parseOffice(JSON.parse(JSON.stringify(r.head))).ok).toBe(true);
    // Move back puts everything back
    const back = mergeIntoHead(r.head, r.brain);
    expect(Object.keys(back.agents).sort()).toEqual(Object.keys(main.agents).sort());
    expect(back.skillBank.some((k) => k.id === skillFileId('a_scout'))).toBe(true);
  });

  test('a brain is handed to one of its agents, or back to JARVIS; the head brain always stays JARVIS\'s', () => {
    const main = ownersBrain();
    const r = splitVenture(main, 'v_store', { id: 'b_store' });
    if ('error' in r) throw new Error(r.error);
    const led = withLead(r.brain, 'v_store');
    if ('error' in led) throw new Error(led.error);
    expect(led.doc.plan!.lead).toBe('v_store');
    expect(led.doc.plan!.history.at(-1)!.note).toMatch(/Meme Tee Store runs it/);
    const back = withLead(led.doc, 'jarvis');
    expect('doc' in back && back.doc.plan!.lead).toBe('jarvis');
    expect(withLead(r.head, 'v_music')).toMatchObject({ error: expect.stringMatching(/JARVIS always runs/) });
    expect(withLead(r.brain, 'nobody')).toMatchObject({ error: expect.any(String) });
  });

  const layout: BrainProposal = {
    id: 'bp1', kind: 'new', status: 'proposed', createdAt: '', name: 'Mug Shop', purpose: 'Print-on-demand mugs for dog owners.', ask: 'a mug store', research: ['dog mug trends'],
    agents: [
      { name: 'Mug Researcher', specialty: 'Product research', skill: 'Research', purpose: 'Find what sells.', degenSkills: ['idea-refine'], everyMinutes: 240, maxMinutes: 5 },
      { name: 'Mug Designer', specialty: 'Designer', skill: 'Creative', purpose: 'Make designs.', degenSkills: [], everyMinutes: 240, maxMinutes: 5 },
    ],
    firstTasks: [{ title: 'Find 5 dog mug themes', detail: '', agent: 'Mug Researcher' }],
  };
  test('an approved layout becomes a brain: JARVIS, a venture for the brain and its skill agents', () => {
    const head = { ...ownersBrain(), head: true };
    const r = buildPlannedBrain(head, layout, { id: 'b_mug' });
    expect(r.errors).toEqual([]);
    expect(r.doc.id).toBe('b_mug');
    expect(r.doc.plan).toMatchObject({ purpose: 'Print-on-demand mugs for dog owners.', lead: 'jarvis', createdBy: 'jarvis', research: ['dog mug trends'] });
    const v = r.agentIds['mug shop'];
    expect(r.doc.agents[v].branch).toEqual({ kind: 'venture', ventureId: v });
    expect(r.doc.agents[r.agentIds['mug researcher']].branch).toEqual({ kind: 'skill', ventureId: v });
    expect(Object.keys(r.doc.agents)).toHaveLength(4);
    // JARVIS keeps the head brain's instructions
    expect(r.doc.agents[ORIGIN_ID].ai.systemInstructions).toBe(head.agents[ORIGIN_ID].ai.systemInstructions);
    expect(parseOffice(JSON.parse(JSON.stringify(r.doc))).ok).toBe(true);
  });

  test('an approved change grows a brain under its lead venture and keeps a history', () => {
    const built = buildPlannedBrain({ ...ownersBrain(), head: true }, layout, { id: 'b_mug' }).doc;
    const change: BrainProposal = { id: 'bp2', kind: 'change', status: 'proposed', createdAt: '', name: 'Mug Shop', brainId: 'b_mug', research: ['mug prices'],
      addAgents: [{ name: 'Mug Ads', specialty: 'Ads', skill: 'Advertising', purpose: 'Cheap reach.', degenSkills: [], everyMinutes: 240, maxMinutes: 5 }, { name: 'Mug Designer', specialty: 'dup', skill: 'Creative', purpose: '', degenSkills: [], everyMinutes: 240, maxMinutes: 5 }] };
    const r = applyBrainChange(built, change);
    expect(Object.keys(r.agentIds)).toEqual(['mug ads']);
    expect(r.errors).toEqual(['Mug Designer is already in the brain']);
    expect(r.doc.plan!.research).toEqual(['mug prices']);
    expect(r.doc.plan!.history.at(-1)!.note).toMatch(/new agent Mug Ads/);
  });

  test('long library skills (up to 60,000 characters) still load', () => {
    const d = applyOps(creatorBrain(), [{ op: 'skillBank.upsert', skill: { id: 'skill_degen_big', name: 'Big', description: 'd', instructions: 'x'.repeat(45_000), tags: [] } }]).doc;
    expect(parseOffice(JSON.parse(JSON.stringify(d))).ok).toBe(true);
  });
});
