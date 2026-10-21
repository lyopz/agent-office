// Design images with the owner's OpenAI key: priced from usage, logged, and capped per month.
import { describe, expect, test } from 'vitest';
import { generateImage, IMAGE_USD } from '../server/openai-images.mjs';

const ok = (data: unknown) => ({ ok: true, status: 200, json: async () => data });

describe('openai images', () => {
  test('one gpt-image call with the key; the cost comes from its usage', async () => {
    const seen: any[] = [];
    const fetch = async (url: string, init: any) => { seen.push({ url, init, body: JSON.parse(init.body) }); return ok({ data: [{ b64_json: 'QUJD' }], usage: { input_tokens: 100, output_tokens: 1000 } }); };
    const r = await generateImage({ prompt: 'a cat in a teacup', quality: 'medium', transparent: true }, { key: 'sk-test', fetch } as any);
    expect(seen[0].url).toBe('https://api.openai.com/v1/images/generations');
    expect(seen[0].init.headers.authorization).toBe('Bearer sk-test');
    expect(seen[0].body).toMatchObject({ model: 'gpt-image-2', quality: 'medium', size: '1024x1024', background: 'transparent', n: 1 });
    expect(r).toMatchObject({ b64: 'QUJD', estimated: false });
    expect(r.usd).toBeCloseTo(1000 * 30e-6 + 100 * 5e-6, 8);
  });

  test('without usage it uses the published price; a refused transparent background is retried plain', async () => {
    let n = 0;
    const fetch = async (_u: string, init: any) => { n++; const b = JSON.parse(init.body); return b.background ? { ok: false, status: 400, json: async () => ({ error: { message: 'no transparency' } }) } : ok({ data: [{ b64_json: 'QQ==' }] }); };
    const r = await generateImage({ prompt: 'x', quality: 'high', transparent: true }, { key: 'sk-test', fetch } as any);
    expect(n).toBe(2);
    expect(r).toMatchObject({ usd: IMAGE_USD.high, estimated: true });
  });
});
