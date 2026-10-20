// The agent taskbar along the bottom: one chip per agent with its ball, what
// it's doing and how far along it is, plus quick "give a task", pause/resume
// and search. Clicking a chip opens that agent's profile.
import { useMemo, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { Pause, Play, Search, Send } from 'lucide-react';
import { useStore } from '../store/store';
import type { AgentStatus } from '../model/types';
import { STATUS_COLOR } from '../viewport/AgentsLayer';
import { BallIcon, moodFor } from './Ball';

const BUSY: AgentStatus[] = ['working', 'researching', 'thinking', 'communicating'];

export function Taskbar() {
  const agents = useStore((s) => s.doc.agents);
  const selected = useStore((s) => (s.selection.kind === 'agent' ? s.selection.id : null));
  const live = useStore(useShallow((s) => {
    const out: Record<string, string> = {};
    for (const id of Object.keys(s.doc.agents)) {
      const r = s.runtime.agents[id];
      const t = r?.currentTaskId ? s.runtime.tasks[r.currentTaskId] : null;
      const queued = Object.values(s.runtime.tasks).filter((x) => x.agentId === id && x.status === 'queued').length;
      out[id] = `${s.doc.agents[id].enabled ? (r?.status ?? 'idle') : 'paused'}|${t?.name ?? ''}|${Math.round(t?.progress ?? 0)}|${queued}`;
    }
    return out;
  }));
  const [q, setQ] = useState('');
  const [task, setTask] = useState('');
  const [target, setTarget] = useState<string>('');
  const list = useMemo(() => Object.values(agents)
    .filter((a) => !q.trim() || `${a.identity.name} ${a.identity.title} ${a.identity.department}`.toLowerCase().includes(q.trim().toLowerCase()))
    .sort((a, b) => a.identity.department.localeCompare(b.identity.department) || a.identity.name.localeCompare(b.identity.name)), [agents, q]);
  const busy = Object.values(live).filter((v) => BUSY.includes(v.split('|')[0] as AgentStatus)).length;
  const to = target || selected || list[0]?.id || '';

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
    <footer className="taskbar" aria-label="Agents taskbar">
      <div className="tb-left">
        <div className="tb-count" title="Agents busy right now"><b>{busy}</b>/{Object.keys(agents).length}<span>busy</span></div>
        <label className="tb-search"><Search size={13} aria-hidden /><input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find agent" aria-label="Find an agent" /></label>
        <form className="tb-give" onSubmit={(e) => { e.preventDefault(); give(); }}>
          <select aria-label="Agent to give the task to" value={to} onChange={(e) => setTarget(e.target.value)}>
            {Object.values(agents).sort((a, b) => a.identity.name.localeCompare(b.identity.name)).map((a) => <option key={a.id} value={a.id}>{a.identity.name}</option>)}
          </select>
          <input value={task} onChange={(e) => setTask(e.target.value)} placeholder="Give a task…" aria-label="Task to give" />
          <button className="btn sm primary" disabled={!task.trim() || !to} aria-label="Give task"><Send size={13} /></button>
        </form>
      </div>
      <ul className="tb-chips">
        {list.map((a) => {
          const [status, taskName, progress, queued] = (live[a.id] ?? 'idle|||0').split('|');
          const st = status as AgentStatus;
          return (
            <li key={a.id} className={`tb-chip${selected === a.id ? ' sel' : ''}${a.enabled ? '' : ' off'}`} style={{ '--c': STATUS_COLOR[st] } as React.CSSProperties}>
              <button className="tb-open" title={`${a.identity.name}, ${a.identity.title}. Open profile`}
                onClick={() => useStore.getState().setUi({ selection: { kind: 'agent', id: a.id }, profileAgentId: a.id, profileTab: 'identity' })}>
                <BallIcon a={a.appearance} size={30} mood={moodFor(st, a.appearance.expression ?? 'smile')} ring={STATUS_COLOR[st]} />
                <span className="tb-text">
                  <span className="tb-name">{a.identity.name}{Number(queued) > 0 && <span className="tb-queue" title={`${queued} queued`}>+{queued}</span>}</span>
                  <span className="tb-task">{taskName || st}</span>
                </span>
                {taskName && <span className="tb-progress" aria-hidden><i style={{ width: `${progress}%` }} /></span>}
              </button>
              <button className="tb-pause" aria-label={a.enabled ? `Pause ${a.identity.name}` : `Resume ${a.identity.name}`} title={a.enabled ? 'Pause' : 'Resume'} onClick={() => togglePause(a.id)}>
                {a.enabled ? <Pause size={12} /> : <Play size={12} />}
              </button>
            </li>
          );
        })}
        {!list.length && <li className="muted small tb-none">No agent matches “{q}”.</li>}
      </ul>
    </footer>
  );
}
