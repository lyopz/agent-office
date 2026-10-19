// The bundled sample office. Built through the same structured operations the
// editor and AI console use, so it exercises the real routing engine.
import { produce } from 'immer';
import { applyOps, type DocOp } from '../engine/ops';
import { emptyOffice, makeAgent } from './defaults';
import { findObjectSpot } from '../engine/spatial';
import type { Agent, FurnitureType, GameId, KnowledgeEntry, OfficeDoc, Project, RuntimeState } from './types';
import { createAsset } from '../engine/production';
import { validate } from '../engine/validate';
import { makeDepartment } from './control';

export function sampleOffice(): OfficeDoc {
  let doc = emptyOffice('NEXUS-7 Headquarters');
  doc.id = 'office_sample';
  doc.settings.layoutPreset = 'bubble'; // the Neural Command Campus look: floating rooms joined by transport tubes
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
  return addProductionWing(addHeadquarters(doc));
}

const HQ_CREATED = '2026-10-01T09:00:00.000Z';

/** The executive wing: business rooms, archetype agents, projects, tube network and library. */
function addHeadquarters(doc0: OfficeDoc): OfficeDoc {
  let doc = doc0;
  const run = (ops: DocOp[]) => { const r = applyOps(doc, ops); if (r.errors.length) throw new Error(`sample HQ: ${r.errors.join('; ')}`); doc = r.doc; };
  run([
    { op: 'room.create', id: 'room_exec', type: 'executive', name: 'Executive Suite', x: 62, y: 0, w: 14, h: 9 },
    { op: 'room.create', id: 'room_library', type: 'library', name: 'Research Library', x: 62, y: 14, w: 14, h: 9 },
    { op: 'room.create', id: 'room_fin', type: 'finance', name: 'Finance Office', x: 82, y: 0, w: 10, h: 8 },
    { op: 'room.create', id: 'room_eng', type: 'engineering', name: 'Engineering Lab', x: 82, y: 14, w: 12, h: 9 },
    { op: 'room.create', id: 'room_design', type: 'design', name: 'Design Lab', x: 62, y: 29, w: 11, h: 8 },
    { op: 'room.create', id: 'room_studio', type: 'studio', name: 'Creative Studio', x: 79, y: 29, w: 11, h: 8 },
    { op: 'room.create', id: 'room_market', type: 'market', name: 'Market Intelligence', x: 98, y: 0, w: 10, h: 8 },
  ]);
  run([
    { op: 'rooms.connect', id: 'hall_hq', a: 'room_srv', b: 'room_library', width: 3 },
    { op: 'rooms.connect', id: 'hall_exec', a: 'room_library', b: 'room_exec' },
    { op: 'rooms.connect', id: 'hall_eng', a: 'room_library', b: 'room_eng' },
    { op: 'rooms.connect', id: 'hall_fin', a: 'room_exec', b: 'room_fin' },
    { op: 'rooms.connect', id: 'hall_market', a: 'room_fin', b: 'room_market' },
    { op: 'rooms.connect', id: 'hall_design', a: 'room_library', b: 'room_design' },
    { op: 'rooms.connect', id: 'hall_studio', a: 'room_design', b: 'room_studio' },
  ]);
  const hallNames: Record<string, string> = { hall_hq: 'HQ Concourse', hall_exec: 'Executive Hall', hall_eng: 'Engineering Hall', hall_fin: 'Finance Hall', hall_market: 'Market Hall', hall_design: 'Design Hall', hall_studio: 'Studio Hall' };
  run(Object.entries(hallNames).map(([id, name]) => ({ op: 'corridor.update', id, patch: { name } }) as DocOp));

  run([
    { op: 'agent.createFromArchetype', archetype: 'president', name: 'ORION', id: 'agent_orion', roomId: 'room_exec', workstationId: 'ws_orion' },
    { op: 'agent.createFromArchetype', archetype: 'librarian', name: 'CODEX', id: 'agent_codex', roomId: 'room_library', workstationId: 'ws_codex' },
    { op: 'agent.createFromArchetype', archetype: 'coo', name: 'VECTOR', id: 'agent_vector', roomId: 'room_ops', workstationId: 'ws_vector' },
    { op: 'agent.createFromArchetype', archetype: 'cfo', name: 'LEDGER', id: 'agent_ledger', roomId: 'room_fin', workstationId: 'ws_ledger' },
    { op: 'agent.createFromArchetype', archetype: 'market-analyst', name: 'SCOUT', id: 'agent_scout', roomId: 'room_market', workstationId: 'ws_scout' },
    { op: 'agent.createFromArchetype', archetype: 'product-architect', name: 'FORGE', id: 'agent_forge', roomId: 'room_design', workstationId: 'ws_forge' },
    { op: 'agent.createFromArchetype', archetype: 'creative-director', name: 'MUSE', id: 'agent_muse', roomId: 'room_studio', workstationId: 'ws_muse' },
    { op: 'agent.createFromArchetype', archetype: 'chief-engineer', name: 'BOLT', id: 'agent_bolt', roomId: 'room_eng', workstationId: 'ws_bolt' },
  ]);
  for (const id of ['agent_orion', 'agent_codex', 'agent_vector', 'agent_ledger', 'agent_scout', 'agent_forge', 'agent_muse', 'agent_bolt']) {
    run([{ op: 'agent.update', id, patch: { identity: { createdAt: HQ_CREATED }, skills: { supervisorId: id === 'agent_orion' ? null : 'agent_orion' } } }]);
  }

  // tube network: one station per business room plus the original core rooms
  const tubes: [string, string, FurnitureType][] = [
    ['room_exec', 'Executive', 'dispatch-terminal'], ['room_library', 'Library', 'tube-station'], ['room_fin', 'Finance', 'tube-station'],
    ['room_eng', 'Engineering', 'tube-station'], ['room_design', 'Design', 'message-station'], ['room_studio', 'Studio', 'message-station'],
    ['room_market', 'Market', 'tube-station'], ['room_ops', 'Operations', 'routing-hub'], ['room_lab', 'Research', 'tube-station'],
  ];
  for (const [roomId, name, type] of tubes) {
    const room = doc.rooms[roomId];
    const has = room.furnitureIds.some((f) => doc.furniture[f]?.tube);
    if (has) { const f = room.furnitureIds.find((x) => doc.furniture[x]?.tube)!; run([{ op: 'furniture.update', id: f, patch: { tube: { stationName: `${name} Station`, department: name } } }]); continue; }
    const spot = findObjectSpot(doc, room, type, { near: { x: room.w - 1, y: room.h - 1 } });
    if (!spot) continue;
    const id = `tube_${roomId.slice(5)}`;
    run([{ op: 'furniture.add', id, roomId, type, x: spot.x, y: spot.y }, { op: 'furniture.update', id, patch: { tube: { stationName: `${name} Station`, department: name } } }]);
  }
  // an archive terminal and budget dashboard so the library and finance rooms do real work
  const place = (roomId: string, type: FurnitureType, id: string, near?: { x: number; y: number }) => {
    const room = doc.rooms[roomId]; const spot = findObjectSpot(doc, room, type, { near });
    if (spot) run([{ op: 'furniture.add', id, roomId, type, x: spot.x, y: spot.y }]);
  };
  if (!Object.values(doc.furniture).some((f) => f.roomId === 'room_library' && f.type === 'archive-terminal')) place('room_library', 'archive-terminal', 'fur_archive', { x: 1, y: 1 });
  if (!Object.values(doc.furniture).some((f) => f.roomId === 'room_fin' && f.type === 'budget-dashboard')) place('room_fin', 'budget-dashboard', 'fur_budget', { x: 1, y: 6 });
  place('room_exec', 'approval-kiosk', 'fur_approvals', { x: 12, y: 7 });

  const projects: Project[] = [
    { id: 'proj_hq', name: 'HQ Operations', ownerAgentId: 'agent_orion', budget: 600, forecastSpend: 420, status: 'active', description: 'Running the headquarters: coordination, briefings and reviews.' },
    { id: 'proj_catalog', name: 'Knowledge Catalogue', ownerAgentId: 'agent_codex', budget: 200, forecastSpend: 150, status: 'active', description: 'Index, verify and deduplicate everything the agents learn.' },
    { id: 'proj_launch', name: 'Spring Product Launch', ownerAgentId: 'agent_muse', budget: 350, forecastSpend: 380, status: 'active', description: 'Packaging, product photography and launch visuals.' },
    { id: 'proj_platform', name: 'Platform Reliability', ownerAgentId: 'agent_bolt', budget: 250, forecastSpend: 200, status: 'active', description: 'Diagnostics and repairs across the office systems.' },
  ];
  for (const project of projects) run([{ op: 'project.upsert', project }]);

  const lib = (id: string, title: string, topic: string, summary: string, tags: string[], conf: number, extra: Partial<KnowledgeEntry> = {}): KnowledgeEntry => ({
    id, title, topic, summary, tags, sources: [{ title: 'Internal briefing (simulated)', url: '' }], createdAt: HQ_CREATED, authorAgentId: 'agent_codex', projectId: 'proj_catalog',
    confidence: conf, verification: conf > 0.8 ? 'verified' : 'unverified', sensitive: false, allowedAgentIds: [], ...extra,
  });
  for (const entry of [
    lib('kb_bench', 'Routing algorithm benchmarks', 'research', 'A* with a binary heap beats BFS on the office graph above 2,000 cells.', ['benchmark', 'routing', 'papers'], 0.9, { authorAgentId: 'agent_atlas' }),
    lib('kb_market', 'Competitor pricing, Q3', 'market', 'Three competitors cut entry prices by 10–15% this quarter.', ['pricing', 'competitors', 'market'], 0.7, { authorAgentId: 'agent_scout' }),
    lib('kb_packaging', 'Packaging material comparison', 'design', 'Recycled board is 8% cheaper than composite at our volumes.', ['packaging', 'materials', 'supplier'], 0.85, { authorAgentId: 'agent_forge' }),
    lib('kb_payroll', 'Agent compensation ledger', 'finance', 'Monthly allowances and approval limits per agent.', ['budget', 'ledger'], 0.95, { authorAgentId: 'agent_ledger', sensitive: true, allowedAgentIds: ['agent_ledger', 'agent_orion'] }),
  ]) run([{ op: 'library.upsert', entry }]);
  return doc;
}

