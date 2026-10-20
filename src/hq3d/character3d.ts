// Original game-inspired 3D characters built from an Appearance: four body
// styles (blocky, heroic, chibi, sleek), modelled faces with expressions, 3D
// hair, layered outfits and accessories. Pure three.js geometry (no canvas), so
// characters can also be built in tests. Shared unit geometries and cached
// materials keep dozens of characters cheap.
import * as THREE from 'three';
import type { Appearance, Expression } from '../model/types';
import { shade } from '../characters/color';
import { bodyDims, type BodyDims } from './proportions';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { frustum, glow, mesh, roundBox, shared, sphereCap, std, torus, unitBox, unitCapsule, unitCone, unitCyl, unitSphere } from './materials';

export type CharacterPose = 'idle' | 'walk' | 'run' | 'work' | 'think' | 'talk' | 'ride' | 'wave' | 'alert' | 'paused';

export interface Rig {
  dims: BodyDims; seed: number;
  body: THREE.Group; hips: THREE.Group; torso: THREE.Group; neck: THREE.Group; head: THREE.Group; face: THREE.Group;
  armL: THREE.Group; armR: THREE.Group; elbowL: THREE.Group; elbowR: THREE.Group;
  legL: THREE.Group; legR: THREE.Group; kneeL: THREE.Group; kneeR: THREE.Group;
  eyes: { o: THREE.Object3D; sy: number }[]; mouth: THREE.Object3D | null;
  idlePose: Appearance['idlePose']; speed: number;
}

const rigs = new WeakMap<THREE.Object3D, Rig>();
export const getRig = (g: THREE.Object3D) => rigs.get(g);

const isBoxHead = (a: Appearance, d: BodyDims) => d.blocky || a.faceShape === 'square';

function hashSeed(s: string): number { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return ((h >>> 0) % 1000) / 1000; }

/** Rounded box tapered towards the bottom: a torso with a waist. */
function torsoGeo(waist: number, r: number) {
  return shared(`torso|${waist.toFixed(2)}|${r}`, () => {
    const gq = new RoundedBoxGeometry(1, 1, 1, 4, r);
    const p = gq.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < p.count; i++) {
      const t = p.getY(i) + 0.5;
      const k = waist + (1 - waist) * Math.min(1, t * 1.25);
      p.setX(i, p.getX(i) * k);
      p.setZ(i, p.getZ(i) * (0.9 + 0.1 * t));
    }
    gq.computeVertexNormals();
    return gq;
  });
}
const halfSphere = () => shared('halfsph', () => new THREE.SphereGeometry(0.5, 20, 14, 0, Math.PI));
const squareRing = () => shared('sqring', () => { const r = new THREE.RingGeometry(0.4, 0.5, 4, 1, Math.PI / 4); return r; });

// ---------- face ----------

interface Head { W: number; H: number; D: number; box: boolean; surf: (x: number, y: number) => number }

function makeHead(a: Appearance, d: BodyDims): Head {
  const box = isBoxHead(a, d);
  const W = d.headW * (a.faceShape === 'oval' && !box ? 0.94 : 1), H = d.headH * (a.faceShape === 'oval' && !box ? 1.04 : 1), D = d.headD;
  const surf = box
    ? (x: number, y: number) => { const ex = Math.max(0, Math.abs(x) - W * 0.34) / (W * 0.16), ey = Math.max(0, Math.abs(y) - H * 0.34) / (H * 0.16); return D / 2 - D * 0.08 * Math.min(1, ex * ex + ey * ey); }
    : (x: number, y: number) => (D / 2) * Math.sqrt(Math.max(0.04, 1 - (2 * x / W) ** 2 - (2 * y / H) ** 2));
  return { W, H, D, box, surf };
}

/** Flat shape bent onto the face surface so features hug the head. */
function faceShape(shape: THREE.Shape, h: Head, cx: number, cy: number, lift: number, mat: THREE.Material, rot = 0): THREE.Mesh {
  const geo = new THREE.ShapeGeometry(shape, 10);
  const p = geo.attributes.position as THREE.BufferAttribute;
  const c = Math.cos(rot), s = Math.sin(rot);
  for (let i = 0; i < p.count; i++) {
    const lx = p.getX(i), ly = p.getY(i);
    const x = cx + lx * c - ly * s, y = cy + lx * s + ly * c;
    p.setXYZ(i, x, y, h.surf(x, y) + lift);
  }
  geo.computeVertexNormals();
  return new THREE.Mesh(geo, mat);
}

function ellipseShape(rx: number, ry: number): THREE.Shape { const s = new THREE.Shape(); s.absellipse(0, 0, rx, ry, 0, Math.PI * 2, false, 0); return s; }
function rectShape(w: number, hh: number): THREE.Shape { const s = new THREE.Shape(); s.moveTo(-w / 2, -hh / 2); s.lineTo(w / 2, -hh / 2); s.lineTo(w / 2, hh / 2); s.lineTo(-w / 2, hh / 2); s.closePath(); return s; }

function mouthShapes(expr: Expression, mw: number, e: number): { mouth: THREE.Shape; teeth?: THREE.Shape; tongue?: THREE.Shape } {
  const s = new THREE.Shape();
  const hw = mw / 2;
  switch (expr) {
    case 'smile': {
      s.moveTo(-hw, e * 0.12); s.quadraticCurveTo(0, -e * 1.25, hw, e * 0.12); s.quadraticCurveTo(0, -e * 0.55, -hw, e * 0.12);
      return { mouth: s };
    }
    case 'grin': {
      s.moveTo(-hw, e * 0.1); s.quadraticCurveTo(0, e * 0.02, hw, e * 0.1); s.quadraticCurveTo(hw * 0.95, -e * 1.6, 0, -e * 1.55); s.quadraticCurveTo(-hw * 0.95, -e * 1.6, -hw, e * 0.1);
      const t = new THREE.Shape(); t.moveTo(-hw * 0.82, e * 0.02); t.quadraticCurveTo(0, -e * 0.06, hw * 0.82, e * 0.02); t.lineTo(hw * 0.7, -e * 0.38); t.quadraticCurveTo(0, -e * 0.48, -hw * 0.7, -e * 0.38); t.closePath();
      const tg = ellipseShape(hw * 0.45, e * 0.32);
      return { mouth: s, teeth: t, tongue: tg };
    }
    case 'surprised': return { mouth: ellipseShape(hw * 0.42, e * 0.7), tongue: ellipseShape(hw * 0.26, e * 0.25) };
    case 'smirk': {
      s.moveTo(-hw * 0.8, -e * 0.05); s.quadraticCurveTo(hw * 0.2, -e * 0.85, hw, e * 0.35); s.quadraticCurveTo(hw * 0.2, -e * 0.42, -hw * 0.8, -e * 0.05);
      return { mouth: s };
    }
    case 'focused': return { mouth: rectShape(mw * 0.55, e * 0.2) };
    case 'determined': {
      s.moveTo(-hw * 0.8, -e * 0.2); s.quadraticCurveTo(0, e * 0.25, hw * 0.8, -e * 0.2); s.quadraticCurveTo(0, e * 0.02, -hw * 0.8, -e * 0.2);
      return { mouth: s };
    }
    default: {
      s.moveTo(-hw * 0.7, 0); s.quadraticCurveTo(0, -e * 0.3, hw * 0.7, 0); s.quadraticCurveTo(0, -e * 0.08, -hw * 0.7, 0);
      return { mouth: s };
    }
  }
}

