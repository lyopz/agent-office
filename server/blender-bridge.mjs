#!/usr/bin/env node
// Local Blender bridge. Connects the Blender Design Studio to a real Blender
// install and reports real machine metrics to the Executive control page.
// Without it, the studio runs in planning mode and every result is simulated.
//
//   BLENDER_PROJECT_DIR=~/game-assets npm run blender-bridge     (listens on 127.0.0.1:8790)
//   BLENDER_BIN=/path/to/blender BRIDGE_PORT=8790 BRIDGE_ORIGIN=http://localhost:5173
//
// Only .blend files inside BLENDER_PROJECT_DIR can be opened, outputs are
// written under its `exports/` folder, and only the bundled scripts run.
// `kind: 'characters'` builds the posted roster as 3D characters with
// tools/blender/build_characters.py (PNG portraits, .glb models, lineup.png);
// GET /files/<path> serves .png/.glb/.json results from `exports/` only.
// Renders can't be paused mid-frame: a job can finish or be cancelled.
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { spawn, execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const PORT = Number(process.env.BRIDGE_PORT || 8790);
const BIN = process.env.BLENDER_BIN || 'blender';
const ROOT = path.resolve((process.env.BLENDER_PROJECT_DIR || process.cwd()).replace(/^~(?=$|\/)/, os.homedir()));
const ORIGIN = process.env.BRIDGE_ORIGIN || '*';
const MAX_JOBS = Number(process.env.BRIDGE_MAX_JOBS || 1);
const EXPORT_SCRIPT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'tools', 'blender', 'export_glb.py');
const CHARACTER_SCRIPT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'tools', 'blender', 'build_characters.py');
const EXPORTS = path.join(ROOT, 'exports');
const MAX_BODY = 1024 * 1024;         // a characters roster; other kinds stay under 16 KB
const MAX_ROSTER = 60;
const FILE_TYPES = { '.png': 'image/png', '.glb': 'model/gltf-binary', '.json': 'application/json', '.blend': 'application/octet-stream', '.webp': 'image/webp' };

const jobs = new Map(); // id -> { id, kind, file, output, status, startedAt, endedAt, log, proc }
let blenderVersion = null;
let lastCpu = os.cpus();

function run(cmd, args) {
  return new Promise((resolve) => execFile(cmd, args, { timeout: 8000 }, (err, stdout) => resolve(err ? null : String(stdout))));
}
async function detectBlender() {
  const out = await run(BIN, ['--version']);
  blenderVersion = out ? out.split('\n')[0].trim() : null;
}
async function gpuMetrics() {
  const out = await run('nvidia-smi', ['--query-gpu=name,memory.used,memory.total,utilization.gpu', '--format=csv,noheader,nounits']);
  if (!out) return null; // no NVIDIA tools: GPU figures are unavailable, not zero
  return out.trim().split('\n').map((l) => { const [name, used, total, util] = l.split(',').map((s) => s.trim()); return { name, memUsedMb: Number(used), memTotalMb: Number(total), utilPct: Number(util) }; });
}
function cpuUtil() {
  const now = os.cpus(); let idle = 0, total = 0;
  now.forEach((c, i) => { const p = lastCpu[i]?.times ?? c.times; for (const k of Object.keys(c.times)) total += c.times[k] - p[k]; idle += c.times.idle - p.idle; });
  lastCpu = now;
  return total > 0 ? Math.round((1 - idle / total) * 100) : null;
}

