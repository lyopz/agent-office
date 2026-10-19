// Where saves physically live. Both backends are synchronous so the office can load before the
// first render and a final save can finish while the page is closing.
//
// Atomic commit, in both backends:
//   1. write the new envelope somewhere other than `current` (a pending key / a temp file)
//   2. read it back and verify it byte-for-byte and by checksum; on failure stop, nothing else changed
//   3. only now copy the previous `current` into `backup`, and only if that previous save is valid
//      (a damaged current never replaces a good backup)
//   4. replace `current` with the new envelope, then drop the pending copy
import { checkEnvelope } from './saveFormat';
import { getDesktopBridge, type OfficeDesktopBridge } from './desktopBridge';

export type SaveSlot = 'current' | 'backup';

export class SaveError extends Error {}

export interface CommitOptions { rotateBackup?: boolean }

export interface SaveBackend {
  readonly kind: 'browser' | 'desktop';
  /** Human-readable place the saves live ("this browser", a folder path). */
  readonly location: string;
  read(slot: SaveSlot): string | null;
  /** Atomically make `text` the current save (see above). Throws SaveError; on failure the
   *  previous current and backup are untouched. `rotateBackup: false` leaves the backup alone
   *  (used when the current save is known to be damaged, even if its checksum is fine). */
  commit(text: string, opts?: CommitOptions): void;
  /** Keep a copy of damaged save data; returns the name it was kept under. Throws on failure. */
  keepDamaged(text: string): string;
}

export const STORAGE_KEYS = {
  current: 'agent-office:current',
  pending: 'agent-office:pending',
  backup: 'agent-office:backup',
  damagedPrefix: 'agent-office:damaged-',
} as const;

/** How many damaged copies the browser keeps (oldest dropped first; storage is small). */
export const MAX_DAMAGED_BROWSER = 3;

export const stamp = (d = new Date()) => d.toISOString().replace(/[:.]/g, '-');

/** localStorage, or null when it is missing or blocked (private mode, sandboxed frames, node). */
export function browserStorage(): Storage | null {
  try { const s = globalThis.localStorage; return s ?? null; } catch { return null; }
}

export class LocalStorageBackend implements SaveBackend {
  readonly kind = 'browser' as const;
  readonly location = 'this browser';
  constructor(private readonly storage: Storage | null) {
    // a pending key left by an interrupted save is never needed: current is valid at every step
    try { storage?.removeItem(STORAGE_KEYS.pending); } catch { /* ignore */ }
  }

  private need(): Storage {
    if (!this.storage) throw new SaveError('Browser storage is unavailable, so the office cannot be saved here.');
    return this.storage;
  }

  read(slot: SaveSlot): string | null {
    try { return this.storage?.getItem(STORAGE_KEYS[slot]) ?? null; } catch { return null; }
  }

  commit(text: string, { rotateBackup = true }: CommitOptions = {}): void {
    const st = this.need();
    const drop = () => { try { st.removeItem(STORAGE_KEYS.pending); } catch { /* ignore */ } };
    const put = (k: string, v: string, what: string) => {
      try { st.setItem(k, v); } catch { drop(); throw new SaveError(`Browser storage is full or unavailable (while writing the ${what}). Your previous save is unchanged.`); }
    };
    // 1–2: pending copy, verified
    put(STORAGE_KEYS.pending, text, 'new save');
    const back = st.getItem(STORAGE_KEYS.pending);
    if (back !== text || !checkEnvelope(back).ok) { drop(); throw new SaveError('The new save did not verify after writing. Your previous save is unchanged.'); }
    // 3: rotate the previous valid current into backup
    const prev = st.getItem(STORAGE_KEYS.current);
    if (rotateBackup && prev !== null && prev !== text && checkEnvelope(prev).ok) put(STORAGE_KEYS.backup, prev, 'backup');
    // 4: promote
    put(STORAGE_KEYS.current, text, 'save');
    if (st.getItem(STORAGE_KEYS.current) !== text) {
      // extremely unlikely (storage returned something else); put the old save back
      if (prev !== null) { try { st.setItem(STORAGE_KEYS.current, prev); } catch { /* backup still holds it */ } }
      drop();
      throw new SaveError('The save did not read back correctly. Your previous save was kept.');
    }
    drop();
  }

  keepDamaged(text: string): string {
    const st = this.need();
    const keys: string[] = [];
    for (let i = 0; i < st.length; i++) { const k = st.key(i); if (k?.startsWith(STORAGE_KEYS.damagedPrefix)) keys.push(k); }
    keys.sort();
    const same = keys.find((k) => st.getItem(k) === text);
    if (same) return same.slice('agent-office:'.length);
    const key = `${STORAGE_KEYS.damagedPrefix}${stamp()}`;
    // make room: drop the oldest copies beyond the cap
    for (const k of keys.slice(0, Math.max(0, keys.length - (MAX_DAMAGED_BROWSER - 1)))) st.removeItem(k);
    try { st.setItem(key, text); } catch { throw new SaveError('There is not enough browser storage to keep a copy of the damaged save. Download it before choosing anything else.'); }
    return key.slice('agent-office:'.length);
  }
}

/** Files on disk through the desktop app's preload bridge. The main process does the atomic
 *  write (temp file, fsync, verify, backup, rename); paths are fixed there. */
export class DesktopFileBackend implements SaveBackend {
  readonly kind = 'desktop' as const;
  readonly location: string;
  constructor(private readonly bridge: OfficeDesktopBridge) {
    let dir = 'the app’s data folder';
    try { dir = bridge.saves.info().dir || dir; } catch { /* keep the generic name */ }
    this.location = dir;
  }
  read(slot: SaveSlot): string | null {
    const v = slot === 'current' ? this.bridge.saves.read() : this.bridge.saves.readBackup();
    return typeof v === 'string' ? v : null;
  }
  commit(text: string, { rotateBackup = true }: CommitOptions = {}): void {
    const r = this.bridge.saves.write(text, { rotateBackup });
    if (!r || !r.ok) throw new SaveError(r?.error ?? 'The desktop app could not write the save.');
  }
  keepDamaged(text: string): string {
    const r = this.bridge.saves.keepDamaged(text);
    if (!r || !r.ok || !r.name) throw new SaveError(r?.error ?? 'The desktop app could not keep a copy of the damaged save.');
    return r.name;
  }
}

export function defaultBackend(): SaveBackend {
  const bridge = getDesktopBridge();
  return bridge ? new DesktopFileBackend(bridge) : new LocalStorageBackend(browserStorage());
}
