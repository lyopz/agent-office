'use strict';
// Save files for the desktop app. Everything lives in one folder with fixed names; nothing here
// accepts a path from the renderer.
//
//   current.json        the save the app loads
//   backup.json         the previous good save
//   current.json.tmp    a new save while it is being written and verified
//   damaged-<time>.json copies of saves that failed to load
//
// write(): temp file → fsync → read back + verify → copy the previous valid current to backup
// (skipped when the renderer says the current save is damaged)
// (via its own temp file + fsync + rename) → rename temp over current → fsync the folder.
// `current` is never missing or half-written at any point, and the backup is replaced only
// after the new save has verified.
const fs = require('node:fs');
const path = require('node:path');
const { checkEnvelope } = require('./saveFormat.cjs');

const MAX_BYTES = 64 * 1024 * 1024;
const MAX_DAMAGED = 10;

function createSaveStore(dir) {
  const P = {
    current: path.join(dir, 'current.json'),
    backup: path.join(dir, 'backup.json'),
    temp: path.join(dir, 'current.json.tmp'),
    backupTemp: path.join(dir, 'backup.json.tmp'),
  };

  const ensureDir = () => fs.mkdirSync(dir, { recursive: true });
  const readIfExists = (file) => { try { return fs.readFileSync(file, 'utf8'); } catch (e) { if (e.code === 'ENOENT') return null; throw e; } };
  const unlinkQuiet = (file) => { try { fs.unlinkSync(file); } catch { /* already gone */ } };
  const fsyncDir = () => {
    // makes the renames durable on POSIX; Windows cannot open a folder for fsync, which is fine
    let fd;
    try { fd = fs.openSync(dir, 'r'); fs.fsyncSync(fd); } catch { /* not supported here */ } finally { if (fd !== undefined) try { fs.closeSync(fd); } catch { /* ignore */ } }
  };
  const writeSynced = (file, text) => {
    const fd = fs.openSync(file, 'w');
    try { fs.writeFileSync(fd, text, 'utf8'); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  };

  // Tidy up after an interrupted write. A leftover temp is never needed because current was
  // never touched before the final rename.
  try { unlinkQuiet(P.temp); unlinkQuiet(P.backupTemp); } catch { /* ignore */ }

  function damagedFiles() {
    try { return fs.readdirSync(dir).filter((f) => /^damaged-[\w-]+\.json$/.test(f)).sort(); } catch { return []; }
  }

  function keepDamaged(text) {
    if (typeof text !== 'string' || text === '') return { ok: false, error: 'Nothing to keep.' };
    if (text.length > MAX_BYTES) return { ok: false, error: 'The damaged save is too large to copy.' };
    try {
      ensureDir();
      const existing = damagedFiles();
      const same = existing.find((f) => readIfExists(path.join(dir, f)) === text);
      if (same) return { ok: true, name: same };
      const name = `damaged-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
      const tmp = path.join(dir, `${name}.tmp`);
      writeSynced(tmp, text);
      fs.renameSync(tmp, path.join(dir, name));
      fsyncDir();
      for (const f of existing.slice(0, Math.max(0, existing.length + 1 - MAX_DAMAGED))) unlinkQuiet(path.join(dir, f));
      return { ok: true, name };
    } catch (e) {
      return { ok: false, error: `Could not keep a copy of the damaged save: ${e.message}` };
    }
  }

  /** @param {{rotateBackup?: boolean}} [opts] rotateBackup: false keeps the backup (the renderer knows current is damaged). */
  function write(text, opts = {}) {
    const rotateBackup = opts.rotateBackup !== false;
    if (typeof text !== 'string') return { ok: false, error: 'A save must be text.' };
    if (text.length > MAX_BYTES) return { ok: false, error: 'The save is too large.' };
    const check = checkEnvelope(text);
    if (!check.ok || check.legacy) return { ok: false, error: `Refusing to write an invalid save (${check.ok ? 'not an envelope' : check.reason}).` };
    try {
      ensureDir();
      // 1–2: temp file, flushed, read back and verified
      writeSynced(P.temp, text);
      const back = readIfExists(P.temp);
      if (back !== text || !checkEnvelope(back).ok) { unlinkQuiet(P.temp); return { ok: false, error: 'The new save did not verify after writing. Your previous save is unchanged.' }; }
      // 3: the previous current becomes the backup, but only if it is itself a valid save
      const prev = readIfExists(P.current);
      if (prev !== null && prev !== text) {
        if (rotateBackup && checkEnvelope(prev).ok) {
          writeSynced(P.backupTemp, prev);
          fs.renameSync(P.backupTemp, P.backup);
        } else {
          keepDamaged(prev); // never overwrite a good backup with damaged data, and never lose it either
        }
      }
      // 4: atomic replace
      fs.renameSync(P.temp, P.current);
      fsyncDir();
      return { ok: true, savedAt: check.savedAt ?? undefined };
    } catch (e) {
      unlinkQuiet(P.temp); unlinkQuiet(P.backupTemp);
      return { ok: false, error: `Could not write the save: ${e.message}. Your previous save is unchanged.` };
    }
  }

  return {
    paths: P,
    read: () => readIfExists(P.current),
    readBackup: () => readIfExists(P.backup),
    write,
    keepDamaged,
    info: () => ({ dir, current: P.current, backup: P.backup, hasCurrent: fs.existsSync(P.current), hasBackup: fs.existsSync(P.backup), damaged: damagedFiles() }),
  };
}

module.exports = { createSaveStore };
