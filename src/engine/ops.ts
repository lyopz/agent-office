// Structured operations: the only way the brain's document changes. Manual
// UI edits, JARVIS's branches and approvals all produce `DocOp[]`, which are
// applied atomically: one error and nothing changes.
import { produce, type Draft } from 'immer';
import type { Agent, AlertSettings, AppearanceSettings, BankSkill, ControlSettings, KnowledgeEntry, OfficeDoc, Project, SkillRequest, ThemeDef } from '../model/types';
import { ARCHETYPE, agentFromArchetype, makeAgent, uid } from '../model/defaults';

export type DeepPartial<T> = { [K in keyof T]?: T[K] extends (infer _U)[] ? T[K] : T[K] extends object ? DeepPartial<T[K]> : T[K] };

export type DocOp =
  | { op: 'agent.createFromArchetype'; archetype: string; name: string; id?: string }
  | { op: 'appearance.update'; patch: Partial<Pick<AppearanceSettings, 'mode' | 'themeId'>> }
  /** The holographic colour of one brain ('main', a team id or an agent id); null goes back to the default. */
  | { op: 'brain.setColor'; brain: string; color: string | null }
  | { op: 'theme.upsert'; theme: ThemeDef }
  | { op: 'theme.delete'; id: string }
  | { op: 'alerts.update'; patch: DeepPartial<AlertSettings> }
  | { op: 'project.upsert'; project: Project }
  | { op: 'project.delete'; id: string }
  | { op: 'library.upsert'; entry: KnowledgeEntry }
  | { op: 'library.delete'; id: string }
  | { op: 'agent.create'; name: string; title?: string; department?: string; id?: string }
  | { op: 'agent.update'; id: string; patch: DeepPartial<Omit<Agent, 'id'>> }
  | { op: 'agent.delete'; id: string }
  | { op: 'agent.duplicate'; id: string; newId?: string }
  | { op: 'office.rename'; name: string }
  | { op: 'control.update'; patch: DeepPartial<ControlSettings> }
  | { op: 'skillBank.upsert'; skill: Omit<BankSkill, 'createdAt'> & { createdAt?: string } }
  | { op: 'skillBank.remove'; id: string }
  | { op: 'agent.setBankSkills'; id: string; skillIds: string[] }
  | { op: 'skillRequest.create'; request: Pick<SkillRequest, 'id' | 'fromAgentId' | 'name' | 'skill' | 'specialty' | 'purpose'> }
  | { op: 'skillRequest.review'; id: string; relevant: boolean; note: string }
  | { op: 'skillRequest.decide'; id: string; approve: boolean; agentId?: string };

export interface ApplyResult { doc: OfficeDoc; summary: string[]; errors: string[] }

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Recursive merge: only keys present in the patch change; arrays are replaced. */
export function deepMerge<T>(target: T, patch: unknown): void {
  if (!isPlainObject(patch)) return;
  const t = target as Record<string, unknown>;
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined) continue;
    if (isPlainObject(v) && isPlainObject(t[k])) deepMerge(t[k], v);
    else t[k] = Array.isArray(v) ? [...v] : v;
  }
}

