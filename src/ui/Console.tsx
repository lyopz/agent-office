import { useEffect, useRef, useState } from 'react';
import { ChevronDown, ChevronUp, CornerDownLeft, TerminalSquare } from 'lucide-react';
import { useStore } from '../store/store';
import { getProvider, providerStatus } from '../ai/providers';
import { EXAMPLES, type Plan } from '../ai/parser';

type Entry =
  | { id: number; type: 'user'; text: string }
  | { id: number; type: 'info'; text: string }
  | { id: number; type: 'error'; text: string }
  | { id: number; type: 'clarify'; text: string; options: { label: string; command: string }[] }
  | { id: number; type: 'plan'; plan: Extract<Plan, { kind: 'plan' }>; summary: string[]; conflicts: string[]; state: 'pending' | 'applied' | 'cancelled' };

let nextId = 1;
type NewEntry = Entry extends infer E ? (E extends Entry ? Omit<E, 'id'> : never) : never;

export function Console() {
  // starts folded so the brain and taskbar get the room; the choice is remembered on this device
  const [open, setOpenState] = useState(() => { try { return localStorage.getItem('agent-office:console-open') === '1'; } catch { return false; } });
  const setOpen = (v: boolean) => { setOpenState(v); try { localStorage.setItem('agent-office:console-open', v ? '1' : '0'); } catch { /* storage unavailable */ } };
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [entries, setEntries] = useState<Entry[]>([{ id: 0, type: 'info', text: 'AI command console. Describe a change in plain English; I build a structured plan, validate it, and preview geometry changes before applying. Type “help” for examples.' }]);
  const [history, setHistory] = useState<string[]>([]);
  const [hIdx, setHIdx] = useState(-1);
  const lastAgent = useRef<string | null>(null);
  const logRef = useRef<HTMLDivElement>(null);
  const prefs = useStore((s) => s.prefs);
  const status = providerStatus(prefs.aiProvider);
  const add = (e: NewEntry) => setEntries((xs) => [...xs, { ...e, id: nextId++ } as Entry]);
  const patchEntry = (id: number, p: Partial<Entry>) => setEntries((xs) => xs.map((x) => (x.id === id ? ({ ...x, ...p } as Entry) : x)));
  useEffect(() => { logRef.current?.scrollTo({ top: 1e6 }); }, [entries]);

  const apply = (entryId: number, plan: Extract<Plan, { kind: 'plan' }>, force = false) => {
    const s = useStore.getState();
    let ok = true;
    if (plan.ops.length) {
      const r = s.commit(plan.ops, plan.label, { force, silent: true });
      ok = r.ok;
      if (!ok) {
        if (r.errors.length) add({ type: 'error', text: `Not applied: ${r.errors[0]}` });
        else { s.setUi({ conflict: null }); add({ type: 'error', text: `Not applied: ${r.conflicts.map((c) => c.message).join('; ')}. Use “Apply anyway” to accept the warnings.` }); }
        return;
      }
    }
    const out = plan.runtimeOps.length ? s.runRuntimeOps(plan.runtimeOps) : [];
    s.setUi({ preview: null });
    patchEntry(entryId, { state: 'applied' } as Partial<Entry>);
    if (out.length) add({ type: 'info', text: out.join('\n') });
  };

  const run = async (cmd: string) => {
    const command = cmd.trim();
    if (!command) return;
    setHistory((h) => [command, ...h].slice(0, 50)); setHIdx(-1);
    add({ type: 'user', text: command });
    const s = useStore.getState();
    const provider = getProvider(s.prefs.aiProvider);
    setBusy(true);
    const idle = Object.entries(s.runtime.agents).filter(([, r]) => r.status === 'idle').map(([id]) => id);
    let plan: Plan;
    try { plan = await provider.plan(command, { doc: s.doc, selection: s.selection, idleAgentIds: idle, lastAgentId: lastAgent.current }); }
    finally { setBusy(false); }
    if (plan.kind === 'clarify') { add({ type: 'clarify', text: plan.question, options: plan.options }); return; }
    if (plan.kind === 'unsupported') {
      add({ type: plan.alternatives.length ? 'info' : 'error', text: plan.message });
      if (plan.alternatives.length) add({ type: 'clarify', text: 'Closest supported commands:', options: plan.alternatives.map((a) => ({ label: a, command: a })) });
      return;
    }
    const agentRef = plan.ops.find((o) => o.op === 'agent.update') as { id: string } | undefined;
    if (agentRef) lastAgent.current = agentRef.id;
    if (!plan.ops.length && !plan.runtimeOps.length) { add({ type: 'info', text: plan.explanation.join('\n') || 'Nothing to change.' }); return; }
    const dry = plan.ops.length ? s.dryRun(plan.ops) : { ok: true, summary: [], errors: [], conflicts: [], doc: s.doc };
    if (!dry.ok) { add({ type: 'error', text: `That change can't be applied: ${dry.errors[0]}` }); return; }
    const id = nextId;
    add({ type: 'plan', plan, summary: [...new Set([...plan.explanation, ...dry.summary])], conflicts: dry.conflicts.map((c) => c.message), state: 'pending' });
    const safe = !plan.needsConfirm && !dry.conflicts.length && s.prefs.autoApplySafe;
    if (safe || (!plan.ops.length && !plan.needsConfirm)) { setTimeout(() => apply(id, plan), 0); return; }
    s.setUi({ preview: { doc: dry.doc!, ops: plan.ops, runtimeOps: plan.runtimeOps, label: plan.label, summary: dry.summary, issues: dry.conflicts, source: 'ai' } });
  };

  const onKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && !busy) { run(text); setText(''); }
    if (e.key === 'ArrowUp' && history.length) { const i = Math.min(history.length - 1, hIdx + 1); setHIdx(i); setText(history[i]); e.preventDefault(); }
    if (e.key === 'ArrowDown') { const i = hIdx - 1; setHIdx(i); setText(i >= 0 ? history[i] : ''); e.preventDefault(); }
  };

  return (
    <section className={`console${open ? '' : ' collapsed'}`} aria-label="AI command console">
      <div className="panel-h" style={{ position: 'static' }}>
        <TerminalSquare size={14} /><span className="grow">AI Command Console</span>
        <span className={`badge ${status.kind}`} title={status.detail}>{status.label}</span>
        <button className="btn icon sm ghost" aria-label={open ? 'Collapse console' : 'Expand console'} onClick={() => setOpen(!open)}>{open ? <ChevronDown size={14} /> : <ChevronUp size={14} />}</button>
      </div>
      {open && (
        <>
          <div className="console-log" ref={logRef} aria-live="polite">
            {entries.map((e) => {
              if (e.type === 'user') return <div key={e.id} className="u">{e.text}</div>;
              if (e.type === 'info' || e.type === 'error') return <div key={e.id} className={e.type === 'info' ? 'a' : 'err'}>{e.text}</div>;
              if (e.type === 'clarify') return (
                <div key={e.id} className="q">{e.text}
                  <div className="row wrap" style={{ marginTop: 4 }}>{e.options.map((o) => <button key={o.label} className="btn sm" onClick={() => run(o.command)}>{o.label}</button>)}</div>
                </div>
              );
              return (
                <div key={e.id} className="plan">
                  <div className="row"><b className="grow" style={{ color: 'var(--accent-blue)' }}>{e.plan.label}</b>
                    <span className="small muted">{e.plan.ops.length} op(s){e.plan.runtimeOps.length ? ` + ${e.plan.runtimeOps.length} action(s)` : ''}</span></div>
                  <ol>{e.summary.map((x, i) => <li key={i}>{x}</li>)}</ol>
                  {e.conflicts.length > 0 && <div className="err">Validation warnings: {e.conflicts.join('; ')}</div>}
                  <details><summary className="small muted">Structured operations</summary><pre className="small" style={{ whiteSpace: 'pre-wrap', maxHeight: 160, overflow: 'auto' }}>{JSON.stringify([...e.plan.ops, ...e.plan.runtimeOps], null, 1)}</pre></details>
                  {e.state === 'pending' && (
                    <div className="row" style={{ marginTop: 4 }}>
                      <button className="btn sm primary" onClick={() => apply(e.id, e.plan)}>Apply{e.plan.ops.some((o) => o.op.startsWith('room') || o.op.startsWith('corridor')) ? ' (preview shown in blue)' : ''}</button>
                      {e.conflicts.length > 0 && <button className="btn sm danger" onClick={() => apply(e.id, e.plan, true)}>Apply anyway</button>}
                      <button className="btn sm" onClick={() => { useStore.getState().setUi({ preview: null }); patchEntry(e.id, { state: 'cancelled' } as Partial<Entry>); }}>Cancel</button>
                    </div>
                  )}
                  {e.state === 'applied' && <div className="small" style={{ color: 'var(--accent)' }}>✓ Applied · undo with Ctrl+Z</div>}
                  {e.state === 'cancelled' && <div className="small muted">Cancelled — nothing changed</div>}
                </div>
              );
            })}
            {busy && <div className="muted">thinking…</div>}
          </div>
          <div className="suggestions">{EXAMPLES.slice(0, 4).map((x) => <button key={x} className="chip" style={{ cursor: 'pointer' }} onClick={() => setText(x)}>{x}</button>)}</div>
          <div className="console-input">
            <span className="prompt">&gt;</span>
            <input id="console-input" type="text" value={text} placeholder="e.g. Move the server room beside the research lab and widen the hallway  (press / to focus)" onChange={(e) => setText(e.target.value)} onKeyDown={onKey} aria-label="AI command" disabled={busy} />
            <button className="btn sm primary" disabled={busy || !text.trim()} onClick={() => { run(text); setText(''); }}><CornerDownLeft size={13} />Run</button>
          </div>
        </>
      )}
    </section>
  );
}
