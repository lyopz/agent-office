import { nanoid } from 'nanoid';
import type { PlayerProfile,
  Agent, Appearance, Furniture, FurnitureType, OfficeDoc, OutfitTemplate, Room, RoomAppearance,
  RoomTemplate, RoomType,
} from './types';
import { FURNITURE_META, ROOM_META } from './catalog';
import { ARCHETYPE, ARCHETYPES, BUILTIN_COSMETICS, OUTFIT_FIELDS } from './cosmetics';
import { defaultAppearanceSettings } from './themes';
import { defaultAlertSettings } from './alertDefaults';
import { defaultArcade, defaultControl } from './control';

export const uid = (prefix: string) => `${prefix}_${nanoid(8)}`;
export const now = () => new Date().toISOString();

export { FURNITURE_META, ROOM_META } from './catalog';
export function makeFurniture(type: FurnitureType, roomId: string, x: number, y: number, extra: Partial<Furniture> = {}): Furniture {
  const m = FURNITURE_META[type];
  const f: Furniture = { id: uid('fur'), type, roomId, x, y, w: m.w, h: m.h, rotation: 0, color: m.color, blocking: m.blocking, ...extra };
  if (m.fn === 'tube' && !f.tube) f.tube = { stationName: m.label, department: '' };
  if (m.fn === 'arcade' && !f.arcade) f.arcade = { game: 'pong', theme: 'neon' };
  return f;
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
    case 'executive':
      list.push(f('exec-desk', Math.max(1, Math.floor(w / 2) - 2), 2, { workstation: workstation('Command Desk', ['holographic dashboard', 'approval console'], ['portfolio']) }));
      list.push(f('analytics-wall', 1, 0), f('strategy-table', 1, h - 3), f('approval-kiosk', w - 2, h - 2), f('plant', w - 2, 1));
      break;
    case 'library':
      list.push(f('archive-terminal', 1, 2, { workstation: workstation('Archive Terminal', ['knowledge wall', 'catalogue'], ['library']) }));
      list.push(f('digital-shelf', 1, 0), f('digital-shelf', 4, 0), f('evidence-station', w - 3, h - 2), f('research-kiosk', w - 2, 2));
      break;
    case 'finance':
      list.push(f('finance-terminal', 1, 2, { workstation: workstation('Financial Control', ['ledger', 'cost dashboard'], ['ledger']) }));
      list.push(f('budget-dashboard', 1, 0), f('approval-kiosk', w - 2, h - 2));
      break;
    case 'engineering':
      list.push(f('workbench', 1, 2, { workstation: workstation('Engineering Bench', ['diagnostics', 'soldering'], ['integrations']) }));
      list.push(f('diagnostic-panel', 1, 0), f('server-rack', w - 2, 1), f('charging-station', w - 2, h - 2));
      break;
    case 'design':
      list.push(f('holo-table', 1, 2, { workstation: workstation('Design Table', ['cad', '3d projector'], ['prototyping']) }));
      list.push(f('prototype-printer', w - 3, h - 3), f('material-station', 1, h - 2));
      break;
    case 'studio':
      list.push(f('curved-monitor', 1, 2, { workstation: workstation('Creative Workstation', ['colour-calibrated display'], ['imagery']) }));
      list.push(f('photo-station', w - 3, h - 3), f('mockup-display', 1, h - 2));
      break;
    case 'market':
      list.push(f('multi-monitor', 1, 2, { workstation: workstation('Market Analysis Station', ['six-screen rig'], ['market data']) }));
      list.push(f('market-display', 1, 0), f('comparison-wall', 4, 0));
      break;
    case 'ops-floor':
      for (let y = 2; y + 1 < h - 1; y += 3) for (let x = 1; x < w - 1; x += 2) {
        if (x === Math.floor(w / 2) || x === Math.floor(w / 2) - 1) continue; // central walkway
        list.push(f('compact-desk', x, y, { workstation: workstation(`Floor Desk ${list.length + 1}`, ['terminal'], ['task queue']) }));
      }
      list.push(f('task-board', 1, 0));
      break;
    case 'arcade':
      list.push(f('dev-desk', 1, 2, { workstation: workstation('Dev Desk', ['dual monitors', 'Roblox Studio'], ['scripting']) }));
      list.push(f('arcade-cabinet', w - 2, 1, { arcade: { game: 'pong', theme: 'classic' } }), f('project-display', 1, 0));
      break;
    case 'blender-studio':
      list.push(f('workstation-3d', 1, 2, { workstation: workstation('3D Workstation', ['three monitors', 'pen display'], ['modelling']) }));
      list.push(f('render-wall', 1, 0), f('preview-stage', w - 3, h - 3));
      break;
    case 'royal-lounge': {
      // briefing board centred on the north wall, throne facing it, sofas either side
      const mid = Math.floor(w / 2);
      list.push(f('briefing-board', Math.max(1, mid - 2), 0));
      list.push(f('crown-chandelier', mid - 1, Math.max(2, Math.floor(h / 2) - 2)));
      list.push(f('throne', mid - 1, Math.min(h - 3, Math.floor(h / 2) + 1)));
      list.push(f('lounge-sofa', 1, 2), f('lounge-sofa', w - 4, 2));
      list.push(f('holo-fountain', 1, h - 3), f('plant', w - 2, h - 2));
      break;
    }
    default:
      break;
  }
  // keep presets inside small rooms
  return list.filter((it) => it.x + it.w <= w && it.y + it.h <= h && it.x >= 0 && it.y >= 0);
}

