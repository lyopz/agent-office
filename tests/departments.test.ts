// Phase 3: department controls, resource policies, the operations floor,
// production pipeline, human-only arcade and persistence.
import { beforeAll, describe, expect, test } from 'vitest';
import { applyOps, type DocOp } from '../src/engine/ops';
import { validate } from '../src/engine/validate';
import { buildNav } from '../src/engine/navigation';
import { createTask, emptyRuntime, step, syncRuntime } from '../src/engine/simulation';
import { departmentStats } from '../src/engine/departments';
import { assetTruth, completeAssetTask, createAsset, productionTask, reviewAsset } from '../src/engine/production';
import { agentArcadeAttempt } from '../src/engine/arcadePolicy';
import { sampleOffice, seedSampleRuntime } from '../src/model/sample';
import { departmentId } from '../src/model/control';
import { exportOffice, parseOffice } from '../src/model/schema';
import type { OfficeDoc, RuntimeState, Task } from '../src/model/types';

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
function world(doc = sampleOffice()) {
  const rt = emptyRuntime(); const nav = buildNav(doc); syncRuntime(doc, rt, nav);
  let seed = 7; const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const run = (d: OfficeDoc, n: number, demoTasks = false) => { for (let i = 0; i < n; i++) step(d, rt, nav, { demoTasks, rand }); };
  return { doc, rt, nav, run };
}
const DESIGN = departmentId('3D Design');

/** Give an agent one task and run until it is actively working on it. */
function startWork(w: ReturnType<typeof world>, agentId: string, t: Partial<Task> = {}) {
  const a = w.doc.agents[agentId];
  const task = createTask(w.rt, { name: 'Long job', agentId, workUnits: 400, destination: { roomId: a.schedule.assignedRoomId, workstationId: a.schedule.preferredWorkstationId }, ...t });
  for (let i = 0; i < 400 && w.rt.tasks[task.id].progress < 10; i++) w.run(w.doc, 1);
  expect(w.rt.tasks[task.id].status).toBe('active');
  return task.id;
}

