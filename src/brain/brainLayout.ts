// The agent brain: each team is a lobe, each agent a ball inside it, and the
// links between them are who reports to whom and who handed work to whom.
// The knowledge core sits in the middle; finished work flows into it and on
// to Graph POW. Pure functions so the layout is deterministic and testable.
import type { OfficeDoc, RuntimeState } from '../model/types';

export interface Pt { x: number; y: number }
export interface BrainLobe { id: string; name: string; color: string; x: number; y: number; r: number; agentIds: string[] }
export interface BrainNode { id: string; lobeId: string; x: number; y: number }
export interface BrainEdge { id: string; from: string; to: string; kind: 'reports' | 'handoff'; weight: number; live: boolean }
export interface BrainLayout {
  width: number; height: number;
  outline: string;          // cerebrum silhouette
  cerebellum: string;
  cerebellumFolds: string[];
  stem: string;
  folds: string[];          // decorative sulci
  core: Pt & { r: number };
  lobes: BrainLobe[];
  nodes: Record<string, BrainNode>;
  edges: BrainEdge[];
}

export const BALL_R = 20;
const SPACING = 58;
const PALETTE = ['#5ad2ff', '#b28cff', '#ff7ad6', '#ffc46b', '#78f7b0', '#7f9cff', '#ff9a74', '#4ff0d0', '#e0a8ff', '#c8f06e'];

function hash(s: string) { let h = 2166136261; for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619); return h >>> 0; }

/** Smooth closed path through points (Catmull-Rom as cubic Béziers). */
export function smoothPath(pts: Pt[], closed = true): string {
  const n = pts.length;
  if (n < 2) return '';
  const p = (i: number) => pts[closed ? (i + n) % n : Math.max(0, Math.min(n - 1, i))];
  let d = `M${p(0).x.toFixed(1)},${p(0).y.toFixed(1)}`;
  for (let i = 0; i < (closed ? n : n - 1); i++) {
    const p0 = p(i - 1), p1 = p(i), p2 = p(i + 1), p3 = p(i + 2);
    const c1 = { x: p1.x + (p2.x - p0.x) / 6, y: p1.y + (p2.y - p0.y) / 6 };
    const c2 = { x: p2.x - (p3.x - p1.x) / 6, y: p2.y - (p3.y - p1.y) / 6 };
    d += ` C${c1.x.toFixed(1)},${c1.y.toFixed(1)} ${c2.x.toFixed(1)},${c2.y.toFixed(1)} ${p2.x.toFixed(1)},${p2.y.toFixed(1)}`;
  }
  return closed ? `${d}Z` : d;
}

/** A side-view brain silhouette: lumpy cerebrum, flatter underside, fuller frontal lobe. */
function cerebrum(cx: number, cy: number, rx: number, ry: number): Pt[] {
  const pts: Pt[] = [];
  const N = 72;
  for (let i = 0; i < N; i++) {
    const t = (i / N) * Math.PI * 2;
    const c = Math.cos(t), s = Math.sin(t);
    const bump = 1 + 0.022 * Math.sin(t * 15 + 0.6) + 0.012 * Math.sin(t * 7);
    const under = s > 0 ? 0.8 + 0.12 * c : 1;        // flatter bottom, the temporal lobe dips at the front
    const front = c < 0 ? 1 + 0.06 * -c * (s < 0 ? 1 : 0.4) : 1; // rounder, taller forehead
    pts.push({ x: cx + rx * c * bump, y: cy + ry * s * bump * under * front });
  }
  return pts;
}

/** Where a point sits inside the cerebrum ellipse (1 = on the edge). */
const ellipseT = (p: Pt, cx: number, cy: number, rx: number, ry: number) => Math.hypot((p.x - cx) / rx, (p.y - cy) / ry);

interface Team { id: string; name: string; color: string; agentIds: string[] }

function teams(doc: OfficeDoc): Team[] {
  const by = new Map<string, string[]>();
  for (const a of Object.values(doc.agents).sort((x, y) => x.identity.name.localeCompare(y.identity.name))) {
    const d = a.identity.department || 'Unassigned';
    by.set(d, [...(by.get(d) ?? []), a.id]);
  }
  const deps = Object.values(doc.departments ?? {});
  return [...by.entries()].map(([name, agentIds]) => {
    const dep = deps.find((d) => d.name.toLowerCase() === name.toLowerCase() || d.id === name);
    return { id: `lobe:${name}`, name, color: dep?.color || PALETTE[hash(name) % PALETTE.length], agentIds };
  });
}

