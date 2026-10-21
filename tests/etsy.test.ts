// Etsy for the agents: compact read-only search results, and the key header Etsy expects.
import { describe, expect, test } from 'vitest';
import { authUrl, searchListings } from '../server/etsy.mjs';

describe('etsy', () => {
  test('search returns compact rows and a median price, sending keystring:secret', async () => {
    const seen: any[] = [];
    const fetch = async (url: string, init: any) => {
      seen.push([url, init.headers['x-api-key']]);
      return { ok: true, status: 200, json: async () => ({ count: 3, results: [10, 20, 30].map((p, i) => ({ title: `Mug ${i}`, price: { amount: p * 100, divisor: 100, currency_code: 'USD' }, num_favorers: i, tags: ['mug'], url: `u${i}`, creation_timestamp: 1_700_000_000 })) }) };
    };
    const r = await searchListings({ keywords: 'cat mug', sort_on: 'score', limit: 3 }, { config: { keystring: 'abc1234567890', secret: 'shh' }, fetch });
    expect(seen[0][0]).toMatch(/listings\/active\?keywords=cat\+mug&limit=3&sort_on=score/);
    expect(seen[0][1]).toBe('abc1234567890:shh');
    expect(r).toMatchObject({ total: 3, shown: 3, medianPrice: 20 });
    expect(r.listings[0]).toMatchObject({ title: 'Mug 0', price: 10, currency: 'USD', madeAt: '2023-11-14' });
  });

  test('falls back to the keystring alone when Etsy refuses keystring:secret', async () => {
    const keys: string[] = [];
    const fetch = async (_u: string, init: any) => { keys.push(init.headers['x-api-key']); return keys.length === 1 ? { ok: false, status: 403, json: async () => ({}) } : { ok: true, status: 200, json: async () => ({ count: 0, results: [] }) }; };
    await searchListings({ keywords: 'x' }, { config: { keystring: 'abc1234567890', secret: 'shh' }, fetch });
    expect(keys).toEqual(['abc1234567890:shh', 'abc1234567890']);
  });

  test('no sign-in link before the key is saved', () => {
    expect(authUrl('http://localhost:8788/api/origin/etsy/callback')).toBeNull();
  });
});
