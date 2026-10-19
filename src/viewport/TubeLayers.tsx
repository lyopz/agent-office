// Tube overlays: the active routes of agents riding the transport tubes, and
// the separate brass mail network that carries work capsules between stations.
import { memo, useMemo } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useStore } from '../store/store';
import type { Point, Room } from '../model/types';
import { mailNetwork } from '../engine/tubes';
import { G } from './OfficeLayers';

const inRoom = (rooms: Room[], p: Point) => rooms.some((r) => p.x >= r.x && p.x < r.x + r.w && p.y >= r.y && p.y < r.y + r.h);

/** How far an agent has been drawn into a tube: 0 inside a room, rising to 1 a cell or so into the tube. */
export function tubeDepth(rooms: Record<string, Room>, p: Point): number {
  let best = Infinity;
  const cx = p.x + 0.5, cy = p.y + 0.5;
  for (const r of Object.values(rooms)) {
    const dx = Math.max(r.x - cx, 0, cx - (r.x + r.w));
    const dy = Math.max(r.y - cy, 0, cy - (r.y + r.h));
    const d = Math.hypot(dx, dy);
    if (d === 0) return 0;
    if (d < best) best = d;
  }
  return Math.max(0, Math.min(1, (best - 0.1) / 1.1));
}

/** The tube legs of every agent in transit, lit up so the active route reads at a glance. */
export function TubeRoutesLayer() {
  const routes = useStore(useShallow((s) => {
    const rooms = Object.values(s.doc.rooms);
    const out: string[] = [];
    for (const [id, r] of Object.entries(s.runtime.agents)) {
      if (r.status !== 'walking' || !r.path.length) continue;
      // the stretch of the route that runs through tubes, from where the agent is now to the next room
      const pts: Point[] = [];
      for (const p of [r.pos, ...r.path]) {
        const tube = !inRoom(rooms, { x: Math.round(p.x), y: Math.round(p.y) });
        if (tube) pts.push(p); else if (pts.length) { pts.push(p); break; }
      }
      if (pts.length > 1) out.push(`${id}|${s.doc.agents[id]?.appearance.accent ?? ''}|${pts.map((p) => `${((p.x + 0.5) * G).toFixed(1)},${((p.y + 0.5) * G).toFixed(1)}`).join(' ')}`);
    }
    return out;
  }));
  if (!routes.length) return null;
  return (
    <g pointerEvents="none" className="tube-routes">
      {routes.map((r) => {
        const [id, accent, pts] = r.split('|');
        return (
          <g key={id}>
            <polyline points={pts} fill="none" stroke={accent || 'var(--accent)'} strokeOpacity={0.22} strokeWidth={14} strokeLinecap="round" strokeLinejoin="round" />
            <polyline className="route-flow" points={pts} fill="none" stroke={accent || 'var(--accent)'} strokeOpacity={0.85} strokeWidth={2.5} strokeDasharray="6 8" strokeLinecap="round" strokeLinejoin="round" />
          </g>
        );
      })}
    </g>
  );
}

/** The dedicated mail tube network: thin brass pipes from every station to the routing hub. */
export const MailNetworkLayer = memo(function MailNetworkLayer() {
  const rooms = useStore((s) => s.doc.rooms);
  const furniture = useStore((s) => s.doc.furniture);
  const busy = useStore(useShallow((s) => Object.values(s.runtime.capsules).filter((c) => c.status === 'in-transit').map((c) => `${c.fromId}>${c.toId}`)));
  const net = useMemo(() => mailNetwork({ rooms, furniture } as Parameters<typeof mailNetwork>[0]), [rooms, furniture]);
  if (!net || net.spokes.length < 2) return null;
  const live = new Set(busy.flatMap((b) => b.split('>')));
  return (
    <g pointerEvents="none" className="mail-network" aria-hidden>
      {net.spokes.map((sp) => {
        const pts = sp.points.map((p) => `${p.x * G},${p.y * G}`).join(' ');
        const on = live.has(sp.stationId);
        return (
          <g key={sp.stationId}>
            <polyline points={pts} fill="none" stroke="#d4a84a" strokeOpacity={on ? 0.75 : 0.18} strokeWidth={5} strokeLinejoin="round" />
            <polyline points={pts} fill="none" stroke="#1d1607" strokeOpacity={on ? 0.8 : 0.4} strokeWidth={2} strokeLinejoin="round" />
          </g>
        );
      })}
      <circle cx={net.hub.x * G} cy={net.hub.y * G} r={7} fill="#2a2110" stroke="#d4a84a" strokeWidth={2} />
      <circle cx={net.hub.x * G} cy={net.hub.y * G} r={2.5} fill="#ffd27a" />
    </g>
  );
});
