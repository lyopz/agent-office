// Canvas-drawn content for screens, wall displays and signs. Each display kind
// shows what a team does at a glance: code and a live build for developers,
// connected findings for research, level layouts for game design, blueprints
// for 3D, type specimens for typography, build plans for builders, campaign
// boards for advertising, and the command overview in the throne room.
import * as THREE from 'three';
import type { RoomTheme } from './layout';

export type DisplayKind =
  | 'code' | 'build-preview' | 'findings' | 'references' | 'level-layout' | 'game-loop' | 'mechanics'
  | 'blueprint' | 'wireframe' | 'materials' | 'font-compare' | 'type-scale' | 'game-ui'
  | 'build-plan' | 'parts' | 'terrain' | 'campaign' | 'drafts' | 'command' | 'team-status'
  | 'tasks' | 'kanban' | 'chart' | 'budget' | 'health' | 'render-queue' | 'welcome' | 'briefing'
  | 'arcade-flappy' | 'arcade-pacman' | 'arcade-pong' | 'city';

export const THEME_DISPLAYS: Record<RoomTheme, [DisplayKind, DisplayKind]> = {
  royal: ['command', 'team-status'], dev: ['code', 'build-preview'], research: ['findings', 'references'],
  gamedesign: ['level-layout', 'game-loop'], model3d: ['blueprint', 'materials'], type: ['font-compare', 'game-ui'],
  building: ['build-plan', 'parts'], ads: ['campaign', 'drafts'], ops: ['kanban', 'chart'], server: ['health', 'chart'],
  lounge: ['welcome', 'chart'], generic: ['kanban', 'chart'],
};
const THEME_DESK: Record<RoomTheme, DisplayKind> = {
  royal: 'command', dev: 'code', research: 'references', gamedesign: 'level-layout', model3d: 'wireframe', type: 'type-scale',
  building: 'terrain', ads: 'drafts', ops: 'tasks', server: 'health', lounge: 'chart', generic: 'tasks',
};

/** Screen content for a furniture type in a room of the given theme. */
export function furnitureDisplay(type: string, theme: RoomTheme, game?: string): DisplayKind {
  switch (type) {
    case 'whiteboard': return theme === 'research' ? 'findings' : theme === 'gamedesign' ? 'mechanics' : theme === 'building' ? 'build-plan' : theme === 'ads' ? 'campaign' : 'kanban';
    case 'project-board': case 'task-board': case 'project-display': return theme === 'building' ? 'build-plan' : 'kanban';
    case 'analytics-wall': case 'market-display': case 'marketplace-display': case 'inventory-monitor': case 'comparison-wall': return 'chart';
    case 'budget-dashboard': case 'finance-terminal': return 'budget';
    case 'render-wall': return 'render-queue';
    case 'reference-display': return theme === 'model3d' ? 'materials' : theme === 'type' ? 'font-compare' : theme === 'ads' ? 'drafts' : 'references';
    case 'diagnostic-panel': return 'health';
    case 'briefing-board': return 'briefing';
    case 'workstation-3d': case 'anim-station': return 'wireframe';
    case 'test-station': return 'build-preview';
    case 'arcade-cabinet': return game === 'pacman' ? 'arcade-pacman' : game === 'pong' ? 'arcade-pong' : 'arcade-flappy';
    case 'window': return 'city';
    case 'code-wall': return 'code';
    case 'build-preview': return 'build-preview';
    case 'evidence-board': case 'note-wall': return 'findings';
    case 'mechanics-board': return 'mechanics';
    case 'blueprint-wall': return 'blueprint';
    case 'font-specimen-wall': return 'font-compare';
    case 'type-scale-panel': case 'lettering-desk': return 'type-scale';
    case 'game-ui-preview': return 'game-ui';
    case 'build-plan-board': return 'build-plan';
    case 'campaign-board': case 'concept-review-wall': return 'campaign';
    case 'image-draft-gallery': case 'final-asset-display': return 'drafts';
    case 'command-display': return 'command';
    case 'material-swatches': return 'materials';
    case 'team-sign': return 'welcome';
    case 'planning-desk': return theme === 'gamedesign' ? 'level-layout' : THEME_DESK[theme];
    case 'archive-terminal': case 'evidence-station': case 'research-kiosk': return 'references';
    default: return THEME_DESK[theme];
  }
}

export const DISPLAY_TITLE: Record<DisplayKind, string> = {
  code: 'SCRIPT EDITOR — PlayerController.luau', 'build-preview': 'LIVE BUILD PREVIEW', findings: 'FINDINGS BOARD', references: 'REFERENCE SEARCH',
  'level-layout': 'LEVEL LAYOUT — WORLD 1', 'game-loop': 'GAMEPLAY LOOP', mechanics: 'MECHANICS BOARD', blueprint: 'BLUEPRINT — FRONT / SIDE / TOP',
  wireframe: 'WIREFRAME', materials: 'MATERIAL SAMPLES', 'font-compare': 'FONT COMPARISON', 'type-scale': 'SIZE & WEIGHT', 'game-ui': 'IN-GAME PREVIEW',
  'build-plan': 'BUILD PLAN', parts: 'MODULAR PARTS · SCALE', terrain: 'TERRAIN PREVIEW', campaign: 'CAMPAIGN BOARD', drafts: 'GENERATED DRAFTS → FINAL',
  command: 'HQ COMMAND OVERVIEW', 'team-status': 'TEAM STATUS', tasks: 'TASK QUEUE', kanban: 'PROJECT BOARD', chart: 'THROUGHPUT',
  budget: 'BUDGET', health: 'SYSTEM HEALTH', 'render-queue': 'RENDER QUEUE', welcome: 'WELCOME', briefing: 'HOURLY BRIEFING',
  'arcade-flappy': 'FLAPPY', 'arcade-pacman': 'MAZE CHASE', 'arcade-pong': 'PONG', city: '',
};

/** Kinds redrawn a few times a second while the avatar is nearby. */
export const ANIMATED_KINDS = new Set<DisplayKind>(['build-preview', 'command', 'render-queue', 'health']);

type Ctx = CanvasRenderingContext2D;
const W = 512, H = 288;
const FONT = '"Inter", "Segoe UI", system-ui, sans-serif';
const MONO = '"JetBrains Mono", "Consolas", ui-monospace, monospace';

function rr(c: Ctx, x: number, y: number, w: number, h: number, r: number) {
  c.beginPath(); c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r); c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath();
}
function rnd(seed: number) { let s = seed || 1; return () => { s = (s * 16807) % 2147483647; return (s - 1) / 2147483646; }; }
function hexA(hex: string, a: number) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex); if (!m) return `rgba(124,247,255,${a})`;
  const n = parseInt(m[1], 16); return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

