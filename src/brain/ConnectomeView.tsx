import { useMemo } from 'react';
import { Activity, Network, Users } from 'lucide-react';
import { create } from 'zustand';
import { useStore } from '../store/store';
import { teamsOf } from './connectome';
import { AgentMenu } from './AgentMenu';
import BrainSwitcher from './BrainSwitcher';
import CreatorDesk from './CreatorDesk';
import BrainScene, { brainAgents } from './BrainScene';
import '../styles/brain.css';

/** Shared focus state for the brain, sector menu, and brain picker. */
export const useBrainFocus = create<{ teamId: string | null; agentId: string | null; selectedTeamId: string | null; brainAgentId: string | null }>(() => ({ teamId: null, agentId: null, selectedTeamId: null, brainAgentId: null }));

export default function ConnectomeView() {
  const agents = useStore((s) => s.doc.agents);
  const ideasCount = useStore((s) => Object.values(s.doc.library).filter((entry) => (entry.tags.includes('idea-review') || entry.tags.includes('idea')) && !entry.tags.some((t) => t.startsWith('grown:'))).length);
  const teams = useMemo(() => teamsOf({ agents }), [agents]);
  // counts cover the agents the brain shows: ORIGIN and its branches
  const shown = useMemo(() => brainAgents(agents), [agents]);
  const shownIds = useMemo(() => shown.map((a) => a.id), [shown]);
  // a specialist brain exists once ORIGIN's branches include a skill agent for that skill
  const specialists = useMemo(() => teamsOf({ agents: Object.fromEntries(shown.filter((a) => a.branch?.kind === 'skill').map((a) => [a.id, a])) }), [shown]);
  const running = useStore((s) => shownIds.filter((id) => ['working', 'researching', 'thinking', 'communicating'].includes(s.runtime.agents[id]?.status ?? '')).length);
  const total = shownIds.length;
  const activeTeamId = useBrainFocus((s) => s.selectedTeamId);
  const activeTeam = teams.find((team) => team.id === activeTeamId);

  return <div className="brain-workspace">
    <header className="brain-toolbar">
      <BrainSwitcher teams={specialists} agents={Object.fromEntries(shown.map((a) => [a.id, a]))} totalAgents={total}/>
      <div className="brain-title"><span className="brain-title-kicker">THE BRAIN <i/> LIVE SYSTEM</span><strong>{activeTeam ? `${activeTeam.name} Sector` : 'The Brain'}</strong><span>ORIGIN at the core. Every branch is one it grew.</span></div>
      <CreatorDesk />
    </header>
    <div className="brain-main">
      <AgentMenu />
      <section className="brain-stage-view" aria-label="Agent brain visualization">
        <div className="brain-stage-glow" aria-hidden="true"/>
        <div className="brain-hud brain-hud-top"><span><Network size={14}/> BRAIN MODEL <b>{total.toString().padStart(2, '0')} AGENTS</b></span><span>NERVES GROW FROM THE MAIN AGENT · {ideasCount} IDEAS</span></div>
        <BrainScene/>
        <div className="brain-hud brain-hud-bottom"><div><span className="brain-hud-icon"><Users size={15}/></span><span><b>{total} connected agent{total === 1 ? '' : 's'}</b><small>Click a glowing bud to grow an idea into a branch</small></span></div><div className="brain-hud-divider"/><div><span className="brain-hud-icon pulse-icon"><Activity size={15}/></span><span><b>{running} active now</b><small>Drag the brain to view it from every angle</small></span></div></div>
        {!total && <div className="brain-empty"><b>Your network starts here</b><span>Create a specialist to grow the first branch.</span></div>}
      </section>
    </div>
  </div>;
}




