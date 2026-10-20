// Low-poly furniture generated from the object catalogue. Common kinds get a
// dedicated model (desks with live screens, server racks with blinking LEDs,
// wall displays, plants, sofas, tables, arcade cabinets, the throne in its
// glowing bubble, the briefing board, the holographic fountain…); anything else
// falls back to a box sized and coloured from FURNITURE_META. Models are built
// in a local frame: footprint centred on the origin, floor at y = 0, front +z.
import * as THREE from 'three';
import type { Furniture } from '../model/types';
import { FURNITURE_META, MATERIAL_COLOR } from '../model/catalog';
import { shade } from '../characters/color';
import type { RoomTheme } from './layout';
import { displayTexture, furnitureDisplay, type DisplayKind } from './textures';
import { fresnel, frustum, glow, mesh, roundBox, screen, std, torus, unitBox, unitCone, unitCyl, unitPlane, unitSphere } from './materials';

export type Updater = (t: number, dt: number) => void;
export interface Interact { kind: 'briefing' | 'arcade' | 'furniture'; id: string; label: string; verb: string; game?: string }
export interface BuiltFurniture { statics: THREE.Group; dynamics: THREE.Group; updaters: Updater[]; interact: Interact | null; height: number; lights: { color: string; y: number; intensity: number }[] }

export interface FurnitureCtx { theme: RoomTheme; accent: string; display: string; material?: string; reduced: boolean; seed: number; hasDevilBubble?: boolean }

// LEDs blink in three phases driven by one shared update per frame
export const ledMats = ['#39ff88', '#4cc9ff', '#ffb347'].map((c) => new THREE.MeshBasicMaterial({ color: new THREE.Color(c).multiplyScalar(1.6), toneMapped: false }));
export function blinkLeds(t: number, reduced: boolean) {
  ledMats.forEach((m, i) => { const on = reduced ? 1 : (Math.sin(t * (3 + i * 1.7) + i * 2) > -0.3 ? 1 : 0.15); m.color.setScalar(0); m.color.set(['#39ff88', '#4cc9ff', '#ffb347'][i]).multiplyScalar(on * 1.6); });
}

class B {
  statics = new THREE.Group(); dynamics = new THREE.Group(); updaters: Updater[] = []; lights: BuiltFurniture['lights'] = []; height = 0.6;
  constructor(public ctx: FurnitureCtx) {}
  add(o: THREE.Object3D) { this.statics.add(o); return o; }
  dyn(o: THREE.Object3D, u?: Updater) { this.dynamics.add(o); if (u && !this.ctx.reduced) this.updaters.push(u); return o; }
  box(w: number, h: number, d: number, m: THREE.Material, x = 0, y = 0, z = 0, round = false) { this.height = Math.max(this.height, y + h / 2); return this.add(mesh(round ? roundBox(0.12) : unitBox(), m, w, h, d, x, y, z)); }
  cyl(r: number, h: number, m: THREE.Material, x = 0, y = 0, z = 0, seg = 20) { this.height = Math.max(this.height, y + h / 2); return this.add(mesh(unitCyl(seg), m, r * 2, h, r * 2, x, y, z)); }
  sph(r: number, m: THREE.Material, x = 0, y = 0, z = 0, sy = 1) { return this.add(mesh(unitSphere(), m, r * 2, r * 2 * sy, r * 2, x, y, z)); }
  screen(kind: DisplayKind, w: number, h: number, x: number, y: number, z: number, tilt = 0, accent = this.ctx.display) {
    const p = mesh(unitPlane(), screen(displayTexture(kind, accent), 0.92), w, h, 1, x, y, z);
    p.rotation.x = -tilt;
    this.height = Math.max(this.height, y + h / 2);
    return this.add(p);
  }
}

function body(f: Furniture, ctx: FurnitureCtx) {
  const mc = (f.material && MATERIAL_COLOR[f.material]) || (ctx.material && ctx.material !== 'default' && MATERIAL_COLOR[ctx.material as keyof typeof MATERIAL_COLOR]) || null;
  const base = mc ?? shade(f.color || '#2a2f3a', 0.22);
  const metal = f.material === 'titanium' || f.material === 'black-titanium' || f.material === 'brass' || f.material === 'graphite';
  return { base, mat: std(base, { rough: metal ? 0.35 : 0.55, metal: metal ? 0.6 : 0.08 }), dark: std(shade(base, -0.35), { rough: 0.5, metal: 0.2 }), trim: glow(ctx.accent) };
}

const MONITORS: Record<string, number> = { desk: 1, 'dev-desk': 2, 'standing-desk': 1, 'compact-desk': 1, 'exec-desk': 2, 'workstation-3d': 3, 'anim-station': 2, 'finance-terminal': 2, 'archive-terminal': 1, 'evidence-station': 2, 'test-station': 1, 'packaging-station': 1 };