function frame(c: Ctx, title: string, acc: string) {
  const g = c.createLinearGradient(0, 0, 0, H); g.addColorStop(0, '#0b1020'); g.addColorStop(1, '#070a14');
  c.fillStyle = g; c.fillRect(0, 0, W, H);
  c.fillStyle = hexA(acc, 0.16); c.fillRect(0, 0, W, 30);
  c.fillStyle = acc; c.fillRect(0, 30, W, 2);
  if (title) { c.font = `700 15px ${FONT}`; c.fillStyle = '#eaf6ff'; c.textBaseline = 'middle'; c.fillText(title, 12, 16); }
  for (const [i, col] of ['#ff5f57', '#febc2e', '#28c840'].entries()) { c.fillStyle = col; c.beginPath(); c.arc(W - 16 - i * 16, 15, 4.5, 0, Math.PI * 2); c.fill(); }
  c.textBaseline = 'alphabetic';
}

function text(c: Ctx, s: string, x: number, y: number, size: number, color: string, weight = 500, font = FONT, align: CanvasTextAlign = 'left') {
  c.font = `${weight} ${size}px ${font}`; c.fillStyle = color; c.textAlign = align; c.fillText(s, x, y); c.textAlign = 'left';
}

function bars(c: Ctx, x: number, y: number, w: number, h: number, n: number, acc: string, seed: number) {
  const r = rnd(seed);
  for (let i = 0; i < n; i++) {
    const v = 0.25 + r() * 0.7, bw = w / n - 6;
    const g = c.createLinearGradient(0, y + h - v * h, 0, y + h); g.addColorStop(0, acc); g.addColorStop(1, hexA(acc, 0.25));
    c.fillStyle = g; rr(c, x + i * (w / n), y + h - v * h, bw, v * h, 3); c.fill();
  }
}
function line(c: Ctx, x: number, y: number, w: number, h: number, acc: string, seed: number, t = 0) {
  const r = rnd(seed); const pts: number[] = [];
  for (let i = 0; i <= 14; i++) pts.push(0.3 + r() * 0.5 + Math.sin(i * 0.7 + t) * 0.1);
  c.strokeStyle = acc; c.lineWidth = 3; c.beginPath();
  pts.forEach((v, i) => { const px = x + (i / 14) * w, py = y + h - v * h; if (i) c.lineTo(px, py); else c.moveTo(px, py); });
  c.stroke();
  c.lineTo(x + w, y + h); c.lineTo(x, y + h); c.closePath(); c.fillStyle = hexA(acc, 0.12); c.fill();
}

