import { useEffect, useMemo, useRef, useState } from 'react';
import { BookOpen, Check, FileText, GitBranch, Library, Mic2, Plus, Search, ShieldCheck, Sparkles, Upload, X } from 'lucide-react';
import { useStore } from '../store/store';
import type { KnowledgeEntry, RunWindow } from '../model/types';
import { ORIGIN_ID, SKILL_LABELS, SKILL_TEAMS, VENTURE_TEAM, agentPrompt, branchAgentOps, describeWindow, growKind, isOpportunityOrigin, opportunityOriginOps, originOutdated, suggestedWindow } from './opportunity';
import SkillRequests from './SkillRequests';
import OriginRuns from './OriginRuns';
import SkillBank, { BankSkillPicker } from './SkillBank';
import { brainMap, syncOrigin } from './originLink';

type DeskTab = 'ideas' | 'agent' | 'requests' | 'runs' | 'bank' | 'tutorial';
const TABS: DeskTab[] = ['ideas', 'agent', 'requests', 'runs', 'bank', 'tutorial'];
const EVERY = [[15, 'every 15 min'], [30, 'every 30 min'], [60, 'every hour'], [120, 'every 2 hours'], [180, 'every 3 hours'], [300, 'every 5 hours'], [480, 'every 8 hours'], [720, 'every 12 hours'], [1440, 'once a day']] as const;

