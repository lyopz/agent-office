// Avatar Studio: the owner's own character for the 3D headquarters. Every
// change is one `player.update` DocOp, so it is undoable like any other edit.
// Controls are grouped (Style, Face, Hair, Outfit) and every option is a
// labelled radio button, swatch or slider, usable from the keyboard.
import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { Dices, RotateCcw, Sparkles, Undo2 } from 'lucide-react';
import { useStore } from '../store/store';
import { BODY_STYLES, EXPRESSIONS, HAIR_STYLES_3D, type Appearance, type ViewMode } from '../model/types';
import { SKIN_TONES, defaultPlayer, withAppearance } from '../model/defaults';
import { Character, type Pose } from '../characters/Character';
import { AvatarPreview3D } from '../hq3d/AvatarPreview3D';
import { ColorField, Slider } from './primitives';
import '../styles/avatar-studio.css';

// ---------- options ----------

/** hint: tooltip text; badge: a short tag shown on the option (e.g. "3D"). */
type Opt<T extends string> = { value: T; label: string; hint?: string; badge?: string };
const o = <T extends string>(value: T, label: string, hint?: string, badge?: string): Opt<T> => ({ value, label, hint, badge });

const HAIR_LABEL: Record<Appearance['hairStyle'], string> = {
  short: 'Short', swept: 'Swept', spiky: 'Spiky', undercut: 'Undercut', afro: 'Afro', braids: 'Braids', 'twin-buns': 'Twin buns',
  curly: 'Curly', long: 'Long', ponytail: 'Ponytail', bun: 'Bun', mohawk: 'Mohawk', buzz: 'Buzz cut', bald: 'Bald',
};
/** Every hair style; the ones sculpted for the 3D headquarters are tagged "3D". */
export const HAIR_OPTIONS: Opt<Appearance['hairStyle']>[] = (Object.keys(HAIR_LABEL) as Appearance['hairStyle'][])
  .map((h) => (HAIR_STYLES_3D as readonly string[]).includes(h) ? o(h, HAIR_LABEL[h], 'Sculpted for the 3D headquarters', '3D') : o(h, HAIR_LABEL[h]));
const EXPRESSION_LABEL: Record<(typeof EXPRESSIONS)[number], string> = {
  neutral: 'Neutral', smile: 'Smile', grin: 'Big grin', focused: 'Focused', surprised: 'Surprised', smirk: 'Smirk', determined: 'Determined',
};
const BODY_LABEL: Record<(typeof BODY_STYLES)[number], [string, string]> = {
  blocky: ['Blocky', 'Chunky, square building-block proportions'], heroic: ['Heroic', 'Tall, broad shoulders, adventure-hero proportions'],
  chibi: ['Chibi', 'Big head, small body, extra expressive'], sleek: ['Sleek', 'Slim, long-limbed, streamlined'],
};
const HAIR_COLORS = ['#2a1d14', '#5a3a20', '#8a3b1e', '#e3c27a', '#e8e2d0', '#16181a', '#4cc9ff', '#b57bff', '#ff9ad5', '#39ff88', '#ff5d73', '#ffd166'];
const CLOTH = ['#2b3a8c', '#1f3d2e', '#3a1030', '#d9772b', '#e8eef0', '#1c2230', '#2a1440', '#103a4a', '#c62f3a', '#f2c230', '#14161c', '#39d0c8'];
const ACCENTS = ['#7cf7ff', '#39ff88', '#4cc9ff', '#ff9f43', '#b57bff', '#ff5d73', '#ffd166', '#ff6fb5'];
const EYE_COLORS = ['#2b1d10', '#3a6ea5', '#3f7a4a', '#7a5a34', '#4cc9ff', '#b57bff', '#ff3b5c'];

