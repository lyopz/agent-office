// Business views: projects and budgets with their usage records, owner
// approvals, the shared library, and structured handoffs between agents.
import { useState } from 'react';
import { useStore } from '../store/store';
import type { Handoff, KnowledgeEntry, Project } from '../model/types';
import { projectSpend } from '../engine/governance';
import { canRead, findDuplicate, searchLibrary } from '../engine/library';
import { uid } from '../model/defaults';
import { confirmAction } from './primitives';

export function BusinessPanels() {
  return (<><Projects /><Approvals /><Handoffs /><Library /></>);
}

function Projects() {
  const doc = useStore((s) => s.doc);
  const usage = useStore((s) => s.runtime.usage);
  const { commit } = useStore.getState();
  const [open, setOpen] = useState<string | null>(null);
  const projects = Object.values(doc.projects);
  const add = () => { const p: Project = { id: uid('proj'), name: 'New project', ownerAgentId: null, budget: 100, forecastSpend: 0, status: 'active', description: '' }; commit([{ op: 'project.upsert', project: p }], 'Create project'); setOpen(p.id); };
  return (
    <div className="card span-8">
      <div className="row"><h4 className="grow">Projects and budgets</h4><button className="btn sm" onClick={add}>New project</button></div>
      <table className="data"><thead><tr><th>Project</th><th>Owner</th><th>Status</th><th>Spent / budget</th><th>Forecast</th><th /></tr></thead><tbody>
        {projects.map((p) => {
          const spent = projectSpend({ usage } as never, p.id); const pct = p.budget ? (spent / p.budget) * 100 : 0;
          const col = pct >= doc.alertSettings.thresholds.budgetCriticalPct ? 'var(--danger)' : pct >= doc.alertSettings.thresholds.budgetWarnPct ? 'var(--warn)' : 'var(--accent)';
          const recs = usage.filter((u) => u.projectId === p.id);
          return [
            <tr key={p.id} id={`project-${p.id}`}>
              <td><b>{p.name}</b></td>
              <td>{p.ownerAgentId ? doc.agents[p.ownerAgentId]?.identity.name : '—'}</td>
              <td><select aria-label={`${p.name} status`} value={p.status} onChange={(e) => commit([{ op: 'project.upsert', project: { ...p, status: e.target.value as Project['status'] } }], `${p.name}: ${e.target.value}`)}>{['active', 'paused', 'blocked', 'done'].map((s) => <option key={s}>{s}</option>)}</select></td>
              <td style={{ minWidth: 150 }}><div className="bar"><i style={{ width: `${Math.min(100, pct)}%`, background: col }} /></div><span className="small mono-num">{spent.toFixed(1)} / {p.budget} credits ({Math.round(pct)}%)</span></td>
              <td className="mono-num" style={{ color: p.forecastSpend > p.budget ? 'var(--warn)' : undefined }}>{p.forecastSpend}</td>
              <td><button className="btn sm" aria-expanded={open === p.id} onClick={() => setOpen(open === p.id ? null : p.id)}>{open === p.id ? 'Hide' : `Usage (${recs.length})`}</button></td>
            </tr>,
            open === p.id && <tr key={`${p.id}-d`}><td colSpan={6}>
              <div className="field-row" style={{ ['--cols' as string]: 4 }}>
                <label className="field"><span>Name</span><input type="text" defaultValue={p.name} onBlur={(e) => e.target.value !== p.name && commit([{ op: 'project.upsert', project: { ...p, name: e.target.value } }], 'Rename project')} /></label>
                <label className="field"><span>Budget</span><input type="number" min={0} defaultValue={p.budget} onBlur={(e) => Number(e.target.value) !== p.budget && commit([{ op: 'project.upsert', project: { ...p, budget: Number(e.target.value) } }], 'Set budget')} /></label>
                <label className="field"><span>Forecast</span><input type="number" min={0} defaultValue={p.forecastSpend} onBlur={(e) => commit([{ op: 'project.upsert', project: { ...p, forecastSpend: Number(e.target.value) } }], 'Set forecast')} /></label>
                <label className="field"><span>Owner</span><select value={p.ownerAgentId ?? ''} onChange={(e) => commit([{ op: 'project.upsert', project: { ...p, ownerAgentId: e.target.value || null } }], 'Set owner')}><option value="">None</option>{Object.values(doc.agents).map((a) => <option key={a.id} value={a.id}>{a.identity.name}</option>)}</select></label>
              </div>
              <table className="data"><thead><tr><th>When</th><th>Agent</th><th>Kind</th><th>Credits</th><th>Source</th></tr></thead><tbody>
                {recs.slice(-15).reverse().map((u) => <tr key={u.id} id={`usage-${u.id}`}><td>{new Date(u.at).toLocaleTimeString()}</td><td>{u.agentId ? doc.agents[u.agentId]?.identity.name : '—'}</td><td>{u.kind}</td><td className="mono-num">{u.credits}</td><td>{u.simulated ? <span className="badge sim">simulated</span> : <span className="badge live">recorded</span>}</td></tr>)}
                {!recs.length && <tr><td colSpan={5} className="muted">No usage yet.</td></tr>}
              </tbody></table>
              <button className="btn sm danger" onClick={() => confirmAction({ title: `Delete ${p.name}?`, danger: true, confirmLabel: 'Delete', body: 'Usage records are kept. You can undo this.', onConfirm: () => commit([{ op: 'project.delete', id: p.id }], 'Delete project') })}>Delete project</button>
            </td></tr>,
          ];
        })}
        {!projects.length && <tr><td colSpan={6} className="muted">No projects yet.</td></tr>}
      </tbody></table>
      <p className="note">Spending shown here is simulated unless a live integration records it. Budget alerts link straight to these usage records.</p>
    </div>
  );
}