function saveTextFile(name: string, text: string) {
  const blob = new Blob([text], { type: 'text/markdown;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = name; a.click();
  URL.revokeObjectURL(url);
}

export default function CreatorDesk() {
  const doc = useStore((s) => s.doc);
  const library = doc.library;
  const leader = doc.agents.agent_origin ?? Object.values(doc.agents).find((a) => !a.skills.supervisorId) ?? null;
  const leaderId = leader?.id ?? null;
  const leaderName = leader?.identity.name ?? 'ORIGIN';
  const [tab, setTab] = useState<DeskTab | null>(null);
  const [ideaMine, setIdeaMine] = useState('');
  const [ideaFriend, setIdeaFriend] = useState('');
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
  // ORIGIN's rules come from the app: bring an older save up to date (new rules, the budget watch skill) once
  useEffect(() => {
    const d = useStore.getState().doc;
    if (isOpportunityOrigin(d) && originOutdated(d)) useStore.getState().commit(opportunityOriginOps(d), "Update ORIGIN's rules", { silent: true });
  }, []);
  // keep the live runner on ORIGIN's current rules, bank skills and branches
  const originPrompt = useMemo(() => (doc.agents[ORIGIN_ID] ? `${agentPrompt(doc, ORIGIN_ID)}\n${brainMap(doc)}` : ''), [doc]);
  useEffect(() => {
    if (!originPrompt) return;
    const t = setTimeout(() => void syncOrigin(useStore.getState().doc), 1500);
    return () => clearTimeout(t);
  }, [originPrompt]);
  const growFrom = parentId && doc.agents[parentId] ? parentId : leaderId;
  // only ORIGIN (starts ventures) and ventures (add skills) can grow branches
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

  const makeIdeaPacket = () => {
    if (!ideaMine.trim() || !ideaFriend.trim()) { setNotice('Add both ideas before preparing a comparison.'); return; }
    const id = () => `idea_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const makeEntry = (title: string, summary: string): KnowledgeEntry => ({ id: id(), title, summary, topic: 'market research', tags: ['idea-review', 'owner-submitted'], sources: [], createdAt: new Date().toISOString(), authorAgentId: leaderId, projectId: doc.projects['proj_firm_playbook'] ? 'proj_firm_playbook' : null, confidence: 0, verification: 'unverified', sensitive: false, allowedAgentIds: [] });
    const entries = [makeEntry('Owner idea for comparison', ideaMine.trim()), makeEntry('Friend idea for comparison', `${ideaFriend.trim()}${fileText ? `\n\nAttached file: ${fileName}\n${fileText}` : ''}`)];
    const result = useStore.getState().commit(entries.map((entry) => ({ op: 'library.upsert' as const, entry })), 'Attach ideas to Creator Brain');
    if (!result.ok) { setNotice(result.errors.join(' · ') || 'The ideas could not be attached.'); return; }
    const packet = `# Idea comparison research request\n\nPrepared ${new Date().toLocaleString()}\n\n## Ideas\n\n### My idea\n${ideaMine.trim()}\n\n### Friend's idea\n${ideaFriend.trim()}\n${fileText ? `\nAttached file: ${fileName}\n\n${fileText}\n` : ''}\n## Research required before ranking\n\n1. Find current, dated demand signals and audience evidence for each idea.\n2. Identify direct competitors and comparable products; cite URLs and dates.\n3. Separate popularity, downloads or concurrent users from verified revenue evidence.\n4. Map monetization options, platform fees, likely conversion assumptions and operating costs. Show ranges, formulas and uncertainty; do not promise earnings.\n5. Compare build effort, maintenance, legal/platform risks, acquisition channels and a low-cost first experiment.\n6. Assess genuine user value and retention: clear first-session payoff, progression, social loops, content cadence, performance and accessibility. Do not use fake users or manipulative retention.\n7. Finish with an evidence table, assumptions, confidence, source links, and a recommendation for the smallest cheap test.\n\n## Current state\n\nThe submitted ideas are attached to the local Creator Brain library as unverified owner-provided notes. This packet is a research brief, not a live market analysis. Connect a current web research provider before reporting findings or revenue estimates.\n`;
    saveTextFile('idea-comparison-research-request.md', packet);
    setNotice('Both ideas are attached to the brain. A research packet was downloaded; connect a live research provider before treating anything as market findings.');
  };

  const proposeAgent = () => {
    if (!agentName.trim() || !agentRole.trim() || !agentPurpose.trim()) { setNotice('Complete the agent name, role and purpose first.'); return; }
    if (!growFrom || !kind) { setNotice(`Only ${leaderName} can start a venture, and only a venture can add skill agents.`); return; }
    const parentName = doc.agents[growFrom]?.identity.name ?? leaderName;
    const { ops, error } = branchAgentOps(doc, growFrom, { id: `agent_custom_${Date.now().toString(36)}`, name: agentName.trim(), specialty: agentRole.trim(), purpose: agentPurpose.trim(), skill: team, window: window_, bankSkillIds: agentSkills });
    const result = error ? null : useStore.getState().commit(ops, `Approve ${kind}: ${agentName.trim()}`);
    if (!result?.ok) { setNotice(error ?? result?.errors.join(' · ') ?? 'The agent could not be added.'); return; }
    setNotice(`${agentName.trim()} now grows from ${parentName} as a new ${kind} branch${agentSkills.length ? ` with ${agentSkills.length} bank skill${agentSkills.length === 1 ? '' : 's'}` : ''}, planned to work ${describeWindow(window_)}. Only ${leaderName} runs live for now, so this window is a plan until its runner is added.`);
    setAgentName(''); setAgentRole(''); setAgentPurpose(''); setAgentSkills([]);
  };

  const setupOrigin = () => {
    const r = useStore.getState().commit(opportunityOriginOps(doc), 'Make ORIGIN the Opportunity Research & Builder Agent');
    setNotice(r.ok ? 'ORIGIN is now your Opportunity Research & Builder Agent. Its memory starts empty: no allowance, sources or schedule are approved yet.' : r.errors.join(' · '));
  };
  const pickTeam = (t: string) => { setAgentDept(t); if (window_.setBy === 'origin') setWindow(suggestedWindow(t)); };
  function pickParent(id: string | null) {
    setParentId(id);
    const k = growKind(useStore.getState().doc, id ?? leaderId ?? '');
    setWindow(suggestedWindow(k === 'venture' ? VENTURE_TEAM : agentDept));
  }

  const speak = () => {
    if (!('speechSynthesis' in window)) { setNotice('Voice output is not available in this browser.'); return; }
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(`I am ${leaderName}. I research the request, show evidence and costs, and prepare specialist agents for your approval. I will not claim a result until the work has actually run.`);
    utterance.pitch = 0.72; utterance.rate = 0.91; utterance.volume = 0.9;
    window.speechSynthesis.speak(utterance);
  };

  return (
    <div className="creator-desk" onPointerDown={(e) => e.stopPropagation()} onWheel={(e) => e.stopPropagation()}>
      <div className="creator-actions" aria-label="Agent Creator actions">
        <span className="creator-live"><i /> {leaderName} · OWNER-LED</span>
        <button className="creator-action" onClick={() => { setTab('ideas'); setNotice(''); }}><Plus size={14} /> Add idea <span className="creator-count">{pending}</span></button>
        <button className="creator-action" onClick={() => { setTab('agent'); pickParent(null); setNotice(''); }}><GitBranch size={14} /> Start a venture</button>
        <button className="creator-action" onClick={() => { setTab('runs'); setNotice(''); }}><Sparkles size={14} /> {leaderName} runs</button>
        <button className="creator-action" onClick={() => { setTab('bank'); setNotice(''); }}><Library size={14} /> Skill bank <span className="creator-count">{doc.skillBank.length}</span></button>
        <button className="creator-action" onClick={() => { setTab('requests'); setRequestFrom(null); setNotice(''); }}><Plus size={14} /> Skill requests <span className="creator-count">{openRequests}</span></button>
        {needsSetup && <button className="creator-action" onClick={setupOrigin} title="Give ORIGIN your Opportunity Research & Builder prompt and starting memory"><Sparkles size={14} /> {isOpportunityOrigin(doc) ? 'Update Opportunity agent rules' : 'Set up Opportunity agent'}</button>}
        <button className="creator-action creator-tutorial" onClick={() => { setTab('tutorial'); setNotice(''); }}><BookOpen size={14} /> Tutorial</button>
        <button className="creator-voice" onClick={speak} title={`Hear ${leaderName}'s low-pitched voice`}><Mic2 size={14} /> Hear {leaderName}</button>
      </div>

      {tab && <div className="creator-overlay" role="presentation" onMouseDown={(e) => { if (e.target === e.currentTarget) setTab(null); }}>
        <section className="creator-dialog" role="dialog" aria-modal="true" aria-labelledby="creator-title">
          <header className="creator-dialog-head">
            <div><span className="creator-kicker"><Sparkles size={13} /> AGENT CREATOR / {leaderName}</span><h2 id="creator-title">{tab === 'ideas' ? 'Compare two ideas' : tab === 'agent' ? (kind === 'skill' ? 'Add a skill to a venture' : 'Start a venture branch') : tab === 'requests' ? 'Skill requests' : tab === 'runs' ? `${leaderName}'s runs and budget` : tab === 'bank' ? 'Skill bank' : 'A quick tour'}</h2></div>
            <button className="creator-close" aria-label="Close dialog" onClick={() => setTab(null)}><X size={17} /></button>
          </header>

          {tab === 'ideas' && <div className="creator-body">
            <div className="creator-context"><ShieldCheck size={16} /><span><b>Evidence first.</b> This prepares a research request that requires current sources; the local prototype does not fetch live market data or forecast earnings.</span></div>
            <div className="creator-idea-grid">
              <label className="creator-field"><span>Your idea</span><textarea value={ideaMine} onChange={(e) => setIdeaMine(e.target.value)} placeholder="What are you considering building? Who is it for?" rows={5} /></label>
              <label className="creator-field"><span>Friend's idea</span><textarea value={ideaFriend} onChange={(e) => setIdeaFriend(e.target.value)} placeholder="Paste the idea or summarize the attached file." rows={5} /></label>
            </div>
            <input ref={inputRef} className="creator-file-input" type="file" accept=".txt,.md,.json,.csv,text/plain,text/markdown,application/json,text/csv" onChange={(e) => void attachFile(e.target.files?.[0])} />
            <div className="creator-upload-row"><button className="creator-upload" onClick={() => inputRef.current?.click()}><Upload size={15} /> Attach friend's idea</button><span>{fileName ? <><FileText size={13} /> {fileName}</> : 'TXT, MD, JSON or CSV · max 1 MB'}</span><button className="creator-upload-remove" disabled={!fileText} onClick={() => { setFileText(''); setFileName(''); }}>Remove</button></div>
            <p className="creator-privacy">Submitted notes are saved in this local office library so the brain can reference them later. Do not attach secrets or personal details.</p>
            <div className="creator-research-points"><span>Demand signals</span><span>Comparable games</span><span>Unit economics</span><span>Build cost</span><span>Retention quality</span></div>
            <p className="creator-privacy">When saved, each idea becomes its own small brain branch growing from the main brain.</p>
            <div className="creator-dialog-foot"><button className="creator-secondary" onClick={() => setTab(null)}>Cancel</button><button className="creator-primary" onClick={makeIdeaPacket}><Search size={15} /> Add ideas & prepare research brief</button></div>
          </div>}

          {tab === 'agent' && <div className="creator-body">
            <div className="creator-context"><ShieldCheck size={16} /><span>This builds the agent from your inputs and the bank skills you pick. {leaderName} can also propose agents from its runs; those wait for you in {leaderName} runs. Nothing is added until you choose <b>Approve & add agent</b>.</span></div>
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
              <label className="creator-field creator-wide"><span>{kind === 'venture' ? 'The opportunity: who pays, for what, and the cheap test' : `How does this skill help ${doc.agents[growFrom ?? '']?.identity.name ?? 'the venture'}?`}</span><textarea value={agentPurpose} onChange={(e) => setAgentPurpose(e.target.value)} placeholder="Define the user, inputs, work, outputs and how you'll judge quality." rows={4} /></label>
            </div>
            <div className="creator-blueprint"><span className="creator-kicker">BLUEPRINT PREVIEW</span><p><b>{kind === 'skill' ? 'Skill for' : 'Started by'}:</b> {doc.agents[growFrom ?? '']?.identity.name ?? leaderName} · <b>Works:</b> {describeWindow(window_)} ({window_.setBy === 'origin' ? `suggested by ${leaderName}: ${window_.reason}` : 'set by you'}) · <b>Skills:</b> {agentSkills.length ? agentSkills.map((id) => doc.skillBank.find((k) => k.id === id)?.name).filter(Boolean).join(', ') : 'none picked'}</p><p>Will use dated sources, expose assumptions, show costs and uncertainty, and request approval before external actions.</p></div>
            <div className="creator-dialog-foot"><button className="creator-secondary" onClick={() => setTab(null)}>Cancel</button><button className="creator-primary" onClick={proposeAgent}><Check size={15} /> Approve & add agent</button></div>
          </div>}

          {tab === 'runs' && <OriginRuns onNotice={setNotice} />}
          {tab === 'bank' && <SkillBank onNotice={setNotice} />}
          {tab === 'requests' && <SkillRequests fromId={requestFrom} onNotice={setNotice} />}

          {tab === 'tutorial' && <div className="creator-body">
            <ol className="creator-steps">
              <li><b>Start with {leaderName}.</b><span>Use Compare ideas to save your idea and your friend's idea into the brain's local knowledge library.</span></li>
              <li><b>Attach context.</b><span>Upload a plain text, Markdown, JSON or CSV idea file. The app keeps its contents in the local office save.</span></li>
              <li><b>Review evidence before money decisions.</b><span>Download the research packet and connect a live research provider to gather current sources. The current prototype does not look up the market yet.</span></li>
              <li><b>Approve specialists deliberately.</b><span>{leaderName} starts each venture as a branch; a venture adds only the skill agents it needs, inspect its purpose and approval boundaries, then approve adding its local blueprint to the brain.</span></li>
              <li><b>Share actual work safely.</b><span>Voice playback is generated by your browser. Workspaces and agents are local here; team access, live model research and shared mobile task intake need backend integrations.</span></li>
            </ol>
            <div className="creator-dialog-foot"><button className="creator-primary" onClick={() => setTab(null)}>Got it</button></div>
          </div>}
          {notice && <div className="creator-notice" role="status">{notice}</div>}
        </section>
      </div>}
    </div>
  );
}
