import { useState } from 'react';
import { useStore } from '../store/store';
import { NumberField, Section, SelectField, Toggle } from './primitives';
import { providerStatus } from '../ai/providers';
import { ThemeEditor } from './ThemeEditor';
import { AlertSettingsPanel } from './AlertSettingsPanel';

const TABS = [['general', 'General'], ['theme', 'Theme & colours'], ['alerts', 'Alerts & sounds'], ['office', 'Office & objects']] as const;

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
      {tab === 'office' && <OfficeSettings />}
    </div>
  );
}

function OfficeSettings() {
  const st = useStore((s) => s.doc.settings);
  const simplifyAbove = useStore((s) => s.doc.control.simplifyAbove);
  const { commit } = useStore.getState();
  const up = (patch: Partial<typeof st>, label: string) => commit([{ op: 'settings.update', patch }], label);
  return (
    <div className="dash">
      <div className="card span-6">
        <h4>Object placement</h4>
        <SelectField label="When objects overlap" value={st.collisionRule} options={[{ value: 'warn', label: 'Allow, but warn and highlight' }, { value: 'prevent', label: 'Prevent placement' }]} onChange={(collisionRule) => up({ collisionRule }, 'Collision rule')} />
        <SelectField label="Hallway connections" value={st.hallwayMode} options={[{ value: 'automatic', label: 'Automatic' }, { value: 'hybrid', label: 'Hybrid' }, { value: 'manual', label: 'Manual' }]} onChange={(hallwayMode) => up({ hallwayMode }, 'Hallway mode')} />
      </div>
      <div className="card span-6">
        <h4>Motion</h4>
        <SelectField label="Animation intensity" value={st.animationIntensity} options={[{ value: 'off', label: 'Off (static)' }, { value: 'subtle', label: 'Subtle' }, { value: 'full', label: 'Full' }]} onChange={(animationIntensity) => up({ animationIntensity }, 'Animation intensity')} />
        <Toggle label="Idle agents wander a little (cosmetic only)" checked={st.idleWandering} onChange={(idleWandering) => up({ idleWandering }, 'Idle wandering')} />
        <NumberField label="Simplify characters when more than this many are visible (0 = never)" value={simplifyAbove} min={0} max={1000} onCommit={(v) => commit([{ op: 'control.update', patch: { simplifyAbove: Math.max(0, Math.floor(v)) } }], 'Simplified display limit')} />
      </div>
    </div>
  );
}

function General() {
  const prefs = useStore((s) => s.prefs);
  const { setPrefs } = useStore.getState();
  const prov = providerStatus(prefs.aiProvider);
  return (
    <div className="dash">
      <div className="card span-6">
        <h4>AI integration</h4>
        <SelectField label="Command console provider" value={prefs.aiProvider} options={[
          { value: 'mock', label: 'Simulated AI — local rule-based interpreter (no API key)' },
          { value: 'remote', label: 'Live model via server proxy (/api/ai/plan)' },
          { value: 'off', label: 'Disconnected' },
        ]} onChange={(aiProvider) => setPrefs({ aiProvider })} />
        <p className="note">{prov.detail}</p>
        <Toggle label="Apply safe changes immediately (profile, appearance, agent moves); always preview layout changes" checked={prefs.autoApplySafe} onChange={(autoApplySafe) => setPrefs({ autoApplySafe })} />
        <p className="note" style={{ marginTop: 8 }}>The live provider needs <code>npm run proxy</code> with <code>ANTHROPIC_API_KEY</code> set on the server. Keys never reach the browser. Whatever the model returns is schema-checked, applied to a draft, validated, and previewed before it touches your office. Manual construction and profile editing work in every mode.</p>
      </div>
      <div className="card span-6">
        <h4>Simulation</h4>
        <Toggle label="Run simulation" checked={prefs.simRunning} onChange={(simRunning) => setPrefs({ simRunning })} />
        <Toggle label="Generate demo tasks for idle agents (labelled simulated)" checked={prefs.demoTasks} onChange={(demoTasks) => setPrefs({ demoTasks })} />
        <SelectField label="Speed" value={String(prefs.simSpeed)} options={['0.5', '1', '2', '4'] as const} onChange={(v) => setPrefs({ simSpeed: Number(v) })} />
      </div>
      <div className="card span-6">
        <h4>Persistence</h4>
        <Toggle label="Autosave layout, profiles and tasks" checked={prefs.autosave} onChange={(autosave) => setPrefs({ autosave })} />
        <p className="note" style={{ marginTop: 8 }}>Data is stored in this browser (localStorage; character artwork in IndexedDB) behind a repository interface, so a server database can replace it. Saved and exported files are schema-validated and migrated on load.</p>
      </div>
      <div className="card span-6">
        <h4>Keyboard shortcuts</h4>
        <Section title="">
          <table className="data"><tbody>
            {[['B', 'Toggle simulate / construct'], ['V R H D K F N', 'Select, room, hallway, door, workstation, furniture, agent tools'], ['Del', 'Delete selection'], ['Ctrl+Z / Ctrl+Shift+Z', 'Undo / redo'], ['Ctrl+D', 'Duplicate room, agent or objects'], ['E', 'Rotate object (or the one being placed)'], ['Shift+drag', 'Box-select objects'], ['Ctrl+S', 'Save'], ['Arrows (Shift)', 'Nudge rooms or objects 1 (5) cells'], ['G / Shift+S / P', 'Grid / snapping / nav paths'], ['Space+drag, wheel', 'Pan, zoom'], ['0', 'Fit office'], ['/', 'Focus AI console'], ['Shift+click', 'Multi-select rooms or objects'], ['Right-click', 'Context menu'], ['Esc', 'Clear selection / cancel']].map(([k, v]) => <tr key={k}><td><span className="kbd">{k}</span></td><td>{v}</td></tr>)}
          </tbody></table>
        </Section>
      </div>
    </div>
  );
}
