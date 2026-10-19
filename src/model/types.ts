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
  'executive', 'library', 'finance', 'engineering', 'design', 'studio', 'market',
  'ops-floor', 'arcade', 'blender-studio',
  'royal-lounge',
] as const;
export type RoomType = (typeof ROOM_TYPES)[number];

export interface RoomAppearance {
  floor: 'grid' | 'tile' | 'carpet' | 'metal' | 'wood' | 'plain';
  wallColor: string;
  accent: string;             // accent strips, labels
  lighting: number;           // intensity 0..1
  theme?: string;             // name of the room palette last applied
  floorColor?: string;        // tints the floor material; unset = global office floor colour
  lightTemp?: number;         // kelvin 2200..6500, default 4500
  doorColor?: string;
  windowTint?: string;
  furnitureMaterial?: FurnitureMaterial;
  displayColor?: string;      // screens and holograms in this room
  effect?: 'none' | 'ambient-glow' | 'scanlines' | 'particles';
}

export const FURNITURE_MATERIALS = ['default', 'graphite', 'titanium', 'black-titanium', 'walnut', 'white-composite', 'brass'] as const;
export type FurnitureMaterial = (typeof FURNITURE_MATERIALS)[number];

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
  // original set
  'desk', 'chair', 'computer', 'monitors', 'server-rack', 'whiteboard', 'cabinet',
  'conference-table', 'shelf', 'container', 'plant', 'lamp', 'sofa', 'decor', 'workbench',
  // furniture
  'exec-desk', 'holo-desk', 'standing-desk', 'lounge-seat', 'locker', 'strategy-table',
  // computing
  'curved-monitor', 'holo-display', 'multi-monitor', 'terminal', 'charging-station', 'diagnostic-panel', 'research-kiosk',
  // communication
  'tube-station', 'dispatch-terminal', 'message-station', 'routing-hub', 'intercom', 'relay-panel',
  // research
  'archive-terminal', 'digital-shelf', 'data-vault', 'evidence-station', 'market-display', 'comparison-wall',
  // creative
  'holo-table', 'mockup-display', 'packaging-station', 'material-station', 'prototype-printer', 'photo-station',
  // business
  'budget-dashboard', 'approval-kiosk', 'project-board', 'finance-terminal', 'marketplace-display', 'inventory-monitor', 'analytics-wall',
  // game development and 3D production
  'arcade-cabinet', 'dev-desk', 'collab-table', 'test-station', 'project-display', 'equipment-shelf',
  'workstation-3d', 'reference-display', 'preview-stage', 'review-table', 'material-library', 'anim-station', 'render-wall',
  // high-capacity operations
  'compact-desk', 'task-board', 'supply-station', 'lane-marker',
  // atmosphere
  'sculpture', 'floor-light', 'wall-panel', 'window', 'deco-robot', 'aquarium', 'wall-art', 'ambient-machine',
  // royal lounge
  'briefing-board', 'throne', 'lounge-sofa', 'crown-chandelier', 'holo-fountain',
] as const;
export type FurnitureType = (typeof FURNITURE_TYPES)[number];

export const OBJECT_CATEGORIES = ['furniture', 'computing', 'communication', 'research', 'creative', 'business', 'atmosphere'] as const;
export type ObjectCategory = (typeof OBJECT_CATEGORIES)[number];

/** What an object does in the simulation. Decorative objects have no function. */
export type ObjectFunction = 'workstation' | 'tube' | 'archive' | 'approval' | 'budget' | 'display' | 'charging' | 'storage' | 'seating' | 'arcade' | 'render' | 'none';

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
  label?: string;             // custom display name
  material?: FurnitureMaterial;
  groupId?: string;           // objects sharing a group move and select together
  tube?: { stationName: string; department: string }; // pneumatic tube endpoint
  arcade?: { game: GameId; theme: string };           // human-only arcade cabinet
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
  top: 'tshirt' | 'hoodie' | 'suit' | 'labcoat' | 'coverall' | 'uniform' | 'vest' | 'jacket' | 'robe' | 'armor' | 'longcoat';
  topColor: string;
  bottom: 'pants' | 'shorts' | 'skirt';
  bottomColor: string;
  shoes: 'sneakers' | 'boots' | 'dress';
  shoeColor: string;
  headwear: 'none' | 'cap' | 'hardhat' | 'helmet' | 'beanie' | 'headset' | 'mask' | 'full-helmet';
  headwearColor: string;
  glasses: 'none' | 'round' | 'square' | 'visor' | 'ar-glasses';
  jewelry: 'none' | 'earrings' | 'necklace' | 'badge';
  equipment: 'none' | 'tablet' | 'wrench' | 'clipboard' | 'laptop' | 'toolbelt' | 'briefcase' | 'drafting-tablet' | 'holo-catalog';
  accent: string;           // glow / palette accent
  trimColor: string;        // secondary clothing colour: trim, insignia, tie
  faceMarkings: 'none' | 'freckles' | 'scar' | 'tattoo' | 'circuit';
  robotic: 'none' | 'eyepiece' | 'jaw' | 'half-face' | 'full';
  shoulders: 'none' | 'pads' | 'metallic' | 'armored';
  gloves: 'none' | 'work' | 'tech' | 'formal';
  gloveColor: string;
  belt: 'none' | 'belt' | 'harness' | 'utility';
  /** Accessory item ids from the cosmetic catalogue (badges, wrist displays, floating assistants…). */
  accessories: string[];
  effects: CharacterEffects;
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

