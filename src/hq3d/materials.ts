// Shared materials and unit geometries. Everything here is cached by its
// parameters so hundreds of meshes reuse a handful of GPU programs and buffers;
// `disposeShared()` frees them when the last 3D view closes.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';

const mats = new Map<string, THREE.Material>();
const geos = new Map<string, THREE.BufferGeometry>();
let users = 0;

/** Count live views so shared GPU resources are released when the last one unmounts. */
export function retainShared() { users++; }
export function releaseShared() { users = Math.max(0, users - 1); if (!users) disposeShared(); }

export function disposeShared() {
  for (const m of mats.values()) m.dispose();
  for (const g of geos.values()) g.dispose();
  mats.clear(); geos.clear();
}

export interface StdOpts { rough?: number; metal?: number; emissive?: string; ei?: number; opacity?: number; side?: THREE.Side; flat?: boolean }

export function std(color: string, o: StdOpts = {}): THREE.MeshStandardMaterial {
  color = color || '#888888';
  const k = `std|${color}|${o.rough ?? 0.6}|${o.metal ?? 0.05}|${o.emissive ?? ''}|${o.ei ?? 1}|${o.opacity ?? 1}|${o.side ?? 0}|${o.flat ? 1 : 0}`;
  let m = mats.get(k) as THREE.MeshStandardMaterial | undefined;
  if (!m) {
    m = new THREE.MeshStandardMaterial({
      color, roughness: o.rough ?? 0.6, metalness: o.metal ?? 0.05,
      emissive: o.emissive ? new THREE.Color(o.emissive) : new THREE.Color(0), emissiveIntensity: o.ei ?? 1,
      transparent: (o.opacity ?? 1) < 1, opacity: o.opacity ?? 1, side: o.side ?? THREE.FrontSide, flatShading: !!o.flat,
      depthWrite: (o.opacity ?? 1) >= 1,
    });
    mats.set(k, m);
  }
  return m;
}

/** Unlit glowing colour (screens, LEDs, rings). Picked up by bloom. */
export function glow(color: string, opacity = 1, additive = false, intensity = 1.5): THREE.MeshBasicMaterial {
  color = color || '#7cf7ff';
  const k = `glow|${color}|${opacity}|${additive ? 1 : 0}|${intensity}`;
  let m = mats.get(k) as THREE.MeshBasicMaterial | undefined;
  if (!m) {
    m = new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(intensity), transparent: opacity < 1 || additive, opacity, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending, depthWrite: !(opacity < 1 || additive), side: THREE.DoubleSide, toneMapped: false });
    mats.set(k, m);
  }
  return m;
}

/** Textured screen. Keyed by texture uuid. */
export function screen(tex: THREE.Texture, brightness = 1): THREE.MeshBasicMaterial {
  const k = `screen|${tex.uuid}|${brightness}`;
  let m = mats.get(k) as THREE.MeshBasicMaterial | undefined;
  if (!m) { m = new THREE.MeshBasicMaterial({ map: tex, color: new THREE.Color(brightness, brightness, brightness), toneMapped: false }); mats.set(k, m); }
  return m;
}

const FRESNEL_VERT = /* glsl */`
  varying vec3 vN; varying vec3 vV; varying vec3 vW;
  #include <common>
  #include <fog_pars_vertex>
  void main() {
    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    vN = normalize(normalMatrix * normal);
    vV = normalize(-mvPosition.xyz);
    vW = (modelMatrix * vec4(position, 1.0)).xyz;
    gl_Position = projectionMatrix * mvPosition;
    #include <fog_vertex>
  }`;
const FRESNEL_FRAG = /* glsl */`
  uniform vec3 uColor; uniform vec3 uRim; uniform float uBase; uniform float uRimAlpha; uniform float uPower; uniform float uIrid; uniform float uTime; uniform float uBands;
  varying vec3 vN; varying vec3 vV; varying vec3 vW;
  #include <common>
  #include <fog_pars_fragment>
  void main() {
    float f = 1.0 - abs(dot(normalize(vN), normalize(vV)));
    float rim = pow(f, uPower);
    vec3 irid = 0.55 + 0.45 * cos(6.2831 * (vec3(0.0, 0.33, 0.67) + f * 1.3 + vW.y * 0.12 + (vW.x + vW.z) * 0.015 + uTime * 0.04));
    vec3 col = mix(uColor, irid, uIrid * rim);
    col = mix(col, uRim, rim * 0.55);
    float bands = uBands > 0.0 ? (0.5 + 0.5 * sin(vW.y * 9.0 - uTime * 1.6 + sin(vW.x * 1.7 + vW.z * 1.3) * 1.5)) : 0.0;
    float a = uBase + rim * uRimAlpha + bands * uBands * (0.25 + rim);
    gl_FragColor = vec4(col * (0.6 + rim * 0.85 + bands * uBands * 1.5), clamp(a, 0.0, 0.85));
    #include <fog_fragment>
  }`;