function buildFace(a: Appearance, d: BodyDims, h: Head, face: THREE.Group, rig: Pick<Rig, 'eyes' | 'mouth'>) {
  const expr: Expression = a.expression ?? 'neutral';
  const chibi = d.style === 'chibi';
  const E = Math.min(h.W, h.H) * (chibi ? 0.155 : d.blocky ? 0.13 : 0.14);
  const eyeY = h.H * (chibi ? -0.02 : 0.05), eyeX = h.W * (chibi ? 0.22 : 0.2);
  const mouthY = -h.H * (chibi ? 0.22 : 0.22);
  const skin = a.skinTone;
  const robot = a.robotic;
  const dark = std('#15121a', { rough: 0.3 });
  const white = std('#f7f7fb', { rough: 0.25 });
  const shine = glow('#ffffff');
  const iris = a.effects.eyeGlow || robot === 'full' ? glow(a.eyeColor) : std(a.eyeColor, { rough: 0.25 });
  const squint = expr === 'focused' || expr === 'determined' ? 0.62 : expr === 'surprised' ? 1.22 : expr === 'smile' || expr === 'grin' ? 0.86 : 1;

  // eyes
  if (a.eyeStyle === 'visor' || robot === 'full') {
    const v = mesh(roundBox(0.3), glow(a.accent), h.W * 0.8, E * 0.75, E * 0.4, 0, eyeY, h.surf(0, eyeY) - E * 0.05);
    face.add(v); rig.eyes.push({ o: v, sy: v.scale.y });
  } else {
    for (const side of [-1, 1]) {
      const ex = side * eyeX;
      const g = new THREE.Group();
      g.position.set(ex, eyeY, h.surf(ex, eyeY) - E * 0.12);
      if (robot === 'eyepiece' && side === 1) {
        g.add(mesh(unitCyl(18), std('#5b6268', { metal: 0.8, rough: 0.3 }), E * 1.9, E * 0.5, E * 1.9, 0, 0, E * 0.15).rotateX(Math.PI / 2));
        g.add(mesh(unitCyl(18), glow(a.accent), E * 1.2, E * 0.55, E * 1.2, 0, 0, E * 0.22).rotateX(Math.PI / 2));
      } else if (a.eyeStyle === 'dot') {
        g.add(mesh(unitSphere(), dark, E * 0.62, E * 0.85, E * 0.36));
        g.add(mesh(unitSphere(0), shine, E * 0.2, E * 0.2, E * 0.1, E * 0.12, E * 0.18, E * 0.16));
      } else {
        const wide = a.eyeStyle === 'wide' || chibi;
        g.add(mesh(unitSphere(), white, E * (wide ? 1.3 : 1.25), E * (wide ? 1.25 : 0.82), E * 0.42));
        const ir = E * (wide ? 0.82 : 0.64);
        g.add(mesh(unitSphere(), iris, ir, ir, E * 0.26, 0, -E * 0.02, E * 0.14));
        g.add(mesh(unitSphere(), dark, ir * 0.5, ir * 0.5, E * 0.18, 0, -E * 0.02, E * 0.2));
        g.add(mesh(unitSphere(0), shine, E * 0.22, E * 0.22, E * 0.08, E * 0.16, E * 0.16, E * 0.25));
      }
      g.scale.y = squint;
      face.add(g); rig.eyes.push({ o: g, sy: squint });
    }
  }

  // brows
  if (a.brows !== 'none' && a.eyeStyle !== 'visor' && robot !== 'full') {
    const bmat = std(a.hairStyle === 'bald' ? shade(skin, -0.45) : shade(a.hairColor, -0.15), { rough: 0.8 });
    const thick = a.brows === 'thick' || a.brows === 'angled' ? 0.34 : 0.2;
    const baseTilt = a.brows === 'angled' ? 0.22 : 0;
    const exprTilt: Record<Expression, number> = { neutral: 0, smile: -0.06, grin: -0.1, focused: 0.2, surprised: -0.22, smirk: 0.05, determined: 0.34 };
    const raise = expr === 'surprised' ? E * 0.45 : expr === 'determined' || expr === 'focused' ? -E * 0.12 : 0;
    for (const side of [-1, 1]) {
      const bx = side * eyeX, by = eyeY + E * (a.eyeStyle === 'wide' || chibi ? 1.2 : 1.0) + raise + (expr === 'smirk' && side === 1 ? E * 0.3 : 0);
      const b = mesh(roundBox(0.4), bmat, E * 1.45, E * thick, E * 0.3, bx, by, h.surf(bx, by) + E * 0.02);
      b.rotation.z = side * (baseTilt + exprTilt[expr]) * (side === 1 && expr === 'smirk' ? -1.5 : 1);
      b.rotation.y = -side * 0.18;
      face.add(b);
    }
  }

  // nose
  const nose = a.nose ?? (d.blocky ? 'none' : 'button');
  const ny = (eyeY + mouthY) / 2 - E * 0.1;
  const nmat = std(shade(skin, -0.07), { rough: 0.55 });
  if (robot !== 'full') {
    if (nose === 'button') face.add(mesh(unitSphere(), nmat, E * 0.55, E * 0.48, E * 0.5, 0, ny, h.surf(0, ny) - E * 0.05));
    if (nose === 'straight') face.add(mesh(unitCapsule(), nmat, E * 0.36, E * 0.42, E * 0.5, 0, ny + E * 0.2, h.surf(0, ny) - E * 0.05));
    if (nose === 'broad') face.add(mesh(unitSphere(), nmat, E * 0.95, E * 0.55, E * 0.55, 0, ny, h.surf(0, ny) - E * 0.08));
  }

  // mouth
  const mw = h.W * (a.mouth === 'wide' ? 0.36 : a.mouth === 'small' ? 0.2 : a.mouth === 'full' ? 0.28 : 0.27) * (chibi ? 0.85 : 1);
  if (robot !== 'full' && a.headwear !== 'mask') {
    const shapes = mouthShapes(expr, mw, E);
    const mg = new THREE.Group();
    mg.position.y = mouthY; // children carry -mouthY so talking scales the mouth about its own centre
    if (a.mouth === 'full') {
      const lip = faceShape(ellipseShape(mw * 0.56, E * 0.55), h, 0, mouthY - E * 0.25, 0.002, std(shade(skin, -0.22), { rough: 0.45 }));
      mg.add(lip);
    }
    mg.add(faceShape(shapes.mouth, h, 0, mouthY, 0.004, std('#3a1418', { rough: 0.5 })));
    if (shapes.tongue) mg.add(faceShape(shapes.tongue, h, 0, mouthY - E * (expr === 'grin' ? 1.0 : 0.25), 0.005, std('#d65a6a', { rough: 0.5 })));
    if (shapes.teeth) mg.add(faceShape(shapes.teeth, h, 0, mouthY, 0.006, white));
    for (const c of mg.children) c.position.y = -mouthY;
    face.add(mg);
    rig.mouth = mg;
  }

  // cheeks
  if (a.cheeks === 'blush') for (const side of [-1, 1]) face.add(faceShape(ellipseShape(E * 0.62, E * 0.36), h, side * h.W * 0.29, mouthY + E * 0.75, 0.003, std('#ff6f91', { opacity: 0.42, rough: 0.6 })));
  if (a.cheeks === 'dimples') for (const side of [-1, 1]) face.add(faceShape(ellipseShape(E * 0.12, E * 0.16), h, side * (mw / 2 + E * 0.3), mouthY - E * 0.1, 0.003, std(shade(skin, -0.3), { opacity: 0.7 })));

  // facial hair
  const hairMat = std(a.hairColor, { rough: 0.8 });
  if (a.facialHair === 'beard') {
    face.add(mesh(unitSphere(), hairMat, h.W * 0.9, h.H * 0.42, h.D * 0.82, 0, -h.H * 0.38, h.D * 0.12));
    for (const side of [-1, 1]) face.add(mesh(roundBox(0.4), hairMat, h.W * 0.1, h.H * 0.42, h.D * 0.4, side * h.W * 0.44, -h.H * 0.08, 0));
  }
  if (a.facialHair === 'mustache' || a.facialHair === 'beard') {
    const my = mouthY + E * 0.55;
    const m = mesh(unitCapsule(), hairMat, E * 0.38, mw * 0.36, E * 0.36, 0, my, h.surf(0, my) + E * 0.05);
    m.rotation.z = Math.PI / 2;
    face.add(m);
  }
  if (a.facialHair === 'stubble') face.add(faceShape(ellipseShape(h.W * 0.34, h.H * 0.2), h, 0, -h.H * 0.3, 0.002, std(shade(a.hairColor, -0.1), { opacity: 0.32, rough: 0.9 })));

  // markings
  if (a.faceMarkings === 'freckles') {
    const fm = std(shade(skin, -0.32), { rough: 0.7 });
    for (const [fx, fy] of [[0.24, 0.0], [0.3, -0.06], [0.2, -0.08], [-0.24, 0.0], [-0.3, -0.06], [-0.2, -0.08]] as const) face.add(faceShape(ellipseShape(E * 0.09, E * 0.09), h, h.W * fx, h.H * fy - E * 0.2, 0.003, fm));
  }
  if (a.faceMarkings === 'scar') face.add(faceShape(rectShape(E * 0.16, E * 1.9), h, eyeX + E * 0.2, eyeY + E * 0.3, 0.003, std(shade(skin, -0.28), { rough: 0.5 }), 0.35));
  if (a.faceMarkings === 'tattoo') {
    const t = new THREE.Shape(); t.moveTo(-E * 0.4, E * 0.3); t.lineTo(0, -E * 0.3); t.lineTo(E * 0.4, E * 0.3); t.lineTo(E * 0.2, E * 0.3); t.lineTo(0, 0); t.lineTo(-E * 0.2, E * 0.3); t.closePath();
    face.add(faceShape(t, h, -h.W * 0.27, mouthY + E * 0.7, 0.003, std(a.accent, { rough: 0.5 })));
  }
  if (a.faceMarkings === 'circuit') {
    const cm = glow(a.accent);
    face.add(faceShape(rectShape(E * 0.08, E * 1.4), h, h.W * 0.3, eyeY - E * 1.3, 0.004, cm));
    face.add(faceShape(rectShape(E * 0.9, E * 0.08), h, h.W * 0.3 - E * 0.45, eyeY - E * 2.0, 0.004, cm));
    face.add(faceShape(ellipseShape(E * 0.14, E * 0.14), h, h.W * 0.3, eyeY - E * 0.55, 0.004, cm));
  }
  if (robot === 'jaw') face.add(mesh(roundBox(0.3), std('#6b7480', { metal: 0.8, rough: 0.3 }), h.W * 0.78, h.H * 0.2, h.D * 0.72, 0, -h.H * 0.38, h.D * 0.1));
  if (robot === 'half-face') {
    const hf = mesh(halfSphere(), std('#7c8794', { metal: 0.85, rough: 0.28 }), h.W * 1.03, h.H * 1.02, h.D * 1.03);
    hf.rotation.y = -Math.PI / 2; // covers the right half (+x)
    face.add(hf);
    face.add(mesh(unitSphere(), glow(a.accent), E * 0.7, E * 0.7, E * 0.3, eyeX, eyeY, h.surf(eyeX, eyeY) + E * 0.12));
  }
}