const DRAW: Record<DisplayKind, (c: Ctx, acc: string, t: number) => void> = {
  code(c, acc) {
    frame(c, DISPLAY_TITLE.code, acc);
    c.fillStyle = '#0d1426'; c.fillRect(0, 32, 128, H - 32);
    const tree = ['▾ Workspace', '   ▸ Lobby', '   ▸ Obby_Stage1', '▾ ReplicatedStorage', '   ◆ Modules', '▾ ServerScriptService', '   ◆ GameLoop', '   ◆ DataStore', '▸ StarterGui'];
    tree.forEach((s, i) => text(c, s, 8, 54 + i * 21, 12, i === 6 ? acc : '#9fb3d1', 500, MONO));
    const code: [string, string][][] = [
      [['local ', '#ff7ab6'], ['Players', '#7cf7ff'], [' = game:GetService(', '#e6edf3'], ['"Players"', '#a5e075'], [')', '#e6edf3']],
      [['local ', '#ff7ab6'], ['SPEED', '#ffd166'], [' = ', '#e6edf3'], ['24', '#ffb86c']],
      [],
      [['function ', '#ff7ab6'], ['onCharacterAdded', '#82aaff'], ['(char)', '#e6edf3']],
      [['  local ', '#ff7ab6'], ['hum', '#e6edf3'], [' = char:WaitForChild(', '#e6edf3'], ['"Humanoid"', '#a5e075'], [')', '#e6edf3']],
      [['  hum.WalkSpeed = ', '#e6edf3'], ['SPEED', '#ffd166']],
      [['  hum.Died:Connect(', '#e6edf3'], ['respawn', '#82aaff'], [')', '#e6edf3']],
      [['end', '#ff7ab6']],
      [],
      [['Players.PlayerAdded:Connect(', '#e6edf3'], ['function', '#ff7ab6'], ['(p)', '#e6edf3']],
      [['  p.CharacterAdded:Connect(', '#e6edf3'], ['onCharacterAdded', '#82aaff'], [')', '#e6edf3']],
    ];
    code.forEach((ln, i) => {
      text(c, String(i + 1).padStart(2, ' '), 136, 54 + i * 19, 12, '#4a5a78', 500, MONO);
      let x = 162;
      for (const [s, col] of ln) { c.font = `500 13px ${MONO}`; c.fillStyle = col; c.fillText(s, x, 54 + i * 19); x += c.measureText(s).width; }
    });
    c.fillStyle = hexA(acc, 0.12); c.fillRect(128, 50 + 5 * 19 - 13, W - 128, 18);
    c.fillStyle = '#0a0f1c'; c.fillRect(128, H - 40, W - 128, 40);
    text(c, '▶ Output  ✓ Build succeeded · 0 errors · 2 warnings', 138, H - 15, 12, '#39ff88', 600, MONO);
  },
  'build-preview'(c, acc, t) {
    frame(c, DISPLAY_TITLE['build-preview'], acc);
    const sky = c.createLinearGradient(0, 32, 0, H); sky.addColorStop(0, '#5ec8ff'); sky.addColorStop(1, '#bde8ff');
    c.fillStyle = sky; c.fillRect(0, 32, W, H - 32);
    c.fillStyle = '#4caf50'; c.fillRect(0, H - 60, W, 60);
    // obby platforms
    const cols = ['#ff5d73', '#ffd166', '#39ff88', '#4cc9ff', '#b57bff'];
    for (let i = 0; i < 6; i++) { const x = 30 + i * 80, y = H - 80 - (i % 3) * 34; c.fillStyle = cols[i % 5]; c.fillRect(x, y, 56, 16); c.fillStyle = 'rgba(0,0,0,.18)'; c.fillRect(x, y + 12, 56, 4); }
    // blocky runner
    const px = 40 + ((t * 70) % 420), py = H - 110 - Math.abs(Math.sin(t * 3)) * 40;
    c.fillStyle = '#ffcc99'; c.fillRect(px, py, 14, 14); c.fillStyle = '#2b3a8c'; c.fillRect(px - 2, py + 14, 18, 18); c.fillStyle = '#20232b'; c.fillRect(px, py + 32, 6, 12); c.fillRect(px + 8, py + 32, 6, 12);
    c.fillStyle = 'rgba(5,10,20,.75)'; rr(c, 10, 40, 200, 26, 6); c.fill();
    text(c, `BUILD #${142 + Math.floor(t / 20)} · PASSING`, 20, 58, 13, '#39ff88', 700);
    c.fillStyle = 'rgba(5,10,20,.75)'; rr(c, W - 130, 40, 120, 26, 6); c.fill();
    text(c, `${58 + Math.round(Math.sin(t) * 2)} FPS · 12 players`, W - 122, 58, 11, '#eaf6ff', 600);
  },
  findings(c, acc) {
    frame(c, DISPLAY_TITLE.findings, acc);
    c.fillStyle = '#2a2018'; c.fillRect(0, 32, W, H - 32);
    const notes = [[40, 60, '#ffd166', 'Players quit\nat stage 3'], [200, 50, '#7cf7ff', 'Survey: 62%\nwant co-op'], [360, 70, '#ff9ad5', 'Competitor A\nadded pets'], [110, 175, '#a5e075', 'Session length\n+18% w/ quests'], [290, 180, '#ffb86c', 'Idea: daily\nchallenge']] as const;
    c.strokeStyle = '#ff5d73'; c.lineWidth = 2.5;
    for (const [a, b] of [[0, 1], [1, 3], [0, 3], [2, 4], [3, 4], [1, 2]]) { c.beginPath(); c.moveTo(notes[a][0] + 55, notes[a][1] + 30); c.lineTo(notes[b][0] + 55, notes[b][1] + 30); c.stroke(); }
    for (const [x, y, col, s] of notes) {
      c.fillStyle = 'rgba(0,0,0,.35)'; c.fillRect(x + 4, y + 4, 110, 70);
      c.fillStyle = col; c.fillRect(x, y, 110, 70);
      c.fillStyle = '#d33'; c.beginPath(); c.arc(x + 55, y + 6, 5, 0, Math.PI * 2); c.fill();
      s.split('\n').forEach((l, i) => text(c, l, x + 8, y + 32 + i * 18, 14, '#1b1b1b', 700));
    }
  },
  references(c, acc) {
    frame(c, DISPLAY_TITLE.references, acc);
    c.fillStyle = '#121a2e'; rr(c, 14, 44, W - 28, 32, 16); c.fill(); c.strokeStyle = acc; c.lineWidth = 1.5; c.stroke();
    text(c, '⌕  retention mechanics roblox', 30, 66, 15, '#cfe3ff', 500);
    const rows = ['Onboarding funnels in UGC games', 'Daily quests and streak design', 'Social features and co-op retention', 'Monetisation without pay-to-win', 'Accessibility in game UI'];
    rows.forEach((s, i) => {
      const y = 96 + i * 36;
      c.fillStyle = i === 0 ? hexA(acc, 0.16) : 'rgba(255,255,255,.03)'; rr(c, 14, y, W - 28, 30, 6); c.fill();
      text(c, s, 28, y + 20, 14, '#eaf6ff', 600);
      text(c, ['verified', 'cited ×4', 'note', 'verified', 'new'][i], W - 30, y + 20, 12, i % 3 === 0 ? '#39ff88' : acc, 600, FONT, 'right');
    });
  },
  'level-layout'(c, acc) {
    frame(c, DISPLAY_TITLE['level-layout'], acc);
    c.strokeStyle = 'rgba(124,247,255,.12)'; c.lineWidth = 1;
    for (let x = 0; x < W; x += 24) { c.beginPath(); c.moveTo(x, 32); c.lineTo(x, H); c.stroke(); }
    for (let y = 32; y < H; y += 24) { c.beginPath(); c.moveTo(0, y); c.lineTo(W, y); c.stroke(); }
    const zones = [[30, 60, 110, 80, '#39ff88', 'SPAWN'], [190, 50, 130, 70, '#ffd166', 'PUZZLE'], [370, 70, 110, 90, '#ff5d73', 'BOSS'], [90, 180, 150, 80, '#4cc9ff', 'SHOP'], [300, 190, 120, 70, '#b57bff', 'SECRET']] as const;
    c.strokeStyle = '#eaf6ff'; c.setLineDash([8, 6]); c.lineWidth = 2.5;
    c.beginPath(); c.moveTo(85, 100); c.lineTo(255, 85); c.lineTo(425, 115); c.moveTo(85, 100); c.lineTo(165, 220); c.lineTo(360, 225); c.lineTo(425, 115); c.stroke(); c.setLineDash([]);
    for (const [x, y, w, h, col, s] of zones) { c.fillStyle = hexA(col, 0.22); rr(c, x, y, w, h, 8); c.fill(); c.strokeStyle = col; c.lineWidth = 2; c.stroke(); text(c, s, x + w / 2, y + h / 2 + 5, 14, col, 800, FONT, 'center'); }
  },
  'game-loop'(c, acc) {
    frame(c, DISPLAY_TITLE['game-loop'], acc);
    const steps = ['EXPLORE', 'COLLECT', 'UPGRADE', 'COMPETE'];
    const cx = W / 2, cy = 160, R = 92;
    c.strokeStyle = hexA(acc, 0.7); c.lineWidth = 4; c.beginPath(); c.arc(cx, cy, R, 0, Math.PI * 2); c.stroke();
    steps.forEach((s, i) => {
      const a = -Math.PI / 2 + (i / 4) * Math.PI * 2, x = cx + Math.cos(a) * R, y = cy + Math.sin(a) * R;
      const a2 = a + 0.6; const ax = cx + Math.cos(a2) * R, ay = cy + Math.sin(a2) * R;
      c.fillStyle = acc; c.beginPath(); c.moveTo(ax, ay); c.lineTo(ax - Math.cos(a2 - 1.2) * 12, ay - Math.sin(a2 - 1.2) * 12); c.lineTo(ax - Math.cos(a2 + 0.6) * 12, ay - Math.sin(a2 + 0.6) * 12); c.fill();
      c.fillStyle = '#121a2e'; rr(c, x - 52, y - 18, 104, 36, 18); c.fill(); c.strokeStyle = acc; c.lineWidth = 2; c.stroke();
      text(c, s, x, y + 6, 14, '#eaf6ff', 800, FONT, 'center');
    });
    text(c, 'CORE LOOP', cx, cy + 6, 18, acc, 800, FONT, 'center');
  },
  mechanics(c, acc) {
    frame(c, DISPLAY_TITLE.mechanics, acc);
    const cards = [['Double jump', 'Movement', '#4cc9ff'], ['Grapple hook', 'Traversal', '#39ff88'], ['Combo meter', 'Combat', '#ff5d73'], ['Pet buddy', 'Social', '#ffd166'], ['Day / night', 'World', '#b57bff'], ['Trading', 'Economy', '#ff9ad5']];
    cards.forEach(([n, k, col], i) => {
      const x = 16 + (i % 3) * 164, y = 46 + Math.floor(i / 3) * 118;
      c.fillStyle = '#121a2e'; rr(c, x, y, 152, 106, 10); c.fill(); c.strokeStyle = col; c.lineWidth = 2; c.stroke();
      c.fillStyle = hexA(col, 0.25); rr(c, x + 10, y + 10, 40, 40, 8); c.fill();
      text(c, n, x + 10, y + 72, 15, '#eaf6ff', 700); text(c, k, x + 10, y + 92, 12, col, 600);
    });
  },
  blueprint(c, acc) {
    c.fillStyle = '#0b2a5a'; c.fillRect(0, 0, W, H);
    c.strokeStyle = 'rgba(255,255,255,.08)'; c.lineWidth = 1;
    for (let x = 0; x < W; x += 16) { c.beginPath(); c.moveTo(x, 0); c.lineTo(x, H); c.stroke(); }
    for (let y = 0; y < H; y += 16) { c.beginPath(); c.moveTo(0, y); c.lineTo(W, y); c.stroke(); }
    text(c, DISPLAY_TITLE.blueprint, 12, 22, 14, '#dff1ff', 700);
    c.strokeStyle = '#dff1ff'; c.lineWidth = 2;
    const views: [number, string][] = [[40, 'FRONT'], [200, 'SIDE'], [360, 'TOP']];
    for (const [x, s] of views) {
      c.strokeRect(x, 80, 110, 130);
      if (s !== 'TOP') { c.strokeRect(x + 30, 50, 50, 30); c.beginPath(); c.moveTo(x + 55, 80); c.lineTo(x + 55, 210); c.stroke(); }
      else { c.beginPath(); c.arc(x + 55, 145, 40, 0, Math.PI * 2); c.stroke(); }
      c.strokeStyle = acc; c.beginPath(); c.moveTo(x, 225); c.lineTo(x + 110, 225); c.stroke(); c.strokeStyle = '#dff1ff';
      text(c, '4.0 studs', x + 55, 244, 12, acc, 600, FONT, 'center'); text(c, s, x + 55, 270, 12, '#dff1ff', 700, FONT, 'center');
    }
  },
  wireframe(c, acc, t) {
    frame(c, DISPLAY_TITLE.wireframe, acc);
    const cx = W / 2, cy = 165, s = 70, a = t * 0.6 + 0.6;
    const v = [[-1, -1, -1], [1, -1, -1], [1, 1, -1], [-1, 1, -1], [-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1], [0, -1.9, 0]];
    const p = v.map(([x, y, z]) => { const X = x * Math.cos(a) - z * Math.sin(a), Z = x * Math.sin(a) + z * Math.cos(a); const Y = y * 0.9 + Z * 0.3; return [cx + X * s, cy + Y * s * 0.8]; });
    c.strokeStyle = acc; c.lineWidth = 2;
    for (const [i, j] of [[0, 1], [1, 2], [2, 3], [3, 0], [4, 5], [5, 6], [6, 7], [7, 4], [0, 4], [1, 5], [2, 6], [3, 7], [8, 0], [8, 1], [8, 4], [8, 5]]) { c.beginPath(); c.moveTo(p[i][0], p[i][1]); c.lineTo(p[j][0], p[j][1]); c.stroke(); }
    c.fillStyle = '#eaf6ff'; for (const [x, y] of p) { c.fillRect(x - 2.5, y - 2.5, 5, 5); }
    text(c, 'Verts 1,284 · Tris 2,410 · LOD0', 14, H - 14, 12, '#9fb3d1', 600);
  },
  materials(c, acc) {
    frame(c, DISPLAY_TITLE.materials, acc);
    const mats: [string, string, string][] = [['Neon', '#7cf7ff', '#e9fdff'], ['Brushed metal', '#8a94a2', '#dfe6ee'], ['Wood plank', '#8a5a34', '#c08a5a'], ['Grass', '#3a8a3a', '#7ad07a'], ['Glass', '#4a7aa8', '#cfe9ff'], ['Lava', '#c0281a', '#ffb347'], ['Marble', '#cfcfd6', '#ffffff'], ['Fabric', '#7a3a8a', '#c58ad6']];
    mats.forEach(([n, a1, a2], i) => {
      const x = 22 + (i % 4) * 122, y = 48 + Math.floor(i / 4) * 118;
      const g = c.createRadialGradient(x + 40, y + 30, 6, x + 50, y + 45, 50); g.addColorStop(0, a2); g.addColorStop(1, a1);
      c.fillStyle = g; c.beginPath(); c.arc(x + 50, y + 45, 40, 0, Math.PI * 2); c.fill();
      text(c, n, x + 50, y + 104, 12, '#eaf6ff', 600, FONT, 'center');
    });
  },
  'font-compare'(c, acc) {
    frame(c, DISPLAY_TITLE['font-compare'], acc);
    const fonts: [string, string][] = [['Display Bold', `900 44px ${FONT}`], ['Rounded', `700 40px "Trebuchet MS", ${FONT}`], ['Serif', `700 40px Georgia, serif`], ['Mono', `700 34px ${MONO}`]];
    fonts.forEach(([n, f], i) => {
      const y = 76 + i * 56;
      c.font = f; c.fillStyle = i === 0 ? acc : '#eaf6ff'; c.fillText('Aa Bb Gg 123', 16, y);
      text(c, n, W - 16, y - 8, 12, '#9fb3d1', 600, FONT, 'right');
      c.fillStyle = 'rgba(255,255,255,.06)'; c.fillRect(16, y + 10, W - 32, 1);
    });
  },
  'type-scale'(c, acc) {
    frame(c, DISPLAY_TITLE['type-scale'], acc);
    [900, 700, 500, 300].forEach((w, i) => text(c, `${w}`, 20, 72 + i * 36, 26, i ? '#eaf6ff' : acc, w));
    [56, 40, 28, 18, 12].forEach((s, i) => { text(c, 'Ag', 140 + i * 74, 200, s, '#eaf6ff', 700); text(c, `${s}px`, 140 + i * 74, 230, 11, '#9fb3d1', 600); });
    c.fillStyle = acc; rr(c, 140, 248, 300, 8, 4); c.fill(); c.fillStyle = '#eaf6ff'; c.beginPath(); c.arc(290, 252, 9, 0, Math.PI * 2); c.fill();
  },
  'game-ui'(c, acc) {
    frame(c, DISPLAY_TITLE['game-ui'], acc);
    const g = c.createLinearGradient(0, 32, 0, H); g.addColorStop(0, '#2a1458'); g.addColorStop(1, '#ff6fb5'); c.fillStyle = g; c.fillRect(0, 32, W, H - 32);
    c.font = `900 50px ${FONT}`; c.textAlign = 'center'; c.lineWidth = 8; c.strokeStyle = '#1b0b33'; c.strokeText('LEVEL UP!', W / 2, 120); c.fillStyle = '#ffd166'; c.fillText('LEVEL UP!', W / 2, 120); c.textAlign = 'left';
    c.fillStyle = '#39ff88'; rr(c, W / 2 - 90, 150, 180, 48, 24); c.fill(); text(c, 'PLAY', W / 2, 183, 24, '#0b2a16', 900, FONT, 'center');
    c.fillStyle = 'rgba(0,0,0,.35)'; rr(c, 14, 44, 120, 30, 15); c.fill(); text(c, '◆ 12,480', 30, 65, 16, '#7cf7ff', 800);
    text(c, 'Quest: reach the summit', W / 2, 240, 16, '#ffffff', 700, FONT, 'center');
  },
  'build-plan'(c, acc) {
    frame(c, DISPLAY_TITLE['build-plan'], acc);
    const steps: [string, boolean][] = [['Terrain sculpt + water', true], ['Spawn plaza (modular)', true], ['Tower shell 40×40 studs', true], ['Interior floors', false], ['Lighting + atmosphere', false], ['Playtest & polish', false]];
    steps.forEach(([s, done], i) => {
      const y = 56 + i * 36;
      c.strokeStyle = done ? '#39ff88' : '#4a5a78'; c.lineWidth = 2; c.strokeRect(18, y - 14, 18, 18);
      if (done) { c.strokeStyle = '#39ff88'; c.beginPath(); c.moveTo(21, y - 5); c.lineTo(26, y); c.lineTo(34, y - 11); c.stroke(); }
      text(c, s, 48, y, 15, done ? '#9fb3d1' : '#eaf6ff', 600);
    });
    c.fillStyle = '#121a2e'; rr(c, 300, 48, 196, 220, 10); c.fill();
    for (let i = 0; i < 6; i++) { c.fillStyle = i < 3 ? acc : hexA(acc, 0.25); c.fillRect(340, 240 - i * 30, 116, 26); }
    text(c, '50%', 398, 70, 18, acc, 800, FONT, 'center');
  },
  parts(c, acc) {
    frame(c, DISPLAY_TITLE.parts, acc);
    const parts: [string, string][] = [['Wall 4×8', '#8a94a2'], ['Floor 8×8', '#c08a5a'], ['Ramp', '#4cc9ff'], ['Window', '#9fd6ff'], ['Door', '#7a5a34'], ['Truss', '#ffd166']];
    parts.forEach(([n, col], i) => {
      const x = 18 + (i % 3) * 120, y = 46 + Math.floor(i / 3) * 112;
      c.fillStyle = '#121a2e'; rr(c, x, y, 108, 100, 8); c.fill();
      c.fillStyle = col; c.beginPath(); c.moveTo(x + 30, y + 30); c.lineTo(x + 66, y + 20); c.lineTo(x + 86, y + 34); c.lineTo(x + 50, y + 46); c.closePath(); c.fill();
      c.fillStyle = 'rgba(0,0,0,.25)'; c.beginPath(); c.moveTo(x + 30, y + 30); c.lineTo(x + 50, y + 46); c.lineTo(x + 50, y + 66); c.lineTo(x + 30, y + 50); c.closePath(); c.fill();
      text(c, n, x + 54, y + 88, 12, '#eaf6ff', 600, FONT, 'center');
    });
    // scale reference figure
    c.fillStyle = '#ffcc99'; c.fillRect(420, 120, 22, 22); c.fillStyle = '#2b3a8c'; c.fillRect(414, 142, 34, 40); c.fillStyle = '#20232b'; c.fillRect(416, 182, 12, 40); c.fillRect(434, 182, 12, 40);
    c.strokeStyle = acc; c.beginPath(); c.moveTo(466, 120); c.lineTo(466, 222); c.stroke(); text(c, '5 studs', 474, 176, 12, acc, 700);
  },
  terrain(c, acc) {
    frame(c, DISPLAY_TITLE.terrain, acc);
    const r = rnd(7);
    for (let layer = 0; layer < 3; layer++) {
      c.fillStyle = ['#2f6b3a', '#3f8a46', '#61b35a'][layer];
      c.beginPath(); c.moveTo(0, H);
      for (let x = 0; x <= W; x += 16) c.lineTo(x, 150 + layer * 30 + Math.sin(x / 50 + layer) * 30 + r() * 10);
      c.lineTo(W, H); c.fill();
    }
    c.fillStyle = '#3a8acf'; c.fillRect(0, H - 34, W, 34);
    text(c, 'Height map · 512×512 studs', 14, 56, 13, '#eaf6ff', 700);
  },
  campaign(c, acc) {
    frame(c, DISPLAY_TITLE.campaign, acc);
    const cols = ['CONCEPT', 'REVIEW', 'APPROVED'];
    cols.forEach((s, i) => {
      const x = 12 + i * 166;
      text(c, s, x + 4, 52, 12, i === 2 ? '#39ff88' : acc, 800);
      for (let j = 0; j < (3 - i === 0 ? 1 : 3 - i); j++) {
        const y = 62 + j * 72;
        const g = c.createLinearGradient(x, y, x + 150, y + 62); g.addColorStop(0, ['#ff6fb5', '#7c5cff', '#ffd166'][(i + j) % 3]); g.addColorStop(1, ['#7cf7ff', '#ff9f43', '#39ff88'][(i + j) % 3]);
        c.fillStyle = g; rr(c, x, y, 154, 62, 8); c.fill();
        text(c, ['Summer Obby Fest', 'New Pet Drop', 'Double XP!'][(i + j) % 3], x + 10, y + 36, 14, '#ffffff', 900);
      }
    });
  },
  drafts(c, acc) {
    frame(c, DISPLAY_TITLE.drafts, acc);
    for (let i = 0; i < 6; i++) {
      const x = 14 + (i % 3) * 164, y = 44 + Math.floor(i / 3) * 120;
      const g = c.createLinearGradient(x, y, x + 150, y + 100); g.addColorStop(0, ['#2a1458', '#0b3a5a', '#3a1a0b'][i % 3]); g.addColorStop(1, ['#ff6fb5', '#7cf7ff', '#ffd166'][i % 3]);
      c.fillStyle = g; rr(c, x, y, 152, 104, 8); c.fill();
      c.fillStyle = 'rgba(255,255,255,.85)'; c.beginPath(); c.arc(x + 110, y + 40, 18, 0, Math.PI * 2); c.fill();
      c.fillStyle = 'rgba(0,0,0,.35)'; c.beginPath(); c.moveTo(x, y + 104); c.lineTo(x + 60, y + 50); c.lineTo(x + 152, y + 104); c.fill();
      const tag = i === 5 ? 'FINAL' : `DRAFT v${i + 1}`;
      c.fillStyle = i === 5 ? '#39ff88' : 'rgba(0,0,0,.6)'; rr(c, x + 6, y + 6, 70, 20, 10); c.fill();
      text(c, tag, x + 41, y + 20, 11, i === 5 ? '#0b2a16' : '#eaf6ff', 800, FONT, 'center');
    }
  },
  command(c, _acc, t) {
    c.fillStyle = '#12060c'; c.fillRect(0, 0, W, H);
    const g = c.createRadialGradient(W / 2, H / 2, 10, W / 2, H / 2, 260); g.addColorStop(0, 'rgba(255,40,80,.25)'); g.addColorStop(1, 'rgba(0,0,0,0)'); c.fillStyle = g; c.fillRect(0, 0, W, H);
    text(c, '♛ ' + DISPLAY_TITLE.command, 14, 26, 15, '#ffd166', 800);
    const kpis: [string, string][] = [['Active', `${12 + Math.round(Math.sin(t * 0.5) * 2)}`], ['Done / hr', '48'], ['Blocked', '2'], ['Queued', '17']];
    kpis.forEach(([k, v], i) => { const x = 14 + i * 124; c.fillStyle = 'rgba(255,209,102,.08)'; rr(c, x, 42, 112, 64, 8); c.fill(); c.strokeStyle = 'rgba(255,209,102,.5)'; c.stroke(); text(c, v, x + 12, 82, 28, i === 2 ? '#ff5d73' : '#ffd166', 800); text(c, k, x + 12, 98, 11, '#e9c9a0', 600); });
    // radar
    const cx = 110, cy = 196, R = 72;
    c.strokeStyle = 'rgba(255,93,115,.5)'; for (let i = 1; i <= 3; i++) { c.beginPath(); c.arc(cx, cy, (R * i) / 3, 0, Math.PI * 2); c.stroke(); }
    c.save(); c.translate(cx, cy); c.rotate(t * 1.2); const sg = c.createLinearGradient(0, 0, R, 0); sg.addColorStop(0, 'rgba(255,93,115,.6)'); sg.addColorStop(1, 'rgba(255,93,115,0)'); c.fillStyle = sg; c.beginPath(); c.moveTo(0, 0); c.arc(0, 0, R, -0.4, 0); c.fill(); c.restore();
    line(c, 220, 130, 276, 130, '#ffd166', 3, t * 0.5);
  },
  'team-status'(c, acc) {
    frame(c, DISPLAY_TITLE['team-status'], acc);
    const teams: [string, number, string][] = [['Roblox Dev', 0.82, '#4cc9ff'], ['Research', 0.64, '#b57bff'], ['Game Design', 0.71, '#39ff88'], ['3D Design', 0.55, '#ff9f43'], ['Typography', 0.4, '#ffd166'], ['Building', 0.77, '#39d0c8'], ['Advertising', 0.6, '#ff6fb5']];
    teams.forEach(([n, v, col], i) => {
      const y = 52 + i * 33;
      text(c, n, 14, y + 14, 13, '#eaf6ff', 600);
      c.fillStyle = 'rgba(255,255,255,.06)'; rr(c, 140, y + 2, 300, 16, 8); c.fill();
      c.fillStyle = col; rr(c, 140, y + 2, 300 * v, 16, 8); c.fill();
      text(c, `${Math.round(v * 100)}%`, 496, y + 15, 12, col, 700, FONT, 'right');
    });
  },
  tasks(c, acc) {
    frame(c, DISPLAY_TITLE.tasks, acc);
    ['Review pull request', 'Update data model', 'Summarise findings', 'Prepare handoff', 'Run checks', 'File report'].forEach((s, i) => {
      const y = 50 + i * 38;
      c.fillStyle = 'rgba(255,255,255,.04)'; rr(c, 12, y, W - 24, 32, 6); c.fill();
      c.fillStyle = ['#39ff88', acc, '#ffd166', acc, '#ff5d73', '#9fb3d1'][i]; c.beginPath(); c.arc(30, y + 16, 6, 0, Math.PI * 2); c.fill();
      text(c, s, 46, y + 21, 14, '#eaf6ff', 600);
      c.fillStyle = hexA(acc, 0.35); rr(c, W - 130, y + 11, 100, 10, 5); c.fill(); c.fillStyle = acc; rr(c, W - 130, y + 11, 100 * ((i * 37) % 100) / 100 + 8, 10, 5); c.fill();
    });
  },
  kanban(c, acc) {
    frame(c, DISPLAY_TITLE.kanban, acc);
    ['TO DO', 'DOING', 'REVIEW', 'DONE'].forEach((s, i) => {
      const x = 10 + i * 125;
      c.fillStyle = 'rgba(255,255,255,.04)'; rr(c, x, 40, 117, H - 50, 8); c.fill();
      text(c, s, x + 10, 60, 12, i === 3 ? '#39ff88' : acc, 800);
      for (let j = 0; j < 4 - (i % 3); j++) { c.fillStyle = ['#1c2a48', '#2a1c48', '#1c3a30', '#3a2a1c'][(i + j) % 4]; rr(c, x + 8, 72 + j * 50, 101, 42, 6); c.fill(); c.fillStyle = 'rgba(255,255,255,.6)'; c.fillRect(x + 16, 86 + j * 50, 70, 5); c.fillStyle = 'rgba(255,255,255,.3)'; c.fillRect(x + 16, 98 + j * 50, 50, 5); }
    });
  },
  chart(c, acc) { frame(c, DISPLAY_TITLE.chart, acc); bars(c, 20, 60, 230, 200, 8, acc, 3); line(c, 270, 60, 222, 200, '#39ff88', 9); },
  budget(c, acc) {
    frame(c, DISPLAY_TITLE.budget, acc);
    const cx = 120, cy = 160;
    [[0.42, acc], [0.28, '#39ff88'], [0.18, '#ffd166'], [0.12, '#ff6fb5']].reduce((a0, [v, col]) => { c.fillStyle = col as string; c.beginPath(); c.moveTo(cx, cy); c.arc(cx, cy, 90, a0, a0 + (v as number) * Math.PI * 2); c.fill(); return a0 + (v as number) * Math.PI * 2; }, -Math.PI / 2);
    c.fillStyle = '#0b1020'; c.beginPath(); c.arc(cx, cy, 50, 0, Math.PI * 2); c.fill();
    text(c, '72%', cx, cy + 8, 22, '#eaf6ff', 800, FONT, 'center');
    bars(c, 250, 70, 240, 180, 6, acc, 5);
  },
  health(c, acc, t) {
    frame(c, DISPLAY_TITLE.health, acc);
    ['CPU', 'MEM', 'NET', 'GPU'].forEach((s, i) => {
      const y = 50 + i * 56;
      text(c, s, 14, y + 26, 14, '#9fb3d1', 700);
      line(c, 64, y, 330, 46, i === 3 ? '#ff9f43' : acc, i + 2, t * (1 + i * 0.3));
      text(c, `${40 + ((i * 17 + Math.round(t * 3)) % 50)}%`, W - 20, y + 30, 18, '#eaf6ff', 800, FONT, 'right');
    });
  },
  'render-queue'(c, acc, t) {
    frame(c, DISPLAY_TITLE['render-queue'], acc);
    ['hero_character.fbx', 'castle_env.blend', 'pet_dragon_anim', 'ui_icons_pack', 'trailer_shot_04'].forEach((s, i) => {
      const y = 50 + i * 44;
      const p = i === 0 ? (t * 0.08) % 1 : [1, 1, 0.4, 0][i - 1] ?? 0;
      text(c, s, 14, y + 18, 13, '#eaf6ff', 600, MONO);
      c.fillStyle = 'rgba(255,255,255,.06)'; rr(c, 240, y + 6, 200, 14, 7); c.fill();
      c.fillStyle = p >= 1 ? '#39ff88' : acc; rr(c, 240, y + 6, Math.max(8, 200 * p), 14, 7); c.fill();
      text(c, p >= 1 ? 'DONE' : p > 0 ? `${Math.round(p * 100)}%` : 'QUEUED', W - 14, y + 18, 12, p >= 1 ? '#39ff88' : '#9fb3d1', 700, FONT, 'right');
    });
  },
  welcome(c, acc) {
    frame(c, '', acc);
    text(c, 'Take a break', W / 2, 130, 40, '#eaf6ff', 800, FONT, 'center');
    text(c, 'Energy restores faster here', W / 2, 170, 18, acc, 600, FONT, 'center');
  },
  briefing(c) {
    c.fillStyle = '#100a1c'; c.fillRect(0, 0, W, H);
    text(c, '♛ HOURLY BRIEFING', 16, 30, 18, '#e0b84a', 800);
    text(c, 'Press E to open', W - 16, 30, 13, '#cdb6ff', 600, FONT, 'right');
    const cols: [string, string, number][] = [['DONE', '#39ff88', 14], ['ACTIVE', '#4cc9ff', 9], ['BLOCKED', '#ff5d73', 2], ['QUEUED', '#ffd166', 17]];
    cols.forEach(([s, col, n], i) => {
      const x = 16 + i * 124;
      c.fillStyle = 'rgba(255,255,255,.05)'; rr(c, x, 48, 112, 220, 10); c.fill(); c.strokeStyle = col; c.lineWidth = 2; c.stroke();
      text(c, String(n), x + 56, 110, 46, col, 900, FONT, 'center');
      text(c, s, x + 56, 140, 13, '#eaf6ff', 800, FONT, 'center');
      for (let j = 0; j < 4; j++) { c.fillStyle = 'rgba(255,255,255,.12)'; rr(c, x + 12, 160 + j * 24, 88 - j * 10, 12, 6); c.fill(); }
    });
  },
  'arcade-flappy'(c) {
    const g = c.createLinearGradient(0, 0, 0, H); g.addColorStop(0, '#47b8ff'); g.addColorStop(1, '#a8e6ff'); c.fillStyle = g; c.fillRect(0, 0, W, H);
    c.fillStyle = '#2fbf4a'; for (const x of [80, 260, 440]) { c.fillRect(x, 0, 50, 90); c.fillRect(x, 180, 50, 120); }
    c.fillStyle = '#ffd166'; c.beginPath(); c.arc(180, 140, 18, 0, Math.PI * 2); c.fill();
    text(c, 'PRESS E', W / 2, 270, 22, '#ffffff', 900, FONT, 'center');
  },
  'arcade-pacman'(c) {
    c.fillStyle = '#000010'; c.fillRect(0, 0, W, H);
    c.strokeStyle = '#2b4bff'; c.lineWidth = 6; c.strokeRect(20, 20, W - 40, H - 40); c.strokeRect(120, 90, 100, 60); c.strokeRect(300, 90, 100, 60);
    c.fillStyle = '#ffd166'; for (let x = 50; x < W - 40; x += 28) { c.beginPath(); c.arc(x, 55, 4, 0, Math.PI * 2); c.fill(); }
    c.fillStyle = '#ffe600'; c.beginPath(); c.moveTo(80, 210); c.arc(80, 210, 22, 0.6, Math.PI * 2 - 0.6); c.fill();
    c.fillStyle = '#ff4d6d'; c.beginPath(); c.arc(300, 210, 20, Math.PI, 0); c.lineTo(320, 232); c.lineTo(280, 232); c.fill();
    text(c, 'PRESS E', W / 2, 270, 22, '#ffffff', 900, FONT, 'center');
  },
  'arcade-pong'(c) {
    c.fillStyle = '#05050a'; c.fillRect(0, 0, W, H);
    c.fillStyle = '#ffffff'; c.fillRect(30, 100, 12, 70); c.fillRect(W - 42, 140, 12, 70); c.fillRect(250, 130, 12, 12);
    for (let y = 10; y < H; y += 24) c.fillRect(W / 2 - 2, y, 4, 12);
    text(c, '3   5', W / 2, 60, 40, '#ffffff', 900, MONO, 'center');
    text(c, 'PRESS E', W / 2, 270, 22, '#7cf7ff', 900, FONT, 'center');
  },
  city(c) {
    const g = c.createLinearGradient(0, 0, 0, H); g.addColorStop(0, '#0a0f2a'); g.addColorStop(1, '#3a1a5a'); c.fillStyle = g; c.fillRect(0, 0, W, H);
    const r = rnd(11);
    for (let x = 0; x < W; x += 38) { const h = 80 + r() * 160; c.fillStyle = '#0b0b1a'; c.fillRect(x, H - h, 34, h); c.fillStyle = 'rgba(255,209,102,.7)'; for (let y = H - h + 8; y < H; y += 14) for (let wx = x + 4; wx < x + 30; wx += 9) if (r() > 0.55) c.fillRect(wx, y, 4, 6); }
  },
};

