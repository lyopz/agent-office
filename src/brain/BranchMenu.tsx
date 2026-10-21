// The Branches menu: the agent tree the brain runs on, as a menu. The main
// agent is at the top, every agent it made is a branch under it, and agents
// those agents made nest inside their branch. Hovering a branch shows its
// agents in the brain; clicking a name focuses that branch, and the arrow
// opens the agent's profile.
import { useMemo, useState, type CSSProperties } from 'react';
import { ChevronRight, UserRound } from 'lucide-react';
import { useStore } from '../store/store';
import type { Agent, AgentStatus } from '../model/types';
import { STATUS_COLOR } from '../viewport/AgentsLayer';
import type { Team } from './connectome';
import { useBrainFocus } from './ConnectomeView';
import { treeOf } from './BrainScene';
import { subtree, type NerveTree } from './nerveTree';

const BUSY: AgentStatus[] = ['working', 'researching', 'thinking', 'communicating'];

interface Props {
  agents: Record<string, Agent>;
  teams: Team[];
  /** `status|task|progress|queued` per agent, as the agent menu keeps it. */
  live: Record<string, string>;
  match: (id: string) => boolean;
  selected: string | null;
}

export function BranchMenu({ agents, teams, live, match, selected }: Props) {
  const tree = useMemo<NerveTree>(() => treeOf(agents, teams), [agents, teams]);
  const focusId = useBrainFocus((s) => s.brainAgentId);
  const [closed, setClosed] = useState<Record<string, boolean>>({});
  if (!tree.rootId) return <p className="muted small am-none">No agents yet. Create one to start the first branch.</p>;

  const busyIn = (id: string) => [...subtree(tree, id)].filter((q) => BUSY.includes((live[q] ?? '').split('|')[0] as AgentStatus)).length;
  const shows = (id: string): boolean => match(id) || tree.nodes[id].childIds.some(shows);
  const hover = (id: string | null) => useBrainFocus.setState({ agentId: id });
  const focus = (id: string) => useBrainFocus.setState({ brainAgentId: focusId === id ? null : id, agentId: null, teamId: null, selectedTeamId: null });
  const open = (id: string) => useStore.getState().setUi({ selection: { kind: 'agent', id }, profileAgentId: id, profileTab: 'identity' });

  const row = (id: string): JSX.Element | null => {
    if (!shows(id)) return null;
    const n = tree.nodes[id], a = agents[id];
    const kids = n.childIds.filter(shows);
    const isClosed = closed[id] ?? false;
    const [status, taskName, progress] = (live[id] ?? 'idle||0').split('|');
    const size = n.size - 1, busy = busyIn(id);
    return (
      <li key={id} className={`bm-branch${n.depth === 0 ? ' is-root' : ''}`} style={{ '--branch-color': n.color } as CSSProperties}>
        <div className={`bm-row${focusId === id ? ' is-focus' : ''}${selected === id ? ' sel' : ''}${a.enabled ? '' : ' off'}`} onPointerEnter={() => hover(id)} onPointerLeave={() => hover(null)}>
          {kids.length ? <button className="bm-toggle" aria-expanded={!isClosed} aria-label={`${isClosed ? 'Open' : 'Close'} ${a.identity.name}'s branch`} onClick={() => setClosed((c) => ({ ...c, [id]: !isClosed }))}><ChevronRight size={13} /></button> : <span className="bm-toggle bm-leaf" aria-hidden />}
          <button className="bm-main" aria-pressed={focusId === id} title={`Show ${a.identity.name}'s branch in the brain`} onFocus={() => hover(id)} onBlur={() => hover(null)} onClick={() => focus(id)}>
            <span className="bm-dot" style={{ background: STATUS_COLOR[status as AgentStatus] ?? n.color }} aria-hidden />
            <span className="bm-text">
              <span className="bm-name">{a.identity.name}<span className="muted"> · {a.identity.title}</span></span>
              <span className="bm-meta">{n.depth === 0 ? 'Main agent' : size ? `${size} agent${size === 1 ? '' : 's'} in this branch` : 'Single agent'}{busy ? ` · ${busy} working` : ''}</span>
              {taskName && <span className="bm-task">{taskName}<span className="am-progress" aria-hidden><i style={{ width: `${progress}%` }} /></span></span>}
            </span>
          </button>
          <button className="bm-open" aria-label={`Open ${a.identity.name}'s profile`} title="Open profile" onClick={() => open(id)}><UserRound size={12} /></button>
        </div>
        {kids.length > 0 && !isClosed && <ul className="bm-children">{kids.map(row)}</ul>}
      </li>
    );
  };

  return <ul className="bm-tree" aria-label="Agent branches">{row(tree.rootId)}</ul>;
}
