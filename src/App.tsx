import { useEffect, useState } from 'react';
import { useStore } from './store/store';
import { TopBar } from './ui/TopBar';
import { Toolbar } from './ui/Toolbar';
import { AutoSortPanel } from './ui/AutoSort';
import { AgentPanel } from './ui/AgentPanel';
import { Inspector } from './ui/Inspector';
import { Console } from './ui/Console';
import { ProfileDrawer } from './ui/ProfileDrawer';
import { Dashboard } from './ui/Dashboard';
import { Settings } from './ui/Settings';
import { Viewport } from './viewport/Viewport';
import { ConfirmDialog } from './ui/primitives';
import { useShortcuts } from './ui/actions';
import { ObjectLibrary } from './ui/ObjectLibrary';
import { PerfPanel } from './ui/PerfPanel';
import { useApplyTheme } from './ui/ThemeEditor';
import { useAlertDelivery } from './ui/AlertCenter';
import { ExecutiveControl } from './ui/ExecutiveControl';
import { ArcadeHost } from './ui/ArcadeHost';

function useSimulationLoop() {
  const running = useStore((s) => s.prefs.simRunning);
  const speed = useStore((s) => s.prefs.simSpeed);
  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => useStore.getState().tick(), 100 / speed);
    return () => clearInterval(t);
  }, [running, speed]);
}

function ConflictDialog() {
  const conflict = useStore((s) => s.conflict);
  const { setUi, commit } = useStore.getState();
  if (!conflict) return null;
  const fixes = conflict.issues.filter((i) => i.fix);
  return (
    <div className="overlay">
      <div className="modal" role="alertdialog" aria-modal="true" aria-labelledby="conflict-h">
        <div className="panel-h" id="conflict-h" style={{ color: 'var(--danger)' }}>Change blocked: {conflict.label}</div>
        <div className="modal-b">
          <p className="note" style={{ fontSize: 'var(--fs-md)', color: 'var(--text)' }}>This change would create layout problems. Nothing has been applied yet.</p>
          {conflict.issues.map((i) => <div key={i.id} className="issue error"><span className="ico">✕</span><span className="msg">{i.message}</span></div>)}
        </div>
        <div className="modal-f">
          <button className="btn" onClick={() => setUi({ conflict: null })} autoFocus>Cancel change</button>
          {fixes.length > 0 && <button className="btn primary" onClick={() => { const r = commit([...conflict.ops, ...fixes.flatMap((f) => f.fix!.ops)], `${conflict.label} (with fix)`); if (r.ok) setUi({ conflict: null }); }}>Apply with suggested fix: {fixes[0].fix!.label}</button>}
          <button className="btn danger" onClick={() => commit(conflict.ops, conflict.label, { force: true })}>Apply anyway</button>
        </div>
      </div>
    </div>
  );
}

function Toast() {
  const toast = useStore((s) => s.toast);
  const [shown, setShown] = useState<typeof toast>(null);
  useEffect(() => {
    if (!toast) return;
    setShown(toast);
    const t = setTimeout(() => setShown(null), 3500);
    return () => clearTimeout(t);
  }, [toast]);
  if (!shown) return null;
  return <div className={`toast ${shown.level}`} role="status">{shown.text}</div>;
}

export function App() {
  useSimulationLoop();
  useShortcuts();
  useApplyTheme();
  useAlertDelivery();
  const page = useStore((s) => s.page);
  const mode = useStore((s) => s.mode);
  const tool = useStore((s) => s.tool);
  const perf = useStore((s) => s.layers.perf);
  const [mobile, setMobile] = useState<'office' | 'agents' | 'inspect'>('office');
  return (
    <div className="app">
      <TopBar />
      {page === 'office' && (
        <main className="main" data-mobile={mobile}>
          <AgentPanel />
          <div className="center">
            <Toolbar />
            <div style={{ position: 'relative', minHeight: 0, display: 'grid' }}>
              <Viewport />
              {mode === 'construct' && <div className="mode-banner">CONSTRUCTION MODE</div>}
              {mode === 'construct' && (tool === 'furniture' || tool === 'workstation') && <ObjectLibrary />}
              {perf && <PerfPanel />}
              <AutoSortPanel />
            </div>
          </div>
          <Inspector />
        </main>
      )}
      {page === 'dashboard' && <main style={{ overflow: 'auto', minHeight: 0 }}><Dashboard /></main>}
      {page === 'control' && <main style={{ overflow: 'auto', minHeight: 0 }}><ExecutiveControl /></main>}
      {page === 'settings' && <main style={{ overflow: 'auto', minHeight: 0 }}><Settings /></main>}
      <div>
        <Console />
        {page === 'office' && (
          <nav className="mobile-tabs" aria-label="Panels">
            {(['agents', 'office', 'inspect'] as const).map((m) => <button key={m} aria-pressed={mobile === m} onClick={() => setMobile(m)}>{m === 'office' ? 'Floor plan' : m === 'agents' ? 'Agents' : 'Inspector'}</button>)}
          </nav>
        )}
      </div>
      <ProfileDrawer />
      <ConflictDialog />
      <ConfirmDialog />
      <Toast />
      <ArcadeHost />
    </div>
  );
}
