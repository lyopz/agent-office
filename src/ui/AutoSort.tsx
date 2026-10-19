// Auto Sort: a preview of the rearranged campus with what moves and why, then
// apply, apply-and-adjust by hand, or cancel. Applying is one undoable step.
import { create } from 'zustand';
import { Sparkles, Undo2, X } from 'lucide-react';
import { useStore } from '../store/store';
import { planAutoSort, type AutoSortPlan } from '../engine/autosort';
import type { LayoutPreset } from '../model/types';
import { G } from '../viewport/OfficeLayers';

interface AutoSortState { open: boolean; plan: AutoSortPlan | null; applied: { label: string; moved: number } | null }
const useAutoSort = create<AutoSortState>(() => ({ open: false, plan: null, applied: null }));

function preview() {
  const s = useStore.getState();
  const plan = planAutoSort(s.doc, s.runtime);
  useAutoSort.setState({ open: true, plan, applied: null });
  if (!plan.ops.length) { s.setUi({ preview: null }); return; }
  const dry = s.dryRun(plan.ops);
  if (!dry.ok || !dry.doc) { useAutoSort.setState({ plan: { ...plan, ops: [], moves: [], message: `Auto Sort could not build a valid layout: ${dry.errors[0] ?? 'unknown error'}` } }); s.setUi({ preview: null }); return; }
  s.setUi({ preview: { doc: dry.doc, ops: plan.ops, runtimeOps: [], label: 'Auto Sort', summary: dry.summary, issues: dry.conflicts, source: 'autosort' } });
}

function close() {
  const s = useStore.getState();
  if (s.preview?.source === 'autosort') s.setUi({ preview: null });
  useAutoSort.setState({ open: false, plan: null, applied: null });
}

function apply(adjust: boolean) {
  const { plan } = useAutoSort.getState();
  const s = useStore.getState();
  if (!plan?.ops.length) return;
  const r = s.commit(plan.ops, 'Auto Sort');
  s.setUi({ preview: null });
  if (!r.ok) { if (!r.errors.length) useAutoSort.setState({ open: false }); return; } // warnings: the conflict dialog takes over
  useAutoSort.setState({ plan: null, applied: { label: plan.message, moved: plan.moves.length } });
  if (adjust) s.setUi({ mode: 'construct', tool: 'select', selection: { kind: 'room', ids: plan.moves.map((m) => m.roomId) } });
  s.notify(adjust ? 'Auto Sort applied. Drag rooms to fine-tune; Undo reverts the whole sort.' : 'Auto Sort applied. Undo reverts it.');
}

export function AutoSortButton() {
  const open = useAutoSort((s) => s.open);
  return (
    <button className="btn sm primary autosort-btn" aria-expanded={open} title="Arrange rooms by team, shared resources and how agents work together" onClick={() => (open ? close() : preview())}>
      <Sparkles size={14} />Auto Sort
    </button>
  );
}

export function LayoutPresetSelect() {
  const preset = useStore((s) => s.doc.settings.layoutPreset ?? 'grid');
  return (
    <select aria-label="Layout preset" title="Campus layout preset" value={preset} onChange={(e) => {
      useStore.getState().commit([{ op: 'settings.update', patch: { layoutPreset: e.target.value as LayoutPreset } }], 'Layout preset');
      if (useAutoSort.getState().open) preview();
    }}>
      <option value="grid">Layout: grid offices</option>
      <option value="bubble">Layout: bubble office</option>
    </select>
  );
}

export function AutoSortPanel() {
  const { open, plan, applied } = useAutoSort();
  const canUndo = useStore((s) => s.past.length > 0 && s.past[s.past.length - 1]?.label === 'Auto Sort');
  if (!open) return null;
  const shown = plan?.moves.slice(0, 7) ?? [];
  return (
    <aside className="autosort-panel" role="dialog" aria-label="Auto Sort">
      <header className="row">
        <Sparkles size={15} /><strong>Auto Sort</strong>
        <span className="small muted">{plan ? (plan.preset === 'bubble' ? 'bubble office' : 'grid offices') : ''}</span>
        <span className="spacer" />
        <button className="btn icon sm" aria-label="Close Auto Sort" onClick={close}><X size={14} /></button>
      </header>
      {applied ? (
        <>
          <p className="small">Applied. {applied.label}</p>
          <div className="row">
            <button className="btn sm" disabled={!canUndo} onClick={() => { useStore.getState().undo(); useAutoSort.setState({ applied: null }); preview(); }}><Undo2 size={13} />Undo sort</button>
            <button className="btn sm" onClick={close}>Done</button>
          </div>
        </>
      ) : plan && (
        <>
          <p className="small">{plan.message}</p>
          {shown.length > 0 && (
            <>
              <div className="label">What moves and why</div>
              <ul className="autosort-moves">
                {shown.map((m) => <li key={m.roomId}><b>{m.name}</b> <span className="muted">{m.reason}</span></li>)}
                {plan.moves.length > shown.length && <li className="muted">and {plan.moves.length - shown.length} more</li>}
              </ul>
              {plan.groups.length > 1 && <p className="small muted">Grouped as {plan.groups.slice(0, 4).map((g) => g.name).join(', ')}{plan.groups.length > 4 ? '…' : ''}. Hallways and tubes reroute with the rooms.</p>}
            </>
          )}
          <div className="row wrap">
            <button className="btn sm primary" disabled={!plan.ops.length} onClick={() => apply(false)}>Apply</button>
            <button className="btn sm" disabled={!plan.ops.length} title="Apply, then drag rooms to fine-tune" onClick={() => apply(true)}>Apply and adjust</button>
            <button className="btn sm" onClick={close}>Cancel</button>
          </div>
        </>
      )}
    </aside>
  );
}

/** Arrows from each room's current spot to where Auto Sort would put it. */
export function AutoSortGhosts() {
  const plan = useAutoSort((s) => s.plan);
  const rooms = useStore((s) => s.doc.rooms);
  if (!plan?.moves.length) return null;
  return (
    <g pointerEvents="none" className="autosort-ghosts">
      <defs><marker id="as-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10z" fill="var(--accent-blue)" /></marker></defs>
      {plan.moves.map((m) => {
        const r = rooms[m.roomId]; if (!r) return null;
        const a = { x: (m.from.x + r.w / 2) * G, y: (m.from.y + r.h / 2) * G }, b = { x: (m.to.x + r.w / 2) * G, y: (m.to.y + r.h / 2) * G };
        return (
          <g key={m.roomId}>
            <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="var(--accent-blue)" strokeWidth={2} strokeOpacity={0.7} strokeDasharray="6 5" markerEnd="url(#as-arrow)" />
            <text x={b.x} y={b.y} textAnchor="middle" className="room-label" fill="var(--accent-blue)">{r.name.toUpperCase()}</text>
          </g>
        );
      })}
    </g>
  );
}
