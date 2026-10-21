// Every brain is a hologram in the colour the owner picked for it.
import { describe, expect, test } from 'vitest';
import { creatorBrain } from '../src/model/sample';
import { applyOps } from '../src/engine/ops';
import { parseOffice } from '../src/model/schema';
import { HOLO_DEFAULT, MAIN_BRAIN, brainColor, holoBrainMaterial } from '../src/brain/brainMesh';
import { selectedBrain } from '../src/brain/BrainScene';
import { teamsOf } from '../src/brain/connectome';

describe('brain colours', () => {
  test('a brain with no colour of its own uses the fallback, then the holo default', () => {
    const doc = creatorBrain();
    expect(brainColor(doc.appearance, MAIN_BRAIN)).toBe(HOLO_DEFAULT);
    expect(brainColor(doc.appearance, 'team:Design', '#ff7ad6')).toBe('#ff7ad6');
    expect(brainColor(undefined, MAIN_BRAIN)).toBe(HOLO_DEFAULT);
  });

  test('brain.setColor saves a colour per brain and null goes back to the default', () => {
    let r = applyOps(creatorBrain(), [{ op: 'brain.setColor', brain: MAIN_BRAIN, color: '#FF354F' }, { op: 'brain.setColor', brain: 'agent_origin', color: '#4ff0d0' }]);
    expect(r.errors).toEqual([]);
    expect(r.doc.appearance.brainColors).toEqual({ main: '#ff354f', agent_origin: '#4ff0d0' });
    expect(brainColor(r.doc.appearance, MAIN_BRAIN)).toBe('#ff354f');
    r = applyOps(r.doc, [{ op: 'brain.setColor', brain: MAIN_BRAIN, color: null }]);
    expect(r.doc.appearance.brainColors).toEqual({ agent_origin: '#4ff0d0' });
    expect(applyOps(r.doc, [{ op: 'brain.setColor', brain: MAIN_BRAIN, color: 'red' }]).errors).toEqual(['Colour must be #rrggbb']);
  });

  test('colours survive a save and load, and an older save without them still loads', () => {
    const doc = applyOps(creatorBrain(), [{ op: 'brain.setColor', brain: MAIN_BRAIN, color: '#b28cff' }]).doc;
    const r = parseOffice(JSON.parse(JSON.stringify(doc)));
    expect(r.ok && r.doc.appearance.brainColors).toEqual({ main: '#b28cff' });
    const old = JSON.parse(JSON.stringify(creatorBrain())) as { appearance: { brainColors?: unknown } };
    delete old.appearance.brainColors;
    const r2 = parseOffice(old);
    expect(r2.ok && r2.doc.appearance.brainColors).toEqual({});
  });

  test('the picked brain is the agent, then the team, then the main brain; team brains fall back to the team colour', () => {
    const doc = applyOps(creatorBrain(), [{ op: 'agent.create', name: 'PIXEL', id: 'agent_pixel', department: 'Design' }]).doc;
    const teams = teamsOf(doc);
    const design = teams.find((t) => t.name === 'Design')!;
    expect(selectedBrain({ brainAgentId: null, selectedTeamId: null }, teams, doc.agents)).toEqual({ key: MAIN_BRAIN, name: 'Main Brain', fallback: HOLO_DEFAULT });
    expect(selectedBrain({ brainAgentId: null, selectedTeamId: design.id }, teams, doc.agents)).toEqual({ key: design.id, name: 'Design Brain', fallback: design.color });
    expect(selectedBrain({ brainAgentId: 'agent_pixel', selectedTeamId: design.id }, teams, doc.agents)).toEqual({ key: 'agent_pixel', name: 'PIXEL Brain', fallback: design.color });
    expect(selectedBrain({ brainAgentId: 'agent_gone', selectedTeamId: null }, teams, doc.agents).key).toBe(MAIN_BRAIN);
  });

  test('the hologram is one material pair sharing a colour that fades to the new one', () => {
    const h = holoBrainMaterial('#000000');
    expect(h.front.side).not.toBe(h.back.side);
    expect(h.front.transparent && h.back.transparent).toBe(true);
    h.setColor('#ffffff');
    h.update(0, 0.1);
    const c = h.front.uniforms.uColor.value as { r: number };
    expect(c.r).toBeGreaterThan(0); expect(c.r).toBeLessThan(1);
    expect((h.back.uniforms.uColor.value as { r: number }).r).toBe(c.r);
    for (let i = 0; i < 40; i++) h.update(i, 0.1);
    expect(c.r).toBeGreaterThan(0.99);
    h.dispose();
  });
});
