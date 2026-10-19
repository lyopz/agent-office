// The hourly briefing (engine/briefing.ts) and the Royal Lounge that hosts it.
import { describe, expect, test } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import { buildBriefing, classifyTask, filterItems, groupItems, taskHistory } from '../src/engine/briefing';
import { buildNav, findPath, roomSpot } from '../src/engine/navigation';
import { emptyRuntime, syncRuntime } from '../src/engine/simulation';
import { applyOps } from '../src/engine/ops';
import { sampleOffice } from '../src/model/sample';
import { FURNITURE_META } from '../src/model/catalog';
import { builtinRoomTemplates } from '../src/model/defaults';
import { exportOffice, parseOffice } from '../src/model/schema';
import { FurnitureShape } from '../src/viewport/OfficeLayers';
import type { OfficeDoc, RuntimeState, Task } from '../src/model/types';

const NOW = Date.parse('2026-10-19T12:00:00.000Z');
const ago = (min: number) => new Date(NOW - min * 60_000).toISOString();

function task(id: string, patch: Partial<Task>): Task {
  return {
    id, name: `Task ${id}`, description: '', agentId: 'agent_atlas', priority: 'normal', status: 'queued', dependencies: [],
    destination: { roomId: null, workstationId: null }, progress: 0, workUnits: 100, createdAt: ago(90), simulated: true, ...patch,
  };
}

function world(tasks: Task[], tweak?: (rt: RuntimeState, doc: OfficeDoc) => void) {
  const doc = sampleOffice();
  const rt = emptyRuntime(); syncRuntime(doc, rt, buildNav(doc));
  for (const t of tasks) rt.tasks[t.id] = t;
  tweak?.(rt, doc);
  return { doc, rt };
}

