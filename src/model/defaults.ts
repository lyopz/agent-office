import { nanoid } from 'nanoid';
import type {
  Agent, Appearance, Furniture, FurnitureType, OfficeDoc, OutfitTemplate, Room, RoomAppearance,
  RoomTemplate, RoomType,
} from './types';

export const uid = (prefix: string) => `${prefix}_${nanoid(8)}`;
export const now = () => new Date().toISOString();

export const ROOM_META: Record<RoomType, { label: string; accent: string; floor: RoomAppearance['floor'] }> = {
  operations: { label: 'Main operations', accent: '#39ff88', floor: 'grid' },
  office: { label: 'Agent office', accent: '#4cc9ff', floor: 'carpet' },
  research: { label: 'Research lab', accent: '#b57bff', floor: 'tile' },
  server: { label: 'Server room', accent: '#ff9f43', floor: 'metal' },
  meeting: { label: 'Meeting room', accent: '#4cc9ff', floor: 'wood' },
  workshop: { label: 'Workshop', accent: '#ff9f43', floor: 'metal' },
  storage: { label: 'Storage', accent: '#8a9a8f', floor: 'plain' },
  break: { label: 'Break room', accent: '#ffd166', floor: 'wood' },
  security: { label: 'Security', accent: '#ff5d73', floor: 'metal' },
  reception: { label: 'Reception', accent: '#39ff88', floor: 'tile' },
  custom: { label: 'Custom', accent: '#39ff88', floor: 'plain' },
};

export const FURNITURE_META: Record<FurnitureType, { label: string; w: number; h: number; blocking: boolean; color: string }> = {
  desk: { label: 'Desk', w: 2, h: 1, blocking: true, color: '#1d3b2a' },
  chair: { label: 'Chair', w: 1, h: 1, blocking: false, color: '#28473a' },
  computer: { label: 'Computer', w: 1, h: 1, blocking: true, color: '#16302a' },
  monitors: { label: 'Monitor wall', w: 3, h: 1, blocking: true, color: '#0f2a1f' },
  'server-rack': { label: 'Server rack', w: 1, h: 2, blocking: true, color: '#2a1e10' },
  whiteboard: { label: 'Whiteboard', w: 3, h: 1, blocking: true, color: '#2b3a3a' },
  cabinet: { label: 'Filing cabinet', w: 1, h: 1, blocking: true, color: '#2a2f2c' },
  'conference-table': { label: 'Conference table', w: 4, h: 2, blocking: true, color: '#1f2d3b' },
  shelf: { label: 'Shelf', w: 2, h: 1, blocking: true, color: '#2a2a22' },
  container: { label: 'Storage container', w: 2, h: 2, blocking: true, color: '#33281a' },
  plant: { label: 'Plant', w: 1, h: 1, blocking: true, color: '#1e5a32' },
  lamp: { label: 'Light', w: 1, h: 1, blocking: false, color: '#5a5a20' },
  sofa: { label: 'Sofa', w: 3, h: 1, blocking: true, color: '#2a2440' },
  decor: { label: 'Decor', w: 1, h: 1, blocking: false, color: '#203040' },
  workbench: { label: 'Workbench', w: 3, h: 1, blocking: true, color: '#3a2a14' },
};

export function makeFurniture(type: FurnitureType, roomId: string, x: number, y: number, extra: Partial<Furniture> = {}): Furniture {
  const m = FURNITURE_META[type];
  return { id: uid('fur'), type, roomId, x, y, w: m.w, h: m.h, rotation: 0, color: m.color, blocking: m.blocking, ...extra };
}

export function workstation(name: string, equipment: string[] = ['terminal'], services: string[] = []) {
  return { name, assignedAgentId: null, equipment, status: 'online' as const, services };
}