describe('department controls', () => {
  test('pausing a department holds its work with progress and freezes its agents; resuming continues', () => {
    const w = world();
    const id = startWork(w, 'agent_mesh');
    const before = w.rt.tasks[id].progress;
    w.doc = ok(w.doc, [{ op: 'departments.setMode', ids: [DESIGN], mode: 'paused' }]);
    w.run(w.doc, 1);
    expect(w.rt.tasks[id]).toMatchObject({ status: 'paused', heldBy: 'department' });
    const held = w.rt.tasks[id].progress;
    expect(held).toBeGreaterThanOrEqual(before);
    const pos = { ...w.rt.agents.agent_mesh.pos };
    w.run(w.doc, 100, true);
    expect(w.rt.agents.agent_mesh.status).toBe('paused');
    expect(w.rt.agents.agent_mesh.pos).toEqual(pos);
    expect(w.rt.tasks[id].progress).toBe(held);
    expect(Object.values(w.rt.tasks).filter((t) => t.agentId === 'agent_rig' && t.status === 'active')).toHaveLength(0);
    expect(departmentStats(w.doc, w.rt).find((s) => s.dept.id === DESIGN)?.state).toBe('paused');
    // other departments keep working
    expect(Object.values(w.rt.tasks).some((t) => t.status === 'active' && t.agentId && w.doc.agents[t.agentId].identity.department !== '3D Design')).toBe(true);

    w.doc = ok(w.doc, [{ op: 'departments.setMode', ids: [DESIGN], mode: 'running' }]);
    for (let i = 0; i < 400 && w.rt.tasks[id].progress <= held; i++) w.run(w.doc, 1);
    expect(w.rt.tasks[id].progress).toBeGreaterThan(held);
    expect(w.rt.tasks[id].heldBy).toBeNull();
  });

  test('renders follow the render policy; saves always finish', () => {
    for (const policy of ['finish', 'defer', 'cancel'] as const) {
      const w = world();
      w.doc = ok(w.doc, [{ op: 'department.update', name: '3D Design', patch: { renderPolicy: policy } }]);
      const id = startWork(w, 'agent_mesh', { jobKind: 'render', workUnits: 200 });
      for (let i = 0; i < 400 && w.rt.tasks[id].progress < 30; i++) w.run(w.doc, 1);
      w.doc = ok(w.doc, [{ op: 'departments.setMode', ids: [DESIGN], mode: 'paused' }]);
      w.run(w.doc, 1);
      const t = w.rt.tasks[id];
      if (policy === 'finish') {
        expect(t.status).toBe('active');
        expect(departmentStats(w.doc, w.rt).find((s) => s.dept.id === DESIGN)?.state).toBe('pausing');
        for (let i = 0; i < 400 && w.rt.tasks[id].status !== 'done'; i++) w.run(w.doc, 1);
        expect(w.rt.tasks[id].status).toBe('done');
        w.run(w.doc, 2);
        expect(departmentStats(w.doc, w.rt).find((s) => s.dept.id === DESIGN)?.state).toBe('paused');
      }
      if (policy === 'defer') { expect(t.status).toBe('paused'); expect(t.progress % 25).toBe(0); expect(t.checkpoint).toBe(t.progress); }
      if (policy === 'cancel') expect(t.status).toBe('cancelled');
    }
    const w = world();
    const save = startWork(w, 'agent_rig', { jobKind: 'save', workUnits: 150 });
    w.doc = ok(w.doc, [{ op: 'departments.setMode', ids: [DESIGN], mode: 'paused' }]);
    for (let i = 0; i < 300 && w.rt.tasks[save].status !== 'done'; i++) w.run(w.doc, 1);
    expect(w.rt.tasks[save].status).toBe('done');
  });

  test('excluded agents keep working through a bulk pause; emergency pause stops everyone', () => {
    const w = world();
    w.doc = ok(w.doc, [{ op: 'department.update', name: '3D Design', patch: { excludedAgentIds: ['agent_rig'] } }, { op: 'departments.setMode', ids: [DESIGN], mode: 'paused' }]);
    const id = startWork(w, 'agent_rig');
    w.run(w.doc, 20);
    expect(w.rt.tasks[id].status).toBe('active');
    expect(w.rt.agents.agent_mesh.status).toBe('paused');

    w.doc = ok(w.doc, [{ op: 'control.update', patch: { emergencyStop: true } }]);
    w.run(w.doc, 2);
    expect(Object.values(w.rt.agents).every((r) => r.status === 'paused')).toBe(true);
    expect(Object.values(w.rt.tasks).filter((t) => t.status === 'active')).toHaveLength(0);
    expect(w.rt.tasks[id]).toMatchObject({ status: 'paused', heldBy: 'emergency' });
    w.doc = ok(w.doc, [{ op: 'control.update', patch: { emergencyStop: false } }]);
    const kept = w.rt.tasks[id].progress;
    w.run(w.doc, 1);
    expect(['queued', 'active']).toContain(w.rt.tasks[id].status);
    expect(w.rt.tasks[id].heldBy ?? null).toBeNull();
    expect(w.rt.tasks[id].progress).toBeGreaterThanOrEqual(kept);
  });

  test('pause all, resume selected, enable all agents and batch assignment', () => {
    let doc = sampleOffice();
    doc = ok(doc, [{ op: 'departments.setMode', ids: 'all', mode: 'paused' }]);
    const w = world(doc);
    w.run(w.doc, 3, true);
    expect(Object.values(w.rt.agents).every((r) => r.status === 'paused')).toBe(true);
    w.doc = ok(w.doc, [{ op: 'departments.setMode', ids: [departmentId('E-commerce'), DESIGN], mode: 'running' }]);
    w.run(w.doc, 3);
    expect(w.rt.agents.agent_merch.status).not.toBe('paused');
    expect(w.rt.agents.agent_orion.status).toBe('paused');

    w.doc = ok(w.doc, [{ op: 'department.setAgentsEnabled', id: departmentId('E-commerce'), enabled: false }]);
    expect(w.doc.agents.agent_cart.enabled).toBe(false);
    w.doc = ok(w.doc, [{ op: 'department.setAgentsEnabled', id: departmentId('E-commerce'), enabled: true }]);
    expect(w.doc.agents.agent_cart.enabled).toBe(true);

    const s = useStore.getState();
    s.newOffice(true);
    const out = s.runRuntimeOps([{ op: 'tasks.batch', departmentId: departmentId('Operations Floor'), name: 'Tag tickets', count: 48 }]);
    expect(out[0]).toMatch(/48 tasks across 24 agents/);
    const per = new Map<string, number>();
    for (const t of Object.values(useStore.getState().runtime.tasks)) if (t.name.startsWith('Tag tickets')) per.set(t.agentId!, (per.get(t.agentId!) ?? 0) + 1);
    expect([...per.values()].every((n) => n === 2)).toBe(true);
  });

  test('per-department limits and resource policies hold new work but never stop running work', () => {
    let doc = sampleOffice();
    doc = ok(doc, [{ op: 'department.update', name: 'Operations Floor', patch: { maxConcurrent: 3 } }]);
    const w = world(doc);
    for (let i = 0; i < 300; i++) {
      w.run(w.doc, 1, true);
      const active = Object.values(w.rt.tasks).filter((t) => t.status === 'active' && t.agentId && w.doc.agents[t.agentId].identity.department === 'Operations Floor').length;
      expect(active).toBeLessThanOrEqual(3);
    }

    const p = world();
    p.doc = ok(p.doc, [{ op: 'control.update', patch: { policy: { pauseNonessential: true, autoResume: true } } }]);
    const shop = startWork(p, 'agent_merch');
    startWork(p, 'agent_mesh', { jobKind: 'render', workUnits: 300 });
    p.run(p.doc, 12);
    expect(p.rt.policyHeld).toContain(departmentId('E-commerce'));
    expect(p.rt.policyHeld).not.toContain(departmentId('Executive')); // essential
    expect(p.rt.tasks[shop].status).toBe('active'); // running work continues
    for (const t of Object.values(p.rt.tasks)) if (t.jobKind === 'render') p.rt.tasks[t.id] = { ...t, status: 'done' };
    p.run(p.doc, 12);
    expect(p.rt.policyHeld).toEqual([]);
  });

  test('department modes, exclusions and policies survive save and reload', () => {
    let doc = sampleOffice();
    doc = ok(doc, [
      { op: 'departments.setMode', ids: [DESIGN], mode: 'paused' },
      { op: 'department.update', name: 'Operations Floor', patch: { excludedAgentIds: ['agent_ops1'], maxConcurrent: 12 } },
      { op: 'control.update', patch: { policy: { prioritizeRendering: true, backgroundLimit: 4 }, simplifyAbove: 25 } },
    ]);
    const r = parseOffice(JSON.parse(exportOffice(doc)));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.doc.departments).toEqual(doc.departments);
    expect(r.doc.control).toEqual(doc.control);
    // older files migrate with everything running
    const v3 = JSON.parse(exportOffice(sampleOffice())).office;
    delete v3.departments; delete v3.control; delete v3.arcade; v3.schemaVersion = 3;
    const m = parseOffice(v3);
    expect(m.ok && m.doc.control.emergencyStop).toBe(false);
    expect(m.ok && m.doc.arcade.policy).toBe('human-only');
  });
});

