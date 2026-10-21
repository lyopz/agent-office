// The nerves of the brain are the agents. The main agent (the one that makes
// the others) sits at the core of the brain, fed by the brainstem. Every agent
// it creates grows out of it as a nerve bundle, and every agent those agents
// create branches off again, so the reporting tree reads as a growing nerve
// tree reaching out towards the cortex. Pure and seeded per agent, so the same
// office always grows the same tree. Coordinates are three.js world units,
// y up, +z towards the front of the brain.

export type Vec3 = [number, number, number];
/** A polyline stored flat as x0,y0,z0,x1,y1,z1… */
export type Path3 = number[];

export interface TreeAgent { id: string; name: string; supervisorId: string | null; teamId: string | null; color: string }
export interface NerveNode {
  id: string; name: string; parentId: string | null; depth: number; pos: Vec3; color: string; teamId: string | null;
  /** Agents below this one, itself included. */
  size: number; childIds: string[];
}
export interface NerveBundle {
  /** The agent this bundle grows into; the trunk is 'trunk'. */
  id: string; from: string | null; to: string; color: string; depth: number;
  strands: Path3[];
  /** Small branching fibres at the end of the bundle, where the agent sits. */
  tufts: Path3[];
}
export interface NerveTree { rootId: string | null; nodes: Record<string, NerveNode>; bundles: NerveBundle[]; maxDepth: number }

/** Where the brainstem enters and where the main agent sits. */
export const STEM_BASE: Vec3 = [0, -0.98, -0.3];
export const CORE: Vec3 = [0, -0.04, -0.06];
/** Half-sizes of the cerebrum used to keep nerves inside it. */
export const CEREBRUM: Vec3 = [0.8, 0.56, 0.86];
const CEREBRUM_CENTER: Vec3 = [0, 0.08, 0];

