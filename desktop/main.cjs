'use strict';
// Desktop app for The Brain. It also starts ORIGIN's runner (server/origin-runner.mjs) in the
// background, so one double-click on the desktop shortcut is all it takes, and when run from
// the app folder it rebuilds the app first if the source changed since the last build.
//
// Security posture: the window runs the built app from a private `app://campus/` scheme (or, for
// development, the local Vite server named by OFFICE_DEV_SERVER_URL). The renderer has no Node:
// contextIsolation on, nodeIntegration off, sandbox on, a strict Content-Security-Policy, all
// permission requests denied except notifications, navigation away from the app blocked, and
// new windows refused (http/https links open in the system browser instead). The preload exposes
// only `window.officeDesktop.saves`, whose file IO happens here with fixed file names under
// <userData>/saves. No environment variables or secrets are passed to the renderer.
const { app, BrowserWindow, ipcMain, protocol, session, shell, Menu } = require('electron');
const { spawn } = require('node:child_process');
const http = require('node:http');
const path = require('node:path');
const fs = require('node:fs');
const { createSaveStore } = require('./saveStore.cjs');

const APP_NAME = 'The Brain';
// saves from before the rename live under this name; they are copied over once
const OLD_APP_NAME = 'Neural Command Campus';
const SCHEME = 'app';
const HOST = 'campus';
const APP_ORIGIN = `${SCHEME}://${HOST}`;
const ROOT = path.resolve(__dirname, '..');
const DIST = path.join(ROOT, 'dist');
const RUNNER = path.join(ROOT, 'server', 'origin-runner.mjs');
const RUNNER_PORT = Number(process.env.ORIGIN_PORT || 8788);

/** Only a local Vite dev server may be loaded instead of the built files. */
function devServerUrl() {
  const raw = process.env.OFFICE_DEV_SERVER_URL;
  if (!raw) return null;
  try {
    const u = new URL(raw);
    if (u.protocol === 'http:' && (u.hostname === 'localhost' || u.hostname === '127.0.0.1')) return u.origin;
  } catch { /* fall through */ }
  console.warn(`Ignoring OFFICE_DEV_SERVER_URL=${raw}: only http://localhost or http://127.0.0.1 is allowed.`);
  return null;
}
const DEV_ORIGIN = devServerUrl();

// Local bridges the app can talk to (AI proxy, Blender bridge) run on this machine only.
const LOCAL = 'http://localhost:* http://127.0.0.1:*';
const CSP = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'", // React style attributes
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "media-src 'self' data: blob:",
  `connect-src 'self' ${LOCAL}`,
  "worker-src 'self' blob:",
  "manifest-src 'self'",
  "object-src 'none'",
  "frame-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join('; ');
// Vite's dev server needs an inline React Refresh preamble and a websocket for hot reload.
const DEV_CSP = CSP
  .replace("script-src 'self'", "script-src 'self' 'unsafe-inline'")
  .replace(`connect-src 'self' ${LOCAL}`, `connect-src 'self' ${LOCAL} ws://localhost:* ws://127.0.0.1:*`);

protocol.registerSchemesAsPrivileged([{ scheme: SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true } }]);

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif', '.ico': 'image/x-icon',
  '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.wav': 'audio/wav', '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg',
  '.glb': 'model/gltf-binary', '.txt': 'text/plain; charset=utf-8',
};

function serveApp() {
  protocol.handle(SCHEME, async (request) => {
    const url = new URL(request.url);
    if (url.host !== HOST) return new Response('Not found', { status: 404 });
    let rel;
    try { rel = decodeURIComponent(url.pathname); } catch { return new Response('Bad request', { status: 400 }); }
    if (rel === '/' || rel === '') rel = '/index.html';
    const file = path.resolve(DIST, `.${rel}`);
    if (file !== DIST && !file.startsWith(DIST + path.sep)) return new Response('Forbidden', { status: 403 });
    try {
      const data = await fs.promises.readFile(file);
      return new Response(data, {
        status: 200,
        headers: {
          'content-type': MIME[path.extname(file).toLowerCase()] ?? 'application/octet-stream',
          'content-security-policy': CSP,
          'x-content-type-options': 'nosniff',
          'cross-origin-opener-policy': 'same-origin',
        },
      });
    } catch {
      return new Response('Not found', { status: 404 });
    }
  });
}