// ---------- hair ----------

function buildHair(a: Appearance, h: Head, head: THREE.Group, covered: boolean) {
  const style = a.hairStyle;
  if (style === 'bald') return;
  const m = std(a.hairColor, { rough: 0.72 });
  const hl = std(shade(a.hairColor, 0.12), { rough: 0.65 });
  const { W, H, D } = h;
  const top = (scale: number, theta = Math.PI * 0.52, y = H * 0.02) => {
    if (covered) return;
    if (h.box) head.add(mesh(roundBox(0.25), m, W * (scale + 0.02), H * 0.36, D * (scale + 0.02), 0, H * 0.34 + y, -D * 0.02));
    else head.add(mesh(sphereCap(theta), m, W * scale, H * scale, D * scale, 0, y, -D * 0.02));
  };
  const backPanel = (len: number) => head.add(mesh(roundBox(0.4), m, W * 0.96, len, D * 0.3, 0, H * 0.15 - len / 2, -D * 0.36));
  switch (style) {
    case 'buzz': top(1.035, Math.PI * 0.5); break;
    case 'short':
      top(1.08);
      if (!covered) head.add(mesh(unitSphere(), m, W * 0.8, H * 0.22, D * 0.4, 0, H * 0.34, D * 0.3));
      break;
    case 'long':
      top(1.08);
      backPanel(H * 1.15);
      for (const s of [-1, 1]) head.add(mesh(roundBox(0.45), m, W * 0.16, H * 0.95, D * 0.5, s * W * 0.47, -H * 0.12, -D * 0.06));
      break;
    case 'bun': top(1.06); head.add(mesh(unitSphere(), m, W * 0.42, W * 0.42, W * 0.42, 0, H * 0.5, -D * 0.35)); break;
    case 'ponytail': {
      top(1.06);
      head.add(mesh(torus(0.25), std(a.accent, { rough: 0.5 }), W * 0.18, W * 0.18, W * 0.18, 0, H * 0.18, -D * 0.52));
      const tail = mesh(unitCapsule(), m, W * 0.24, H * 0.42, W * 0.24, 0, -H * 0.12, -D * 0.62);
      tail.rotation.x = 0.35; head.add(tail);
      break;
    }
    case 'mohawk':
      top(1.02, Math.PI * 0.5);
      for (let i = 0; i < 5; i++) {
        const t = (i / 4) * 1.6 - 0.3;
        const c = mesh(unitCone(8), m, W * 0.16, H * 0.42, D * 0.22, 0, H * 0.48 * Math.cos(t * 0.9) + H * 0.05, D * 0.5 * Math.sin(-t + 0.5) * 0.9);
        c.rotation.x = -(t - 0.5) * 0.9; head.add(c);
      }
      break;
    case 'curly':
      for (let i = 0; i < 18; i++) {
        const phi = (i / 18) * Math.PI * 2 * 2.618, th = Math.acos(1 - (i + 0.5) / 18 * 1.15);
        if (covered && th < 1.1) continue;
        const x = Math.sin(th) * Math.cos(phi), y = Math.cos(th), z = Math.sin(th) * Math.sin(phi);
        if (z > 0.55 && y < 0.55) continue;
        head.add(mesh(unitSphere(0), i % 3 ? m : hl, W * 0.34, W * 0.34, W * 0.34, x * W * 0.5, y * H * 0.5 + H * 0.06, z * D * 0.5 - D * 0.04));
      }
      break;
    case 'spiky':
      top(1.06);
      if (!covered) for (let i = 0; i < 9; i++) {
        const ang = (i / 9) * Math.PI * 2;
        const c = mesh(unitCone(6), i % 2 ? m : hl, W * 0.2, H * 0.48, W * 0.2, Math.cos(ang) * W * 0.26, H * 0.56, Math.sin(ang) * D * 0.26 - D * 0.04);
        c.rotation.z = -Math.cos(ang) * 0.55; c.rotation.x = Math.sin(ang) * 0.55; head.add(c);
      }
      break;
    case 'afro':
      if (!covered) head.add(mesh(unitSphere(), m, W * 1.55, H * 1.28, D * 1.5, 0, H * 0.2, -D * 0.1));
      else backPanel(H * 0.6);
      break;
    case 'braids':
      top(1.06);
      for (const s of [-1, 1]) for (let i = 0; i < 6; i++) {
        const r = W * (0.17 - i * 0.012);
        head.add(mesh(unitSphere(0), i % 2 ? m : hl, r, r * 1.1, r, s * W * 0.42, -H * 0.05 - i * H * 0.17, -D * 0.1 + i * D * 0.02));
      }
      break;
    case 'undercut':
      top(1.02, Math.PI * 0.5);
      if (!covered) head.add(mesh(sphereCap(Math.PI * 0.3), m, W * 1.12, H * 1.2, D * 1.15, 0, H * 0.1, D * 0.02));
      break;
    case 'swept': {
      top(1.07);
      if (!covered) {
        const sw = mesh(unitSphere(), hl, W * 0.95, H * 0.3, D * 0.62, W * 0.06, H * 0.4, D * 0.16);
        sw.rotation.z = -0.32; sw.rotation.x = -0.25; head.add(sw);
      }
      break;
    }
    case 'twin-buns':
      top(1.06);
      for (const s of [-1, 1]) head.add(mesh(unitSphere(), m, W * 0.36, W * 0.36, W * 0.36, s * W * 0.4, H * 0.48, -D * 0.05));
      break;
  }
}