export function roomAppearance(type: RoomType): RoomAppearance {
  const m = ROOM_META[type];
  return { floor: m.floor, wallColor: '', accent: m.accent, lighting: 0.6, lightTemp: 4500 };
}

export function makeRoom(type: RoomType, x: number, y: number, w: number, h: number, name?: string): Room {
  return {
    id: uid('room'), name: name ?? ROOM_META[type].label, type, x, y, w, h, rotation: 0,
    walls: { thickness: 2, style: 'solid' }, doors: [], appearance: roomAppearance(type),
    furnitureIds: [], assignedAgentIds: [], purpose: ROOM_META[type].purpose || ROOM_META[type].label,
    special: type === 'break' || type === 'royal-lounge' ? 'restores-energy' : undefined,
  };
}

export const DEFAULT_APPEARANCE: Appearance = {
  height: 1, build: 'average', skinTone: '#c68a64', faceShape: 'oval', eyeStyle: 'almond', eyeColor: '#2b1d10',
  brows: 'thin', hairStyle: 'short', hairColor: '#2a1d14', facialHair: 'none', top: 'hoodie', topColor: '#1f3d2e',
  bottom: 'pants', bottomColor: '#1b1f24', shoes: 'sneakers', shoeColor: '#d8dde0', headwear: 'none',
  headwearColor: '#f2c230', glasses: 'none', jewelry: 'none', equipment: 'none', accent: '#39ff88',
  idlePose: 'stand', walkPose: 'normal', workPose: 'typing', facing: 'right', artStyle: 'flat', outline: 1.5,
  shading: 'soft', animationSpeed: 1, preferredView: 'top',
  trimColor: '#39ff88', faceMarkings: 'none', robotic: 'none', shoulders: 'none', gloves: 'none', gloveColor: '#2a2f33', belt: 'none',
  accessories: [],
  effects: { aura: false, holoOutline: false, eyeGlow: false, particles: false, energyAccents: false, robotics: false, intensity: 0.35 },
};

/** The owner's avatar for the 3D headquarters: an original explorer look. */
export function defaultPlayer(): PlayerProfile {
  return {
    name: 'You', camera: 'third', lastRoomId: null,
    appearance: withAppearance(DEFAULT_APPEARANCE, {
      hairStyle: 'swept', hairColor: '#3b2416', top: 'jacket', topColor: '#2b3a8c', trimColor: '#ffd166', accent: '#7cf7ff',
      bottom: 'pants', bottomColor: '#20232b', shoes: 'boots', shoeColor: '#1a1a1f', expression: 'smile', bodyStyle: 'heroic', mouth: 'wide', nose: 'button', cheeks: 'none',
    }),
  };
}

/** Appearance merge that keeps nested effects and copies arrays. */
export function withAppearance(base: Appearance, patch: Partial<Appearance> = {}): Appearance {
  const out: Appearance = { ...base, ...patch, effects: { ...base.effects, ...(patch.effects ?? {}) }, accessories: [...(patch.accessories ?? base.accessories)] };
  return out;
}

export const SKIN_TONES = ['#f6d7c3', '#e8b897', '#c68a64', '#a0663f', '#7a4a2a', '#4f3020', '#9fd8c0', '#b8c4ff'];

export const APPEARANCE_PRESETS: { name: string; patch: Partial<Appearance> }[] = [
  { name: 'Deck officer', patch: { top: 'uniform', topColor: '#1a2a3a', trimColor: '#4cc9ff', headwear: 'headset', headwearColor: '#1a1a1a', shoes: 'boots', equipment: 'tablet', accent: '#4cc9ff' } },
  { name: 'Netrunner', patch: { top: 'jacket', topColor: '#2a1440', trimColor: '#b57bff', glasses: 'visor', gloves: 'tech', accent: '#b57bff' } },
  { name: 'Void engineer', patch: { top: 'armor', topColor: '#3a3f46', trimColor: '#ff9f43', shoulders: 'armored', belt: 'utility', shoes: 'boots', shoeColor: '#111316', accent: '#ff9f43' } },
  { name: 'Archive scholar', patch: { top: 'longcoat', topColor: '#2a1f4a', trimColor: '#c9d6e8', glasses: 'ar-glasses', equipment: 'holo-catalog', accent: '#5ad1ff' } },
];

