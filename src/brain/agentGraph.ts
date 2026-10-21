// Graph POW for agents: every agent, the work they finished and the knowledge
// they wrote, linked by who handed work to whom, who reports to whom, what
// each agent produced and what each piece of work cited. The data uses Graph
// POW's own format, so the same graph can be saved as a standalone Graph POW page.
import { create } from 'zustand';
import type { OfficeDoc, RuntimeState } from '../model/types';
import template from '../../tools/graph-pow/template.html?raw';

export type AgentLinkKind = 'handoff' | 'reports' | 'made' | 'cites';
export interface PowGroup { id: string; count: number; color?: string }
export interface PowNode {
  id: string; name: string; group: string; role: string; purpose: string;
  cluster: string | null; degree: number; in: number; out: number;
  kind: 'agent' | 'work' | 'knowledge'; agentId: string | null; at?: string;
}
export interface PowLink { s: string; t: string; w: number; kinds: Partial<Record<AgentLinkKind, number>>; primary: AgentLinkKind; why: string[] }
export interface PowData { project: string; generated: string; commit: string | null; groups: PowGroup[]; files: PowNode[]; links: PowLink[] }

export const LINK_KINDS: { id: AgentLinkKind; label: string; color: string; verb: string }[] = [
  { id: 'handoff', label: 'Handoffs', color: '#5ad2ff', verb: 'handed work to' },
  { id: 'reports', label: 'Reports to', color: '#b28cff', verb: 'reports to' },
  { id: 'made', label: 'Produced', color: '#78f7b0', verb: 'produced' },
  { id: 'cites', label: 'Cites', color: '#ffc46b', verb: 'cites' },
];
const VERB = Object.fromEntries(LINK_KINDS.map((k) => [k.id, k.verb])) as Record<AgentLinkKind, string>;
/** Most recent finished tasks kept as nodes, so a long-running office stays readable. */
export const MAX_WORK = 160;

const clip = (s: string, n = 60) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

