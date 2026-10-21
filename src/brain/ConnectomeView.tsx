import { useEffect, useMemo, useRef } from 'react';
import { Activity, Network, RotateCcw, Users } from 'lucide-react';
import { create } from 'zustand';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { useStore } from '../store/store';
import { teamsOf } from './connectome';
import { AgentMenu } from './AgentMenu';
import BrainSwitcher from './BrainSwitcher';
import CreatorDesk from './CreatorDesk';
import '../styles/brain.css';

/** Shared focus state for the brain, sector menu, and brain picker. */
export const useBrainFocus = create<{ teamId: string | null; agentId: string | null; selectedTeamId: string | null; brainAgentId: string | null }>(() => ({ teamId: null, agentId: null, selectedTeamId: null, brainAgentId: null }));

function BrainModel() {
  const scene = useRef<HTMLDivElement>(null);
  const controls = useRef<OrbitControls | null>(null);

  useEffect(() => {
    const host = scene.current;
    if (!host) return;
    const threeScene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(38, 1, .05, 100);
    camera.up.set(0, 0, 1);
    camera.position.set(0, -3.05, .18);
    const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, powerPreference: 'high-performance' });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
    renderer.setClearColor(0x000000, 0);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.domElement.className = 'brain-webgl-canvas';
    renderer.domElement.setAttribute('aria-hidden', 'true');
    host.prepend(renderer.domElement);

    const orbit = new OrbitControls(camera, renderer.domElement);
    controls.current = orbit;
    orbit.target.set(0, 0, -.05);
    orbit.enableDamping = true;
    orbit.dampingFactor = .08;
    orbit.enablePan = false;
    orbit.minDistance = 2.35;
    orbit.maxDistance = 7.5;
    orbit.minPolarAngle = .05;
    orbit.maxPolarAngle = Math.PI - .05;
    orbit.saveState();

    threeScene.add(new THREE.HemisphereLight(0xbceeff, 0x101735, 2.2));
    const key = new THREE.DirectionalLight(0x7bd9ff, 2.2);
    key.position.set(-2, -3, 3);
    threeScene.add(key);
    const rim = new THREE.DirectionalLight(0x407aff, 1.8);
    rim.position.set(2, 3, 1);
    threeScene.add(rim);

    let disposed = false;
    const modelUrl = new URL('models/brain-outline.glb', document.baseURI).href;
    new GLTFLoader().load(modelUrl, (gltf) => {
      if (disposed) return;
      const model = gltf.scene;
      model.rotation.x = Math.PI / 2;
      model.traverse((object) => {
        if (!(object instanceof THREE.Mesh)) return;
        const shell = /shell|surface/i.test(object.name);
        object.material = shell
          ? new THREE.MeshPhysicalMaterial({ color: 0x54bfff, emissive: 0x1b83d5, emissiveIntensity: .28, transparent: true, opacity: .09, side: THREE.DoubleSide, depthWrite: false, metalness: .1, roughness: .2 })
          : new THREE.MeshBasicMaterial({ color: 0x9aeaff, transparent: true, opacity: .83, depthWrite: false, blending: THREE.AdditiveBlending });
        object.renderOrder = shell ? 1 : 3;
      });
      const bounds = new THREE.Box3().setFromObject(model);
      const size = bounds.getSize(new THREE.Vector3());
      const center = bounds.getCenter(new THREE.Vector3());
      model.position.sub(center);
      model.scale.setScalar(2.25 / Math.max(size.x, size.y, size.z));
      threeScene.add(model);
    }, undefined, (error) => {
      console.error('Could not load the Blender brain model', error);
      host.classList.add('brain-model-unavailable');
    });

    const resize = () => {
      const { width, height } = host.getBoundingClientRect();
      if (!width || !height) return;
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      renderer.setSize(width, height, false);
    };
    const observer = new ResizeObserver(resize);
    observer.observe(host);
    resize();
    const reset = () => orbit.reset();
    host.addEventListener('dblclick', reset);
    let frame = 0;
    let lastFrame = 0;
    const render = (now: number) => {
      frame = requestAnimationFrame(render);
      if (now - lastFrame < 30 && !orbit.update()) return;
      lastFrame = now;
      orbit.update();
      renderer.render(threeScene, camera);
    };
    frame = requestAnimationFrame(render);

    return () => {
      disposed = true;
      cancelAnimationFrame(frame);
      observer.disconnect();
      host.removeEventListener('dblclick', reset);
      orbit.dispose();
      controls.current = null;
      threeScene.traverse((object) => {
        if (!(object instanceof THREE.Mesh)) return;
        object.geometry.dispose();
        const materials = Array.isArray(object.material) ? object.material : [object.material];
        materials.forEach((material) => material.dispose());
      });
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, []);

  return <div className="brain-object-wrap">
    <div ref={scene} className="brain-scene" aria-label="Orbitable three-dimensional brain outline; drag to rotate, scroll to zoom, double click to reset">
      <div className="brain-main-label"><span>MAIN BRAIN</span><i/></div>
    </div>
    <div className="brain-rotate-tools"><span>DRAG TO ORBIT · SCROLL TO ZOOM · DOUBLE-CLICK TO RESET</span><button className="btn icon sm" aria-label="Reset brain view" title="Reset view" onClick={() => controls.current?.reset()}><RotateCcw size={13}/></button></div>
  </div>;
}

export default function ConnectomeView() {
  const agents = useStore((s) => s.doc.agents);
  const departments = useStore((s) => s.doc.departments);
  const ideasCount = useStore((s) => Object.values(s.doc.library).filter((entry) => entry.tags.includes('idea-review')).length);
  const teams = useMemo(() => teamsOf({ agents, departments }), [agents, departments]);
  const running = useStore((s) => Object.values(s.runtime.agents).filter((agent) => ['working', 'researching', 'thinking', 'communicating'].includes(agent.status)).length);
  const total = Object.keys(agents).length;
  const activeTeamId = useBrainFocus((s) => s.selectedTeamId);
  const activeTeam = teams.find((team) => team.id === activeTeamId);

  return <div className="brain-workspace">
    <header className="brain-toolbar">
      <BrainSwitcher teams={teams} agents={agents} totalAgents={total}/>
      <div className="brain-title"><span className="brain-title-kicker">THE BRAIN <i/> LIVE SYSTEM</span><strong>{activeTeam ? `${activeTeam.name} Sector` : 'The Brain'}</strong><span>One connected workspace. Every specialist has a place in the network.</span></div>
      <CreatorDesk />
    </header>
    <div className="brain-main">
      <AgentMenu />
      <section className="brain-stage-view" aria-label="Agent brain visualization">
        <div className="brain-stage-glow" aria-hidden="true"/>
        <div className="brain-hud brain-hud-top"><span><Network size={14}/> BRAIN MODEL <b>{total.toString().padStart(2, '0')} AGENTS</b></span><span>3D BRAIN OUTLINE · {ideasCount} IDEAS</span></div>
        <BrainModel/>
        <div className="brain-hud brain-hud-bottom"><div><span className="brain-hud-icon"><Users size={15}/></span><span><b>{total} connected agents</b><small>Explore specialists by sector in the agent menu</small></span></div><div className="brain-hud-divider"/><div><span className="brain-hud-icon pulse-icon"><Activity size={15}/></span><span><b>{running} active now</b><small>Drag the brain to view it from every angle</small></span></div></div>
        {!total && <div className="brain-empty"><b>Your network starts here</b><span>Create a specialist to grow the first branch.</span></div>}
      </section>
    </div>
  </div>;
}