/** Locked role uniforms: one per role. Cosmetics can't be added to or removed from them piece by piece. */
export const roleUniformId = (archetypeId: string) => `uniform_${archetypeId}`;
export const ROLE_UNIFORMS: OutfitTemplate[] = ARCHETYPES.filter((t) => t.id !== 'custom').map((t) => {
  const full = withAppearance(DEFAULT_APPEARANCE, t.appearance);
  const patch: Partial<Appearance> = {};
  for (const k of OUTFIT_FIELDS) (patch as Record<string, unknown>)[k] = JSON.parse(JSON.stringify(full[k]));
  return { id: roleUniformId(t.id), name: `${t.title} uniform`, patch, kind: 'uniform', department: t.department, approved: true, locked: true };
});

export const DEFAULT_OUTFITS: OutfitTemplate[] = [
  ...APPEARANCE_PRESETS.map((p, i) => ({ id: `outfit_${i}`, name: p.name, patch: p.patch })),
  ...ROLE_UNIFORMS,
];

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
    appearance: withAppearance(DEFAULT_APPEARANCE, appearance),
    defaultAppearance: withAppearance(DEFAULT_APPEARANCE, appearance),
    budget: { monthlyCredits: 150, approvalAbove: 25 },
    assets: {},
  };
}

/** A fully configured agent from a starter archetype. The owner can change every field afterwards. */
export function agentFromArchetype(archetypeId: string, name: string): Agent {
  const t = ARCHETYPE[archetypeId] ?? ARCHETYPE.custom;
  const a = makeAgent(name, t.title, t.department, t.appearance);
  a.archetype = t.id;
  if (t.id !== 'custom') a.uniformId = roleUniformId(t.id);
  a.identity.roleDescription = t.roleDescription;
  a.identity.bio = t.responsibilities.length ? `Responsibilities: ${t.responsibilities.join('; ')}.` : '';
  a.personality.traits = [...t.traits]; a.personality.communicationStyle = t.communicationStyle;
  a.skills.skills = [...t.skills]; a.skills.tools = [...t.tools]; a.skills.primaryRole = t.title; a.skills.expertise = [...t.responsibilities];
  a.ai.toolPermissions = [...t.tools];
  a.permissions.allowedTools = [...t.tools]; a.permissions.requireApprovalFor = [...t.requireApprovalFor];
  a.budget = { monthlyCredits: t.monthlyCredits, approvalAbove: t.approvalAbove };
  return a;
}

export function builtinRoomTemplates(): RoomTemplate[] {
  const types: [RoomType, number, number][] = [
    ['office', 7, 6], ['research', 10, 7], ['server', 8, 6], ['meeting', 9, 7], ['workshop', 9, 7],
    ['storage', 6, 5], ['break', 8, 6], ['security', 7, 6], ['reception', 9, 6], ['operations', 16, 10],
    ['executive', 12, 8], ['library', 12, 8], ['finance', 9, 6], ['engineering', 11, 7], ['design', 11, 7], ['studio', 10, 7], ['market', 10, 6],
    ['ops-floor', 24, 16], ['arcade', 16, 10], ['blender-studio', 14, 9], ['royal-lounge', 14, 10],
  ];
  return types.map(([t, w, h]) => ({
    id: `tpl_${t}`, name: ROOM_META[t].label, type: t, w, h, appearance: roomAppearance(t), furniture: furniturePreset(t, w, h),
  }));
}

export function emptyOffice(name = 'New Office'): OfficeDoc {
  return {
    schemaVersion: 7, id: uid('office'), name,
    settings: { gridSize: 24, bounds: null, hallwayMode: 'hybrid', minCorridorWidth: 1, defaultCorridorWidth: 2, collisionRule: 'warn', animationIntensity: 'subtle', idleWandering: false, layoutPreset: 'grid' },
    rooms: {}, corridors: {}, furniture: {}, agents: {}, outfitTemplates: JSON.parse(JSON.stringify(DEFAULT_OUTFITS)), roomTemplates: builtinRoomTemplates(),
    cosmetics: BUILTIN_COSMETICS.map((c) => ({ ...c })), appearance: defaultAppearanceSettings(), alertSettings: defaultAlertSettings(),
    projects: {}, library: {}, departments: {}, control: defaultControl(), arcade: defaultArcade(), player: defaultPlayer(),
  };
}