function applyOne(doc: Draft<OfficeDoc>, o: DocOp, summary: string[], errors: string[]) {
  switch (o.op) {
    case 'agent.createFromArchetype': {
      if (!ARCHETYPE[o.archetype]) { errors.push(`Unknown archetype ${o.archetype}`); return; }
      const a = agentFromArchetype(o.archetype, o.name);
      if (o.id) a.id = o.id;
      doc.agents[a.id] = a;
      summary.push(`Created ${a.identity.name}`);
      return;
    }
    case 'appearance.update':
      if (o.patch.themeId && !doc.appearance.themes.some((t) => t.id === o.patch.themeId)) { errors.push('Theme not found'); return; }
      Object.assign(doc.appearance, o.patch);
      summary.push(o.patch.mode ? `Interface mode: ${o.patch.mode}` : 'Changed interface theme');
      return;
    case 'brain.setColor': {
      if (!o.brain) { errors.push('Which brain?'); return; }
      doc.appearance.brainColors ??= {};
      if (o.color === null) { delete doc.appearance.brainColors[o.brain]; summary.push('Brain colour back to default'); return; }
      if (!/^#[0-9a-f]{6}$/i.test(o.color)) { errors.push('Colour must be #rrggbb'); return; }
      doc.appearance.brainColors[o.brain] = o.color.toLowerCase();
      summary.push(`Brain colour ${o.color.toLowerCase()}`);
      return;
    }
    case 'theme.upsert': {
      const i = doc.appearance.themes.findIndex((t) => t.id === o.theme.id);
      if (i >= 0) doc.appearance.themes[i] = o.theme; else doc.appearance.themes.push(o.theme);
      summary.push(`${i >= 0 ? 'Updated' : 'Saved'} theme ${o.theme.name}`);
      return;
    }
    case 'theme.delete': {
      const t = doc.appearance.themes.find((x) => x.id === o.id);
      if (!t) { errors.push('Theme not found'); return; }
      if (doc.appearance.themes.length <= 1) { errors.push('Keep at least one theme'); return; }
      doc.appearance.themes = doc.appearance.themes.filter((x) => x.id !== o.id);
      if (doc.appearance.themeId === o.id) doc.appearance.themeId = doc.appearance.themes[0].id;
      summary.push(`Deleted theme ${t.name}`);
      return;
    }
    case 'alerts.update':
      deepMerge(doc.alertSettings, o.patch);
      summary.push('Updated alert settings');
      return;
    case 'project.upsert':
      doc.projects[o.project.id] = o.project; summary.push(`Saved project ${o.project.name}`);
      return;
    case 'control.update':
      deepMerge(doc.control, o.patch);
      summary.push(o.patch.emergencyStop === true ? 'Emergency pause: all agents stopped' : o.patch.emergencyStop === false ? 'Emergency pause lifted' : 'Updated control settings');
      return;
    case 'project.delete':
      if (!doc.projects[o.id]) { errors.push('Project not found'); return; }
      summary.push(`Deleted project ${doc.projects[o.id].name}`); delete doc.projects[o.id];
      return;
    case 'skillBank.upsert': {
      const k = o.skill, name = k.name.trim();
      if (!name || !k.instructions.trim()) { errors.push('A bank skill needs a name and instructions'); return; }
      if (doc.skillBank.some((x) => x.id !== k.id && x.name.toLowerCase() === name.toLowerCase())) { errors.push(`The bank already has a skill called ${name}`); return; }
      const next: BankSkill = { id: k.id, name, description: k.description.trim(), instructions: k.instructions.trim(), tags: k.tags.map((t) => t.trim()).filter(Boolean), createdAt: k.createdAt ?? new Date().toISOString() };
      const i = doc.skillBank.findIndex((x) => x.id === k.id);
      if (i >= 0) { next.createdAt = doc.skillBank[i].createdAt; doc.skillBank[i] = next; summary.push(`Updated bank skill ${name}`); }
      else { doc.skillBank.push(next); summary.push(`Added ${name} to the skill bank`); }
      return;
    }
    case 'skillBank.remove': {
      const i = doc.skillBank.findIndex((x) => x.id === o.id);
      if (i < 0) { errors.push('Bank skill not found'); return; }
      summary.push(`Removed ${doc.skillBank[i].name} from the skill bank`);
      doc.skillBank.splice(i, 1);
      for (const a of Object.values(doc.agents)) if (a.bankSkills?.includes(o.id)) a.bankSkills = a.bankSkills.filter((x) => x !== o.id);
      return;
    }
    case 'agent.setBankSkills': {
      const a = doc.agents[o.id];
      if (!a) { errors.push('Agent not found'); return; }
      const missing = o.skillIds.filter((x) => !doc.skillBank.some((k) => k.id === x));
      if (missing.length) { errors.push('That skill is not in the bank'); return; }
      a.bankSkills = [...new Set(o.skillIds)];
      summary.push(`${a.identity.name} now uses ${a.bankSkills.length} bank skill${a.bankSkills.length === 1 ? '' : 's'}`);
      return;
    }
    case 'skillRequest.create': {
      const r = o.request, from = doc.agents[r.fromAgentId];
      if (!from || from.branch?.kind !== 'skill' || !from.branch.ventureId || !doc.agents[from.branch.ventureId]) { errors.push('Only a skill agent working for a venture can file a skill request'); return; }
      if (!r.name.trim() || !r.purpose.trim()) { errors.push('A skill request needs a name and how it helps the venture'); return; }
      if (doc.skillRequests.some((x) => x.id === r.id)) { errors.push('That request already exists'); return; }
      doc.skillRequests.push({ ...r, ventureId: from.branch.ventureId, status: 'venture-review', ventureNote: '', createdAt: new Date().toISOString(), decidedAt: null, agentId: null });
      summary.push(`${from.identity.name} asked ${doc.agents[from.branch.ventureId].identity.name} for a ${r.skill} skill agent`);
      return;
    }
    case 'skillRequest.review': {
      const r = doc.skillRequests.find((x) => x.id === o.id);
      if (!r) { errors.push('Skill request not found'); return; }
      if (r.status !== 'venture-review') { errors.push('That request has already been reviewed'); return; }
      r.status = o.relevant ? 'owner-review' : 'not-relevant'; r.ventureNote = o.note.trim();
      if (!o.relevant) r.decidedAt = new Date().toISOString();
      summary.push(`${doc.agents[r.ventureId]?.identity.name ?? 'The venture'} judged “${r.name}” ${o.relevant ? 'relevant; it now waits for the owner' : 'not relevant'}`);
      return;
    }
    case 'skillRequest.decide': {
      const r = doc.skillRequests.find((x) => x.id === o.id);
      if (!r) { errors.push('Skill request not found'); return; }
      if (r.status !== 'owner-review') { errors.push('Only a request its venture judged relevant can be decided'); return; }
      if (o.approve) {
        const a = o.agentId ? doc.agents[o.agentId] : null;
        if (!a || a.branch?.kind !== 'skill' || a.branch.ventureId !== r.ventureId) { errors.push('Approving a request needs the new skill agent under its venture'); return; }
        r.agentId = a.id;
      }
      r.status = o.approve ? 'approved' : 'denied'; r.decidedAt = new Date().toISOString();
      summary.push(`Owner ${o.approve ? 'approved' : 'denied'} “${r.name}”`);
      return;
    }
    case 'library.upsert':
      doc.library[o.entry.id] = o.entry; summary.push(`Filed “${o.entry.title}” in the library`);
      return;
    case 'library.delete':
      if (!doc.library[o.id]) { errors.push('Library entry not found'); return; }
      summary.push(`Removed “${doc.library[o.id].title}” from the library`); delete doc.library[o.id];
      return;
    case 'agent.create': {
      const a = makeAgent(o.name, o.title ?? 'Generalist', o.department ?? 'Operations');
      if (o.id) a.id = o.id;
      doc.agents[a.id] = a;
      summary.push(`Created agent ${a.identity.name}`);
      return;
    }
    case 'agent.update': {
      const a = doc.agents[o.id];
      if (!a) { errors.push(`Agent ${o.id} not found`); return; }
      const p = o.patch as Record<string, unknown>;
      if ('id' in p) { errors.push('Agent IDs are immutable'); return; }
      deepMerge(a, p);
      summary.push(`Updated ${a.identity.name}: ${Object.keys(p).join(', ')}`);
      return;
    }
    case 'agent.delete': {
      const a = doc.agents[o.id];
      if (!a) { errors.push('Agent not found'); return; }
      for (const other of Object.values(doc.agents)) if (other.skills.supervisorId === a.id) other.skills.supervisorId = null;
      delete doc.agents[a.id];
      summary.push(`Deleted agent ${a.identity.name}`);
      return;
    }
    case 'agent.duplicate': {
      const a = doc.agents[o.id];
      if (!a) { errors.push('Agent not found'); return; }
      const copy: Agent = JSON.parse(JSON.stringify(a));
      copy.id = o.newId ?? uid('agent'); copy.identity.name = `${a.identity.name} (copy)`; copy.identity.createdAt = new Date().toISOString();
      copy.memory = copy.memory.filter((m) => m.persistent);
      doc.agents[copy.id] = copy;
      summary.push(`Duplicated ${a.identity.name}`);
      return;
    }
    case 'office.rename':
      doc.name = o.name; summary.push(`Renamed the brain to ${o.name}`);
      return;
  }
}

export function applyOps(doc: OfficeDoc, ops: DocOp[]): ApplyResult {
  const summary: string[] = []; const errors: string[] = [];
  const next = produce(doc, (d) => {
    for (const o of ops) { applyOne(d, o, summary, errors); if (errors.length) return; }
  });
  if (errors.length) return { doc, summary: [], errors };
  return { doc: next, summary, errors };
}
