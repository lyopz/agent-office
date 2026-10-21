// Switch between the agent brain (the main screen) and the classic floor
// plan. The choice is remembered per device.
import { useStore } from '../store/store';
import type { HqView } from '../persistence/repository';

export function useHqView(): HqView { return useStore(() => 'brain'); }

export function setHqView(v: HqView, focusRoomId?: string | null) {
  const s = useStore.getState();
  if (v === 'overview') return;
  s.setPrefs({ hqView: 'brain' });
  s.setUi({ page: 'office', ...(focusRoomId !== undefined ? { focusRoomId } : {}) });
}

export function HqSwitch() {
  return null;
}

/** Retained for old overview components; the product now keeps the brain as its only workspace. */
export function ClassicToggle() {
  return null;
}