const isAppUrl = (raw) => {
  try { const o = new URL(raw).origin; return o === APP_ORIGIN || (DEV_ORIGIN !== null && o === DEV_ORIGIN); } catch { return false; }
};
const openExternally = (raw) => {
  try { const u = new URL(raw); if (u.protocol === 'https:' || u.protocol === 'http:') void shell.openExternal(u.toString()); } catch { /* ignore */ }
};

function hardenSession() {
  const ses = session.defaultSession;
  // the dev server's responses get the (relaxed) dev CSP; app:// responses carry their own
  if (DEV_ORIGIN) {
    ses.webRequest.onHeadersReceived({ urls: [`${DEV_ORIGIN}/*`] }, (details, done) => {
      done({ responseHeaders: { ...details.responseHeaders, 'Content-Security-Policy': [DEV_CSP] } });
    });
  }
  ses.setPermissionRequestHandler((_wc, permission, done) => done(permission === 'notifications'));
  ses.setPermissionCheckHandler((_wc, permission) => permission === 'notifications');
}

/** Saves made before the app was renamed: copy them into the new data folder once, never over newer ones. */
function adoptOldSaves() {
  const now = path.join(app.getPath('userData'), 'saves');
  const old = path.join(app.getPath('appData'), OLD_APP_NAME, 'saves');
  try {
    if (fs.existsSync(path.join(now, 'current.json')) || !fs.existsSync(old)) return;
    fs.mkdirSync(now, { recursive: true });
    for (const f of fs.readdirSync(old)) if (f.endsWith('.json')) fs.copyFileSync(path.join(old, f), path.join(now, f));
  } catch (e) { console.warn(`Could not copy the old saves: ${e && e.message}`); }
}