/** Resolve a path inside the project folder, or null if it escapes it. */
function inside(rel) {
  if (typeof rel !== 'string' || !rel) return null;
  const p = path.resolve(ROOT, rel);
  return p === ROOT || p.startsWith(ROOT + path.sep) ? p : null;
}
const publicJob = ({ proc, stdout, ...j }) => ({ ...j, log: j.log.slice(-2000) });
const runningCount = () => [...jobs.values()].filter((j) => j.status === 'running' || j.status === 'cancelling').length;
function newJobId() {
  let id = `job_${Date.now().toString(36)}`;
  while (jobs.has(id)) id = `job_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  return id;
}

/** Validate a posted roster: { characters: [{ id, name?, title?, appearance }] }, at most 60. */
function checkRoster(roster) {
  const list = roster && typeof roster === 'object' && !Array.isArray(roster) ? roster.characters : null;
  if (!Array.isArray(list) || list.length === 0) throw new Error('roster.characters must be a non-empty array');
  if (list.length > MAX_ROSTER) throw new Error(`roster is limited to ${MAX_ROSTER} characters`);
  const plain = (o) => o !== null && typeof o === 'object' && !Array.isArray(o);
  const seen = new Set();
  return {
    characters: list.map((c, i) => {
      if (!plain(c)) throw new Error(`character ${i} must be an object`);
      if (typeof c.id !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(c.id)) throw new Error(`character ${i}: id must match [A-Za-z0-9_-]{1,64}`);
      if (seen.has(c.id)) throw new Error(`duplicate character id ${c.id}`);
      seen.add(c.id);
      if (!plain(c.appearance)) throw new Error(`character ${c.id}: appearance must be an object`);
      return { id: c.id, name: typeof c.name === 'string' ? c.name.slice(0, 64) : c.id, title: typeof c.title === 'string' ? c.title.slice(0, 64) : '', appearance: c.appearance };
    }),
  };
}

/** Build a roster of characters in Blender: writes exports/characters/<jobId>/{<id>.png,<id>.glb,lineup.png},
 *  plus <id>_sprites.webp walk/sit/talk strips with `sprites` (only those with `spritesOnly`). */
function startCharacters(roster, name, { sprites = false, spritesOnly = false } = {}) {
  const clean = checkRoster(roster);
  if (runningCount() >= MAX_JOBS) throw new Error(`already running ${MAX_JOBS} job(s)`);
  const id = newJobId();
  const outDir = path.join(EXPORTS, 'characters', id); fs.mkdirSync(outDir, { recursive: true });
  const rosterFile = path.join(outDir, 'roster.json');
  fs.writeFileSync(rosterFile, JSON.stringify(clean));
  const rel = (f) => path.posix.join('characters', id, f);
  const args = ['-b', '--factory-startup', '--python-exit-code', '1', '--python', CHARACTER_SCRIPT, '--', rosterFile, outDir];
  if (spritesOnly === true) args.push('--sprites-only'); else if (sprites === true) args.push('--sprites');
  const job = { id, kind: 'characters', file: null, name: typeof name === 'string' ? name.slice(0, 80) : null, count: clean.characters.length, output: spritesOnly === true ? null : rel('lineup.png'), outputs: [], sprites: sprites === true || spritesOnly === true ? { only: spritesOnly === true } : null, status: 'running', startedAt: new Date().toISOString(), endedAt: null, log: '', pausable: false, stdout: '' };
  const proc = spawn(BIN, args, { cwd: ROOT });
  proc.stdout.on('data', (d) => { job.log = (job.log + d).slice(-8000); job.stdout = (job.stdout + d).slice(-16000); });
  proc.stderr.on('data', (d) => { job.log = (job.log + d).slice(-8000); });
  proc.on('error', (e) => { job.log += `\n${e.message}`; });
  proc.on('close', (code) => {
    job.endedAt = new Date().toISOString();
    // the script's last stdout line is {"ok":..,"outputs":[file names in outDir]}
    let result = null;
    for (const line of job.stdout.split('\n').reverse()) {
      if (!line.trim().startsWith('{')) continue;
      try { const r = JSON.parse(line); if (r && typeof r.ok === 'boolean') { result = r; break; } } catch { /* not the result line */ }
    }
    const files = Array.isArray(result?.outputs) ? result.outputs.filter((f) => typeof f === 'string' && /^[\w.-]+\.(png|glb|blend|webp)$/.test(f) && fs.existsSync(path.join(outDir, f))) : [];
    job.outputs = files.map(rel);
    job.output = files.includes('lineup.png') ? rel('lineup.png') : (job.outputs[0] ?? null);
    if (result?.errors) job.errors = result.errors;
    if (result?.engine) job.engine = result.engine;
    if (result?.sprites && job.sprites) Object.assign(job.sprites, { frames: result.sprites.frames, w: result.sprites.w, h: result.sprites.h });
    if (job.status === 'cancelling') job.status = 'cancelled';
    else job.status = code === 0 && result?.ok && files.length ? 'completed' : 'failed';
  });
  jobs.set(id, Object.assign(job, { proc }));
  return job;
}

/** Serve a result file from exports/ only: no traversal, no symlink escapes, only .png/.glb/.blend/.json/.webp. */
function serveFile(res, relEncoded) {
  let rel;
  try { rel = decodeURIComponent(relEncoded); } catch { return send(res, 400, { error: 'bad path' }); }
  if (!rel || rel.includes('\0')) return send(res, 400, { error: 'bad path' });
  const type = FILE_TYPES[path.extname(rel).toLowerCase()];
  if (!type) return send(res, 403, { error: 'only .png, .glb, .blend, .json and .webp files are served' });
  const p = path.resolve(EXPORTS, rel);
  if (!p.startsWith(EXPORTS + path.sep)) return send(res, 403, { error: 'outside exports' });
  let real;
  try { real = fs.realpathSync(p); } catch { return send(res, 404, { error: 'not found' }); }
  let realRoot;
  try { realRoot = fs.realpathSync(EXPORTS); } catch { return send(res, 404, { error: 'not found' }); }
  if (!real.startsWith(realRoot + path.sep)) return send(res, 403, { error: 'outside exports' });
  const st = fs.statSync(real);
  if (!st.isFile()) return send(res, 404, { error: 'not found' });
  res.writeHead(200, { 'content-type': type, 'content-length': st.size, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'access-control-allow-origin': ORIGIN, 'access-control-allow-methods': 'GET,POST,OPTIONS', 'access-control-allow-headers': 'content-type' });
  fs.createReadStream(real).pipe(res);
}

function start(kind, file, name) {
  const blend = inside(file);
  if (!blend || !blend.endsWith('.blend') || !fs.existsSync(blend)) throw new Error('file must be an existing .blend inside the project folder');
  if ([...jobs.values()].filter((j) => j.status === 'running').length >= MAX_JOBS) throw new Error(`already running ${MAX_JOBS} job(s)`);
  const id = `job_${Date.now().toString(36)}`;
  const outDir = path.join(ROOT, 'exports'); fs.mkdirSync(outDir, { recursive: true });
  const base = (name || path.basename(blend, '.blend')).replace(/[^\w.-]+/g, '_');
  const output = kind === 'export' ? path.join(outDir, `${base}.glb`) : path.join(outDir, `${base}_####`);
  const args = kind === 'export' ? ['-b', blend, '--python', EXPORT_SCRIPT, '--', output] : ['-b', blend, '-o', output, '-F', 'PNG', '-f', '1'];
  const job = { id, kind, file: path.relative(ROOT, blend), output: path.relative(ROOT, kind === 'export' ? output : output.replace('####', '0001') + '.png'), status: 'running', startedAt: new Date().toISOString(), endedAt: null, log: '', pausable: false };
  const proc = spawn(BIN, args, { cwd: ROOT });
  proc.stdout.on('data', (d) => { job.log = (job.log + d).slice(-8000); });
  proc.stderr.on('data', (d) => { job.log = (job.log + d).slice(-8000); });
  proc.on('close', (code) => {
    job.endedAt = new Date().toISOString();
    if (job.status === 'cancelling') job.status = 'cancelled';
    else job.status = code === 0 && fs.existsSync(path.join(ROOT, job.output)) ? 'completed' : 'failed';
  });
  jobs.set(id, Object.assign(job, { proc }));
  return job;
}