export interface CharacterEffects {
  aura: boolean; holoOutline: boolean; eyeGlow: boolean; particles: boolean; energyAccents: boolean; robotics: boolean;
  intensity: number;        // 0..1, restrained by default
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
  /** Appearance the agent was created with; "Restore default appearance" returns here. */
  defaultAppearance?: Appearance;
  archetype?: string;
  /** A locked uniform the agent is wearing; its cosmetics can't be changed piece by piece. */
  uniformId?: ID | null;
  budget: AgentBudget;
  assets: VisualAssets;
}

export interface AgentBudget {
  monthlyCredits: number;     // spending allowance
  approvalAbove: number;      // any single spend above this needs owner approval
}

export interface OutfitTemplate {
  id: ID; name: string; patch: Partial<Appearance>;
  kind?: 'outfit' | 'uniform';
  department?: string;        // uniforms: the department they're approved for
  approved?: boolean;         // uniforms must be approved before applying to a department
  occasion?: string;          // seasonal / event label
  locked?: boolean;           // a fixed role uniform: worn whole, never edited or accessorised
}

export type CosmeticCategory = 'head' | 'clothing' | 'accessory' | 'effect';
export type Rarity = 'common' | 'uncommon' | 'rare' | 'legendary';

/**
 * A cosmetic inventory item. Applying it merges `patch` into the appearance
 * (or adds `accessoryId`). Rarity and collections are purely organisational and
 * never affect permissions or performance. Functional equipment names the tool
 * it represents; it can only be worn by agents allowed to use that tool.
 */
export interface CosmeticItem {
  id: ID; name: string; category: CosmeticCategory;
  slot: string;               // the appearance field it occupies (top, headwear, accessories…)
  patch?: Partial<Appearance>;
  accessoryId?: string;
  rarity?: Rarity;
  collection?: string;
  functionalTool?: string;    // e.g. 'diagnostics' — wearing it requires this tool permission
  custom?: boolean;
  assetId?: ID | null;        // uploaded artwork preview
  tags?: string[];
}
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
  collisionRule: 'warn' | 'prevent';  // object placement overlapping another object
  animationIntensity: 'off' | 'subtle' | 'full';
  idleWandering: boolean;      // purely cosmetic idle movement
  /** How the campus is drawn and how Auto Sort packs it: classic grid offices, or floating bubble rooms joined by transport tubes. */
  layoutPreset: LayoutPreset;
}
export const LAYOUT_PRESETS = ['grid', 'bubble'] as const;
export type LayoutPreset = (typeof LAYOUT_PRESETS)[number];

// ---------- Themes ----------

export interface ThemeTokens {
  bg: string; bg2: string; panel: string; accent: string; accent2: string; text: string; border: string;
  selection: string; success: string; warning: string; error: string; highlight: string;
}
export interface OfficeColors { floor: string; wall: string; door: string; corridor: string; lighting: string }
export interface ThemeDef { id: ID; name: string; builtin?: boolean; dark: ThemeTokens; light: ThemeTokens; office: { dark: OfficeColors; light: OfficeColors } }
export interface AppearanceSettings { mode: 'dark' | 'light' | 'system'; themeId: ID; themes: ThemeDef[] }

// ---------- Alerts ----------

export type AlertSeverity = 'critical' | 'high' | 'warning' | 'info';
export type AlertCategory = 'operational' | 'financial' | 'project' | 'informational';
export type DeliveryChannel = 'in-app' | 'sound' | 'desktop' | 'email' | 'messaging' | 'push';

