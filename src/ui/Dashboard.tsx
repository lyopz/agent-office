// The dashboard: how the brain is doing at a glance. JARVIS's budget, what it is working on,
// what each branch has spent and earned, who is busy, and what waits for the owner. Everything
// here is real: it comes from JARVIS's runner (useOrigin) and the brain itself; nothing is simulated.
import { useEffect, useMemo, useRef, useState } from 'react';
import { Activity, BookOpen, CircleDollarSign, ExternalLink, FileText, Play, RotateCcw, ShieldCheck, Sparkles, Store, Sunrise, Users, X } from 'lucide-react';
import { useStore } from '../store/store';
import { useOrigin } from '../brain/useOrigin';
import { runOrigin, runnerStatus, setMemeLookFor, startStore, storeAction, taskAction, type RunnerStatus, type RunnerTask, type TaskReport } from '../brain/originLink';
import { moneyByBranch } from '../brain/branchMoney';
import { ProgressBar, ProgressLog } from '../brain/Progress';
import { STATUS_COLOR } from '../brain/status';
import { MANUAL_RUN_MINUTES, ORIGIN_ID } from '../brain/opportunity';
import { skillFileId } from '../brain/skillFiles';
import { Library } from './Business';

// Show, don't store: the page only reads what the runner and the brain already hold. The one thing it
// keeps is the last answer the runner gave, so a runner that goes offline leaves stale numbers, not blanks.
let lastKnown: { st: RunnerStatus; at: number } | null = null;
const SEEN_KEY = 'jarvis:dash-seen';
const seenAt = () => { try { return Number(localStorage.getItem(SEEN_KEY)) || 0; } catch { return 0; } };

/** Dollars, readable: whole cents, and three decimals only under a dollar. */
export const usd = (n: number) => `${n < 0 ? '-' : ''}$${Math.abs(n).toFixed(Math.abs(n) < 1 && n !== 0 ? 3 : 2)}`;
const when = (iso: string) => new Date(iso).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
const clock = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

/** Go to where a finished task's result is: a section of Approvals, or the Ads page. */
function openResult(open: NonNullable<TaskReport['open']>) {
  useStore.getState().setUi({ page: open.page });
  if (open.anchor) setTimeout(() => document.getElementById(open.anchor!)?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 250);
}

/** Open the brain page on one of JARVIS's dialogs (its runs, the agent creator, ideas). */
function openBrain(tab: 'runs' | 'ideas' | 'agent') {
  useStore.getState().setUi({ page: 'office' });
  setTimeout(() => window.dispatchEvent(new CustomEvent('agent-office:open-creator', { detail: { tab } })), 60);
}

