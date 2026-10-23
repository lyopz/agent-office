// The Anthropic API key, saved once on this PC by `npm run set-key`, so the
// runner finds it in any window. It lives outside the app folder (never in git)
// and only the runner reads it; it is never logged or sent to the app.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/** The folder on this PC, outside the app, where keys and sign-ins are kept. */
export const secretsDir = () => path.join(process.env.APPDATA || path.join(os.homedir(), '.config'), 'the-brain');
export const keyPath = () => path.join(secretsDir(), 'anthropic-key');

/** The key from the environment if set there, else the saved file, else ''. */
export function readKey() {
  if (process.env.ANTHROPIC_API_KEY?.trim()) return { key: process.env.ANTHROPIC_API_KEY.trim(), from: 'environment' };
  try { const k = fs.readFileSync(keyPath(), 'utf8').trim(); if (k) return { key: k, from: 'saved file' }; } catch { /* not saved yet */ }
  return { key: '', from: 'nowhere' };
}

export function saveKey(key) {
  fs.mkdirSync(path.dirname(keyPath()), { recursive: true });
  fs.writeFileSync(keyPath(), key.trim(), { mode: 0o600 });
}
