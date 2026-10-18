import {
  AlignEndHorizontal, AlignEndVertical, AlignHorizontalDistributeCenter, AlignStartHorizontal, AlignStartVertical,
  AlignVerticalDistributeCenter, Armchair, CheckCircle2, DoorOpen, Grid3x3, Hand, Magnet, Monitor, MousePointer2,
  Redo2, Route, ScanLine, Spline, SquareDashed, SquarePlus, Trash2, Undo2, UserPlus, Workflow,
} from 'lucide-react';
import { useStore, type Tool } from '../store/store';
import { FURNITURE_TYPES } from '../model/types';
import { FURNITURE_META } from '../model/defaults';
import type { DocOp } from '../engine/ops';
import { deleteSelection } from './actions';

const TOOLS: { id: Tool; label: string; key: string; icon: typeof MousePointer2 }[] = [
  { id: 'select', label: 'Select / move / resize', key: 'V', icon: MousePointer2 },
  { id: 'pan', label: 'Pan', key: 'Space', icon: Hand },
  { id: 'room', label: 'Create room (drag)', key: 'R', icon: SquarePlus },
  { id: 'hallway', label: 'Create hallway / connect rooms', key: 'H', icon: Spline },
  { id: 'door', label: 'Create door (click a wall)', key: 'D', icon: DoorOpen },
  { id: 'workstation', label: 'Add workstation', key: 'K', icon: Monitor },
  { id: 'furniture', label: 'Add furniture', key: 'F', icon: Armchair },
  { id: 'agent', label: 'Add agent', key: 'N', icon: UserPlus },
];

export function alignOps(kind: 'left' | 'right' | 'top' | 'bottom' | 'hdist' | 'vdist'): DocOp[] {
  const s = useStore.getState();
  if (s.selection.kind !== 'room' || s.selection.ids.length < 2) return [];
  const rooms = s.selection.ids.map((id) => s.doc.rooms[id]);
  if (kind === 'left') { const x = Math.min(...rooms.map((r) => r.x)); return rooms.map((r) => ({ op: 'room.update', id: r.id, patch: { x } })); }
  if (kind === 'right') { const x = Math.max(...rooms.map((r) => r.x + r.w)); return rooms.map((r) => ({ op: 'room.update', id: r.id, patch: { x: x - r.w } })); }
  if (kind === 'top') { const y = Math.min(...rooms.map((r) => r.y)); return rooms.map((r) => ({ op: 'room.update', id: r.id, patch: { y } })); }
  if (kind === 'bottom') { const y = Math.max(...rooms.map((r) => r.y + r.h)); return rooms.map((r) => ({ op: 'room.update', id: r.id, patch: { y: y - r.h } })); }
  const horiz = kind === 'hdist';
  const sorted = [...rooms].sort((a, b) => (horiz ? a.x - b.x : a.y - b.y));
  const first = sorted[0], last = sorted[sorted.length - 1];
  const span = horiz ? last.x + last.w - first.x : last.y + last.h - first.y;
  const total = sorted.reduce((t, r) => t + (horiz ? r.w : r.h), 0);
  const gap = Math.max(1, Math.floor((span - total) / (sorted.length - 1)));
  let cur = horiz ? first.x : first.y;
  return sorted.map((r) => { const p = horiz ? { x: cur } : { y: cur }; cur += (horiz ? r.w : r.h) + gap; return { op: 'room.update', id: r.id, patch: p } as DocOp; });
}

