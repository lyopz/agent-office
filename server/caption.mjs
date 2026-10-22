// Captioned images for the design agents: a meme the owner picked from memez (or one of their own files,
// or an image already in the gallery) with a few words laid over it. The image is wrapped in SVG with
// the text and rendered to a print-size PNG by the same renderer as SVG designs, so the fonts are the
// owner's PC's installed fonts. No web image search: memes come from the scouts' memez folder.
const PRINT_WIDTH = 4500;
const MAX_BYTES = 25_000_000;
/** Where a design prints on the garment. */
export const PLACEMENTS = ['front_center', 'full_front', 'left_chest', 'back'];
const FONTS = { impact: 'Impact, Haettenschweiler, "Arial Black", sans-serif', bold: '"Arial Black", Bahnschrift, Arial, sans-serif', plain: '"Segoe UI", Arial, sans-serif', mono: '"Courier New", monospace', serif: 'Georgia, "Times New Roman", serif', hand: '"Segoe Print", "Comic Sans MS", cursive' };

export const CAPTION_TOOL = {
  name: 'design_caption_image',
  description: "The way to make a meme shirt design: take a meme the owner picked Yes on in memez (source_file; files_source with picks \"yes\" lists them), one of the owner's own files, or an image already in their gallery (design_id), and keep it as it is: add a few words in a font that fits the picture, or no words at all (no_caption) when the meme already has its own text. Crop or remove_background only when it clearly prints better. The image is not redrawn and no AI is used. Say where it goes on the shirt (placement). Saved to the owner's Approvals like any design. A reference file (someone's meme or post) makes a DRAFT: the owner sees it flagged and it is never listed for sale as it is.",
  input_schema: { type: 'object', properties: {
    design_id: { type: 'string', description: 'or: an image already in the gallery (from design_generate_image or an earlier save)' },
    source_file: { type: 'string', description: 'a file from files_source the owner picked Yes on (or their own file), e.g. memez/fish.png; a reference file gives a flagged draft' },
    no_caption: { type: 'boolean', description: 'true when the meme already carries its own words: no text is added' },
    placement: { type: 'string', enum: PLACEMENTS, description: 'where it prints: front_center (most designs), full_front (a big picture), left_chest (a small doodle or one-liner, pocket size), back (a big piece, with a small mark on the front optional). Pick what suits this design.' },
    crop: { type: 'object', description: 'optional: keep only this part of the image, in percent of its width and height, e.g. {"x": 10, "y": 0, "w": 80, "h": 100} (after remove_background, percent of the cut-out)', properties: { x: { type: 'number' }, y: { type: 'number' }, w: { type: 'number' }, h: { type: 'number' } } },
    remove_background: { type: 'boolean', description: 'true cuts a plain background (white, one flat colour) away on this PC, no AI, and trims to the subject, so it prints as a sticker on the shirt; a photo with a real background is left as it is and the result says so' },
    top: { type: 'string', description: 'caption above, 0 to 6 words; leave empty for none' },
    bottom: { type: 'string', description: 'caption below, 0 to 6 words; leave empty for none' },
    font: { type: 'string', enum: Object.keys(FONTS), description: 'pick the one that fits the picture: hand (scribbly, for doodles and hand-drawn memes), plain (deadpan lowercase), impact (classic meme macro), bold, mono, serif (mock-serious)' },
    uppercase: { type: 'boolean', description: 'default true for impact, false otherwise' },
    color: { type: 'string', description: 'text colour, default white with a black outline' },
    cutout: { type: 'boolean', description: 'true keeps the image at its own size on a transparent sheet with the text outside it (sticker look); false lays the text over the image' },
    title: { type: 'string', description: 'what the design is and why it is funny' },
    assets: { type: 'array', description: 'the image used: title, page (source URL), licence; required for a found image', items: { type: 'object', properties: { title: { type: 'string' }, page: { type: 'string' }, licence: { type: 'string' } } } },
    file_name: { type: 'string' },
  } },
};

