// Interface theme editor: dark/light/system, presets, every colour token with
// hex input, contrast checks, before/after preview, save, duplicate, import,
// export and restore.
import { useEffect, useMemo, useState } from 'react';
import { useStore } from '../store/store';
import type { ThemeDef, ThemeTokens } from '../model/types';
import { BUILTIN_THEMES, activeTheme, contrastIssues, parseHex, resolveMode, themeVars } from '../model/themes';
import { saveFile } from '../persistence/saveFile';
import { uid } from '../model/defaults';

const TOKEN_LABEL: Record<keyof ThemeTokens, string> = {
  bg: 'Primary background', bg2: 'Secondary background', panel: 'Panels', accent: 'Primary accent', accent2: 'Secondary accent', text: 'Text',
  border: 'Borders', selection: 'Selection', success: 'Success', warning: 'Warning', error: 'Error', highlight: 'Highlight / focus',
};

export function usePrefersDark() {
  const q = typeof window !== 'undefined' && window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;
  const [dark, setDark] = useState(q ? q.matches : true);
  useEffect(() => { if (!q) return; const f = (e: MediaQueryListEvent) => setDark(e.matches); q.addEventListener('change', f); return () => q.removeEventListener('change', f); }, [q]);
  return dark;
}

/** Applies the active theme's variables to the document root. Character colours are never themed. */
export function useApplyTheme() {
  const ap = useStore((s) => s.doc.appearance);
  const prefersDark = usePrefersDark();
  useEffect(() => {
    const t = activeTheme(ap); const mode = resolveMode(ap.mode, prefersDark);
    const vars = themeVars(t[mode], mode);
    const root = document.documentElement;
    for (const [k, v] of Object.entries(vars)) { if (k === 'color-scheme') root.style.colorScheme = v; else root.style.setProperty(k, v); }
    root.dataset.theme = mode;
  }, [ap, prefersDark]);
}