function buildHeadwear(a: Appearance, h: Head, head: THREE.Group) {
  const { W, H, D } = h;
  const c = std(a.headwearColor, { rough: 0.5 });
  switch (a.headwear) {
    case 'cap':
      head.add(mesh(sphereCap(Math.PI * 0.5), c, W * 1.12, H * 1.05, D * 1.12, 0, H * 0.06, 0));
      head.add(mesh(roundBox(0.3), std(shade(a.headwearColor, -0.15)), W * 0.78, H * 0.05, D * 0.5, 0, H * 0.1, D * 0.62).rotateX(0.12));
      break;
    case 'hardhat':
      head.add(mesh(sphereCap(Math.PI * 0.5), std(a.headwearColor, { rough: 0.35 }), W * 1.2, H * 1.1, D * 1.2, 0, H * 0.08, 0));
      head.add(mesh(unitCyl(28), std(a.headwearColor, { rough: 0.35 }), W * 1.45, H * 0.04, D * 1.45, 0, H * 0.1, 0));
      break;
    case 'helmet':
      head.add(mesh(sphereCap(Math.PI * 0.62), std(a.headwearColor, { metal: 0.4, rough: 0.35 }), W * 1.2, H * 1.16, D * 1.2, 0, H * 0.04, 0));
      break;
    case 'beanie':
      head.add(mesh(sphereCap(Math.PI * 0.5), c, W * 1.1, H * 1.2, D * 1.1, 0, H * 0.05, 0));
      head.add(mesh(torus(0.22), std(shade(a.headwearColor, -0.12)), W * 1.06, W * 1.06, H * 0.5, 0, H * 0.1, 0).rotateX(Math.PI / 2));
      head.add(mesh(unitSphere(0), std(a.trimColor), W * 0.22, W * 0.22, W * 0.22, 0, H * 0.66, 0));
      break;
    case 'headset': {
      const hm = std('#22252c', { rough: 0.4, metal: 0.3 });
      head.add(mesh(torus(0.05, Math.PI), hm, W * 1.12, H * 1.12, W * 1.12, 0, H * 0.02, 0));
      for (const s of [-1, 1]) head.add(mesh(unitCyl(16), hm, H * 0.32, W * 0.1, H * 0.32, s * W * 0.53, -H * 0.04, 0).rotateZ(Math.PI / 2));
      head.add(mesh(roundBox(0.4), hm, W * 0.04, W * 0.04, D * 0.5, W * 0.42, -H * 0.24, D * 0.28).rotateY(0.5));
      head.add(mesh(unitSphere(0), glow(a.accent), W * 0.07, W * 0.07, W * 0.07, W * 0.28, -H * 0.27, D * 0.48));
      break;
    }
    case 'mask':
      head.add(mesh(unitSphere(), c, W * 0.98, H * 0.48, D * 1.0, 0, -H * 0.26, D * 0.02));
      break;
    case 'full-helmet':
      head.add(mesh(unitSphere(), std(a.headwearColor, { metal: 0.5, rough: 0.3 }), W * 1.28, H * 1.24, D * 1.3, 0, 0, 0));
      head.add(mesh(roundBox(0.4), glow(a.accent, 0.85), W * 0.92, H * 0.3, D * 0.2, 0, H * 0.04, D * 0.56));
      break;
  }
}

