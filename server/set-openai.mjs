// Save the owner's OpenAI API key on this PC once: npm run set-openai
// Typing is hidden. The key is checked with a free call before saving. It is used only to make
// design images (gpt-image), billed to the owner's OpenAI account.
import readline from 'node:readline';
import { openaiConfig, saveOpenai } from './openai-images.mjs';
import { secretsDir } from './key-file.mjs';

const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
let hidden = false;
rl._writeToOutput = (s) => { if (!hidden || s.includes('\n')) process.stdout.write(hidden ? '\n' : s); };
const ask = (q) => new Promise((res) => { process.stdout.write(q); hidden = true; rl.question('', (a) => { hidden = false; res(a.trim()); }); });

const key = await ask('Paste your OpenAI API key (it starts with sk-, and it will not show): ');
rl.close();
if (!key.startsWith('sk-') || key.length < 20) { console.log('\nThat does not look like an OpenAI API key. Nothing was saved.'); process.exit(1); }
let r;
try { r = await fetch('https://api.openai.com/v1/models', { headers: { authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(20_000) }); }
catch { console.log('\nCould not reach OpenAI. Check your internet connection and try again. Nothing was saved.'); process.exit(1); }
if (!r.ok) { console.log(`\nOpenAI did not accept the key (${r.status}). Nothing was saved.`); process.exit(1); }
saveOpenai({ ...(openaiConfig() || {}), key });
console.log(`\nSaved. Agents can now make design images, billed to your OpenAI account, within the image cap you set in the app. Stored in ${secretsDir()}, outside the app folder.`);
