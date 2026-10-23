// The brain shows only ORIGIN and the branches it grew; other agents stay in the backend.
import { describe, expect, test } from 'vitest';
import { creatorBrain } from '../src/model/sample';
import { applyOps } from '../src/engine/ops';
import { brainAgents, treeOf } from '../src/brain/BrainScene';
import { teamsOf } from '../src/brain/connectome';
import { parseOffice } from '../src/model/schema';
import { emptyRuntime, step, syncRuntime, createTask } from '../src/engine/simulation';

/** ORIGIN plus two agents from an older save that aren't ORIGIN's branches. */
const withStaff = () => applyOps(creatorBrain(), [
  { op: 'agent.create', name: 'SCOUT', id: 'agent_scout', department: 'Research' },
  { op: 'agent.create', name: 'BOLT', id: 'agent_bolt', department: 'Engineering' },
]).doc;

describe('brain agents', () => {
  test('a fresh brain is ORIGIN alone', () => {
    expect(Object.keys(creatorBrain().agents)).toEqual(['agent_origin']);
  });

  test('agents that are not ORIGIN branches are hidden from the brain but kept', () => {
    const doc = withStaff();
    expect(brainAgents(doc.agents).map((a) => a.id)).toEqual(['agent_origin']);
    expect(Object.keys(treeOf(doc.agents, teamsOf(doc)).nodes)).toEqual(['agent_origin']);
    expect(Object.keys(doc.agents)).toHaveLength(3);
  });

  test('ventures and their skill agents grow as branches', () => {
    const doc = applyOps(withStaff(), [
      { op: 'agent.update', id: 'agent_scout', patch: { branch: { kind: 'venture', ventureId: 'agent_scout' }, skills: { supervisorId: 'agent_origin' } } },
      { op: 'agent.update', id: 'agent_bolt', patch: { branch: { kind: 'skill', ventureId: 'agent_scout' }, skills: { supervisorId: 'agent_scout' } } },
    ]).doc;
    const tree = treeOf(doc.agents, teamsOf(doc));
    expect(Object.keys(tree.nodes).sort()).toEqual(['agent_bolt', 'agent_origin', 'agent_scout']);
    expect(tree.nodes.agent_bolt.parentId).toBe('agent_scout');
  });
});

describe('no office left', () => {
  test('an old office save becomes a brain: agents, knowledge and projects kept, rooms and outfits dropped', () => {
    const office = {
      schemaVersion: 7, id: 'office_x', name: 'Old office',
      settings: { gridSize: 24 }, rooms: { room_a: { id: 'room_a' } }, corridors: {}, furniture: {}, cosmetics: [], outfitTemplates: [], roomTemplates: [], departments: {}, arcade: {}, player: {},
      agents: { agent_origin: { id: 'agent_origin', identity: { name: 'ORIGIN', title: 'Lead' }, appearance: { top: 'suit' }, schedule: { assignedRoomId: 'room_a', preferredWorkstationId: null, workStart: '08:00' }, permissions: { canMoveRooms: true } } },
      library: {}, projects: {}, control: { emergencyStop: false, policy: {}, simplifyAbove: 30, blenderBridgeUrl: '' },
      appearance: creatorBrain().appearance, alertSettings: creatorBrain().alertSettings,
    };
    const r = parseOffice(office);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const doc = r.doc as unknown as Record<string, unknown>;
    for (const k of ['rooms', 'corridors', 'furniture', 'cosmetics', 'arcade', 'player', 'departments']) expect(doc[k]).toBeUndefined();
    const a = r.doc.agents.agent_origin as unknown as Record<string, Record<string, unknown>>;
    expect(a.appearance).toBeUndefined();
    expect(a.schedule.assignedRoomId).toBeUndefined();
    expect(a.schedule.workStart).toBe('08:00');
    expect(r.doc.control).toEqual({ emergencyStop: false });
  });

  test('queued work runs without rooms, and the emergency stop holds it with its progress', () => {
    const doc = creatorBrain(), rt = emptyRuntime();
    syncRuntime(doc, rt);
    const t = createTask(rt, { name: 'Research demand', agentId: 'agent_origin', workUnits: 20 });
    for (let i = 0; i < 12; i++) step(doc, rt);
    expect(rt.tasks[t.id].status).toBe('active');
    const progress = rt.tasks[t.id].progress;
    expect(progress).toBeGreaterThan(0);
    const stopped = { ...doc, control: { emergencyStop: true } };
    step(stopped, rt);
    expect(rt.tasks[t.id]).toMatchObject({ status: 'paused', heldBy: 'emergency' });
    for (let i = 0; i < 30; i++) step(doc, rt);
    expect(rt.tasks[t.id].status).toBe('done');
  });
});
