import { saveFile } from '../persistence/saveFile';
import { useEffect, useMemo, useState } from 'react';
import { X } from 'lucide-react';
import { ORIGIN_ID, describeWindow } from '../brain/opportunity';
import { AgentSkillFile, AgentTasks } from '../brain/agentWork';
import { useStore } from '../store/store';
import type { Agent, MemoryItem } from '../model/types';
import type { DeepPartial } from '../engine/ops';
import { uid } from '../model/defaults';
import { stripSecrets } from '../model/schema';
import { STATUS_COLOR } from '../brain/status';
import { ChipsInput, NumberField, SelectField, Slider, TextField, Toggle, confirmAction } from './primitives';
import { deleteAgent } from './actions';

const TABS = [
  ['identity', 'Identity'], ['skillfile', 'SKILL.md'], ['personality', 'Personality'], ['skills', 'Skills & roles'], ['ai', 'AI model'], ['memory', 'Memory'],
  ['schedule', 'Schedule & tasks'], ['activity', 'Activity & logs'], ['permissions', 'Permissions'],
] as const;

type Up = (patch: DeepPartial<Omit<Agent, 'id'>>, label?: string) => void;

function Identity({ a, up }: { a: Agent; up: Up }) {
  const rt = useStore((s) => s.runtime.agents[a.id]);
  return (
    <div className="grid-2">
      <div>
        <TextField label="Display name" value={a.identity.name} maxLength={80} onCommit={(name) => name.trim() && up({ identity: { name: name.trim() } }, 'Rename agent')} />
        <div className="field"><span>Unique agent ID</span><input type="text" value={a.id} readOnly aria-readonly /></div>
        <div className="field-row">
          <TextField label="Job title" value={a.identity.title} onCommit={(title) => up({ identity: { title } })} />
          <TextField label="Department" value={a.identity.department} onCommit={(department) => up({ identity: { department } }, 'Change department')} />
        </div>
        <TextField label="Role description" multiline value={a.identity.roleDescription} onCommit={(roleDescription) => up({ identity: { roleDescription } })} />
        <TextField label="Short biography" multiline value={a.identity.bio} onCommit={(bio) => up({ identity: { bio } })} />
        <div className="field-row">
          <div className="field"><span>Created</span><input type="text" readOnly value={new Date(a.identity.createdAt).toLocaleString()} /></div>
          <SelectField label="Agent status" value={a.identity.status} options={['active', 'paused', 'disabled'] as const} onChange={(status) => up({ identity: { status }, enabled: status !== 'disabled' }, `Set ${a.identity.name} ${status}`)} />
        </div>
      </div>
      <div className="card"><p className="note">Runtime status: <span style={{ color: STATUS_COLOR[rt?.status ?? 'idle'] }}>{rt?.status}</span></p></div>
    </div>
  );
}

