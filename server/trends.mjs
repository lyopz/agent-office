// Trend research for the agents, from public sources only: Google's daily trending searches
// (a public RSS feed, free, no login) and free-to-use images (public domain and CC0, from
// Wikimedia Commons and Openverse). TikTok's Creative Center and Pinterest Trends only
// render in a browser, and Instagram has no public trend page, so those go through
// web_search for fresh roundups; TREND_SOURCES says how, so agents never log in, scrape,
// or use the owner's own social accounts.
const GOOGLE_TRENDS = 'https://trends.google.com/trending/rss';
const COMMONS = 'https://commons.wikimedia.org/w/api.php';
const OPENVERSE = 'https://api.openverse.org/v1/images/';
const MAX_ITEMS = 25;
const MAX_ASSETS = 12;
const UA = 'the-brain/1.0 (research for the owner; a few public reads per task)';

export const GOOGLE_TRENDS_TOOL = {
  name: 'trends_google',
  description: "Google's trending searches for the last day (public RSS feed, free, no search fee, no login): each rising search with its approximate traffic and the news headlines behind it. Use it to see whether a meme, phrase or moment born on TikTok or Instagram is breaking into general search; a phrase that is here and in a fresh TikTok roundup is real. Then verify it on Etsy with etsy_search.",
  input_schema: { type: 'object', properties: { geo: { type: 'string', description: 'two-letter country code, default US' }, limit: { type: 'integer', description: `how many searches, 1 to ${MAX_ITEMS}, default ${MAX_ITEMS}` } } },
};
export const ASSETS_TOOL = {
  name: 'assets_public_domain',
  description: "Find images that are free to use on products: public domain and CC0 only, from Wikimedia Commons (and Openverse when Commons has little). Returns each image's title, creator, licence, source page and file URL. Use it for vintage illustrations, botanical plates, old maps, engravings, posters and icons an original design can build on; never for memes, logos, characters or photos of real people. Record every asset you use (title, source URL, licence) in design_save's assets so the owner sees where it came from, and open the source page to confirm the licence before using it.",
  input_schema: { type: 'object', properties: { query: { type: 'string', description: 'what to look for, e.g. "vintage botanical rose engraving"' }, limit: { type: 'integer', description: `how many, 1 to ${MAX_ASSETS}` } }, required: ['query'] },
};
export const TREND_TOOLS = [GOOGLE_TRENDS_TOOL, ASSETS_TOOL];

/** How agents may look at TikTok and Instagram trends: public pages only, and how each one is reached. */
export const TREND_SOURCES = `TRENDS (TikTok, Instagram and the rest): the owner wants TikTok and Instagram trends checked for design ideas, and you may do that from public sources only: never log in to a social site, never use the owner's accounts, never a scraper or a scraping service. TikTok's Creative Center (free and public at ads.tiktok.com/business/creativecenter) and Pinterest Trends only render in a browser, so web_fetch returns nothing from them; get TikTok trends through web_search for this week's roundups (for example "TikTok trending hashtags this week", "TikTok trends this month", "trending TikTok sounds this week", "TikTok Creative Center top hashtags" with the month and year, and TikTok's own newsroom and Creative Center articles that appear in results) and read the two freshest with web_fetch. Instagram has no public trend page and its hashtag API needs a Meta developer app the owner has not set up, so Instagram trends come from the same kind of weekly roundups (Later, Hootsuite, Sprout Social, Buffer and others publish them) and from press coverage. trends_google (free, no search fee) shows what is breaking into general search right now, with the news behind each search; a phrase that is there and in a fresh TikTok roundup is real. Then measure it with etsy_search: how many listings already use the phrase, their prices and favorites; a trend with real search and few listings is the opportunity, one with thousands of listings is late. Date every trend (first seen, source), treat anything older than four weeks as fading. PINTEREST: Pinterest Trends and pin pages also render only in a browser and Pinterest's API needs a developer app the owner has not set up, so use Pinterest through web_search (add "pinterest" to a query: which styles, phrases and products recur) for inspiration only; a pin is someone else's work, never copy one.`;

/** What a design may and may not use, so nothing the owner lists is copied or trademarked. */
export const COPYRIGHT_RULES = `ORIGINAL ONLY: a design the owner lists must be your own work. Never copy a meme image, a character, a logo, a brand, a celebrity's name or likeness, song lyrics or another seller's design; a meme format or a trend may inspire an original phrase and original art, nothing more. Before you build on a phrase, web_search it with the word trademark (and "site:uspto.gov") and drop it if a live registration or a known brand owns it; say in the design's title that you checked. Images you did not draw yourself come only from assets_public_domain (public domain and CC0), with each one's title, source URL and licence saved in design_save's assets.`;

/** True when a task (or its agent) is about trends, memes or social video, so the brief explains the sources. */
export const trendTask = (task, agentName = '') => /\btrend|tiktok|tik tok|instagram|\breels?\b|viral|meme|hashtag|short.?video|what.?s selling|what sells/i.test(`${task?.title || ''} ${task?.detail || ''} ${agentName || ''}`);

