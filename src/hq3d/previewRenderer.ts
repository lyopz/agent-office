// Small three.js renderer behind AvatarPreview3D: one character on a glowing
// pedestal, studio lighting, idle animation, auto turntable and drag to rotate.
import * as THREE from 'three';
import type { Appearance } from '../model/types';
import { animateCharacter, buildCharacter } from './character3d';
import { disposeTree, glow, mesh, releaseShared, retainShared, std, torus, unitCyl } from './materials';

export interface PreviewHandle { setAppearance(a: Appearance): void; setAutoRotate(on: boolean): void; rotateBy(rad: number): void; dispose(): void }

export function createPreview(canvas: HTMLCanvasElement, wrap: HTMLElement, appearance: Appearance, opts: { autoRotate: boolean; reduced: boolean }): PreviewHandle | null {
  let renderer: THREE.WebGLRenderer;
  try { renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true }); } catch { return null; }
  retainShared();
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(30, 1, 0.05, 50);
  scene.add(new THREE.HemisphereLight('#cfe3ff', '#20142a', 1.3));
  const key = new THREE.DirectionalLight('#ffffff', 2.2); key.position.set(2, 3, 3); scene.add(key);
  const rim = new THREE.DirectionalLight('#7cf7ff', 1.6); rim.position.set(-2.5, 2, -2.5); scene.add(rim);
  const pedestal = new THREE.Group();
  pedestal.add(mesh(unitCyl(40), std('#141a2e', { metal: 0.6, rough: 0.3 }), 1.3, 0.08, 1.3, 0, -0.04, 0));
  const ringMat = glow(appearance.accent || '#7cf7ff');
  const ringMesh = mesh(torus(0.04), ringMat, 1.3, 1.3, 1.3, 0, 0.005, 0); ringMesh.rotation.x = Math.PI / 2;
  pedestal.add(ringMesh);
  scene.add(pedestal);
  const turn = new THREE.Group(); scene.add(turn);
  let char: THREE.Group | null = null;
  let rot = 0.5, auto = opts.autoRotate, raf = 0, t = 0, last = performance.now();
  const frameTo = (h: number) => {
    const dist = h * 2.55 + 0.4;
    camera.position.set(0, h * 0.68, dist); camera.lookAt(0, h * 0.52, 0);
  };
  const setAppearance = (a: Appearance) => {
    if (char) { turn.remove(char); disposeTree(char); }
    char = buildCharacter(a, 'preview');
    turn.add(char);
    ringMesh.material = glow(a.accent || '#7cf7ff');
    frameTo((char.userData.height as number) ?? 1.6);
  };
  setAppearance(appearance);
  const size = () => {
    const r = wrap.getBoundingClientRect();
    renderer.setSize(Math.max(1, r.width), Math.max(1, r.height), false);
    camera.aspect = r.width / Math.max(1, r.height); camera.updateProjectionMatrix();
  };
  size();
  const ro = new ResizeObserver(size); ro.observe(wrap);
  const loop = () => {
      const now = performance.now(); // rAF timestamps can stall in some embedders
    raf = requestAnimationFrame(loop);
    if (document.hidden) return;
    const dt = Math.min(0.05, (now - last) / 1000); last = now; t += dt;
    if (auto) rot += dt * 0.6;
    turn.rotation.y = rot;
    if (char) animateCharacter(char, 'idle', t, { reduced: opts.reduced });
    renderer.render(scene, camera);
  };
  raf = requestAnimationFrame(loop);
  return {
    setAppearance,
    setAutoRotate(on) { auto = on; },
    rotateBy(rad) { rot += rad; },
    dispose() {
      cancelAnimationFrame(raf); ro.disconnect();
      if (char) disposeTree(char);
      renderer.dispose();
      releaseShared();
    },
  };
}
