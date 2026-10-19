// Saving: change detection, atomic rotation, damaged-save recovery, legacy saves, and the
// desktop file store. Runs under Node with an in-memory Storage (and a temp folder for desktop).
import { afterAll, beforeEach, describe, expect, test, vi } from 'vitest';
import { createRequire } from 'node:module';
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LocalStorageRepository, SaveError } from '../src/persistence/repository';
import { STORAGE_KEYS } from '../src/persistence/backends';
import { checkEnvelope, checksumOf, inspectSave, serializeBody, wrapEnvelope } from '../src/persistence/saveFormat';
import { sampleOffice } from '../src/model/sample';
import { emptyRuntime } from '../src/engine/simulation';
import type { OfficeDoc, RuntimeState } from '../src/model/types';

/** In-memory Storage that records every call and can be told to misbehave. */
class FakeStorage {
  m = new Map<string, string>();
  log: string[] = [];
  /** Return a replacement for what gets stored (to simulate a torn/corrupted write), or throw. */
  onSet: ((k: string, v: string) => string) | null = null;
  getItem(k: string) { this.log.push(`get ${k}`); return this.m.has(k) ? this.m.get(k)! : null; }
  setItem(k: string, v: string) { this.log.push(`set ${k}`); this.m.set(k, this.onSet ? this.onSet(k, String(v)) : String(v)); }
  removeItem(k: string) { this.log.push(`remove ${k}`); this.m.delete(k); }
  clear() { this.m.clear(); }
  key(i: number) { return [...this.m.keys()][i] ?? null; }
  get length() { return this.m.size; }
  sets() { return this.log.filter((l) => l.startsWith('set ')).length; }
}
const asStorage = (s: FakeStorage) => s as unknown as Storage;

const rt = (): RuntimeState => emptyRuntime();
const named = (name: string): OfficeDoc => ({ ...sampleOffice(), name });

let store: FakeStorage;
let repo: LocalStorageRepository;
beforeEach(() => { store = new FakeStorage(); repo = new LocalStorageRepository(asStorage(store)); });

describe('save envelope', () => {
  test('wraps the body with a checksum that verifies, and detects any change', () => {
    const body = serializeBody(sampleOffice(), rt());
    const text = wrapEnvelope(body, '2026-10-19T14:02:00.000Z');
    const env = JSON.parse(text);
    expect(env).toMatchObject({ format: 'agent-office-save', version: 1, savedAt: '2026-10-19T14:02:00.000Z', checksum: checksumOf(body) });
    expect(env.doc.name).toBe(sampleOffice().name);
    expect(checkEnvelope(text).ok).toBe(true);
    expect(checkEnvelope(text.replace(sampleOffice().name, 'TAMPERED')).ok).toBe(false);
    expect(checkEnvelope(text.slice(0, -20)).ok).toBe(false);
  });

  test('the desktop main process computes the same checksum and verdicts', () => {
    const require = createRequire(import.meta.url);
    const cjs = require('../desktop/saveFormat.cjs') as { checksumOf(b: string): string; checkEnvelope(t: string): { ok: boolean } };
    const body = serializeBody(named('Ünïcødé ✓ office'), rt());
    expect(cjs.checksumOf(body)).toBe(checksumOf(body));
    const text = wrapEnvelope(body, new Date().toISOString());
    expect(cjs.checkEnvelope(text).ok).toBe(true);
    expect(cjs.checkEnvelope(text.replace('Ünïcødé', 'Unicode')).ok).toBe(false);
  });
});

