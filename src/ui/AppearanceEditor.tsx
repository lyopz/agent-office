import { useEffect, useState } from 'react';
import { useStore } from '../store/store';
import type { Agent, Appearance, ViewMode } from '../model/types';
import { APPEARANCE_PRESETS, SKIN_TONES, uid } from '../model/defaults';
import { Character, type Pose } from '../characters/Character';
import { assetStore } from '../persistence/repository';
import { useAsset } from '../viewport/AgentsLayer';
import { ColorField, SelectField, Slider } from './primitives';

const VIEWS: { v: ViewMode; label: string }[] = [
  { v: 'front', label: 'Front' }, { v: 'side', label: 'Side' }, { v: 'three-quarter', label: '3/4' }, { v: 'top', label: 'Top-down' }, { v: 'portrait', label: 'Portrait' },
];
const OUTFIT_KEYS: (keyof Appearance)[] = ['top', 'topColor', 'bottom', 'bottomColor', 'shoes', 'shoeColor', 'headwear', 'headwearColor', 'glasses', 'jewelry', 'equipment', 'accent'];
const HAIR = ['#2a1d14', '#5a3a20', '#8a3b1e', '#e3c27a', '#e8e2d0', '#16181a', '#4cc9ff', '#b57bff', '#ff9f43', '#39ff88'];
const CLOTH = ['#1f3d2e', '#13402a', '#d9772b', '#e8eef0', '#1c2230', '#2a1440', '#103a4a', '#26313a', '#c62f3a', '#f2c230'];

function Stage({ a, assets, pose }: { a: Appearance; assets: Agent['assets']; pose: Pose }) {
  const [frame, setFrame] = useState(0);
  useEffect(() => {
    if (pose === 'idle') return;
    const t = setInterval(() => setFrame((f) => (f + 1) % 4), 220 / a.animationSpeed);
    return () => clearInterval(t);
  }, [pose, a.animationSpeed]);
  return (
    <div className="preview-stage" aria-label="Live character preview">
      {VIEWS.map(({ v, label }) => <ViewFigure key={v} a={a} view={v} label={label} pose={pose} frame={frame} assetId={assets[v]?.assetId} />)}
    </div>
  );
}

