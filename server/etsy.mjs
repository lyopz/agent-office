// Etsy for JARVIS's agents: read-only research on public listings with the owner's
// app key, and (once the owner signs in) read-only stats for their own shop.
// The key, secret and sign-in tokens live only on this PC in the secrets folder;
// they are never logged, sent to the app, or put in a prompt.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { secretsDir } from './key-file.mjs';

const API = 'https://openapi.etsy.com/v3/application';
const FILE = () => path.join(secretsDir(), 'etsy.json');
/** Read scopes only: nothing the agents do can change the shop. */
export const ETSY_SCOPES = 'shops_r listings_r transactions_r profile_r';

export function etsyConfig() {
  try { return JSON.parse(fs.readFileSync(FILE(), 'utf8')); } catch { return null; }
}
export function saveEtsy(cfg) {
  fs.mkdirSync(secretsDir(), { recursive: true });
  const tmp = `${FILE()}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(cfg), { mode: 0o600 });
  fs.renameSync(tmp, FILE());
}
/** What the app may see: whether Etsy is set up, never the key or tokens. */
export function etsyPublic() {
  const c = etsyConfig();
  return { configured: !!c?.keystring, connected: !!c?.tokens?.refresh, shopName: c?.shopName ?? null };
}

// Etsy asks for "keystring:shared_secret" in x-api-key; older apps accept the keystring alone
const keyHeader = (c, plain) => (c.secret && !plain ? `${c.keystring}:${c.secret}` : c.keystring);

async function etsyGet(p, { auth = false, deps = {} } = {}) {
  const c = deps.config ?? etsyConfig();
  if (!c?.keystring) throw new Error('Etsy is not set up. The owner runs npm.cmd run set-etsy once.');
  const f = deps.fetch ?? globalThis.fetch;
  const token = auth ? await accessToken(c, deps) : null;
  const go = (plain) => f(`${API}${p}`, { headers: { 'x-api-key': keyHeader(c, plain), ...(token ? { authorization: `Bearer ${token}` } : {}) }, signal: AbortSignal.timeout(20_000) });
  let r = await go(false);
  if ((r.status === 401 || r.status === 403) && c.secret && !auth) r = await go(true);
  if (!r.ok) throw new Error(`Etsy answered ${r.status}`);
  return r.json();
}

/** Check the saved key with a harmless call. */
export async function pingEtsy(config, f = globalThis.fetch) {
  await etsyGet('/openapi-ping', { deps: { config, fetch: f } });
  return true;
}

const money = (p) => (p ? Math.round((p.amount / (p.divisor || 100)) * 100) / 100 : null);
const row = (l) => ({
  title: l.title, price: money(l.price), currency: l.price?.currency_code, favorites: l.num_favorers, views: l.views, quantity: l.quantity,
  tags: (l.tags || []).slice(0, 13), madeAt: l.creation_timestamp ? new Date(l.creation_timestamp * 1000).toISOString().slice(0, 10) : null, url: l.url, shopId: l.shop_id,
});

/** Active public listings for a search, compact enough for a prompt. */
export async function searchListings(input, deps) {
  const q = new URLSearchParams({ keywords: String(input.keywords || '').slice(0, 200), limit: String(Math.min(50, Math.max(1, Number(input.limit) || 25))) });
  if (['score', 'created', 'price', 'updated'].includes(input.sort_on)) q.set('sort_on', input.sort_on);
  if (input.min_price) q.set('min_price', String(input.min_price));
  if (input.max_price) q.set('max_price', String(input.max_price));
  const data = await etsyGet(`/listings/active?${q}`, { deps });
  const rows = (data.results || []).map(row);
  const prices = rows.map((r) => r.price).filter((n) => n != null).sort((a, b) => a - b);
  return { total: data.count, shown: rows.length, medianPrice: prices.length ? prices[Math.floor(prices.length / 2)] : null, listings: rows };
}

/** The owner's own shop: its numbers and active listings (needs the owner's sign-in). */
export async function myShop(deps) {
  const c = deps?.config ?? etsyConfig();
  if (!c?.tokens?.refresh) throw new Error('The owner has not connected their Etsy shop yet.');
  const shops = await etsyGet(`/users/${c.tokens.userId}/shops`, { auth: true, deps });
  const shop = shops.shop_id ? shops : shops.results?.[0];
  if (!shop) return { shop: null, note: 'This Etsy account has no shop yet.' };
  const listings = await etsyGet(`/shops/${shop.shop_id}/listings?state=active&limit=50`, { auth: true, deps });
  return {
    shop: { name: shop.shop_name, sales: shop.transaction_sold_count, favorites: shop.num_favorers, activeListings: shop.listing_active_count, reviews: shop.review_count, rating: shop.review_average, currency: shop.currency_code, url: shop.url },
    listings: (listings.results || []).map(row),
  };
}

// ---- sign-in (OAuth 2 with PKCE); tokens stay in the secrets folder ----
const pending = new Map();
const b64url = (b) => b.toString('base64url');

export function authUrl(redirectUri) {
  const c = etsyConfig();
  if (!c?.keystring) return null;
  const verifier = b64url(crypto.randomBytes(48));
  const state = b64url(crypto.randomBytes(18));
  pending.set(state, { verifier, redirectUri, at: Date.now() });
  const q = new URLSearchParams({ response_type: 'code', client_id: c.keystring, redirect_uri: redirectUri, scope: ETSY_SCOPES, state, code_challenge: b64url(crypto.createHash('sha256').update(verifier).digest()), code_challenge_method: 'S256' });
  return `https://www.etsy.com/oauth/connect?${q}`;
}