function Personality({ a, up }: { a: Agent; up: Up }) {
  const p = a.personality;
  const slider = (k: 'formality' | 'humor' | 'creativity' | 'detail' | 'riskTolerance' | 'initiative', label: string) =>
    <Slider label={label} value={p[k]} onCommit={(v) => up({ personality: { [k]: v } }, `${label} for ${a.identity.name}`)} />;
  const prompt = `Personality: ${p.traits.join(', ') || 'neutral'}. Communicate in a ${p.communicationStyle} style (formality ${p.formality}/100, humour ${p.humor}/100). Creativity ${p.creativity}/100, attention to detail ${p.detail}/100, risk tolerance ${p.riskTolerance}/100, initiative ${p.initiative}/100. Collaboration: ${p.collaboration}. Decisions: ${p.decisionMaking}. Work habits: ${p.workHabits} Default response style: ${p.responseStyle}`;
  return (
    <div className="grid-2">
      <div>
        <p className="note warn">These settings shape behaviour only when this agent uses a live AI provider: they are sent as part of its instructions (preview on the right). The local simulator does not read them.</p>
        <ChipsInput label="Personality traits" values={p.traits} onChange={(traits) => up({ personality: { traits } })} suggestions={['calm', 'curious', 'decisive', 'meticulous', 'witty', 'empathetic', 'bold', 'pragmatic', 'skeptical', 'warm']} />
        <div className="field-row">
          <SelectField label="Communication style" value={p.communicationStyle} options={['concise', 'detailed', 'friendly', 'formal', 'technical'] as const} onChange={(communicationStyle) => up({ personality: { communicationStyle } })} />
          <SelectField label="Collaboration" value={p.collaboration} options={['solo', 'pairs', 'team'] as const} onChange={(collaboration) => up({ personality: { collaboration } })} />
        </div>
        {slider('formality', 'Formality')}{slider('humor', 'Humour')}{slider('creativity', 'Creativity')}
        {slider('detail', 'Attention to detail')}{slider('riskTolerance', 'Risk tolerance')}{slider('initiative', 'Initiative')}
      </div>
      <div>
        <SelectField label="Decision-making" value={p.decisionMaking} options={['data-driven', 'intuitive', 'consensus', 'directive'] as const} onChange={(decisionMaking) => up({ personality: { decisionMaking } })} />
        <TextField label="Work habits" multiline value={p.workHabits} onCommit={(workHabits) => up({ personality: { workHabits } })} />
        <div className="field-row">
          <label className="field"><span>Working hours start</span><input type="time" value={p.workingHours.start} onChange={(e) => up({ personality: { workingHours: { start: e.target.value } } })} /></label>
          <label className="field"><span>Working hours end</span><input type="time" value={p.workingHours.end} onChange={(e) => up({ personality: { workingHours: { end: e.target.value } } })} /></label>
        </div>
        <TextField label="Default response style" multiline value={p.responseStyle} onCommit={(responseStyle) => up({ personality: { responseStyle } })} />
        <div className="card"><h4>Instruction preview</h4><p className="note" style={{ color: 'var(--text-dim)' }}>{prompt}</p></div>
      </div>
    </div>
  );
}

function Skills({ a, up }: { a: Agent; up: Up }) {
  const doc = useStore((s) => s.doc);
  const k = a.skills;
  return (
    <div className="grid-2">
      <div>
        <TextField label="Primary role" value={k.primaryRole} onCommit={(primaryRole) => up({ skills: { primaryRole } })} />
        <ChipsInput label="Secondary roles" values={k.secondaryRoles} onChange={(secondaryRoles) => up({ skills: { secondaryRoles } })} />
        <ChipsInput label="Skills" values={k.skills} onChange={(skills) => up({ skills: { skills } })} />
        <ChipsInput label="Areas of expertise" values={k.expertise} onChange={(expertise) => up({ skills: { expertise } })} />
        <ChipsInput label="Tools available" values={k.tools} onChange={(tools) => up({ skills: { tools } })} suggestions={['terminal', 'search', 'notebook', 'ssh', 'metrics', 'email', 'calendar', 'wrench']} />
        <ChipsInput label="Team memberships" values={k.teams} onChange={(teams) => up({ skills: { teams } })} />
      </div>
      <div>
        <ChipsInput label="Task permissions" values={k.taskPermissions} onChange={(taskPermissions) => up({ skills: { taskPermissions } })} suggestions={['execute-assigned', 'assign-tasks', 'create-tasks', 'cancel-tasks']} />
        <NumberField label="Workload limit (open tasks)" value={k.workloadLimit} min={1} max={50} onCommit={(workloadLimit) => up({ skills: { workloadLimit } })} />
        <TextField label="Priority rules" multiline value={k.priorityRules} onCommit={(priorityRules) => up({ skills: { priorityRules } })} />
        <TextField label="Escalation rules" multiline value={k.escalationRules} onCommit={(escalationRules) => up({ skills: { escalationRules } })} />
        <SelectField label="Supervisor / reports to" value={k.supervisorId ?? ''} options={[{ value: '', label: 'None' }, ...Object.values(doc.agents).filter((x) => x.id !== a.id).map((x) => ({ value: x.id, label: x.identity.name }))]} onChange={(v) => up({ skills: { supervisorId: v || null } })} />
        <TextField label="Department (move without recreating)" value={a.identity.department} onCommit={(department) => up({ identity: { department } }, 'Change department')} />
      </div>
    </div>
  );
}

