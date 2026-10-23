// The brain universe: every brain the owner started, floating together. The open brain sits in the
// middle, the others around it, and brains that share skills are joined by bundles of nerves that run
// from stem to stem. Click a brain to open it; Start new brain grows a new one that already knows
// the other brains' skills (see brainUniverse.ts and the brain library in persistence/brains.ts).
import { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { Brain, Plus, Trash2 } from 'lucide-react';
import { useStore } from '../store/store';
import { summarize, type BrainSummary } from '../persistence/brains';
import { brainLinks, brainPlaces, type BrainLink } from './brainUniverse';
import { buildBrainGeometry, holoBrainMaterial } from './brainMesh';
import { STEM_BASE, hash, rng } from './nerveTree';
import { useSpin } from './spin';
import { SpinToggle } from './BrainScene';
import { confirmAction } from '../ui/primitives';

const PALETTE = ['#ff5a74', '#5ad2ff', '#b28cff', '#ffc46b', '#78f7b0', '#ff9a74', '#4ff0d0', '#e0a8ff'];
const colorOf = (b: Pick<BrainSummary, 'id' | 'color'>) => b.color ?? PALETTE[hash(b.id) % PALETTE.length];
const OPEN_SCALE = 1, OTHER_SCALE = 0.74;

function glowTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const g = c.getContext('2d')!;
  const grd = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grd.addColorStop(0, 'rgba(255,255,255,1)'); grd.addColorStop(0.35, 'rgba(255,255,255,.35)'); grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd; g.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

/** The nerves of one link: a bundle of tubes from one brain's stem to the other's, sagging below like a cable. */
function nerveBundle(link: BrainLink, from: THREE.Vector3, to: THREE.Vector3): { geometry: THREE.BufferGeometry | null; curves: THREE.CatmullRomCurve3[] } {
  const r = rng(hash(link.a + link.b));
  const parts: THREE.BufferGeometry[] = [];
  const curves: THREE.CatmullRomCurve3[] = [];
  const side = new THREE.Vector3().subVectors(to, from).cross(new THREE.Vector3(0, 1, 0)).normalize();
  for (let i = 0; i < link.strength; i++) {
    const sag = 0.3 + r() * 0.3, sway = (r() - 0.5) * 0.4, spread = (r() - 0.5) * 0.09;
    const a = from.clone().add(side.clone().multiplyScalar(spread));
    const d = to.clone().add(side.clone().multiplyScalar(spread));
    const b = a.clone().lerp(d, 0.3).add(new THREE.Vector3(0, -sag * 0.75, 0)).add(side.clone().multiplyScalar(sway));
    const c = a.clone().lerp(d, 0.7).add(new THREE.Vector3(0, -sag, 0)).add(side.clone().multiplyScalar(sway * 0.6));
    const curve = new THREE.CatmullRomCurve3([a, b, c, d], false, 'catmullrom', 0.6);
    curves.push(curve);
    parts.push(new THREE.TubeGeometry(curve, 56, 0.005 + r() * 0.005, 5, false));
  }
  const geometry = parts.length ? mergeGeometries(parts, false) : null;
  for (const p of parts) p.dispose();
  return { geometry, curves };
}

export default function BrainUniverse() {
  const host = useRef<HTMLDivElement>(null);
  const labels = useRef<HTMLDivElement>(null);
  const doc = useStore((s) => s.doc);
  const library = useStore((s) => s.brains);
  const [name, setName] = useState('');
  const all = useMemo<BrainSummary[]>(() => [summarize(doc, new Date().toISOString(), true), ...library], [doc, library]);
  const links = useMemo(() => brainLinks(all), [all]);
  const places = useMemo(() => brainPlaces(all), [all]);
  const key = JSON.stringify(all.map((b) => [b.id, b.name, b.agents, b.skillIds.length]));

  useEffect(() => { useStore.getState().refreshBrains(); }, []);

  useEffect(() => {
    const el = host.current, layer = labels.current;
    if (!el || !layer) return;
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(36, 1, 0.05, 80);
    camera.position.set(0.6, 2.4, all.length > 1 ? 7.6 : 4.2);
    const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, powerPreference: 'high-performance' });
    renderer.setClearColor(0x000000, 0);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.domElement.className = 'brain-webgl-canvas';
    renderer.domElement.setAttribute('aria-hidden', 'true');
    el.prepend(renderer.domElement);
    const orbit = new OrbitControls(camera, renderer.domElement);
    orbit.target.set(0, -0.35, 0);
    orbit.enableDamping = true; orbit.dampingFactor = 0.08; orbit.enablePan = false;
    orbit.minDistance = 2.2; orbit.maxDistance = 16;
    const calm = !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    orbit.autoRotate = !calm && useSpin.getState().on; orbit.autoRotateSpeed = 0.35;
    scene.add(new THREE.AmbientLight(0xffffff, 0.35));
    const key1 = new THREE.DirectionalLight(0xffe2e6, 1.1); key1.position.set(3, 4, 2); scene.add(key1);
    const key2 = new THREE.DirectionalLight(0x8fd8ff, 0.5); key2.position.set(-4, 1, -3); scene.add(key2);

    const geo = buildBrainGeometry(48);
    const glow = glowTexture();
    const disposables: { dispose(): void }[] = [geo, glow];
    const meshes: { id: string; mesh: THREE.Group; holo: ReturnType<typeof holoBrainMaterial>; hit: THREE.Mesh; label: HTMLDivElement; top: THREE.Vector3; open: boolean }[] = [];
    const pos = (id: string) => new THREE.Vector3(...(places[id] ?? [0, 0, 0]));
    for (const b of all) {
      const scale = b.open ? OPEN_SCALE : OTHER_SCALE;
      // every brain is a hologram in its own colour: the far surface first, the near one over it
      const holo = holoBrainMaterial(colorOf(b));
      const back = new THREE.Mesh(geo, holo.back); back.renderOrder = 0;
      const front = new THREE.Mesh(geo, holo.front); front.renderOrder = 1;
      back.userData.brainId = front.userData.brainId = b.id;
      // the brain turns about its brainstem, so the nerves to the other brains stay joined to the stem
      back.position.set(-STEM_BASE[0], 0, -STEM_BASE[2]); front.position.copy(back.position);
      const mesh = new THREE.Group(); mesh.add(back, front);
      mesh.position.copy(pos(b.id)); mesh.scale.setScalar(scale);
      scene.add(mesh); disposables.push(holo);
      if (b.open) holo.pulse(1);
      const sm = new THREE.SpriteMaterial({ map: glow, color: new THREE.Color(colorOf(b)), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: b.open ? 0.45 : 0.3 });
      const halo = new THREE.Sprite(sm); halo.position.copy(pos(b.id)).add(new THREE.Vector3(0, -0.1, 0)); halo.scale.setScalar(2.6 * scale); scene.add(halo); disposables.push(sm);
      const label = document.createElement('div');
      label.className = `brain-node-label universe-label${b.open ? ' is-root' : ''}`;
      label.textContent = `${b.name} · ${b.agents} agent${b.agents === 1 ? '' : 's'} · ${b.skillIds.length} skills${b.open ? ' · open' : ''}`;
      label.style.setProperty('--node-color', colorOf(b));
      layer.appendChild(label);
      meshes.push({ id: b.id, mesh, holo, hit: front, label, top: pos(b.id).add(new THREE.Vector3(0, 1.08 * scale, 0)), open: b.open });
    }
    // the nerves between brains that share skills, stem to stem
    const pulses: { curve: THREE.CatmullRomCurve3; sprite: THREE.Sprite; t: number; speed: number }[] = [];
    for (const link of links) {
      const sa = all.find((b) => b.id === link.a)!.open ? OPEN_SCALE : OTHER_SCALE, sb = all.find((b) => b.id === link.b)!.open ? OPEN_SCALE : OTHER_SCALE;
      // each brain's stem sits on its turning axis (see above), right under the brain's place
      const from = pos(link.a).add(new THREE.Vector3(0, STEM_BASE[1] * sa, 0));
      const to = pos(link.b).add(new THREE.Vector3(0, STEM_BASE[1] * sb, 0));
      const { geometry, curves } = nerveBundle(link, from, to);
      if (!geometry) continue;
      const mat = new THREE.MeshBasicMaterial({ color: new THREE.Color('#ff6a84'), transparent: true, opacity: 0.6, blending: THREE.AdditiveBlending, depthWrite: false });
      const mesh = new THREE.Mesh(geometry, mat); mesh.renderOrder = 2; scene.add(mesh); disposables.push(geometry, mat);
      for (let i = 0; i < Math.min(3, curves.length); i++) {
        const sm = new THREE.SpriteMaterial({ map: glow, color: new THREE.Color('#fff1f3'), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
        const sprite = new THREE.Sprite(sm); sprite.scale.setScalar(0.09); scene.add(sprite); disposables.push(sm);
        pulses.push({ curve: curves[i], sprite, t: Math.random(), speed: 0.12 + Math.random() * 0.1 });
      }
    }
    // click a brain to open it (a drag is not a click)
    const ray = new THREE.Raycaster(); const ndc = new THREE.Vector2();
    let down: { x: number; y: number } | null = null;
    const onDown = (e: PointerEvent) => { down = { x: e.clientX, y: e.clientY }; };
    const onUp = (e: PointerEvent) => {
      if (!down || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 6) { down = null; return; }
      down = null;
      const r = renderer.domElement.getBoundingClientRect();
      ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
      ray.setFromCamera(ndc, camera);
      const hit = ray.intersectObjects(meshes.map((m) => m.hit), false)[0];
      const id = hit?.object.userData.brainId as string | undefined;
      const target = id ? all.find((b) => b.id === id) : null;
      meshes.find((m) => m.id === id)?.holo.pulse(1);
      if (target && !target.open && useStore.getState().switchBrain(target.id)) useStore.getState().notify(`Opened the brain “${target.name}”. Its agents and tasks are back; the other brains wait in the universe.`);
    };
    renderer.domElement.addEventListener('pointerdown', onDown);
    renderer.domElement.addEventListener('pointerup', onUp);

    const resize = () => { const w = el.clientWidth || 1, h = el.clientHeight || 1; renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix(); };
    resize();
    const ro = new ResizeObserver(resize); ro.observe(el);
    const v = new THREE.Vector3();
    let raf = 0, last = performance.now();
    const frame = (now: number) => {
      const dt = Math.max(0, Math.min(0.05, (now - last) / 1000)); last = now; // the first frame can be stamped before last
      orbit.update();
      const spin = useSpin.getState().on && !calm;
      orbit.autoRotate = spin;
      for (const m of meshes) { if (spin) m.mesh.rotation.y += dt * (m.open ? 0.12 : 0.06); m.holo.update(now / 1000, dt); }
      for (const p of pulses) { p.t = (p.t + dt * p.speed) % 1; p.sprite.position.copy(p.curve.getPointAt(p.t)); }
      renderer.render(scene, camera);
      const w = el.clientWidth, h = el.clientHeight;
      for (const m of meshes) {
        v.copy(m.top).project(camera);
        const on = v.z < 1;
        m.label.style.opacity = on ? '1' : '0';
        m.label.style.transform = `translate(-50%, -100%) translate(${((v.x + 1) / 2) * w}px, ${((1 - v.y) / 2) * h}px)`;
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(raf); ro.disconnect();
      renderer.domElement.removeEventListener('pointerdown', onDown); renderer.domElement.removeEventListener('pointerup', onUp);
      for (const m of meshes) m.label.remove();
      for (const d of disposables) d.dispose();
      orbit.dispose(); renderer.dispose(); renderer.domElement.remove();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const start = () => {
    if (useStore.getState().startNewBrain(name)) { useStore.getState().notify(`“${name.trim() || 'The new brain'}” is growing. It already knows the other brains' skills; JARVIS is its core.`); setName(''); }
  };
  const open = all.find((b) => b.open)!;
  const sharedWith = (id: string) => links.filter((l) => l.a === id || l.b === id).map((l) => ({ other: all.find((b) => b.id === (l.a === id ? l.b : l.a))!, n: l.shared.length }));

  return (
    <div className="brain-canvas universe" ref={host}>
      <div className="brain-node-labels" ref={labels} />
      <div className="universe-tools"><SpinToggle /></div>
      <aside className="universe-panel">
        <h4><Brain size={14} /> Brain universe <span className="count">{all.length} brain{all.length === 1 ? '' : 's'}</span></h4>
        <p className="note">Each brain has its own JARVIS, agents and work. Brains that share skills are joined by nerves from their stems. A new brain starts with every skill the others learned, and skills keep flowing between them whenever you switch. Click a brain to open it; only the open brain's agents run.</p>
        <form className="universe-new" onSubmit={(e) => { e.preventDefault(); start(); }}>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name the new brain (e.g. Music, Fitness app)" aria-label="New brain name" maxLength={60} />
          <button className="btn sm primary" type="submit"><Plus size={13} /> Start new brain</button>
        </form>
        <ul className="universe-list">
          {all.map((b) => <li key={b.id} className={b.open ? 'is-open' : ''}>
            <span className="universe-dot" style={{ background: colorOf(b) }} />
            <div className="grow">
              <b>{b.name}</b>{b.open && <span className="small muted"> · open</span>}
              <div className="small muted">{b.agents} agent{b.agents === 1 ? '' : 's'} · {b.skillIds.length} skills{sharedWith(b.id).length ? ` · nerves to ${sharedWith(b.id).map((x) => `${x.other.name} (${x.n} shared)`).join(', ')}` : ''}</div>
            </div>
            {!b.open && <button className="btn sm" onClick={() => { if (useStore.getState().switchBrain(b.id)) useStore.getState().notify(`Opened the brain “${b.name}”.`); }}>Open</button>}
            {!b.open && <button className="btn icon sm" aria-label={`Delete the brain ${b.name}`} onClick={() => confirmAction({ title: `Delete the brain “${b.name}”?`, confirmLabel: 'Delete', body: 'Its agents, skills and tasks in the brain library are removed. Skills it already shared with other brains stay there. This cannot be undone.', onConfirm: () => { useStore.getState().deleteBrain(b.id); } })}><Trash2 size={13} /></button>}
          </li>)}
        </ul>
        <p className="small muted">Open now: {open.name}. Rename it from the name field at the top.</p>
      </aside>
    </div>
  );
}