describe('operations floor', () => {
  test('40 agents work the floor without getting stuck, and steps stay fast', () => {
    let doc = sampleOffice();
    const ops: DocOp[] = [];
    for (let i = 25; i <= 40; i++) ops.push({ op: 'agent.createFromArchetype', archetype: 'ops-worker', name: `OPS-${i}`, id: `agent_ops${i}`, roomId: 'room_floor' });
    doc = ok(doc, ops);
    expect(validate(doc).filter((i) => i.severity === 'error')).toEqual([]);
    const floor = Object.values(doc.agents).filter((a) => a.identity.department === 'Operations Floor');
    expect(floor).toHaveLength(40);
    expect(new Set(floor.map((a) => a.schedule.preferredWorkstationId)).size).toBe(40); // one desk each
    const w = world(doc);
    const t0 = performance.now();
    w.run(w.doc, 600, true);
    const per = (performance.now() - t0) / 600;
    expect(per).toBeLessThan(15);
    const done = Object.values(w.rt.tasks).filter((t) => t.status === 'done' && t.agentId && w.doc.agents[t.agentId].identity.department === 'Operations Floor').length;
    expect(done).toBeGreaterThan(20);
    expect(floor.filter((a) => w.rt.agents[a.id].status === 'error')).toHaveLength(0);
    // no two seated agents share a cell
    const cells = floor.filter((a) => w.rt.agents[a.id].status === 'working').map((a) => `${Math.round(w.rt.agents[a.id].pos.x)},${Math.round(w.rt.agents[a.id].pos.y)}`);
    expect(new Set(cells).size).toBe(cells.length);
  });
});