function send(res, code, body) {
  res.writeHead(code, { 'content-type': 'application/json', 'access-control-allow-origin': ORIGIN, 'access-control-allow-methods': 'GET,POST,OPTIONS', 'access-control-allow-headers': 'content-type' });
  res.end(JSON.stringify(body));
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') return send(res, 204, {});
  const url = new URL(req.url, 'http://local');
  try {
    if (req.method === 'GET' && url.pathname === '/health') return send(res, 200, { ok: true, blender: blenderVersion, projectDir: path.basename(ROOT) });
    if (req.method === 'GET' && url.pathname === '/metrics') {
      const running = [...jobs.values()].filter((j) => j.status === 'running').length;
      return send(res, 200, { ram: { usedMb: Math.round((os.totalmem() - os.freemem()) / 1048576), totalMb: Math.round(os.totalmem() / 1048576) }, cpu: { utilPct: cpuUtil(), cores: os.cpus().length }, gpu: await gpuMetrics(), blenderJobs: running, measuredAt: new Date().toISOString() });
    }
    if (req.method === 'GET' && url.pathname === '/jobs') return send(res, 200, [...jobs.values()].slice(-50).map(publicJob));
    if (req.method === 'POST' && url.pathname === '/jobs') {
      let raw = ''; for await (const c of req) { raw += c; if (raw.length > MAX_BODY) return send(res, 413, { error: 'body too large' }); }
      const { kind, file, name, roster, sprites, spritesOnly } = JSON.parse(raw || '{}');
      if (kind !== 'render' && kind !== 'export' && kind !== 'characters') return send(res, 400, { error: 'kind must be render, export or characters' });
      if (kind !== 'characters' && raw.length > 16384) return send(res, 413, { error: 'body too large' });
      if (!blenderVersion) return send(res, 503, { error: `Blender not found (${BIN}). Install it or set BLENDER_BIN.` });
      if (kind === 'characters') return send(res, 201, publicJob(startCharacters(roster, name, { sprites, spritesOnly })));
      return send(res, 201, publicJob(start(kind, file, name)));
    }
    if (req.method === 'GET' && url.pathname.startsWith('/files/')) return serveFile(res, url.pathname.slice('/files/'.length));
    const m = url.pathname.match(/^\/jobs\/([\w-]+)\/cancel$/);
    if (req.method === 'POST' && m) {
      const j = jobs.get(m[1]); if (!j) return send(res, 404, { error: 'no such job' });
      if (j.status === 'running') { j.status = 'cancelling'; j.proc.kill('SIGTERM'); }
      return send(res, 200, publicJob(j));
    }
    // open a finished character scene in the Blender window on this machine
    const o = url.pathname.match(/^\/jobs\/([\w-]+)\/open$/);
    if (req.method === 'POST' && o) {
      const j = jobs.get(o[1]); if (!j) return send(res, 404, { error: 'no such job' });
      const rel = (j.outputs ?? []).find((f) => f.endsWith('/characters.blend'));
      if (!rel || !blenderVersion) return send(res, 409, { error: 'this job has no .blend scene to open' });
      const abs = path.join(ROOT, 'exports', rel);
      spawn(BIN, [abs], { cwd: path.dirname(abs), detached: true, stdio: 'ignore' }).unref();
      return send(res, 200, { opened: rel });
    }
    send(res, 404, { error: 'not found' });
  } catch (e) { send(res, 400, { error: e.message }); }
});

await detectBlender();
server.listen(PORT, '127.0.0.1', () => console.log(`Blender bridge on http://127.0.0.1:${PORT} · project ${ROOT} · ${blenderVersion ?? 'Blender NOT found'}`));
