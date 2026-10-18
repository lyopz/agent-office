// The 15 acceptance tests from the AI Headquarters specification, run against
// the real engines, store and schema. Plus a large-office performance check.
import { beforeAll, describe, expect, test } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import { applyOps, type DocOp } from '../src/engine/ops';
import { validate } from '../src/engine/validate';
import { buildNav } from '../src/engine/navigation';
import { checkPlacement, findObjectSpot } from '../src/engine/spatial';
import { createTask, emptyRuntime, step, syncRuntime } from '../src/engine/simulation';
import { HEADLESS_ENV, planDeliveries, raiseAlert, testAlert } from '../src/engine/alerts';
import { approvalReason, decideApproval, recordUsage, requestAction } from '../src/engine/governance';
import { dispatchViaTube, stepCapsules } from '../src/engine/tubes';
import { sampleOffice } from '../src/model/sample';
import { emptyOffice } from '../src/model/defaults';
import { exportOffice, parseOffice } from '../src/model/schema';
import { activeTheme, themeVars } from '../src/model/themes';
import { Character } from '../src/characters/Character';
import { interpret } from '../src/ai/parser';
import type { OfficeDoc, RuntimeState } from '../src/model/types';

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

const ok = (doc: OfficeDoc, ops: DocOp[]) => { const r = applyOps(doc, ops); expect(r.errors).toEqual([]); return r.doc; };
const errors = (doc: OfficeDoc) => validate(doc).filter((i) => i.severity === 'error');
function runtimeFor(doc: OfficeDoc): RuntimeState { const rt = emptyRuntime(); syncRuntime(doc, rt, buildNav(doc)); return rt; }
const NOON = new Date(2026, 9, 18, 12, 0, 0);
const at = (sec: number) => new Date(NOON.getTime() + sec * 1000);

