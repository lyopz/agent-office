// The agent brain as a connectome: no outline and no agents, just dense
// tangles of nerve fibres. Each team is a region in its own colour, nerve
// tracts join teams that report to or hand work to each other, and the
// information the agents produced sits in their region as small nodes the
// brain can go back to. Pure and seeded, so the same office always grows
// the same brain.
import type { OfficeDoc, RuntimeState } from '../model/types';

export interface Pt { x: number; y: number }
export interface Region { id: string; name: string; color: string; x: number; y: number; rx: number; ry: number; rim: boolean; agentIds: string[] }
/** A polyline stored flat as x0,y0,x1,y1… */
export type Path = number[];
export interface Fiber { regionId: string; pts: Path; color: string; width: number; alpha: number }
export interface Tract { a: string; b: string; weight: number; curves: Path[] }
export interface RimDot { x: number; y: number; r: number; color: string }
export interface Connectome { width: number; height: number; regions: Region[]; fibers: Fiber[]; tracts: Tract[]; rim: RimDot[] }

export interface TeamLink { a: string; b: string; weight: number }
export interface InfoNode {
  id: string; kind: 'knowledge' | 'work'; title: string; summary: string;
  regionId: string; agentId: string | null; at: string; important: boolean;
}

export const WIDTH = 1600, HEIGHT = 900;
const PALETTE = ['#5ad2ff', '#b28cff', '#ff7ad6', '#ffc46b', '#78f7b0', '#7f9cff', '#ff9a74', '#4ff0d0', '#e0a8ff', '#c8f06e'];
/** Most recent finished tasks kept as nodes. */
export const MAX_WORK_NODES = 160;

export function hash(s: string) { let h = 2166136261; for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619); return h >>> 0; }
export function rng(seed: number) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

/** Shift a hex colour's hue by `deg` degrees and its lightness by `dl` (−1..1). */
export function tint(hex: string, deg: number, dl = 0): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  const r = ((n >> 16) & 255) / 255, g = ((n >> 8) & 255) / 255, b = (n & 255) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  let l = (max + min) / 2;
  const s = d ? d / (1 - Math.abs(2 * l - 1)) : 0;
  let h = d ? (max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4) * 60 : 0;
  h = (((h + deg) % 360) + 360) % 360; l = Math.max(0, Math.min(1, l + dl));
  const c = (1 - Math.abs(2 * l - 1)) * s, x = c * (1 - Math.abs(((h / 60) % 2) - 1)), o = l - c / 2;
  const [R, G, B] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  const to = (v: number) => Math.round((v + o) * 255).toString(16).padStart(2, '0');
  return `#${to(R)}${to(G)}${to(B)}`;
}

// ---------- teams and links from the office ----------

export interface Team { id: string; name: string; color: string; agentIds: string[] }

export function teamsOf(doc: Pick<OfficeDoc, 'agents' | 'departments'>): Team[] {
  const by = new Map<string, string[]>();
  for (const a of Object.values(doc.agents).sort((x, y) => x.identity.name.localeCompare(y.identity.name))) {
    const d = a.identity.department || 'Unassigned';
    by.set(d, [...(by.get(d) ?? []), a.id]);
  }
  const deps = Object.values(doc.departments ?? {});
  return [...by.entries()].map(([name, agentIds]) => {
    const dep = deps.find((d) => d.name.toLowerCase() === name.toLowerCase() || d.id === name);
    // canvas drawing needs plain #rrggbb colours
    const color = dep?.color && /^#[0-9a-f]{6}$/i.test(dep.color) ? dep.color : PALETTE[hash(name) % PALETTE.length];
    return { id: `team:${name}`, name, color, agentIds };
  });
}

export const teamOfAgent = (teams: Team[], agentId: string | null | undefined) => (agentId ? teams.find((t) => t.agentIds.includes(agentId))?.id ?? null : null);

/** Team-to-team links: reporting lines plus every recorded handoff. */
export function teamLinks(doc: Pick<OfficeDoc, 'agents'>, rt: RuntimeState | null, teams: Team[]): TeamLink[] {
  const w = new Map<string, number>();
  const add = (x: string | null, y: string | null, n: number) => {
    if (!x || !y || x === y) return;
    const k = [x, y].sort().join('|');
    w.set(k, (w.get(k) ?? 0) + n);
  };
  for (const a of Object.values(doc.agents)) if (a.skills.supervisorId) add(teamOfAgent(teams, a.id), teamOfAgent(teams, a.skills.supervisorId), 1);
  for (const t of Object.values(rt?.tasks ?? {})) if (t.handoff?.fromAgentId && t.agentId) add(teamOfAgent(teams, t.handoff.fromAgentId), teamOfAgent(teams, t.agentId), 1);
  return [...w.entries()].map(([k, weight]) => { const [a, b] = k.split('|'); return { a, b, weight }; }).sort((p, q) => (p.a + p.b).localeCompare(q.a + q.b));
}

