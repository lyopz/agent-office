// Connect the owner's Pinterest app for trends and idea search: npm run set-pinterest
// Needs a Pinterest developer app with an access token (pins:read, boards:read; trends need an
// approved app). The token is typed hidden and checked before saving.
import readline from 'node:readline';
import { pingPinterest, pinterestConfig, savePinterest } from './pinterest.mjs';
import { secretsDir } from './key-file.mjs';

const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
let hidden = false;
rl._writeToOutput = (s) => { if (!hidden || s.includes('\n')) process.stdout.write(hidden ? '\n' : s); };
const ask = (q, hide) => new Promise((res) => { process.stdout.write(q); hidden = hide; rl.question('', (a) => { hidden = false; res(a.trim()); }); });

const token = await ask('Pinterest access token (it will not show): ', true);
rl.close();
if (token.length < 20) { console.log('\nThat does not look like a token. Nothing was saved.'); process.exit(1); }
const cfg = { ...(pinterestConfig() || {}), token, savedAt: new Date().toISOString() };
try { cfg.username = await pingPinterest(cfg); }
catch (e) { console.log(`\n${e.message}. Nothing was saved.`); process.exit(1); }
savePinterest(cfg);
console.log(`\nSaved: connected as ${cfg.username || 'your Pinterest account'}. The trend scouts can now read Pinterest trends and search pins for ideas. Stored in ${secretsDir()}, outside the app folder.`);
