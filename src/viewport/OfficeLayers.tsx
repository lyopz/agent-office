// Static office rendering (rooms, hallways, doors, furniture). Each layer is
// memoised on the document slices it uses, so simulation ticks never rerender it.
import { memo } from 'react';
import type { Corridor, Furniture, OfficeDoc, Room } from '../model/types';
import { doorSegment } from '../engine/geometry';
import { FURNITURE_META, MATERIAL_COLOR } from '../model/catalog';
import { kelvinColor } from '../model/themes';

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

/** One object, drawn from its library entry: a body in its material plus a glyph for what it does. */
export function FurnitureShape({ f, x, y, w, h, display, ghost }: { f: Pick<Furniture, 'type' | 'color' | 'material' | 'workstation' | 'label'> & Partial<Pick<Furniture, 'arcade'>> & { id?: string }; x: number; y: number; w: number; h: number; display?: string; ghost?: 'ok' | 'bad' }) {
  const px = x * G, py = y * G, pw = w * G, ph = h * G;
  const ix = px + 3, iy = py + 3, iw = pw - 6, ih = ph - 6;
  const meta = FURNITURE_META[f.type];
  const ws = f.workstation;
  const scr = display ?? 'var(--screen)';
  const statusColor = ws ? (ws.status === 'online' ? 'var(--accent)' : ws.status === 'maintenance' ? 'var(--warn)' : 'var(--danger)') : undefined;
  const body = (f.material && MATERIAL_COLOR[f.material]) || f.color;
  const cx = px + pw / 2, cy = py + ph / 2, rr = Math.min(pw, ph) / 2 - 3;
  let detail: React.ReactNode = null;
  let round = false, bodyless = false;
  switch (f.type) {
    case 'arcade-cabinet': {
      const c = ARCADE_SCREEN[f.arcade?.game ?? 'pong'];
      detail = <><rect x={ix + 2} y={iy + 2} width={iw - 4} height={ih * 0.55} fill="#05060a" stroke={c} strokeWidth={1} /><rect className="arcade-glow" x={ix + 4} y={iy + 4} width={iw - 8} height={ih * 0.55 - 4} fill={c} opacity={0.35} /><circle cx={cx - 3} cy={iy + ih * 0.8} r={1.6} fill="#ff5d73" /><circle cx={cx + 3} cy={iy + ih * 0.8} r={1.6} fill="#ffd166" /></>;
      break;
    }
    case 'render-wall':
      detail = ['var(--muted)', 'var(--accent-orange)', 'var(--accent)', 'var(--accent)', 'var(--accent-orange)', 'var(--danger)', 'var(--muted)', 'var(--accent)'].map((c, i) => <rect key={i} x={ix + 3 + i * (iw - 6) / 8} y={iy + 3} width={(iw - 6) / 8 - 2} height={ih - 6} fill={c} opacity={0.55} />);
      break;
    case 'preview-stage': round = true; detail = <><circle cx={cx} cy={cy} r={rr} fill="#0c1820" stroke={scr} strokeOpacity={0.6} /><path className="turntable" d={`M${cx},${cy - rr * 0.55} L${cx + rr * 0.45},${cy + rr * 0.35} L${cx - rr * 0.45},${cy + rr * 0.35}Z`} fill={scr} opacity={0.7} style={{ transformOrigin: `${cx}px ${cy}px` }} /></>; break;
    case 'lane-marker': bodyless = true; detail = <line x1={px + 2} x2={px + pw - 2} y1={cy} y2={cy} stroke="var(--accent)" strokeOpacity={0.35} strokeWidth={3} strokeDasharray="4 3" />; break;
    case 'task-board': detail = [0, 1, 2].map((i) => <g key={i}><rect x={ix + 3 + i * iw / 3} y={iy + 2} width={iw / 3 - 6} height={ih - 4} fill={scr} opacity={0.18} />{[0, 1].map((k) => <rect key={k} x={ix + 5 + i * iw / 3} y={iy + 4 + k * 5} width={iw / 3 - 10} height={3} fill={i === 2 ? 'var(--accent)' : i === 1 ? 'var(--accent-blue)' : 'var(--muted)'} />)}</g>); break;
    case 'workstation-3d': case 'dev-desk': {
      const n = f.type === 'workstation-3d' ? 3 : 2;
      detail = Array.from({ length: n }, (_, i) => <rect key={i} x={ix + 3 + i * (iw - 6) / n} y={iy + 1} width={(iw - 6) / n - 2} height={5} fill={scr} />);
      break;
    }
    // royal lounge: violet bodies, gold trim, restrained glow
    case 'briefing-board': {
      const cols = ['var(--success, var(--accent))', 'var(--accent-blue)', 'var(--danger)', 'var(--muted)'];
      const cw = (iw - 8) / 4;
      detail = <><rect x={ix + 1} y={iy + 1} width={iw - 2} height={ih - 2} fill="#0c0818" stroke={ROYAL_GOLD} strokeWidth={1.2} />
        <rect x={ix + 3} y={iy + 2.5} width={iw * 0.3} height={2} fill={ROYAL_GOLD} opacity={0.8} />
        {cols.map((c, i) => <g key={i}><rect x={ix + 4 + i * cw} y={iy + 6} width={cw - 3} height={Math.max(2, ih - 9)} fill={c} opacity={0.14} />{[0, 1].map((k) => <rect key={k} x={ix + 5 + i * cw} y={iy + 7 + k * 4} width={(cw - 5) * (k ? 0.6 : 1)} height={2} fill={c} opacity={0.75} />)}</g>)}</>;
      break;
    }
    case 'throne':
      detail = <><rect x={ix + 1} y={iy + 1} width={iw - 2} height={ih * 0.3} rx={2} fill="#3a2458" stroke={ROYAL_GOLD} strokeWidth={1} />
        <path d={`M${cx - iw * 0.28},${iy + 1} l${iw * 0.093},-3 l${iw * 0.093},3 l${iw * 0.093},-4 l${iw * 0.093},4 l${iw * 0.093},-3 l${iw * 0.093},3`} fill="none" stroke={ROYAL_GOLD} strokeWidth={1.2} />
        <rect x={ix + iw * 0.2} y={iy + ih * 0.36} width={iw * 0.6} height={ih * 0.5} rx={3} fill="#4a2c70" />
        <rect x={ix + 1} y={iy + ih * 0.34} width={iw * 0.14} height={ih * 0.56} rx={2} fill={ROYAL_GOLD} opacity={0.55} />
        <rect x={ix + iw * 0.86 - 1} y={iy + ih * 0.34} width={iw * 0.14} height={ih * 0.56} rx={2} fill={ROYAL_GOLD} opacity={0.55} />
        <circle cx={cx} cy={iy + ih * 0.16} r={1.6} fill="var(--accent-purple)" /></>;
      break;
    case 'lounge-sofa':
      detail = <><rect x={ix} y={iy} width={iw} height={5} rx={2} fill="#3e2662" />
        {[0, 1, 2].map((i) => <rect key={i} x={ix + 2 + i * (iw - 4) / 3} y={iy + 6} width={(iw - 4) / 3 - 2} height={Math.max(3, ih - 8)} rx={2} fill="#4a2c70" />)}
        <line x1={ix + 1} x2={ix + iw - 1} y1={iy + 5.5} y2={iy + 5.5} stroke={ROYAL_GOLD} strokeOpacity={0.7} strokeWidth={0.8} /></>;
      break;
    case 'crown-chandelier': {
      round = true; bodyless = true;
      const n = 8;
      detail = <><circle cx={cx} cy={cy} r={rr} fill="#ffe7a8" opacity={0.08} />
        <circle cx={cx} cy={cy} r={rr * 0.72} fill="none" stroke={ROYAL_GOLD} strokeWidth={1.5} />
        {Array.from({ length: n }, (_, i) => { const a = (i / n) * Math.PI * 2; return <circle key={i} cx={cx + Math.cos(a) * rr * 0.72} cy={cy + Math.sin(a) * rr * 0.72} r={1.8} fill="#ffe7a8" opacity={0.85} />; })}
        <circle cx={cx} cy={cy} r={rr * 0.22} fill="var(--accent-purple)" opacity={0.6} /></>;
      break;
    }
    case 'holo-fountain':
      round = true;
      detail = <><circle cx={cx} cy={cy} r={rr} fill="#141a30" stroke={ROYAL_GOLD} strokeWidth={1.5} />
        <circle cx={cx} cy={cy} r={rr * 0.75} fill="#0b2238" />
        <circle className="fountain-ripple" cx={cx} cy={cy} r={rr * 0.5} fill="none" stroke="var(--accent-blue)" strokeOpacity={0.5} style={{ transformOrigin: `${cx}px ${cy}px` }} />
        <circle cx={cx} cy={cy} r={rr * 0.2} fill="var(--accent-purple)" opacity={0.7} /></>;
      break;
    case 'plant': round = true; detail = <><circle cx={cx} cy={cy} r={rr} fill="#1f6b3a" /><circle cx={cx - 3} cy={cy - 2} r={rr / 2} fill="#2f8f4e" /></>; break;
    case 'lamp': case 'floor-light': round = true; detail = <circle cx={cx} cy={cy} r={6} fill="#ffe28a" opacity={0.6} filter="url(#glow)" />; break;
    case 'aquarium': detail = <><rect x={ix + 2} y={iy + 2} width={iw - 4} height={ih - 4} fill="#0b4a6b" opacity={0.9} /><circle cx={ix + iw * 0.3} cy={cy} r={2} fill="#ffb14a" /><circle cx={ix + iw * 0.7} cy={cy + 2} r={1.6} fill="#ff6f91" /></>; break;
    case 'sculpture': round = true; detail = <><circle cx={cx} cy={cy} r={rr} fill={body} /><path d={`M${cx - rr / 2},${cy + rr / 2} L${cx},${cy - rr / 2} L${cx + rr / 2},${cy + rr / 2}Z`} fill="var(--accent)" opacity={0.6} /></>; break;
    case 'deco-robot': round = true; detail = <><circle cx={cx} cy={cy} r={rr} fill="#3a4250" /><rect x={cx - 4} y={cy - 2} width={8} height={3} fill="var(--accent-blue)" /></>; break;
    case 'conference-table': case 'strategy-table': case 'holo-table':
      detail = <rect x={ix + 4} y={iy + 4} width={iw - 8} height={ih - 8} rx={8} fill="none" stroke={scr} strokeOpacity={0.55} />; break;
    case 'server-rack': detail = Array.from({ length: 6 }).map((_, i) => <circle key={i} className="led" cx={ix + 5 + (i % 2) * 8} cy={iy + 6 + Math.floor(i / 2) * (ih / 3.2)} r={1.6} fill={i % 3 ? 'var(--accent)' : 'var(--accent-orange)'} style={{ animationDelay: `${i * 0.37}s` }} />); break;
    case 'monitors': case 'multi-monitor': detail = [0, 1, 2].map((i) => <rect key={i} x={ix + 2 + i * (iw / 3)} y={iy + 2} width={iw / 3 - 4} height={ih - 4} fill={scr} opacity={0.85} />); break;
    case 'whiteboard': detail = <path d={`M${ix + 4},${cy} q6,-5 12,0 t12,0`} stroke="var(--accent-blue)" fill="none" strokeWidth={1.5} />; break;
    default:
      switch (meta?.fn) {
        case 'workstation': detail = <><rect x={ix + iw * 0.3} y={iy + 1} width={iw * 0.4} height={4} fill={scr} />{f.type === 'holo-desk' && <rect x={ix + 3} y={iy + 7} width={iw - 6} height={Math.max(2, ih - 10)} fill={scr} opacity={0.18} />}</>; break;
        case 'display': detail = <><rect x={ix + 2} y={iy + 2} width={iw - 4} height={ih - 4} fill={scr} opacity={0.75} /><path d={`M${ix + 4},${iy + ih - 5} l${iw * 0.25},-${ih * 0.35} l${iw * 0.2},${ih * 0.15} l${iw * 0.3},-${ih * 0.3}`} stroke="rgba(0,0,0,.45)" fill="none" strokeWidth={1.2} /></>; break;
        case 'tube': detail = <><circle cx={cx} cy={cy} r={rr} fill="#3a2f12" stroke="#d4a84a" strokeWidth={2} /><circle cx={cx} cy={cy} r={rr / 2.2} fill="#0d0d0d" /><rect x={cx - 1.5} y={py} width={3} height={4} fill="#d4a84a" /></>; round = true; break;
        case 'archive': case 'storage': detail = [1, 2, 3].map((i) => <line key={i} x1={ix + 2} x2={ix + iw - 2} y1={iy + (ih * i) / 4} y2={iy + (ih * i) / 4} stroke="rgba(255,255,255,.18)" />); break;
        case 'approval': case 'budget': detail = <><rect x={ix + 2} y={iy + 2} width={iw - 4} height={ih - 4} fill={scr} opacity={0.3} />{[0.3, 0.6, 0.45].map((v, i) => <rect key={i} x={ix + 4 + i * (iw - 8) / 3} y={iy + ih - 2 - (ih - 6) * v} width={(iw - 8) / 3 - 2} height={(ih - 6) * v} fill={f.type === 'approval-kiosk' ? 'var(--accent)' : 'var(--warn)'} />)}</>; break;
        case 'charging': detail = <path d={`M${cx + 2},${iy + 2} L${cx - 3},${cy + 1} L${cx + 1},${cy + 1} L${cx - 2},${iy + ih - 2}`} stroke="var(--warn)" fill="none" strokeWidth={2} />; break;
        case 'seating': detail = <rect x={ix} y={iy} width={iw} height={5} rx={2} fill="rgba(255,255,255,.08)" />; break;
        default: break;
      }
  }
  const tint = ghost === 'bad' ? 'var(--danger)' : ghost === 'ok' ? 'var(--accent)' : undefined;
  const openable = f.type === 'briefing-board' && !ghost;
  return (
    <g data-kind={ghost ? undefined : 'furniture'} data-id={f.id} className={`furniture${f.arcade && !ghost ? ' playable' : ''}${openable ? ' openable' : ''}`} opacity={ghost ? 0.75 : 1} pointerEvents={(f.arcade || openable) && !ghost ? 'visiblePainted' : undefined}>
      {f.arcade && !ghost && <title>{`Play ${f.label ?? 'arcade game'}`}</title>}
      {openable && <title>Open the hourly briefing</title>}
      {!round && !bodyless && <rect className="f-body" x={ix} y={iy} width={iw} height={ih} rx={2} fill={body} stroke={tint ?? 'color-mix(in srgb, var(--accent) 35%, transparent)'} strokeWidth={tint ? 2 : 1} />}
      {detail}
      {round && tint && <circle cx={cx} cy={cy} r={rr + 1} fill="none" stroke={tint} strokeWidth={2} />}
      {statusColor && <circle cx={px + pw - 5} cy={py + 5} r={2.5} fill={statusColor} />}
    </g>
  );
}

