// Persistence behind an interface so a backend (REST/DB) can replace the
// browser implementation without touching the rest of the app.
//
// The current office is written as a checksummed envelope (saveFormat.ts) through a SaveBackend
// (backends.ts): localStorage in the browser, files on disk in the desktop app. Saving is atomic,
// keeps the previous good save as a backup, and skips the write when nothing changed. Loading
// never silently discards a damaged save: it reports it, keeps a copy, and blocks saving until
// the user chooses how to recover.
import { parseOffice, stripSecrets } from '../model/schema';
import type { OfficeDoc, RuntimeState } from '../model/types';
import { browserStorage, defaultBackend, DesktopFileBackend, LocalStorageBackend, SaveError, type SaveBackend } from './backends';
import { checksumOf, inspectSave, serializeBody, wrapEnvelope } from './saveFormat';
import type { OfficeDesktopBridge } from './desktopBridge';

export { SaveError } from './backends';

export interface SavedVersion { id: string; officeId: string; name: string; savedAt: string; doc: OfficeDoc }
export interface Preferences { autosave: boolean; showDashboard: boolean; simSpeed: number; simRunning: boolean; liveMode?: boolean }

export interface LoadedSave { doc: OfficeDoc; runtime: Partial<RuntimeState> | null; savedAt: string }

export type LoadResult =
  | { status: 'empty' }
  | ({ status: 'ok'; legacy: boolean; warnings: string[] } & LoadedSave)
  | {
      status: 'corrupt';
      /** Why the current save could not be used. */
      reason: string;
      /** The damaged text exactly as stored (null when the current save is missing). */
      raw: string | null;
      /** Where a copy of the damaged text was kept (null if it could not be kept or there was nothing to keep). */
      damagedName: string | null;
      damagedError: string | null;
      /** The backup, when it is valid. */
      backup: LoadedSave | null;
      /** Why the backup is not usable (null when it is fine or absent). */
      backupProblem: string | null;
    };

export interface SaveResult {
  /** 'unchanged': the content matched the last successful save, so nothing was written. */
  status: 'saved' | 'unchanged';
  savedAt: string;
  checksum: string;
  bytes: number;
}

export interface OfficeRepository {
  readonly backendKind: 'browser' | 'desktop';
  readonly location: string;
  /** Read the current save, reporting damage instead of hiding it. */
  load(): LoadResult;
  /** The current save when it is valid, else null (kept for callers that only need the happy path). */
  loadCurrent(): LoadedSave | null;
  saveCurrent(doc: OfficeDoc, runtime: RuntimeState, opts?: { force?: boolean }): SaveResult;
  /** True after a damaged load until resumeSaving() is called: saveCurrent refuses to write. */
  readonly savingSuspended: boolean;
  resumeSaving(): void;
  listVersions(officeId?: string): Omit<SavedVersion, 'doc'>[];
  saveVersion(name: string, doc: OfficeDoc): SavedVersion;
  loadVersion(id: string): OfficeDoc | null;
  deleteVersion(id: string): void;
  loadPrefs(): Partial<Preferences>;
  savePrefs(p: Partial<Preferences>): void;
}

const K = { versions: 'agent-office:versions', prefs: 'agent-office:prefs' };

export class SaveRepository implements OfficeRepository {
  private lastChecksum: string | null = null;
  private lastSavedAt: string | null = null;
  private suspended = false;
  /** Whether the stored current save is known good (so it may become the backup). */
  private currentTrusted = true;

  constructor(readonly backend: SaveBackend, private readonly storage: Storage | null = browserStorage()) {}

  get backendKind() { return this.backend.kind; }
  get location() { return this.backend.location; }
  get savingSuspended() { return this.suspended; }

  load(): LoadResult {
    const raw = this.backend.read('current');
    if (raw !== null) {
      const cur = inspectSave(raw);
      if (cur.ok) {
        // a legacy save has no checksum, so the next save always writes (migrating it into the envelope)
        this.lastChecksum = cur.checksum; this.lastSavedAt = cur.savedAt; this.currentTrusted = true;
        return { status: 'ok', legacy: cur.legacy, warnings: cur.warnings, doc: cur.doc, runtime: cur.runtime, savedAt: cur.savedAt };
      }
      return this.corrupt(cur.reason, raw);
    }
    const b = this.backend.read('backup');
    if (b === null) return { status: 'empty' };
    return this.corrupt('The current save is missing, but a backup exists.', null);
  }

  private corrupt(reason: string, raw: string | null): LoadResult {
    this.suspended = true;
    this.currentTrusted = false;
    let damagedName: string | null = null, damagedError: string | null = null;
    if (raw !== null && raw !== '') {
      try { damagedName = this.backend.keepDamaged(raw); } catch (e) { damagedError = (e as Error).message; }
    }
    const backupRaw = this.backend.read('backup');
    const b = inspectSave(backupRaw);
    return {
      status: 'corrupt', reason, raw, damagedName, damagedError,
      backup: b.ok ? { doc: b.doc, runtime: b.runtime, savedAt: b.savedAt } : null,
      backupProblem: b.ok ? null : backupRaw === null ? null : b.reason,
    };
  }

