import { useMemo, useState } from 'react';
import { Copy, Plus, Power, Search, Trash2, UserRound } from 'lucide-react';
import { ARCHETYPE, ARCHETYPES } from '../model/cosmetics';
import { useStore } from '../store/store';
import { Character } from '../characters/Character';
import { STATUS_COLOR } from '../viewport/AgentsLayer';
import { G } from '../viewport/OfficeLayers';
import type { AgentStatus } from '../model/types';
import { deleteAgent } from './actions';

const STATUSES: AgentStatus[] = ['idle', 'working', 'walking', 'thinking', 'communicating', 'error', 'paused'];

export function centerOn(x: number, y: number) {
  const s = useStore.getState();
  const vp = document.querySelector('.viewport');
  const w = vp?.clientWidth ?? 800, h = vp?.clientHeight ?? 600;
  s.setUi({ camera: { ...s.camera, x: w / 2 - (x + 0.5) * G * s.camera.zoom, y: h / 2 - (y + 0.5) * G * s.camera.zoom } });
}

export function AgentPanel() {
  const agents = useStore((s) => s.doc.agents);
  const rooms = useStore((s) => s.doc.rooms);
  const rt = useStore((s) => s.runtime.agents);
  const tasks = useStore((s) => s.runtime.tasks);
  const selection = useStore((s) => s.selection);
  const { setUi, commit } = useStore.getState();
  const [q, setQ] = useState('');
  const [status, setStatus] = useState<'all' | AgentStatus>('all');
  const [dept, setDept] = useState('all');
  const [sort, setSort] = useState<'name' | 'status' | 'room' | 'workload'>('name');
  const depts = useMemo(() => [...new Set(Object.values(agents).map((a) => a.identity.department))].sort(), [agents]);
  const queueLen = (id: string) => Object.values(tasks).filter((t) => t.agentId === id && (t.status === 'queued' || t.status === 'active')).length;

  const list = Object.values(agents)
    .filter((a) => {
      const s = q.toLowerCase();
      const room = rt[a.id]?.roomId ? rooms[rt[a.id].roomId!]?.name ?? '' : '';
      return (!s || [a.identity.name, a.identity.title, a.identity.department, room, ...a.skills.skills].some((x) => x.toLowerCase().includes(s)))
        && (status === 'all' || rt[a.id]?.status === status) && (dept === 'all' || a.identity.department === dept);
    })
    .sort((a, b) => {
      if (sort === 'status') return (rt[a.id]?.status ?? '').localeCompare(rt[b.id]?.status ?? '');
      if (sort === 'room') return (rooms[rt[a.id]?.roomId ?? '']?.name ?? '~').localeCompare(rooms[rt[b.id]?.roomId ?? '']?.name ?? '~');
      if (sort === 'workload') return queueLen(b.id) - queueLen(a.id);
      return a.identity.name.localeCompare(b.identity.name);
    });

  const create = (archetype = 'custom') => {
    const n = Object.keys(agents).length + 1;
    const id = `agent_${Date.now().toString(36)}`;
    const t = ARCHETYPE[archetype];
    // the archetype's home room if there is one, else operations
    const home = Object.values(rooms).find((r) => r.type === t.roomType) ?? Object.values(rooms).find((r) => r.type === 'operations') ?? Object.values(rooms)[0];
    const name = archetype === 'custom' ? `AGENT-${String(n).padStart(2, '0')}` : `${t.title.split(' ').map((w) => w[0]).join('').toUpperCase()}-${String(n).padStart(2, '0')}`;
    let r = commit([{ op: 'agent.createFromArchetype', archetype, id, name, roomId: home?.id ?? null }], `Create ${t.label}`, { silent: true });
    if (!r.ok && home) r = commit([{ op: 'agent.createFromArchetype', archetype, id, name, roomId: null }, { op: 'agent.assignRoom', agentId: id, roomId: home.id }], `Create ${t.label}`);
    if (r.ok) setUi({ selection: { kind: 'agent', id }, profileAgentId: id, profileTab: 'identity' });
  };

  return (
    <aside className="panel left" aria-label="Agents">
      <div className="panel-h"><span className="grow">Agents <span className="count">{list.length}/{Object.keys(agents).length}</span></span>
        <button className="btn sm primary" onClick={() => create()} title="Create a blank agent"><Plus size={13} />New</button>
        <select aria-label="New agent from archetype" value="" onChange={(e) => e.target.value && create(e.target.value)} style={{ width: 'auto', minHeight: 26 }}>
          <option value="">From role…</option>{ARCHETYPES.filter((x) => x.id !== 'custom').map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}
        </select>
      </div>
      <div className="section" style={{ display: 'grid', gap: 6 }}>
        <div className="row"><Search size={14} className="muted" /><input type="search" placeholder="Search name, role, room, skill" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search agents" /></div>
        <div className="field-row" style={{ ['--cols' as string]: 3 }}>
          <select aria-label="Filter by status" value={status} onChange={(e) => setStatus(e.target.value as never)}><option value="all">All status</option>{STATUSES.map((s) => <option key={s}>{s}</option>)}</select>
          <select aria-label="Filter by department" value={dept} onChange={(e) => setDept(e.target.value)}><option value="all">All depts</option>{depts.map((d) => <option key={d}>{d}</option>)}</select>
          <select aria-label="Sort agents" value={sort} onChange={(e) => setSort(e.target.value as never)}><option value="name">Name</option><option value="status">Status</option><option value="room">Room</option><option value="workload">Workload</option></select>
        </div>
      </div>
      {list.length === 0 && <div className="empty">No agents match. <button className="btn sm" onClick={() => { setQ(''); setStatus('all'); setDept('all'); }}>Clear filters</button></div>}
      <div role="list">
        {list.map((a) => {
          const r = rt[a.id];
          const st = r?.status ?? 'idle';
          const task = r?.currentTaskId ? tasks[r.currentTaskId] : undefined;
          const sel = selection.kind === 'agent' && selection.id === a.id;
          const load = Math.min(100, (queueLen(a.id) / Math.max(1, a.skills.workloadLimit)) * 100);
          return (
            <div key={a.id} role="listitem" className={`agent-row${sel ? ' sel' : ''}${a.enabled ? '' : ' off'}`} tabIndex={0}
              onClick={() => { setUi({ selection: { kind: 'agent', id: a.id } }); if (r) centerOn(r.pos.x, r.pos.y); }}
              onKeyDown={(e) => { if (e.key === 'Enter') setUi({ selection: { kind: 'agent', id: a.id }, profileAgentId: a.id }); }}
              onDoubleClick={() => setUi({ profileAgentId: a.id, profileTab: 'identity' })}>
              <div className="portrait" style={{ borderColor: a.appearance.accent }}><Character a={a.appearance} view="portrait" size={40} title={`${a.identity.name} portrait`} /></div>
              <div style={{ minWidth: 0 }}>
                <div className="row" style={{ gap: 6 }}><span className="agent-name">{a.identity.name}</span><span className="status" style={{ color: STATUS_COLOR[st] }}><i className="dot" />{st}</span></div>
                <div className="agent-meta">{a.identity.title} · {r?.roomId ? rooms[r.roomId]?.name : 'In hallway'}</div>
                <div className="agent-meta" title={task?.name}>{task ? `▸ ${task.name}${task.simulated ? ' (sim)' : ''}` : r?.statusMessage ?? '— no active task'}</div>
                <div className="minibars" aria-hidden>
                  <div className="bar" title={`Energy ${Math.round(r?.energy ?? 0)}%`}><i style={{ width: `${r?.energy ?? 0}%`, background: 'var(--accent-blue)' }} /></div>
                  <div className="bar" title={`Workload ${Math.round(load)}%`}><i style={{ width: `${load}%`, background: 'var(--accent-orange)' }} /></div>
                  <div className="bar" title={`Task progress ${Math.round(task?.progress ?? 0)}%`}><i style={{ width: `${task?.progress ?? 0}%` }} /></div>
                </div>
              </div>
              <div style={{ display: 'grid', gap: 2 }} onClick={(e) => e.stopPropagation()}>
                <button className="btn icon sm ghost" title="Open full profile" aria-label={`Open ${a.identity.name} profile`} onClick={() => setUi({ selection: { kind: 'agent', id: a.id }, profileAgentId: a.id, profileTab: 'identity' })}><UserRound size={14} /></button>
                <button className="btn icon sm ghost" title="Duplicate" aria-label={`Duplicate ${a.identity.name}`} onClick={() => commit([{ op: 'agent.duplicate', id: a.id }], `Duplicate ${a.identity.name}`)}><Copy size={14} /></button>
                <button className="btn icon sm ghost" title={a.enabled ? 'Disable' : 'Enable'} aria-label={`${a.enabled ? 'Disable' : 'Enable'} ${a.identity.name}`} onClick={() => commit([{ op: 'agent.update', id: a.id, patch: { enabled: !a.enabled } }], a.enabled ? `Disable ${a.identity.name}` : `Enable ${a.identity.name}`)}><Power size={14} /></button>
                <button className="btn icon sm ghost" title="Remove" aria-label={`Remove ${a.identity.name}`} onClick={() => deleteAgent(a.id)}><Trash2 size={14} /></button>
              </div>
            </div>
          );
        })}
      </div>
    </aside>
  );
}
