import { useEffect, useState } from 'react';
import { useStore } from './store/store';
import { TopBar } from './ui/TopBar';
import ConnectomeView from './brain/ConnectomeView';
import { Console } from './ui/Console';
import { ProfileDrawer } from './ui/ProfileDrawer';
import { Dashboard } from './ui/Dashboard';
import { Settings } from './ui/Settings';
import { Approvals } from './ui/Approvals';
import { Charts } from './ui/Charts';
import { Ads } from './ui/Ads';
import BrainUniverse from './brain/UniverseView';
import { ConfirmDialog } from './ui/primitives';
import { useShortcuts } from './ui/actions';
import { useApplyTheme } from './ui/ThemeEditor';
import { useAutosave } from './ui/SaveStatus';
import { RecoveryDialog } from './ui/RecoveryDialog';
import { NavDock } from './ui/NavDock';

/** One line at a time. Only real events reach it: what you just did, and JARVIS's runner (see useOrigin). */
function Toast() {
  const toast = useStore((s) => s.toast);
  const [shown, setShown] = useState<typeof toast>(null);
  useEffect(() => {
    if (!toast) return;
    setShown(toast);
    const t = setTimeout(() => setShown(null), 5000);
    return () => clearTimeout(t);
  }, [toast]);
  if (!shown) return null;
  return <div className={`toast ${shown.level}`} role="status">{shown.text}</div>;
}

export function App() {
  useShortcuts();
  useApplyTheme();
  useAutosave();
  const page = useStore((s) => s.page);
  return (
    <div className="app" data-page={page}>
      <div className="space-bg" aria-hidden="true"><i className="stars far" /><i className="stars near" /><i className="galaxy g1" /><i className="galaxy g2" /></div>
      <TopBar />
      {page === 'office' && (
        <main className="brain-stage view-fade" key="brain">
          <ConnectomeView />
        </main>
      )}
      {page === 'dashboard' && <main className="page view-fade" key="dashboard"><Dashboard /></main>}
      {page === 'universe' && <main className="brain-stage view-fade" key="universe"><BrainUniverse /></main>}
      {page === 'charts' && <main className="page view-fade" key="charts"><Charts /></main>}
      {page === 'approvals' && <main className="page view-fade" key="approvals"><Approvals /></main>}
      {page === 'ads' && <main className="page view-fade" key="ads"><Ads /></main>}
      {page === 'settings' && <main className="page view-fade" key="settings"><Settings /></main>}
      <div>
        <Console />
      </div>
      <NavDock />
      <ProfileDrawer />
      <RecoveryDialog />
      <ConfirmDialog />
      <Toast />
    </div>
  );
}
