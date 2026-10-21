// A human brain built from code: two cerebral hemispheres with frontal,
// temporal and occipital shaping, winding gyri and sulci, the longitudinal
// fissure between them, a folded cerebellum and the brainstem. Each vertex
// carries a `fold` value (1 on a gyrus crown, 0 deep in a sulcus) so the
// shader can shade the folds, and a `tint`, the colour of its region (frontal,
// parietal, temporal and occipital lobes, cerebellum, brainstem), blended
// softly across the sulci that divide them. Seeded, so it never changes between loads.
//
// Every brain is a hologram: `holoBrainMaterial` draws it as a translucent
// projection in one colour, the colour the owner picked for that brain
// (`brainColor`), with the folds, a light, scan lines and the faint inner
// surface showing through, like a volumetric scan hanging in the air.
import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';

// ---------- 3D simplex noise (Gustavson), seeded ----------
const GRAD = [[1, 1, 0], [-1, 1, 0], [1, -1, 0], [-1, -1, 0], [1, 0, 1], [-1, 0, 1], [1, 0, -1], [-1, 0, -1], [0, 1, 1], [0, -1, 1], [0, 1, -1], [0, -1, -1]];
function makeNoise(seed: number) {
  const p = new Uint8Array(256);
  for (let i = 0; i < 256; i++) p[i] = i;
  let s = seed >>> 0;
  for (let i = 255; i > 0; i--) { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; const j = s % (i + 1); [p[i], p[j]] = [p[j], p[i]]; }
  const perm = new Uint8Array(512);
  for (let i = 0; i < 512; i++) perm[i] = p[i & 255];
  const F3 = 1 / 3, G3 = 1 / 6;
  return (x: number, y: number, z: number) => {
    const sk = (x + y + z) * F3, i = Math.floor(x + sk), j = Math.floor(y + sk), k = Math.floor(z + sk);
    const t = (i + j + k) * G3, x0 = x - (i - t), y0 = y - (j - t), z0 = z - (k - t);
    let i1, j1, k1, i2, j2, k2;
    if (x0 >= y0) { if (y0 >= z0) { i1 = 1; j1 = 0; k1 = 0; i2 = 1; j2 = 1; k2 = 0; } else if (x0 >= z0) { i1 = 1; j1 = 0; k1 = 0; i2 = 1; j2 = 0; k2 = 1; } else { i1 = 0; j1 = 0; k1 = 1; i2 = 1; j2 = 0; k2 = 1; } }
    else if (y0 < z0) { i1 = 0; j1 = 0; k1 = 1; i2 = 0; j2 = 1; k2 = 1; } else if (x0 < z0) { i1 = 0; j1 = 1; k1 = 0; i2 = 0; j2 = 1; k2 = 1; } else { i1 = 0; j1 = 1; k1 = 0; i2 = 1; j2 = 1; k2 = 0; }
    const c = [[x0, y0, z0, 0, 0, 0], [x0 - i1 + G3, y0 - j1 + G3, z0 - k1 + G3, i1, j1, k1], [x0 - i2 + 2 * G3, y0 - j2 + 2 * G3, z0 - k2 + 2 * G3, i2, j2, k2], [x0 - 1 + 3 * G3, y0 - 1 + 3 * G3, z0 - 1 + 3 * G3, 1, 1, 1]];
    const ii = i & 255, jj = j & 255, kk = k & 255;
    let n = 0;
    for (const [dx, dy, dz, oi, oj, ok] of c) {
      let tt = 0.6 - dx * dx - dy * dy - dz * dz;
      if (tt < 0) continue;
      const g = GRAD[perm[ii + oi + perm[jj + oj + perm[kk + ok]]] % 12];
      tt *= tt;
      n += tt * tt * (g[0] * dx + g[1] * dy + g[2] * dz);
    }
    return 32 * n;
  };
}

