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
  test('Imgflip templates and Reddit top posts come back as names, counts, links and the image link for saving to memez', async () => {
    const { popularMemes, trendTools, trendSources, MEMES_TOOL } = await import('../server/trends.mjs');
    const fetch = async (u: URL | string) => {
      const url = String(u);
      if (url.includes('imgflip')) return { ok: true, status: 200, json: async () => ({ success: true, data: { memes: [{ id: '1', name: 'Drake Hotline Bling', url: 'https://i.imgflip.com/30b1gx.jpg', box_count: 2, captions: 1250000 }] } }) };
      if (url.includes('/r/memes/')) return { ok: true, status: 200, json: async () => ({ data: { children: [{ data: { title: 'fih', score: 42000, num_comments: 300, created_utc: 1_760_000_000, permalink: '/r/memes/comments/x/fih/', url: 'https://i.redd.it/x.png', post_hint: 'image' } }, { data: { title: 'nsfw', over_18: true, score: 9 } }, { data: { title: 'vid', score: 5, post_hint: 'hosted:video', url: 'https://v.redd.it/y' } }] } }) };
      return { ok: false, status: 429, json: async () => ({}) };
    };
    const r: any = await popularMemes({ subreddit: 'memes' }, { fetch });
    expect(r.imgflip).toEqual([{ template: 'Drake Hotline Bling', captions: 1250000, text_boxes: 2, image: 'https://i.imgflip.com/30b1gx.jpg', page: 'https://imgflip.com/memegenerator/1' }]);
    expect(r.reddit).toEqual([{ subreddit: 'memes', title: 'fih', score: 42000, comments: 300, at: new Date(1_760_000_000 * 1000).toISOString(), link: 'https://www.reddit.com/r/memes/comments/x/fih/', image: 'https://i.redd.it/x.png' }, { subreddit: 'memes', title: 'vid', score: 5, comments: null, at: null, link: null }]);
    expect(r.note).toMatch(/never sold as it is/);
    const bad: any = await popularMemes({ source: 'reddit', subreddit: 'bad name!' }, { fetch });
    expect(bad.reddit_errors[0]).toMatch(/not a subreddit/);
    expect(trendTools({ google: true, memes: true, instagram: { configured: false, kind: null, hashtags: false, username: null, hashtagsLeft: null, expiresAt: null, renews: false, refreshedAt: null, refreshError: null }, pinterest: { configured: false, username: null, board: null, canSave: false, expiresAt: null, renews: false, refreshedAt: null, refreshError: null } }).map((t) => t.name)).toEqual(['trends_google', 'trends_memes', 'assets_public_domain']);
    expect(trendTools({ google: true, memes: true, instagram: { configured: true, kind: 'facebook', hashtags: true, username: 'ed', hashtagsLeft: 30, expiresAt: null, renews: false, refreshedAt: null, refreshError: null }, pinterest: { configured: true, username: 'ed', board: 'memez', canSave: true, expiresAt: null, renews: false, refreshedAt: null, refreshError: null } }).map((t) => t.name)).toContain('trends_instagram');
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
    expect(instagramPublic(saved[0])).toEqual({ configured: true, kind: 'facebook', hashtags: true, username: null, hashtagsLeft: 29, expiresAt: null, renews: false, refreshedAt: null, refreshError: null });
    await expect(instagramHashtag({ hashtag: 'x' }, { config: { token: 't', igUserId: '1', recent: [] }, fetch: async () => ({ ok: false, status: 400, json: async () => ({ error: { code: 190 } }) }) })).rejects.toThrow(/expired/);
    await expect(instagramHashtag({ hashtag: 'x' }, { config: null as any })).rejects.toThrow(/set-instagram/);
  });

  test('an Instagram-login token reads the owner\'s own account on graph.instagram.com and says plainly that hashtag search is not on it', async () => {
    const { instagramTool, instagramPublic, pingInstagram } = await import('../server/instagram.mjs');
    const urls: string[] = [];
    const fetch = async (u: URL, init: any) => {
      const url = String(u); urls.push(url);
      expect(init.method).toBe('GET');
      if (url.includes('graph.instagram.com/v21.0/me?') && url.includes('user_id')) return { ok: true, json: async () => ({ user_id: '777', username: 'memezarizing' }) };
      if (url.includes('graph.instagram.com/v21.0/me?')) return { ok: true, json: async () => ({ username: 'memezarizing', followers_count: 120, media_count: 9 }) };
      if (url.includes('graph.instagram.com/v21.0/me/media')) return { ok: true, json: async () => ({ data: [{ id: '1', caption: 'fih', media_type: 'IMAGE', permalink: 'https://www.instagram.com/p/y/', like_count: 5, comments_count: 1, timestamp: '2026-10-19T00:00:00+0000', media_url: 'https://cdn/y.jpg' }] }) };
      return { ok: false, status: 400, json: async () => ({ error: { code: 100, message: 'nope' } }) };
    };
    expect(await pingInstagram({ kind: 'instagram', token: 't' }, fetch)).toEqual({ igUserId: '777', username: 'memezarizing' });
    const cfg: any = { kind: 'instagram', token: 't', igUserId: '777', username: 'memezarizing' };
    expect(instagramPublic(cfg)).toEqual({ configured: true, kind: 'instagram', hashtags: false, username: 'memezarizing', hashtagsLeft: null, expiresAt: null, renews: true, refreshedAt: null, refreshError: null });
    expect(await instagramTool({ action: 'account' }, { config: cfg, fetch })).toEqual({ username: 'memezarizing', followers: 120, posts: 9, hashtagSearch: false });
    const mine: any = await instagramTool({ action: 'my_posts' }, { config: cfg, fetch });
    expect(mine.posts).toEqual([{ caption: 'fih', type: 'IMAGE', likes: 5, comments: 1, at: '2026-10-19T00:00:00+0000', link: 'https://www.instagram.com/p/y/' }]);
    await expect(instagramTool({ action: 'hashtag', hashtag: 'fih' }, { config: cfg, fetch })).rejects.toThrow(/not available on this connection/);
    expect(urls.every((u) => u.startsWith('https://graph.instagram.com/') && !u.includes('ig_hashtag_search'))).toBe(true);
    // The Facebook-login kind reads the same things on graph.facebook.com by account id.
    const fb = async (u: URL) => { const url = String(u); expect(url).toMatch(/graph\.facebook\.com\/v21\.0\/123/); return { ok: true, json: async () => (url.includes('/media') ? { data: [] } : { username: 'ed', followers_count: 1, media_count: 2 }) }; };
    expect(await instagramTool({ action: 'account' }, { config: { token: 't', igUserId: '123' }, fetch: fb })).toEqual({ username: 'ed', followers: 1, posts: 2, hashtagSearch: true });
    expect(((await instagramTool({ action: 'my_posts' }, { config: { token: 't', igUserId: '123' }, fetch: fb })) as any).posts).toEqual([]);
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
    expect(p.pins).toEqual([{ id: '9', title: 'funny fish tee', description: 'a tee', link: 'https://shop/x', board: null, owner: null, at: '2026-10-01T00:00:00' }]);
    expect(p.canSave).toBe(false);
    await expect(pinterestTool({ action: 'trends', region: 'ZZ' }, { config: { token: 'tok' }, fetch })).rejects.toThrow(/standard access/);
  });

  test('Pinterest find filters by phrase; save and unsave touch only the secret memez board and every other write is refused', async () => {
    const { pinterestTool, findOrCreateBoard, savePin, unsavePin, boardPins, pinterestPublic, MEMEZ_BOARD } = await import('../server/pinterest.mjs');
    const calls: { method: string; url: string; body?: any }[] = [];
    const fetch = async (u: URL | string, init: any) => {
      const url = String(u); const method = init?.method || 'GET';
      calls.push({ method, url, body: init?.body ? JSON.parse(init.body) : undefined });
      if (method === 'GET' && url.endsWith('/boards?page_size=100')) return { ok: true, json: async () => ({ items: [{ id: 'b-other', name: 'Shirts' }], bookmark: null }) };
      if (method === 'POST' && url.endsWith('/boards')) return { ok: true, json: async () => ({ id: 'b-memez', name: 'memez' }) };
      if (url.includes('/search/pins')) return { ok: true, json: async () => ({ items: [{ id: '1', title: 'fih shirt', description: 'the fih meme' }, { id: '2', title: 'fish dinner', description: 'recipe' }] }) };
      if (method === 'POST' && url.endsWith('/pins/1/save')) return { ok: true, json: async () => ({ id: '1', title: 'fih shirt', board_id: 'b-memez' }) };
      if (method === 'GET' && url.endsWith('/pins/1')) return { ok: true, json: async () => ({ id: '1', title: 'fih shirt', board_id: 'b-memez' }) };
      if (method === 'GET' && url.endsWith('/pins/2')) return { ok: true, json: async () => ({ id: '2', title: 'fish dinner', board_id: 'b-other' }) };
      if (method === 'DELETE' && url.endsWith('/pins/1')) return { ok: true, status: 204, json: async () => ({}) };
      if (method === 'GET' && url.includes('/boards/b-memez/pins')) return { ok: true, json: async () => ({ items: [{ id: '1', title: 'fih shirt', board_id: 'b-memez' }] }) };
      return { ok: false, status: 400, json: async () => ({ message: `unexpected ${method} ${url}` }) };
    };
    const cfg: any = { token: 'tok', username: 'ed' };
    expect(pinterestPublic(cfg)).toEqual({ configured: true, username: 'ed', board: null, canSave: false, expiresAt: null, renews: false, refreshedAt: null, refreshError: null });
    await expect(savePin(cfg, '1', fetch)).rejects.toThrow(/no memez board yet/);
    const board = await findOrCreateBoard(cfg, fetch);
    expect(board).toEqual({ id: 'b-memez', name: MEMEZ_BOARD });
    expect(calls.filter((c) => c.method === 'POST').map((c) => c.body)).toEqual([expect.objectContaining({ name: 'memez', privacy: 'SECRET' })]);
    cfg.boardId = board.id; cfg.boardName = board.name;
    expect(pinterestPublic(cfg).canSave).toBe(true);

    const found: any = await pinterestTool({ action: 'find', query: 'fish shirt', phrase: 'fih' }, { config: cfg, fetch });
    expect(found.pins.map((p: any) => p.id)).toEqual(['1']);
    expect(found.canSave).toBe(true);

    const saved: any = await pinterestTool({ action: 'save', pin_id: '1', note: 'rising on fish accounts' }, { config: cfg, fetch });
    expect(saved.saved).toMatchObject({ id: '1', title: 'fih shirt', board: 'b-memez' });
    expect(saved.board).toBe('memez');
    expect(calls.find((c) => c.url.endsWith('/pins/1/save'))?.body).toEqual({ board_id: 'b-memez' });

    expect((await boardPins(cfg, 10, fetch)).map((p) => p.id)).toEqual(['1']);
    await expect(unsavePin(cfg, '2', fetch)).rejects.toThrow(/not on the memez board/);
    expect(calls.some((c) => c.method === 'DELETE' && c.url.endsWith('/pins/2'))).toBe(false);
    const removed: any = await pinterestTool({ action: 'unsave', pin_id: '1' }, { config: cfg, fetch });
    expect(removed).toEqual({ removed: '1', title: 'fih shirt', board: 'memez' });

    // Nothing else is ever written: every non-GET call so far is the board creation, the save, or the delete on the memez board.
    const writes = calls.filter((c) => c.method !== 'GET');
    expect(writes.map((c) => `${c.method} ${c.url.split('/v5/')[1]}`)).toEqual(['POST boards', 'POST pins/1/save', 'DELETE pins/1']);
  });

  test('tokens renew themselves: Instagram weekly through Meta (no secret for the Instagram-login kind), Pinterest through its refresh token; a hand-pasted Pinterest token stays manual', async () => {
    const { instagramMaintain, refreshInstagram } = await import('../server/instagram.mjs');
    const { exchangeCode, pinterestMaintain, authorizeUrl, REDIRECT_URI } = await import('../server/pinterest.mjs');
    const DAY = 86_400_000; const now = Date.parse('2026-10-22T00:00:00Z');
    const saved: any[] = [];
    const igFetch = async (u: URL, init: any) => {
      const url = String(u); expect(init.method).toBe('GET');
      if (url.startsWith('https://graph.instagram.com/v21.0/refresh_access_token?grant_type=ig_refresh_token')) return { ok: true, json: async () => ({ access_token: 'IGAAnew', token_type: 'bearer', expires_in: 60 * 86_400 }) };
      if (url.startsWith('https://graph.facebook.com/v21.0/oauth/access_token?grant_type=fb_exchange_token') && url.includes('client_secret=sec')) return { ok: true, json: async () => ({ access_token: 'EAAnew', expires_in: 5_000_000 }) };
      return { ok: false, status: 400, json: async () => ({ error: { code: 190, message: 'bad' } }) };
    };
    const ig: any = { kind: 'instagram', token: 'IGAAold', igUserId: '7', savedAt: new Date(now - 8 * DAY).toISOString(), expiresAt: new Date(now + 52 * DAY).toISOString() };
    expect(await instagramMaintain({ config: { ...ig, savedAt: new Date(now - 3600_000).toISOString() }, now, fetch: igFetch, save: (c: any) => saved.push(c) })).toMatchObject({ status: 'too new' });
    expect(await instagramMaintain({ config: { ...ig, savedAt: new Date(now - 2 * DAY).toISOString() }, now, fetch: igFetch, save: (c: any) => saved.push(c) })).toMatchObject({ status: 'not due' });
    expect(await instagramMaintain({ config: ig, now, fetch: igFetch, save: (c: any) => saved.push(c) })).toMatchObject({ status: 'renewed' });
    expect(saved[0]).toMatchObject({ token: 'IGAAnew', refreshError: null, igUserId: '7' });
    expect(Date.parse(saved[0].expiresAt) - Date.now()).toBeGreaterThan(59 * DAY);
    // a Facebook-login token without the app secret stays manual; with it, it is exchanged
    expect(await instagramMaintain({ config: { kind: 'facebook', token: 'EAAold', igUserId: '1', savedAt: new Date(now - 8 * DAY).toISOString() }, now, fetch: igFetch, save: () => {} })).toMatchObject({ status: 'manual' });
    expect((await refreshInstagram({ kind: 'facebook', token: 'EAAold', igUserId: '1', appId: '42', appSecret: 'sec' }, igFetch)).token).toBe('EAAnew');
    // a failed renewal is recorded, the old token kept
    saved.length = 0;
    expect(await instagramMaintain({ config: { ...ig, token: 'IGAAbroken' }, now, fetch: async () => ({ ok: false, status: 400, json: async () => ({ error: { code: 190, message: 'cannot parse' } }) }), save: (c: any) => saved.push(c) })).toMatchObject({ status: 'failed' });
    expect(saved[0]).toMatchObject({ token: 'IGAAbroken' }); expect(saved[0].refreshError).toMatch(/cannot parse/);

    const pinFetch = async (u: URL | string, init: any) => {
      expect(String(u)).toBe('https://api.pinterest.com/v5/oauth/token'); expect(init.method).toBe('POST');
      expect(init.headers.authorization).toBe(`Basic ${Buffer.from('app:secret').toString('base64')}`);
      const body = new URLSearchParams(init.body);
      if (body.get('grant_type') === 'authorization_code') { expect(body.get('redirect_uri')).toBe(REDIRECT_URI); return { ok: true, json: async () => ({ access_token: 'pina1', refresh_token: 'pinr1', expires_in: 2_592_000, refresh_token_expires_in: 5_184_000, scope: 'pins:read' }) }; }
      if (body.get('grant_type') === 'refresh_token' && body.get('refresh_token') === 'pinr1') return { ok: true, json: async () => ({ access_token: 'pina2', refresh_token: 'pinr2', expires_in: 2_592_000, refresh_token_expires_at: Math.floor(now / 1000) + 5_184_000 }) };
      return { ok: false, status: 400, json: async () => ({ message: 'bad grant' }) };
    };
    expect(authorizeUrl('app', 'st')).toMatch(/^https:\/\/www\.pinterest\.com\/oauth\/\?client_id=app&redirect_uri=http%3A%2F%2Flocalhost%3A8789%2Fcallback&response_type=code&scope=.*&state=st$/);
    const first: any = await exchangeCode({ appId: 'app', appSecret: 'secret' }, 'code1', pinFetch);
    expect(first).toMatchObject({ token: 'pina1', refresh: 'pinr1', via: 'oauth', refreshError: null });
    const pinSaved: any[] = [];
    expect(await pinterestMaintain({ config: first, now: Date.parse(first.refreshedAt) + DAY, fetch: pinFetch, save: (c: any) => pinSaved.push(c) })).toMatchObject({ status: 'not due' });
    expect(await pinterestMaintain({ config: first, now: Date.parse(first.refreshedAt) + 22 * DAY, fetch: pinFetch, save: (c: any) => pinSaved.push(c) })).toMatchObject({ status: 'renewed' });
    expect(pinSaved[0]).toMatchObject({ token: 'pina2', refresh: 'pinr2', appId: 'app' });
    expect(await pinterestMaintain({ config: { token: 'pasted-by-hand-token-xyz', username: 'ed' }, now, fetch: pinFetch, save: () => {} })).toMatchObject({ status: 'manual' });
  });
});
