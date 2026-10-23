// The shared library: what the agents know, as entries the owner can read, verify and add to.
// (Ideas are library entries too; they are managed under Ideas in the brain's branch menu.)
import { useState } from 'react';
import { useStore } from '../store/store';
import type { KnowledgeEntry } from '../model/types';
import { canRead, findDuplicate, searchLibrary } from '../engine/library';
import { uid } from '../model/defaults';
import { confirmAction } from './primitives';

export function Library({ className = 'card span-6' }: { className?: string }) {
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
    <div className={className}>
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
