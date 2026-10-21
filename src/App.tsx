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
    </div>
  );
}
