#!/usr/bin/env node
// Server-side AI proxy for the command console's "live" provider.
// The API key lives only in this process's environment. The browser sends a
// command plus a secret-free office summary and gets back structured ops,
// which the app schema-checks, dry-runs and validates before applying.
//
//   ANTHROPIC_API_KEY=sk-... npm run proxy        (listens on :8787)
//   AI_MODEL=claude-sonnet-5-5 AI_PROXY_PORT=8787 RATE_LIMIT_PER_MIN=20
import http from 'node:http';

const PORT = Number(process.env.AI_PROXY_PORT || 8787);
const MODEL = process.env.AI_MODEL || 'claude-sonnet-5-5';
const KEY = process.env.ANTHROPIC_API_KEY;
const LIMIT = Number(process.env.RATE_LIMIT_PER_MIN || 20);
const MAX_BODY = 256 * 1024;

const SYSTEM = `You translate plain-English office-layout commands into structured operations for an agent office simulator.
Respond with ONE JSON object only, no prose, matching:
{"kind":"plan"|"clarify"|"unsupported","ops":[...],"runtimeOps":[...],"explanation":["short step"],"question":"...","options":[{"label":"...","command":"..."}],"message":"..."}
Coordinates are integer grid cells. Rooms are rects {x,y,w,h}. Use only ids present in the context. Never invent secrets or credentials.
Allowed ops (field shapes):
- room.create {type,x,y,w,h,name?}  type: operations|office|research|server|meeting|workshop|storage|break|security|reception|custom
- room.update {id,patch:{name?,x?,y?,w?,h?,purpose?}}  room.delete {id,cascade?}  room.duplicate {id,x?,y?}
- door.add {roomId,side:"n"|"s"|"e"|"w",offset,width?}
- corridor.update {id,patch:{width?,routing?:"auto"|"manual",blocked?,name?}}  corridor.delete {id}  corridors.realign {}
- rooms.connect {a,b,width?}  room.connectToCorridor {roomId,corridorId}
- furniture.add {roomId,type:desk|chair|computer|monitors|server-rack|whiteboard|cabinet|conference-table|shelf|container|plant|lamp|sofa|decor|workbench,x,y,workstationName?} (x,y relative to room)  furniture.delete {id}
- agent.create {name,title?,department?,roomId?}  agent.update {id,patch:{identity?,personality?,appearance?,skills?}}
- agent.assignRoom {agentId,roomId}  workstation.assign {furnitureId,agentId}  office.rename {name}
Runtime ops: agent.goTo {agentId,roomId,workstationId?}, task.create {agentId,name,description?,priority?:"low"|"normal"|"high"|"critical",roomId?}
If the command is ambiguous, return kind "clarify" with a question and options. If impossible, kind "unsupported" with message.
Prefer moving rooms to free space that doesn't overlap other rooms; corridors reroute automatically after room moves.`;

const hits = new Map();
function limited(ip) {
  const now = Date.now();
  const list = (hits.get(ip) || []).filter((t) => now - t < 60_000);
  list.push(now);
  hits.set(ip, list);
  return list.length > LIMIT;
}

function send(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
  res.end(JSON.stringify(body));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', (c) => { size += c.length; if (size > MAX_BODY) { reject(new Error('too large')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function extractJson(text) {
  const start = text.indexOf('{'); const end = text.lastIndexOf('}');
  if (start < 0 || end < start) throw new Error('no JSON in model output');
  return JSON.parse(text.slice(start, end + 1));
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'GET' && req.url === '/api/ai/health') return send(res, 200, { ok: true, model: MODEL, configured: Boolean(KEY) });
  if (req.method !== 'POST' || req.url !== '/api/ai/plan') return send(res, 404, { error: 'not found' });
  const ip = req.socket.remoteAddress || 'unknown';
  if (limited(ip)) return send(res, 429, { error: 'rate limited' });
  if (!KEY) return send(res, 503, { error: 'ANTHROPIC_API_KEY is not set on the server' });
  let input;
  try { input = JSON.parse(await readBody(req)); } catch { return send(res, 400, { error: 'invalid request body' }); }
  if (typeof input?.command !== 'string' || !input.command.trim() || input.command.length > 2000) return send(res, 400, { error: 'command required' });
  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': KEY, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: MODEL, max_tokens: 4096, system: SYSTEM,
        messages: [{ role: 'user', content: `Office context:\n${JSON.stringify(input.context ?? {})}\n\nCommand: ${input.command}` }],
      }),
      signal: AbortSignal.timeout(28_000),
    });
    if (r.status === 429) return send(res, 429, { error: 'upstream rate limited' });
    if (!r.ok) { console.error(`[ai-proxy] upstream ${r.status}`); return send(res, 502, { error: `upstream error ${r.status}` }); }
    const data = await r.json();
    const text = (data.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('');
    return send(res, 200, extractJson(text));
  } catch (e) {
    // Log the failure class only; never the request headers or key.
    console.error(`[ai-proxy] ${e.name}: ${e.message}`);
    return send(res, 502, { error: 'model call failed' });
  }
});

server.listen(PORT, () => console.log(`[ai-proxy] listening on :${PORT} model=${MODEL} key=${KEY ? 'set' : 'MISSING'}`));