/** What the agents produced: knowledge entries and finished work, newest work first and capped. */
export function infoNodes(doc: Pick<OfficeDoc, 'agents' | 'departments' | 'library'>, rt: RuntimeState | null, teams = teamsOf(doc)): InfoNode[] {
  const out: InfoNode[] = [];
  for (const k of Object.values(doc.library)) {
    const regionId = teamOfAgent(teams, k.authorAgentId) ?? teams[0]?.id;
    if (!regionId) continue;
    out.push({ id: `k:${k.id}`, kind: 'knowledge', title: k.title, summary: k.sensitive ? 'Restricted entry: only allowed agents can read it.' : k.summary, regionId, agentId: k.authorAgentId, at: k.createdAt, important: true });
  }
  const done = Object.values(rt?.tasks ?? {}).filter((t) => t.status === 'done' && t.agentId && doc.agents[t.agentId])
    .sort((a, b) => (b.completedAt ?? '').localeCompare(a.completedAt ?? '')).slice(0, MAX_WORK_NODES);
  for (const t of done) {
    const regionId = teamOfAgent(teams, t.agentId);
    if (!regionId) continue;
    out.push({ id: `t:${t.id}`, kind: 'work', title: t.name, summary: t.handoff?.deliverable || t.description || '', regionId, agentId: t.agentId, at: t.completedAt ?? t.createdAt, important: t.priority === 'high' || t.priority === 'critical' || !!t.handoff });
  }
  return out;
}

// ---------- geometry ----------

/** Slots in a fly-brain arrangement: two large optic lobes at the sides, a central body, crown and base. */
const SLOTS: (Pt & { big?: boolean })[] = [
  { x: -0.74, y: 0.04, big: true }, { x: 0.74, y: 0.04, big: true },
  { x: -0.25, y: 0.02 }, { x: 0.25, y: 0.02 },
  { x: 0, y: -0.58 }, { x: -0.34, y: -0.5 }, { x: 0.34, y: -0.5 },
  { x: 0, y: 0.52 }, { x: -0.36, y: 0.5 }, { x: 0.36, y: 0.5 },
  { x: -0.55, y: -0.4 }, { x: 0.55, y: -0.4 },
];

export const insideRegion = (r: Region, p: Pt) => Math.hypot((p.x - r.x) / r.rx, (p.y - r.y) / r.ry);

/** A stable spot for a piece of information inside its region (doesn't move as more info arrives). */
export function infoPosition(r: Region, id: string): Pt {
  const rand = rng(hash(id));
  const a = rand() * Math.PI * 2, d = 0.15 + Math.sqrt(rand()) * 0.72;
  return { x: r.x + Math.cos(a) * r.rx * d, y: r.y + Math.sin(a) * r.ry * d };
}

function walk(r: Region, rand: () => number, steps: number, step: number): Path {
  const a0 = rand() * Math.PI * 2, d0 = Math.sqrt(rand()) * 0.95;
  let x = r.x + Math.cos(a0) * r.rx * d0, y = r.y + Math.sin(a0) * r.ry * d0;
  let a = rand() * Math.PI * 2, turn = (rand() - 0.5) * 0.3;
  const pts: Path = [x, y];
  for (let i = 0; i < steps; i++) {
    turn = turn * 0.8 + (rand() - 0.5) * 0.7;
    a += turn;
    let nx = x + Math.cos(a) * step, ny = y + Math.sin(a) * step;
    if (insideRegion(r, { x: nx, y: ny }) > (rand() < 0.12 ? 1.1 : 1)) {
      a = Math.atan2(r.y - y, r.x - x) + (rand() - 0.5) * 1.2; // bend back inside
      nx = x + Math.cos(a) * step; ny = y + Math.sin(a) * step;
    }
    x = nx; y = ny;
    pts.push(x, y);
  }
  return pts;
}

/** A quadratic curve sampled into a path. */
export function curve(a: Pt, c: Pt, b: Pt, n = 24): Path {
  const out: Path = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n, u = 1 - t;
    out.push(u * u * a.x + 2 * u * t * c.x + t * t * b.x, u * u * a.y + 2 * u * t * c.y + t * t * b.y);
  }
  return out;
}