export function buildAgentGraph(doc: OfficeDoc, rt: RuntimeState | null, now = new Date()): PowData {
  const nodes = new Map<string, PowNode>();
  const used = new Set<string>();
  // Graph POW shows the id as the node's title, so ids are readable names made unique
  const uniq = (base: string) => { let id = base, i = 2; while (used.has(id)) id = `${base} (${i++})`; used.add(id); return id; };
  const agentNode: Record<string, string> = {};
  const links = new Map<string, PowLink>();
  const link = (s: string | undefined, t: string | undefined, kind: AgentLinkKind, why: string) => {
    if (!s || !t || s === t) return;
    const key = `${s}\u0000${t}`;
    const l = links.get(key) ?? { s, t, w: 0, kinds: {}, primary: kind, why: [] };
    l.kinds[kind] = (l.kinds[kind] ?? 0) + 1;
    l.w++;
    if (why && l.why.length < 6 && !l.why.includes(why)) l.why.push(why);
    l.primary = (Object.entries(l.kinds) as [AgentLinkKind, number][]).sort((a, b) => b[1] - a[1])[0][0];
    links.set(key, l);
  };

  const agents = Object.values(doc.agents).sort((a, b) => a.identity.name.localeCompare(b.identity.name));
  for (const a of agents) {
    const id = uniq(a.identity.name || a.id);
    agentNode[a.id] = id;
    nodes.set(id, { id, name: a.identity.name, group: a.identity.department || 'Unassigned', role: a.identity.title || 'Agent', purpose: a.identity.roleDescription || a.identity.bio || '', cluster: null, degree: 0, in: 0, out: 0, kind: 'agent', agentId: a.id });
  }
  for (const a of agents) {
    const sup = a.skills.supervisorId;
    if (sup && doc.agents[sup]) link(agentNode[a.id], agentNode[sup], 'reports', `${VERB.reports} ${doc.agents[sup].identity.name}`);
  }

  const projectName = (pid: string | null | undefined) => (pid ? doc.projects[pid]?.name ?? null : null);
  const knowledgeNode: Record<string, string> = {};
  for (const k of Object.values(doc.library).sort((a, b) => a.createdAt.localeCompare(b.createdAt))) {
    const author = k.authorAgentId ? doc.agents[k.authorAgentId] : null;
    const id = uniq(clip(k.title));
    knowledgeNode[k.id] = id;
    nodes.set(id, { id, name: clip(k.title, 40), group: author?.identity.department || 'Library', role: `Knowledge · ${k.topic || 'general'}${k.verification === 'verified' ? ' · verified' : ''}`, purpose: k.sensitive ? 'Restricted entry: only allowed agents can read it.' : k.summary, cluster: projectName(k.projectId), degree: 0, in: 0, out: 0, kind: 'knowledge', agentId: author?.id ?? null, at: k.createdAt });
    if (author) link(agentNode[author.id], id, 'made', `wrote “${clip(k.title, 40)}”`);
  }

  const tasks = Object.values(rt?.tasks ?? {});
  for (const t of tasks) {
    const from = t.handoff?.fromAgentId;
    if (from && t.agentId && doc.agents[from] && doc.agents[t.agentId]) link(agentNode[from], agentNode[t.agentId], 'handoff', `handed over “${clip(t.name, 40)}”`);
  }
  const done = tasks.filter((t) => t.status === 'done' && t.agentId && doc.agents[t.agentId]).sort((a, b) => (b.completedAt ?? '').localeCompare(a.completedAt ?? '')).slice(0, MAX_WORK);
  for (const t of done) {
    const a = doc.agents[t.agentId!];
    const id = uniq(`✓ ${clip(t.name, 48)}`);
    nodes.set(id, { id, name: clip(t.name, 40), group: a.identity.department || 'Unassigned', role: `Finished work by ${a.identity.name}${t.simulated ? ' (simulated)' : ''}`, purpose: t.handoff?.deliverable || t.description || '', cluster: projectName(t.projectId), degree: 0, in: 0, out: 0, kind: 'work', agentId: a.id, at: t.completedAt });
    link(agentNode[a.id], id, 'made', `finished “${clip(t.name, 40)}”`);
    for (const ref of t.libraryRefs ?? []) if (knowledgeNode[ref]) link(id, knowledgeNode[ref], 'cites', `cites “${clip(doc.library[ref].title, 40)}”`);
  }

  const nbrs = new Map<string, Set<string>>();
  for (const l of links.values()) {
    nodes.get(l.s)!.out++; nodes.get(l.t)!.in++;
    (nbrs.get(l.s) ?? nbrs.set(l.s, new Set()).get(l.s)!).add(l.t);
    (nbrs.get(l.t) ?? nbrs.set(l.t, new Set()).get(l.t)!).add(l.s);
  }
  for (const n of nodes.values()) n.degree = nbrs.get(n.id)?.size ?? 0;
  const files = [...nodes.values()];
  const count = new Map<string, number>();
  for (const f of files) count.set(f.group, (count.get(f.group) ?? 0) + 1);
  // teams keep the colour they have in the brain
  const deps = Object.values(doc.departments ?? {});
  const groups = [...count.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([id, c]) => {
    const color = deps.find((d) => d.name.toLowerCase() === id.toLowerCase())?.color;
    return color ? { id, count: c, color } : { id, count: c };
  });
  return { project: doc.name || 'Agent Office', generated: now.toISOString().slice(0, 16).replace('T', ' '), commit: null, groups, files, links: [...links.values()] };
}

/** The node id Graph POW uses for an agent (its name, made unique). */
export function agentNodeId(data: PowData, agentId: string): string | null {
  return data.files.find((f) => f.kind === 'agent' && f.agentId === agentId)?.id ?? null;
}

// ---------- standalone page ----------

