// Schema validation + migrations for saved/imported offices.
import { z } from 'zod';
import { DEFAULT_APPEARANCE, DEFAULT_OUTFITS, builtinRoomTemplates, makeAgent, withAppearance } from './defaults';
import { FURNITURE_MATERIALS, FURNITURE_TYPES, ROOM_TYPES, type OfficeDoc } from './types';
import { BUILTIN_COSMETICS } from './cosmetics';
import { defaultAppearanceSettings } from './themes';
import { defaultAlertSettings } from './alertDefaults';

export const SCHEMA_VERSION = 3;

const id = z.string().min(1).max(120);
const num = z.number().finite();
const point = z.object({ x: num, y: num });
const color = z.string().max(40);

const door = z.object({ id, side: z.enum(['n', 's', 'e', 'w']), offset: num, width: num.min(1) });
const room = z.object({
  id, name: z.string().max(120), type: z.enum(ROOM_TYPES), x: num, y: num, w: num.min(1), h: num.min(1),
  rotation: z.literal(0).default(0),
  walls: z.object({ thickness: num, style: z.enum(['solid', 'glass']) }).default({ thickness: 2, style: 'solid' }),
  doors: z.array(door), appearance: z.object({
    floor: z.enum(['grid', 'tile', 'carpet', 'metal', 'wood', 'plain']), wallColor: color, accent: color, lighting: num, theme: z.string().optional(),
    floorColor: color.optional(), lightTemp: num.optional(), doorColor: color.optional(), windowTint: color.optional(),
    furnitureMaterial: z.enum(FURNITURE_MATERIALS).optional(), displayColor: color.optional(),
    effect: z.enum(['none', 'ambient-glow', 'scanlines', 'particles']).optional(),
  }),
  furnitureIds: z.array(id), assignedAgentIds: z.array(id), purpose: z.string().max(500).default(''), special: z.string().optional(),
});
const endpoint = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('door'), roomId: id, doorId: id }),
  z.object({ kind: z.literal('corridor'), corridorId: id }),
]);
const corridor = z.object({
  id, name: z.string().max(120), width: num.min(1).max(12), points: z.array(point).max(500), start: endpoint, end: endpoint,
  routing: z.enum(['auto', 'manual']), isMain: z.boolean().default(false), blocked: z.boolean().default(false),
  status: z.enum(['ok', 'warning', 'broken']).default('ok'), statusMessage: z.string().optional(),
});
const workstation = z.object({
  name: z.string(), assignedAgentId: id.nullable(), equipment: z.array(z.string()), status: z.enum(['online', 'offline', 'maintenance']), services: z.array(z.string()),
});
const furniture = z.object({
  id, type: z.enum(FURNITURE_TYPES), roomId: id, x: num, y: num, w: num.min(1), h: num.min(1),
  rotation: z.union([z.literal(0), z.literal(90), z.literal(180), z.literal(270)]), color, blocking: z.boolean(), workstation: workstation.optional(),
  label: z.string().max(120).optional(), material: z.enum(FURNITURE_MATERIALS).optional(), groupId: z.string().max(120).optional(),
  tube: z.object({ stationName: z.string().max(120), department: z.string().max(120) }).optional(),
});

// Agents are validated loosely and then filled from defaults, so older files gain new fields.
const agent = z.object({
  id, enabled: z.boolean().default(true),
  identity: z.object({ name: z.string().min(1).max(80), title: z.string().max(120) }).passthrough(),
}).passthrough();

const settings = z.object({
  gridSize: num, bounds: z.object({ x: num, y: num, w: num, h: num }).nullable(),
  hallwayMode: z.enum(['automatic', 'manual', 'hybrid']), minCorridorWidth: num, defaultCorridorWidth: num,
  collisionRule: z.enum(['warn', 'prevent']).default('warn'),
  animationIntensity: z.enum(['off', 'subtle', 'full']).default('subtle'),
  idleWandering: z.boolean().default(false),
});

const tokens = z.object({
  bg: color, bg2: color, panel: color, accent: color, accent2: color, text: color, border: color,
  selection: color, success: color, warning: color, error: color, highlight: color,
});
const officeColors = z.object({ floor: color, wall: color, door: color, corridor: color, lighting: color });
const theme = z.object({ id, name: z.string().max(80), builtin: z.boolean().optional(), dark: tokens, light: tokens, office: z.object({ dark: officeColors, light: officeColors }) });
const appearanceSettings = z.object({ mode: z.enum(['dark', 'light', 'system']), themeId: id, themes: z.array(theme).min(1).max(60) });

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
const cosmetic = z.object({
  id, name: z.string().max(120), category: z.enum(['head', 'clothing', 'accessory', 'effect']), slot: z.string().max(40),
  patch: z.record(z.unknown()).optional(), accessoryId: z.string().max(80).optional(),
  rarity: z.enum(['common', 'uncommon', 'rare', 'legendary']).optional(), collection: z.string().max(80).optional(),
  functionalTool: z.string().max(80).optional(), custom: z.boolean().optional(), assetId: id.nullable().optional(), tags: z.array(z.string().max(40)).optional(),
});

