// The brain library: every brain the owner is not looking at right now, kept whole (agents, skills,
// runtime) in browser storage next to the saved versions. The open brain stays in the ordinary
// current save, so recovery and autosave do not change. Switching brains moves the open one into
// the library and takes the chosen one out of it.
import type { OfficeDoc, RuntimeState } from '../model/types';
import { browserStorage } from './backends';

export const BRAINS_KEY = 'agent-office:brains';

export interface StoredBrain { id: string; name: string; savedAt: string; doc: OfficeDoc; runtime: Partial<RuntimeState> | null }
/** What the universe shows for a brain without loading its whole document. */
export interface BrainSummary {
  id: string; name: string; savedAt: string; agents: number; skillIds: string[]; skillNames: string[]; open: boolean; color: string | null;
  /** JARVIS's head brain, always drawn in the middle. */
  head: boolean;
  /** What the brain is for, and who runs it ('jarvis' until the owner hooks up one of its agents). */
  purpose: string; lead: string;
}

type Library = Record<string, StoredBrain>;

function readAll(storage: Storage | null = browserStorage()): Library {
  try {
    const raw = storage?.getItem(BRAINS_KEY);
    const v = raw ? JSON.parse(raw) : {};
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Library) : {};
  } catch { return {}; }
}
function writeAll(lib: Library, storage: Storage | null = browserStorage()) {
  if (!storage) throw new Error('Browser storage is unavailable, so other brains cannot be kept here.');
  storage.setItem(BRAINS_KEY, JSON.stringify(lib));
}

/** The hologram colour the owner picked for a whole brain (brain.setColor on 'main'), or null for the universe's own palette. */
const mainColor = (doc: OfficeDoc) => { const c = doc.appearance?.brainColors?.main; return c && /^#[0-9a-f]{6}$/i.test(c) ? c : null; };
export const summarize = (doc: OfficeDoc, savedAt: string, open: boolean): BrainSummary => ({
  id: doc.id, name: doc.name, savedAt, open, color: mainColor(doc), agents: Object.keys(doc.agents).length,
  head: !!doc.head, purpose: doc.plan?.purpose ?? (doc.head ? 'JARVIS\'s head brain: builds and oversees every other brain.' : ''), lead: doc.plan?.lead ?? 'jarvis',
  skillIds: (doc.skillBank ?? []).map((k) => k.id), skillNames: (doc.skillBank ?? []).map((k) => k.name),
});

/** The brains in the library (not the open one), newest first. */
export function listBrains(storage?: Storage | null): BrainSummary[] {
  return Object.values(readAll(storage)).sort((a, b) => b.savedAt.localeCompare(a.savedAt)).map((b) => summarize(b.doc, b.savedAt, false));
}
/** The library's skill banks, for sharing skills with the open brain. */
export function librarySkillBanks(storage?: Storage | null): { brainId: string; brainName: string; skills: OfficeDoc['skillBank'] }[] {
  return Object.values(readAll(storage)).map((b) => ({ brainId: b.id, brainName: b.name, skills: b.doc.skillBank ?? [] }));
}
/** The library's brains in full, for JARVIS's runner (it works the tasks of every brain). */
export function libraryDocs(storage?: Storage | null): OfficeDoc[] {
  return Object.values(readAll(storage)).map((b) => b.doc);
}
/** One library brain in full, or null. */
export function peekBrain(id: string, storage?: Storage | null): StoredBrain | null {
  return readAll(storage)[id] ?? null;
}
export function putBrain(doc: OfficeDoc, runtime: Partial<RuntimeState> | null, storage?: Storage | null) {
  const lib = readAll(storage);
  lib[doc.id] = { id: doc.id, name: doc.name, savedAt: new Date().toISOString(), doc, runtime };
  writeAll(lib, storage);
}
/** Take a brain out of the library to open it; null when it is not there. */
export function takeBrain(id: string, storage?: Storage | null): StoredBrain | null {
  const lib = readAll(storage);
  const b = lib[id] ?? null;
  if (b) { delete lib[id]; writeAll(lib, storage); }
  return b;
}
export function removeBrain(id: string, storage?: Storage | null) {
  const lib = readAll(storage);
  if (!lib[id]) return false;
  delete lib[id]; writeAll(lib, storage);
  return true;
}