/** Region colours, like an anatomy atlas. */
export const REGIONS = [
  { id: 'frontal', name: 'Frontal lobe', color: '#4f86e8' },
  { id: 'parietal', name: 'Parietal lobe', color: '#e2b84a' },
  { id: 'temporal', name: 'Temporal lobe', color: '#4fbf86' },
  { id: 'occipital', name: 'Occipital lobe', color: '#e2704f' },
  { id: 'cerebellum', name: 'Cerebellum', color: '#a874e0' },
  { id: 'brainstem', name: 'Brainstem', color: '#8b95a6' },
] as const;
const RC = Object.fromEntries(REGIONS.map((r) => [r.id, new THREE.Color(r.color)])) as Record<(typeof REGIONS)[number]['id'], THREE.Color>;
const tintOf = (geo: THREE.BufferGeometry, c: THREE.Color) => {
  const n = geo.attributes.position.count, t = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) t.set([c.r, c.g, c.b], i * 3);
  geo.setAttribute('tint', new THREE.BufferAttribute(t, 3));
};

const smooth = (e0: number, e1: number, x: number) => { const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t); };
const gauss = (d2: number, w: number) => Math.exp(-d2 / (w * w));

/** A unit sphere with its seam and pole vertices welded, so shaping it leaves no cracks or creases. */
function sphere(detail: number) {
  // an icosphere has evenly sized triangles, so folds run any way without grid streaks
  const raw = new THREE.IcosahedronGeometry(1, detail);
  raw.deleteAttribute('uv'); raw.deleteAttribute('normal');
  const geo = mergeVertices(raw, 1e-6);
  raw.dispose();
  return geo;
}

/**
 * One cerebral hemisphere. `side` is -1 (left) or 1 (right). Built from a
 * sphere so it can be shaped by direction, then folded with ridged noise.
 */
