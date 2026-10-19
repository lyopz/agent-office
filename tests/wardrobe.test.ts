// Sci-fi wardrobe (four items per slot) and locked role uniforms.
import { describe, expect, test } from 'vitest';
import { applyOps, type DocOp } from '../src/engine/ops';
import { sampleOffice } from '../src/model/sample';
import { BUILTIN_COSMETICS, ITEMS_PER_SLOT, OUTFIT_FIELDS, WARDROBE_SLOTS } from '../src/model/cosmetics';
import { ROLE_UNIFORMS, roleUniformId } from '../src/model/defaults';
import { exportOffice, parseOffice } from '../src/model/schema';
import type { OfficeDoc } from '../src/model/types';

const ok = (doc: OfficeDoc, ops: DocOp[]) => { const r = applyOps(doc, ops); expect(r.errors).toEqual([]); return r.doc; };
const fails = (doc: OfficeDoc, ops: DocOp[], re: RegExp) => { const r = applyOps(doc, ops); expect(r.errors.join(' ')).toMatch(re); expect(r.doc).toBe(doc); };

describe('sci-fi wardrobe', () => {
  test('exactly four items in every wardrobe slot, plus the functional equipment', () => {
    const decorative = BUILTIN_COSMETICS.filter((c) => !c.tags?.includes('equipment'));
    for (const slot of WARDROBE_SLOTS) expect(decorative.filter((c) => c.slot === slot), slot).toHaveLength(ITEMS_PER_SLOT);
    expect(decorative).toHaveLength(WARDROBE_SLOTS.length * ITEMS_PER_SLOT);
    const names = BUILTIN_COSMETICS.map((c) => c.name).join(' ');
    for (const old of ['T-shirt', 'Casual hoodie', 'Lab coat', 'Briefcase', 'Round glasses', 'Winter gala', 'Scar']) expect(names).not.toContain(old);
  });
});