export function Dashboard() {
  const doc = useStore((s) => s.doc);
  const rt = useStore((s) => s.runtime);
  const live = useOrigin((o) => o.status);
  const checked = useOrigin((o) => o.checked);
  if (live) lastKnown = { st: live, at: Date.now() };
  const stale = !live && lastKnown ? lastKnown : null;
  const st = live ?? stale?.st ?? null;
  const [logAgent, setLogAgent] = useState('');
  // the digest covers everything since you last had this page open; the mark moves when you leave it
  const since = useRef(seenAt()).current;
  useEffect(() => () => { try { localStorage.setItem(SEEN_KEY, String(Date.now())); } catch { /* storage unavailable */ } }, []);
  const [running, setRunning] = useState(false);
  // cancelling a task takes two clicks: the first shows what it does, the second does it
  const [cancelId, setCancelId] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const cancelTask = async (t: RunnerTask) => {
    const { notify } = useStore.getState();
    setCancelling(true);
    const r = await taskAction({ action: 'cancel', id: t.id });
    setCancelling(false); setCancelId(null);
    if (!r) { notify(`${leader}'s runner did not answer, so "${t.title}" was not cancelled.`, 'warn'); return; }
    const cleared = r.cleared ?? 0;
    notify(`Cancelled "${t.title}": no more runs or spend on it${cleared ? `, and ${cleared} waiting design${cleared === 1 ? '' : 's'} taken off your approval list` : ''}. Approve it again under ${leader}'s runs if you change your mind.`);
    useOrigin.setState({ status: await runnerStatus() });
  };
  // the Start store button: which venture's store, and the click
  const [storeId, setStoreId] = useState('');
  const [starting, setStarting] = useState(false);
  const runStore = async () => {
    const { notify } = useStore.getState();
    setStarting(true);
    const r = await startStore(storeId || st?.storeVentures?.[0]?.id);
    setStarting(false);
    if (!r) { notify(`${leader}'s runner did not answer, so the store did not start. Start it with npm.cmd run origin.`, 'warn'); return; }
    notify(r.started ? `${r.run.ventureName}'s store started: ${r.order.map((x, i) => `${i + 1}. ${x}`).join(' ')}` : `${r.run.ventureName}'s store is already running (step ${r.run.stage + 1} of ${r.order.length}).`);
    useOrigin.setState({ status: await runnerStatus() });
  };
  // what the owner wants the scouts to look for; kept as typed until saved
  const [lookFor, setLookFor] = useState<string | null>(null);
  const saveLookFor = async () => {
    const { notify } = useStore.getState();
    const ok = await setMemeLookFor(lookFor ?? '');
    notify(ok ? 'Saved. The scouts follow it from their next run.' : `${leader}'s runner did not answer, so it was not saved.`, ok ? undefined : 'warn');
    if (ok) { setLookFor(null); useOrigin.setState({ status: await runnerStatus() }); }
  };
  const storeDo = async (action: 'stop' | 'restart', runId: string, name: string) => {
    const { notify } = useStore.getState();
    setStarting(true);
    const r = await storeAction(action, runId);
    setStarting(false);
    if (!r?.ok) { notify(r?.error ?? `${leader}'s runner did not answer.`, 'warn'); return; }
    notify(action === 'stop' ? `Stopped ${name}'s store run: no more runs or spend on it${r.cleared ? `, and ${r.cleared} waiting design${r.cleared === 1 ? '' : 's'} left Approvals` : ''}. Memez files and decided designs stay.` : `Restarted ${name}'s store from step 1: ${r.order[0]}.`);
    useOrigin.setState({ status: await runnerStatus() });
  };
  const runNow = async () => {
    const { notify } = useStore.getState();
    const status = await runnerStatus();
    if (!status?.configured) { notify(status ? `${leader}'s runner has no API key, so nothing ran.` : `${leader}'s runner isn't running, so nothing ran. Start it on your PC with npm.cmd run origin.`, 'warn'); return; }
    setRunning(true);
    useOrigin.setState({ status: { ...status, running: 'manual' } });
    const r = await runOrigin(useStore.getState().doc, MANUAL_RUN_MINUTES);
    useOrigin.setState({ status: await runnerStatus() });
    setRunning(false);
    const run = r?.data.run;
    notify(run ? `${leader}'s run ended (${run.status}, ${run.costKnown ? usd(run.costUsd) : 'cost unknown'})${run.summary ? `: ${run.summary}` : '.'}` : r?.data.reason ?? 'The runner did not answer.');
  };
  const agents = Object.values(doc.agents);
  const leader = doc.agents[ORIGIN_ID]?.identity.name ?? 'JARVIS';

  const money = useMemo(() => (st?.money ? moneyByBranch(doc.agents, st.money.byAgent) : []), [st?.money, doc.agents]);
  const totals = money.reduce((t, r) => ({ spent: t.spent + r.spentUsd, earned: t.earned + r.earnedUsd }), { spent: 0, earned: 0 });
  const net = totals.earned - totals.spent;
  const tasks = st?.tasks ?? [];
  const working = tasks.filter((t) => t.status === 'approved' && t.kind == null).sort((a, b) => Number(!a.focus) - Number(!b.focus));
  const waiting = tasks.filter((t) => t.status === 'proposed').length + (st?.agentProposals ?? []).filter((p) => p.status === 'proposed' && !st?.autoAgents).length + (st?.publishRequests ?? []).filter((r) => r.status === 'waiting').length;
  const done = tasks.filter((t) => t.status === 'done').length;
  const busy = agents.filter((a) => a.enabled && ['working', 'researching', 'thinking', 'communicating'].includes(rt.agents[a.id]?.status ?? '')).length;
  const errors = Object.entries(rt.agents).filter(([, r]) => r.status === 'error');
  const pct = st ? Math.min(100, (st.spentUsd / st.capUsd) * 100) : 0;
  const log = st?.progressLog ?? [];
  const who = [...new Map(log.map((e) => [e.agentId, doc.agents[e.agentId]?.identity.name ?? e.agentName])).entries()];
  const name = (id?: string | null) => (id ? doc.agents[id]?.identity.name ?? (id === ORIGIN_ID ? leader : id) : leader);

  // the digest: runs since you last looked, what they cost, and what they want you to know
  const fresh = (st?.runs ?? []).filter((r) => r.endedAt && Date.parse(r.startedAt) > since);
  const freshCost = fresh.reduce((n, r) => n + (r.costKnown ? r.costUsd : 0), 0);
  const notes = fresh.filter((r) => r.notify).slice(0, 4);
  // the pulse: runs by day over the last two weeks, newest on the right
  const days = useMemo(() => {
    const out = Array.from({ length: 14 }, (_, i) => { const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - (13 - i)); return { day: d, runs: 0, usd: 0 }; });
    for (const r of st?.runs ?? []) { const t = Date.parse(r.startedAt); const i = out.findIndex((x, j) => t >= x.day.getTime() && (j === 13 || t < out[j + 1].day.getTime())); if (i >= 0) { out[i].runs++; out[i].usd += r.costKnown ? r.costUsd : 0; } }
    return out;
  }, [st?.runs]);
  const maxRuns = Math.max(1, ...days.map((d) => d.runs));
  const skillFile = doc.skillBank.find((k) => k.id === skillFileId(ORIGIN_ID));
  const openProfile = (tab: string) => useStore.getState().setUi({ page: 'office', selection: { kind: 'agent', id: ORIGIN_ID }, profileAgentId: ORIGIN_ID, profileTab: tab });

  const runner = !checked ? { kind: 'sim', label: 'checking', note: `Looking for ${leader}'s runner…` }
    : !live ? { kind: 'off', label: stale ? 'offline · last known' : 'offline', note: `${leader}'s runner isn't running${stale ? `; showing what it said at ${clock(new Date(stale.at).toISOString())}` : ''}. Open the desktop app, or run npm.cmd run origin on your PC.` }
    : !live.configured ? { kind: 'off', label: 'no API key', note: 'The runner is up but has no API key. In the app folder run npm.cmd run set-key once, then restart it.' }
    : { kind: 'live', label: live.running ? 'working now' : 'live', note: `${live.model} · ${live.maxMinutes} min every ${live.everyMinutes >= 60 ? `${live.everyMinutes / 60} h` : `${live.everyMinutes} min`}${live.nextScheduledAt ? ` · next run about ${clock(live.nextScheduledAt)}` : ''}` };

  return (
    <div className={`dash${stale ? ' is-stale' : ''}`} aria-label="Dashboard">
      <div className="dash-head">
        <div>
          <span className="kicker"><i /> THE BRAIN · DASHBOARD</span>
          <h2>{doc.name}</h2>
          <p>{leader} at the core. {agents.length} agent{agents.length === 1 ? '' : 's'}, {busy} busy now{waiting ? `, ${waiting} thing${waiting === 1 ? '' : 's'} waiting for you` : ''}.</p>
        </div>
        <div className="actions">
          <button className="btn" disabled={running || !!st?.running} title={`Start an extra ${MANUAL_RUN_MINUTES}-minute run now, within your cap`} onClick={() => void runNow()}><Play size={14} /> {running || st?.running ? 'Running…' : `Run ${MANUAL_RUN_MINUTES} min`}</button>
          <button className="btn" onClick={() => openBrain('ideas')}><Sparkles size={14} /> Give {leader} an idea</button>
          <button className={`btn${waiting ? ' primary' : ''}`} onClick={() => openBrain('runs')}><ShieldCheck size={14} /> {waiting ? `Approve ${waiting} waiting` : `${leader}'s runs`}</button>
        </div>
      </div>

      <div className="card kpi span-4">
        <div className="l">{leader}'s budget this month</div>
        <div className="v">{st ? usd(st.spentUsd) : '—'}<small>of {st ? usd(st.capUsd) : '—'}</small></div>
        <div className="meter"><div className="bar"><i style={{ width: `${pct}%`, background: pct >= 100 ? 'var(--danger)' : pct >= 80 ? 'var(--warn)' : undefined }} /></div>
          <div className="row"><span className="grow">{st ? `${usd(st.spentTodayUsd ?? 0)} today${st.allowanceUsd != null ? ` of ${usd(st.allowanceUsd)}` : ''}` : 'No runner'}</span><span>{st ? `${usd(Math.max(0, st.capUsd - st.spentUsd))} left` : ''}</span></div></div>
      </div>
      <div className={`card kpi span-2${net > 0 ? ' good' : net < 0 ? ' bad' : ''}`}>
        <div className="l">Net, all time</div>
        <div className="v">{usd(net)}</div>
        <div className="s">earned {usd(totals.earned)} · spent {usd(totals.spent)}</div>
      </div>
      <div className="card kpi span-2">
        <div className="l">Working on</div>
        <div className="v">{working.length}<small>task{working.length === 1 ? '' : 's'}</small></div>
        <div className="s">{done} done so far</div>
      </div>
      <div className={`card kpi span-2${waiting ? ' accent' : ''}`}>
        <div className="l">Waiting for you</div>
        <div className="v">{waiting}</div>
        <div className="s">{waiting ? 'tasks, agents or products to approve' : 'nothing to approve'}</div>
      </div>
      <div className="card kpi span-2">
        <div className="l">{leader}</div>
        <div className="v"><span className={`badge ${runner.kind}`}>{runner.label}</span></div>
        <div className="s">{runner.note}</div>
      </div>

      <div className="card span-7">
        <h4><Sunrise size={13} /> Since you last looked <span className="count">{since ? `from ${when(new Date(since).toISOString())}` : 'first visit'}</span></h4>
        {!st && <p className="note">Nothing to report: the runner has not answered yet.</p>}
        {st && fresh.length === 0 && <p className="note">No runs since then. {working.length ? `${working.length} task${working.length === 1 ? '' : 's'} waiting for the next run${st.nextScheduledAt ? ` about ${clock(st.nextScheduledAt)}` : ''}.` : ''}{waiting ? ` ${waiting} thing${waiting === 1 ? '' : 's'} waiting for you.` : ''}</p>}
        {fresh.length > 0 && <>
          <p style={{ margin: '0 0 8px' }}><b>{fresh.length} run{fresh.length === 1 ? '' : 's'}</b> for {usd(freshCost)}{fresh.some((r) => !r.costKnown) ? ' (some costs unknown)' : ''}{waiting ? <>, and <b>{waiting}</b> thing{waiting === 1 ? '' : 's'} waiting for you</> : ''}.</p>
          <div className="events">{(notes.length ? notes : fresh.slice(0, 4)).map((r) => <div key={r.id} className="ev"><time>{when(r.startedAt)}</time><span className="m">{r.notify ?? r.summary ?? r.status}</span><span className="small muted mono-num">{r.costKnown ? usd(r.costUsd) : '?'}</span></div>)}</div>
        </>}
      </div>
      <div className="card span-5">
        <h4><BookOpen size={13} /> What {leader} knows</h4>
        <div className="know-list">
          <button className="know" onClick={() => openProfile('skillfile')}><b>SKILL.md</b><span>{skillFile ? skillFile.description || skillFile.name : 'Not written yet. Ask in the console: "write your SKILL.md".'}</span></button>
          <button className="know" onClick={() => openProfile('memory')}><b>Notes</b><span>{st?.memory ? st.memory.split('\n').find((l) => l.trim()) ?? 'Notes from its runs' : 'No notes yet; each run can add to them.'}</span></button>
          <button className="know" onClick={() => openBrain('runs')}><b>Next action</b><span>{st?.nextAction || 'Decided at the start of the next run.'}</span></button>
          <div className="know static"><b>Library</b><span>{Object.keys(doc.library).length} entr{Object.keys(doc.library).length === 1 ? 'y' : 'ies'} · {doc.skillBank.length} skill{doc.skillBank.length === 1 ? '' : 's'} in the bank</span></div>
        </div>
      </div>

      <div className="card span-7">
        <h4><Activity size={13} /> What {leader} is working on <span className="count">{working.length}</span></h4>
        {working.length === 0 && <p className="note">{st ? `Nothing approved. ${leader} only proposes until you approve a task, or give it one in the console below.` : 'Start the runner to see live work here.'}</p>}
        <div className="task-list">
          {working.slice(0, 8).map((t) => (
            <div key={t.id} className="task-row">
              <div className="t"><b>{t.focus ? 'Focus: ' : ''}{t.title}</b><span>{name(t.agentId)}{t.by === 'origin' ? ` · set by ${leader}` : ''} · {usd(t.spentUsd ?? 0)} of {usd(t.budgetUsd ?? st?.taskBudgetUsd ?? 1.5)}</span>
                {cancelId === t.id
                  ? <span className="task-cancel"><button className="btn sm danger" disabled={cancelling} onClick={() => void cancelTask(t)}>{cancelling ? 'Cancelling…' : 'Yes, cancel it'}</button><button className="btn sm" disabled={cancelling} onClick={() => setCancelId(null)}>Keep</button></span>
                  : <button className="btn sm ghost task-cancel-btn" title="Stop this task: no more runs or spend, and its waiting designs leave your approval list" onClick={() => setCancelId(t.id)}><X size={12} /> Cancel</button>}
              </div>
              {cancelId === t.id && <span className="small warn">Stops the task for good (no more runs or spend) and clears its designs still waiting for your Yes or No. The files stay in the gallery.</span>}
              <ProgressBar pct={t.count ? Math.round(((st?.publishRequests ?? []).filter((r) => r.taskId === t.id).length / t.count) * 100) : t.progress} label={`${t.title} progress`} />
              {t.steps?.length ? <span className="small muted">{t.steps.filter((x) => x.done).length} of {t.steps.length} steps · next: {t.steps.find((x) => !x.done)?.text ?? 'finishing'}</span> : null}
            </div>
          ))}
        </div>
        {working.length > 8 && <p className="note">And {working.length - 8} more under {leader}'s runs.</p>}
      </div>

      <div className="card span-5">
        <h4><Users size={13} /> Agents online <span className="count">{live ? `${(st?.workingNow ?? []).length} working now` : 'runner off'}</span></h4>
        {!live && <p className="note">The runner is off, so no agent is online. Start it on your PC with npm.cmd run origin.</p>}
        <div className="agent-online-list">
          {agents.filter((a) => a.enabled).map((a) => {
            const now = (st?.workingNow ?? []).find((w) => w.agentId === a.id);
            const queued = now ? undefined : tasks.find((t) => t.status === 'approved' && !t.kind && (t.agentId ?? ORIGIN_ID) === a.id && !t.waitingOnOwner);
            const state = !live ? 'offline' : now ? 'working' : queued ? 'queued' : 'idle';
            return <div key={a.id} className={`agent-online ${state}`}>
              <i aria-hidden />
              <b>{a.identity.name}</b>
              <span>{state === 'working' ? `working now on "${now!.title}"` : state === 'queued' ? `next run: "${queued!.title}"` : state === 'idle' ? 'online, nothing to do' : 'offline'}</span>
            </div>;
          })}
        </div>
      </div>

      <div className="card span-7">
        <h4><Store size={13} /> Start store <span className="count">{(st?.storeRuns ?? []).filter((r) => r.status === 'running' || r.status === 'waiting').length} running</span></h4>
        <p className="note">One button runs a store's whole job in order. Each step starts when the last one is done, inside each task's budget and the monthly cap. You can also type "start store" in the console.</p>
        <ol className="store-order">{(st?.storeOrder ?? ['Research what is selling now', 'Find memes and save them to memez', 'Design shirts from memez (no AI)', 'Ads for the products you approved']).map((x, i) => <li key={i}>{x}{i === 2 ? <small> · then your Yes in Approvals makes and lists each product</small> : null}</li>)}</ol>
        <label className="look-for">
          <b>What to look for</b>
          <span className="small muted">Tell the scouts what memes to find on Pinterest: subjects, the kind of humour, accounts or boards, and what to avoid. They follow it before their own ideas.</span>
          <textarea rows={3} maxLength={1500} value={lookFor ?? st?.memeLookFor ?? ''} placeholder='e.g. "cats acting like people, deadpan captions, reaction faces; search Pinterest for: cursed cat meme, silly animal meme; no politics, no old drawings"' onChange={(e) => setLookFor(e.target.value)} />
          {lookFor != null && lookFor !== (st?.memeLookFor ?? '') && <button className="btn sm primary" disabled={!live} onClick={() => void saveLookFor()}>Save what to look for</button>}
        </label>
        <div className="store-start">
          {(st?.storeVentures?.length ?? 0) > 1 && <select value={storeId} onChange={(e) => setStoreId(e.target.value)} aria-label="Which store">{st!.storeVentures!.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}</select>}
          <button className="btn sm primary" disabled={!live || starting} onClick={() => void runStore()}><Play size={13} /> {starting ? 'Starting…' : `Start ${st?.storeVentures?.find((v) => v.id === storeId)?.name ?? st?.storeVentures?.[0]?.name ?? leader}'s store`}</button>
        </div>
        {(st?.storeRuns ?? []).slice(0, 3).map((r) => <div key={r.id} className="store-run">
          <b>{r.ventureName}</b> <span className={`approval-state ${r.status === 'done' ? 'published' : r.status === 'stopped' ? '' : 'approved'}`}>{r.status}</span>
          <span className="small muted"> · step {Math.min(r.stage + 1, (st?.storeOrder ?? []).length || 4)} of {(st?.storeOrder ?? []).length || 4}: {(st?.storeOrder ?? [])[r.stage] ?? ''} · started {when(r.startedAt)}</span>
          {r.note ? <p className="small muted">{r.note}</p> : null}
          <span className="store-run-actions">
            {(r.status === 'running' || r.status === 'waiting') && <button className="btn sm danger" disabled={!live || starting} onClick={() => void storeDo('stop', r.id, r.ventureName)}><X size={12} /> Stop</button>}
            <button className="btn sm" disabled={!live || starting} onClick={() => void storeDo('restart', r.id, r.ventureName)}><RotateCcw size={12} /> Restart from step 1</button>
          </span>
        </div>)}
      </div>

      <div className="card span-12">
        <h4><FileText size={13} /> Finished tasks <span className="count">{(st?.reports ?? []).length} reports</span></h4>
        {!(st?.reports ?? []).length && <p className="note">Each task that finishes gets a report here: what was done, what came of it, what it cost, and a button to its result.</p>}
        <div className="report-list">
          {(st?.reports ?? []).map((r) => <details key={r.id} className="report">
            <summary>
              <b>{r.title}</b>
              <span className="small muted">{r.agentName} · {r.doneAt ? when(r.doneAt) : 'done'} · {usd(r.spentUsd)} over {r.runs} run{r.runs === 1 ? '' : 's'}</span>
              {r.open && <button className="btn sm" onClick={(e) => { e.preventDefault(); openResult(r.open!); }}><ExternalLink size={12} /> {r.open.label}</button>}
            </summary>
            <ul className="report-facts">
              {r.steps ? <li>{r.stepsDone} of {r.steps} steps done</li> : null}
              {r.saved ? <li>{r.saved} image{r.saved === 1 ? '' : 's'} saved to memez</li> : null}
              {r.designs.made ? <li>{r.designs.made} design{r.designs.made === 1 ? '' : 's'}: {r.designs.waiting} waiting for you, {r.designs.yes} yes, {r.designs.no} no</li> : null}
              {r.products.made ? <li>{r.products.listed} of {r.products.made} product{r.products.made === 1 ? '' : 's'} listed{r.products.titles.length ? `: ${r.products.titles.join(', ')}` : ''}</li> : null}
              {r.ads ? <li>{r.ads} ad{r.ads === 1 ? '' : 's'} made</li> : null}
            </ul>
            <pre className="origin-notes">{r.summary}</pre>
          </details>)}
        </div>
      </div>

      <div className="card span-5">
        <h4><CircleDollarSign size={13} /> Money by branch <span className="count">all time</span></h4>
        {!st?.money && <p className="note">Spent and earned per branch appear here once the runner is on.</p>}
        <div className="money-list">
          {money.map((r) => (
            <div key={r.id || 'none'} className="money-row">
              <b title={r.name}>{r.name}</b>
              <span><small>Spent</small>{usd(r.spentUsd)}</span>
              <span><small>Earned</small>{usd(r.earnedUsd)}</span>
              <span className={r.netUsd < 0 ? 'neg' : r.netUsd > 0 ? 'pos' : ''}><small>Net</small>{usd(r.netUsd)}</span>
            </div>
          ))}
        </div>
        {st?.money && <p className="note" style={{ marginTop: 10 }}>Earned is only what buyers paid, plus income you add. Details and your own entries are under {leader}'s runs. <button className="btn sm" style={{ marginLeft: 6 }} onClick={() => openBrain('runs')}>Open</button></p>}
      </div>

      <div className="card span-7">
        <h4>Agents <span className="count">{busy} of {agents.length} busy</span></h4>
        <table className="data"><thead><tr><th>Agent</th><th>Status</th><th>Task</th><th className="num">This month</th></tr></thead><tbody>
          {agents.sort((a, b) => (a.id === ORIGIN_ID ? -1 : b.id === ORIGIN_ID ? 1 : a.identity.name.localeCompare(b.identity.name))).map((a) => {
            const r = rt.agents[a.id]; const status = a.enabled ? r?.status ?? 'idle' : 'paused';
            const t = tasks.find((x) => x.status === 'approved' && x.kind == null && (x.agentId ?? ORIGIN_ID) === a.id);
            return (
              <tr key={a.id}>
                <td><b>{a.identity.name}</b><span className="muted"> · {a.identity.title}</span></td>
                <td><span className="status" style={{ color: STATUS_COLOR[status] }}><i className="dot" />{status}</span></td>
                <td>{t ? <>{t.title}{t.progress != null ? <span className="muted"> · {t.progress}%</span> : null}</> : <span className="muted">—</span>}</td>
                <td className="num">{st?.spentByAgent?.[a.id] != null ? usd(st.spentByAgent[a.id]) : <span className="muted">—</span>}</td>
              </tr>
            );
          })}
        </tbody></table>
        {errors.length > 0 && <div style={{ marginTop: 10 }}>{errors.map(([id, r]) => <div key={id} className="issue error"><span className="ico">!</span><span>{name(id)}: {r.statusMessage}</span></div>)}</div>}
      </div>

      <div className="card span-5">
        <h4><Play size={13} /> Recent runs <span className="count">{st?.runs.length ?? 0}</span></h4>
        <div className="pulse" role="img" aria-label={`Runs per day over the last 14 days: ${days.map((d) => d.runs).join(', ')}`}>
          {days.map((d, i) => <i key={i} title={`${d.day.toLocaleDateString([], { month: 'short', day: 'numeric' })}: ${d.runs} run${d.runs === 1 ? '' : 's'}, ${usd(d.usd)}`} style={{ height: `${Math.max(d.runs ? 12 : 4, (d.runs / maxRuns) * 100)}%`, opacity: d.runs ? 1 : .3 }} />)}
        </div>
        <div className="row small muted" style={{ marginBottom: 8 }}><span className="grow">14 days ago</span><span>today</span></div>
        {!st?.runs.length && <p className="note">No runs yet. {leader} runs {st ? `${st.maxMinutes} minutes every ${st.everyMinutes >= 60 ? `${st.everyMinutes / 60} hours` : `${st.everyMinutes} minutes`}` : 'on a schedule'} while the runner is on.</p>}
        <div className="events">
          {(st?.runs ?? []).slice(0, 12).map((r) => (
            <div key={r.id} className={`ev${r.status === 'error' ? ' error' : ''}`}><time>{when(r.startedAt)}</time><span className="m">{r.summary || r.status}{r.notify ? <b> · {r.notify}</b> : null}</span><span className="small muted mono-num">{r.costKnown ? usd(r.costUsd) : '?'}</span></div>
          ))}
        </div>
      </div>

      <div className="card span-7">
        <div className="row"><h4 className="grow">Progress log</h4>
          {who.length > 1 && <select aria-label="Agent or venture" value={logAgent} onChange={(e) => setLogAgent(e.target.value)} style={{ width: 180 }}><option value="">Everyone</option>{who.map(([id, n]) => <option key={id} value={id}>{n}</option>)}</select>}</div>
        <ProgressLog entries={logAgent ? log.filter((e) => e.agentId === logAgent) : log} showAgent={!logAgent} limit={25} />
      </div>

      <Library className="card span-5" />
    </div>
  );
}