export function drawDisplay(c: Ctx, kind: DisplayKind, accent: string, t = 0) {
  c.save(); c.clearRect(0, 0, W, H); (DRAW[kind] ?? DRAW.tasks)(c, accent, t); c.restore();
}

// ---------- texture cache ----------

const texCache = new Map<string, THREE.CanvasTexture>();
export interface LiveTexture { tex: THREE.CanvasTexture; kind: DisplayKind; accent: string; canvas: HTMLCanvasElement; lastT: number }
const live = new Map<string, LiveTexture>();

function newCanvas(w: number, h: number) { const cv = document.createElement('canvas'); cv.width = w; cv.height = h; return cv; }

/** Shared texture for a display kind and accent. Animated kinds are registered for redraws. */
export function displayTexture(kind: DisplayKind, accent: string): THREE.CanvasTexture {
  const k = `${kind}|${accent}`;
  let t = texCache.get(k);
  if (!t) {
    const cv = newCanvas(W, H);
    drawDisplay(cv.getContext('2d')!, kind, accent, 0);
    t = new THREE.CanvasTexture(cv);
    t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
    texCache.set(k, t);
    if (ANIMATED_KINDS.has(kind)) live.set(k, { tex: t, kind, accent, canvas: cv, lastT: 0 });
  }
  return t;
}