  loadCurrent(): LoadedSave | null {
    const r = inspectSave(this.backend.read('current'));
    return r.ok ? { doc: r.doc, runtime: r.runtime, savedAt: r.savedAt } : null;
  }

  saveCurrent(doc: OfficeDoc, runtime: RuntimeState, opts: { force?: boolean } = {}): SaveResult {
    if (this.suspended) throw new SaveError('Saving is paused until you choose how to recover the damaged save.');
    const body = serializeBody(doc, runtime);
    const checksum = checksumOf(body);
    if (!opts.force && checksum === this.lastChecksum && this.lastSavedAt) return { status: 'unchanged', savedAt: this.lastSavedAt, checksum, bytes: 0 };
    const savedAt = new Date().toISOString();
    const text = wrapEnvelope(body, savedAt, checksum);
    this.backend.commit(text, { rotateBackup: this.currentTrusted });
    this.currentTrusted = true;
    this.lastChecksum = checksum; this.lastSavedAt = savedAt;
    return { status: 'saved', savedAt, checksum, bytes: text.length };
  }

  resumeSaving() { this.suspended = false; this.lastChecksum = null; }

  private get(k: string): string | null { try { return this.storage?.getItem(k) ?? null; } catch { return null; } }
  private set(k: string, v: string): boolean { try { if (!this.storage) return false; this.storage.setItem(k, v); return true; } catch { return false; } }

  private versions(): SavedVersion[] {
    try { return JSON.parse(this.get(K.versions) ?? '[]'); } catch { return []; }
  }
  listVersions(officeId?: string) {
    return this.versions().filter((v) => !officeId || v.officeId === officeId).map(({ doc: _d, ...rest }) => rest);
  }
  saveVersion(name: string, doc: OfficeDoc) {
    const v: SavedVersion = { id: `ver_${Date.now().toString(36)}`, officeId: doc.id, name, savedAt: new Date().toISOString(), doc: stripSecrets(doc) };
    const all = [...this.versions(), v].slice(-30);
    if (!this.set(K.versions, JSON.stringify(all))) throw new Error('Browser storage is full or unavailable');
    return v;
  }
  loadVersion(id: string) {
    const v = this.versions().find((x) => x.id === id);
    if (!v) return null;
    const r = parseOffice(v.doc);
    return r.ok ? r.doc : null;
  }
  deleteVersion(id: string) { this.set(K.versions, JSON.stringify(this.versions().filter((v) => v.id !== id))); }
  loadPrefs() { try { return JSON.parse(this.get(K.prefs) ?? '{}'); } catch { return {}; } }
  savePrefs(p: Partial<Preferences>) { this.set(K.prefs, JSON.stringify({ ...this.loadPrefs(), ...p })); }
}

/** The browser repository: everything in localStorage (or the Storage passed in, for tests). */
export class LocalStorageRepository extends SaveRepository {
  constructor(storage: Storage | null = browserStorage()) { super(new LocalStorageBackend(storage), storage); }
}

/** The desktop repository: the current save and its backup are files on disk (via the preload
 *  bridge); named versions and preferences stay in the app window's own storage. */
export class FileRepository extends SaveRepository {
  constructor(bridge: OfficeDesktopBridge, storage: Storage | null = browserStorage()) { super(new DesktopFileBackend(bridge), storage); }
}

/** Files on disk when running inside the desktop app, otherwise this browser's storage. */
export function createRepository(): SaveRepository { return new SaveRepository(defaultBackend()); }


// ---------- Asset store (character artwork) ----------
// Approved artwork lives in IndexedDB (falls back to memory) and is referenced by id from agent profiles.
const mem = new Map<string, string>();
function idb(): Promise<IDBDatabase | null> {
  return new Promise((res) => {
    try {
      const req = indexedDB.open('agent-office-assets', 1);
      req.onupgradeneeded = () => req.result.createObjectStore('assets');
      req.onsuccess = () => res(req.result);
      req.onerror = () => res(null);
    } catch { res(null); }
  });
}
export const assetStore = {
  async put(id: string, dataUrl: string) {
    mem.set(id, dataUrl);
    const db = await idb(); if (!db) return;
    await new Promise<void>((r) => { const tx = db.transaction('assets', 'readwrite'); tx.objectStore('assets').put(dataUrl, id); tx.oncomplete = () => r(); tx.onerror = () => r(); });
  },
  async get(id: string): Promise<string | null> {
    if (mem.has(id)) return mem.get(id)!;
    const db = await idb(); if (!db) return null;
    return new Promise((r) => { const q = db.transaction('assets').objectStore('assets').get(id); q.onsuccess = () => { if (q.result) mem.set(id, q.result); r(q.result ?? null); }; q.onerror = () => r(null); });
  },
  peek(id: string) { return mem.get(id) ?? null; },
};