// Run a Node script with Electron's own Node, so nothing else needs to be installed.
const runNode = (script, args, opts) => spawn(process.execPath, [script, ...args], { ...opts, env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', ...(opts && opts.env) }, windowsHide: true });

/** Newest modification time under a folder (or of a file). */
function newest(p) {
  try {
    const st = fs.statSync(p);
    if (!st.isDirectory()) return st.mtimeMs;
    return fs.readdirSync(p).reduce((m, f) => Math.max(m, newest(path.join(p, f))), 0);
  } catch { return 0; }
}

/** From the app folder (not an installed copy), rebuild dist/ when the source is newer than the last build. */
function buildIfStale() {
  const vite = path.join(ROOT, 'node_modules', 'vite', 'bin', 'vite.js');
  if (app.isPackaged || DEV_ORIGIN || !fs.existsSync(vite)) return Promise.resolve(true);
  const built = newest(path.join(DIST, 'index.html'));
  const source = Math.max(newest(path.join(ROOT, 'src')), newest(path.join(ROOT, 'public')), newest(path.join(ROOT, 'index.html')));
  if (built && built >= source) return Promise.resolve(true);
  const splash = new BrowserWindow({ width: 420, height: 160, frame: false, resizable: false, backgroundColor: '#03060b', show: true, webPreferences: { sandbox: true, contextIsolation: true } });
  void splash.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent('<body style="margin:0;display:grid;place-items:center;height:100vh;background:#03060b;color:#9beaff;font:15px system-ui">Updating The Brain…</body>')}`);
  return new Promise((resolve) => {
    const child = runNode(vite, ['build'], { cwd: ROOT, stdio: 'ignore' });
    child.on('exit', (code) => { splash.destroy(); resolve(code === 0 || fs.existsSync(path.join(DIST, 'index.html'))); });
    child.on('error', () => { splash.destroy(); resolve(fs.existsSync(path.join(DIST, 'index.html'))); });
  });
}

/** Is a runner already answering (for example one started by hand with npm run origin)? */
function runnerUp() {
  return new Promise((resolve) => {
    const req = http.get({ host: '127.0.0.1', port: RUNNER_PORT, path: '/api/origin/status', timeout: 1500 }, (res) => { res.resume(); resolve(true); });
    req.on('timeout', () => { req.destroy(); resolve(false); });
    req.on('error', () => resolve(false));
  });
}

let runner = null;
/** Start ORIGIN's runner in the background unless one is already running. Its output goes to origin-data/runner.log. */
async function startRunner() {
  if (!fs.existsSync(RUNNER) || await runnerUp()) return;
  // from the app folder the runner keeps its state in <app folder>/origin-data, as with npm run origin
  const dataDir = app.isPackaged ? path.join(app.getPath('userData'), 'origin-data') : path.join(ROOT, 'origin-data');
  fs.mkdirSync(dataDir, { recursive: true });
  const log = fs.openSync(path.join(dataDir, 'runner.log'), 'a');
  runner = runNode(RUNNER, [], { cwd: app.isPackaged ? dataDir : ROOT, stdio: ['ignore', log, log], env: { ORIGIN_DATA_DIR: dataDir } });
  runner.on('exit', () => { runner = null; });
}
const stopRunner = () => { if (runner) { try { runner.kill(); } catch { /* already gone */ } runner = null; } };

let saves = null;
function registerSaveIpc() {
  saves = createSaveStore(path.join(app.getPath('userData'), 'saves'));
  const trusted = (event) => isAppUrl(event.senderFrame?.url ?? '');
  const handle = (channel, fn, fallback) => {
    ipcMain.on(channel, (event, ...args) => {
      if (!trusted(event)) { event.returnValue = fallback; return; }
      try { event.returnValue = fn(...args); } catch (e) { event.returnValue = typeof fallback === 'object' && fallback !== null ? { ok: false, error: String(e && e.message || e) } : fallback; }
    });
  };
  handle('saves:read', () => saves.read(), null);
  handle('saves:readBackup', () => saves.readBackup(), null);
  handle('saves:write', (text, opts) => saves.write(text, { rotateBackup: !(opts && opts.rotateBackup === false) }), { ok: false, error: 'Not allowed.' });
  handle('saves:keepDamaged', (text) => saves.keepDamaged(text), { ok: false, error: 'Not allowed.' });
  handle('saves:info', () => saves.info(), { dir: '', current: '', backup: '', hasCurrent: false, hasBackup: false, damaged: [] });
}

function createWindow() {
  const icon = path.join(ROOT, 'build', process.platform === 'win32' ? 'icon.ico' : 'icon.png');
  const win = new BrowserWindow({
    title: APP_NAME,
    width: 1440,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: '#030605',
    show: false,
    icon: fs.existsSync(icon) ? icon : undefined,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      nodeIntegrationInWorker: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      webviewTag: false,
      spellcheck: false,
    },
  });
  win.on('page-title-updated', (e) => e.preventDefault());
  win.once('ready-to-show', () => win.show());

  const wc = win.webContents;
  wc.setWindowOpenHandler(({ url }) => { openExternally(url); return { action: 'deny' }; });
  wc.on('will-navigate', (e, url) => { if (!isAppUrl(url)) { e.preventDefault(); openExternally(url); } });
  wc.on('will-redirect', (e, url) => { if (!isAppUrl(url)) e.preventDefault(); });
  wc.on('will-attach-webview', (e) => e.preventDefault());

  void win.loadURL(DEV_ORIGIN ? `${DEV_ORIGIN}/` : `${APP_ORIGIN}/index.html`);
  return win;
}

app.setName(APP_NAME);
// saves live in <AppData>/The Brain/saves, whatever folder or copy the app was started from
app.setPath('userData', path.join(app.getPath('appData'), APP_NAME));
if (process.platform === 'win32') app.setAppUserModelId('app.thebrain.desktop');
// one window, one writer: a second launch focuses the first instead of racing it on the save files
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => { const w = BrowserWindow.getAllWindows()[0]; if (w) { if (w.isMinimized()) w.restore(); w.focus(); } });
  app.on('web-contents-created', (_e, contents) => {
    contents.on('will-navigate', (e, url) => { if (!isAppUrl(url)) e.preventDefault(); });
    contents.setWindowOpenHandler(({ url }) => { openExternally(url); return { action: 'deny' }; });
  });
  app.whenReady().then(async () => {
    if (process.platform !== 'darwin') Menu.setApplicationMenu(null);
    adoptOldSaves();
    void startRunner();
    await buildIfStale();
    if (!DEV_ORIGIN && !fs.existsSync(path.join(DIST, 'index.html'))) console.warn('dist/index.html is missing: run `npm run build` first (or use `npm run desktop`).');
    serveApp();
    hardenSession();
    registerSaveIpc();
    createWindow();
    app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
  });
  app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
  app.on('will-quit', stopRunner);
}