/** Redraw animated displays (throttled by the caller). */
export function updateLiveTextures(t: number, only?: (l: LiveTexture) => boolean) {
  for (const l of live.values()) {
    if (only && !only(l)) continue;
    drawDisplay(l.canvas.getContext('2d')!, l.kind, l.accent, t);
    l.tex.needsUpdate = true; l.lastT = t;
  }
}

export function disposeTextures() {
  for (const t of texCache.values()) t.dispose();
  texCache.clear(); live.clear();
}

// ---------- signs and labels ----------

/** Large room sign: name plus team, on a dark glass plate edged in the room accent. */
export function signTexture(name: string, team: string, accent: string, royal = false): THREE.CanvasTexture {
  const cw = 1024, ch = 256;
  const cv = newCanvas(cw, ch); const c = cv.getContext('2d')!;
  rr(c, 8, 8, cw - 16, ch - 16, 48);
  const g = c.createLinearGradient(0, 0, 0, ch); g.addColorStop(0, royal ? 'rgba(40,6,18,.92)' : 'rgba(8,14,30,.9)'); g.addColorStop(1, royal ? 'rgba(20,2,10,.92)' : 'rgba(4,8,20,.9)');
  c.fillStyle = g; c.fill();
  c.lineWidth = 8; c.strokeStyle = accent; c.stroke();
  c.textAlign = 'center';
  let size = 92; c.font = `800 ${size}px ${FONT}`;
  while (c.measureText(name).width > cw - 100 && size > 40) { size -= 4; c.font = `800 ${size}px ${FONT}`; }
  c.fillStyle = '#ffffff'; c.shadowColor = accent; c.shadowBlur = 18; c.fillText(name, cw / 2, 122);
  c.shadowBlur = 0; c.font = `600 44px ${FONT}`; c.fillStyle = accent; c.fillText(team.toUpperCase(), cw / 2, 196);
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return t;
}

