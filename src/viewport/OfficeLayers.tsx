// Static office rendering (rooms, hallways, doors, furniture). Each layer is
// memoised on the document slices it uses, so simulation ticks never rerender it.
import { memo } from 'react';
import type { Corridor, Furniture, OfficeDoc, Room } from '../model/types';
import { doorSegment } from '../engine/geometry';

export const G = 24; // px per cell at zoom 1

export function FloorPatterns() {
  return (
    <defs>
      <pattern id="fl-grid" width={G} height={G} patternUnits="userSpaceOnUse"><rect width={G} height={G} fill="var(--floor-grid)" /><path d={`M${G} 0 L0 0 0 ${G}`} fill="none" stroke="var(--floor-line)" strokeWidth="1" /></pattern>
      <pattern id="fl-tile" width={G} height={G} patternUnits="userSpaceOnUse"><rect width={G} height={G} fill="var(--floor-tile)" /><rect x="1" y="1" width={G - 2} height={G - 2} fill="none" stroke="var(--floor-line)" strokeWidth="1" /></pattern>
      <pattern id="fl-carpet" width="6" height="6" patternUnits="userSpaceOnUse"><rect width="6" height="6" fill="var(--floor-carpet)" /><circle cx="3" cy="3" r="0.8" fill="var(--floor-line)" /></pattern>
      <pattern id="fl-metal" width={G / 2} height={G / 2} patternUnits="userSpaceOnUse"><rect width={G / 2} height={G / 2} fill="var(--floor-metal)" /><path d={`M0 ${G / 2} L${G / 2} 0`} stroke="var(--floor-line)" strokeWidth="1" /></pattern>
      <pattern id="fl-wood" width={G * 2} height={G / 2} patternUnits="userSpaceOnUse"><rect width={G * 2} height={G / 2} fill="var(--floor-wood)" /><path d={`M0 ${G / 2} H${G * 2} M${G} 0 V${G / 2}`} stroke="var(--floor-line)" strokeWidth="1" /></pattern>
      <pattern id="fl-plain" width={G} height={G} patternUnits="userSpaceOnUse"><rect width={G} height={G} fill="var(--floor-plain)" /></pattern>
      <pattern id="fl-hall" width={G} height={G} patternUnits="userSpaceOnUse"><rect width={G} height={G} fill="var(--hall-floor)" /><path d={`M${G} 0 L0 0 0 ${G}`} fill="none" stroke="var(--hall-line)" strokeWidth="1" /></pattern>
      <pattern id="hazard" width="12" height="12" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="12" height="12" fill="rgba(255,170,0,.25)" /><rect width="6" height="12" fill="rgba(0,0,0,.5)" /></pattern>
      <filter id="glow" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="3" result="b" /><feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge></filter>
    </defs>
  );
}

/** Pixel polyline of a corridor's band centre. */
export function corridorPx(c: Corridor) {
  const lo = -Math.floor((c.width - 1) / 2), hi = Math.ceil((c.width - 1) / 2);
  const off = (lo + hi) / 2 + 0.5;
  return c.points.map((p) => ({ x: (p.x + off) * G, y: (p.y + off) * G }));
}

export const CorridorShape = memo(function CorridorShape({ c, selected, ghost }: { c: Corridor; selected?: boolean; ghost?: boolean }) {
  if (c.points.length < 2) return null;
  const pts = corridorPx(c).map((p) => `${p.x},${p.y}`).join(' ');
  const w = c.width * G;
  const broken = c.status === 'broken';
  if (ghost) return <polyline points={pts} fill="none" stroke="var(--accent-blue)" strokeOpacity={0.55} strokeWidth={w} strokeLinecap="square" strokeLinejoin="miter" strokeDasharray="8 6" />;
  return (
    <g data-kind="corridor" data-id={c.id} className="corridor">
      <polyline points={pts} fill="none" stroke={broken ? 'var(--danger)' : c.status === 'warning' ? 'var(--warn)' : 'var(--hall-edge)'} strokeWidth={w + 4} strokeLinecap="square" strokeLinejoin="miter" />
      <polyline points={pts} fill="none" stroke="url(#fl-hall)" strokeWidth={w} strokeLinecap="square" strokeLinejoin="miter" />
      {c.blocked && <polyline points={pts} fill="none" stroke="url(#hazard)" strokeWidth={w} strokeLinecap="square" />}
      {c.isMain && <polyline points={pts} fill="none" stroke="var(--accent)" strokeOpacity={0.25} strokeWidth={2} strokeDasharray="2 10" />}
      {selected && <polyline points={pts} fill="none" stroke="var(--accent)" strokeWidth={w + 8} strokeOpacity={0.25} strokeLinecap="square" filter="url(#glow)" />}
      {broken && <polyline points={pts} fill="none" stroke="var(--danger)" strokeWidth={3} strokeDasharray="6 6" />}
    </g>
  );
});

