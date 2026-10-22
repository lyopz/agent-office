import { BarChart3, Brain, CircleCheck, LayoutGrid, Megaphone, Plus, Settings, Users, type LucideIcon } from 'lucide-react';
import { useStore } from '../store/store';
import { useOrigin } from '../brain/useOrigin';
import { openDesk } from '../brain/CreatorDesk';

type Page = ReturnType<typeof useStore.getState>['page'];
const PAGES: { id: Page; label: string; icon: LucideIcon }[] = [
  { id: 'office', label: 'Brain', icon: Brain },
  { id: 'universe', label: 'Brains', icon: Users },
  { id: 'dashboard', label: 'Dashboard', icon: LayoutGrid },
  { id: 'charts', label: 'Charts', icon: BarChart3 },
  { id: 'approvals', label: 'Approvals', icon: CircleCheck },
  { id: 'ads', label: 'Ads', icon: Megaphone },
  { id: 'settings', label: 'Settings', icon: Settings },
];

/** The round page buttons along the bottom, and Add idea at the bottom left. */
export function NavDock() {
  const page = useStore((s) => s.page);
  // designs and products waiting for the owner's Yes or No
  const waiting = useOrigin((o) => (o.status?.designs ?? []).filter((d) => d.status === 'waiting').length + (o.status?.publishRequests ?? []).filter((r) => r.status === 'waiting').length);
  const go = (p: Page) => useStore.getState().setUi({ page: p });
  return (
    <>
      <button className="dock-idea" onClick={() => { if (page !== 'office') go('office'); openDesk('ideas'); }}><Plus size={18} /> Add idea</button>
      <nav className="nav-dock" aria-label="Pages">
        {PAGES.map(({ id, label, icon: Icon }) => (
          <button key={id} className="dock-btn" aria-pressed={page === id} aria-current={page === id ? 'page' : undefined} onClick={() => go(id)}>
            <span className="dock-orb"><Icon size={22} strokeWidth={1.7} />{id === 'approvals' && waiting > 0 && <span className="nav-count" aria-label={`${waiting} waiting`}>{waiting}</span>}</span>
            <span className="dock-label">{label}</span>
          </button>
        ))}
      </nav>
    </>
  );
}