describe('buildBriefing', () => {
  test('assigns every status to the right bucket', () => {
    const { doc, rt } = world([
      task('done', { status: 'done', progress: 100, startedAt: ago(40), completedAt: ago(10) }),
      task('act', { status: 'active', progress: 50, startedAt: ago(20), agentId: 'agent_volt' }),
      task('tube', { status: 'in-transit', agentId: 'agent_pixel' }),
      task('q', { status: 'queued', agentId: 'agent_echo' }),
      task('appr', { status: 'waiting-approval', agentId: 'agent_ledger' }),
      task('held', { status: 'paused', heldBy: 'department', agentId: 'agent_mesh' }),
      task('fail', { status: 'failed', failures: 2, startedAt: ago(30), agentId: 'agent_bolt' }),
      task('dep', { status: 'queued', dependencies: ['fail'], agentId: 'agent_codex' }),
      task('cxl', { status: 'cancelled' }),
    ]);
    const b = buildBriefing(doc, rt, NOW);
    const bucket = (id: string) => b.items.find((i) => i.taskId === id)?.bucket;
    expect(bucket('done')).toBe('done');
    expect(bucket('act')).toBe('active');
    expect(bucket('tube')).toBe('active');
    expect(bucket('q')).toBe('queued');
    for (const id of ['appr', 'held', 'fail', 'dep']) expect(bucket(id), id).toBe('blocked');
    expect(bucket('cxl')).toBeUndefined();
    expect(b.counts).toEqual({ done: 1, active: 2, blocked: 4, queued: 1 });
    expect(b.items.find((i) => i.taskId === 'held')!.blockedReason).toMatch(/department paused/);
    expect(b.items.find((i) => i.taskId === 'dep')!.blockedReason).toMatch(/Task fail/);
    // blocked first, done last
    expect(b.items[0].bucket).toBe('blocked');
    expect(b.items[b.items.length - 1].bucket).toBe('done');
  });

  test('an agent stuck on its active task makes the task blocked', () => {
    const { doc, rt } = world([task('a', { status: 'active', startedAt: ago(5), agentId: 'agent_volt' })], (rt) => {
      Object.assign(rt.agents.agent_volt, { status: 'error', currentTaskId: 'a', statusMessage: 'No route to Server Room' });
    });
    const b = buildBriefing(doc, rt, NOW);
    expect(b.items[0]).toMatchObject({ bucket: 'blocked', blockedReason: 'No route to Server Room', agentName: 'VOLT' });
    expect(b.attention.filter((a) => a.agentId === 'agent_volt')).toHaveLength(1); // not listed twice
  });

  test('done work counts only inside the one-hour window', () => {
    const { doc, rt } = world([
      task('recent', { status: 'done', completedAt: ago(59) }),
      task('edge', { status: 'done', completedAt: ago(60) }),
      task('old', { status: 'done', completedAt: ago(61) }),
      task('future', { status: 'done', completedAt: new Date(NOW + 60_000).toISOString() }),
      task('oldfail', { status: 'failed', startedAt: ago(200), createdAt: ago(240) }),
      task('notyet', { status: 'queued', createdAt: new Date(NOW + 5_000).toISOString() }),
      task('oldq', { status: 'queued', createdAt: ago(600) }), // current queue is always shown
    ]);
    const b = buildBriefing(doc, rt, NOW);
    expect(b.items.map((i) => i.taskId).sort()).toEqual(['edge', 'oldq', 'recent']);
    expect(b.windowStart).toBe(ago(60));
    expect(b.generatedAt).toBe(new Date(NOW).toISOString());
    // a wider window picks up the older completion
    expect(buildBriefing(doc, rt, NOW, { windowMinutes: 120 }).counts.done).toBe(3);
  });

  test('failure time comes from the failure log line when there is one', () => {
    const t = task('f', { status: 'failed', startedAt: ago(300), createdAt: ago(300), agentId: 'agent_bolt' });
    const { doc, rt } = world([t], (rt) => rt.events.push({ id: 'e1', at: ago(15), kind: 'task-failed', agentId: 'agent_bolt', message: `“${t.name}” failed (BOLT): timeout`, simulated: true, level: 'error' }));
    const b = buildBriefing(doc, rt, NOW);
    expect(b.items[0]).toMatchObject({ taskId: 'f', bucket: 'blocked', failedAt: ago(15) });
    expect(b.attention[0]).toMatchObject({ kind: 'blocked', severity: 'high', taskId: 'f' });
  });

  test('groups by team and by project, with catch-all groups last', () => {
    const { doc, rt } = world([
      task('r1', { status: 'active', startedAt: ago(10), agentId: 'agent_atlas', projectId: 'proj_catalog' }),
      task('r2', { status: 'done', completedAt: ago(5), agentId: 'agent_atlas' }),
      task('i1', { status: 'queued', agentId: 'agent_volt', projectId: 'proj_platform' }),
      task('u1', { status: 'queued', agentId: null, projectId: 'proj_platform' }),
    ]);
    const b = buildBriefing(doc, rt, NOW);
    const team = Object.fromEntries(b.byTeam.map((g) => [g.label, g.counts]));
    expect(team.Research).toEqual({ done: 1, active: 1, blocked: 0, queued: 0 });
    expect(team.Infrastructure.queued).toBe(1);
    expect(b.byTeam[b.byTeam.length - 1].label).toBe('Unassigned');
    const proj = Object.fromEntries(b.byProject.map((g) => [g.label, g.items.map((i) => i.taskId).sort()]));
    expect(proj['Platform Reliability']).toEqual(['i1', 'u1']);
    expect(proj['Knowledge Catalogue']).toEqual(['r1']);
    expect(b.byProject[b.byProject.length - 1].label).toBe('No project');
    expect(b.projects.map((p) => p.id)).toContain(null);
    // filters compose with grouping
    const f = filterItems(b.items, { projectId: 'proj_platform', bucket: 'queued', team: 'Infrastructure' });
    expect(f.map((i) => i.taskId)).toEqual(['i1']);
    expect(filterItems(b.items, { projectId: 'none' }).map((i) => i.taskId)).toEqual(['r2']);
    expect(groupItems(f, 'team')).toHaveLength(1);
  });

  test('attention lists blockers, overdue work and stuck agents; idle agents are listed', () => {
    const { doc, rt } = world([
      task('appr', { status: 'waiting-approval', agentId: 'agent_ledger', priority: 'high' }),
      task('late', { status: 'active', startedAt: ago(30), progress: 25, deadline: ago(5), agentId: 'agent_scout' }),
      task('busy', { status: 'queued', agentId: 'agent_echo' }),
    ], (rt) => {
      rt.approvals.ap1 = { id: 'ap1', at: ago(3), agentId: 'agent_ledger', action: 'spend', detail: 'Buy data feed', reason: 'over limit', status: 'pending', taskId: 'appr' };
      Object.assign(rt.agents.agent_rusty, { status: 'error', statusMessage: 'No route to Workshop' });
    });
    const b = buildBriefing(doc, rt, NOW);
    expect(b.attention.map((a) => a.kind).sort()).toEqual(['agent-error', 'blocked', 'overdue']);
    expect(b.attention.find((a) => a.kind === 'blocked')!.message).toMatch(/Buy data feed/);
    expect(b.attention[b.attention.length - 1].severity).toBe('medium'); // high severity first
    const idle = b.idleAgents.map((a) => a.agentId);
    expect(idle).toContain('agent_atlas');
    for (const id of ['agent_ledger', 'agent_scout', 'agent_echo', 'agent_rusty']) expect(idle).not.toContain(id);
    // ETA from observed progress: 25% in 30 min → 90 more minutes
    expect(b.items.find((i) => i.taskId === 'late')).toMatchObject({ etaBasis: 'observed', eta: new Date(NOW + 90 * 60_000).toISOString(), overdue: true });
  });

  test('is pure: it does not change the runtime it reads', () => {
    const { doc, rt } = world([task('a', { status: 'active', startedAt: ago(1) }), task('d', { status: 'done', completedAt: ago(2) })]);
    const before = JSON.stringify(rt);
    buildBriefing(doc, rt, NOW);
    expect(JSON.stringify(rt)).toBe(before);
    expect(classifyTask(rt, rt.tasks.d, NOW - 3_600_000, NOW)).toEqual({ bucket: 'done' });
  });

  test('task history collects timestamps, approvals and log lines for that run only', () => {
    const t = task('h', { status: 'done', createdAt: ago(30), startedAt: ago(25), completedAt: ago(5) });
    const { rt } = world([t], (rt) => {
      rt.approvals.a = { id: 'a', at: ago(28), agentId: 'agent_atlas', action: 'spend', detail: 'Start', reason: 'r', status: 'approved', decidedAt: ago(26), taskId: 'h' };
      rt.events.push({ id: 'old', at: ago(120), kind: 'library', agentId: 'agent_atlas', message: `checked library for “${t.name}”`, simulated: true, level: 'info' });
      rt.events.push({ id: 'new', at: ago(20), kind: 'library', agentId: 'agent_atlas', message: `checked library for “${t.name}”`, simulated: true, level: 'info' });
    });
    const h = taskHistory(rt, 'h');
    expect(h.map((e) => e.label)).toEqual(['Created', 'Approval requested: Start', 'Approval approved', 'Started', `checked library for “${t.name}”`, 'Completed']);
  });
});

