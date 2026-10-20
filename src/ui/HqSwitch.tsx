// Switch between the explorable 3D headquarters, the avatar studio and the 2D
// overview of the whole operation. The choice is remembered per device.
import { Box, Map as MapIcon, UserRound } from 'lucide-react';
import { useStore } from '../store/store';
import type { HqView } from '../persistence/repository';

const VIEWS: { id: HqView; label: string; icon: typeof Box; title: string }[] = [
  { id: '3d', label: '3D HQ', icon: Box, title: 'Walk through the headquarters in 3D' },
  { id: 'avatar', label: 'Avatar', icon: UserRound, title: 'Customize your character' },
  { id: 'overview', label: '2D Overview', icon: MapIcon, title: 'See every room, team and connection at once' },
];

export function useHqView(): HqView { return useStore((s) => s.prefs.hqView ?? '3d'); }

export function setHqView(v: HqView, focusRoomId?: string | null) {
  const s = useStore.getState();
  s.setPrefs({ hqView: v });
  s.setUi({ page: 'office', ...(focusRoomId !== undefined ? { focusRoomId } : {}) });
}

export function HqSwitch() {
  const view = useHqView();
  const page = useStore((s) => s.page);
  return (
    <nav className="seg hq-switch" aria-label="Headquarters view">
      {VIEWS.map((v) => (
        <button key={v.id} className="btn sm" aria-pressed={page === 'office' && view === v.id} title={v.title} onClick={() => setHqView(v.id)}>
          <v.icon size={14} /><span className="hide-sm">{v.label}</span>
        </button>
      ))}
    </nav>
  );
}
