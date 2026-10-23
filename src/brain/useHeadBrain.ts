// Keeps JARVIS's head brain in charge: the store venture moves out into a brain of its own once
// (the owner asked for it on 2026-10-23), and the runner hears about every brain whenever one of
// them changes, so JARVIS works their tasks whichever brain is open.
import { useEffect } from 'react';
import { useStore } from '../store/store';
import { storeVentureIn } from './headBrain';
import { syncOrigin } from './originLink';
import { libraryDocs } from '../persistence/brains';

const MOVED_KEY = 'brain:store-moved';

export function useHeadBrain() {
  useEffect(() => {
    const st = useStore.getState();
    let moved: string | null = null;
    try { moved = localStorage.getItem(MOVED_KEY); } catch { /* private window */ }
    const v = st.doc.head ? storeVentureIn(st.doc) : null;
    let already = false;
    try { already = libraryDocs().some((d) => d.plan?.fromVenture === v); } catch { /* storage unavailable */ }
    // once only: after a Move back the owner keeps it in the head brain
    if (!v || moved || already) return;
    const b = st.moveVentureToBrain(v);
    if (!b) return;
    try { localStorage.setItem(MOVED_KEY, b.id); } catch { /* asked again next time, and skipped because the brain exists */ }
    st.notify(`Moved ${b.name} into its own brain. JARVIS runs it until you hook up another agent (Dashboard > Brains). A version from before the move is saved.`);
  }, []);
  // a change in another brain (a SKILL.md saved there, a new agent, a new lead) reaches the runner too
  const brains = useStore((s) => s.brains);
  useEffect(() => {
    const t = setTimeout(() => void syncOrigin(useStore.getState().doc), 1500);
    return () => clearTimeout(t);
  }, [brains]);
}
