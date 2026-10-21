// More brains: the library in browser storage, skills flowing between brains, and the universe's links and places.
import { describe, expect, test } from 'vitest';
import { applyOps } from '../src/engine/ops';
import { creatorBrain } from '../src/model/sample';
import { brainLinks, brainPlaces, sharedSkillOps } from '../src/brain/brainUniverse';
import { BRAINS_KEY, listBrains, librarySkillBanks, putBrain, removeBrain, summarize, takeBrain } from '../src/persistence/brains';

class MemStorage implements Storage {
  m = new Map<string, string>();
  get length() { return this.m.size; }
  clear() { this.m.clear(); }
  getItem(k: string) { return this.m.get(k) ?? null; }
  key(i: number) { return [...this.m.keys()][i] ?? null; }
  removeItem(k: string) { this.m.delete(k); }
  setItem(k: string, v: string) { this.m.set(k, v); }
}
const brain = (id: string, name: string) => ({ ...creatorBrain(), id, name });

describe('brain universe', () => {
  test('the library keeps whole brains; taking one out removes it from the library', () => {
    const st = new MemStorage();
    const a = brain('brain_a', 'Shirts'), b = brain('brain_b', 'Music');
    putBrain(a, { tasks: {} }, st); putBrain(b, null, st);
    expect(listBrains(st).map((x) => x.name).sort()).toEqual(['Music', 'Shirts']);
    expect(JSON.parse(st.getItem(BRAINS_KEY)!).brain_a.doc.name).toBe('Shirts');
    expect(librarySkillBanks(st).map((x) => x.brainName).sort()).toEqual(['Music', 'Shirts']);
    const taken = takeBrain('brain_a', st);
    expect(taken?.doc.id).toBe('brain_a');
    expect(taken?.runtime).toEqual({ tasks: {} });
    expect(listBrains(st).map((x) => x.id)).toEqual(['brain_b']);
    expect(takeBrain('brain_a', st)).toBeNull();
    expect(removeBrain('brain_b', st)).toBe(true);
    expect(listBrains(st)).toEqual([]);
  });

  test('a brain learns the skills the other brains have; an agent playbook becomes a shared playbook named for its brain', () => {
    const me = brain('brain_me', 'New');
    const other = brain('brain_other', 'Shirts');
    const r = applyOps(other, [{ op: 'skillBank.upsert', skill: { id: 'skill_pricing', name: 'Pricing', description: 'd', instructions: 'i'.repeat(300), tags: ['owner-file'] } }, { op: 'skillBank.upsert', skill: { id: 'skill_file_agent_x', name: 'SKILL.md: Designer', description: 'd', instructions: 'p'.repeat(300), tags: ['skill-file'] } }]);
    const ops = sharedSkillOps(me, [{ brainId: other.id, brainName: other.name, skills: r.doc.skillBank }]);
    const names = ops.map((o) => (o.op === 'skillBank.upsert' ? [o.skill.id, o.skill.name, o.skill.tags] : null));
    expect(names).toEqual([
      ['skill_pricing', 'Pricing', ['from-brain:Shirts']],
      ['skill_file_agent_x', 'SKILL.md: Designer (from Shirts)', ['skill-file', 'from-brain:Shirts', 'shared-playbook']],
    ]);
    // the built-in skills both brains already have are not copied again, and a brain never copies from itself
    expect(sharedSkillOps(me, [{ brainId: me.id, brainName: me.name, skills: me.skillBank }])).toEqual([]);
    expect(applyOps(me, ops).errors).toEqual([]);
  });

  test('brains that share skills are linked, taught skills count more than built-ins; the open brain sits in the middle', () => {
    const a = summarize(brain('a', 'A'), '2026-10-21T00:00:00Z', true);
    const b = summarize(brain('b', 'B'), '2026-10-21T00:00:00Z', false);
    const c = { ...summarize(brain('c', 'C'), '2026-10-21T00:00:00Z', false), skillIds: ['skill_pricing', 'skill_x'], skillNames: ['Pricing', 'X'] };
    const builtins = brainLinks([a, b]);
    expect(builtins).toHaveLength(1);
    expect(builtins[0].strength).toBe(3); // built-ins only: 1 + min(2, shared)
    const taught = brainLinks([a, { ...b, skillIds: [...b.skillIds, 'skill_pricing', 'skill_file_z'] }, c]);
    expect(taught.find((l) => l.a === 'b' && l.b === 'c')).toMatchObject({ shared: ['skill_pricing'], strength: 3 });
    expect(taught.find((l) => l.a === 'a' && l.b === 'c')).toBeUndefined();
    const places = brainPlaces([a, b, c]);
    expect(places.a).toEqual([0, 0, 0]);
    expect(Math.hypot(places.b[0], places.b[2])).toBeCloseTo(2.6, 5);
    expect(Math.hypot(places.c[0], places.c[2])).toBeCloseTo(2.6, 5);
    expect(a.color).toBeNull();
  });
});
