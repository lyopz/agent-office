// Persistence behind an interface so a backend (REST/DB) can replace the
// browser implementation without touching the rest of the app.
import { parseOffice, stripSecrets } from '../model/schema';
import type { OfficeDoc, RuntimeState } from '../model/types';

export interface SavedVersion { id: string; officeId: string; name: string; savedAt: string; doc: OfficeDoc }
export interface Preferences { autosave: boolean; viewMode: string; showDashboard: boolean; aiProvider: string; autoApplySafe: boolean; simSpeed: number; simRunning: boolean; demoTasks: boolean }

export interface OfficeRepository {
  loadCurrent(): { doc: OfficeDoc; runtime: Partial<RuntimeState> | null; savedAt: string } | null;
  saveCurrent(doc: OfficeDoc, runtime: RuntimeState): string;
  listVersions(officeId?: string): Omit<SavedVersion, 'doc'>[];
  saveVersion(name: string, doc: OfficeDoc): SavedVersion;
  loadVersion(id: string): OfficeDoc | null;
  deleteVersion(id: string): void;
  loadPrefs(): Partial<Preferences>;
  savePrefs(p: Partial<Preferences>): void;
}

const K = { current: 'agent-office:current', versions: 'agent-office:versions', prefs: 'agent-office:prefs' };

function safeGet(k: string): string | null { try { return localStorage.getItem(k); } catch { return null; } }
function safeSet(k: string, v: string): boolean { try { localStorage.setItem(k, v); return true; } catch { return false; } }

export class LocalStorageRepository implements OfficeRepository {
  loadCurrent() {
    const raw = safeGet(K.current);
    if (!raw) return null;
    try {
      const data = JSON.parse(raw);
      const r = parseOffice(data.doc);
      if (!r.ok) { console.warn('Saved office failed validation', r.errors); return null; }
      return { doc: r.doc, runtime: data.runtime ?? null, savedAt: data.savedAt };
    } catch { return null; }
  }
  saveCurrent(doc: OfficeDoc, runtime: RuntimeState) {
    const savedAt = new Date().toISOString();
    const rt = { ...runtime, events: runtime.events.slice(-300) };
    if (!safeSet(K.current, JSON.stringify(stripSecrets({ doc, runtime: rt, savedAt })))) throw new Error('Browser storage is full or unavailable');
    return savedAt;
  }
  private versions(): SavedVersion[] {
    try { return JSON.parse(safeGet(K.versions) ?? '[]'); } catch { return []; }
  }
  listVersions(officeId?: string) {
    return this.versions().filter((v) => !officeId || v.officeId === officeId).map(({ doc: _d, ...rest }) => rest);
  }
  saveVersion(name: string, doc: OfficeDoc) {
    const v: SavedVersion = { id: `ver_${Date.now().toString(36)}`, officeId: doc.id, name, savedAt: new Date().toISOString(), doc: stripSecrets(doc) };
    const all = [...this.versions(), v].slice(-30);
    if (!safeSet(K.versions, JSON.stringify(all))) throw new Error('Browser storage is full or unavailable');
    return v;
  }
  loadVersion(id: string) {
    const v = this.versions().find((x) => x.id === id);
    if (!v) return null;
    const r = parseOffice(v.doc);
    return r.ok ? r.doc : null;
  }
  deleteVersion(id: string) { safeSet(K.versions, JSON.stringify(this.versions().filter((v) => v.id !== id))); }
  loadPrefs() { try { return JSON.parse(safeGet(K.prefs) ?? '{}'); } catch { return {}; } }
  savePrefs(p: Partial<Preferences>) { safeSet(K.prefs, JSON.stringify({ ...this.loadPrefs(), ...p })); }
}


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