describe('browser repository', () => {
  test('unchanged content skips the write entirely', () => {
    const doc = sampleOffice(), runtime = rt();
    expect(repo.saveCurrent(doc, runtime).status).toBe('saved');
    const writes = store.sets();
    const again = repo.saveCurrent(structuredClone(doc), structuredClone(runtime));
    expect(again.status).toBe('unchanged');
    expect(store.sets()).toBe(writes);
    expect(repo.saveCurrent(named('Changed'), rt()).status).toBe('saved');
    expect(store.sets()).toBeGreaterThan(writes);
  });

  test('a save rotates the previous current into backup, only after the new save verified', () => {
    repo.saveCurrent(named('A'), rt());
    const a = store.m.get(STORAGE_KEYS.current)!;
    expect(store.m.has(STORAGE_KEYS.backup)).toBe(false);
    store.log = [];
    repo.saveCurrent(named('B'), rt());
    const b = store.m.get(STORAGE_KEYS.current)!;
    expect(JSON.parse(b).doc.name).toBe('B');
    expect(store.m.get(STORAGE_KEYS.backup)).toBe(a);
    expect(store.m.has(STORAGE_KEYS.pending)).toBe(false);
    // order: pending written → pending read back → backup → current → pending removed
    const i = (l: string) => store.log.indexOf(l);
    expect(i(`set ${STORAGE_KEYS.pending}`)).toBeGreaterThanOrEqual(0);
    expect(i(`get ${STORAGE_KEYS.pending}`)).toBeGreaterThan(i(`set ${STORAGE_KEYS.pending}`));
    expect(i(`set ${STORAGE_KEYS.backup}`)).toBeGreaterThan(i(`get ${STORAGE_KEYS.pending}`));
    expect(i(`set ${STORAGE_KEYS.current}`)).toBeGreaterThan(i(`set ${STORAGE_KEYS.backup}`));
    expect(i(`remove ${STORAGE_KEYS.pending}`)).toBeGreaterThan(i(`set ${STORAGE_KEYS.current}`));
  });

  test('a write that fails to verify keeps the previous current and backup intact', () => {
    repo.saveCurrent(named('A'), rt());
    repo.saveCurrent(named('B'), rt());
    const before = { current: store.m.get(STORAGE_KEYS.current), backup: store.m.get(STORAGE_KEYS.backup) };
    store.onSet = (k, v) => (k === STORAGE_KEYS.pending ? v.slice(0, v.length / 2) : v); // torn write
    expect(() => repo.saveCurrent(named('C'), rt())).toThrow(SaveError);
    expect(store.m.get(STORAGE_KEYS.current)).toBe(before.current);
    expect(store.m.get(STORAGE_KEYS.backup)).toBe(before.backup);
    expect(store.m.has(STORAGE_KEYS.pending)).toBe(false);
    // storage full while rotating the backup: current is still untouched
    store.onSet = (k, v) => { if (k === STORAGE_KEYS.backup) throw new Error('QuotaExceededError'); return v; };
    expect(() => repo.saveCurrent(named('D'), rt())).toThrow(/full or unavailable/);
    expect(store.m.get(STORAGE_KEYS.current)).toBe(before.current);
    expect(store.m.get(STORAGE_KEYS.backup)).toBe(before.backup);
    // and a later good save goes through (the failed attempts did not count as saved)
    store.onSet = null;
    expect(repo.saveCurrent(named('C'), rt()).status).toBe('saved');
    expect(store.m.get(STORAGE_KEYS.backup)).toBe(before.current);
  });

  test.each([
    ['bad JSON', (t: string) => t.slice(0, t.length - 40)],
    ['checksum mismatch', (t: string) => t.replace('"name":"B"', '"name":"X"')],
    ['schema failure', (t: string) => { const e = JSON.parse(t); e.doc = { rooms: 'nope' }; e.checksum = checksumOf(JSON.stringify({ doc: e.doc, runtime: e.runtime })); return JSON.stringify(e); }],
  ])('a damaged current (%s) is reported with the valid backup, a damaged copy is kept, and nothing is overwritten', (_label, damage) => {
    repo.saveCurrent(named('A'), rt());
    repo.saveCurrent(named('B'), rt());
    const backup = store.m.get(STORAGE_KEYS.backup)!;
    const broken = damage(store.m.get(STORAGE_KEYS.current)!);
    store.m.set(STORAGE_KEYS.current, broken);

    const fresh = new LocalStorageRepository(asStorage(store));
    const r = fresh.load();
    expect(r.status).toBe('corrupt');
    if (r.status !== 'corrupt') return;
    expect(r.raw).toBe(broken);
    expect(r.backup?.doc.name).toBe('A');
    expect(r.backup?.savedAt).toBe(JSON.parse(backup).savedAt);
    expect(r.damagedName).toMatch(/^damaged-/);
    expect(store.m.get(`agent-office:${r.damagedName}`)).toBe(broken);
    expect(fresh.loadCurrent()).toBeNull();

    // saving is refused until the user chooses
    expect(fresh.savingSuspended).toBe(true);
    expect(() => fresh.saveCurrent(named('placeholder'), rt())).toThrow(/paused/);
    expect(store.m.get(STORAGE_KEYS.current)).toBe(broken);
    expect(store.m.get(STORAGE_KEYS.backup)).toBe(backup);

    // after restoring, the damaged current never replaces the good backup
    fresh.resumeSaving();
    fresh.saveCurrent(r.backup!.doc, rt());
    expect(JSON.parse(store.m.get(STORAGE_KEYS.current)!).doc.name).toBe('A');
    expect(store.m.get(STORAGE_KEYS.backup)).toBe(backup);
  });

  test('loading the same damaged save twice keeps one copy, and old copies are capped', () => {
    store.m.set(STORAGE_KEYS.current, '{"format":"agent-office-save"');
    new LocalStorageRepository(asStorage(store)).load();
    new LocalStorageRepository(asStorage(store)).load();
    const damaged = () => [...store.m.keys()].filter((k) => k.startsWith(STORAGE_KEYS.damagedPrefix));
    expect(damaged()).toHaveLength(1);
    for (let i = 0; i < 5; i++) {
      store.m.set(`${STORAGE_KEYS.damagedPrefix}2000-01-0${i}`, `old ${i}`);
      store.m.set(STORAGE_KEYS.current, `broken ${i}`);
      new LocalStorageRepository(asStorage(store)).load();
    }
    expect(damaged().length).toBeLessThanOrEqual(3);
    expect(store.m.get(damaged().sort().at(-1)!)).toBe('broken 4');
  });

  test('a missing current with a backup still offers the backup', () => {
    repo.saveCurrent(named('A'), rt());
    repo.saveCurrent(named('B'), rt());
    store.m.delete(STORAGE_KEYS.current);
    const r = new LocalStorageRepository(asStorage(store)).load();
    expect(r.status).toBe('corrupt');
    if (r.status === 'corrupt') { expect(r.raw).toBeNull(); expect(r.backup?.doc.name).toBe('A'); }
  });

  test('an empty store loads as empty', () => {
    expect(repo.load()).toEqual({ status: 'empty' });
  });

  test('a legacy (pre-envelope) save loads and is migrated into the envelope on the next save', () => {
    const doc = named('Legacy HQ');
    const legacy = JSON.stringify({ doc, runtime: { tasks: {} }, savedAt: '2026-01-02T03:04:05.000Z' });
    store.m.set(STORAGE_KEYS.current, legacy);
    const r = repo.load();
    expect(r.status).toBe('ok');
    if (r.status !== 'ok') return;
    expect(r.legacy).toBe(true);
    expect(r.doc.name).toBe('Legacy HQ');
    expect(r.savedAt).toBe('2026-01-02T03:04:05.000Z');
    expect(repo.saveCurrent(r.doc, rt()).status).toBe('saved');
    const now = store.m.get(STORAGE_KEYS.current)!;
    expect(JSON.parse(now).format).toBe('agent-office-save');
    expect(inspectSave(now).ok).toBe(true);
    expect(store.m.get(STORAGE_KEYS.backup)).toBe(legacy); // the legacy save is the backup now
  });

  test('saves never contain secrets', () => {
    const doc = { ...sampleOffice(), apiKey: 'sk-ant-should-not-persist' } as OfficeDoc;
    repo.saveCurrent(doc, rt());
    expect(store.m.get(STORAGE_KEYS.current)).not.toMatch(/sk-ant-/);
  });
});

