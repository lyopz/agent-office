// Trend and asset research from public sources: Google Trends RSS, Wikimedia Commons and Openverse (public domain only).
import { describe, expect, test } from 'vitest';
import { ASSETS_TOOL, COPYRIGHT_RULES, GOOGLE_TRENDS_TOOL, TREND_SOURCES, parseTrendsRss, publicDomainAssets, runTrendTool, trendTask } from '../server/trends.mjs';

const RSS = `<?xml version="1.0"?><rss><channel><item><title>katie boulter</title><ht:approx_traffic>200+</ht:approx_traffic><pubDate>Tue, 20 Oct 2026 13:00:00 -0700</pubDate><ht:news_item><ht:news_item_title>Boulter &amp; co win</ht:news_item_title><ht:news_item_url>https://news.example/a</ht:news_item_url><ht:news_item_source>Example News</ht:news_item_source></ht:news_item></item><item><title><![CDATA[arby's]]></title><ht:approx_traffic>1000+</ht:approx_traffic></item></channel></rss>`;

describe('trends', () => {
  test('the Google Trends feed becomes titles, traffic and the news behind each', () => {
    expect(parseTrendsRss(RSS)).toEqual([
      { title: 'katie boulter', traffic: '200+', published: 'Tue, 20 Oct 2026 13:00:00 -0700', news: [{ title: 'Boulter & co win', source: 'Example News', url: 'https://news.example/a' }] },
      { title: "arby's", traffic: '1000+', published: null, news: [] },
    ]);
  });

  test('trends_google reads the public feed for a country with a limit', async () => {
    const urls: string[] = [];
    const fetch = async (u: string) => { urls.push(u); return { ok: true, status: 200, text: async () => RSS }; };
    const r = await runTrendTool('trends_google', { geo: 'gb', limit: 1 }, { fetch });
    expect(urls).toEqual(['https://trends.google.com/trending/rss?geo=GB']);
    const out = JSON.parse(r.content);
    expect(out.items).toHaveLength(1);
    expect(out.source).toMatch(/GB/);
    expect(r.isError).toBe(false);
  });

  test('a trend task is one about trends, TikTok, Instagram, memes or hashtags', () => {
    expect(trendTask({ title: 'Trend Scout: rising meme phrases', detail: '' })).toBe(true);
    expect(trendTask({ title: 'Research', detail: 'check tiktok and instagram for mom shirts' })).toBe(true);
    expect(trendTask({ title: 'Mug demand', detail: 'prices' }, 'Trend Scout')).toBe(true);
    expect(trendTask({ title: 'Mug demand', detail: 'prices' }, 'Pricing')).toBe(false);
    expect(TREND_SOURCES).toMatch(/never log in/);
    expect(TREND_SOURCES).toMatch(/Pinterest/);
    expect(COPYRIGHT_RULES).toMatch(/trademark/);
    expect([GOOGLE_TRENDS_TOOL.name, ASSETS_TOOL.name]).toEqual(['trends_google', 'assets_public_domain']);
  });

  test('assets_public_domain keeps only public-domain and CC0 files from Commons, and falls back to Openverse', async () => {
    const urls: string[] = [];
    const commons = { query: { pages: {
      1: { title: 'File:Rose.jpg', imageinfo: [{ url: 'https://u/rose.jpg', descriptionurl: 'https://commons/Rose', thumburl: 'https://u/rose-s.jpg', width: 3000, height: 2000, extmetadata: { LicenseShortName: { value: 'Public domain' }, Artist: { value: '<a href="x">Redouté</a>' }, ObjectName: { value: 'Rosa gallica' } } }] },
      2: { title: 'File:Modern.jpg', imageinfo: [{ url: 'https://u/m.jpg', descriptionurl: 'https://commons/M', extmetadata: { LicenseShortName: { value: 'CC BY-SA 4.0' } } }] },
    } } };
    const openverse = { results: [{ title: 'Old map', creator: 'Anon', license: 'cc0', license_url: 'https://cc/0', foreign_landing_url: 'https://ov/map', url: 'https://u/map.jpg', source: 'rawpixel', width: 10, height: 10 }, { title: 'By image', license: 'by', foreign_landing_url: 'https://ov/by', url: 'https://u/by.jpg' }] };
    const fetch = async (u: string) => { urls.push(u); return { ok: true, status: 200, json: async () => (u.includes('wikimedia') ? commons : openverse) }; };
    const r = await publicDomainAssets({ query: 'vintage rose' }, { fetch });
    expect(urls[0]).toMatch(/commons\.wikimedia\.org.*gsrsearch=vintage%20rose/);
    expect(urls[1]).toMatch(/api\.openverse\.org.*license=cc0,pdm/);
    expect(r.items.map((x) => [x.title, x.licence, x.source])).toEqual([['Rosa gallica', 'Public domain', 'Wikimedia Commons'], ['Old map', 'CC0 (https://cc/0)', 'Openverse (rawpixel)']]);
    expect(r.items[0].creator).toBe('Redouté');
    expect(r.note).toMatch(/confirm the licence/);
  });

  test('an Openverse rate limit is reported, not thrown, and Commons results still come back', async () => {
    const fetch = async (u: string) => (u.includes('wikimedia') ? { ok: true, status: 200, json: async () => ({ query: { pages: {} } }) } : { ok: false, status: 429, json: async () => ({}) });
    const r = JSON.parse((await runTrendTool('assets_public_domain', { query: 'x' }, { fetch })).content);
    expect(r.items).toEqual([]);
    expect(r.notes[0]).toMatch(/few anonymous searches an hour/);
  });
});

