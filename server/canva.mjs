// Canva for the agents' designs, through Canva's own MCP server (https://mcp.canva.com/mcp) with
// the owner's Canva account. The owner signs in once (npm run connect-canva); the sign-in stays in
// the runner, outside the app folder, and is never logged or sent to the app. Canva's policy for
// MCP clients: each person signs in with their own account, access happens only on an explicit
// request (so agents get Canva only in tasks the owner gave), retries are bounded with backoff on
// 429, and Canva AI credit use is shown, never hidden.
import fs from 'node:fs';
import path from 'node:path';
import { secretsDir } from './key-file.mjs';

export const CANVA_MCP = process.env.CANVA_MCP_URL || 'https://mcp.canva.com/mcp';
const FILE = () => path.join(secretsDir(), 'canva.json');
const PROTOCOL = '2025-06-18';

/** The Canva tools agents may use: make, check and export designs. Nothing that shares, deletes, comments or browses the owner's account. */
export const CANVA_ALLOWED = ['create-design', 'get-create-design-async-job', 'generate-design', 'create-design-from-candidate', 'generate-image', 'get-generate-image-job', 'remove-background', 'get-export-formats', 'export-design'];
/** Calls that spend the owner's Canva AI credits. */
export const CANVA_AI = ['create-design', 'generate-design', 'generate-image'];
export const toolName = (canvaName) => `canva_${canvaName.replace(/-/g, '_')}`;
export const canvaName = (tool) => tool.replace(/^canva_/, '').replace(/_/g, '-');