/** Original, game-inspired one-click looks (no existing characters are copied). */
export const AVATAR_PRESETS: { id: string; name: string; desc: string; patch: Partial<Appearance> }[] = [
  { id: 'neon-runner', name: 'Neon Runner', desc: 'Rooftop sprinter with a glowing visor.', patch: { bodyStyle: 'sleek', hairStyle: 'spiky', hairColor: '#4cc9ff', expression: 'determined', top: 'jacket', topColor: '#14161c', trimColor: '#39ff88', bottom: 'pants', bottomColor: '#1c2230', shoes: 'sneakers', shoeColor: '#39ff88', glasses: 'visor', headwear: 'none', gloves: 'tech', gloveColor: '#14161c', belt: 'none', accent: '#39ff88' } },
  { id: 'pixel-knight', name: 'Pixel Knight', desc: 'Blocky armoured guardian.', patch: { bodyStyle: 'blocky', hairStyle: 'short', hairColor: '#e3c27a', expression: 'smile', top: 'armor', topColor: '#5b6268', trimColor: '#ffd166', shoulders: 'armored', bottom: 'pants', bottomColor: '#3a3f46', shoes: 'boots', shoeColor: '#2a2d31', headwear: 'none', glasses: 'none', gloves: 'work', gloveColor: '#3a3f46', belt: 'belt', accent: '#ffd166' } },
  { id: 'star-courier', name: 'Star Courier', desc: 'Space delivery pilot with a flight helmet.', patch: { bodyStyle: 'heroic', hairStyle: 'swept', hairColor: '#e8e2d0', expression: 'grin', top: 'coverall', topColor: '#d9772b', trimColor: '#e8eef0', bottom: 'pants', shoes: 'boots', shoeColor: '#1a1a1f', headwear: 'headset', headwearColor: '#e8eef0', glasses: 'none', belt: 'harness', gloves: 'none', accent: '#ff9f43' } },
  { id: 'cozy-builder', name: 'Cozy Builder', desc: 'Friendly constructor in a beanie.', patch: { bodyStyle: 'chibi', hairStyle: 'braids', hairColor: '#8a3b1e', expression: 'smile', cheeks: 'blush', top: 'hoodie', topColor: '#f2c230', trimColor: '#2a1d14', bottom: 'shorts', bottomColor: '#3a5a8a', shoes: 'sneakers', shoeColor: '#e8eef0', headwear: 'beanie', headwearColor: '#c62f3a', glasses: 'none', belt: 'utility', gloves: 'none', accent: '#f2c230' } },
  { id: 'arcane-scholar', name: 'Arcane Scholar', desc: 'Robed researcher with round glasses.', patch: { bodyStyle: 'sleek', hairStyle: 'twin-buns', hairColor: '#b57bff', expression: 'focused', top: 'robe', topColor: '#2a1440', trimColor: '#ffd166', bottom: 'skirt', bottomColor: '#14161c', shoes: 'dress', shoeColor: '#14161c', headwear: 'none', glasses: 'round', gloves: 'none', belt: 'belt', accent: '#b57bff' } },
  { id: 'circuit-ace', name: 'Circuit Ace', desc: 'Cyber engineer with tech gloves.', patch: { bodyStyle: 'heroic', hairStyle: 'undercut', hairColor: '#ff5d73', expression: 'smirk', top: 'vest', topColor: '#103a4a', trimColor: '#7cf7ff', bottom: 'pants', bottomColor: '#14161c', shoes: 'boots', shoeColor: '#14161c', headwear: 'none', glasses: 'ar-glasses', gloves: 'tech', gloveColor: '#7cf7ff', belt: 'utility', faceMarkings: 'circuit', accent: '#7cf7ff' } },
];

const GROUPS = [
  { id: 'style', label: 'Style' }, { id: 'face', label: 'Face' }, { id: 'hair', label: 'Hair' }, { id: 'outfit', label: 'Outfit' },
] as const;
type GroupId = (typeof GROUPS)[number]['id'];

const pick = <T,>(xs: readonly T[]) => xs[Math.floor(Math.random() * xs.length)];

/** A random but coherent look: body, face, hair and outfit drawn from the option lists. */
export function randomLook(): Partial<Appearance> {
  const accent = pick(ACCENTS);
  return {
    bodyStyle: pick(BODY_STYLES), height: Math.round((0.9 + Math.random() * 0.2) * 100) / 100, build: pick(['slim', 'average', 'broad'] as const),
    skinTone: pick(SKIN_TONES), faceShape: pick(['round', 'oval', 'square'] as const), eyeStyle: pick(['dot', 'almond', 'wide'] as const), eyeColor: pick(EYE_COLORS),
    brows: pick(['thin', 'thick', 'angled'] as const), nose: pick(['button', 'straight', 'broad'] as const), mouth: pick(['small', 'wide', 'full'] as const),
    cheeks: pick(['none', 'none', 'blush', 'dimples'] as const), expression: pick(EXPRESSIONS), facialHair: pick(['none', 'none', 'none', 'stubble', 'beard', 'mustache'] as const),
    hairStyle: pick(HAIR_OPTIONS.map((h) => h.value)), hairColor: pick(HAIR_COLORS),
    top: pick(['tshirt', 'hoodie', 'jacket', 'vest', 'coverall', 'armor', 'robe', 'longcoat', 'suit'] as const), topColor: pick(CLOTH), trimColor: accent,
    bottom: pick(['pants', 'shorts', 'skirt'] as const), bottomColor: pick(CLOTH), shoes: pick(['sneakers', 'boots', 'dress'] as const), shoeColor: pick(CLOTH),
    headwear: pick(['none', 'none', 'cap', 'beanie', 'headset'] as const), headwearColor: pick(CLOTH), glasses: pick(['none', 'none', 'round', 'square', 'visor'] as const),
    gloves: pick(['none', 'none', 'tech', 'work'] as const), belt: pick(['none', 'belt', 'utility'] as const), accent,
  };
}