function AIModel({ a, up }: { a: Agent; up: Up }) {
  const c = a.ai;
  return (
    <div className="grid-2">
      <div>
        <div className="field-row">
          <SelectField label="AI provider" value={c.provider} options={[{ value: 'simulated', label: 'Simulated (no model)' }, { value: 'remote-proxy', label: 'Live via server proxy' }]} onChange={(provider) => up({ ai: { provider } })} />
          <TextField label="Model" value={c.model} onCommit={(model) => up({ ai: { model } })} placeholder="e.g. claude-sonnet-5-5" />
        </div>
        <TextField label="System instructions" multiline value={c.systemInstructions} onCommit={(systemInstructions) => up({ ai: { systemInstructions } })} />
        <TextField label="Agent-specific instructions" multiline value={c.agentInstructions} onCommit={(agentInstructions) => up({ ai: { agentInstructions } })} />
        <TextField label="Response constraints" value={c.responseConstraints} onCommit={(responseConstraints) => up({ ai: { responseConstraints } })} />
      </div>
      <div>
        <ChipsInput label="Tool permissions" values={c.toolPermissions} onChange={(toolPermissions) => up({ ai: { toolPermissions } })} />
        <NumberField label="Context limit (tokens)" value={c.contextLimit} min={1000} max={1000000} step={1000} onCommit={(contextLimit) => up({ ai: { contextLimit } })} />
        <div className="field-row">
          <SelectField label="Task execution" value={c.executionMode} options={['manual-approval', 'auto'] as const} onChange={(executionMode) => up({ ai: { executionMode } })} />
          <SelectField label="On error" value={c.errorHandling} options={['pause', 'retry', 'escalate'] as const} onChange={(errorHandling) => up({ ai: { errorHandling } })} />
        </div>
        <NumberField label="Max retries" value={c.maxRetries} min={0} max={10} onCommit={(maxRetries) => up({ ai: { maxRetries } })} />
        <div className="card">
          <h4>Credentials</h4>
          <p className="note">API keys are never stored in a profile, the browser, logs or saved/exported files. ORIGIN's live runs go through <code>server/origin-runner.mjs</code> on your PC, which reads <code>ANTHROPIC_API_KEY</code> from its own environment.</p>
        </div>
      </div>
    </div>
  );
}

