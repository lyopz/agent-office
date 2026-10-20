// Switch between the agent brain (the main screen) and the classic floor
// plan. The choice is remembered per device.
import { Brain, Map as MapIcon } from 'lucide-react';
import { useStore } from '../store/store';
import type { HqView } from '../persistence/repository';

const VIEWS: { id: HqView; label: string; icon: typeof Brain; title: string }[] = [
  { id: 'brain', label: 'Brain', icon: Brain, title: 'The team brain: nerves between teams and the information the agents produced' },
  { id: 'overview', label: 'Floor plan', icon: MapIcon, title: 'The classic floor plan, for building rooms by hand' },
];

export function useHqView(): HqView { return useStore((s) => s.prefs.hqView ?? 'brain'); }

export function setHqView(v: HqView, focusRoomId?: string | null) {
  const s = useStore.getState();
  s.setPrefs({ hqView: v });
  s.setUi({ page: 'office', ...(focusRoomId !== undefined ? { focusRoomId } : {}) });
}

export function HqSwitch() {
  const view = useHqView();
  const page = useStore((s) => s.page);
  return (
    <nav className="seg hq-switch" aria-label="Main view">
      {VIEWS.map((v) => (
        <button key={v.id} className="btn sm" aria-pressed={page === 'office' && view === v.id} title={v.title} onClick={() => setHqView(v.id)}>
          <v.icon size={14} /><span className="hide-sm">{v.label}</span>
        </button>
      ))}
    </nav>
  );
}

/** The classic floor plan stays one click away from the brain, for building rooms by hand. */
export function ClassicToggle() {
  const view = useHqView();
  return view === 'overview'
    ? <button className="btn sm" onClick={() => setHqView('brain')} title="Back to the agent brain"><Brain size={13} />Back to brain</button>
    : <button className="btn sm" onClick={() => setHqView('overview')} title="Open the classic floor plan to build rooms by hand"><MapIcon size={13} />Classic floor plan</button>;
}
