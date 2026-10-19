// Blender sprite lookup: one sheet per exact look, never a stale picture.
import { describe, expect, test } from 'vitest';
import { frameFor, lookKey } from '../src/characters/sprites';
import { sampleOffice } from '../src/model/sample';
import { withAppearance } from '../src/model/defaults';

describe('character sprites', () => {
  const doc = sampleOffice();
  const orion = doc.agents.agent_orion.appearance;

  test('the key is stable, ignores animation-only fields and changes with the look', () => {
    expect(lookKey(orion)).toBe(lookKey(JSON.parse(JSON.stringify(orion))));
    expect(lookKey(withAppearance(orion, { facing: orion.facing === 'left' ? 'right' : 'left', animationSpeed: 2, preferredView: 'side' }))).toBe(lookKey(orion));
    expect(lookKey(withAppearance(orion, { hairColor: '#123456' }))).not.toBe(lookKey(orion));
    expect(lookKey(withAppearance(orion, { accessories: [...orion.accessories].reverse() }))).not.toBe(lookKey(orion));
    // key order in the object doesn't matter
    const shuffled = Object.fromEntries(Object.entries(orion).reverse()) as typeof orion;
    expect(lookKey(shuffled)).toBe(lookKey(orion));
    // the 24 floor agents differ by hair and skin, so each gets its own sheet
    const floor = Object.values(doc.agents).filter((a) => a.identity.department === 'Operations Floor').map((a) => lookKey(a.appearance));
    expect(new Set(floor).size).toBeGreaterThan(1);
  });

  test('simulation states map to sprite frames', () => {
    expect([0, 1, 2, 3, 4].map((f) => frameFor('walking', false, f))).toEqual(['walk0', 'walk1', 'walk2', 'walk3', 'walk0']);
    expect(frameFor('working', true, 0)).toBe('sit');
    expect(frameFor('working', false, 0)).toBe('work');
    expect(frameFor('communicating', false, 0)).toBe('talk');
    expect(frameFor('idle', false, 2)).toBe('idle');
    expect(frameFor('paused', false, 2)).toBe('idle');
  });
});
