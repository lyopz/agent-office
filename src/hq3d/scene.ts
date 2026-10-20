// The three.js headquarters built from the live OfficeDoc. Rooms, tubes and
// characters are cached by object identity (Immer keeps unchanged slices
// identical), so a doc change rebuilds only what changed. Static furniture is
// merged per room and material, keeping draw calls low.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import type { Agent, Appearance, Corridor, Furniture, OfficeDoc, Room, RuntimeState } from '../model/types';
import { buildNav, furnitureWorldRect, type NavGraph } from '../engine/navigation';
import { FURNITURE_META } from '../model/catalog';
import { key } from '../engine/geometry';
import { kelvinColor } from '../model/themes';
import { shade } from '../characters/color';
import { describeRoom, describeTube, inwardRotY, nearestWall, roomAtWorld, type RoomDesc, type TubeDesc, type XZ } from './layout';
import { animateCharacter, buildCharacter, poseForStatus, type CharacterPose } from './character3d';
import { blinkLeds, buildFurniture, type Interact, type Updater } from './furniture3d';
import { disposeFloorTextures, disposeTextures, displayTexture, doorSignTexture, drawName, floorTexture, nameTexture, radialTexture, signTexture, THEME_DISPLAYS, updateLiveTextures } from './textures';
import { disposeTree, fresnel, glow, mesh, releaseShared, retainShared, roundBox, screen, std, tickShared, torus, unitBox, unitCone, unitCyl, unitPlane, unitSphere } from './materials';
import type { PlayerController } from './controls';

export interface Target extends Omit<Interact, 'kind'> { kind: Interact['kind'] | 'agent'; dist: number }
interface InteractBox { box: THREE.Box3; info: Interact }

interface RoomRec { room: Room; furn: (Furniture | undefined)[]; preset: string; agentsKey: string; group: THREE.Group; updaters: Updater[]; interacts: InteractBox[]; desc: RoomDesc; ownMats: THREE.Material[]; lights: THREE.PointLight[] }
interface TubeRec { c: Corridor; ends: (Room | undefined)[]; group: THREE.Group; desc: TubeDesc; updaters: Updater[] }
interface CharRec { app: Appearance; root: THREE.Group; char: THREE.Group; label: THREE.Sprite; labelKey: string; disc: THREE.Mesh; pos: THREE.Vector3; yaw: number; pose: CharacterPose; height: number; seen: boolean }

const SUPER_N = 6;
const WALL_KINDS = new Set(['whiteboard', 'project-board', 'task-board', 'analytics-wall', 'market-display', 'comparison-wall', 'budget-dashboard', 'project-display', 'render-wall', 'reference-display', 'marketplace-display', 'inventory-monitor', 'diagnostic-panel', 'briefing-board', 'monitors', 'window', 'wall-art', 'wall-panel', 'intercom', 'relay-panel', 'digital-shelf', 'shelf', 'locker', 'material-library', 'equipment-shelf',
  'code-wall', 'evidence-board', 'note-wall', 'mechanics-board', 'blueprint-wall', 'font-specimen-wall', 'type-scale-panel', 'game-ui-preview', 'build-plan-board', 'campaign-board', 'concept-review-wall', 'image-draft-gallery', 'final-asset-display', 'command-display', 'team-sign']);
const sp = (v: number, e: number) => Math.sign(v) * Math.pow(Math.abs(v), e);

export function superellipseShape(a: number, b: number, n = SUPER_N, seg = 72, hole?: { a: number; b: number }): THREE.Shape {
  const s = new THREE.Shape();
  for (let i = 0; i <= seg; i++) {
    const t = (i / seg) * Math.PI * 2;
    const x = a * sp(Math.cos(t), 2 / n), y = b * sp(Math.sin(t), 2 / n);
    if (i) s.lineTo(x, y); else s.moveTo(x, y);
  }
  if (hole) {
    const h = new THREE.Path();
    for (let i = 0; i <= seg; i++) { const t = (i / seg) * Math.PI * 2; const x = hole.a * sp(Math.cos(t), 2 / n), y = hole.b * sp(Math.sin(t), 2 / n); if (i) h.lineTo(x, y); else h.moveTo(x, y); }
    s.holes.push(h);
  }
  return s;
}

/** Upper half of a superellipsoid: a rounded bubble shell that hugs a rectangular room. */
export function domeGeometry(a: number, b: number, height: number, n = SUPER_N, m = 2.6, U = 72, V = 18): THREE.BufferGeometry {
  const pos: number[] = []; const idx: number[] = [];
  for (let v = 0; v <= V; v++) {
    const phi = (v / V) * Math.PI / 2;
    const hf = Math.pow(Math.cos(phi), 2 / m), y = height * Math.pow(Math.sin(phi), 2 / m);
    for (let u = 0; u <= U; u++) {
      const t = (u / U) * Math.PI * 2;
      pos.push(a * hf * sp(Math.cos(t), 2 / n), y, b * hf * sp(Math.sin(t), 2 / n));
    }
  }
  for (let v = 0; v < V; v++) for (let u = 0; u < U; u++) {
    const i = v * (U + 1) + u;
    idx.push(i, i + U + 1, i + 1, i + 1, i + U + 1, i + U + 2);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx); g.computeVertexNormals();
  return g;
}