/** Width and height from a PNG or JPEG header; null when the bytes are neither. */
export function imageSize(buf) {
  if (buf.length > 24 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return { mime: 'image/png', width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
  if (buf.length > 4 && buf[0] === 0xff && buf[1] === 0xd8) {
    let i = 2;
    while (i + 9 < buf.length) {
      if (buf[i] !== 0xff) { i++; continue; }
      const m = buf[i + 1];
      if (m === 0xd8 || m === 0x01 || (m >= 0xd0 && m <= 0xd7)) { i += 2; continue; }
      const len = buf.readUInt16BE(i + 2);
      if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) return { mime: 'image/jpeg', height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7) };
      i += 2 + len;
    }
  }
  return null;
}

const esc = (t) => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
/** Break a caption into lines that fit the width at the given size (roughly 0.55 em per character). */
export function wrapCaption(text, width, fontSize, maxLines = 3) {
  const words = String(text || '').trim().split(/\s+/).filter(Boolean);
  const perLine = Math.max(4, Math.floor(width / (fontSize * 0.58)));
  const lines = [];
  let cur = '';
  for (const w of words) {
    const next = cur ? `${cur} ${w}` : w;
    if (next.length > perLine && cur) { lines.push(cur); cur = w; } else cur = next;
  }
  if (cur) lines.push(cur);
  return lines.slice(0, maxLines);
}

/** The SVG that lays the captions over (or around) the image. */
export function captionSvg({ imageB64, mime, width, height, top = '', bottom = '', font = 'impact', uppercase, color = '#ffffff', cutout = false, crop = null }) {
  const family = FONTS[font] || FONTS.impact;
  const upper = uppercase ?? font === 'impact';
  const fix = (t) => (upper ? String(t).toUpperCase() : String(t));
  const size = Math.round(Math.max(24, Math.min(width, height) / 9));
  const stroke = Math.max(2, Math.round(size / 14));
  const topLines = top ? wrapCaption(fix(top), width * 0.94, size) : [];
  const botLines = bottom ? wrapCaption(fix(bottom), width * 0.94, size) : [];
  const lineH = size * 1.12;
  const band = (n) => (n ? Math.round(n * lineH + size * 0.6) : 0);
  const topBand = cutout ? band(topLines.length) : 0, botBand = cutout ? band(botLines.length) : 0;
  const H = height + topBand + botBand;
  const textBlock = (lines, yStart) => lines.map((l, i) => `<text x="${width / 2}" y="${Math.round(yStart + i * lineH)}" font-family='${family}' font-weight="900" font-size="${size}" text-anchor="middle" fill="${esc(color)}" stroke="#000" stroke-width="${stroke}" stroke-linejoin="round" paint-order="stroke fill">${esc(l)}</text>`).join('');
  const topY = cutout ? size * 1.05 : size * 1.15;
  const botY = cutout ? topBand + height + size * 1.05 : height - (botLines.length - 1) * lineH - size * 0.45;
  // a crop shows one window of the full image: the window is the sheet, the full image sits behind it
  const picture = crop
    ? `<svg x="0" y="${topBand}" width="${width}" height="${height}" viewBox="${crop.x} ${crop.y} ${width} ${height}" preserveAspectRatio="none"><image x="0" y="0" width="${crop.fullWidth}" height="${crop.fullHeight}" preserveAspectRatio="none" href="data:${mime};base64,${imageB64}"/></svg>`
    : `<image x="0" y="${topBand}" width="${width}" height="${height}" preserveAspectRatio="xMidYMid meet" href="data:${mime};base64,${imageB64}"/>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${width}" height="${H}" viewBox="0 0 ${width} ${H}">${picture}${textBlock(topLines, topY)}${textBlock(botLines, botY)}</svg>`;
}

/** A crop given in percent of the original, as pixels; null when there is none or it is not sensible. */
export function cropBox(c, size) {
  if (!c || typeof c !== 'object') return null;
  const pct = (v, d) => (Number.isFinite(Number(v)) ? Math.max(0, Math.min(100, Number(v))) : d);
  const x = pct(c.x, 0), y = pct(c.y, 0), w = Math.min(pct(c.w, 100), 100 - x), h = Math.min(pct(c.h, 100), 100 - y);
  if (w < 5 || h < 5 || (x === 0 && y === 0 && w === 100 && h === 100)) return null;
  const box = { x: Math.round(size.width * x / 100), y: Math.round(size.height * y / 100), w: Math.round(size.width * w / 100), h: Math.round(size.height * h / 100) };
  return box.w >= 16 && box.h >= 16 ? box : null;
}