export interface FresnelOpts { color: string; rim: string; base?: number; rimAlpha?: number; power?: number; irid?: number; bands?: number; additive?: boolean }

/** Soap-bubble glass: transparent in the middle, iridescent glowing rims. Shared per parameter set. */
export function fresnel(o: FresnelOpts): THREE.ShaderMaterial {
  const k = `fres|${o.color}|${o.rim}|${o.base ?? 0.04}|${o.rimAlpha ?? 0.55}|${o.power ?? 2.4}|${o.irid ?? 0.8}|${o.bands ?? 0}|${o.additive ? 1 : 0}`;
  let m = mats.get(k) as THREE.ShaderMaterial | undefined;
  if (!m) {
    m = new THREE.ShaderMaterial({
      uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {
        uColor: { value: new THREE.Color(o.color) }, uRim: { value: new THREE.Color(o.rim) },
        uBase: { value: o.base ?? 0.04 }, uRimAlpha: { value: o.rimAlpha ?? 0.55 }, uPower: { value: o.power ?? 2.4 },
        uIrid: { value: o.irid ?? 0.8 }, uTime: { value: 0 }, uBands: { value: o.bands ?? 0 },
      }]),
      vertexShader: FRESNEL_VERT, fragmentShader: FRESNEL_FRAG,
      transparent: true, depthWrite: false, side: THREE.DoubleSide, fog: true,
      blending: o.additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    m.userData.fresnel = true;
    mats.set(k, m);
  }
  return m;
}

/** Advance time on every animated shared shader. */
export function tickShared(t: number) {
  for (const m of mats.values()) if ((m as THREE.ShaderMaterial).userData?.fresnel) (m as THREE.ShaderMaterial).uniforms.uTime.value = t;
}

// ---------- unit geometries ----------

function g<T extends THREE.BufferGeometry>(k: string, make: () => T): T {
  let x = geos.get(k) as T | undefined;
  if (!x) { x = make(); geos.set(k, x); }
  return x;
}
export const unitBox = () => g('box', () => new THREE.BoxGeometry(1, 1, 1));
export const roundBox = (r = 0.18) => g(`rbox|${r}`, () => new RoundedBoxGeometry(1, 1, 1, 2, r));
export const unitSphere = (detail = 1) => g(`sph|${detail}`, () => new THREE.SphereGeometry(0.5, detail ? 20 : 10, detail ? 14 : 7));
export const unitCyl = (seg = 20) => g(`cyl|${seg}`, () => new THREE.CylinderGeometry(0.5, 0.5, 1, seg));
export const unitCone = (seg = 16) => g(`cone|${seg}`, () => new THREE.ConeGeometry(0.5, 1, seg));
export const unitCapsule = () => g('caps', () => new THREE.CapsuleGeometry(0.5, 1, 4, 12));
export const unitPlane = () => g('plane', () => new THREE.PlaneGeometry(1, 1));
export const frustum = (top: number, seg = 20) => g(`frus|${top}|${seg}`, () => new THREE.CylinderGeometry(top * 0.5, 0.5, 1, seg, 1, true));
export const ring = (inner: number, seg = 40) => g(`ring|${inner}`, () => new THREE.RingGeometry(inner * 0.5, 0.5, seg));
export const torus = (tube: number, arc = Math.PI * 2) => g(`torus|${tube}|${arc}`, () => new THREE.TorusGeometry(0.5, tube, 10, 36, arc));
export const sphereCap = (theta: number) => g(`cap|${theta}`, () => new THREE.SphereGeometry(0.5, 24, 14, 0, Math.PI * 2, 0, theta));
export const shared = g;

/** A mesh using shared geometry/material, scaled and positioned. */
export function mesh(geo: THREE.BufferGeometry, mat: THREE.Material, sx: number, sy: number, sz: number, x = 0, y = 0, z = 0): THREE.Mesh {
  const m = new THREE.Mesh(geo, mat);
  m.scale.set(sx, sy, sz);
  m.position.set(x, y, z);
  m.userData.sharedGeo = true;
  return m;
}

/** Dispose an object tree's own (non-shared) geometries, materials and textures. */
export function disposeTree(o: THREE.Object3D) {
  o.traverse((c) => {
    const m = c as THREE.Mesh;
    if (m.geometry && !m.userData.sharedGeo && !(c as THREE.Sprite).isSprite) m.geometry.dispose();
    if (m.userData.ownMaterial) {
      const list = Array.isArray(m.material) ? m.material : [m.material];
      for (const x of list) { (x as THREE.MeshBasicMaterial).map?.dispose(); x.dispose(); }
    }
  });
}
