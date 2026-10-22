// The halo around the main brain: a glass ring of light with the specialist brains riding on it,
// each linked to JARVIS's brain by a nerve that carries sparks. Decorative and cheap: one torus,
// one point cloud, and a small hologram per specialist brain (sharing the main brain's geometry).
import * as THREE from 'three';
import { holoBrainMaterial, type HoloBrain } from './brainMesh';

export interface RingBrain { key: string; name: string; color: string }

const ringVertex = `varying vec3 vN; varying vec3 vV; varying float vA; varying float vY;
  void main(){ vec4 mv=modelViewMatrix*vec4(position,1.); vN=normalize(normalMatrix*normal); vV=normalize(-mv.xyz);
    vA=atan(position.z,position.x); vY=position.y; gl_Position=projectionMatrix*mv; }`;
const ringFragment = `uniform vec3 uColor; uniform vec3 uColor2; uniform float uTime; varying vec3 vN; varying vec3 vV; varying float vA; varying float vY;
  void main(){ float f=pow(1.-abs(dot(normalize(vN),normalize(vV))),2.4);
    float hue=.5+.5*sin(vA*2.+uTime*.25); vec3 col=mix(uColor,uColor2,hue*.55);
    float streak=pow(.5+.5*sin(vA*46.-uTime*1.6+vY*30.),14.)*.55; float shimmer=pow(.5+.5*sin(vA*9.+uTime*.9),6.)*.35;
    col=mix(col,vec3(1.),f*.35+streak*.3);
    gl_FragColor=vec4(col,clamp(.035+f*.78+(streak+shimmer)*f,0.,1.)); }`;
const sparkVertex = `uniform float uTime; uniform float uScale; attribute float aTheta; attribute float aSeed; attribute vec2 aOff; uniform float uR; varying float vA;
  void main(){ float th=aTheta+uTime*(.02+aSeed*.05); float r=uR+aOff.x; vec3 p=vec3(cos(th)*r,aOff.y,sin(th)*r);
    vec4 mv=modelViewMatrix*vec4(p,1.); gl_Position=projectionMatrix*mv; vA=.25+.75*pow(.5+.5*sin(uTime*(1.2+aSeed*2.)+aSeed*60.),3.);
    gl_PointSize=uScale*(.6+aSeed*1.8)/-mv.z; }`;
const sparkFragment = `uniform vec3 uColor; varying float vA; void main(){ vec2 c=gl_PointCoord-.5; float d=length(c); if(d>.5) discard; gl_FragColor=vec4(mix(uColor,vec3(1.),.6)*vA,(1.-d*2.)*vA*.8); }`;

interface Sat { brain: RingBrain; holo: HoloBrain; meshes: THREE.Mesh[]; nerve: THREE.Mesh; curve: THREE.QuadraticBezierCurve3; sparks: THREE.Sprite[]; pos: THREE.Vector3; label: HTMLDivElement; angle: number }

