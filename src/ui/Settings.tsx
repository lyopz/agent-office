import { useState } from 'react';
import { Section } from './primitives';
import { ThemeEditor } from './ThemeEditor';

const TABS = [['general', 'General'], ['theme', 'Theme & colours']] as const;

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
    </div>
  );
}

function General() {
  return (
    <div className="dash">
      <div className="card span-6">
        <h4>Persistence</h4>
        <p className="note">Everything saves on this computer, always: shortly after every change and whenever one of JARVIS's tasks finishes. In the desktop app saves are files in its data folder; in a browser they stay in that browser. JARVIS's own runs, tasks and spend are saved by its runner in origin-data.</p>
      </div>
      <div className="card span-6">
        <h4>Keyboard shortcuts</h4>
        <Section title="">
          <table className="data"><tbody>
            {[['Ctrl+Z / Ctrl+Shift+Z', 'Undo / redo'], ['Ctrl+S', 'Save'], ['Del', 'Delete the selected agent'], ['/', 'Ask JARVIS in the console'], ['Esc', 'Clear selection']].map(([k, v]) => <tr key={k}><td><span className="kbd">{k}</span></td><td>{v}</td></tr>)}
          </tbody></table>
        </Section>
      </div>
    </div>
  );
}
