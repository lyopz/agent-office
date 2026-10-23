// Every agent gets its own SKILL.md: a full, detailed, specific playbook for
// its job. Files from before the detailed format (version 1) are rewritten. JARVIS writes it as a task in its live runs
// (one at a time, like any task); the app saves each finished file to the skill
// bank and gives it to the agent.
import { useEffect, useRef } from 'react';
import { applyOps, type DocOp } from '../engine/ops';
import { libraryDocs, peekBrain } from '../persistence/brains';
import type { OfficeDoc } from '../model/types';
import { useStore } from '../store/store';
import { useOrigin } from './useOrigin';
import { ORIGIN_ID, branchAgentOps, branchKind } from './opportunity';
import { agentProposalAction, skillFileImported, taskAction, type AgentProposal, type RunnerStatus, type SkillFile } from './originLink';

import { SKILL_FILE_VERSION, skillFileId } from './originSkillFile';
export { SKILL_FILE_VERSION, skillFileId };
const versionTag = `skill-file-v${SKILL_FILE_VERSION}`;

/** The agents that still need a current SKILL.md: every agent but JARVIS, whose rules are its prompt. */
export function agentsNeedingSkillFile(doc: OfficeDoc, status: Pick<RunnerStatus, 'tasks'> & { skillFiles?: { agentId: string; agentIds?: string[]; version?: number; bank?: boolean }[] }): string[] {
  // requests and files from the runner are written in the current format (older runners didn't record it)
  const current = (v?: number) => (v ?? SKILL_FILE_VERSION) >= SKILL_FILE_VERSION;
  return Object.values(doc.agents)
    .filter((a) => a.id !== ORIGIN_ID)
    .filter((a) => !doc.skillBank.find((k) => k.id === skillFileId(a.id))?.tags.includes(versionTag))
    // already asked for in this format (a stopped or rejected request is not repeated), or written and waiting to be saved
    .filter((a) => !status.tasks.some((t) => t.kind === 'skill-file' && t.agentId === a.id && current(t.version)))
    .filter((a) => !status.skillFiles?.some((f) => !f.bank && (f.agentIds ?? [f.agentId]).includes(a.id) && current(f.version)))
    .map((a) => a.id);
}

/** The brief JARVIS gets for an agent's SKILL.md: what its creator and the owner said about it. */
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

/** The owner's own .md as an agent's SKILL.md: saved in the current format (so JARVIS never rewrites it) and marked as the owner's. */
export function ownSkillFileOps(doc: OfficeDoc, agentId: string, agentName: string, f: { name: string; description: string; body: string }, bankSkillIds: string[]): DocOp[] {
  const up = skillFileUpsert(doc, agentId, agentName, { ...f, version: SKILL_FILE_VERSION });
  if (up.op === 'skillBank.upsert') up.skill.tags = [...up.skill.tags, 'owner-file'];
  return [up, { op: 'agent.setBankSkills', id: agentId, skillIds: [...new Set([...bankSkillIds, skillFileId(agentId)])] }];
}

/** The bank id of a shared skill JARVIS wrote. */
export const bankSkillId = (key: string) => `skill_${key}`;

/** The ops that save a shared skill JARVIS wrote to the bank and give it to each of its agents. */
export function bankSkillOps(doc: OfficeDoc, f: { skillKey?: string; skillName?: string; name: string; description: string; body: string; version?: number; agentIds?: string[]; tags?: string[] }): DocOp[] {
  const id = bankSkillId(f.skillKey || f.name.toLowerCase().replace(/[^a-z0-9]+/g, '_'));
  const base = (f.skillName || f.name).trim();
  // bank names are unique: a different skill with the same name keeps it, and this one says who wrote it
  const name = (doc.skillBank.some((k) => k.id !== id && k.name.toLowerCase() === base.toLowerCase()) ? `${base} (JARVIS)` : base).slice(0, 80);
  // a skill the owner edited in the bank keeps their text; it is only attached to more agents
  const have = doc.skillBank.find((k) => k.id === id);
  const ops: DocOp[] = have?.tags.includes('owner-edited') ? [] : [{ op: 'skillBank.upsert', skill: { id, name, description: f.description || base, instructions: f.body, tags: [...new Set(['bank-skill', `skill-file-v${f.version ?? 1}`, ...(f.tags ?? [])])] } }];
  for (const agentId of f.agentIds ?? []) {
    const a = doc.agents[agentId];
    if (a) ops.push({ op: 'agent.setBankSkills', id: agentId, skillIds: [...new Set([...(a.bankSkills ?? []), id])] });
  }
  return ops;
}