function Approvals() {
  const doc = useStore((s) => s.doc);
  const approvals = useStore((s) => s.runtime.approvals);
  const { runRuntimeOps } = useStore.getState();
  const list = Object.values(approvals).sort((a, b) => (a.status === 'pending' ? -1 : 1) - (b.status === 'pending' ? -1 : 1) || b.at.localeCompare(a.at)).slice(0, 20);
  return (
    <div className="card span-4">
      <h4>Owner approvals</h4>
      {list.map((a) => (
        <div key={a.id} className={`issue ${a.status === 'pending' ? 'warning' : ''}`} style={{ display: 'grid', gap: 4 }}>
          <span><b>{doc.agents[a.agentId ?? '']?.identity.name ?? 'Agent'}</b>: {a.action}{a.amount != null ? ` · ${a.amount} credits` : ''}</span>
          <span className="small">{a.detail}</span>
          <span className="small muted">{a.reason}</span>
          {a.status === 'pending'
            ? <span className="row" style={{ gap: 4 }}><button className="btn sm primary" onClick={() => runRuntimeOps([{ op: 'approval.decide', id: a.id, approve: true }])}>Approve</button><button className="btn sm danger" onClick={() => runRuntimeOps([{ op: 'approval.decide', id: a.id, approve: false }])}>Reject</button></span>
            : <span className="small" style={{ color: a.status === 'approved' ? 'var(--success)' : 'var(--danger)' }}>{a.status} {a.decidedAt ? new Date(a.decidedAt).toLocaleTimeString() : ''}</span>}
        </div>
      ))}
      {!list.length && <p className="note">No requests. Agents ask here before spending over their limit or using a tool they aren't allowed.</p>}
    </div>
  );
}

function Handoffs() {
  const doc = useStore((s) => s.doc);
  const tasks = useStore((s) => s.runtime.tasks);
  const { runRuntimeOps, notify } = useStore.getState();
  const agents = Object.values(doc.agents);
  const [from, setFrom] = useState(agents[0]?.id ?? '');
  const [to, setTo] = useState(agents[1]?.id ?? '');
  const [h, setH] = useState<Handoff>({ request: '', why: '', known: '', deliverable: '', acceptance: '', deadline: '', budget: undefined });
  const [priority, setPriority] = useState<'normal' | 'high' | 'critical'>('high');
  const prior = h.request ? searchLibrary(doc, `${h.request} ${h.deliverable}`, to, 3) : [];
  const send = () => {
    if (!h.request.trim() || !h.deliverable.trim() || !h.acceptance.trim()) { notify('A handoff needs the request, the deliverable and how it will be accepted', 'warn'); return; }
    const out = runRuntimeOps([{ op: 'task.create', name: h.request.trim().slice(0, 80), description: `${h.why}\nKnown: ${h.known}\nDeliverable: ${h.deliverable}\nAccepted when: ${h.acceptance}`, agentId: to, priority, simulated: true, handoff: { ...h, fromAgentId: from }, deadline: h.deadline || undefined }]);
    notify(out.slice(-1)[0] ?? 'Sent');
    setH({ request: '', why: '', known: '', deliverable: '', acceptance: '', deadline: '', budget: undefined });
  };
  const recent = Object.values(tasks).filter((t) => t.handoff).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 6);
  const field = (k: keyof Handoff, label: string, ph: string) => <label className="field"><span>{label}</span><input type="text" value={(h[k] as string) ?? ''} placeholder={ph} onChange={(e) => setH({ ...h, [k]: e.target.value })} /></label>;
  return (
    <div className="card span-6">
      <h4>Structured handoff</h4>
      <div className="field-row" style={{ ['--cols' as string]: 3 }}>
        <label className="field"><span>From</span><select value={from} onChange={(e) => setFrom(e.target.value)}>{agents.map((a) => <option key={a.id} value={a.id}>{a.identity.name}</option>)}</select></label>
        <label className="field"><span>To</span><select value={to} onChange={(e) => setTo(e.target.value)}>{agents.map((a) => <option key={a.id} value={a.id}>{a.identity.name}</option>)}</select></label>
        <label className="field"><span>Priority</span><select value={priority} onChange={(e) => setPriority(e.target.value as typeof priority)}><option>normal</option><option>high</option><option>critical</option></select></label>
      </div>
      {field('request', 'What is requested', 'Compare packaging suppliers')}
      {field('why', 'Why it matters', 'Launch packaging decision due Friday')}
      {field('known', 'Already known', 'Recycled board quote from Q3')}
      {field('deliverable', 'Deliverable', 'One-page comparison table')}
      {field('acceptance', 'Accepted when', 'Three suppliers, unit price and lead time')}
      <div className="field-row">{field('deadline', 'Deadline', '2026-10-24')}<label className="field"><span>Budget (credits)</span><input type="number" min={0} value={h.budget ?? ''} onChange={(e) => setH({ ...h, budget: e.target.value ? Number(e.target.value) : undefined })} /></label></div>
      {prior.length > 0 && <p className="note">Already in the library: {prior.map((p) => `“${p.entry.title}”`).join(', ')}. The receiving agent will start from these.</p>}
      <button className="btn sm primary" onClick={send}>Send handoff</button>
      <div style={{ marginTop: 8 }}>
        {recent.map((t) => { return (
          <div key={t.id} className="row small"><span className="grow">{t.name} → {doc.agents[t.agentId ?? '']?.identity.name}</span><span style={{ color: t.acknowledgedBy ? 'var(--success)' : 'var(--warn)' }}>{t.acknowledgedBy ? `acknowledged ${new Date(t.acknowledgedAt!).toLocaleTimeString()}` : t.status}</span></div>
        ); })}
      </div>
    </div>
  );
}