/**
 * Fetch the image (allowed hosts only) or read it from the gallery, caption it, and render a print PNG.
 * deps: fetch, svgToPng(svg) => {png,width,height}|null, readDesign(id) => {buf, kind}|null
 */
export async function captionImage(input, deps) {
  const top = String(input?.top || '').trim().slice(0, 80), bottom = String(input?.bottom || '').trim().slice(0, 80);
  if (!top && !bottom && !input?.cutout && !input?.no_caption) throw new Error('Give a caption in top or bottom, or no_caption true when the meme already has its own words.');
  let buf, source, sourceMeta = null;
  if (input?.source_file) {
    const f = deps.readSource?.(String(input.source_file));
    if (!f) throw new Error('No such file in the owner\'s source folders; use a ref from files_source (e.g. memez/fish.png).');
    buf = f.buf; source = `source:${f.ref}`; sourceMeta = f.meta;
  } else if (input?.design_id) {
    const d = deps.readDesign?.(String(input.design_id));
    if (!d) throw new Error('No image with that design_id is in the gallery.');
    if (d.kind === 'svg') throw new Error('That design is an SVG; caption a png or jpg image, or write the words into the SVG itself.');
    buf = d.buf; source = `gallery:${input.design_id}`;
  } else throw new Error(input?.image_url ? 'Web images are not used: design from a meme the owner picked in memez (source_file from files_source) or a design_id.' : 'Give source_file (from files_source) or design_id.');
  if (buf.length > MAX_BYTES) throw new Error('That image is too large (over 25 MB).');
  let size = imageSize(buf);
  if (!size) throw new Error('That file is not a PNG or JPEG image.');
  // the background cut away on this PC (plain backgrounds only), then the subject trimmed to its box
  let background = null;
  if (input?.remove_background) {
    if (!deps.cutout) throw new Error('Background removal is not available in this runner.');
    const cut = await deps.cutout(buf, size);
    if (cut) { buf = cut.png; size = { mime: 'image/png', width: cut.width, height: cut.height }; background = { removed: Math.round(cut.removed * 100), trimmed: cut.trimmed }; }
    else background = { removed: 0, note: 'no plain background found (a photo with a real background); the image is used as it is' };
  }
  // an optional crop window, in percent of the original
  const crop = cropBox(input?.crop, size);
  const shown = crop ? { width: crop.w, height: crop.h } : size;
  // scale the sheet so the short side is print-size without blowing up a small image past 4500 px
  const scale = Math.max(1, Math.min(PRINT_WIDTH / shown.width, 3));
  const width = Math.round(shown.width * scale), height = Math.round(shown.height * scale);
  const svg = captionSvg({ imageB64: buf.toString('base64'), mime: size.mime, width, height, top, bottom, font: input?.font, uppercase: input?.uppercase, color: typeof input?.color === 'string' && /^#[0-9a-f]{3,8}$/i.test(input.color) ? input.color : undefined, cutout: !!input?.cutout, crop: crop ? { x: Math.round(crop.x * scale), y: Math.round(crop.y * scale), fullWidth: Math.round(size.width * scale), fullHeight: Math.round(size.height * scale) } : null });
  const out = await deps.svgToPng(svg);
  if (!out) throw new Error('The image renderer is not installed on this PC (run npm.cmd install once).');
  const rights = sourceMeta ? (sourceMeta.usable || 'reference') : input?.source_file ? 'owner' : 'print';
  const placement = PLACEMENTS.includes(input?.placement) ? input.placement : 'front_center';
  return { placement, png: out.png, width: out.width, height: out.height, source, sourceFile: input?.source_file ? String(input.source_file) : null, sourceMeta, rights, background, crop: crop ? { x: crop.x, y: crop.y, w: crop.w, h: crop.h } : null, caption: [top, bottom].filter(Boolean).join(' / '), original: { width: size.width, height: size.height, mime: size.mime } };
}
