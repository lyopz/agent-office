// The on-disk / in-storage save format.
//
// A save is an envelope around the serialized office:
//   {"format":"agent-office-save","version":1,"savedAt":"…","checksum":"fnv1a32-xxxxxxxx-<len>","doc":{…},"runtime":{…}}
// The checksum covers the body `{"doc":…,"runtime":…}` exactly as JSON.stringify writes it, so a
// reader re-serializes the parsed doc and runtime and compares. The same checksum doubles as the
// "has anything changed since the last save" hash. desktop/saveFormat.cjs implements the same
// checks for the desktop main process; tests keep the two in step.
import { parseOffice, stripSecrets } from '../model/schema';
import type { OfficeDoc, RuntimeState } from '../model/types';

export const SAVE_FORMAT = 'agent-office-save';
export const SAVE_FORMAT_VERSION = 1;
/** Runtime events kept in a save (the log is capped so saves stay small). */
export const SAVED_EVENTS = 300;

/** FNV-1a (32-bit) over UTF-16 code units. Fast, synchronous and dependency-free; it detects
 *  truncation and bit rot, which is all a local save needs (it is not a security measure). */
export function fnv1a32(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

export function checksumOf(body: string): string { return `fnv1a32-${fnv1a32(body)}-${body.length}`; }

/** The checksummed body. Secrets are stripped and the event log is capped. */
export function serializeBody(doc: OfficeDoc, runtime: RuntimeState | null): string {
  const rt = runtime ? { ...runtime, events: (runtime.events ?? []).slice(-SAVED_EVENTS) } : null;
  return JSON.stringify(stripSecrets({ doc, runtime: rt }));
}

/** Wrap a body (from serializeBody) in the envelope without serializing the office twice. */
export function wrapEnvelope(body: string, savedAt: string, checksum = checksumOf(body)): string {
  const head = JSON.stringify({ format: SAVE_FORMAT, version: SAVE_FORMAT_VERSION, savedAt, checksum });
  return `${head.slice(0, -1)},${body.slice(1)}`;
}

export type EnvelopeCheck =
  | { ok: true; legacy: boolean; savedAt: string | null; checksum: string | null; doc: unknown; runtime: unknown }
  | { ok: false; reason: string };

/** Structural check: valid JSON, a known envelope with a matching checksum, or a legacy
 *  (pre-envelope) save that at least has a `doc` object. Does not validate the office schema. */
export function checkEnvelope(text: string | null): EnvelopeCheck {
  if (text == null || text === '') return { ok: false, reason: 'The save is empty.' };
  let data: unknown;
  try { data = JSON.parse(text); } catch { return { ok: false, reason: 'The save is not valid JSON (it may have been cut off while writing).' }; }
  if (!data || typeof data !== 'object' || Array.isArray(data)) return { ok: false, reason: 'The save is not an office save.' };
  const d = data as Record<string, unknown>;
  if (d.format === undefined) {
    // legacy: {doc, runtime, savedAt} written before the envelope existed
    if (!d.doc || typeof d.doc !== 'object') return { ok: false, reason: 'The save has no office in it.' };
    return { ok: true, legacy: true, savedAt: typeof d.savedAt === 'string' ? d.savedAt : null, checksum: null, doc: d.doc, runtime: d.runtime ?? null };
  }
  if (d.format !== SAVE_FORMAT) return { ok: false, reason: `Unknown save format “${String(d.format)}”.` };
  if (typeof d.version !== 'number' || d.version > SAVE_FORMAT_VERSION) return { ok: false, reason: `The save uses format version ${String(d.version)}; this app reads up to ${SAVE_FORMAT_VERSION}.` };
  if (typeof d.checksum !== 'string') return { ok: false, reason: 'The save has no checksum.' };
  const body = JSON.stringify({ doc: d.doc, runtime: d.runtime });
  if (checksumOf(body) !== d.checksum) return { ok: false, reason: 'The save failed its checksum (the data is damaged or incomplete).' };
  return { ok: true, legacy: false, savedAt: typeof d.savedAt === 'string' ? d.savedAt : null, checksum: d.checksum, doc: d.doc, runtime: d.runtime ?? null };
}

export type InspectedSave =
  | { ok: true; legacy: boolean; savedAt: string; checksum: string | null; doc: OfficeDoc; runtime: Partial<RuntimeState> | null; warnings: string[] }
  | { ok: false; reason: string };

/** Full check: envelope plus the office schema (with migrations). */
export function inspectSave(text: string | null): InspectedSave {
  const env = checkEnvelope(text);
  if (!env.ok) return env;
  const r = parseOffice(env.doc);
  if (!r.ok) return { ok: false, reason: `The saved office failed validation: ${r.errors.slice(0, 3).join('; ')}` };
  const runtime = env.runtime && typeof env.runtime === 'object' ? (env.runtime as Partial<RuntimeState>) : null;
  return { ok: true, legacy: env.legacy, savedAt: env.savedAt ?? new Date(0).toISOString(), checksum: env.checksum, doc: r.doc, runtime, warnings: r.warnings };
}