export function Toolbar() {
  const mode = useStore((s) => s.mode);
  const tool = useStore((s) => s.tool);
  const layers = useStore((s) => s.layers);
  const view = useStore((s) => s.view);
  const furnitureType = useStore((s) => s.furnitureType);
  const canUndo = useStore((s) => s.past.length > 0);
  const canRedo = useStore((s) => s.future.length > 0);
  const multi = useStore((s) => s.selection.kind === 'room' && s.selection.ids.length > 1);
  const hasSel = useStore((s) => s.selection.kind !== 'none');
  const hallwayMode = useStore((s) => s.doc.settings.hallwayMode);
  const { setUi, setLayer, undo, redo, commit, notify } = useStore.getState();
  const construct = mode === 'construct';
  const align = (k: Parameters<typeof alignOps>[0], label: string) => { const ops = alignOps(k); if (ops.length) commit(ops, label); };
  return (
    <div className="toolbar" role="toolbar" aria-label="Construction tools">
      <div className="seg" role="group" aria-label="Mode">
        <button className="btn sm" aria-pressed={!construct} onClick={() => setUi({ mode: 'simulate', tool: 'select' })} title="Simulation mode (B)">Simulate</button>
        <button className="btn sm" aria-pressed={construct} onClick={() => setUi({ mode: 'construct' })} title="Construction mode (B)">Construct</button>
      </div>
      <span className="sep" />
      {TOOLS.map((t) => (
        <button key={t.id} className="btn icon sm" aria-pressed={tool === t.id} disabled={!construct && t.id !== 'select' && t.id !== 'pan'} title={`${t.label} (${t.key})`} aria-label={t.label}
          onClick={() => setUi({ tool: t.id, hallwayDraft: null })}><t.icon size={15} /></button>
      ))}
      {construct && tool === 'furniture' && (
        <select aria-label="Furniture type" value={furnitureType} onChange={(e) => setUi({ furnitureType: e.target.value })}>
          {FURNITURE_TYPES.map((f) => <option key={f} value={f}>{FURNITURE_META[f].label}</option>)}
        </select>
      )}
      <button className="btn icon sm" disabled={!hasSel || !construct} title="Delete selection (Del)" aria-label="Delete selection" onClick={deleteSelection}><Trash2 size={15} /></button>
      <span className="sep" />
      <button className="btn icon sm" disabled={!multi} title="Align left" aria-label="Align left" onClick={() => align('left', 'Align left')}><AlignStartVertical size={15} /></button>
      <button className="btn icon sm" disabled={!multi} title="Align right" aria-label="Align right" onClick={() => align('right', 'Align right')}><AlignEndVertical size={15} /></button>
      <button className="btn icon sm" disabled={!multi} title="Align top" aria-label="Align top" onClick={() => align('top', 'Align top')}><AlignStartHorizontal size={15} /></button>
      <button className="btn icon sm" disabled={!multi} title="Align bottom" aria-label="Align bottom" onClick={() => align('bottom', 'Align bottom')}><AlignEndHorizontal size={15} /></button>
      <button className="btn icon sm" disabled={!multi} title="Distribute horizontally" aria-label="Distribute horizontally" onClick={() => align('hdist', 'Distribute horizontally')}><AlignHorizontalDistributeCenter size={15} /></button>
      <button className="btn icon sm" disabled={!multi} title="Distribute vertically" aria-label="Distribute vertically" onClick={() => align('vdist', 'Distribute vertically')}><AlignVerticalDistributeCenter size={15} /></button>
      <span className="sep" />
      <button className="btn icon sm" aria-pressed={layers.grid} title="Toggle grid (G)" aria-label="Toggle grid" onClick={() => setLayer('grid', !layers.grid)}><Grid3x3 size={15} /></button>
      <button className="btn icon sm" aria-pressed={layers.snap} title="Toggle snapping (Shift+S)" aria-label="Toggle snapping" onClick={() => setLayer('snap', !layers.snap)}><Magnet size={15} /></button>
      <button className="btn icon sm" aria-pressed={layers.boundaries} title="Show room boundaries" aria-label="Show room boundaries" onClick={() => setLayer('boundaries', !layers.boundaries)}><SquareDashed size={15} /></button>
      <button className="btn icon sm" aria-pressed={layers.paths} title="Show navigation paths (P)" aria-label="Show navigation paths" onClick={() => setLayer('paths', !layers.paths)}><Route size={15} /></button>
      <button className="btn icon sm" aria-pressed={layers.labels} title="Labels and occupancy" aria-label="Labels and occupancy" onClick={() => { setLayer('labels', !layers.labels); setLayer('occupancy', !layers.labels); }}><ScanLine size={15} /></button>
      <span className="sep" />
      <button className="btn sm" title="Validate layout" onClick={() => { const n = useStore.getState().issues; notify(n.length ? `${n.filter((i) => i.severity === 'error').length} error(s), ${n.filter((i) => i.severity === 'warning').length} warning(s) — see Inspector` : 'Layout is valid', n.some((i) => i.severity === 'error') ? 'warn' : 'info'); }}><CheckCircle2 size={14} />Validate</button>
      <button className="btn sm" title="Reroute every automatic hallway and repair disconnected segments" onClick={() => commit([{ op: 'corridors.realign' }], 'Realign hallways')}><Workflow size={14} />Realign</button>
      <select aria-label="Hallway mode" title="Hallway connection mode" value={hallwayMode} onChange={(e) => commit([{ op: 'settings.update', patch: { hallwayMode: e.target.value as never } }], 'Hallway mode')}>
        <option value="automatic">Halls: automatic</option><option value="hybrid">Halls: hybrid</option><option value="manual">Halls: manual</option>
      </select>
      <span className="sep" />
      <button className="btn icon sm" disabled={!canUndo} title="Undo (Ctrl+Z)" aria-label="Undo" onClick={undo}><Undo2 size={15} /></button>
      <button className="btn icon sm" disabled={!canRedo} title="Redo (Ctrl+Shift+Z)" aria-label="Redo" onClick={redo}><Redo2 size={15} /></button>
      <span className="spacer" />
      <label className="row small muted" style={{ gap: 4 }}>View
        <select aria-label="Character view" value={view} onChange={(e) => { setUi({ view: e.target.value as never }); useStore.getState().setPrefs({ viewMode: e.target.value }); }}>
          <option value="auto">Per agent</option><option value="top">Top-down</option><option value="front">Front</option><option value="side">Side</option><option value="three-quarter">Three-quarter</option>
        </select>
      </label>
    </div>
  );
}
