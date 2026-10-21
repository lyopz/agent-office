// Layout for the in-app Graph POW: teams become glowing lobes round an
// ellipse, agents sit inside their lobe, and the work and knowledge each agent
// produced orbit it. Deterministic, so the map doesn't reshuffle as work lands.
import type { PowData } from './agentGraph';

export interface PowPos { x: number; y: number; r: number }
export interface PowLobe { id: string; x: number; y: number; r: number; color: string }
export interface PowLayout { width: number; height: number; pos: Record<string, PowPos>; lobes: PowLobe[] }

export const POW_PALETTE = ['#5ad2ff', '#b28cff', '#ff7ad6', '#ffc46b', '#78f7b0', '#7f9cff', '#ff9a74', '#4ff0d0', '#e0a8ff', '#c8f06e', '#ff6f9c', '#9fd4ff'];
const GOLD = Math.PI * (3 - Math.sqrt(5));

export function layoutPow(data: PowData): PowLayout {
  const byGroup = new Map<string, PowData['files']>();
  for (const f of data.files) byGroup.set(f.group, [...(byGroup.get(f.group) ?? []), f]);
  const owner = new Map<string, string>(); // satellite node id -> its agent node id
  const agentIdOf = new Map(data.files.filter((f) => f.kind === 'agent').map((f) => [f.agentId, f.id]));
  for (const f of data.files) if (f.kind !== 'agent' && f.agentId && agentIdOf.has(f.agentId)) owner.set(f.id, agentIdOf.get(f.agentId)!);

  // each agent with its orbit: rings of 10, 16, 22… satellites
  const orbitR = (n: number) => { let r = 22, left = n, ring = 0; while (left > 0) { left -= 10 + ring * 6; r += 13; ring++; } return r; };
  const sats = new Map<string, string[]>();
  for (const [s, a] of owner) sats.set(a, [...(sats.get(a) ?? []), s]);

  const lobes: (PowLobe & { members: PowData['files'] })[] = data.groups.map((g, i) => {
    const members = byGroup.get(g.id) ?? [];
    const area = members.filter((m) => m.kind === 'agent').reduce((s, m) => s + Math.PI * orbitR(sats.get(m.id)?.length ?? 0) ** 2, 0)
      + members.filter((m) => m.kind !== 'agent' && !owner.has(m.id)).length * 400;
    return { id: g.id, x: 0, y: 0, r: Math.max(60, Math.sqrt(area / Math.PI) * 1.25 + 20), color: g.color ?? POW_PALETTE[i % POW_PALETTE.length], members };
  });
  const total = lobes.reduce((s, l) => s + l.r * 2 + 30, 0);
  const rx = Math.max(360, total / (Math.PI * 1.5)), ry = rx * 0.68;
  const cx = rx + 160, cy = ry + 140;
  lobes.forEach((l, i) => {
    const a = Math.PI + (i / Math.max(1, lobes.length)) * Math.PI * 2;
    if (lobes.length === 1) { l.x = cx; l.y = cy; return; }
    l.x = cx + Math.cos(a) * rx; l.y = cy + Math.sin(a) * ry;
  });
  for (let it = 0; it < 80; it++) {
    for (let i = 0; i < lobes.length; i++) for (let j = i + 1; j < lobes.length; j++) {
      const A = lobes[i], B = lobes[j];
      const dx = B.x - A.x, dy = B.y - A.y, d = Math.hypot(dx, dy) || 0.01, min = A.r + B.r + 24;
      if (d < min) { const m = (min - d) / 2; A.x -= (dx / d) * m; A.y -= (dy / d) * m; B.x += (dx / d) * m; B.y += (dy / d) * m; }
    }
  }

  const pos: Record<string, PowPos> = {};
  const size = (f: PowData['files'][number]) => (f.kind === 'agent' ? 9 + Math.sqrt(f.degree) * 1.4 : f.kind === 'knowledge' ? 5.5 : 4);
  for (const L of lobes) {
    const agents = L.members.filter((m) => m.kind === 'agent');
    const loose = L.members.filter((m) => m.kind !== 'agent' && !owner.has(m.id));
    const step = agents.length > 1 ? Math.max(...agents.map((a) => orbitR(sats.get(a.id)?.length ?? 0))) * 1.5 : 0;
    agents.forEach((a, i) => {
      const rr = agents.length === 1 ? 0 : step * 0.7 * Math.sqrt(i + 0.5);
      pos[a.id] = { x: L.x + Math.cos(i * GOLD) * rr, y: L.y + Math.sin(i * GOLD) * rr, r: size(a) };
      // satellites round the agent, newest on the inner ring
      const list = sats.get(a.id) ?? [];
      let k = 0, ring = 0;
      while (k < list.length) {
        const cap = 10 + ring * 6, rad = 24 + ring * 13;
        for (let j = 0; j < cap && k < list.length; j++, k++) {
          const ang = (j / cap) * Math.PI * 2 + ring * 0.4;
          const f = data.files.find((x) => x.id === list[k])!;
          pos[f.id] = { x: pos[a.id].x + Math.cos(ang) * rad, y: pos[a.id].y + Math.sin(ang) * rad, r: size(f) };
        }
        ring++;
      }
    });
    loose.forEach((f, i) => {
      const rr = 18 * Math.sqrt(i + 1) + (agents.length ? L.r * 0.55 : 0);
      pos[f.id] = { x: L.x + Math.cos(i * GOLD + 1) * rr, y: L.y + Math.sin(i * GOLD + 1) * rr, r: size(f) };
    });
  }
  const xs = Object.values(pos), pad = 120;
  const minX = Math.min(...xs.map((p) => p.x), ...lobes.map((l) => l.x - l.r)) - pad, minY = Math.min(...xs.map((p) => p.y), ...lobes.map((l) => l.y - l.r)) - pad;
  const maxX = Math.max(...xs.map((p) => p.x), ...lobes.map((l) => l.x + l.r)) + pad, maxY = Math.max(...xs.map((p) => p.y), ...lobes.map((l) => l.y + l.r)) + pad;
  for (const p of Object.values(pos)) { p.x -= minX; p.y -= minY; }
  return { width: Math.max(400, maxX - minX), height: Math.max(300, maxY - minY), pos, lobes: lobes.map(({ members: _m, ...l }) => ({ ...l, x: l.x - minX, y: l.y - minY })) };
}
