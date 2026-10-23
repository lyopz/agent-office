// Schema validation + migrations for saved/imported brains.
import { z } from 'zod';
import { makeAgent } from './defaults';
import type { OfficeDoc } from './types';
import { defaultAppearanceSettings } from './themes';
import { defaultAlertSettings } from './alertDefaults';

export const SCHEMA_VERSION = 8;

const id = z.string().min(1).max(120);
const num = z.number().finite();
const color = z.string().max(40);

// Agents are validated loosely and then filled from defaults, so older files gain new fields.
const agent = z.object({
  id, enabled: z.boolean().default(true),
  identity: z.object({ name: z.string().min(1).max(80), title: z.string().max(120) }).passthrough(),
}).passthrough();

const tokens = z.object({
  bg: color, bg2: color, panel: color, accent: color, accent2: color, text: color, border: color,
  selection: color, success: color, warning: color, error: color, highlight: color,
});
const theme = z.object({ id, name: z.string().max(80), builtin: z.boolean().optional(), dark: tokens, light: tokens });
const hexColor = z.string().regex(/^#[0-9a-f]{6}$/i);
const appearanceSettings = z.object({ mode: z.enum(['dark', 'light', 'system']), themeId: id, themes: z.array(theme).min(1).max(60), brainColors: z.record(z.string().max(120), hexColor).default({}) });

const severity = z.enum(['critical', 'high', 'warning', 'info']);
const sevSound = z.object({ soundId: z.string().max(80), volume: num.min(0).max(1), repeatSec: num.min(0), ackRequired: z.boolean() });
const hours = z.object({ enabled: z.boolean(), start: z.string().max(5), end: z.string().max(5) });
const channel = z.object({ enabled: z.boolean(), minSeverity: severity, target: z.string().max(200).optional() });
const alertSettings = z.object({
  sounds: z.object({ critical: sevSound, high: sevSound, warning: sevSound, info: sevSound }),
  customSounds: z.array(z.object({ id, name: z.string().max(80), assetId: id })).max(40),
  masterVolume: num.min(0).max(1),
  muted: z.record(z.boolean()),
  quietHours: hours, soundSchedule: hours,
  cooldownSec: num.min(0), escalation: z.object({ enabled: z.boolean(), afterSec: num.min(5), maxLevel: num.min(1).max(10) }),
  thresholds: z.object({ budgetWarnPct: num, budgetCriticalPct: num, spendRateFactor: num, repeatedFailures: num.min(1) }),
  channels: z.object({ 'in-app': channel, sound: channel, desktop: channel, email: channel, messaging: channel, push: channel }),
  minSoundSeverity: severity,
});

const project = z.object({
  id, name: z.string().max(120), ownerAgentId: id.nullable(), budget: num.min(0), forecastSpend: num.min(0),
  status: z.enum(['active', 'paused', 'blocked', 'done']), description: z.string().max(2000).default(''),
});
const knowledge = z.object({
  id, title: z.string().max(200), summary: z.string().max(4000), topic: z.string().max(120), tags: z.array(z.string().max(60)).max(30),
  sources: z.array(z.object({ title: z.string().max(200), url: z.string().max(1000) })).max(40),
  createdAt: z.string(), authorAgentId: id.nullable(), projectId: id.nullable(), confidence: num.min(0).max(1),
  verification: z.enum(['unverified', 'verified', 'disputed']), sensitive: z.boolean(), allowedAgentIds: z.array(id),
});
export const officeSchema = z.object({
  schemaVersion: z.number().int(),
  id, name: z.string().max(200),
  head: z.boolean().optional(),
  plan: z.object({
    purpose: z.string().max(4000), lead: z.string().max(80), createdBy: z.enum(['jarvis', 'owner']), createdAt: z.string(),
    research: z.array(z.string().max(400)).max(20).default([]), fromVenture: z.string().max(80).optional(),
    history: z.array(z.object({ at: z.string(), note: z.string().max(1000) })).max(200).default([]),
  }).optional(),
  agents: z.record(agent),
  appearance: appearanceSettings,
  alertSettings,
  projects: z.record(project),
  library: z.record(knowledge),
  control: z.object({ emergencyStop: z.boolean() }),
  skillRequests: z.array(z.object({
    id, fromAgentId: id, ventureId: id, name: z.string().min(1).max(80), skill: z.string().max(120), specialty: z.string().max(200), purpose: z.string().max(4000),
    status: z.enum(['venture-review', 'owner-review', 'not-relevant', 'approved', 'denied']), ventureNote: z.string().max(2000),
    createdAt: z.string(), decidedAt: z.string().nullable(), agentId: id.nullable(),
  })).max(1000).default([]),
  skillBank: z.array(z.object({
    id, name: z.string().min(1).max(80), description: z.string().max(1000), instructions: z.string().max(60_000), // the owner's library skills run long (up to 60,000 characters)
    tags: z.array(z.string().max(40)).max(20).default([]), createdAt: z.string(),
  })).max(400).default([]),
});

const SECRET_KEYS = /^(api[-_]?key|secret|token|password|authorization|credential)s?$/i;

/** Remove anything that looks like a credential. Saved and exported files never contain secrets. */
export function stripSecrets<T>(value: T): T {
  if (Array.isArray(value)) return value.map(stripSecrets) as T;
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) if (!SECRET_KEYS.test(k)) out[k] = stripSecrets(v);
    return out as T;
  }
  return value;
}

