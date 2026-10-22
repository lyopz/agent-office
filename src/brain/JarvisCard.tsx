// The brain page's two live cards: JARVIS and its current task (top right), and that task's
// progress and steps (bottom). Everything comes from the runner; nothing here is simulated.
import { useState } from 'react';
import { Brain, Check, Loader2, MoreHorizontal, Play, Square } from 'lucide-react';
import { useStore } from '../store/store';
import { useOrigin } from './useOrigin';
import { runOrigin, runnerStatus, taskAction, type RunnerStatus, type RunnerTask } from './originLink';
import { MANUAL_RUN_MINUTES } from './opportunity';
import { openDesk } from './CreatorDesk';
import { confirmAction } from '../ui/primitives';

const ORIGIN_ID = 'agent_origin';

/** The task JARVIS's runner is on now: its own first, else any agent's. */
export function currentTask(st: RunnerStatus | null): { task: RunnerTask | null; title: string; agentName: string } | null {
  const now = st?.workingNow ?? [];
  const w = now.find((x) => x.agentId === ORIGIN_ID) ?? now[0];
  if (!w) return null;
  return { task: st?.tasks.find((t) => t.id === w.taskId) ?? null, title: w.title, agentName: w.agentName };
}

export function JarvisCard() {
  const st = useOrigin((o) => o.status);
  const name = useStore((s) => s.doc.agents[ORIGIN_ID]?.identity.name ?? 'JARVIS');
  const [busy, setBusy] = useState(false);
  const cur = currentTask(st);
  const state = !st ? 'Offline' : !st.configured ? 'No API key' : st.running || cur ? 'Working' : 'Idle';
  const { notify } = useStore.getState();

  const run = async () => {
    setBusy(true);
    useOrigin.setState({ status: st ? { ...st, running: 'manual' } : st });
    const r = await runOrigin(useStore.getState().doc, MANUAL_RUN_MINUTES);
    useOrigin.setState({ status: await runnerStatus() });
    setBusy(false);
    const done = r?.data.run;
    notify(done ? `${name}'s run ended (${done.status})${done.summary ? `: ${done.summary}` : '.'}` : r?.data.reason ?? 'The runner did not answer.');
  };
  const stop = (task: RunnerTask) => confirmAction({
    title: `Stop “${task.title}”?`, danger: true, confirmLabel: 'Stop task',
    body: 'The runner stops working on it and spends nothing more on it. Its progress and results stay. You can give it again later.',
    onConfirm: async () => { const r = await taskAction({ action: 'stop', id: task.id }); useOrigin.setState({ status: await runnerStatus() }); notify(r ? 'Stopped.' : 'The runner did not answer.', r ? 'info' : 'error'); },
  });

  return (
    <section className="jarvis-card" data-state={state.toLowerCase().replace(/\s+/g, '-')} aria-label={`${name} status`}>
      <header>
        <span className="jarvis-card-icon"><Brain size={26} strokeWidth={1.5} /></span>
        <span className="jarvis-card-name"><b>{name}</b><span><i className="jarvis-dot" />{state}</span></span>
        <button className="jarvis-more" aria-label={`${name} runs and settings`} title={`${name} runs`} onClick={() => openDesk('runs')}><MoreHorizontal size={18} /></button>
      </header>
      <div className="jarvis-card-label">Current task</div>
      <div className="jarvis-card-task">{cur ? cur.title : !st ? 'The runner is off. Open the app from the desktop shortcut and it starts by itself.' : !st.configured ? 'The runner has no API key yet. Run npm.cmd run set-key once in the app folder.' : 'Nothing right now. Give a task, or run a work window.'}</div>
      {cur?.task
        ? <button className="jarvis-action danger" onClick={() => stop(cur.task!)}><Square size={15} fill="currentColor" /> Stop task</button>
        : <button className="jarvis-action" disabled={!st?.configured || !!st.running || busy} onClick={() => void run()}>{busy || st?.running ? <Loader2 size={16} className="spin" /> : <Play size={16} fill="currentColor" />} {busy || st?.running ? 'Running…' : `Run ${MANUAL_RUN_MINUTES} min`}</button>}
    </section>
  );
}

/** The current task across the bottom: title, percent done, and its steps. */
export function TaskTrack() {
  const st = useOrigin((o) => o.status);
  const cur = currentTask(st);
  if (!cur) return null;
  const pct = Math.max(0, Math.min(100, cur.task?.progress ?? 0));
  const steps = (cur.task?.steps ?? []).slice(0, 6);
  const next = steps.findIndex((s) => !s.done);
  return (
    <section className="task-track" aria-label="Current task">
      <div className="task-track-kicker">CURRENT TASK{cur.agentName ? <span> · {cur.agentName}</span> : null}</div>
      <div className="task-track-title">{cur.title}</div>
      <div className="task-track-bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}><i style={{ width: `${pct}%` }} /><b>{pct}%</b></div>
      {steps.length > 0 && <ol className="task-track-steps" style={{ '--steps': steps.length } as React.CSSProperties}>
        {steps.map((s, i) => <li key={i} className={s.done ? 'done' : i === next ? 'now' : ''} title={s.text}><span className="task-step-dot">{s.done ? <Check size={14} strokeWidth={2.5} /> : <i />}</span><span className="task-step-text">{s.text}</span></li>)}
      </ol>}
    </section>
  );
}
