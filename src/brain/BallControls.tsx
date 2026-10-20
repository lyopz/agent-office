// An agent's ball (its colour, glow and face), edited from the profile's Ball
// tab. Every change is one `agent.update` DocOp, so Undo works as usual.
import { useStore } from '../store/store';
import { EXPRESSIONS, type Agent, type Appearance } from '../model/types';
import { OUTFIT_FIELDS } from '../model/cosmetics';
import { BallIcon, ballColor } from './Ball';

const BODY = ['#39d0c8', '#4cc9ff', '#2b6cff', '#7b5cff', '#b57bff', '#ff6fb5', '#ff5d73', '#ff9f43', '#ffd166', '#9be15d', '#39ff88', '#e8eef0', '#8a94a6', '#2a2f3a'];
const GLOW = ['#7cf7ff', '#39ff88', '#4cc9ff', '#ff9f43', '#b57bff', '#ff5d73', '#ffd166', '#ff6fb5'];
const HAIR = ['#2a1d14', '#5a3a20', '#8a3b1e', '#e3c27a', '#e8e2d0', '#16181a', '#4cc9ff', '#b57bff', '#ff9ad5', '#39ff88'];
const EYE_COLORS = ['#2b1d10', '#3a6ea5', '#3f7a4a', '#7a5a34', '#4cc9ff', '#b57bff', '#ff3b5c'];
const EYES: [Appearance['eyeStyle'], string][] = [['dot', 'Dots'], ['almond', 'Almond'], ['wide', 'Big'], ['visor', 'Visor']];
const MOUTHS: [NonNullable<Appearance['mouth']>, string][] = [['small', 'Small'], ['wide', 'Wide'], ['full', 'Full']];
const CHEEKS: [NonNullable<Appearance['cheeks']>, string][] = [['none', 'None'], ['blush', 'Blush']];
const TUFTS: [Appearance['hairStyle'], string][] = [['bald', 'None'], ['short', 'Swoosh'], ['spiky', 'Spikes'], ['curly', 'Curls'], ['bun', 'Bun'], ['twin-buns', 'Two buns']];
const GLASSES: [Appearance['glasses'], string][] = [['none', 'None'], ['round', 'Round'], ['square', 'Square']];
const EXPRESSION_LABEL: Record<(typeof EXPRESSIONS)[number], string> = { neutral: 'Calm', smile: 'Smile', grin: 'Big grin', focused: 'Focused', surprised: 'Surprised', smirk: 'Smirk', determined: 'Determined' };


function Choice<T extends string>({ label, value, options, onPick, render }: { label: string; value: T; options: [T, string][]; onPick: (v: T) => void; render?: (v: T) => React.ReactNode }) {
  return (
    <fieldset className="bs-field">
      <legend>{label}</legend>
      <div className="bs-options" role="radiogroup" aria-label={label}>
        {options.map(([v, l]) => (
          <button key={v} type="button" role="radio" aria-checked={value === v} className={`bs-opt${value === v ? ' on' : ''}`} onClick={() => onPick(v)}>
            {render?.(v)}<span>{l}</span>
          </button>
        ))}
      </div>
    </fieldset>
  );
}