describe('meme databases and connectors', () => {
  test('Imgflip templates and Reddit top posts come back as names, counts and links; never image URLs', async () => {
    const { popularMemes, trendTools, trendSources, MEMES_TOOL } = await import('../server/trends.mjs');
    const fetch = async (u: URL | string) => {
      const url = String(u);
      if (url.includes('imgflip')) return { ok: true, status: 200, json: async () => ({ success: true, data: { memes: [{ id: '1', name: 'Drake Hotline Bling', url: 'https://i.imgflip.com/30b1gx.jpg', box_count: 2, captions: 1250000 }] } }) };
      if (url.includes('/r/memes/')) return { ok: true, status: 200, json: async () => ({ data: { children: [{ data: { title: 'fih', score: 42000, num_comments: 300, created_utc: 1_760_000_000, permalink: '/r/memes/comments/x/fih/', url: 'https://i.redd.it/x.png' } }, { data: { title: 'nsfw', over_18: true, score: 9 } }] } }) };
      return { ok: false, status: 429, json: async () => ({}) };
    };
    const r: any = await popularMemes({ subreddit: 'memes' }, { fetch });
    expect(r.imgflip).toEqual([{ template: 'Drake Hotline Bling', captions: 1250000, text_boxes: 2 }]);
    expect(r.reddit).toEqual([{ subreddit: 'memes', title: 'fih', score: 42000, comments: 300, at: new Date(1_760_000_000 * 1000).toISOString(), link: 'https://www.reddit.com/r/memes/comments/x/fih/' }]);
    expect(JSON.stringify(r)).not.toMatch(/i\.redd\.it|i\.imgflip/);
    const bad: any = await popularMemes({ source: 'reddit', subreddit: 'bad name!' }, { fetch });
    expect(bad.reddit_errors[0]).toMatch(/not a subreddit/);
    expect(trendTools({ google: true, memes: true, instagram: { configured: false, username: null, hashtagsLeft: null }, pinterest: { configured: false, username: null } }).map((t) => t.name)).toEqual(['trends_google', 'trends_memes', 'assets_public_domain']);
    expect(trendTools({ google: true, memes: true, instagram: { configured: true, username: 'ed', hashtagsLeft: 30 }, pinterest: { configured: true, username: 'ed' } }).map((t) => t.name)).toContain('trends_instagram');
    expect(trendSources()).not.toMatch(/INSTAGRAM CONNECTED/);
    expect(TREND_SOURCES).toMatch(/MEME DATABASES: trends_memes/);
    expect(MEMES_TOOL.name).toBe('trends_memes');
  });

  test('Instagram hashtag search returns captions and counts only, counts the weekly allowance, and explains Meta errors', async () => {
    const { instagramHashtag, instagramPublic } = await import('../server/instagram.mjs');
    const cfg: any = { token: 't', igUserId: '123', recent: [] };
    const fetch = async (u: URL) => {
      const url = String(u);
      expect(url).not.toMatch(/media_url/);
      if (url.includes('ig_hashtag_search')) return { ok: true, json: async () => ({ data: [{ id: 'h1' }] }) };
      if (url.includes('h1/top_media')) return { ok: true, json: async () => ({ data: [{ id: 'm', caption: 'fih  shirt day', media_type: 'IMAGE', permalink: 'https://www.instagram.com/p/x/', like_count: 10, comments_count: 2, timestamp: '2026-10-20T00:00:00+0000', media_url: 'https://cdn/x.jpg' }] }) };
      return { ok: false, status: 400, json: async () => ({ error: { code: 190, message: 'expired' } }) };
    };
    const saved: any[] = [];
    const r: any = await instagramHashtag({ hashtag: '#FihShirt' }, { config: cfg, fetch, save: (c: any) => saved.push(c) });
    expect(r.posts).toEqual([{ caption: 'fih shirt day', type: 'IMAGE', likes: 10, comments: 2, at: '2026-10-20T00:00:00+0000', link: 'https://www.instagram.com/p/x/' }]);
    expect(JSON.stringify(r)).not.toMatch(/cdn\/x\.jpg/);
    expect(saved[0].recent).toEqual([expect.objectContaining({ tag: 'fihshirt' })]);
    expect(instagramPublic(saved[0])).toEqual({ configured: true, username: null, hashtagsLeft: 29 });
    await expect(instagramHashtag({ hashtag: 'x' }, { config: { token: 't', igUserId: '1', recent: [] }, fetch: async () => ({ ok: false, status: 400, json: async () => ({ error: { code: 190 } }) }) })).rejects.toThrow(/expired/);
    await expect(instagramHashtag({ hashtag: 'x' }, { config: null as any })).rejects.toThrow(/set-instagram/);
  });

  test('Pinterest trends and pin search return keywords, titles and links, never images', async () => {
    const { pinterestTool } = await import('../server/pinterest.mjs');
    const fetch = async (u: URL, init: any) => {
      expect(init.headers.authorization).toBe('Bearer tok');
      const url = String(u);
      if (url.includes('/trends/keywords/US/top/growing')) return { ok: true, json: async () => ({ trends: [{ keyword: 'fish shirt', pct_growth_wow: 40, pct_growth_yoy: 300, time_series: [1, 2, 3] }] }) };
      if (url.includes('/search/pins')) return { ok: true, json: async () => ({ items: [{ id: '9', title: 'funny fish tee', description: 'a  tee', link: 'https://shop/x', media: { images: {} }, created_at: '2026-10-01T00:00:00' }] }) };
      return { ok: false, status: 403, json: async () => ({ message: 'needs standard access' }) };
    };
    const t: any = await pinterestTool({ action: 'trends' }, { config: { token: 'tok' }, fetch });
    expect(t.trends).toEqual([{ keyword: 'fish shirt', pct_growth_wow: 40, pct_growth_yoy: 300, time_series: [1, 2, 3] }]);
    const p: any = await pinterestTool({ action: 'search', query: 'funny fish' }, { config: { token: 'tok' }, fetch });
    expect(p.pins).toEqual([{ title: 'funny fish tee', description: 'a tee', link: 'https://shop/x', board: null, at: '2026-10-01T00:00:00' }]);
    await expect(pinterestTool({ action: 'trends', region: 'ZZ' }, { config: { token: 'tok' }, fetch })).rejects.toThrow(/standard access/);
  });
});
