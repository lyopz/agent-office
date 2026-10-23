// The main brain's low-poly model, made in Blender (src/brain/models/brain.glb, built by
// scripts/blender/brain_lowpoly.py): the same shape and size as the procedural brain, cut into clear
// triangles, drawn with bright edges and sparkles at the corners. If it can't load, the procedural brain stays.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import modelBase64 from './models/brainGlb';

/** The Blender model as a hologram-ready geometry (flat facets, `fold` and `tint`), or null if it can't load. */
export async function loadBrainModel(): Promise<{ facets: THREE.BufferGeometry; mesh: THREE.BufferGeometry } | null> {
  try {
    const bytes = Uint8Array.from(atob(modelBase64), (c) => c.charCodeAt(0));
    const gltf = await new GLTFLoader().parseAsync(bytes.buffer, '');
    let found: THREE.BufferGeometry | null = null;
    gltf.scene.traverse((o) => { if (!found && (o as THREE.Mesh).isMesh) found = (o as THREE.Mesh).geometry; });
    if (!found) return null;
    const mesh = new THREE.BufferGeometry();
    const src: THREE.BufferGeometry = found;
    mesh.setAttribute('position', src.attributes.position);
    mesh.setAttribute('fold', src.attributes._fold ?? new THREE.BufferAttribute(new Float32Array(src.attributes.position.count).fill(0.6), 1));
    mesh.setAttribute('tint', src.attributes._tint ?? new THREE.BufferAttribute(new Float32Array(src.attributes.position.count * 3), 3));
    mesh.setIndex(src.index);
    mesh.computeVertexNormals();
    // one normal per triangle, so every facet catches the light on its own like the reference
    const facets = mesh.toNonIndexed();
    facets.computeVertexNormals();
    return { facets, mesh };
  } catch {
    return null;
  }
}

// further away the lines crowd, so each one dims
const edgeVertex = `uniform float uTime; attribute float fold; varying float vA;
  void main(){ vec4 mv=modelViewMatrix*vec4(position,1.); vec3 n=normalize(normalMatrix*normal); vec3 v=normalize(-mv.xyz);
    float face=dot(n,v); vA=(.1+.9*smoothstep(-.15,.55,face))*(.25+.75*smoothstep(.3,.85,fold))*clamp(3.4/-mv.z,.55,1.); gl_Position=projectionMatrix*mv; }`;
// a touch of violet over the brain's colour, as in ed's reference picture
const edgeFragment = `uniform vec3 uColor; uniform float uOpacity; varying float vA; void main(){ vec3 c=mix(uColor,vec3(.66,.45,1.),.28); gl_FragColor=vec4(mix(c,vec3(1.),.08),vA*uOpacity); }`;
const sparkVertex = `uniform float uTime; uniform float uScale; attribute float aSeed; varying float vA;
  void main(){ vec4 mv=modelViewMatrix*vec4(position,1.); vec3 n=normalize(normalMatrix*normal); float face=smoothstep(-.1,.5,dot(n,normalize(-mv.xyz)));
    float tw=pow(.5+.5*sin(uTime*(.8+aSeed*2.2)+aSeed*80.),10.);
    vA=face*(.18+.82*tw); gl_PointSize=uScale*(.5+1.6*tw)*(.6+aSeed*.8)/-mv.z; gl_Position=projectionMatrix*mv; }`;
const sparkFragment = `uniform vec3 uColor; varying float vA; void main(){ vec2 c=gl_PointCoord-.5; float d=length(c); if(d>.5) discard;
  float core=pow(1.-d*2.,2.2); gl_FragColor=vec4(mix(uColor,vec3(1.),.7),core*vA); }`;

/** Bright triangle edges and twinkling corners over the brain; they fade on the far side. */
export function brainWire(mesh: THREE.BufferGeometry) {
  const group = new THREE.Group();
  const shared = { uColor: { value: new THREE.Color('#5fb8ff') }, uTime: { value: 0 } };
  const wire = new THREE.WireframeGeometry(mesh);
  // the wireframe keeps positions only: give each line end its corner's normal (far-side fade) and fold
  const normals = new Float32Array(wire.attributes.position.count * 3), folds = new Float32Array(wire.attributes.position.count);
  { const pos = mesh.attributes.position, nrm = mesh.attributes.normal, fold = mesh.attributes.fold, wp = wire.attributes.position, at = new Map<string, number>();
    for (let i = 0; i < pos.count; i++) at.set(`${pos.getX(i).toFixed(5)},${pos.getY(i).toFixed(5)},${pos.getZ(i).toFixed(5)}`, i);
    for (let i = 0; i < wp.count; i++) { const k = at.get(`${wp.getX(i).toFixed(5)},${wp.getY(i).toFixed(5)},${wp.getZ(i).toFixed(5)}`) ?? 0; normals[i * 3] = nrm.getX(k); normals[i * 3 + 1] = nrm.getY(k); normals[i * 3 + 2] = nrm.getZ(k); folds[i] = fold.getX(k); } }
  wire.setAttribute('normal', new THREE.BufferAttribute(normals, 3)); wire.setAttribute('fold', new THREE.BufferAttribute(folds, 1));
  const edgeMat = new THREE.ShaderMaterial({ vertexShader: edgeVertex, fragmentShader: edgeFragment, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, uniforms: { ...shared, uOpacity: { value: 0.38 } } });
  const edges = new THREE.LineSegments(wire, edgeMat); edges.renderOrder = 2;
  const seeds = new Float32Array(mesh.attributes.position.count).map(() => Math.random());
  const sparkGeo = new THREE.BufferGeometry();
  sparkGeo.setAttribute('position', mesh.attributes.position); sparkGeo.setAttribute('normal', mesh.attributes.normal);
  sparkGeo.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 1));
  const sparkMat = new THREE.ShaderMaterial({ vertexShader: sparkVertex, fragmentShader: sparkFragment, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, uniforms: { ...shared, uScale: { value: 6 } } });
  const sparks = new THREE.Points(sparkGeo, sparkMat); sparks.renderOrder = 3;
  group.add(edges, sparks);
  return {
    group,
    update(time: number, color: THREE.Color, pixelScale: number, calm: boolean) {
      shared.uColor.value.copy(color); shared.uTime.value = calm ? 0 : time; sparkMat.uniforms.uScale.value = pixelScale;
    },
    dispose() { wire.dispose(); edgeMat.dispose(); sparkGeo.dispose(); sparkMat.dispose(); },
  };
}