function Memory({ a, up }: { a: Agent; up: Up }) {
  const [q, setQ] = useState('');
  const [draft, setDraft] = useState<{ title: string; content: string; kind: MemoryItem['kind']; persistent: boolean }>({ title: '', content: '', kind: 'note', persistent: true });
  const items = a.memory.filter((m) => !q || `${m.title} ${m.content}`.toLowerCase().includes(q.toLowerCase()));
  const save = (memory: MemoryItem[], label: string) => up({ memory }, label);
  const group = (persistent: boolean) => items.filter((m) => m.persistent === persistent);
  const Item = ({ m }: { m: MemoryItem }) => (
    <div className="card" style={{ marginBottom: 6 }}>
      <div className="row"><span className="chip">{m.kind}</span><input type="text" aria-label="Memory title" defaultValue={m.title} onBlur={(e) => e.target.value !== m.title && save(a.memory.map((x) => (x.id === m.id ? { ...x, title: e.target.value } : x)), 'Edit memory')} /><button className="btn sm danger" onClick={() => save(a.memory.filter((x) => x.id !== m.id), 'Delete memory')}>Delete</button></div>
      <textarea aria-label="Memory content" defaultValue={m.content} style={{ marginTop: 6 }} onBlur={(e) => e.target.value !== m.content && save(a.memory.map((x) => (x.id === m.id ? { ...x, content: e.target.value } : x)), 'Edit memory')} />
      <div className="small muted">{new Date(m.createdAt).toLocaleString()} · {m.persistent ? 'persistent' : 'temporary context'}</div>
    </div>
  );
  return (
    <div className="grid-2">
      <div>
        <div className="row" style={{ marginBottom: 8 }}><input type="search" placeholder="Search memory" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search memory" />
          <button className="btn sm danger" onClick={() => confirmAction({ title: `Reset ${a.identity.name}'s memory?`, danger: true, confirmLabel: 'Reset memory', body: `Deletes all ${a.memory.length} memory items (persistent and temporary). Undo can restore them.`, onConfirm: () => save([], 'Reset memory') })}>Reset</button></div>
        <h3 className="label">Persistent memory ({group(true).length})</h3>
        {group(true).map((m) => <Item key={m.id} m={m} />)}
        {!group(true).length && <p className="note">No persistent notes.</p>}
        <h3 className="label" style={{ marginTop: 12 }}>Temporary conversation context ({group(false).length})</h3>
        {group(false).map((m) => <Item key={m.id} m={m} />)}
        {!group(false).length && <p className="note">No temporary context. It's cleared when the agent is duplicated.</p>}
      </div>
      <div className="card">
        <h4>Add memory</h4>
        <div className="field-row">
          <SelectField label="Kind" value={draft.kind} options={[{ value: 'note', label: 'Persistent note' }, { value: 'project', label: 'Project context' }, { value: 'knowledge', label: 'Knowledge source' }, { value: 'preference', label: 'User-approved preference' }, { value: 'conversation', label: 'Conversation history' }]} onChange={(kind) => setDraft({ ...draft, kind, persistent: kind !== 'conversation' })} />
          <div className="field"><span>Lifetime</span><Toggle label="Persistent" checked={draft.persistent} onChange={(persistent) => setDraft({ ...draft, persistent })} /></div>
        </div>
        <label className="field"><span>Title</span><input type="text" value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} /></label>
        <label className="field"><span>Content</span><textarea value={draft.content} onChange={(e) => setDraft({ ...draft, content: e.target.value })} /></label>
        <button className="btn primary sm" disabled={!draft.title.trim()} onClick={() => { save([...a.memory, { id: uid('mem'), createdAt: new Date().toISOString(), ...draft }], 'Add memory'); setDraft({ ...draft, title: '', content: '' }); }}>Add</button>
        <p className="note" style={{ marginTop: 8 }}>This is everything the agent can draw on. Persistent items survive sessions; temporary context is per conversation.</p>
      </div>
    </div>
  );
}

function Schedule({ a, up }: { a: Agent; up: Up }) {
  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <div className="grid-3">
        <div className="field-row">
          <label className="field"><span>Work start</span><input type="time" value={a.schedule.workStart} onChange={(e) => up({ schedule: { workStart: e.target.value } })} /></label>
          <label className="field"><span>Work end</span><input type="time" value={a.schedule.workEnd} onChange={(e) => up({ schedule: { workEnd: e.target.value } })} /></label>
        </div>
        <NumberField label="Break every (min)" value={a.schedule.breakEveryMin} min={15} max={480} onCommit={(breakEveryMin) => up({ schedule: { breakEveryMin } })} />
        <NumberField label="Break length (min)" value={a.schedule.breakLengthMin} min={5} max={120} onCommit={(breakLengthMin) => up({ schedule: { breakLengthMin } })} />
        <NumberField label="Work window: minutes per run" value={a.schedule.runWindow?.maxMinutes ?? 0} min={1} max={60} onCommit={(maxMinutes) => up({ schedule: { runWindow: maxMinutes ? { everyMinutes: a.schedule.runWindow?.everyMinutes ?? 60, maxMinutes, setBy: 'owner', reason: 'Set by the owner.' } : undefined } })} />
        <NumberField label="Work window: every (min)" value={a.schedule.runWindow?.everyMinutes ?? 0} min={15} max={10080} onCommit={(everyMinutes) => up({ schedule: { runWindow: everyMinutes ? { maxMinutes: a.schedule.runWindow?.maxMinutes ?? 5, everyMinutes, setBy: 'owner', reason: 'Set by the owner.' } : undefined } })} />
        <div className="field"><span>Work window</span><input type="text" readOnly value={`${describeWindow(a.schedule.runWindow)}${a.schedule.runWindow ? ` · ${a.schedule.runWindow.setBy === 'origin' ? 'suggested by ORIGIN' : 'set by you'} · planned, not scheduled` : ''}`} title={a.schedule.runWindow?.reason} /></div>
      </div>
      <AgentTasks a={a} />
    </div>
  );
}