export function buildConnectome(teams: Team[], links: TeamLink[], seed = 7): Connectome {
  const rand = rng(seed + teams.length * 101);
  const cx = WIDTH / 2, cy = HEIGHT / 2;
  // biggest teams take the optic lobes; the rest fill the central body outwards
  const order = [...teams].sort((a, b) => b.agentIds.length - a.agentIds.length || a.name.localeCompare(b.name));
  const regions: Region[] = order.map((t, i) => {
    const slot = SLOTS[i] ?? { x: Math.cos(i * 2.4) * 0.6, y: Math.sin(i * 2.4) * 0.55 };
    const n = t.agentIds.length;
    const big = !!slot.big && order.length > 2;
    const rx = big ? 158 + 12 * Math.sqrt(n) : 118 + 18 * Math.sqrt(n);
    const ry = big ? rx * 1.34 : rx * 0.74;
    return { id: t.id, name: t.name, color: t.color, x: cx + slot.x * WIDTH * 0.44, y: cy + slot.y * HEIGHT * 0.6, rx, ry, rim: big, agentIds: t.agentIds };
  });

  const fibers: Fiber[] = [];
  for (const r of regions) {
    const count = Math.round(90 + 34 * r.agentIds.length + (r.rim ? 80 : 0));
    const step = Math.min(r.rx, r.ry) * 0.075;
    for (let i = 0; i < count; i++) {
      const fine = rand() < 0.7;
      fibers.push({
        regionId: r.id, pts: walk(r, rand, 10 + Math.floor(rand() * 26), step * (fine ? 0.8 : 1.4)),
        color: tint(r.color, (rand() - 0.5) * 70, (rand() - 0.5) * 0.2), width: fine ? 0.5 + rand() * 0.5 : 1 + rand() * 0.9, alpha: fine ? 0.22 + rand() * 0.25 : 0.35 + rand() * 0.3,
      });
    }
  }

  // tracts: bundles of nerves between linked teams, plus faint ones between near neighbours so the brain reads as one
  const byId = Object.fromEntries(regions.map((r) => [r.id, r]));
  const pairs = new Map<string, TeamLink>();
  for (const l of links) if (byId[l.a] && byId[l.b]) pairs.set([l.a, l.b].sort().join('|'), l);
  for (const a of regions) {
    const near = regions.filter((b) => b !== a).sort((p, q) => Math.hypot(p.x - a.x, p.y - a.y) - Math.hypot(q.x - a.x, q.y - a.y)).slice(0, 2);
    for (const b of near) { const k = [a.id, b.id].sort().join('|'); if (!pairs.has(k)) pairs.set(k, { a: a.id, b: b.id, weight: 0 }); }
  }
  const tracts: Tract[] = [...pairs.values()].map((l) => {
    const A = byId[l.a], B = byId[l.b];
    const n = 6 + Math.min(18, l.weight * 3);
    const curves: Path[] = [];
    for (let i = 0; i < n; i++) {
      const pa = { x: A.x + (rand() - 0.5) * A.rx * 0.9, y: A.y + (rand() - 0.5) * A.ry * 0.7 };
      const pb = { x: B.x + (rand() - 0.5) * B.rx * 0.9, y: B.y + (rand() - 0.5) * B.ry * 0.7 };
      // nerves bow towards the middle of the brain, like commissures crossing the midline
      const mx = (pa.x + pb.x) / 2, my = (pa.y + pb.y) / 2;
      const c = { x: mx + (cx - mx) * 0.25 + (rand() - 0.5) * 40, y: my + (cy - my) * 0.35 - 30 + (rand() - 0.5) * 40 };
      curves.push(curve(pa, c, pb));
    }
    return { a: l.a, b: l.b, weight: l.weight, curves };
  });

  // optic-lobe rims: the bright beaded edge seen in connectome maps
  const rim: RimDot[] = [];
  for (const r of regions.filter((x) => x.rim)) {
    const outer = r.x < cx ? -1 : 1;
    for (let i = 0; i < 220; i++) {
      const a = (i / 220) * Math.PI * 2;
      const side = Math.cos(a) * outer; // the outward-facing half carries the rim
      if (side < -0.15) continue;
      const k = 1.0 + (rand() - 0.5) * 0.04;
      rim.push({ x: r.x + Math.cos(a) * r.rx * k, y: r.y + Math.sin(a) * r.ry * k, r: 1.6 + rand() * 1.8, color: i % 3 === 0 ? '#3d5bff' : '#ff3d8b' });
      if (i % 2 === 0) rim.push({ x: r.x + Math.cos(a) * r.rx * 0.92, y: r.y + Math.sin(a) * r.ry * 0.92, r: 1.2 + rand(), color: '#4a63ff' });
    }
  }
  return { width: WIDTH, height: HEIGHT, regions, fibers, tracts, rim };
}
