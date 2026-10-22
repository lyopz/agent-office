// Printify for the agents: designs and products are made unpublished; only the owner publishes.
import { describe, expect, test } from 'vitest';
import { PRINTIFY_TOOLS, runPrintifyTool, svgToPng } from '../server/printify.mjs';

const ok = (data: unknown) => ({ ok: true, status: 200, json: async () => data });

describe('printify', () => {
  const SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 450 540"><text x="225" y="300" font-family="Arial, sans-serif" font-size="90" text-anchor="middle" fill="#112">JERSEY AVE</text></svg>';

  test('an SVG design with text is rendered to a print-size PNG and uploaded with the token and a user agent', async () => {
    const seen: any[] = [];
    const fetch = async (url: string, init: any) => { seen.push({ url, init }); return ok({ id: 'img1', width: 4500, height: 5400 }); };
    const r = await runPrintifyTool('printify_upload_design', { file_name: 'cat.svg', svg: SVG }, { config: { token: 'tok', shopId: 7 }, fetch });
    expect(JSON.parse(r.content)).toMatchObject({ image_id: 'img1', rendered: 'PNG 4500x5400 from your SVG' });
    expect(seen[0].url).toBe('https://api.printify.com/v1/uploads/images.json');
    expect(seen[0].init.headers).toMatchObject({ authorization: 'Bearer tok', 'user-agent': 'TheBrain/1.0' });
    const body = JSON.parse(seen[0].init.body);
    expect(body.file_name).toBe('cat.png');
    expect(body.contents.startsWith('iVBOR')).toBe(true); // a PNG
    expect(Buffer.from(body.contents, 'base64').length).toBeGreaterThan(5000); // the lettering is in it, not a blank canvas
  });

  test('svgToPng keeps an SVG already at print size as it is, and refuses markup that is not an SVG', async () => {
    const big = await svgToPng(SVG.replace('viewBox="0 0 450 540"', 'viewBox="0 0 4500 5400"'));
    expect(big).toMatchObject({ width: 4500, height: 5400 });
    const r = await runPrintifyTool('printify_upload_design', { svg: 'hello' }, { config: { token: 'tok', shopId: 7 }, fetch: async () => ok({}) });
    expect(r.isError).toBe(true);
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

describe('printify placement', () => {
  test('a named placement sets the print side, spot and size', async () => {
    const { placeholder } = await import('../server/printify.mjs');
    expect(placeholder({ image_id: 'i1', placement: 'left_chest' })).toEqual({ position: 'front', images: [{ id: 'i1', x: 0.72, y: 0.22, scale: 0.3, angle: 0 }] });
    expect(placeholder({ image_id: 'i1', placement: 'back' }).position).toBe('back');
    expect(placeholder({ image_id: 'i1' })).toEqual({ position: 'front', images: [{ id: 'i1', x: 0.5, y: 0.5, scale: 1, angle: 0 }] });
  });
});
