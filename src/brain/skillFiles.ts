// Every agent gets its own SKILL.md: a full, detailed, specific playbook for
// its job. Files from before the detailed format (version 1) are rewritten. ORIGIN writes it as a task in its live runs
// (one at a time, like any task); the app saves each finished file to the skill
// bank and gives it to the agent.
import { useEffect, useRef } from 'react';
import type { DocOp } from '../engine/ops';
import type { OfficeDoc } from '../model/types';
import { useStore } from '../store/store';
import { useOrigin } from './useOrigin';
import { ORIGIN_ID, branchAgentOps, branchKind } from './opportunity';
import { agentProposalAction, skillFileImported, taskAction, type AgentProposal, type RunnerStatus } from './originLink';

/** The bank id of an agent's own SKILL.md. */
export const skillFileId = (agentId: string) => `skill_file_${agentId}`;
/** The current SKILL.md format: the full ten-section playbook. Older files are rewritten in it. */
export const SKILL_FILE_VERSION = 2;
const versionTag = `skill-file-v${SKILL_FILE_VERSION}`;

/** The agents that still need a current SKILL.md: every agent but ORIGIN, whose rules are its prompt. */
export function agentsNeedingSkillFile(doc: OfficeDoc, status: Pick<RunnerStatus, 'tasks'> & { skillFiles?: { agentId: string; agentIds?: string[]; version?: number }[] }): string[] {
  // requests and files from the runner are written in the current format (older runners didn't record it)
  const current = (v?: number) => (v ?? SKILL_FILE_VERSION) >= SKILL_FILE_VERSION;
  return Object.values(doc.agents)
    .filter((a) => a.id !== ORIGIN_ID)
    .filter((a) => !doc.skillBank.find((k) => k.id === skillFileId(a.id))?.tags.includes(versionTag))
    // already asked for in this format (a stopped or rejected request is not repeated), or written and waiting to be saved
    .filter((a) => !status.tasks.some((t) => t.kind === 'skill-file' && t.agentId === a.id && current(t.version)))
    .filter((a) => !status.skillFiles?.some((f) => (f.agentIds ?? [f.agentId]).includes(a.id) && current(f.version)))
    .map((a) => a.id);
}

/** The brief ORIGIN gets for an agent's SKILL.md: what its creator and the owner said about it. */
export function skillFileBrief(doc: OfficeDoc, agentId: string): string {
  const a = doc.agents[agentId];
  const parent = a.skills.supervisorId ? doc.agents[a.skills.supervisorId]?.identity.name : null;
  return [
    `${({ venture: 'Venture', skill: 'Skill agent' } as Record<string, string>)[branchKind(doc, agentId) ?? ''] ?? 'Agent'}: ${a.identity.name}, ${a.identity.title}${parent ? `, created by ${parent}` : ''}.`,
    a.identity.bio && `Purpose: ${a.identity.bio}`,
    a.identity.roleDescription && a.identity.roleDescription !== a.identity.bio && `Role: ${a.identity.roleDescription}`,
    `Skills: ${a.skills.skills.join(', ')}.`,
    a.schedule.runWindow && `Works ${a.schedule.runWindow.maxMinutes} min every ${a.schedule.runWindow.everyMinutes} min.`,
  ].filter(Boolean).join('\n').slice(0, 3500);
}

/** The bank entry for an agent's own SKILL.md. Bank names are unique, so it is named after the agent when they'd clash. */
export function skillFileUpsert(doc: OfficeDoc, agentId: string, agentName: string, file: { name: string; description: string; body: string; version?: number }): DocOp {
  const id = skillFileId(agentId);
  const base = file.name.trim() || `${agentName} playbook`;
  const taken = (n: string) => doc.skillBank.some((k) => k.id !== id && k.name.toLowerCase() === n.toLowerCase());
  const name = (taken(base) ? `${agentName}: ${base}` : base).slice(0, 80);
  return { op: 'skillBank.upsert', skill: { id, name, description: file.description || `${agentName}'s own playbook`, instructions: file.body, tags: ['skill-file', `skill-file-v${file.version ?? 1}`] } };
}