/** Entrance sign above a tube mouth: arrow and destination. */
export function doorSignTexture(label: string, accent: string): THREE.CanvasTexture {
  const cw = 512, ch = 112;
  const cv = newCanvas(cw, ch); const c = cv.getContext('2d')!;
  rr(c, 4, 4, cw - 8, ch - 8, 28); c.fillStyle = 'rgba(6,10,22,.88)'; c.fill(); c.lineWidth = 5; c.strokeStyle = accent; c.stroke();
  let size = 46; c.font = `800 ${size}px ${FONT}`;
  const s = `▶ ${label}`;
  while (c.measureText(s).width > cw - 40 && size > 22) { size -= 2; c.font = `800 ${size}px ${FONT}`; }
  c.fillStyle = '#ffffff'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText(s, cw / 2, ch / 2 + 2);
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return t;
}

/** Name tag above an agent: name plus a status dot. */
export function nameTexture(name: string, status: string, accent: string, you = false): THREE.CanvasTexture {
  const cw = 512, ch = 112;
  const cv = newCanvas(cw, ch); const c = cv.getContext('2d')!;
  drawName(c, cw, ch, name, status, accent, you);
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace;
  t.userData.canvas = cv;
  return t;
}
const STATUS_COLOR: Record<string, string> = { working: '#39ff88', walking: '#4cc9ff', thinking: '#b57bff', researching: '#b57bff', communicating: '#ffd166', blocked: '#ff5d73', error: '#ff5d73', paused: '#8a9a8f', waiting: '#ff9f43', idle: '#cfd8e3' };
export function drawName(c: Ctx, cw: number, ch: number, name: string, status: string, accent: string, you = false) {
  c.clearRect(0, 0, cw, ch);
  c.font = `700 44px ${FONT}`;
  const tw = Math.min(cw - 40, c.measureText(name).width + 80);
  const x = (cw - tw) / 2;
  rr(c, x, 14, tw, ch - 28, (ch - 28) / 2); c.fillStyle = you ? 'rgba(30,20,60,.85)' : 'rgba(6,10,22,.78)'; c.fill();
  c.lineWidth = 4; c.strokeStyle = you ? '#ffd166' : accent; c.stroke();
  c.fillStyle = STATUS_COLOR[status] ?? '#cfd8e3'; c.beginPath(); c.arc(x + 34, ch / 2, 11, 0, Math.PI * 2); c.fill();
  c.fillStyle = '#ffffff'; c.textBaseline = 'middle'; c.fillText(name, x + 56, ch / 2 + 2, tw - 70);
}

