import { useEffect, useRef, useState } from 'react';
import { ChevronDown, ChevronUp, CornerDownLeft, Maximize2, Minimize2, TerminalSquare } from 'lucide-react';
import { useOrigin } from '../brain/useOrigin';
import { askOrigin, giveTask } from '../brain/originLink';

type Entry = { id: number; type: 'user' | 'answer' | 'error'; text: string; meta?: string };

let nextId = 1;

/**
 * The console is a direct line to ORIGIN. Ask: a question answered right away by
 * the best-suited agent (one short model call on the same key and cap). Task: work
 * for ORIGIN, approved by your words; it becomes ORIGIN's focus, ahead of creating
 * agents or its own tasks, and starts right away.
 */
export function Console() {
  // starts folded so the brain gets the room; the choice is remembered on this device
  const [open, setOpenState] = useState(() => { try { return localStorage.getItem('agent-office:console-open') === '1'; } catch { return false; } });
  const setOpen = (v: boolean) => { setOpenState(v); try { localStorage.setItem('agent-office:console-open', v ? '1' : '0'); } catch { /* storage unavailable */ } };
  // the log can be made tall to read back through earlier answers; also remembered
  const [big, setBigState] = useState(() => { try { return localStorage.getItem('agent-office:console-big') === '1'; } catch { return false; } });
  const setBig = (v: boolean) => { setBigState(v); try { localStorage.setItem('agent-office:console-big', v ? '1' : '0'); } catch { /* storage unavailable */ } };
  const [text, setText] = useState('');
  // Ask a question, or give a task; remembered on this device
  const [mode, setModeState] = useState<'ask' | 'task'>(() => { try { return localStorage.getItem('agent-office:console-mode') === 'task' ? 'task' : 'ask'; } catch { return 'ask'; } });
  const setMode = (v: 'ask' | 'task') => { setModeState(v); try { localStorage.setItem('agent-office:console-mode', v); } catch { /* storage unavailable */ } };
  const [busy, setBusy] = useState(false);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [history, setHistory] = useState<string[]>([]);
  const [hIdx, setHIdx] = useState(-1);
  const logRef = useRef<HTMLDivElement>(null);
  const status = useOrigin((s) => s.status);
  const checked = useOrigin((s) => s.checked);
  const focus = status?.tasks.find((t) => t.status === 'approved' && t.focus);
  const task = focus ?? status?.tasks.find((t) => t.status === 'approved' && t.kind !== 'skill-file') ?? status?.tasks.find((t) => t.status === 'approved');
  const add = (e: Omit<Entry, 'id'>) => setEntries((xs) => [...xs, { ...e, id: nextId++ }]);
  useEffect(() => { logRef.current?.scrollTo({ top: 1e6 }); }, [entries, busy]);

  // show the last few questions from the runner's log once, so the console survives a reload
  const loaded = useRef(false);
  useEffect(() => {
    if (loaded.current || !status?.asks?.length) return;
    loaded.current = true;
    setEntries(status.asks.slice(0, 10).reverse().flatMap((a) => [{ id: nextId++, type: 'user' as const, text: a.q }, { id: nextId++, type: 'answer' as const, text: a.a, meta: a.by && a.by !== 'ORIGIN' ? `answered by ${a.by}` : undefined }]));
  }, [status]);

  const run = async (q: string) => {
    const question = q.trim();
    if (!question || busy) return;
    setHistory((h) => [question, ...h].slice(0, 50)); setHIdx(-1); setText('');
    add({ type: 'user', text: question });
    setBusy(true);
    try {
      if (mode === 'task') {
        const t = await giveTask(question);
        if (!t) add({ type: 'error', text: "ORIGIN's runner isn't running. Open the desktop app (or npm.cmd run origin)." });
        else if (!t.ok) add({ type: 'error', text: t.reason });
        else add({ type: 'answer', text: `Got it. This is ORIGIN's focus now, ahead of everything else${t.task.count ? `: ${t.task.count} items, each sent to you to approve or reject one by one under Focus in ORIGIN runs` : ''}. ${t.started ? 'Working on it now.' : 'It starts as soon as the current run ends.'}`, meta: 'task approved' });
        return;
      }
      const r = await askOrigin(question);
      if (!r) add({ type: 'error', text: "ORIGIN's runner isn't running. Start it on your PC with npm.cmd run origin." });
      else if (!r.ok) add({ type: 'error', text: r.reason });
      else add({ type: 'answer', text: r.answer, meta: [r.by && r.by !== 'ORIGIN' ? `answered by ${r.by}` : '', r.costUsd == null ? 'cost unknown' : `$${r.costUsd.toFixed(4)}`, r.approved?.length ? `approved: ${r.approved.join('; ')}${r.started ? ' · started' : ''}` : ''].filter(Boolean).join(' · ') });
    } finally { setBusy(false); }
  };

  const onKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') void run(text);
    if (e.key === 'ArrowUp' && history.length) { const i = Math.min(history.length - 1, hIdx + 1); setHIdx(i); setText(history[i]); e.preventDefault(); }
    if (e.key === 'ArrowDown') { const i = hIdx - 1; setHIdx(i); setText(i >= 0 ? history[i] : ''); e.preventDefault(); }
  };

  const badge = !checked ? { kind: 'sim', label: 'checking' } : !status ? { kind: 'off', label: 'runner off' } : !status.configured ? { kind: 'off', label: 'no API key' } : { kind: 'live', label: status.running ? 'ORIGIN working' : 'ORIGIN live' };

  return (
    <section className={`console${open ? (big ? ' big' : '') : ' collapsed'}`} aria-label="Command center">
      <div className="panel-h" style={{ position: 'static' }}>
        <TerminalSquare size={14} /><span className="grow" title="Your question goes to the agent best suited to it. Name an agent to ask it directly.">Command center{task ? <span className="muted"> · {focus ? 'focus' : 'working on'}: {task.title}</span> : null}</span>
        {status && <span className="small muted" title="Spent this month on the API, and today">${status.spentUsd.toFixed(2)} of ${status.capUsd} · today ${(status.spentTodayUsd ?? 0).toFixed(2)}</span>}
        <span className={`badge ${badge.kind}`}>{badge.label}</span>
        {open && <button className="btn icon sm ghost" aria-label={big ? 'Make the chat log smaller' : 'Make the chat log bigger'} title={big ? 'Smaller' : 'Bigger'} onClick={() => setBig(!big)}>{big ? <Minimize2 size={14} /> : <Maximize2 size={14} />}</button>}
        <button className="btn icon sm ghost" aria-label={open ? 'Collapse console' : 'Expand console'} onClick={() => setOpen(!open)}>{open ? <ChevronDown size={14} /> : <ChevronUp size={14} />}</button>
      </div>
      {open && (
        <>
          <div className="console-log" ref={logRef} aria-live="polite">
            {entries.map((e) => (
              <div key={e.id} className={e.type === 'user' ? 'u' : e.type === 'answer' ? 'a' : 'err'}>
                {e.text}{e.meta && <span className="small muted"> · {e.meta}</span>}
              </div>
            ))}
            {busy && <div className="muted">{mode === 'task' ? 'Giving ORIGIN the task…' : 'ORIGIN is answering…'}</div>}
          </div>
          <div className="console-input">
            <div className="seg" role="group" aria-label="Ask a question or give a task">
              <button className="btn sm" aria-pressed={mode === 'ask'} onClick={() => setMode('ask')} title="A question: answered right away by the best-suited agent">Ask</button>
              <button className="btn sm" aria-pressed={mode === 'task'} onClick={() => setMode('task')} title="Work: ORIGIN's focus until done, starting now">Task</button>
            </div>
            <span className="prompt">&gt;</span>
            <input id="console-input" type="text" value={text} onChange={(e) => setText(e.target.value)} onKeyDown={onKey} aria-label={mode === 'task' ? 'Task for ORIGIN' : 'Question for your agents'} placeholder={mode === 'task' ? 'A task for ORIGIN, e.g. make 5 items for my Etsy store' : 'Ask anything. It goes to the best-suited agent, or name one.'} disabled={busy} />
            <button className="btn sm primary" disabled={busy || !text.trim()} onClick={() => void run(text)}><CornerDownLeft size={13} />{mode === 'task' ? 'Do it' : 'Ask'}</button>
          </div>
        </>
      )}
    </section>
  );
}