/** Create an agent JARVIS proposed (or created on its own), with its SKILL.md, and tell the runner. */
export async function createProposedAgent(p: AgentProposal): Promise<{ ok: boolean; message: string }> {
  const open = useStore.getState().doc;
  // the venture may live in another brain (JARVIS works every brain); the agent is added there
  let home: string | null = null;
  if (!open.agents[p.parentId]) { try { home = libraryDocs().find((x) => x.agents[p.parentId])?.id ?? null; } catch { /* storage unavailable */ } }
  const d = home ? peekBrain(home)!.doc : open;
  const id = `agent_${p.name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 30) || 'new'}_${Date.now().toString(36)}`;
  const bank = p.bankSkillIds.filter((k) => d.skillBank.some((x) => x.id === k));
  const { ops, error } = branchAgentOps(d, p.parentId, { id, name: p.name, specialty: p.specialty || p.skill, purpose: p.purpose, skill: p.skill, window: { everyMinutes: p.everyMinutes, maxMinutes: p.maxMinutes, setBy: 'origin', reason: p.reason || 'Proposed by JARVIS.' }, bankSkillIds: bank });
  // its own SKILL.md, written by JARVIS with the proposal, goes to the bank with it
  const own: DocOp[] = p.skillFile ? [skillFileUpsert(d, id, p.name, { ...p.skillFile, version: SKILL_FILE_VERSION }), { op: 'agent.setBankSkills', id, skillIds: [...bank, skillFileId(id)] }] : [];
  const label = `${p.auto ? 'JARVIS created' : 'Approve'} agent: ${p.name}`;
  let r: { ok: boolean; errors: string[] } | null = null;
  if (error) r = null;
  else if (home) { const x = applyOps(d, [...ops, ...own]); r = { ok: !x.errors.length && useStore.getState().updateBrain(home, () => x.doc, label), errors: x.errors }; }
  else r = useStore.getState().commit([...ops, ...own], label, { silent: true });
  if (!r?.ok) return { ok: false, message: `Couldn't add ${p.name}: ${error ?? r?.errors.join(' · ')}` };
  await agentProposalAction({ action: 'approve', id: p.id, agentId: id });
  return { ok: true, message: `${p.name} is now a branch of ${d.agents[p.parentId]?.identity.name}.` };
}

/** The ops that save a finished file: a shared bank skill, or one agent's SKILL.md (one file can serve several agents with the same job; each gets it under its own name). */
function fileOps(doc: OfficeDoc, f: SkillFile): DocOp[] {
  let d = doc;
  const ops: DocOp[] = f.bank ? bankSkillOps(d, f) : [];
  if (!f.bank) for (const agentId of f.agentIds ?? [f.agentId]) {
    const mine = skillFileOps(d, agentId, f);
    ops.push(...mine);
    if (mine[0]?.op === 'skillBank.upsert') d = { ...d, skillBank: [...d.skillBank, { ...mine[0].skill, createdAt: '' }] };
  }
  return ops;
}

/** The library brain a file belongs in, when it is not the open one: the brain the runner named, else the one its agents live in. */
export function homeBrainOf(open: OfficeDoc, f: Pick<SkillFile, 'agentId' | 'agentIds'> & { brainId?: string }): string | null {
  if (f.brainId && f.brainId !== open.id && peekBrain(f.brainId)) return f.brainId;
  const ids = f.agentIds?.length ? f.agentIds : [f.agentId];
  if (ids.some((id) => open.agents[id])) return null;
  try { return libraryDocs().find((d) => ids.some((id) => d.agents[id]))?.id ?? null; } catch { return null; }
}

/** Keep every agent's SKILL.md flowing: ask JARVIS for missing ones, and save finished ones. */
export function useSkillFiles() {
  const status = useOrigin((s) => s.status);
  const asked = useRef(new Set<string>());
  const saved = useRef(new Set<string>());
  const made = useRef(new Set<string>());
  useEffect(() => {
    if (!status?.configured) return;
    // agents JARVIS created on its own (the owner allowed it): add them to the brain
    for (const p of status.agentProposals ?? []) {
      if (p.status !== 'proposed' || !status.autoAgents || made.current.has(p.id)) continue;
      made.current.add(p.id);
      void createProposedAgent(p).then((r) => { if (!r.ok) void agentProposalAction({ action: 'reject', id: p.id }); });
    }
    for (const f of status.skillFiles ?? []) {
      if (saved.current.has(f.id)) continue;
      saved.current.add(f.id);
      const label = f.bank ? `Add the ${f.skillName ?? f.name} skill` : `Save ${f.agentName}'s SKILL.md`;
      // a file for agents of another brain (JARVIS works every brain) is saved into that brain
      const home = homeBrainOf(useStore.getState().doc, f);
      if (home) {
        let empty = false;
        const ok = useStore.getState().updateBrain(home, (d) => { const ops = fileOps(d, f); empty = !ops.length; const r = applyOps(d, ops); return empty || r.errors.length ? null : r.doc; }, label);
        if (ok || empty) void skillFileImported(f.id);
        else saved.current.delete(f.id);
        continue;
      }
      const ops = fileOps(useStore.getState().doc, f);
      const r = ops.length ? useStore.getState().commit(ops, label, { silent: true }) : null;
      if (!ops.length || r?.ok) void skillFileImported(f.id); // an agent removed since is simply skipped
      else saved.current.delete(f.id);
    }
    for (const id of agentsNeedingSkillFile(useStore.getState().doc, status)) {
      if (asked.current.has(id)) continue;
      asked.current.add(id);
      const d = useStore.getState().doc;
      const again = d.skillBank.some((k) => k.id === skillFileId(id));
      // a new agent's first SKILL.md is written right away, so it has its playbook from the start; rewrites go at the normal pace
      void taskAction({ action: 'add', kind: 'skill-file', version: SKILL_FILE_VERSION, requested: !again, agentId: id, agentName: d.agents[id].identity.name, title: `${again ? 'Rewrite' : 'Write'} ${d.agents[id].identity.name}'s SKILL.md in full detail`, detail: skillFileBrief(d, id) });
    }
  }, [status]);
}
