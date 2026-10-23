// The owner's own SKILL.md: name and description come from its frontmatter, else its heading and first paragraph.
import { describe, expect, test } from 'vitest';
import { readSkillMarkdown } from '../src/brain/SkillFileDrop';

describe('owner SKILL.md files', () => {
  test('frontmatter wins', () => {
    const f = readSkillMarkdown('ads.md', '---\nname: Ads playbook\ndescription: "When to run Etsy ads"\n---\n# Ads\n\nBody text here for the agent.');
    expect(f).toMatchObject({ name: 'Ads playbook', description: 'When to run Etsy ads', body: '# Ads\n\nBody text here for the agent.' });
  });
  test('without frontmatter: heading and first paragraph, Windows line endings too', () => {
    const f = readSkillMarkdown('x.md', '# Mockup rules\r\n\r\nMake clean mockups\r\nfor every listing.\r\n\r\n## Steps');
    expect(f).toMatchObject({ name: 'Mockup rules', description: 'Make clean mockups for every listing.' });
  });
});
