// Section tabs inside a page, under its header. Each page remembers its last tab, and other pages can
// open a page on a given tab (and scroll to a section in it), e.g. a finished task's Open button.
import type { ReactNode } from 'react';
import { create } from 'zustand';
import type { LucideIcon } from 'lucide-react';
import { useStore } from '../store/store';

type Page = ReturnType<typeof useStore.getState>['page'];
const KEY = (page: string) => `brain:tab:${page}`;
const remembered = (page: string) => { try { return localStorage.getItem(KEY(page)); } catch { return null; } };

/** The open tab of every page that has tabs. */
export const usePageTabs = create<Record<string, string>>(() => ({}));

/** The page's open tab: the one asked for, else the last one used, else the first. */
export function usePageTab<T extends string>(page: Page, ids: readonly T[]): [T, (t: T) => void] {
  const asked = usePageTabs((s) => s[page]);
  const pick = [asked, remembered(page)].find((t): t is T => !!t && (ids as readonly string[]).includes(t)) ?? ids[0];
  const set = (t: T) => { usePageTabs.setState({ [page]: t }); try { localStorage.setItem(KEY(page), t); } catch { /* private window */ } };
  return [pick, set];
}

/** Open a page on one of its tabs, then bring a section of it into view. */
export function openSection(page: Page, tab: string | null, anchor?: string | null) {
  if (tab) { usePageTabs.setState({ [page]: tab }); try { localStorage.setItem(KEY(page), tab); } catch { /* private window */ } }
  useStore.getState().setUi({ page });
  if (anchor) setTimeout(() => document.getElementById(anchor)?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 250);
}

export interface TabDef<T extends string> { id: T; label: string; icon?: LucideIcon; count?: number; alert?: boolean }

export function PageTabs<T extends string>({ label, tabs, value, onChange }: { label: string; tabs: TabDef<T>[]; value: T; onChange: (t: T) => void }) {
  return (
    <nav className="page-tabs" role="tablist" aria-label={label}>
      {tabs.map(({ id, label: name, icon: Icon, count, alert }) => (
        <button key={id} role="tab" id={`tab-${id}`} aria-selected={value === id} className="page-tab" onClick={() => onChange(id)}>
          {Icon && <Icon size={15} />}{name}{count != null && <span className={`page-tab-count${alert && count ? ' alert' : ''}`}>{count}</span>}
        </button>
      ))}
    </nav>
  );
}

/** The panel under the tabs; the grid of cards lives inside it. */
export function TabPanel({ id, children }: { id: string; children: ReactNode }) {
  return <div className="tab-panel" role="tabpanel" aria-labelledby={`tab-${id}`} key={id}>{children}</div>;
}