/** Supervisor links plus every handoff a task recorded; live while that work is still moving. */
export function brainEdges(doc: OfficeDoc, rt: RuntimeState | null): BrainEdge[] {
  const out = new Map<string, BrainEdge>();
  for (const a of Object.values(doc.agents)) {
    const sup = a.skills.supervisorId;
    if (sup && sup !== a.id && doc.agents[sup]) out.set(`r:${a.id}>${sup}`, { id: `r:${a.id}>${sup}`, from: a.id, to: sup, kind: 'reports', weight: 1, live: false });
  }
  for (const t of Object.values(rt?.tasks ?? {})) {
    const from = t.handoff?.fromAgentId, to = t.agentId;
    if (!from || !to || from === to || !doc.agents[from] || !doc.agents[to]) continue;
    const id = `h:${from}>${to}`;
    const e = out.get(id) ?? { id, from, to, kind: 'handoff' as const, weight: 0, live: false };
    e.weight++;
    if (t.status === 'in-transit' || t.status === 'queued' || t.status === 'active') e.live = true;
    out.set(id, e);
  }
  return [...out.values()].sort((a, b) => a.id.localeCompare(b.id));
}

/** Order teams around the brain so teams that work together sit side by side. */
function orderTeams(list: Team[], edges: BrainEdge[], lobeOf: Map<string, string>): Team[] {
  if (list.length < 3) return list;
  const w = new Map<string, number>();
  for (const e of edges) {
    const a = lobeOf.get(e.from)!, b = lobeOf.get(e.to)!;
    if (a === b) continue;
    const k = [a, b].sort().join('|');
    w.set(k, (w.get(k) ?? 0) + e.weight);
  }
  const weight = (a: string, b: string) => w.get([a, b].sort().join('|')) ?? 0;
  const left = [...list].sort((a, b) => b.agentIds.length - a.agentIds.length || a.name.localeCompare(b.name));
  const order = [left.shift()!];
  while (left.length) {
    const last = order[order.length - 1];
    left.sort((a, b) => weight(last.id, b.id) - weight(last.id, a.id) || b.agentIds.length - a.agentIds.length || a.name.localeCompare(b.name));
    order.push(left.shift()!);
  }
  return order;
}