describe('store recovery flow', () => {
  test('a damaged save opens recovery, suspends saving, and restoring the backup keeps everything', async () => {
    const mem = new FakeStorage();
    const seed = new LocalStorageRepository(asStorage(mem));
    seed.saveCurrent(named('Backup HQ'), rt());
    seed.saveCurrent(named('Current HQ'), rt());
    const backup = mem.m.get(STORAGE_KEYS.backup)!;
    mem.m.set(STORAGE_KEYS.current, '{"format":"agent-office-save","version":1,"doc":{');
    const g = globalThis as unknown as { localStorage?: Storage };
    const prev = g.localStorage;
    g.localStorage = asStorage(mem);
    try {
      vi.resetModules();
      const { useStore } = await import('../src/store/store');
      const s = useStore.getState();
      expect(s.recovery?.backup?.doc.name).toBe('Backup HQ');
      expect(s.save()).toBeNull();
      expect(mem.m.get(STORAGE_KEYS.current)).toBe('{"format":"agent-office-save","version":1,"doc":{');
      s.resolveRecovery('backup');
      const after = useStore.getState();
      expect(after.recovery).toBeNull();
      expect(after.doc.name).toBe('Backup HQ');
      expect(after.dirty).toBe(false);
      expect(JSON.parse(mem.m.get(STORAGE_KEYS.current)!).doc.name).toBe('Backup HQ');
      expect(mem.m.get(STORAGE_KEYS.backup)).toBe(backup);
      expect([...mem.m.keys()].some((k) => k.startsWith(STORAGE_KEYS.damagedPrefix))).toBe(true);
    } finally {
      g.localStorage = prev;
      vi.resetModules();
    }
  });
});