function desk(b: B, f: Furniture, w: number, d: number) {
  const { mat, dark, trim } = body(f, b.ctx);
  const topY = f.type === 'standing-desk' ? 1.0 : 0.74;
  const exec = f.type === 'exec-desk';
  b.box(w - 0.08, 0.07, d - 0.12, mat, 0, topY, 0, true);
  b.box(w - 0.12, 0.025, 0.03, trim, 0, topY - 0.03, d / 2 - 0.07);
  if (exec) b.box(w - 0.3, topY - 0.05, 0.08, dark, 0, (topY - 0.05) / 2, -d / 2 + 0.2);
  for (const sx of [-1, 1]) b.box(0.08, topY, d - 0.3, dark, sx * (w / 2 - 0.12), topY / 2, 0);
  if (f.type === 'workbench') {
    b.box(w - 0.2, 0.9, 0.06, std('#3a3a40', { rough: 0.8 }), 0, topY + 0.5, -d / 2 + 0.1);
    for (let i = 0; i < 4; i++) b.box(0.05, 0.28, 0.05, std('#9aa3ad', { metal: 0.8, rough: 0.3 }), -w / 2 + 0.4 + i * 0.4, topY + 0.6, -d / 2 + 0.16);
    b.box(0.4, 0.18, 0.3, std('#c0392b'), w / 2 - 0.5, topY + 0.13, 0);
    return;
  }
  const n = MONITORS[f.type] ?? 1;
  const kind = furnitureDisplay(f.type, b.ctx.theme);
  const mw = Math.min(0.9, (w - 0.3) / n - 0.06);
  for (let i = 0; i < n; i++) {
    const x = (i - (n - 1) / 2) * (mw + 0.06);
    const yaw = n > 1 ? -(i - (n - 1) / 2) * 0.25 : 0;
    const g = new THREE.Group(); g.position.set(x, topY, -d / 2 + 0.25); g.rotation.y = yaw;
    g.add(mesh(unitBox(), dark, mw + 0.05, mw * 0.6 + 0.05, 0.04, 0, 0.42, 0));
    const s = mesh(unitPlane(), screen(displayTexture(i === 1 && kind === 'code' ? 'build-preview' : kind, b.ctx.display), 0.92), mw, mw * 0.56, 1, 0, 0.42, 0.022);
    g.add(s);
    g.add(mesh(unitBox(), dark, 0.05, 0.3, 0.05, 0, 0.15, -0.03));
    g.add(mesh(unitBox(), dark, 0.25, 0.02, 0.18, 0, 0.01, 0));
    b.add(g);
  }
  b.height = Math.max(b.height, topY + 0.8);
  b.box(Math.min(0.6, w * 0.35), 0.025, 0.18, std('#1a1c22', { rough: 0.4 }), 0, topY + 0.05, d / 2 - 0.3);
  b.box(0.08, 0.025, 0.12, std('#1a1c22'), Math.min(0.6, w * 0.35) / 2 + 0.15, topY + 0.05, d / 2 - 0.3);
  if (f.type === 'holo-desk') {
    const h = mesh(unitPlane(), glow(b.ctx.display, 0.35, true), w * 0.7, 0.5, 1, 0, topY + 0.45, 0);
    b.dyn(h, (t) => { h.position.y = topY + 0.45 + Math.sin(t * 1.5) * 0.02; });
  }
  if (f.type === 'test-station') b.box(0.22, 0.05, 0.14, std('#2b2b33'), -w / 4, topY + 0.06, d / 2 - 0.25, true);
}

function chair(b: B, f: Furniture) {
  const { mat, dark } = body(f, b.ctx);
  b.box(0.5, 0.08, 0.48, mat, 0, 0.46, 0, true);
  b.box(0.5, 0.55, 0.08, mat, 0, 0.78, -0.22, true);
  b.cyl(0.04, 0.42, dark, 0, 0.22, 0);
  b.box(0.5, 0.03, 0.06, dark, 0, 0.03, 0); b.box(0.06, 0.03, 0.5, dark, 0, 0.03, 0);
}

function wallDisplay(b: B, f: Furniture, w: number, d: number) {
  const { dark, trim } = body(f, b.ctx);
  const brief = f.type === 'briefing-board';
  const kind = furnitureDisplay(f.type, b.ctx.theme, f.arcade?.game);
  const sw = w - 0.12, sh = brief ? Math.min(2.1, sw * 0.5) : Math.min(1.35, sw * 0.56);
  const y = brief ? 0.35 + sh / 2 : 0.32 + sh / 2;
  const z = -d / 2 + 0.12;
  const frameMat = brief ? std('#c9a24a', { metal: 0.9, rough: 0.25 }) : dark;
  b.box(sw + 0.1, sh + 0.1, 0.08, frameMat, 0, y, z);
  b.screen(kind, sw, sh, 0, y, z + 0.045);
  b.box(sw + 0.1, 0.03, 0.06, brief ? glow('#e0b84a') : trim, 0, y - sh / 2 - 0.07, z + 0.02);
  for (const sx of [-1, 1]) b.box(0.06, y - sh / 2, 0.06, dark, sx * (sw / 2 - 0.2), (y - sh / 2) / 2, z);
  if (brief) { b.box(sw + 0.3, 0.06, 0.2, std('#c9a24a', { metal: 0.9, rough: 0.25 }), 0, y + sh / 2 + 0.1, z + 0.04); b.sph(0.12, glow('#ff4d6d'), 0, y + sh / 2 + 0.26, z + 0.05); }
}

function storage(b: B, f: Furniture, w: number, d: number) {
  const { mat, dark, trim } = body(f, b.ctx);
  const tall = f.type === 'locker' || f.type === 'digital-shelf' || f.type === 'data-vault' || f.type === 'material-library' || f.type === 'equipment-shelf' || f.type === 'shelf';
  const h = f.type === 'container' ? 1.0 : tall ? 1.6 : 0.9;
  const dd = Math.min(d - 0.1, 0.55);
  const z = -d / 2 + dd / 2 + 0.05;
  if (f.type === 'container' || f.type === 'cabinet' || f.type === 'locker' || f.type === 'data-vault' || f.type === 'supply-station') {
    b.box(w - 0.1, h, dd, mat, 0, h / 2, z, true);
    b.box(0.03, h * 0.8, 0.02, dark, 0, h / 2, z + dd / 2 + 0.01);
    b.box(w * 0.6, 0.03, 0.02, f.type === 'data-vault' ? glow('#ff5d73') : trim, 0, h - 0.12, z + dd / 2 + 0.01);
    if (f.type === 'data-vault') b.cyl(0.18, 0.05, std('#9aa3ad', { metal: 0.9, rough: 0.2 }), 0, h / 2, z + dd / 2 + 0.03).rotateX(Math.PI / 2);
    return;
  }
  // open shelving with items
  for (const sx of [-1, 1]) b.box(0.05, h, dd, dark, sx * (w / 2 - 0.08), h / 2, z);
  b.box(w - 0.1, 0.04, dd, dark, 0, h, z);
  const rows = 4;
  const palette = f.type === 'material-library' ? ['#7cf7ff', '#8a94a2', '#c08a5a', '#3a8a3a', '#c0281a', '#cfcfd6'] : f.type === 'digital-shelf' ? ['#4cc9ff', '#b57bff', '#5ad1ff'] : ['#c0392b', '#2980b9', '#27ae60', '#f39c12', '#8e44ad', '#ecf0f1'];
  let k = b.ctx.seed * 7;
  for (let r = 0; r < rows; r++) {
    const y = 0.08 + r * (h / rows);
    b.box(w - 0.14, 0.03, dd - 0.04, dark, 0, y, z);
    let x = -w / 2 + 0.15;
    while (x < w / 2 - 0.2) {
      const bw = 0.06 + ((k * 13) % 7) / 50; const bh = h / rows - 0.12 - ((k * 7) % 5) / 40;
      const c = palette[k % palette.length];
      const m = f.type === 'digital-shelf' ? glow(c) : f.type === 'material-library' ? std(c, { metal: 0.3, rough: 0.4 }) : std(c, { rough: 0.7 });
      if (f.type === 'material-library' || f.type === 'equipment-shelf') b.sph(Math.min(0.09, bh / 2), m, x + 0.08, y + 0.11, z);
      else b.box(bw, bh, dd * 0.7, m, x + bw / 2, y + bh / 2 + 0.02, z);
      x += (f.type === 'material-library' || f.type === 'equipment-shelf' ? 0.22 : bw + 0.015); k++;
    }
  }
}

