import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, FileText, GitBranch, Library, Mic2, Plus, ShieldCheck, Sparkles, Upload, X } from 'lucide-react';
import { useStore } from '../store/store';
import type { RunWindow } from '../model/types';
import { ORIGIN_ID, SKILL_LABELS, SKILL_TEAMS, VENTURE_TEAM, agentPrompt, branchAgentOps, describeWindow, growKind, isOpportunityOrigin, opportunityOriginOps, originOutdated, suggestedWindow } from './opportunity';
import SkillRequests from './SkillRequests';
import OriginRuns from './OriginRuns';
import SkillBank, { BankSkillPicker } from './SkillBank';
import { brainMap, syncOrigin, taskAction } from './originLink';
import { growIdeaOps, ownerIdeaOps } from './ideas';
import { ownSkillFileOps, useSkillFiles } from './skillFiles';
import { SkillFileDrop, type OwnSkillFile } from './SkillFileDrop';
import { useOrigin } from './useOrigin';
import { say } from '../ui/voice';

type DeskTab = 'ideas' | 'agent' | 'requests' | 'runs' | 'bank';
const TABS: DeskTab[] = ['ideas', 'agent', 'requests', 'runs', 'bank'];
const EVERY = [[15, 'every 15 min'], [30, 'every 30 min'], [60, 'every hour'], [120, 'every 2 hours'], [180, 'every 3 hours'], [300, 'every 5 hours'], [480, 'every 8 hours'], [720, 'every 12 hours'], [1440, 'once a day']] as const;

// Add idea in the bottom dock opens the desk from any page: the tab waits here until the desk is mounted.
let pendingTab: DeskTab | null = null;
const DESK_EVENT = 'brain:open-desk';
export function openDesk(tab: DeskTab) { pendingTab = tab; window.dispatchEvent(new Event(DESK_EVENT)); }

