import { saveFile } from '../persistence/saveFile';
import { useRef, useState } from 'react';
import { Download, FolderOpen, History, Network, OctagonX, Pause, Play, Redo2, Undo2, Upload } from 'lucide-react';
import { openAgentGraphPow } from '../brain/agentGraph';
import { useStore } from '../store/store';
import { repo } from '../store/store';
import { confirmAction } from './primitives';
import { providerStatus } from '../ai/providers';
import { AlertBell } from './AlertCenter';
import { HqSwitch } from './HqSwitch';
import { SaveStatus } from './SaveStatus';
import { LogoLockup } from '../brand/Logo';

export function TopBar() {
  const name = useStore((s) => s.doc.name);
  const page = useStore((s) => s.page);
  const prefs = useStore((s) => s.prefs);
  const canUndo = useStore((s) => s.past.length > 0);
  const canRedo = useStore((s) => s.future.length > 0);
  const s = useStore.getState();
  const [versionsOpen, setVersionsOpen] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const prov = providerStatus(prefs.aiProvider);

  const exportFile = async () => {
    const r = await saveFile(`${name.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}.office.json`, s.exportText());
    if (r === 'failed') s.notify('Export is unavailable in this view', 'error');
  };
  const importFile = async (f: File) => {
    const text = await f.text();
    const r = useStore.getState().importText(text);
    if (r.ok) s.notify(`Imported ${f.name}${r.warnings.length ? ` (${r.warnings.join('; ')})` : ''}`);
    else confirmAction({ title: 'Import rejected', confirmLabel: 'OK', body: <><p>The file was not applied; your current office is unchanged.</p><ul>{r.errors.map((e) => <li key={e}>{e}</li>)}</ul></>, onConfirm: () => {} });
  };

  return (
    <header className="topbar">
      <span className="brand"><LogoLockup /><small className="hide-sm">sim v0.2</small></span>
      <input className="office-name" aria-label="Office name" defaultValue={name} key={name} onBlur={(e) => e.target.value.trim() && e.target.value !== name && s.commit([{ op: 'office.rename', name: e.target.value.trim() }], 'Rename office')} onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()} />
      <HqSwitch />
      <nav className="seg" aria-label="Pages">
        {(['dashboard', 'control', 'settings'] as const).map((p) => <button key={p} className="btn sm" aria-pressed={page === p} onClick={() => s.setUi({ page: p })}>{p === 'control' ? 'Control' : p[0].toUpperCase() + p.slice(1)}</button>)}
      </nav>
      <GraphPowButton />
      <span className="spacer" />
      <AlertBell />
      <button className="btn icon sm" aria-label={prefs.simRunning ? 'Pause simulation' : 'Run simulation'} title={prefs.simRunning ? 'Pause simulation' : 'Run simulation'} onClick={() => s.setPrefs({ simRunning: !prefs.simRunning })}>{prefs.simRunning ? <Pause size={14} /> : <Play size={14} />}</button>
      <EmergencyButton />
      <select className="hide-sm" aria-label="Simulation speed" value={prefs.simSpeed} onChange={(e) => s.setPrefs({ simSpeed: Number(e.target.value) })} style={{ width: 64, minHeight: 26 }}>
        {[0.5, 1, 2, 4].map((v) => <option key={v} value={v}>{v}×</option>)}
      </select>
      <span className={`badge ${prov.kind} hide-sm`} title={prov.detail}>{prov.label}</span>
      <button className="btn icon sm" disabled={!canUndo} aria-label="Undo" title="Undo (Ctrl+Z)" onClick={s.undo}><Undo2 size={14} /></button>
      <button className="btn icon sm" disabled={!canRedo} aria-label="Redo" title="Redo (Ctrl+Shift+Z)" onClick={s.redo}><Redo2 size={14} /></button>
      <SaveStatus />
      <div style={{ position: 'relative' }}>
        <button className="btn sm" aria-expanded={versionsOpen} onClick={() => setVersionsOpen(!versionsOpen)}><History size={14} /><span className="hide-sm">Versions</span></button>
        {versionsOpen && <VersionsMenu onClose={() => setVersionsOpen(false)} />}
      </div>
      <button className="btn icon sm" aria-label="Export office" title="Export office configuration" onClick={exportFile}><Download size={14} /></button>
      <button className="btn icon sm" aria-label="Import office" title="Import office configuration" onClick={() => fileRef.current?.click()}><Upload size={14} /></button>
      <input ref={fileRef} type="file" accept=".json,application/json" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) importFile(f); e.target.value = ''; }} />
    </header>
  );
}