function table(b: B, f: Furniture, w: number, d: number) {
  const { mat, dark, trim } = body(f, b.ctx);
  const holo = f.type === 'holo-table' || f.type === 'strategy-table' || f.type === 'review-table';
  const y = 0.74;
  b.box(w - 0.1, 0.08, d - 0.1, holo ? std('#141a2a', { rough: 0.3, metal: 0.5 }) : mat, 0, y, 0, true);
  for (const sz of [-1, 1]) b.box(w - 0.14, 0.02, 0.03, trim, 0, y + 0.03, sz * (d / 2 - 0.06));
  b.box(w * 0.5, y - 0.04, d * 0.4, dark, 0, (y - 0.04) / 2, 0, true);
  if (holo) {
    b.box(w - 0.3, 0.012, d - 0.3, glow(b.ctx.display, 0.22, true, 1), 0, y + 0.05, 0);
    const g = new THREE.Group(); g.position.set(0, y + 0.75, 0);
    const theme = b.ctx.theme;
    const geo = theme === 'model3d' ? new THREE.TorusKnotGeometry(0.28, 0.08, 80, 10) : theme === 'gamedesign' || theme === 'building' ? new THREE.BoxGeometry(0.5, 0.3, 0.5, 3, 2, 3) : new THREE.IcosahedronGeometry(0.38, 1);
    const wire = new THREE.LineSegments(new THREE.WireframeGeometry(geo), new THREE.LineBasicMaterial({ color: new THREE.Color(b.ctx.display).multiplyScalar(1.5), transparent: true, opacity: 0.9, toneMapped: false }));
    wire.userData.ownMaterial = true;
    geo.dispose();
    g.add(wire);
    g.add(mesh(frustum(0.1), glow(b.ctx.display, 0.12, true), 0.9, 0.7, 0.9, 0, -0.35, 0));
    b.dyn(g, (t) => { g.rotation.y = t * 0.6; wire.position.y = Math.sin(t * 1.2) * 0.04; });
    b.height = Math.max(b.height, y + 1.2);
  }
}

function sofa(b: B, f: Furniture, w: number, d: number) {
  const { mat } = body(f, b.ctx);
  const royal = f.type === 'lounge-sofa';
  const m = royal ? std('#4a1a6a', { rough: 0.85 }) : mat;
  const gold = std('#c9a24a', { metal: 0.9, rough: 0.25 });
  const dd = Math.min(d, 0.95);
  b.box(w - 0.1, 0.4, dd, m, 0, 0.22, 0, true);
  b.box(w - 0.1, 0.55, 0.22, m, 0, 0.62, -dd / 2 + 0.11, true);
  for (const sx of [-1, 1]) b.box(0.2, 0.55, dd, m, sx * (w / 2 - 0.15), 0.36, 0, true);
  const n = Math.max(1, Math.round(w / 1.0));
  for (let i = 0; i < n; i++) b.box((w - 0.5) / n - 0.04, 0.12, dd - 0.3, std(shade(royal ? '#4a1a6a' : (f.color || '#2a2440'), 0.18), { rough: 0.9 }), -w / 2 + 0.25 + ((w - 0.5) / n) * (i + 0.5), 0.47, 0.06, true);
  if (royal) b.box(w - 0.1, 0.04, 0.05, gold, 0, 0.9, -dd / 2 + 0.22);
}

function plant(b: B) {
  b.cyl(0.22, 0.4, std('#e8e4dc', { rough: 0.4 }), 0, 0.2, 0);
  b.cyl(0.2, 0.03, std('#3a2614'), 0, 0.4, 0);
  const greens = ['#2e8b57', '#3cb371', '#228b22'];
  for (let i = 0; i < 5; i++) {
    const a = i * 1.3 + b.ctx.seed * 6;
    b.add(mesh(unitSphere(0), std(greens[i % 3], { rough: 0.7, flat: true }), 0.42, 0.5, 0.42, Math.cos(a) * 0.14, 0.7 + (i % 3) * 0.18, Math.sin(a) * 0.14));
  }
  b.height = 1.3;
}

function serverRack(b: B, f: Furniture, w: number, d: number) {
  const { dark } = body(f, b.ctx);
  const h = 2.0;
  b.box(w - 0.08, h, d - 0.1, std('#16181d', { rough: 0.4, metal: 0.5 }), 0, h / 2, 0, true);
  const front = d / 2 - 0.04;
  for (let r = 0; r < 9; r++) {
    const y = 0.2 + r * 0.2;
    b.box(w - 0.22, 0.14, 0.02, dark, 0, y, front);
    for (let i = 0; i < 4; i++) b.add(mesh(unitBox(), ledMats[(r + i + b.ctx.seed * 10) % 3 | 0], 0.035, 0.035, 0.02, -w / 2 + 0.2 + i * 0.07, y, front + 0.015));
  }
  b.box(w - 0.1, 0.03, 0.02, glow(b.ctx.accent), 0, h - 0.06, front);
}

