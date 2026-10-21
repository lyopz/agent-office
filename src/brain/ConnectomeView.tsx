import { useMemo } from 'react';
import { Activity, Network, Users } from 'lucide-react';
import { create } from 'zustand';
import { useStore } from '../store/store';
import { teamsOf } from './connectome';
import { AgentMenu } from './AgentMenu';
import BrainSwitcher from './BrainSwitcher';
import CreatorDesk from './CreatorDesk';
import BrainScene from './BrainScene';
import '../styles/brain.css';

/** Shared focus state for the brain, sector menu, and brain picker. */
export const useBrainFocus = create<{ teamId: string | null; agentId: string | null; selectedTeamId: string | null; brainAgentId: string | null }>(() => ({ teamId: null, agentId: null, selectedTeamId: null, brainAgentId: null }));

export default function ConnectomeView() {
  const agents = useStore((s) => s.doc.agents);
  const departments = useStore((s) => s.doc.departments);
  const ideasCount = useStore((s) => Object.values(s.doc.library).filter((entry) => entry.tags.includes('idea-review')).length);
  const teams = useMemo(() => teamsOf({ agents, departments }), [agents, departments]);
  const running = useStore((s) => Object.values(s.runtime.agents).filter((agent) => ['working', 'researching', 'thinking', 'communicating'].includes(agent.status)).length);
  const total = Object.keys(agents).length;
  const activeTeamId = useBrainFocus((s) => s.selectedTeamId);
  const activeTeam = teams.find((team) => team.id === activeTeamId);

  return <div className="brain-workspace">
    <header className="brain-toolbar">
      <BrainSwitcher teams={teams} agents={agents} totalAgents={total}/>
      <div className="brain-title"><span className="brain-title-kicker">THE BRAIN <i/> LIVE SYSTEM</span><strong>{activeTeam ? `${activeTeam.name} Sector` : 'The Brain'}</strong><span>One connected workspace. Every specialist has a place in the network.</span></div>
      <CreatorDesk />
    </header>
    <div className="brain-main">
      <AgentMenu />
      <section className="brain-stage-view" aria-label="Agent brain visualization">
        <div className="brain-stage-glow" aria-hidden="true"/>
        <div className="brain-hud brain-hud-top"><span><Network size={14}/> BRAIN MODEL <b>{total.toString().padStart(2, '0')} AGENTS</b></span><span>NERVES GROW FROM THE MAIN AGENT · {ideasCount} IDEAS</span></div>
        <BrainScene/>
        <div className="brain-hud brain-hud-bottom"><div><span className="brain-hud-icon"><Users size={15}/></span><span><b>{total} connected agents</b><small>Every agent is a branch of the agent that made it</small></span></div><div className="brain-hud-divider"/><div><span className="brain-hud-icon pulse-icon"><Activity size={15}/></span><span><b>{running} active now</b><small>Drag the brain to view it from every angle</small></span></div></div>
        {!total && <div className="brain-empty"><b>Your network starts here</b><span>Create a specialist to grow the first branch.</span></div>}
      </section>
    </div>
  </div>;
}