export default function CreatorDesk() {
  const doc = useStore((s) => s.doc);
  const library = doc.library;
  const leader = doc.agents.agent_origin ?? Object.values(doc.agents).find((a) => !a.skills.supervisorId) ?? null;
  const leaderId = leader?.id ?? null;
  const leaderName = leader?.identity.name ?? 'JARVIS';
  const [tab, setTab] = useState<DeskTab | null>(null);
  useEffect(() => {
    const take = () => { if (pendingTab) { setTab(pendingTab); pendingTab = null; } };
    take();
    window.addEventListener(DESK_EVENT, take);
    return () => window.removeEventListener(DESK_EVENT, take);
  }, []);
  const [idea, setIdea] = useState('');
  const [fileName, setFileName] = useState('');
  const [fileText, setFileText] = useState('');
  const [notice, setNotice] = useState('');
  const [agentName, setAgentName] = useState('');
  const [agentRole, setAgentRole] = useState('');
  const [agentDept, setAgentDept] = useState('Research');
  const [agentPurpose, setAgentPurpose] = useState('');
  const [parentId, setParentId] = useState<string | null>(null);
  const [requestFrom, setRequestFrom] = useState<string | null>(null);
  const openRequests = doc.skillRequests.filter((r) => r.status === 'venture-review' || r.status === 'owner-review').length;
  const [window_, setWindow] = useState<RunWindow>(suggestedWindow('Research'));
  const [agentSkills, setAgentSkills] = useState<string[]>([]);
  // the owner's own SKILL.md for the new agent; without one, JARVIS writes it as soon as the agent exists
  const [ownFile, setOwnFile] = useState<OwnSkillFile | null>(null);
  useSkillFiles();
  // what waits for the owner in JARVIS runs, shown on its button since notifications are off
  const runner = useOrigin((st) => st.status);
  const waiting = (runner?.tasks.filter((t) => t.status === 'proposed').length ?? 0) + (runner?.agentProposals?.filter((p) => p.status === 'proposed' && !runner.autoAgents).length ?? 0);
  // JARVIS's rules come from the app: bring an older save up to date (new rules, the budget watch skill) once
  useEffect(() => {
    const d = useStore.getState().doc;
    if (isOpportunityOrigin(d) && originOutdated(d)) useStore.getState().commit(opportunityOriginOps(d), "Update JARVIS's rules", { silent: true });
  }, []);
  // keep the live runner on JARVIS's current rules, bank skills and branches
  const originPrompt = useMemo(() => (doc.agents[ORIGIN_ID] ? [agentPrompt(doc, ORIGIN_ID), brainMap(doc), ...Object.keys(doc.agents).map((id) => agentPrompt(doc, id))].join('\n') : ''), [doc]);
  useEffect(() => {
    if (!originPrompt) return;
    const t = setTimeout(() => void syncOrigin(useStore.getState().doc), 1500);
    return () => clearTimeout(t);
  }, [originPrompt]);
  const growFrom = parentId && doc.agents[parentId] ? parentId : leaderId;
  // only JARVIS (starts ventures) and ventures (add skills) can grow branches
  const parents = useMemo(() => Object.values(doc.agents).filter((a) => growKind(doc, a.id)).sort((a, b) => (a.id === leaderId ? -1 : b.id === leaderId ? 1 : a.identity.name.localeCompare(b.identity.name))), [doc, leaderId]);
  const kind = growFrom ? growKind(doc, growFrom) : null;
  const team = kind === 'venture' ? VENTURE_TEAM : agentDept;
  const needsSetup = !!doc.agents.agent_origin && (!isOpportunityOrigin(doc) || originOutdated(doc));
  const inputRef = useRef<HTMLInputElement>(null);
  const pending = useMemo(() => Object.values(library).filter((item) => item.tags.includes('idea-review')).length, [library]);

  useEffect(() => {
    const onOpen = (event: Event) => {
      const detail = (event as CustomEvent<{ tab?: DeskTab; parentId?: string; fromId?: string }>).detail;
      const requested = detail?.tab;
      if (!requested || !TABS.includes(requested)) return;
      setNotice(''); setTab(requested); pickParent(detail?.parentId ?? null); setRequestFrom(detail?.fromId ?? null);
    };
    window.addEventListener('agent-office:open-creator', onOpen);
    return () => window.removeEventListener('agent-office:open-creator', onOpen);
  }, []);

  useEffect(() => {
    if (!tab) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setTab(null); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [tab]);

  const attachFile = async (file?: File) => {
    if (!file) return;
    if (file.size > 1_000_000) { setNotice('Choose a file under 1 MB.'); return; }
    if (!/\.(txt|md|json|csv)$/i.test(file.name)) { setNotice('Use a .txt, .md, .json or .csv file.'); return; }
    try {
      const content = await file.text();
      setFileName(file.name); setFileText(content.slice(0, 12_000));
      setNotice(content.length > 12_000 ? 'Attached. The first 12,000 characters will be saved.' : 'Idea file attached.');
    } catch { setNotice('I could not read that file. Try a plain text, Markdown, JSON or CSV file.'); }
  };

  // One idea in, one venture out: JARVIS grows it into a venture at once, then picks the agents it needs; every one of them gets its own SKILL.md
  const submitIdea = async () => {
    const text = `${idea.trim()}${fileText ? `\n\nAttached file: ${fileName}\n${fileText}` : ''}`.trim();
    if (!text) { setNotice('Type your idea first.'); return; }
    const d = useStore.getState().doc;
    const rootId = d.agents[ORIGIN_ID] ? ORIGIN_ID : leaderId;
    if (!rootId) { setNotice('There is no main agent to give the idea to.'); return; }
    const [saveIdea] = ownerIdeaOps(text, rootId);
    if (saveIdea.op !== 'library.upsert') return;
    const { agentId, name, ops } = growIdeaOps(d, saveIdea.entry, rootId);
    const r = useStore.getState().commit([saveIdea, ...ops], `Idea: ${saveIdea.entry.title}`);
    if (!r.ok) { setNotice(r.errors.join(' · ') || 'The idea could not be added.'); return; }
    setIdea(''); setFileText(''); setFileName('');
    await syncOrigin(useStore.getState().doc);
    const t = await taskAction({ action: 'add', agentId, title: `Build the team for ${name}`, detail: `The owner just gave this idea:\n${text.slice(0, 3000)}\n\nWork as ${name} (venture id ${agentId}). Decide which skill agents this idea needs to make money, usually 3 to 6 (for example product research, design, listing copy and SEO, pricing, marketing), and create them now in proposedAgents with parentId "${agentId}", each with a clear two or three sentence purpose. Each gets its own detailed SKILL.md in the next runs. Then record the first research steps in your notes and report progress.` });
    setNotice(t ? `${name} is now a venture of ${leaderName}. ${leaderName} picks the agents it needs in its next run and writes a SKILL.md for each one. Press Run 10 min in ${leaderName} runs to start now.` : `${name} is now a venture. Start ${leaderName}'s runner (npm.cmd run origin) so it can pick the agents and write their SKILL.md files.`);
  };

  const proposeAgent = () => {
    if (!agentName.trim() || !agentRole.trim() || !agentPurpose.trim()) { setNotice('Complete the agent name, role and purpose first.'); return; }
    if (!growFrom || !kind) { setNotice(`Only ${leaderName} can start a venture, and only a venture can add skill agents.`); return; }
    const parentName = doc.agents[growFrom]?.identity.name ?? leaderName;
    const newId = `agent_custom_${Date.now().toString(36)}`;
    const { ops, error } = branchAgentOps(doc, growFrom, { id: newId, name: agentName.trim(), specialty: agentRole.trim(), purpose: agentPurpose.trim(), skill: team, window: window_, bankSkillIds: agentSkills });
    const own = ownFile ? ownSkillFileOps(doc, newId, agentName.trim(), ownFile, agentSkills) : [];
    const result = error ? null : useStore.getState().commit([...ops, ...own], `Approve ${kind}: ${agentName.trim()}`);
    if (!result?.ok) { setNotice(error ?? result?.errors.join(' · ') ?? 'The agent could not be added.'); return; }
    setNotice(`${agentName.trim()} now grows from ${parentName} as a new ${kind} branch${agentSkills.length ? ` with ${agentSkills.length} bank skill${agentSkills.length === 1 ? '' : 's'}` : ''}, planned to work ${describeWindow(window_)}. ${ownFile ? `Your ${ownFile.fileName} is its SKILL.md.` : `${leaderName} is writing its SKILL.md now.`}`);
    setAgentName(''); setAgentRole(''); setAgentPurpose(''); setAgentSkills([]); setOwnFile(null);
  };

  const setupOrigin = () => {
    const r = useStore.getState().commit(opportunityOriginOps(doc), 'Make JARVIS the Opportunity Research & Builder Agent');
    setNotice(r.ok ? 'JARVIS is now your Opportunity Research & Builder Agent. Its memory starts empty: no allowance, sources or schedule are approved yet.' : r.errors.join(' · '));
  };
  const pickTeam = (t: string) => { setAgentDept(t); if (window_.setBy === 'origin') setWindow(suggestedWindow(t)); };
  function pickParent(id: string | null) {
    setParentId(id);
    const k = growKind(useStore.getState().doc, id ?? leaderId ?? '');
    setWindow(suggestedWindow(k === 'venture' ? VENTURE_TEAM : agentDept));
  }

  const speak = () => {
    if (!('speechSynthesis' in window)) { setNotice('Voice output is not available here.'); return; }
    say(`I am ${leaderName}. Speak to me with the mic in the command center, or type there. I research, grow your ventures and their agents, and ask you before using your accounts or spending.`);
  };

  return (
    <div className="creator-desk" onPointerDown={(e) => e.stopPropagation()} onWheel={(e) => e.stopPropagation()}>
      <div className="creator-actions" aria-label="Agent Creator actions">
        <span className="creator-live"><i /> {leaderName} · OWNER-LED</span>
        <button className="creator-action" onClick={() => { setTab('ideas'); setNotice(''); }}><Plus size={14} /> Add idea <span className="creator-count">{pending}</span></button>
        <button className="creator-action" title="Start a venture" onClick={() => { setTab('agent'); pickParent(null); setNotice(''); }}><GitBranch size={14} /> Start a venture</button>
        <button className="creator-action" title={`${leaderName} runs`} onClick={() => { setTab('runs'); setNotice(''); }}><Sparkles size={14} /> {leaderName} runs {waiting > 0 && <span className="creator-count" title="Waiting for your approval">{waiting}</span>}</button>
        <button className="creator-action" title="Skill bank" onClick={() => { setTab('bank'); setNotice(''); }}><Library size={14} /> Skill bank <span className="creator-count">{doc.skillBank.length}</span></button>
        <button className="creator-action" title="Skill requests" onClick={() => { setTab('requests'); setRequestFrom(null); setNotice(''); }}><Plus size={14} /> Skill requests <span className="creator-count">{openRequests}</span></button>
        {needsSetup && <button className="creator-action" onClick={setupOrigin} title="Give JARVIS your Opportunity Research & Builder prompt and starting memory"><Sparkles size={14} /> {isOpportunityOrigin(doc) ? 'Update Opportunity agent rules' : 'Set up Opportunity agent'}</button>}
        <button className="creator-voice" onClick={speak} title={`Hear ${leaderName}'s low-pitched voice`}><Mic2 size={14} /> Hear {leaderName}</button>
      </div>

      {tab && <div className="creator-overlay" role="presentation" onMouseDown={(e) => { if (e.target === e.currentTarget) setTab(null); }}>
        <section className="creator-dialog" role="dialog" aria-modal="true" aria-labelledby="creator-title">
          <header className="creator-dialog-head">
            <div><span className="creator-kicker"><Sparkles size={13} /> AGENT CREATOR / {leaderName}</span><h2 id="creator-title">{tab === 'ideas' ? 'Add an idea' : tab === 'agent' ? (kind === 'skill' ? 'Add a skill to a venture' : 'Start a venture branch') : tab === 'requests' ? 'Skill requests' : tab === 'runs' ? `${leaderName}'s runs and budget` : 'Skill bank'}</h2></div>
            <button className="creator-close" aria-label="Close dialog" onClick={() => setTab(null)}><X size={17} /></button>
          </header>

          {tab === 'ideas' && <div className="creator-body">
            <label className="creator-field"><span>Your idea</span><textarea value={idea} onChange={(e) => setIdea(e.target.value)} placeholder="e.g. An Etsy store selling custom pet portraits" rows={6} /></label>
            <input ref={inputRef} className="creator-file-input" type="file" accept=".txt,.md,.json,.csv,text/plain,text/markdown,application/json,text/csv" onChange={(e) => void attachFile(e.target.files?.[0])} />
            <div className="creator-upload-row"><button className="creator-upload" onClick={() => inputRef.current?.click()}><Upload size={15} /> Attach a file</button><span>{fileName ? <><FileText size={13} /> {fileName}</> : 'Optional · TXT, MD, JSON or CSV · max 1 MB'}</span><button className="creator-upload-remove" disabled={!fileText} onClick={() => { setFileText(''); setFileName(''); }}>Remove</button></div>
            <p className="creator-privacy">{leaderName} turns the idea into a venture branch right away, decides which agents it needs, creates them, and writes a detailed SKILL.md for each one. All of it stays inside your monthly cap.</p>
            <div className="creator-dialog-foot"><button className="creator-secondary" onClick={() => setTab(null)}>Cancel</button><button className="creator-primary" disabled={!idea.trim() && !fileText} onClick={() => void submitIdea()}><Sparkles size={15} /> Give {leaderName} this idea</button></div>
          </div>}

          {tab === 'agent' && <div className="creator-body">
            <div className="creator-context"><ShieldCheck size={16} /><span>This builds the agent from your inputs and the bank skills you pick. {leaderName} and its ventures also create the agents they need in their runs (you can switch that to ask-first in {leaderName} runs).</span></div>
            <div className="creator-agent-grid">
              <label className="creator-field"><span>Agent name</span><input value={agentName} onChange={(e) => setAgentName(e.target.value)} placeholder="e.g. SIGNAL" /></label>
              <label className="creator-field"><span>{kind === 'venture' ? 'Venture' : 'Specialty'}</span><input value={agentRole} onChange={(e) => setAgentRole(e.target.value)} placeholder={kind === 'venture' ? 'e.g. Roblox development' : 'e.g. Roblox map modeller'} /></label>
              <label className="creator-field"><span>Grows from</span><select value={growFrom ?? ''} onChange={(e) => pickParent(e.target.value)}>{parents.map((a) => <option key={a.id} value={a.id}>{a.id === leaderId ? `${a.identity.name}: start a new venture` : `${a.identity.name}: add a skill to this venture`}</option>)}</select></label>
              {kind === 'skill'
                ? <label className="creator-field"><span>Skill</span><select value={agentDept} onChange={(e) => pickTeam(e.target.value)}>{SKILL_TEAMS.map((d) => <option key={d} value={d}>{SKILL_LABELS[d] ?? d}</option>)}</select></label>
                : <div className="creator-field"><span>Team</span><input readOnly value="Ventures" /></div>}
              <label className="creator-field"><span>Works</span><span className="creator-window">
                <input type="number" min={1} max={60} value={window_.maxMinutes} aria-label="Minutes per run" onChange={(e) => setWindow({ ...window_, maxMinutes: Math.max(1, Math.min(60, Number(e.target.value) || 1)), setBy: 'owner', reason: 'Set by the owner.' })} /> min
                <select value={window_.everyMinutes} aria-label="How often" onChange={(e) => setWindow({ ...window_, everyMinutes: Number(e.target.value), setBy: 'owner', reason: 'Set by the owner.' })}>{EVERY.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
              </span></label>
              <div className="creator-field"><span>Branch rule</span><p className="creator-rule">{kind === 'skill' ? `Works only for ${doc.agents[growFrom ?? '']?.identity.name ?? 'this venture'}. It can't add agents or start another business.` : `Only ${leaderName} starts ventures. A venture can add only the skills it needs.`}</p></div>
              <div className="creator-field creator-wide"><span>Skills from the bank</span><BankSkillPicker value={agentSkills} onChange={setAgentSkills} /></div>
              <div className="creator-field creator-wide"><span>Its SKILL.md: attach your own, or {leaderName} writes one as soon as the agent is added</span><SkillFileDrop value={ownFile} onChange={setOwnFile} /></div>
              <label className="creator-field creator-wide"><span>{kind === 'venture' ? 'The opportunity: who pays, for what, and the cheap test' : `How does this skill help ${doc.agents[growFrom ?? '']?.identity.name ?? 'the venture'}?`}</span><textarea value={agentPurpose} onChange={(e) => setAgentPurpose(e.target.value)} placeholder="Define the user, inputs, work, outputs and how you'll judge quality." rows={4} /></label>
            </div>
            <div className="creator-blueprint"><span className="creator-kicker">BLUEPRINT PREVIEW</span><p><b>{kind === 'skill' ? 'Skill for' : 'Started by'}:</b> {doc.agents[growFrom ?? '']?.identity.name ?? leaderName} · <b>Works:</b> {describeWindow(window_)} ({window_.setBy === 'origin' ? `suggested by ${leaderName}: ${window_.reason}` : 'set by you'}) · <b>Skills:</b> {agentSkills.length ? agentSkills.map((id) => doc.skillBank.find((k) => k.id === id)?.name).filter(Boolean).join(', ') : 'none picked'}</p><p>Will use dated sources, expose assumptions, show costs and uncertainty, and request approval before external actions.</p></div>
            <div className="creator-dialog-foot"><button className="creator-secondary" onClick={() => setTab(null)}>Cancel</button><button className="creator-primary" onClick={proposeAgent}><Check size={15} /> Approve & add agent</button></div>
          </div>}

          {tab === 'runs' && <OriginRuns onNotice={setNotice} />}
          {tab === 'bank' && <SkillBank onNotice={setNotice} />}
          {tab === 'requests' && <SkillRequests fromId={requestFrom} onNotice={setNotice} />}

          {notice && <div className="creator-notice" role="status">{notice}</div>}
        </section>
      </div>}
    </div>
  );
}