function screenStand(b: B, f: Furniture, w: number, d: number) {
  const { dark } = body(f, b.ctx);
  const kind = furnitureDisplay(f.type, b.ctx.theme);
  const holo = f.type === 'holo-display';
  if (f.type === 'monitors' || f.type === 'multi-monitor' || f.type === 'curved-monitor') {
    const rows = f.type === 'multi-monitor' ? 2 : 1, cols = f.type === 'curved-monitor' ? 1 : 3;
    const sw = (w - 0.2) / cols;
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      const x = (c - (cols - 1) / 2) * sw, y = 1.0 + r * 0.62;
      b.box(sw - 0.02, 0.6, 0.05, dark, x, y, -d / 2 + 0.15);
      b.screen(kind, sw - 0.08, 0.54, x, y, -d / 2 + 0.18);
    }
    b.box(0.12, 1.0, 0.12, dark, 0, 0.5, -d / 2 + 0.15);
    b.box(w * 0.5, 0.05, 0.4, dark, 0, 0.025, -d / 2 + 0.2);
    return;
  }
  if (holo) {
    b.cyl(0.35, 0.12, dark, 0, 0.06, 0);
    b.add(mesh(torus(0.08), glow(b.ctx.display), 0.6, 0.6, 0.6, 0, 0.13, 0).rotateX(Math.PI / 2));
    const p = mesh(unitPlane(), new THREE.MeshBasicMaterial({ map: displayTexture(kind, b.ctx.display), transparent: true, opacity: 0.75, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }), w - 0.2, (w - 0.2) * 0.56, 1, 0, 1.15, 0);
    p.userData.ownMaterial = true;
    b.dyn(p, (t) => { p.position.y = 1.15 + Math.sin(t * 1.3) * 0.03; });
    b.height = 1.7;
    return;
  }
  // kiosks, terminals, computers
  const h = f.type === 'computer' ? 0.5 : 1.05;
  b.box(Math.min(0.5, w - 0.2), h, Math.min(0.4, d - 0.2), dark, 0, h / 2, 0, true);
  b.box(Math.min(0.6, w - 0.1), 0.42, 0.05, dark, 0, h + 0.2, 0);
  b.screen(kind, Math.min(0.54, w - 0.16), 0.36, 0, h + 0.2, 0.03, 0.15);
  b.box(Math.min(0.5, w - 0.2), 0.03, 0.03, glow(b.ctx.accent), 0, h * 0.3, Math.min(0.4, d - 0.2) / 2 + 0.01);
}

function tubeStation(b: B, f: Furniture, w: number) {
  const brass = std('#b08a3a', { metal: 0.85, rough: 0.3 });
  const hub = f.type === 'routing-hub';
  const n = hub ? 4 : 1;
  b.cyl(hub ? 0.8 : 0.36, 0.5, brass, 0, 0.25, 0);
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2, r = hub ? 0.42 : 0;
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    b.add(mesh(unitCyl(16), fresnel({ color: '#7cf7ff', rim: '#c8f8ff', base: 0.06, rimAlpha: 0.5 }), 0.36, 2.2, 0.36, x, 1.6, z));
    b.add(mesh(torus(0.12), brass, 0.42, 0.42, 0.42, x, 0.55, z).rotateX(Math.PI / 2));
    const cap = mesh(unitCyl(12), std('#ffd166', { metal: 0.5, rough: 0.3, emissive: '#ffb347', ei: 0.6 }), 0.22, 0.32, 0.22, x, 1.2, z);
    const ph = i * 1.7 + b.ctx.seed * 5;
    b.dyn(cap, (t) => { cap.position.y = 0.8 + ((t * 0.5 + ph) % 1) * 2.0; });
  }
  b.box(0.36, 0.1, 0.04, glow(b.ctx.accent), 0, 0.42, (hub ? 0.8 : 0.36) + 0.01);
  b.height = 2.8; void w;
}

function arcade(b: B, f: Furniture) {
  const c = f.arcade?.theme === 'neon' ? '#2a1458' : shade(f.color || '#1a1030', 0.15);
  const m = std(c, { rough: 0.5 });
  b.box(0.82, 1.7, 0.7, m, 0, 0.85, -0.05, true);
  b.box(0.86, 0.04, 0.74, glow(b.ctx.accent), 0, 1.72, -0.05);
  b.box(0.72, 0.22, 0.05, glow('#ff6fb5'), 0, 1.55, 0.31);
  const kind = furnitureDisplay('arcade-cabinet', b.ctx.theme, f.arcade?.game);
  b.screen(kind, 0.62, 0.48, 0, 1.18, 0.29, 0.2, '#ffffff');
  b.box(0.8, 0.08, 0.32, std('#111'), 0, 0.88, 0.38);
  b.cyl(0.02, 0.12, std('#ddd'), -0.18, 0.98, 0.4); b.sph(0.045, std('#ff3b3b'), -0.18, 1.05, 0.4);
  for (let i = 0; i < 3; i++) b.sph(0.035, glow(['#39ff88', '#4cc9ff', '#ffd166'][i]), 0.05 + i * 0.1, 0.94, 0.4, 0.5);
}

