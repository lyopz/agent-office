// The 15 acceptance tests from the build brief, run against the real engine,
// store, schema and command interpreter (no UI mocks).
import { beforeAll, describe, expect, test } from 'vitest';
import { applyOps, type DocOp } from '../src/engine/ops';
import { validate } from '../src/engine/validate';
import { isOrthogonal } from '../src/engine/geometry';
import { resolveEndpoint } from '../src/engine/routing';
import { buildNav, findPath, roomSpot } from '../src/engine/navigation';
import { emptyRuntime, goTo, syncRuntime } from '../src/engine/simulation';
import { emptyOffice } from '../src/model/defaults';
import { sampleOffice } from '../src/model/sample';
import { exportOffice, parseOffice, stripSecrets } from '../src/model/schema';
import { interpret, type ParseContext, type Plan } from '../src/ai/parser';
import { getProvider } from '../src/ai/providers';
import type { Corridor, OfficeDoc } from '../src/model/types';

// Minimal localStorage so the real store and repository run under Node.
class MemoryStorage {
  private m = new Map<string, string>();
  getItem(k: string) { return this.m.has(k) ? this.m.get(k)! : null; }
  setItem(k: string, v: string) { this.m.set(k, String(v)); }
  removeItem(k: string) { this.m.delete(k); }
  clear() { this.m.clear(); }
  key(i: number) { return [...this.m.keys()][i] ?? null; }
  get length() { return this.m.size; }
}
(globalThis as unknown as { localStorage: Storage }).localStorage = new MemoryStorage() as unknown as Storage;

type Store = typeof import('../src/store/store')['useStore'];
let useStore: Store;
beforeAll(async () => { useStore = (await import('../src/store/store')).useStore; });

const ok = (doc: OfficeDoc, ops: DocOp[]) => {
  const r = applyOps(doc, ops);
  expect(r.errors).toEqual([]);
  return r.doc;
};
const errors = (doc: OfficeDoc) => validate(doc).filter((i) => i.severity === 'error');
const ctx = (doc: OfficeDoc, extra: Partial<ParseContext> = {}): ParseContext => ({ doc, selection: { kind: 'none' }, idleAgentIds: [], ...extra });
const asPlan = (p: Plan) => { expect(p.kind).toBe('plan'); return p as Extract<Plan, { kind: 'plan' }>; };

/** A corridor is valid when it's routed, orthogonal, and both ends sit on their door anchors. */
function corridorConnected(doc: OfficeDoc, c: Corridor) {
  expect(c.status).not.toBe('broken');
  expect(c.points.length).toBeGreaterThanOrEqual(2);
  expect(isOrthogonal(c.points)).toBe(true);
  for (const [ep, pt] of [[c.start, c.points[0]], [c.end, c.points[c.points.length - 1]]] as const) {
    if (ep.kind !== 'door') continue;
    const r = resolveEndpoint(doc, ep);
    expect(r.error).toBeUndefined();
    expect(r.anchor).toEqual(pt);
  }
}

function threeRooms() {
  let d = emptyOffice('Test');
  d = ok(d, [
    { op: 'room.create', id: 'a', type: 'office', x: 0, y: 0, w: 8, h: 6 },
    { op: 'room.create', id: 'b', type: 'research', x: 14, y: 0, w: 8, h: 6 },
    { op: 'room.create', id: 'c', type: 'server', x: 28, y: 0, w: 8, h: 6 },
  ]);
  return ok(d, [{ op: 'rooms.connect', id: 'h1', a: 'a', b: 'b' }, { op: 'rooms.connect', id: 'h2', a: 'b', b: 'c' }]);
}

