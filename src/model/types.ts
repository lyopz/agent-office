// Core data model. Everything persistent lives in `OfficeDoc` (undoable layout +
// profiles) or `RuntimeState` (simulation: tasks, positions, logs). Ephemeral UI
// state (selection, camera, hover) lives in the UI store and is never saved.

export type ID = string;
export interface Point { x: number; y: number }
export interface Rect { x: number; y: number; w: number; h: number }

export type Side = 'n' | 's' | 'e' | 'w';

export const ROOM_TYPES = [
  'operations', 'office', 'research', 'server', 'meeting', 'workshop',
  'storage', 'break', 'security', 'reception', 'custom',
] as const;
export type RoomType = (typeof ROOM_TYPES)[number];

export interface RoomAppearance {
  floor: 'grid' | 'tile' | 'carpet' | 'metal' | 'wood' | 'plain';
  wallColor: string;
  accent: string;
  lighting: number; // 0..1
  theme?: string;
}

export interface Door {
  id: ID;
  side: Side;
  offset: number; // cells from the wall's start (west end for n/s, north end for e/w)
  width: number;  // cells
}

export interface Room extends Rect {
  id: ID;
  name: string;
  type: RoomType;
  rotation: 0;                 // rooms are axis aligned; furniture can rotate
  walls: { thickness: number; style: 'solid' | 'glass' };
  doors: Door[];
  appearance: RoomAppearance;
  furnitureIds: ID[];
  assignedAgentIds: ID[];
  purpose: string;
  special?: string;            // optional special behaviour tag, e.g. 'restores-energy'
}

export type CorridorEndpoint =
  | { kind: 'door'; roomId: ID; doorId: ID }
  | { kind: 'corridor'; corridorId: ID };

export interface Corridor {
  id: ID;
  name: string;
  width: number;            // cells
  points: Point[];          // centerline, cell coordinates, orthogonal polyline
  start: CorridorEndpoint;
  end: CorridorEndpoint;
  routing: 'auto' | 'manual';
  isMain: boolean;          // hybrid mode: main corridors stay manual
  blocked: boolean;         // e.g. maintenance closure; not walkable
  status: 'ok' | 'warning' | 'broken';
  statusMessage?: string;
}

export const FURNITURE_TYPES = [
  'desk', 'chair', 'computer', 'monitors', 'server-rack', 'whiteboard', 'cabinet',
  'conference-table', 'shelf', 'container', 'plant', 'lamp', 'sofa', 'decor', 'workbench',
] as const;
export type FurnitureType = (typeof FURNITURE_TYPES)[number];

export interface Workstation {
  name: string;
  assignedAgentId: ID | null;
  equipment: string[];
  status: 'online' | 'offline' | 'maintenance';
  services: string[];
}

export interface Furniture {
  id: ID;
  type: FurnitureType;
  roomId: ID;
  x: number; y: number;     // room-local cell coordinates
  w: number; h: number;
  rotation: 0 | 90 | 180 | 270;
  color: string;
  blocking: boolean;
  workstation?: Workstation;
}

// ---------- Characters ----------

export type ViewMode = 'top' | 'front' | 'side' | 'three-quarter' | 'portrait';

export interface Appearance {
  height: number;           // 0.85..1.15
  build: 'slim' | 'average' | 'broad';
  skinTone: string;
  faceShape: 'round' | 'oval' | 'square';
  eyeStyle: 'dot' | 'almond' | 'wide' | 'visor';
  eyeColor: string;
  brows: 'none' | 'thin' | 'thick' | 'angled';
  hairStyle: 'bald' | 'buzz' | 'short' | 'long' | 'bun' | 'ponytail' | 'mohawk' | 'curly';
  hairColor: string;
  facialHair: 'none' | 'stubble' | 'beard' | 'mustache';
  top: 'tshirt' | 'hoodie' | 'suit' | 'labcoat' | 'coverall' | 'uniform' | 'vest';
  topColor: string;
  bottom: 'pants' | 'shorts' | 'skirt';
  bottomColor: string;
  shoes: 'sneakers' | 'boots' | 'dress';
  shoeColor: string;
  headwear: 'none' | 'cap' | 'hardhat' | 'helmet' | 'beanie' | 'headset';
  headwearColor: string;
  glasses: 'none' | 'round' | 'square' | 'visor';
  jewelry: 'none' | 'earrings' | 'necklace' | 'badge';
  equipment: 'none' | 'tablet' | 'wrench' | 'clipboard' | 'laptop' | 'toolbelt';
  accent: string;           // glow / palette accent
  idlePose: 'stand' | 'arms-crossed' | 'hands-hips';
  walkPose: 'normal' | 'brisk' | 'casual';
  workPose: 'typing' | 'reading' | 'tinkering';
  facing: 'left' | 'right';
  artStyle: 'flat' | 'neon' | 'realistic' | 'pixel';
  outline: number;          // px at 1x
  shading: 'none' | 'soft' | 'hard';
  animationSpeed: number;   // 0.5..2
  preferredView: ViewMode;  // view used on the floor plan when global view = 'auto'
}

export interface VisualAssets {
  // approved artwork per view, stored in the asset store; procedural fallback otherwise
  [view: string]: { assetId: ID; approvedAt: string } | null | undefined;
}

