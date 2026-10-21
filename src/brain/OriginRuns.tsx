import { useEffect, useState } from 'react';
import { Check, Play, Plus, RefreshCw, ShieldCheck, X } from 'lucide-react';
import { useStore } from '../store/store';
import { agentProposalAction, runnerStatus, setAutoAgents, setAutoTasks, syncOrigin, taskAction, type AgentProposal, type RunnerStatus, type RunnerTask } from './originLink';
import { branchKind, describeWindow } from './opportunity';
import { createProposedAgent } from './skillFiles';
import { ProgressBar, ProgressLog } from './Progress';

const money = (n: number) => `$${n.toFixed(n < 1 ? 3 : 2)}`;

/**
 * ORIGIN's live runs: the budget, the tasks it may work on (the owner's
 * approval is the spending limit), its notes and recent runs. Reads from
 * server/origin-runner.mjs; without it, explains how to start it.
 */
export default function OriginRuns({ onNotice }: { onNotice: (text: string) => void }) {
  const doc = useStore((s) => s.doc);
  const [st, setSt] = useState<RunnerStatus | null | undefined>(undefined);
  const [title, setTitle] = useState('');
  const [detail, setDetail] = useState('');
  const [logAgent, setLogAgent] = useState('');
  const refresh = async () => { const s = await runnerStatus(); setSt(s); if (s && !s.synced) await syncOrigin(doc); };
  useEffect(() => { void refresh(); const t = setInterval(() => void refresh(), 15_000); return () => clearInterval(t); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const act = async (body: Parameters<typeof taskAction>[0] | (() => Promise<unknown>), done: string) => {
    const r = typeof body === 'function' ? await body() : await taskAction(body);
    onNotice(r ? done : 'The runner did not answer.');
    void refresh();
  };

  const approveAgent = async (p: AgentProposal) => {
    const r = await createProposedAgent(p);
    onNotice(r.ok ? r.message : `${r.message}. Reject it, or fix the brain and try again.`);
    void refresh();
  };
  const spent = (t: RunnerTask) => `${money(t.spentUsd ?? 0)} of ${money(t.budgetUsd ?? st?.taskBudgetUsd ?? 1.5)}${t.runCosts?.length ? ` over ${t.runCosts.length} run${t.runCosts.length === 1 ? '' : 's'}` : ''}`;

  if (st === undefined) return <div className="creator-body"><p className="creator-privacy">Checking for ORIGIN's runner…</p></div>;
  if (st === null) return (
    <div className="creator-body">
      <div className="creator-context"><ShieldCheck size={16} /><span><b>ORIGIN is offline.</b> The live runner isn't running, so nothing runs and nothing is spent.</span></div>
      <ol className="creator-steps">
        <li><b>Start the runner on your PC.</b><span>In the app folder, run <code>npm.cmd run set-key</code> once to save your Anthropic API key, then <code>npm.cmd run origin</code>. It uses Claude Haiku 5.5 and stops at your $15 monthly cap.</span></li>
        <li><b>Keep the app open once.</b><span>It sends ORIGIN's current rules to the runner. After that, runs happen every 2 hours even with the app closed, while the runner is on.</span></li>
        <li><b>Approve tasks here.</b><span>ORIGIN works only on tasks you approve. With none approved it just proposes tasks, which costs almost nothing.</span></li>
      </ol>
      <div className="creator-dialog-foot"><button className="creator-secondary" onClick={() => void refresh()}><RefreshCw size={14} /> Check again</button></div>
    </div>
  );

  const proposed = st.tasks.filter((t) => t.status === 'proposed');
  // the runner's order: your tasks first, oldest first, then SKILL.md writing
  const approved = st.tasks.filter((t) => t.status === 'approved').sort((a, b) => Number(a.kind === 'skill-file') - Number(b.kind === 'skill-file'));
  const stopped = st.tasks.filter((t) => t.status === 'stopped').slice(-5);
  // with auto-create on, ORIGIN's agents are added for you; only ones made while you were asked first still wait
  const agentAsks = (st.agentProposals ?? []).filter((p) => p.status === 'proposed' && !st.autoAgents);
  const created = (st.agentProposals ?? []).filter((p) => p.status === 'approved' && (p.auto || st.autoAgents)).slice(-6).reverse();
  const pct = Math.min(100, (st.spentUsd / st.capUsd) * 100);
  // one tap approves real work for a venture: it is worked as that venture, within its task budget
  const ventures = Object.values(doc.agents).filter((a) => branchKind(doc, a.id) === 'venture');
  const working = (id: string) => st.tasks.some((t) => t.status === 'approved' && t.kind !== 'skill-file' && t.agentId === id);
  const letWork = (id: string) => {
    const a = doc.agents[id];
    void act({ action: 'add', agentId: id, title: `Get ${a.identity.name} started`, detail: `Work as ${a.identity.name}. Take the next concrete step toward making this venture earn money (${a.identity.bio || a.identity.title}). Make sure it has the skill agents it needs, then do the first piece of real work and report what you found, with sources.` }, `Approved. ${a.identity.name} works on it in ORIGIN's next run.`);
  };
  return (
    <div className="creator-body">
      <div className="creator-context"><ShieldCheck size={16} /><span><b>{st.configured ? `Live on ${st.model}.` : `Runner connected (${st.model}), but it has no API key.`}</b> {st.maxMinutes} min every {st.everyMinutes / 60} h{st.schedule ? '' : ' (schedule off: manual runs only)'}. {st.running ? 'A run is in progress now.' : st.nextScheduledAt ? `Next run about ${new Date(st.nextScheduledAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}.` : ''}{st.configured ? '' : ' Run npm.cmd run set-key once in the app folder, then restart the runner.'}</span></div>
      <div className="origin-budget" aria-label={`Spent ${money(st.spentUsd)} of ${money(st.capUsd)} this month`}>
        <span>{money(st.spentUsd)} of {money(st.capUsd)} this month{st.unknownCostRuns ? ` · ${st.unknownCostRuns} run(s) with unknown cost` : ''}</span>
        <i style={{ width: `${pct}%` }} />
      </div>

      {st.spentByAgent && Object.keys(st.spentByAgent).length > 0 && <p className="creator-privacy">This month by agent (one key, one cap): {Object.entries(st.spentByAgent).map(([id, usd]) => `${doc.agents[id]?.identity.name ?? id} ${money(usd)}`).join(' · ')}</p>}

      <label className="creator-privacy" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <input type="checkbox" checked={st.autoAgents !== false} onChange={(e) => void act(() => setAutoAgents(e.target.checked), e.target.checked ? 'ORIGIN and its ventures now create the agents they need, up to 3 a run, each with its SKILL.md.' : 'ORIGIN will ask you before creating agents.')} />
        Let ORIGIN and its ventures create the agents they need without asking (up to 3 a run; agents cost nothing until they work)
      </label>
      <label className="creator-privacy" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <input type="checkbox" checked={st.autoTasks !== false} onChange={(e) => void act(() => setAutoTasks(e.target.checked), e.target.checked ? 'Empire mode on: ORIGIN picks ventures and sets its own research tasks, inside the cap.' : 'ORIGIN will ask you before working on tasks it thinks of.')} />
        Empire mode: ORIGIN picks the ventures and sets its own research tasks (3 open at most, each within its budget and the {money(st.capUsd)} cap). It still asks before using your accounts, publishing, or spending money.
      </label>
      {created.length > 0 && <p className="creator-privacy">Recently created by ORIGIN: {created.map((p) => `${p.name} (for ${doc.agents[p.parentId]?.identity.name ?? p.parentId})`).join(', ')}.</p>}

      {ventures.length > 0 && <><span className="creator-kicker">VENTURES</span>
        <ul className="creator-request-log">{ventures.map((v) => <li key={v.id}><b>{v.identity.name}</b> · {working(v.id) ? 'approved and working' : 'idle'}{!working(v.id) && <> <button className="link-btn" onClick={() => letWork(v.id)}><Play size={12} /> Approve work</button></>}</li>)}</ul>
        <p className="creator-privacy">You can also just tell ORIGIN in the console, e.g. "allow etsy store to run" or "$1 is fine": your words count as approval, inside the {money(st.capUsd)} cap.</p></>}

      <span className="creator-kicker">WAITING FOR YOUR APPROVAL</span>
      {proposed.length === 0 && agentAsks.length === 0 && <p className="creator-privacy">Nothing proposed right now. ORIGIN proposes one thing at a time.</p>}
      {agentAsks.map((p) => (
        <div key={p.id} className="creator-blueprint creator-request">
          <p><b>New agent: {p.name}</b> · {p.skill} for {doc.agents[p.parentId]?.identity.name ?? p.parentId} · works {describeWindow({ everyMinutes: p.everyMinutes, maxMinutes: p.maxMinutes, setBy: 'origin', reason: p.reason })}</p>
          {p.purpose && <p>{p.purpose}</p>}
          {p.skillFile && <details><summary className="creator-privacy">Its own SKILL.md: {p.skillFile.name}</summary><pre className="origin-notes">{p.skillFile.body}</pre></details>}
          <p>Skills: {p.bankSkillIds.length ? p.bankSkillIds.map((k) => doc.skillBank.find((x) => x.id === k)?.name ?? `${k} (not in the bank)`).join(', ') : 'none from the bank'}</p>
          <div className="creator-request-row"><button className="creator-secondary" onClick={() => void act(() => agentProposalAction({ action: 'reject', id: p.id }), 'Rejected.')}><X size={14} /> Reject</button><button className="creator-primary" onClick={() => void approveAgent(p)}><Check size={14} /> Approve & add agent</button></div>
        </div>
      ))}
      {proposed.map((t) => (
        <div key={t.id} className="creator-blueprint creator-request">
          <p><b>{t.title}</b></p>{t.detail && <p>{t.detail}</p>}
          <div className="creator-request-row"><button className="creator-secondary" onClick={() => void act({ action: 'reject', id: t.id }, 'Rejected.')}><X size={14} /> Reject</button><button className="creator-primary" onClick={() => void act({ action: 'approve', id: t.id }, 'Approved. ORIGIN can spend its run time on it.')}><Check size={14} /> Approve</button></div>
        </div>
      ))}

      <span className="creator-kicker">APPROVED · ONE AT A TIME, YOUR TASKS FIRST</span>
      {approved.length === 0 ? <p className="creator-privacy">No approved tasks. ORIGIN will only propose tasks until you approve one.</p>
        : <ul className="creator-request-log">{approved.map((t, i) => <li key={t.id}><b>{i === 0 ? 'Working on: ' : 'Queued: '}{t.title}</b>{t.agentId && doc.agents[t.agentId] ? <span className="muted"> ({doc.agents[t.agentId].identity.name}{t.by === 'origin' ? ', set by ORIGIN' : ''})</span> : t.by === 'origin' ? <span className="muted"> (set by ORIGIN)</span> : null}{t.kind !== 'skill-file' && <ProgressBar pct={t.progress} label={`${t.title} progress`} />}{t.detail && t.kind !== 'skill-file' ? `: ${t.detail.slice(0, 300)}` : ''} · {spent(t)} <button className="link-btn" onClick={() => void act({ action: 'done', id: t.id }, 'Marked done.')}>mark done</button> <button className="link-btn" onClick={() => void act({ action: 'stop', id: t.id }, 'Stopped.')}>stop</button></li>)}</ul>}
      {stopped.length > 0 && <><span className="creator-kicker">STOPPED BY BUDGET WATCH</span>
        <ul className="creator-request-log">{stopped.map((t) => <li key={t.id}><b>{t.title}</b> · {spent(t)}{t.stopReason ? `. ${t.stopReason}` : ''} <button className="link-btn" onClick={() => void act({ action: 'approve', id: t.id }, 'Restarted with a fresh budget.')}>restart</button></li>)}</ul></>}
      <div className="creator-agent-grid">
        <label className="creator-field"><span>Give ORIGIN a task (approved)</span><input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Check demand for Roblox tycoon gamepasses" /></label>
        <label className="creator-field"><span>Details</span><input value={detail} onChange={(e) => setDetail(e.target.value)} placeholder="What a good answer looks like" /></label>
      </div>
      <div className="creator-dialog-foot"><button className="creator-primary" disabled={!title.trim()} onClick={() => { void act({ action: 'add', title, detail }, 'Added and approved.'); setTitle(''); setDetail(''); }}><Plus size={14} /> Add approved task</button></div>

      <span className="creator-kicker">PROGRESS LOG</span>
      {(() => {
        const log = st.progressLog ?? [];
        const who = [...new Map(log.map((e) => [e.agentId, doc.agents[e.agentId]?.identity.name ?? e.agentName])).entries()];
        return <>
          {who.length > 1 && <label className="creator-field"><span>Agent or venture</span><select value={logAgent} onChange={(e) => setLogAgent(e.target.value)}><option value="">Everyone</option>{who.map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></label>}
          <ProgressLog entries={logAgent ? log.filter((e) => e.agentId === logAgent) : log} showAgent={!logAgent} />
        </>;
      })()}

      {st.nextAction && <><span className="creator-kicker">NEXT ACTION</span><p className="creator-privacy">{st.nextAction}</p></>}
      {st.memory && <><span className="creator-kicker">ORIGIN'S NOTES</span><pre className="origin-notes">{st.memory}</pre></>}
      {st.runs.length > 0 && <><span className="creator-kicker">RECENT RUNS</span>
        <ul className="creator-request-log">{st.runs.map((r) => <li key={r.id}>{new Date(r.startedAt).toLocaleString()} · {r.trigger} · {r.status} · {r.costKnown ? money(r.costUsd) : 'cost unknown'}{r.searches ? ` · ${r.searches} searches` : ''}{r.skillFileFor ? ` · wrote ${r.skillFileFor}'s SKILL.md` : ''}{r.summary ? `: ${r.summary}` : ''}{r.notify ? <b> · {r.notify}</b> : null}</li>)}</ul></>}
    </div>
  );
}
