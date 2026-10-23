// The 3D brain: a realistic brain (folded hemispheres, cerebellum and
// brainstem) with the agents as its nerves. The main agent sits at the core,
// fed by the brainstem; every agent it creates grows out as a nerve bundle,
// and agents those agents create branch off again. Signals run along the
// nerves: work flows out to busy agents, handoffs travel through the shared
// manager, and finished work reports back to the core. Ideas, the owner's or
// the main agent's own, sprout as buds; growing one adds a new agent and the
// bud becomes a full branch. Bloom, drifting neural dust and synapse flashes
// make the activity readable at a glance. Every brain is a hologram in the
// colour the owner picked for it (the brain picker chooses which brain).
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { Pause, Play, RotateCcw } from 'lucide-react';
import { useStore } from '../store/store';
import type { Agent } from '../model/types';
import { teamOfAgent, teamsOf, type Team } from './connectome';
import { MAIN_BRAIN, brainColor, buildBrainGeometry, holoBrainMaterial } from './brainMesh';
import { brainRing, ringBrainsOf } from './brainRing';
import { brainWire, loadBrainModel } from './brainModel';
import { useSpin } from './spin';
import BrainColorPicker from './BrainColor';
import { CEREBRUM, buildNerveTree, ideaSprouts, insideCerebrum, pathToRoot, route, subtree, type IdeaSprout, type NerveTree, type Path3 } from './nerveTree';
import { growIdeaOps, openIdeas, treeIdeas } from './ideas';
import { confirmAction } from '../ui/primitives';
import { useBrainFocus } from './ConnectomeView';
import { useOrigin } from './useOrigin';
import { ORIGIN_ID, branchKind } from './opportunity';

const BUSY = new Set(['working', 'researching', 'thinking', 'communicating']);
const reduceMotion = () => typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;

/** The tree's shape only depends on who reports to whom, names, teams and colours. */
function treeKey(agents: Record<string, Agent>, teams: Team[]) {
  return JSON.stringify([Object.values(agents).map((a) => [a.id, a.identity.name, a.skills.supervisorId, a.identity.department, a.branch?.kind ?? '']).sort(), teams.map((t) => [t.id, t.color])]);
}
/**
 * The agents the brain shows: JARVIS and the branches it grew (its ventures
 * and their skill agents). The other agents still exist and work; they just
 * aren't nerves. With no JARVIS, every agent is shown.
 */
export function brainAgents(agents: Record<string, Agent>): Agent[] {
  const all = Object.values(agents);
  if (!agents[ORIGIN_ID]) return all;
  return all.filter((a) => branchKind({ agents }, a.id) !== 'core');
}
export function treeOf(agents: Record<string, Agent>, teams: Team[]): NerveTree {
  return buildNerveTree(brainAgents(agents).map((a) => {
    const teamId = teamOfAgent(teams, a.id);
    return { id: a.id, name: a.identity.name, supervisorId: a.skills.supervisorId ?? null, teamId, color: teams.find((t) => t.id === teamId)?.color ?? '#9fe6ff' };
  }));
}

const nerveVertex = `attribute float aT; varying float vT; varying vec3 vN; varying vec3 vV;
  void main(){ vT=aT; vec4 mv=modelViewMatrix*vec4(position,1.); vN=normalize(normalMatrix*normal); vV=normalize(-mv.xyz); gl_Position=projectionMatrix*mv; }`;
const nerveFragment = `uniform vec3 uColor; uniform float uGrow; uniform float uOpacity; uniform float uTime; varying float vT; varying vec3 vN; varying vec3 vV;
  void main(){ if(vT>uGrow) discard; float edge=pow(1.-abs(dot(normalize(vN),normalize(vV))),1.5);
    float front=smoothstep(uGrow-.06,uGrow,vT)*step(uGrow,1.25); float shimmer=.82+.18*sin(vT*38.-uTime*2.4);
    vec3 col=mix(uColor,vec3(1.),.04+front*.6)*shimmer*(1.+front*.7); gl_FragColor=vec4(col*(.42+.38*(1.-edge)),uOpacity*(.35+.5*(1.-edge))+front*.6); }`;

/** Neural dust: faint motes drifting through the brain. */
const dustVertex = `uniform float uTime; uniform float uScale; attribute float aSeed; varying float vA;
  void main(){ vec3 p=position; p+=vec3(sin(uTime*.21+aSeed*6.3),cos(uTime*.17+aSeed*4.1),sin(uTime*.13+aSeed*9.7))*.025;
    vec4 mv=modelViewMatrix*vec4(p,1.); gl_Position=projectionMatrix*mv; vA=.35+.65*(.5+.5*sin(uTime*1.3+aSeed*40.));
    gl_PointSize=uScale*(1.+aSeed*1.6)/-mv.z; }`;
