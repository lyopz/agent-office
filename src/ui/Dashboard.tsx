import { useMemo, useState } from 'react';
import { useStore } from '../store/store';
import { STATUS_COLOR } from '../brain/status';
import { BusinessPanels } from './Business';

export function Dashboard() {
  const doc = useStore((s) => s.doc);
  const rt = useStore((s) => s.runtime);
  const prefs = useStore((s) => s.prefs);
  const { runRuntimeOps } = useStore.getState();
  const [evFilter, setEvFilter] = useState('all');
  const tasks = Object.values(rt.tasks);
  const agents = Object.values(doc.agents);
  const active = agents.filter((a) => a.enabled && rt.agents[a.id] && rt.agents[a.id].status !== 'paused').length;
  const done = tasks.filter((t) => t.status === 'done');
  const inProgress = tasks.filter((t) => t.status === 'active');
  const queued = tasks.filter((t) => t.status === 'queued');
  const errorsAgents = Object.values(rt.agents).filter((r) => r.status === 'error');
  const comms = rt.events.filter((e) => e.kind === 'comms').slice(-30).reverse();
  const events = rt.events.filter((e) => evFilter === 'all' || (evFilter === 'problems' ? e.level !== 'info' : e.kind === evFilter)).slice(-80).reverse();
  // completions per minute over the last 15 minutes
  const buckets = useMemo(() => {
    const now = Date.now(); const b = Array.from({ length: 15 }, () => 0);
    for (const t of done) { const m = Math.floor((now - Date.parse(t.completedAt ?? '')) / 60000); if (m >= 0 && m < 15) b[14 - m]++; }
    return b;
  }, [done]);
  const maxB = Math.max(1, ...buckets);
  const unassigned = queued.filter((t) => !t.agentId);

  return (
    <div className="dash" aria-label="System dashboard">
      <div className="span-12 note">ORIGIN's live runs are listed under ORIGIN runs on the brain page. Tasks marked <b>sim</b> below did not call a model.</div>
      {[
        ['Active agents', `${active}/${agents.length}`], ['Tasks completed', done.length], ['In progress', inProgress.length],
        ['Queued', queued.length], ['Agents in error', errorsAgents.length]
      ].map(([l, v]) => <div key={l as string} className="card kpi"><div className="v">{v}</div><div className="l">{l}</div></div>)}

      <BusinessPanels />

      <div className="card span-8">
        <h4>Tasks completed per minute (last 15 min)</h4>
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 4, height: 120 }} role="img" aria-label={`Completions per minute: ${buckets.join(', ')}`}>
          {buckets.map((b, i) => <div key={i} title={`${b} task(s), ${14 - i} min ago`} style={{ flex: 1, height: `${(b / maxB) * 100}%`, minHeight: 2, background: 'var(--accent)', opacity: b ? 0.85 : 0.2, borderRadius: '2px 2px 0 0' }} />)}
        </div>
        <div className="row small muted"><span className="grow">15 min ago</span><span>now</span></div>
      </div>
      <div className="card span-4">
        <h4>System health</h4>
        <div className="kv" style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 4, fontSize: 'var(--fs-sm)' }}>
          <span>Task loop</span><span style={{ color: prefs.simRunning ? 'var(--accent)' : 'var(--warn)' }}>{prefs.simRunning ? 'running' : 'paused'}</span>
          <span>Autosave</span><span>{prefs.autosave ? 'on' : 'off'}</span>
        </div>
      </div>

      <div className="card span-8">
        <h4>Agents</h4>
        <table className="data"><thead><tr><th>Agent</th><th>Status</th><th>Task</th><th>Progress</th></tr></thead><tbody>
          {agents.map((a) => { const r = rt.agents[a.id]; const t = r?.currentTaskId ? rt.tasks[r.currentTaskId] : undefined; return (
            <tr key={a.id}><td>{a.identity.name}</td><td style={{ color: STATUS_COLOR[r?.status ?? 'idle'] }}>{r?.status}{r?.statusMessage ? ` — ${r.statusMessage}` : ''}</td><td>{t ? `${t.name}${t.simulated ? ' (sim)' : ''}` : '—'}</td><td style={{ width: 90 }}><div className="bar"><i style={{ width: `${t?.progress ?? 0}%` }} /></div></td></tr>
          ); })}
        </tbody></table>
      </div>

      <div className="card span-6">
        <h4>Task queues</h4>
        <table className="data"><thead><tr><th>Task</th><th>Agent</th><th>Priority</th><th>Status</th></tr></thead><tbody>
          {[...inProgress, ...queued].slice(0, 40).map((t) => (
            <tr key={t.id}><td>{t.name}{t.simulated && <span className="badge sim" style={{ marginLeft: 6 }}>sim</span>}</td>
              <td>{t.agentId ? doc.agents[t.agentId]?.identity.name : <select aria-label="Assign task" value="" onChange={(e) => e.target.value && runRuntimeOps([{ op: 'task.update', id: t.id, patch: { agentId: e.target.value, status: 'queued' } }])}><option value="">Unassigned — assign…</option>{agents.map((a) => <option key={a.id} value={a.id}>{a.identity.name}</option>)}</select>}</td>
              <td>{t.priority}</td><td>{t.status}</td></tr>
          ))}
          {!inProgress.length && !queued.length && <tr><td colSpan={4} className="muted">No open tasks.</td></tr>}
        </tbody></table>
        {unassigned.length > 0 && <p className="note warn">{unassigned.length} task(s) have no agent.</p>}
      </div>
      <div className="card span-6">
        <h4>Agent communication history</h4>
        <div className="events">{comms.map((e) => <div key={e.id} className="ev"><time>{new Date(e.at).toLocaleTimeString()}</time><span className="m">{e.message}</span><span className="badge sim">sim</span></div>)}{!comms.length && <p className="note">No messages yet.</p>}</div>
      </div>

      <div className="card span-8">
        <div className="row"><h4 className="grow">Recent events</h4>
          <select aria-label="Filter events" value={evFilter} onChange={(e) => setEvFilter(e.target.value)} style={{ width: 160 }}>{['all', 'problems', 'task-start', 'task-complete', 'change', 'config', 'system', 'finance', 'approval', 'library', 'alert'].map((k) => <option key={k}>{k}</option>)}</select></div>
        <div className="events">{events.map((e) => <div key={e.id} className={`ev ${e.level}`}><time>{new Date(e.at).toLocaleTimeString()}</time><span className="m">{e.message}</span>{e.simulated ? <span className="badge sim">sim</span> : <span className="badge live">sys</span>}</div>)}</div>
      </div>
      <div className="card span-4">
        <h4>Errors &amp; warnings</h4>
        {errorsAgents.map((r, i) => <div key={i} className="issue error"><span className="ico">!</span><span>{r.statusMessage}</span></div>)}
        {!errorsAgents.length && <p className="note">All clear.</p>}
      </div>
    </div>
  );
}