/** The ops that save a written SKILL.md to the bank and give it to its agent. */
export function skillFileOps(doc: OfficeDoc, agentId: string, file: { name: string; description: string; body: string; version?: number }): DocOp[] {
  const a = doc.agents[agentId];
  if (!a) return [];
  return [
    skillFileUpsert(doc, agentId, a.identity.name, file),
    { op: 'agent.setBankSkills', id: agentId, skillIds: [...new Set([...(a.bankSkills ?? []), skillFileId(agentId)])] },
  ];
}

/** Create an agent ORIGIN proposed (or created on its own), with its SKILL.md, and tell the runner. */
export async function createProposedAgent(p: AgentProposal): Promise<{ ok: boolean; message: string }> {
  const d = useStore.getState().doc;
  const id = `agent_${p.name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 30) || 'new'}_${Date.now().toString(36)}`;
  const bank = p.bankSkillIds.filter((k) => d.skillBank.some((x) => x.id === k));
  const { ops, error } = branchAgentOps(d, p.parentId, { id, name: p.name, specialty: p.specialty || p.skill, purpose: p.purpose, skill: p.skill, window: { everyMinutes: p.everyMinutes, maxMinutes: p.maxMinutes, setBy: 'origin', reason: p.reason || 'Proposed by ORIGIN.' }, bankSkillIds: bank });
  // its own SKILL.md, written by ORIGIN with the proposal, goes to the bank with it
  const own: DocOp[] = p.skillFile ? [skillFileUpsert(d, id, p.name, { ...p.skillFile, version: SKILL_FILE_VERSION }), { op: 'agent.setBankSkills', id, skillIds: [...bank, skillFileId(id)] }] : [];
  const r = error ? null : useStore.getState().commit([...ops, ...own], `${p.auto ? 'ORIGIN created' : 'Approve'} agent: ${p.name}`, { silent: true });
  if (!r?.ok) return { ok: false, message: `Couldn't add ${p.name}: ${error ?? r?.errors.join(' · ')}` };
  await agentProposalAction({ action: 'approve', id: p.id, agentId: id });
  return { ok: true, message: `${p.name} is now a branch of ${d.agents[p.parentId]?.identity.name}.` };
}

/** Keep every agent's SKILL.md flowing: ask ORIGIN for missing ones, and save finished ones. */
export function useSkillFiles() {
  const status = useOrigin((s) => s.status);
  const asked = useRef(new Set<string>());
  const saved = useRef(new Set<string>());
  const made = useRef(new Set<string>());
  useEffect(() => {
    if (!status?.configured) return;
    const st = useStore.getState();
    // agents ORIGIN created on its own (the owner allowed it): add them to the brain
    for (const p of status.agentProposals ?? []) {
      if (p.status !== 'proposed' || !p.auto || !status.autoAgents || made.current.has(p.id)) continue;
      made.current.add(p.id);
      void createProposedAgent(p).then((r) => { if (!r.ok) void agentProposalAction({ action: 'reject', id: p.id }); });
    }
    for (const f of status.skillFiles ?? []) {
      if (saved.current.has(f.id)) continue;
      saved.current.add(f.id);
      // one file can serve several agents with the same job; each gets it under its own name
      let d = st.doc;
      const ops: DocOp[] = [];
      for (const agentId of f.agentIds ?? [f.agentId]) {
        const mine = skillFileOps(d, agentId, f);
        ops.push(...mine);
        if (mine[0]?.op === 'skillBank.upsert') d = { ...d, skillBank: [...d.skillBank, { ...mine[0].skill, createdAt: '' }] };
      }
      const r = ops.length ? useStore.getState().commit(ops, `Save ${f.agentName}'s SKILL.md`, { silent: true }) : null;
      if (!ops.length || r?.ok) void skillFileImported(f.id); // an agent removed since is simply skipped
      else saved.current.delete(f.id);
    }
    for (const id of agentsNeedingSkillFile(useStore.getState().doc, status)) {
      if (asked.current.has(id)) continue;
      asked.current.add(id);
      const d = useStore.getState().doc;
      const again = d.skillBank.some((k) => k.id === skillFileId(id));
      void taskAction({ action: 'add', kind: 'skill-file', version: SKILL_FILE_VERSION, agentId: id, agentName: d.agents[id].identity.name, title: `${again ? 'Rewrite' : 'Write'} ${d.agents[id].identity.name}'s SKILL.md in full detail`, detail: skillFileBrief(d, id) });
    }
  }, [status]);
}
