// Core data model. Everything persistent lives in `OfficeDoc` (the brain's
// agents and what they know, undoable) or `RuntimeState` (tasks, usage,
// approvals, alerts and the activity log). Ephemeral UI state lives in the UI
// store and is never saved.

export type ID = string;

// ---------- Agents ----------

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
  workStart: string; workEnd: string;
  breakEveryMin: number; breakLengthMin: number;
  /** How often the agent wakes and how long it may work, sized to its task. Planned only until a scheduler is connected. */
  runWindow?: RunWindow;
}

export interface RunWindow {
  everyMinutes: number;       // wake once per this many minutes
  maxMinutes: number;         // and work for at most this long
  setBy: 'origin' | 'owner';  // ORIGIN proposes from its productivity research; the owner can override
  reason: string;
}

export interface Permissions {
  allowedTools: string[];
  contactableAgentIds: ID[] | 'all';
  requireApprovalFor: string[];
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
  archetype?: string;
  budget: AgentBudget;
  /** Where the agent sits in the brain's branches (see brain/opportunity.ts); missing = not one of ORIGIN's branches. */
  branch?: AgentBranch;
  /** Skills from the owner's skill bank this agent uses (ids into doc.skillBank). */
  bankSkills?: ID[];
}

export interface BankSkill {
  id: ID;
  name: string;
  description: string;        // when to use it, shown to agents choosing skills
  instructions: string;       // the skill itself (a SKILL.md body)
  tags: string[];
  createdAt: string;
}

/** A venture is a business ORIGIN started; a skill agent works for exactly one venture. */
export interface SkillRequest {
  id: ID;
  fromAgentId: ID;            // the skill agent asking
  ventureId: ID;              // the venture it works for, which reviews the request
  name: string; skill: string; specialty: string; purpose: string;
  status: 'venture-review' | 'owner-review' | 'not-relevant' | 'approved' | 'denied';
  ventureNote: string;        // why the venture judged it relevant or not
  createdAt: string; decidedAt: string | null;
  agentId: ID | null;         // the skill agent created on approval
}

export interface AgentBranch { kind: 'core' | 'venture' | 'skill'; ventureId: ID | null }

export interface AgentBudget {
  monthlyCredits: number;     // spending allowance
  approvalAbove: number;      // any single spend above this needs owner approval
}

// ---------- Themes ----------

export interface ThemeTokens {
  bg: string; bg2: string; panel: string; accent: string; accent2: string; text: string; border: string;
  selection: string; success: string; warning: string; error: string; highlight: string;
}
export interface ThemeDef { id: ID; name: string; builtin?: boolean; dark: ThemeTokens; light: ThemeTokens }
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

export interface ControlSettings {
  emergencyStop: boolean;
}

export interface OfficeDoc {
  schemaVersion: number;
  id: ID;
  name: string;
  agents: Record<ID, Agent>;
  appearance: AppearanceSettings;
  alertSettings: AlertSettings;
  projects: Record<ID, Project>;
  library: Record<ID, KnowledgeEntry>;
  control: ControlSettings;
  /** Skill agents ask their venture for new skill agents here (see brain/opportunity.ts). */
  skillRequests: SkillRequest[];
  /** The owner's skill bank: reusable skills that agents creating agents can equip them with. */
  skillBank: BankSkill[];
}

// ---------- Runtime ----------

export type AgentStatus = 'idle' | 'working' | 'thinking' | 'communicating' | 'researching' | 'waiting' | 'blocked' | 'error' | 'paused';

export interface AgentRuntime {
  status: AgentStatus;
  currentTaskId: ID | null;
  statusMessage?: string;
  waitTicks: number;
}

export type TaskStatus = 'queued' | 'active' | 'waiting-approval' | 'paused' | 'done' | 'cancelled' | 'failed';

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
  libraryRefs?: ID[];         // knowledge consulted before starting
  heldBy?: 'emergency' | null; // paused by the emergency stop; resumes with its progress
}

export type EventKind =
  | 'task-start' | 'task-complete' | 'task-failed' | 'comms'
  | 'tool' | 'config' | 'error' | 'pause' | 'resume' | 'change' | 'ai' | 'system'
  | 'finance' | 'approval' | 'library' | 'alert';

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

export interface RuntimeState {
  agents: Record<ID, AgentRuntime>;
  tasks: Record<ID, Task>;
  events: ActivityEvent[];
  tick: number;
  usage: UsageRecord[];
  approvals: Record<ID, ApprovalRequest>;
  alerts: Record<ID, Alert>;
}
