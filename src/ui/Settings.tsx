import { useState } from 'react';
import { ThemeEditor } from './ThemeEditor';
import { VoiceSettings } from './VoiceSettings';

const TABS = [['general', 'General'], ['theme', 'Theme & colours']] as const;

export function Settings() {
  const [tab, setTab] = useState<(typeof TABS)[number][0]>('general');
  return (
    <div className="dash settings">
      <div className="dash-head">
        <div><span className="kicker"><i /> THE BRAIN · SETTINGS</span><h2>Settings</h2><p>Every change here is part of the undo history and of saved versions, so you can always step back.</p></div>
        <nav className="seg actions" role="tablist" aria-label="Settings sections">
          {TABS.map(([k, label]) => <button key={k} className="btn sm" role="tab" aria-selected={tab === k} aria-pressed={tab === k} onClick={() => setTab(k)}>{label}</button>)}
        </nav>
      </div>
      {tab === 'general' && <General />}
      {tab === 'theme' && <div className="span-12"><ThemeEditor /></div>}
    </div>
  );
}

function General() {
  return (
    <>
      <VoiceSettings />
      <div className="card span-6">
        <h4>Keyboard shortcuts</h4>
        <table className="data"><tbody>
          {[['Ctrl+Z / Ctrl+Shift+Z', 'Undo / redo'], ['Ctrl+S', 'Save'], ['Del', 'Delete the selected agent'], ['/', 'Ask JARVIS in the console'], ['Esc', 'Clear selection']].map(([k, v]) => <tr key={k}><td style={{ width: 170 }}><span className="kbd">{k}</span></td><td>{v}</td></tr>)}
        </tbody></table>
      </div>
      <div className="card span-6">
        <h4>Saving</h4>
        <p className="note" style={{ fontSize: 'var(--fs-sm)' }}>Everything saves on this computer, always: shortly after every change and whenever one of JARVIS's tasks finishes. In the desktop app saves are files in its data folder; in a browser they stay in that browser. JARVIS's own runs, tasks and spend are saved by its runner in origin-data.</p>
      </div>
    </>
  );
}