/** Smooth tube path through orthogonal corners. */
export function tubeCurve(pts: XZ[], y: number, radius: number): THREE.CurvePath<THREE.Vector3> {
  const path = new THREE.CurvePath<THREE.Vector3>();
  const V = (p: XZ) => new THREE.Vector3(p.x, y, p.z);
  let cur = V(pts[0]);
  for (let i = 1; i < pts.length - 1; i++) {
    const A = V(pts[i - 1]), P = V(pts[i]), C = V(pts[i + 1]);
    const lin = P.clone().sub(A), lout = C.clone().sub(P);
    const rc = Math.min(radius * 1.15, lin.length() / 2, lout.length() / 2);
    const entry = P.clone().sub(lin.normalize().multiplyScalar(rc)), exit = P.clone().add(lout.normalize().multiplyScalar(rc));
    if (cur.distanceTo(entry) > 1e-4) path.add(new THREE.LineCurve3(cur, entry));
    path.add(new THREE.QuadraticBezierCurve3(entry, P, exit));
    cur = exit;
  }
  const last = V(pts[pts.length - 1]);
  if (cur.distanceTo(last) > 1e-4 || !path.curves.length) path.add(new THREE.LineCurve3(cur, last));
  return path;
}

/** Flat strip following a curve, from offset `inner` to `outer` on both sides (inner 0 = one solid strip). */
function ribbon(curve: THREE.CurvePath<THREE.Vector3>, inner: number, outer: number, y: number, samples: number): THREE.BufferGeometry {
  const pos: number[] = []; const uv: number[] = []; const idx: number[] = [];
  const sides = inner > 0 ? [[inner, outer], [-outer, -inner]] : [[-outer, outer]];
  let base = 0;
  for (const [o1, o2] of sides) {
    for (let i = 0; i <= samples; i++) {
      const t = Math.min(0.9995, Math.max(0.0005, i / samples));
      const p = curve.getPointAt(t), tan = curve.getTangentAt(t);
      const nx = -tan.z, nz = tan.x; const l = Math.hypot(nx, nz) || 1;
      pos.push(p.x + (nx / l) * o1, y, p.z + (nz / l) * o1, p.x + (nx / l) * o2, y, p.z + (nz / l) * o2);
      uv.push(0, t * curve.getLength(), 1, t * curve.getLength());
      if (i < samples) { const k = base + i * 2; idx.push(k, k + 2, k + 1, k + 1, k + 2, k + 3); }
    }
    base += (samples + 1) * 2;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx); g.computeVertexNormals();
  // make normals face up regardless of winding
  const n = g.attributes.normal as THREE.BufferAttribute; for (let i = 0; i < n.count; i++) n.setXYZ(i, 0, 1, 0);
  return g;
}

/** Merge every mesh under `root` into one mesh per material (world space). */
function mergeStatics(root: THREE.Object3D, into: THREE.Object3D) {
  root.updateMatrixWorld(true);
  const byMat = new Map<THREE.Material, THREE.BufferGeometry[]>();
  const keep: THREE.Object3D[] = [];
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) { if ((o as THREE.Line).isLine || (o as THREE.Points).isPoints) keep.push(o); return; }
    if (Array.isArray(m.material)) { keep.push(o); return; }
    const gq = m.geometry.index ? m.geometry.toNonIndexed() : m.geometry.clone();
    for (const name of Object.keys(gq.attributes)) if (name !== 'position' && name !== 'normal' && name !== 'uv') gq.deleteAttribute(name);
    if (!gq.attributes.normal) gq.computeVertexNormals();
    if (!gq.attributes.uv) gq.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(gq.attributes.position.count * 2), 2));
    gq.clearGroups();
    gq.applyMatrix4(m.matrixWorld);
    const list = byMat.get(m.material) ?? [];
    list.push(gq); byMat.set(m.material, list);
  });
  for (const [mat, list] of byMat) {
    const merged = mergeGeometries(list, false);
    for (const g of list) g.dispose();
    if (!merged) continue;
    const mm = new THREE.Mesh(merged, mat);
    if ((mat as THREE.Material).transparent) mm.renderOrder = 2;
    into.add(mm);
  }
  for (const o of keep) { o.updateMatrixWorld(true); const c = o.clone(); c.matrixAutoUpdate = false; c.matrix.copy(o.matrixWorld); into.add(c); }
}

function makeSprite(tex: THREE.Texture, w: number, h: number): THREE.Sprite {
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, toneMapped: false }));
  s.scale.set(w, h, 1); s.userData.ownMaterial = true; s.renderOrder = 10;
  return s;
}

function signPlane(tex: THREE.Texture, w: number, h: number): THREE.Mesh {
  const m = new THREE.Mesh(unitPlane(), new THREE.MeshBasicMaterial({ map: tex, transparent: true, side: THREE.FrontSide, toneMapped: false, depthWrite: false }));
  m.scale.set(w, h, 1); m.userData.sharedGeo = true; m.userData.ownMaterial = true; m.renderOrder = 5;
  return m;
}

export class HQScene {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(68, 1, 0.05, 600);
  private composer: EffectComposer | null = null;
  private bloomPass: UnrealBloomPass | null = null;
  private rooms = new Map<string, RoomRec>();
  private tubes = new Map<string, TubeRec>();
  private agents = new Map<string, CharRec>();
  private player: CharRec | null = null;
  private playerApp: Appearance | null = null;
  private world = new THREE.Group();
  private hemi = new THREE.HemisphereLight('#9cc4ff', '#1c1030', 0.9);
  private sun = new THREE.DirectionalLight('#ffffff', 1.1);
  private roomLight = new THREE.PointLight('#7cf7ff', 3, 14, 1.2);
  private ground: THREE.Mesh | null = null;
  private stars: THREE.Points | null = null;
  private preset = '';
  private fogTarget = new THREE.Color('#05070f');
  private bloomOn = true;
  private liveTimer = 0;
  doc: OfficeDoc;
  nav: NavGraph;
  currentRoomId: string | null = null;