function buildGlasses(a: Appearance, d: BodyDims, h: Head, head: THREE.Group) {
  if (a.glasses === 'none' || a.robotic === 'full' || a.headwear === 'full-helmet') return;
  const E = Math.min(h.W, h.H) * (d.style === 'chibi' ? 0.155 : d.blocky ? 0.13 : 0.14);
  const eyeY = h.H * (d.style === 'chibi' ? -0.02 : 0.05), eyeX = h.W * (d.style === 'chibi' ? 0.22 : 0.2);
  const z = h.surf(eyeX, eyeY) + E * 0.32;
  const frame = std('#1b1c22', { rough: 0.35, metal: 0.4 });
  if (a.glasses === 'round' || a.glasses === 'square') {
    for (const s of [-1, 1]) {
      const r = a.glasses === 'round'
        ? mesh(torus(0.09), frame, E * 1.7, E * 1.7, E * 1.7, s * eyeX, eyeY, z)
        : mesh(squareRing(), frame, E * 2.1, E * 1.7, 1, s * eyeX, eyeY, z);
      head.add(r);
      head.add(mesh(unitPlane(), std('#bfe6ff', { opacity: 0.18, rough: 0.05 }), E * 1.5, E * 1.3, 1, s * eyeX, eyeY, z - 0.002));
      head.add(mesh(unitBox(), frame, E * 0.12, E * 0.12, h.D * 0.45, s * h.W * 0.48, eyeY, z - h.D * 0.25));
    }
    head.add(mesh(unitBox(), frame, eyeX * 2 - E * 1.6, E * 0.14, E * 0.14, 0, eyeY + E * 0.2, z));
  } else if (a.glasses === 'visor') {
    head.add(mesh(roundBox(0.45), glow(a.accent, 0.55, true), h.W * 0.98, E * 1.15, E * 0.25, 0, eyeY, z));
  } else {
    head.add(mesh(unitBox(), frame, h.W * 0.9, E * 0.14, E * 0.14, 0, eyeY + E * 0.65, z));
    head.add(mesh(roundBox(0.3), glow(a.accent, 0.6, true), E * 1.6, E * 1.1, E * 0.1, eyeX, eyeY, z));
  }
}

function unitPlane() { return shared('plane', () => new THREE.PlaneGeometry(1, 1)); }

// ---------- body and outfit ----------

