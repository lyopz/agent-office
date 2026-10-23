// The ring around the main brain shows the owner's real brains, never placeholders.
import { describe, expect, test } from 'vitest';
import { ringBrainsOf } from '../src/brain/brainRing';

describe('brain ring', () => {
  test('an empty library leaves the ring empty', () => {
    expect(ringBrainsOf([])).toEqual([]);
  });
  test('every library brain rides the ring in its own colour, or the ring palette', () => {
    const ring = ringBrainsOf([{ id: 'b1', name: 'Music', color: '#ff0000' }, { id: 'b2', name: 'Shirts', color: null }]);
    expect(ring.map((b) => [b.key, b.name])).toEqual([['b1', 'Music'], ['b2', 'Shirts']]);
    expect(ring[0].color).toBe('#ff0000');
    expect(ring[1].color).toMatch(/^#[0-9a-f]{6}$/);
  });
  test('the open brain is never on its own ring', () => {
    expect(ringBrainsOf([{ id: 'b1', name: 'Open', color: null, open: true }])).toEqual([]);
  });
});
