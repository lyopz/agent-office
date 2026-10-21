// Instagram for the trend scouts, through Meta's Graph API with the owner's own Instagram
// professional account: hashtag search (which posts lead a hashtag, their captions and counts).
// The token and account id live only on this PC in the secrets folder; they are never logged,
// sent to the app or put in a prompt. Read-only: nothing here posts, likes or follows.
// Meta allows 30 unique hashtags per account per rolling 7 days, so the recent ones are kept here.
import fs from 'node:fs';
import path from 'node:path';
import { secretsDir } from './key-file.mjs';

const GRAPH = 'https://graph.facebook.com/v21.0';
const FILE = () => path.join(secretsDir(), 'instagram.json');
const WEEK = 7 * 86_400_000;
export const HASHTAG_LIMIT = 30;

export function instagramConfig() {
  try { return JSON.parse(fs.readFileSync(FILE(), 'utf8')); } catch { return null; }
}
export function saveInstagram(cfg) {
  fs.mkdirSync(secretsDir(), { recursive: true });
  const tmp = `${FILE()}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(cfg), { mode: 0o600 });
  fs.renameSync(tmp, FILE());
}
/** What the app may see: whether Instagram is connected and how many hashtags this week's allowance has left. */
export function instagramPublic(cfg = instagramConfig()) {
  const used = (cfg?.recent || []).filter((r) => Date.now() - Date.parse(r.at) < WEEK).length;
  return { configured: !!(cfg?.token && cfg?.igUserId), username: cfg?.username ?? null, hashtagsLeft: cfg ? Math.max(0, HASHTAG_LIMIT - used) : null };
}

// READ ONLY: every call here is a GET. Nothing in this file can post, comment, like, follow or change the owner's account, and the scopes asked for (instagram_basic, pages_show_list, pages_read_engagement) are read scopes.
async function graphGet(p, params, cfg, f = globalThis.fetch) {
  const u = new URL(`${GRAPH}/${p}`);
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, String(v));
  u.searchParams.set('access_token', cfg.token);
  const r = await f(u, { method: 'GET', signal: AbortSignal.timeout(20_000) });
  const data = await r.json().catch(() => ({}));
  if (!r.ok || data.error) {
    const e = data.error || {};
    const why = e.code === 190 ? 'the token has expired or was revoked: run npm.cmd run set-instagram again' : e.code === 10 || e.code === 200 ? 'the app lacks permission (instagram_basic and the Instagram Public Content Access feature are needed, approved in App Review)' : e.message || `HTTP ${r.status}`;
    throw new Error(`Instagram: ${why}`);
  }
  return data;
}

/** Check a token and account id and return the account's username; throws when Meta refuses. */
export async function pingInstagram(cfg, f = globalThis.fetch) {
  const me = await graphGet(cfg.igUserId, { fields: 'id,username' }, cfg, f);
  return me.username || '';
}

export const INSTAGRAM_TOOL = {
  name: 'trends_instagram',
  description: "Instagram hashtag search through the owner's connected Instagram account (Meta Graph API): the top posts under a hashtag with their captions, like and comment counts, dates and links. Text and numbers only, never the pictures: a post is someone's work, so you take the phrase and the joke's grammar, never the image. Meta allows 30 different hashtags per week, so look up a hashtag only when it matters. Read-only: this tool cannot post, like, comment or follow, and nothing else can either.",
  input_schema: { type: 'object', properties: { hashtag: { type: 'string', description: 'one hashtag without #, e.g. memeshirt' }, kind: { type: 'string', enum: ['top', 'recent'], description: 'top (default) or recent posts' }, limit: { type: 'integer', minimum: 1, maximum: 25 } }, required: ['hashtag'] },
};

/** Top or recent posts for one hashtag: captions, counts, permalinks. No media URLs leave this function. */
export async function instagramHashtag(input = {}, deps = {}) {
  const cfg = deps.config ?? instagramConfig();
  if (!cfg?.token || !cfg?.igUserId) throw new Error('Instagram is not connected: the owner runs npm.cmd run set-instagram once.');
  const tag = String(input.hashtag || '').replace(/^#/, '').trim().toLowerCase().replace(/[^\p{L}\p{N}_]/gu, '');
  if (!tag) throw new Error('Give one hashtag.');
  const f = deps.fetch ?? globalThis.fetch;
  const recent = (cfg.recent || []).filter((r) => Date.now() - Date.parse(r.at) < WEEK);
  if (!recent.some((r) => r.tag === tag) && recent.length >= HASHTAG_LIMIT) throw new Error(`Instagram allows ${HASHTAG_LIMIT} different hashtags a week and they are used up until ${new Date(Date.parse(recent[0].at) + WEEK).toDateString()}; search a hashtag already looked up this week, or wait.`);
  const found = await graphGet('ig_hashtag_search', { user_id: cfg.igUserId, q: tag }, cfg, f);
  const id = found.data?.[0]?.id;
  if (!id) return { hashtag: tag, posts: [], note: 'No such hashtag on Instagram.' };
  const kind = input.kind === 'recent' ? 'recent_media' : 'top_media';
  const limit = Math.max(1, Math.min(25, Number(input.limit) || 15));
  const media = await graphGet(`${id}/${kind}`, { user_id: cfg.igUserId, fields: 'id,caption,media_type,permalink,like_count,comments_count,timestamp', limit }, cfg, f);
  if (!recent.some((r) => r.tag === tag)) { cfg.recent = [...recent, { tag, at: new Date().toISOString() }]; (deps.save ?? saveInstagram)(cfg); }
  const posts = (media.data || []).map((m) => ({ caption: String(m.caption || '').replace(/\s+/g, ' ').slice(0, 300), type: m.media_type, likes: m.like_count ?? null, comments: m.comments_count ?? null, at: m.timestamp, link: m.permalink }));
  return { hashtag: tag, kind: input.kind === 'recent' ? 'recent' : 'top', posts, hashtagsLeftThisWeek: Math.max(0, HASHTAG_LIMIT - (cfg.recent || []).length), note: 'Captions and counts only; the pictures are their authors\' work and are not for products.' };
}
