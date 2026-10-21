// Connect the owner's Pinterest app for trends and idea search: npm run set-pinterest
// Needs a Pinterest developer app with an access token (pins:read, boards:read; trends need an
// approved app). The token is typed hidden and checked before saving.
import readline from 'node:readline';
import { findOrCreateBoard, pingPinterest, pinterestConfig, savePinterest } from './pinterest.mjs';
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
let boardNote = '';
try { const b = await findOrCreateBoard(cfg); cfg.boardId = b.id; cfg.boardName = b.name; boardNote = `The agents may save pins to your secret "${b.name}" board and remove them from it; that board is the only thing they can write to.`; }
catch (e) { delete cfg.boardId; boardNote = `No memez board (${e.message}); the agents can read trends and search pins, but not save any. For saving, make a new token with boards:write and pins:write too, then run this again.`; }
savePinterest(cfg);
console.log(`\nSaved: connected as ${cfg.username || 'your Pinterest account'}. ${boardNote} Nothing in the app can post, comment or follow. Stored in ${secretsDir()}, outside the app folder.`);
