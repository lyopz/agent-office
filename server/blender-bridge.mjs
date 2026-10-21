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
const EXPORTS = path.join(ROOT, 'exports');
const MAX_BODY = 16384;
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
      const { kind, file, name } = JSON.parse(raw || '{}');
      if (kind !== 'render' && kind !== 'export') return send(res, 400, { error: 'kind must be render or export' });
      if (!blenderVersion) return send(res, 503, { error: `Blender not found (${BIN}). Install it or set BLENDER_BIN.` });
      return send(res, 201, publicJob(start(kind, file, name)));
    }
    if (req.method === 'GET' && url.pathname.startsWith('/files/')) return serveFile(res, url.pathname.slice('/files/'.length));
    const m = url.pathname.match(/^\/jobs\/([\w-]+)\/cancel$/);
    if (req.method === 'POST' && m) {
      const j = jobs.get(m[1]); if (!j) return send(res, 404, { error: 'no such job' });
      if (j.status === 'running') { j.status = 'cancelling'; j.proc.kill('SIGTERM'); }
      return send(res, 200, publicJob(j));
    }
    send(res, 404, { error: 'not found' });
  } catch (e) { send(res, 400, { error: e.message }); }
});

await detectBlender();
server.listen(PORT, '127.0.0.1', () => console.log(`Blender bridge on http://127.0.0.1:${PORT} · project ${ROOT} · ${blenderVersion ?? 'Blender NOT found'}`));
