import { useStore } from '../store/store';
import { Section, SelectField, Toggle } from './primitives';
import { providerStatus } from '../ai/providers';

export function Settings() {
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
            {[['B', 'Toggle simulate / construct'], ['V R H D K F N', 'Select, room, hallway, door, workstation, furniture, agent tools'], ['Del', 'Delete selection'], ['Ctrl+Z / Ctrl+Shift+Z', 'Undo / redo'], ['Ctrl+D', 'Duplicate room or agent'], ['Ctrl+S', 'Save'], ['Arrows (Shift)', 'Nudge rooms 1 (5) cells'], ['G / Shift+S / P', 'Grid / snapping / nav paths'], ['Space+drag, wheel', 'Pan, zoom'], ['0', 'Fit office'], ['/', 'Focus AI console'], ['Shift+click', 'Multi-select rooms'], ['Right-click', 'Context menu'], ['Esc', 'Clear selection / cancel']].map(([k, v]) => <tr key={k}><td><span className="kbd">{k}</span></td><td>{v}</td></tr>)}
          </tbody></table>
        </Section>
      </div>
    </div>
  );
}