  constructor(readonly renderer: THREE.WebGLRenderer, doc: OfficeDoc, bloom: boolean) {
    retainShared();
    this.doc = doc; this.nav = buildNav(doc);
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.25;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.scene.background = new THREE.Color('#05070f');
    this.scene.fog = new THREE.FogExp2('#05070f', 0.0105);
    this.sun.position.set(30, 60, 20);
    this.scene.add(this.hemi, this.sun, this.roomLight, new THREE.AmbientLight('#404a70', 0.6), this.world);
    this.buildSky();
    this.setBloom(bloom);
    this.sync(doc);
  }

  setBloom(on: boolean) {
    this.bloomOn = on;
    if (on && !this.composer) {
      const size = this.renderer.getSize(new THREE.Vector2());
      this.composer = new EffectComposer(this.renderer);
      this.composer.addPass(new RenderPass(this.scene, this.camera));
      this.bloomPass = new UnrealBloomPass(new THREE.Vector2(Math.max(1, size.x / 2), Math.max(1, size.y / 2)), 0.62, 0.55, 0.88);
      this.composer.addPass(this.bloomPass);
      this.composer.addPass(new OutputPass());
      this.composer.setSize(size.x, size.y);
    }
  }

  resize(w: number, h: number) {
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / Math.max(1, h); this.camera.updateProjectionMatrix();
    this.composer?.setSize(w, h);
    this.bloomPass?.resolution.set(Math.max(1, w / 2), Math.max(1, h / 2));
  }