function usePrefersReducedMotion() {
  const q = typeof window !== 'undefined' && window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
  const [reduced, setReduced] = useState(!!q?.matches);
  useEffect(() => {
    if (!q) return;
    const on = () => setReduced(q.matches);
    q.addEventListener?.('change', on);
    return () => q.removeEventListener?.('change', on);
  }, [q]);
  return reduced;
}

// ---------- accessible building blocks ----------

/** A labelled radio group of buttons with roving focus (arrow keys move and select). */
function Choice<T extends string>({ label, value, options, onChange, render, columns }: {
  label: string; value: T | undefined; options: Opt<T>[]; onChange: (v: T) => void; render?: (v: T) => ReactNode; columns?: number;
}) {
  const id = useId();
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const idx = Math.max(0, options.findIndex((x) => x.value === value));
  const key = (e: KeyboardEvent, i: number) => {
    const d = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
    if (!d && e.key !== 'Home' && e.key !== 'End') return;
    e.preventDefault();
    const n = e.key === 'Home' ? 0 : e.key === 'End' ? options.length - 1 : (i + d + options.length) % options.length;
    refs.current[n]?.focus();
    onChange(options[n].value);
  };
  return (
    <div className="as-choice">
      <div className="label" id={id}>{label}</div>
      <div role="radiogroup" aria-labelledby={id} className={render ? 'as-tiles' : 'as-chips'} style={columns ? { gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` } : undefined}>
        {options.map((opt, i) => {
          const on = opt.value === value;
          return (
            <button key={opt.value} ref={(el) => { refs.current[i] = el; }} type="button" role="radio" aria-checked={on} tabIndex={i === idx ? 0 : -1}
              className={`as-opt${on ? ' on' : ''}`} title={opt.hint ? `${opt.label}: ${opt.hint}` : opt.label} onClick={() => onChange(opt.value)} onKeyDown={(e) => key(e, i)}>
              {render && <span className="as-thumb" aria-hidden>{render(opt.value)}</span>}
              <span>{opt.label}</span>
              {opt.badge && <small className="as-hint">{opt.badge}</small>}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function Panel({ title, children }: { title: string; children: ReactNode }) {
  return <section className="as-panel" aria-label={title}><h3>{title}</h3>{children}</section>;
}

// ---------- the studio ----------

const PREVIEW_VIEWS: { v: ViewMode; label: string }[] = [{ v: 'front', label: 'Front' }, { v: 'three-quarter', label: '3/4' }, { v: 'side', label: 'Side' }, { v: 'top', label: 'Floor plan' }];

export interface AvatarStudioProps {
  /** Optional: shown as an "Enter the headquarters" button when the host wants a way back to the 3D view. */
  onDone?: () => void;
}

/** Full-page avatar customization for the owner's character (doc.player). */
export function AvatarStudio({ onDone }: AvatarStudioProps = {}) {
  const player = useStore((s) => s.doc.player);
  const canUndo = useStore((s) => s.past.length > 0);
  const { commit, undo } = useStore.getState();
  const a = player.appearance;
  const reduced = usePrefersReducedMotion();
  const [group, setGroup] = useState<GroupId>('style');
  const [spin, setSpin] = useState(!reduced);
  const [pose, setPose] = useState<Pose>('idle');
  const [frame, setFrame] = useState(0);
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);
  useEffect(() => { if (reduced) setSpin(false); }, [reduced]);
  useEffect(() => {
    if (pose === 'idle' || reduced) { setFrame(0); return; }
    const t = setInterval(() => setFrame((f) => (f + 1) % 4), 220);
    return () => clearInterval(t);
  }, [pose, reduced]);

  const set = (patch: Partial<Appearance>, label = 'Edit your avatar') => commit([{ op: 'player.update', patch: { appearance: patch } }], label);
  // face close-up: a larger portrait cropped to the head so expressions and hair read at tile size
  const thumb = (patch: Partial<Appearance>) => <span className="as-face"><Character a={withAppearance(a, patch)} view="portrait" size={84} title="" /></span>;

  const tabKey = (e: KeyboardEvent, i: number) => {
    const d = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
    if (!d) return;
    e.preventDefault();
    const n = (i + d + GROUPS.length) % GROUPS.length;
    setGroup(GROUPS[n].id); tabRefs.current[n]?.focus();
  };
  const activePreset = useMemo(() => AVATAR_PRESETS.find((p) => Object.entries(p.patch).every(([k, v]) => (a as unknown as Record<string, unknown>)[k] === v))?.id, [a]);

  return (
    <div className={`avatar-studio${reduced ? ' reduced' : ''}`}>
      <header className="as-head">
        <div>
          <h2>Avatar Studio</h2>
          <p className="note">Design the character you explore the headquarters with. Changes save with your office, and Undo steps back through them.</p>
        </div>
        <NameField name={player.name} />
        <div className="row wrap as-actions">
          <button className="btn" onClick={() => set(randomLook(), 'Randomize your avatar')}><Dices size={14} aria-hidden />Randomize</button>
          <button className="btn" onClick={() => commit([{ op: 'player.update', patch: { appearance: defaultPlayer().appearance } }], 'Reset your avatar')}><RotateCcw size={14} aria-hidden />Reset</button>
          <button className="btn" disabled={!canUndo} onClick={undo}><Undo2 size={14} aria-hidden />Undo</button>
          {onDone && <button className="btn primary" onClick={onDone}>Enter the headquarters</button>}
        </div>
      </header>

      <div className="as-body">
        <section className="as-stage" aria-label="Live preview">
          <div className="as-3d">
            <AvatarPreview3D appearance={a} height={380} autoRotate={spin && !reduced} label={`3D preview of ${player.name}`} />
          </div>
          <div className="row wrap as-stage-controls">
            <label className="row small"><input type="checkbox" checked={spin && !reduced} disabled={reduced} onChange={(e) => setSpin(e.target.checked)} />Turntable{reduced ? ' (off: reduced motion)' : ''}</label>
            <span className="label">2D pose</span>
            <div className="seg" role="group" aria-label="2D preview pose">{(['idle', 'walk', 'work', 'talk'] as Pose[]).map((p) => <button key={p} className="btn sm" aria-pressed={pose === p} onClick={() => setPose(p)}>{p}</button>)}</div>
          </div>
          <div className="as-2d" aria-label="2D views used on the floor plan">
            {PREVIEW_VIEWS.map(({ v, label }) => (
              <figure key={v}>
                <div className="as-2d-fig"><Character a={a} view={v} pose={pose} frame={frame} heading={pose === 'walk' ? 'right' : 'down'} size={v === 'top' ? 90 : 150} title={`${label} view of ${player.name}`} /></div>
                <figcaption>{label}</figcaption>
              </figure>
            ))}
          </div>
          <div className="as-presets">
            <h3><Sparkles size={14} aria-hidden /> One-click looks</h3>
            <div className="as-preset-grid">
              {AVATAR_PRESETS.map((p) => (
                <button key={p.id} type="button" className={`as-preset${activePreset === p.id ? ' on' : ''}`} aria-pressed={activePreset === p.id} onClick={() => set(p.patch, `Wear the ${p.name} look`)}>
                  <Character a={withAppearance(a, p.patch)} view="portrait" size={56} title="" />
                  <span><b>{p.name}</b><small>{p.desc}</small></span>
                </button>
              ))}
            </div>
          </div>
        </section>

        <section className="as-controls" aria-label="Customize">
          <div role="tablist" aria-label="Customization groups" className="as-tabs">
            {GROUPS.map((g, i) => (
              <button key={g.id} ref={(el) => { tabRefs.current[i] = el; }} role="tab" id={`as-tab-${g.id}`} aria-controls={`as-pane-${g.id}`} aria-selected={group === g.id} tabIndex={group === g.id ? 0 : -1}
                className={`as-tab${group === g.id ? ' on' : ''}`} onClick={() => setGroup(g.id)} onKeyDown={(e) => tabKey(e, i)}>{g.label}</button>
            ))}
          </div>
          <div role="tabpanel" id={`as-pane-${group}`} aria-labelledby={`as-tab-${group}`} className="as-pane" tabIndex={0}>
            {group === 'style' && <>
              <Panel title="Body style">
                <Choice label="Proportions" value={a.bodyStyle ?? 'heroic'} columns={2} options={BODY_STYLES.map((b) => o(b, BODY_LABEL[b][0], BODY_LABEL[b][1]))} onChange={(bodyStyle) => set({ bodyStyle }, 'Change body style')} />
                <p className="note">{BODY_LABEL[a.bodyStyle ?? 'heroic'][1]}.</p>
              </Panel>
              <Panel title="Body details">
                <Slider label="Height" value={a.height} min={0.85} max={1.15} step={0.01} format={(v) => `${Math.round(v * 100)}%`} onCommit={(height) => set({ height }, 'Change height')} />
                <Choice label="Build" value={a.build} options={[o('slim', 'Slim'), o('average', 'Average'), o('broad', 'Broad')]} onChange={(build) => set({ build }, 'Change build')} />
                <ColorField label="Skin tone" value={a.skinTone} swatches={SKIN_TONES} onChange={(skinTone) => set({ skinTone }, 'Change skin tone')} />
                <ColorField label="Glow accent" value={a.accent} swatches={ACCENTS} onChange={(accent) => set({ accent }, 'Change accent')} />
              </Panel>
            </>}
            {group === 'face' && <>
              <Panel title="Expression">
                <Choice label="Resting expression" value={a.expression ?? 'neutral'} options={EXPRESSIONS.map((e) => o(e, EXPRESSION_LABEL[e]))} render={(expression) => thumb({ expression })} onChange={(expression) => set({ expression }, 'Change expression')} />
              </Panel>
              <Panel title="Features">
                <Choice label="Face shape" value={a.faceShape} options={[o('round', 'Round'), o('oval', 'Oval'), o('square', 'Square')]} onChange={(faceShape) => set({ faceShape }, 'Change face shape')} />
                <Choice label="Eyes" value={a.eyeStyle} options={[o('almond', 'Almond'), o('wide', 'Wide'), o('dot', 'Dot'), o('visor', 'Visor')]} onChange={(eyeStyle) => set({ eyeStyle }, 'Change eyes')} />
                <ColorField label="Eye colour" value={a.eyeColor} swatches={EYE_COLORS} onChange={(eyeColor) => set({ eyeColor }, 'Change eye colour')} />
                <Choice label="Eyebrows" value={a.brows} options={[o('thin', 'Thin'), o('thick', 'Thick'), o('angled', 'Angled'), o('none', 'None')]} onChange={(brows) => set({ brows }, 'Change eyebrows')} />
                <Choice label="Nose" value={a.nose ?? 'button'} options={[o('button', 'Button'), o('straight', 'Straight'), o('broad', 'Broad'), o('none', 'None')]} onChange={(nose) => set({ nose }, 'Change nose')} />
                <Choice label="Mouth" value={a.mouth ?? 'wide'} options={[o('small', 'Small'), o('wide', 'Wide'), o('full', 'Full')]} onChange={(mouth) => set({ mouth }, 'Change mouth')} />
                <Choice label="Cheeks" value={a.cheeks ?? 'none'} options={[o('none', 'Plain'), o('blush', 'Blush'), o('dimples', 'Dimples')]} onChange={(cheeks) => set({ cheeks }, 'Change cheeks')} />
                <Choice label="Facial hair" value={a.facialHair} options={[o('none', 'None'), o('stubble', 'Stubble'), o('beard', 'Beard'), o('mustache', 'Mustache')]} onChange={(facialHair) => set({ facialHair }, 'Change facial hair')} />
                <Choice label="Face markings" value={a.faceMarkings} options={[o('none', 'None'), o('freckles', 'Freckles'), o('scar', 'Scar'), o('tattoo', 'Tattoo'), o('circuit', 'Circuit')]} onChange={(faceMarkings) => set({ faceMarkings }, 'Change face markings')} />
              </Panel>
            </>}
            {group === 'hair' && <Panel title="Hair">
              <Choice label="Hair style (3D = sculpted for the headquarters)" value={a.hairStyle} options={HAIR_OPTIONS} render={(hairStyle) => thumb({ hairStyle, headwear: 'none' })} onChange={(hairStyle) => set({ hairStyle }, 'Change hair style')} />
              <ColorField label="Hair colour" value={a.hairColor} swatches={HAIR_COLORS} onChange={(hairColor) => set({ hairColor }, 'Change hair colour')} />
            </Panel>}
            {group === 'outfit' && <>
              <Panel title="Clothes">
                <Choice label="Top" value={a.top} options={[o('tshirt', 'T-shirt'), o('hoodie', 'Hoodie'), o('jacket', 'Jacket'), o('vest', 'Vest'), o('coverall', 'Coverall'), o('uniform', 'Uniform'), o('suit', 'Suit'), o('labcoat', 'Lab coat'), o('robe', 'Robe'), o('armor', 'Armour'), o('longcoat', 'Long coat')]} onChange={(top) => set({ top }, 'Change top')} />
                <div className="field-row"><ColorField label="Top colour" value={a.topColor} swatches={CLOTH} onChange={(topColor) => set({ topColor }, 'Change top colour')} /><ColorField label="Trim colour" value={a.trimColor} swatches={ACCENTS} onChange={(trimColor) => set({ trimColor }, 'Change trim colour')} /></div>
                <Choice label="Bottom" value={a.bottom} options={[o('pants', 'Trousers'), o('shorts', 'Shorts'), o('skirt', 'Skirt')]} onChange={(bottom) => set({ bottom }, 'Change bottom')} />
                <ColorField label="Bottom colour" value={a.bottomColor} swatches={CLOTH} onChange={(bottomColor) => set({ bottomColor }, 'Change bottom colour')} />
                <Choice label="Shoes" value={a.shoes} options={[o('sneakers', 'Sneakers'), o('boots', 'Boots'), o('dress', 'Dress shoes')]} onChange={(shoes) => set({ shoes }, 'Change shoes')} />
                <ColorField label="Shoe colour" value={a.shoeColor} swatches={CLOTH} onChange={(shoeColor) => set({ shoeColor }, 'Change shoe colour')} />
              </Panel>
              <Panel title="Accessories">
                <Choice label="Headwear" value={a.headwear} options={[o('none', 'None'), o('cap', 'Cap'), o('beanie', 'Beanie'), o('headset', 'Headset'), o('hardhat', 'Hard hat'), o('helmet', 'Helmet')]} onChange={(headwear) => set({ headwear }, 'Change headwear')} />
                {a.headwear !== 'none' && <ColorField label="Headwear colour" value={a.headwearColor} swatches={CLOTH} onChange={(headwearColor) => set({ headwearColor }, 'Change headwear colour')} />}
                <Choice label="Glasses" value={a.glasses} options={[o('none', 'None'), o('round', 'Round'), o('square', 'Square'), o('visor', 'Visor'), o('ar-glasses', 'AR glasses')]} onChange={(glasses) => set({ glasses }, 'Change glasses')} />
                <Choice label="Gloves" value={a.gloves} options={[o('none', 'None'), o('tech', 'Tech'), o('work', 'Work'), o('formal', 'Formal')]} onChange={(gloves) => set({ gloves }, 'Change gloves')} />
                {a.gloves !== 'none' && <ColorField label="Glove colour" value={a.gloveColor} swatches={CLOTH} onChange={(gloveColor) => set({ gloveColor }, 'Change glove colour')} />}
                <Choice label="Belt" value={a.belt} options={[o('none', 'None'), o('belt', 'Belt'), o('utility', 'Utility'), o('harness', 'Harness')]} onChange={(belt) => set({ belt }, 'Change belt')} />
              </Panel>
            </>}
          </div>
        </section>
      </div>
    </div>
  );
}

/** Name input: commits on blur/Enter; an empty name is refused by the op and the field goes back. */
function NameField({ name }: { name: string }) {
  const [v, setV] = useState(name);
  useEffect(() => setV(name), [name]);
  const save = () => {
    const t = v.trim();
    if (t === name) { setV(name); return; }
    const r = useStore.getState().commit([{ op: 'player.update', patch: { name: t } }], 'Rename your avatar');
    if (!r.ok) setV(name);
  };
  return (
    <label className="field as-name">
      <span>Avatar name</span>
      <input type="text" value={v} maxLength={40} onChange={(e) => setV(e.target.value)} onBlur={save} onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); if (e.key === 'Escape') setV(name); }} aria-describedby="as-name-help" />
      <small id="as-name-help" className="muted">Shown above your character in the headquarters.</small>
    </label>
  );
}