/** A devilish force-field bubble: crimson/violet iridescent shell with drifting bands, horn spires and rising embers. Walkable: purely visual. */
function devilBubble(b: B, R: number, cy: number) {
  const obs = std('#140a12', { rough: 0.25, metal: 0.6 });
  const k = R / 1.75;
  const bubble = new THREE.Group(); bubble.position.y = cy;
  const shell = mesh(unitSphere(), fresnel({ color: '#3a0018', rim: '#ff2a4a', base: 0.045, rimAlpha: 0.7, power: 2.0, irid: 0.3, bands: 0.16 }), R * 2, R * 2.05, R * 2);
  bubble.add(shell);
  bubble.add(mesh(unitSphere(), fresnel({ color: '#7a1aff', rim: '#c05cff', base: 0.0, rimAlpha: 0.32, power: 4.0, irid: 0.15, additive: true }), R * 2.1, R * 2.14, R * 2.1));
  // two great horns curling up from the crown, plus a ring of smaller spires
  for (const s of [-1, 1]) for (let i = 0; i < 9; i++) {
    const t = i / 8, a = 0.38 + t * 0.55;
    const r = 0.2 * k * (1 - t * 0.85);
    const x = s * (Math.sin(a) * R * 0.92 + t * t * 0.5 * k), y = Math.cos(a) * R * 0.92 + t * 1.1 * k - t * t * 0.25 * k;
    bubble.add(mesh(unitSphere(0), i > 6 ? glow('#ff4d2a') : obs, r * 2, r * 2.4, r * 2, x, y, 0));
  }
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 + Math.PI / 6;
    const sp = mesh(unitCone(6), obs, 0.18 * k, 0.75 * k, 0.18 * k, Math.cos(a) * R * 0.55, R * 0.86, Math.sin(a) * R * 0.55);
    sp.rotation.z = -Math.cos(a) * 0.5; sp.rotation.x = Math.sin(a) * 0.5;
    bubble.add(sp);
  }
  // rune circle on the floor
  bubble.add(mesh(torus(0.025), glow('#ff2a4a', 0.9), R * 1.9, R * 1.9, 1, 0, -cy + 0.03, 0).rotateX(Math.PI / 2));
  bubble.add(mesh(torus(0.02), glow('#b04cff', 0.8), R * 1.5, R * 1.5, 1, 0, -cy + 0.03, 0).rotateX(Math.PI / 2));
  // embers
  const n = Math.round(60 * k);
  const pos = new Float32Array(n * 3); const seeds: number[] = [];
  for (let i = 0; i < n; i++) { const a = Math.random() * Math.PI * 2, rr = Math.random() * R * 0.85; pos[i * 3] = Math.cos(a) * rr; pos[i * 3 + 1] = (Math.random() * 2 - 1) * R * 0.6; pos[i * 3 + 2] = Math.sin(a) * rr; seeds.push(Math.random()); }
  const pg = new THREE.BufferGeometry(); pg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const pm = new THREE.PointsMaterial({ color: new THREE.Color('#ff7a2a').multiplyScalar(2), size: 0.07, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
  const pts = new THREE.Points(pg, pm); pts.userData.ownMaterial = true;
  bubble.add(pts);
  b.dyn(bubble, (t) => {
    const s = 1 + Math.sin(t * 1.6) * 0.015;
    shell.scale.set(R * 2 * s, R * 2.05 * s, R * 2 * s);
    const p = pg.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < n; i++) { let y = p.getY(i) + 0.006 + seeds[i] * 0.006; if (y > R * 0.8) y = -cy + 0.1; p.setY(i, y); }
    p.needsUpdate = true;
  });
  b.lights.push({ color: '#ff2a4a', y: Math.max(1.4, cy), intensity: 2.5 });
  b.height = Math.max(b.height, cy + R + 0.8);
}

/** The command throne, sealed inside a pulsing, horned, devilish bubble. */
function throne(b: B, w: number, d: number) {
  const gold = std('#d4a84a', { metal: 0.95, rough: 0.22 });
  const obs = std('#140a12', { rough: 0.25, metal: 0.6 });
  const velvet = std('#6a0f2a', { rough: 0.9 });
  // dais
  b.cyl(Math.min(w, d) * 0.55, 0.16, obs, 0, 0.08, 0, 6);
  b.cyl(Math.min(w, d) * 0.45, 0.14, obs, 0, 0.23, 0, 6);
  b.add(mesh(torus(0.04), glow('#ff2a4a'), Math.min(w, d) * 1.1, Math.min(w, d) * 1.1, 1, 0, 0.17, 0).rotateX(Math.PI / 2));
  // seat
  b.box(0.95, 0.42, 0.8, obs, 0, 0.51, 0.05, true);
  b.box(0.85, 0.12, 0.7, velvet, 0, 0.77, 0.08, true);
  // tall back with spikes
  b.box(1.0, 1.7, 0.2, obs, 0, 1.45, -0.32, true);
  b.box(0.7, 1.3, 0.06, velvet, 0, 1.4, -0.2, true);
  b.box(1.04, 0.06, 0.24, gold, 0, 2.3, -0.32);
  for (let i = -2; i <= 2; i++) {
    const h = 0.55 - Math.abs(i) * 0.12;
    b.add(mesh(unitCone(6), i === 0 ? gold : obs, 0.14, h, 0.14, i * 0.22, 2.33 + h / 2, -0.32));
  }
  // horns sweeping out of the back
  for (const s of [-1, 1]) for (let k = 0; k < 6; k++) {
    const t = k / 5;
    const r = 0.11 * (1 - t * 0.8);
    const x = s * (0.5 + t * 0.35 + t * t * 0.1), y = 2.0 + t * 0.6 - t * t * 0.1, z = -0.32 + t * 0.15;
    b.add(mesh(unitSphere(0), k === 5 ? glow('#ff2a4a') : obs, r * 2, r * 2.2, r * 2, x, y, z));
  }
  // armrests with gold claws and gem
  for (const s of [-1, 1]) {
    b.box(0.16, 0.3, 0.7, obs, s * 0.52, 0.9, 0.05, true);
    b.add(mesh(unitSphere(), gold, 0.2, 0.2, 0.2, s * 0.52, 1.07, 0.38));
  }
  b.sph(0.1, glow('#ff2a4a'), 0, 1.95, -0.19);
  if (!b.ctx.hasDevilBubble) devilBubble(b, Math.max(1.75, Math.max(w, d) * 0.85), 1.15);
  b.height = 3.4;
}

function chandelier(b: B, w: number) {
  const gold = std('#d4a84a', { metal: 0.95, rough: 0.22 });
  const g = new THREE.Group(); g.position.y = 3.3;
  const r = Math.min(1.0, w * 0.45);
  g.add(mesh(torus(0.06), gold, r * 2, r * 2, r * 2).rotateX(Math.PI / 2));
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    g.add(mesh(unitCone(6), gold, 0.12, 0.35, 0.12, Math.cos(a) * r, 0.2, Math.sin(a) * r));
    g.add(mesh(unitSphere(0), glow('#ffe7a0'), 0.12, 0.16, 0.12, Math.cos(a) * r, -0.08, Math.sin(a) * r));
  }
  g.add(mesh(unitCyl(6), gold, 0.03, 1.2, 0.03, 0, 0.8, 0));
  b.dyn(g, (t) => { g.rotation.y = t * 0.15; });
  b.height = 4.2;
}

