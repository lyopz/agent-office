// Object library: browse by category, search, and arm an object for
// one-click placement. The viewport shows a ghost with collision colouring.
import { useMemo, useState } from 'react';
import { Search, X } from 'lucide-react';
import { useStore } from '../store/store';
import { FURNITURE_TYPES, OBJECT_CATEGORIES, type FurnitureType, type ObjectCategory } from '../model/types';
import { CATEGORY_LABEL, FURNITURE_META } from '../model/catalog';
import { FurnitureShape, G } from '../viewport/OfficeLayers';

function Thumb({ type }: { type: FurnitureType }) {
  const m = FURNITURE_META[type];
  const s = Math.max(m.w, m.h);
  return (
    <svg viewBox={`${-0.25 * G} ${-0.25 * G} ${(s + 0.5) * G} ${(s + 0.5) * G}`} width={40} height={40} aria-hidden>
      <g transform={`translate(${((s - m.w) / 2) * G} ${((s - m.h) / 2) * G})`}><FurnitureShape f={{ type, color: m.color }} x={0} y={0} w={m.w} h={m.h} /></g>
    </svg>
  );
}

export function ObjectLibrary() {
  const furnitureType = useStore((s) => s.furnitureType);
  const rotation = useStore((s) => s.placeRotation);
  const rule = useStore((s) => s.doc.settings.collisionRule);
  const { setUi, commit } = useStore.getState();
  const [cat, setCat] = useState<ObjectCategory | 'all'>('all');
  const [q, setQ] = useState('');
  const items = useMemo(() => FURNITURE_TYPES.filter((t) => {
    const m = FURNITURE_META[t];
    if (cat !== 'all' && m.category !== cat) return false;
    const needle = q.trim().toLowerCase();
    return !needle || m.label.toLowerCase().includes(needle) || m.desc.toLowerCase().includes(needle) || t.includes(needle);
  }), [cat, q]);
  const armed = FURNITURE_META[furnitureType as FurnitureType];
  return (
    <aside className="obj-lib" aria-label="Object library">
      <div className="panel-h row"><span>Object library</span><span className="spacer" /><button className="btn icon sm" aria-label="Close object library" onClick={() => setUi({ tool: 'select' })}><X size={13} /></button></div>
      <div className="obj-lib-search"><Search size={13} aria-hidden /><input type="search" placeholder="Search objects" aria-label="Search objects" value={q} onChange={(e) => setQ(e.target.value)} /></div>
      <div className="chips" role="tablist" aria-label="Object categories">
        {(['all', ...OBJECT_CATEGORIES] as const).map((c) => <button key={c} role="tab" aria-selected={cat === c} className="chip-btn" onClick={() => setCat(c)}>{c === 'all' ? 'All' : CATEGORY_LABEL[c]}</button>)}
      </div>
      <div className="obj-grid">
        {items.map((t) => (
          <button key={t} className="obj-item" aria-pressed={furnitureType === t} title={FURNITURE_META[t].desc} onClick={() => setUi({ furnitureType: t, tool: 'furniture' })}>
            <Thumb type={t} /><span>{FURNITURE_META[t].label}</span>
          </button>
        ))}
        {!items.length && <p className="note">No objects match.</p>}
      </div>
      <div className="obj-lib-f">
        {armed && <p className="note"><b>{armed.label}</b> · {armed.w}×{armed.h} · {rotation}° — click a room to place, <span className="kbd">E</span> rotates.{armed.fn !== 'none' ? ` Functional: ${armed.fn}.` : ''}</p>}
        <label className="row small"><input type="checkbox" checked={rule === 'prevent'} onChange={(e) => commit([{ op: 'settings.update', patch: { collisionRule: e.target.checked ? 'prevent' : 'warn' } }], 'Collision rule')} /> Prevent overlapping objects</label>
      </div>
    </aside>
  );
}