function Activity({ a }: { a: Agent }) {
  const events = useStore((s) => s.runtime.events);
  const [q, setQ] = useState('');
  const [kind, setKind] = useState('all');
  const list = useMemo(() => events.filter((e) => (e.agentId === a.id || e.message.includes(a.identity.name)) && (kind === 'all' || e.kind === kind) && (!q || e.message.toLowerCase().includes(q.toLowerCase()))).slice().reverse(), [events, a.id, a.identity.name, q, kind]);
  return (
    <div>
      <div className="row" style={{ marginBottom: 8 }}>
        <input type="search" placeholder="Search activity" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search activity" />
        <select aria-label="Event type" value={kind} onChange={(e) => setKind(e.target.value)} style={{ width: 200 }}>
          {['all', 'task-start', 'task-complete', 'task-failed', 'comms', 'tool', 'config', 'error', 'pause', 'resume', 'change', 'approval', 'library', 'system'].map((k) => <option key={k}>{k}</option>)}
        </select>
      </div>
      <table className="data"><thead><tr><th>Time</th><th>Type</th><th>Event</th><th>Source</th></tr></thead><tbody>
        {list.map((e) => <tr key={e.id}><td className="small">{new Date(e.at).toLocaleTimeString()}</td><td className="small">{e.kind}</td><td style={{ color: e.level === 'error' ? 'var(--danger)' : undefined }}>{e.message}</td><td>{e.simulated ? <span className="badge sim">simulated</span> : <span className="badge live">system</span>}</td></tr>)}
        {!list.length && <tr><td colSpan={4} className="muted">No matching activity.</td></tr>}
      </tbody></table>
    </div>
  );
}

