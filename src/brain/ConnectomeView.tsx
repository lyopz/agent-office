import { useMemo, useState } from 'react';
import { ChevronDown, ChevronUp, Users } from 'lucide-react';
import { create } from 'zustand';
import { useStore } from '../store/store';
import { teamsOf } from './connectome';
import { AgentMenu } from './AgentMenu';
import BrainSwitcher from './BrainSwitcher';
import CreatorDesk from './CreatorDesk';
import BrainScene, { brainAgents } from './BrainScene';
import { JarvisCard, TaskTrack } from './JarvisCard';
import '../styles/brain.css';

/** Shared focus state for the brain, sector menu, and brain picker. */
export const useBrainFocus = create<{ teamId: string | null; agentId: string | null; selectedTeamId: string | null; brainAgentId: string | null }>(() => ({ teamId: null, agentId: null, selectedTeamId: null, brainAgentId: null }));

export default function ConnectomeView() {
  const agents = useStore((s) => s.doc.agents);
  const ideasCount = useStore((s) => Object.values(s.doc.library).filter((entry) => (entry.tags.includes('idea-review') || entry.tags.includes('idea')) && !entry.tags.some((t) => t.startsWith('grown:'))).length);
  const teams = useMemo(() => teamsOf({ agents }), [agents]);
  // counts cover the agents the brain shows: JARVIS and its branches
  const shown = useMemo(() => brainAgents(agents), [agents]);
  const shownIds = useMemo(() => shown.map((a) => a.id), [shown]);
  // a specialist brain exists once JARVIS's branches include a skill agent for that skill
  const specialists = useMemo(() => teamsOf({ agents: Object.fromEntries(shown.filter((a) => a.branch?.kind === 'skill').map((a) => [a.id, a])) }), [shown]);
  const running = useStore((s) => shownIds.filter((id) => ['working', 'researching', 'thinking', 'communicating'].includes(s.runtime.agents[id]?.status ?? '')).length);
  const total = shownIds.length;
  const activeTeamId = useBrainFocus((s) => s.selectedTeamId);
  const activeTeam = teams.find((team) => team.id === activeTeamId);

  const dots = useMemo(() => shown.map((a) => teams.find((t) => t.agentIds.includes(a.id))?.color ?? '#5fb8ff'), [shown, teams]);
  const [menuOpen, setMenuOpen] = useState(() => { try { return localStorage.getItem('brain:menu-open') === '1'; } catch { return false; } });
  const toggleMenu = () => setMenuOpen((o) => { try { localStorage.setItem('brain:menu-open', o ? '0' : '1'); } catch { /* private window */ } return !o; });

  return <div className="brain-workspace">
    <section className="brain-stage-view" aria-label="Agent brain visualization">
      <BrainScene/>
      {!total && <div className="brain-empty"><b>Your network starts here</b><span>Create a specialist to grow the first branch.</span></div>}
    </section>
    <div className="brain-float brain-float-left">
      <BrainSwitcher teams={specialists} agents={Object.fromEntries(shown.map((a) => [a.id, a]))} totalAgents={total} running={running} dots={dots}/>
      <button className="brain-menu-toggle" aria-expanded={menuOpen} onClick={toggleMenu}><Users size={14}/> Branches, ideas and tasks {menuOpen ? <ChevronUp size={14}/> : <ChevronDown size={14}/>}</button>
      {menuOpen && <AgentMenu />}
    </div>
    <div className="brain-float brain-float-top" title={`${activeTeam ? `${activeTeam.name} Sector` : 'The Brain'}: JARVIS at the core. Every branch is one it grew. ${ideasCount} ideas.`}>
      <CreatorDesk />
    </div>
    <div className="brain-float brain-float-right"><JarvisCard /></div>
    <div className="brain-float brain-float-bottom"><TaskTrack /></div>
  </div>;
}




