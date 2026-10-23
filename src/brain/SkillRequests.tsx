import { useState } from 'react';
import { Check, Send, ShieldCheck, X } from 'lucide-react';
import { useStore } from '../store/store';
import type { SkillRequest } from '../model/types';
import { SKILL_LABELS, SKILL_TEAMS, branchAgentOps, suggestedWindow } from './opportunity';

const STATUS: Record<SkillRequest['status'], string> = {
  'venture-review': 'Waiting on the venture', 'owner-review': 'Waiting on you', 'not-relevant': 'Not relevant', approved: 'Approved', denied: 'Denied',
};

/**
 * Skill agents can't create agents. They file a request here; the venture they
 * work for judges whether it helps the venture; then the owner approves or
 * denies. Approving adds the skill agent under the venture.
 */
export default function SkillRequests({ fromId, onNotice }: { fromId: string | null; onNotice: (text: string) => void }) {
  const doc = useStore((s) => s.doc);
  const skillAgents = Object.values(doc.agents).filter((a) => a.branch?.kind === 'skill' && a.branch.ventureId && doc.agents[a.branch.ventureId]);
  const [from, setFrom] = useState(fromId ?? skillAgents[0]?.id ?? '');
  const [name, setName] = useState('');
  const [skill, setSkill] = useState<string>('Research');
  const [specialty, setSpecialty] = useState('');
  const [purpose, setPurpose] = useState('');
  const [notes, setNotes] = useState<Record<string, string>>({});
  const nameOf = (id: string | null) => (id && doc.agents[id]?.identity.name) || 'unknown';
  const commit = useStore.getState().commit;

  const file = () => {
    if (!from || !name.trim() || !purpose.trim()) { onNotice('Pick the skill agent asking, and give the new skill a name and how it helps the venture.'); return; }
    const r = commit([{ op: 'skillRequest.create', request: { id: `req_${Date.now().toString(36)}`, fromAgentId: from, name: name.trim(), skill, specialty: specialty.trim() || (SKILL_LABELS[skill] ?? skill), purpose: purpose.trim() } }], 'File a skill request');
    if (!r.ok) { onNotice(r.errors.join(' · ')); return; }
    onNotice(`Filed with ${nameOf(doc.agents[from]?.branch?.ventureId ?? null)} for review.`);
    setName(''); setSpecialty(''); setPurpose('');
  };
  const review = (r: SkillRequest, relevant: boolean) => {
    const note = notes[r.id]?.trim() ?? '';
    if (!note) { onNotice(`Say in one line why ${nameOf(r.ventureId)} judged it ${relevant ? 'relevant' : 'not relevant'}.`); return; }
    const res = commit([{ op: 'skillRequest.review', id: r.id, relevant, note }], 'Venture review');
    onNotice(res.ok ? (relevant ? 'Marked relevant. It now waits for your approval.' : 'Marked not relevant.') : res.errors.join(' · '));
  };
  const decide = (r: SkillRequest, approve: boolean) => {
    if (!approve) { const res = commit([{ op: 'skillRequest.decide', id: r.id, approve: false }], 'Deny skill request'); onNotice(res.ok ? 'Denied.' : res.errors.join(' · ')); return; }
    const id = `agent_custom_${Date.now().toString(36)}`;
    const { ops, error } = branchAgentOps(doc, r.ventureId, { id, name: r.name, specialty: r.specialty, purpose: r.purpose, skill: r.skill, window: suggestedWindow(r.skill) });
    if (error) { onNotice(error); return; }
    const res = commit([...ops, { op: 'skillRequest.decide', id: r.id, approve: true, agentId: id }], `Approve skill request: ${r.name}`);
    onNotice(res.ok ? `${r.name} now grows from ${nameOf(r.ventureId)} as a new skill branch.` : res.errors.join(' · '));
  };

  const open = doc.skillRequests.filter((r) => r.status === 'venture-review' || r.status === 'owner-review');
  const done = doc.skillRequests.filter((r) => !open.includes(r)).slice(-6).reverse();
  return (
    <div className="creator-body">
      <div className="creator-context"><ShieldCheck size={16} /><span>Skill agents can't create agents. They ask their venture, the venture checks whether the skill helps <b>that venture</b>, and then you decide. Venture reviews are recorded by hand here until a live model is connected.</span></div>

      {open.length === 0 && <p className="creator-privacy">No open requests.</p>}
      {open.map((r) => (
        <div key={r.id} className="creator-blueprint creator-request">
          <span className="creator-kicker">{STATUS[r.status]}</span>
          <p><b>{r.name}</b> · {SKILL_LABELS[r.skill] ?? r.skill} · {r.specialty}</p>
          <p>{nameOf(r.fromAgentId)} asks {nameOf(r.ventureId)}: {r.purpose}</p>
          {r.status === 'venture-review' && <div className="creator-request-row">
            <input aria-label="Venture's reasoning" placeholder={`${nameOf(r.ventureId)}'s reasoning, in one line`} value={notes[r.id] ?? ''} onChange={(e) => setNotes({ ...notes, [r.id]: e.target.value })} />
            <button className="creator-secondary" onClick={() => review(r, false)}><X size={14} /> Not relevant</button>
            <button className="creator-primary" onClick={() => review(r, true)}><Check size={14} /> Relevant</button>
          </div>}
          {r.status === 'owner-review' && <>
            <p><b>{nameOf(r.ventureId)}:</b> {r.ventureNote}</p>
            <div className="creator-request-row"><button className="creator-secondary" onClick={() => decide(r, false)}><X size={14} /> Deny</button><button className="creator-primary" onClick={() => decide(r, true)}><Check size={14} /> Approve & add</button></div>
          </>}
        </div>
      ))}

      <span className="creator-kicker">FILE A REQUEST</span>
      {skillAgents.length === 0 ? <p className="creator-privacy">Requests come from skill agents. Start a venture and give it a skill agent first.</p> : <>
        <div className="creator-agent-grid">
          <label className="creator-field"><span>Asked by</span><select value={from} onChange={(e) => setFrom(e.target.value)}>{skillAgents.map((a) => <option key={a.id} value={a.id}>{a.identity.name} (for {nameOf(a.branch!.ventureId)})</option>)}</select></label>
          <label className="creator-field"><span>New skill agent's name</span><input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. RIGGER" /></label>
          <label className="creator-field"><span>Skill</span><select value={skill} onChange={(e) => setSkill(e.target.value)}>{SKILL_TEAMS.map((d) => <option key={d} value={d}>{SKILL_LABELS[d] ?? d}</option>)}</select></label>
          <label className="creator-field"><span>Specialty</span><input value={specialty} onChange={(e) => setSpecialty(e.target.value)} placeholder="e.g. Character rigging" /></label>
          <label className="creator-field creator-wide"><span>How does it help the venture?</span><textarea value={purpose} onChange={(e) => setPurpose(e.target.value)} rows={3} /></label>
        </div>
        <div className="creator-dialog-foot"><button className="creator-primary" onClick={file}><Send size={14} /> Send to the venture</button></div>
      </>}

      {done.length > 0 && <><span className="creator-kicker">RECENT</span>
        <ul className="creator-request-log">{done.map((r) => <li key={r.id}><b>{r.name}</b> for {nameOf(r.ventureId)}: {STATUS[r.status]}{r.ventureNote ? `, “${r.ventureNote}”` : ''}</li>)}</ul></>}
    </div>
  );
}