/** Furniture preset for a room type, laid out relative to the room size. */
export function furniturePreset(type: RoomType, w: number, h: number): Omit<Furniture, 'id' | 'roomId'>[] {
  const f = (t: FurnitureType, x: number, y: number, extra: Partial<Furniture> = {}) => {
    const { id: _i, roomId: _r, ...rest } = makeFurniture(t, '', x, y, extra);
    return rest;
  };
  const list: Omit<Furniture, 'id' | 'roomId'>[] = [];
  const cols = Math.max(1, Math.floor((w - 2) / 4));
  switch (type) {
    case 'operations':
      list.push(f('monitors', Math.max(1, Math.floor(w / 2) - 1), 1));
      for (let i = 0; i < cols; i++) list.push(f('desk', 1 + i * 4, Math.min(h - 3, 4), { workstation: workstation(`Ops Station ${i + 1}`, ['terminal', 'dual monitors'], ['telemetry']) }));
      list.push(f('plant', w - 2, h - 2));
      break;
    case 'office':
      list.push(f('desk', 1, 1, { workstation: workstation('Private Desk', ['terminal'], ['mail']) }));
      list.push(f('cabinet', w - 2, 1));
      list.push(f('plant', w - 2, h - 2));
      break;
    case 'research':
      list.push(f('desk', 1, 1, { workstation: workstation('Lab Bench A', ['microscope', 'terminal'], ['dataset store']) }));
      if (w >= 7) list.push(f('desk', 4, 1, { workstation: workstation('Lab Bench B', ['terminal'], ['compute']) }));
      list.push(f('whiteboard', 1, h - 2));
      list.push(f('shelf', w - 3, h - 2));
      break;
    case 'server':
      for (let i = 0; i < Math.min(4, w - 2); i += 2) list.push(f('server-rack', 1 + i, 1));
      list.push(f('desk', Math.max(1, w - 3), h - 2, { workstation: workstation('Rack Console', ['terminal'], ['cluster mgmt']) }));
      break;
    case 'meeting':
      list.push(f('conference-table', Math.max(1, Math.floor(w / 2) - 2), Math.max(1, Math.floor(h / 2) - 1)));
      list.push(f('whiteboard', 1, 0 + 1));
      break;
    case 'workshop':
      list.push(f('workbench', 1, 1, { workstation: workstation('Workbench', ['tools', 'soldering'], ['fabrication']) }));
      list.push(f('container', w - 3, h - 3));
      break;
    case 'storage':
      list.push(f('shelf', 1, 1), f('shelf', 1, h - 2), f('container', w - 3, 1));
      break;
    case 'break':
      list.push(f('sofa', 1, h - 2), f('plant', w - 2, 1), f('lamp', 1, 1));
      break;
    case 'security':
      list.push(f('monitors', 1, 1), f('desk', 1, 3, { workstation: workstation('Security Console', ['cameras', 'badge reader'], ['access control']) }));
      break;
    case 'reception':
      list.push(f('desk', Math.floor(w / 2) - 1, 2, { workstation: workstation('Front Desk', ['terminal'], ['visitor log']) }), f('plant', 1, 1));
      break;
    default:
      break;
  }
  // keep presets inside small rooms
  return list.filter((it) => it.x + it.w <= w && it.y + it.h <= h && it.x >= 0 && it.y >= 0);
}

export function roomAppearance(type: RoomType): RoomAppearance {
  const m = ROOM_META[type];
  return { floor: m.floor, wallColor: '#1f6f45', accent: m.accent, lighting: 0.6 };
}

export function makeRoom(type: RoomType, x: number, y: number, w: number, h: number, name?: string): Room {
  return {
    id: uid('room'), name: name ?? ROOM_META[type].label, type, x, y, w, h, rotation: 0,
    walls: { thickness: 2, style: 'solid' }, doors: [], appearance: roomAppearance(type),
    furnitureIds: [], assignedAgentIds: [], purpose: ROOM_META[type].label,
    special: type === 'break' ? 'restores-energy' : undefined,
  };
}

export const DEFAULT_APPEARANCE: Appearance = {
  height: 1, build: 'average', skinTone: '#c68a64', faceShape: 'oval', eyeStyle: 'almond', eyeColor: '#2b1d10',
  brows: 'thin', hairStyle: 'short', hairColor: '#2a1d14', facialHair: 'none', top: 'hoodie', topColor: '#1f3d2e',
  bottom: 'pants', bottomColor: '#1b1f24', shoes: 'sneakers', shoeColor: '#d8dde0', headwear: 'none',
  headwearColor: '#f2c230', glasses: 'none', jewelry: 'none', equipment: 'none', accent: '#39ff88',
  idlePose: 'stand', walkPose: 'normal', workPose: 'typing', facing: 'right', artStyle: 'flat', outline: 1.5,
  shading: 'soft', animationSpeed: 1, preferredView: 'top',
};

export const SKIN_TONES = ['#f6d7c3', '#e8b897', '#c68a64', '#a0663f', '#7a4a2a', '#4f3020', '#9fd8c0', '#b8c4ff'];