function hemisphere(side: 1 | -1, detail: number): THREE.BufferGeometry {
  const geo = sphere(detail);
  const pos = geo.attributes.position as THREE.BufferAttribute;
  const fold = new Float32Array(pos.count);
  const tint = new Float32Array(pos.count * 3);
  const col = new THREE.Color();
  const noise = makeNoise(side > 0 ? 71 : 113);
  const warp = makeNoise(side > 0 ? 7 : 19);
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i); // unit direction
    const ux = v.x, uy = v.y, uz = v.z;
    const lateral = ux * side; // +1 = outer side, -1 = facing the other hemisphere
    // basic proportions: long front to back, tall in the middle
    // the crest sits next to the midline and the hemisphere bulges outwards from it
    let x = ux * 0.72, y = uy * 0.56, z = uz * 0.84;
    // the medial wall is flat and meets the other half at the midline, with only the
    // narrow longitudinal fissure between them
    if (lateral < 0) x = -side * 0.032 * Math.pow(-lateral, 0.5);
    // flatter underside, a little lower at the front (frontal lobe slopes down)
    if (uy < -0.15) y = -0.15 * 0.56 + (uy + 0.15) * 0.56 * 0.5;
    y -= 0.07 * Math.max(0, uz) ** 2;
    // occipital pole a touch more pointed, frontal pole fuller and rounder
    z *= 1 + 0.05 * Math.max(0, -uz) - 0.03 * Math.max(0, uz);
    x *= 1 + 0.06 * Math.max(0, uz) * Math.max(0, lateral);
    // temporal lobe: a thumb-shaped bulge low on the outer side, pointing forward
    const tl = gauss((lateral - 0.75) ** 2 + (uy + 0.52) ** 2 * 1.4 + (uz - 0.18) ** 2 * 0.55, 0.42);
    x += side * 0.09 * tl; y -= 0.1 * tl;
    // the Sylvian fissure: a deep groove above the temporal lobe, rising towards the back
    const sylvian = Math.abs(uy - (-0.18 - 0.26 * uz)) ;
    const syl = Math.max(0, lateral) * smooth(0.12, 0, sylvian) * smooth(-0.6, 0.1, uz) * smooth(0.95, 0.3, uz);
    // central sulcus: a groove across the top, between frontal and parietal lobes
    const central = Math.abs(uz - (0.06 - 0.22 * uy));
    const cen = smooth(0.06, 0, central) * smooth(-0.2, 0.5, uy) * smooth(-0.6, 0.1, lateral);
    // gyri and sulci: ridged, domain-warped noise gives winding folds of brain width
    // (real gyri are broad and rounded, the sulci between them thin and deep).
    // Noise is sampled on the shaped surface, not the sphere, so folds keep one width everywhere.
    const f = 6.2, qx = x * f, qy = y * f, qz = z * f;
    const wx = warp(qx * 0.35, qy * 0.35, qz * 0.35) * 1.1, wy = warp(qy * 0.35 + 5, qz * 0.35, qx * 0.35) * 1.1, wz = warp(qz * 0.35 + 9, qx * 0.35, qy * 0.35) * 1.1;
    const g1 = Math.abs(noise(qx + wx, qy + wy, qz + wz));
    const g2 = Math.abs(noise((qx + wz) * 1.8 + 3, (qy + wx) * 1.8, (qz + wy) * 1.8));
    let crown = Math.pow(smooth(0.0, 0.5, g1), 0.6) * 0.88 + smooth(0.0, 0.45, g2) * 0.12;
    const medial = smooth(-0.3, -0.75, lateral); // the flat inner wall is smoother
    crown = crown * (1 - medial * 0.6) + medial * 0.6 * 0.8;
    crown *= 1 - 0.85 * syl; crown *= 1 - 0.6 * cen;
    fold[i] = crown;
    // lobes: frontal in front of the central sulcus, temporal below the Sylvian fissure, occipital at the back
    const wF = smooth(-0.04, 0.04, uz - (0.3 - 0.16 * uy));
    const wO = smooth(-0.5, -0.72, uz) * (1 - wF);
    const wT = smooth(-0.04, 0.06, (-0.18 - 0.26 * uz) - uy) * smooth(-0.25, 0.25, lateral) * smooth(-0.78, -0.55, uz);
    col.copy(RC.parietal).lerp(RC.frontal, wF).lerp(RC.occipital, wO).lerp(RC.temporal, wT);
    tint.set([col.r, col.g, col.b], i * 3);
    const depth = 0.045 * (crown - 0.8) - 0.05 * syl - 0.025 * cen;
    // push along the sphere's outward direction, scaled to the lobe shape
    const n = new THREE.Vector3(lateral < 0 ? -side * 2 : x / 0.72 ** 2, y / 0.56 ** 2, z / 0.84 ** 2).normalize();
    pos.setXYZ(i, x + side * 0.046 + n.x * depth, y + 0.1 + n.y * depth, z + n.z * depth);
  }
  geo.setAttribute('fold', new THREE.BufferAttribute(fold, 1));
  geo.setAttribute('tint', new THREE.BufferAttribute(tint, 3));
  geo.computeVertexNormals();
  return geo;
}

/** The cerebellum: two rounded lobes under the back of the brain, finely folded across. */
function cerebellum(detail: number): THREE.BufferGeometry {
  const geo = sphere(detail);
  const pos = geo.attributes.position as THREE.BufferAttribute;
  const fold = new Float32Array(pos.count);
  const noise = makeNoise(5);
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const ux = v.x, uy = v.y, uz = v.z;
    let x = ux * 0.5, y = uy * 0.24, z = uz * 0.3;
    // a dip down the middle (the vermis) makes two lobes
    y -= 0.05 * gauss(ux * ux, 0.18) * Math.max(0, uy);
    z -= 0.04 * gauss(ux * ux, 0.2) * Math.max(0, -uz);
    if (uy > 0.2) y = 0.2 * 0.24 + (uy - 0.2) * 0.24 * 0.6; // tucked under the cerebrum
    // folia: tight parallel folds running across
    const el = Math.atan2(uy, -uz);
    const folia = Math.sin(el * 26 + noise(ux * 3, uy * 3, uz * 3) * 1.2);
    const crown = 0.5 + 0.5 * folia;
    fold[i] = crown;
    const n = new THREE.Vector3(x / 0.25, y / 0.0576, z / 0.09).normalize();
    const d = 0.012 * (crown - 0.6);
    pos.setXYZ(i, x + n.x * d, y - 0.38 + n.y * d, z - 0.6 + n.z * d);
  }
  geo.setAttribute('fold', new THREE.BufferAttribute(fold, 1));
  geo.computeVertexNormals();
  return geo;
}