function fountain(b: B, w: number) {
  const r = Math.min(w, 2) * 0.48;
  const stone = std('#2a2e3a', { rough: 0.4, metal: 0.3 });
  b.add(mesh(unitCyl(32), stone, r * 2, 0.4, r * 2, 0, 0.2, 0));
  b.add(mesh(torus(0.12), std('#c9a24a', { metal: 0.9, rough: 0.25 }), r * 2, r * 2, r * 2, 0, 0.4, 0).rotateX(Math.PI / 2));
  b.add(mesh(unitCyl(32), glow('#5ad1ff', 0.7), r * 1.8, 0.02, r * 1.8, 0, 0.38, 0));
  const col = mesh(frustum(0.6), fresnel({ color: '#5ad1ff', rim: '#c8f8ff', base: 0.12, rimAlpha: 0.6, bands: 0.4, additive: true }), 0.5, 1.8, 0.5, 0, 1.3, 0);
  const rings = new THREE.Group();
  for (let i = 0; i < 3; i++) rings.add(mesh(torus(0.04), glow('#7cf7ff', 0.8), 0.5 + i * 0.25, 0.5 + i * 0.25, 1, 0, 0.6 + i * 0.5, 0).rotateX(Math.PI / 2));
  b.dyn(col, (t) => { col.rotation.y = t * 0.8; });
  b.dyn(rings, (t) => { rings.children.forEach((c, i) => { c.position.y = 0.5 + ((t * 0.3 + i / 3) % 1) * 1.6; }); });
  b.height = 2.3;
}

function lamp(b: B, f: Furniture) {
  if (f.type === 'floor-light') { b.box(0.8, 0.03, 0.8, glow(b.ctx.accent, 0.7), 0, 0.02, 0); return; }
  b.cyl(0.18, 0.05, std('#222'), 0, 0.03, 0);
  b.cyl(0.03, 1.5, std('#333', { metal: 0.6 }), 0, 0.78, 0);
  b.sph(0.18, glow('#ffe7a0'), 0, 1.6, 0);
  b.height = 1.8;
}

function creative(b: B, f: Furniture, w: number, d: number) {
  const { dark, trim } = body(f, b.ctx);
  if (f.type === 'preview-stage' || f.type === 'mockup-display') {
    const r = Math.min(w, d) * 0.42;
    b.cyl(r, 0.2, dark, 0, 0.1, 0, 32);
    b.add(mesh(torus(0.03), trim, r * 2, r * 2, 1, 0, 0.21, 0).rotateX(Math.PI / 2));
    const g = new THREE.Group(); g.position.y = 0.22;
    const m = std(b.ctx.display, { rough: 0.35, metal: 0.4 });
    if (b.ctx.theme === 'dev' || b.ctx.theme === 'building' || f.type === 'preview-stage') {
      // blocky reference figure with a 1-stud scale bar
      g.add(mesh(roundBox(0.1), std('#ffcc99'), 0.28, 0.28, 0.28, 0, 1.0, 0));
      g.add(mesh(roundBox(0.1), m, 0.42, 0.42, 0.22, 0, 0.66, 0));
      for (const s of [-1, 1]) { g.add(mesh(roundBox(0.1), std('#20232b'), 0.2, 0.42, 0.2, s * 0.11, 0.22, 0)); g.add(mesh(roundBox(0.1), m, 0.14, 0.4, 0.16, s * 0.29, 0.66, 0)); }
    } else {
      const k = new THREE.Mesh(new THREE.TorusKnotGeometry(0.25, 0.08, 60, 8), m); k.position.y = 0.6; g.add(k);
    }
    b.dyn(g, (t) => { g.rotation.y = t * 0.7; });
    b.height = 1.4;
    return;
  }
  if (f.type === 'prototype-printer') {
    const frameM = std('#3a3d44', { metal: 0.6, rough: 0.3 });
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.box(0.08, 1.6, 0.08, frameM, sx * (w / 2 - 0.15), 0.8, sz * (d / 2 - 0.15));
    b.box(w - 0.2, 0.08, d - 0.2, frameM, 0, 1.6, 0);
    b.box(w - 0.3, 0.05, d - 0.3, std('#1a1c22'), 0, 0.3, 0);
    b.add(mesh(unitCyl(24), glow(b.ctx.accent, 0.8), 0.5, 0.6, 0.5, 0, 0.62, 0));
    const head = mesh(unitBox(), std('#ff9f43'), 0.2, 0.15, 0.2, 0, 1.2, 0);
    b.dyn(head, (t) => { head.position.x = Math.sin(t * 2) * (w / 2 - 0.4); head.position.z = Math.cos(t * 1.3) * (d / 2 - 0.4); });
    b.add(mesh(unitBox(), std('#bfe6ff', { opacity: 0.15 }), w - 0.2, 1.5, d - 0.2, 0, 0.82, 0));
    return;
  }
  if (f.type === 'photo-station') {
    b.box(w - 0.2, 1.8, 0.05, std('#f2f2f2', { rough: 0.9 }), 0, 0.9, -d / 2 + 0.1);
    b.box(w - 0.2, 0.05, d * 0.6, std('#f2f2f2', { rough: 0.9 }), 0, 0.02, -d / 2 + d * 0.3);
    for (const s of [-1, 1]) { b.cyl(0.03, 1.6, std('#222'), s * (w / 2 - 0.2), 0.8, d / 2 - 0.3); b.box(0.5, 0.5, 0.1, glow('#ffffff', 0.9), s * (w / 2 - 0.25), 1.6, d / 2 - 0.35).rotation.y = s * 0.5; }
    b.box(0.3, 0.3, 0.3, std(b.ctx.display, { metal: 0.3 }), 0, 0.2, -d / 2 + 0.5, true);
    return;
  }
  if (f.type === 'material-station') {
    table(b, f, w, d);
    ['#7cf7ff', '#c08a5a', '#8a94a2', '#c0281a', '#3a8a3a'].forEach((c, i) => b.sph(0.1, std(c, { metal: i === 2 ? 0.9 : 0.1, rough: i === 0 ? 0.1 : 0.5 }), -w / 2 + 0.35 + i * ((w - 0.7) / 4), 0.9, 0));
    return;
  }
  generic(b, f, w, d);
}

