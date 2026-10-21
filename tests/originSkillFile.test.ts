import { describe, expect, test } from 'vitest';
import { applyOps } from '../src/engine/ops';
import { creatorBrain } from '../src/model/sample';
import { ORIGIN_ID, agentPrompt, opportunityOriginOps, originOutdated } from '../src/brain/opportunity';
import { ORIGIN_SKILL_FILE, originSkillFileOutdated, originSkillFileUpsert, skillFileId } from '../src/brain/originSkillFile';
import { ownSkillFileOps } from '../src/brain/skillFiles';

describe("JARVIS's SKILL.md", () => {
  test('a fresh brain gives JARVIS its SKILL.md, attached and in its prompt', () => {
    const doc = creatorBrain();
    const k = doc.skillBank.find((x) => x.id === skillFileId(ORIGIN_ID))!;
    expect(k.name).toBe(ORIGIN_SKILL_FILE.name);
    expect(k.tags).toContain('skill-file');
    expect(doc.agents[ORIGIN_ID].bankSkills).toContain(k.id);
    expect(agentPrompt(doc, ORIGIN_ID)).toMatch(/never answer "I can't"/i);
    expect(originSkillFileOutdated(doc, ORIGIN_ID)).toBe(false);
    expect(originOutdated(doc)).toBe(false);
  });

  test('an older brain without the file is outdated, and the update adds it without losing the budget watch', () => {
    const fresh = creatorBrain();
    const old = { ...fresh, skillBank: fresh.skillBank.filter((k) => k.id !== skillFileId(ORIGIN_ID)), agents: { ...fresh.agents, [ORIGIN_ID]: { ...fresh.agents[ORIGIN_ID], bankSkills: fresh.agents[ORIGIN_ID].bankSkills!.filter((id) => id !== skillFileId(ORIGIN_ID)) } } };
    expect(originOutdated(old)).toBe(true);
    const r = applyOps(old, opportunityOriginOps(old));
    expect(r.errors).toEqual([]);
    expect(originOutdated(r.doc)).toBe(false);
    expect(r.doc.agents[ORIGIN_ID].bankSkills).toEqual(expect.arrayContaining(['skill_budget_watch', skillFileId(ORIGIN_ID)]));
  });

  test("the owner's own .md replaces it and is never overwritten by the built-in one", () => {
    const doc = creatorBrain();
    const r = applyOps(doc, ownSkillFileOps(doc, ORIGIN_ID, 'JARVIS', { name: 'My JARVIS', description: 'mine', body: '# Mine\n\nDo exactly what I say, always.' }, doc.agents[ORIGIN_ID].bankSkills ?? []));
    expect(r.errors).toEqual([]);
    expect(originSkillFileUpsert(r.doc, ORIGIN_ID)).toBeNull();
    expect(originOutdated(r.doc)).toBe(false);
    expect(agentPrompt(r.doc, ORIGIN_ID)).toMatch(/Do exactly what I say/);
  });
});
