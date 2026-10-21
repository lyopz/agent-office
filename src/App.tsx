import { useEffect, useState } from 'react';
import { useStore } from './store/store';
import { TopBar } from './ui/TopBar';
import ConnectomeView from './brain/ConnectomeView';
import { Console } from './ui/Console';
import { ProfileDrawer } from './ui/ProfileDrawer';
import { Dashboard } from './ui/Dashboard';
import { Settings } from './ui/Settings';
import { ConfirmDialog } from './ui/primitives';
import { useShortcuts } from './ui/actions';
import { useApplyTheme } from './ui/ThemeEditor';
import { useAutosave } from './ui/SaveStatus';
import { RecoveryDialog } from './ui/RecoveryDialog';

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
    <div className="app">
      <TopBar />
      {page === 'office' && (
        <main className="brain-stage view-fade" key="brain">
          <ConnectomeView />
        </main>
      )}
      {page === 'dashboard' && <main style={{ overflow: 'auto', minHeight: 0 }}><Dashboard /></main>}
      {page === 'settings' && <main style={{ overflow: 'auto', minHeight: 0 }}><Settings /></main>}
      <div>
        <Console />
      </div>
      <ProfileDrawer />
      <RecoveryDialog />
      <ConfirmDialog />
      <Toast />
    </div>
  );
}