export interface SeveritySound { soundId: string; volume: number; repeatSec: number; ackRequired: boolean }
export interface AlertSettings {
  sounds: Record<AlertSeverity, SeveritySound>;
  customSounds: { id: ID; name: string; assetId: ID }[];
  masterVolume: number;
  muted: Partial<Record<AlertCategory, boolean>>;   // never silences critical alerts
  quietHours: { enabled: boolean; start: string; end: string };   // critical alerts still sound
  soundSchedule: { enabled: boolean; start: string; end: string }; // sound only in these hours (critical exempt)
  cooldownSec: number;          // identical alerts within this window are grouped
  escalation: { enabled: boolean; afterSec: number; maxLevel: number };
  thresholds: { budgetWarnPct: number; budgetCriticalPct: number; spendRateFactor: number; repeatedFailures: number };
  channels: Record<DeliveryChannel, { enabled: boolean; minSeverity: AlertSeverity; target?: string }>;
  minSoundSeverity: AlertSeverity; // routine events below this never make noise
}

// ---------- Business ----------

export interface Project {
  id: ID; name: string; ownerAgentId: ID | null; budget: number; forecastSpend: number;
  status: 'active' | 'paused' | 'blocked' | 'done';
  description: string;
}

export interface KnowledgeEntry {
  id: ID; title: string; summary: string; topic: string; tags: string[];
  sources: { title: string; url: string }[];
  createdAt: string; authorAgentId: ID | null; projectId: ID | null;
  confidence: number;         // 0..1
  verification: 'unverified' | 'verified' | 'disputed';
  sensitive: boolean;         // only agents in allowedAgentIds can read it
  allowedAgentIds: ID[];
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
  cosmetics: CosmeticItem[];
  appearance: AppearanceSettings;
  alertSettings: AlertSettings;
  projects: Record<ID, Project>;
  library: Record<ID, KnowledgeEntry>;
  departments: Record<ID, Department>;
  control: ControlSettings;
  arcade: ArcadeSettings;
}

// ---------- Departments and executive control ----------

/**
 * A category of agents, matched by `identity.department`. Its mode is what the
 * owner asked for; the state shown on the dashboard is derived from what the
 * agents are actually doing (see engine/departments.ts).
 */
export interface Department {
  id: ID; name: string; color: string; description: string;
  mode: 'running' | 'paused';
  essential: boolean;               // never paused automatically by a resource policy
  maxConcurrent: number | null;     // simultaneous active tasks, null = no limit
  excludedAgentIds: ID[];           // left alone by bulk pause and resume
  renderPolicy: 'finish' | 'cancel' | 'defer'; // jobs that can't be paused safely
}
export type DepartmentState = 'running' | 'pausing' | 'paused' | 'blocked' | 'error';

export interface ResourcePolicy {
  prioritizeRendering: boolean;     // while a render runs, cap other work at backgroundLimit
  backgroundLimit: number;
  pauseNonessential: boolean;       // hold new work in non-essential departments while rendering
  autoResume: boolean;              // release those holds when rendering ends
}
export interface ControlSettings {
  emergencyStop: boolean;
  policy: ResourcePolicy;
  simplifyAbove: number;            // visible agents before characters switch to simple markers (0 = never)
  blenderBridgeUrl: string;         // local Blender bridge (server/blender-bridge.mjs); empty = planning mode
}

export type GameId = 'flappy' | 'pacman' | 'pong';
export interface ArcadeSettings {
  policy: 'human-only' | 'agent-disabled' | 'token-free';
  limits: Record<GameId, { maxScore: number; maxSessionSec: number }>;
  maxAgentMatchesPerDay: number;
  tokenFreeVerified: boolean;       // set only by a verified local, model-free play path; none exists yet
}

export type AssetKind = 'character' | 'prop' | 'cosmetic' | 'environment' | 'animation' | 'luau-script' | 'level' | 'ui';
export const ASSET_STAGES = ['assigned', 'creating', 'preview', 'review', 'approved', 'exported', 'integrated', 'rejected'] as const;
export type AssetStage = (typeof ASSET_STAGES)[number];
/** A production item moving through task → creation → preview → review → approval → export → integration. */
export interface AssetJob {
  id: ID; name: string; kind: AssetKind; projectId: ID | null; ownerAgentId: ID | null;
  stage: AssetStage;
  history: { stage: AssetStage; at: string; by: ID | null; simulated: boolean }[];
  real: { file: string; verifiedAt: string } | null; // set only when a real file was produced and checked
  notes: string;
}

// ---------- Runtime (simulation) ----------

