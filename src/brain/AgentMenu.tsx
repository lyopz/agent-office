// The agent menu beside the brain: every agent, grouped by team, with what it
// is doing and how far along it is. Hovering an agent or team lights up its
// part of the brain; clicking opens the profile. Give a task, pause, resume
// and search from here.
import { useMemo, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { Pause, Play, Search, Send } from 'lucide-react';
import { useStore } from '../store/store';
import type { AgentStatus } from '../model/types';
import { STATUS_COLOR } from '../viewport/AgentsLayer';
import { teamsOf } from './connectome';
import { useBrainFocus } from './ConnectomeView';

const BUSY: AgentStatus[] = ['working', 'researching', 'thinking', 'communicating'];

export function AgentMenu() {
  const agents = useStore((s) => s.doc.agents);
  const departments = useStore((s) => s.doc.departments);
  const selected = useStore((s) => (s.selection.kind === 'agent' ? s.selection.id : null));
  const live = useStore(useShallow((s) => {
    const queued: Record<string, number> = {};
    for (const t of Object.values(s.runtime.tasks)) if (t.status === 'queued' && t.agentId) queued[t.agentId] = (queued[t.agentId] ?? 0) + 1;
    const out: Record<string, string> = {};
    for (const id of Object.keys(s.doc.agents)) {
      const r = s.runtime.agents[id];
      const t = r?.currentTaskId ? s.runtime.tasks[r.currentTaskId] : null;
      out[id] = `${s.doc.agents[id].enabled ? (r?.status ?? 'idle') : 'paused'}|${t?.name ?? ''}|${Math.round(t?.progress ?? 0)}|${queued[id] ?? 0}`;
    }
    return out;
  }));
  const teams = useMemo(() => teamsOf({ agents, departments }), [agents, departments]);
  const [q, setQ] = useState('');
  const [task, setTask] = useState('');
  const [target, setTarget] = useState('');
  const match = (id: string) => { const a = agents[id]; return !q.trim() || `${a.identity.name} ${a.identity.title} ${a.identity.department}`.toLowerCase().includes(q.trim().toLowerCase()); };
  const busy = Object.values(live).filter((v) => BUSY.includes(v.split('|')[0] as AgentStatus)).length;
  const sorted = Object.values(agents).sort((a, b) => a.identity.name.localeCompare(b.identity.name));
  const to = target || selected || sorted[0]?.id || '';
  const focus = (teamId: string | null, agentId: string | null = null) => useBrainFocus.setState({ teamId, agentId });

  const give = () => {
    const a = agents[to];
    if (!a || !task.trim()) return;
    const s = useStore.getState();
    s.runRuntimeOps([{ op: 'task.create', agentId: a.id, name: task.trim(), roomId: a.schedule.assignedRoomId, workstationId: a.schedule.preferredWorkstationId, simulated: true }]);
    s.notify(`Gave “${task.trim()}” to ${a.identity.name}`);
    setTask('');
  };
  const togglePause = (id: string) => {
    const a = agents[id];
    useStore.getState().commit([{ op: 'agent.update', id, patch: { enabled: !a.enabled, identity: { status: a.enabled ? 'paused' : 'active' } } }], a.enabled ? `Pause ${a.identity.name}` : `Resume ${a.identity.name}`);
  };

  return (
    <aside className="agent-menu" aria-label="Agents" onPointerLeave={() => focus(null)}>
      <header className="am-head">
        <div><b>Agents</b> <span className="muted small">{busy} of {sorted.length} busy</span></div>
        <label className="am-search"><Search size={13} aria-hidden /><input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find an agent" aria-label="Find an agent" /></label>
      </header>
      <div className="am-list">
        {teams.map((t) => {
          const ids = t.agentIds.filter(match);
          if (!ids.length) return null;
          return (
            <section key={t.id} onPointerEnter={() => focus(t.id)}>
              <h4 style={{ color: t.color }}><i style={{ background: t.color }} />{t.name}<span className="muted">{ids.length}</span></h4>
              <ul>
                {ids.map((id) => {
                  const a = agents[id];
                  const [status, taskName, progress, queued] = (live[id] ?? 'idle|||0').split('|');
                  const st = status as AgentStatus;
                  return (
                    <li key={id} className={`am-agent${selected === id ? ' sel' : ''}${a.enabled ? '' : ' off'}`} onPointerEnter={() => focus(t.id, id)} onPointerLeave={() => focus(t.id)}>
                      <button className="am-open" title={`${a.identity.name}, ${a.identity.title}. Open profile`} onFocus={() => focus(t.id, id)}
                        onClick={() => useStore.getState().setUi({ selection: { kind: 'agent', id }, profileAgentId: id, profileTab: 'identity' })}>
                        <span className="am-status" style={{ background: STATUS_COLOR[st] }} aria-hidden />
                        <span className="am-text">
                          <span className="am-name">{a.identity.name}<span className="muted"> · {a.identity.title}</span>{Number(queued) > 0 && <span className="am-queue" title={`${queued} queued`}>+{queued}</span>}</span>
                          <span className="am-task">{taskName || st}</span>
                          {taskName && <span className="am-progress" aria-hidden><i style={{ width: `${progress}%`, background: t.color }} /></span>}
                        </span>
                      </button>
                      <button className="am-pause" aria-label={a.enabled ? `Pause ${a.identity.name}` : `Resume ${a.identity.name}`} title={a.enabled ? 'Pause' : 'Resume'} onClick={() => togglePause(id)}>
                        {a.enabled ? <Pause size={12} /> : <Play size={12} />}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </section>
          );
        })}
        {!sorted.some((a) => match(a.id)) && <p className="muted small am-none">No agent matches “{q}”.</p>}
      </div>
      <form className="am-give" onSubmit={(e) => { e.preventDefault(); give(); }}>
        <span className="label">Give a task</span>
        <select aria-label="Agent to give the task to" value={to} onChange={(e) => setTarget(e.target.value)}>
          {sorted.map((a) => <option key={a.id} value={a.id}>{a.identity.name}</option>)}
        </select>
        <div className="row">
          <input value={task} onChange={(e) => setTask(e.target.value)} placeholder="What should they do?" aria-label="Task to give" />
          <button className="btn sm primary" disabled={!task.trim() || !to} aria-label="Give task"><Send size={13} /></button>
        </div>
      </form>
    </aside>
  );
}