export interface Personality {
  traits: string[];
  communicationStyle: 'concise' | 'detailed' | 'friendly' | 'formal' | 'technical';
  formality: number; humor: number; creativity: number; detail: number;
  riskTolerance: number; initiative: number;           // 0..100
  collaboration: 'solo' | 'pairs' | 'team';
  decisionMaking: 'data-driven' | 'intuitive' | 'consensus' | 'directive';
  workHabits: string;
  workingHours: { start: string; end: string };
  responseStyle: string;
}

export interface Skills {
  primaryRole: string;
  secondaryRoles: string[];
  skills: string[];
  tools: string[];
  expertise: string[];
  taskPermissions: string[];
  workloadLimit: number;     // max queued tasks
  priorityRules: string;
  escalationRules: string;
  teams: string[];
  supervisorId: ID | null;
}

export interface AIConfig {
  provider: 'simulated' | 'remote-proxy';
  model: string;
  systemInstructions: string;
  agentInstructions: string;
  toolPermissions: string[];
  contextLimit: number;
  responseConstraints: string;
  executionMode: 'manual-approval' | 'auto';
  errorHandling: 'pause' | 'retry' | 'escalate';
  maxRetries: number;
}

export interface MemoryItem {
  id: ID;
  kind: 'note' | 'project' | 'knowledge' | 'preference' | 'conversation';
  persistent: boolean;       // false = temporary conversation context
  title: string;
  content: string;
  createdAt: string;
}

export interface Schedule {
  assignedRoomId: ID | null;
  preferredWorkstationId: ID | null;
  workStart: string; workEnd: string;
  breakEveryMin: number; breakLengthMin: number;
}

export interface Permissions {
  allowedTools: string[];
  contactableAgentIds: ID[] | 'all';
  requireApprovalFor: string[];
  canMoveRooms: boolean;
  canEditOthers: boolean;
}

export interface Agent {
  id: ID;
  enabled: boolean;
  identity: {
    name: string; title: string; department: string;
    roleDescription: string; bio: string; createdAt: string;
    profileImageAssetId: ID | null;
    status: 'active' | 'paused' | 'disabled';
  };
  personality: Personality;
  skills: Skills;
  ai: AIConfig;
  memory: MemoryItem[];
  schedule: Schedule;
  permissions: Permissions;
  appearance: Appearance;
  assets: VisualAssets;
}

export interface OutfitTemplate { id: ID; name: string; patch: Partial<Appearance> }
export interface RoomTemplate {
  id: ID; name: string; type: RoomType; w: number; h: number;
  appearance: RoomAppearance; furniture: Omit<Furniture, 'id' | 'roomId'>[];
}

export interface OfficeSettings {
  gridSize: number;            // px per cell at zoom 1
  bounds: Rect | null;         // permitted layout area, null = unbounded
  hallwayMode: 'automatic' | 'manual' | 'hybrid';
  minCorridorWidth: number;
  defaultCorridorWidth: number;
}

export interface OfficeDoc {
  schemaVersion: number;
  id: ID;
  name: string;
  settings: OfficeSettings;
  rooms: Record<ID, Room>;
  corridors: Record<ID, Corridor>;
  furniture: Record<ID, Furniture>;
  agents: Record<ID, Agent>;
  outfitTemplates: OutfitTemplate[];
  roomTemplates: RoomTemplate[];
}

// ---------- Runtime (simulation) ----------

export type AgentStatus = 'idle' | 'working' | 'walking' | 'thinking' | 'communicating' | 'error' | 'paused';

export interface AgentRuntime {
  pos: Point;                 // world cell coordinates (float, cell centre = .5)
  roomId: ID | null;
  status: AgentStatus;
  path: Point[];              // remaining cells
  destination: { roomId: ID | null; workstationId: ID | null; cell: Point } | null;
  heading: 'left' | 'right' | 'up' | 'down';
  energy: number;             // 0..100
  currentTaskId: ID | null;
  statusMessage?: string;
  waitTicks: number;
}

export type TaskStatus = 'queued' | 'active' | 'paused' | 'done' | 'cancelled' | 'failed';

export interface Task {
  id: ID;
  name: string;
  description: string;
  agentId: ID | null;
  priority: 'low' | 'normal' | 'high' | 'critical';
  status: TaskStatus;
  dependencies: ID[];
  destination: { roomId: ID | null; workstationId: ID | null };
  progress: number;           // 0..100
  workUnits: number;          // ticks of work required
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
  deadline?: string;
  simulated: boolean;         // true = generated by the simulator, no model ran
}

export type EventKind =
  | 'task-start' | 'task-complete' | 'task-failed' | 'room-change' | 'comms'
  | 'tool' | 'config' | 'error' | 'pause' | 'resume' | 'layout' | 'ai' | 'system';

export interface ActivityEvent {
  id: ID;
  at: string;
  kind: EventKind;
  agentId: ID | null;
  message: string;
  simulated: boolean;
  level: 'info' | 'warn' | 'error';
}

export interface RuntimeState {
  agents: Record<ID, AgentRuntime>;
  tasks: Record<ID, Task>;
  events: ActivityEvent[];
  tick: number;
}
