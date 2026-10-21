// Instagram for the trend scouts, through Meta's API with the owner's own Instagram professional
// account. Two kinds of token exist, and both are accepted:
//   kind 'instagram': a token from the app dashboard's "Instagram > API setup with Instagram login"
//     (scope instagram_business_basic, host graph.instagram.com). It sees the owner's own account only:
//     profile numbers and own posts. Meta does not offer hashtag search on this route.
//   kind 'facebook': a token from "Facebook Login for Business" (instagram_basic, pages_show_list,
//     host graph.facebook.com) with the Instagram Public Content Access feature. Adds hashtag search:
//     which posts lead a hashtag, their captions and counts. 30 unique hashtags per rolling 7 days.
// The token and account id live only on this PC in the secrets folder; they are never logged,
// sent to the app or put in a prompt. Read-only: nothing here posts, likes, comments or follows.
import fs from 'node:fs';
import path from 'node:path';
import { secretsDir } from './key-file.mjs';

const VERSION = 'v21.0';
const HOSTS = { facebook: `https://graph.facebook.com/${VERSION}`, instagram: `https://graph.instagram.com/${VERSION}` };
const FILE = () => path.join(secretsDir(), 'instagram.json');
const WEEK = 7 * 86_400_000;
export const HASHTAG_LIMIT = 30;
const MEDIA_FIELDS = 'id,caption,media_type,permalink,like_count,comments_count,timestamp';