describe('Acceptance', () => {
  test('1. create three rooms and a hallway connecting them', () => {
    const d = threeRooms();
    expect(Object.keys(d.rooms)).toHaveLength(3);
    expect(Object.keys(d.corridors)).toEqual(['h1', 'h2']);
    for (const c of Object.values(d.corridors)) corridorConnected(d, c);
    expect(errors(d)).toEqual([]);
    const nav = buildNav(d);
    expect(findPath(nav, roomSpot(nav, d.rooms.a)!, roomSpot(nav, d.rooms.c)!)).not.toBeNull();
  });

  test('2. move the middle room; hallways reconnect automatically', () => {
    const before = threeRooms();
    const d = ok(before, [{ op: 'room.update', id: 'b', patch: { y: 12 } }]);
    expect(d.rooms.b.y).toBe(12);
    for (const c of Object.values(d.corridors)) corridorConnected(d, c);
    expect(d.corridors.h1.points).not.toEqual(before.corridors.h1.points);
    expect(errors(d)).toEqual([]);
  });

  test('3. resize a room; doors, furniture and corridors stay valid', () => {
    let d = threeRooms();
    d = ok(d, [{ op: 'furniture.add', id: 'desk1', roomId: 'b', type: 'desk', x: 6, y: 4 }]);
    d = ok(d, [{ op: 'room.update', id: 'b', patch: { w: 5, h: 4 } }]);
    const room = d.rooms.b;
    for (const door of room.doors) {
      const len = door.side === 'n' || door.side === 's' ? room.w : room.h;
      expect(door.offset + door.width).toBeLessThanOrEqual(len);
    }
    const f = d.furniture.desk1;
    expect(f.x + f.w).toBeLessThanOrEqual(room.w);
    expect(f.y + f.h).toBeLessThanOrEqual(room.h);
    for (const c of Object.values(d.corridors)) corridorConnected(d, c);
    expect(errors(d)).toEqual([]);
  });

  test('4. edit a hallway manually, then return it to automatic routing', () => {
    let d = threeRooms();
    d = ok(d, [{ op: 'settings.update', patch: { hallwayMode: 'hybrid' } }]);
    const auto = d.corridors.h1.points;
    const [s, e] = [auto[0], auto[auto.length - 1]];
    const detour = [s, { x: s.x + 2, y: s.y }, { x: s.x + 2, y: s.y + 4 }, { x: e.x - 1, y: s.y + 4 }, { x: e.x - 1, y: e.y }, e];
    d = ok(d, [{ op: 'corridor.update', id: 'h1', patch: { routing: 'manual', points: detour } }]);
    expect(d.corridors.h1.routing).toBe('manual');
    expect(d.corridors.h1.points.some((p) => p.y === s.y + 4)).toBe(true);
    // a manual corridor stays pinned to its doors when the room moves
    d = ok(d, [{ op: 'room.update', id: 'a', patch: { y: 1 } }]);
    corridorConnected(d, d.corridors.h1);
    d = ok(d, [{ op: 'corridor.update', id: 'h1', patch: { routing: 'auto' } }]);
    expect(d.corridors.h1.routing).toBe('auto');
    expect(d.corridors.h1.points.some((p) => p.y === s.y + 4)).toBe(false);
    corridorConnected(d, d.corridors.h1);
  });

  test('5. switch a character between views (one profile drives every view)', async () => {
    const s = useStore.getState();
    for (const v of ['top', 'front', 'side', 'three-quarter', 'auto'] as const) {
      s.setUi({ view: v });
      expect(useStore.getState().view).toBe(v);
    }
    // views are rendered from the single canonical appearance object
    const { renderToStaticMarkup } = await import('react-dom/server');
    const { createElement } = await import('react');
    const { Character } = await import('../src/characters/Character');
    const a = sampleOffice().agents.agent_rusty;
    const out = (['front', 'side', 'top', 'three-quarter', 'portrait'] as const).map((view) => renderToStaticMarkup(createElement(Character, { a: a.appearance, view, size: 64 })));
    expect(new Set(out).size).toBe(5);
    for (const svg of out) expect(svg).toContain(a.appearance.topColor);
  });

  test('6. change outfit without changing identity', () => {
    const d0 = sampleOffice();
    const a0 = d0.agents.agent_atlas;
    const d = ok(d0, [{ op: 'agent.update', id: 'agent_atlas', patch: { appearance: { top: 'coverall', topColor: '#556b2f', bottom: 'shorts' } } }]);
    const a = d.agents.agent_atlas;
    expect(a.appearance.top).toBe('coverall');
    expect(a.identity).toEqual(a0.identity);
    expect(a.personality).toEqual(a0.personality);
    expect(a.memory).toEqual(a0.memory);
    expect(a.appearance.skinTone).toBe(a0.appearance.skinTone);
  });

  test('7. save a profile and it persists', () => {
    const s = useStore.getState();
    s.loadDoc(sampleOffice(), 'Load sample');
    const r = s.commit([{ op: 'agent.update', id: 'agent_volt', patch: { identity: { title: 'Principal SRE', bio: 'Saved bio' }, personality: { traits: ['steady'] } } }], 'Edit profile');
    expect(r.ok).toBe(true);
    s.save();
    const raw = JSON.parse(localStorage.getItem('agent-office:current')!);
    const back = parseOffice(raw.doc);
    expect(back.ok).toBe(true);
    if (back.ok) {
      expect(back.doc.agents.agent_volt.identity.title).toBe('Principal SRE');
      expect(back.doc.agents.agent_volt.personality.traits).toEqual(['steady']);
    }
  });

  test('8. AI command moves a room and the geometry actually changes', () => {
    const d = sampleOffice();
    const before = { ...d.rooms.room_lab };
    const p = asPlan(interpret('Move the research room to the left of the main office', ctx(d)));
    expect(p.needsConfirm).toBe(true);
    const after = ok(d, p.ops);
    const lab = after.rooms.room_lab, ops = after.rooms.room_ops;
    expect([lab.x, lab.y]).not.toEqual([before.x, before.y]);
    expect(lab.x + lab.w).toBeLessThanOrEqual(ops.x);
    expect(errors(after)).toEqual([]);
    for (const c of Object.values(after.corridors)) expect(c.status).not.toBe('broken');
  });

  test('9. AI command changes appearance', () => {
    const d = sampleOffice();
    const p = asPlan(interpret('Change PIXEL into a realistic side-view mechanic wearing work clothes', ctx(d)));
    const after = ok(d, p.ops);
    const a = after.agents.agent_pixel.appearance;
    expect(a.artStyle).toBe('realistic');
    expect(a.preferredView).toBe('side');
    expect(a.top).not.toBe(d.agents.agent_pixel.appearance.top);
    expect(after.agents.agent_pixel.identity.name).toBe('PIXEL');
  });

  test('10. undo/redo a room move preserves assignments', () => {
    const s = useStore.getState();
    s.loadDoc(sampleOffice(), 'Load sample');
    const assigned = () => Object.values(useStore.getState().doc.furniture).filter((f) => f.workstation?.assignedAgentId).map((f) => [f.id, f.workstation!.assignedAgentId]);
    const agentsRooms = () => Object.values(useStore.getState().doc.agents).map((a) => [a.id, a.schedule.assignedRoomId]);
    const ws0 = assigned(), ar0 = agentsRooms();
    expect(ws0.length).toBeGreaterThan(0);
    expect(ar0.some(([, r]) => r)).toBe(true);
    const x0 = useStore.getState().doc.rooms.room_srv.x;
    expect(s.commit([{ op: 'room.update', id: 'room_srv', patch: { x: x0 + 3 } }], 'Move server room').ok).toBe(true);
    expect(useStore.getState().doc.rooms.room_srv.x).toBe(x0 + 3);
    s.undo();
    expect(useStore.getState().doc.rooms.room_srv.x).toBe(x0);
    expect(assigned()).toEqual(ws0); expect(agentsRooms()).toEqual(ar0);
    s.redo();
    expect(useStore.getState().doc.rooms.room_srv.x).toBe(x0 + 3);
    expect(assigned()).toEqual(ws0); expect(agentsRooms()).toEqual(ar0);
  });

  test('11. save and reload preserves layout, profiles and tasks', async () => {
    const s = useStore.getState();
    s.loadDoc(sampleOffice(), 'Load sample');
    s.commit([{ op: 'room.update', id: 'room_break', patch: { name: 'Coffee Lab' } }], 'Rename');
    s.runRuntimeOps([{ op: 'task.create', agentId: 'agent_echo', name: 'Persisted task' }]);
    s.save();
    const { LocalStorageRepository } = await import('../src/persistence/repository');
    const loaded = new LocalStorageRepository().loadCurrent();
    expect(loaded).not.toBeNull();
    expect(loaded!.doc).toEqual(useStore.getState().doc);
    expect(Object.values(loaded!.runtime!.tasks as Record<string, { name: string }>).some((t) => t.name === 'Persisted task')).toBe(true);
  });

  test('12. overlapping rooms produce a warning with a fix, and nothing is deleted', () => {
    const d0 = sampleOffice();
    const d = ok(d0, [{ op: 'room.update', id: 'room_srv', patch: { x: 30, y: 14 } }]);
    const iss = validate(d).filter((i) => i.code === 'room-overlap');
    expect(iss.length).toBeGreaterThan(0);
    expect(iss[0].objectIds).toContain('room_srv');
    expect(iss[0].fix).toBeDefined();
    expect(Object.keys(d.rooms)).toEqual(Object.keys(d0.rooms));
    const fixed = ok(d, iss[0].fix!.ops);
    expect(validate(fixed).filter((i) => i.code === 'room-overlap')).toEqual([]);
    // the store refuses to commit it silently
    const s = useStore.getState();
    s.loadDoc(d0, 'Load');
    const r = s.commit([{ op: 'room.update', id: 'room_srv', patch: { x: 30, y: 14 } }], 'Overlap');
    expect(r.ok).toBe(false);
    expect(useStore.getState().conflict).not.toBeNull();
    expect(useStore.getState().doc.rooms.room_srv.x).toBe(d0.rooms.room_srv.x);
    s.setUi({ conflict: null });
  });

  test('13. blocked corridor: agents reroute or report "no route"', () => {
    // a loop gives a detour: a—b direct, and a—c—b
    let d = emptyOffice('Loop');
    d = ok(d, [
      { op: 'room.create', id: 'a', type: 'office', x: 0, y: 0, w: 6, h: 6 },
      { op: 'room.create', id: 'b', type: 'office', x: 14, y: 0, w: 6, h: 6 },
      { op: 'room.create', id: 'c', type: 'office', x: 7, y: 14, w: 6, h: 6 },
    ]);
    d = ok(d, [{ op: 'rooms.connect', id: 'ab', a: 'a', b: 'b' }, { op: 'rooms.connect', id: 'ac', a: 'a', b: 'c' }, { op: 'rooms.connect', id: 'cb', a: 'c', b: 'b' }]);
    const nav0 = buildNav(d);
    const from = roomSpot(nav0, d.rooms.a)!, to = roomSpot(nav0, d.rooms.b)!;
    const direct = findPath(nav0, from, to)!;
    const blocked = ok(d, [{ op: 'corridor.update', id: 'ab', patch: { blocked: true } }]);
    const detour = findPath(buildNav(blocked), from, to);
    expect(detour).not.toBeNull();
    expect(detour!.length).toBeGreaterThan(direct.length);
    expect(validate(blocked).some((i) => i.code === 'corridor-blocked')).toBe(true);
    // block the only route: the agent goes to error state with a no-route message
    const sealed = ok(blocked, [{ op: 'corridor.update', id: 'ac', patch: { blocked: true } }, { op: 'corridor.update', id: 'cb', patch: { blocked: true } }]);
    const withAgent = ok(sealed, [{ op: 'agent.create', id: 'ag', name: 'T', roomId: 'a' }]);
    const rt = emptyRuntime(); const nav = buildNav(withAgent);
    syncRuntime(withAgent, rt, nav);
    const res = goTo(withAgent, rt, nav, 'ag', 'b');
    expect(res.ok).toBe(false);
    expect(rt.agents.ag.status).toBe('error');
    expect(rt.agents.ag.statusMessage).toMatch(/No route/);
  });

  test('14. AI disconnected: commands refuse, manual editing still works', async () => {
    const off = getProvider('off');
    const p = await off.plan('Move the server room', ctx(sampleOffice()));
    expect(p.kind).toBe('unsupported');
    const s = useStore.getState();
    s.setPrefs({ aiProvider: 'off' });
    s.loadDoc(sampleOffice(), 'Load sample');
    const r = s.commit([{ op: 'room.create', id: 'manual_room', type: 'storage', x: 0, y: 70, w: 5, h: 5 }], 'Manual room');
    expect(r.ok).toBe(true);
    expect(useStore.getState().doc.rooms.manual_room).toBeDefined();
    s.setPrefs({ aiProvider: 'mock' });
  });

  test('15. import a valid config; reject malformed config', () => {
    const d = sampleOffice();
    const text = exportOffice(d);
    const good = parseOffice(JSON.parse(text));
    expect(good.ok).toBe(true);
    const s = useStore.getState();
    expect(s.importText(text).ok).toBe(true);
    for (const bad of [
      '{not json',
      JSON.stringify({ hello: 'world' }),
      (() => { const e = JSON.parse(exportOffice(d)); e.office.rooms = { r: { id: 'r', x: 'left' } }; return JSON.stringify(e); })(),
      (() => { const e = JSON.parse(exportOffice(d)) as { office: { corridors: Record<string, Corridor> } }; e.office.corridors.hall_main.start = { kind: 'door', roomId: 'ghost', doorId: 'x' }; return JSON.stringify(e); })(),
    ]) {
      const before = useStore.getState().doc;
      const r = s.importText(bad);
      expect(r.ok).toBe(false);
      expect(useStore.getState().doc).toBe(before);
    }
  });
});

