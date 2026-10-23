// The brain universe: every brain the owner started, what they share, and where each sits.
// Brains grow from one another's skills: when a brain opens, bank skills the other brains have
// and it lacks are copied in (tagged with the brain they came from), so a new brain starts with
// everything the others learned. Two brains that share skills are drawn joined by nerves from
// their stems; more shared skills, more nerves.
import type { DocOp } from '../engine/ops';
import type { BankSkill, OfficeDoc } from '../model/types';
import type { BrainSummary } from '../persistence/brains';

export const fromBrainTag = (name: string) => `from-brain:${name}`;

/** Skills of other brains this brain does not have yet, as bank upserts; an agent's own SKILL.md becomes a shared playbook named after its agent and brain. */
export function sharedSkillOps(doc: OfficeDoc, others: { brainId: string; brainName: string; skills: BankSkill[] }[]): DocOp[] {
  const have = new Set((doc.skillBank ?? []).map((k) => k.id));
  const ops: DocOp[] = [];
  for (const o of others) {
    if (o.brainId === doc.id) continue;
    for (const k of o.skills) {
      if (have.has(k.id)) continue;
      have.add(k.id);
      const file = k.id.startsWith('skill_file_');
      const tags = [...new Set([...k.tags.filter((t) => t !== 'owner-file' && !t.startsWith('from-brain:')), fromBrainTag(o.brainName), ...(file ? ['shared-playbook'] : [])])];
      ops.push({ op: 'skillBank.upsert', skill: { id: k.id, name: file ? `${k.name} (from ${o.brainName})` : k.name, description: k.description, instructions: k.instructions, tags } });
    }
  }
  return ops;
}

export interface BrainLink { a: string; b: string; shared: string[]; strength: number }

/** Which brains share skills, and how strongly: built-in skills every brain has count less than skills one brain taught another. */
export function brainLinks(brains: BrainSummary[]): BrainLink[] {
  const links: BrainLink[] = [];
  for (let i = 0; i < brains.length; i++) for (let j = i + 1; j < brains.length; j++) {
    const b = new Set(brains[j].skillIds);
    const shared = brains[i].skillIds.filter((id) => b.has(id));
    if (!shared.length) continue;
    // what every brain is born with (the built-in playbooks, Budget watch, JARVIS's own SKILL.md) is not teaching
    const taught = shared.filter((id) => !id.startsWith('skill_builtin_') && id !== 'skill_budget_watch' && id !== 'skill_file_agent_origin').length;
    links.push({ a: brains[i].id, b: brains[j].id, shared, strength: Math.min(12, 1 + taught * 2 + Math.min(2, shared.length - taught)) });
  }
  return links;
}

/** Where each brain sits: the open brain in the middle, the others on a ring around it (a single brain sits alone). */
export function brainPlaces(brains: BrainSummary[], radius = 2.6): Record<string, [number, number, number]> {
  const out: Record<string, [number, number, number]> = {};
  const open = brains.find((b) => b.open) ?? brains[0];
  if (!open) return out;
  out[open.id] = [0, 0, 0];
  const rest = brains.filter((b) => b.id !== open.id);
  rest.forEach((b, i) => {
    const t = (i / rest.length) * Math.PI * 2; // the first ones to the sides, so they don't hide behind the open brain
    out[b.id] = [Math.cos(t) * radius, 0, Math.sin(t) * radius];
  });
  return out;
}
