import { useEffect, useState } from 'react';
import { Check, Plus, RefreshCw, ShieldCheck, X } from 'lucide-react';
import { useStore } from '../store/store';
import { agentProposalAction, runnerStatus, syncOrigin, taskAction, type AgentProposal, type RunnerStatus, type RunnerTask } from './originLink';
import { branchAgentOps, describeWindow } from './opportunity';
import { skillFileId, skillFileUpsert } from './skillFiles';
import type { DocOp } from '../engine/ops';

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
  const refresh = async () => { const s = await runnerStatus(); setSt(s); if (s && !s.synced) await syncOrigin(doc); };
  useEffect(() => { void refresh(); const t = setInterval(() => void refresh(), 15_000); return () => clearInterval(t); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const act = async (body: Parameters<typeof taskAction>[0] | (() => Promise<unknown>), done: string) => {
    const r = typeof body === 'function' ? await body() : await taskAction(body);
    onNotice(r ? done : 'The runner did not answer.');
    void refresh();
  };

  const approveAgent = async (p: AgentProposal) => {
    const d = useStore.getState().doc;
    const id = `agent_${p.name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 30) || 'new'}_${Date.now().toString(36)}`;
    const { ops, error } = branchAgentOps(d, p.parentId, { id, name: p.name, specialty: p.specialty || p.skill, purpose: p.purpose, skill: p.skill, window: { everyMinutes: p.everyMinutes, maxMinutes: p.maxMinutes, setBy: 'origin', reason: p.reason || 'Proposed by ORIGIN.' }, bankSkillIds: p.bankSkillIds.filter((k) => d.skillBank.some((x) => x.id === k)) });
    // the agent's own SKILL.md, written by ORIGIN with the proposal, goes to the bank with it
    const bank = p.bankSkillIds.filter((k) => d.skillBank.some((x) => x.id === k));
    const own: DocOp[] = p.skillFile ? [skillFileUpsert(d, id, p.name, p.skillFile), { op: 'agent.setBankSkills', id, skillIds: [...bank, skillFileId(id)] }] : [];
    const r = error ? null : useStore.getState().commit([...ops, ...own], `Approve agent: ${p.name}`);
    if (!r?.ok) { onNotice(`Couldn't add ${p.name}: ${error ?? r?.errors.join(' · ')}. Reject it, or fix the brain and try again.`); return; }
    await act(() => agentProposalAction({ action: 'approve', id: p.id, agentId: id }), `${p.name} is now a branch of ${d.agents[p.parentId]?.identity.name}.`);
  };
  const spent = (t: RunnerTask) => `${money(t.spentUsd ?? 0)} of ${money(t.budgetUsd ?? st?.taskBudgetUsd ?? 1.5)}${t.runCosts?.length ? ` over ${t.runCosts.length} run${t.runCosts.length === 1 ? '' : 's'}` : ''}`;

  if (st === undefined) return <div className="creator-body"><p className="creator-privacy">Checking for ORIGIN's runner…</p></div>;
  if (st === null) return (
    <div className="creator-body">
      <div className="creator-context"><ShieldCheck size={16} /><span><b>ORIGIN is offline.</b> The live runner isn't running, so nothing runs and nothing is spent.</span></div>
      <ol className="creator-steps">
        <li><b>Start the runner on your PC.</b><span>In the app folder, run <code>npm run origin</code> with your Anthropic API key set (see the README, "ORIGIN live runs"). It uses Claude Haiku 5.5 and stops at your $15 monthly cap.</span></li>
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
  const agentAsks = (st.agentProposals ?? []).filter((p) => p.status === 'proposed');
  const pct = Math.min(100, (st.spentUsd / st.capUsd) * 100);
  return (
    <div className="creator-body">
      <div className="creator-context"><ShieldCheck size={16} /><span><b>{st.configured ? `Live on ${st.model}.` : `Runner connected (${st.model}), but it has no API key.`}</b> {st.maxMinutes} min every {st.everyMinutes / 60} h{st.schedule ? '' : ' (schedule off: manual runs only)'}. {st.running ? 'A run is in progress now.' : st.nextScheduledAt ? `Next run about ${new Date(st.nextScheduledAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}.` : ''}{st.configured ? '' : ' Runs fail until you set one.'}</span></div>
      <div className="origin-budget" aria-label={`Spent ${money(st.spentUsd)} of ${money(st.capUsd)} this month`}>
        <span>{money(st.spentUsd)} of {money(st.capUsd)} this month{st.unknownCostRuns ? ` · ${st.unknownCostRuns} run(s) with unknown cost` : ''}</span>
        <i style={{ width: `${pct}%` }} />
      </div>

      {st.spentByAgent && Object.keys(st.spentByAgent).length > 0 && <p className="creator-privacy">This month by agent (one key, one cap): {Object.entries(st.spentByAgent).map(([id, usd]) => `${doc.agents[id]?.identity.name ?? id} ${money(usd)}`).join(' · ')}</p>}

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
        : <ul className="creator-request-log">{approved.map((t, i) => <li key={t.id}><b>{i === 0 ? 'Working on: ' : 'Queued: '}{t.title}</b>{t.detail && t.kind !== 'skill-file' ? `: ${t.detail.slice(0, 300)}` : ''} · {spent(t)} <button className="link-btn" onClick={() => void act({ action: 'done', id: t.id }, 'Marked done.')}>mark done</button> <button className="link-btn" onClick={() => void act({ action: 'stop', id: t.id }, 'Stopped.')}>stop</button></li>)}</ul>}
      {stopped.length > 0 && <><span className="creator-kicker">STOPPED BY BUDGET WATCH</span>
        <ul className="creator-request-log">{stopped.map((t) => <li key={t.id}><b>{t.title}</b> · {spent(t)}{t.stopReason ? `. ${t.stopReason}` : ''} <button className="link-btn" onClick={() => void act({ action: 'approve', id: t.id }, 'Restarted with a fresh budget.')}>restart</button></li>)}</ul></>}
      <div className="creator-agent-grid">
        <label className="creator-field"><span>Give ORIGIN a task (approved)</span><input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Check demand for Roblox tycoon gamepasses" /></label>
        <label className="creator-field"><span>Details</span><input value={detail} onChange={(e) => setDetail(e.target.value)} placeholder="What a good answer looks like" /></label>
      </div>
      <div className="creator-dialog-foot"><button className="creator-primary" disabled={!title.trim()} onClick={() => { void act({ action: 'add', title, detail }, 'Added and approved.'); setTitle(''); setDetail(''); }}><Plus size={14} /> Add approved task</button></div>

      {st.nextAction && <><span className="creator-kicker">NEXT ACTION</span><p className="creator-privacy">{st.nextAction}</p></>}
      {st.memory && <><span className="creator-kicker">ORIGIN'S NOTES</span><pre className="origin-notes">{st.memory}</pre></>}
      {st.runs.length > 0 && <><span className="creator-kicker">RECENT RUNS</span>
        <ul className="creator-request-log">{st.runs.map((r) => <li key={r.id}>{new Date(r.startedAt).toLocaleString()} · {r.trigger} · {r.status} · {r.costKnown ? money(r.costUsd) : 'cost unknown'}{r.searches ? ` · ${r.searches} searches` : ''}{r.summary ? `: ${r.summary}` : ''}{r.notify ? <b> · {r.notify}</b> : null}</li>)}</ul></>}
    </div>
  );
}