  private buildSky() {
    const n = 1400; const p = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const u = Math.random() * 2 - 1, a = Math.random() * Math.PI * 2, r = 280;
      const s = Math.sqrt(1 - u * u);
      p[i * 3] = Math.cos(a) * s * r; p[i * 3 + 1] = Math.abs(u) * r * 0.9 + 10; p[i * 3 + 2] = Math.sin(a) * s * r;
    }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(p, 3));
    this.stars = new THREE.Points(g, new THREE.PointsMaterial({ color: '#cfe3ff', size: 1.6, sizeAttenuation: false, fog: false, transparent: true, opacity: 0.85 }));
    this.scene.add(this.stars);
  }

  private buildGround(doc: OfficeDoc) {
    if (this.ground) { this.scene.remove(this.ground); this.ground.geometry.dispose(); (this.ground.material as THREE.Material).dispose(); }
    const bubble = doc.settings.layoutPreset === 'bubble';
    const cv = document.createElement('canvas'); cv.width = cv.height = 128;
    const c = cv.getContext('2d')!;
    c.fillStyle = bubble ? '#070b18' : '#0a0f1c'; c.fillRect(0, 0, 128, 128);
    c.strokeStyle = bubble ? 'rgba(124,247,255,0.22)' : 'rgba(124,247,255,0.12)'; c.lineWidth = 2; c.strokeRect(0, 0, 128, 128);
    const tex = new THREE.CanvasTexture(cv); tex.wrapS = tex.wrapT = THREE.RepeatWrapping; tex.repeat.set(120, 120); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 8;
    const rs = Object.values(doc.rooms);
    const cx = rs.length ? rs.reduce((n, r) => n + r.x + r.w / 2, 0) / rs.length : 0, cz = rs.length ? rs.reduce((n, r) => n + r.y + r.h / 2, 0) / rs.length : 0;
    this.ground = new THREE.Mesh(new THREE.PlaneGeometry(960, 960), new THREE.MeshBasicMaterial({ map: tex }));
    this.ground.rotation.x = -Math.PI / 2; this.ground.position.set(cx, bubble ? -6 : -0.08, cz);
    this.scene.add(this.ground);
  }

  // ---------- sync ----------

  sync(doc: OfficeDoc) {
    this.doc = doc; this.nav = buildNav(doc);
    const preset = doc.settings.layoutPreset;
    if (preset !== this.preset) { this.preset = preset; this.buildGround(doc); }
    // rooms
    for (const [id, rec] of this.rooms) {
      const r = doc.rooms[id];
      const furn = r ? r.furnitureIds.map((f) => doc.furniture[f]) : [];
      const agentsKey = r ? r.assignedAgentIds.map((a) => doc.agents[a]?.identity.department).join('|') : '';
      if (!r || r !== rec.room || rec.preset !== preset || agentsKey !== rec.agentsKey || furn.length !== rec.furn.length || furn.some((f, i) => f !== rec.furn[i])) { this.disposeRoom(rec); this.rooms.delete(id); }
    }
    for (const r of Object.values(doc.rooms)) if (!this.rooms.has(r.id)) this.rooms.set(r.id, this.buildRoom(doc, r));
    // tubes
    for (const [id, rec] of this.tubes) {
      const c = doc.corridors[id];
      const ends = c ? this.endRooms(doc, c) : [];
      if (!c || c !== rec.c || ends.some((e, i) => e !== rec.ends[i]) || rec.ends.some((e) => e && !doc.rooms[e.id])) { this.world.remove(rec.group); disposeTree(rec.group); this.tubes.delete(id); }
    }
    for (const c of Object.values(doc.corridors)) if (!this.tubes.has(c.id)) { const t = this.buildTube(doc, c); if (t) this.tubes.set(c.id, t); }
    // agents
    for (const [id, rec] of this.agents) {
      const a = doc.agents[id];
      if (!a || a.appearance !== rec.app) { this.world.remove(rec.root); disposeTree(rec.root); this.agents.delete(id); }
    }
    for (const a of Object.values(doc.agents)) if (!this.agents.has(a.id)) this.agents.set(a.id, this.buildChar(a.appearance, a.identity.name, a.id, false));
    // player
    const pa = doc.player?.appearance;
    if (pa && pa !== this.playerApp) {
      if (this.player) { this.world.remove(this.player.root); disposeTree(this.player.root); }
      this.playerApp = pa;
      const old = this.player;
      this.player = this.buildChar(pa, doc.player.name || 'You', 'player', true);
      if (old) { this.player.pos.copy(old.pos); this.player.yaw = old.yaw; }
    }
  }

  private endRooms(doc: OfficeDoc, c: Corridor) {
    return [c.start, c.end].map((e) => (e.kind === 'door' ? doc.rooms[e.roomId] : undefined));
  }

  private disposeRoom(rec: RoomRec) {
    this.world.remove(rec.group);
    disposeTree(rec.group);
    for (const m of rec.ownMats) m.dispose();
  }

  private buildRoom(doc: OfficeDoc, room: Room): RoomRec {
    const desc = describeRoom(doc, room);
    const g = new THREE.Group(); g.name = `room:${room.name}`;
    const ap = room.appearance;
    const royal = desc.theme === 'royal';
    const accent = ap.accent || '#7cf7ff';
    const display = ap.displayColor || accent;
    const floorBase = royal ? '#2a0f1e' : ap.floorColor || shade(accent, -0.8);
    const fmat = new THREE.MeshStandardMaterial({ map: floorTexture(ap.floor, floorBase), roughness: ap.floor === 'metal' ? 0.35 : ap.floor === 'wood' ? 0.55 : 0.7, metalness: ap.floor === 'metal' ? 0.5 : 0.08 });
    const ownMats: THREE.Material[] = [fmat];
    const updaters: Updater[] = [];
    const lights: THREE.PointLight[] = [];
    const statics = new THREE.Group();
    // floor
    if (desc.dome) {
      const { a, b } = desc.dome;
      const top = new THREE.Mesh(new THREE.ShapeGeometry(superellipseShape(a, b), 1), fmat);
      top.rotation.x = -Math.PI / 2; top.position.set(desc.cx, 0, desc.cz);
      // world-aligned texture: shape UVs are local units, offset so neighbouring rooms line up
      g.add(top);
      const body = new THREE.Mesh(new THREE.ExtrudeGeometry(superellipseShape(a, b), { depth: 0.45, bevelEnabled: true, bevelThickness: 0.12, bevelSize: 0.12, bevelSegments: 2 }), std(royal ? '#1a0a12' : '#0f1424', { rough: 0.35, metal: 0.6 }));
      body.rotation.x = Math.PI / 2; body.position.set(desc.cx, -0.15, desc.cz); // bevel pokes 0.12 above the extrusion start
      g.add(body);
      const rim = new THREE.Mesh(new THREE.ShapeGeometry(superellipseShape(a + 0.14, b + 0.14, SUPER_N, 72, { a: a - 0.02, b: b - 0.02 }), 1), glow(accent, 0.95));
      rim.rotation.x = -Math.PI / 2; rim.position.set(desc.cx, 0.012, desc.cz);
      g.add(rim);
      // shell
      const dome = new THREE.Mesh(domeGeometry(a, b, desc.dome.height), royal
        ? fresnel({ color: '#2a0010', rim: '#ff3355', base: 0.03, rimAlpha: 0.5, power: 2.2, irid: 0.35 })
        : fresnel({ color: shade(accent, -0.5), rim: '#d8fbff', base: 0.025, rimAlpha: 0.42, power: 2.6, irid: 0.9 }));
      dome.position.set(desc.cx, 0, desc.cz); dome.renderOrder = 3;
      g.add(dome);
      // underside glow on the ground far below
      const pool = new THREE.Mesh(unitPlane(), new THREE.MeshBasicMaterial({ map: radialTexture(), color: new THREE.Color(accent).multiplyScalar(0.5), transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false }));
      pool.userData.sharedGeo = true; pool.userData.ownMaterial = true;
      pool.rotation.x = -Math.PI / 2; pool.scale.set(a * 3, b * 3, 1); pool.position.set(desc.cx, -5.95, desc.cz);
      g.add(pool);
    } else {
      const f = new THREE.Mesh(new THREE.PlaneGeometry(room.w, room.h), fmat);
      f.rotation.x = -Math.PI / 2; f.position.set(desc.cx, 0, desc.cz);
      const uv = f.geometry.attributes.uv as THREE.BufferAttribute;
      for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * room.w, uv.getY(i) * room.h);
      g.add(f);
      const wallMat = room.walls.style === 'glass' ? std(ap.wallColor || '#9fd6ff', { opacity: 0.28, rough: 0.05, metal: 0.2 }) : std(shade(ap.wallColor || '#2a3346', -0.25), { rough: 0.5, metal: 0.2 });
      const strip = glow(accent);
      for (const w of desc.walls) {
        const len = Math.hypot(w.x2 - w.x1, w.z2 - w.z1); if (len < 0.01) continue;
        const horiz = w.side === 'n' || w.side === 's';
        const mx = (w.x1 + w.x2) / 2, mz = (w.z1 + w.z2) / 2;
        statics.add(mesh(unitBox(), wallMat, horiz ? len + 0.14 : 0.14, desc.wallHeight, horiz ? 0.14 : len + 0.14, mx, desc.wallHeight / 2, mz));
        statics.add(mesh(unitBox(), strip, horiz ? len + 0.16 : 0.05, 0.05, horiz ? 0.05 : len + 0.16, mx, desc.wallHeight + 0.02, mz));
        statics.add(mesh(unitBox(), strip, horiz ? len : 0.02, 0.03, horiz ? 0.02 : len, mx - (horiz ? 0 : (w.side === 'w' ? -0.08 : 0.08)), 0.08, mz - (horiz ? (w.side === 'n' ? -0.08 : 0.08) : 0)));
      }
      for (const d of desc.doors) {
        const horiz = d.side === 'n' || d.side === 's';
        for (const s of [-1, 1]) {
          const px = horiz ? d.x + s * d.width / 2 : d.x, pz = horiz ? d.z : d.z + s * d.width / 2;
          statics.add(mesh(roundBox(0.2), std('#1b2233', { rough: 0.3, metal: 0.6 }), 0.22, 2.6, 0.22, px, 1.3, pz));
          statics.add(mesh(unitBox(), strip, 0.05, 2.4, 0.05, px + (horiz ? 0 : d.normal.x * 0.12), 1.3, pz + (horiz ? d.normal.z * 0.12 : 0)));
        }
        statics.add(mesh(unitBox(), strip, horiz ? d.width + 0.22 : 0.12, 0.1, horiz ? 0.12 : d.width + 0.22, d.x, 2.62, d.z));
      }
    }
    // light pool and room light colour
    const lc = ap.lightTemp ? kelvinColor(ap.lightTemp) : accent;
    const poolMat = new THREE.MeshBasicMaterial({ map: radialTexture(), color: new THREE.Color(royal ? '#c0203c' : lc).multiplyScalar(royal ? 0.3 : 0.25 + ap.lighting * 0.35), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });
    ownMats.push(poolMat);
    const pool = mesh(unitPlane(), poolMat, room.w * 1.1, room.h * 1.1, 1, desc.cx, 0.02, desc.cz);
    pool.rotation.x = -Math.PI / 2;
    g.add(pool);
    // sign
    const sign = makeSprite(signTexture(room.name, desc.team, accent, royal), 5.6, 1.4);
    sign.position.set(desc.sign.x, desc.sign.y, desc.sign.z);
    g.add(sign);
    // wall displays that say what the team does
    const kinds = THEME_DISPLAYS[desc.theme];
    desc.displays.forEach((slot, i) => {
      const grp = new THREE.Group(); grp.position.set(slot.x, slot.y, slot.z); grp.rotation.y = slot.rotY;
      grp.add(mesh(roundBox(0.06), std('#0c111c', { rough: 0.3, metal: 0.6 }), slot.w + 0.16, slot.h + 0.16, 0.1, 0, 0, -0.03));
      grp.add(mesh(unitPlane(), screen(displayTexture(kinds[i % 2], display), 0.95), slot.w, slot.h, 1, 0, 0, 0.03));
      grp.add(mesh(unitBox(), glow(accent), slot.w + 0.16, 0.04, 0.04, 0, -slot.h / 2 - 0.1, 0.02));
      if (desc.bubble) for (const s of [-1, 1]) grp.add(mesh(unitCyl(6), std('#1b2233', { metal: 0.6 }), 0.04, slot.y - slot.h / 2, 0.04, s * slot.w * 0.35, -(slot.y - slot.h / 2) / 2 - slot.h / 2, -0.04));
      else for (const s of [-1, 1]) grp.add(mesh(unitBox(), std('#1b2233', { metal: 0.6 }), 0.08, slot.y - slot.h / 2 - desc.wallHeight + 0.1, 0.08, s * slot.w * 0.35, -slot.h / 2 - (slot.y - slot.h / 2 - desc.wallHeight) / 2, -0.06));
      statics.add(grp);
    });
    // throne room atmosphere: obsidian pillars with braziers at the corners
    if (royal) {
      const obs = std('#120810', { rough: 0.25, metal: 0.6 }), gold = std('#d4a84a', { metal: 0.95, rough: 0.22 });
      const inset = desc.bubble ? 0.4 : 0;
      for (const [px, pz] of [[room.x + inset, room.y + inset], [room.x + room.w - inset, room.y + inset], [room.x + inset, room.y + room.h - inset], [room.x + room.w - inset, room.y + room.h - inset]]) {
        statics.add(mesh(unitCyl(6), obs, 0.5, 3.2, 0.5, px, 1.6, pz));
        statics.add(mesh(unitCyl(6), gold, 0.62, 0.12, 0.62, px, 3.25, pz));
        statics.add(mesh(unitCyl(6), gold, 0.62, 0.12, 0.62, px, 0.06, pz));
        const flame = mesh(unitCone(8), glow('#ff4d2a', 0.85, true), 0.34, 0.6, 0.34, px, 3.6, pz);
        g.add(flame);
        const ph = px * 1.3 + pz;
        updaters.push((t) => { const s = 1 + Math.sin(t * 9 + ph) * 0.12 + Math.sin(t * 13.7 + ph) * 0.06; flame.scale.set(0.34 * s, 0.6 * (2 - s), 0.34 * s); });
      }
    }
    // furniture
    const interacts: InteractBox[] = [];
    const hasDevilBubble = room.furnitureIds.some((id) => (doc.furniture[id]?.type as string) === 'devil-bubble');
    const seed = (n: number) => ((n * 9301 + 49297) % 233280) / 233280;
    room.furnitureIds.forEach((fid, i) => {
      const f = doc.furniture[fid]; if (!f) return;
      const wr = furnitureWorldRect(doc, f);
      const meta = f.type;
      const wallItem = !!(FURNITURE_META as Record<string, { wall?: boolean } | undefined>)[meta]?.wall || WALL_KINDS.has(meta);
      let rotY: number, lw: number, ld: number;
      if (wallItem) {
        const side = nearestWall(room, wr);
        rotY = inwardRotY[side];
        const horiz = side === 'n' || side === 's';
        lw = horiz ? wr.w : wr.h; ld = horiz ? wr.h : wr.w;
      } else { rotY = -(f.rotation * Math.PI) / 180; lw = f.w; ld = f.h; }
      const built = buildFurniture(f, lw, ld, { theme: desc.theme, accent, display, material: ap.furnitureMaterial, reduced: false, seed: seed(i + 1), hasDevilBubble });
      const holder = new THREE.Group(); holder.position.set(wr.x + wr.w / 2, 0, wr.y + wr.h / 2); holder.rotation.y = rotY;
      holder.add(built.statics);
      statics.add(holder);
      if (built.dynamics.children.length) {
        const dh = new THREE.Group(); dh.position.copy(holder.position); dh.rotation.y = rotY; dh.add(built.dynamics); g.add(dh);
      }
      updaters.push(...built.updaters);
      for (const l of built.lights) { const pl = new THREE.PointLight(l.color, l.intensity, 9, 1.6); pl.position.set(holder.position.x, l.y, holder.position.z); g.add(pl); lights.push(pl); }
      if (built.interact) interacts.push({ box: new THREE.Box3(new THREE.Vector3(wr.x, 0, wr.y), new THREE.Vector3(wr.x + wr.w, Math.max(0.8, built.height), wr.y + wr.h)), info: built.interact });
    });
    mergeStatics(statics, g);
    disposeTree(statics);
    this.world.add(g);
    const agentsKey = room.assignedAgentIds.map((a) => doc.agents[a]?.identity.department).join('|');
    return { room, furn: room.furnitureIds.map((id) => doc.furniture[id]), preset: doc.settings.layoutPreset, agentsKey, group: g, updaters, interacts, desc, ownMats, lights };
  }

  private buildTube(doc: OfficeDoc, c: Corridor): TubeRec | null {
    const desc = describeTube(doc, c);
    if (!desc) return null;
    const g = new THREE.Group(); g.name = `tube:${c.name}`;
    const updaters: Updater[] = [];
    const curve = tubeCurve(desc.points, desc.centerY, desc.radius);
    const len = curve.getLength();
    const warn = c.blocked || c.status === 'broken' ? '#ff5d73' : c.status === 'warning' ? '#ffb347' : null;
    const glass = fresnel({ color: warn ?? '#3aa8ff', rim: warn ?? '#c8f8ff', base: 0.03, rimAlpha: 0.34, power: 2.6, irid: warn ? 0.1 : 1 });
    const tube = new THREE.Mesh(new THREE.TubeGeometry(curve, Math.max(12, Math.ceil(len * 3)), desc.radius, 28, false), glass);
    tube.renderOrder = 3;
    g.add(tube);
    const samples = Math.max(8, Math.ceil(len * 2));
    const deck = new THREE.Mesh(ribbon(curve, 0, desc.floorWidth / 2, 0.005, samples), std('#0b1322', { rough: 0.25, metal: 0.55, opacity: 0.92 }));
    deck.renderOrder = 1;
    g.add(deck);
    g.add(new THREE.Mesh(ribbon(curve, desc.floorWidth / 2 - 0.12, desc.floorWidth / 2 - 0.04, 0.012, samples), glow(warn ?? '#7cf7ff', 0.95)));
    g.add(new THREE.Mesh(ribbon(curve, 0.02, 0.05, 0.012, samples), glow(warn ?? '#7cf7ff', 0.35)));
    // ends: glowing entrance rings, signs both ways, junction bulbs
    desc.ends.forEach((e, i) => {
      const other = desc.ends[1 - i];
      const room = e.roomId ? doc.rooms[e.roomId] : undefined;
      const acc = room?.appearance.accent ?? '#7cf7ff';
      const p = new THREE.Vector3(e.x, desc.centerY, e.z);
      if (e.kind === 'door') {
        const ringM = mesh(torus(0.022), glow(acc), desc.radius * 2.04, desc.radius * 2.04, desc.radius * 2.04, p.x, p.y, p.z);
        ringM.lookAt(p.x + e.dir.x, p.y, p.z + e.dir.z);
        g.add(ringM);
        const collar = mesh(torus(0.04), std('#1b2233', { rough: 0.3, metal: 0.7 }), desc.radius * 2.08, desc.radius * 2.08, desc.radius * 2.08, p.x - e.dir.x * 0.12, p.y, p.z - e.dir.z * 0.12);
        collar.lookAt(p.x + e.dir.x, p.y, p.z + e.dir.z);
        g.add(collar);
        const sy = desc.centerY + desc.radius + 0.5;
        const inSign = signPlane(doorSignTexture(e.label, acc), 2.6, 0.57);
        inSign.position.set(p.x - e.dir.x * 0.3, sy, p.z - e.dir.z * 0.3); inSign.lookAt(inSign.position.x - e.dir.x, sy, inSign.position.z - e.dir.z);
        const outLabel = other.kind === 'door' ? other.label : 'Tube network';
        const outSign = signPlane(doorSignTexture(outLabel, '#7cf7ff'), 2.6, 0.57);
        outSign.position.set(p.x - e.dir.x * 0.25, sy, p.z - e.dir.z * 0.25); outSign.lookAt(outSign.position.x + e.dir.x, sy, outSign.position.z + e.dir.z);
        g.add(inSign, outSign);
        // floor arrow pad at the mouth
        const pad = mesh(unitPlane(), glow(acc, 0.5, true), desc.floorWidth * 0.8, 0.5, 1, p.x - e.dir.x * 0.6, 0.015, p.z - e.dir.z * 0.6);
        pad.rotation.x = -Math.PI / 2; pad.rotation.z = Math.atan2(e.dir.x, -e.dir.z);
        g.add(pad);
      } else {
        g.add(mesh(unitSphere(), glass, desc.radius * 2.15, desc.radius * 2.15, desc.radius * 2.15, p.x, p.y, p.z));
        g.add(mesh(torus(0.05), glow('#7cf7ff', 0.8), desc.radius * 2.0, desc.radius * 2.0, 1, p.x, 0.02, p.z).rotateX(Math.PI / 2));
      }
    });
    // light pulses travelling through the tube
    if (!c.blocked) {
      const pulses: THREE.Mesh[] = [];
      const n = Math.max(1, Math.min(4, Math.round(len / 8)));
      for (let i = 0; i < n; i++) { const m = mesh(torus(0.02), glow(warn ?? '#bdf3ff', 0.3, true, 1), desc.radius * 1.9, desc.radius * 1.9, desc.radius * 1.9); g.add(m); pulses.push(m); }
      const tmp = new THREE.Vector3();
      updaters.push((t) => pulses.forEach((m, i) => {
        const u = Math.min(0.999, Math.max(0.001, ((t * 3.2) / len + i / pulses.length) % 1));
        curve.getPointAt(u, m.position); curve.getTangentAt(u, tmp);
        m.lookAt(m.position.x + tmp.x, m.position.y + tmp.y, m.position.z + tmp.z);
      }));
    }
    this.world.add(g);
    return { c, ends: this.endRooms(doc, c), group: g, desc, updaters };
  }

  private buildChar(app: Appearance, name: string, id: string, you: boolean): CharRec {
    const root = new THREE.Group();
    const char = buildCharacter(app, id);
    root.add(char);
    const h = (char.userData.height as number) ?? 1.6;
    const label = makeSprite(nameTexture(name, 'idle', app.accent, you), 1.5, 0.33);
    label.position.y = h + 0.42;
    root.add(label);
    const disc = mesh(unitCyl(24), glow(app.accent, 0.55, true), 0.9, 0.04, 0.9, 0, 0.04, 0);
    disc.visible = false;
    root.add(disc);
    root.visible = false;
    this.world.add(root);
    return { app, root, char, label, labelKey: `${name}|idle`, disc, pos: new THREE.Vector3(), yaw: 0, pose: 'idle', height: h, seen: false };
  }

  // ---------- per frame ----------

  /** Room descriptors (for HUD and the tube map). */
  roomDescs(): RoomDesc[] { return [...this.rooms.values()].map((r) => r.desc); }
  tubeDescs(): TubeDesc[] { return [...this.tubes.values()].map((t) => t.desc); }
  get playerHeight() { return this.player?.height ?? 1.6; }

  private updateLabel(rec: CharRec, name: string, status: string, you: boolean) {
    const k = `${name}|${status}`;
    if (k === rec.labelKey) return;
    rec.labelKey = k;
    const tex = rec.label.material.map as THREE.CanvasTexture;
    const cv = tex.userData.canvas as HTMLCanvasElement | undefined;
    if (!cv) return;
    drawName(cv.getContext('2d')!, cv.width, cv.height, name, status, rec.app.accent, you);
    tex.needsUpdate = true;
  }

  frame(dt: number, t: number, rt: RuntimeState, ctrl: PlayerController, reduced: boolean) {
    const doc = this.doc;
    tickShared(reduced ? 0 : t);
    blinkLeds(t, reduced);
    if (!reduced) for (const r of this.rooms.values()) for (const u of r.updaters) u(t, dt);
    if (!reduced) for (const tb of this.tubes.values()) for (const u of tb.updaters) u(t, dt);
    const cam = this.camera.position;
    // agents
    const kPos = 1 - Math.exp(-dt * 9);
    for (const [id, rec] of this.agents) {
      const a: Agent | undefined = doc.agents[id];
      const r = rt.agents[id];
      if (!a || !r) { rec.root.visible = false; continue; }
      rec.root.visible = true;
      const tx = r.pos.x + 0.5, tz = r.pos.y + 0.5;
      const cell = key(Math.round(r.pos.x), Math.round(r.pos.y));
      const tubeHere = this.nav.walkable.has(cell) && this.nav.region.get(cell) === '';
      const ty = tubeHere ? 0.14 + (reduced ? 0 : Math.sin(t * 2 + rec.yaw) * 0.03) : 0;
      const prevX = rec.pos.x, prevZ = rec.pos.z;
      if (!rec.seen || Math.hypot(tx - rec.pos.x, tz - rec.pos.z) > 4) { rec.pos.set(tx, ty, tz); rec.seen = true; }
      else { rec.pos.x += (tx - rec.pos.x) * kPos; rec.pos.z += (tz - rec.pos.z) * kPos; rec.pos.y += (ty - rec.pos.y) * kPos; }
      const vx = rec.pos.x - prevX, vz = rec.pos.z - prevZ;
      const moving = Math.hypot(vx, vz) > 0.25 * dt;
      let want = rec.yaw;
      if (moving) want = Math.atan2(vx, vz);
      else if (r.status === 'working' && r.destination?.workstationId && doc.furniture[r.destination.workstationId]) {
        const wr = furnitureWorldRect(doc, doc.furniture[r.destination.workstationId]);
        want = Math.atan2(wr.x + wr.w / 2 - rec.pos.x, wr.y + wr.h / 2 - rec.pos.z);
      } else want = { up: Math.PI, down: 0, left: -Math.PI / 2, right: Math.PI / 2 }[r.heading] ?? 0;
      let d = (want - rec.yaw) % (Math.PI * 2); if (d > Math.PI) d -= Math.PI * 2; if (d < -Math.PI) d += Math.PI * 2;
      rec.yaw += d * (1 - Math.exp(-dt * 8));
      rec.root.position.copy(rec.pos);
      rec.char.rotation.y = rec.yaw;
      rec.disc.visible = tubeHere;
      const pose = poseForStatus(r.status, moving, tubeHere);
      animateCharacter(rec.char, pose, t, { blend: 1 - Math.exp(-dt * 10), reduced });
      const dist = cam.distanceTo(rec.pos);
      rec.char.visible = dist < 70;
      const face = rec.char.getObjectByName('face'); if (face) face.visible = dist < 28;
      rec.label.visible = dist < 18;
      if (rec.label.visible) this.updateLabel(rec, a.identity.name, r.status, false);
    }
    // player avatar
    if (this.player) {
      const p = this.player;
      p.root.visible = ctrl.mode === 'third';
      p.pos.set(ctrl.pos.x, ctrl.y + (ctrl.tube ? 0.14 : 0), ctrl.pos.z);
      p.root.position.copy(p.pos);
      p.char.rotation.y = ctrl.facing;
      p.disc.visible = ctrl.tube;
      p.label.visible = false;
      const pose: CharacterPose = ctrl.glide ? 'ride' : ctrl.moving ? (ctrl.tube ? 'ride' : ctrl.running ? 'run' : 'walk') : 'idle';
      animateCharacter(p.char, pose, t, { blend: 1 - Math.exp(-dt * 12), reduced });
    }
    // room light follows the avatar, tinted by the room's accent; the throne room darkens the fog
    const room = roomAtWorld(doc, ctrl.pos.x, ctrl.pos.z);
    this.currentRoomId = room?.id ?? null;
    const rec = room ? this.rooms.get(room.id) : undefined;
    const royal = rec?.desc.theme === 'royal';
    this.roomLight.color.lerp(new THREE.Color(royal ? '#ff3355' : room ? room.appearance.accent : '#7cf7ff'), 1 - Math.exp(-dt * 3));
    this.roomLight.position.set(ctrl.pos.x, 4.2, ctrl.pos.z + 1);
    this.roomLight.intensity = 2 + (room ? room.appearance.lighting * 3 : 1);
    this.fogTarget.set(royal ? '#16050d' : '#05070f');
    const fog = this.scene.fog as THREE.FogExp2;
    fog.color.lerp(this.fogTarget, 1 - Math.exp(-dt * 2));
    (this.scene.background as THREE.Color).copy(fog.color);
    this.hemi.intensity += ((royal ? 0.5 : 0.9) - this.hemi.intensity) * (1 - Math.exp(-dt * 2));
    // animated screens near the avatar, a few times a second
    this.liveTimer += dt;
    if (this.liveTimer > (reduced ? 2 : 0.25)) { this.liveTimer = 0; updateLiveTextures(t); }
    if (this.stars && !reduced) this.stars.rotation.y = t * 0.002;
    if (this.bloomOn && this.composer) this.composer.render(dt);
    else this.renderer.render(this.scene, this.camera);
  }

  /** What the ray points at: furniture with a function, or an agent (nearest hit). */
  pick(ray: THREE.Ray, maxDist: number): Target | null {
    let best: Target | null = null;
    const hit = new THREE.Vector3();
    for (const r of this.rooms.values()) for (const ib of r.interacts) {
      if (!ray.intersectBox(ib.box, hit)) continue;
      const d = hit.distanceTo(ray.origin);
      if (d <= maxDist && (!best || d < best.dist)) best = { ...ib.info, dist: d };
    }
    const box = new THREE.Box3();
    for (const [id, rec] of this.agents) {
      if (!rec.root.visible) continue;
      box.min.set(rec.pos.x - 0.35, rec.pos.y, rec.pos.z - 0.35); box.max.set(rec.pos.x + 0.35, rec.pos.y + rec.height, rec.pos.z + 0.35);
      if (!ray.intersectBox(box, hit)) continue;
      const d = hit.distanceTo(ray.origin);
      const a = this.doc.agents[id];
      if (a && d <= maxDist && (!best || d < best.dist + 0.3)) best = { kind: 'agent', id, label: a.identity.name, verb: 'open profile', dist: d };
    }
    return best;
  }

  /** Nearest interactable in front of the avatar (used when nothing is under the cursor). */
  nearby(pos: XZ, dir: XZ, radius = 2.4): Target | null {
    let best: Target | null = null; let bestScore = Infinity;
    const consider = (cx: number, cz: number, halfW: number, halfD: number, info: Omit<Target, 'dist'>) => {
      const dx = Math.max(Math.abs(cx - pos.x) - halfW, 0), dz = Math.max(Math.abs(cz - pos.z) - halfD, 0);
      const d = Math.hypot(dx, dz);
      if (d > radius) return;
      const vx = cx - pos.x, vz = cz - pos.z, l = Math.hypot(vx, vz) || 1;
      const facing = (vx * dir.x + vz * dir.z) / l;
      if (facing < -0.1 && d > 0.6) return;
      const score = d - facing * 0.8;
      if (score < bestScore) { bestScore = score; best = { ...info, dist: d }; }
    };
    for (const r of this.rooms.values()) for (const ib of r.interacts) {
      const b = ib.box;
      consider((b.min.x + b.max.x) / 2, (b.min.z + b.max.z) / 2, (b.max.x - b.min.x) / 2, (b.max.z - b.min.z) / 2, ib.info);
    }
    for (const [id, rec] of this.agents) {
      const a = this.doc.agents[id];
      if (a && rec.root.visible) consider(rec.pos.x, rec.pos.z, 0.3, 0.3, { kind: 'agent', id, label: a.identity.name, verb: 'open profile' });
    }
    return best;
  }

  /** Agent dots for the minimap. */
  agentPositions(): { id: string; x: number; z: number; color: string }[] {
    return [...this.agents.entries()].filter(([, r]) => r.root.visible).map(([id, r]) => ({ id, x: r.pos.x, z: r.pos.z, color: r.app.accent }));
  }

  dispose() {
    for (const r of this.rooms.values()) this.disposeRoom(r);
    for (const t of this.tubes.values()) disposeTree(t.group);
    for (const a of this.agents.values()) disposeTree(a.root);
    if (this.player) disposeTree(this.player.root);
    this.rooms.clear(); this.tubes.clear(); this.agents.clear();
    if (this.ground) { this.ground.geometry.dispose(); const m = this.ground.material as THREE.MeshBasicMaterial; m.map?.dispose(); m.dispose(); }
    if (this.stars) { this.stars.geometry.dispose(); (this.stars.material as THREE.Material).dispose(); }
    this.composer?.dispose();
    disposeTextures(); disposeFloorTextures();
    releaseShared();
  }
}