export function instagramConfig() {
  try { return JSON.parse(fs.readFileSync(FILE(), 'utf8')); } catch { return null; }
}
export function saveInstagram(cfg) {
  fs.mkdirSync(secretsDir(), { recursive: true });
  const tmp = `${FILE()}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(cfg), { mode: 0o600 });
  fs.renameSync(tmp, FILE());
}
const kindOf = (cfg) => (cfg?.kind === 'instagram' ? 'instagram' : 'facebook');
/** What the app may see: whether Instagram is connected, which token kind, and the hashtag allowance left. */
export function instagramPublic(cfg = instagramConfig()) {
  const used = (cfg?.recent || []).filter((r) => Date.now() - Date.parse(r.at) < WEEK).length;
  const configured = !!(cfg?.token && cfg?.igUserId);
  const kind = configured ? kindOf(cfg) : null;
  return { configured, kind, hashtags: kind === 'facebook', username: cfg?.username ?? null, hashtagsLeft: configured && kind === 'facebook' ? Math.max(0, HASHTAG_LIMIT - used) : null };
}

// READ ONLY: every call here is a GET. Nothing in this file can post, comment, like, follow or change the owner's account; the scopes used (instagram_business_basic, or instagram_basic + pages_show_list) are read scopes.
async function graphGet(p, params, cfg, f = globalThis.fetch) {
  const u = new URL(`${HOSTS[kindOf(cfg)]}/${p}`);
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, String(v));
  u.searchParams.set('access_token', cfg.token);
  const r = await f(u, { method: 'GET', signal: AbortSignal.timeout(20_000) });
  const data = await r.json().catch(() => ({}));
  if (!r.ok || data.error) {
    const e = data.error || {};
    const why = e.code === 190 ? `Meta did not accept the token (${e.message || 'expired, revoked or unreadable'}): run npm.cmd run set-instagram again`
      : e.code === 10 || e.code === 200 || e.code === 3 ? `the token lacks permission for this (${e.message || 'permission error'}); hashtag search needs a Facebook Login for Business token with instagram_basic, pages_show_list and the Instagram Public Content Access feature`
      : e.message || `HTTP ${r.status}`;
    throw new Error(`Instagram: ${why}`);
  }
  return data;
}

/** Check a token (and account id for the Facebook kind); returns {igUserId, username}. Throws when Meta refuses. */
export async function pingInstagram(cfg, f = globalThis.fetch) {
  if (kindOf(cfg) === 'instagram') {
    const me = await graphGet('me', { fields: 'user_id,username' }, cfg, f);
    return { igUserId: String(me.user_id || me.id || ''), username: me.username || '' };
  }
  const me = await graphGet(cfg.igUserId, { fields: 'id,username' }, cfg, f);
  return { igUserId: String(me.id || cfg.igUserId), username: me.username || '' };
}

export const INSTAGRAM_TOOL = {
  name: 'trends_instagram',
  description: "Instagram through the owner's connected Instagram account (Meta's API), read-only. account: the owner's own profile numbers (followers, posts). my_posts: the owner's own recent posts with captions, likes and comments, to see what of theirs lands. hashtag: the top posts under a hashtag with captions, like and comment counts, dates and links (only when the connection is a Facebook Login token with Public Content Access; otherwise the tool says so). Text and numbers only, never the pictures: a post is someone's work, so you take the phrase and the joke's grammar, never the image. Meta allows 30 different hashtags per week, so look up a hashtag only when it matters. This tool cannot post, like, comment or follow, and nothing else can either.",
  input_schema: { type: 'object', properties: { action: { type: 'string', enum: ['hashtag', 'account', 'my_posts'], description: 'default hashtag' }, hashtag: { type: 'string', description: 'for hashtag: one hashtag without #, e.g. memeshirt' }, kind: { type: 'string', enum: ['top', 'recent'], description: 'for hashtag: top (default) or recent posts' }, limit: { type: 'integer', minimum: 1, maximum: 25 } } },
};

const postView = (m) => ({ caption: String(m.caption || '').replace(/\s+/g, ' ').slice(0, 300), type: m.media_type, likes: m.like_count ?? null, comments: m.comments_count ?? null, at: m.timestamp, link: m.permalink });
const connected = (deps) => {
  const cfg = deps.config ?? instagramConfig();
  if (!cfg?.token || !cfg?.igUserId) throw new Error('Instagram is not connected: the owner runs npm.cmd run set-instagram once.');
  return cfg;
};
const self = (cfg) => (kindOf(cfg) === 'instagram' ? 'me' : cfg.igUserId);

/** The owner's own account numbers. Works with both token kinds. */
export async function instagramAccount(deps = {}) {
  const cfg = connected(deps);
  const me = await graphGet(self(cfg), { fields: 'username,followers_count,media_count' }, cfg, deps.fetch ?? globalThis.fetch);
  return { username: me.username ?? cfg.username ?? null, followers: me.followers_count ?? null, posts: me.media_count ?? null, hashtagSearch: kindOf(cfg) === 'facebook' };
}
/** The owner's own recent posts: captions and counts, no media URLs. Works with both token kinds. */
export async function instagramOwnPosts(input = {}, deps = {}) {
  const cfg = connected(deps);
  const limit = Math.max(1, Math.min(25, Number(input.limit) || 15));
  const media = await graphGet(`${self(cfg)}/media`, { fields: MEDIA_FIELDS, limit }, cfg, deps.fetch ?? globalThis.fetch);
  return { account: cfg.username ?? null, posts: (media.data || []).map(postView), note: 'The owner\'s own posts: captions and counts only.' };
}

/** Top or recent posts for one hashtag: captions, counts, permalinks. No media URLs leave this function. */
export async function instagramHashtag(input = {}, deps = {}) {
  const cfg = connected(deps);
  if (kindOf(cfg) !== 'facebook') throw new Error("hashtag search is not available on this connection: the token comes from Instagram login, which Meta limits to the owner's own account (use action account or my_posts). Hashtag search needs a Facebook Login for Business token with Instagram Public Content Access; until then use web search for fresh Instagram trend roundups.");
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
  const media = await graphGet(`${id}/${kind}`, { user_id: cfg.igUserId, fields: MEDIA_FIELDS, limit }, cfg, f);
  if (!recent.some((r) => r.tag === tag)) { cfg.recent = [...recent, { tag, at: new Date().toISOString() }]; (deps.save ?? saveInstagram)(cfg); }
  return { hashtag: tag, kind: input.kind === 'recent' ? 'recent' : 'top', posts: (media.data || []).map(postView), hashtagsLeftThisWeek: Math.max(0, HASHTAG_LIMIT - (cfg.recent || []).length), note: 'Captions and counts only; the pictures are their authors\' work and are not for products.' };
}

/** One entry point for the trends_instagram tool. */
export async function instagramTool(input = {}, deps = {}) {
  if (input.action === 'account') return instagramAccount(deps);
  if (input.action === 'my_posts') return instagramOwnPosts(input, deps);
  return instagramHashtag(input, deps);
}