function ViewFigure({ a, view, label, pose, frame, assetId }: { a: Appearance; view: ViewMode; label: string; pose: Pose; frame: number; assetId?: string }) {
  const url = useAsset(assetId);
  const size = view === 'portrait' ? 120 : view === 'top' ? 96 : 180;
  return (
    <figure>
      <div style={{ height: 180, display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}>
        <Character a={a} view={view} pose={pose} frame={frame} heading={pose === 'walk' ? 'right' : 'down'} size={size} assetUrl={url} title={`${label} view`} />
      </div>
      <figcaption>{label}{url ? ' · artwork' : ''}</figcaption>
    </figure>
  );
}

export function AppearanceEditor({ agent }: { agent: Agent }) {
  const doc = useStore((s) => s.doc);
  const { commit, notify } = useStore.getState();
  const a = agent.appearance;
  const [pose, setPose] = useState<Pose>('walk');
  const set = (patch: Partial<Appearance>, label = `Restyle ${agent.identity.name}`) => commit([{ op: 'agent.update', id: agent.id, patch: { appearance: patch } }], label);
  const sel = <K extends keyof Appearance>(k: K, label: string, opts: readonly string[]) => <SelectField label={label} value={a[k] as string} options={opts} onChange={(v) => set({ [k]: v } as Partial<Appearance>)} />;

  const upload = async (view: ViewMode, file: File) => {
    if (!/^image\/(png|jpeg|webp|svg\+xml|gif)$/.test(file.type)) { notify('Use a PNG, JPEG, WebP, GIF or SVG image', 'error'); return; }
    if (file.size > 2_000_000) { notify('Images must be under 2 MB', 'error'); return; }
    const url = await new Promise<string>((res) => { const r = new FileReader(); r.onload = () => res(r.result as string); r.readAsDataURL(file); });
    const assetId = uid('asset');
    await assetStore.put(assetId, url);
    commit([{ op: 'agent.update', id: agent.id, patch: { assets: { ...agent.assets, [view]: { assetId, approvedAt: new Date().toISOString() } } } }], `Approve ${view} artwork`);
  };

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <div className="row wrap">
        <span className="label">Preview pose</span>
        <div className="seg">{(['idle', 'walk', 'work'] as Pose[]).map((p) => <button key={p} className="btn sm" aria-pressed={pose === p} onClick={() => setPose(p)}>{p}</button>)}</div>
        <span className="note">Every view is drawn from this one profile. Changing the look never touches name, role, personality, tasks or memory.</span>
      </div>
      <Stage a={a} assets={agent.assets} pose={pose} />
      <div className="card">
        <h4>Presets &amp; outfit templates</h4>
        <div className="row wrap">
          {APPEARANCE_PRESETS.map((p) => <button key={p.name} className="btn sm" onClick={() => set(p.patch, `Apply ${p.name} preset`)}>{p.name}</button>)}
          {doc.outfitTemplates.filter((t) => !APPEARANCE_PRESETS.some((p) => p.name === t.name)).map((t) => <button key={t.id} className="btn sm" onClick={() => set(t.patch, `Apply outfit ${t.name}`)}>★ {t.name}</button>)}
          <button className="btn sm primary" onClick={() => {
            const patch = Object.fromEntries(OUTFIT_KEYS.map((k) => [k, a[k]])) as Partial<Appearance>;
            commit([{ op: 'template.saveOutfit', template: { id: uid('outfit'), name: `${agent.identity.name} outfit`, patch } }], 'Save outfit template');
          }}>Save current outfit as template</button>
        </div>
      </div>
      <div className="grid-3">
        <div className="card">
          <h4>Body &amp; face</h4>
          <Slider label="Height" value={a.height} min={0.85} max={1.15} step={0.01} format={(v) => `${Math.round(v * 100)}%`} onCommit={(height) => set({ height })} />
          {sel('build', 'Build', ['slim', 'average', 'broad'])}
          <ColorField label="Skin tone" value={a.skinTone} swatches={SKIN_TONES} onChange={(skinTone) => set({ skinTone })} />
          {sel('faceShape', 'Face shape', ['round', 'oval', 'square'])}
          <div className="field-row">{sel('eyeStyle', 'Eyes', ['dot', 'almond', 'wide', 'visor'])}{sel('brows', 'Eyebrows', ['none', 'thin', 'thick', 'angled'])}</div>
          <ColorField label="Eye colour" value={a.eyeColor} swatches={['#2b1d10', '#3a6ea5', '#3f7a4a', '#7a5a34', '#4cc9ff']} onChange={(eyeColor) => set({ eyeColor })} />
        </div>
        <div className="card">
          <h4>Hair</h4>
          {sel('hairStyle', 'Style', ['bald', 'buzz', 'short', 'long', 'bun', 'ponytail', 'mohawk', 'curly'])}
          <ColorField label="Hair colour" value={a.hairColor} swatches={HAIR} onChange={(hairColor) => set({ hairColor })} />
          {sel('facialHair', 'Facial hair', ['none', 'stubble', 'beard', 'mustache'])}
          <h4 style={{ marginTop: 12 }}>Accessories</h4>
          <div className="field-row">{sel('headwear', 'Hat / helmet', ['none', 'cap', 'hardhat', 'helmet', 'beanie', 'headset'])}{sel('glasses', 'Glasses', ['none', 'round', 'square', 'visor'])}</div>
          <ColorField label="Headwear colour" value={a.headwearColor} swatches={['#f2c230', '#d9772b', '#e8eef0', '#26313a', '#39ff88']} onChange={(headwearColor) => set({ headwearColor })} />
          <div className="field-row">{sel('jewelry', 'Jewelry', ['none', 'earrings', 'necklace', 'badge'])}{sel('equipment', 'Equipment', ['none', 'tablet', 'wrench', 'clipboard', 'laptop', 'toolbelt'])}</div>
        </div>
        <div className="card">
          <h4>Clothing</h4>
          {sel('top', 'Top / uniform', ['tshirt', 'hoodie', 'suit', 'labcoat', 'coverall', 'uniform', 'vest'])}
          <ColorField label="Top colour" value={a.topColor} swatches={CLOTH} onChange={(topColor) => set({ topColor })} />
          {sel('bottom', 'Bottom', ['pants', 'shorts', 'skirt'])}
          <ColorField label="Bottom colour" value={a.bottomColor} swatches={['#1b1f24', '#1c2230', '#3a5a8a', '#6b4423', '#a69a6b']} onChange={(bottomColor) => set({ bottomColor })} />
          {sel('shoes', 'Shoes', ['sneakers', 'boots', 'dress'])}
          <ColorField label="Shoe colour" value={a.shoeColor} swatches={['#d8dde0', '#4a3020', '#111111', '#39ff88']} onChange={(shoeColor) => set({ shoeColor })} />
          <ColorField label="Accent / glow" value={a.accent} swatches={['#39ff88', '#4cc9ff', '#ff9f43', '#b57bff', '#ff5d73']} onChange={(accent) => set({ accent })} />
        </div>
        <div className="card">
          <h4>Poses &amp; motion</h4>
          {sel('idlePose', 'Idle pose', ['stand', 'arms-crossed', 'hands-hips'])}
          {sel('walkPose', 'Walking pose', ['normal', 'brisk', 'casual'])}
          {sel('workPose', 'Working pose', ['typing', 'reading', 'tinkering'])}
          {sel('facing', 'Default facing', ['left', 'right'])}
          <Slider label="Animation speed" value={a.animationSpeed} min={0.5} max={2} step={0.1} format={(v) => `${v.toFixed(1)}×`} onCommit={(animationSpeed) => set({ animationSpeed })} />
        </div>
        <div className="card">
          <h4>Rendering</h4>
          {sel('artStyle', 'Art style', ['flat', 'neon', 'realistic', 'pixel'])}
          <Slider label="Outline thickness" value={a.outline} min={0} max={4} step={0.25} format={(v) => `${v}px`} onCommit={(outline) => set({ outline })} />
          {sel('shading', 'Shading & lighting', ['none', 'soft', 'hard'])}
          <SelectField label="Floor-plan view (when View = per agent)" value={a.preferredView} options={[{ value: 'top', label: 'Top-down' }, { value: 'front', label: 'Front' }, { value: 'side', label: 'Side' }, { value: 'three-quarter', label: 'Three-quarter' }]} onChange={(preferredView) => set({ preferredView })} />
        </div>
        <div className="card">
          <h4>Approved artwork</h4>
          <p className="note">Upload finished art for any view. It's stored once and linked to this profile, so it never regenerates. Views without art use the procedural drawing above.</p>
          {VIEWS.map(({ v, label }) => (
            <div key={v} className="row small" style={{ padding: '3px 0' }}>
              <span className="grow">{label}: {agent.assets[v] ? <span style={{ color: 'var(--accent)' }}>approved</span> : <span className="muted">procedural</span>}</span>
              <label className="btn sm">Upload<input type="file" accept="image/*" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) upload(v, f); e.target.value = ''; }} /></label>
              {agent.assets[v] && <button className="btn sm danger" onClick={() => commit([{ op: 'agent.update', id: agent.id, patch: { assets: { ...agent.assets, [v]: null } } }], `Remove ${v} artwork`)}>Remove</button>}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
