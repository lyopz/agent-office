// Save the owner's Etsy app key on this PC once: npm run set-etsy
// The keystring is shown as typed; the shared secret is hidden. Both are checked before saving.
import readline from 'node:readline';
import { etsyConfig, pingEtsy, saveEtsy } from './etsy.mjs';
import { secretsDir } from './key-file.mjs';

const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
let hidden = false;
rl._writeToOutput = (s) => { if (!hidden || s.includes('\n')) process.stdout.write(hidden ? '\n' : s); };
const ask = (q, hide) => new Promise((res) => { process.stdout.write(q); hidden = hide; rl.question('', (a) => { hidden = false; res(a.trim()); }); });

const keystring = await ask('Etsy app KEYSTRING (from etsy.com/developers/your-apps): ', false);
const secret = await ask('Etsy SHARED SECRET (it will not show): ', true);
rl.close();
if (!/^[a-z0-9]{10,}$/i.test(keystring)) { console.log('\nThat keystring does not look right. Nothing was saved.'); process.exit(1); }
const cfg = { ...(etsyConfig() || {}), keystring, secret: secret || undefined };
try { await pingEtsy(cfg); }
catch (e) { console.log(`\nEtsy did not accept it (${e.message}). If your app is still "pending" on Etsy, wait for approval and run this again. Nothing was saved.`); process.exit(1); }
saveEtsy(cfg);
console.log(`\nSaved. ORIGIN's agents can now search Etsy listings (read-only). Stored in ${secretsDir()}, outside the app folder.`);
console.log('To let them read your own shop too, open the ORIGIN runs panel in the app and press "Connect my Etsy shop".');
