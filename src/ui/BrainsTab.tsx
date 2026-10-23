// Brains: JARVIS's head brain and every brain it oversees. Ask JARVIS to design a brain for a
// business or task, say Yes or No to the layouts it designs (new brains, and changes that grow a
// brain), pick who runs each brain (JARVIS until the owner hooks up one of its agents), open a
// brain, or move a moved-out venture back into the head brain. Nothing here is simulated: layouts
// come from JARVIS's runner, and a brain is built only after the owner's Yes.
import { useMemo, useState } from 'react';
import { Brain, Check, FlaskConical, GitBranch, Plus, RotateCcw, X } from 'lucide-react';
import { useStore } from '../store/store';
import { useOrigin } from '../brain/useOrigin';
import { brainProposalAction, evolveBrain, planBrain, runnerStatus, syncOrigin } from '../brain/originLink';
import type { BrainProposal, PlannedAgent } from '../brain/headBrain';
import { ORIGIN_ID } from '../brain/opportunity';
import { peekBrain, summarize } from '../persistence/brains';
import { headFirst } from '../brain/brainUniverse';

const when = (iso: string) => new Date(iso).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
const refresh = async () => useOrigin.setState({ status: await runnerStatus() });

function AgentLine({ a }: { a: PlannedAgent }) {
  return <li><b>{a.name}</b> · {a.specialty}{a.purpose ? <span className="small muted"> · {a.purpose}</span> : null}{a.degenSkills.length ? <span className="small"> · skills: {a.degenSkills.join(', ')}</span> : null}</li>;
}

/** The brain layouts JARVIS designed that wait for a Yes or No. Yes builds the brain (or the change) here, then tells the runner. */
export function BrainLayouts({ compact = false }: { compact?: boolean }) {
  const st = useOrigin((o) => o.status);
  const [busy, setBusy] = useState<string | null>(null);
  const waiting = (st?.brainProposals ?? []).filter((p) => p.status === 'proposed');
  if (!waiting.length) return null;
  const notify = (t: string, level?: 'warn') => useStore.getState().notify(t, level);
  const decide = async (p: BrainProposal, yes: boolean) => {
    setBusy(p.id);
    try {
      if (!yes) { const r = await brainProposalAction({ action: 'reject', id: p.id }); notify(r?.ok ? `No to the ${p.name} ${p.kind === 'new' ? 'brain' : 'changes'}.` : r?.error ?? 'The runner did not answer.', r?.ok ? undefined : 'warn'); return; }
      const s = useStore.getState();
      const built = p.kind === 'new' ? s.buildBrain(p) : s.changeBrain(p);
      if (!built) return;
      const r = await brainProposalAction({ action: 'approve', id: p.id, brainId: built.brainId, agentIds: built.agentIds });
      await syncOrigin(useStore.getState().doc);
      if (!r?.ok) notify(r?.error ?? 'The runner did not answer, so the skills and first tasks are not queued yet.', 'warn');
      else notify(p.kind === 'new' ? `Built the ${p.name} brain. JARVIS runs it and hands its agents their skills.${r.errors?.length ? ` Not given: ${r.errors.join('; ')}` : ''}` : `${p.name} grows: ${(p.addAgents ?? []).length} new agents.`);
    } finally { setBusy(null); void refresh(); }
  };
  return (
    <section id="approvals-brains" className="card approval-group brain-layouts">
      <h4><Brain size={13} /> Brain layouts from JARVIS <span className="count">{waiting.length} waiting · nothing is built before your Yes</span></h4>
      {waiting.map((p) => <div key={p.id} className="brain-layout">
        <b>{p.kind === 'new' ? `New brain: ${p.name}` : `Grow ${p.name}`}</b>
        <span className="small muted"> · {when(p.createdAt)}{p.ask ? ` · you asked for "${p.ask}"` : ''}</span>
        {p.purpose ? <p>{p.purpose}</p> : null}
        {p.note ? <p className="small">{p.note}</p> : null}
        {p.reason ? <p className="small muted">Why: {p.reason}</p> : null}
        {!compact && (p.agents ?? p.addAgents ?? []).length > 0 && <ul className="brain-layout-agents">{(p.agents ?? p.addAgents ?? []).map((a) => <AgentLine key={a.name} a={a} />)}</ul>}
        {!compact && (p.addDegenSkills ?? []).length > 0 && <ul className="brain-layout-agents">{p.addDegenSkills!.map((g) => <li key={g.skill}>Give <b>{g.skill}</b> to {g.agents.join(', ')}</li>)}</ul>}
        {!compact && (p.firstTasks ?? []).length > 0 && <p className="small">First tasks: {p.firstTasks!.map((t) => `${t.agent ? `${t.agent}: ` : ''}${t.title}`).join(' · ')}</p>}
        {!compact && (p.research ?? []).length > 0 && <p className="small muted">Keeps researching: {p.research!.join('; ')}</p>}
        <div className="approval-actions">
          <button className="btn sm danger" disabled={busy === p.id} onClick={() => void decide(p, false)}><X size={13} /> No</button>
          <button className="btn sm primary" disabled={busy === p.id} onClick={() => void decide(p, true)}><Check size={13} /> {p.kind === 'new' ? 'Yes, build it' : 'Yes, grow it'}</button>
        </div>
      </div>)}
    </section>
  );
}

