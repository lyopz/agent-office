// Ball Studio: pick an agent and choose its ball's colour, glow and face.
// Every change is one `agent.update` DocOp, so Undo works as usual. A preview
// shows how the face reacts to what the agent is doing.
import { useMemo, useState } from 'react';
import { Dices, Undo2 } from 'lucide-react';
import { useStore } from '../store/store';
import { EXPRESSIONS, type Agent, type AgentStatus, type Appearance, type OutfitTemplate } from '../model/types';
import { OUTFIT_FIELDS } from '../model/cosmetics';
import { BallIcon, ballColor, moodFor } from './Ball';
import { STATUS_COLOR } from '../viewport/AgentsLayer';

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
const PREVIEW: [AgentStatus, string][] = [['idle', 'Idle'], ['working', 'Working'], ['thinking', 'Thinking'], ['communicating', 'Talking'], ['error', 'Stuck'], ['paused', 'Paused']];

const pick = <T,>(xs: readonly T[]) => xs[Math.floor(Math.random() * xs.length)];

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

function surprise(agent: Agent, outfits: OutfitTemplate[]) {
  const locked = !!agent.uniformId && outfits.some((o) => o.id === agent.uniformId && o.kind === 'uniform');
  const look: Partial<Appearance> = {
    ...(locked ? {} : { topColor: pick(BODY), accent: pick(GLOW) }),
    eyeStyle: pick(EYES)[0], eyeColor: pick(EYE_COLORS), expression: pick(EXPRESSIONS), mouth: pick(MOUTHS)[0], cheeks: pick(CHEEKS)[0], hairStyle: pick(TUFTS)[0], hairColor: pick(HAIR),
  };
  useStore.getState().commit([{ op: 'agent.update', id: agent.id, patch: { appearance: look } }], `${agent.identity.name}: surprise look`);
}

/** The ball's colour, glow and face controls for one agent (Ball Studio and the profile's Appearance tab). */
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

export function BallStudio({ onDone }: { onDone: () => void }) {
  const agents = useStore((s) => s.doc.agents);
  const outfits = useStore((s) => s.doc.outfitTemplates);
  const selected = useStore((s) => (s.selection.kind === 'agent' ? s.selection.id : null));
  const canUndo = useStore((s) => s.past.length > 0);
  const list = useMemo(() => Object.values(agents).sort((a, b) => a.identity.department.localeCompare(b.identity.department) || a.identity.name.localeCompare(b.identity.name)), [agents]);
  const [chosen, setChosen] = useState<string | null>(null);
  const id = chosen && agents[chosen] ? chosen : selected && agents[selected] ? selected : list[0]?.id ?? null;
  const [preview, setPreview] = useState<AgentStatus>('idle');
  const agent = id ? agents[id] : null;
  if (!agent) return <div className="ball-studio empty"><p className="muted">No agents yet. Add one from the Classic floor plan or the Control page.</p></div>;
  const a = agent.appearance;
  return (
    <div className="ball-studio">
      <aside className="bs-list" aria-label="Agents">
        <div className="label">Agents</div>
        <ul>
          {list.map((x) => (
            <li key={x.id}><button className={`bs-agent${x.id === agent.id ? ' on' : ''}`} aria-pressed={x.id === agent.id} onClick={() => { setChosen(x.id); useStore.getState().setUi({ selection: { kind: 'agent', id: x.id } }); }}>
              <BallIcon a={x.appearance} size={30} mood={x.appearance.expression ?? 'smile'} />
              <span><b>{x.identity.name}</b><small className="muted">{x.identity.department}</small></span>
            </button></li>
          ))}
        </ul>
      </aside>
      <section className="bs-stage" aria-label="Preview">
        <div className="bs-preview">
          <div className="bs-bounce" key={preview}><BallIcon a={a} size={220} mood={moodFor(preview, a.expression ?? 'smile')} ring={STATUS_COLOR[preview]} title={`${agent.identity.name} ball preview`} /></div>
        </div>
        <h2>{agent.identity.name}</h2>
        <p className="muted small">{agent.identity.title} · {agent.identity.department}</p>
        <div className="seg bs-moods" role="group" aria-label="Preview the face while the agent is…">
          {PREVIEW.map(([s, l]) => <button key={s} className="btn sm" aria-pressed={preview === s} onClick={() => setPreview(s)}>{l}</button>)}
        </div>
        <div className="row wrap bs-actions">
          <button className="btn sm" onClick={() => surprise(agent, outfits)}><Dices size={13} />Surprise me</button>
          <button className="btn sm" disabled={!canUndo} onClick={() => useStore.getState().undo()}><Undo2 size={13} />Undo</button>
          <button className="btn sm primary" onClick={onDone}>Done</button>
        </div>
      </section>
      <BallControls agent={agent} />
    </div>
  );
}