export function canvaConfig() {
  try { return JSON.parse(fs.readFileSync(FILE(), 'utf8')); } catch { return null; }
}
export function saveCanva(cfg) {
  fs.mkdirSync(secretsDir(), { recursive: true });
  const tmp = `${FILE()}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(cfg), { mode: 0o600 });
  fs.renameSync(tmp, FILE());
}
export function forgetCanva() { try { fs.unlinkSync(FILE()); return true; } catch { return false; } }
/** What the app may see: never a token. */
export function canvaPublic() { const c = canvaConfig(); return { configured: !!c?.refreshToken || !!c?.accessToken, connectedAt: c?.connectedAt ?? null }; }

/** Where Canva's sign-in lives, from the server's own OAuth metadata, with Canva's documented endpoints as the fallback. */
export async function discover(f = globalThis.fetch) {
  const origin = new URL(CANVA_MCP).origin;
  const get = async (u) => { try { const r = await f(u, { signal: AbortSignal.timeout(15_000) }); return r.ok ? await r.json() : null; } catch { return null; } };
  const pr = (await get(`${origin}/.well-known/oauth-protected-resource${new URL(CANVA_MCP).pathname}`)) || (await get(`${origin}/.well-known/oauth-protected-resource`));
  const issuer = pr?.authorization_servers?.[0] || origin;
  const as = (await get(`${issuer.replace(/\/$/, '')}/.well-known/oauth-authorization-server`)) || {};
  return {
    authorization_endpoint: as.authorization_endpoint || `${origin}/authorize`,
    token_endpoint: as.token_endpoint || `${origin}/token`,
    registration_endpoint: as.registration_endpoint || `${origin}/register`,
    scopes: pr?.scopes_supported || as.scopes_supported || [],
  };
}

const form = (o) => new URLSearchParams(Object.entries(o).filter(([, v]) => v != null && v !== '')).toString();

/** A fresh access token, refreshing it (and saving the new refresh token) when it is about to expire. */
async function accessToken(deps = {}) {
  const c = deps.config ?? canvaConfig();
  if (!c) throw new Error('Canva is not connected. The owner runs npm.cmd run connect-canva once.');
  if (c.accessToken && (c.expiresAt ?? 0) - 60_000 > Date.now() && !deps.forceRefresh) return c.accessToken;
  if (!c.refreshToken) throw new Error('The Canva sign-in has expired. The owner runs npm.cmd run connect-canva again.');
  const f = deps.fetch ?? globalThis.fetch;
  const r = await f(c.tokenEndpoint, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: form({ grant_type: 'refresh_token', refresh_token: c.refreshToken, client_id: c.clientId, client_secret: c.clientSecret }), signal: AbortSignal.timeout(20_000) });
  if (!r.ok) throw new Error(`Canva did not renew the sign-in (${r.status}). The owner runs npm.cmd run connect-canva again.`);
  const t = await r.json();
  const next = { ...c, accessToken: t.access_token, refreshToken: t.refresh_token || c.refreshToken, expiresAt: Date.now() + (Number(t.expires_in) || 3600) * 1000 };
  (deps.save ?? saveCanva)(next);
  if (deps.config) Object.assign(deps.config, next);
  return next.accessToken;
}

/** The JSON-RPC reply with this id, from a plain JSON body or a server-sent event stream. */
export function readRpc(text, contentType, id) {
  if (!/event-stream/.test(contentType || '')) return JSON.parse(text);
  for (const ev of text.replace(/\r/g, '').split('\n\n')) {
    const data = ev.split('\n').filter((l) => l.startsWith('data:')).map((l) => l.slice(5).trimStart()).join('\n');
    if (!data) continue;
    try { const m = JSON.parse(data); if (m.id === id) return m; } catch { /* not JSON */ }
  }
  throw new Error('Canva sent no answer.');
}

let session = null; // { id, token }
let rpcId = 0;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function post(body, token, deps) {
  const f = deps.fetch ?? globalThis.fetch;
  return f(CANVA_MCP, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', accept: 'application/json, text/event-stream', 'mcp-protocol-version': PROTOCOL, ...(session?.id ? { 'mcp-session-id': session.id } : {}) },
    body: JSON.stringify(body), signal: AbortSignal.timeout(deps.timeoutMs ?? 120_000),
  });
}

/** One request to Canva's MCP server: signs in, starts a session when needed, renews an expired token once and backs off on 429 (twice at most). */
export async function canvaRpc(method, params, deps = {}) {
  for (let attempt = 0; attempt < 4; attempt++) {
    const token = await accessToken({ ...deps, forceRefresh: attempt > 0 && deps._renew });
    deps._renew = false;
    if (!session || session.token !== token) {
      session = null;
      const id = ++rpcId;
      const r = await post({ jsonrpc: '2.0', id, method: 'initialize', params: { protocolVersion: PROTOCOL, capabilities: {}, clientInfo: { name: 'the-brain', version: '1.0.0' } } }, token, deps);
      if (r.status === 401) { deps._renew = true; continue; }
      if (!r.ok) throw new Error(`Canva answered ${r.status} when connecting.`);
      readRpc(await r.text(), r.headers.get('content-type'), id);
      session = { id: r.headers.get('mcp-session-id') || null, token };
      await post({ jsonrpc: '2.0', method: 'notifications/initialized' }, token, deps).catch(() => null);
    }
    const id = ++rpcId;
    const r = await post({ jsonrpc: '2.0', id, method, params }, token, deps);
    if (r.status === 401) { session = null; deps._renew = true; continue; }
    if (r.status === 404 && session?.id) { session = null; continue; } // the session ended: start a new one
    if (r.status === 429) { if (attempt >= 2) throw new Error('Canva is limiting requests right now. Try again in a minute.'); await wait((deps.backoffMs ?? 2000) * 2 ** attempt); continue; }
    if (!r.ok) throw new Error(`Canva answered ${r.status}.`);
    const m = readRpc(await r.text(), r.headers.get('content-type'), id);
    if (m.error) throw new Error(`Canva: ${String(m.error.message || 'error').slice(0, 300)}`);
    return m.result;
  }
  throw new Error('Canva did not accept the sign-in. The owner runs npm.cmd run connect-canva again.');
}
export function resetCanvaSession() { session = null; }

let listed = null; // { at, tools }
/** The allowed Canva tools as agent tools, with Canva's own descriptions and schemas (cached for an hour). */
export async function canvaTools(deps = {}) {
  if (listed && Date.now() - listed.at < 3_600_000 && !deps.fresh) return listed.tools;
  const r = await canvaRpc('tools/list', {}, deps);
  const tools = (r?.tools || []).filter((t) => CANVA_ALLOWED.includes(t.name)).map((t) => ({
    name: toolName(t.name),
    description: `CANVA (the owner's own Canva account${CANVA_AI.includes(t.name) ? '; uses their Canva AI credits, so make each one count' : ''}). ${String(t.description || '').slice(0, 3500)}`,
    input_schema: t.inputSchema && t.inputSchema.type === 'object' ? t.inputSchema : { type: 'object', properties: {} },
  }));
  listed = { at: Date.now(), tools };
  return tools;
}

