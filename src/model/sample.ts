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
  if (doc.id === ROBLOX_HQ_ID) { seedRobloxRuntime(doc, rt); return; }
  if (!doc.agents.agent_mesh || Object.keys(rt.assets).length) return;
  const items: [string, Parameters<typeof createAsset>[1]['kind'], string][] = [
    ['Runner character', 'character', 'agent_mesh'], ['Neon jacket cosmetic', 'cosmetic', 'agent_mesh'], ['Hoverboard prop', 'prop', 'agent_rig'],
    ['Run cycle animation', 'animation', 'agent_rig'], ['Checkpoint system', 'luau-script', 'agent_luau'], ['Rooftop level', 'level', 'agent_quest'], ['Shop UI', 'ui', 'agent_quest'],
  ];
  for (const [name, kind, owner] of items) createAsset(rt, { name, kind, ownerAgentId: owner, projectId: 'proj_roblox' }, new Date(HQ_CREATED));
}

// ---------------------------------------------------------------------------
// Roblox development headquarters
// ---------------------------------------------------------------------------

export const ROBLOX_HQ_ID = 'office_roblox_hq';

/** Room ids of the Roblox headquarters, throne room first. */
export const ROBLOX_HQ_ROOMS = {
  throne: 'room_throne', dev: 'room_dev', research: 'room_research', design: 'room_gamedesign',
  modeling: 'room_3d', type: 'room_type', build: 'room_build', ads: 'room_ads',
} as const;

/**
 * The Roblox development headquarters: the throne room (the owner's command
 * centre) in the middle, seven team rooms around it. Wide tubes run straight
 * from the throne room's sides to the nearest rooms, and an outer ring links
 * neighbours, so every room is reachable two ways. Built through DocOps like the classic sample.
 */