function atmosphere(b: B, f: Furniture, w: number, d: number) {
  const { mat, dark, trim } = body(f, b.ctx);
  switch (f.type) {
    case 'sculpture': {
      b.cyl(0.3, 0.6, dark, 0, 0.3, 0);
      const k = new THREE.Mesh(new THREE.TorusKnotGeometry(0.22, 0.07, 64, 8), std('#c9d2dc', { metal: 0.95, rough: 0.15 }));
      k.position.y = 0.95;
      b.dyn(k, (t) => { k.rotation.y = t * 0.4; k.rotation.x = t * 0.2; });
      b.height = 1.3; return;
    }
    case 'deco-robot': {
      const m = std('#9aa3ad', { metal: 0.7, rough: 0.35 });
      b.box(0.4, 0.5, 0.3, m, 0, 0.55, 0, true); b.box(0.32, 0.28, 0.28, m, 0, 0.98, 0, true);
      for (const s of [-1, 1]) { b.sph(0.045, glow(b.ctx.accent), s * 0.08, 1.0, 0.15); b.box(0.1, 0.3, 0.1, m, s * 0.1, 0.15, 0, true); b.box(0.08, 0.35, 0.08, m, s * 0.27, 0.55, 0, true); }
      b.cyl(0.01, 0.2, m, 0, 1.22, 0); b.sph(0.04, glow('#ff5d73'), 0, 1.33, 0);
      return;
    }
    case 'aquarium': {
      b.box(w - 0.1, 0.5, d - 0.2, dark, 0, 0.25, 0);
      b.box(w - 0.1, 0.8, d - 0.2, std('#3a9ad9', { opacity: 0.35, rough: 0.05 }), 0, 0.9, 0);
      const fish = new THREE.Group(); fish.position.y = 0.9;
      for (let i = 0; i < 5; i++) fish.add(mesh(unitCone(6), std(['#ff9f43', '#ffd166', '#ff6fb5'][i % 3], { emissive: '#ff9f43', ei: 0.3 }), 0.08, 0.18, 0.08).rotateZ(Math.PI / 2));
      b.dyn(fish, (t) => fish.children.forEach((c, i) => { const a = t * (0.5 + i * 0.13) + i; c.position.set(Math.sin(a) * (w / 2 - 0.3), Math.sin(a * 1.7) * 0.2, Math.cos(a * 0.7) * (d / 2 - 0.25)); c.rotation.y = Math.cos(a) > 0 ? 0 : Math.PI; }));
      b.height = 1.3; return;
    }
    case 'wall-art': case 'wall-panel': case 'window': {
      const z = -d / 2 + 0.08;
      if (f.type === 'window') { b.box(w, 1.4, 0.08, dark, 0, 1.1, z); b.screen('city', w - 0.15, 1.25, 0, 1.1, z + 0.045, 0, '#ffffff'); return; }
      if (f.type === 'wall-panel') { for (let i = 0; i < Math.round(w * 5); i++) b.box(0.12, 1.3, 0.06, i % 2 ? mat : dark, -w / 2 + 0.1 + i * 0.2, 0.9, z); return; }
      b.box(w - 0.2, 0.9, 0.06, std('#c9a24a', { metal: 0.8, rough: 0.3 }), 0, 1.2, z);
      b.screen('drafts', w - 0.34, 0.76, 0, 1.2, z + 0.035, 0, b.ctx.accent);
      return;
    }
    case 'ambient-machine': {
      b.box(w - 0.2, 0.9, d - 0.3, dark, 0, 0.45, 0, true);
      for (let i = 0; i < 3; i++) b.cyl(0.06, 1.4, std('#8a6a2a', { metal: 0.8, rough: 0.3 }), -0.25 + i * 0.25, 0.9, -0.15);
      b.cyl(0.1, 0.04, trim, 0, 0.6, (d - 0.3) / 2 + 0.01).rotateX(Math.PI / 2);
      b.height = 1.6; return;
    }
    case 'lane-marker': b.box(w - 0.1, 0.01, 0.12, glow(f.color || '#39ff88', 0.8), 0, 0.01, 0); b.height = 0.05; return;
    case 'decor': b.cyl(0.14, 0.4, std(b.ctx.accent, { rough: 0.3, metal: 0.3 }), 0, 0.2, 0, 10); return;
    case 'intercom': case 'relay-panel': b.box(0.5, 0.6, 0.06, dark, 0, 1.2, -d / 2 + 0.06); b.box(0.36, 0.36, 0.02, glow(b.ctx.display, 0.8), 0, 1.25, -d / 2 + 0.1); return;
    case 'charging-station': {
      b.box(0.5, 1.5, 0.4, dark, 0, 0.75, 0, true);
      b.add(mesh(torus(0.06), glow('#39ff88'), 0.42, 0.42, 0.42, 0, 1.0, 0.21));
      b.box(0.06, 1.2, 0.02, glow('#39ff88'), 0, 0.75, 0.21);
      return;
    }
  }
  generic(b, f, w, d);
}

function generic(b: B, f: Furniture, w: number, d: number) {
  const meta = (FURNITURE_META as Record<string, { fn: string; wall?: boolean } | undefined>)[f.type];
  const { mat, trim } = body(f, b.ctx);
  if (meta?.fn === 'display' || meta?.fn === 'render' || meta?.fn === 'budget' || meta?.wall) { wallDisplay(b, f, w, d); return; }
  if (meta?.fn === 'workstation') { desk(b, f, w, d); return; }
  if (meta?.fn === 'seating') { sofa(b, f, w, d); return; }
  if (meta?.fn === 'storage' || meta?.fn === 'archive') { storage(b, f, w, d); return; }
  const h = 0.8;
  b.box(w - 0.15, h, d - 0.15, mat, 0, h / 2, 0, true);
  b.box(w - 0.2, 0.03, 0.02, trim, 0, h - 0.1, d / 2 - 0.07);
}

