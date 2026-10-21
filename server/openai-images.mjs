// Image generation for the agents' designs, with the owner's OpenAI API key (gpt-image-2).
// The owner saves the key once (npm run set-openai); it stays in the runner, outside the app
// folder, and is never logged or sent to the app. Each image is billed to the owner's OpenAI
// account, separate from the Anthropic cap, so the runner keeps its own monthly image cap and a
// per-image cost log.
import fs from 'node:fs';
import path from 'node:path';
import { secretsDir } from './key-file.mjs';

const FILE = () => path.join(secretsDir(), 'openai.json');
export const IMAGE_MODEL = process.env.ORIGIN_IMAGE_MODEL || 'gpt-image-2';
/** What one image costs at each quality (1024x1024, from OpenAI's published examples). Used when the reply has no usage. */
export const IMAGE_USD = { low: 0.006, medium: 0.053, high: 0.211 };
/** Token prices for gpt-image-2: image output $30 per million, text input $5 per million. */
const OUT_PER_TOKEN = 30 / 1e6, IN_PER_TOKEN = 5 / 1e6;
const SIZES = ['1024x1024', '1024x1536', '1536x1024'];

export function openaiConfig() {
  try { return JSON.parse(fs.readFileSync(FILE(), 'utf8')); } catch { return null; }
}
export function saveOpenai(cfg) {
  fs.mkdirSync(secretsDir(), { recursive: true });
  const tmp = `${FILE()}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(cfg), { mode: 0o600 });
  fs.renameSync(tmp, FILE());
}
/** What the app may see: never the key. */
export function openaiPublic() { return { configured: !!openaiConfig()?.key, model: IMAGE_MODEL }; }

/** A worst-case price for one image before it is made, so the image cap is never passed. */
export const imageWorstUsd = (quality) => (IMAGE_USD[quality] ?? IMAGE_USD.medium) * 1.6;

/** Make one image. Returns the PNG as base64 and what it cost (from the reply's usage when given). */
export async function generateImage({ prompt, quality = 'medium', size = '1024x1024', transparent = false }, deps = {}) {
  const key = deps.key ?? openaiConfig()?.key;
  if (!key) throw new Error('OpenAI is not set up. The owner runs npm.cmd run set-openai once.');
  const q = ['low', 'medium', 'high'].includes(quality) ? quality : 'medium';
  const body = { model: IMAGE_MODEL, prompt: String(prompt || '').slice(0, 4000), n: 1, size: SIZES.includes(size) ? size : '1024x1024', quality: q, output_format: 'png', ...(transparent ? { background: 'transparent' } : {}) };
  if (!body.prompt.trim()) throw new Error('Describe the image in prompt.');
  const f = deps.fetch ?? globalThis.fetch;
  const post = (b) => f('https://api.openai.com/v1/images/generations', { method: 'POST', headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' }, body: JSON.stringify(b), signal: AbortSignal.timeout(180_000) });
  let r = await post(body);
  // a model without transparent backgrounds says so: make it on a plain background instead
  if (r.status === 400 && transparent) { const { background, ...rest } = body; void background; r = await post(rest); }
  if (!r.ok) {
    let why = '';
    try { const e = await r.json(); why = String(e.error?.message || '').slice(0, 300); } catch { /* no body */ }
    throw new Error(`OpenAI answered ${r.status}${why ? `: ${why}` : ''}`);
  }
  const data = await r.json();
  const b64 = data.data?.[0]?.b64_json;
  if (!b64) throw new Error('OpenAI returned no image.');
  const u = data.usage;
  const usd = u && Number.isFinite(u.output_tokens) ? (u.output_tokens * OUT_PER_TOKEN) + ((u.input_tokens || 0) * IN_PER_TOKEN) : IMAGE_USD[q];
  return { b64, usd: Math.round(usd * 1e6) / 1e6, model: IMAGE_MODEL, quality: q, size: body.size, estimated: !u };
}

export const IMAGE_TOOL = {
  name: 'design_generate_image',
  description: "Make artwork with the owner's image generator (ChatGPT's gpt-image) and upload it to Printify as a design. Returns image_id for printify_create_product. Each image costs the owner money (about $0.006 low, $0.05 medium, $0.21 high quality), so plan the design first and make one image per product unless it failed. Best for illustrated or photo-style art on mugs, posters, stickers and totes. For text-only designs, write SVG with printify_upload_design instead (free and sharper).",
  input_schema: { type: 'object', properties: {
    prompt: { type: 'string', description: 'The full image description: subject, style, colors, composition, any text to show exactly, and "isolated on a plain background" for print.' },
    quality: { type: 'string', enum: ['low', 'medium', 'high'], description: 'medium for most products; high only for a hero design the research supports' },
    size: { type: 'string', enum: SIZES },
    transparent: { type: 'boolean', description: 'true for shirts, stickers and anything printed on color' },
    file_name: { type: 'string' },
  }, required: ['prompt'] },
};
