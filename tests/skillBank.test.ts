// The owner's skill bank: agents that create agents equip them from it, and ORIGIN gets the bank and its budget watch.
import { describe, expect, test } from 'vitest';
import { creatorBrain } from '../src/model/sample';
import { applyOps } from '../src/engine/ops';
import { BUDGET_WATCH_ID, ORIGIN_ID, agentPrompt, branchAgentOps, originOutdated } from '../src/brain/opportunity';
import { brainMap } from '../src/brain/originLink';
import { parseSkillFile } from '../src/brain/SkillBank';
import { exportOffice, parseOffice } from '../src/model/schema';
import type { OfficeDoc } from '../src/model/types';

const window_ = { everyMinutes: 240, maxMinutes: 5, setBy: 'origin' as const, reason: 'test' };
const add = (doc: OfficeDoc, id: string, name: string) => {
  const r = applyOps(doc, [{ op: 'skillBank.upsert', skill: { id, name, description: `${name} work`, instructions: `Do ${name} well.`, tags: [] } }]);
  expect(r.errors).toEqual([]);
  return r.doc;
};

describe('skill bank', () => {
  test('ORIGIN starts with the budget watch skill and sees the bank when it creates agents', () => {
    const doc = creatorBrain();
    expect(doc.skillBank.map((k) => k.id)).toContain(BUDGET_WATCH_ID);
    expect(doc.agents[ORIGIN_ID].bankSkills).toContain(BUDGET_WATCH_ID);
    expect(originOutdated(doc)).toBe(false);
    const p = agentPrompt(doc, ORIGIN_ID);
    expect(p).toMatch(/## Budget watch/);
    expect(p).toMatch(/THE OWNER'S SKILL BANK/);
    expect(p).toMatch(/one task at a time/i);
  });

  test('a venture equips the agents it creates with bank skills; they get the skills, not the bank', () => {
    let doc = add(creatorBrain(), 'skill_etsy', 'Etsy listings');
    const v = branchAgentOps(doc, ORIGIN_ID, { id: 'agent_etsy', name: 'ETSY', specialty: 'Etsy store', purpose: 'Sell prints', skill: 'Ventures', window: window_ });
    doc = applyOps(doc, v.ops).doc;
    const s = branchAgentOps(doc, 'agent_etsy', { id: 'agent_listing', name: 'LISTER', specialty: 'Listings', purpose: 'Write listings', skill: 'Advertising', window: window_, bankSkillIds: ['skill_etsy'] });
    expect(s.error).toBeNull();
    doc = applyOps(doc, s.ops).doc;
    expect(doc.agents.agent_listing.bankSkills).toEqual(['skill_etsy']);
    expect(agentPrompt(doc, 'agent_listing')).toMatch(/## Etsy listings\nDo Etsy listings well\./);
    expect(agentPrompt(doc, 'agent_listing')).not.toMatch(/SKILL BANK/);
    expect(agentPrompt(doc, 'agent_etsy')).toMatch(/\[skill_etsy\] Etsy listings/); // a venture can pick from the bank
    expect(brainMap(doc)).toMatch(/\[agent_etsy\] ETSY: Etsy store \(skill agents: LISTER\)/);
    expect(branchAgentOps(doc, 'agent_etsy', { id: 'x', name: 'X', specialty: 'x', purpose: 'x', skill: 'Research', window: window_, bankSkillIds: ['nope'] }).error).toMatch(/no longer in the skill bank/);
  });

  test('removing a skill takes it off every agent; names stay unique; the bank survives a save', () => {
    let doc = add(creatorBrain(), 'skill_r', 'Research');
    doc = applyOps(doc, [{ op: 'agent.setBankSkills', id: ORIGIN_ID, skillIds: [BUDGET_WATCH_ID, 'skill_r'] }]).doc;
    expect(applyOps(doc, [{ op: 'skillBank.upsert', skill: { id: 'other', name: 'research', description: '', instructions: 'x', tags: [] } }]).errors[0]).toMatch(/already has/);
    expect(applyOps(doc, [{ op: 'agent.setBankSkills', id: ORIGIN_ID, skillIds: ['missing'] }]).errors[0]).toMatch(/not in the bank/);
    const loaded = parseOffice(JSON.parse(exportOffice(doc)));
    expect(loaded.ok && loaded.doc.skillBank.find((k) => k.id === 'skill_r')?.name).toBe('Research');
    doc = applyOps(doc, [{ op: 'skillBank.remove', id: 'skill_r' }]).doc;
    expect(doc.agents[ORIGIN_ID].bankSkills).toEqual([BUDGET_WATCH_ID]);
  });

  test('a SKILL.md imports its name, description and body', () => {
    const k = parseSkillFile('---\r\nname: idea-refine\r\ndescription: "Sharpen a raw idea"\r\n---\r\n# Steps\r\n1. Ask why.', 'SKILL.md');
    expect(k).toEqual({ name: 'idea-refine', description: 'Sharpen a raw idea', instructions: '# Steps\n1. Ask why.' });
    expect(parseSkillFile('Just text', 'notes.md')).toMatchObject({ name: 'notes', instructions: 'Just text' });
  });
});

describe('each agent gets its own SKILL.md', () => {
  test('ventures and skill agents without one are queued once; a finished file goes to the bank and the agent', async () => {
    const { agentsNeedingSkillFile, skillFileBrief, skillFileOps, skillFileId, SKILL_FILE_VERSION } = await import('../src/brain/skillFiles');
    const { skillFileText } = await import('../src/brain/SkillBank');
    let doc = creatorBrain();
    doc = applyOps(doc, branchAgentOps(doc, ORIGIN_ID, { id: 'agent_etsy', name: 'ETSY', specialty: 'Etsy store', purpose: 'Sell prints', skill: 'Ventures', window: window_ }).ops).doc;
    expect(agentsNeedingSkillFile(doc, { tasks: [] })).toEqual(['agent_etsy']); // every agent but ORIGIN
    expect(skillFileBrief(doc, 'agent_etsy')).toMatch(/Venture: ETSY, Etsy store, created by JARVIS/);
    const req = { id: 't', title: '', detail: '', status: 'stopped' as const, by: 'owner' as const, createdAt: '', kind: 'skill-file' as const, agentId: 'agent_etsy' };
    expect(agentsNeedingSkillFile(doc, { tasks: [{ ...req, version: SKILL_FILE_VERSION }] })).toEqual([]);
    expect(agentsNeedingSkillFile(doc, { tasks: [{ ...req, version: 1 }] })).toEqual(['agent_etsy']); // an old-format request doesn't count
    expect(agentsNeedingSkillFile(doc, { tasks: [req] })).toEqual([]); // queued before versions were recorded: written in the current format
    // a thin first-version file is rewritten in the detailed format
    const old = applyOps(doc, skillFileOps(doc, 'agent_etsy', { name: 'Etsy store playbook', description: 'Running the store', body: 'Thin.' })).doc;
    expect(agentsNeedingSkillFile(old, { tasks: [] })).toEqual(['agent_etsy']);
    const r = applyOps(old, skillFileOps(old, 'agent_etsy', { name: 'Etsy store playbook', description: 'Running the store', body: '# Steps\n1. List.', version: SKILL_FILE_VERSION }));
    expect(r.errors).toEqual([]);
    expect(r.doc.agents.agent_etsy.bankSkills).toContain(skillFileId('agent_etsy'));
    expect(agentPrompt(r.doc, 'agent_etsy')).toMatch(/## Etsy store playbook\n# Steps/);
    expect(agentsNeedingSkillFile(r.doc, { tasks: [] })).toEqual([]);
    const k = r.doc.skillBank.find((x) => x.id === skillFileId('agent_etsy'))!;
    expect(parseSkillFile(skillFileText(k), 'x.md')).toEqual({ name: 'Etsy store playbook', description: 'Running the store', instructions: '# Steps\n1. List.' });
  });
});