export const officeSchema = z.object({
  schemaVersion: z.number().int(),
  id, name: z.string().max(200),
  settings,
  rooms: z.record(room), corridors: z.record(corridor), furniture: z.record(furniture), agents: z.record(agent),
  outfitTemplates: z.array(z.object({
    id, name: z.string(), patch: z.record(z.unknown()), kind: z.enum(['outfit', 'uniform']).optional(),
    department: z.string().max(120).optional(), approved: z.boolean().optional(), occasion: z.string().max(120).optional(),
  })).default([]),
  roomTemplates: z.array(z.unknown()).default([]),
  cosmetics: z.array(cosmetic).max(500),
  appearance: appearanceSettings,
  alertSettings,
  projects: z.record(project),
  library: z.record(knowledge),
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
const migrations: Record<number, (d: Raw) => Raw> = {
  // v1 → v2: templates, hallway flags and agent appearance assets were added.
  1: (d) => {
    for (const c of Object.values<Raw>(d.corridors ?? {})) { c.isMain ??= false; c.blocked ??= false; c.status ??= 'ok'; }
    d.outfitTemplates ??= DEFAULT_OUTFITS;
    d.roomTemplates ??= builtinRoomTemplates();
    d.settings ??= {};
    d.settings.hallwayMode ??= 'hybrid';
    d.settings.minCorridorWidth ??= 1;
    d.settings.defaultCorridorWidth ??= 2;
    d.settings.gridSize ??= 24;
    d.settings.bounds ??= null;
    d.schemaVersion = 2;
    return d;
  },
  // v2 → v3: headquarters features — object library, cosmetics, themes, alerts, projects, library.
  2: (d) => {
    d.settings ??= {};
    d.settings.collisionRule ??= 'warn';
    d.settings.animationIntensity ??= 'subtle';
    d.settings.idleWandering ??= false;
    d.cosmetics ??= BUILTIN_COSMETICS;
    d.appearance ??= defaultAppearanceSettings();
    d.alertSettings ??= defaultAlertSettings();
    d.projects ??= {};
    d.library ??= {};
    d.schemaVersion = 3;
    return d;
  },
};

function fillAgent(a: Raw): Raw {
  const base = makeAgent(a.identity?.name ?? 'Agent', a.identity?.title ?? 'Generalist', a.identity?.department ?? 'Operations') as unknown as Raw;
  const merge = (t: Raw, s: Raw) => {
    for (const [k, v] of Object.entries(s ?? {})) {
      if (v && typeof v === 'object' && !Array.isArray(v) && t[k] && typeof t[k] === 'object' && !Array.isArray(t[k])) merge(t[k], v as Raw);
      else t[k] = v;
    }
  };
  merge(base, a);
  base.appearance = withAppearance(DEFAULT_APPEARANCE, a.appearance ?? {});
  base.defaultAppearance = a.defaultAppearance ? withAppearance(DEFAULT_APPEARANCE, a.defaultAppearance) : base.appearance;
  base.id = a.id;
  return base;
}

export type ParseResult = { ok: true; doc: OfficeDoc; warnings: string[] } | { ok: false; errors: string[] };

/** Validate + migrate any saved or imported office. Never throws. */
export function parseOffice(input: unknown): ParseResult {
  try {
    if (!input || typeof input !== 'object') return { ok: false, errors: ['File is not a JSON object'] };
    let d: Raw = JSON.parse(JSON.stringify(stripSecrets(input)));
    if (d.format === 'agent-office' && d.office) d = d.office;
    const warnings: string[] = [];
    const v = typeof d.schemaVersion === 'number' ? d.schemaVersion : 1;
    if (v > SCHEMA_VERSION) return { ok: false, errors: [`File uses schema v${v}; this app supports up to v${SCHEMA_VERSION}`] };
    for (let k = v; k < SCHEMA_VERSION; k++) { d = migrations[k](d); warnings.push(`Migrated from schema v${k} to v${k + 1}`); }
    const r = officeSchema.safeParse(d);
    if (!r.success) {
      return { ok: false, errors: r.error.issues.slice(0, 12).map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`) };
    }
    const doc = r.data as unknown as OfficeDoc;
    for (const [k, a] of Object.entries(doc.agents)) doc.agents[k] = fillAgent(a as unknown as Raw) as unknown as OfficeDoc['agents'][string];
    if (!doc.roomTemplates.length) doc.roomTemplates = builtinRoomTemplates();
    // referential integrity
    const errs: string[] = [];
    for (const r of Object.values(doc.rooms)) for (const fid of r.furnitureIds) if (!doc.furniture[fid]) errs.push(`Room ${r.name} references missing furniture ${fid}`);
    for (const f of Object.values(doc.furniture)) if (!doc.rooms[f.roomId]) errs.push(`Furniture ${f.id} references missing room ${f.roomId}`);
    for (const c of Object.values(doc.corridors)) for (const e of [c.start, c.end]) {
      if (e.kind === 'door' && !doc.rooms[e.roomId]) errs.push(`${c.name} references missing room ${e.roomId}`);
      if (e.kind === 'corridor' && !doc.corridors[e.corridorId]) errs.push(`${c.name} joins missing hallway ${e.corridorId}`);
    }
    for (const [k, r] of Object.entries(doc.rooms)) if (r.id !== k) errs.push(`Room key ${k} doesn't match its id`);
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
  return JSON.stringify(stripSecrets({ format: 'agent-office', version: SCHEMA_VERSION, exportedAt: new Date().toISOString(), office: doc, ...extra }), null, 2);
}
