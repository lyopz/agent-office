// Asking for a token at the keyboard without showing it, for the set-* scripts.
// A long token pasted into a Windows console can arrive cut or with stray characters, so the
// owner may also press Enter on an empty line and the token is read straight from the clipboard
// (PowerShell Get-Clipboard), never typed and never shown. finish() ends the script without
// process.exit, which on Windows can trip a Node assertion while the console input is closing.
import { execFileSync } from 'node:child_process';
import readline from 'node:readline';

const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
let hidden = false;
rl._writeToOutput = (s) => { if (!hidden || s.includes('\n')) process.stdout.write(hidden ? '\n' : s); };

/** Ask a question; the answer is shown unless hide is true. */
export const ask = (q, hide = false) => new Promise((res) => { process.stdout.write(q); hidden = hide; rl.question('', (a) => { hidden = false; res(a.trim()); }); });

function clipboard() {
  try {
    if (process.platform === 'win32') return execFileSync('powershell.exe', ['-NoProfile', '-Command', 'Get-Clipboard'], { encoding: 'utf8', windowsHide: true });
    if (process.platform === 'darwin') return execFileSync('pbpaste', [], { encoding: 'utf8' });
  } catch { /* no clipboard */ }
  return '';
}
/** A token: typed hidden, or taken from the clipboard when the owner just presses Enter. Whitespace inside is dropped. */
export async function askSecret(q) {
  const typed = await ask(`${q} (paste it; it will not show. Or copy it and just press Enter here): `, true);
  const raw = typed || clipboard();
  const token = raw.replace(/\s+/g, '');
  return { token, from: typed ? 'typed' : token ? 'clipboard' : 'nothing' };
}
/** Describe a token without revealing it, for error messages. */
export const describeToken = (t) => (t ? `${t.length} characters, starts with ${t.slice(0, 4)}` : 'empty');
/** Close the prompt and end the script with a code once everything else is done. */
export function finish(code = 0) { rl.close(); process.stdin.pause(); process.exitCode = code; }
