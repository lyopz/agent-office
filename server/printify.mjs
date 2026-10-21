// Printify for ORIGIN's agents. The owner connects their Etsy shop inside Printify
// and saves a Printify personal access token once (npm run set-printify). Agents can
// browse the catalog, upload designs and create products, which stay unpublished in
// Printify. Only the owner publishes: each product an agent marks ready waits for the
// owner's Publish button in the app. The token stays in the runner; never logged or sent to the app.
import fs from 'node:fs';
import path from 'node:path';
import { secretsDir } from './key-file.mjs';

const API = 'https://api.printify.com/v1';
const FILE = () => path.join(secretsDir(), 'printify.json');

export function printifyConfig() {
  try { return JSON.parse(fs.readFileSync(FILE(), 'utf8')); } catch { return null; }
}
export function savePrintify(cfg) {
  fs.mkdirSync(secretsDir(), { recursive: true });
  const tmp = `${FILE()}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(cfg), { mode: 0o600 });
  fs.renameSync(tmp, FILE());
}
/** What the app may see: never the token. */
export function printifyPublic() {
  const c = printifyConfig();
  return { configured: !!c?.token, shopId: c?.shopId ?? null, shopTitle: c?.shopTitle ?? null, channel: c?.channel ?? null };
}

export async function pf(p, { deps = {}, method = 'GET', body } = {}) {
  const c = deps.config ?? printifyConfig();
  if (!c?.token) throw new Error('Printify is not set up. The owner runs npm.cmd run set-printify once.');
  const f = deps.fetch ?? globalThis.fetch;
  const r = await f(`${API}${p}`, { method, headers: { authorization: `Bearer ${c.token}`, 'user-agent': 'TheBrain/1.0', ...(body ? { 'content-type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(30_000) });
  if (!r.ok) {
    let why = '';
    try { const e = await r.json(); why = String(e.message || e.error || JSON.stringify(e.errors || '')).slice(0, 400); } catch { /* no body */ }
    throw new Error(`Printify answered ${r.status}${why ? `: ${why}` : ''}`);
  }
  return r.status === 204 ? {} : r.json();
}

/** The shop products go to: the one the owner picked, else the first. */
async function shopId(deps) {
  const c = deps?.config ?? printifyConfig();
  if (c?.shopId) return c.shopId;
  const shops = await pf('/shops.json', { deps });
  if (!shops?.length) throw new Error('No shop is connected in Printify yet. The owner connects their Etsy shop at printify.com first.');
  return shops[0].id;
}

let blueprints = null;
const tools = {
  async printify_find_product_type(input, deps) {
    blueprints ??= await pf('/catalog/blueprints.json', { deps });
    const words = String(input.query || '').toLowerCase().split(/\s+/).filter(Boolean);
    return { matches: blueprints.filter((b) => words.every((w) => `${b.title} ${b.brand} ${b.model}`.toLowerCase().includes(w))).slice(0, 20).map((b) => ({ blueprint_id: b.id, title: b.title, brand: b.brand, model: b.model })) };
  },
  async printify_providers(input, deps) {
    const list = await pf(`/catalog/blueprints/${Number(input.blueprint_id)}/print_providers.json`, { deps });
    return { providers: list.map((p) => ({ print_provider_id: p.id, title: p.title, location: p.location?.country ?? null })) };
  },
  async printify_variants(input, deps) {
    const v = await pf(`/catalog/blueprints/${Number(input.blueprint_id)}/print_providers/${Number(input.print_provider_id)}/variants.json`, { deps });
    return { variants: (v.variants || []).slice(0, 120).map((x) => ({ id: x.id, title: x.title, placeholders: (x.placeholders || []).map((p) => p.position) })) };
  },
  async printify_upload_design(input, deps) {
    const name = String(input.file_name || 'design.svg').replace(/[^\w.-]/g, '_').slice(0, 80);
    const body = input.svg ? { file_name: name.endsWith('.svg') ? name : `${name}.svg`, contents: Buffer.from(String(input.svg)).toString('base64') } : input.url ? { file_name: name, url: String(input.url) } : null;
    if (!body) throw new Error('Give either svg (the full SVG markup of the design) or url (a public image link).');
    const img = await pf('/uploads/images.json', { deps, method: 'POST', body });
    return { image_id: img.id, width: img.width, height: img.height, preview: img.preview_url };
  },
  async printify_create_product(input, deps) {
    const shop = await shopId(deps);
    const variantIds = (input.variant_ids || []).map(Number).filter(Boolean).slice(0, 100);
    if (!variantIds.length) throw new Error('Pick the variant_ids to sell (from printify_variants).');
    const cents = Math.round(Number(input.price_usd) * 100);
    if (!(cents > 0)) throw new Error('Give price_usd, the retail price you researched.');
    const body = {
      title: String(input.title || '').slice(0, 140), description: String(input.description || '').slice(0, 5000),
      blueprint_id: Number(input.blueprint_id), print_provider_id: Number(input.print_provider_id),
      variants: variantIds.map((id) => ({ id, price: cents, is_enabled: true })),
      print_areas: [{ variant_ids: variantIds, placeholders: [{ position: String(input.position || 'front'), images: [{ id: String(input.image_id), x: 0.5, y: 0.5, scale: Number(input.scale) || 1, angle: 0 }] }] }],
      ...(Array.isArray(input.tags) ? { tags: input.tags.map((t) => String(t).slice(0, 20)).slice(0, 13) } : {}),
    };
    const p = await pf(`/shops/${shop}/products.json`, { deps, method: 'POST', body });
    return { product_id: p.id, shop_id: shop, title: p.title, note: 'Created in Printify, not published. Call printify_request_publish when it is ready for the owner to approve.' };
  },
  async printify_my_products(input, deps) {
    const shop = await shopId(deps);
    const list = await pf(`/shops/${shop}/products.json?limit=${Math.min(50, Number(input.limit) || 20)}`, { deps });
    return { products: (list.data || []).map((p) => ({ product_id: p.id, title: p.title, visible: p.visible, published: !!p.external?.id, created: p.created_at })) };
  },
};

export const PRINTIFY_TOOLS = [
  { name: 'printify_find_product_type', description: 'Search the Printify catalog for a product type (blueprint), e.g. "mug 11oz", "unisex t-shirt", "poster".', input_schema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] } },
  { name: 'printify_providers', description: 'Print providers that make a blueprint, with their country.', input_schema: { type: 'object', properties: { blueprint_id: { type: 'integer' } }, required: ['blueprint_id'] } },
  { name: 'printify_variants', description: 'Sizes and colors (variant ids) a provider offers for a blueprint, and the print positions.', input_schema: { type: 'object', properties: { blueprint_id: { type: 'integer' }, print_provider_id: { type: 'integer' } }, required: ['blueprint_id', 'print_provider_id'] } },
  { name: 'printify_upload_design', description: 'Upload a design to Printify. Either write the design yourself as complete SVG markup (typography, simple vector art; size it for print, e.g. 4500x5400 for shirts) in "svg", or give a public image "url". Returns image_id.', input_schema: { type: 'object', properties: { file_name: { type: 'string' }, svg: { type: 'string' }, url: { type: 'string' } } } },
  { name: 'printify_create_product', description: "Create a product in the owner's Printify shop from an uploaded design. It is NOT published: it waits in Printify until the owner approves it. Use a researched price, an SEO title, a full description and 13 tags.", input_schema: { type: 'object', properties: { title: { type: 'string' }, description: { type: 'string' }, blueprint_id: { type: 'integer' }, print_provider_id: { type: 'integer' }, variant_ids: { type: 'array', items: { type: 'integer' } }, price_usd: { type: 'number' }, image_id: { type: 'string' }, position: { type: 'string', description: 'usually front' }, scale: { type: 'number' }, tags: { type: 'array', items: { type: 'string' }, maxItems: 13 } }, required: ['title', 'description', 'blueprint_id', 'print_provider_id', 'variant_ids', 'price_usd', 'image_id'] } },
  { name: 'printify_my_products', description: "The products already in the owner's Printify shop and whether each is published.", input_schema: { type: 'object', properties: { limit: { type: 'integer' } } } },
  { name: 'printify_request_publish', description: "Ask the owner to publish a finished product to their Etsy shop. You cannot publish; the owner approves each one in the app. Say why it should sell in one or two sentences.", input_schema: { type: 'object', properties: { product_id: { type: 'string' }, title: { type: 'string' }, why: { type: 'string' } }, required: ['product_id', 'title'] } },
];

/** Run one Printify tool call. printify_request_publish is handled by the runner (it records the request). */
export async function runPrintifyTool(name, input, deps) {
  try {
    const fn = tools[name];
    if (!fn) return { content: `unknown tool ${name}`, isError: true };
    return { content: JSON.stringify(await fn(input || {}, deps)).slice(0, 30_000), isError: false };
  } catch (e) {
    return { content: e.message, isError: true };
  }
}

/** The owner pressed Publish: send the product to the connected Etsy shop. */
export async function publishProduct(shop, productId, deps) {
  await pf(`/shops/${shop}/products/${encodeURIComponent(productId)}/publish.json`, { deps, method: 'POST', body: { title: true, description: true, images: true, variants: true, tags: true, keyFeatures: true, shipping_template: true } });
  return true;
}

/** A product's default mockup and its lowest price, for the owner's approval list. */
export async function productPreview(productId, deps) {
  const shop = await shopId(deps);
  const p = await pf(`/shops/${shop}/products/${encodeURIComponent(productId)}.json`, { deps });
  const img = (p.images || []).find((i) => i.is_default) || (p.images || [])[0];
  const cents = (p.variants || []).filter((v) => v.is_enabled !== false).map((v) => v.price).filter((n) => n > 0);
  return { image: img?.src ? String(img.src) : null, priceUsd: cents.length ? Math.min(...cents) / 100 : null };
}