function Permissions({ a, up }: { a: Agent; up: Up }) {
  const doc = useStore((s) => s.doc);
  const p = a.permissions;
  const contactAll = p.contactableAgentIds === 'all';
  const exportCfg = () => {
    void saveFile(`${a.identity.name.toLowerCase()}.agent.json`, JSON.stringify(stripSecrets({ format: 'agent-office-agent', agent: a }), null, 2));
  };
  return (
    <div className="grid-2">
      <div>
        <ChipsInput label="Tools this agent may use" values={p.allowedTools} onChange={(allowedTools) => up({ permissions: { allowedTools } })} suggestions={['terminal', 'search', 'email', 'ssh', 'deploy', 'files']} />
        <ChipsInput label="Requires approval before" values={p.requireApprovalFor} onChange={(requireApprovalFor) => up({ permissions: { requireApprovalFor } })} suggestions={['delete', 'external-message', 'deploy', 'spend', 'layout-change']} />
        <Toggle label="May contact every agent" checked={contactAll} onChange={(v) => up({ permissions: { contactableAgentIds: v ? 'all' : [] } })} />
        {!contactAll && (
          <div className="chips" style={{ marginTop: 6 }}>{Object.values(doc.agents).filter((x) => x.id !== a.id).map((x) => {
            const on = (p.contactableAgentIds as string[]).includes(x.id);
            return <button key={x.id} className={`btn sm${on ? ' active' : ''}`} aria-pressed={on} onClick={() => up({ permissions: { contactableAgentIds: on ? (p.contactableAgentIds as string[]).filter((y) => y !== x.id) : [...(p.contactableAgentIds as string[]), x.id] } })}>{x.identity.name}</button>;
          })}</div>
        )}
        <div style={{ display: 'grid', gap: 6, marginTop: 10 }}>
          <Toggle label="May edit other agents' profiles" checked={p.canEditOthers} onChange={(canEditOthers) => up({ permissions: { canEditOthers } })} />
        </div>
      </div>
      <div className="card">
        <h4>Controls</h4>
        <div className="row wrap">
          <button className="btn sm" onClick={() => up({ enabled: !a.enabled, identity: { status: a.enabled ? 'paused' : 'active' } }, a.enabled ? `Pause ${a.identity.name}` : `Resume ${a.identity.name}`)}>{a.enabled && a.identity.status === 'active' ? 'Pause' : 'Resume'}</button>
          <button className="btn sm" onClick={() => {
            const st = useStore.getState(); const r = st.runtime.agents[a.id];
            if (r) { useStore.setState({ runtime: { ...st.runtime, agents: { ...st.runtime.agents, [a.id]: { ...r, status: 'idle', currentTaskId: null, statusMessage: undefined } } } }); st.notify(`${a.identity.name} restarted`); }
          }}>Restart</button>
          <button className="btn sm" onClick={exportCfg}>Export configuration</button>
          {a.id !== ORIGIN_ID && <button className="btn sm danger" onClick={() => deleteAgent(a.id)}>Delete agent…</button>}
        </div>
        <p className="note" style={{ marginTop: 8 }}>Exported configuration never includes credentials. Deleting asks for confirmation and explains what happens to tasks and memory.</p>
      </div>
    </div>
  );
}

export function ProfileDrawer() {
  const id = useStore((s) => s.profileAgentId);
  const tab = useStore((s) => s.profileTab);
  const agent = useStore((s) => (id ? s.doc.agents[id] : undefined));
  const { setUi, commit } = useStore.getState();
  useEffect(() => {
    if (!id) return;
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape' && !(e.target as HTMLElement).closest('input,textarea,select')) setUi({ profileAgentId: null }); };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [id, setUi]);
  if (!id || !agent) return null;
  const up: Up = (patch, label = `Edit ${agent.identity.name}`) => commit([{ op: 'agent.update', id: agent.id, patch }], label);
  return (
    <div className="drawer" role="dialog" aria-modal="false" aria-label={`${agent.identity.name} profile`}>
      <div className="drawer-h">
        <span className="bm-dot" style={{ width: 12, height: 12, background: STATUS_COLOR[useStore.getState().runtime.agents[agent.id]?.status ?? 'idle'] }} aria-hidden />
        <div className="grow"><div className="agent-name" style={{ fontSize: 16 }}>{agent.identity.name}</div><div className="small muted">{agent.identity.title} · {agent.identity.department} · {agent.id}</div></div>
        <span className="small muted">Changes save automatically and can be undone</span>
        <button className="btn icon" aria-label="Close profile" onClick={() => setUi({ profileAgentId: null })}><X size={16} /></button>
      </div>
      <div className="tabs" role="tablist">
        {TABS.map(([k, label]) => <button key={k} role="tab" aria-selected={tab === k} onClick={() => setUi({ profileTab: k })}>{label}</button>)}
      </div>
      <div className="tab-body" role="tabpanel">
        {tab === 'identity' && <Identity a={agent} up={up} />}
        {tab === 'skillfile' && <AgentSkillFile a={agent} />}
        {tab === 'personality' && <Personality a={agent} up={up} />}
        {tab === 'skills' && <Skills a={agent} up={up} />}
        {tab === 'ai' && <AIModel a={agent} up={up} />}
        {tab === 'memory' && <Memory a={agent} up={up} />}
        {tab === 'schedule' && <Schedule a={agent} up={up} />}
        {tab === 'activity' && <Activity a={agent} />}
        {tab === 'permissions' && <Permissions a={agent} up={up} />}
      </div>
    </div>
  );
}
