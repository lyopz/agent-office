// Save the Anthropic API key on this PC once: npm run set-key
// Typing is hidden. The key is checked with a free call before it is saved.
import readline from 'node:readline';
import { keyPath, saveKey } from './key-file.mjs';

const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
let hidden = false;
rl._writeToOutput = (s) => { if (!hidden || s.includes('\n')) process.stdout.write(hidden ? '\n' : s); };
process.stdout.write('Paste your Anthropic API key (starts with sk-ant-) and press Enter. It will not show: ');
hidden = true;
rl.question('', async (answer) => {
  hidden = false; rl.close();
  const key = answer.trim();
  if (!/^sk-ant-[\w-]{20,}$/.test(key)) { console.log('\nThat does not look like an Anthropic API key (it should start with sk-ant-). Nothing was saved.'); process.exit(1); }
  try {
    const r = await fetch('https://api.anthropic.com/v1/models?limit=1', { headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01' }, signal: AbortSignal.timeout(20_000) });
    if (r.status === 401 || r.status === 403) { console.log(`\nAnthropic rejected that key (${r.status}). Copy it again from console.anthropic.com. Nothing was saved.`); process.exit(1); }
  } catch { console.log('\nCould not reach Anthropic to check the key; saving it anyway.'); }
  saveKey(key);
  console.log(`\nSaved. The runner will use it from now on, in any window. (Stored at ${keyPath()}, outside the app folder.)`);
});