function Library() {
  const doc = useStore((s) => s.doc);
  const { commit, notify } = useStore.getState();
  const [q, setQ] = useState('');
  const [asAgent, setAsAgent] = useState<string>('');
  const [draft, setDraft] = useState({ title: '', topic: '', summary: '', source: '', sensitive: false });
  const entries = q ? searchLibrary(doc, q, asAgent || null, 20).map((x) => x.entry) : Object.values(doc.library).filter((e) => !asAgent || canRead(e, asAgent));
  const hidden = asAgent ? Object.values(doc.library).filter((e) => !canRead(e, asAgent)).length : 0;
  const add = () => {
    if (!draft.title.trim() || !draft.topic.trim()) { notify('Give the entry a title and topic', 'warn'); return; }
    const dup = findDuplicate(doc, draft.title, draft.topic);
    const entry: KnowledgeEntry = { id: uid('kb'), title: draft.title.trim(), topic: draft.topic.trim().toLowerCase(), summary: draft.summary, tags: draft.topic.toLowerCase().split(/\s+/), sources: draft.source ? [{ title: draft.source, url: /^https?:\/\//.test(draft.source) ? draft.source : '' }] : [], createdAt: new Date().toISOString(), authorAgentId: null, projectId: null, confidence: 0.6, verification: 'unverified', sensitive: draft.sensitive, allowedAgentIds: [] };
    const save = () => { commit([{ op: 'library.upsert', entry }], 'Add library entry'); setDraft({ title: '', topic: '', summary: '', source: '', sensitive: false }); };
    if (dup) confirmAction({ title: 'Similar entry exists', confirmLabel: 'Add anyway', body: `“${dup.title}” already covers ${dup.topic}. Adding a duplicate makes agents repeat work.`, onConfirm: save }); else save();
  };
  return (
    <div className="card span-6">
      <div className="row wrap"><h4 className="grow">Shared library</h4>
        <input type="search" aria-label="Search library" placeholder="Search" value={q} onChange={(e) => setQ(e.target.value)} style={{ maxWidth: 160 }} />
        <select aria-label="View as agent" value={asAgent} onChange={(e) => setAsAgent(e.target.value)}><option value="">View as owner</option>{Object.values(doc.agents).map((a) => <option key={a.id} value={a.id}>as {a.identity.name}</option>)}</select>
      </div>
      {entries.map((e) => (
        <div key={e.id} className="lib-entry">
          <div className="row"><b className="grow">{e.title}</b>{e.sensitive && <span className="chip" title={`Readable by ${e.allowedAgentIds.map((id) => doc.agents[id]?.identity.name).join(', ')}`}>restricted</span>}<span className="chip">{e.verification}</span><span className="small mono-num">{Math.round(e.confidence * 100)}%</span></div>
          <div className="small">{e.summary}</div>
          <div className="small muted">{e.topic} · {new Date(e.createdAt).toLocaleDateString()} · {e.authorAgentId ? doc.agents[e.authorAgentId]?.identity.name : 'owner'} · {e.sources.map((s) => s.url ? <a key={s.title} href={s.url} target="_blank" rel="noreferrer">{s.title}</a> : s.title).reduce<React.ReactNode[]>((acc, x, i) => (i ? [...acc, ', ', x] : [x]), [])}</div>
          <div className="row" style={{ gap: 4 }}>
            {e.verification !== 'verified' && <button className="btn sm" onClick={() => commit([{ op: 'library.upsert', entry: { ...e, verification: 'verified', confidence: Math.max(e.confidence, 0.85) } }], 'Verify entry')}>Mark verified</button>}
            <button className="btn sm danger" onClick={() => commit([{ op: 'library.delete', id: e.id }], 'Delete entry')}>Delete</button>
          </div>
        </div>
      ))}
      {!entries.length && <p className="note">Nothing found.</p>}
      {hidden > 0 && <p className="note">{hidden} restricted entr{hidden > 1 ? 'ies are' : 'y is'} hidden from this agent.</p>}
      <div className="field-row" style={{ ['--cols' as string]: 2, marginTop: 8 }}>
        <label className="field"><span>Title</span><input type="text" value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} /></label>
        <label className="field"><span>Topic</span><input type="text" value={draft.topic} onChange={(e) => setDraft({ ...draft, topic: e.target.value })} /></label>
      </div>
      <label className="field"><span>Summary</span><input type="text" value={draft.summary} onChange={(e) => setDraft({ ...draft, summary: e.target.value })} /></label>
      <label className="field"><span>Source</span><input type="text" placeholder="Title or https:// link" value={draft.source} onChange={(e) => setDraft({ ...draft, source: e.target.value })} /></label>
      <label className="row small"><input type="checkbox" checked={draft.sensitive} onChange={(e) => setDraft({ ...draft, sensitive: e.target.checked })} /> Restricted (only listed agents can read it)</label>
      <button className="btn sm primary" onClick={add}>Add to library</button>
    </div>
  );
}
