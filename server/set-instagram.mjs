// Connect the owner's Instagram professional account for hashtag research: npm run set-instagram
// Needs a Meta app with instagram_basic and Instagram Public Content Access, a long-lived user
// token, and the Instagram account id. The token is typed hidden and checked before saving.
import readline from 'node:readline';
import { instagramConfig, pingInstagram, saveInstagram } from './instagram.mjs';
import { secretsDir } from './key-file.mjs';

const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
let hidden = false;
rl._writeToOutput = (s) => { if (!hidden || s.includes('\n')) process.stdout.write(hidden ? '\n' : s); };
const ask = (q, hide) => new Promise((res) => { process.stdout.write(q); hidden = hide; rl.question('', (a) => { hidden = false; res(a.trim()); }); });

const igUserId = await ask('Instagram account id (the ig-user-id from Graph API Explorer: me/accounts → instagram_business_account): ', false);
const token = await ask('Long-lived user access token (it will not show): ', true);
rl.close();
if (!/^\d{5,}$/.test(igUserId) || token.length < 20) { console.log('\nThat does not look right. Nothing was saved.'); process.exit(1); }
const cfg = { ...(instagramConfig() || {}), igUserId, token, savedAt: new Date().toISOString() };
try { cfg.username = await pingInstagram(cfg); }
catch (e) { console.log(`\n${e.message}. Nothing was saved.`); process.exit(1); }
saveInstagram(cfg);
console.log(`\nSaved: connected as @${cfg.username || igUserId}. Read-only: the agents can only search hashtags (30 a week); nothing in the app can post, like, comment or follow. Stored in ${secretsDir()}, outside the app folder. Long-lived tokens last 60 days; run this again when it expires.`);