export function layoutBrain(doc: OfficeDoc, rt: RuntimeState | null): BrainLayout {
  const edges = brainEdges(doc, rt);
  const raw = teams(doc);
  const lobeOf = new Map<string, string>();
  for (const t of raw) for (const id of t.agentIds) lobeOf.set(id, t.id);
  const list = orderTeams(raw, edges, lobeOf);
  const lobeR = (n: number) => SPACING * Math.sqrt(n) * 0.62 + 36;

  // size the brain to fit its teams, never smaller than the default
  const area = list.reduce((s, t) => s + Math.PI * (lobeR(t.agentIds.length) + 18) ** 2, 0) + Math.PI * 90 ** 2;
  const k = Math.max(1, Math.sqrt(area / (Math.PI * 470 * 300 * 0.55)));
  const rx = 470 * k, ry = 300 * k;
  const pad = 70;
  const width = rx * 2 + pad * 2, height = ry * 2 + pad * 2 + 90 * k;
  const cx = pad + rx, cy = pad + ry;
  const core = { x: cx + 10 * k, y: cy + 8 * k, r: 46 * k };

  // the team whose agents sit highest in the reporting chain gets the crown; the rest go round the core
  const isTop = (id: string) => !doc.agents[id]?.skills.supervisorId;
  const crown = list.find((t) => t.agentIds.some(isTop) && list.length > 1);
  const ring = list.filter((t) => t !== crown);
  const lobes: BrainLobe[] = [];
  if (crown) lobes.push({ id: crown.id, name: crown.name, color: crown.color, x: cx, y: cy - ry * 0.62, r: lobeR(crown.agentIds.length), agentIds: crown.agentIds });
  ring.forEach((t, i) => {
    // spread round the core starting at the front (left), skipping the crown's spot at the top
    const span = crown ? Math.PI * 1.62 : Math.PI * 2;
    const start = crown ? -Math.PI / 2 + (Math.PI * 2 - span) / 2 : Math.PI;
    const a = start + (ring.length === 1 ? span / 2 : (i + 0.5) * (span / ring.length));
    lobes.push({ id: t.id, name: t.name, color: t.color, x: cx + Math.cos(a) * rx * 0.64, y: cy + Math.sin(a) * ry * 0.6, r: lobeR(t.agentIds.length), agentIds: t.agentIds });
  });

  // relax: lobes (with their labels on top) push apart from each other and from the core and its caption, then stay inside the skull
  const LABEL = 14; // a lobe's label sits above it, so its footprint reaches a little higher
  for (let it = 0; it < 160; it++) {
    for (let i = 0; i < lobes.length; i++) {
      const A = lobes[i];
      for (let j = i + 1; j < lobes.length; j++) {
        const B = lobes[j];
        const dx = B.x - A.x, dy = B.y - A.y, d = Math.hypot(dx, dy) || 0.01;
        const min = A.r + B.r + 28 + LABEL * 2;
        if (d < min) { const m = (min - d) / 2; A.x -= (dx / d) * m; A.y -= (dy / d) * m; B.x += (dx / d) * m; B.y += (dy / d) * m; }
      }
      // the core's caption hangs below it, so treat the core as a little lower and larger
      const kc = { x: core.x, y: core.y + 16 * k, r: core.r + 30 * k };
      const dx = A.x - kc.x, dy = A.y - LABEL - kc.y, d = Math.hypot(dx, dy) || 0.01;
      const min = A.r + LABEL + kc.r + 18;
      if (d < min) { A.x = kc.x + (dx / d) * min; A.y = kc.y + (dy / d) * min + LABEL; }
      const t = ellipseT(A, cx, cy, rx - A.r - 16, ry - A.r - 16 - LABEL);
      if (t > 1) { A.x = cx + (A.x - cx) / t; A.y = cy + (A.y - cy) / t; }
    }
  }

  // agents: a sunflower spiral inside each lobe, supervisors at the centre
  const nodes: Record<string, BrainNode> = {};
  const golden = Math.PI * (3 - Math.sqrt(5));
  for (const L of lobes) {
    const ids = [...L.agentIds].sort((a, b) => Number(isTop(b)) - Number(isTop(a)) || reportsTo(doc, b, L.agentIds) - reportsTo(doc, a, L.agentIds));
    const n = ids.length;
    ids.forEach((id, i) => {
      const rr = n === 1 ? 0 : SPACING * 0.62 * Math.sqrt(i + (n > 1 ? 0.5 : 0));
      const a = i * golden;
      nodes[id] = { id, lobeId: L.id, x: L.x + Math.cos(a) * rr, y: L.y + Math.sin(a) * rr };
    });
  }

  const s = (x: number, y: number) => ({ x: cx + x * rx, y: cy + y * ry });
  const folds = [
    [s(-0.06, -0.98), s(-0.1, -0.6), s(-0.04, -0.3), s(-0.14, 0.02)],          // central sulcus
    [s(-0.78, 0.38), s(-0.42, 0.22), s(-0.08, 0.3), s(0.28, 0.2)],            // lateral fissure
    [s(0.62, -0.72), s(0.5, -0.42), s(0.62, -0.12)],                           // parieto-occipital
    [s(-0.6, -0.62), s(-0.5, -0.3), s(-0.66, -0.02)],
    [s(-0.5, 0.62), s(-0.2, 0.56), s(0.12, 0.66)],
    [s(0.3, -0.9), s(0.24, -0.6), s(0.36, -0.36)],
  ].map((p) => smoothPath(p, false));

  const cb = { x: cx + rx * 0.5, y: cy + ry * 0.74 };
  const cerebellumPts: Pt[] = [];
  for (let i = 0; i < 40; i++) {
    const t = (i / 40) * Math.PI * 2;
    const b = 1 + 0.04 * Math.sin(t * 12);
    cerebellumPts.push({ x: cb.x + Math.cos(t) * rx * 0.3 * b, y: cb.y + Math.sin(t) * ry * 0.26 * b });
  }
  const stem = smoothPath([{ x: cx + rx * 0.12, y: cy + ry * 0.7 }, { x: cx + rx * 0.17, y: cy + ry * 1.0 }, { x: cx + rx * 0.2, y: cy + ry * 1.24 }, { x: cx + rx * 0.3, y: cy + ry * 1.24 }, { x: cx + rx * 0.3, y: cy + ry * 0.96 }, { x: cx + rx * 0.32, y: cy + ry * 0.7 }]);

  // the cerebellum's fine horizontal folds
  const cbFolds = [-0.35, 0, 0.35, 0.65].map((f) => smoothPath([
    { x: cb.x - rx * 0.26 * Math.sqrt(1 - f * f * 0.6), y: cb.y + ry * 0.26 * f },
    { x: cb.x, y: cb.y + ry * 0.26 * f + ry * 0.05 },
    { x: cb.x + rx * 0.26 * Math.sqrt(1 - f * f * 0.6), y: cb.y + ry * 0.26 * f },
  ], false));
  return { width, height, outline: smoothPath(cerebrum(cx, cy, rx, ry)), cerebellum: smoothPath(cerebellumPts), cerebellumFolds: cbFolds, stem, folds, core, lobes, nodes, edges };
}

/** How many teammates report to this agent (so leads sit in the middle of their lobe). */
function reportsTo(doc: OfficeDoc, id: string, ids: string[]) {
  return ids.filter((x) => doc.agents[x]?.skills.supervisorId === id).length;
}

/** A gentle curve between two balls, bowed away from the brain's centre so links don't pile up. */
export function edgePath(a: Pt, b: Pt, bow = 0.18): string {
  const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
  const dx = b.x - a.x, dy = b.y - a.y;
  const c = { x: mx - dy * bow, y: my + dx * bow };
  return `M${a.x.toFixed(1)},${a.y.toFixed(1)} Q${c.x.toFixed(1)},${c.y.toFixed(1)} ${b.x.toFixed(1)},${b.y.toFixed(1)}`;
}

/** Point t (0..1) along the same curve as edgePath. */
export function pointOnEdge(a: Pt, b: Pt, t: number, bow = 0.18): Pt {
  const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
  const c = { x: mx - (b.y - a.y) * bow, y: my + (b.x - a.x) * bow };
  const u = 1 - t;
  return { x: u * u * a.x + 2 * u * t * c.x + t * t * b.x, y: u * u * a.y + 2 * u * t * c.y + t * t * b.y };
}
