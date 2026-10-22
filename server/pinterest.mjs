// Pinterest for the trend scouts, through Pinterest's API with the owner's own app token:
// trending keywords by region, pin search for ideas (titles, descriptions and links only, never the
// pictures: a pin is someone's work), and the one write the owner allowed: saving a pin to their
// secret "memez" board so a meme is not lost, and removing it from that board later. Nothing else is
// ever written: no posting, commenting, following, and no other board. The token lives only on this
// PC in the secrets folder.
import fs from 'node:fs';
import path from 'node:path';
import { secretsDir } from './key-file.mjs';

const API = 'https://api.pinterest.com/v5';
const FILE = () => path.join(secretsDir(), 'pinterest.json');

export function pinterestConfig() {
  try { return JSON.parse(fs.readFileSync(FILE(), 'utf8')); } catch { return null; }
}
export function savePinterest(cfg) {
  fs.mkdirSync(secretsDir(), { recursive: true });
  const tmp = `${FILE()}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(cfg), { mode: 0o600 });
  fs.renameSync(tmp, FILE());
}
export const MEMEZ_BOARD = 'memez';
export function pinterestPublic(cfg = pinterestConfig()) {
  const configured = !!cfg?.token;
  return { configured, username: cfg?.username ?? null, board: cfg?.boardName ?? null, canSave: !!cfg?.boardId, expiresAt: configured ? cfg.expiresAt ?? null : null, renews: configured && !!cfg.refresh, refreshedAt: configured ? cfg.refreshedAt ?? null : null, refreshError: configured ? cfg.refreshError ?? null : null };
}

// ---------- sign-in with a refresh token, so the runner renews the token itself ----------
export const PINTEREST_PORT = 8789;
export const REDIRECT_URI = `http://localhost:${PINTEREST_PORT}/callback`;
export const SCOPES = ['user_accounts:read', 'boards:read', 'pins:read', 'boards:write', 'pins:write'];
const DAY = 86_400_000;
/** Pinterest's token endpoint with the app id and secret; grant is authorization_code or refresh_token. */
async function tokenCall(cfg, body, f = globalThis.fetch) {
  const r = await f(`${API}/oauth/token`, { method: 'POST', headers: { authorization: `Basic ${Buffer.from(`${cfg.appId}:${cfg.appSecret}`).toString('base64')}`, 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' }, body: new URLSearchParams(body).toString(), signal: AbortSignal.timeout(20_000) });
  const data = await r.json().catch(() => ({}));
  if (!r.ok || !data.access_token) throw new Error(`Pinterest sign-in: ${data.message || data.error_description || data.error || `HTTP ${r.status}`}`);
  return data;
}
const keepTokens = (cfg, t, now = Date.now()) => ({
  ...cfg, token: t.access_token, refresh: t.refresh_token || cfg.refresh || null, scope: t.scope || cfg.scope || null, via: 'oauth',
  expiresAt: new Date(now + (Number(t.expires_in) || 30 * DAY / 1000) * 1000).toISOString(),
  refreshExpiresAt: t.refresh_token_expires_at ? new Date(Number(t.refresh_token_expires_at) * 1000).toISOString() : t.refresh_token_expires_in ? new Date(now + Number(t.refresh_token_expires_in) * 1000).toISOString() : cfg.refreshExpiresAt ?? null,
  refreshedAt: new Date(now).toISOString(), refreshError: null,
});
/** The link the owner opens to allow the app, and the state to check on the way back. */
export function authorizeUrl(appId, state) {
  const u = new URL('https://www.pinterest.com/oauth/');
  for (const [k, v] of Object.entries({ client_id: appId, redirect_uri: REDIRECT_URI, response_type: 'code', scope: SCOPES.join(','), state })) u.searchParams.set(k, v);
  return u.toString();
}
/** Turn the code Pinterest sent back into tokens. Returns the config to save (not saved here). */
export async function exchangeCode(cfg, code, f = globalThis.fetch) {
  return keepTokens(cfg, await tokenCall(cfg, { grant_type: 'authorization_code', code, redirect_uri: REDIRECT_URI }, f));
}
/** A fresh access token (30 days) and refresh token (60 days, continuous) from the saved refresh token. Not saved here. */
export async function refreshPinterest(cfg, f = globalThis.fetch) {
  if (!cfg?.refresh || !cfg.appId || !cfg.appSecret) throw new Error('Pinterest renews itself only after npm.cmd run connect-pinterest (a token pasted by hand cannot be renewed).');
  return keepTokens(cfg, await tokenCall(cfg, { grant_type: 'refresh_token', refresh_token: cfg.refresh }, f));
}
/** Renew when due: under 10 days left on the access token, or under 20 on the refresh token, or three weeks since the last renewal. Called by the runner; saves the result. */
export async function pinterestMaintain(deps = {}) {
  const cfg = deps.config ?? pinterestConfig();
  const now = deps.now ?? Date.now();
  if (!cfg?.token) return { status: 'not connected' };
  if (!cfg.refresh || !cfg.appId || !cfg.appSecret) return { status: 'manual', expiresAt: cfg.expiresAt ?? null };
  const refreshed = Date.parse(cfg.refreshedAt || cfg.savedAt || 0) || 0;
  const expires = Date.parse(cfg.expiresAt || 0) || refreshed + 30 * DAY;
  const refreshExpires = Date.parse(cfg.refreshExpiresAt || 0) || refreshed + 60 * DAY;
  if (refreshExpires <= now) return { status: 'expired', expiresAt: cfg.expiresAt ?? null };
  if (expires - now > 10 * DAY && refreshExpires - now > 20 * DAY && now - refreshed < 21 * DAY) return { status: 'not due', expiresAt: cfg.expiresAt ?? null };
  try {
    const next = await refreshPinterest(cfg, deps.fetch ?? globalThis.fetch);
    (deps.save ?? savePinterest)(next);
    return { status: 'renewed', expiresAt: next.expiresAt };
  } catch (e) {
    (deps.save ?? savePinterest)({ ...cfg, refreshError: `${new Date(now).toISOString()} ${e.message}`.slice(0, 300) });
    return { status: 'failed', error: e.message, expiresAt: cfg.expiresAt ?? null };
  }
}

// READS are GETs. The only writes are in pinWrite below: save a pin to the owner's memez board, remove a pin from that board, and make that board once at setup. Nothing here can comment, follow, post to another board or change the account. Scopes: pins:read, boards:read, user_accounts:read, and pins:write + boards:write used for the memez board only.
async function pinGet(p, params, cfg, f = globalThis.fetch) {
  const u = new URL(`${API}/${p}`);
  for (const [k, v] of Object.entries(params)) if (v != null && v !== '') u.searchParams.set(k, String(v));
  const r = await f(u, { method: 'GET', headers: { authorization: `Bearer ${cfg.token}`, accept: 'application/json' }, signal: AbortSignal.timeout(20_000) });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) {
    const why = r.status === 401 ? 'the token has expired or was revoked: run npm.cmd run set-pinterest again' : r.status === 403 ? `the app may not call this yet (${data.message || 'scope or access level'}); trends need an approved app with standard access` : data.message || `HTTP ${r.status}`;
    throw new Error(`Pinterest: ${why}`);
  }
  return data;
}

/** The only writes allowed: a save to the memez board, a delete of a pin that is on it, or making that board. Anything else is refused here before it reaches Pinterest. */
async function pinWrite(method, p, body, cfg, f = globalThis.fetch) {
  const ok = (method === 'POST' && p === 'boards' && body?.name === MEMEZ_BOARD && body?.privacy === 'SECRET')
    || (method === 'POST' && /^pins\/[\w-]+\/save$/.test(p) && cfg.boardId && body?.board_id === cfg.boardId)
    || (method === 'DELETE' && /^pins\/[\w-]+$/.test(p) && body?.verifiedBoard === cfg.boardId);
  if (!ok) throw new Error('Pinterest: that write is not allowed; the app only saves to and removes from the memez board.');
  const r = await f(`${API}/${p}`, { method, headers: { authorization: `Bearer ${cfg.token}`, accept: 'application/json', ...(method === 'POST' ? { 'content-type': 'application/json' } : {}) }, ...(method === 'POST' ? { body: JSON.stringify({ ...body }) } : {}), signal: AbortSignal.timeout(20_000) });
  if (r.status === 204) return {};
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`Pinterest: ${r.status === 401 ? 'the token has expired: run npm.cmd run set-pinterest again' : r.status === 403 ? `the token lacks the scope for this (${data.message || 'pins:write and boards:write for the memez board'})` : data.message || `HTTP ${r.status}`}`);
  return data;
}

/** The owner's secret memez board: found by name, made once when missing. Needs boards:read (+ boards:write to make it). */
export async function findOrCreateBoard(cfg, f = globalThis.fetch) {
  let bookmark;
  for (let i = 0; i < 10; i++) {
    const page = await pinGet('boards', { page_size: 100, bookmark }, cfg, f);
    const hit = (page.items || []).find((b) => String(b.name || '').trim().toLowerCase() === MEMEZ_BOARD);
    if (hit) return { id: hit.id, name: hit.name };
    bookmark = page.bookmark; if (!bookmark) break;
  }
  const made = await pinWrite('POST', 'boards', { name: MEMEZ_BOARD, description: "Memes the Brain's scouts saved for later. Secret board; nothing is posted from it.", privacy: 'SECRET' }, cfg, f);
  return { id: made.id, name: made.name || MEMEZ_BOARD };
}
const pinView = (p) => ({ id: p.id, title: String(p.title || '').slice(0, 160), description: String(p.description || '').replace(/\s+/g, ' ').slice(0, 300), link: p.link || `https://www.pinterest.com/pin/${p.id}/`, board: p.board_id ?? null, owner: p.board_owner?.username ?? null, at: p.created_at ?? null });
/** Save an existing pin to the memez board (Pinterest's own save; the picture stays Pinterest's). */
export async function savePin(cfg, pinId, f = globalThis.fetch) {
  if (!cfg.boardId) throw new Error('Pinterest: no memez board yet; the owner runs npm.cmd run set-pinterest again with a token that has boards:write and pins:write.');
  const id = String(pinId || '').replace(/[^\w-]/g, '');
  if (!id) throw new Error('Give the pin_id from a search or find result.');
  const saved = await pinWrite('POST', `pins/${id}/save`, { board_id: cfg.boardId }, cfg, f);
  return pinView({ ...saved, board_id: saved.board_id ?? cfg.boardId });
}
/** Remove a pin from the memez board; a pin on any other board is refused. */
export async function unsavePin(cfg, pinId, f = globalThis.fetch) {
  const id = String(pinId || '').replace(/[^\w-]/g, '');
  if (!id) throw new Error('Give the pin_id of a pin on the memez board.');
  const pin = await pinGet(`pins/${id}`, {}, cfg, f);
  if (!cfg.boardId || pin.board_id !== cfg.boardId) throw new Error('Pinterest: that pin is not on the memez board, so it is not removed.');
  await pinWrite('DELETE', `pins/${id}`, { verifiedBoard: cfg.boardId }, cfg, f);
  return { removed: id, title: pin.title || '' };
}
/** What is on the memez board now. */
export async function boardPins(cfg, limit = 25, f = globalThis.fetch) {
  if (!cfg.boardId) return [];
  const page = await pinGet(`boards/${cfg.boardId}/pins`, { page_size: Math.min(100, limit) }, cfg, f);
  return (page.items || []).slice(0, limit).map(pinView);
}

export async function pingPinterest(cfg, f = globalThis.fetch) {
  const me = await pinGet('user_account', {}, cfg, f);
  return me.username || '';
}

export const PINTEREST_TOOL = {
  name: 'trends_pinterest',
  description: "Pinterest through the owner's connected Pinterest app. trends: trending keywords for a region (growing, monthly, yearly or seasonal). search: pins by words (titles, descriptions, links, pin ids). find: a specific meme, with phrase words that must appear in the title or description. save: keep a found pin on the owner's secret memez board so it is not lost (Pinterest's own save; the picture stays on Pinterest). unsave: remove a pin from that board. board: what is on it. Never the pictures: a pin is someone's work and is never a free image; take the phrase and the joke, make your own. The memez board is the only place this app ever writes: no posting, commenting, following, no other board.",
  input_schema: { type: 'object', properties: { action: { type: 'string', enum: ['trends', 'search', 'find', 'save', 'unsave', 'board'] }, query: { type: 'string', description: 'for search and find: what to look for, e.g. "funny fish shirt"' }, phrase: { type: 'string', description: 'for find: words that must all appear in the pin, e.g. "fih"' }, pin_id: { type: 'string', description: 'for save and unsave' }, note: { type: 'string', description: 'for save: why it matters (the joke, the trend, where it is rising); saved with the meme\'s info' }, region: { type: 'string', description: 'for trends: US (default), CA, GB, DE, FR, ...' }, trend_type: { type: 'string', enum: ['growing', 'monthly', 'yearly', 'seasonal'] }, interests: { type: 'string', description: 'for trends: comma-separated interest filter, optional' }, limit: { type: 'integer', minimum: 1, maximum: 25 } }, required: ['action'] },
};

export async function pinterestTool(input = {}, deps = {}) {
  const cfg = deps.config ?? pinterestConfig();
  if (!cfg?.token) throw new Error('Pinterest is not connected: the owner runs npm.cmd run set-pinterest once.');
  const f = deps.fetch ?? globalThis.fetch;
  const limit = Math.max(1, Math.min(25, Number(input.limit) || 15));
  if (input.action === 'search' || input.action === 'find') {
    const q = String(input.query || input.phrase || '').trim().slice(0, 120);
    if (!q) throw new Error('Give a query.');
    const data = await pinGet('search/pins', { query: q, page_size: input.action === 'find' ? 50 : limit }, cfg, f);
    let pins = (data.items || []).map(pinView);
    if (input.action === 'find') {
      const words = String(input.phrase || input.query || '').toLowerCase().split(/\s+/).filter(Boolean);
      pins = pins.filter((p) => words.every((w) => `${p.title} ${p.description}`.toLowerCase().includes(w))).slice(0, limit);
    }
    return { query: q, ...(input.action === 'find' ? { phrase: input.phrase || q } : {}), pins, canSave: !!cfg.boardId, note: 'Titles, descriptions and links only; pins are their authors\' work. save keeps one on the memez board.' };
  }
  if (input.action === 'save') return { saved: await savePin(cfg, input.pin_id, f), note: String(input.note || '').slice(0, 400), board: cfg.boardName || MEMEZ_BOARD, info: 'Kept on the owner\'s secret memez board; its info is written to the memez folder. Nothing was posted.' };
  if (input.action === 'unsave') return { ...(await unsavePin(cfg, input.pin_id, f)), board: cfg.boardName || MEMEZ_BOARD };
  if (input.action === 'board') return { board: cfg.boardName || MEMEZ_BOARD, pins: await boardPins(cfg, limit, f) };
  const region = String(input.region || 'US').toUpperCase().replace(/[^A-Z+]/g, '').slice(0, 5) || 'US';
  const type = ['growing', 'monthly', 'yearly', 'seasonal'].includes(input.trend_type) ? input.trend_type : 'growing';
  const data = await pinGet(`trends/keywords/${region}/top/${type}`, { interests: input.interests, limit }, cfg, f);
  return { region, trend_type: type, trends: (data.trends || []).slice(0, limit).map((t) => ({ keyword: t.keyword, pct_growth_wow: t.pct_growth_wow ?? null, pct_growth_yoy: t.pct_growth_yoy ?? null, time_series: Array.isArray(t.time_series) ? t.time_series.slice(-8) : undefined })) };
}