/** The brainstem: midbrain, the swelling of the pons, then the medulla narrowing down to the spinal cord. */
function brainstem(): THREE.BufferGeometry {
  const pts: THREE.Vector2[] = [];
  const profile = [[0.0, 0.115], [0.12, 0.14], [0.26, 0.16], [0.36, 0.13], [0.5, 0.1], [0.66, 0.082], [0.8, 0.07], [0.92, 0.062]];
  for (const [t, r] of profile) pts.push(new THREE.Vector2(r, -t));
  const raw = new THREE.LatheGeometry(pts, 40);
  raw.deleteAttribute('uv'); raw.deleteAttribute('normal');
  const geo = mergeVertices(raw, 1e-6);
  raw.dispose();
  const pos = geo.attributes.position as THREE.BufferAttribute;
  const fold = new Float32Array(pos.count).fill(0.65);
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const t = -y;
    // flattened front to back, leaning back as it descends
    pos.setXYZ(i, x * 1.08, y * 0.98 - 0.12, z * 0.82 - 0.2 - t * 0.14);
  }
  geo.setAttribute('fold', new THREE.BufferAttribute(fold, 1));
  geo.computeVertexNormals();
  return geo;
}

/** The whole brain as one geometry with a `fold` attribute. `detail` is icosphere subdivisions: ~64 for the app, lower for tests. */
export function buildBrainGeometry(detail = 64): THREE.BufferGeometry {
  const cb = cerebellum(Math.round(detail * 0.7)), bs = brainstem();
  tintOf(cb, RC.cerebellum); tintOf(bs, RC.brainstem);
  const parts = [hemisphere(-1, detail), hemisphere(1, detail), cb, bs];
  const merged = mergeGeometries(parts, false)!;
  parts.forEach((g) => g.dispose());
  return merged;
}

/** The holographic colour a brain shows when the owner hasn't picked one. */
export const HOLO_DEFAULT = '#5fb8ff';
/** Brain keys: 'main' for the whole brain, a team id for a specialist brain, an agent id for an agent's brain. */
export const MAIN_BRAIN = 'main';
/** The colour the owner picked for a brain, or `fallback` (the team's colour, then the holo default). */
export function brainColor(appearance: { brainColors?: Record<string, string> } | undefined, brain: string, fallback: string = HOLO_DEFAULT): string {
  const c = appearance?.brainColors?.[brain];
  return c && /^#[0-9a-f]{6}$/i.test(c) ? c : fallback;
}

const holoVertex = `attribute float fold; attribute vec3 tint;
  varying float vFold; varying vec3 vTint; varying vec3 vN; varying vec3 vV; varying vec3 vWN; varying vec3 vWP;
  void main(){ vFold=fold; vTint=tint; vec4 wp=modelMatrix*vec4(position,1.); vWP=wp.xyz; vec4 mv=viewMatrix*wp;
    vN=normalize(normalMatrix*normal); vWN=normalize(mat3(modelMatrix)*normal); vV=normalize(-mv.xyz); gl_Position=projectionMatrix*mv; }`;
