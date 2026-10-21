// Save status in the top bar (last save time, unsaved-changes indicator, Save now) and the
// autosave loop. Saving is always on and always local (this browser, or files in the desktop
// app): shortly after every change, whenever one of JARVIS's tasks finishes, every 60 s, and
// once more when the page is hidden or closed. The repository skips the write when the content
// hash matches the last successful save, so an idle brain never rewrites storage.
import { useEffect, useState } from 'react';
import { Save } from 'lucide-react';
import { repo, useStore } from '../store/store';
import { useOrigin } from '../brain/useOrigin';

export const AUTOSAVE_INTERVAL_MS = 60_000;
const AFTER_CHANGE_MS = 1_500;

export function useAutosave(intervalMs = AUTOSAVE_INTERVAL_MS) {
  useEffect(() => {
    const auto = () => { const s = useStore.getState(); if (!s.recovery) s.save(); };
    const t = setInterval(auto, intervalMs);
    const onHide = () => { if (document.visibilityState === 'hidden') auto(); };
    window.addEventListener('pagehide', auto);
    document.addEventListener('visibilitychange', onHide);
    // every change is saved a moment later, so a burst of edits is one write
    let pending: ReturnType<typeof setTimeout> | null = null;
    const offDoc = useStore.subscribe((s, prev) => {
      if (s.doc === prev.doc) return;
      if (pending) clearTimeout(pending);
      pending = setTimeout(() => { pending = null; auto(); }, AFTER_CHANGE_MS);
    });
    // a task JARVIS finishes is a save
    const offTasks = useOrigin.subscribe((s, prev) => {
      const was = new Set((prev.status?.tasks ?? []).filter((x) => x.status === 'done').map((x) => x.id));
      if ((s.status?.tasks ?? []).some((x) => x.status === 'done' && !was.has(x.id)) && prev.status) auto();
    });
    return () => {
      clearInterval(t); if (pending) clearTimeout(pending); offDoc(); offTasks();
      window.removeEventListener('pagehide', auto); document.removeEventListener('visibilitychange', onHide);
    };
  }, [intervalMs]);
}

export function relativeTime(at: string, now: number): string {
  const sec = Math.max(0, Math.round((now - new Date(at).getTime()) / 1000));
  if (sec < 45) return 'just now';
  const min = Math.round(sec / 60);
  if (min < 60) return `${min} min ago`;
  const h = Math.round(min / 60);
  if (h < 24) return `${h} h ago`;
  return `${Math.round(h / 24)} d ago`;
}

const clock = (at: string) => new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

export function SaveStatus() {
  const dirty = useStore((s) => s.dirty);
  const lastSaved = useStore((s) => s.lastSaved?.at ?? null);
  const error = useStore((s) => s.saveError);
  const paused = useStore((s) => s.recovery !== null);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 15_000); return () => clearInterval(t); }, []);

  const where = repo.backendKind === 'desktop' ? `files in ${repo.location}` : 'this browser';
  const state = paused ? 'paused' : error ? 'error' : dirty ? 'dirty' : lastSaved ? 'saved' : 'never';
  const text = {
    paused: 'Saving paused',
    error: 'Save failed',
    dirty: 'Unsaved changes',
    saved: lastSaved ? `Saved ${clock(lastSaved)}` : '',
    never: 'Not saved',
  }[state];
  const detail = [
    state === 'paused' ? 'Your saved brain was damaged. Choose how to recover it before anything is saved.' : null,
    state === 'error' ? error : null,
    lastSaved ? `Last saved ${new Date(lastSaved).toLocaleString()} (${relativeTime(lastSaved, now)}).` : 'Not saved yet.',
    `Saves to ${where} after every change and every finished task.`,
  ].filter(Boolean).join(' ');

  return (
    <span className="save-status" data-state={state} title={detail}>
      <span className="save-dot" role="img" aria-label={text} />
      <span className="save-text hide-sm" aria-live="polite">
        {text}{state === 'saved' && lastSaved && <span className="muted save-rel"> · {relativeTime(lastSaved, now)}</span>}
      </span>
      <button className="btn sm" disabled={paused} onClick={() => useStore.getState().saveNow()} title="Save now (Ctrl+S)" aria-label="Save now">
        <Save size={14} /><span className="hide-sm">Save now</span>
      </button>
    </span>
  );
}
