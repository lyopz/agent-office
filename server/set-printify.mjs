// Save the owner's Printify personal access token on this PC once: npm run set-printify
// Typing is hidden. The token is checked, and the shop products go to is picked, before saving.
import readline from 'node:readline';
import { pf, printifyConfig, savePrintify } from './printify.mjs';
import { secretsDir } from './key-file.mjs';

const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
let hidden = false;
rl._writeToOutput = (s) => { if (!hidden || s.includes('\n')) process.stdout.write(hidden ? '\n' : s); };
const ask = (q, hide) => new Promise((res) => { process.stdout.write(q); hidden = hide; rl.question('', (a) => { hidden = false; res(a.trim()); }); });

const token = await ask('Paste your Printify personal access token (it will not show): ', true);
if (token.length < 20) { rl.close(); console.log('\nThat does not look like a Printify token. Nothing was saved.'); process.exit(1); }
let shops;
try { shops = await pf('/shops.json', { deps: { config: { token } } }); }
catch (e) { rl.close(); console.log(`\nPrintify did not accept it (${e.message}). Nothing was saved.`); process.exit(1); }
if (!shops.length) console.log('\nThe token works, but no shop is connected in Printify yet. Connect your Etsy shop at printify.com (My stores), then run this again.');
let shop = shops[0];
if (shops.length > 1) {
  shops.forEach((s, i) => console.log(`  ${i + 1}. ${s.title} (${s.sales_channel})`));
  const n = Number(await ask('Which shop should agents use? Type its number: ', false));
  shop = shops[n - 1] ?? shops[0];
}
rl.close();
savePrintify({ ...(printifyConfig() || {}), token, shopId: shop?.id ?? null, shopTitle: shop?.title ?? null, channel: shop?.sales_channel ?? null });
console.log(`\nSaved${shop ? `. Agents will create products in "${shop.title}" (${shop.sales_channel})` : ''}. Nothing is published until you press Publish in the app. Stored in ${secretsDir()}, outside the app folder.`);