// uSide: 1 for the surface facing the viewer, 0 for the inner (far) surface seen through it
const holoFragment = `uniform vec3 uColor; uniform vec3 uLight; uniform float uOpacity; uniform float uRegions; uniform float uTime; uniform float uSide; uniform float uPulse;
  varying float vFold; varying vec3 vTint; varying vec3 vN; varying vec3 vV; varying vec3 vWN; varying vec3 vWP;
  float hash(vec2 p){ return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453); }
  void main(){
    vec3 n=normalize(vN); vec3 v=normalize(vV); vec3 wn=normalize(vWN);
    if(uSide<.5){ n=-n; wn=-wn; }
    float ndv=max(dot(n,v),0.);
    float fres=pow(1.-ndv,2.2);
    float diff=max(dot(wn,uLight),0.);
    float back=max(dot(wn,-uLight),0.)*.35;
    float f=smoothstep(.12,.95,vFold);
    // the hologram's colours all come from one hue: a dark fill deep in the sulci, the hue on the gyri, nearly white on the rims
    vec3 lum=vec3(dot(uColor,vec3(.3,.59,.11)));
    vec3 deep=uColor*.16, crown=mix(uColor,lum,.08), rim=mix(uColor,vec3(1.),.55);
    // region tints sit lightly over the brain's own colour, so the picked colour always shows
    deep=mix(deep,vTint*.3,uRegions*.4); crown=mix(crown,vTint,uRegions*.35); rim=mix(rim,mix(vTint,vec3(1.),.5),uRegions*.3);
    // scan lines and a slow interference band drifting up, as a projector would draw it
    float scan=.86+.14*sin(vWP.y*240.-uTime*2.6);
    float band=smoothstep(.985,1.,sin(vWP.y*5.5-uTime*.75+vWP.z*.6))*.35;
    float slice=smoothstep(.93,1.,abs(fract(vWP.y*14.)*2.-1.))*.12;
    float flick=.965+.035*sin(uTime*31.)*sin(uTime*7.3+vWP.x);
    float grain=hash(floor(gl_FragCoord.xy*.5)+floor(uTime*12.))*.08;
    // light on the folds: the key light picks out the gyri, the sulci stay dark and see-through
    vec3 spec=rim*pow(max(dot(reflect(-uLight,wn),v),0.),28.)*.45*f;
    vec3 col=mix(deep,crown,f*.85)*(.2+.9*diff+back)+rim*fres*.62+spec;
    col*=scan*flick; col+=rim*(band+slice)*.6; col+=uColor*grain; col+=rim*uPulse*.35;
    float a=(.05+.26*f*(.4+.6*diff)+.5*fres)*scan*uOpacity;
    // the far surface only shows its rims and the brightest crowns, like the back wall of a glass scan
    if(uSide<.5){ col*=.5; a=(.015+.05*f*diff+.4*fres)*scan*uOpacity*.55; }
    gl_FragColor=vec4(col,a);
  }`;

/**
 * The hologram, as two materials over the same geometry: `back` draws the far
 * inner surface faintly (depth through the glass), `front` draws the near
 * surface with the folds lit. Both share `uColor`, so recolouring a brain is
 * one uniform. `setColor` fades to a new colour, `update` advances time.
 */
export interface HoloBrain { front: THREE.ShaderMaterial; back: THREE.ShaderMaterial; setColor(hex: string): void; setRegions(on: boolean): void; update(time: number, dt: number): void; pulse(strength?: number): void; dispose(): void }
export function holoBrainMaterial(color: string = HOLO_DEFAULT): HoloBrain {
  const make = (side: number) => new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, side: side ? THREE.FrontSide : THREE.BackSide,
    uniforms: { uColor: { value: new THREE.Color(color) }, uLight: { value: new THREE.Vector3(-0.5, 0.8, 0.6).normalize() }, uOpacity: { value: 1 }, uRegions: { value: 1 }, uTime: { value: 0 }, uSide: { value: side }, uPulse: { value: 0 } },
    vertexShader: holoVertex, fragmentShader: holoFragment,
  });
  const front = make(1), back = make(0);
  const target = new THREE.Color(color);
  let pulse = 0;
  return {
    front, back,
    setColor: (hex) => { target.set(hex); },
    setRegions: (on) => { front.uniforms.uRegions.value = back.uniforms.uRegions.value = on ? 1 : 0; },
    update: (time, dt) => {
      const c = front.uniforms.uColor.value as THREE.Color;
      c.lerp(target, Math.min(1, dt * 4));
      (back.uniforms.uColor.value as THREE.Color).copy(c);
      pulse = Math.max(0, pulse - dt * 1.8);
      front.uniforms.uTime.value = back.uniforms.uTime.value = time;
      front.uniforms.uPulse.value = back.uniforms.uPulse.value = pulse;
    },
    pulse: (strength = 1) => { pulse = Math.max(pulse, strength); },
    dispose: () => { front.dispose(); back.dispose(); },
  };
}