/** Build a character group (feet at y = 0, facing +z). */
export function buildCharacter(a: Appearance, seedKey = ''): THREE.Group {
  const d = bodyDims(a);
  const root = new THREE.Group();
  root.name = 'character';
  const body = new THREE.Group(); root.add(body);
  const limb = d.blocky ? roundBox(0.12) : unitCapsule();
  const limbScale = (w: number, len: number) => (d.blocky ? [w, len, w] : [w, len / 2, w]) as [number, number, number];
  const skin = std(a.skinTone, { rough: 0.55 });
  const top = a.top === 'armor' ? std(a.topColor, { metal: 0.65, rough: 0.35 }) : std(a.topColor, { rough: 0.62 });
  const topDark = std(shade(a.topColor, -0.18), { rough: 0.6 });
  const trim = std(a.trimColor, { rough: 0.45, metal: 0.15 });
  const legColor = a.top === 'coverall' ? a.topColor : a.bottomColor;
  const bottom = std(legColor, { rough: 0.68 });
  const shoe = std(a.shoeColor, { rough: a.shoes === 'dress' ? 0.25 : 0.6, metal: a.shoes === 'dress' ? 0.2 : 0 });
  const hand = a.gloves !== 'none' ? std(a.gloveColor, { rough: 0.5 }) : skin;
  const energy = a.effects.energyAccents ? glow(a.accent) : null;

  const hips = new THREE.Group(); hips.position.y = d.hipY; body.add(hips);
  // legs
  const mkLeg = (side: number) => {
    const leg = new THREE.Group();
    leg.position.set(side * (d.waistW / 2 - d.legW * 0.55), 0, 0);
    hips.add(leg);
    const thighMat = a.bottom === 'skirt' ? skin : bottom;
    const shinMat = a.bottom === 'pants' || a.top === 'coverall' ? bottom : skin;
    leg.add(mesh(limb, thighMat, ...limbScale(d.legW * 1.05, d.legLen * 0.55), 0, -d.legLen * 0.25, 0));
    const knee = new THREE.Group(); knee.position.y = -d.legLen * 0.5; leg.add(knee);
    knee.add(mesh(limb, shinMat, ...limbScale(d.legW * 0.95, d.legLen * 0.55), 0, -d.legLen * 0.24, 0));
    const fh = a.shoes === 'boots' ? d.legW * 1.1 : d.legW * 0.55;
    knee.add(mesh(roundBox(0.3), shoe, d.legW * 1.18, fh, d.legW * 1.7, 0, -d.legLen * 0.5 + fh / 2, d.legW * 0.28));
    if (a.shoes === 'sneakers') knee.add(mesh(roundBox(0.3), std('#f2f2f2', { rough: 0.5 }), d.legW * 1.22, d.legW * 0.16, d.legW * 1.76, 0, -d.legLen * 0.5 + d.legW * 0.08, d.legW * 0.28));
    return { leg, knee };
  };
  const L = mkLeg(-1), R = mkLeg(1);

  // torso
  const torso = new THREE.Group(); hips.add(torso);
  const tg = d.blocky ? roundBox(0.1) : torsoGeo(d.waistW / d.torsoW, 0.3);
  torso.add(mesh(tg, top, d.torsoW, d.torsoH * 1.04, d.torsoD, 0, d.torsoH / 2, 0));
  const fz = d.torsoD / 2;
  const front = (w: number, hh: number, y: number, mat: THREE.Material, x = 0, dz = 0.006) => torso.add(mesh(roundBox(0.3), mat, w, hh, d.torsoD * 0.08, x, y, fz + dz));
  switch (a.top) {
    case 'tshirt': front(d.torsoW * 0.28, d.torsoH * 0.06, d.torsoH * 0.97, skin); break;
    case 'hoodie':
      torso.add(mesh(torus(0.35, Math.PI), topDark, d.torsoW * 0.62, d.torsoW * 0.5, d.torsoD * 1.4, 0, d.torsoH * 0.98, -d.torsoD * 0.25).rotateX(-Math.PI / 2 + 0.3));
      front(d.torsoW * 0.55, d.torsoH * 0.22, d.torsoH * 0.22, topDark);
      for (const s of [-1, 1]) front(d.torsoW * 0.03, d.torsoH * 0.22, d.torsoH * 0.75, trim, s * d.torsoW * 0.08);
      break;
    case 'suit':
      front(d.torsoW * 0.26, d.torsoH * 0.42, d.torsoH * 0.78, std('#f2f2f4'));
      front(d.torsoW * 0.09, d.torsoH * 0.55, d.torsoH * 0.66, trim, 0, 0.01);
      for (const s of [-1, 1]) torso.add(mesh(roundBox(0.3), topDark, d.torsoW * 0.12, d.torsoH * 0.5, d.torsoD * 0.08, s * d.torsoW * 0.15, d.torsoH * 0.72, fz + 0.012).rotateZ(s * 0.32));
      break;
    case 'labcoat': case 'longcoat': case 'robe': {
      const len = a.top === 'robe' ? d.legLen * 0.92 : a.top === 'longcoat' ? d.legLen * 0.72 : d.legLen * 0.55;
      const sk = mesh(frustum(0.82), a.top === 'robe' ? top : std(a.topColor, { rough: 0.62, side: THREE.DoubleSide }), d.torsoW * 1.18, len, d.torsoD * 1.35, 0, -len / 2 + d.torsoH * 0.05, 0);
      torso.add(sk);
      if (a.top !== 'robe') front(d.torsoW * 0.2, d.torsoH * 0.9, d.torsoH * 0.5, std(a.top === 'labcoat' ? '#9fb3c8' : a.trimColor));
      else front(d.torsoW * 0.95, d.torsoH * 0.1, d.torsoH * 0.12, trim);
      torso.add(mesh(torus(0.3, Math.PI), topDark, d.torsoW * 0.56, d.torsoW * 0.4, d.torsoD * 1.1, 0, d.torsoH * 0.98, -d.torsoD * 0.05).rotateX(-Math.PI / 2 + 0.6));
      break;
    }
    case 'coverall': front(d.torsoW * 0.06, d.torsoH * 0.8, d.torsoH * 0.5, trim); break;
    case 'uniform':
      front(d.torsoW * 0.98, d.torsoH * 0.08, d.torsoH * 0.62, trim);
      for (const s of [-1, 1]) torso.add(mesh(roundBox(0.3), trim, d.armW * 1.3, d.torsoH * 0.05, d.torsoD * 0.6, s * d.torsoW * 0.42, d.torsoH * 1.01, 0));
      break;
    case 'vest': front(d.torsoW * 0.3, d.torsoH * 0.5, d.torsoH * 0.74, std(a.trimColor)); break;
    case 'jacket':
      front(d.torsoW * 0.3, d.torsoH * 0.95, d.torsoH * 0.5, std(a.trimColor));
      torso.add(mesh(torus(0.3, Math.PI), topDark, d.torsoW * 0.58, d.torsoW * 0.44, d.torsoD * 1.1, 0, d.torsoH * 0.98, -d.torsoD * 0.05).rotateX(-Math.PI / 2 + 0.6));
      break;
    case 'armor':
      front(d.torsoW * 0.4, d.torsoH * 0.32, d.torsoH * 0.62, std(shade(a.topColor, 0.2), { metal: 0.8, rough: 0.25 }));
      front(d.torsoW * 0.12, d.torsoH * 0.12, d.torsoH * 0.62, glow(a.accent), 0, 0.012);
      break;
  }
  if (a.bottom === 'skirt' && a.top !== 'robe') torso.add(mesh(frustum(0.85), std(legColor, { rough: 0.6, side: THREE.DoubleSide }), d.waistW * 1.25, d.legLen * 0.42, d.torsoD * 1.4, 0, -d.legLen * 0.19, 0));
  if (energy) for (const s of [-1, 1]) torso.add(mesh(unitBox(), energy, d.torsoW * 0.03, d.torsoH * 0.7, d.torsoD * 0.5, s * d.torsoW * 0.47, d.torsoH * 0.5, 0));
  // belt
  if (a.belt !== 'none' || a.top === 'coverall') {
    const bm = std(shade(legColor, -0.35), { rough: 0.5 });
    torso.add(mesh(roundBox(0.3), bm, d.waistW * 1.06, d.torsoH * 0.09, d.torsoD * 1.06, 0, d.torsoH * 0.04, 0));
    torso.add(mesh(roundBox(0.3), std('#d4a84a', { metal: 0.8, rough: 0.3 }), d.waistW * 0.16, d.torsoH * 0.08, d.torsoD * 0.1, 0, d.torsoH * 0.04, fz + 0.01));
    if (a.belt === 'utility' || a.equipment === 'toolbelt') for (const s of [-1, 1]) torso.add(mesh(roundBox(0.3), bm, d.waistW * 0.2, d.torsoH * 0.16, d.torsoD * 0.3, s * d.waistW * 0.38, -d.torsoH * 0.02, fz * 0.7));
    if (a.belt === 'harness') for (const s of [-1, 1]) torso.add(mesh(unitBox(), bm, d.torsoW * 0.07, d.torsoH * 1.05, d.torsoD * 0.06, 0, d.torsoH * 0.5, fz + 0.012).rotateZ(s * 0.5));
  }
  // jewelry
  if (a.jewelry === 'badge') front(d.torsoW * 0.12, d.torsoH * 0.08, d.torsoH * 0.78, glow(a.accent), -d.torsoW * 0.26, 0.012);
  if (a.jewelry === 'necklace') torso.add(mesh(torus(0.08), std('#e0b84a', { metal: 0.9, rough: 0.25 }), d.torsoW * 0.42, d.torsoW * 0.42, d.torsoW * 0.42, 0, d.torsoH * 0.95, d.torsoD * 0.1).rotateX(Math.PI / 2 - 0.35));

  // arms
  const sleeveFore = a.top === 'tshirt' ? skin : a.top === 'vest' ? std(a.trimColor, { rough: 0.6 }) : top;
  const sleeveUpper = a.top === 'vest' ? std(a.trimColor, { rough: 0.6 }) : top;
  const mkArm = (side: number) => {
    const arm = new THREE.Group();
    arm.position.set(side * (d.torsoW / 2 + d.armW * 0.42), d.torsoH - d.armW * 0.55, 0);
    torso.add(arm);
    arm.add(mesh(limb, sleeveUpper, ...limbScale(d.armW * 1.08, d.armLen * 0.55), 0, -d.armLen * 0.22, 0));
    const elbow = new THREE.Group(); elbow.position.y = -d.armLen * 0.48; arm.add(elbow);
    elbow.add(mesh(limb, sleeveFore, ...limbScale(d.armW, d.armLen * 0.5), 0, -d.armLen * 0.2, 0));
    elbow.add(mesh(d.blocky ? roundBox(0.3) : unitSphere(), hand, d.armW * 1.2, d.armW * 1.25, d.armW * 1.2, 0, -d.armLen * 0.46, 0));
    if (a.gloves === 'tech') elbow.add(mesh(unitBox(), glow(a.accent), d.armW * 1.1, d.armW * 0.15, d.armW * 1.1, 0, -d.armLen * 0.36, 0));
    if (a.shoulders !== 'none' || a.top === 'armor') {
      const metal = a.shoulders === 'metallic' || a.shoulders === 'armored' || a.top === 'armor';
      const big = a.shoulders === 'armored' || a.top === 'armor' ? 1.5 : 1.2;
      arm.add(mesh(roundBox(0.35), metal ? std('#8a94a2', { metal: 0.85, rough: 0.3 }) : topDark, d.armW * 1.6 * big, d.armW * 0.75 * big, d.armW * 1.5 * big, side * d.armW * 0.12, d.armW * 0.2, 0));
      if (a.shoulders === 'armored') arm.add(mesh(unitBox(), glow(a.accent), d.armW * 1.9, d.armW * 0.08, d.armW * 0.12, side * d.armW * 0.12, d.armW * 0.3, d.armW * 1.1));
    }
    return { arm, elbow };
  };
  const AL = mkArm(-1), AR = mkArm(1);
  // equipment in the right hand
  const eq = a.equipment;
  const handY = -d.armLen * 0.5;
  const u = Math.min(d.armW, 0.1); // props keep a believable size on chunky arms
  if (eq === 'tablet' || eq === 'drafting-tablet' || eq === 'clipboard') {
    const big = eq === 'drafting-tablet' ? 1.4 : 1;
    const p = new THREE.Group(); p.position.set(0, handY, u * 0.9); p.rotation.x = -0.9;
    p.add(mesh(roundBox(0.2), std(eq === 'clipboard' ? '#7a5a34' : '#1a1c22', { rough: 0.4 }), u * 2.6 * big, u * 3.4 * big, u * 0.25));
    p.add(mesh(unitPlane(), eq === 'clipboard' ? std('#f4f1e8') : glow(a.accent, 0.9), u * 2.2 * big, u * 2.9 * big, 1, 0, 0, u * 0.14));
    AR.elbow.add(p);
  } else if (eq === 'laptop' || eq === 'briefcase') {
    AR.elbow.add(mesh(roundBox(0.2), std(eq === 'briefcase' ? '#4a3222' : '#2a2d33', { rough: 0.4, metal: 0.2 }), u * 0.8, u * 2.6, u * 3.4, 0, handY - u * 1.4, 0));
  } else if (eq === 'wrench') {
    AR.elbow.add(mesh(unitCyl(8), std('#9aa3ad', { metal: 0.85, rough: 0.3 }), u * 0.3, d.armLen * 0.5, u * 0.3, 0, handY - d.armLen * 0.15, u * 0.5));
  } else if (eq === 'holo-catalog') {
    AR.elbow.add(mesh(unitPlane(), glow(a.accent, 0.45, true), u * 3.4, u * 2.4, 1, 0, handY + u * 0.5, u * 2.2));
  }

  // neck and head
  const neck = new THREE.Group(); neck.position.y = d.torsoH; torso.add(neck);
  neck.add(mesh(unitCyl(14), skin, d.armW * 1.1, d.neck + d.headH * 0.2, d.armW * 1.1, 0, (d.neck + d.headH * 0.2) / 2 - d.headH * 0.1, 0));
  const head = new THREE.Group(); head.position.y = d.neck + d.headH / 2; neck.add(head);
  const hd = makeHead(a, d);
  const headMat = a.robotic === 'full' ? std('#8a94a2', { metal: 0.8, rough: 0.3 }) : skin;
  head.add(mesh(hd.box ? roundBox(d.blocky ? 0.2 : 0.32) : unitSphere(), headMat, hd.W, hd.H, hd.D));
  if (!hd.box && a.robotic !== 'full') for (const s of [-1, 1]) head.add(mesh(unitSphere(0), skin, hd.W * 0.14, hd.H * 0.24, hd.D * 0.18, s * hd.W * 0.48, -hd.H * 0.04, -hd.D * 0.02));
  if (a.jewelry === 'earrings') for (const s of [-1, 1]) head.add(mesh(unitSphere(0), std('#e0b84a', { metal: 0.9, rough: 0.2 }), hd.W * 0.07, hd.W * 0.07, hd.W * 0.07, s * hd.W * 0.5, -hd.H * 0.2, 0));
  const face = new THREE.Group(); face.name = 'face'; head.add(face);
  const rig: Rig = {
    dims: d, seed: hashSeed(seedKey || `${a.skinTone}${a.hairStyle}${a.topColor}`),
    body, hips, torso, neck, head, face, armL: AL.arm, armR: AR.arm, elbowL: AL.elbow, elbowR: AR.elbow,
    legL: L.leg, legR: R.leg, kneeL: L.knee, kneeR: R.knee, eyes: [], mouth: null, idlePose: a.idlePose, speed: a.animationSpeed || 1,
  };
  buildFace(a, d, hd, face, rig);
  const covered = a.headwear === 'cap' || a.headwear === 'hardhat' || a.headwear === 'helmet' || a.headwear === 'beanie';
  if (a.headwear !== 'full-helmet') buildHair(a, hd, head, covered);
  buildHeadwear(a, hd, head);
  buildGlasses(a, d, hd, head);

  if (a.effects.aura) root.add(mesh(unitSphere(), glow(a.accent, 0.08 + a.effects.intensity * 0.12, true), d.torsoW * 2.6, d.total * 1.2, d.torsoW * 2.2, 0, d.total * 0.52, 0));
  rigs.set(root, rig);
  root.userData.height = d.total;
  return root;
}

