import { useEffect, useRef, useState } from 'react';
import { ChevronDown, ChevronUp, CornerDownLeft, TerminalSquare } from 'lucide-react';
import { useOrigin } from '../brain/useOrigin';
import { askOrigin } from '../brain/originLink';

type Entry = { id: number; type: 'user' | 'answer' | 'error'; text: string; meta?: string };

let nextId = 1;

/**
 * The console is a direct line to ORIGIN: type any question about the task it
 * is working on and it answers right away, at any time, without approval. Each
 * answer is one short model call on the same key and monthly cap as its runs.
 */
export function Console() {
  // starts folded so the brain gets the room; the choice is remembered on this device
  const [open, setOpenState] = useState(() => { try { return localStorage.getItem('agent-office:console-open') === '1'; } catch { return false; } });
  const setOpen = (v: boolean) => { setOpenState(v); try { localStorage.setItem('agent-office:console-open', v ? '1' : '0'); } catch { /* storage unavailable */ } };
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [history, setHistory] = useState<string[]>([]);
  const [hIdx, setHIdx] = useState(-1);
  const logRef = useRef<HTMLDivElement>(null);
  const status = useOrigin((s) => s.status);
  const checked = useOrigin((s) => s.checked);
  const task = status?.tasks.find((t) => t.status === 'approved' && t.kind !== 'skill-file') ?? status?.tasks.find((t) => t.status === 'approved');
  const add = (e: Omit<Entry, 'id'>) => setEntries((xs) => [...xs, { ...e, id: nextId++ }]);
  useEffect(() => { logRef.current?.scrollTo({ top: 1e6 }); }, [entries, busy]);

  // show the last few questions from the runner's log once, so the console survives a reload
  const loaded = useRef(false);
  useEffect(() => {
    if (loaded.current || !status?.asks?.length) return;
    loaded.current = true;
    setEntries(status.asks.slice(0, 5).reverse().flatMap((a) => [{ id: nextId++, type: 'user' as const, text: a.q }, { id: nextId++, type: 'answer' as const, text: a.a }]));
  }, [status]);

  const run = async (q: string) => {
    const question = q.trim();
    if (!question || busy) return;
    setHistory((h) => [question, ...h].slice(0, 50)); setHIdx(-1); setText('');
    add({ type: 'user', text: question });
    setBusy(true);
    try {
      const r = await askOrigin(question);
      if (!r) add({ type: 'error', text: "ORIGIN's runner isn't running. Start it on your PC with npm.cmd run origin." });
      else if (!r.ok) add({ type: 'error', text: r.reason });
      else add({ type: 'answer', text: r.answer, meta: r.costUsd == null ? 'cost unknown' : `$${r.costUsd.toFixed(4)}` });
    } finally { setBusy(false); }
  };

  const onKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') void run(text);
    if (e.key === 'ArrowUp' && history.length) { const i = Math.min(history.length - 1, hIdx + 1); setHIdx(i); setText(history[i]); e.preventDefault(); }
    if (e.key === 'ArrowDown') { const i = hIdx - 1; setHIdx(i); setText(i >= 0 ? history[i] : ''); e.preventDefault(); }
  };

  const badge = !checked ? { kind: 'sim', label: 'checking' } : !status ? { kind: 'off', label: 'runner off' } : !status.configured ? { kind: 'off', label: 'no API key' } : { kind: 'live', label: status.running ? 'ORIGIN working' : 'ORIGIN live' };

  return (
    <section className={`console${open ? '' : ' collapsed'}`} aria-label="Ask ORIGIN">
      <div className="panel-h" style={{ position: 'static' }}>
        <TerminalSquare size={14} /><span className="grow">Ask ORIGIN{task ? <span className="muted"> · working on: {task.title}</span> : null}</span>
        <span className={`badge ${badge.kind}`}>{badge.label}</span>
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
            {busy && <div className="muted">ORIGIN is answering…</div>}
          </div>
          <div className="console-input">
            <span className="prompt">&gt;</span>
            <input id="console-input" type="text" value={text} onChange={(e) => setText(e.target.value)} onKeyDown={onKey} aria-label="Question for ORIGIN" disabled={busy} />
            <button className="btn sm primary" disabled={busy || !text.trim()} onClick={() => void run(text)}><CornerDownLeft size={13} />Ask</button>
          </div>
        </>
      )}
    </section>
  );
}
