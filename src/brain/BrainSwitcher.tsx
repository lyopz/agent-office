import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { Brain, ChevronDown, Command, Plus, X } from 'lucide-react';
import { useBrainFocus } from './ConnectomeView';
import type { Team } from './connectome';
import type { Agent } from '../model/types';

const REFERENCES = [
  { id: 'amazon', mark: 'amazon', note: 'Discovery · trust · repeat purchase', className: 'brand-amazon' },
  { id: 'etsy', mark: 'etsy', note: 'Independent sellers · curation', className: 'brand-etsy' },
  { id: 'roblox', mark: 'ROBLOX', note: 'Creator economy · social play', className: 'brand-roblox' },
];

export default function BrainSwitcher({ teams, agents, totalAgents }: { teams: Team[]; agents: Record<string, Agent>; totalAgents: number }) {
  const selectedTeamId = useBrainFocus((s) => s.selectedTeamId);
  const selectedAgentId = useBrainFocus((s) => s.brainAgentId);
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const active = teams.find((team) => team.id === selectedTeamId);
  const activeAgent = selectedAgentId ? agents[selectedAgentId] : null;
  const select = (teamId: string | null) => {
    useBrainFocus.setState({ teamId, agentId: null, selectedTeamId: teamId, brainAgentId: null });
    setOpen(false);
  };
  const selectAgent = (agent: Agent) => {
    const team = teams.find((item) => item.agentIds.includes(agent.id));
    useBrainFocus.setState({ teamId: team?.id ?? null, agentId: null, selectedTeamId: team?.id ?? null, brainAgentId: agent.id });
    setOpen(false);
  };

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false); };
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false); };
    document.addEventListener('pointerdown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('pointerdown', onPointer); document.removeEventListener('keydown', onKey); };
  }, [open]);

  return (
    <div className="brain-switcher" ref={root} onPointerDown={(event) => event.stopPropagation()} onPointerUp={(event) => event.stopPropagation()}>
      <button className="brain-switch-trigger" aria-expanded={open} aria-haspopup="dialog" aria-controls="brain-switch-popover" onClick={() => setOpen((value) => !value)}>
        <span className="brain-switch-icon"><Brain size={17} /></span>
        <span className="brain-switch-copy"><span className="brain-switch-kicker">NEURAL NETWORK</span><b>{activeAgent ? `${activeAgent.identity.name} Brain` : active ? `${active.name} Brain` : 'Main Brain'}</b></span>
        {(() => { const n = activeAgent ? Object.values(agents).filter((agent) => agent.skills.supervisorId === activeAgent.id).length : active ? active.agentIds.length : totalAgents; return <span className="brain-switch-count">{n}<small> agent{n === 1 ? '' : 's'}</small></span>; })()}
        <ChevronDown className={open ? 'brain-chevron is-open' : 'brain-chevron'} size={15} />
      </button>

      {open && <section className="brain-switch-popover" id="brain-switch-popover" role="dialog" aria-label="Choose an agent brain" onWheel={(event) => event.stopPropagation()}>
        <header className="brain-switch-head"><span><Command size={13} /> WORKSPACE BRAINS</span><button aria-label="Close brain menu" onClick={() => setOpen(false)}><X size={14} /></button></header>
        <button className={`brain-choice main-choice${!active && !activeAgent ? ' is-selected' : ''}`} onClick={() => select(null)}>
          <span className="brain-choice-mark root-mark"><Brain size={16} /></span><span className="brain-choice-copy"><b>Main Brain</b><small>Orchestrates every specialist sector</small></span><span className="brain-choice-count">{totalAgents}</span>
        </button>
        <div className="brain-switch-label">SPECIALIST BRAINS <span>{teams.length}</span></div>
        <div className="brain-choice-list">{teams.map((team) => <button key={team.id} className={`brain-choice${active?.id === team.id && !activeAgent ? ' is-selected' : ''}`} onClick={() => select(team.id)}>
          <span className="brain-choice-mark" style={{ '--brain-color': team.color } as CSSProperties & { '--brain-color': string }}><i /></span><span className="brain-choice-copy"><b>{team.name} Brain</b><small>Branch of Main Brain</small></span><span className="brain-choice-count">{team.agentIds.length}</span>
        </button>)}</div>
        <div className="brain-switch-label">AGENT BRAINS <span>{totalAgents}</span></div>
        <div className="brain-choice-list agent-brain-list">{Object.values(agents).sort((a, b) => a.identity.name.localeCompare(b.identity.name)).map((agent) => {
          const team = teams.find((item) => item.agentIds.includes(agent.id));
          const reports = Object.values(agents).filter((child) => child.skills.supervisorId === agent.id).length;
          return <button key={agent.id} className={`brain-choice${selectedAgentId === agent.id ? ' is-selected' : ''}`} onClick={() => selectAgent(agent)}>
            <span className="brain-choice-mark" style={{ '--brain-color': team?.color ?? '#ff354f' } as CSSProperties & { '--brain-color': string }}><i /></span>
            <span className="brain-choice-copy"><b>{agent.identity.name} Brain</b><small>{reports ? `${reports} direct reports` : agent.identity.title} · ${team?.name ?? 'Unassigned'}</small></span>
            <span className="brain-agent-status" data-enabled={agent.enabled}>{agent.enabled ? 'ENABLED' : 'PAUSED'}</span>
          </button>;
        })}</div>
        <div className="brain-reference-block">
          <div className="brain-switch-label">MARKET REFERENCE POINTS <span>IDEAS</span></div>
          <p>Use proven patterns as research prompts. These are examples, not connected services.</p>
          <div className="brain-reference-list">{REFERENCES.map((reference) => <div className="brain-reference" key={reference.id}>
            <span className={`brain-reference-mark ${reference.className}`} role="img" aria-label={`${reference.mark} brand reference`}>{reference.id === 'roblox' && <i aria-hidden>◇</i>}{reference.mark}{reference.id === 'amazon' && <i aria-hidden />}</span>
            <span>{reference.note}</span>
          </div>)}</div>
        </div>
        <button className="brain-create-button" onClick={() => { setOpen(false); window.dispatchEvent(new CustomEvent('agent-office:open-creator', { detail: { tab: 'agent' } })); }}><Plus size={14} /> Create a specialist brain</button>
      </section>}
    </div>
  );
}
