// Neural Command Campus: Auto Sort, the bubble preset, tube travel and the mail network.
import { describe, expect, test } from 'vitest';
import { applyOps } from '../src/engine/ops';
import { validate } from '../src/engine/validate';
import { buildNav } from '../src/engine/navigation';
import { createTask, emptyRuntime, step, syncRuntime, goTo } from '../src/engine/simulation';
import { collaborationDistance, planAutoSort, roomAffinity } from '../src/engine/autosort';
import { dispatchViaTube, mailNetwork, stepCapsules, CAPSULE_LINGER } from '../src/engine/tubes';
import { sampleOffice } from '../src/model/sample';
import { emptyOffice } from '../src/model/defaults';
import { parseOffice } from '../src/model/schema';
import type { OfficeDoc, RuntimeState } from '../src/model/types';

function runtimeFor(doc: OfficeDoc): RuntimeState { const rt = emptyRuntime(); syncRuntime(doc, rt, buildNav(doc)); return rt; }
const NOON = new Date(2026, 9, 18, 12, 0, 0);
const withPreset = (d: OfficeDoc, layoutPreset: 'grid' | 'bubble') => applyOps(d, [{ op: 'settings.update', patch: { layoutPreset } }]).doc;

/** The sample with its rooms scattered, so there is something to sort. */
function scrambled(): OfficeDoc {
  const doc = sampleOffice();
  const ids = Object.keys(doc.rooms).sort();
  const ops = ids.map((id, i) => ({ op: 'room.update' as const, id, patch: { x: (i * 37) % 140, y: Math.floor(i / 4) * 30 } }));
  return applyOps(doc, [{ op: 'room.update', id: ids[0], patch: { x: 300, y: 300 } }, ...ops, { op: 'corridors.realign' }]).doc;
}

describe('Neural Command Campus', () => {
  test('affinity links rooms that share a team, and explains why', () => {
    const doc = sampleOffice();
    const links = roomAffinity(doc, runtimeFor(doc));
    const team = [...links.values()].filter((l) => [...l.reasons.keys()].some((r) => r.startsWith('same team')));
    expect(team.length).toBeGreaterThan(0);
  });

  test('Auto Sort previews moves with reasons, brings collaborators closer, and keeps every room connected', () => {
    const doc = scrambled();
    const rt = runtimeFor(doc);
    const plan = planAutoSort(doc, rt);
    expect(plan.moves.length).toBeGreaterThan(0);
    expect(plan.after).toBeLessThan(plan.before);
    expect(plan.moves.every((m) => m.reason.length > 0)).toBe(true);
    const r = applyOps(doc, plan.ops);
    expect(r.errors).toEqual([]);
    // rooms never overlap and every hallway still reaches its rooms
    const issues = validate(r.doc).filter((i) => i.severity === 'error');
    expect(issues).toEqual([]);
    expect(Object.values(r.doc.corridors).every((c) => c.status !== 'broken')).toBe(true);
    expect(collaborationDistance(r.doc.rooms, roomAffinity(doc, rt))).toBe(plan.after);
  });

  test('Auto Sort is pure until applied, and a second run finds nothing better', () => {
    const doc = scrambled();
    const before = JSON.stringify(doc.rooms);
    const plan = planAutoSort(doc, null);
    expect(JSON.stringify(doc.rooms)).toBe(before);
    const sorted = applyOps(doc, plan.ops).doc;
    const again = planAutoSort(sorted, null);
    expect(again.ops.length).toBe(0);
    expect(again.message).toMatch(/already well arranged/i);
  });

  test('the bubble preset packs rooms with wider gaps than the grid preset', () => {
    const grid = withPreset(scrambled(), 'grid');
    const bubble = withPreset(scrambled(), 'bubble');
    const span = (d: OfficeDoc, p: ReturnType<typeof planAutoSort>) => {
      const rooms = Object.values(applyOps(d, p.ops).doc.rooms);
      return Math.max(...rooms.map((r) => r.x + r.w)) - Math.min(...rooms.map((r) => r.x)) + Math.max(...rooms.map((r) => r.y + r.h)) - Math.min(...rooms.map((r) => r.y));
    };
    expect(span(bubble, planAutoSort(bubble, null))).toBeGreaterThan(span(grid, planAutoSort(grid, null)));
  });

  test('older saves migrate to the grid preset; the sample uses the bubble office', () => {
    const old = JSON.parse(JSON.stringify(emptyOffice('Old')));
    old.schemaVersion = 5; delete old.settings.layoutPreset;
    const r = parseOffice(old);
    expect(r.ok && r.doc.settings.layoutPreset).toBe('grid');
    expect(sampleOffice().settings.layoutPreset).toBe('bubble');
  });

  test('tubes carry agents faster than walking the same hallway', () => {
    const ticksToArrive = (preset: 'grid' | 'bubble') => {
      const doc = withPreset(sampleOffice(), preset);
      const nav = buildNav(doc);
      const rt = runtimeFor(doc);
      goTo(doc, rt, nav, 'agent_codex', 'room_ops');
      let n = 0;
      while (rt.agents.agent_codex.status === 'walking' && n < 2000) { step(doc, rt, nav, { demoTasks: false, rand: () => 0.5 }); n++; }
      return n;
    };
    expect(ticksToArrive('bubble')).toBeLessThan(ticksToArrive('grid'));
  });

  test('mail capsules ride the dedicated network through the hub and leave a delivery receipt', () => {
    const doc = sampleOffice();
    const rt = runtimeFor(doc);
    const net = mailNetwork(doc)!;
    expect(net.spokes.length).toBeGreaterThan(1);
    const t = createTask(rt, { name: 'Brief the board', agentId: 'agent_codex', priority: 'high' });
    const { capsule } = dispatchViaTube(doc, rt, t.id, 'agent_orion');
    expect(capsule!.path.some((p) => p.x === net.hub.x && p.y === net.hub.y)).toBe(true);
    let n = 0;
    while (rt.capsules[capsule!.id]?.status === 'in-transit' && n++ < 500) { stepCapsules(doc, rt, 1, NOON); rt.tick++; }
    expect(rt.capsules[capsule!.id]).toMatchObject({ status: 'delivered', acknowledged: true });
    for (let i = 0; i <= CAPSULE_LINGER + 1; i++) { rt.tick++; stepCapsules(doc, rt, 1, NOON); }
    expect(rt.capsules[capsule!.id]).toBeUndefined();
  });
});