async function tokenCall(body, f = globalThis.fetch) {
  const r = await f('https://api.etsy.com/v3/public/oauth/token', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(body), signal: AbortSignal.timeout(20_000) });
  if (!r.ok) throw new Error(`Etsy sign-in answered ${r.status}`);
  return r.json();
}
const keep = (t) => ({ access: t.access_token, refresh: t.refresh_token, expiresAt: Date.now() + (t.expires_in - 60) * 1000, userId: String(t.access_token).split('.')[0] });

export async function finishAuth(code, state) {
  const p = pending.get(state);
  pending.delete(state);
  if (!p || Date.now() - p.at > 10 * 60_000) throw new Error('This sign-in link expired. Start again from the app.');
  const c = etsyConfig();
  const t = await tokenCall({ grant_type: 'authorization_code', client_id: c.keystring, redirect_uri: p.redirectUri, code, code_verifier: p.verifier });
  c.tokens = keep(t);
  saveEtsy(c);
  try { const s = await myShop(); c.shopName = s.shop?.name ?? null; saveEtsy(c); } catch { /* the name is only for display */ }
  return c.shopName;
}

async function accessToken(c, deps = {}) {
  if (!c.tokens?.refresh) throw new Error('The owner has not connected their Etsy shop yet.');
  if (c.tokens.expiresAt > Date.now()) return c.tokens.access;
  const t = await tokenCall({ grant_type: 'refresh_token', client_id: c.keystring, refresh_token: c.tokens.refresh }, deps.fetch);
  c.tokens = keep(t);
  if (!deps.config) saveEtsy(c);
  return c.tokens.access;
}

// ---- the tools agents get in their runs ----
export const ETSY_TOOLS = [
  { name: 'etsy_search', description: 'Search active Etsy listings (read-only). Returns titles, prices, favorites, views, tags and links, plus the total count and median price. Use it to measure demand, competition and price ranges for a product idea.', input_schema: { type: 'object', properties: { keywords: { type: 'string', description: 'What a buyer would type, e.g. "custom pet portrait"' }, sort_on: { type: 'string', enum: ['score', 'created', 'price', 'updated'] }, min_price: { type: 'number' }, max_price: { type: 'number' }, limit: { type: 'integer', minimum: 1, maximum: 50 } }, required: ['keywords'] } },
  { name: 'etsy_my_shop', description: "The owner's own Etsy shop (read-only): sales, favorites, reviews and active listings. Only works after the owner has connected their shop.", input_schema: { type: 'object', properties: {} } },
];
/** Run one Etsy tool call; errors come back as text the model can read. */
export async function runEtsyTool(name, input, deps) {
  try {
    const out = name === 'etsy_search' ? await searchListings(input || {}, deps) : name === 'etsy_my_shop' ? await myShop(deps) : { error: `unknown tool ${name}` };
    return { content: JSON.stringify(out).slice(0, 30_000), isError: !!out.error };
  } catch (e) {
    return { content: e.message, isError: true };
  }
}
