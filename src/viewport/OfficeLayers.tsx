// Static office rendering (rooms, hallways, doors, furniture). Each layer is
// memoised on the document slices it uses, so simulation ticks never rerender it.
import { memo } from 'react';
import type { Corridor, Furniture, OfficeDoc, Room } from '../model/types';
import { doorSegment } from '../engine/geometry';
import { FURNITURE_META, MATERIAL_COLOR } from '../model/catalog';
import { kelvinColor } from '../model/themes';
import '../styles/hq-rooms.css';

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
      <radialGradient id="devil-bubble-fill" cx="0.5" cy="0.5" r="0.5"><stop offset="0.55" stopColor="#3a0a2a" stopOpacity="0.15" /><stop offset="0.85" stopColor="#b0103a" stopOpacity="0.32" /><stop offset="1" stopColor="#ff2a4a" stopOpacity="0.55" /></radialGradient>
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
    // ---- Roblox development headquarters ----
    case 'team-sign':
      detail = <><rect x={ix} y={iy + 1} width={iw} height={ih - 2} rx={3} fill="#0a0d16" stroke={scr} strokeOpacity={0.8} strokeWidth={1.2} />
        <circle cx={ix + 6} cy={cy} r={2.4} fill={scr} />
        {f.label && (() => { const room = iw - 15, fs = Math.min(8, room / (f.label.length * 0.62)); return <text x={ix + 11} y={cy + fs * 0.36} className="team-sign-text" fill={scr} fontSize={fs} fontWeight={700} textLength={Math.min(room, f.label.length * fs * 0.62)} lengthAdjust="spacingAndGlyphs">{f.label}</text>; })()}</>;
      break;
    case 'studio-workstation': {
      // explorer tree | 3D viewport with play button | properties panel
      const third = (iw - 4) / 3, sh = Math.max(6, ih - 7);
      detail = <><rect x={ix + 1} y={iy + 1} width={third} height={sh} fill="#0d1726" stroke={scr} strokeOpacity={0.5} strokeWidth={0.6} />
        {[0, 1, 2, 3].map((k) => <rect key={k} x={ix + 3 + (k % 2) * 3} y={iy + 3 + k * 3} width={third - 6 - (k % 2) * 3} height={1.4} fill={scr} opacity={0.7} />)}
        <rect x={ix + 2 + third} y={iy + 1} width={third} height={sh} fill="#1a3350" />
        <path d={`M${ix + 4 + third},${iy + sh} l${third * 0.3},-${sh * 0.45} l${third * 0.25},${sh * 0.25} l${third * 0.3},-${sh * 0.3}`} fill="none" stroke="#7ee08a" strokeWidth={1} />
        <path d={`M${ix + 2 + third * 1.5 - 2},${iy + 2.5} l4,2.2 l-4,2.2z`} fill="#39ff88" />
        <rect x={ix + 3 + third * 2} y={iy + 1} width={third} height={sh} fill="#0d1726" stroke={scr} strokeOpacity={0.5} strokeWidth={0.6} />
        {[0, 1, 2].map((k) => <g key={k}><rect x={ix + 5 + third * 2} y={iy + 3 + k * 3.4} width={third * 0.35} height={1.4} fill="#8aa0b8" /><rect x={ix + 6 + third * 2.45} y={iy + 3 + k * 3.4} width={third * 0.35} height={1.4} fill={scr} /></g>)}
        <rect x={ix + iw * 0.3} y={iy + ih - 4} width={iw * 0.4} height={2.5} rx={1} fill="#2a3344" /></>;
      break;
    }
    case 'build-preview':
      detail = <><rect x={ix + 1} y={iy + 1} width={iw - 2} height={ih - 2} rx={2} fill="#10243c" stroke={scr} strokeWidth={1.2} />
        <rect x={ix + 1} y={iy + ih * 0.62} width={iw - 2} height={ih * 0.38 - 1} fill="#2e7d3a" />
        <rect x={ix + iw * 0.18} y={iy + ih * 0.36} width={iw * 0.16} height={ih * 0.27} fill="#c0c7cf" stroke="#0a0d16" strokeWidth={0.6} />
        <rect x={ix + iw * 0.4} y={iy + ih * 0.44} width={iw * 0.12} height={ih * 0.19} fill="#ff9f43" stroke="#0a0d16" strokeWidth={0.6} />
        <path d={`M${ix + iw * 0.62},${iy + ih * 0.62} l${iw * 0.08},-${ih * 0.3} l${iw * 0.08},${ih * 0.3}z`} fill="#4cc9ff" stroke="#0a0d16" strokeWidth={0.6} />
        <circle cx={ix + iw * 0.84} cy={iy + ih * 0.55} r={2.6} fill="#ffd166" />
        <rect x={ix + 3} y={iy + 3} width={22} height={7} rx={2} fill="#c62f3a" /><circle cx={ix + 6.5} cy={iy + 6.5} r={1.4} className="led" fill="#fff" /><rect x={ix + 9.5} y={iy + 5.6} width={13} height={1.8} fill="#fff" opacity={0.85} />
        <path d={`M${ix + iw - 10},${iy + 3.5} l6,3.2 l-6,3.2z`} fill="#39ff88" /></>;
      break;
    case 'code-wall': {
      const cols = ['#c792ea', '#82aaff', '#c3e88d', '#ffcb6b', '#f78c6c', '#89ddff'];
      const pw2 = (iw - 6) / 3;
      detail = <>{[0, 1, 2].map((p) => <g key={p}><rect x={ix + 1 + p * (pw2 + 2)} y={iy + 1} width={pw2} height={ih - 2} fill="#070b14" stroke={scr} strokeOpacity={0.45} strokeWidth={0.6} />
        {[0, 1, 2].map((l) => <g key={l}><rect x={ix + 3 + p * (pw2 + 2) + (l === 1 ? 3 : 0)} y={iy + 3.5 + l * 4.2} width={pw2 * 0.28} height={1.6} fill={cols[(p * 3 + l) % 6]} /><rect x={ix + 4 + p * (pw2 + 2) + pw2 * 0.3 + (l === 1 ? 3 : 0)} y={iy + 3.5 + l * 4.2} width={pw2 * (0.2 + ((p + l) % 3) * 0.1)} height={1.6} fill={cols[(p * 3 + l + 2) % 6]} opacity={0.8} /></g>)}</g>)}
        <circle cx={ix + iw - 4} cy={iy + 4} r={1.6} fill="#39ff88" className="led" /></>;
      break;
    }
    case 'evidence-board': {
      const pins = [[0.1, 0.3], [0.32, 0.65], [0.5, 0.25], [0.7, 0.6], [0.88, 0.3]] as const;
      detail = <><rect x={ix + 1} y={iy + 1} width={iw - 2} height={ih - 2} fill="#6b4a2a" />
        {pins.map(([u, v], k) => <rect key={k} x={ix + iw * u - 5} y={iy + ih * v - 4} width={10} height={7} fill={k % 2 ? '#f4f1e8' : '#ffe9a8'} transform={`rotate(${(k % 3 - 1) * 6} ${ix + iw * u} ${iy + ih * v})`} />)}
        <path d={pins.map(([u, v], k) => `${k ? 'L' : 'M'}${ix + iw * u},${iy + ih * v - 3}`).join(' ') + ` M${ix + iw * 0.1},${iy + ih * 0.3 - 3} L${ix + iw * 0.7},${iy + ih * 0.6 - 3}`} fill="none" stroke="#ff3b4a" strokeWidth={0.9} />
        {pins.map(([u, v], k) => <circle key={k} cx={ix + iw * u} cy={iy + ih * v - 3} r={1.3} fill="#ff3b4a" />)}</>;
      break;
    }
    case 'reference-stack':
      detail = <><rect x={ix + 2} y={iy + 2} width={iw - 4} height={5} rx={2.5} fill="#0b0d1a" stroke={scr} strokeOpacity={0.7} strokeWidth={0.7} /><circle cx={ix + 5.5} cy={iy + 4.5} r={1.3} fill="none" stroke={scr} strokeWidth={0.8} /><rect x={ix + 8} y={iy + 4} width={iw * 0.4} height={1} fill={scr} opacity={0.6} />
        {[0, 1, 2, 3, 4].map((k) => <rect key={k} x={ix + 3 + k * (iw - 6) / 5} y={iy + 8.5} width={(iw - 6) / 5 - 1.5} height={ih - 11} fill={['#5ad1ff', '#b57bff', '#ffd166', '#39d0c8', '#ff6fb5'][k]} opacity={0.75} />)}</>;
      break;
    case 'note-wall': {
      const cw = (iw - 4) / 3;
      detail = <><rect x={ix + 1} y={iy + 1} width={iw - 2} height={ih - 2} fill="#e8ecef" opacity={0.92} />
        {[0, 1, 2].map((c) => <g key={c}><rect x={ix + 2 + c * cw} y={iy + 2} width={cw - 1} height={2} fill="#26313a" opacity={0.6} />{[0, 1].map((r) => <rect key={r} x={ix + 3 + c * cw + (r % 2) * 2} y={iy + 5.5 + r * 6} width={cw - 5} height={5} fill={['#ffd166', '#7ee0ff', '#ff9ad5'][c]} />)}</g>)}</>;
      break;
    }
    case 'level-layout-table': {
      const pts = [[0.12, 0.78], [0.3, 0.4], [0.52, 0.62], [0.72, 0.28], [0.88, 0.7]] as const;
      detail = <><rect x={ix + 2} y={iy + 2} width={iw - 4} height={ih - 4} rx={3} fill="#0e2a2a" stroke={scr} strokeOpacity={0.6} />
        {[1, 2, 3].map((k) => <line key={k} x1={ix + 2 + (iw - 4) * k / 4} x2={ix + 2 + (iw - 4) * k / 4} y1={iy + 2} y2={iy + ih - 2} stroke={scr} strokeOpacity={0.15} />)}
        <rect x={ix + iw * 0.36} y={iy + ih * 0.14} width={iw * 0.12} height={ih * 0.18} fill="#3a5a5a" /><rect x={ix + iw * 0.6} y={iy + ih * 0.55} width={iw * 0.08} height={ih * 0.3} fill="#3a5a5a" />
        <path d={pts.map(([u, v], k) => `${k ? 'L' : 'M'}${ix + iw * u},${iy + ih * v}`).join(' ')} fill="none" stroke="#ffd166" strokeWidth={1.4} strokeDasharray="3 2" />
        {pts.map(([u, v], k) => <circle key={k} cx={ix + iw * u} cy={iy + ih * v} r={k === 0 || k === 4 ? 3 : 2} fill={k === 0 ? '#39ff88' : k === 4 ? '#ff5d73' : scr} />)}
        <path d={`M${ix + iw * 0.2},${iy + ih * 0.2} l2.5,4 l-5,0z`} fill="#ff9f43" /></>;
      break;
    }
    case 'mechanics-board': {
      const bw = (iw - 14) / 3;
      detail = <><rect x={ix + 1} y={iy + 1} width={iw - 2} height={ih - 2} fill="#081a1c" />
        {['#39d0c8', '#ffd166', '#ff6fb5'].map((c, k) => <rect key={k} x={ix + 3 + k * (bw + 4)} y={cy - 4} width={bw} height={8} rx={2} fill="none" stroke={c} strokeWidth={1.2} />)}
        {[0, 1].map((k) => <path key={k} d={`M${ix + 3 + bw + k * (bw + 4) + 0.5},${cy} l3,0 m-2,-1.6 l2,1.6 l-2,1.6`} stroke="#e8eef0" strokeWidth={0.9} fill="none" />)}
        <path d={`M${ix + 3 + bw * 2.5 + 8},${cy + 4} q0,4 -${bw * 1.25 + 4},4 t-${bw * 1.25 + 4},-4`} stroke="#e8eef0" strokeOpacity={0.6} strokeWidth={0.8} fill="none" strokeDasharray="2 1.5" /></>;
      break;
    }
    case 'prototype-pod':
      round = true;
      detail = <><circle cx={cx} cy={cy} r={rr} fill="#0c1e20" stroke={scr} strokeWidth={1.4} />
        <rect x={cx - rr * 0.6} y={cy - rr * 0.65} width={rr * 1.2} height={rr * 0.75} rx={2} fill="#14363a" stroke={scr} strokeOpacity={0.7} strokeWidth={0.7} />
        <rect x={cx - rr * 0.35} y={cy - rr * 0.35} width={rr * 0.25} height={rr * 0.3} fill="#9aa4a8" /><rect x={cx} y={cy - rr * 0.48} width={rr * 0.3} height={rr * 0.43} fill="#c0c7cf" />
        <rect x={cx - rr * 0.45} y={cy + rr * 0.25} width={rr * 0.9} height={rr * 0.35} rx={rr * 0.17} fill="#26313a" />
        <circle cx={cx - rr * 0.25} cy={cy + rr * 0.42} r={1.3} fill="#e8eef0" /><circle cx={cx + rr * 0.22} cy={cy + rr * 0.38} r={1.1} fill="#ff5d73" /><circle cx={cx + rr * 0.34} cy={cy + rr * 0.48} r={1.1} fill="#39ff88" /></>;
      break;
    case 'planning-desk':
      detail = <><rect x={ix + 3} y={iy + 2} width={iw * 0.38} height={ih - 5} fill="#f4f1e8" transform={`rotate(-4 ${ix + 3} ${iy + 2})`} /><path d={`M${ix + 5},${iy + ih - 6} q4,-5 8,-1`} stroke="#2b6cb0" strokeWidth={0.9} fill="none" />
        <rect x={ix + iw * 0.55} y={iy + 2} width={iw * 0.3} height={ih - 6} rx={1.5} fill={scr} opacity={0.7} /><rect x={ix + iw - 7} y={iy + ih - 6} width={3.5} height={3.5} fill="#e8eef0" /></>;
      break;
    case 'blueprint-wall':
      detail = <><rect x={ix + 1} y={iy + 1} width={iw - 2} height={ih - 2} fill="#0d3a6e" />
        {Array.from({ length: 9 }, (_, k) => <line key={k} x1={ix + 1 + (iw - 2) * k / 8} x2={ix + 1 + (iw - 2) * k / 8} y1={iy + 1} y2={iy + ih - 1} stroke="#9fd0ff" strokeOpacity={0.18} />)}
        <rect x={ix + iw * 0.08} y={iy + ih * 0.3} width={iw * 0.18} height={ih * 0.45} fill="none" stroke="#e8f4ff" strokeWidth={0.9} />
        <path d={`M${ix + iw * 0.36},${iy + ih * 0.75} L${ix + iw * 0.36},${iy + ih * 0.3} L${ix + iw * 0.5},${iy + ih * 0.3} L${ix + iw * 0.58},${iy + ih * 0.75} Z`} fill="none" stroke="#e8f4ff" strokeWidth={0.9} />
        <circle cx={ix + iw * 0.78} cy={iy + ih * 0.52} r={ih * 0.24} fill="none" stroke="#e8f4ff" strokeWidth={0.9} /><circle cx={ix + iw * 0.78} cy={iy + ih * 0.52} r={ih * 0.1} fill="none" stroke="#e8f4ff" strokeWidth={0.7} />
        <path d={`M${ix + iw * 0.08},${iy + ih * 0.18} L${ix + iw * 0.26},${iy + ih * 0.18} M${ix + iw * 0.08},${iy + ih * 0.12} l0,3 M${ix + iw * 0.26},${iy + ih * 0.12} l0,3`} stroke="#ffd166" strokeWidth={0.7} /></>;
      break;
    case 'wireframe-stand': {
      round = true;
      const s0 = rr * 0.55;
      detail = <><circle cx={cx} cy={cy} r={rr} fill="#111420" stroke="#5a6070" strokeWidth={1.2} />
        <g fill="none" stroke={scr} strokeWidth={0.8} filter="url(#glow)">
          <path d={`M${cx},${cy - s0} L${cx + s0},${cy - s0 * 0.3} L${cx + s0},${cy + s0 * 0.5} L${cx},${cy + s0} L${cx - s0},${cy + s0 * 0.5} L${cx - s0},${cy - s0 * 0.3} Z`} />
          <path d={`M${cx},${cy - s0} L${cx},${cy + s0} M${cx - s0},${cy - s0 * 0.3} L${cx + s0},${cy + s0 * 0.5} M${cx + s0},${cy - s0 * 0.3} L${cx - s0},${cy + s0 * 0.5}`} strokeOpacity={0.6} />
        </g></>;
      break;
    }
    case 'material-swatches':
      detail = <>{['#c0c7cf', '#8a5a34', '#9fd8ff', '#ff6fb5', '#5a6b2e'].map((c, k) => <g key={k}><circle cx={ix + 4 + k * (iw - 8) / 4} cy={cy} r={Math.min(4, (iw - 8) / 10)} fill={c} /><circle cx={ix + 3 + k * (iw - 8) / 4} cy={cy - 1.4} r={1.1} fill="#fff" opacity={0.6} /></g>)}</>;
      break;
    case 'preview-turntable':
      round = true;
      detail = <><circle cx={cx} cy={cy} r={rr} fill="#0c1820" stroke={scr} strokeOpacity={0.7} strokeWidth={1.2} /><circle cx={cx} cy={cy} r={rr * 0.8} fill="none" stroke={scr} strokeOpacity={0.3} strokeDasharray="2 3" />
        <g className="turntable" style={{ transformOrigin: `${cx}px ${cy}px` }}><path d={`M${cx},${cy - rr * 0.5} L${cx + rr * 0.45},${cy - rr * 0.22} L${cx + rr * 0.45},${cy + rr * 0.3} L${cx},${cy + rr * 0.55} L${cx - rr * 0.45},${cy + rr * 0.3} L${cx - rr * 0.45},${cy - rr * 0.22} Z`} fill={scr} opacity={0.55} /><path d={`M${cx},${cy - rr * 0.5} L${cx},${cy + rr * 0.05} L${cx + rr * 0.45},${cy - rr * 0.22} M${cx},${cy + rr * 0.05} L${cx - rr * 0.45},${cy - rr * 0.22} M${cx},${cy + rr * 0.05} L${cx},${cy + rr * 0.55}`} stroke="#fff" strokeOpacity={0.6} strokeWidth={0.7} fill="none" /></g></>;
      break;
    case 'font-specimen-wall':
      detail = <><rect x={ix + 1} y={iy + 1} width={iw - 2} height={ih - 2} fill="#f4efe2" />
        {[{ f: 'Georgia, serif', w: 400 }, { f: 'Arial, sans-serif', w: 300 }, { f: 'Arial, sans-serif', w: 800 }, { f: '"Courier New", monospace', w: 700 }].map((t, k) => <text key={k} x={ix + 4 + k * (iw - 6) / 4} y={iy + ih - 4} fontFamily={t.f} fontWeight={t.w} fontSize={Math.min(12, ih - 4)} fill={k === 2 ? '#c62f3a' : '#1a1a1e'}>Aa</text>)}</>;
      break;
    case 'type-scale-panel':
      detail = <><rect x={ix + 1} y={iy + 1} width={iw - 2} height={ih - 2} fill="#14141a" />
        {[7, 5.5, 4, 3].map((sz, k) => <rect key={k} x={ix + 3} y={iy + 2 + k * 3.6} width={(iw - 14) * (1 - k * 0.18)} height={sz * 0.35} fill={scr} opacity={0.9 - k * 0.15} />)}
        <line x1={ix + iw - 6} x2={ix + iw - 6} y1={iy + 3} y2={iy + ih - 3} stroke="#5a6070" strokeWidth={1} /><circle cx={ix + iw - 6} cy={iy + ih * 0.4} r={1.8} fill={scr} />
        <line x1={ix + iw - 3} x2={ix + iw - 3} y1={iy + 3} y2={iy + ih - 3} stroke="#5a6070" strokeWidth={1} /><circle cx={ix + iw - 3} cy={iy + ih * 0.7} r={1.8} fill="#ff7a59" /></>;
      break;
    case 'lettering-desk':
      detail = <><rect x={ix + 3} y={iy + 2} width={iw * 0.55} height={ih - 4} fill="#f4efe2" />
        <text x={ix + 5} y={iy + ih - 4} fontFamily="Georgia, serif" fontStyle="italic" fontWeight={700} fontSize={Math.min(11, ih - 4)} fill="#1a1a1e">Ag</text>
        <line x1={ix + iw * 0.7} y1={iy + ih - 3} x2={ix + iw - 3} y2={iy + 3} stroke="#d4a84a" strokeWidth={1.6} strokeLinecap="round" /><circle cx={ix + iw - 3} cy={iy + 3} r={0.9} fill="#1a1a1e" /></>;
      break;
    case 'game-ui-preview':
      detail = <><rect x={ix + 1} y={iy + 1} width={iw - 2} height={ih - 2} fill="#1a2a4a" />
        <rect x={ix + 3} y={iy + 3} width={iw * 0.32} height={3} rx={1.5} fill="#2a1a1a" /><rect x={ix + 3} y={iy + 3} width={iw * 0.22} height={3} rx={1.5} fill="#ff5d73" />
        <text x={cx} y={iy + ih * 0.62} textAnchor="middle" fontFamily="Arial, sans-serif" fontWeight={900} fontSize={Math.min(7, ih * 0.38)} fill="#ffd166" stroke="#1a1a1e" strokeWidth={0.4}>LEVEL 1</text>
        <rect x={ix + iw - 18} y={iy + ih - 8} width={14} height={5.5} rx={2.5} fill="#39ff88" /><rect x={ix + iw - 15} y={iy + ih - 6} width={8} height={1.5} fill="#0a3a1a" /></>;
      break;
    case 'modular-parts-rack': {
      const bw = (iw - 4) / 4;
      detail = <>{[0, 1, 2, 3].map((k) => <rect key={k} x={ix + 2 + k * bw} y={iy + 2} width={bw - 1.5} height={ih - 4} fill="#1a1c20" />)}
        <rect x={ix + 4} y={cy - 2.5} width={bw - 5} height={5} fill="#c62f3a" /><rect x={ix + 5} y={cy - 4} width={2} height={1.5} fill="#e85a5a" /><rect x={ix + bw - 4} y={cy - 4} width={2} height={1.5} fill="#e85a5a" />
        <path d={`M${ix + 3.5 + bw},${cy + 3} l${bw - 5},0 l0,-6 z`} fill="#2b6cb0" />
        <ellipse cx={ix + 2 + bw * 2.5} cy={cy} rx={(bw - 5) / 2} ry={3.2} fill="#39b54a" />
        <circle cx={ix + 2 + bw * 3.5} cy={cy} r={3} fill="#f2c230" /></>;
      break;
    }
    case 'terrain-table':
      detail = <><rect x={ix + 2} y={iy + 2} width={iw - 4} height={ih - 4} rx={3} fill="#3c6e2e" />
        <ellipse cx={ix + iw * 0.3} cy={iy + ih * 0.4} rx={iw * 0.2} ry={ih * 0.24} fill="#5a8a3a" /><ellipse cx={ix + iw * 0.3} cy={iy + ih * 0.4} rx={iw * 0.1} ry={ih * 0.12} fill="#8aa05a" />
        <path d={`M${ix + 2},${iy + ih * 0.78} Q${ix + iw * 0.4},${iy + ih * 0.6} ${ix + iw * 0.62},${iy + ih - 2} L${ix + 2},${iy + ih - 2}Z`} fill="#2b6cb0" opacity={0.85} />
        <rect x={ix + iw * 0.62} y={iy + ih * 0.22} width={iw * 0.2} height={ih * 0.3} fill="#c0c7cf" stroke="#1a1a1e" strokeWidth={0.6} /><path d={`M${ix + iw * 0.6},${iy + ih * 0.22} l${iw * 0.12},-${ih * 0.12} l${iw * 0.12},${ih * 0.12}z`} fill="#c62f3a" stroke="#1a1a1e" strokeWidth={0.6} />
        <rect x={ix + iw * 0.82} y={iy + ih * 0.65} width={4} height={4} fill="#f2c230" stroke="#1a1a1e" strokeWidth={0.5} /></>;
      break;
    case 'scale-figure':
      detail = <><line x1={ix + 3} x2={ix + 3} y1={iy + 2} y2={iy + ih - 2} stroke="#f2c230" strokeWidth={1.2} />{[0, 1, 2, 3].map((k) => <line key={k} x1={ix + 2} x2={ix + 5} y1={iy + 2 + k * (ih - 4) / 3} y2={iy + 2 + k * (ih - 4) / 3} stroke="#f2c230" strokeWidth={0.8} />)}
        <rect x={cx - 1} y={cy - 6} width={6} height={5} rx={1} fill="#d8c8a8" stroke="#1a1a1e" strokeWidth={0.5} /><rect x={cx - 1.5} y={cy - 1} width={7} height={6} fill="#6b7377" stroke="#1a1a1e" strokeWidth={0.5} /><rect x={cx - 1} y={cy + 5} width={6} height={3} fill="#3a3f46" /></>;
      break;
    case 'build-plan-board': {
      const steps = [1, 1, 0.6, 0];
      const sw = (iw - 6) / 4;
      detail = <><rect x={ix + 1} y={iy + 1} width={iw - 2} height={ih - 2} fill="#121608" />
        {steps.map((p, k) => <g key={k}><rect x={ix + 3 + k * sw} y={iy + 3} width={sw - 2} height={ih - 10} fill="none" stroke="#f2c230" strokeOpacity={0.5} strokeWidth={0.7} />{p === 1 && <path d={`M${ix + 4.5 + k * sw},${iy + 6} l2,2 l3.5,-4`} stroke="#39ff88" strokeWidth={1.2} fill="none" />}
          <rect x={ix + 3 + k * sw} y={iy + ih - 5} width={(sw - 2) * Math.max(0.08, p)} height={2} fill={p === 1 ? '#39ff88' : p > 0 ? '#f2c230' : '#5a6070'} /></g>)}</>;
      break;
    }
    case 'campaign-board':
      detail = <><rect x={ix + 1} y={iy + 1} width={iw - 2} height={ih - 2} fill="#140a12" />
        {[0, 1, 2].map((r) => <g key={r}><rect x={ix + 3} y={iy + 3 + r * 4.5} width={4} height={2.4} fill={['#ff6fb5', '#4cc9ff', '#ffd166'][r]} /><rect x={ix + 9 + r * 6} y={iy + 3 + r * 4.5} width={iw * 0.35} height={2.4} rx={1.2} fill={['#ff6fb5', '#4cc9ff', '#ffd166'][r]} opacity={0.55} /></g>)}
        <line x1={ix + iw * 0.72} x2={ix + iw * 0.72} y1={iy + 2} y2={iy + ih - 2} stroke="#fff" strokeOpacity={0.8} strokeDasharray="1.5 1.5" /><path d={`M${ix + iw * 0.72},${iy + 2} l4,2 l-4,2z`} fill="#ff5d73" /></>;
      break;
    case 'concept-review-wall': {
      const tw2 = (iw - 6) / 4;
      const marks = ['ok', 'ok', 'rev', 'no'];
      detail = <><rect x={ix + 1} y={iy + 1} width={iw - 2} height={ih - 2} fill="#1a0e1e" />
        {marks.map((mk, k) => <g key={k}><rect x={ix + 3 + k * tw2} y={iy + 3} width={tw2 - 2} height={ih - 6} fill={['#7a3a8a', '#2b6cb0', '#d9772b', '#3a3f46'][k]} opacity={0.75} stroke={mk === 'ok' ? '#39ff88' : mk === 'rev' ? '#ffd166' : '#ff5d73'} strokeWidth={1} />
          {mk === 'ok' ? <path d={`M${ix + 5 + k * tw2},${iy + 7} l2,2 l4,-4`} stroke="#39ff88" strokeWidth={1.3} fill="none" /> : mk === 'no' ? <path d={`M${ix + 5 + k * tw2},${iy + 5} l4,4 m0,-4 l-4,4`} stroke="#ff5d73" strokeWidth={1.3} /> : <circle cx={ix + 7 + k * tw2} cy={iy + 7} r={2} fill="none" stroke="#ffd166" strokeWidth={1.2} />}</g>)}</>;
      break;
    }
    case 'image-draft-gallery': {
      const tw2 = (iw - 4) / 4;
      detail = <><rect x={ix + 1} y={iy + 1} width={iw - 2} height={ih - 2} fill="#14101c" />
        {[0, 1, 2, 3].map((k) => <g key={k}><rect x={ix + 2.5 + k * tw2} y={iy + 3} width={tw2 - 2} height={ih - 6} fill={['#2b4a7a', '#5a2a6a', '#2e6a4a', '#6a4a2a'][k]} stroke="#e8eef0" strokeOpacity={0.6} strokeWidth={0.7} strokeDasharray="2 1.5" />
          <circle cx={ix + 5 + k * tw2} cy={iy + 6} r={1.4} fill="#ffd166" opacity={0.8} /><path d={`M${ix + 3 + k * tw2},${iy + ih - 3.5} l${tw2 * 0.35},-${ih * 0.3} l${tw2 * 0.4},${ih * 0.3}`} fill="#e8eef0" opacity={0.35} /></g>)}</>;
      break;
    }
    case 'final-asset-display':
      detail = <><rect x={ix + 1} y={iy + 1} width={iw - 2} height={ih - 2} fill="#d4a84a" /><rect x={ix + 3} y={iy + 3} width={iw - 6} height={ih - 6} fill="#3a1030" />
        <path d={`M${cx},${iy + 4} l1.6,3.3 l3.6,0.4 l-2.7,2.4 l0.8,3.5 l-3.3,-1.8 l-3.3,1.8 l0.8,-3.5 l-2.7,-2.4 l3.6,-0.4z`} fill="#ffd166" />
        <rect x={ix + iw - 9} y={iy + ih - 7} width={6} height={3} rx={1} fill="#39ff88" /></>;
      break;
    case 'devil-bubble': {
      round = true; bodyless = true;
      const spires = 8;
      detail = <><circle cx={cx} cy={cy} r={rr} fill="url(#devil-bubble-fill)" />
        <circle className="devil-pulse" cx={cx} cy={cy} r={rr * 0.94} fill="none" stroke="#ff2a4a" strokeOpacity={0.75} strokeWidth={2.2} filter="url(#glow)" style={{ transformOrigin: `${cx}px ${cy}px` }} />
        <circle cx={cx} cy={cy} r={rr * 0.82} fill="none" stroke="#b86bff" strokeOpacity={0.5} strokeWidth={1} strokeDasharray="5 4" />
        {Array.from({ length: spires }, (_, i) => {
          // curved horn-like spires on the rim, pointing outward
          const a = (i / spires) * Math.PI * 2 - Math.PI / 2, n = a + 0.16, p = a - 0.16;
          const bx1 = cx + Math.cos(p) * rr * 0.9, by1 = cy + Math.sin(p) * rr * 0.9, bx2 = cx + Math.cos(n) * rr * 0.9, by2 = cy + Math.sin(n) * rr * 0.9;
          const tx = cx + Math.cos(a + 0.12) * rr * 1.14, ty = cy + Math.sin(a + 0.12) * rr * 1.14;
          return <path key={i} d={`M${bx1},${by1} Q${cx + Math.cos(a - 0.05) * rr * 1.06},${cy + Math.sin(a - 0.05) * rr * 1.06} ${tx},${ty} Q${cx + Math.cos(a + 0.1) * rr * 1.0},${cy + Math.sin(a + 0.1) * rr * 1.0} ${bx2},${by2} Z`} fill="#2a0610" stroke="#ff3b5c" strokeWidth={0.9} />;
        })}
        <ellipse cx={cx - rr * 0.35} cy={cy - rr * 0.5} rx={rr * 0.25} ry={rr * 0.09} fill="#ffb3c2" opacity={0.35} transform={`rotate(-30 ${cx - rr * 0.35} ${cy - rr * 0.5})`} /></>;
      break;
    }
    case 'war-table':
      detail = <><rect x={ix + 2} y={iy + 2} width={iw - 4} height={ih - 4} rx={4} fill="#120810" stroke="#ff3b5c" strokeOpacity={0.6} />
        <circle cx={cx} cy={cy} r={3} fill="#ff3b5c" />
        {Array.from({ length: 7 }, (_, i) => { const a = (i / 7) * Math.PI * 2; const x2 = cx + Math.cos(a) * (iw / 2 - 7), y2 = cy + Math.sin(a) * (ih / 2 - 5); return <g key={i}><line x1={cx} y1={cy} x2={x2} y2={y2} stroke="#b86bff" strokeOpacity={0.45} strokeWidth={0.8} /><rect x={x2 - 2} y={y2 - 2} width={4} height={4} rx={1} fill={['#4cc9ff', '#b57bff', '#39d0c8', '#ff9f43', '#f4e7c8', '#f2c230', '#ff6fb5'][i]} /></g>; })}</>;
      break;
    case 'command-display':
      detail = <><rect x={ix + 1} y={iy + 1} width={iw - 2} height={ih - 2} fill="#0e060c" stroke="#ff3b5c" strokeOpacity={0.5} strokeWidth={0.7} />
        {['#4cc9ff', '#b57bff', '#39d0c8', '#ff9f43', '#f4e7c8', '#f2c230', '#ff6fb5'].map((c, k) => <rect key={k} x={ix + 3 + k * (iw - 6) / 7} y={iy + ih - 3 - (ih - 7) * (0.35 + ((k * 37) % 60) / 100)} width={(iw - 6) / 7 - 1.5} height={(ih - 7) * (0.35 + ((k * 37) % 60) / 100)} fill={c} opacity={0.8} />)}</>;
      break;
    case 'dark-candelabra':
      round = true; bodyless = true;
      detail = <><circle cx={cx} cy={cy} r={rr} fill="#b86bff" opacity={0.12} filter="url(#glow)" /><circle cx={cx} cy={cy} r={rr * 0.55} fill="#1a1014" stroke="#5a4a50" strokeWidth={1} />
        {[[-1, 0], [1, 0], [0, -1]].map(([dx, dy], k) => <circle key={k} className="candle" cx={cx + dx * rr * 0.4} cy={cy + dy * rr * 0.4} r={1.7} fill="#c58aff" style={{ animationDelay: `${k * 0.4}s` }} />)}</>;
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
