// Executive control: run the company by department. Switches here change what
// the simulation actually executes (task starts, holds, render handling), and
// the state shown is read back from the agents, not assumed from the switch.
import { Fragment, useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, OctagonX, Pause, Play } from 'lucide-react';
import { useStore } from '../store/store';
import { departmentStats, type DepartmentStats } from '../engine/departments';
import { STAGE_LABEL, assetTruth, isBlenderKind } from '../engine/production';
import { ASSET_STAGES, type AssetKind, type DepartmentState, type GameId } from '../model/types';
import { TOKEN_FREE_VERIFIED } from '../model/control';
import { GAME_META } from '../arcade/types';
import { confirmAction } from './primitives';
import { bridgeRequest, useBridge, useBrowserMetrics } from './resources';
import { perfSnapshot } from './perf';
import { useArcade } from './ArcadeHost';

type Tab = 'departments' | 'resources' | 'production' | 'arcade';

export function ExecutiveControl() {
  const [tab, setTab] = useState<Tab>('departments');
  return (
    <div className="exec">
      <div className="tabs" role="tablist" aria-label="Executive control">
        {(['departments', 'resources', 'production', 'arcade'] as Tab[]).map((t) => (
          <button key={t} role="tab" aria-selected={tab === t} onClick={() => setTab(t)}>{t === 'departments' ? 'Departments' : t === 'resources' ? 'Resources' : t === 'production' ? 'Production' : 'Arcade'}</button>
        ))}
      </div>
      <div className="exec-body">
        {tab === 'departments' && <Departments />}
        {tab === 'resources' && <Resources />}
        {tab === 'production' && <Production />}
        {tab === 'arcade' && <ArcadeSettingsPanel />}
      </div>
    </div>
  );
}

const STATE_LABEL: Record<DepartmentState, string> = { running: 'Running', pausing: 'Pausing', paused: 'Paused', blocked: 'Blocked', error: 'Error' };
export function StateChip({ state }: { state: DepartmentState }) {
  return <span className={`dstate dstate-${state}`}><i aria-hidden />{STATE_LABEL[state]}</span>;
}

function useStats() {
  const doc = useStore((s) => s.doc);
  const rt = useStore((s) => s.runtime);
  // the runtime changes every tick; recomputing ~5×/s is plenty for a dashboard
  const bucket = Math.floor(rt.tick / 2);
  return useMemo(() => departmentStats(doc, rt), [doc, bucket]); // eslint-disable-line react-hooks/exhaustive-deps
}

