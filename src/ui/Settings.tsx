import { CircleDollarSign, Palette, SlidersHorizontal } from 'lucide-react';
import { ThemeEditor } from './ThemeEditor';
import { VoiceSettings } from './VoiceSettings';
import { PageTabs, TabPanel, usePageTab } from './PageTabs';
import { Budgets } from './Approvals';
import { useStore } from '../store/store';
import { useOrigin } from '../brain/useOrigin';
import { runnerStatus } from '../brain/originLink';

export function Settings() {
  const [tab, setTab] = usePageTab('settings', ['general', 'theme', 'budgets'] as const);
  return (
    <div className="dash settings">
      <div className="dash-head">
        <div><span className="kicker"><i /> THE BRAIN · SETTINGS</span><h2>Settings</h2><p>Every change here is part of the undo history and of saved versions, so you can always step back.</p></div>
      </div>
      <PageTabs label="Settings sections" value={tab} onChange={setTab} tabs={[
        { id: 'general', label: 'General', icon: SlidersHorizontal },
        { id: 'theme', label: 'Theme & colours', icon: Palette },
        { id: 'budgets', label: 'Budgets', icon: CircleDollarSign },
      ]} />
      {tab === 'general' && <TabPanel id="general"><General /></TabPanel>}
      {tab === 'theme' && <TabPanel id="theme"><div className="span-12"><ThemeEditor /></div></TabPanel>}
      {tab === 'budgets' && <TabPanel id="budgets"><BudgetsTab /></TabPanel>}
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

/** The monthly cap, add funds, and per-branch budgets: they live in JARVIS's runner. */
function BudgetsTab() {
  const st = useOrigin((o) => o.status);
  const agents = useStore((s) => s.doc.agents);
  if (!st) return <div className="card span-12 empty-state"><b>Budgets need JARVIS's runner</b><span>The runner keeps the monthly cap and every branch's budget. Open the app from the desktop shortcut and it starts by itself.</span></div>;
  return <div className="span-12"><Budgets st={st} agents={agents} onDone={() => void runnerStatus().then((s) => useOrigin.setState({ status: s }))} /></div>;
}
