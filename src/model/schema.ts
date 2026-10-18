// Schema validation + migrations for saved/imported offices.
import { z } from 'zod';
import { DEFAULT_APPEARANCE, DEFAULT_OUTFITS, builtinRoomTemplates, makeAgent } from './defaults';
import { FURNITURE_TYPES, ROOM_TYPES, type OfficeDoc } from './types';

export const SCHEMA_VERSION = 2;

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
});

// Agents are validated loosely and then filled from defaults, so older files gain new fields.
const agent = z.object({
  id, enabled: z.boolean().default(true),
  identity: z.object({ name: z.string().min(1).max(80), title: z.string().max(120) }).passthrough(),
}).passthrough();

const settings = z.object({
  gridSize: num, bounds: z.object({ x: num, y: num, w: num, h: num }).nullable(),
  hallwayMode: z.enum(['automatic', 'manual', 'hybrid']), minCorridorWidth: num, defaultCorridorWidth: num,
});

export const officeSchema = z.object({
  schemaVersion: z.number().int(),
  id, name: z.string().max(200),
  settings,
  rooms: z.record(room), corridors: z.record(corridor), furniture: z.record(furniture), agents: z.record(agent),
  outfitTemplates: z.array(z.object({ id, name: z.string(), patch: z.record(z.unknown()) })).default([]),
  roomTemplates: z.array(z.unknown()).default([]),
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
  base.appearance = { ...DEFAULT_APPEARANCE, ...(a.appearance ?? {}) };
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