const smooth = (cur: number, target: number, k: number) => cur + (target - cur) * k;

/** Pose a character at time t (seconds). `blend` (0..1) eases between poses; reduced motion calms idle motion. */
export function animateCharacter(group: THREE.Object3D, pose: CharacterPose, t: number, opts: { blend?: number; reduced?: boolean } = {}) {
  const r = rigs.get(group);
  if (!r) return;
  const k = opts.blend ?? 1;
  const calm = opts.reduced ? 0.35 : 1;
  const tt = t * r.speed + r.seed * 10;
  let legL = 0, legR = 0, kneeL = 0, kneeR = 0, armLx = 0, armRx = 0, armLz = -0.07, armRz = 0.07, elbL = -0.12, elbR = -0.12;
  let headX = 0, headY = 0, headZ = 0, torsoX = 0, torsoY = 0, bob = 0;
  switch (pose) {
    case 'walk': case 'run': {
      const run = pose === 'run';
      const f = run ? 11 : 7.6, amp = run ? 0.85 : 0.55;
      const s = Math.sin(tt * f);
      legL = s * amp; legR = -s * amp;
      kneeL = Math.max(0, -Math.cos(tt * f)) * (run ? 1.1 : 0.7); kneeR = Math.max(0, Math.cos(tt * f)) * (run ? 1.1 : 0.7);
      armLx = -s * amp * 0.9; armRx = s * amp * 0.9; elbL = elbR = run ? -1.1 : -0.35;
      bob = Math.abs(Math.sin(tt * f)) * (run ? 0.06 : 0.035);
      torsoX = run ? 0.18 : 0.04; torsoY = s * 0.07;
      break;
    }
    case 'work': {
      armLx = -0.95; armRx = -0.95; elbL = -0.75 + Math.sin(tt * 16) * 0.08 * calm; elbR = -0.75 + Math.sin(tt * 16 + 1.7) * 0.08 * calm;
      armLz = 0.12; armRz = -0.12; headX = 0.18; headY = Math.sin(tt * 0.5) * 0.12 * calm;
      break;
    }
    case 'think': {
      armRx = -1.25; elbR = -2.1; armRz = -0.25; armLx = -0.5; elbL = -1.5; armLz = 0.4;
      headX = -0.1; headZ = 0.14 + Math.sin(tt * 0.8) * 0.05 * calm;
      break;
    }
    case 'talk': {
      armRx = -0.6 + Math.sin(tt * 3.1) * 0.25 * calm; elbR = -0.9; armLx = -0.3 + Math.sin(tt * 2.3) * 0.18 * calm; elbL = -0.6;
      headY = Math.sin(tt * 1.3) * 0.2 * calm; headX = Math.sin(tt * 2.1) * 0.05;
      break;
    }
    case 'ride': {
      armLz = -0.45; armRz = 0.45; elbL = elbR = -0.3; torsoX = 0.08; headX = -0.05;
      bob = Math.sin(tt * 2.2) * 0.02 * calm;
      break;
    }
    case 'wave': {
      armRz = 2.55; armRx = 0; elbR = -0.3 + Math.sin(tt * 8) * 0.35; headZ = -0.1; headY = 0.1;
      break;
    }
    case 'alert': {
      armLz = -0.7; armRz = 0.7; elbL = elbR = -1.6; armLx = armRx = 0.2;
      headY = Math.sin(tt * 5) * 0.3 * calm;
      break;
    }
    case 'paused': {
      headX = 0.35; armLz = -0.02; armRz = 0.02; torsoX = 0.08; bob = -0.02;
      break;
    }
    default: {
      bob = Math.sin(tt * 1.7) * 0.008 * calm;
      headY = Math.sin(tt * 0.37) * 0.22 * calm; headX = Math.sin(tt * 0.23) * 0.05 * calm;
      if (r.idlePose === 'arms-crossed') { armLx = armRx = -0.55; elbL = elbR = -1.75; armLz = 0.32; armRz = -0.32; }
      else if (r.idlePose === 'hands-hips') { armLz = -0.65; armRz = 0.65; elbL = elbR = -1.5; armLx = armRx = 0.15; }
      else { armLz = -0.08 - Math.sin(tt * 1.7) * 0.02 * calm; armRz = 0.08 + Math.sin(tt * 1.7) * 0.02 * calm; }
    }
  }
  r.legL.rotation.x = smooth(r.legL.rotation.x, legL, k); r.legR.rotation.x = smooth(r.legR.rotation.x, legR, k);
  r.kneeL.rotation.x = smooth(r.kneeL.rotation.x, kneeL, k); r.kneeR.rotation.x = smooth(r.kneeR.rotation.x, kneeR, k);
  r.armL.rotation.x = smooth(r.armL.rotation.x, armLx, k); r.armR.rotation.x = smooth(r.armR.rotation.x, armRx, k);
  r.armL.rotation.z = smooth(r.armL.rotation.z, armLz, k); r.armR.rotation.z = smooth(r.armR.rotation.z, armRz, k);
  r.elbowL.rotation.x = smooth(r.elbowL.rotation.x, elbL, k); r.elbowR.rotation.x = smooth(r.elbowR.rotation.x, elbR, k);
  r.head.rotation.x = smooth(r.head.rotation.x, headX, k); r.head.rotation.y = smooth(r.head.rotation.y, headY, k); r.head.rotation.z = smooth(r.head.rotation.z, headZ, k);
  r.torso.rotation.x = smooth(r.torso.rotation.x, torsoX, k); r.torso.rotation.y = smooth(r.torso.rotation.y, torsoY, k);
  r.body.position.y = smooth(r.body.position.y, bob, k);
  // blink every few seconds; talk moves the mouth
  const bt = (tt * 0.27 + r.seed) % 1;
  const blink = bt < 0.035 ? 0.12 : 1;
  for (const e of r.eyes) e.o.scale.y = e.sy * blink;
  if (r.mouth) r.mouth.scale.y = pose === 'talk' ? 1 + Math.abs(Math.sin(tt * 9)) * 0.6 : 1;
}

/** Map a simulation status to a pose. */
export function poseForStatus(status: string, moving: boolean, inTube: boolean): CharacterPose {
  if (moving) return inTube ? 'ride' : 'walk';
  switch (status) {
    case 'working': return 'work';
    case 'thinking': case 'researching': return 'think';
    case 'communicating': return 'talk';
    case 'blocked': case 'error': return 'alert';
    case 'paused': return 'paused';
    case 'walking': return inTube ? 'ride' : 'walk';
    default: return 'idle';
  }
}
