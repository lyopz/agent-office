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
