// Every agent ORIGIN or the owner creates gets its own SKILL.md: a detailed,
// specific playbook for its job. ORIGIN writes it as a task in its live runs
// (one at a time, like any task); the app saves each finished file to the skill
// bank and gives it to the agent.
import { useEffect, useRef } from 'react';
import type { DocOp } from '../engine/ops';
import type { OfficeDoc } from '../model/types';
import { useStore } from '../store/store';
import { useOrigin } from './useOrigin';
import { branchKind } from './opportunity';
import { skillFileImported, taskAction, type RunnerStatus } from './originLink';

/** The bank id of an agent's own SKILL.md. */
export const skillFileId = (agentId: string) => `skill_file_${agentId}`;

/** The agents that still need their own SKILL.md: every venture and skill agent ORIGIN's tree grew. */
export function agentsNeedingSkillFile(doc: OfficeDoc, status: Pick<RunnerStatus, 'tasks'> & { skillFiles?: { agentId: string }[] }): string[] {
  return Object.values(doc.agents)
    .filter((a) => { const k = branchKind(doc, a.id); return k === 'venture' || k === 'skill'; })
    .filter((a) => !doc.skillBank.some((k) => k.id === skillFileId(a.id)))
    // already asked for once (a stopped or rejected request is not repeated), or written and waiting to be saved
    .filter((a) => !status.tasks.some((t) => t.kind === 'skill-file' && t.agentId === a.id))
    .filter((a) => !status.skillFiles?.some((f) => f.agentId === a.id))
    .map((a) => a.id);
}

/** The brief ORIGIN gets for an agent's SKILL.md: what its creator and the owner said about it. */
export function skillFileBrief(doc: OfficeDoc, agentId: string): string {
  const a = doc.agents[agentId];
  const parent = a.skills.supervisorId ? doc.agents[a.skills.supervisorId]?.identity.name : null;
  return [
    `${branchKind(doc, agentId) === 'venture' ? 'Venture' : 'Skill agent'}: ${a.identity.name}, ${a.identity.title}${parent ? `, created by ${parent}` : ''}.`,
    a.identity.bio && `Purpose: ${a.identity.bio}`,
    `Skills: ${a.skills.skills.join(', ')}.`,
    a.schedule.runWindow && `Works ${a.schedule.runWindow.maxMinutes} min every ${a.schedule.runWindow.everyMinutes} min.`,
  ].filter(Boolean).join('\n').slice(0, 3500);
}

/** The bank entry for an agent's own SKILL.md. Bank names are unique, so it is named after the agent when they'd clash. */
export function skillFileUpsert(doc: OfficeDoc, agentId: string, agentName: string, file: { name: string; description: string; body: string }): DocOp {
  const id = skillFileId(agentId);
  const base = file.name.trim() || `${agentName} playbook`;
  const taken = (n: string) => doc.skillBank.some((k) => k.id !== id && k.name.toLowerCase() === n.toLowerCase());
  const name = (taken(base) ? `${agentName}: ${base}` : base).slice(0, 80);
  return { op: 'skillBank.upsert', skill: { id, name, description: file.description || `${agentName}'s own playbook`, instructions: file.body, tags: ['skill-file'] } };
}

/** The ops that save a written SKILL.md to the bank and give it to its agent. */
export function skillFileOps(doc: OfficeDoc, agentId: string, file: { name: string; description: string; body: string }): DocOp[] {
  const a = doc.agents[agentId];
  if (!a) return [];
  return [
    skillFileUpsert(doc, agentId, a.identity.name, file),
    { op: 'agent.setBankSkills', id: agentId, skillIds: [...new Set([...(a.bankSkills ?? []), skillFileId(agentId)])] },
  ];
}

/** Keep every agent's SKILL.md flowing: ask ORIGIN for missing ones, and save finished ones. */
export function useSkillFiles() {
  const status = useOrigin((s) => s.status);
  const asked = useRef(new Set<string>());
  const saved = useRef(new Set<string>());
  useEffect(() => {
    if (!status?.configured) return;
    const st = useStore.getState();
    for (const f of status.skillFiles ?? []) {
      if (saved.current.has(f.id)) continue;
      saved.current.add(f.id);
      const ops = skillFileOps(st.doc, f.agentId, f);
      const r = ops.length ? useStore.getState().commit(ops, `Save ${f.agentName}'s SKILL.md`, { silent: true }) : null;
      if (!ops.length || r?.ok) void skillFileImported(f.id); // an agent removed since is simply skipped
      else saved.current.delete(f.id);
    }
    for (const id of agentsNeedingSkillFile(useStore.getState().doc, status)) {
      if (asked.current.has(id)) continue;
      asked.current.add(id);
      const d = useStore.getState().doc;
      void taskAction({ action: 'add', kind: 'skill-file', agentId: id, agentName: d.agents[id].identity.name, title: `Write ${d.agents[id].identity.name}'s SKILL.md`, detail: skillFileBrief(d, id) });
    }
  }, [status]);
}
