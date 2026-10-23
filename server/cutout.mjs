// Cutting a plain background away from a found image, on this PC and without any AI: the image is
// rasterised by the same renderer as the designs, every pixel reachable from the edge that is close
// to the edge colour becomes transparent, and the subject is trimmed to its box with a margin. Photos
// with a real background (sky, a room) are left alone: the caller is told no plain background was found.
import zlib from 'node:zlib';

let resvg = null;
/** The RGBA pixels of a PNG or JPEG, at its own size. */
export async function rasterize(buf, mime, deps = {}) {
  try { resvg ??= deps.resvg ?? (await import('@resvg/resvg-js')).Resvg; } catch { return null; }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${deps.width || 0}" height="${deps.height || 0}"><image width="${deps.width || 0}" height="${deps.height || 0}" href="data:${mime};base64,${buf.toString('base64')}"/></svg>`;
  const r = new resvg(svg, { fitTo: { mode: 'original' }, background: 'rgba(0,0,0,0)' });
  const img = r.render();
  return { pixels: Buffer.from(img.pixels), width: img.width, height: img.height };
}

const dist = (p, i, c) => Math.abs(p[i] - c[0]) + Math.abs(p[i + 1] - c[1]) + Math.abs(p[i + 2] - c[2]);

/** The colour the edges share, or null when the edges are not plain (a photo background). */
export function edgeColour(pixels, width, height) {
  const samples = [];
  const take = (x, y) => { const i = (y * width + x) * 4; if (pixels[i + 3] > 200) samples.push([pixels[i], pixels[i + 1], pixels[i + 2]]); };
  const step = Math.max(1, Math.floor(Math.max(width, height) / 64));
  for (let x = 0; x < width; x += step) { take(x, 0); take(x, height - 1); }
  for (let y = 0; y < height; y += step) { take(0, y); take(width - 1, y); }
  if (samples.length < 8) return { colour: null, transparent: true };
  const avg = [0, 1, 2].map((k) => Math.round(samples.reduce((n, s) => n + s[k], 0) / samples.length));
  // most of the edge must sit close to that colour, or there is no plain background to cut
  const close = samples.filter((s) => Math.abs(s[0] - avg[0]) + Math.abs(s[1] - avg[1]) + Math.abs(s[2] - avg[2]) < 60).length;
  return close / samples.length >= 0.8 ? { colour: avg, transparent: false } : { colour: null, transparent: false };
}

/**
 * Make every edge-connected pixel near the edge colour transparent. Returns the share of pixels removed,
 * or null when the edges are not one plain colour (nothing is changed then).
 */
export function removeFlatBackground(pixels, width, height, tolerance = 72) {
  const edge = edgeColour(pixels, width, height);
  if (!edge.colour) return edge.transparent ? 0 : null;
  const seen = new Uint8Array(width * height);
  const stack = [];
  const push = (x, y) => { const k = y * width + x; if (seen[k]) return; const i = k * 4; if (pixels[i + 3] < 20 || dist(pixels, i, edge.colour) <= tolerance) { seen[k] = 1; stack.push(k); } };
  for (let x = 0; x < width; x++) { push(x, 0); push(x, height - 1); }
  for (let y = 0; y < height; y++) { push(0, y); push(width - 1, y); }
  let removed = 0;
  while (stack.length) {
    const k = stack.pop(); removed++;
    const x = k % width, y = (k - x) / width;
    if (x > 0) push(x - 1, y); if (x < width - 1) push(x + 1, y); if (y > 0) push(x, y - 1); if (y < height - 1) push(x, y + 1);
  }
  // a soft edge: pixels on the border of the cut keep a little of their alpha so the outline is not jagged
  for (let k = 0; k < seen.length; k++) {
    if (!seen[k]) continue;
    const i = k * 4, x = k % width, y = (k - x) / width;
    const near = (x > 0 && !seen[k - 1]) || (x < width - 1 && !seen[k + 1]) || (y > 0 && !seen[k - width]) || (y < height - 1 && !seen[k + width]);
    pixels[i + 3] = near ? Math.min(pixels[i + 3], 90) : 0;
  }
  return removed / (width * height);
}

/** The box around every visible pixel, with a margin; null when nothing is visible. */
export function visibleBox(pixels, width, height, margin = 0.04) {
  let x0 = width, y0 = height, x1 = -1, y1 = -1;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) if (pixels[(y * width + x) * 4 + 3] > 20) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  if (x1 < 0) return null;
  const mx = Math.round((x1 - x0 + 1) * margin), my = Math.round((y1 - y0 + 1) * margin);
  x0 = Math.max(0, x0 - mx); y0 = Math.max(0, y0 - my); x1 = Math.min(width - 1, x1 + mx); y1 = Math.min(height - 1, y1 + my);
  return { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

/** Cut a box out of an RGBA buffer. */
export function cropPixels(pixels, width, box) {
  const out = Buffer.alloc(box.w * box.h * 4);
  for (let y = 0; y < box.h; y++) pixels.copy(out, y * box.w * 4, ((box.y + y) * width + box.x) * 4, ((box.y + y) * width + box.x + box.w) * 4);
  return out;
}

// ---------- PNG writing: zlib is built in, so no library is needed ----------
const CRC = (() => { const t = new Int32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c; } return t; })();
const crc32 = (buf) => { let c = -1; for (const b of buf) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ -1) >>> 0; };
const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type, 'ascii'), data]); const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td)); return Buffer.concat([len, td, crc]); };
/** RGBA pixels as a PNG file. */
export function encodePng(pixels, width, height) {
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) { raw[y * (width * 4 + 1)] = 0; pixels.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4); }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4); ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 6 })), chunk('IEND', Buffer.alloc(0))]);
}

/**
 * The whole job for one image: cut a plain background away and trim to the subject.
 * Returns {png, width, height, removed, trimmed} or null when the image has no plain background.
 */
export async function cutoutImage(buf, { mime, width, height }, deps = {}) {
  const r = await rasterize(buf, mime, { ...deps, width, height });
  if (!r) throw new Error('The image renderer is not installed on this PC (run npm.cmd install once).');
  const removed = removeFlatBackground(r.pixels, r.width, r.height, deps.tolerance);
  if (removed == null) return null;
  const box = visibleBox(r.pixels, r.width, r.height);
  if (!box) return null;
  const trimmed = box.w < r.width || box.h < r.height;
  const pixels = trimmed ? cropPixels(r.pixels, r.width, box) : r.pixels;
  return { png: encodePng(pixels, box.w, box.h), width: box.w, height: box.h, removed, trimmed };
}
