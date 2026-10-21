// Real work only: a task given to any agent goes to ORIGIN's runner (the one
// live model, on the owner's key and cap), and each agent's SKILL.md is the
// playbook ORIGIN wrote for it. Nothing here is simulated.
import { useState } from 'react';
import { Download, Send } from 'lucide-react';
import type { Agent, OfficeDoc } from '../model/types';
import { useStore } from '../store/store';
import { useOrigin } from './useOrigin';
import { ORIGIN_ID, branchKind } from './opportunity';
import { taskAction, type RunnerTask } from './originLink';
import { skillFileId } from './skillFiles';
import { skillFileText } from './SkillBank';

/** Hand a task to ORIGIN's runner. A task for another agent names it, so ORIGIN works it with that agent's SKILL.md. */
export async function giveTask(doc: OfficeDoc, agentId: string, text: string): Promise<{ ok: boolean; message: string }> {
  const a = doc.agents[agentId];
  const task = text.trim();
  if (!a || !task) return { ok: false, message: 'Write the task first.' };
  const forOrigin = agentId === ORIGIN_ID;
  const own = doc.skillBank.find((k) => k.id === skillFileId(agentId));
  const r = await taskAction({
    action: 'add',
    ...(forOrigin ? {} : { agentId }),
    title: (forOrigin ? task : `${a.identity.name}: ${task}`).slice(0, 160),
    detail: forOrigin ? '' : `Do this as ${a.identity.name} (${a.identity.title}). ${own ? `Follow its SKILL.md, "${own.name}", in the skill bank.` : 'It has no SKILL.md yet, so work from its role.'}`,
  });
  if (!r) return { ok: false, message: "ORIGIN's runner isn't running, so the task wasn't given. Start it on your PC with npm.cmd run origin." };
  return { ok: true, message: forOrigin ? 'Given to ORIGIN. It works one task at a time in its runs.' : `Given to ORIGIN to do as ${a.identity.name}. It works one task at a time in its runs.` };
}

/** The runner tasks that belong to an agent: ORIGIN's own, or the ones named for this agent. */
export function tasksFor(tasks: RunnerTask[], a: Agent): RunnerTask[] {
  if (a.id === ORIGIN_ID) return tasks.filter((t) => t.kind !== 'skill-file');
  return tasks.filter((t) => t.agentId === a.id || t.title.startsWith(`${a.identity.name}: `));
}

export function AgentTasks({ a }: { a: Agent }) {
  const status = useOrigin((s) => s.status);
  const doc = useStore((s) => s.doc);
  const [text, setText] = useState('');
  const [msg, setMsg] = useState('');
  const mine = status ? tasksFor(status.tasks, a).slice().reverse() : [];
  const send = async () => { const r = await giveTask(doc, a.id, text); setMsg(r.message); if (r.ok) setText(''); };
  return (
    <div className="card">
      <h4>Tasks</h4>
      {!status && <p className="note">ORIGIN's runner isn't running, so there are no tasks to show. Tasks only exist when you give them.</p>}
      {status && !mine.length && <p className="note">No tasks yet. Nothing runs until you give one.</p>}
      {mine.length > 0 && <table className="data"><thead><tr><th>Task</th><th>Status</th><th>Spent</th></tr></thead><tbody>
        {mine.map((t) => <tr key={t.id}><td>{t.title}{t.stopReason && <div className="small muted">{t.stopReason}</div>}</td><td>{t.status}</td><td className="small">{t.spentUsd != null ? `$${t.spentUsd.toFixed(3)}` : '—'}</td></tr>)}
      </tbody></table>}
      <form className="row" style={{ marginTop: 8 }} onSubmit={(e) => { e.preventDefault(); void send(); }}>
        <input type="text" className="grow" value={text} onChange={(e) => setText(e.target.value)} placeholder={`Give ${a.identity.name} a task`} aria-label={`Task for ${a.identity.name}`} />
        <button className="btn primary sm" disabled={!text.trim()}><Send size={13} /> Give task</button>
      </form>
      {msg && <p className="note" role="status">{msg}</p>}
    </div>
  );
}

/** The agent's own SKILL.md, plus the bank skills it was given. */
export function AgentSkillFile({ a }: { a: Agent }) {
  const doc = useStore((s) => s.doc);
  const status = useOrigin((s) => s.status);
  const own = doc.skillBank.find((k) => k.id === skillFileId(a.id));
  const others = doc.skillBank.filter((k) => k.id !== skillFileId(a.id) && (a.bankSkills ?? []).includes(k.id));
  const kind = branchKind(doc, a.id);
  const request = status?.tasks.find((t) => t.kind === 'skill-file' && t.agentId === a.id);
  const download = (k: { name: string; description: string; instructions: string }) => {
    const url = URL.createObjectURL(new Blob([skillFileText(k)], { type: 'text/markdown;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url; link.download = `${a.identity.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'agent'}.SKILL.md`; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <div className="card">
        <div className="row"><h4 className="grow">{own ? own.name : `${a.identity.name}'s SKILL.md`}</h4>{own && <button className="btn sm" onClick={() => download(own)}><Download size={13} /> Download</button>}</div>
        {own ? <>
          {own.description && <p className="note">{own.description}</p>}
          <pre className="skill-file">{own.instructions}</pre>
        </> : <p className="note">{
          kind === 'root' ? "ORIGIN's playbook is its instructions, under AI model. Each agent it creates gets its own SKILL.md here."
            : kind === 'core' ? 'This agent was not grown by ORIGIN, so ORIGIN does not write a SKILL.md for it.'
            : request ? `ORIGIN is writing it: “${request.title}” is ${request.status === 'approved' ? 'queued for its next run' : request.status}. It appears here when it's done.`
            : status ? 'ORIGIN will be asked to write it on its next check.' : "ORIGIN writes it in its runs. Start the runner on your PC with npm.cmd run origin."
        }</p>}
      </div>
      {others.length > 0 && <div className="card">
        <h4>Skills from the bank</h4>
        {others.map((k) => <details key={k.id}><summary>{k.name}{k.description ? ` · ${k.description}` : ''}</summary><pre className="skill-file">{k.instructions}</pre></details>)}
      </div>}
    </div>
  );
}
