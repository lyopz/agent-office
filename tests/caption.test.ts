// Captioned images: a public-domain image with meme text laid over it, rendered like any SVG design.
import { describe, expect, test } from 'vitest';
import { CAPTION_TOOL, captionImage, captionSvg, hostAllowed, imageSize, wrapCaption } from '../server/caption.mjs';

const png1x1 = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');

describe('captioned images', () => {
  test('only public-domain hosts are accepted', () => {
    expect(hostAllowed('https://upload.wikimedia.org/wikipedia/commons/a/a1/Rose.jpg')).toBe(true);
    expect(hostAllowed('https://live.staticflickr.com/1/2_o.jpg')).toBe(true);
    expect(hostAllowed('https://i.pinimg.com/originals/x.jpg')).toBe(false);
    expect(hostAllowed('https://p16-sign.tiktokcdn.com/x.jpeg')).toBe(false);
    expect(hostAllowed('http://upload.wikimedia.org/x.jpg')).toBe(false);
  });

  test('image sizes come from PNG and JPEG headers', () => {
    expect(imageSize(png1x1)).toEqual({ mime: 'image/png', width: 1, height: 1 });
    const jpg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x02, 0x58, 0x03, 0x20, 0x03, 0x01, 0x22, 0x00, 0x02, 0x11, 0x01, 0x03, 0x11, 0x01]);
    expect(imageSize(jpg)).toEqual({ mime: 'image/jpeg', width: 800, height: 600 });
    expect(imageSize(Buffer.from('<svg/>'))).toBeNull();
  });

  test('captions wrap and sit over the image in meme type; cutout puts them outside', () => {
    expect(wrapCaption('BRO IS COMPRESSED BEYOND ALL REASON', 400, 40)).toEqual(['BRO IS COMPRESSED', 'BEYOND ALL REASON']);
    const over = captionSvg({ imageB64: 'AAAA', mime: 'image/jpeg', width: 1000, height: 800, top: 'me', bottom: 'u buggin', font: 'impact' });
    expect(over).toMatch(/viewBox="0 0 1000 800"/);
    expect(over).toMatch(/>ME<\/text>/);
    expect(over).toMatch(/>U BUGGIN<\/text>/);
    expect(over).toMatch(/Impact/);
    expect(over).toMatch(/paint-order="stroke fill"/);
    const cut = captionSvg({ imageB64: 'AAAA', mime: 'image/png', width: 1000, height: 800, bottom: 'fih', font: 'plain', cutout: true });
    expect(cut).toMatch(/>fih<\/text>/);
    expect(cut).not.toMatch(/viewBox="0 0 1000 800"/);
  });

  test('a found image is fetched from an allowed host, must carry its licence, and renders to PNG', async () => {
    const urls: string[] = [];
    const fetch = async (u: string) => { urls.push(u); return { ok: true, status: 200, arrayBuffer: async () => png1x1.buffer.slice(png1x1.byteOffset, png1x1.byteOffset + png1x1.byteLength) }; };
    const svgToPng = async (svg: string) => ({ png: Buffer.from(`PNG:${svg.length}`), width: 4500, height: 4500 });
    const r = await captionImage({ image_url: 'https://upload.wikimedia.org/x.png', top: 'fih', assets: [{ title: 'Fish', page: 'https://commons.wikimedia.org/wiki/File:Fish.png', licence: 'Public domain' }] }, { fetch, svgToPng });
    expect(urls).toEqual(['https://upload.wikimedia.org/x.png']);
    expect(r.png.toString()).toMatch(/^PNG:/);
    expect(r.caption).toBe('fih');
    expect(r.original).toEqual({ width: 1, height: 1, mime: 'image/png' });
    await expect(captionImage({ image_url: 'https://upload.wikimedia.org/x.png', top: 'fih' }, { fetch, svgToPng })).rejects.toThrow(/assets/);
    await expect(captionImage({ image_url: 'https://i.pinimg.com/x.jpg', top: 'fih', assets: [{}] }, { fetch, svgToPng })).rejects.toThrow(/public-domain source/);
    await expect(captionImage({ design_id: 'nope', top: 'x' }, { fetch, svgToPng, readDesign: () => null })).rejects.toThrow(/gallery/);
    expect(CAPTION_TOOL.name).toBe('design_caption_image');
  });
});

describe('captions from the owner\'s source folders', () => {
  test('a print or owner file is captioned, a reference file is refused', async () => {
    const { captionImage } = await import('../server/caption.mjs');
    const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from('0000000d49484452', 'hex'), Buffer.from([0, 0, 0, 40, 0, 0, 0, 30]), Buffer.alloc(16)]);
    const svgToPng = async (svg: string) => ({ png: Buffer.from(svg), width: 1, height: 1 });
    const files: Record<string, any> = { 'memez/fish.png': { buf: png, kind: 'png', meta: { title: 'A fish', page: 'https://commons/x', licence: 'Public domain', usable: 'print' }, ref: 'memez/fish.png' }, 'memez/post.png': { buf: png, kind: 'png', meta: { usable: 'reference' }, ref: 'memez/post.png' }, 'ideas/mine.png': { buf: png, kind: 'png', meta: null, ref: 'ideas/mine.png' } };
    const readSource = (ref: string) => files[ref] ?? null;
    const ok = await captionImage({ source_file: 'memez/fish.png', bottom: 'fih' }, { svgToPng, readSource });
    expect(ok).toMatchObject({ source: 'source:memez/fish.png', sourceFile: 'memez/fish.png', sourceMeta: expect.objectContaining({ licence: 'Public domain' }) });
    expect((await captionImage({ source_file: 'ideas/mine.png', top: 'me' }, { svgToPng, readSource })).sourceMeta).toBeNull();
    await expect(captionImage({ source_file: 'memez/post.png', top: 'x' }, { svgToPng, readSource })).rejects.toThrow(/reference only/);
    await expect(captionImage({ source_file: 'memez/none.png', top: 'x' }, { svgToPng, readSource })).rejects.toThrow(/files_source/);
  });
});