const BUILDERS: Record<string, (b: B, f: Furniture, w: number, d: number) => void> = {};
for (const t of Object.keys(MONITORS).concat(['holo-desk', 'workbench'])) BUILDERS[t] = desk;
BUILDERS.chair = (b, f) => chair(b, f);
for (const t of ['whiteboard', 'project-board', 'task-board', 'analytics-wall', 'market-display', 'comparison-wall', 'budget-dashboard', 'project-display', 'render-wall', 'reference-display', 'marketplace-display', 'inventory-monitor', 'diagnostic-panel', 'briefing-board']) BUILDERS[t] = wallDisplay;
for (const t of ['cabinet', 'locker', 'shelf', 'container', 'digital-shelf', 'data-vault', 'equipment-shelf', 'material-library', 'supply-station']) BUILDERS[t] = storage;
for (const t of ['conference-table', 'collab-table', 'strategy-table', 'review-table', 'holo-table']) BUILDERS[t] = table;
for (const t of ['sofa', 'lounge-seat', 'lounge-sofa']) BUILDERS[t] = sofa;
BUILDERS.plant = (b) => plant(b);
BUILDERS['server-rack'] = serverRack;
for (const t of ['monitors', 'multi-monitor', 'curved-monitor', 'holo-display', 'terminal', 'computer', 'research-kiosk', 'approval-kiosk']) BUILDERS[t] = screenStand;
for (const t of ['tube-station', 'dispatch-terminal', 'message-station', 'routing-hub']) BUILDERS[t] = (b, f, w) => tubeStation(b, f, w);
BUILDERS['arcade-cabinet'] = (b, f) => arcade(b, f);
BUILDERS.throne = (b, _f, w, d) => throne(b, w, d);
// Roblox HQ kinds (string keys so this compiles before and after they join the catalogue)
BUILDERS['devil-bubble'] = (b, _f, w, d) => devilBubble(b, Math.min(w, d) * 0.48, Math.min(w, d) * 0.48 * 0.62);
for (const t of ['code-wall', 'build-preview', 'evidence-board', 'note-wall', 'mechanics-board', 'blueprint-wall', 'font-specimen-wall', 'type-scale-panel', 'game-ui-preview', 'build-plan-board', 'campaign-board', 'concept-review-wall', 'image-draft-gallery', 'final-asset-display', 'command-display', 'team-sign', 'material-swatches']) BUILDERS[t] = wallDisplay;
for (const t of ['studio-workstation', 'planning-desk', 'lettering-desk']) BUILDERS[t] = desk;
for (const t of ['level-layout-table', 'terrain-table', 'war-table']) BUILDERS[t] = table;
for (const t of ['preview-turntable', 'wireframe-stand', 'scale-figure', 'prototype-pod']) BUILDERS[t] = (b, f, w, d) => creative(b, { ...f, type: 'preview-stage' } as Furniture, w, d);
for (const t of ['reference-stack', 'modular-parts-rack']) BUILDERS[t] = (b, f, w, d) => storage(b, { ...f, type: t === 'reference-stack' ? 'shelf' : 'equipment-shelf' } as Furniture, w, d);
BUILDERS['dark-candelabra'] = (b) => {
  const iron = std('#1a0f16', { rough: 0.3, metal: 0.7 });
  b.cyl(0.22, 0.06, iron, 0, 0.03, 0, 8); b.cyl(0.04, 1.7, iron, 0, 0.85, 0, 8);
  for (const x of [-0.3, 0, 0.3]) {
    b.box(Math.abs(x) > 0 ? 0.3 : 0.02, 0.03, 0.03, iron, x / 2, 1.5, 0);
    b.cyl(0.04, 0.22, std('#e8dcc8'), x, 1.62 + (x ? 0 : 0.15), 0, 8);
    const fl = mesh(unitCone(8), glow('#ff4d2a', 0.9, true), 0.08, 0.18, 0.08, x, 1.82 + (x ? 0 : 0.15), 0);
    const ph = x * 7;
    b.dyn(fl, (t) => { fl.scale.y = 0.18 * (1 + Math.sin(t * 11 + ph) * 0.2); });
  }
  b.height = 2.1;
};
BUILDERS['crown-chandelier'] = (b, _f, w) => chandelier(b, w);
BUILDERS['holo-fountain'] = (b, _f, w) => fountain(b, w);
for (const t of ['lamp', 'floor-light']) BUILDERS[t] = (b, f) => lamp(b, f);
for (const t of ['preview-stage', 'mockup-display', 'prototype-printer', 'photo-station', 'material-station']) BUILDERS[t] = creative;
for (const t of ['sculpture', 'deco-robot', 'aquarium', 'wall-art', 'wall-panel', 'window', 'ambient-machine', 'lane-marker', 'decor', 'intercom', 'relay-panel', 'charging-station']) BUILDERS[t] = atmosphere;

/** Whether a furniture type has a dedicated model (others use the catalogue fallback). */
export const hasModel = (type: string) => type in BUILDERS;

export function buildFurniture(f: Furniture, w: number, d: number, ctx: FurnitureCtx): BuiltFurniture {
  const b = new B(ctx);
  (BUILDERS[f.type] ?? generic)(b, f, w, d);
  const meta = (FURNITURE_META as Record<string, { label: string; fn: string } | undefined>)[f.type];
  const label = f.label || f.workstation?.name || meta?.label || f.type;
  let interact: Interact | null = null;
  if (f.type === 'briefing-board') interact = { kind: 'briefing', id: f.id, label, verb: 'open the hourly briefing' };
  else if (f.arcade) interact = { kind: 'arcade', id: f.id, label, verb: `play ${f.arcade.game}`, game: f.arcade.game };
  else if (meta && meta.fn !== 'none') interact = { kind: 'furniture', id: f.id, label, verb: 'inspect' };
  return { statics: b.statics, dynamics: b.dynamics, updaters: b.updaters, interact, height: b.height, lights: b.lights };
}
