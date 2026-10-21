// Connect the owner's Instagram professional account: npm run set-instagram
// Two kinds of token are accepted, both read-only:
//   1. From the Meta app dashboard, Instagram > API setup with Instagram login > Generate token.
//      Needs no account id. Sees the owner's own account only (profile numbers, own posts).
//   2. From Facebook Login for Business (Graph API Explorer) with instagram_basic, pages_show_list and
//      the Instagram Public Content Access feature, plus the Instagram account id. Adds hashtag search.
// The token is typed hidden and checked with Meta before saving.
import readline from 'node:readline';
import { instagramConfig, pingInstagram, saveInstagram } from './instagram.mjs';
import { secretsDir } from './key-file.mjs';

const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
let hidden = false;
rl._writeToOutput = (s) => { if (!hidden || s.includes('\n')) process.stdout.write(hidden ? '\n' : s); };
const ask = (q, hide) => new Promise((res) => { process.stdout.write(q); hidden = hide; rl.question('', (a) => { hidden = false; res(a.trim()); }); });

console.log('Which token?\n  1  Instagram login token (app dashboard: Instagram > API setup with Instagram login > Generate token). Own account only.\n  2  Facebook Login for Business token (Graph API Explorer, instagram_basic + pages_show_list + Public Content Access). Adds hashtag search.');
const choice = await ask('1 or 2: ', false);
const kind = choice === '2' ? 'facebook' : 'instagram';
const igUserId = kind === 'facebook' ? await ask('Instagram account id (Graph API Explorer: me/accounts, then <page-id>?fields=instagram_business_account): ', false) : '';
const token = await ask('Access token (it will not show): ', true);
rl.close();
if ((kind === 'facebook' && !/^\d{5,}$/.test(igUserId)) || token.length < 20) { console.log('\nThat does not look right. Nothing was saved.'); process.exit(1); }
const cfg = { ...(instagramConfig() || {}), kind, igUserId, token, savedAt: new Date().toISOString() };
try { const me = await pingInstagram(cfg); cfg.igUserId = me.igUserId || igUserId; cfg.username = me.username; }
catch (e) { console.log(`\n${e.message}. Nothing was saved.`); process.exit(1); }
if (!cfg.igUserId) { console.log('\nMeta did not return the account id. Nothing was saved.'); process.exit(1); }
saveInstagram(cfg);
console.log(`\nSaved: connected as @${cfg.username || cfg.igUserId} (${kind === 'facebook' ? 'Facebook login: own account and hashtag search, 30 hashtags a week' : 'Instagram login: own account numbers and own posts; Meta gives no hashtag search on this token'}). Read-only: nothing in the app can post, like, comment or follow. Stored in ${secretsDir()}, outside the app folder. Dashboard and long-lived tokens last 60 days; run this again when it expires.`);
