// Pinterest for the trend scouts, through Pinterest's API with the owner's own app token:
// trending keywords by region and pin search for ideas (titles, descriptions and links only, never
// the pictures: a pin is someone's work). The token lives only on this PC in the secrets folder.
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
export function pinterestPublic(cfg = pinterestConfig()) {
  return { configured: !!cfg?.token, username: cfg?.username ?? null };
}

async function pinGet(p, params, cfg, f = globalThis.fetch) {
  const u = new URL(`${API}/${p}`);
  for (const [k, v] of Object.entries(params)) if (v != null && v !== '') u.searchParams.set(k, String(v));
  const r = await f(u, { headers: { authorization: `Bearer ${cfg.token}`, accept: 'application/json' }, signal: AbortSignal.timeout(20_000) });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) {
    const why = r.status === 401 ? 'the token has expired or was revoked: run npm.cmd run set-pinterest again' : r.status === 403 ? `the app may not call this yet (${data.message || 'scope or access level'}); trends need an approved app with standard access` : data.message || `HTTP ${r.status}`;
    throw new Error(`Pinterest: ${why}`);
  }
  return data;
}

export async function pingPinterest(cfg, f = globalThis.fetch) {
  const me = await pinGet('user_account', {}, cfg, f);
  return me.username || '';
}

export const PINTEREST_TOOL = {
  name: 'trends_pinterest',
  description: "Pinterest through the owner's connected Pinterest app: trending keywords for a region (growing, monthly, yearly or seasonal) and a pin search that returns titles, descriptions and links only, for ideas. Never the pictures: a pin is someone's work and is never a free image; take the phrase and the idea, make your own.",
  input_schema: { type: 'object', properties: { action: { type: 'string', enum: ['trends', 'search'] }, query: { type: 'string', description: 'for search: what to look for, e.g. "funny fish shirt"' }, region: { type: 'string', description: 'for trends: US (default), CA, GB, DE, FR, ...' }, trend_type: { type: 'string', enum: ['growing', 'monthly', 'yearly', 'seasonal'] }, interests: { type: 'string', description: 'for trends: comma-separated interest filter, optional' }, limit: { type: 'integer', minimum: 1, maximum: 25 } }, required: ['action'] },
};

export async function pinterestTool(input = {}, deps = {}) {
  const cfg = deps.config ?? pinterestConfig();
  if (!cfg?.token) throw new Error('Pinterest is not connected: the owner runs npm.cmd run set-pinterest once.');
  const f = deps.fetch ?? globalThis.fetch;
  const limit = Math.max(1, Math.min(25, Number(input.limit) || 15));
  if (input.action === 'search') {
    const q = String(input.query || '').trim().slice(0, 120);
    if (!q) throw new Error('Give a query.');
    const data = await pinGet('search/pins', { query: q, page_size: limit }, cfg, f);
    return { query: q, pins: (data.items || []).map((p) => ({ title: String(p.title || '').slice(0, 160), description: String(p.description || '').replace(/\s+/g, ' ').slice(0, 300), link: p.link || `https://www.pinterest.com/pin/${p.id}/`, board: p.board_owner?.username ?? null, at: p.created_at })), note: 'Titles, descriptions and links only; pins are their authors\' work.' };
  }
  const region = String(input.region || 'US').toUpperCase().replace(/[^A-Z+]/g, '').slice(0, 5) || 'US';
  const type = ['growing', 'monthly', 'yearly', 'seasonal'].includes(input.trend_type) ? input.trend_type : 'growing';
  const data = await pinGet(`trends/keywords/${region}/top/${type}`, { interests: input.interests, limit }, cfg, f);
  return { region, trend_type: type, trends: (data.trends || []).slice(0, limit).map((t) => ({ keyword: t.keyword, pct_growth_wow: t.pct_growth_wow ?? null, pct_growth_yoy: t.pct_growth_yoy ?? null, time_series: Array.isArray(t.time_series) ? t.time_series.slice(-8) : undefined })) };
}
