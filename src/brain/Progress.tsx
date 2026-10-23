import type { ProgressEntry } from './originLink';

/** How far along a task is, as JARVIS last reported it after a run. */
export function ProgressBar({ pct, label }: { pct?: number | null; label?: string }) {
  const known = pct != null;
  return (
    <span className="task-progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={known ? pct : undefined} aria-label={label ?? 'Task progress'}>
      <i style={{ width: `${known ? pct : 0}%` }} />
      <b>{known ? `${pct}%` : 'not started'}</b>
    </span>
  );
}

/** The progress log, newest first: what each run got done, for which agent and task. */
export function ProgressLog({ entries, showAgent = true, limit = 40 }: { entries: ProgressEntry[]; showAgent?: boolean; limit?: number }) {
  if (!entries.length) return <p className="creator-privacy">Nothing logged yet. Each run adds a line here.</p>;
  return (
    <ul className="creator-request-log progress-log">
      {entries.slice(-limit).reverse().map((e) => (
        <li key={e.id}>
          <span className="small muted">{new Date(e.at).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</span>{' '}
          {showAgent && <b>{e.agentName}</b>}{e.taskTitle ? <> · {e.taskTitle}</> : null}{e.pct != null ? <> · {e.pct}%</> : null}: {e.note}
        </li>
      ))}
    </ul>
  );
}