/** Text swaps that turn the file-map template into the agent map. Each one must match the template exactly once. */
export const TEMPLATE_SWAPS: [string, string][] = [
  ['placeholder="Find a file, symbol or purpose" aria-label="Search files"', 'placeholder="Find an agent, task or knowledge" aria-label="Search agents and knowledge"'],
  ['aria-label="Folders"><span class="lbl">Folders</span>', 'aria-label="Teams"><span class="lbl">Teams</span>'],
  ['aria-label="File relationship graph. Use search to select a file; details appear in the side panel."', 'aria-label="Agent knowledge graph. Use search to select an agent or piece of work; details appear in the side panel."'],
  ['Size shows how many files it touches', 'Size shows how much it connects to'],
  ['Colour shows its folder', 'Colour shows its team'],
  ['Signals fire from a file into what it depends on', 'Signals fire when an agent hands off or finishes work'],
  [`const KINDS = [
  { id: 'imports', label: 'Imports', color: tok('--k-imports') },
  { id: 'calls', label: 'Calls', color: tok('--k-calls') },
  { id: 'types', label: 'Types', color: tok('--k-types') },
  { id: 'tests', label: 'Tests', color: tok('--k-tests') },
  { id: 'docs', label: 'Docs', color: tok('--k-docs') },
];`, `const KINDS = ${JSON.stringify(LINK_KINDS.map(({ id, label, color }) => ({ id, label, color })))};`],
  [`const VERB = { imports: 'imports', calls: 'calls', types: 'uses types from', tests: 'tests', docs: 'documents' };`, `const VERB = ${JSON.stringify(VERB)};`],
  ['${n.degree} connected files', '${n.degree} connections'],
  ['${nodes.length} files in ${groups.length} folders, joined by ${links.length} relationships. Each glowing lobe is a folder; brighter, larger nodes touch more of the codebase.', '${nodes.length} agents, finished tasks and knowledge entries in ${groups.length} teams, joined by ${links.length} links. Each glowing lobe is a team; brighter, larger nodes connect to more of the operation.'],
  ['<h3>Most connected files</h3>', '<h3>Most connected</h3>'],
  ['${t.degree} files</span>', '${t.degree} links</span>'],
  ['No description yet. Add one to purposes.json to explain this file.', 'No description yet.'],
  ['title="graphify community"', 'title="Project"'],
  ["'Pick a file to trace to…'", "'Pick a node to trace to…'"],
  ['Turn on more link types or folders to see its neighbours.', 'Turn on more link types or teams to see its neighbours.'],
  ['title="Double-click to show only this folder"', 'title="Double-click to show only this team"'],
  ["${nodes.length} files · ${links.length} links · ${groups.length} folders", "${nodes.length} nodes · ${links.length} links · ${groups.length} teams"],
];

/** A standalone Graph POW page for the agent graph. Agent text is escaped so it can't break out of the data block. */
export function agentGraphPowHtml(data: PowData, tpl: string = template): string {
  let html = tpl;
  for (const [from, to] of TEMPLATE_SWAPS) html = html.split(from).join(to);
  const json = JSON.stringify(data).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026');
  const title = data.project.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
  html = html.split('__PROJECT_NAME__').join(`${title} agents`).replace('__GRAPH_DATA__', () => json);
  return `<!doctype html>\n<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">\n${html}\n</html>\n`;
}

// ---------- in-app panel state ----------

interface PowState { open: boolean; focus: string | null; pulses: { agentId: string; at: number }[] }
export const useGraphPow = create<PowState>(() => ({ open: false, focus: null, pulses: [] }));

export function openAgentGraphPow(focusAgentId: string | null = null) { useGraphPow.setState({ open: true, focus: focusAgentId }); }
export function closeAgentGraphPow() { useGraphPow.setState({ open: false, focus: null }); }
/** Light an agent in Graph POW: called when it finishes work. */
export function fireAgentGraph(agentId: string) {
  const now = Date.now();
  useGraphPow.setState((s) => ({ pulses: [...s.pulses.filter((p) => now - p.at < 3000), { agentId, at: now }].slice(-30) }));
}
