// The 3D brain: a realistic brain (folded hemispheres, cerebellum and
// brainstem) with the agents as its nerves. The main agent sits at the core,
// fed by the brainstem; every agent it creates grows out as a nerve bundle,
// and agents those agents create branch off again. Signals run along the
// nerves: work flows out to busy agents, handoffs travel through the shared
// manager, and finished work reports back to the core.
import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { RotateCcw } from 'lucide-react';
import { useStore } from '../store/store';
import type { Agent } from '../model/types';
import { teamOfAgent, teamsOf, type Team } from './connectome';
import { buildBrainGeometry, glassBrainMaterial, solidBrainMaterial } from './brainMesh';
import { buildNerveTree, pathToRoot, route, subtree, type NerveTree, type Path3 } from './nerveTree';
import { useBrainFocus } from './ConnectomeView';

const BUSY = new Set(['working', 'researching', 'thinking', 'communicating']);
const reduceMotion = () => typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;

/** The tree's shape only depends on who reports to whom, names, teams and colours. */
function treeKey(agents: Record<string, Agent>, teams: Team[]) {
  return JSON.stringify([Object.values(agents).map((a) => [a.id, a.identity.name, a.skills.supervisorId, a.identity.department]).sort(), teams.map((t) => [t.id, t.color])]);
}
export function treeOf(agents: Record<string, Agent>, teams: Team[]): NerveTree {
  return buildNerveTree(Object.values(agents).map((a) => {
    const teamId = teamOfAgent(teams, a.id);
    return { id: a.id, name: a.identity.name, supervisorId: a.skills.supervisorId ?? null, teamId, color: teams.find((t) => t.id === teamId)?.color ?? '#9fe6ff' };
  }));
}

const nerveVertex = `attribute float aT; varying float vT; varying vec3 vN; varying vec3 vV;
  void main(){ vT=aT; vec4 mv=modelViewMatrix*vec4(position,1.); vN=normalize(normalMatrix*normal); vV=normalize(-mv.xyz); gl_Position=projectionMatrix*mv; }`;
const nerveFragment = `uniform vec3 uColor; uniform float uGrow; uniform float uOpacity; uniform float uTime; varying float vT; varying vec3 vN; varying vec3 vV;
  void main(){ if(vT>uGrow) discard; float edge=pow(1.-abs(dot(normalize(vN),normalize(vV))),1.5);
    float front=smoothstep(uGrow-.06,uGrow,vT)*step(uGrow,1.25); float shimmer=.82+.18*sin(vT*38.-uTime*2.4);
    vec3 col=mix(uColor,vec3(1.),.18+front*.7)*shimmer; gl_FragColor=vec4(col*(.55+.45*(1.-edge)),uOpacity*(.5+.5*(1.-edge))+front*.5); }`;

function glowTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d')!, grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, 'rgba(255,255,255,1)'); grad.addColorStop(0.18, 'rgba(255,255,255,.85)'); grad.addColorStop(0.45, 'rgba(255,255,255,.25)'); grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad; g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Tubes for every strand of a path list, merged, with `aT` = how far along the nerve (offset..offset+span). */
function tubes(paths: Path3[], radius: (i: number) => number, offset: number, span: number) {
  const parts: THREE.BufferGeometry[] = [];
  paths.forEach((p, i) => {
    const pts: THREE.Vector3[] = [];
    for (let k = 0; k < p.length; k += 3) pts.push(new THREE.Vector3(p[k], p[k + 1], p[k + 2]));
    if (pts.length < 2) return;
    const seg = Math.max(8, pts.length);
    const geo = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), seg, radius(i), 4, false);
    const t = new Float32Array(geo.attributes.position.count);
    for (let v = 0; v < t.length; v++) t[v] = offset + (Math.floor(v / 5) / seg) * span;
    geo.setAttribute('aT', new THREE.BufferAttribute(t, 1));
    geo.deleteAttribute('uv');
    parts.push(geo);
  });
  if (!parts.length) return null;
  const merged = mergeGeometries(parts, false);
  parts.forEach((g) => g.dispose());
  return merged;
}

