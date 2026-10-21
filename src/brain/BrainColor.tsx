// The colour of the brain the owner has picked. A swatch in the brain's
// toolbar opens a small palette: preset holo colours, any colour, and a way
// back to the default. The choice is saved on the brain, so every device shows it.
import { useEffect, useRef, useState } from 'react';
import { Palette, RotateCcw } from 'lucide-react';
import { useStore } from '../store/store';
import { useBrainFocus } from './ConnectomeView';
import { selectedBrain } from './BrainScene';
import { HOLO_DEFAULT, brainColor } from './brainMesh';
import type { Team } from './connectome';
import type { Agent } from '../model/types';

export const HOLO_PRESETS: { name: string; color: string }[] = [
  { name: 'Holo blue', color: '#5fb8ff' },
  { name: 'Mint', color: '#4ff0d0' },
  { name: 'Violet', color: '#b28cff' },
  { name: 'Magenta', color: '#ff7ad6' },
  { name: 'Brain red', color: '#ff354f' },
  { name: 'Amber', color: '#ffc46b' },
  { name: 'Lime', color: '#c8f06e' },
  { name: 'White', color: '#dfe9ff' },
];

export default function BrainColorPicker({ teams, agents }: { teams: Team[]; agents: Record<string, Agent> }) {
  const focus = useBrainFocus();
  const appearance = useStore((s) => s.doc.appearance);
  const commit = useStore((s) => s.commit);
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const pick = selectedBrain(focus, teams, agents);
  const current = brainColor(appearance, pick.key, pick.fallback);
  const custom = !!appearance.brainColors?.[pick.key];
  const set = (color: string | null) => commit([{ op: 'brain.setColor', brain: pick.key, color }], color ? `${pick.name} colour ${color}` : `${pick.name} colour reset`);

  useEffect(() => {
    if (!open) return;
    const onPointer = (e: PointerEvent) => { if (!root.current?.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('pointerdown', onPointer); document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('pointerdown', onPointer); document.removeEventListener('keydown', onKey); };
  }, [open]);

  return <div className="brain-color" ref={root} onPointerDown={(e) => e.stopPropagation()} onPointerUp={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()}>
    <button className="btn sm brain-color-trigger" aria-expanded={open} aria-haspopup="dialog" title={`Colour of the ${pick.name}`} onClick={() => setOpen((v) => !v)}>
      <i style={{ background: current, boxShadow: `0 0 8px ${current}` }} /><Palette size={12} /> Colour
    </button>
    {open && <section className="brain-color-pop" role="dialog" aria-label={`${pick.name} colour`} onWheel={(e) => e.stopPropagation()}>
      <header><b>{pick.name}</b><span>{custom ? 'your colour' : pick.fallback === HOLO_DEFAULT ? 'default holo' : 'team colour'}</span></header>
      <div className="brain-color-swatches" role="group" aria-label="Preset colours">
        {HOLO_PRESETS.map((p) => <button key={p.color} className="brain-color-swatch" aria-pressed={current.toLowerCase() === p.color} title={p.name} aria-label={p.name} style={{ background: p.color, boxShadow: current.toLowerCase() === p.color ? `0 0 0 2px #fff, 0 0 12px ${p.color}` : `0 0 8px ${p.color}66` }} onClick={() => set(p.color)} />)}
      </div>
      <label className="brain-color-custom">Any colour <input type="color" value={current} onChange={(e) => set(e.target.value)} aria-label={`Custom colour for the ${pick.name}`} /></label>
      <button className="btn sm" disabled={!custom} onClick={() => set(null)}><RotateCcw size={11} /> Default</button>
    </section>}
  </div>;
}
