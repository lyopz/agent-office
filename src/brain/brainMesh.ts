// A human brain built from code: two cerebral hemispheres with frontal,
// temporal and occipital shaping, winding gyri and sulci, the longitudinal
// fissure between them, a folded cerebellum and the brainstem. Each vertex
// carries a `fold` value (1 on a gyrus crown, 0 deep in a sulcus) so the
// shader can shade the folds, and a `tint`, the colour of its region (frontal,
// parietal, temporal and occipital lobes, cerebellum, brainstem), blended
// softly across the sulci that divide them. Seeded, so it never changes between loads.
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

/** Glassy tissue: the folds catch the light, the edges glow, and the nerves show through. */
export function glassBrainMaterial() {
  return new THREE.ShaderMaterial({
    transparent: true, depthWrite: false,
    uniforms: { uDeep: { value: new THREE.Color('#0b2547') }, uCrown: { value: new THREE.Color('#5fb8ff') }, uRim: { value: new THREE.Color('#9fe6ff') }, uLight: { value: new THREE.Vector3(-0.5, 0.8, 0.6).normalize() }, uOpacity: { value: 1 }, uRegions: { value: 1 } },
    vertexShader: `attribute float fold; attribute vec3 tint; varying float vFold; varying vec3 vTint; varying vec3 vN; varying vec3 vV; varying vec3 vWN;
      void main(){ vFold=fold; vTint=tint; vec4 mv=modelViewMatrix*vec4(position,1.); vN=normalize(normalMatrix*normal); vWN=normalize(mat3(modelMatrix)*normal); vV=normalize(-mv.xyz); gl_Position=projectionMatrix*mv; }`,
    fragmentShader: `uniform vec3 uDeep; uniform vec3 uCrown; uniform vec3 uRim; uniform vec3 uLight; uniform float uOpacity; uniform float uRegions; varying float vFold; varying vec3 vTint; varying vec3 vN; varying vec3 vV; varying vec3 vWN;
      void main(){ vec3 n=normalize(vN); float fres=pow(1.-abs(dot(n,normalize(vV))),2.4); float diff=max(dot(normalize(vWN),uLight),0.);
        float f=smoothstep(.15,.95,vFold); vec3 crown=mix(uCrown,vTint,uRegions), rim=mix(uRim,vTint,uRegions*.75);
        vec3 col=mix(uDeep*mix(vec3(1.),vTint*1.6,uRegions*.6),crown,f*.8)*(.34+.62*diff)+rim*fres*.55;
        float a=(.06+.2*f*diff+.42*fres)*uOpacity; gl_FragColor=vec4(col,a); }`,
  });
}

/** Tissue as it looks: soft pinkish grey, darker in the sulci. Hides the nerves. */
export function solidBrainMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: { uSulcus: { value: new THREE.Color('#6d4648') }, uGyrus: { value: new THREE.Color('#e3b9b2') }, uLight: { value: new THREE.Vector3(-0.5, 0.8, 0.6).normalize() }, uFill: { value: new THREE.Vector3(0.6, -0.2, -0.7).normalize() }, uRegions: { value: 1 } },
    vertexShader: `attribute float fold; attribute vec3 tint; varying float vFold; varying vec3 vTint; varying vec3 vWN; varying vec3 vN; varying vec3 vV;
      void main(){ vFold=fold; vTint=tint; vec4 mv=modelViewMatrix*vec4(position,1.); vWN=normalize(mat3(modelMatrix)*normal); vN=normalize(normalMatrix*normal); vV=normalize(-mv.xyz); gl_Position=projectionMatrix*mv; }`,
    fragmentShader: `uniform vec3 uSulcus; uniform vec3 uGyrus; uniform vec3 uLight; uniform vec3 uFill; uniform float uRegions; varying float vFold; varying vec3 vTint; varying vec3 vWN; varying vec3 vN; varying vec3 vV;
      void main(){ vec3 n=normalize(vWN); float key=max(dot(n,uLight),0.); float fill=max(dot(n,uFill),0.)*.35;
        float f=smoothstep(.1,.9,vFold); vec3 gyrus=mix(uGyrus,vTint*1.05,uRegions*.7), sulcus=mix(uSulcus,vTint*.42,uRegions*.7); vec3 base=mix(sulcus,gyrus,f);
        float spec=pow(max(dot(reflect(-normalize(vV),normalize(vN)),vec3(0.,0.,1.)),0.),24.)*.12*f;
        float fres=pow(1.-abs(dot(normalize(vN),normalize(vV))),3.)*.25;
        gl_FragColor=vec4(base*(.22+.85*key+fill)+spec+fres*vec3(.9,.7,.7),1.); }`,
  });
}
