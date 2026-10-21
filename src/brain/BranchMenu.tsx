// The Branches menu: the agent tree the brain runs on, as a menu. The main
// agent is at the top, every agent it made is a branch under it, and agents
// those agents made nest inside their branch. Hovering a branch shows its
// agents in the brain; clicking a name focuses that branch, and the arrow
// opens the agent's profile. Under the main agent sit its open ideas: give it
// one, ask it for one, or grow one into a new branch.
import { useMemo, useState, type CSSProperties } from 'react';
import { ChevronRight, Lightbulb, Sparkles, Sprout, UserRound } from 'lucide-react';
import { useStore } from '../store/store';
import type { Agent, AgentStatus } from '../model/types';
import { STATUS_COLOR } from '../viewport/AgentsLayer';
import type { Team } from './connectome';
import { useBrainFocus } from './ConnectomeView';
import { askGrow, treeOf } from './BrainScene';
import { byOwner, openIdeas, ownerIdeaOps, suggestIdeaOps } from './ideas';
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
  const library = useStore((s) => s.doc.library);
  const ideas = useMemo(() => openIdeas({ library }), [library]);
  const [idea, setIdea] = useState('');
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

  const rootId = tree.rootId, rootName = agents[rootId]?.identity.name ?? 'The main agent';
  const give = () => { if (!idea.trim()) return; const r = useStore.getState().commit(ownerIdeaOps(idea, rootId), 'Give the main agent an idea'); if (r.ok) setIdea(''); };
  const ask = () => { const s = useStore.getState(); s.commit(suggestIdeaOps(s.doc, rootId), `${rootName} suggests an idea`); };

  return <>
    <section className="bm-ideas" aria-label="Ideas">
      <div className="bm-ideas-head"><Lightbulb size={13} aria-hidden /><b>Ideas</b><span className="muted small">{ideas.length ? `${ideas.length} budding on ${rootName}` : `${rootName} grows from ideas`}</span></div>
      <form className="bm-idea-form" onSubmit={(e) => { e.preventDefault(); give(); }}>
        <input value={idea} onChange={(e) => setIdea(e.target.value)} placeholder={`Give ${rootName} an idea`} aria-label={`Give ${rootName} an idea`} maxLength={600} />
        <button className="btn sm primary" disabled={!idea.trim()} aria-label="Add idea"><Sprout size={13} /></button>
        <button type="button" className="btn sm" onClick={ask} title={`${rootName} suggests an idea (simulated until a live model is connected)`}><Sparkles size={13} /> Ask</button>
      </form>
      {ideas.length > 0 && <ul className="bm-idea-list">{ideas.map((e) => <li key={e.id} className={byOwner(e) ? 'is-owner' : 'is-agent'} onPointerEnter={() => hover(rootId)} onPointerLeave={() => hover(null)}>
        <span className="bm-bud" aria-hidden />
        <span className="bm-idea-text"><b title={e.summary}>{e.title}</b><small>{byOwner(e) ? 'Your idea' : `${agents[e.authorAgentId ?? '']?.identity.name ?? rootName}'s idea`}{e.tags.includes('simulated') ? ' · simulated' : ''}</small></span>
        <button className="btn sm" onClick={() => askGrow(e.id)} title="Grow this idea into a new agent branch"><Sprout size={12} /> Grow</button>
      </li>)}</ul>}
    </section>
    <ul className="bm-tree" aria-label="Agent branches">{row(rootId)}</ul>
  </>;
}