export function brainRing(opts: { geo: THREE.BufferGeometry; glow: THREE.Texture; labelLayer: HTMLElement; core: THREE.Vector3; onPick: (key: string) => void; radius?: number; tube?: number }) {
  const R = opts.radius ?? 2.45, TUBE = opts.tube ?? 0.17, Y = -0.12;
  const group = new THREE.Group(); group.position.y = Y;

  const torusGeo = new THREE.TorusGeometry(R, TUBE, 40, 200); torusGeo.rotateX(Math.PI / 2);
  const torusMat = new THREE.ShaderMaterial({ vertexShader: ringVertex, fragmentShader: ringFragment, transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending,
    uniforms: { uColor: { value: new THREE.Color('#3f7dff') }, uColor2: { value: new THREE.Color('#38e1ff') }, uTime: { value: 0 } } });
  const torus = new THREE.Mesh(torusGeo, torusMat); torus.renderOrder = 3; group.add(torus);
  // a thin bright core line inside the glass
  const coreGeo = new THREE.TorusGeometry(R, 0.012, 6, 200); coreGeo.rotateX(Math.PI / 2);
  const coreMat = new THREE.MeshBasicMaterial({ color: new THREE.Color('#9fd8ff'), transparent: true, opacity: 0.35, depthWrite: false, blending: THREE.AdditiveBlending });
  group.add(new THREE.Mesh(coreGeo, coreMat));

  const N = 1400, theta = new Float32Array(N), seed = new Float32Array(N), off = new Float32Array(N * 2), pos = new Float32Array(N * 3);
  for (let i = 0; i < N; i++) { theta[i] = Math.random() * Math.PI * 2; seed[i] = Math.random(); const a = Math.random() * Math.PI * 2, r = Math.sqrt(Math.random()) * TUBE * 0.95; off[i * 2] = Math.cos(a) * r; off[i * 2 + 1] = Math.sin(a) * r; }
  const sparkGeo = new THREE.BufferGeometry();
  sparkGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3)); sparkGeo.setAttribute('aTheta', new THREE.BufferAttribute(theta, 1));
  sparkGeo.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1)); sparkGeo.setAttribute('aOff', new THREE.BufferAttribute(off, 2));
  sparkGeo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), R + TUBE);
  const sparkMat = new THREE.ShaderMaterial({ vertexShader: sparkVertex, fragmentShader: sparkFragment, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    uniforms: { uTime: { value: 0 }, uScale: { value: 6 }, uR: { value: R }, uColor: { value: new THREE.Color('#8fd0ff') } } });
  const sparks = new THREE.Points(sparkGeo, sparkMat); sparks.renderOrder = 4; group.add(sparks);

  let sats: Sat[] = [];
  let key = '';
  const v = new THREE.Vector3();
  const coreLocal = opts.core.clone().sub(group.position);

  const clear = () => {
    for (const s of sats) {
      s.holo.dispose(); s.nerve.geometry.dispose(); (s.nerve.material as THREE.Material).dispose();
      for (const sp of s.sparks) (sp.material as THREE.Material).dispose();
      group.remove(...s.meshes, s.nerve, ...s.sparks); s.label.remove();
    }
    sats = [];
  };

  const setBrains = (list: RingBrain[]) => {
    const k = JSON.stringify(list.map((b) => [b.key, b.name, b.color]));
    if (k === key) return; key = k;
    clear();
    const shown = list.slice(0, 8);
    shown.forEach((brain, i) => {
      const angle = (i / shown.length) * Math.PI * 2 + Math.PI / 4;
      const p = new THREE.Vector3(Math.cos(angle) * R, 0.02, Math.sin(angle) * R);
      const holo = holoBrainMaterial(brain.color); holo.setRegions(false);
      const back = new THREE.Mesh(opts.geo, holo.back), front = new THREE.Mesh(opts.geo, holo.front);
      for (const m of [back, front]) { m.position.copy(p); m.scale.setScalar(0.36); m.rotation.y = -angle + Math.PI / 2; }
      back.renderOrder = 3; front.renderOrder = 4;
      const mid = p.clone().add(coreLocal).multiplyScalar(0.5); mid.y += 0.45;
      const curve = new THREE.QuadraticBezierCurve3(coreLocal.clone(), mid, p.clone());
      const nerve = new THREE.Mesh(new THREE.TubeGeometry(curve, 48, 0.0055, 5, false), new THREE.MeshBasicMaterial({ color: new THREE.Color(brain.color).lerp(new THREE.Color('#ffffff'), 0.25), transparent: true, opacity: 0.5, depthWrite: false, blending: THREE.AdditiveBlending }));
      nerve.renderOrder = 2;
      const sparkList = [0, 1].map(() => { const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: opts.glow, color: new THREE.Color(brain.color).lerp(new THREE.Color('#ffffff'), 0.5), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending })); sp.scale.setScalar(0.05); sp.renderOrder = 5; return sp; });
      group.add(back, front, nerve, ...sparkList);
      const label = document.createElement('div');
      label.className = 'brain-node-label ring-brain-label'; label.textContent = brain.name; label.title = `Open ${brain.name}`;
      label.style.setProperty('--node-color', brain.color);
      label.addEventListener('click', () => opts.onPick(brain.key));
      opts.labelLayer.appendChild(label);
      sats.push({ brain, holo, meshes: [back, front], nerve, curve, sparks: sparkList, pos: p, label, angle });
    });
  };

  const update = (time: number, dt: number, camera: THREE.Camera, size: { width: number; height: number }, pixelScale: number, calm: boolean) => {
    torusMat.uniforms.uTime.value = calm ? 0 : time;
    sparkMat.uniforms.uTime.value = calm ? 0 : time;
    sparkMat.uniforms.uScale.value = pixelScale;
    for (const [i, s] of sats.entries()) {
      s.holo.update(time, dt);
      const bob = calm ? 0 : Math.sin(time * 0.9 + i * 1.7) * 0.025;
      for (const m of s.meshes) { m.position.y = s.pos.y + bob; if (!calm) m.rotation.y += dt * 0.25; }
      s.sparks.forEach((sp, k) => { const t = calm ? 0.5 : ((time * 0.28 + i * 0.37 + k * 0.5) % 1); s.curve.getPoint(t, sp.position); (sp.material as THREE.SpriteMaterial).opacity = Math.sin(t * Math.PI); });
      v.set(s.pos.x, s.pos.y + 0.24 + bob, s.pos.z).add(group.position).applyMatrix4(group.parent?.matrixWorld ?? new THREE.Matrix4()).project(camera);
      const x = (v.x * 0.5 + 0.5) * size.width, y = (-v.y * 0.5 + 0.5) * size.height;
      s.label.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) translate(-50%, -100%)`;
      s.label.style.opacity = v.z < 1 ? '1' : '0';
    }
  };

  const dispose = () => { clear(); torusGeo.dispose(); torusMat.dispose(); coreGeo.dispose(); coreMat.dispose(); sparkGeo.dispose(); sparkMat.dispose(); };
  return { group, setBrains, update, dispose };
}