export const APPEARANCE_PRESETS: { name: string; patch: Partial<Appearance> }[] = [
  { name: 'Ops operator', patch: { top: 'uniform', topColor: '#13402a', headwear: 'headset', headwearColor: '#39ff88', equipment: 'tablet' } },
  { name: 'Lab researcher', patch: { top: 'labcoat', topColor: '#e8eef0', glasses: 'round', equipment: 'clipboard' } },
  { name: 'Field mechanic', patch: { top: 'coverall', topColor: '#d9772b', headwear: 'hardhat', headwearColor: '#f2c230', shoes: 'boots', shoeColor: '#4a3020', equipment: 'wrench', artStyle: 'realistic', preferredView: 'side' } },
  { name: 'Executive', patch: { top: 'suit', topColor: '#1c2230', bottomColor: '#1c2230', shoes: 'dress', shoeColor: '#111', jewelry: 'badge' } },
  { name: 'Netrunner', patch: { top: 'hoodie', topColor: '#2a1440', glasses: 'visor', accent: '#b57bff', artStyle: 'neon', hairStyle: 'mohawk', hairColor: '#b57bff' } },
  { name: 'Security', patch: { top: 'vest', topColor: '#26313a', headwear: 'helmet', headwearColor: '#26313a', shoes: 'boots', equipment: 'tablet' } },
];

export const DEFAULT_OUTFITS: OutfitTemplate[] = APPEARANCE_PRESETS.map((p, i) => ({ id: `outfit_${i}`, name: p.name, patch: p.patch }));

export function makeAgent(name: string, title: string, department: string, appearance: Partial<Appearance> = {}): Agent {
  return {
    id: uid('agent'),
    enabled: true,
    identity: {
      name, title, department, roleDescription: `${title} in ${department}.`, bio: '', createdAt: now(),
      profileImageAssetId: null, status: 'active',
    },
    personality: {
      traits: ['focused'], communicationStyle: 'concise', formality: 50, humor: 30, creativity: 50, detail: 60,
      riskTolerance: 40, initiative: 55, collaboration: 'team', decisionMaking: 'data-driven',
      workHabits: 'Works in focused blocks and reports progress at milestones.',
      workingHours: { start: '09:00', end: '17:00' }, responseStyle: 'Short status updates with evidence.',
    },
    skills: {
      primaryRole: title, secondaryRoles: [], skills: [], tools: ['terminal'], expertise: [],
      taskPermissions: ['execute-assigned'], workloadLimit: 5, priorityRules: 'Critical first, then FIFO.',
      escalationRules: 'Escalate to supervisor after 2 failed attempts.', teams: [department], supervisorId: null,
    },
    ai: {
      provider: 'simulated', model: 'simulated-local', systemInstructions: 'You are an agent working inside Agent Office.',
      agentInstructions: '', toolPermissions: ['terminal'], contextLimit: 32000, responseConstraints: 'Plain text, under 200 words.',
      executionMode: 'manual-approval', errorHandling: 'retry', maxRetries: 2,
    },
    memory: [],
    schedule: { assignedRoomId: null, preferredWorkstationId: null, workStart: '09:00', workEnd: '17:00', breakEveryMin: 120, breakLengthMin: 15 },
    permissions: { allowedTools: ['terminal'], contactableAgentIds: 'all', requireApprovalFor: ['delete', 'external-message'], canMoveRooms: false, canEditOthers: false },
    appearance: { ...DEFAULT_APPEARANCE, ...appearance },
    assets: {},
  };
}

export function builtinRoomTemplates(): RoomTemplate[] {
  const types: [RoomType, number, number][] = [
    ['office', 7, 6], ['research', 10, 7], ['server', 8, 6], ['meeting', 9, 7], ['workshop', 9, 7],
    ['storage', 6, 5], ['break', 8, 6], ['security', 7, 6], ['reception', 9, 6], ['operations', 16, 10],
  ];
  return types.map(([t, w, h]) => ({
    id: `tpl_${t}`, name: ROOM_META[t].label, type: t, w, h, appearance: roomAppearance(t), furniture: furniturePreset(t, w, h),
  }));
}

export function emptyOffice(name = 'New Office'): OfficeDoc {
  return {
    schemaVersion: 2, id: uid('office'), name,
    settings: { gridSize: 24, bounds: null, hallwayMode: 'hybrid', minCorridorWidth: 1, defaultCorridorWidth: 2 },
    rooms: {}, corridors: {}, furniture: {}, agents: {}, outfitTemplates: DEFAULT_OUTFITS, roomTemplates: builtinRoomTemplates(),
  };
}
