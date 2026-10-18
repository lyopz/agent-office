import { useEffect, useRef, useState, type ReactNode } from 'react';
import { create } from 'zustand';

/** Text input that commits on blur / Enter, so each edit is one history entry. */
export function TextField({ label, value, onCommit, multiline, placeholder, field, maxLength = 2000 }: {
  label: string; value: string; onCommit: (v: string) => void; multiline?: boolean; placeholder?: string; field?: string; maxLength?: number;
}) {
  const [v, setV] = useState(value);
  useEffect(() => setV(value), [value]);
  const commit = () => { if (v !== value) onCommit(v); };
  return (
    <label className="field">
      <span>{label}</span>
      {multiline
        ? <textarea value={v} maxLength={maxLength} placeholder={placeholder} data-field={field} onChange={(e) => setV(e.target.value)} onBlur={commit} />
        : <input type="text" value={v} maxLength={maxLength} placeholder={placeholder} data-field={field} onChange={(e) => setV(e.target.value)} onBlur={commit} onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); if (e.key === 'Escape') setV(value); }} />}
    </label>
  );
}

export function NumberField({ label, value, onCommit, min, max, step = 1, field }: { label: string; value: number; onCommit: (v: number) => void; min?: number; max?: number; step?: number; field?: string }) {
  const [v, setV] = useState(String(value));
  useEffect(() => setV(String(value)), [value]);
  const commit = () => {
    const n = Number(v);
    if (!Number.isFinite(n)) { setV(String(value)); return; }
    const c = Math.max(min ?? -Infinity, Math.min(max ?? Infinity, n));
    if (c !== value) onCommit(c); else setV(String(value));
  };
  return (
    <label className="field">
      <span>{label}</span>
      <input type="number" value={v} min={min} max={max} step={step} data-field={field} onChange={(e) => setV(e.target.value)} onBlur={commit} onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }} />
    </label>
  );
}

export function SelectField<T extends string>({ label, value, options, onChange, field }: { label: string; value: T; options: readonly T[] | { value: T; label: string }[]; onChange: (v: T) => void; field?: string }) {
  const opts = (options as readonly (T | { value: T; label: string })[]).map((o) => (typeof o === 'string' ? { value: o, label: o } : o));
  return (
    <label className="field">
      <span>{label}</span>
      <select value={value} data-field={field} onChange={(e) => onChange(e.target.value as T)}>
        {opts.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </label>
  );
}

/** Slider that previews locally while dragging and commits once on release. */
export function Slider({ label, value, onCommit, min = 0, max = 100, step = 1, format }: { label: string; value: number; onCommit: (v: number) => void; min?: number; max?: number; step?: number; format?: (v: number) => string }) {
  const [v, setV] = useState(value);
  useEffect(() => setV(value), [value]);
  const commit = () => { if (v !== value) onCommit(v); };
  return (
    <label className="field">
      <span className="row"><span className="grow">{label}</span><span className="mono-num" style={{ color: 'var(--accent)' }}>{format ? format(v) : v}</span></span>
      <input type="range" min={min} max={max} step={step} value={v} onChange={(e) => setV(Number(e.target.value))} onPointerUp={commit} onKeyUp={commit} onBlur={commit} />
    </label>
  );
}

export function ColorField({ label, value, onChange, swatches }: { label: string; value: string; onChange: (v: string) => void; swatches?: string[] }) {
  const [v, setV] = useState(value);
  useEffect(() => setV(value), [value]);
  return (
    <div className="field">
      <span>{label}</span>
      <div className="row">
        <input type="color" aria-label={label} value={/^#[0-9a-f]{6}$/i.test(v) ? v : '#000000'} onChange={(e) => setV(e.target.value)} onBlur={() => v !== value && onChange(v)} />
        {swatches && <div className="swatches">{swatches.map((s) => <button key={s} type="button" aria-label={`Use ${s}`} aria-pressed={s.toLowerCase() === value.toLowerCase()} style={{ background: s }} onClick={() => onChange(s)} />)}</div>}
      </div>
    </div>
  );
}

export function ChipsInput({ label, values, onChange, placeholder, suggestions }: { label: string; values: string[]; onChange: (v: string[]) => void; placeholder?: string; suggestions?: string[] }) {
  const [t, setT] = useState('');
  const add = (x: string) => { const s = x.trim(); if (s && !values.includes(s)) onChange([...values, s]); setT(''); };
  const listId = useRef(`dl-${Math.random().toString(36).slice(2)}`).current;
  return (
    <div className="field">
      <span>{label}</span>
      <div className="chips" style={{ marginBottom: 4 }}>
        {values.map((v) => <span key={v} className="chip">{v}<button type="button" aria-label={`Remove ${v}`} onClick={() => onChange(values.filter((x) => x !== v))}>×</button></span>)}
        {!values.length && <span className="muted small">none</span>}
      </div>
      <input type="text" list={suggestions ? listId : undefined} value={t} placeholder={placeholder ?? 'Type and press Enter'} onChange={(e) => setT(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); add(t); } }} onBlur={() => t && add(t)} aria-label={`Add ${label}`} />
      {suggestions && <datalist id={listId}>{suggestions.map((s) => <option key={s} value={s} />)}</datalist>}
    </div>
  );
}

export function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return <label className="check"><input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />{label}</label>;
}

export function Section({ title, children, actions }: { title: string; children: ReactNode; actions?: ReactNode }) {
  return <div className="section"><div className="row" style={{ marginBottom: 8 }}><h3 className="grow" style={{ margin: 0 }}>{title}</h3>{actions}</div>{children}</div>;
}

// ---------- confirmation dialog (no native confirm(), works in sandboxed frames) ----------
interface ConfirmReq { title: string; body: ReactNode; confirmLabel: string; danger?: boolean; onConfirm: () => void }
export const useConfirm = create<{ req: ConfirmReq | null; ask: (r: ConfirmReq) => void; close: () => void }>((set) => ({
  req: null, ask: (req) => set({ req }), close: () => set({ req: null }),
}));
export const confirmAction = (r: ConfirmReq) => useConfirm.getState().ask(r);

export function ConfirmDialog() {
  const { req, close } = useConfirm();
  const ref = useRef<HTMLButtonElement>(null);
  useEffect(() => { if (req) setTimeout(() => ref.current?.focus(), 10); }, [req]);
  if (!req) return null;
  return (
    <div className="overlay" onKeyDown={(e) => e.key === 'Escape' && close()}>
      <div className="modal" role="alertdialog" aria-modal="true" aria-labelledby="confirm-title">
        <div className="panel-h" id="confirm-title">{req.title}</div>
        <div className="modal-b note" style={{ fontSize: 'var(--fs-md)', color: 'var(--text)' }}>{req.body}</div>
        <div className="modal-f">
          <button className="btn" ref={ref} onClick={close}>Cancel</button>
          <button className={`btn ${req.danger ? 'danger' : 'primary'}`} onClick={() => { req.onConfirm(); close(); }}>{req.confirmLabel}</button>
        </div>
      </div>
    </div>
  );
}