/** Who runs a brain: JARVIS, or one of the brain's own agents. */
function LeadPicker({ brainId, lead }: { brainId: string; lead: string }) {
  const open = useStore((s) => s.doc);
  const doc = brainId === open.id ? open : peekBrain(brainId)?.doc;
  if (!doc || doc.head) return <span className="small">Run by JARVIS</span>;
  const agents = Object.values(doc.agents).filter((a) => a.id !== ORIGIN_ID);
  return (
    <label className="small">Run by{' '}
      <select value={lead} onChange={(e) => useStore.getState().setBrainLead(brainId, e.target.value)} aria-label={`Who runs ${doc.name}`}>
        <option value="jarvis">JARVIS</option>
        {agents.map((a) => <option key={a.id} value={a.id}>{a.identity.name}</option>)}
      </select>
    </label>
  );
}

export function BrainsTab() {
  const doc = useStore((s) => s.doc);
  const library = useStore((s) => s.brains);
  const st = useOrigin((o) => o.status);
  const [ask, setAsk] = useState('');
  const [busy, setBusy] = useState(false);
  const live = !!st;
  const all = useMemo(() => headFirst([summarize(doc, new Date().toISOString(), true), ...library]), [doc, library]);
  const info = (id: string) => st?.brain?.others.find((b) => b.id === id);
  const openTasks = (id: string) => (st?.tasks ?? []).filter((t) => t.brainId === id && t.status === 'approved').length;
  const notify = (t: string, level?: 'warn') => useStore.getState().notify(t, level);
  const design = async () => {
    setBusy(true);
    const r = await planBrain(ask);
    setBusy(false);
    if (!r?.ok) { notify(r?.error ?? 'JARVIS\'s runner is offline. Start it, then ask again.', 'warn'); return; }
    setAsk('');
    notify('JARVIS is researching and designing the brain. Its layout shows up here and in Approvals for your Yes.');
    void refresh();
  };
  const grow = async (id: string, name: string) => {
    const r = await evolveBrain(id);
    notify(r?.ok ? `JARVIS is researching how ${name} can grow. Its ideas wait for your Yes.` : r?.error ?? 'The runner did not answer.', r?.ok ? undefined : 'warn');
    void refresh();
  };
  const head = all[0];
  return (
    <>
      <div className="card span-5 brain-head-card">
        <h4><Brain size={13} /> JARVIS · head brain <span className="count">oversees {Math.max(0, all.length - 1)} brain{all.length === 2 ? '' : 's'}</span></h4>
        <p className="note">JARVIS sits in the middle. It designs a brain for each business or task, gives each of its agents the skills that fit, works every brain's approved tasks whichever brain is open, and once a day researches how one brain could grow. Every new brain, agent and skill waits for your Yes.</p>
        <p className="small">Skill library: {st?.degen ? `${st.degen.skills} skills from lyopz/degen-skill (read from ${st.degen.from === 'local' ? 'your PC' : 'GitHub'}), ${st.degen.given} handed out so far.` : 'lyopz/degen-skill, read when the runner is on.'}</p>
        <label className="look-for">
          <b>Build a brain</b>
          <span className="small muted">Say what the brain is for. JARVIS researches it and designs the layout: its agents, their skills, what to keep researching and the first tasks.</span>
          <textarea rows={3} maxLength={600} value={ask} placeholder='e.g. "a print-on-demand mug store for dog owners" or "find grants for my art"' onChange={(e) => setAsk(e.target.value)} />
        </label>
        <button className="btn sm primary" disabled={!live || busy || !ask.trim()} onClick={() => void design()}><Plus size={13} /> {busy ? 'Asking…' : 'Ask JARVIS to design it'}</button>
        {!live && <p className="small muted">Start JARVIS's runner to build brains.</p>}
      </div>
      <div className="card span-7">
        <BrainLayouts />
        <h4><GitBranch size={13} /> Brains <span className="count">{all.length}</span></h4>
        <div className="task-list">
          {all.map((b) => {
            const lib = b.open ? null : peekBrain(b.id);
            const moved = !!(b.open ? doc.plan?.fromVenture : lib?.doc.plan?.fromVenture);
            const note = info(b.id)?.lastNote;
            return <div key={b.id} className="task-row brain-row">
              <div className="t">
                <b>{b.name}{b.head ? ' · head brain' : ''}{b.open ? ' · open' : ''}</b>
                <span>{b.purpose || 'No purpose written yet.'}</span>
                <span className="small muted">{b.agents - 1 === 1 ? '1 agent' : `${Math.max(0, b.agents - 1)} agents`} besides JARVIS · {openTasks(b.id) === 1 ? '1 open task' : `${openTasks(b.id)} open tasks`}{info(b.id)?.evolvedAt ? ` · last researched ${when(info(b.id)!.evolvedAt!)}` : ''}</span>
                {note ? <span className="small">{note}</span> : null}
              </div>
              <span className="brain-row-actions">
                <LeadPicker brainId={b.id} lead={b.lead} />
                {!b.head && <button className="btn sm" disabled={!live} title="JARVIS researches how this brain could grow; its ideas wait for your Yes" onClick={() => void grow(b.id, b.name)}><FlaskConical size={12} /> Research growth</button>}
                {!b.open && <button className="btn sm" onClick={() => useStore.getState().switchBrain(b.id)}>Open</button>}
                {moved && !b.open && doc.head && <button className="btn sm" title="Put its agents back into the head brain" onClick={() => { if (useStore.getState().moveBrainBack(b.id)) notify(`Moved ${b.name} back into ${head.name}.`); }}><RotateCcw size={12} /> Move back</button>}
              </span>
            </div>;
          })}
        </div>
      </div>
    </>
  );
}