interface BundleMesh { id: string; to: string; from: string | null; mesh: THREE.Mesh; mat: THREE.ShaderMaterial; grow: number; growFrom: number; strands: { pts: Path3; cum: number[] }[] }
interface NodeView { id: string; sprite: THREE.Sprite; label: HTMLDivElement; base: number; pos: THREE.Vector3; screen: { x: number; y: number; on: boolean } }
interface Pulse { legs: { pts: Path3; cum: number[]; reverse: boolean }[]; leg: number; dist: number; speed: number; sprite: THREE.Sprite }

const cumulative = (p: Path3) => { const c = [0]; for (let i = 3; i < p.length; i += 3) c.push(c[c.length - 1] + Math.hypot(p[i] - p[i - 3], p[i + 1] - p[i - 2], p[i + 2] - p[i - 1])); return c; };
function sample(p: Path3, cum: number[], d: number, out: THREE.Vector3) {
  const total = cum[cum.length - 1]; d = Math.max(0, Math.min(total, d));
  let i = 1; while (i < cum.length - 1 && cum[i] < d) i++;
  const u = (d - cum[i - 1]) / ((cum[i] - cum[i - 1]) || 1), a = (i - 1) * 3, b = i * 3;
  return out.set(p[a] + (p[b] - p[a]) * u, p[a + 1] + (p[b + 1] - p[a + 1]) * u, p[a + 2] + (p[b + 2] - p[a + 2]) * u);
}

