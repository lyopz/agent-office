// Cutting a plain background away on this PC: edge colour, flood fill, trim, PNG writing.
import { describe, expect, test } from 'vitest';
import { captionImage, imageSize } from '../server/caption.mjs';
import { cropPixels, cutoutImage, edgeColour, encodePng, removeFlatBackground, visibleBox } from '../server/cutout.mjs';
import { svgToPng } from '../server/printify.mjs';

/** A w by h sheet of one colour with a red square in the middle. */
const sheet = (w: number, h: number, bg: number[], square = true) => {
  const p = Buffer.alloc(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 4;
    const inSquare = square && x >= w / 4 && x < (3 * w) / 4 && y >= h / 4 && y < (3 * h) / 4;
    const c = inSquare ? [220, 30, 30] : bg;
    p[i] = c[0]; p[i + 1] = c[1]; p[i + 2] = c[2]; p[i + 3] = 255;
  }
  return p;
};
const noisy = (w: number, h: number) => { const p = sheet(w, h, [0, 0, 0]); for (let i = 0; i < p.length; i += 4) { const v = (i * 37) % 256; p[i] = v; p[i + 1] = 255 - v; p[i + 2] = (v * 3) % 256; } return p; };

describe('background cut-out', () => {
  test('a plain edge is recognised; a noisy one is not', () => {
    expect(edgeColour(sheet(40, 40, [255, 255, 255]), 40, 40)).toEqual({ colour: [255, 255, 255], transparent: false });
    expect(edgeColour(noisy(40, 40), 40, 40).colour).toBeNull();
  });

  test('the background goes transparent, the subject stays, and the box trims to it', () => {
    const p = sheet(40, 40, [250, 250, 250]);
    const removed = removeFlatBackground(p, 40, 40);
    expect(removed).toBeGreaterThan(0.6);
    expect(p[3]).toBe(0); // corner
    expect(p[(20 * 40 + 20) * 4 + 3]).toBe(255); // middle of the square
    const box = visibleBox(p, 40, 40, 0);
    expect(box).toEqual({ x: 9, y: 9, w: 22, h: 22 }); // the subject plus its one-pixel soft edge
    expect(cropPixels(p, 40, box!)).toHaveLength(22 * 22 * 4);
  });

  test('a photo-like background is left alone', () => {
    const p = noisy(40, 40);
    expect(removeFlatBackground(p, 40, 40)).toBeNull();
    expect(p[3]).toBe(255);
  });

  test('the PNG writer makes a file the renderer reads back at the right size', async () => {
    const png = encodePng(sheet(24, 16, [255, 255, 255]), 24, 16);
    expect(imageSize(png)).toEqual({ mime: 'image/png', width: 24, height: 16 });
    const cut = await cutoutImage(png, { mime: 'image/png', width: 24, height: 16 });
    expect(cut).toMatchObject({ trimmed: true });
    expect(cut!.width).toBeLessThan(24);
    expect(imageSize(cut!.png)!.width).toBe(cut!.width);
  });

  test('design_caption_image with remove_background uses the cut-out and reports it', async () => {
    const png = encodePng(sheet(40, 40, [255, 255, 255]), 40, 40);
    const readSource = () => ({ buf: png, kind: 'png', meta: { title: 'frog', licence: 'CC0', usable: 'print' }, ref: 'memez/frog.png' });
    const r = await captionImage({ source_file: 'memez/frog.png', bottom: 'sit', remove_background: true, cutout: true }, { svgToPng, readSource, cutout: (buf: Buffer, size: any) => cutoutImage(buf, size) });
    expect(r.background).toMatchObject({ trimmed: true });
    expect(r.background!.removed).toBeGreaterThan(50);
    expect(r.original.mime).toBe('image/png');
    const plain = await captionImage({ source_file: 'memez/frog.png', bottom: 'sit' }, { svgToPng, readSource });
    expect(plain.background).toBeNull();
  });
});