describe('AI Headquarters acceptance', () => {
  test('1. a librarian and a president have distinct designs, roles, workstations and profiles', () => {
    const doc = sampleOffice();
    const orion = doc.agents.agent_orion, codex = doc.agents.agent_codex;
    expect(orion.archetype).toBe('president');
    expect(codex.archetype).toBe('librarian');
    expect(orion.identity.title).not.toBe(codex.identity.title);
    expect(orion.identity.roleDescription).not.toBe(codex.identity.roleDescription);
    expect(orion.appearance.top).not.toBe(codex.appearance.top);
    expect(orion.appearance.accessories).not.toEqual(codex.appearance.accessories);
    expect(orion.permissions.allowedTools).not.toEqual(codex.permissions.allowedTools);
    const ws = (id: string) => Object.values(doc.furniture).find((f) => f.workstation?.assignedAgentId === id)!;
    expect(ws('agent_orion').type).not.toBe(ws('agent_codex').type);
    expect(doc.rooms[ws('agent_orion').roomId].type).not.toBe(doc.rooms[ws('agent_codex').roomId].type);
    const svg = (id: string) => renderToStaticMarkup(createElement(Character, { a: doc.agents[id].appearance, view: 'front', pose: 'idle', frame: 0, facing: 'right', heading: 'down', size: 80 }));
    expect(svg('agent_orion')).not.toBe(svg('agent_codex'));
  });

  test('2. changing an outfit keeps the agent identity, permissions and memory', () => {
    let doc = sampleOffice();
    const before = doc.agents.agent_codex;
    doc = ok(doc, [{ op: 'agent.update', id: 'agent_codex', patch: { appearance: { top: 'armor', topColor: '#552222' } } }]);
    const after = doc.agents.agent_codex;
    expect(after.appearance.top).toBe('armor');
    for (const k of ['identity', 'permissions', 'memory', 'skills', 'ai', 'budget', 'personality'] as const) expect(after[k]).toEqual(before[k]);
    doc = ok(doc, [{ op: 'agent.restoreAppearance', id: 'agent_codex' }]);
    expect(doc.agents.agent_codex.appearance.top).toBe(before.appearance.top);
  });

  test('3. an outfit saved from one agent applies to another', () => {
    let doc = sampleOffice();
    doc = ok(doc, [{ op: 'outfit.save', id: 'out_exec', name: 'Executive gold', fromAgentId: 'agent_orion' }]);
    const outfit = doc.outfitTemplates.find((o) => o.id === 'out_exec')!;
    expect(outfit).toBeTruthy();
    const scoutIdentity = doc.agents.agent_scout.identity;
    doc = ok(doc, [{ op: 'outfit.apply', outfitId: 'out_exec', agentIds: ['agent_scout'] }]);
    expect(doc.agents.agent_scout.appearance.top).toBe(doc.agents.agent_orion.appearance.top);
    expect(doc.agents.agent_scout.appearance.trimColor).toBe(doc.agents.agent_orion.appearance.trimColor);
    expect(doc.agents.agent_scout.identity).toEqual(scoutIdentity);
  });

  test('4. a holo-desk, an archive terminal and a tube station can be added', () => {
    let doc = sampleOffice();
    const room = doc.rooms.room_library;
    const ops: DocOp[] = [];
    let probe = doc;
    for (const type of ['holo-desk', 'archive-terminal', 'tube-station'] as const) {
      const spot = findObjectSpot(probe, probe.rooms.room_library, type);
      expect(spot).not.toBeNull();
      const op: DocOp = { op: 'furniture.add', roomId: room.id, type, x: spot!.x, y: spot!.y, id: `new_${type}`, strict: true };
      probe = ok(probe, [op]); ops.push(op);
    }
    doc = ok(doc, ops);
    expect(doc.furniture['new_holo-desk'].type).toBe('holo-desk');
    expect(doc.furniture['new_archive-terminal'].type).toBe('archive-terminal');
    expect(doc.furniture['new_tube-station'].tube).toBeTruthy();
    expect(errors(doc)).toEqual([]);
    expect(validate(doc).filter((i) => i.code === 'furniture-overlap')).toEqual([]);
  });

  test('5. moving a group keeps its spacing', () => {
    let doc = sampleOffice();
    doc = ok(doc, [
      { op: 'room.create', id: 'g', type: 'office', x: 0, y: 70, w: 16, h: 10 },
      { op: 'furniture.add', roomId: 'g', type: 'desk', x: 1, y: 1, id: 'd1' },
      { op: 'furniture.add', roomId: 'g', type: 'desk', x: 5, y: 1, id: 'd2' },
      { op: 'furniture.add', roomId: 'g', type: 'plant', x: 3, y: 4, id: 'p1' },
      { op: 'furniture.group', ids: ['d1', 'd2', 'p1'], groupId: 'grp' },
    ]);
    const rel = (d: OfficeDoc) => ['d2', 'p1'].map((id) => ({ dx: d.furniture[id].x - d.furniture.d1.x, dy: d.furniture[id].y - d.furniture.d1.y }));
    const spacing = rel(doc);
    doc = ok(doc, [{ op: 'furniture.moveMany', ids: ['d1', 'd2', 'p1'], dx: 3, dy: 2 }]);
    expect(doc.furniture.d1.x).toBe(4);
    expect(doc.furniture.d1.y).toBe(3);
    expect(rel(doc)).toEqual(spacing);
    expect(new Set(['d1', 'd2', 'p1'].map((id) => doc.furniture[id].groupId))).toEqual(new Set(['grp']));
  });

  test('6. switching dark to light mode leaves characters unchanged', () => {
    let doc = sampleOffice();
    const agents = structuredClone(doc.agents);
    const draw = (d: OfficeDoc) => Object.values(d.agents).map((a) => renderToStaticMarkup(createElement(Character, { a: a.appearance, view: 'front', pose: 'idle', frame: 0, facing: 'right', heading: 'down', size: 80 }))).join('');
    const dark = draw(doc);
    const theme0 = activeTheme(doc.appearance);
    const darkVars = themeVars(theme0.dark, theme0.office.dark, 'dark');
    doc = ok(doc, [{ op: 'appearance.update', patch: { mode: 'light' } }]);
    expect(doc.appearance.mode).toBe('light');
    expect(themeVars(theme0.light, theme0.office.light, 'light')).not.toEqual(darkVars);
    expect(doc.agents).toEqual(agents);
    expect(draw(doc)).toBe(dark);
  });

  test('7. a library room palette is independent of the global theme', () => {
    let doc = sampleOffice();
    doc = ok(doc, [{ op: 'room.applyPalette', roomIds: ['room_library'], patch: { wallColor: '#4a2d7a', floorColor: '#1a1030', lightTemp: 3000 } }]);
    const lib = structuredClone(doc.rooms.room_library.appearance);
    const others = structuredClone(doc.rooms.room_eng.appearance);
    doc = ok(doc, [{ op: 'appearance.update', patch: { mode: 'light' } }]);
    const theme = doc.appearance.themes.find((t) => t.id !== doc.appearance.themeId)!;
    doc = ok(doc, [{ op: 'appearance.update', patch: { themeId: theme.id } }]);
    expect(doc.rooms.room_library.appearance).toEqual(lib);
    expect(doc.rooms.room_library.appearance.wallColor).toBe('#4a2d7a');
    expect(doc.rooms.room_eng.appearance).toEqual(others);
  });

  test('8. a sound can be chosen, previewed and a test alert received', () => {
    const doc0 = sampleOffice();
    const doc = ok(doc0, [{ op: 'alerts.update', patch: { sounds: { high: { soundId: 'klaxon', volume: 0.6 } } } }]);
    expect(doc.alertSettings.sounds.high.soundId).toBe('klaxon');
    expect(doc.alertSettings.sounds.high.ackRequired).toBe(doc0.alertSettings.sounds.high.ackRequired);
    const rt = runtimeFor(doc);
    const a = testAlert(doc, rt, 'high', NOON).alert;
    expect(a.test).toBe(true);
    expect(a.deliveries.find((d) => d.channel === 'in-app')?.status).toBe('shown');
    expect(a.deliveries.find((d) => d.channel === 'sound')).toMatchObject({ status: 'delivered', soundId: 'klaxon' });
    // before the browser allows audio, the delivery says so instead of pretending
    const locked = planDeliveries(doc.alertSettings, a, NOON, { ...HEADLESS_ENV, soundUnlocked: false });
    expect(locked.find((d) => d.channel === 'sound')?.status).toBe('permission-needed');
    for (const ch of ['email', 'messaging', 'push'] as const) {
      const d = planDeliveries({ ...doc.alertSettings, channels: { ...doc.alertSettings.channels, [ch]: { enabled: true, minSeverity: 'info' } } }, a, NOON, HEADLESS_ENV).find((x) => x.channel === ch);
      expect(d?.status).toBe('not-connected');
    }
  });

  test('9. a budget warning links to the project and its usage records', () => {
    const doc = sampleOffice();
    const rt = runtimeFor(doc);
    const p = doc.projects.proj_catalog;
    const credits = (p.budget * doc.alertSettings.thresholds.budgetWarnPct) / 100 / 4 + 1;
    const recs = [0, 1, 2, 3].map((i) => recordUsage(doc, rt, { agentId: 'agent_codex', projectId: p.id, taskId: null, credits, kind: 'model' }, at(i)));
    const alert = Object.values(rt.alerts).find((a) => a.key === `budget:${p.id}:warn`)!;
    expect(alert).toBeTruthy();
    expect(alert.category).toBe('financial');
    expect(alert.projectId).toBe(p.id);
    const ids = alert.evidence.filter((e) => e.kind === 'usage').map((e) => e.id);
    expect(ids).toContain(recs[recs.length - 1].id);
    for (const id of ids) expect(rt.usage.find((u) => u.id === id)?.projectId).toBe(p.id);
    expect(rt.usage.every((u) => u.simulated)).toBe(true);
  });

  test('10. a priority task travels the tube network and the recipient acknowledges it', () => {
    const doc = sampleOffice();
    const rt = runtimeFor(doc);
    const t = createTask(rt, { name: 'Urgent: verify pricing sources', agentId: 'agent_codex', priority: 'critical', projectId: 'proj_catalog' });
    const r = dispatchViaTube(doc, rt, t.id, 'agent_orion');
    expect(r.capsule).not.toBeNull();
    expect(doc.furniture[r.capsule!.fromId].roomId).toBe('room_exec');
    expect(doc.furniture[r.capsule!.toId].roomId).toBe('room_library');
    expect(rt.tasks[t.id].status).toBe('in-transit');
    let n = 0;
    while (rt.capsules[r.capsule!.id]?.status === 'in-transit' && n++ < 500) stepCapsules(doc, rt, 1, NOON);
    expect(rt.tasks[t.id]).toMatchObject({ status: 'queued', deliveredVia: 'tube', acknowledgedBy: 'agent_codex' });
    expect(rt.events.some((e) => e.kind === 'tube' && /acknowledged/.test(e.message))).toBe(true);
  });

  test('11. an unauthorised action requests approval', () => {
    const doc = sampleOffice();
    const rt = runtimeFor(doc);
    const t = createTask(rt, { name: 'Buy dataset', agentId: 'agent_scout', projectId: 'proj_launch' });
    const req = { agentId: 'agent_scout', action: 'spend', detail: 'Buy a market dataset', amount: doc.agents.agent_scout.budget.approvalAbove + 40, projectId: 'proj_launch', taskId: t.id };
    expect(approvalReason(doc, req)).toBeTruthy();
    const r = requestAction(doc, rt, req, NOON);
    expect(r.allowed).toBe(false);
    if (r.allowed) return;
    expect(rt.approvals[r.approval.id].status).toBe('pending');
    expect(rt.tasks[t.id].status).toBe('waiting-approval');
    const alert = Object.values(rt.alerts).find((a) => a.approvalId === r.approval.id)!;
    expect(alert.severity).toBe('high');
    decideApproval(doc, rt, r.approval.id, true, at(5));
    expect(rt.approvals[r.approval.id].status).toBe('approved');
    expect(rt.tasks[t.id].status).toBe('queued');
    expect(rt.alerts[alert.id].status).toBe('resolved');
    // a tool the agent hasn't been granted also needs approval
    expect(approvalReason(doc, { agentId: 'agent_scout', action: 'shell', detail: 'Run a script', tool: true })).toBeTruthy();
  });

  test('12. remodelling while agents are active stays responsive and keeps data', () => {
    const s = useStore.getState();
    s.newOffice(true);
    s.setPrefs({ demoTasks: true });
    for (let i = 0; i < 40; i++) useStore.getState().tick();
    const before = useStore.getState();
    const agents = Object.keys(before.doc.agents).sort();
    const tasks = Object.keys(before.runtime.tasks).length;
    const plan = interpret('Arrange the desks in two aligned rows in the research lab', { doc: before.doc, selection: { kind: 'none' }, idleAgentIds: [] });
    expect(plan.kind).toBe('plan');
    if (plan.kind !== 'plan') return;
    const t0 = performance.now();
    const res = useStore.getState().commit(plan.ops, plan.label);
    for (let i = 0; i < 20; i++) useStore.getState().tick();
    const ms = performance.now() - t0;
    expect(res.ok).toBe(true);
    const after = useStore.getState();
    expect(Object.keys(after.doc.agents).sort()).toEqual(agents);
    expect(Object.keys(after.runtime.tasks).length).toBeGreaterThanOrEqual(Math.min(tasks, 1));
    expect(Object.values(after.runtime.agents).every((r) => Number.isFinite(r.pos.x) && Number.isFinite(r.pos.y))).toBe(true);
    expect(ms).toBeLessThan(1500);
    expect(errors(after.doc)).toEqual([]);
  });

  test('13. save and reload keeps positions, themes, appearances, sounds and alert rules', () => {
    let doc = sampleOffice();
    doc = ok(doc, [
      { op: 'furniture.moveMany', ids: ['tube_library'], dx: 1, dy: 0 },
      { op: 'appearance.update', patch: { mode: 'light' } },
      { op: 'room.applyPalette', roomIds: ['room_library'], patch: { wallColor: '#4a2d7a' } },
      { op: 'agent.update', id: 'agent_codex', patch: { appearance: { top: 'robe', topColor: '#331155' } } },
      { op: 'alerts.update', patch: { sounds: { warning: { soundId: 'chime' } }, quietHours: { enabled: true, start: '22:00', end: '07:00' }, thresholds: { repeatedFailures: 4 } } },
    ]);
    const parsed = parseOffice(JSON.parse(exportOffice(doc)));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const d = parsed.doc;
    expect(Object.fromEntries(Object.values(d.furniture).map((f) => [f.id, [f.roomId, f.x, f.y, f.rotation]]))).toEqual(Object.fromEntries(Object.values(doc.furniture).map((f) => [f.id, [f.roomId, f.x, f.y, f.rotation]])));
    expect(d.appearance).toEqual(doc.appearance);
    expect(d.rooms.room_library.appearance).toEqual(doc.rooms.room_library.appearance);
    expect(d.agents.agent_codex.appearance).toEqual(doc.agents.agent_codex.appearance);
    expect(d.alertSettings).toEqual(doc.alertSettings);
    // and through the browser repository used by autosave
    const s = useStore.getState();
    s.loadDoc(doc, 'test'); s.save();
    const raw = localStorage.getItem('agent-office:current')!;
    expect(raw).not.toMatch(/sk-ant-|apiKey"\s*:\s*"[^"]/);
    const reloaded = parseOffice(JSON.parse(raw).doc);
    expect(reloaded.ok && reloaded.doc.alertSettings).toEqual(doc.alertSettings);
  });

  test('14. a repeated failure is deduplicated and escalated', () => {
    const doc = sampleOffice();
    const rt = runtimeFor(doc);
    const input = { key: 'task-fail:agent_bolt:diagnostics', severity: 'warning' as const, category: 'operational' as const, title: 'Diagnostics failed', description: 'Probe timed out', recommended: 'Retry or reassign', agentId: 'agent_bolt' };
    const n = doc.alertSettings.thresholds.repeatedFailures;
    for (let i = 0; i < n; i++) raiseAlert(doc, rt, input, at(i * 5));
    const matching = Object.values(rt.alerts).filter((a) => a.key === input.key);
    expect(matching).toHaveLength(1);
    expect(matching[0].count).toBe(n);
    expect(matching[0].severity).toBe('high');
    expect(matching[0].escalationLevel).toBeGreaterThanOrEqual(1);
    expect(matching[0].title).toMatch(/^Repeated/);
  });

  test('15. routine activity does not overwhelm the owner', () => {
    const doc = sampleOffice();
    const rt = runtimeFor(doc);
    const nav = buildNav(doc);
    for (let i = 0; i < 600; i++) step(doc, rt, nav, { demoTasks: true });
    const done = Object.values(rt.tasks).filter((t) => t.status === 'done').length;
    expect(done).toBeGreaterThan(0);
    const noisy = Object.values(rt.alerts).filter((a) => a.deliveries.some((d) => d.channel === 'sound' && d.status === 'delivered'));
    expect(noisy.length).toBeLessThanOrEqual(3);
    // routine info never makes a sound, but critical cuts through quiet hours and mute
    const s = { ...doc.alertSettings, quietHours: { enabled: true, start: '00:00', end: '23:59' }, muted: { operational: true } };
    const snd = (sev: 'info' | 'critical') => planDeliveries(s, { severity: sev, category: 'operational' }, NOON, HEADLESS_ENV).find((d) => d.channel === 'sound');
    expect(snd('info')?.status ?? 'suppressed').toBe('suppressed');
    expect(snd('critical')?.status).toBe('delivered');
  });
});

describe('performance', () => {
  test('a large office places objects and steps the simulation quickly', () => {
    let doc = emptyOffice('Big HQ');
    const ops: DocOp[] = [];
    for (let i = 0; i < 48; i++) ops.push({ op: 'room.create', id: `r${i}`, type: 'office', x: (i % 8) * 20, y: Math.floor(i / 8) * 16, w: 16, h: 12 });
    doc = ok(doc, ops);
    const fops: DocOp[] = [];
    for (let i = 0; i < 48; i++) for (let k = 0; k < 12; k++) fops.push({ op: 'furniture.add', roomId: `r${i}`, type: 'desk', x: 1 + (k % 4) * 3, y: 1 + Math.floor(k / 4) * 3, id: `f${i}_${k}` });
    for (let i = 0; i < 60; i++) fops.push({ op: 'agent.create', name: `A${i}`, id: `ag${i}`, roomId: `r${i % 48}` });
    doc = ok(doc, fops);
    expect(Object.keys(doc.furniture).length).toBeGreaterThanOrEqual(576);
    const room = doc.rooms.r20;
    let t0 = performance.now();
    for (let i = 0; i < 500; i++) checkPlacement(doc, room, { x: i % 14, y: i % 10, w: 2, h: 1, rotation: 0, blocking: true });
    expect(performance.now() - t0).toBeLessThan(300);
    t0 = performance.now();
    const moved = ok(doc, [{ op: 'furniture.moveMany', ids: Array.from({ length: 12 }, (_, k) => `f20_${k}`), dx: 0, dy: 0 }]);
    validate(moved);
    expect(performance.now() - t0).toBeLessThan(1500);
    const rt = runtimeFor(doc); const nav = buildNav(doc);
    t0 = performance.now();
    for (let i = 0; i < 100; i++) step(doc, rt, nav, { demoTasks: true });
    expect((performance.now() - t0) / 100).toBeLessThan(20);
  });
});