const dustFragment = `uniform vec3 uColor; varying float vA; void main(){ vec2 c=gl_PointCoord-.5; float d=length(c); if(d>.5) discard; gl_FragColor=vec4(mix(uColor,vec3(1.),.45)*vA,(1.-d*2.)*vA*.28); }`;

function backdrop() {
  const c = document.createElement('canvas'); c.width = c.height = 512;
  const g = c.getContext('2d')!, grad = g.createRadialGradient(256, 236, 10, 256, 256, 360);
  grad.addColorStop(0, '#0d1a33'); grad.addColorStop(0.45, '#070c1a'); grad.addColorStop(1, '#020309');
  g.fillStyle = grad; g.fillRect(0, 0, 512, 512);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

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
interface NodeView { id: string; sprite: THREE.Sprite; label: HTMLDivElement; base: number; pos: THREE.Vector3; screen: { x: number; y: number; on: boolean }; flash: number }
interface Pulse { legs: { pts: Path3; cum: number[]; reverse: boolean }[]; leg: number; dist: number; speed: number; sprite: THREE.Sprite; trail: THREE.Sprite[]; ends: (string | null)[] }
interface Bud { id: string; mesh: THREE.Mesh; mat: THREE.ShaderMaterial; sprite: THREE.Sprite; halo: THREE.Sprite; pos: THREE.Vector3; grow: number; seed: number; owner: boolean }
interface Ring { sprite: THREE.Sprite; age: number }
const TRAIL = 5;

const cumulative = (p: Path3) => { const c = [0]; for (let i = 3; i < p.length; i += 3) c.push(c[c.length - 1] + Math.hypot(p[i] - p[i - 3], p[i + 1] - p[i - 2], p[i + 2] - p[i - 1])); return c; };
function sample(p: Path3, cum: number[], d: number, out: THREE.Vector3) {
  const total = cum[cum.length - 1]; d = Math.max(0, Math.min(total, d));
  let i = 1; while (i < cum.length - 1 && cum[i] < d) i++;
  const u = (d - cum[i - 1]) / ((cum[i] - cum[i - 1]) || 1), a = (i - 1) * 3, b = i * 3;
  return out.set(p[a] + (p[b] - p[a]) * u, p[a + 1] + (p[b + 1] - p[a + 1]) * u, p[a + 2] + (p[b + 2] - p[a + 2]) * u);
}

/** The brain the owner has picked in the brain picker: its key, its name and the colour it falls back to. */
export function selectedBrain(focus: { brainAgentId: string | null; selectedTeamId: string | null }, teams: Team[], agents: Record<string, Agent>): { key: string; name: string; fallback: string } {
  if (focus.brainAgentId && agents[focus.brainAgentId]) {
    const team = teams.find((t) => t.agentIds.includes(focus.brainAgentId!));
    return { key: focus.brainAgentId, name: `${agents[focus.brainAgentId].identity.name} Brain`, fallback: team?.color ?? HOLO_FALLBACK };
  }
  const team = focus.selectedTeamId ? teams.find((t) => t.id === focus.selectedTeamId) : null;
  if (team) return { key: team.id, name: `${team.name} Brain`, fallback: team.color };
  return { key: MAIN_BRAIN, name: 'Main Brain', fallback: HOLO_FALLBACK };
}
const HOLO_FALLBACK = '#5fb8ff';

/** Ask the owner before an idea grows into a new agent under the main agent. */
export function askGrow(ideaId: string) {
  const s = useStore.getState();
  const idea = openIdeas(s.doc).find((e) => e.id === ideaId);
  const rootId = treeOf(s.doc.agents, teamsOf(s.doc)).rootId;
  if (!idea || !rootId) return;
  // only the main agent starts branches; a grown idea becomes one of its ventures
  const parentId = rootId;
  const { name, ops } = growIdeaOps(s.doc, idea, parentId);
  confirmAction({
    title: `Grow “${idea.title}” into a branch?`, confirmLabel: `Grow ${name}`,
    body: `${s.doc.agents[parentId]?.identity.name ?? 'The main agent'} creates ${name}, an idea lead for this idea, and a new nerve branch grows from it. As a venture it can add only the skill agents this idea needs. ${name} starts on a simulated provider with manual approval, so nothing runs, spends or publishes without you.`,
    onConfirm: () => { const r = useStore.getState().commit(ops, `Grow idea: ${idea.title}`); useStore.getState().notify(r.ok ? `${name} branched off ${s.doc.agents[parentId]?.identity.name ?? 'the main agent'}` : r.errors.join(' · ')); },
  });
}

/** Stops or starts the brains turning on their own. */
export function SpinToggle() {
  const on = useSpin((s) => s.on);
  return <button className="btn sm brain-spin-toggle" aria-pressed={!on} onClick={() => useSpin.getState().toggle()} title={on ? 'Stop the brain turning' : 'Let the brain turn on its own'}>{on ? <Pause size={12} /> : <Play size={12} />} {on ? 'Stop spin' : 'Spin'}</button>;
}

export default function BrainScene() {
  const host = useRef<HTMLDivElement>(null);
  const labels = useRef<HTMLDivElement>(null);
  const api = useRef<{ reset(): void; setRegions(on: boolean): void } | null>(null);
  // the scene's own buttons sit under the JARVIS card, in the right column (see ConnectomeView)
  const [toolsHost, setToolsHost] = useState<HTMLElement | null>(null);
  useEffect(() => { setToolsHost(document.getElementById('brain-view-tools')); }, []);
  const [hover, setHover] = useState<{ id: string; x: number; y: number; idea?: boolean } | null>(null);
  const agents = useStore((s) => s.doc.agents);
  const teams = teamsOf({ agents });
  const key = treeKey(agents, teams);
  const tree = useRef<NerveTree>(treeOf(agents, teams));
  const rebuild = useRef<((t: NerveTree) => void) | null>(null);
  const library = useStore((s) => s.doc.library);
  const ideas = treeIdeas({ library });
  const ideaKey = JSON.stringify(ideas.map((i) => [i.id, i.authorId]));
  const sprouts = useRef<IdeaSprout[]>(ideaSprouts(tree.current, ideas));
  const regrowBuds = useRef<((s: IdeaSprout[]) => void) | null>(null);

  useEffect(() => {
    const el = host.current, labelLayer = labels.current;
    if (!el || !labelLayer) return;
    const calm = reduceMotion();
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(34, 1, 0.05, 50);
    // far enough back to see the ring of brains around the main one
    camera.position.set(-3.85, 2.05, 3.0); // close enough that the brain fills the middle, the ring just around it
    const renderer = new THREE.WebGLRenderer({ alpha: true, premultipliedAlpha: false, antialias: true, powerPreference: 'high-performance' });
    renderer.setClearColor(0x000000, 0);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    const sky = backdrop();
    const composer = new EffectComposer(renderer);
    composer.addPass(new RenderPass(scene, camera));
    const bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.22, 0.3, 0.72);
    composer.addPass(bloom);
    composer.addPass(new OutputPass());
    renderer.domElement.className = 'brain-webgl-canvas';
    renderer.domElement.setAttribute('aria-hidden', 'true');
    el.prepend(renderer.domElement);

    const orbit = new OrbitControls(camera, renderer.domElement);
    orbit.target.set(0, -0.08, -0.05);
    orbit.enableDamping = true; orbit.dampingFactor = 0.08; orbit.enablePan = false;
    orbit.minDistance = 1.6; orbit.maxDistance = 12;
    orbit.autoRotate = !calm && useSpin.getState().on; orbit.autoRotateSpeed = 0.45;
    orbit.saveState();
    let idleSince = performance.now();
    orbit.addEventListener('start', () => { orbit.autoRotate = false; });
    orbit.addEventListener('end', () => { idleSince = performance.now(); });

    // the brain itself: a hologram, drawn far surface first and near surface over it
    const geo = buildBrainGeometry(64);
    const pick0 = selectedBrain(useBrainFocus.getState(), teamsOf(useStore.getState().doc), useStore.getState().doc.agents);
    const holo = holoBrainMaterial(brainColor(useStore.getState().doc.appearance, pick0.key, pick0.fallback));
    const brainBack = new THREE.Mesh(geo, holo.back); brainBack.renderOrder = 0;
    const brain = new THREE.Mesh(geo, holo.front); brain.renderOrder = 1;
    scene.add(brainBack, brain);
    // the Blender model replaces the procedural shape once it loads, with bright edges and sparkles
    let model: { facets: THREE.BufferGeometry; mesh: THREE.BufferGeometry } | null = null, wire: ReturnType<typeof brainWire> | null = null, gone = false;
    void loadBrainModel().then((m) => {
      if (!m) return;
      if (gone) { m.facets.dispose(); m.mesh.dispose(); return; }
      model = m; brain.geometry = brainBack.geometry = m.facets;
      wire = brainWire(m.mesh); scene.add(wire.group);
      // the edges carry the light now, so the glass fill steps back to a dark glow
      holo.front.uniforms.uOpacity.value = 0.72; holo.back.uniforms.uOpacity.value = 0.5;
    });

    const glow = glowTexture();
    // neural dust inside the cerebrum
    const DUST = 650, dustPos = new Float32Array(DUST * 3), dustSeed = new Float32Array(DUST);
    { let i = 0, r = Math.random; while (i < DUST) { const p: [number, number, number] = [(r() * 2 - 1) * CEREBRUM[0], (r() * 2 - 1) * CEREBRUM[1] + 0.08, (r() * 2 - 1) * CEREBRUM[2]]; if (insideCerebrum(p) > 0.95) continue; dustPos.set(p, i * 3); dustSeed[i] = r(); i++; } }
    const dustGeo = new THREE.BufferGeometry();
    dustGeo.setAttribute('position', new THREE.BufferAttribute(dustPos, 3)); dustGeo.setAttribute('aSeed', new THREE.BufferAttribute(dustSeed, 1));
    const dustMat = new THREE.ShaderMaterial({ vertexShader: dustVertex, fragmentShader: dustFragment, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, uniforms: { uTime: { value: 0 }, uScale: { value: 7 }, uColor: { value: new THREE.Color(HOLO_FALLBACK) } } });
    const dust = new THREE.Points(dustGeo, dustMat); dust.renderOrder = 2; scene.add(dust);
    // the halo: the owner's other brains riding a glass ring around this one; click one to open it
    const openRingBrain = (id: string) => {
      const b = useStore.getState().brains.find((x) => x.id === id);
      if (!b) return;
      confirmAction({ title: `Open the brain “${b.name}”?`, confirmLabel: 'Open it', body: `This brain moves onto the ring and “${b.name}” opens in the middle, with its own JARVIS and agents. Click this brain on the ring to come back.`,
        onConfirm: () => { if (useStore.getState().switchBrain(id)) useStore.getState().notify(`Opened the brain “${b.name}”.`); } });
    };
    const halo = brainRing({ geo, glow, labelLayer, core: new THREE.Vector3(0, 0.08, 0), onPick: openRingBrain, radius: 2.15, tube: 0.15 });
    scene.add(halo.group);
    const nerves = new THREE.Group(); nerves.renderOrder = 2; scene.add(nerves);
    const nodeGroup = new THREE.Group(); scene.add(nodeGroup);
    const pulseGroup = new THREE.Group(); scene.add(pulseGroup);
    const budGroup = new THREE.Group(); scene.add(budGroup);
    let buds: Bud[] = [];
    let rings: Ring[] = [];
    const ring = (at: THREE.Vector3, color: string, size = 0.05) => {
      if (calm || rings.length > 40) return;
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: ringTex, color: new THREE.Color(color).lerp(new THREE.Color('#ffffff'), 0.4), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
      sp.position.copy(at); sp.scale.setScalar(size); sp.renderOrder = 5; pulseGroup.add(sp); rings.push({ sprite: sp, age: 0 });
    };
    const ringTex = (() => {
      const c = document.createElement('canvas'); c.width = c.height = 64; const g = c.getContext('2d')!;
      g.strokeStyle = 'rgba(255,255,255,1)'; g.lineWidth = 3; g.shadowColor = '#fff'; g.shadowBlur = 6; g.beginPath(); g.arc(32, 32, 26, 0, Math.PI * 2); g.stroke();
      const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
    })();
    const known = new Set<string>();
    const disposeBuds = () => { for (const b of buds) { b.mesh.geometry.dispose(); b.mat.dispose(); (b.sprite.material as THREE.Material).dispose(); (b.halo.material as THREE.Material).dispose(); budGroup.remove(b.mesh, b.sprite, b.halo); } buds = []; };
    const buildBuds = (list: IdeaSprout[]) => {
      const had = new Map(buds.map((b) => [b.id, b.grow]));
      disposeBuds();
      for (const sp of list) {
        const a = tubes(sp.strands, () => 0.0026, 0, 1), tf = tubes(sp.tufts, () => 0.0016, 1, 0.25);
        const g = a && tf ? mergeGeometries([a, tf], false) : a ?? tf; a?.dispose(); tf?.dispose();
        if (!g) continue;
        const color = sp.byOwner ? '#ffd27a' : '#9ff4ff';
        const mat = new THREE.ShaderMaterial({ vertexShader: nerveVertex, fragmentShader: nerveFragment, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, uniforms: { uColor: { value: new THREE.Color(color) }, uGrow: { value: 0 }, uOpacity: { value: 0.85 }, uTime: { value: 0 } } });
        const mesh = new THREE.Mesh(g, mat); mesh.renderOrder = 2;
        const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: glow, color: new THREE.Color(color), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
        const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: ringTex, color: new THREE.Color(color), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0.6 }));
        sprite.position.set(...sp.pos); halo.position.set(...sp.pos); sprite.renderOrder = halo.renderOrder = 4;
        budGroup.add(mesh, sprite, halo);
        buds.push({ id: sp.id, mesh, mat, sprite, halo, pos: new THREE.Vector3(...sp.pos), grow: had.get(sp.id) ?? (firstBuds ? -2.2 : 0), seed: (sp.pos[0] * 13.1 + sp.pos[2] * 7.3) % 1, owner: sp.byOwner });
      }
    };
    regrowBuds.current = (l) => { firstBuds = false; buildBuds(l); };
    let firstBuds = true;
    let bundles: BundleMesh[] = [];
    let nodes: NodeView[] = [];
    let pulses: Pulse[] = [];
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
        const strandR = b.id === 'trunk' ? 0.0058 : Math.min(0.005, 0.0024 + 0.0007 * Math.sqrt(size));
        const a = tubes(b.strands, (i) => strandR * (0.6 + ((i * 37) % 10) / 20), 0, 1);
        const tf = tubes(b.tufts, () => strandR * 0.55, 1, 0.25);
        const g = a && tf ? mergeGeometries([a, tf], false) : a ?? tf;
        a?.dispose(); tf?.dispose();
        if (!g) continue;
        const mat = new THREE.ShaderMaterial({ vertexShader: nerveVertex, fragmentShader: nerveFragment, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, uniforms: { uColor: { value: new THREE.Color(b.color) }, uGrow: { value: 0 }, uOpacity: { value: 0.8 }, uTime: { value: 0 } } });
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
        const base = n.depth === 0 ? 0.1 : 0.034 + 0.007 * Math.sqrt(n.size);
        sprite.scale.setScalar(base); sprite.position.set(...n.pos); sprite.renderOrder = 3;
        nodeGroup.add(sprite);
        const label = document.createElement('div');
        label.className = `brain-node-label${n.depth === 0 ? ' is-root' : ''}`;
        label.textContent = n.name; label.style.setProperty('--node-color', n.color);
        labelLayer.appendChild(label);
        nodes.push({ id: n.id, sprite, label, base, pos: new THREE.Vector3(...n.pos), screen: { x: 0, y: 0, on: false }, flash: 0 });
      }
      for (const id of Object.keys(t.nodes)) known.add(id);
      known.add('trunk');
      if (fresh) started = performance.now();
    };
    rebuild.current = build;
    build(tree.current);
    buildBuds(sprouts.current); firstBuds = false;

    // signals
    const bundleTo = (id: string) => bundles.find((b) => b.to === id && b.id !== 'trunk');
    const pulse = (chain: { b: BundleMesh; reverse: boolean }[], color: string, speed = 0.9) => {
      if (calm || pulses.length > 90 || !chain.length) return;
      const legs = chain.map(({ b, reverse }) => { const s = b.strands[Math.floor(Math.random() * b.strands.length)]; return { pts: s.pts, cum: s.cum, reverse }; });
      const mk = (k: number) => { const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: glow, color: new THREE.Color(color).lerp(new THREE.Color('#ffffff'), k ? 0.15 : 0.6), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: k ? 0.75 * (1 - k / (TRAIL + 1)) : 1 })); sp.scale.setScalar(k ? 0.03 * (1 - k / (TRAIL + 2)) : 0.045); sp.renderOrder = 4; pulseGroup.add(sp); return sp; };
      pulses.push({ legs, leg: 0, dist: 0, speed, sprite: mk(0), trail: Array.from({ length: TRAIL }, (_, k) => mk(k + 1)), ends: chain.map(({ b, reverse }) => (reverse ? b.from : b.to)) });
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
        if (t.handoff?.fromAgentId && t.handoff.fromAgentId !== t.agentId && !was && t.status !== 'done') handoff(t.handoff.fromAgentId, t.agentId, color);
        else if (t.status === 'done') backFrom(t.agentId);
        else if (!was) outTo(t.agentId, color);
      }
      prevTasks = tasks;
    });

    const resize = () => {
      const { width, height } = el.getBoundingClientRect();
      if (!width || !height) return;
      composer.setPixelRatio(renderer.getPixelRatio()); composer.setSize(width, height);
      // The canvas fills the window, but the brain is framed in the open space between the top bar
      // and the task track: the field of view covers that space, and the view shifts up to centre it.
      const [top, bottom] = el.closest('.brain-stage-view') ? (height < 850 ? [70, 210] : [70, 260]) : [0, 0];
      const room = Math.max(height * 0.45, height - top - bottom);
      const aspect = width / room;
      const fov = aspect < 1 ? 34 / Math.max(0.55, aspect) : 34; // keep the whole brain in view on narrow screens
      camera.aspect = width / height;
      camera.fov = THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(fov / 2)) * height / room));
      const shift = Math.round((bottom - top) / 2);
      if (shift) camera.setViewOffset(width, height, 0, shift, width, height); else camera.clearViewOffset();
      camera.updateProjectionMatrix();
      renderer.setSize(width, height, false);
    };
    const ro = new ResizeObserver(resize); ro.observe(el); resize();

    let mouse: { x: number; y: number } | null = null, down: { x: number; y: number } | null = null, hovered: string | null = null;
    const onMove = (e: PointerEvent) => { const r = el.getBoundingClientRect(); mouse = { x: e.clientX - r.left, y: e.clientY - r.top }; };
    const onLeave = () => { mouse = null; };
    const onDown = (e: PointerEvent) => { down = { x: e.clientX, y: e.clientY }; };
    const onUp = (e: PointerEvent) => {
      if (down && Math.hypot(e.clientX - down.x, e.clientY - down.y) < 5 && hovered) {
        if (buds.some((b) => b.id === hovered)) askGrow(hovered);
        else useStore.getState().setUi({ selection: { kind: 'agent', id: hovered }, profileAgentId: hovered, profileTab: 'identity' });
      }
      down = null;
    };
    const onDbl = () => orbit.reset();
    el.addEventListener('pointermove', onMove); el.addEventListener('pointerleave', onLeave);
    el.addEventListener('pointerdown', onDown); el.addEventListener('pointerup', onUp); el.addEventListener('dblclick', onDbl);

    api.current = {
      reset: () => orbit.reset(),
      setRegions: (on) => holo.setRegions(on),
    };

    let raf = 0, last = performance.now(), nextAmbient = 0;
    let prevDoc: unknown = null, prevFocus: unknown = null, prevBrains: unknown = null;
    const v = new THREE.Vector3();
    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      const dt = Math.max(0, Math.min(0.05, (now - last) / 1000)); last = now;
      const spin = useSpin.getState().on;
      if (!spin) orbit.autoRotate = false;
      else if (!orbit.autoRotate && !calm && now - idleSince > 9000 && !down) orbit.autoRotate = true;
      orbit.update();
      const time = now / 1000;
      const st = useStore.getState();
      const focus = useBrainFocus.getState();
      const t = tree.current;
      // the hologram wears the colour of the brain the owner picked
      if (st.doc !== prevDoc || focus !== prevFocus) {
        prevDoc = st.doc; prevFocus = focus;
        const pick = selectedBrain(focus, teamsOf(st.doc), st.doc.agents);
        holo.setColor(brainColor(st.doc.appearance, pick.key, pick.fallback));
      }
      if (st.brains !== prevBrains) { prevBrains = st.brains; halo.setBrains(ringBrainsOf(st.brains)); }
      holo.update(time, dt);
      (dustMat.uniforms.uColor.value as THREE.Color).copy(holo.front.uniforms.uColor.value as THREE.Color);
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
        const target = on ? (lit ? 0.95 : 0.72) : 0.07;
        b.mat.uniforms.uOpacity.value += (target - b.mat.uniforms.uOpacity.value) * Math.min(1, dt * 6);
      }
      // ambient: busy agents keep receiving work from the core
      if (!calm && now > nextAmbient) {
        const busy = Object.keys(t.nodes).filter((id) => BUSY.has(st.runtime.agents[id]?.status ?? '') && t.nodes[id].depth > 0);
        const id = busy.length ? busy[Math.floor(Math.random() * busy.length)] : null;
        if (id) outTo(id, t.nodes[id].color);
        // JARVIS's live run: its core fires while the runner works
        if (useOrigin.getState().status?.running && t.rootId) { const rn = nodes.find((q) => q.id === t.rootId); if (rn) { rn.flash = 1; ring(rn.pos, t.nodes[t.rootId].color, rn.base); holo.pulse(0.35); } }
        if (buds.length && Math.random() < 0.35) { const b = buds[Math.floor(Math.random() * buds.length)]; if (b.grow >= 1) { b.sprite.scale.multiplyScalar(1.8); ring(b.pos, b.owner ? '#ffd27a' : '#9ff4ff', 0.06); } }
        nextAmbient = now + (busy.length ? 650 : 1800) + Math.random() * 600;
      }
      const keep: Pulse[] = [];
      for (const p of pulses) {
        const leg = p.legs[p.leg], total = leg.cum[leg.cum.length - 1];
        p.dist += p.speed * dt;
        if (p.dist >= total) {
          // the signal reaches an agent: its synapse fires
          const end = p.ends[p.leg], nv = end ? nodes.find((q) => q.id === end) : null;
          if (nv) { nv.flash = 1; ring(nv.pos, t.nodes[nv.id]?.color ?? '#ffffff', nv.base * 0.9); }
          p.leg++; p.dist = 0;
          if (p.leg >= p.legs.length) { for (const sp of [p.sprite, ...p.trail]) { (sp.material as THREE.Material).dispose(); pulseGroup.remove(sp); } continue; }
        }
        const l = p.legs[p.leg], lt = l.cum[l.cum.length - 1];
        sample(l.pts, l.cum, l.reverse ? lt - p.dist : p.dist, p.sprite.position);
        p.trail.forEach((sp, k) => { const d = Math.max(0, p.dist - (k + 1) * 0.022); sample(l.pts, l.cum, l.reverse ? lt - d : d, sp.position); });
        keep.push(p);
      }
      pulses = keep;
      // synapse rings fade out as they spread
      rings = rings.filter((r) => { r.age += dt * 1.6; const m = r.sprite.material as THREE.SpriteMaterial; r.sprite.scale.multiplyScalar(1 + dt * 2.6); m.opacity = Math.max(0, 1 - r.age); if (r.age >= 1) { m.dispose(); pulseGroup.remove(r.sprite); return false; } return true; });
      dustMat.uniforms.uTime.value = time;
      { const r = el.getBoundingClientRect(); dustMat.uniforms.uScale.value = renderer.getPixelRatio() * Math.min(r.width, r.height) * 0.012; wire?.update(time, holo.front.uniforms.uColor.value as THREE.Color, dustMat.uniforms.uScale.value * 0.75, calm); halo.update(time, dt, camera, r, renderer.getPixelRatio() * Math.min(r.width, r.height) * 0.011, calm, spin); }
      // idea buds grow out, then breathe; now and then the main agent sends a spark into one
      for (const b of buds) {
        b.grow = calm ? 1.25 : Math.min(1.25, b.grow + dt * 0.7);
        b.mat.uniforms.uGrow.value = Math.max(0, b.grow); b.mat.uniforms.uTime.value = time;
        const ready = b.grow >= 1, breathe = calm ? 1 : 1 + 0.28 * Math.sin(time * 2.2 + b.seed * 30);
        const lit2 = hovered === b.id;
        b.sprite.scale.setScalar(ready ? (lit2 ? 0.08 : 0.05) * breathe : 0.0001);
        b.halo.scale.setScalar(ready ? 0.06 + 0.035 * ((time * 0.6 + b.seed) % 1) : 0.0001);
        (b.halo.material as THREE.SpriteMaterial).opacity = ready ? 0.65 * (1 - ((time * 0.6 + b.seed) % 1)) : 0;
        b.mat.uniforms.uOpacity.value = lit ? 0.25 : 0.85;
      }
      // nodes and labels
      const { width, height } = el.getBoundingClientRect();
      const many = nodes.length > 22;
      void width;
      let best: { id: string; d: number; x: number; y: number } | null = null;
      for (const n of nodes) {
        const node = t.nodes[n.id]; if (!node) continue;
        const grownIn = n.id === t.rootId || (bundleTo(n.id)?.grow ?? 1.25) >= 0.98;
        const on = !lit || lit.has(n.id);
        const busy = BUSY.has(st.runtime.agents[n.id]?.status ?? '');
        const beat = (busy || n.id === t.rootId) && !calm ? 1 + (n.id === t.rootId ? 0.12 : 0.18) * Math.sin(time * (n.id === t.rootId ? 2.4 : 5) + n.base * 40) : 1;
        n.flash = Math.max(0, n.flash - dt * 2.2);
        n.sprite.scale.setScalar(grownIn ? n.base * beat * (on ? 1 : 0.6) * (1 + n.flash * 1.4) : 0.0001);
        (n.sprite.material as THREE.SpriteMaterial).opacity = on ? 1 : 0.25;
        v.copy(n.pos).project(camera);
        const x = (v.x * 0.5 + 0.5) * width, y = (-v.y * 0.5 + 0.5) * height, front = v.z < 1;
        n.screen = { x, y, on: front };
        const show = grownIn && front && (node.depth <= 1 || !many || (lit ? lit.has(n.id) : false) || hovered === n.id);
        n.label.style.transform = `translate(${x.toFixed(1)}px, ${(y - 10).toFixed(1)}px) translate(-50%, -100%)`;
        n.label.style.opacity = show ? (on ? '1' : '.28') : '0';
        if (mouse && grownIn && front) { const d = Math.hypot(mouse.x - x, mouse.y - y); if (d < 16 && (!best || d < best.d)) best = { id: n.id, d, x, y }; }
      }
      let bestIdea = false;
      if (mouse) for (const b of buds) {
        if (b.grow < 1) continue;
        v.copy(b.pos).project(camera); if (v.z >= 1) continue;
        const x = (v.x * 0.5 + 0.5) * width, y = (-v.y * 0.5 + 0.5) * height, d = Math.hypot(mouse.x - x, mouse.y - y);
        if (d < 14 && (!best || d < best.d)) { best = { id: b.id, d, x, y }; bestIdea = true; }
      }
      const nh = best?.id ?? null;
      if (nh !== hovered) { hovered = nh; el.style.cursor = nh ? 'pointer' : ''; setHover(best ? { id: best.id, x: best.x, y: best.y, idea: bestIdea } : null); }
      composer.render();
    };
    raf = requestAnimationFrame(frame);
    void started;

    return () => {
      cancelAnimationFrame(raf); unsub(); ro.disconnect();
      el.removeEventListener('pointermove', onMove); el.removeEventListener('pointerleave', onLeave);
      el.removeEventListener('pointerdown', onDown); el.removeEventListener('pointerup', onUp); el.removeEventListener('dblclick', onDbl);
      disposeNerves(); disposeBuds();
      for (const p of pulses) for (const sp of [p.sprite, ...p.trail]) (sp.material as THREE.Material).dispose();
      for (const r of rings) (r.sprite.material as THREE.Material).dispose();
      gone = true; wire?.dispose(); model?.facets.dispose(); model?.mesh.dispose(); halo.dispose(); orbit.dispose(); geo.dispose(); holo.dispose(); glow.dispose(); ringTex.dispose(); sky.dispose();
      dustGeo.dispose(); dustMat.dispose(); composer.dispose();
      renderer.dispose(); renderer.domElement.remove();
      api.current = null; rebuild.current = null; regrowBuds.current = null;
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // a new agent, or a new reporting line, regrows the tree; new branches grow in from their manager
  useEffect(() => {
    tree.current = treeOf(agents, teams);
    rebuild.current?.(tree.current);
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    sprouts.current = ideaSprouts(tree.current, treeIdeas(useStore.getState().doc));
    regrowBuds.current?.(sprouts.current);
  }, [ideaKey, key]); // eslint-disable-line react-hooks/exhaustive-deps

  // one colour for the whole brain (the regions key and its button were removed)
  useEffect(() => { api.current?.setRegions(false); }, []);

  const hoverIdea = hover?.idea ? library[hover.id] : null;
  const hoverAgent = hover && !hover.idea ? agents[hover.id] : null;
  const hoverNode = hover ? tree.current.nodes[hover.id] : null;
  const reports = hoverNode?.childIds.length ?? 0;
  const tools = <div className="brain-rotate-tools">
    <span>DRAG TO ORBIT · SCROLL TO ZOOM · CLICK A NODE FOR ITS AGENT</span>
    <BrainColorPicker teams={teams} agents={agents} />
    <SpinToggle />
    <button className="btn icon sm" aria-label="Reset brain view" title="Reset view" onClick={() => api.current?.reset()}><RotateCcw size={13}/></button>
  </div>;
  return <div className="brain-object-wrap">
    <div ref={host} className="brain-scene" aria-label="Three-dimensional brain. The main agent sits at the core and every agent it creates branches out as a nerve. Drag to rotate, scroll to zoom, double-click to reset.">
      <div ref={labels} className="brain-node-labels" aria-hidden="true" />
      {hover && hoverIdea && <div className="brain-node-tip is-idea" style={{ left: hover.x, top: hover.y + 14 }}>
        <b>{hoverIdea.title}</b><span>{hoverIdea.tags.includes('owner-submitted') ? 'Your idea' : 'Suggested by the main agent'}{hoverIdea.tags.includes('simulated') ? ' · simulated' : ''}</span>
        <small>Click to grow it into a new branch</small>
      </div>}
      {hover && hoverAgent && <div className="brain-node-tip" style={{ left: hover.x, top: hover.y + 14 }}>
        <b>{hoverAgent.identity.name}</b><span>{hoverAgent.identity.title}</span>
        <small>{hoverNode?.depth === 0 ? 'Main agent · the core of the brain' : `Branch of ${tree.current.nodes[hoverNode?.parentId ?? '']?.name ?? 'the core'}`}{reports ? ` · ${reports} agent${reports === 1 ? '' : 's'} branch from it` : ''}</small>
      </div>}
    </div>
    {toolsHost ? createPortal(tools, toolsHost) : tools}
  </div>;
}