// ---------- floors ----------

const floorCache = new Map<string, THREE.CanvasTexture>();
/** Repeating floor pattern (one texture tile = 2×2 cells). */
export function floorTexture(style: string, color: string): THREE.CanvasTexture {
  const k = `${style}|${color}`;
  let t = floorCache.get(k);
  if (t) return t;
  const S = 256;
  const cv = newCanvas(S, S); const c = cv.getContext('2d')!;
  c.fillStyle = color; c.fillRect(0, 0, S, S);
  const r = rnd(style.length * 31 + 7);
  const light = 'rgba(255,255,255,0.07)', dark = 'rgba(0,0,0,0.28)';
  switch (style) {
    case 'grid':
      c.strokeStyle = 'rgba(124,247,255,0.22)'; c.lineWidth = 3;
      for (let i = 0; i <= 2; i++) { c.beginPath(); c.moveTo(i * S / 2, 0); c.lineTo(i * S / 2, S); c.stroke(); c.beginPath(); c.moveTo(0, i * S / 2); c.lineTo(S, i * S / 2); c.stroke(); }
      break;
    case 'tile':
      for (let i = 0; i < 2; i++) for (let j = 0; j < 2; j++) { c.fillStyle = (i + j) % 2 ? light : 'rgba(255,255,255,0.03)'; c.fillRect(i * S / 2 + 3, j * S / 2 + 3, S / 2 - 6, S / 2 - 6); }
      break;
    case 'metal':
      c.strokeStyle = dark; c.lineWidth = 4; c.strokeRect(2, 2, S / 2 - 4, S / 2 - 4); c.strokeRect(S / 2 + 2, S / 2 + 2, S / 2 - 4, S / 2 - 4); c.strokeRect(S / 2 + 2, 2, S / 2 - 4, S / 2 - 4); c.strokeRect(2, S / 2 + 2, S / 2 - 4, S / 2 - 4);
      c.fillStyle = 'rgba(255,255,255,0.18)'; for (const [x, y] of [[12, 12], [S / 2 - 12, 12], [12, S / 2 - 12], [S / 2 - 12, S / 2 - 12]]) for (const [ox, oy] of [[0, 0], [S / 2, 0], [0, S / 2], [S / 2, S / 2]]) { c.beginPath(); c.arc(x + ox, y + oy, 3, 0, Math.PI * 2); c.fill(); }
      break;
    case 'wood':
      for (let i = 0; i < 8; i++) { c.fillStyle = i % 2 ? light : dark.replace('0.28', '0.12'); c.fillRect(0, i * S / 8, S, S / 8 - 2); c.fillStyle = dark; c.fillRect(((i * 97) % S), i * S / 8, 3, S / 8); }
      break;
    case 'carpet':
      for (let i = 0; i < 2600; i++) { c.fillStyle = r() > 0.5 ? light : dark.replace('0.28', '0.1'); c.fillRect(r() * S, r() * S, 2, 2); }
      c.strokeStyle = 'rgba(255,209,102,0.12)'; c.lineWidth = 2; c.strokeRect(S / 4, S / 4, S / 2, S / 2);
      break;
    default:
      for (let i = 0; i < 900; i++) { c.fillStyle = r() > 0.5 ? light : dark.replace('0.28', '0.08'); c.fillRect(r() * S, r() * S, 3, 3); }
  }
  t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(0.5, 0.5); t.anisotropy = 8;
  floorCache.set(k, t);
  return t;
}

/** Soft radial glow used for room light pools on the floor. */
let glowTex: THREE.CanvasTexture | null = null;
export function radialTexture(): THREE.CanvasTexture {
  if (glowTex) return glowTex;
  const S = 128; const cv = newCanvas(S, S); const c = cv.getContext('2d')!;
  const g = c.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2); g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.5, 'rgba(255,255,255,0.35)'); g.addColorStop(1, 'rgba(255,255,255,0)');
  c.fillStyle = g; c.fillRect(0, 0, S, S);
  glowTex = new THREE.CanvasTexture(cv);
  return glowTex;
}

export function disposeFloorTextures() { for (const t of floorCache.values()) t.dispose(); floorCache.clear(); glowTex?.dispose(); glowTex = null; }