type Raw = Record<string, any>;

/** Fields that belonged to the old office (rooms, hallways, furniture, outfits, arcade) and are dropped on load. */
const OFFICE_FIELDS = ['settings', 'rooms', 'corridors', 'furniture', 'outfitTemplates', 'roomTemplates', 'cosmetics', 'departments', 'arcade', 'player'];
const OFFICE_AGENT_FIELDS = ['appearance', 'defaultAppearance', 'uniformId', 'assets'];

/** Any older save (v1 to v7, the office) becomes a brain: its agents, knowledge, projects and settings are kept. */
function fromOffice(d: Raw): Raw {
  for (const k of OFFICE_FIELDS) delete d[k];
  d.appearance ??= defaultAppearanceSettings();
  for (const t of Array.isArray(d.appearance?.themes) ? d.appearance.themes : []) delete t.office;
  d.alertSettings ??= defaultAlertSettings();
  d.projects ??= {};
  d.library ??= {};
  d.control = { emergencyStop: !!d.control?.emergencyStop };
  for (const a of Object.values((d.agents ?? {}) as Record<string, Raw>)) {
    for (const k of OFFICE_AGENT_FIELDS) delete a[k];
    if (a.schedule) { delete a.schedule.assignedRoomId; delete a.schedule.preferredWorkstationId; }
    if (a.permissions) delete a.permissions.canMoveRooms;
  }
  d.schemaVersion = 8;
  return d;
}

function fillAgent(a: Raw): Raw {
  const base = makeAgent(a.identity?.name ?? 'Agent', a.identity?.title ?? 'Generalist', a.identity?.department ?? 'Operations') as unknown as Raw;
  const merge = (t: Raw, s: Raw) => {
    for (const [k, v] of Object.entries(s ?? {})) {
      if (v && typeof v === 'object' && !Array.isArray(v) && t[k] && typeof t[k] === 'object' && !Array.isArray(t[k])) merge(t[k], v as Raw);
      else t[k] = v;
    }
  };
  merge(base, a);
  base.id = a.id;
  return base;
}

export type ParseResult = { ok: true; doc: OfficeDoc; warnings: string[] } | { ok: false; errors: string[] };

/** Validate + migrate any saved or imported office. Never throws. */
export function parseOffice(input: unknown): ParseResult {
  try {
    if (!input || typeof input !== 'object') return { ok: false, errors: ['File is not a JSON object'] };
    let d: Raw = JSON.parse(JSON.stringify(stripSecrets(input)));
    if ((d.format === 'the-brain' || d.format === 'agent-office') && d.office) d = d.office;
    const warnings: string[] = [];
    const v = typeof d.schemaVersion === 'number' ? d.schemaVersion : 1;
    if (v > SCHEMA_VERSION) return { ok: false, errors: [`File uses schema v${v}; this app supports up to v${SCHEMA_VERSION}`] };
    if (v < SCHEMA_VERSION) { d = fromOffice(d); warnings.push(`Converted a v${v} office save into a brain`); }
    const r = officeSchema.safeParse(d);
    if (!r.success) {
      return { ok: false, errors: r.error.issues.slice(0, 12).map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`) };
    }
    const doc = r.data as unknown as OfficeDoc;
    for (const [k, a] of Object.entries(doc.agents)) doc.agents[k] = fillAgent(a as unknown as Raw) as unknown as OfficeDoc['agents'][string];
    const errs: string[] = [];
    for (const [k, a] of Object.entries(doc.agents)) if (a.id !== k) errs.push(`Agent key ${k} doesn't match its id`);
    for (const p of Object.values(doc.projects)) if (p.ownerAgentId && !doc.agents[p.ownerAgentId]) p.ownerAgentId = null;
    if (!doc.appearance.themes.some((t) => t.id === doc.appearance.themeId)) doc.appearance.themeId = doc.appearance.themes[0].id;
    if (errs.length) return { ok: false, errors: errs.slice(0, 12) };
    doc.schemaVersion = SCHEMA_VERSION;
    return { ok: true, doc, warnings };
  } catch (e) {
    return { ok: false, errors: [`Could not read file: ${(e as Error).message}`] };
  }
}

export function exportOffice(doc: OfficeDoc, extra: Record<string, unknown> = {}) {
  return JSON.stringify(stripSecrets({ format: 'the-brain', version: SCHEMA_VERSION, exportedAt: new Date().toISOString(), office: doc, ...extra }), null, 2);
}