describe('Royal Lounge', () => {
  test("the sample has a King's Lounge with its furniture, reachable on foot", () => {
    const doc = sampleOffice();
    const lounge = Object.values(doc.rooms).find((r) => r.type === 'royal-lounge')!;
    expect(lounge.name).toBe("King's Lounge");
    const types = lounge.furnitureIds.map((id) => doc.furniture[id].type);
    for (const t of ['briefing-board', 'throne', 'lounge-sofa', 'crown-chandelier', 'holo-fountain'] as const) expect(types).toContain(t);
    expect(FURNITURE_META.throne.fn).toBe('seating');
    expect(FURNITURE_META['lounge-sofa'].fn).toBe('seating');
    const nav = buildNav(doc);
    const from = roomSpot(nav, doc.rooms.room_ops)!, to = roomSpot(nav, lounge)!;
    expect(findPath(nav, from, to)).not.toBeNull();
  });

  test('offered as a room template and survives save and reload', () => {
    expect(builtinRoomTemplates().some((t) => t.type === 'royal-lounge' && t.furniture.some((f) => f.type === 'briefing-board'))).toBe(true);
    const r = applyOps(sampleOffice(), [{ op: 'room.create', id: 'room_l2', type: 'royal-lounge', x: 0, y: 80, w: 14, h: 10 }]);
    expect(r.errors).toEqual([]);
    const back = parseOffice(JSON.parse(exportOffice(r.doc)));
    expect(back.ok).toBe(true);
    if (back.ok) expect(Object.values(back.doc.furniture).filter((f) => f.roomId === 'room_l2').map((f) => f.type)).toContain('throne');
  });

  test('the new furniture draws, and the briefing board is clickable', () => {
    for (const type of ['briefing-board', 'throne', 'lounge-sofa', 'crown-chandelier', 'holo-fountain'] as const) {
      const m = FURNITURE_META[type];
      const svg = renderToStaticMarkup(createElement('svg', null, createElement(FurnitureShape, { f: { id: 'x', type, color: m.color }, x: 0, y: 0, w: m.w, h: m.h })));
      expect(svg, type).toContain('data-kind="furniture"');
      if (type === 'briefing-board') expect(svg).toContain('openable');
    }
  });
});

describe('BriefingBoard', () => {
  test('renders the summary strip, refresh time, filters and grouping with text labels, not colour alone', async () => {
    const mem = new Map<string, string>();
    (globalThis as unknown as { localStorage: Storage }).localStorage = {
      getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, String(v)), removeItem: (k: string) => void mem.delete(k),
      clear: () => mem.clear(), key: (i: number) => [...mem.keys()][i] ?? null, get length() { return mem.size; },
    } as Storage;
    const { useStore } = await import('../src/store/store');
    const { BriefingBoard } = await import('../src/ui/BriefingBoard');
    const rt = useStore.getState().runtime;
    rt.tasks.t1 = task('t1', { status: 'waiting-approval', agentId: 'agent_ledger', createdAt: new Date(Date.now() - 60_000).toISOString() });
    const html = renderToStaticMarkup(createElement(BriefingBoard));
    expect(html).toContain('role="dialog"');
    expect(html).toContain('aria-modal="true"');
    expect(html).toContain('Last refreshed');
    for (const label of ['Done', 'Active', 'Blocked', 'Queued', 'By team', 'By project', 'All teams', 'All projects', 'All statuses', 'Refresh']) expect(html, label).toContain(label);
    expect(html).toContain('Task t1');
    expect(html).toContain('aria-label="Close briefing"');
  });
});