export function hash(s: string) { let h = 2166136261; for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619); return h >>> 0; }
export function rng(seed: number) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const mul = (a: Vec3, k: number): Vec3 => [a[0] * k, a[1] * k, a[2] * k];
const len = (a: Vec3) => Math.hypot(a[0], a[1], a[2]);
const norm = (a: Vec3): Vec3 => { const l = len(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const lerp = (a: Vec3, b: Vec3, t: number): Vec3 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

/** How far a point is from the cerebrum's centre, relative to its surface (1 = on it). */
export function insideCerebrum(p: Vec3) {
  const d = sub(p, CEREBRUM_CENTER);
  return Math.hypot(d[0] / CEREBRUM[0], d[1] / CEREBRUM[1], d[2] / CEREBRUM[2]);
}

/** A point in direction (azimuth, elevation) from the core, `f` of the way to the cortex. */
function towardsCortex(az: number, el: number, f: number): Vec3 {
  const dir: Vec3 = [Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el)];
  // distance from the core to the ellipsoid surface along dir
  const o = sub(CORE, CEREBRUM_CENTER);
  const a = (dir[0] / CEREBRUM[0]) ** 2 + (dir[1] / CEREBRUM[1]) ** 2 + (dir[2] / CEREBRUM[2]) ** 2;
  const b = 2 * (o[0] * dir[0] / CEREBRUM[0] ** 2 + o[1] * dir[1] / CEREBRUM[1] ** 2 + o[2] * dir[2] / CEREBRUM[2] ** 2);
  const c = (o[0] / CEREBRUM[0]) ** 2 + (o[1] / CEREBRUM[1]) ** 2 + (o[2] / CEREBRUM[2]) ** 2 - 1;
  const t = (-b + Math.sqrt(Math.max(0, b * b - 4 * a * c))) / (2 * a);
  return add(CORE, mul(dir, t * f));
}

/** Catmull-Rom through the control points, sampled into n segments. */
function spline(ctrl: Vec3[], n: number): Path3 {
  const out: Path3 = [];
  const p = [ctrl[0], ...ctrl, ctrl[ctrl.length - 1]];
  for (let i = 0; i <= n; i++) {
    const u = (i / n) * (ctrl.length - 1), k = Math.min(ctrl.length - 2, Math.floor(u)), t = u - k;
    const [p0, p1, p2, p3] = [p[k], p[k + 1], p[k + 2], p[k + 3]];
    for (let d = 0; d < 3; d++) {
      out.push(0.5 * (2 * p1[d] + (-p0[d] + p2[d]) * t + (2 * p0[d] - 5 * p1[d] + 4 * p2[d] - p3[d]) * t * t + (-p0[d] + 3 * p1[d] - 3 * p2[d] + p3[d]) * t * t * t));
    }
  }
  return out;
}

/** A bundle of strands from a to b: tight at both ends, fanning out in the middle like a nerve. */
function bundle(a: Vec3, b: Vec3, count: number, spread: number, rand: () => number): Path3[] {
  const axis = norm(sub(b, a));
  const up: Vec3 = Math.abs(axis[1]) > 0.9 ? [1, 0, 0] : [0, 1, 0];
  const u = norm(cross(axis, up)), v = cross(axis, u);
  const bow = mul(norm(sub(lerp(a, b, 0.5), CORE)), len(sub(b, a)) * 0.07); // bundles arc outwards a little
  const strands: Path3[] = [];
  for (let i = 0; i < count; i++) {
    const ang = rand() * Math.PI * 2, r = spread * Math.sqrt(rand());
    const off = (s: number): Vec3 => add(mul(u, Math.cos(ang + s) * r), mul(v, Math.sin(ang + s) * r));
    const twist = (rand() - 0.5) * 0.9;
    const ctrl: Vec3[] = [
      add(a, mul(off(0), 0.12)),
      add(add(lerp(a, b, 0.3), off(twist * 0.3)), mul(bow, 0.7)),
      add(add(lerp(a, b, 0.62), off(twist)), bow),
      add(b, mul(off(twist), 0.18)),
    ];
    strands.push(spline(ctrl, 36));
  }
  return strands;
}

/** Short wandering fibres around an agent: its dendrites, reaching further out on leaf agents. */
function tufts(at: Vec3, outward: Vec3, count: number, reach: number, rand: () => number): Path3[] {
  const out: Path3[] = [];
  for (let i = 0; i < count; i++) {
    let dir = norm(add(outward, [(rand() - 0.5) * 1.6, (rand() - 0.5) * 1.6, (rand() - 0.5) * 1.6]));
    let p = at;
    const pts: Path3 = [...p];
    const steps = 6 + Math.floor(rand() * 5), step = (reach * (0.6 + rand() * 0.6)) / steps;
    for (let s = 0; s < steps; s++) {
      dir = norm(add(dir, [(rand() - 0.5) * 0.7, (rand() - 0.5) * 0.7, (rand() - 0.5) * 0.7]));
      let next = add(p, mul(dir, step));
      if (insideCerebrum(next) > 0.97) { dir = norm(sub(CORE, p)); next = add(p, mul(dir, step)); }
      p = next; pts.push(...p);
    }
    out.push(pts);
  }
  return out;
}

/**
 * The agent tree. The root is `agent_origin` when present, else the top-level
 * agent with the most agents under it; other top-level agents hang off the root.
 */
export function buildNerveTree(agents: TreeAgent[], rootHint = 'agent_origin'): NerveTree {
  const byId = new Map(agents.map((a) => [a.id, a]));
  if (!agents.length) return { rootId: null, nodes: {}, bundles: [], maxDepth: 0 };
  // parent links, with cycles and missing supervisors cut
  const parent = new Map<string, string | null>();
  for (const a of agents) {
    let p = a.supervisorId && byId.has(a.supervisorId) && a.supervisorId !== a.id ? a.supervisorId : null;
    const seen = new Set([a.id]);
    for (let q = p; q; q = byId.get(q)?.supervisorId ?? null) { if (seen.has(q)) { p = null; break; } seen.add(q); if (!byId.has(q)) break; }
    parent.set(a.id, p);
  }
  const kids = new Map<string, string[]>();
  for (const a of [...agents].sort((x, y) => x.name.localeCompare(y.name) || x.id.localeCompare(y.id))) {
    const p = parent.get(a.id);
    if (p) kids.set(p, [...(kids.get(p) ?? []), a.id]);
  }
  const sizeOf = (id: string): number => 1 + (kids.get(id) ?? []).reduce((s, k) => s + sizeOf(k), 0);
  const tops = agents.filter((a) => !parent.get(a.id)).map((a) => a.id);
  const rootId = byId.has(rootHint) && tops.includes(rootHint) ? rootHint : [...tops].sort((x, y) => sizeOf(y) - sizeOf(x) || x.localeCompare(y))[0];
  for (const t of tops) if (t !== rootId) { parent.set(t, rootId); kids.set(rootId, [...(kids.get(rootId) ?? []), t]); }

  const nodes: Record<string, NerveNode> = {};
  const bundles: NerveBundle[] = [];
  let maxDepth = 0;
  const leaves = (id: string): number => { const k = kids.get(id) ?? []; return k.length ? k.reduce((s, c) => s + leaves(c), 0) : 1; };
  const root = byId.get(rootId)!;
  nodes[rootId] = { id: rootId, name: root.name, parentId: null, depth: 0, pos: CORE, color: root.color, teamId: root.teamId, size: sizeOf(rootId), childIds: kids.get(rootId) ?? [] };

  // the brainstem trunk carries everything into the main agent
  const trunkRand = rng(hash(`trunk:${rootId}`));
  bundles.push({ id: 'trunk', from: null, to: rootId, color: root.color, depth: 0, strands: bundle(STEM_BASE, CORE, 8, 0.024, trunkRand), tufts: tufts(CORE, [0, 1, 0], 5, 0.08, trunkRand) });

  // each agent gets a slice of directions (azimuth around the vertical axis) sized by the agents below it
  const place = (id: string, az0: number, az1: number, el: number, depth: number) => {
    const children = kids.get(id) ?? [];
    const total = children.reduce((s, c) => s + leaves(c), 0) || 1;
    let at = az0;
    for (const c of children) {
      const share = ((az1 - az0) * leaves(c)) / total;
      const a = byId.get(c)!, rand = rng(hash(c));
      const d = depth + 1;
      maxDepth = Math.max(maxDepth, d);
      const isLeaf = !(kids.get(c) ?? []).length;
      const az = at + share / 2 + (rand() - 0.5) * share * 0.2;
      const elev = Math.max(-0.45, Math.min(1.05, el + (rand() - 0.5) * 0.5 + (d === 1 ? 0.15 : 0.1)));
      const f = isLeaf ? 0.92 : Math.min(0.82, 0.45 + 0.18 * d);
      const pos = towardsCortex(az, elev, f);
      const from = nodes[id].pos;
      nodes[c] = { id: c, name: a.name, parentId: id, depth: d, pos, color: a.color, teamId: a.teamId, size: sizeOf(c), childIds: kids.get(c) ?? [] };
      const count = Math.min(7, 2 + sizeOf(c));
      const spread = 0.008 + 0.005 * Math.sqrt(sizeOf(c));
      bundles.push({ id: c, from: id, to: c, color: a.color, depth: d, strands: bundle(from, pos, count, spread, rand), tufts: tufts(pos, norm(sub(pos, from)), isLeaf ? 4 : 2, isLeaf ? 0.07 : 0.045, rand) });
      place(c, at, at + share, elev, d);
      at += share;
    }
  };
  place(rootId, -Math.PI, Math.PI, 0.18, 0);
  return { rootId, nodes, bundles, maxDepth };
}

/** The chain of agents from `id` up to the root, `id` first. */
export function pathToRoot(tree: NerveTree, id: string): string[] {
  const out: string[] = [];
  for (let q: string | null = id; q && tree.nodes[q]; q = tree.nodes[q].parentId) out.push(q);
  return out;
}

/** `id` and every agent below it. */
export function subtree(tree: NerveTree, id: string): Set<string> {
  const out = new Set<string>();
  const walk = (q: string) => { if (!tree.nodes[q] || out.has(q)) return; out.add(q); tree.nodes[q].childIds.forEach(walk); };
  walk(id);
  return out;
}

/** The agents a signal passes through from a to b: up to their shared manager, then down. */
export function route(tree: NerveTree, a: string, b: string): string[] {
  const up = pathToRoot(tree, a), down = pathToRoot(tree, b);
  const meet = up.find((q) => down.includes(q));
  if (!meet) return [];
  return [...up.slice(0, up.indexOf(meet) + 1), ...down.slice(0, down.indexOf(meet)).reverse()];
}

/** An idea waiting to become a branch: who it came from and what it says. */
export interface TreeIdea { id: string; title: string; authorId: string | null; byOwner: boolean }
/** A short nerve sprouting from the agent an idea belongs to, ending in a bud. */
export interface IdeaSprout { id: string; title: string; from: string; byOwner: boolean; pos: Vec3; strands: Path3[]; tufts: Path3[] }

/**
 * Ideas sprout as short nerves off their agent (the main agent for the
 * owner's ideas), each ending in a bud. Building an agent from an idea turns
 * the bud into a full branch. Seeded per idea, so a bud keeps its place.
 */
export function ideaSprouts(tree: NerveTree, ideas: TreeIdea[]): IdeaSprout[] {
  if (!tree.rootId) return [];
  return ideas.map((idea) => {
    const from = idea.authorId && tree.nodes[idea.authorId] ? idea.authorId : tree.rootId!;
    const start = tree.nodes[from].pos, rand = rng(hash(`idea:${idea.id}`));
    const outward = from === tree.rootId ? norm([rand() - 0.5, rand() * 0.9 - 0.2, rand() - 0.5]) : norm(sub(start, CORE));
    const dir = norm(add(outward, [(rand() - 0.5) * 1.1, (rand() - 0.5) * 1.1, (rand() - 0.5) * 1.1]));
    let reach = from === tree.rootId ? 0.34 + rand() * 0.18 : 0.16 + rand() * 0.1;
    let pos = add(start, mul(dir, reach));
    while (insideCerebrum(pos) > 0.9 && reach > 0.05) { reach *= 0.8; pos = add(start, mul(dir, reach)); }
    return { id: idea.id, title: idea.title, from, byOwner: idea.byOwner, pos, strands: bundle(start, pos, 4, 0.012, rand), tufts: tufts(pos, dir, 5, 0.06, rand) };
  });
}