describe('Security and AI', () => {
  test('secrets are stripped from exports and saved files', () => {
    const d = ok(sampleOffice(), [{ op: 'agent.update', id: 'agent_nova', patch: { ai: { apiKey: 'sk-live-123' } as never } }]);
    const out = exportOffice(d);
    expect(out).not.toContain('sk-live-123');
    expect(JSON.stringify(stripSecrets({ a: { password: 'x', token: 'y', keep: 1 } }))).toBe('{"a":{"keep":1}}');
  });

  test('every example command produces a plan or a clarifying question', () => {
    const d = sampleOffice();
    const prompts = [
      'Move the research room to the left of the main office',
      'Make the hallway wider and align it with the conference room entrance',
      'Create a private office for the lead agent',
      'Give ATLAS a different personality and update its job description',
      'Move every idle agent to an available workstation',
      'Add a server room connected to the main corridor',
      'Undo the last layout change',
      'Block the east wing',
      'Send RUSTY to the break room',
      'Move the server room beside the research laboratory, extend the hallway between them, and move the research agent to the new workstation',
      'Make RUSTY a rugged mechanic in a side view with olive work clothes, a cap and a tool belt',
    ];
    for (const cmd of prompts) {
      const p = interpret(cmd, ctx(d, { idleAgentIds: Object.keys(d.agents), selection: { kind: 'agent', id: 'agent_rusty' } }));
      expect(p.kind, `${cmd} -> ${JSON.stringify(p).slice(0, 200)}`).not.toBe('unsupported');
      if (p.kind === 'plan') expect(applyOps(d, p.ops).errors, cmd).toEqual([]);
    }
  });
});