function FurnitureShape({ f, x, y, w, h }: { f: Furniture; x: number; y: number; w: number; h: number }) {
  const px = x * G, py = y * G, pw = w * G, ph = h * G;
  const inner = { x: px + 3, y: py + 3, w: pw - 6, h: ph - 6 };
  const ws = f.workstation;
  const statusColor = ws ? (ws.status === 'online' ? 'var(--accent)' : ws.status === 'maintenance' ? 'var(--warn)' : 'var(--danger)') : undefined;
  let detail: React.ReactNode = null;
  switch (f.type) {
    case 'desk': case 'workbench':
      detail = <><rect x={inner.x + inner.w * 0.3} y={inner.y + 1} width={inner.w * 0.4} height={4} fill="var(--screen)" /><rect x={inner.x + 2} y={inner.y + inner.h - 4} width={inner.w - 4} height={2} fill="rgba(255,255,255,.08)" /></>;
      break;
    case 'monitors': detail = [0, 1, 2].map((i) => <rect key={i} x={inner.x + 2 + i * (inner.w / 3)} y={inner.y + 2} width={inner.w / 3 - 4} height={inner.h - 4} fill="var(--screen)" opacity={0.85} />); break;
    case 'computer': detail = <rect x={inner.x + 2} y={inner.y + 2} width={inner.w - 4} height={inner.h - 6} fill="var(--screen)" />; break;
    case 'server-rack': detail = Array.from({ length: 6 }).map((_, i) => <circle key={i} className="led" cx={inner.x + 5 + (i % 2) * 8} cy={inner.y + 6 + Math.floor(i / 2) * (inner.h / 3.2)} r={1.6} fill={i % 3 ? 'var(--accent)' : 'var(--accent-orange)'} style={{ animationDelay: `${i * 0.37}s` }} />); break;
    case 'plant': detail = <><circle cx={px + pw / 2} cy={py + ph / 2} r={pw / 2 - 3} fill="#1f6b3a" /><circle cx={px + pw / 2 - 3} cy={py + ph / 2 - 2} r={4} fill="#2f8f4e" /></>; break;
    case 'whiteboard': detail = <path d={`M${inner.x + 4},${inner.y + inner.h / 2} q6,-5 12,0 t12,0`} stroke="var(--accent-blue)" fill="none" strokeWidth={1.5} />; break;
    case 'conference-table': detail = <rect x={inner.x + 4} y={inner.y + 4} width={inner.w - 8} height={inner.h - 8} rx={8} fill="rgba(76,201,255,.08)" stroke="rgba(76,201,255,.4)" />; break;
    case 'lamp': detail = <circle cx={px + pw / 2} cy={py + ph / 2} r={6} fill="#ffe28a" opacity={0.6} filter="url(#glow)" />; break;
    case 'sofa': detail = <rect x={inner.x} y={inner.y} width={inner.w} height={5} rx={2} fill="rgba(255,255,255,.08)" />; break;
    default: break;
  }
  const round = f.type === 'plant' || f.type === 'lamp';
  return (
    <g data-kind="furniture" data-id={f.id} className="furniture">
      {!round && <rect x={inner.x} y={inner.y} width={inner.w} height={inner.h} rx={2} fill={f.color} stroke="rgba(57,255,136,.35)" strokeWidth={1} />}
      {detail}
      {statusColor && <circle cx={px + pw - 5} cy={py + 5} r={2.5} fill={statusColor} />}
    </g>
  );
}

