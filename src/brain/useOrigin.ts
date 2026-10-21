// Live state of ORIGIN's runner (server/origin-runner.mjs), polled while the
// brain is open. This is also the only source of brain notifications: the
// owner hears about a finished run only when the runner flags it (`notify`),
// about a task ORIGIN proposes for approval, and about the monthly cap.
import { useEffect } from 'react';
import { create } from 'zustand';
import { useStore } from '../store/store';
import { runnerStatus, type RunnerStatus } from './originLink';

export const useOrigin = create<{ status: RunnerStatus | null; checked: boolean }>(() => ({ status: null, checked: false }));

const POLL_MS = 30_000;

/** What to tell the owner between two runner states; at most one line. */
export function originNotice(prev: RunnerStatus | null, next: RunnerStatus): { text: string; level: 'info' | 'warn' } | null {
  if (!prev) return null; // first contact sets the baseline; nothing old is replayed
  const seenRuns = new Set(prev.runs.map((r) => r.id));
  const flagged = next.runs.filter((r) => !seenRuns.has(r.id) && r.endedAt && r.notify);
  if (flagged.length) return { text: `ORIGIN: ${flagged[flagged.length - 1].notify}`, level: 'info' };
  const seenTasks = new Set(prev.tasks.map((t) => t.id));
  const proposed = next.tasks.filter((t) => t.status === 'proposed' && t.by === 'origin' && !seenTasks.has(t.id));
  if (proposed.length) return { text: proposed.length === 1 ? `ORIGIN wants your approval: ${proposed[0].title}` : `ORIGIN wants your approval on ${proposed.length} tasks`, level: 'info' };
  // agents ORIGIN created on its own (auto-create on), or that wait for approval (ask-first)
  const seenAgents = new Set((prev.agentProposals ?? []).map((p) => p.id));
  const newAgents = (next.agentProposals ?? []).filter((p) => !seenAgents.has(p.id) && p.status === 'proposed');
  if (newAgents.length) return { text: next.autoAgents ? `ORIGIN created ${newAgents.map((p) => p.name).join(', ')}` : `ORIGIN wants your approval for a new agent: ${newAgents[0].name}`, level: 'info' };
  const pct = (s: RunnerStatus) => (s.capUsd ? s.spentUsd / s.capUsd : 0);
  if (next.month === prev.month && pct(prev) < 1 && pct(next) >= 1) return { text: `ORIGIN hit its $${next.capUsd} monthly cap and won't run again this month.`, level: 'warn' };
  if (next.month === prev.month && pct(prev) < 0.8 && pct(next) >= 0.8) return { text: `ORIGIN has used $${next.spentUsd.toFixed(2)} of its $${next.capUsd} monthly cap.`, level: 'warn' };
  return null;
}

/** Poll the runner while mounted. */
export function useOriginPoll() {
  useEffect(() => {
    let alive = true;
    const tick = async () => {
      const next = await runnerStatus();
      if (!alive) return;
      const prev = useOrigin.getState().status;
      useOrigin.setState({ status: next, checked: true });
      if (next) { const n = originNotice(prev, next); if (n) useStore.getState().notify(n.text, n.level); }
    };
    void tick();
    const id = setInterval(tick, POLL_MS);
    return () => { alive = false; clearInterval(id); };
  }, []);
}