const ROYAL_GOLD = '#d9b45a';
const ARCADE_SCREEN: Record<string, string> = { flappy: '#4cc9ff', pacman: '#ffd166', pong: '#39ff88' };

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
    for (const g of gaps) walls.push(<line key={`d${side}${g.a.x}${g.a.y}`} className="door-mark" x1={g.a.x * G} y1={g.a.y * G} x2={g.b.x * G} y2={g.b.y * G} stroke={room.appearance.doorColor || 'var(--door)'} strokeOpacity={0.7} strokeWidth={2} strokeDasharray="3 3" />);
  }
  const floor = `url(#fl-${room.appearance.floor})`;
  const ap = room.appearance;
  const wall = room.walls.style === 'glass' ? 'var(--accent-blue)' : ap.wallColor || 'var(--wall)';
  return (
    <g className={`room${selected ? ' selected' : ''}${invalid ? ' invalid' : ''}`}>
      {ap.floorColor && <rect x={x} y={y} width={w} height={h} fill={ap.floorColor} pointerEvents="none" />}
      <rect data-kind="room" data-id={room.id} x={x} y={y} width={w} height={h} fill={floor} opacity={ap.floorColor ? 0.45 : 1} />
      <rect x={x} y={y} width={w} height={h} fill={ap.lightTemp ? kelvinColor(ap.lightTemp) : 'var(--light)'} opacity={0.03 + ap.lighting * 0.07} pointerEvents="none" />
      {ap.effect === 'ambient-glow' && <rect x={x} y={y} width={w} height={h} fill="none" stroke={acc} strokeOpacity={0.25} strokeWidth={10} filter="url(#glow)" pointerEvents="none" />}
      <g pointerEvents="none">
        {furniture.map((f) => {
          const rot = f.rotation === 90 || f.rotation === 270;
          return <FurnitureShape key={f.id} f={ap.furnitureMaterial && ap.furnitureMaterial !== 'default' && !f.material ? { ...f, material: ap.furnitureMaterial } : f} x={room.x + f.x} y={room.y + f.y} w={rot ? f.h : f.w} h={rot ? f.w : f.h} display={ap.displayColor} />;
        })}
      </g>
      <g stroke={wall} strokeWidth={room.walls.thickness * 2} strokeLinecap="square" opacity={room.walls.style === 'glass' ? 0.6 : 1} pointerEvents="none">{walls}</g>
      {showBoundary && <rect x={x + 3} y={y + 3} width={w - 6} height={h - 6} fill="none" stroke={acc} strokeOpacity={0.35} strokeWidth={1} strokeDasharray={construct ? '4 4' : undefined} pointerEvents="none" />}
      {invalid && <rect className="pulse" x={x - 2} y={y - 2} width={w + 4} height={h + 4} fill="rgba(255,93,115,.12)" stroke="var(--danger)" strokeWidth={3} pointerEvents="none" />}
      {selected && <rect x={x - 3} y={y - 3} width={w + 6} height={h + 6} fill="none" stroke="var(--accent)" strokeWidth={2} filter="url(#glow)" pointerEvents="none" />}
      {showLabel && (
        <g pointerEvents="none">
          <rect x={x + 6} y={y + 6} width={Math.min(w - 12, room.name.length * 7.4 + 14)} height={17} fill="var(--label-bg)" stroke={acc} strokeOpacity={0.6} />
          <text x={x + 13} y={y + 18} className="room-label" fill={acc}>{room.name.toUpperCase()}</text>
          {occupancy !== null && (
            <g>
              <rect x={x + w - 34} y={y + 6} width={28} height={17} fill="var(--label-bg)" stroke={acc} strokeOpacity={0.6} />
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