const parsed = (r) => {
  if (r?.structuredContent && typeof r.structuredContent === 'object') return r.structuredContent;
  for (const c of r?.content || []) if (c.type === 'text') { try { return JSON.parse(c.text); } catch { /* prose */ } }
  return null;
};
const status = (o) => String(o?.status ?? o?.job?.status ?? '').toLowerCase();
const pending = (o) => ['in_progress', 'running', 'pending', 'queued', 'processing'].includes(status(o));

/** Call one Canva tool. Slow jobs (create-design, generate-image) are followed here until they finish, so the agent gets the result in one step. */
export async function callCanva(tool, args, deps = {}) {
  const name = canvaName(tool);
  if (!CANVA_ALLOWED.includes(name)) throw new Error(`${tool} is not available.`);
  let r = await canvaRpc('tools/call', { name, arguments: args || {} }, deps);
  const until = Date.now() + (deps.followMs ?? 150_000);
  const pause = (o) => wait(Math.min(15, Math.max(2, Number(o?.polling_policy?.wait_seconds) || 5)) * 1000 * (deps.pollScale ?? 1));
  if (name === 'create-design') {
    let o = parsed(r);
    while (o?.job_id && o?.continuation_token && pending(o) && Date.now() < until) {
      await pause(o);
      r = await canvaRpc('tools/call', { name: 'get-create-design-async-job', arguments: { job_id: o.job_id, continuation_token: o.continuation_token, user_intent: args?.user_intent || 'make a design for the owner' } }, deps);
      o = { job_id: o.job_id, ...parsed(r) };
    }
  } else if (name === 'generate-image') {
    const jobId = parsed(r)?.jobId ?? parsed(r)?.job_id;
    let o = { status: 'pending' };
    while (jobId && pending(o) && Date.now() < until) {
      await pause(o);
      r = await canvaRpc('tools/call', { name: 'get-generate-image-job', arguments: { jobId, user_intent: args?.user_intent || 'make an image for the owner' } }, deps);
      o = parsed(r) || { status: 'unknown' };
    }
  }
  return r;
}

/** Images Canva returned in a tool result: inline image content, and the files an export links to. */
export async function canvaFiles(r, tool, deps = {}) {
  const out = [];
  for (const c of r?.content || []) {
    if (c.type === 'image' && c.data) out.push({ ext: /jpe?g/.test(c.mimeType || '') ? 'jpg' : 'png', b64: c.data });
    if (c.type === 'resource' && c.resource?.blob && /^image\//.test(c.resource.mimeType || '')) out.push({ ext: /jpe?g/.test(c.resource.mimeType) ? 'jpg' : 'png', b64: c.resource.blob });
  }
  if (canvaName(tool) === 'export-design') {
    const text = JSON.stringify(r?.structuredContent ?? '') + (r?.content || []).filter((c) => c.type === 'text').map((c) => c.text).join('\n');
    const urls = [...new Set(text.match(/https:\/\/[^\s"'<>)\\]+/g) || [])].slice(0, 6);
    const f = deps.fetch ?? globalThis.fetch;
    for (const u of urls) {
      if (out.length >= 4) break;
      try {
        const res = await f(u, { signal: AbortSignal.timeout(60_000) });
        const type = res.headers.get('content-type') || '';
        if (!res.ok || !/^image\/(png|jpe?g)/.test(type)) continue;
        const buf = Buffer.from(await res.arrayBuffer());
        if (buf.length > 25_000_000) continue;
        out.push({ ext: /jpe?g/.test(type) ? 'jpg' : 'png', b64: buf.toString('base64') });
      } catch { /* not a file */ }
    }
  }
  return out;
}

/** What the agent reads back: Canva's text, without the image data. */
export function canvaText(r) {
  const parts = (r?.content || []).map((c) => (c.type === 'text' ? c.text : c.type === 'image' ? '[image]' : c.type === 'resource' ? `[resource ${c.resource?.uri || ''}]` : ''));
  return parts.join('\n').slice(0, 20_000) || JSON.stringify(r?.structuredContent ?? {}).slice(0, 20_000);
}
