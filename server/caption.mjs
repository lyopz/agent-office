// Captioned images for the design agents: a found image (public domain or CC0, from the hosts the
// asset search returns, or an image an agent generated into the gallery) with meme-style text laid
// over it. The image is wrapped in SVG with the text and rendered to a print-size PNG by the same
// renderer as SVG designs, so the fonts are the owner's PC's installed fonts.
const PRINT_WIDTH = 4500;
const MAX_BYTES = 25_000_000;
/** Where a found image may come from: the public-domain sources assets_public_domain searches. */
export const IMAGE_HOSTS = [/(^|\.)upload\.wikimedia\.org$/, /(^|\.)commons\.wikimedia\.org$/, /(^|\.)staticflickr\.com$/, /(^|\.)rawpixel\.com$/, /(^|\.)loc\.gov$/, /(^|\.)metmuseum\.org$/, /(^|\.)openverse\.org$/, /(^|\.)si\.edu$/, /(^|\.)nypl\.org$/, /(^|\.)europeana\.eu$/, /(^|\.)archive\.org$/];
const FONTS = { impact: 'Impact, Haettenschweiler, "Arial Black", sans-serif', bold: '"Arial Black", Bahnschrift, Arial, sans-serif', plain: '"Segoe UI", Arial, sans-serif', mono: '"Courier New", monospace', serif: 'Georgia, "Times New Roman", serif', hand: '"Segoe Print", "Comic Sans MS", cursive' };

export const CAPTION_TOOL = {
  name: 'design_caption_image',
  description: "The default way to make a meme shirt design: take an image you found with assets_public_domain (its file URL), a print or owner file from the owner's source folders (source_file), or an image already in the owner's gallery (its design_id), and lay a short caption over it in meme style. The image is not redrawn or changed; the text makes the joke. Saved to the owner's Approvals like any design. Only public-domain and CC0 images from the asset search, or images you generated, can be used; never a photo from a social post.",
  input_schema: { type: 'object', properties: {
    image_url: { type: 'string', description: 'the file URL from an assets_public_domain result (not the page URL)' },
    design_id: { type: 'string', description: 'or: an image already in the gallery (from design_generate_image or an earlier save)' },
    source_file: { type: 'string', description: 'or: a file from files_source marked print or owner, e.g. memez/fish.png' },
    top: { type: 'string', description: 'caption above, 0 to 6 words; leave empty for none' },
    bottom: { type: 'string', description: 'caption below, 0 to 6 words; leave empty for none' },
    font: { type: 'string', enum: Object.keys(FONTS), description: 'impact (classic meme), bold, plain (deadpan), mono, serif (mock-serious), hand' },
    uppercase: { type: 'boolean', description: 'default true for impact, false otherwise' },
    color: { type: 'string', description: 'text colour, default white with a black outline' },
    cutout: { type: 'boolean', description: 'true keeps the image at its own size on a transparent sheet with the text outside it (sticker look); false lays the text over the image' },
    title: { type: 'string', description: 'what the design is and why it is funny' },
    assets: { type: 'array', description: 'the image used: title, page (source URL), licence; required for a found image', items: { type: 'object', properties: { title: { type: 'string' }, page: { type: 'string' }, licence: { type: 'string' } } } },
    file_name: { type: 'string' },
  } },
};

export const hostAllowed = (url) => { try { const h = new URL(url).hostname.toLowerCase(); return new URL(url).protocol === 'https:' && IMAGE_HOSTS.some((re) => re.test(h)); } catch { return false; } };

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
export function captionSvg({ imageB64, mime, width, height, top = '', bottom = '', font = 'impact', uppercase, color = '#ffffff', cutout = false }) {
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
  return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${width}" height="${H}" viewBox="0 0 ${width} ${H}"><image x="0" y="${topBand}" width="${width}" height="${height}" preserveAspectRatio="xMidYMid meet" href="data:${mime};base64,${imageB64}"/>${textBlock(topLines, topY)}${textBlock(botLines, botY)}</svg>`;
}

/**
 * Fetch the image (allowed hosts only) or read it from the gallery, caption it, and render a print PNG.
 * deps: fetch, svgToPng(svg) => {png,width,height}|null, readDesign(id) => {buf, kind}|null
 */
export async function captionImage(input, deps) {
  const top = String(input?.top || '').trim().slice(0, 80), bottom = String(input?.bottom || '').trim().slice(0, 80);
  if (!top && !bottom && !input?.cutout) throw new Error('Give a caption in top or bottom (or both).');
  let buf, source, sourceMeta = null;
  if (input?.source_file) {
    const f = deps.readSource?.(String(input.source_file));
    if (!f) throw new Error('No such file in the owner\'s source folders; use a ref from files_source (e.g. memez/fish.png).');
    if (f.meta?.usable === 'reference') throw new Error('That image is reference only (not public domain or CC0, and not the owner\'s own): learn the joke from it and remake it with a free image (assets_public_domain) or your own drawing.');
    buf = f.buf; source = `source:${f.ref}`; sourceMeta = f.meta;
  } else if (input?.design_id) {
    const d = deps.readDesign?.(String(input.design_id));
    if (!d) throw new Error('No image with that design_id is in the gallery.');
    if (d.kind === 'svg') throw new Error('That design is an SVG; caption a png or jpg image, or write the words into the SVG itself.');
    buf = d.buf; source = `gallery:${input.design_id}`;
  } else if (input?.image_url) {
    const url = String(input.image_url);
    if (!hostAllowed(url)) throw new Error('That image is not from a public-domain source this tool accepts (Wikimedia Commons, Flickr Commons, rawpixel, Library of Congress, the Met, Smithsonian, NYPL, Europeana, Internet Archive, Openverse). Use a file URL from assets_public_domain, or an image you generated (design_id).');
    const f = deps.fetch ?? globalThis.fetch;
    const r = await f(url, { headers: { 'user-agent': 'the-brain/1.0 (one public-domain image for the owner\'s design)' } });
    if (!r.ok) throw new Error(`The image could not be fetched (${r.status}).`);
    buf = Buffer.from(await r.arrayBuffer()); source = url;
    if (!Array.isArray(input.assets) || !input.assets.length) throw new Error('Record the image in assets (title, page, licence) so the owner sees where it came from.');
  } else throw new Error('Give image_url (from assets_public_domain), source_file (from files_source) or design_id.');
  if (buf.length > MAX_BYTES) throw new Error('That image is too large (over 25 MB).');
  const size = imageSize(buf);
  if (!size) throw new Error('That file is not a PNG or JPEG image.');
  // scale the sheet so the short side is print-size without blowing up a small image past 4500 px
  const scale = Math.min(PRINT_WIDTH / size.width, 3);
  const width = Math.round(size.width * Math.max(1, scale)), height = Math.round(size.height * Math.max(1, scale));
  const svg = captionSvg({ imageB64: buf.toString('base64'), mime: size.mime, width, height, top, bottom, font: input?.font, uppercase: input?.uppercase, color: typeof input?.color === 'string' && /^#[0-9a-f]{3,8}$/i.test(input.color) ? input.color : undefined, cutout: !!input?.cutout });
  const out = await deps.svgToPng(svg);
  if (!out) throw new Error('The image renderer is not installed on this PC (run npm.cmd install once).');
  return { png: out.png, width: out.width, height: out.height, source, sourceFile: input?.source_file ? String(input.source_file) : null, sourceMeta, caption: [top, bottom].filter(Boolean).join(' / '), original: { width: size.width, height: size.height, mime: size.mime } };
}