describe('production pipeline', () => {
  test('stages advance by work, review needs the owner, and simulated progress is never called real', () => {
    const doc = sampleOffice();
    const rt: RuntimeState = emptyRuntime();
    const job = createAsset(rt, { name: 'Jetpack', kind: 'prop', ownerAgentId: 'agent_mesh', projectId: 'proj_roblox' });
    const finish = (t: Task | null) => { expect(t).not.toBeNull(); rt.tasks[t!.id] = { ...t!, status: 'done' }; completeAssetTask(doc, rt, t!); };
    finish(productionTask(doc, rt, doc.agents.agent_mesh)); // assigned → creating
    finish(productionTask(doc, rt, doc.agents.agent_mesh)); // creating → preview
    const preview = productionTask(doc, rt, doc.agents.agent_mesh);
    expect(preview?.jobKind).toBe('render');
    finish(preview); // preview → review
    expect(rt.assets[job.id].stage).toBe('review');
    expect(productionTask(doc, rt, doc.agents.agent_mesh)).toBeNull(); // waits for the owner
    expect(reviewAsset(rt, job.id, true)).toBe(true);
    finish(productionTask(doc, rt, doc.agents.agent_mesh)); // export
    expect(productionTask(doc, rt, doc.agents.agent_mesh)).toBeNull(); // integration belongs to QA
    finish(productionTask(doc, rt, doc.agents.agent_probe));
    expect(rt.assets[job.id].stage).toBe('integrated');
    expect(rt.assets[job.id].real).toBeNull();
    expect(assetTruth(rt.assets[job.id])).toMatch(/Simulated progress only/);
    const fresh = emptyRuntime(); seedSampleRuntime(doc, fresh);
    expect(Object.keys(fresh.assets).length).toBeGreaterThan(5);
  });
});

describe('human-only arcade', () => {
  test('the sample arcade has the three playable machines', () => {
    const doc = sampleOffice();
    const games = Object.values(doc.furniture).filter((f) => f.arcade).map((f) => f.arcade!.game).sort();
    expect(games).toEqual(['flappy', 'pacman', 'pong']);
  });

  test('agents are blocked from arcade machines in code, and attempts are logged', () => {
    const doc = sampleOffice();
    expect(applyOps(doc, [{ op: 'workstation.assign', furnitureId: 'cab_pong', agentId: 'agent_luau' }]).errors[0]).toMatch(/owner only/);
    expect(applyOps(doc, [{ op: 'furniture.update', id: 'cab_pong', patch: { workstation: { name: 'Hack' } } }]).errors[0]).toMatch(/owner only/);
    const rt = emptyRuntime();
    const r = agentArcadeAttempt(doc, rt, 'agent_luau', 'pong', 'test');
    expect(r.ok).toBe(false);
    expect(rt.events.at(-1)).toMatchObject({ kind: 'policy', agentId: 'agent_luau' });

    const s = useStore.getState();
    s.newOffice(true);
    const out = s.runRuntimeOps([
      { op: 'agent.goTo', agentId: 'agent_luau', roomId: 'room_arcade', workstationId: 'cab_flappy' },
      { op: 'task.create', agentId: 'agent_quest', name: 'Play a round', roomId: 'room_arcade', workstationId: 'cab_pacman' },
    ]);
    expect(out.every((m) => /policy: human-only/.test(m))).toBe(true);
    const st = useStore.getState();
    expect(Object.values(st.runtime.tasks).some((t) => t.name === 'Play a round')).toBe(false);
    expect(st.runtime.agents.agent_luau.destination?.workstationId).not.toBe('cab_flappy');
    expect(st.runtime.events.filter((e) => e.kind === 'policy')).toHaveLength(2);
  });

  test('token-free agent play cannot be switched on until verified, even from a file', () => {
    const doc = sampleOffice();
    expect(applyOps(doc, [{ op: 'arcade.update', patch: { policy: 'token-free', tokenFreeVerified: true } }]).errors[0]).toMatch(/can’t be enabled/);
    const raw = JSON.parse(exportOffice(doc));
    raw.office.arcade.policy = 'token-free'; raw.office.arcade.tokenFreeVerified = true;
    const r = parseOffice(raw);
    expect(r.ok && r.doc.arcade).toMatchObject({ policy: 'human-only', tokenFreeVerified: false });
  });

  test('the owner’s own sessions are recorded separately from agents', () => {
    const s = useStore.getState();
    s.newOffice(true);
    s.runRuntimeOps([{ op: 'arcade.recordSession', game: 'pong', score: 11, durationSec: 95, result: 'win' }]);
    expect(useStore.getState().runtime.arcadeSessions.at(-1)).toMatchObject({ agentId: null, game: 'pong', score: 11, reward: 0 });
  });
});

