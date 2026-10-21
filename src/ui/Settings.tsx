import { useState } from 'react';
import { useStore } from '../store/store';
import { Section, SelectField, Toggle } from './primitives';
import { ThemeEditor } from './ThemeEditor';
import { AlertSettingsPanel } from './AlertSettingsPanel';

const TABS = [['general', 'General'], ['theme', 'Theme & colours'], ['alerts', 'Alerts & sounds']] as const;

export function Settings() {
  const [tab, setTab] = useState<(typeof TABS)[number][0]>('general');
  return (
    <div>
      <div className="tabs" role="tablist" aria-label="Settings sections" style={{ padding: '8px 16px 0' }}>
        {TABS.map(([k, label]) => <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)}>{label}</button>)}
      </div>
      <p className="note" style={{ padding: '4px 16px 0' }}>Every settings change is part of the undo history and of saved versions, so you can always step back.</p>
      {tab === 'general' && <General />}
      {tab === 'theme' && <ThemeEditor />}
      {tab === 'alerts' && <AlertSettingsPanel />}
    </div>
  );
}

function General() {
  const prefs = useStore((s) => s.prefs);
  const { setPrefs } = useStore.getState();
  return (
    <div className="dash">
      <div className="card span-6">
        <h4>Task loop</h4>
        <Toggle label="Run agents' queued tasks" checked={prefs.simRunning} onChange={(simRunning) => setPrefs({ simRunning })} />
        <SelectField label="Speed" value={String(prefs.simSpeed)} options={['0.5', '1', '2', '4'] as const} onChange={(v) => setPrefs({ simSpeed: Number(v) })} />
      </div>
      <div className="card span-6">
        <h4>Persistence</h4>
        <Toggle label="Autosave agents, knowledge and tasks" checked={prefs.autosave} onChange={(autosave) => setPrefs({ autosave })} />
        <p className="note" style={{ marginTop: 8 }}>Data is stored in this browser (localStorage) behind a repository interface, so a server database can replace it. Saved and exported files are schema-validated and migrated on load.</p>
      </div>
      <div className="card span-6">
        <h4>Keyboard shortcuts</h4>
        <Section title="">
          <table className="data"><tbody>
            {[['Ctrl+Z / Ctrl+Shift+Z', 'Undo / redo'], ['Ctrl+S', 'Save'], ['Del', 'Delete the selected agent'], ['/', 'Ask ORIGIN in the console'], ['Esc', 'Clear selection']].map(([k, v]) => <tr key={k}><td><span className="kbd">{k}</span></td><td>{v}</td></tr>)}
          </tbody></table>
        </Section>
      </div>
    </div>
  );
}
