// Connect the owner's Canva account once: npm run connect-canva
// Opens Canva's sign-in in the browser; Canva sends the answer back to this PC only
// (127.0.0.1). The sign-in is saved outside the app folder and never shown or logged.
// npm run connect-canva -- --forget removes it.
import http from 'node:http';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { canvaTools, discover, forgetCanva, saveCanva } from './canva.mjs';
import { secretsDir } from './key-file.mjs';

if (process.argv.includes('--forget')) {
  console.log(forgetCanva() ? 'Canva is disconnected from The Brain on this PC. You can also remove it in Canva under Settings, Apps.' : 'Canva was not connected.');
  process.exit(0);
}

const fail = (msg) => { console.log(`\n${msg}\nNothing was saved.`); process.exit(1); };
const b64url = (b) => b.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

const meta = await discover();
const verifier = b64url(crypto.randomBytes(32));
const challenge = b64url(crypto.createHash('sha256').update(verifier).digest());
const state = b64url(crypto.randomBytes(16));

// a one-time page on this PC that receives Canva's answer
const server = http.createServer();
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const redirect = `http://127.0.0.1:${server.address().port}/callback`;

let reg;
try {
  const r = await fetch(meta.registration_endpoint, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ client_name: 'The Brain (personal)', redirect_uris: [redirect], grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'], token_endpoint_auth_method: 'none' }), signal: AbortSignal.timeout(20_000) });
  if (!r.ok) fail(`Canva did not register this app (${r.status}). Canva may only allow approved apps right now.`);
  reg = await r.json();
} catch (e) { fail(`Could not reach Canva (${e.message}). Check your internet connection and try again.`); }

const url = new URL(meta.authorization_endpoint);
for (const [k, v] of Object.entries({ response_type: 'code', client_id: reg.client_id, redirect_uri: redirect, code_challenge: challenge, code_challenge_method: 'S256', state, ...(meta.scopes.length ? { scope: meta.scopes.join(' ') } : {}) })) url.searchParams.set(k, v);

console.log('Opening Canva in your browser. Sign in and press Allow.');
console.log(`If it does not open, paste this into your browser:\n${url}\n`);
const open = process.platform === 'win32' ? ['rundll32', ['url.dll,FileProtocolHandler', url.toString()]] : process.platform === 'darwin' ? ['open', [url.toString()]] : ['xdg-open', [url.toString()]];
try { spawn(open[0], open[1], { detached: true, stdio: 'ignore' }).unref(); } catch { /* the link is printed */ }

const code = await new Promise((resolve) => {
  const timer = setTimeout(() => resolve(null), 10 * 60_000);
  server.on('request', (req, res) => {
    const q = new URL(req.url, redirect);
    if (q.pathname !== '/callback') { res.writeHead(404).end(); return; }
    const ok = q.searchParams.get('state') === state && q.searchParams.get('code');
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(`<!doctype html><title>The Brain</title><body style="font:16px system-ui;padding:40px">${ok ? 'Canva is connected to The Brain. You can close this tab.' : 'Canva did not connect. Go back to the window and try again.'}</body>`);
    clearTimeout(timer);
    resolve(ok ? q.searchParams.get('code') : null);
  });
});
server.close();
if (!code) fail('Canva did not sign in (cancelled, timed out or the answer did not match).');

const r = await fetch(meta.token_endpoint, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: redirect, client_id: reg.client_id, code_verifier: verifier, ...(reg.client_secret ? { client_secret: reg.client_secret } : {}) }).toString(), signal: AbortSignal.timeout(20_000) }).catch(() => null);
if (!r?.ok) fail(`Canva did not finish the sign-in (${r?.status ?? 'no answer'}).`);
const t = await r.json();
saveCanva({ clientId: reg.client_id, ...(reg.client_secret ? { clientSecret: reg.client_secret } : {}), tokenEndpoint: meta.token_endpoint, accessToken: t.access_token, refreshToken: t.refresh_token || null, expiresAt: Date.now() + (Number(t.expires_in) || 3600) * 1000, connectedAt: new Date().toISOString() });

let tools = [];
try { tools = await canvaTools({ fresh: true }); } catch (e) { console.log(`\nSaved, but the first check with Canva failed: ${e.message}`); }
console.log(`\nConnected. ${tools.length ? `Agents can use ${tools.length} Canva tools (make designs and images, export them) in tasks you give them. ` : ''}Each export is saved in the app's design gallery and goes into your Printify shop only as a product you approve. AI designs use your Canva AI credits. Stored in ${secretsDir()}, outside the app folder.`);
process.exit(0);