export function robloxHQ(): OfficeDoc {
  let doc = emptyOffice('Roblox Development HQ');
  doc.id = ROBLOX_HQ_ID;
  doc.settings.layoutPreset = 'bubble';
  const run = (ops: DocOp[]) => { const r = applyOps(doc, ops); if (r.errors.length) throw new Error(`roblox HQ: ${r.errors.join('; ')}`); doc = r.doc; };
  const R = ROBLOX_HQ_ROOMS;
  run([
    { op: 'room.create', id: R.throne, type: 'throne-room', name: 'Throne Room', x: 32, y: 24, w: 20, h: 14 },
    { op: 'room.create', id: R.research, type: 'research', name: 'Research', x: 6, y: 4, w: 16, h: 11, preset: false },
    { op: 'room.create', id: R.dev, type: 'roblox-dev', name: 'Roblox Development', x: 34, y: 4, w: 16, h: 11 },
    { op: 'room.create', id: R.design, type: 'game-design', name: 'Game Design', x: 62, y: 4, w: 16, h: 11 },
    { op: 'room.create', id: R.modeling, type: '3d-design', name: '3D Design', x: 6, y: 25, w: 16, h: 12 },
    { op: 'room.create', id: R.build, type: 'roblox-build', name: 'Roblox Building', x: 62, y: 25, w: 16, h: 12 },
    { op: 'room.create', id: R.type, type: 'typography', name: 'Typography & Fonts', x: 20, y: 47, w: 16, h: 11 },
    { op: 'room.create', id: R.ads, type: 'ad-studio', name: 'Advertising & Creative', x: 48, y: 47, w: 16, h: 11 },
  ]);
  // research: organised boards, searchable references, notes and the connections between findings
  run([{ op: 'room.update', id: R.research, patch: { appearance: { floorColor: '#120c22', wallColor: '#3a2a5e', lightTemp: 5200, lighting: 0.6, displayColor: '#b57bff', doorColor: '#b57bff' }, purpose: 'Player research, references and findings, connected on the boards.' } }]);
  const add = (roomId: string, type: FurnitureType, x: number, y: number, extra: Partial<Extract<DocOp, { op: 'furniture.add' }>> = {}): DocOp => ({ op: 'furniture.add', roomId, type, x, y, ...extra });
  run([
    add(R.research, 'evidence-board', 3, 1), add(R.research, 'note-wall', 8, 1), add(R.research, 'digital-shelf', 12, 1),
    add(R.research, 'archive-terminal', 2, 4, { workstationName: 'Findings Terminal' }),
    add(R.research, 'multi-monitor', 6, 4, { workstationName: 'Player Data Station' }),
    add(R.research, 'reference-stack', 11, 4), add(R.research, 'reference-stack', 11, 6),
    add(R.research, 'research-kiosk', 2, 7), add(R.research, 'collab-table', 6, 7),
    add(R.research, 'team-sign', 5, 10, { label: 'FIND · CONNECT · BRIEF', w: 6 }),
  ]);

  const tube = (a: string, b: string, id: string, width = 3): DocOp => ({ op: 'rooms.connect', id, a, b, width });
  run([
    // straight spokes from the throne room's four sides (the south door serves both southern rooms)
    tube(R.throne, R.dev, 'tube_dev'), tube(R.throne, R.modeling, 'tube_3d'), tube(R.throne, R.build, 'tube_build'),
    tube(R.throne, R.type, 'tube_type'), tube(R.throne, R.ads, 'tube_ads'),
    // the outer ring: neighbours link directly, so every room has two ways in
    tube(R.research, R.dev, 'ring_research_dev', 2), tube(R.dev, R.design, 'ring_dev_design', 2),
    tube(R.research, R.modeling, 'ring_research_3d', 2), tube(R.design, R.build, 'ring_design_build', 2), tube(R.type, R.ads, 'ring_type_ads', 2),
  ]);
  // the southern rooms also reach the side rooms through their outer walls, on doors of their own,
  // so the shared south door of the throne room is never the only way in
  const door = (roomId: string, doorId: string) => ({ kind: 'door' as const, roomId, doorId });
  run([
    { op: 'door.add', roomId: R.modeling, id: 'door_3d_s', side: 's', offset: 7, width: 2 }, { op: 'door.add', roomId: R.type, id: 'door_type_w', side: 'w', offset: 4, width: 2 },
    { op: 'door.add', roomId: R.build, id: 'door_build_s', side: 's', offset: 7, width: 2 }, { op: 'door.add', roomId: R.ads, id: 'door_ads_e', side: 'e', offset: 4, width: 2 },
    { op: 'corridor.create', id: 'ring_3d_type', width: 2, start: door(R.modeling, 'door_3d_s'), end: door(R.type, 'door_type_w') },
    { op: 'corridor.create', id: 'ring_build_ads', width: 2, start: door(R.build, 'door_build_s'), end: door(R.ads, 'door_ads_e') },
  ]);
  const names: Record<string, string> = {
    tube_dev: 'Dev Tube', tube_3d: '3D Tube', tube_build: 'Build Tube', tube_type: 'Type Tube', tube_ads: 'Campaign Tube',
    ring_research_dev: 'North Ring West', ring_dev_design: 'North Ring East', ring_research_3d: 'West Ring', ring_design_build: 'East Ring', ring_type_ads: 'South Ring', ring_3d_type: 'South-West Ring', ring_build_ads: 'South-East Ring',
  };
  run(Object.entries(names).map(([id, name]) => ({ op: 'corridor.update', id, patch: { name, isMain: id.startsWith('tube_') } }) as DocOp));
  // keep doorways clear: move any object a new door landed on
  for (const i of validate(doc)) if (i.code === 'door-blocked') {
    const f = doc.furniture[i.objectIds[0]]; const room = doc.rooms[f.roomId];
    const spot = findObjectSpot(doc, room, f.type, { near: { x: f.x, y: f.y }, ignore: new Set([f.id]), rotation: f.rotation });
    if (spot) run([{ op: 'furniture.update', id: f.id, patch: { x: spot.x, y: spot.y } }]);
  }

  // one capsule station per team so work can be handed between rooms
  const stations: [string, string, FurnitureType][] = [
    [R.throne, 'Command', 'dispatch-terminal'], [R.dev, 'Development', 'tube-station'], [R.research, 'Research', 'tube-station'], [R.design, 'Game Design', 'tube-station'],
    [R.modeling, '3D Design', 'tube-station'], [R.type, 'Typography', 'tube-station'], [R.build, 'Building', 'tube-station'], [R.ads, 'Advertising', 'tube-station'],
  ];
  for (const [roomId, dept, type] of stations) {
    const room = doc.rooms[roomId];
    const spot = findObjectSpot(doc, room, type, { near: { x: room.w - 4, y: room.h - 2 } });
    if (!spot) continue;
    const id = `tube_${roomId.slice(5)}_station`;
    run([{ op: 'furniture.add', id, roomId, type, x: spot.x, y: spot.y }, { op: 'furniture.update', id, patch: { tube: { stationName: `${dept} Station`, department: dept } } }]);
  }

  // the teams
  const hire: [string, string, string, string | null][] = [
    ['coo', 'REGENT', 'agent_regent', R.throne],
    ['roblox-dev', 'LUAU', 'agent_luau', null], ['roblox-dev', 'BYTE', 'agent_byte', null], ['qa-integrator', 'PROBE', 'agent_probe', R.dev],
    ['librarian', 'CODEX', 'agent_codex', R.research], ['market-analyst', 'SCOUT', 'agent_scout', R.research],
    ['game-designer', 'QUEST', 'agent_quest', R.design], ['game-designer', 'LOOP', 'agent_loop', R.design],
    ['blender-artist', 'MESH', 'agent_mesh', R.modeling], ['blender-artist', 'RIG', 'agent_rig', R.modeling],
    ['type-designer', 'SERIF', 'agent_serif', R.type], ['type-designer', 'KERN', 'agent_kern', R.type],
    ['roblox-builder', 'BRICK', 'agent_brick', R.build], ['roblox-builder', 'TERRA', 'agent_terra', R.build],
    ['ad-creative', 'PROMO', 'agent_promo', R.ads], ['ad-creative', 'FLASH', 'agent_flash', R.ads],
  ];
  run(hire.map(([archetype, name, id, roomId]) => ({ op: 'agent.createFromArchetype', archetype, name, id, roomId }) as DocOp));
  // developers sit at the studio workstations (their archetype's own desk isn't in this room)
  const studio = Object.values(doc.furniture).filter((f) => f.roomId === R.dev && f.type === 'studio-workstation' && !f.workstation?.assignedAgentId).sort((a, b) => a.y - b.y || a.x - b.x);
  run([{ op: 'workstation.assign', furnitureId: studio[0].id, agentId: 'agent_luau' }, { op: 'workstation.assign', furnitureId: studio[1].id, agentId: 'agent_byte' }]);
  // the chief of staff and the developers wear their own looks rather than the role uniform
  run(['agent_regent', 'agent_luau', 'agent_byte'].map((id) => ({ op: 'agent.removeUniform', id }) as DocOp));
  run([
    { op: 'agent.update', id: 'agent_regent', patch: { identity: { title: 'Chief of Staff', department: 'Command', roleDescription: 'Runs the command centre for the ruler: routes work between teams and keeps the war table current.' }, appearance: { top: 'robe', topColor: '#2a0a18', trimColor: '#ff3b5c', accent: '#ff3b5c', hairStyle: 'swept', hairColor: '#e8e2d0', expression: 'determined', bodyStyle: 'heroic' } } },
    { op: 'agent.update', id: 'agent_luau', patch: { appearance: { hairStyle: 'spiky', hairColor: '#4cc9ff', expression: 'focused', bodyStyle: 'blocky', topColor: '#14284a', trimColor: '#4cc9ff', accent: '#4cc9ff' } } },
    { op: 'agent.update', id: 'agent_byte', patch: { appearance: { hairStyle: 'afro', hairColor: '#1a1410', skinTone: '#7a4a2a', expression: 'smile', bodyStyle: 'heroic', topColor: '#1a2a4a', trimColor: '#4cc9ff', accent: '#4cc9ff' } } },
    { op: 'agent.update', id: 'agent_loop', patch: { appearance: { hairStyle: 'spiky', hairColor: '#39d0c8', skinTone: '#e8b897', expression: 'surprised', bodyStyle: 'chibi', cheeks: 'none' } } },
    { op: 'agent.update', id: 'agent_rig', patch: { appearance: { hairStyle: 'undercut', hairColor: '#c0c0c0', expression: 'smirk' } } },
    { op: 'agent.update', id: 'agent_kern', patch: { appearance: { hairStyle: 'twin-buns', hairColor: '#8a3b1e', skinTone: '#a0663f', expression: 'smile' } } },
    { op: 'agent.update', id: 'agent_terra', patch: { appearance: { hairStyle: 'afro', hairColor: '#5a3a1a', skinTone: '#4f3020', expression: 'grin' } } },
    { op: 'agent.update', id: 'agent_flash', patch: { appearance: { hairStyle: 'braids', hairColor: '#b57bff', skinTone: '#f6d7c3', expression: 'grin', bodyStyle: 'sleek' } } },
  ]);
  for (const [, , id] of hire) run([{ op: 'agent.update', id, patch: { identity: { createdAt: HQ_CREATED }, skills: { supervisorId: id === 'agent_regent' ? null : 'agent_regent' } } }]);
  for (const name of ['Command', 'Game Development', 'Research', 'Game Design', '3D Design', 'Typography', 'Roblox Building', 'Advertising']) run([{ op: 'department.update', name, patch: makeDepartment(name) }]);

  for (const project of [
    { id: 'proj_obby', name: 'Sky Islands Obby', ownerAgentId: 'agent_luau', budget: 400, forecastSpend: 300, status: 'active', description: 'A floating-island obstacle course: scripts, levels, models, builds and UI type.' },
    { id: 'proj_campaign', name: 'Launch Campaign', ownerAgentId: 'agent_promo', budget: 200, forecastSpend: 150, status: 'active', description: 'Thumbnails, icons and ads for the Sky Islands launch.' },
  ] as Project[]) run([{ op: 'project.upsert', project }]);
  run([{ op: 'library.upsert', entry: {
    id: 'kb_players', title: 'What keeps players coming back', topic: 'research', summary: 'Short checkpoints and visible progress raise return visits; long unskippable intros lower them.',
    tags: ['players', 'retention', 'obby'], sources: [{ title: 'Play-test notes (simulated)', url: '' }], createdAt: HQ_CREATED, authorAgentId: 'agent_scout', projectId: 'proj_obby',
    confidence: 0.75, verification: 'unverified', sensitive: false, allowedAgentIds: [],
  } }]);
  run([{ op: 'player.update', patch: { lastRoomId: R.throne } }]);
  return doc;
}

function seedRobloxRuntime(doc: OfficeDoc, rt: RuntimeState) {
  if (Object.keys(rt.assets).length) return;
  const items: [string, Parameters<typeof createAsset>[1]['kind'], string, string][] = [
    ['Checkpoint system', 'luau-script', 'agent_luau', 'proj_obby'], ['Island level 1', 'level', 'agent_quest', 'proj_obby'], ['Floating island kit', 'environment', 'agent_brick', 'proj_obby'],
    ['Explorer avatar', 'character', 'agent_mesh', 'proj_obby'], ['Title and HUD type', 'ui', 'agent_serif', 'proj_obby'], ['Launch thumbnail', 'prop', 'agent_promo', 'proj_campaign'],
  ];
  for (const [name, kind, owner, projectId] of items) if (doc.agents[owner]) createAsset(rt, { name, kind, ownerAgentId: owner, projectId }, new Date(HQ_CREATED));
}
