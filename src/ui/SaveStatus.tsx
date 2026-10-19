// Save status in the top bar (last save time, unsaved-changes indicator, Save now) and the
// autosave loop: every 60 s, and once more when the page is hidden or closed. The repository
// skips the write when the content hash matches the last successful save, so an idle office
// never rewrites storage.
import { useEffect, useState } from 'react';
import { Save } from 'lucide-react';
import { repo, useStore } from '../store/store';

export const AUTOSAVE_INTERVAL_MS = 60_000;

export function useAutosave(intervalMs = AUTOSAVE_INTERVAL_MS) {
  const enabled = useStore((s) => s.prefs.autosave);
  useEffect(() => {
    if (!enabled) return;
    const auto = () => { const s = useStore.getState(); if (!s.recovery) s.save(); };
    const t = setInterval(auto, intervalMs);
    const onHide = () => { if (document.visibilityState === 'hidden') auto(); };
    window.addEventListener('pagehide', auto);
    document.addEventListener('visibilitychange', onHide);
    return () => { clearInterval(t); window.removeEventListener('pagehide', auto); document.removeEventListener('visibilitychange', onHide); };
  }, [enabled, intervalMs]);
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
  const autosave = useStore((s) => s.prefs.autosave);
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
    state === 'paused' ? 'Your saved office was damaged. Choose how to recover it before anything is saved.' : null,
    state === 'error' ? error : null,
    lastSaved ? `Last saved ${new Date(lastSaved).toLocaleString()} (${relativeTime(lastSaved, now)}).` : 'Not saved yet.',
    autosave ? `Autosaves every minute to ${where} when something changed.` : `Autosave is off. Saves go to ${where}.`,
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