export const RoomShape = memo(function RoomShape({
  room, furniture, selected, invalid, occupancy, showLabel, showBoundary, construct,
}: { room: Room; furniture: Furniture[]; selected: boolean; invalid: boolean; occupancy: number | null; showLabel: boolean; showBoundary: boolean; construct: boolean }) {
  const x = room.x * G, y = room.y * G, w = room.w * G, h = room.h * G;
  const acc = room.appearance.accent;
  // walls with door gaps
  const walls: React.ReactNode[] = [];
  const sides: ('n' | 's' | 'e' | 'w')[] = ['n', 's', 'e', 'w'];
  for (const side of sides) {
    const gaps = room.doors.filter((d) => d.side === side).map((d) => doorSegment(room, d)).sort((a, b) => (a.a.x + a.a.y) - (b.a.x + b.a.y));
    const horiz = side === 'n' || side === 's';
    const fixed = side === 'n' ? room.y : side === 's' ? room.y + room.h : side === 'w' ? room.x : room.x + room.w;
    let cur = horiz ? room.x : room.y;
    const end = horiz ? room.x + room.w : room.y + room.h;
    const segs: [number, number][] = [];
    for (const g of gaps) { const s0 = horiz ? g.a.x : g.a.y, s1 = horiz ? g.b.x : g.b.y; if (s0 > cur) segs.push([cur, s0]); cur = Math.max(cur, s1); }
    if (cur < end) segs.push([cur, end]);
    segs.forEach(([a, b], i) => walls.push(horiz
      ? <line key={`${side}${i}`} x1={a * G} y1={fixed * G} x2={b * G} y2={fixed * G} />
      : <line key={`${side}${i}`} x1={fixed * G} y1={a * G} x2={fixed * G} y2={b * G} />));
    for (const g of gaps) walls.push(<line key={`d${side}${g.a.x}${g.a.y}`} className="door-mark" x1={g.a.x * G} y1={g.a.y * G} x2={g.b.x * G} y2={g.b.y * G} stroke={acc} strokeOpacity={0.5} strokeWidth={2} strokeDasharray="3 3" />);
  }
  const floor = `url(#fl-${room.appearance.floor})`;
  return (
    <g className={`room${selected ? ' selected' : ''}${invalid ? ' invalid' : ''}`}>
      <rect data-kind="room" data-id={room.id} x={x} y={y} width={w} height={h} fill={floor} />
      <rect x={x} y={y} width={w} height={h} fill={acc} opacity={0.04 + room.appearance.lighting * 0.06} pointerEvents="none" />
      <g pointerEvents="none">
        {furniture.map((f) => {
          const rot = f.rotation === 90 || f.rotation === 270;
          return <FurnitureShape key={f.id} f={f} x={room.x + f.x} y={room.y + f.y} w={rot ? f.h : f.w} h={rot ? f.w : f.h} />;
        })}
      </g>
      <g stroke={room.walls.style === 'glass' ? 'var(--accent-blue)' : room.appearance.wallColor} strokeWidth={room.walls.thickness * 2} strokeLinecap="square" opacity={room.walls.style === 'glass' ? 0.6 : 1} pointerEvents="none">{walls}</g>
      {showBoundary && <rect x={x + 3} y={y + 3} width={w - 6} height={h - 6} fill="none" stroke={acc} strokeOpacity={0.35} strokeWidth={1} strokeDasharray={construct ? '4 4' : undefined} pointerEvents="none" />}
      {invalid && <rect className="pulse" x={x - 2} y={y - 2} width={w + 4} height={h + 4} fill="rgba(255,93,115,.12)" stroke="var(--danger)" strokeWidth={3} pointerEvents="none" />}
      {selected && <rect x={x - 3} y={y - 3} width={w + 6} height={h + 6} fill="none" stroke="var(--accent)" strokeWidth={2} filter="url(#glow)" pointerEvents="none" />}
      {showLabel && (
        <g pointerEvents="none">
          <rect x={x + 6} y={y + 6} width={Math.min(w - 12, room.name.length * 7.4 + 14)} height={17} fill="rgba(0,0,0,.65)" stroke={acc} strokeOpacity={0.6} />
          <text x={x + 13} y={y + 18} className="room-label" fill={acc}>{room.name.toUpperCase()}</text>
          {occupancy !== null && (
            <g>
              <rect x={x + w - 34} y={y + 6} width={28} height={17} fill="rgba(0,0,0,.65)" stroke={acc} strokeOpacity={0.6} />
              <text x={x + w - 20} y={y + 18} className="room-label" textAnchor="middle" fill={occupancy ? acc : 'var(--muted)'}>{occupancy}</text>
            </g>
          )}
        </g>
      )}
    </g>
  );
});

export function useFurnitureByRoom(doc: OfficeDoc) {
  const map: Record<string, Furniture[]> = {};
  for (const f of Object.values(doc.furniture)) (map[f.roomId] ??= []).push(f);
  return map;
}