const unescape = (t) => String(t || '').replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").trim();
const tag = (xml, name) => { const m = xml.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`)); return m ? unescape(m[1]) : ''; };

/** The items of a Google Trends RSS feed: title, approximate traffic, when, and the news behind each. */
export function parseTrendsRss(xml) {
  const items = [];
  for (const m of String(xml || '').matchAll(/<item>([\s\S]*?)<\/item>/g)) {
    const it = m[1];
    const news = [...it.matchAll(/<ht:news_item>([\s\S]*?)<\/ht:news_item>/g)].map((n) => ({ title: tag(n[1], 'ht:news_item_title'), source: tag(n[1], 'ht:news_item_source'), url: tag(n[1], 'ht:news_item_url') })).filter((n) => n.title).slice(0, 3);
    const title = tag(it, 'title');
    if (title) items.push({ title, traffic: tag(it, 'ht:approx_traffic') || null, published: tag(it, 'pubDate') || null, news });
  }
  return items;
}

/** Google's trending searches for a country, from the public feed. */
export async function googleTrends(input = {}, deps = {}) {
  const f = deps.fetch ?? globalThis.fetch;
  const geo = /^[A-Za-z]{2}$/.test(input?.geo || '') ? input.geo.toUpperCase() : 'US';
  const limit = Math.min(MAX_ITEMS, Math.max(1, Number(input?.limit) || MAX_ITEMS));
  const r = await f(`${GOOGLE_TRENDS}?geo=${geo}`, { headers: { 'user-agent': 'the-brain/1.0 (trend research for the owner; reads the public feed once per task)' } });
  if (!r.ok) throw new Error(`Google Trends answered ${r.status}`);
  const items = parseTrendsRss(await r.text()).slice(0, limit);
  return { source: `Google Trends daily trending searches, ${geo}`, url: `${GOOGLE_TRENDS}?geo=${geo}`, fetchedAt: new Date().toISOString(), items };
}

const PUBLIC_DOMAIN = /public domain|\bcc0\b|\bpdm\b|no known copyright/i;
const strip = (html) => String(html || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

/** Wikimedia Commons files for a query, public domain and CC0 only. */
export async function commonsAssets(query, limit, deps = {}) {
  const f = deps.fetch ?? globalThis.fetch;
  const u = `${COMMONS}?action=query&format=json&generator=search&gsrnamespace=6&gsrlimit=${Math.min(50, limit * 4)}&gsrsearch=${encodeURIComponent(query)}&prop=imageinfo&iiprop=url|extmetadata|size&iiurlwidth=1024&iiextmetadatafilter=LicenseShortName|Artist|ObjectName|ImageDescription`;
  const r = await f(u, { headers: { 'user-agent': UA } });
  if (!r.ok) throw new Error(`Wikimedia Commons answered ${r.status}`);
  const data = await r.json();
  const out = [];
  for (const pg of Object.values(data?.query?.pages || {})) {
    const ii = pg.imageinfo?.[0]; const md = ii?.extmetadata || {};
    const licence = md.LicenseShortName?.value || '';
    if (!ii || !PUBLIC_DOMAIN.test(licence)) continue;
    out.push({ title: strip(md.ObjectName?.value) || String(pg.title || '').replace(/^File:/, ''), creator: strip(md.Artist?.value) || null, licence, source: 'Wikimedia Commons', page: ii.descriptionurl, file: ii.url, preview: ii.thumburl || null, width: ii.width, height: ii.height, about: strip(md.ImageDescription?.value).slice(0, 200) || null });
    if (out.length >= limit) break;
  }
  return out;
}

/** Openverse images for a query, public domain and CC0 only (anonymous use allows a few calls an hour). */
export async function openverseAssets(query, limit, deps = {}) {
  const f = deps.fetch ?? globalThis.fetch;
  const r = await f(`${OPENVERSE}?q=${encodeURIComponent(query)}&license=cc0,pdm&page_size=${limit}`, { headers: { 'user-agent': UA, accept: 'application/json' } });
  if (r.status === 429) throw new Error('Openverse allows only a few anonymous searches an hour; try later or use Wikimedia Commons results');
  if (!r.ok) throw new Error(`Openverse answered ${r.status}`);
  const data = await r.json();
  return (data?.results || []).filter((x) => PUBLIC_DOMAIN.test(`${x.license} ${x.license_version || ''}`) || ['cc0', 'pdm'].includes(String(x.license).toLowerCase())).slice(0, limit)
    .map((x) => ({ title: x.title || null, creator: x.creator || null, licence: String(x.license || '').toUpperCase() + (x.license_url ? ` (${x.license_url})` : ''), source: `Openverse (${x.source || x.provider || 'provider'})`, page: x.foreign_landing_url, file: x.url, preview: x.thumbnail || null, width: x.width, height: x.height, about: null }));
}

/** Free-to-use images for a design: Commons first, Openverse when Commons has little. */
export async function publicDomainAssets(input = {}, deps = {}) {
  const query = String(input?.query || '').trim();
  if (!query) throw new Error('Say what to look for in query');
  const limit = Math.min(MAX_ASSETS, Math.max(1, Number(input?.limit) || MAX_ASSETS));
  const notes = [];
  let items = [];
  try { items = await commonsAssets(query, limit, deps); } catch (e) { notes.push(e.message); }
  if (items.length < 3) { try { items = [...items, ...(await openverseAssets(query, limit - items.length, deps))]; } catch (e) { notes.push(e.message); } }
  return { query, licence_filter: 'public domain and CC0 only', items, notes, note: 'Open each page URL and confirm the licence before using the file; save the title, page URL and licence of every asset you use in design_save assets.' };
}

/** Run one of the trend tools for an agent; the result is text for the model. */
export async function runTrendTool(name, input, deps = {}) {
  try {
    if (name === GOOGLE_TRENDS_TOOL.name) return { content: JSON.stringify(await googleTrends(input, deps)), isError: false };
    if (name === ASSETS_TOOL.name) return { content: JSON.stringify(await publicDomainAssets(input, deps)), isError: false };
    return { content: `Unknown trend tool ${name}`, isError: true };
  } catch (e) { return { content: `Trends: ${e.message}`, isError: true }; }
}
