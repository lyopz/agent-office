'use strict';
// Main-process copy of the save envelope check in src/persistence/saveFormat.ts.
// It checks structure and checksum only (the office schema is validated in the renderer).
// tests/save.test.ts keeps both implementations producing identical checksums.

const SAVE_FORMAT = 'agent-office-save';
const SAVE_FORMAT_VERSION = 1;

function fnv1a32(text) {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

function checksumOf(body) { return `fnv1a32-${fnv1a32(body)}-${body.length}`; }

/** @returns {{ok: true, legacy: boolean, savedAt: string|null} | {ok: false, reason: string}} */
function checkEnvelope(text) {
  if (typeof text !== 'string' || text === '') return { ok: false, reason: 'empty' };
  let d;
  try { d = JSON.parse(text); } catch { return { ok: false, reason: 'not valid JSON' }; }
  if (!d || typeof d !== 'object' || Array.isArray(d)) return { ok: false, reason: 'not an office save' };
  if (d.format === undefined) {
    if (!d.doc || typeof d.doc !== 'object') return { ok: false, reason: 'no office in the save' };
    return { ok: true, legacy: true, savedAt: typeof d.savedAt === 'string' ? d.savedAt : null };
  }
  if (d.format !== SAVE_FORMAT) return { ok: false, reason: 'unknown save format' };
  if (typeof d.version !== 'number' || d.version > SAVE_FORMAT_VERSION) return { ok: false, reason: 'newer save format' };
  if (typeof d.checksum !== 'string') return { ok: false, reason: 'no checksum' };
  if (checksumOf(JSON.stringify({ doc: d.doc, runtime: d.runtime })) !== d.checksum) return { ok: false, reason: 'checksum mismatch' };
  return { ok: true, legacy: false, savedAt: typeof d.savedAt === 'string' ? d.savedAt : null };
}

module.exports = { SAVE_FORMAT, SAVE_FORMAT_VERSION, fnv1a32, checksumOf, checkEnvelope };