export default function BrainScene() {
  const host = useRef<HTMLDivElement>(null);
  const labels = useRef<HTMLDivElement>(null);
  const api = useRef<{ reset(): void; setSurface(s: 'glass' | 'solid'): void } | null>(null);
  const [surface, setSurface] = useState<'glass' | 'solid'>(() => { try { return localStorage.getItem('brain:surface') === 'solid' ? 'solid' : 'glass'; } catch { return 'glass'; } });
  const [hover, setHover] = useState<{ id: string; x: number; y: number } | null>(null);
  const agents = useStore((s) => s.doc.agents);
  const departments = useStore((s) => s.doc.departments);
  const teams = teamsOf({ agents, departments });
  const key = treeKey(agents, teams);
  const tree = useRef<NerveTree>(treeOf(agents, teams));
  const rebuild = useRef<((t: NerveTree) => void) | null>(null);

  useEffect(() => {
    const el = host.current, labelLayer = labels.current;
    if (!el || !labelLayer) return;
    const calm = reduceMotion();
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(34, 1, 0.05, 50);
    camera.position.set(-2.25, 0.62, 1.72);
    const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, powerPreference: 'high-performance' });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
    renderer.setClearColor(0x000000, 0);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.domElement.className = 'brain-webgl-canvas';
    renderer.domElement.setAttribute('aria-hidden', 'true');
    el.prepend(renderer.domElement);

    const orbit = new OrbitControls(camera, renderer.domElement);
    orbit.target.set(0, -0.08, -0.05);
    orbit.enableDamping = true; orbit.dampingFactor = 0.08; orbit.enablePan = false;
    orbit.minDistance = 1.6; orbit.maxDistance = 7;
    orbit.autoRotate = !calm; orbit.autoRotateSpeed = 0.45;
    orbit.saveState();
    let idleSince = performance.now();
    orbit.addEventListener('start', () => { orbit.autoRotate = false; });
    orbit.addEventListener('end', () => { idleSince = performance.now(); });

    // the brain itself
    const geo = buildBrainGeometry(64);
    const glass = glassBrainMaterial(), solid = solidBrainMaterial();
    const brain = new THREE.Mesh(geo, surface === 'solid' ? solid : glass);
    brain.renderOrder = 1;
    scene.add(brain);

    const glow = glowTexture();
    const nerves = new THREE.Group(); nerves.renderOrder = 2; scene.add(nerves);
    const nodeGroup = new THREE.Group(); scene.add(nodeGroup);
    const pulseGroup = new THREE.Group(); scene.add(pulseGroup);
    let bundles: BundleMesh[] = [];
    let nodes: NodeView[] = [];
    let pulses: Pulse[] = [];
    const known = new Set<string>();
    let started = performance.now();

    const disposeNerves = () => {
      for (const b of bundles) { b.mesh.geometry.dispose(); b.mat.dispose(); nerves.remove(b.mesh); }
      for (const n of nodes) { (n.sprite.material as THREE.Material).dispose(); nodeGroup.remove(n.sprite); n.label.remove(); }
      bundles = []; nodes = [];
    };
    const build = (t: NerveTree) => {
      const fresh = !known.size;
      disposeNerves();
      for (const b of t.bundles) {
        const size = t.nodes[b.to]?.size ?? 1;
        const strandR = b.id === 'trunk' ? 0.0075 : Math.min(0.0065, 0.0028 + 0.0009 * Math.sqrt(size));
        const a = tubes(b.strands, (i) => strandR * (0.6 + ((i * 37) % 10) / 20), 0, 1);
        const tf = tubes(b.tufts, () => strandR * 0.55, 1, 0.25);
        const g = a && tf ? mergeGeometries([a, tf], false) : a ?? tf;
        a?.dispose(); tf?.dispose();
        if (!g) continue;
        const mat = new THREE.ShaderMaterial({ vertexShader: nerveVertex, fragmentShader: nerveFragment, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, uniforms: { uColor: { value: new THREE.Color(b.color) }, uGrow: { value: 0 }, uOpacity: { value: 0.9 }, uTime: { value: 0 } } });
        const mesh = new THREE.Mesh(g, mat); mesh.renderOrder = 2;
        nerves.add(mesh);
        const isNew = !known.has(b.to);
        // on first load the tree grows out from the core one level at a time; later, only new agents grow
        const delay = fresh ? 0.3 + b.depth * 0.9 : 0;
        bundles.push({ id: b.id, to: b.to, from: b.from, mesh, mat, grow: isNew ? 0 : 1.25, growFrom: performance.now() / 1000 + delay, strands: b.strands.map((pts) => ({ pts, cum: cumulative(pts) })) });
      }
      for (const n of Object.values(t.nodes)) {
        const mat = new THREE.SpriteMaterial({ map: glow, color: new THREE.Color(n.color).lerp(new THREE.Color('#ffffff'), 0.35), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
        const sprite = new THREE.Sprite(mat);
        const base = n.depth === 0 ? 0.16 : 0.05 + 0.012 * Math.sqrt(n.size);
        sprite.scale.setScalar(base); sprite.position.set(...n.pos); sprite.renderOrder = 3;
        nodeGroup.add(sprite);
        const label = document.createElement('div');
        label.className = `brain-node-label${n.depth === 0 ? ' is-root' : ''}`;
        label.textContent = n.name; label.style.setProperty('--node-color', n.color);
        labelLayer.appendChild(label);
        nodes.push({ id: n.id, sprite, label, base, pos: new THREE.Vector3(...n.pos), screen: { x: 0, y: 0, on: false } });
      }
      for (const id of Object.keys(t.nodes)) known.add(id);
      known.add('trunk');
      if (fresh) started = performance.now();
    };
    rebuild.current = build;
    build(tree.current);

    // signals
    const bundleTo = (id: string) => bundles.find((b) => b.to === id && b.id !== 'trunk');
    const pulse = (chain: { b: BundleMesh; reverse: boolean }[], color: string, speed = 0.9) => {
      if (calm || pulses.length > 90 || !chain.length) return;
      const legs = chain.map(({ b, reverse }) => { const s = b.strands[Math.floor(Math.random() * b.strands.length)]; return { pts: s.pts, cum: s.cum, reverse }; });
      const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: glow, color: new THREE.Color(color).lerp(new THREE.Color('#ffffff'), 0.5), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
      sprite.scale.setScalar(0.06); sprite.renderOrder = 4;
      pulseGroup.add(sprite);
      pulses.push({ legs, leg: 0, dist: 0, speed, sprite });
    };
    /** Work flowing out from the core to an agent, through every manager on the way. */
    const outTo = (id: string, color: string) => {
      const chain = pathToRoot(tree.current, id).reverse().slice(1).map((q) => bundleTo(q)).filter(Boolean).map((b) => ({ b: b!, reverse: false }));
      pulse(chain, color);
    };
    const backFrom = (id: string) => {
      const chain = pathToRoot(tree.current, id).slice(0, -1).map((q) => bundleTo(q)).filter(Boolean).map((b) => ({ b: b!, reverse: true }));
      pulse(chain, '#ffffff', 1.1);
    };
    const handoff = (a: string, b: string, color: string) => {
      const path = route(tree.current, a, b);
      const chain: { b: BundleMesh; reverse: boolean }[] = [];
      for (let i = 0; i + 1 < path.length; i++) {
        const x = path[i], y = path[i + 1];
        if (tree.current.nodes[x]?.parentId === y) { const bm = bundleTo(x); if (bm) chain.push({ b: bm, reverse: true }); }
        else { const bm = bundleTo(y); if (bm) chain.push({ b: bm, reverse: false }); }
      }
      pulse(chain, color, 1);
    };
    let prevTasks = useStore.getState().runtime.tasks;
    const unsub = useStore.subscribe((s) => {
      const tasks = s.runtime.tasks;
      if (tasks === prevTasks) return;
      for (const t of Object.values(tasks)) {
        const was = prevTasks[t.id];
        if (was?.status === t.status || !t.agentId) continue;
        const color = tree.current.nodes[t.agentId]?.color ?? '#ffffff';
        if (t.handoff?.fromAgentId && t.handoff.fromAgentId !== t.agentId && (!was || t.status === 'in-transit') && t.status !== 'done') handoff(t.handoff.fromAgentId, t.agentId, color);
        else if (t.status === 'done') backFrom(t.agentId);
        else if (!was) outTo(t.agentId, color);
      }
      prevTasks = tasks;
    });

    const resize = () => {
      const { width, height } = el.getBoundingClientRect();
      if (!width || !height) return;
      camera.aspect = width / height;
      // keep the whole brain in view on narrow screens
      camera.fov = width / height < 1 ? 34 / Math.max(0.55, width / height) : 34;
      camera.updateProjectionMatrix();
      renderer.setSize(width, height, false);
    };
    const ro = new ResizeObserver(resize); ro.observe(el); resize();

    let mouse: { x: number; y: number } | null = null, down: { x: number; y: number } | null = null, hovered: string | null = null;
    const onMove = (e: PointerEvent) => { const r = el.getBoundingClientRect(); mouse = { x: e.clientX - r.left, y: e.clientY - r.top }; };
    const onLeave = () => { mouse = null; };
    const onDown = (e: PointerEvent) => { down = { x: e.clientX, y: e.clientY }; };
    const onUp = (e: PointerEvent) => {
      if (down && Math.hypot(e.clientX - down.x, e.clientY - down.y) < 5 && hovered) useStore.getState().setUi({ selection: { kind: 'agent', id: hovered }, profileAgentId: hovered, profileTab: 'identity' });
      down = null;
    };
    const onDbl = () => orbit.reset();
    el.addEventListener('pointermove', onMove); el.addEventListener('pointerleave', onLeave);
    el.addEventListener('pointerdown', onDown); el.addEventListener('pointerup', onUp); el.addEventListener('dblclick', onDbl);

    api.current = {
      reset: () => orbit.reset(),
      setSurface: (s) => { brain.material = s === 'solid' ? solid : glass; },
    };

    let raf = 0, last = performance.now(), nextAmbient = 0;
    const v = new THREE.Vector3();
    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      const dt = Math.min(0.05, (now - last) / 1000); last = now;
      if (!orbit.autoRotate && !calm && now - idleSince > 9000 && !down) orbit.autoRotate = true;
      orbit.update();
      const time = now / 1000;
      const st = useStore.getState();
      const focus = useBrainFocus.getState();
      const t = tree.current;
      // which agents are lit: hover or menu focus on an agent shows its line to the core and everyone under it
      const agentFocus = hovered ?? focus.agentId ?? focus.brainAgentId;
      const teamFocus = focus.teamId ?? focus.selectedTeamId;
      let lit: Set<string> | null = null;
      if (agentFocus && t.nodes[agentFocus]) { lit = subtree(t, agentFocus); for (const q of pathToRoot(t, agentFocus)) lit.add(q); }
      else if (teamFocus) { lit = new Set(Object.values(t.nodes).filter((n) => n.teamId === teamFocus).map((n) => n.id)); }
      for (const b of bundles) {
        if (now / 1000 >= b.growFrom && b.grow < 1.25) b.grow = calm ? 1.25 : Math.min(1.25, b.grow + dt * 1.1);
        b.mat.uniforms.uGrow.value = b.grow;
        b.mat.uniforms.uTime.value = time;
        const on = !lit || lit.has(b.to);
        const target = on ? (lit ? 1 : 0.85) : 0.08;
        b.mat.uniforms.uOpacity.value += (target - b.mat.uniforms.uOpacity.value) * Math.min(1, dt * 6);
      }
      // ambient: busy agents keep receiving work from the core
      if (!calm && now > nextAmbient) {
        const busy = Object.keys(t.nodes).filter((id) => BUSY.has(st.runtime.agents[id]?.status ?? '') && t.nodes[id].depth > 0);
        const id = busy.length ? busy[Math.floor(Math.random() * busy.length)] : null;
        if (id) outTo(id, t.nodes[id].color);
        else if (bundles.length > 1) { const b = bundles[1 + Math.floor(Math.random() * (bundles.length - 1))]; outTo(b.to, t.nodes[b.to]?.color ?? '#fff'); }
        nextAmbient = now + (busy.length ? 650 : 1800) + Math.random() * 600;
      }
      const keep: Pulse[] = [];
      for (const p of pulses) {
        const leg = p.legs[p.leg], total = leg.cum[leg.cum.length - 1];
        p.dist += p.speed * dt;
        if (p.dist >= total) { p.leg++; p.dist = 0; if (p.leg >= p.legs.length) { (p.sprite.material as THREE.Material).dispose(); pulseGroup.remove(p.sprite); continue; } }
        const l = p.legs[p.leg];
        sample(l.pts, l.cum, l.reverse ? l.cum[l.cum.length - 1] - p.dist : p.dist, p.sprite.position);
        keep.push(p);
      }
      pulses = keep;
      // nodes and labels
      const { width, height } = el.getBoundingClientRect();
      const many = nodes.length > 22;
      let best: { id: string; d: number; x: number; y: number } | null = null;
      for (const n of nodes) {
        const node = t.nodes[n.id]; if (!node) continue;
        const grownIn = n.id === t.rootId || (bundleTo(n.id)?.grow ?? 1.25) >= 0.98;
        const on = !lit || lit.has(n.id);
        const busy = BUSY.has(st.runtime.agents[n.id]?.status ?? '');
        const beat = busy && !calm ? 1 + 0.18 * Math.sin(time * 5 + n.base * 40) : 1;
        n.sprite.scale.setScalar(grownIn ? n.base * beat * (on ? 1 : 0.6) : 0.0001);
        (n.sprite.material as THREE.SpriteMaterial).opacity = on ? 1 : 0.25;
        v.copy(n.pos).project(camera);
        const x = (v.x * 0.5 + 0.5) * width, y = (-v.y * 0.5 + 0.5) * height, front = v.z < 1;
        n.screen = { x, y, on: front };
        const show = grownIn && front && (node.depth <= 1 || !many || (lit ? lit.has(n.id) : false) || hovered === n.id);
        n.label.style.transform = `translate(${x.toFixed(1)}px, ${(y - 10).toFixed(1)}px) translate(-50%, -100%)`;
        n.label.style.opacity = show ? (on ? '1' : '.28') : '0';
        if (mouse && grownIn && front) { const d = Math.hypot(mouse.x - x, mouse.y - y); if (d < 16 && (!best || d < best.d)) best = { id: n.id, d, x, y }; }
      }
      const nh = best?.id ?? null;
      if (nh !== hovered) { hovered = nh; el.style.cursor = nh ? 'pointer' : ''; setHover(best ? { id: best.id, x: best.x, y: best.y } : null); }
      renderer.render(scene, camera);
    };
    raf = requestAnimationFrame(frame);
    void started;

    return () => {
      cancelAnimationFrame(raf); unsub(); ro.disconnect();
      el.removeEventListener('pointermove', onMove); el.removeEventListener('pointerleave', onLeave);
      el.removeEventListener('pointerdown', onDown); el.removeEventListener('pointerup', onUp); el.removeEventListener('dblclick', onDbl);
      disposeNerves();
      for (const p of pulses) (p.sprite.material as THREE.Material).dispose();
      orbit.dispose(); geo.dispose(); glass.dispose(); solid.dispose(); glow.dispose();
      renderer.dispose(); renderer.domElement.remove();
      api.current = null; rebuild.current = null;
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // a new agent, or a new reporting line, regrows the tree; new branches grow in from their manager
  useEffect(() => {
    tree.current = treeOf(agents, teams);
    rebuild.current?.(tree.current);
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { api.current?.setSurface(surface); try { localStorage.setItem('brain:surface', surface); } catch { /* storage unavailable */ } }, [surface]);

  const hoverAgent = hover ? agents[hover.id] : null;
  const hoverNode = hover ? tree.current.nodes[hover.id] : null;
  const reports = hoverNode?.childIds.length ?? 0;
  return <div className="brain-object-wrap">
    <div ref={host} className="brain-scene" aria-label="Three-dimensional brain. The main agent sits at the core and every agent it creates branches out as a nerve. Drag to rotate, scroll to zoom, double-click to reset.">
      <div ref={labels} className="brain-node-labels" aria-hidden="true" />
      {hover && hoverAgent && <div className="brain-node-tip" style={{ left: hover.x, top: hover.y + 14 }}>
        <b>{hoverAgent.identity.name}</b><span>{hoverAgent.identity.title}</span>
        <small>{hoverNode?.depth === 0 ? 'Main agent · the core of the brain' : `Branch of ${tree.current.nodes[hoverNode?.parentId ?? '']?.name ?? 'the core'}`}{reports ? ` · ${reports} agent${reports === 1 ? '' : 's'} branch from it` : ''}</small>
      </div>}
    </div>
    <div className="brain-rotate-tools">
      <span>DRAG TO ORBIT · SCROLL TO ZOOM · CLICK A NODE FOR ITS AGENT</span>
      <div className="seg brain-surface" role="group" aria-label="Brain surface">
        <button className="btn sm" aria-pressed={surface === 'glass'} onClick={() => setSurface('glass')}>Glass</button>
        <button className="btn sm" aria-pressed={surface === 'solid'} onClick={() => setSurface('solid')}>Tissue</button>
      </div>
      <button className="btn icon sm" aria-label="Reset brain view" title="Reset view" onClick={() => api.current?.reset()}><RotateCcw size={13}/></button>
    </div>
  </div>;
}