describe('desktop file store', () => {
  const require = createRequire(import.meta.url);
  const { createSaveStore } = require('../desktop/saveStore.cjs') as { createSaveStore(dir: string): {
    read(): string | null; readBackup(): string | null; write(t: string, o?: { rotateBackup?: boolean }): { ok: boolean; error?: string };
    keepDamaged(t: string): { ok: boolean; name?: string }; info(): { damaged: string[] }; paths: { current: string; backup: string; temp: string };
  } };
  const dirs: string[] = [];
  const tmp = () => { const d = mkdtempSync(join(tmpdir(), 'ncc-saves-')); dirs.push(d); return d; };
  afterAll(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });
  const env = (name: string) => wrapEnvelope(serializeBody(named(name), rt()), new Date().toISOString());

  test('writes atomically, rotates the previous good save to backup, and leaves no temp file', () => {
    const dir = tmp();
    const fsStore = createSaveStore(join(dir, 'saves'));
    const a = env('A'), b = env('B');
    expect(fsStore.write(a).ok).toBe(true);
    expect(fsStore.read()).toBe(a);
    expect(fsStore.readBackup()).toBeNull();
    expect(fsStore.write(b).ok).toBe(true);
    expect(fsStore.read()).toBe(b);
    expect(fsStore.readBackup()).toBe(a);
    expect(readdirSync(join(dir, 'saves')).sort()).toEqual(['backup.json', 'current.json']);
  });

  test('refuses invalid saves, and a damaged current never replaces the backup', () => {
    const fsStore = createSaveStore(join(tmp(), 'saves'));
    const a = env('A');
    fsStore.write(a); fsStore.write(env('B'));
    expect(fsStore.write('{"not":"an envelope"').ok).toBe(false);
    expect(fsStore.write(env('C').replace('"name":"C"', '"name":"Z"')).ok).toBe(false);
    expect(fsStore.readBackup()).toBe(a);
    writeFileSync(fsStore.paths.current, '{"truncated');
    expect(fsStore.write(env('D')).ok).toBe(true);
    expect(fsStore.readBackup()).toBe(a);
    expect(fsStore.info().damaged).toHaveLength(1);
    const kept = fsStore.keepDamaged('{"truncated');
    expect(kept.ok).toBe(true);
    expect(fsStore.info().damaged).toEqual([kept.name]);
    expect(readFileSync(join(fsStore.paths.current, '..', kept.name!), 'utf8')).toBe('{"truncated');
    // the renderer can say the current save is damaged even when its checksum is fine (schema
    // failure): the backup stays, and the flagged save is kept as a damaged copy instead
    const flagged = fsStore.read();
    expect(fsStore.write(env('E'), { rotateBackup: false }).ok).toBe(true);
    expect(fsStore.readBackup()).toBe(a);
    expect(fsStore.info().damaged.some((f) => readFileSync(join(fsStore.paths.current, '..', f), 'utf8') === flagged)).toBe(true);
  });

  test('a leftover temp file from an interrupted write is discarded and the current save survives', () => {
    const dir = join(tmp(), 'saves');
    const first = createSaveStore(dir);
    const a = env('A');
    first.write(a);
    writeFileSync(first.paths.temp, env('half'));
    const again = createSaveStore(dir);
    expect(again.read()).toBe(a);
    expect(readdirSync(dir)).not.toContain('current.json.tmp');
  });
});