function Swatch({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  const [t, setT] = useState(value);
  useEffect(() => setT(value), [value]);
  const ok = !!parseHex(t);
  return (
    <label className="theme-swatch">
      <span className="grow">{label}</span>
      <input type="color" aria-label={`${label} colour picker`} value={ok ? (t.length === 4 ? `#${t[1]}${t[1]}${t[2]}${t[2]}${t[3]}${t[3]}` : t) : '#000000'} onChange={(e) => { setT(e.target.value); onChange(e.target.value); }} />
      <input type="text" aria-label={`${label} hex`} value={t} maxLength={7} style={{ width: 84, borderColor: ok ? undefined : 'var(--danger)' }} onChange={(e) => { setT(e.target.value); if (parseHex(e.target.value)) onChange(e.target.value.startsWith('#') ? e.target.value : `#${e.target.value}`); }} />
    </label>
  );
}

function Preview({ theme, mode, label }: { theme: ThemeDef; mode: 'dark' | 'light'; label: string }) {
  const vars = themeVars(theme[mode], mode) as Record<string, string>;
  const style = Object.fromEntries(Object.entries(vars).filter(([k]) => k.startsWith('--'))) as React.CSSProperties;
  return (
    <figure className="theme-preview" style={{ ...style, background: 'var(--bg)', color: 'var(--text)' }}>
      <figcaption>{label}</figcaption>
      <div style={{ background: 'var(--panel)', border: '1px solid var(--border)', padding: 8, display: 'grid', gap: 6 }}>
        <div style={{ color: 'var(--accent)', fontWeight: 700 }}>THE BRAIN</div>
        <div style={{ color: 'var(--muted)', fontSize: 11 }}>Secondary text</div>
        <div className="row" style={{ gap: 4 }}>
          <span style={{ border: '1px solid var(--accent)', color: 'var(--accent)', padding: '1px 6px', fontSize: 11 }}>Button</span>
          <span style={{ color: 'var(--warn)', fontSize: 11 }}>warning</span><span style={{ color: 'var(--danger)', fontSize: 11 }}>error</span><span style={{ color: 'var(--success)', fontSize: 11 }}>ok</span>
        </div>
        <svg viewBox="0 0 120 50" width="100%" height={50} aria-hidden>
          <rect x={6} y={6} width={50} height={38} fill="var(--floor-grid)" stroke="var(--wall)" strokeWidth={3} />
          <rect x={56} y={20} width={40} height={10} fill="var(--hall-floor)" />
          <rect x={96} y={6} width={18} height={38} fill="var(--floor-grid)" stroke="var(--wall)" strokeWidth={3} />
          <rect x={53} y={20} width={6} height={10} fill="var(--door)" />
          <rect x={14} y={14} width={16} height={8} fill="var(--panel-3)" stroke="var(--accent)" strokeOpacity={0.5} />
          <circle cx={40} cy={32} r={4} fill="#d9772b" /><circle cx={105} cy={25} r={4} fill="#4cc9ff" />
        </svg>
      </div>
    </figure>
  );
}

export function ThemeEditor() {
  const ap = useStore((s) => s.doc.appearance);
  const { commit, notify } = useStore.getState();
  const prefersDark = usePrefersDark();
  const current = activeTheme(ap);
  const [draft, setDraft] = useState<ThemeDef>(() => JSON.parse(JSON.stringify(current)));
  useEffect(() => setDraft(JSON.parse(JSON.stringify(current))), [current.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const [editMode, setEditMode] = useState<'dark' | 'light'>(resolveMode(ap.mode, prefersDark));
  const issues = useMemo(() => contrastIssues(draft[editMode]), [draft, editMode]);
  const dirty = JSON.stringify(draft) !== JSON.stringify(current);

  const setTok = (k: keyof ThemeTokens, v: string) => setDraft((d) => ({ ...d, [editMode]: { ...d[editMode], [k]: v } }));
  const apply = () => { const t = draft.builtin && dirty ? { ...draft } : draft; commit([{ op: 'theme.upsert', theme: t }, { op: 'appearance.update', patch: { themeId: t.id } }], `Apply theme ${t.name}`); };
  const saveAs = () => { const t: ThemeDef = { ...JSON.parse(JSON.stringify(draft)), id: uid('theme'), name: `${draft.name.replace(/ \(custom\)$/, '')} (custom)`, builtin: false }; commit([{ op: 'theme.upsert', theme: t }, { op: 'appearance.update', patch: { themeId: t.id } }], `Save theme ${t.name}`); };
  const restore = () => { const b = BUILTIN_THEMES.find((x) => x.id === draft.id); if (b) { setDraft(JSON.parse(JSON.stringify(b))); commit([{ op: 'theme.upsert', theme: JSON.parse(JSON.stringify(b)) }], `Restore ${b.name}`); } else notify('Custom themes have no default; pick a preset instead', 'warn'); };
  const importTheme = async (f: File) => {
    try {
      const t = JSON.parse(await f.text()) as ThemeDef;
      const keys = Object.keys(TOKEN_LABEL) as (keyof ThemeTokens)[];
      const valid = t && typeof t.name === 'string' && (['dark', 'light'] as const).every((m) => keys.every((k) => parseHex(String(t[m]?.[k] ?? ''))));
      if (!valid) { notify('That file is not a valid theme (every colour must be a hex value)', 'error'); return; }
      const theme: ThemeDef = { id: uid('theme'), name: t.name.slice(0, 60), dark: t.dark, light: t.light };
      commit([{ op: 'theme.upsert', theme }, { op: 'appearance.update', patch: { themeId: theme.id } }], `Import theme ${theme.name}`);
    } catch { notify('Could not read that theme file', 'error'); }
  };

  return (
    <div className="dash">
      <div className="card span-6">
        <h4>Mode and preset</h4>
        <div className="seg" role="group" aria-label="Colour mode">
          {(['dark', 'light', 'system'] as const).map((m) => <button key={m} className="btn sm" aria-pressed={ap.mode === m} onClick={() => commit([{ op: 'appearance.update', patch: { mode: m } }], `Use ${m} mode`)}>{m === 'system' ? `System (${prefersDark ? 'dark' : 'light'})` : m[0].toUpperCase() + m.slice(1)}</button>)}
        </div>
        <div className="theme-presets">
          {ap.themes.map((t) => (
            <button key={t.id} className="theme-chip" aria-pressed={ap.themeId === t.id} onClick={() => commit([{ op: 'appearance.update', patch: { themeId: t.id } }], `Theme ${t.name}`)} title={t.name}>
              <span style={{ background: t.dark.bg }} /><span style={{ background: t.dark.accent }} /><span style={{ background: t.light.bg }} /><span style={{ background: t.light.accent }} />
              <b>{t.name}</b>
            </button>
          ))}
        </div>
        <p className="note">Themes change the interface. The brain keeps its own colours.</p>
      </div>
      <div className="card span-6">
        <h4>Before and after</h4>
        <div className="row" style={{ alignItems: 'stretch' }}>
          <Preview theme={current} mode={editMode} label="Current" />
          <Preview theme={draft} mode={editMode} label={dirty ? 'Edited' : 'Edited (no changes)'} />
        </div>
        {issues.length > 0
          ? <div style={{ marginTop: 8 }}>{issues.map((i) => <div key={i.pair} className="issue warning"><span className="ico">!</span><span className="msg">{i.pair}: contrast {i.ratio.toFixed(1)}:1, needs {i.min}:1</span></div>)}</div>
          : <p className="note" style={{ color: 'var(--success)' }}>Contrast checks pass for {editMode} mode.</p>}
      </div>
      <div className="card span-12">
        <div className="row wrap" style={{ marginBottom: 8 }}>
          <h4 style={{ margin: 0 }}>Edit “{draft.name}”</h4>
          <div className="seg" role="group" aria-label="Edit which mode">{(['dark', 'light'] as const).map((m) => <button key={m} className="btn sm" aria-pressed={editMode === m} onClick={() => setEditMode(m)}>{m} colours</button>)}</div>
          <span className="spacer" />
          <input type="text" aria-label="Theme name" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} style={{ maxWidth: 200 }} />
          <button className="btn sm primary" disabled={!dirty} onClick={apply}>Apply globally</button>
          <button className="btn sm" onClick={saveAs}>Save as new theme</button>
          <button className="btn sm" disabled={!dirty} onClick={() => setDraft(JSON.parse(JSON.stringify(current)))}>Discard edits</button>
          {draft.builtin && <button className="btn sm" onClick={restore}>Restore default</button>}
          {!draft.builtin && <button className="btn sm danger" onClick={() => commit([{ op: 'theme.delete', id: draft.id }], `Delete ${draft.name}`)}>Delete</button>}
          <button className="btn sm" onClick={() => saveFile(`${draft.name.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}.theme.json`, JSON.stringify({ name: draft.name, dark: draft.dark, light: draft.light }, null, 2))}>Export</button>
          <label className="btn sm">Import<input type="file" accept="application/json,.json" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) importTheme(f); e.target.value = ''; }} /></label>
        </div>
        <div className="grid-3">
          <div>{(Object.keys(TOKEN_LABEL) as (keyof ThemeTokens)[]).slice(0, 6).map((k) => <Swatch key={k} label={TOKEN_LABEL[k]} value={draft[editMode][k]} onChange={(v) => setTok(k, v)} />)}</div>
          <div>{(Object.keys(TOKEN_LABEL) as (keyof ThemeTokens)[]).slice(6).map((k) => <Swatch key={k} label={TOKEN_LABEL[k]} value={draft[editMode][k]} onChange={(v) => setTok(k, v)} />)}</div>
        </div>
      </div>
    </div>
  );
}
