// Connect the owner's Canva account once: npm run connect-canva
// Opens Canva's sign-in in the browser; Canva sends the answer back to this PC only
// (127.0.0.1). The sign-in is saved outside the app folder and never shown or logged.
// The app's Connect Canva button (JARVIS runs) does the same without this window.
// npm run connect-canva -- --forget removes it.
import { canvaTools, forgetCanva, startConnect } from './canva.mjs';
import { secretsDir } from './key-file.mjs';

if (process.argv.includes('--forget')) {
  console.log(forgetCanva() ? 'Canva is disconnected from The Brain on this PC. You can also remove it in Canva under Settings, Apps.' : 'Canva was not connected.');
  process.exit(0);
}
let c;
try { c = await startConnect(); } catch (e) { console.log(`\n${e.message}\nNothing was saved.`); process.exit(1); }
console.log('Opening Canva in your browser. Sign in and press Allow.');
console.log(`If it does not open, paste this into your browser:\n${c.url}\n`);
const r = await c.done;
if (!r.ok) { console.log(`\n${r.error}\nNothing was saved.`); process.exit(1); }
let tools = [];
try { tools = await canvaTools({ fresh: true }); } catch (e) { console.log(`\nSaved, but the first check with Canva failed: ${e.message}`); }
console.log(`\nConnected. ${tools.length ? `Agents can use ${tools.length} Canva tools (make designs and images, export them) in tasks you give them. ` : ''}Each export goes to your Approvals, and into your store only when you press Yes. AI designs use your Canva AI credits. Stored in ${secretsDir()}, outside the app folder.`);
process.exit(0);
