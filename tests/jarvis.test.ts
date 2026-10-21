// The owner renamed ORIGIN to JARVIS: a fresh brain uses the new name and older saves are renamed on load.
import { describe, expect, test } from 'vitest';
import { creatorBrain } from '../src/model/sample';
import { renamedLeader } from '../src/store/store';
import { ORIGIN_ID } from '../src/brain/opportunity';

describe('JARVIS', () => {
  test('a fresh brain is led by JARVIS', () => {
    expect(creatorBrain().agents[ORIGIN_ID].identity.name).toBe('JARVIS');
  });

  test('an older save named ORIGIN is renamed, instructions and skill bank too', () => {
    const doc = creatorBrain();
    const lead = doc.agents[ORIGIN_ID];
    const old = {
      ...doc,
      agents: { ...doc.agents, [ORIGIN_ID]: { ...lead, identity: { ...lead.identity, name: 'ORIGIN' }, ai: { ...lead.ai, systemInstructions: 'You are ORIGIN, the root.' } } },
      skillBank: doc.skillBank.map((k) => ({ ...k, description: 'How ORIGIN works' })),
    };
    const next = renamedLeader(old);
    expect(next.agents[ORIGIN_ID].identity.name).toBe('JARVIS');
    expect(next.agents[ORIGIN_ID].ai.systemInstructions).toBe('You are JARVIS, the root.');
    expect(next.skillBank.every((k) => k.description === 'How JARVIS works')).toBe(true);
    expect(next.agents[ORIGIN_ID].id).toBe(ORIGIN_ID);
  });

  test('a brain already named JARVIS is left alone', () => {
    const doc = creatorBrain();
    expect(renamedLeader(doc)).toBe(doc);
  });
});

import { withBrainTheme, defaultAppearanceSettings, BUILTIN_THEMES } from '../src/model/themes';
describe('Brain Red theme', () => {
  test('is the default and the first built-in theme', () => {
    expect(BUILTIN_THEMES[0].id).toBe('brain-red');
    expect(defaultAppearanceSettings().themeId).toBe('brain-red');
  });
  test('moves an old save off the old green default but keeps a theme the owner chose', () => {
    const old = { mode: 'dark' as const, themeId: 'obsidian-green', themes: BUILTIN_THEMES.filter((t) => t.id !== 'brain-red') };
    const moved = withBrainTheme(old);
    expect(moved.themeId).toBe('brain-red');
    expect(moved.themes[0].id).toBe('brain-red');
    const chosen = withBrainTheme({ ...old, themeId: 'arctic-blue' });
    expect(chosen.themeId).toBe('arctic-blue');
    expect(withBrainTheme(moved)).toBe(moved);
  });
});
