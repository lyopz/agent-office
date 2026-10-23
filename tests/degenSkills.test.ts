// The owner's skill library (lyopz/degen-skill): read from a clone, matched to agent roles, design first.
import { describe, expect, test } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DEGEN_TOOL, degenBankSkill, degenCatalog, degenSkill, degenSkillsForRole, parseFrontmatter } from '../server/degen-skills.mjs';

const lib = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'degen-'));
  const put = (name: string, md: string) => { fs.mkdirSync(path.join(dir, 'skills', name), { recursive: true }); fs.writeFileSync(path.join(dir, 'skills', name, 'SKILL.md'), md); };
  put('design', '---\nname: design\ndescription: "Comprehensive design skill: brand identity, tokens, logos"\n---\n\n<!-- from: someone (MIT) -->\n\n# Design\n\nDo design well.\n');
  put('brand', '---\nname: brand\ndescription: |\n  Brand voice, visual identity,\n  messaging frameworks\n---\n# Brand\nBody.\n');
  put('cli-keys', '---\nname: cli-keys\ndescription: Rotate API keys from the CLI.\n---\n# Keys\n');
  return dir;
};

describe('degen skill library', () => {
  test('front matter: plain, quoted and block descriptions; the source comment is dropped from the body', () => {
    expect(parseFrontmatter('---\nname: x\ndescription: "A thing"\n---\n\n<!-- from: a -->\n\n# X\nbody')).toEqual({ name: 'x', description: 'A thing', body: '# X\nbody' });
    expect(parseFrontmatter('---\nname: y\ndescription: >-\n  two\n  lines\n---\nbody').description).toBe('two lines');
    expect(parseFrontmatter('no front matter')).toEqual({ name: '', description: '', body: 'no front matter' });
  });

  test('roles: designers get the design skills first, store agents never get developer tooling', () => {
    expect(degenSkillsForRole('Mockup & Design shirt graphics and mockups')).toEqual([]); // the owner's rule: no AI art, found memes only
    expect(degenSkillsForRole('Ads & Reach inexpensive-reach ads')).toEqual(['brand', 'banner-design']);
    expect(degenSkillsForRole('Trend Scout rising meme phrases research')).toEqual(['idea-refine', 'llm-council']);
    expect(degenSkillsForRole('Pricing unit economics')).toEqual([]);
    expect(degenSkillsForRole('STORE Etsy print-on-demand shop')).toEqual([]);
  });

  test('a local clone is catalogued and read; a skill becomes a bank skill named for the library', async () => {
    const dir = lib();
    const cat = await degenCatalog({ dir, fresh: true });
    expect(cat.from).toBe('local');
    expect(cat.skills.map((k) => [k.name, k.roles])).toEqual([['brand', ['ads']], ['cli-keys', []], ['design', []]]);
    expect(cat.skills[0].description).toBe('Brand voice, visual identity, messaging frameworks');
    const k = await degenSkill('design', { dir });
    expect(k).toMatchObject({ name: 'design', title: 'design', body: '# Design\n\nDo design well.', roles: [], from: 'local' });
    expect(degenBankSkill(k)).toMatchObject({ skillKey: 'degen_design', skillName: 'Design (degen)', tags: ['degen-skill', 'degen:design'] });
    await expect(degenSkill('../etc', { dir })).rejects.toThrow(/skill name/);
    await expect(degenSkill('missing', { dir })).rejects.toThrow(/No skill named missing/);
    expect(DEGEN_TOOL.input_schema).toMatchObject({ required: ['action'] });
  });

  test('the real library on this machine, when present, lists design, brand and banner-design', async () => {
    const real = '/home/claude/degen-skill';
    if (!fs.existsSync(path.join(real, 'skills'))) return;
    const cat = await degenCatalog({ dir: real, fresh: true });
    expect(cat.skills.map((k) => k.name)).toEqual(expect.arrayContaining(['design', 'brand', 'banner-design', 'design-system', 'idea-refine']));
    const design = await degenSkill('design', { dir: real });
    expect(design.body.length).toBeGreaterThan(2000);
  });
});
