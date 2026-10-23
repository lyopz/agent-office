// Connect the owner's Pinterest app once with a sign-in that renews itself: npm run connect-pinterest
// Asks for the app id and secret (from developers.pinterest.com, My apps), opens Pinterest's "allow"
// page in the browser, receives the answer on this PC only (http://localhost:8789/callback, which must be
// listed as a redirect URI in the Pinterest app), and saves the access and refresh tokens outside the
// app folder. The runner then renews them by itself. Scopes: read, plus write for the secret memez
// board only. Nothing in the app can post, comment or follow.
import http from 'node:http';
import crypto from 'node:crypto';
import { openInBrowser } from './canva.mjs';
import { REDIRECT_URI, PINTEREST_PORT, SCOPES, authorizeUrl, exchangeCode, findOrCreateBoard, pingPinterest, pinterestConfig, savePinterest } from './pinterest.mjs';
import { secretsDir } from './key-file.mjs';
import { ask, askSecret, finish } from './secret-prompt.mjs';

async function main() {
  console.log(`Before this: in your Pinterest app (developers.pinterest.com, My apps) add the redirect URI ${REDIRECT_URI} and save.`);
  const appId = await ask('App id: ');
  const { token: appSecret } = await askSecret('App secret');
  if (!/^\d{5,}$/.test(appId) || appSecret.length < 10) { console.log('\nThat does not look right. Nothing was saved.'); return 1; }
  const state = crypto.randomBytes(16).toString('hex');
  const url = authorizeUrl(appId, state);
  const cfg = { ...(pinterestConfig() || {}), appId, appSecret, savedAt: new Date().toISOString() };
  const code = await new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const u = new URL(req.url, `http://localhost:${PINTEREST_PORT}`);
      if (u.pathname !== '/callback') { res.writeHead(404); res.end(); return; }
      const ok = u.searchParams.get('state') === state && u.searchParams.get('code');
      res.writeHead(200, { 'content-type': 'text/html' });
      res.end(`<p style="font:16px sans-serif">${ok ? 'Pinterest is connected to The Brain. You can close this tab.' : `Pinterest said: ${u.searchParams.get('error_description') || u.searchParams.get('error') || 'no code'}. Close this tab and try again.`}</p>`);
      server.close(); resolve(ok ? u.searchParams.get('code') : null);
    });
    server.once('error', (e) => { console.log(`\nCould not listen on localhost:${PINTEREST_PORT} (${e.message}).`); resolve(null); });
    server.listen(PINTEREST_PORT, '127.0.0.1', () => {
      console.log(`\nOpening Pinterest in your browser. Sign in and press Give access (scopes: ${SCOPES.join(', ')}).\nIf it does not open, paste this into your browser:\n${url}\n`);
      openInBrowser(url);
    });
    setTimeout(() => { server.close(); resolve(null); }, 10 * 60_000).unref();
  });
  if (!code) { console.log('No answer from Pinterest. Nothing was saved.'); return 1; }
  let next;
  try { next = await exchangeCode(cfg, code); next.username = await pingPinterest(next); }
  catch (e) { console.log(`\n${e.message}. Nothing was saved.`); return 1; }
  let boardNote = '';
  try { const b = await findOrCreateBoard(next); next.boardId = b.id; next.boardName = b.name; boardNote = `The agents may save pins to your secret "${b.name}" board and remove them from it; that board is the only thing they can write to.`; }
  catch (e) { delete next.boardId; boardNote = `No memez board (${e.message}); the agents can read trends and search pins, but not save any.`; }
  savePinterest(next);
  console.log(`\nConnected as ${next.username || 'your Pinterest account'}. ${boardNote} The sign-in renews itself: the runner refreshes the token every few weeks while it runs. Nothing in the app can post, comment or follow. Stored in ${secretsDir()}, outside the app folder.`);
  return 0;
}
finish(await main());
