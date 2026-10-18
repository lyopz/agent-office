// The bundled sample office. Built through the same structured operations the
// editor and AI console use, so it exercises the real routing engine.
import { produce } from 'immer';
import { applyOps, type DocOp } from '../engine/ops';
import { emptyOffice, makeAgent } from './defaults';
import type { Agent, OfficeDoc } from './types';

export function sampleOffice(): OfficeDoc {
  let doc = emptyOffice('NEXUS-7 Agent Office');
  doc.id = 'office_sample';
  const rooms: DocOp[] = [
    { op: 'room.create', id: 'room_ops', type: 'operations', name: 'Main Operations', x: 18, y: 12, w: 18, h: 11 },
    { op: 'room.create', id: 'room_lab', type: 'research', name: 'Research Lab', x: 0, y: 12, w: 11, h: 8 },
    { op: 'room.create', id: 'room_srv', type: 'server', name: 'Server Room', x: 44, y: 12, w: 9, h: 7 },
    { op: 'room.create', id: 'room_meet', type: 'meeting', name: 'Conference Room', x: 20, y: 0, w: 13, h: 7 },
    { op: 'room.create', id: 'room_break', type: 'break', name: 'Break Room', x: 44, y: 26, w: 9, h: 6 },
    { op: 'room.create', id: 'room_shop', type: 'workshop', name: 'Workshop', x: 20, y: 29, w: 11, h: 7 },
    { op: 'room.create', id: 'room_rec', type: 'reception', name: 'Reception', x: 0, y: 27, w: 11, h: 6 },
    { op: 'room.create', id: 'room_lead', type: 'office', name: 'Lead Office', x: 0, y: 0, w: 8, h: 6 },
  ];
  doc = applyOps(doc, rooms).doc;
  const links: DocOp[] = [
    { op: 'rooms.connect', id: 'hall_main', a: 'room_rec', b: 'room_ops', width: 3 },
    { op: 'rooms.connect', id: 'hall_lab', a: 'room_ops', b: 'room_lab' },
    { op: 'rooms.connect', id: 'hall_srv', a: 'room_ops', b: 'room_srv' },
    { op: 'rooms.connect', id: 'hall_meet', a: 'room_ops', b: 'room_meet' },
    { op: 'rooms.connect', id: 'hall_shop', a: 'room_ops', b: 'room_shop' },
    { op: 'rooms.connect', id: 'hall_break', a: 'room_srv', b: 'room_break' },
    { op: 'rooms.connect', id: 'hall_lead', a: 'room_lab', b: 'room_lead' },
  ];
  doc = applyOps(doc, links).doc;
  const names: Record<string, string> = {
    hall_main: 'Main Corridor', hall_lab: 'Lab Wing', hall_srv: 'East Wing', hall_meet: 'North Hall',
    hall_shop: 'South Hall', hall_break: 'Service Hall', hall_lead: 'Lead Hall',
  };
  doc = applyOps(doc, Object.entries(names).map(([id, name]) => ({ op: 'corridor.update', id, patch: { name } }) as DocOp)).doc;

  const agents: Agent[] = [];
  const add = (id: string, name: string, title: string, dept: string, look: Partial<Agent['appearance']>, extra: (a: Agent) => void) => {
    const a = makeAgent(name, title, dept, look); a.id = id; extra(a); agents.push(a);
  };
  add('agent_nova', 'NOVA', 'Lead Coordinator', 'Command', { hairStyle: 'bun', hairColor: '#e8e2d0', skinTone: '#a0663f', top: 'suit', topColor: '#13402a', headwear: 'headset', headwearColor: '#39ff88', accent: '#39ff88', jewelry: 'badge' }, (a) => {
    a.identity.bio = 'Coordinates the office, routes tasks, and resolves conflicts between agents.';
    a.personality.traits = ['decisive', 'calm', 'strategic']; a.personality.formality = 70; a.personality.initiative = 85;
    a.skills.skills = ['planning', 'delegation', 'reporting']; a.skills.taskPermissions = ['assign-tasks', 'execute-assigned'];
  });
  add('agent_atlas', 'ATLAS', 'Research Analyst', 'Research', { top: 'labcoat', topColor: '#e6eef0', glasses: 'round', hairStyle: 'curly', hairColor: '#1a1410', skinTone: '#7a4a2a', equipment: 'clipboard', accent: '#b57bff' }, (a) => {
    a.identity.bio = 'Digs through datasets and literature, then writes concise briefs.';
    a.personality.traits = ['curious', 'meticulous']; a.personality.detail = 90; a.personality.communicationStyle = 'detailed';
    a.skills.skills = ['literature review', 'data analysis', 'summarisation']; a.skills.tools = ['terminal', 'search', 'notebook'];
    a.memory.push({ id: 'mem_1', kind: 'project', persistent: true, title: 'Current focus', content: 'Benchmarking routing algorithms for the office nav graph.', createdAt: a.identity.createdAt });
  });
  add('agent_volt', 'VOLT', 'Systems Engineer', 'Infrastructure', { hairStyle: 'mohawk', hairColor: '#ff9f43', top: 'hoodie', topColor: '#2a1e10', glasses: 'visor', accent: '#ff9f43', artStyle: 'neon', skinTone: '#e8b897' }, (a) => {
    a.identity.bio = 'Keeps the cluster healthy and the racks cool.';
    a.personality.traits = ['pragmatic', 'fast']; a.personality.riskTolerance = 65; a.personality.humor = 60;
    a.skills.skills = ['linux', 'networking', 'monitoring']; a.skills.tools = ['terminal', 'ssh', 'metrics'];
  });
  add('agent_pixel', 'PIXEL', 'Interface Designer', 'Product', { hairStyle: 'long', hairColor: '#4cc9ff', skinTone: '#f6d7c3', top: 'tshirt', topColor: '#103a4a', accent: '#4cc9ff', equipment: 'tablet', jewelry: 'earrings' }, (a) => {
    a.identity.bio = 'Designs dashboards and control surfaces for the other agents.';
    a.personality.traits = ['creative', 'empathetic']; a.personality.creativity = 90; a.personality.communicationStyle = 'friendly';
    a.skills.skills = ['ui design', 'prototyping', 'accessibility'];
  });
  add('agent_rusty', 'RUSTY', 'Field Mechanic', 'Facilities', { top: 'coverall', topColor: '#d9772b', headwear: 'hardhat', headwearColor: '#f2c230', shoes: 'boots', shoeColor: '#4a3020', equipment: 'wrench', facialHair: 'beard', hairColor: '#5a3a20', skinTone: '#c68a64', build: 'broad', artStyle: 'realistic', preferredView: 'side' }, (a) => {
    a.identity.bio = 'Fixes anything with bolts. Prefers the workshop to meetings.';
    a.personality.traits = ['rugged', 'reliable', 'blunt']; a.personality.formality = 20; a.personality.humor = 70;
    a.skills.skills = ['repairs', 'fabrication', 'hvac']; a.skills.tools = ['wrench', 'multimeter'];
  });
  add('agent_echo', 'ECHO', 'Communications Officer', 'Front Office', { hairStyle: 'ponytail', hairColor: '#2a1d14', skinTone: '#4f3020', top: 'uniform', topColor: '#1f3d2e', headwear: 'headset', headwearColor: '#39ff88', accent: '#39ff88' }, (a) => {
    a.identity.bio = 'Handles visitors, inbound requests, and inter-agent messaging.';
    a.personality.traits = ['warm', 'organised']; a.personality.communicationStyle = 'friendly';
    a.skills.skills = ['triage', 'scheduling', 'messaging'];
  });
  doc = produce(doc, (d) => {
    for (const a of agents) {
      if (a.id !== 'agent_nova') a.skills.supervisorId = 'agent_nova';
      d.agents[a.id] = a;
    }
  });

  const ws = (roomId: string) => Object.values(doc.furniture).filter((f) => f.roomId === roomId && f.workstation).map((f) => f.id);
  const assign: [string, string | undefined][] = [
    ['agent_nova', ws('room_lead')[0]], ['agent_atlas', ws('room_lab')[0]], ['agent_volt', ws('room_srv')[0]],
    ['agent_pixel', ws('room_ops')[0]], ['agent_rusty', ws('room_shop')[0]], ['agent_echo', ws('room_rec')[0]],
  ];
  doc = applyOps(doc, assign.filter(([, f]) => f).map(([agentId, furnitureId]) => ({ op: 'workstation.assign', furnitureId: furnitureId!, agentId }) as DocOp)).doc;
  return doc;
}
