// Printify for the agents: designs and products are made unpublished; only the owner publishes.
import { describe, expect, test } from 'vitest';
import { PRINTIFY_TOOLS, runPrintifyTool } from '../server/printify.mjs';

const ok = (data: unknown) => ({ ok: true, status: 200, json: async () => data });

describe('printify', () => {
  test('an SVG design is uploaded as base64 contents with the token and a user agent', async () => {
    const seen: any[] = [];
    const fetch = async (url: string, init: any) => { seen.push({ url, init }); return ok({ id: 'img1', width: 4500, height: 5400 }); };
    const r = await runPrintifyTool('printify_upload_design', { file_name: 'cat', svg: '<svg/>' }, { config: { token: 'tok', shopId: 7 }, fetch });
    expect(JSON.parse(r.content)).toMatchObject({ image_id: 'img1' });
    expect(seen[0].url).toBe('https://api.printify.com/v1/uploads/images.json');
    expect(seen[0].init.headers).toMatchObject({ authorization: 'Bearer tok', 'user-agent': 'TheBrain/1.0' });
    expect(JSON.parse(seen[0].init.body)).toEqual({ file_name: 'cat.svg', contents: Buffer.from('<svg/>').toString('base64') });
  });

  test('a product is created in the chosen shop with the price in cents, never published', async () => {
    const seen: any[] = [];
    const fetch = async (url: string, init: any) => { seen.push({ url, body: JSON.parse(init.body) }); return ok({ id: 'p1', title: 'Cat Mug' }); };
    const r = await runPrintifyTool('printify_create_product', { title: 'Cat Mug', description: 'd', blueprint_id: 68, print_provider_id: 1, variant_ids: [33719], price_usd: 18.5, image_id: 'img1' }, { config: { token: 'tok', shopId: 7 }, fetch });
    expect(r.isError).toBe(false);
    expect(seen).toHaveLength(1);
    expect(seen[0].url).toBe('https://api.printify.com/v1/shops/7/products.json');
    expect(seen[0].body.variants).toEqual([{ id: 33719, price: 1850, is_enabled: true }]);
    expect(seen[0].body.print_areas[0].placeholders[0]).toMatchObject({ position: 'front', images: [{ id: 'img1', x: 0.5, y: 0.5, scale: 1, angle: 0 }] });
  });

  test('agents have no publish tool', () => {
    expect(PRINTIFY_TOOLS.map((t) => t.name).filter((n) => /publish/.test(n))).toEqual(['printify_request_publish']);
  });
});