function VersionsMenu({ onClose }: { onClose: () => void }) {
  const doc = useStore((s) => s.doc);
  const s = useStore.getState();
  const [name, setName] = useState(`Layout ${new Date().toLocaleString()}`);
  const [, force] = useState(0);
  const versions = repo.listVersions().slice().reverse();
  return (
    <div className="ctx-menu" style={{ right: 0, top: 32, width: 320, padding: 10 }} role="dialog" aria-label="Layout versions">
      <div className="label" style={{ marginBottom: 4 }}>Save named version</div>
      <div className="row"><input type="text" value={name} onChange={(e) => setName(e.target.value)} aria-label="Version name" /><button className="btn sm primary" onClick={() => { s.saveVersion(name); force((x) => x + 1); }}>Save</button></div>
      <div className="row" style={{ marginTop: 8, gap: 4 }}>
        <button className="btn sm" onClick={() => { s.resetToSaved(); onClose(); }}>Reset to last save</button>
        <button className="btn sm" title="Store a copy of this layout as a version you can restore or keep editing separately" onClick={() => { s.saveVersion(`${doc.name} (duplicate)`); force((x) => x + 1); }}>Duplicate layout</button>
      </div>
      <div className="row" style={{ marginTop: 4, gap: 4 }}>
        <button className="btn sm" title="Load the Roblox development headquarters sample" onClick={() => confirmAction({ title: 'Load the Roblox HQ sample?', confirmLabel: 'Load Roblox HQ', body: 'Replaces the current layout with the Roblox development headquarters: a throne room surrounded by seven team rooms. Undo brings your layout back, and saved versions are kept.', onConfirm: () => { s.newOffice('roblox'); onClose(); } })}><FolderOpen size={13} />Roblox HQ</button>
        <button className="btn sm" title="Load the classic NEXUS-7 sample office" onClick={() => confirmAction({ title: 'Load the NEXUS-7 sample?', confirmLabel: 'Load NEXUS-7', body: 'Replaces the current layout with the classic NEXUS-7 sample office. Undo brings your layout back, and saved versions are kept.', onConfirm: () => { s.newOffice(true); onClose(); } })}>NEXUS-7</button>
        <button className="btn sm" onClick={() => confirmAction({ title: 'Start a blank office?', confirmLabel: 'New blank office', body: 'Replaces the current layout with an empty one. Undo brings your layout back, and saved versions are kept.', onConfirm: () => { s.newOffice(false); onClose(); } })}>Blank</button>
      </div>
      <div className="label" style={{ margin: '10px 0 4px' }}>Saved versions ({versions.length})</div>
      {versions.length === 0 && <div className="muted small">None yet.</div>}
      <div style={{ maxHeight: 220, overflow: 'auto' }}>
        {versions.map((v) => (
          <div key={v.id} className="row small" style={{ padding: '3px 0' }}>
            <span className="grow" title={v.savedAt}>{v.name}<br /><span className="muted">{new Date(v.savedAt).toLocaleString()}</span></span>
            <button className="btn sm" onClick={() => confirmAction({ title: `Restore “${v.name}”?`, confirmLabel: 'Restore', body: 'The current layout is kept in undo history, so you can step back to it.', onConfirm: () => { s.restoreVersion(v.id); onClose(); } })}>Restore</button>
            <button className="btn sm danger" aria-label={`Delete ${v.name}`} onClick={() => { repo.deleteVersion(v.id); force((x) => x + 1); }}>×</button>
          </div>
        ))}
      </div>
    </div>
  );
}

/** Opens Graph POW: the map of every agent, the work they finished and the knowledge they wrote. */
function GraphPowButton() {
  return <button className="btn sm" title="Open Graph POW, the map of what the agents made and know" onClick={() => openAgentGraphPow()}><Network size={14} /><span className="hide-sm">Graph POW</span></button>;
}

function EmergencyButton() {
  const on = useStore((st) => st.doc.control.emergencyStop);
  const { commit } = useStore.getState();
  if (on) return <button className="btn sm danger pressed" aria-pressed="true" title="Every agent is stopped; click to lift" onClick={() => commit([{ op: 'control.update', patch: { emergencyStop: false } }], 'Lift emergency pause')}><OctagonX size={14} /><span className="hide-sm">Stopped · resume</span></button>;
  return <button className="btn icon sm" aria-label="Emergency pause all agents" title="Emergency pause: stop every agent now (progress is kept)" onClick={() => confirmAction({ title: 'Emergency pause every agent?', danger: true, confirmLabel: 'Pause everything', body: 'All agents stop at once. Running tasks are held with their progress, and nothing is deleted. Lift it here or on the Control page.', onConfirm: () => commit([{ op: 'control.update', patch: { emergencyStop: true } }], 'Emergency pause') })}><OctagonX size={14} /></button>;
}