function Swatches({ label, value, colors, onPick, disabled, show = (c) => c }: { label: string; value: string; colors: string[]; onPick: (c: string) => void; disabled?: boolean; show?: (c: string) => string }) {
  return (
    <fieldset className="bs-field" disabled={disabled}>
      <legend>{label}</legend>
      <div className="bs-swatches" role="radiogroup" aria-label={label}>
        {colors.map((c) => <button key={c} type="button" role="radio" aria-checked={value.toLowerCase() === c} aria-label={c} className={`bs-swatch${value.toLowerCase() === c ? ' on' : ''}`} style={{ background: show(c) }} onClick={() => onPick(c)} />)}
        <label className="bs-custom" title="Pick any colour"><input type="color" value={/^#[0-9a-f]{6}$/i.test(value) ? value : '#888888'} onChange={(e) => onPick(e.target.value)} aria-label={`${label}: custom`} /><span>Custom</span></label>
      </div>
    </fieldset>
  );
}

/** The ball's colour, glow and face controls for one agent (the profile's Ball tab). */
export function BallControls({ agent }: { agent: Agent }) {
  const departments = useStore((s) => s.doc.departments);
  const outfits = useStore((s) => s.doc.outfitTemplates);
  const a = agent.appearance;
  const uniform = agent.uniformId ? outfits.find((o) => o.id === agent.uniformId && o.kind === 'uniform') : null;
  const locked = (k: keyof Appearance) => !!uniform && OUTFIT_FIELDS.includes(k);
  const set = (patch: Partial<Appearance>, what: string) => useStore.getState().commit([{ op: 'agent.update', id: agent.id, patch: { appearance: patch } }], `${agent.identity.name}: ${what}`);
  const team = Object.values(departments).find((d) => d.name.toLowerCase() === agent.identity.department.toLowerCase());

  return (
    <section className="bs-controls" aria-label={`${agent.identity.name}'s ball`}>
      {uniform && (
        <p className="note small">Wearing the locked {uniform.name}, so colour, glow and glasses come from the uniform. <button className="btn sm" onClick={() => useStore.getState().commit([{ op: 'agent.removeUniform', id: agent.id }], `Remove ${uniform.name}`)}>Take it off</button></p>
      )}
      <Swatches label="Ball colour" value={a.topColor} colors={BODY} disabled={locked('topColor')} show={(c) => ballColor({ ...a, topColor: c })} onPick={(c) => set({ topColor: c }, 'ball colour')} />
      {team && !locked('topColor') && <button className="btn sm bs-team" onClick={() => set({ topColor: team.color }, 'team colour')}><i style={{ background: team.color }} />Use {team.name} colour</button>}
      <Swatches label="Glow" value={a.accent} colors={GLOW} disabled={locked('accent')} onPick={(c) => set({ accent: c }, 'glow')} />
      <Choice label="Eyes" value={a.eyeStyle} options={EYES} onPick={(v) => set({ eyeStyle: v }, 'eyes')} render={(v) => <BallIcon a={{ ...a, eyeStyle: v }} size={34} mood={a.expression ?? 'smile'} />} />
      <Swatches label="Eye colour" value={a.eyeColor} colors={EYE_COLORS} onPick={(c) => set({ eyeColor: c }, 'eye colour')} />
      <Choice label="Resting face" value={a.expression ?? 'smile'} options={EXPRESSIONS.map((e) => [e, EXPRESSION_LABEL[e]])} onPick={(v) => set({ expression: v }, 'face')} render={(v) => <BallIcon a={a} size={34} mood={v} />} />
      <Choice label="Mouth" value={a.mouth ?? 'small'} options={MOUTHS} onPick={(v) => set({ mouth: v }, 'mouth')} />
      <Choice label="Cheeks" value={a.cheeks === 'blush' ? 'blush' : 'none'} options={CHEEKS} onPick={(v) => set({ cheeks: v }, 'cheeks')} />
      <Choice label="Tuft" value={(TUFTS.find(([t]) => t === a.hairStyle)?.[0]) ?? a.hairStyle} options={TUFTS} onPick={(v) => set({ hairStyle: v }, 'tuft')} render={(v) => <BallIcon a={{ ...a, hairStyle: v }} size={34} mood={a.expression ?? 'smile'} />} />
      {a.hairStyle !== 'bald' && a.hairStyle !== 'buzz' && <Swatches label="Tuft colour" value={a.hairColor} colors={HAIR} onPick={(c) => set({ hairColor: c }, 'tuft colour')} />}
      {!locked('glasses') && <Choice label="Glasses" value={a.glasses === 'round' || a.glasses === 'square' ? a.glasses : 'none'} options={GLASSES} onPick={(v) => set({ glasses: v }, 'glasses')} />}
    </section>
  );
}