export type AgentStatus = 'idle' | 'working' | 'walking' | 'thinking' | 'communicating' | 'researching' | 'waiting' | 'blocked' | 'error' | 'paused';

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

export type TaskStatus = 'queued' | 'in-transit' | 'active' | 'waiting-approval' | 'paused' | 'done' | 'cancelled' | 'failed';

/** A structured handoff: every collaboration states its outcome up front. */
export interface Handoff {
  request: string; why: string; known: string; deliverable: string;
  deadline?: string; budget?: number; acceptance: string;
  fromAgentId?: ID | null;
}

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
  projectId?: ID | null;
  handoff?: Handoff;
  costPerUnit?: number;       // credits spent per work unit (simulated usage)
  failures?: number;
  acknowledgedBy?: ID | null; // set when the receiving agent confirms a delivered task
  acknowledgedAt?: string;
  deliveredVia?: 'tube' | 'direct';
  libraryRefs?: ID[];         // knowledge consulted before starting
  jobKind?: 'standard' | 'render' | 'save'; // render jobs can't pause mid-frame; saves always finish
  heldBy?: 'department' | 'emergency' | null; // paused by a bulk control; resumes with its progress
  assetId?: ID | null;        // production item this task advances
  checkpoint?: number;        // last safe progress point for jobs restarted after a hold
}

export type EventKind =
  | 'task-start' | 'task-complete' | 'task-failed' | 'room-change' | 'comms'
  | 'tool' | 'config' | 'error' | 'pause' | 'resume' | 'layout' | 'ai' | 'system'
  | 'tube' | 'finance' | 'approval' | 'library' | 'alert' | 'department' | 'policy' | 'production';

export interface ActivityEvent {
  id: ID;
  at: string;
  kind: EventKind;
  agentId: ID | null;
  message: string;
  simulated: boolean;
  level: 'info' | 'warn' | 'error';
}

export interface UsageRecord {
  id: ID; at: string; agentId: ID | null; projectId: ID | null; taskId: ID | null;
  credits: number; kind: 'model' | 'tool' | 'purchase';
  simulated: boolean;
}

export interface ApprovalRequest {
  id: ID; at: string; agentId: ID | null; action: string; detail: string;
  amount?: number; projectId?: ID | null; taskId?: ID | null;
  reason: string;             // why approval is needed
  status: 'pending' | 'approved' | 'rejected';
  decidedAt?: string;
}

export interface AlertDelivery { channel: DeliveryChannel; status: 'delivered' | 'shown' | 'queued' | 'not-connected' | 'permission-needed' | 'suppressed'; detail?: string; soundId?: string }

export interface Alert {
  id: ID; key: string;        // dedupe key: same key within cooldown = same alert
  severity: AlertSeverity; category: AlertCategory;
  title: string; description: string; recommended: string;
  firstAt: string; lastAt: string; count: number;
  agentId?: ID | null; projectId?: ID | null; roomId?: ID | null; taskId?: ID | null; approvalId?: ID | null;
  evidence: { kind: 'event' | 'usage' | 'task' | 'log'; id: string; label: string }[];
  status: 'open' | 'acknowledged' | 'resolved';
  ackRequired: boolean;
  escalationLevel: number;
  lastNotifiedAt: string;
  deliveries: AlertDelivery[];
  test?: boolean;
}

export interface Capsule {
  id: ID; taskId: ID; fromId: ID; toId: ID;   // tube-station furniture ids
  path: Point[]; progress: number;            // index into path (float)
  status: 'in-transit' | 'delivered';
  recipientId: ID | null;
  deliveredTick?: number;                     // tick the capsule arrived; it stays visible briefly with its delivery status
  acknowledged?: boolean;                     // the recipient confirmed it on arrival
}

export interface RuntimeState {
  agents: Record<ID, AgentRuntime>;
  tasks: Record<ID, Task>;
  events: ActivityEvent[];
  tick: number;
  usage: UsageRecord[];
  approvals: Record<ID, ApprovalRequest>;
  alerts: Record<ID, Alert>;
  capsules: Record<ID, Capsule>;
  policyHeld: ID[];           // departments a resource policy is holding (no new work)
  assets: Record<ID, AssetJob>; // production items; stages advance as work completes
  arcadeSessions: ArcadeSession[];
}

export interface ArcadeSession {
  id: ID; agentId: ID | null; game: GameId; startedAt: string; durationSec: number; score: number;
  result: 'crash' | 'caught' | 'cleared' | 'win' | 'lose' | 'score-cap' | 'time-limit' | 'abandoned'; reward: number;
}
