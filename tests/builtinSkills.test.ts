// The owner's built-in playbooks: Meme shirt design for every designer, Trend scouting for every scout.
import { describe, expect, test } from 'vitest';
import { applyOps } from '../src/engine/ops';
import { creatorBrain } from '../src/model/sample';
import { ORIGIN_ID, agentPrompt, branchAgentOps, opportunityOriginOps, originOutdated } from '../src/brain/opportunity';
import { MEME_DESIGN_ID, MEME_DESIGN_SKILL, TREND_SCOUT_ID, TREND_SCOUT_SKILL, builtinSkillOps, builtinSkillsFor } from '../src/brain/builtinSkills';

const w = { everyMinutes: 120, maxMinutes: 5, setBy: 'owner' as const, reason: 'test' };
const withAgents = () => {
  const doc = creatorBrain();
  const v = branchAgentOps(doc, ORIGIN_ID, { id: 'agent_store', name: 'STORE', specialty: 'Etsy print-on-demand shop', purpose: 'sell shirts', skill: 'venture', window: w });
  expect(v.error).toBeNull();
  let r = applyOps(doc, v.ops);
  expect(r.errors).toEqual([]);
  const d = branchAgentOps(r.doc, 'agent_store', { id: 'agent_design', name: 'Mockup & Design', specialty: 'shirt graphics and mockups', purpose: 'make designs', skill: 'design', window: w });
  const t = branchAgentOps(r.doc, 'agent_store', { id: 'agent_trend', name: 'Trend Scout', specialty: 'rising meme and short-video phrases', purpose: 'research only', skill: 'research', window: w });
  const p = branchAgentOps(r.doc, 'agent_store', { id: 'agent_price', name: 'Pricing', specialty: 'unit economics', purpose: 'prices', skill: 'finance', window: w });
  r = applyOps(r.doc, [...d.ops, ...t.ops, ...p.ops]);
  expect(r.errors).toEqual([]);
  return r.doc;
};

describe('built-in skills', () => {
  test('a fresh brain has both playbooks in the bank, in the full format, and JARVIS carries neither', () => {
    const doc = creatorBrain();
    expect(doc.skillBank.map((k) => k.id)).toEqual(expect.arrayContaining([MEME_DESIGN_ID, TREND_SCOUT_ID]));
    expect(MEME_DESIGN_SKILL.instructions.length).toBeGreaterThan(6000);
    expect(TREND_SCOUT_SKILL.instructions.length).toBeGreaterThan(6000);
    for (const k of [MEME_DESIGN_SKILL, TREND_SCOUT_SKILL]) for (const n of [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]) expect(k.instructions).toMatch(new RegExp(`\\n## ${n}\\. `));
    expect(doc.agents[ORIGIN_ID].bankSkills).not.toContain(MEME_DESIGN_ID);
    expect(originOutdated(doc)).toBe(false);
  });

  test('a new designer gets Meme shirt design, a new trend scout gets Trend scouting, a pricing agent gets neither', () => {
    const doc = withAgents();
    expect(doc.agents.agent_design.bankSkills).toContain(MEME_DESIGN_ID);
    expect(doc.agents.agent_design.bankSkills).not.toContain(TREND_SCOUT_ID);
    expect(doc.agents.agent_trend.bankSkills).toContain(TREND_SCOUT_ID);
    expect(doc.agents.agent_price.bankSkills ?? []).not.toContain(MEME_DESIGN_ID);
    expect(agentPrompt(doc, 'agent_design')).toMatch(/fih: a plain fish in high-tops/);
    expect(agentPrompt(doc, 'agent_trend')).toMatch(/Never log in, never scrape/);
    expect(builtinSkillOps(doc)).toEqual([]);
  });

  test("an older brain without the skills is outdated; JARVIS's update adds them and attaches them by role", () => {
    const fresh = withAgents();
    const agents = Object.fromEntries(Object.entries(fresh.agents).map(([id, a]) => [id, { ...a, bankSkills: (a.bankSkills ?? []).filter((k) => ![MEME_DESIGN_ID, TREND_SCOUT_ID].includes(k)) }]));
    const old = { ...fresh, agents, skillBank: fresh.skillBank.filter((k) => ![MEME_DESIGN_ID, TREND_SCOUT_ID].includes(k.id)) };
    expect(originOutdated(old)).toBe(true);
    const r = applyOps(old, opportunityOriginOps(old));
    expect(r.errors).toEqual([]);
    expect(originOutdated(r.doc)).toBe(false);
    expect(r.doc.agents.agent_design.bankSkills).toContain(MEME_DESIGN_ID);
    expect(r.doc.agents.agent_trend.bankSkills).toContain(TREND_SCOUT_ID);
  });

  test("the owner's edited copy is kept, and an agent that does both design and trends gets both", () => {
    const doc = withAgents();
    const edited = { ...doc, skillBank: doc.skillBank.map((k) => (k.id === MEME_DESIGN_ID ? { ...k, instructions: '# Mine', tags: ['owner-edited'] } : k)) };
    expect(builtinSkillOps(edited)).toEqual([]);
    expect(builtinSkillsFor({ ...doc.agents.agent_design, identity: { ...doc.agents.agent_design.identity, title: 'Meme trend designer' } })).toEqual([MEME_DESIGN_ID, TREND_SCOUT_ID]);
  });
});

describe('the Ad strategy playbook', () => {
  test('an ads agent gets Ad strategy; the playbook has the ten sections and the inexpensive-reach rules', async () => {
    const { AD_ROLE, AD_STRATEGY_ID, AD_STRATEGY_SKILL, builtinSkillsForRole } = await import('../src/brain/builtinSkills');
    expect(builtinSkillsForRole('Ads & Reach inexpensive-reach ads and marketing')).toEqual([AD_STRATEGY_ID]);
    expect(builtinSkillsForRole('Pricing unit economics')).toEqual([]);
    expect(AD_ROLE.test('Growth marketing')).toBe(true);
    expect(AD_STRATEGY_SKILL.instructions.length).toBeGreaterThan(5000);
    for (const n of [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]) expect(AD_STRATEGY_SKILL.instructions).toMatch(new RegExp(`\\n## ${n}\\. `));
    expect(AD_STRATEGY_SKILL.instructions).toMatch(/Organic before paid/);
    expect(AD_STRATEGY_SKILL.instructions).toMatch(/ad_save/);
    expect(creatorBrain().skillBank.map((k) => k.id)).toContain(AD_STRATEGY_ID);
  });
});