function Departments() {
  const doc = useStore((s) => s.doc);
  const stats = useStats();
  const { commit } = useStore.getState();
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [open, setOpen] = useState<string | null>(null);
  const emergency = doc.control.emergencyStop;
  const toggle = (id: string) => setSel((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const setMode = (ids: string[] | 'all', mode: 'running' | 'paused', label: string) => commit([{ op: 'departments.setMode', ids, mode }], label);
  return (
    <>
      {emergency && <div className="exec-banner danger" role="alert"><OctagonX size={16} />Emergency pause is on. Every agent is stopped and active work is held with its progress.<button className="btn sm" onClick={() => commit([{ op: 'control.update', patch: { emergencyStop: false } }], 'Lift emergency pause')}>Lift emergency pause</button></div>}
      <div className="row exec-actions">
        <h3 className="grow">Departments</h3>
        <button className="btn sm" onClick={() => setMode('all', 'paused', 'Pause all departments')}><Pause size={13} />Pause all departments</button>
        <button className="btn sm" disabled={!sel.size} onClick={() => { setMode([...sel], 'running', 'Resume selected departments'); setSel(new Set()); }}><Play size={13} />Resume selected{sel.size ? ` (${sel.size})` : ''}</button>
        {!emergency && <button className="btn sm danger" onClick={() => confirmAction({ title: 'Emergency pause every agent?', danger: true, confirmLabel: 'Pause everything', body: 'All agents stop at once, including excluded ones. Running tasks are held with their progress; renders restart from their last checkpoint on resume. Nothing is deleted.', onConfirm: () => commit([{ op: 'control.update', patch: { emergencyStop: true } }], 'Emergency pause') })}><OctagonX size={13} />Emergency pause</button>}
      </div>
      <table className="data depts">
        <thead><tr><th aria-label="Select" /><th>Department</th><th>On</th><th>Active</th><th>Paused</th><th>Tasks</th><th>Workload</th><th>Resources</th><th>Status</th><th /></tr></thead>
        <tbody>
          {stats.map((s) => (
            <Fragment key={s.dept.id}>
              <tr className={s.dept.mode === 'paused' ? 'is-off' : undefined}>
                <td><input type="checkbox" aria-label={`Select ${s.dept.name}`} checked={sel.has(s.dept.id)} onChange={() => toggle(s.dept.id)} /></td>
                <td><span className="dept-name"><i style={{ background: s.dept.color }} aria-hidden /><b>{s.dept.name}</b></span><div className="small muted">{s.note}</div></td>
                <td><Switch on={s.dept.mode === 'running'} label={`${s.dept.name} on`} onChange={(on) => setMode([s.dept.id], on ? 'running' : 'paused', `${on ? 'Resume' : 'Pause'} ${s.dept.name}`)} /></td>
                <td className="mono-num">{s.active}</td>
                <td className="mono-num">{s.paused}</td>
                <td className="mono-num">{s.tasks}{s.renders ? <span className="small muted"> · {s.renders} render</span> : null}</td>
                <td style={{ minWidth: 90 }}><div className="bar"><i style={{ width: `${s.workload}%` }} /></div><span className="small mono-num">{s.workload}%</span></td>
                <td className="small muted" title="Departments share one browser tab, so their memory and CPU can't be measured separately.">Not measurable</td>
                <td><StateChip state={s.state} /></td>
                <td className="nowrap">
                  {s.dept.mode === 'running'
                    ? <button className="btn sm" onClick={() => setMode([s.dept.id], 'paused', `Pause ${s.dept.name}`)}>Pause all agents</button>
                    : <button className="btn sm primary" onClick={() => setMode([s.dept.id], 'running', `Resume ${s.dept.name}`)}>Resume</button>}
                  <button className="btn icon sm" aria-label={`${s.dept.name} details`} aria-expanded={open === s.dept.id} onClick={() => setOpen(open === s.dept.id ? null : s.dept.id)}>{open === s.dept.id ? <ChevronDown size={14} /> : <ChevronRight size={14} />}</button>
                </td>
              </tr>
              {open === s.dept.id && <tr className="dept-detail"><td colSpan={10}><DepartmentDetail s={s} /></td></tr>}
            </Fragment>
          ))}
        </tbody>
      </table>
      <p className="note">Pausing a department stops new task starts, holds running tasks with their progress, and stops its agents’ movement and animation. Saves always finish. Renders follow the department’s render policy because they can’t pause mid-frame. Pausing doesn’t by itself free system memory: the browser keeps what it has already allocated.</p>
    </>
  );
}

function Switch({ on, label, onChange }: { on: boolean; label: string; onChange: (on: boolean) => void }) {
  return <button type="button" role="switch" aria-checked={on} aria-label={label} className="switch" onClick={() => onChange(!on)}><i /></button>;
}

function DepartmentDetail({ s }: { s: DepartmentStats }) {
  const doc = useStore((st) => st.doc);
  const { commit, runRuntimeOps, notify } = useStore.getState();
  const d = s.dept;
  const members = Object.values(doc.agents).filter((a) => (a.identity.department || 'General') === d.name);
  const [batch, setBatch] = useState({ name: '', count: 10 });
  const update = (patch: Record<string, unknown>, label: string) => commit([{ op: 'department.update', name: d.name, patch }], label);
  return (
    <div className="dept-grid">
      <div>
        <h4>Agents</h4>
        <p className="small muted">Excluded agents keep running when the department is paused or resumed in bulk.</p>
        <ul className="dept-agents">
          {members.map((a) => {
            const excluded = d.excludedAgentIds.includes(a.id);
            return (
              <li key={a.id}>
                <span className="grow">{a.identity.name}<span className="small muted"> · {a.identity.title}{!a.enabled ? ' · disabled' : ''}</span></span>
                <label className="small"><input type="checkbox" checked={excluded} onChange={() => update({ excludedAgentIds: excluded ? d.excludedAgentIds.filter((x) => x !== a.id) : [...d.excludedAgentIds, a.id] }, `${excluded ? 'Include' : 'Exclude'} ${a.identity.name}`)} /> Exclude from bulk actions</label>
              </li>
            );
          })}
        </ul>
        <div className="row">
          <button className="btn sm" onClick={() => commit([{ op: 'department.setAgentsEnabled', id: d.id, enabled: true }], `Enable all agents in ${d.name}`)}>Enable all agents</button>
          <button className="btn sm" onClick={() => commit([{ op: 'department.setAgentsEnabled', id: d.id, enabled: false }], `Disable all agents in ${d.name}`)}>Disable all agents</button>
        </div>
      </div>
      <div>
        <h4>Limits and safety</h4>
        <label className="field"><span>Maximum simultaneous tasks</span>
          <input type="number" min={0} placeholder="No limit" defaultValue={d.maxConcurrent ?? ''} onBlur={(e) => { const v = e.target.value ? Math.max(1, Math.floor(Number(e.target.value))) : null; if (v !== d.maxConcurrent) update({ maxConcurrent: v }, `Limit ${d.name}`); }} /></label>
        <label className="field"><span>Jobs that can’t pause safely (renders)</span>
          <select value={d.renderPolicy} onChange={(e) => update({ renderPolicy: e.target.value }, `${d.name} render policy`)}>
            <option value="finish">Let them finish, then pause</option>
            <option value="defer">Stop and restart from the last checkpoint</option>
            <option value="cancel">Cancel them</option>
          </select></label>
        <label className="small"><input type="checkbox" checked={d.essential} onChange={() => update({ essential: !d.essential }, `${d.name} essential`)} /> Essential (resource policies never pause it)</label>
        <h4 style={{ marginTop: 12 }}>Assign tasks in a batch</h4>
        <div className="row">
          <input type="text" aria-label="Batch task name" placeholder="Task name, e.g. Tag tickets" value={batch.name} onChange={(e) => setBatch({ ...batch, name: e.target.value })} />
          <input type="number" aria-label="How many" min={1} max={200} style={{ width: 70 }} value={batch.count} onChange={(e) => setBatch({ ...batch, count: Number(e.target.value) })} />
          <button className="btn sm primary" disabled={!batch.name.trim()} onClick={() => { notify(runRuntimeOps([{ op: 'tasks.batch', departmentId: d.id, name: batch.name.trim(), count: batch.count }]).join('; ')); setBatch({ ...batch, name: '' }); }}>Assign</button>
        </div>
        <p className="small muted">Tasks are spread evenly across the department’s enabled agents.</p>
      </div>
    </div>
  );
}

function Metric({ label, value, source }: { label: string; value: string | null; source: string }) {
  return <div className="metric"><div className="l">{label}</div><div className={`v${value == null ? ' na' : ''}`}>{value ?? 'Unavailable'}</div><div className="s">{source}</div></div>;
}

function Resources() {
  const doc = useStore((s) => s.doc);
  const { commit } = useStore.getState();
  const stats = useStats();
  const bm = useBrowserMetrics();
  const bridge = useBridge(doc.control.blenderBridgeUrl);
  const perf = perfSnapshot();
  const m = bridge.metrics;
  const gpu = m?.gpu?.[0];
  const viaBridge = bridge.status === 'connected' ? 'Measured by the local bridge' : 'Needs the local bridge';
  const p = doc.control.policy;
  const tasks = useStore((s) => s.runtime.tasks);
  const simRenders = Object.values(tasks).filter((t) => t.jobKind === 'render' && t.status === 'active').length;
  const background = Object.values(tasks).filter((t) => t.status === 'active' && t.jobKind !== 'render').length;
  const setPolicy = (patch: Partial<typeof p>, label: string) => commit([{ op: 'control.update', patch: { policy: patch } }], label);
  return (
    <>
      <h3>Measurements</h3>
      <div className="metrics">
        <Metric label="System RAM" value={m ? `${(m.ram.usedMb / 1024).toFixed(1)} / ${(m.ram.totalMb / 1024).toFixed(1)} GB` : null} source={viaBridge} />
        <Metric label="CPU utilisation" value={m?.cpu.utilPct != null ? `${m.cpu.utilPct}% of ${m.cpu.cores} cores` : null} source={viaBridge} />
        <Metric label="GPU memory" value={gpu ? `${(gpu.memUsedMb / 1024).toFixed(1)} / ${(gpu.memTotalMb / 1024).toFixed(1)} GB` : null} source={bridge.status === 'connected' ? (m?.gpu ? gpu?.name ?? '' : 'No NVIDIA tools found on the machine') : 'Needs the local bridge'} />
        <Metric label="GPU utilisation" value={gpu ? `${gpu.utilPct}%` : null} source={bridge.status === 'connected' ? (m?.gpu ? 'nvidia-smi' : 'No NVIDIA tools found on the machine') : 'Needs the local bridge'} />
        <Metric label="Active Blender jobs" value={bridge.status === 'connected' ? String(m?.blenderJobs ?? 0) : null} source={bridge.status === 'connected' ? 'Real Blender processes' : 'Blender not connected'} />
        <Metric label="This tab’s JS memory" value={bm.heapUsedMb != null ? `${bm.heapUsedMb} MB` : null} source={bm.heapUsedMb != null ? 'Reported by the browser' : 'This browser doesn’t report it'} />
        <Metric label="Simulation tick" value={perf.tick ? `${perf.tick.avg.toFixed(1)} ms avg` : null} source="Measured in this tab" />
        <Metric label="Background tasks" value={String(background)} source={`Simulated work · ${simRenders} simulated render${simRenders === 1 ? '' : 's'}`} />
      </div>
      <p className="note">Per-department memory and CPU can’t be measured: departments share one browser tab. The table below shows each department’s simulated workload instead.</p>
      <table className="data"><thead><tr><th>Department</th><th>Running tasks</th><th>Queued and held</th><th>Workload</th><th>Resource use</th></tr></thead><tbody>
        {stats.map((s) => <tr key={s.dept.id}><td>{s.dept.name}</td><td className="mono-num">{s.activeTasks}</td><td className="mono-num">{s.tasks - s.activeTasks}</td><td className="mono-num">{s.workload}%</td><td className="small muted">Unavailable</td></tr>)}
      </tbody></table>

      <h3>Resource policies</h3>
      <div className="policies">
        <label><input type="checkbox" checked={p.prioritizeRendering} onChange={() => setPolicy({ prioritizeRendering: !p.prioritizeRendering }, 'Prioritise rendering')} /> Prioritise rendering: while a render runs, other departments run at most
          <input type="number" min={1} max={200} aria-label="Background limit" style={{ width: 60, margin: '0 6px' }} defaultValue={p.backgroundLimit} onBlur={(e) => setPolicy({ backgroundLimit: Math.max(1, Math.floor(Number(e.target.value) || 1)) }, 'Background limit')} /> tasks at once</label>
        <label><input type="checkbox" checked={p.pauseNonessential} onChange={() => setPolicy({ pauseNonessential: !p.pauseNonessential }, 'Pause non-essential departments while rendering')} /> Hold new work in non-essential departments while rendering</label>
        <label><input type="checkbox" checked={p.autoResume} onChange={() => setPolicy({ autoResume: !p.autoResume }, 'Auto-resume')} /> Release those holds automatically when rendering ends</label>
        <p className="small muted">Policies only stop new work from starting. They never cancel or pause work that is already running. Per-department task limits are in each department’s details.</p>
      </div>

      <h3>Blender connection</h3>
      <BridgeSettings bridge={bridge} />
    </>
  );
}

function BridgeSettings({ bridge }: { bridge: ReturnType<typeof useBridge> }) {
  const doc = useStore((s) => s.doc);
  const { commit } = useStore.getState();
  return (
    <div className="card">
      <div className="row">
        <span className={`badge ${bridge.status === 'connected' && bridge.blender ? 'live' : 'sim'}`}>{bridge.status === 'connected' ? (bridge.blender ? 'Blender connected' : 'Bridge connected, Blender not found') : bridge.status === 'unreachable' ? 'Bridge unreachable' : 'Planning mode'}</span>
        {bridge.blender && <span className="small muted">{bridge.blender}</span>}
      </div>
      <label className="field"><span>Bridge address</span>
        <input type="url" placeholder="http://127.0.0.1:8790" defaultValue={doc.control.blenderBridgeUrl} onBlur={(e) => e.target.value !== doc.control.blenderBridgeUrl && commit([{ op: 'control.update', patch: { blenderBridgeUrl: e.target.value.trim() } }], 'Set Blender bridge')} /></label>
      {bridge.status !== 'connected' && (
        <p className="small muted">Without the bridge the studio runs in planning mode: asset progress and renders are simulated, and nothing is reported as a finished file. To produce real files, install Blender, then run <code>BLENDER_PROJECT_DIR=~/your-assets npm run blender-bridge</code> on the same machine and enter <code>http://127.0.0.1:8790</code> above. The bridge only opens .blend files in that folder and writes to its <code>exports/</code> folder. It also reports real RAM, CPU and NVIDIA GPU usage.</p>
      )}
      {bridge.error && bridge.status === 'unreachable' && <p className="small" style={{ color: 'var(--warn)' }}>{bridge.error}</p>}
    </div>
  );
}

const KINDS: AssetKind[] = ['character', 'prop', 'cosmetic', 'environment', 'animation', 'luau-script', 'level', 'ui'];

function Production() {
  const doc = useStore((s) => s.doc);
  const assets = useStore((s) => s.runtime.assets);
  const tasks = useStore((s) => s.runtime.tasks);
  const { runRuntimeOps, notify } = useStore.getState();
  const bridge = useBridge(doc.control.blenderBridgeUrl);
  const makers = Object.values(doc.agents).filter((a) => a.identity.department === '3D Design' || a.identity.department === 'Game Development');
  const [form, setForm] = useState<{ name: string; kind: AssetKind; owner: string }>({ name: '', kind: 'prop', owner: makers[0]?.id ?? '' });
  const [file, setFile] = useState<Record<string, string>>({});
  const list = Object.values(assets);
  const renders = Object.values(tasks).filter((t) => t.jobKind === 'render').slice(-12).reverse();
  const real = bridge.status === 'connected' && !!bridge.blender;
  const submit = async (kind: 'render' | 'export', id: string) => {
    const a = assets[id]; const f = file[id];
    if (!f) { notify('Enter the .blend file path first', 'warn'); return; }
    try { const j = await bridgeRequest<{ id: string }>(doc.control.blenderBridgeUrl, '/jobs', { kind, file: f, name: a.name }); notify(`Blender ${kind} started (${j.id})`); bridge.refresh(); }
    catch (e) { notify((e as Error).message, 'error'); }
  };
  return (
    <>
      <div className={`exec-banner ${real ? '' : 'warn'}`}>{real ? `Blender is connected (${bridge.blender}). Real renders and exports run through the bridge; an item counts as real only once its output file is attached.` : 'Planning mode: Blender isn’t connected, so stage progress below is simulated and no model files are produced. Connect the Blender bridge under Resources to run real jobs.'}</div>
      <h3>Pipeline</h3>
      <div className="pipeline">
        {ASSET_STAGES.filter((s) => s !== 'rejected').map((stage) => (
          <div key={stage} className="stage-col">
            <div className="stage-h">{STAGE_LABEL[stage]}<span className="small muted"> {list.filter((a) => a.stage === stage || (stage === 'assigned' && a.stage === 'rejected')).length}</span></div>
            {list.filter((a) => a.stage === stage || (stage === 'assigned' && a.stage === 'rejected')).map((a) => {
              const t = Object.values(tasks).find((x) => x.assetId === a.id && (x.status === 'active' || x.status === 'queued' || x.status === 'paused'));
              return (
                <div key={a.id} className="asset-card">
                  <b>{a.name}</b>
                  <div className="small muted">{a.kind}{a.ownerAgentId ? ` · ${doc.agents[a.ownerAgentId]?.identity.name}` : ''}{a.stage === 'rejected' ? ' · changes requested' : ''}</div>
                  {t && <div className="small">{t.status === 'paused' ? 'Held' : t.status === 'queued' ? 'Queued' : 'Working'}: {t.name} <span className="mono-num">{Math.round(t.progress)}%</span></div>}
                  <div className={`small ${a.real ? 'ok' : 'sim'}`}>{assetTruth(a)}</div>
                  {a.stage === 'review' && <div className="row"><button className="btn sm primary" onClick={() => runRuntimeOps([{ op: 'asset.review', id: a.id, approve: true }])}>Approve</button><button className="btn sm" onClick={() => runRuntimeOps([{ op: 'asset.review', id: a.id, approve: false }])}>Request changes</button></div>}
                  {real && isBlenderKind(a.kind) && (
                    <div className="row">
                      <input type="text" aria-label={`${a.name} .blend file`} placeholder="models/thing.blend" value={file[a.id] ?? ''} onChange={(e) => setFile({ ...file, [a.id]: e.target.value })} />
                      <button className="btn sm" onClick={() => submit('render', a.id)}>Render</button>
                      <button className="btn sm" onClick={() => submit('export', a.id)}>Export</button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        ))}
      </div>
      <div className="row" style={{ marginTop: 8 }}>
        <input type="text" aria-label="New item name" placeholder="New item, e.g. Jetpack prop" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        <select aria-label="Kind" value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value as AssetKind })}>{KINDS.map((k) => <option key={k}>{k}</option>)}</select>
        <select aria-label="Owner" value={form.owner} onChange={(e) => setForm({ ...form, owner: e.target.value })}>{makers.map((a) => <option key={a.id} value={a.id}>{a.identity.name}</option>)}</select>
        <button className="btn sm primary" disabled={!form.name.trim()} onClick={() => { runRuntimeOps([{ op: 'asset.create', name: form.name.trim(), kind: form.kind, ownerAgentId: form.owner || null, projectId: 'proj_roblox' in doc.projects ? 'proj_roblox' : null }]); setForm({ ...form, name: '' }); }}>Assign</button>
      </div>
      <p className="note">Agents move items through creation, preview, export and integration. Review and approval are yours. Publishing to Roblox needs your approval and a connected Roblox account, which this app doesn’t have.</p>

      <h3>Render status wall</h3>
      <table className="data"><thead><tr><th>Job</th><th>Agent or file</th><th>Status</th><th>Progress</th><th>Source</th><th /></tr></thead><tbody>
        {bridge.jobs.slice().reverse().map((j) => (
          <tr key={j.id}><td>{j.kind} · {j.id}</td><td className="small">{j.file} → {j.output}</td><td><span className={`rstate rstate-${j.status}`}>{j.status}</span></td><td>—</td><td><span className="badge live">Blender</span></td>
            <td>{j.status === 'running' && <button className="btn sm danger" title="Renders can’t pause; cancelling stops the Blender process" onClick={async () => { try { await bridgeRequest(doc.control.blenderBridgeUrl, `/jobs/${j.id}/cancel`, {}); bridge.refresh(); } catch (e) { notify((e as Error).message, 'error'); } }}>Cancel</button>}</td></tr>
        ))}
        {renders.map((t) => (
          <tr key={t.id}><td>{t.name}</td><td className="small">{t.agentId ? doc.agents[t.agentId]?.identity.name : '—'}</td>
            <td><span className={`rstate rstate-${t.status === 'active' ? 'running' : t.status === 'done' ? 'completed' : t.status === 'paused' ? 'deferred' : t.status}`}>{t.status === 'active' ? 'rendering' : t.status === 'done' ? 'completed' : t.status === 'paused' ? 'deferred' : t.status}</span></td>
            <td style={{ minWidth: 90 }}><div className="bar"><i style={{ width: `${t.progress}%` }} /></div></td><td><span className="badge sim">simulated</span></td><td /></tr>
        ))}
        {!renders.length && !bridge.jobs.length && <tr><td colSpan={6} className="muted">No render jobs yet.</td></tr>}
      </tbody></table>
    </>
  );
}

function ArcadeSettingsPanel() {
  const doc = useStore((s) => s.doc);
  const sessions = useStore((s) => s.runtime.arcadeSessions);
  const events = useStore((s) => s.runtime.events);
  const { commit } = useStore.getState();
  const a = doc.arcade;
  const blocked = events.filter((e) => e.kind === 'policy' && /arcade/.test(e.message)).slice(-8).reverse();
  return (
    <>
      <h3>Play</h3>
      <div className="row">{(Object.keys(GAME_META) as GameId[]).map((g) => <button key={g} className="btn" onClick={() => useArcade.getState().open(g)}>{GAME_META[g].title}</button>)}</div>
      <p className="note">You can also click an arcade cabinet in the Game Dev Arcade. Your own games have no score cap or time limit; Pong is always a match to 11.</p>

      <h3>Who may play</h3>
      <div className="policies" role="radiogroup" aria-label="Arcade policy">
        <label><input type="radio" name="arcade-policy" checked={a.policy === 'human-only'} onChange={() => commit([{ op: 'arcade.update', patch: { policy: 'human-only' } }], 'Arcade: human only')} /> Human only (default): only you can open the games.</label>
        <label><input type="radio" name="arcade-policy" checked={a.policy === 'agent-disabled'} onChange={() => commit([{ op: 'arcade.update', patch: { policy: 'agent-disabled' } }], 'Arcade: agent play disabled')} /> Agent play disabled: same access, with agent play switched off explicitly.</label>
        <label className={TOKEN_FREE_VERIFIED ? '' : 'disabled'}><input type="radio" name="arcade-policy" disabled={!TOKEN_FREE_VERIFIED} checked={a.policy === 'token-free'} onChange={() => commit([{ op: 'arcade.update', patch: { policy: 'token-free' } }], 'Arcade: token-free agent play')} /> Token-free agent play: not available yet.</label>
      </div>
      <p className="small muted">Agents are blocked in code: they can’t be sent to or assigned an arcade machine, and any attempt is rejected and logged. Future agent matches would be driven by local, deterministic strategies with no model calls. That path hasn’t been verified end to end, so it stays off.</p>

      <h3>Limits for future agent matches</h3>
      <table className="data"><thead><tr><th>Game</th><th>Maximum score</th><th>Maximum session (minutes)</th></tr></thead><tbody>
        {(Object.keys(GAME_META) as GameId[]).map((g) => (
          <tr key={g}><td>{GAME_META[g].title}</td>
            <td><input type="number" min={1} aria-label={`${g} max score`} defaultValue={a.limits[g].maxScore} onBlur={(e) => commit([{ op: 'arcade.update', patch: { limits: { [g]: { maxScore: Math.max(1, Math.floor(Number(e.target.value) || 1)) } } } }], `${g} score cap`)} /></td>
            <td><input type="number" min={1} step={0.5} aria-label={`${g} max minutes`} defaultValue={a.limits[g].maxSessionSec / 60} onBlur={(e) => commit([{ op: 'arcade.update', patch: { limits: { [g]: { maxSessionSec: Math.max(10, Math.round(Number(e.target.value) * 60) || 60) } } } }], `${g} session limit`)} /></td></tr>
        ))}
      </tbody></table>
      <label className="field" style={{ maxWidth: 260 }}><span>Agent matches per agent per day</span><input type="number" min={0} max={100} defaultValue={a.maxAgentMatchesPerDay} onBlur={(e) => commit([{ op: 'arcade.update', patch: { maxAgentMatchesPerDay: Math.max(0, Math.floor(Number(e.target.value) || 0)) } }], 'Daily match limit')} /></label>

      <h3>Recent sessions</h3>
      <table className="data"><thead><tr><th>When</th><th>Player</th><th>Game</th><th>Score</th><th>Duration</th><th>Result</th></tr></thead><tbody>
        {sessions.slice(-10).reverse().map((s) => <tr key={s.id}><td>{new Date(s.startedAt).toLocaleTimeString()}</td><td>{s.agentId ? doc.agents[s.agentId]?.identity.name : 'You'}</td><td>{GAME_META[s.game].title}</td><td className="mono-num">{s.score}</td><td className="mono-num">{Math.round(s.durationSec)}s</td><td>{s.result}</td></tr>)}
        {!sessions.length && <tr><td colSpan={6} className="muted">No sessions yet.</td></tr>}
      </tbody></table>
      {blocked.length > 0 && <><h3>Blocked agent attempts</h3><ul className="small">{blocked.map((e) => <li key={e.id}>{new Date(e.at).toLocaleTimeString()} · {e.message}</li>)}</ul></>}
    </>
  );
}