/**
 * The production wing: a high-capacity operations floor, the game development
 * arcade (Roblox work plus the owner's arcade machines) and the Blender studio.
 */
function addProductionWing(doc0: OfficeDoc): OfficeDoc {
  let doc = doc0;
  const run = (ops: DocOp[]) => { const r = applyOps(doc, ops); if (r.errors.length) throw new Error(`sample wing: ${r.errors.join('; ')}`); doc = r.doc; };
  run([
    { op: 'room.create', id: 'room_floor', type: 'ops-floor', name: 'Operations Floor', x: 0, y: 46, w: 30, h: 17 },
    { op: 'room.create', id: 'room_arcade', type: 'arcade', name: 'Game Dev Arcade', x: 38, y: 46, w: 18, h: 12 },
    { op: 'room.create', id: 'room_blender', type: 'blender-studio', name: 'Blender Design Studio', x: 62, y: 46, w: 16, h: 11 },
    { op: 'room.create', id: 'room_lounge', type: 'royal-lounge', name: "King's Lounge", x: 86, y: 46, w: 16, h: 11 },
  ]);
  run([
    { op: 'rooms.connect', id: 'hall_floor', a: 'room_shop', b: 'room_floor', width: 3 },
    { op: 'rooms.connect', id: 'hall_arcade', a: 'room_shop', b: 'room_arcade' },
    { op: 'rooms.connect', id: 'hall_blender', a: 'room_arcade', b: 'room_blender' },
    { op: 'rooms.connect', id: 'hall_studio3d', a: 'room_design', b: 'room_blender' },
    { op: 'rooms.connect', id: 'hall_lounge', a: 'room_blender', b: 'room_lounge' },
    { op: 'rooms.connect', id: 'hall_court', a: 'room_studio', b: 'room_lounge' },
  ]);
  // keep doorways clear: move any preset object a new door landed on
  for (const i of validate(doc)) if (i.code === 'door-blocked') {
    const f = doc.furniture[i.objectIds[0]]; const room = doc.rooms[f.roomId];
    const spot = findObjectSpot(doc, room, f.type, { near: { x: f.x, y: room.h - 1 }, ignore: new Set([f.id]), rotation: f.rotation });
    if (spot) run([{ op: 'furniture.update', id: f.id, patch: { x: spot.x, y: spot.y } }]);
  }
  run(Object.entries({ hall_floor: 'Floor Concourse', hall_arcade: 'Arcade Hall', hall_blender: 'Studio Walk', hall_studio3d: 'Design Link', hall_lounge: 'Royal Walk', hall_court: 'Court Hall' }).map(([id, name]) => ({ op: 'corridor.update', id, patch: { name } }) as DocOp));

  const place = (roomId: string, type: FurnitureType, id: string, near: { x: number; y: number }, extra: Record<string, unknown> = {}) => {
    const room = doc.rooms[roomId]; const spot = findObjectSpot(doc, room, type, { near });
    if (!spot) throw new Error(`sample wing: no room for ${type} in ${roomId}`);
    run([{ op: 'furniture.add', id, roomId, type, x: spot.x, y: spot.y }]);
    if (Object.keys(extra).length) run([{ op: 'furniture.update', id, patch: extra }]);
  };
  // arcade: development first, the owner's machines in the lounge corner
  run(Object.values(doc.furniture).filter((f) => f.roomId === 'room_arcade' && f.type === 'arcade-cabinet').map((f) => ({ op: 'furniture.delete', id: f.id }) as DocOp));
  const cabinets: [GameId, string][] = [['flappy', 'Sky Hopper'], ['pacman', 'Maze Muncher'], ['pong', 'Classic Pong']];
  cabinets.forEach(([game, label], i) => place('room_arcade', 'arcade-cabinet', `cab_${game}`, { x: 13 + i * 2, y: 1 }, { arcade: { game, theme: 'neon' }, label }));
  place('room_arcade', 'collab-table', 'fur_collab', { x: 6, y: 5 });
  place('room_arcade', 'equipment-shelf', 'fur_eqshelf', { x: 16, y: 10 });
  place('room_arcade', 'sofa', 'fur_arcade_sofa', { x: 13, y: 9 });
  place('room_arcade', 'lounge-seat', 'fur_arcade_seat', { x: 13, y: 6 });
  // studio equipment around the render wall and preview stage
  place('room_blender', 'reference-display', 'fur_refs', { x: 7, y: 0 });
  place('room_blender', 'review-table', 'fur_review', { x: 7, y: 5 });
  place('room_blender', 'material-library', 'fur_materials', { x: 0, y: 10 });
  place('room_blender', 'anim-station', 'fur_anim', { x: 1, y: 6 });
  // floor: supplies and charging along the side wall
  place('room_floor', 'charging-station', 'fur_charge', { x: 29, y: 1 });
  place('room_floor', 'supply-station', 'fur_supply', { x: 29, y: 4 });

  run([
    { op: 'agent.createFromArchetype', archetype: 'roblox-dev', name: 'LUAU', id: 'agent_luau', roomId: 'room_arcade', workstationId: 'ws_luau' },
    { op: 'agent.createFromArchetype', archetype: 'roblox-dev', name: 'QUEST', id: 'agent_quest', roomId: 'room_arcade', workstationId: 'ws_quest' },
    { op: 'agent.createFromArchetype', archetype: 'qa-integrator', name: 'PROBE', id: 'agent_probe', roomId: 'room_arcade', workstationId: 'ws_probe' },
    { op: 'agent.createFromArchetype', archetype: 'blender-artist', name: 'MESH', id: 'agent_mesh', roomId: 'room_blender', workstationId: 'ws_mesh' },
    { op: 'agent.createFromArchetype', archetype: 'blender-artist', name: 'RIG', id: 'agent_rig', roomId: 'room_blender', workstationId: 'ws_rig' },
    { op: 'agent.createFromArchetype', archetype: 'ecommerce', name: 'MERCH', id: 'agent_merch', roomId: 'room_market', workstationId: 'ws_merch' },
    { op: 'agent.createFromArchetype', archetype: 'ecommerce', name: 'CART', id: 'agent_cart', roomId: 'room_market', workstationId: 'ws_cart' },
  ]);
  run([{ op: 'agent.update', id: 'agent_rig', patch: { appearance: { hairStyle: 'short', hairColor: '#c0c0c0' } } },
    { op: 'agent.update', id: 'agent_quest', patch: { appearance: { hairStyle: 'ponytail', hairColor: '#ffd166' } } },
    { op: 'agent.update', id: 'agent_cart', patch: { appearance: { hairStyle: 'buzz', hairColor: '#1a1410', skinTone: '#7a4a2a' } } }]);
  const floor: DocOp[] = [];
  for (let i = 1; i <= 24; i++) floor.push({ op: 'agent.createFromArchetype', archetype: 'ops-worker', name: `OPS-${String(i).padStart(2, '0')}`, id: `agent_ops${i}`, roomId: 'room_floor' });
  run(floor);
  const tones = ['#f6d7c3', '#c68a64', '#a0663f', '#7a4a2a', '#e8b897'], hair = ['#1a1410', '#5a3a1a', '#d4b483', '#2a1d14', '#8a8a8a'];
  run(Array.from({ length: 24 }, (_, k) => ({ op: 'agent.update', id: `agent_ops${k + 1}`, patch: { identity: { createdAt: HQ_CREATED }, appearance: { skinTone: tones[k % 5], hairColor: hair[(k * 3) % 5], hairStyle: (['buzz', 'short', 'bun', 'ponytail', 'curly'] as const)[k % 5] } } }) as DocOp));
  for (const id of ['agent_luau', 'agent_quest', 'agent_probe', 'agent_mesh', 'agent_rig', 'agent_merch', 'agent_cart']) run([{ op: 'agent.update', id, patch: { identity: { createdAt: HQ_CREATED } } }]);

  for (const project of [
    { id: 'proj_roblox', name: 'Neon Runner (Roblox)', ownerAgentId: 'agent_luau', budget: 300, forecastSpend: 240, status: 'active', description: 'A Roblox rooftop runner: Luau gameplay, levels and Blender-made characters and props.' },
    { id: 'proj_store', name: 'Online Store', ownerAgentId: 'agent_merch', budget: 150, forecastSpend: 110, status: 'active', description: 'Listings, inventory and promotions for the store.' },
  ] as Project[]) run([{ op: 'project.upsert', project }]);
  // ensure every department has an explicit row, with production departments marked non-essential
  for (const name of ['Game Development', '3D Design', 'E-commerce', 'Operations Floor']) run([{ op: 'department.update', name, patch: { ...makeDepartment(name), maxConcurrent: name === 'Operations Floor' ? 20 : null } }]);
  return doc;
}

/** Starting production items for the sample office's game project. */
export function seedSampleRuntime(doc: OfficeDoc, rt: RuntimeState) {
  if (!doc.agents.agent_mesh || Object.keys(rt.assets).length) return;
  const items: [string, Parameters<typeof createAsset>[1]['kind'], string][] = [
    ['Runner character', 'character', 'agent_mesh'], ['Neon jacket cosmetic', 'cosmetic', 'agent_mesh'], ['Hoverboard prop', 'prop', 'agent_rig'],
    ['Run cycle animation', 'animation', 'agent_rig'], ['Checkpoint system', 'luau-script', 'agent_luau'], ['Rooftop level', 'level', 'agent_quest'], ['Shop UI', 'ui', 'agent_quest'],
  ];
  for (const [name, kind, owner] of items) createAsset(rt, { name, kind, ownerAgentId: owner, projectId: 'proj_roblox' }, new Date(HQ_CREATED));
}