describe('locked role uniforms', () => {
  const doc0 = sampleOffice();

  test('every role has a locked uniform, and role agents start in it', () => {
    expect(ROLE_UNIFORMS.length).toBeGreaterThanOrEqual(14);
    expect(ROLE_UNIFORMS.every((u) => u.locked && u.kind === 'uniform' && u.approved)).toBe(true);
    expect(doc0.agents.agent_orion.uniformId).toBe(roleUniformId('president'));
    expect(doc0.agents.agent_codex.uniformId).toBe(roleUniformId('librarian'));
    expect(doc0.agents.agent_ops7.uniformId).toBe(roleUniformId('ops-worker'));
    // custom-built agents aren't locked
    expect(doc0.agents.agent_echo.uniformId ?? null).toBeNull();
  });

  test('cosmetics cannot be added to or removed from a locked uniform', () => {
    fails(doc0, [{ op: 'cosmetic.apply', itemId: 'cos_flight-helmet', agentIds: ['agent_orion'] }], /locked President uniform/);
    fails(doc0, [{ op: 'cosmetic.remove', itemId: 'cos_holo-badge', agentId: 'agent_orion' }], /can't be added to or removed/);
    fails(doc0, [{ op: 'agent.update', id: 'agent_orion', patch: { appearance: { topColor: '#ff0000' } } }], /locked/);
    fails(doc0, [{ op: 'agent.update', id: 'agent_orion', patch: { appearance: { accessories: [] } } }], /locked/);
    // face, hair and body stay editable
    const d = ok(doc0, [{ op: 'agent.update', id: 'agent_orion', patch: { appearance: { hairColor: '#123456', skinTone: '#7a4a2a' } } }]);
    expect(d.agents.agent_orion.appearance.hairColor).toBe('#123456');
    // a bulk apply that touches a locked agent changes nobody
    fails(doc0, [{ op: 'cosmetic.apply', itemId: 'cos_mag-boots', agentIds: ['agent_echo', 'agent_orion'] }], /locked/);
  });

  test('the uniform itself cannot be edited or deleted; a duplicate is editable', () => {
    const id = roleUniformId('president');
    fails(doc0, [{ op: 'outfit.update', id, patch: { patch: { top: 'hoodie' } } }], /locked role uniform/);
    fails(doc0, [{ op: 'outfit.update', id, patch: { locked: false } }], /locked role uniform/);
    fails(doc0, [{ op: 'template.delete', id }], /can’t be deleted/);
    const d = ok(doc0, [{ op: 'outfit.duplicate', id, newId: 'out_copy' }, { op: 'outfit.update', id: 'out_copy', patch: { patch: { top: 'jacket' } } }]);
    expect(d.outfitTemplates.find((t) => t.id === 'out_copy')?.locked).toBe(false);
  });

  test('a uniform is worn whole: wearing it resets the outfit and locks it; another outfit or taking it off unlocks', () => {
    let d = ok(doc0, [{ op: 'cosmetic.apply', itemId: 'cos_flight-helmet', agentIds: ['agent_echo'] }]);
    d = ok(d, [{ op: 'outfit.apply', outfitId: roleUniformId('coo'), agentIds: ['agent_echo'] }]);
    const u = d.outfitTemplates.find((t) => t.id === roleUniformId('coo'))!;
    for (const k of OUTFIT_FIELDS) expect(d.agents.agent_echo.appearance[k], k).toEqual(u.patch[k]);
    expect(d.agents.agent_echo.uniformId).toBe(u.id);
    fails(d, [{ op: 'cosmetic.apply', itemId: 'cos_mag-boots', agentIds: ['agent_echo'] }], /locked/);
    // switching to a regular outfit takes the uniform off
    const sw = ok(d, [{ op: 'outfit.apply', outfitId: 'outfit_1', agentIds: ['agent_echo'] }]);
    expect(sw.agents.agent_echo.uniformId).toBeNull();
    // taking it off keeps the look and frees the wardrobe
    const off = ok(d, [{ op: 'agent.removeUniform', id: 'agent_echo' }]);
    expect(off.agents.agent_echo.appearance).toEqual(d.agents.agent_echo.appearance);
    ok(off, [{ op: 'cosmetic.apply', itemId: 'cos_mag-boots', agentIds: ['agent_echo'] }]);
    // restoring the default look keeps a locked uniform on
    const r = ok(doc0, [{ op: 'agent.update', id: 'agent_orion', patch: { appearance: { hairStyle: 'long' } } }, { op: 'agent.restoreAppearance', id: 'agent_orion' }]);
    expect(r.agents.agent_orion.uniformId).toBe(roleUniformId('president'));
  });

  test('uniforms and locks survive save and reload; v4 files migrate without changing anyone’s look', () => {
    const r = parseOffice(JSON.parse(exportOffice(doc0)));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.doc.agents.agent_orion.uniformId).toBe(roleUniformId('president'));
    fails(r.doc, [{ op: 'cosmetic.apply', itemId: 'cos_flight-helmet', agentIds: ['agent_orion'] }], /locked/);

    const v4 = JSON.parse(exportOffice(doc0)).office;
    v4.schemaVersion = 4;
    v4.outfitTemplates = v4.outfitTemplates.filter((t: { locked?: boolean }) => !t.locked);
    for (const a of Object.values(v4.agents) as { uniformId?: unknown }[]) delete a.uniformId;
    v4.agents.agent_scout.appearance.topColor = '#ff00ff'; // customised before the update
    v4.cosmetics = [{ id: 'cos_tee', name: 'T-shirt', category: 'clothing', slot: 'top', patch: { top: 'tshirt' } }, { id: 'cos_mine', name: 'My jacket', category: 'clothing', slot: 'top', patch: { top: 'jacket' }, custom: true }];
    const m = parseOffice(v4);
    expect(m.ok).toBe(true);
    if (!m.ok) return;
    expect(m.doc.cosmetics.some((c) => c.id === 'cos_tee')).toBe(false);
    expect(m.doc.cosmetics.some((c) => c.id === 'cos_mine')).toBe(true);
    expect(m.doc.outfitTemplates.filter((t) => t.locked)).toHaveLength(ROLE_UNIFORMS.length);
    expect(m.doc.agents.agent_orion.uniformId).toBe(roleUniformId('president'));
    expect(m.doc.agents.agent_scout.uniformId).toBeNull();
    expect(m.doc.agents.agent_scout.appearance.topColor).toBe('#ff00ff');
  });
});
