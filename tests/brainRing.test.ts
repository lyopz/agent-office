// The ring around the main brain shows the owner's real brains, never placeholders; the main brain is the Blender model.
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

describe('Blender brain model', () => {
  test('loads with the hologram attributes, inside the same bounds as the procedural brain', async () => {
    const { loadBrainModel } = await import('../src/brain/brainModel');
    const m = await loadBrainModel();
    expect(m).not.toBeNull();
    const g = m!.mesh;
    expect(g.attributes.fold.count).toBe(g.attributes.position.count);
    expect(g.attributes.tint.itemSize).toBe(3);
    expect(g.index!.count / 3).toBeGreaterThan(2000);
    g.computeBoundingBox();
    const { min, max } = g.boundingBox!;
    expect(min.x).toBeGreaterThan(-0.85); expect(max.x).toBeLessThan(0.85);
    expect(min.y).toBeGreaterThan(-1.1); expect(max.y).toBeLessThan(0.75);
    expect(min.z).toBeGreaterThan(-1.0); expect(max.z).toBeLessThan(0.9);
  });
});

describe('head brain on the ring', () => {
  test("JARVIS's head brain is never on the ring, only in the middle", () => {
    expect(ringBrainsOf([{ id: 'h', name: 'JARVIS', color: null, head: true }, { id: 'etsy', name: 'Etsy store', color: null }]).map((b) => b.key)).toEqual(['etsy']);
  });
});
