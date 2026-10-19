// Bubble Office preset: rooms float as translucent soap-bubble pods and hallways
// become glass transport tubes. Fills stay faint and the sheen sits on the rims,
// so agents, labels and activity inside are never covered.
import { memo } from 'react';
import type { Corridor, Furniture, Room } from '../model/types';
import { doorSegment } from '../engine/geometry';
import { FurnitureShape, G, corridorPx } from './OfficeLayers';
import { kelvinColor } from '../model/themes';

/** Shared gradients for bubbles and tubes. User-space units so straight tubes (zero-height boxes) still paint. */
export function BubbleDefs() {
  return (
    <defs>
      <linearGradient id="bubble-iris" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="420" y2="300" spreadMethod="reflect">
        <stop offset="0" stopColor="#7cf7ff" />
        <stop offset="0.3" stopColor="#a98bff" />
        <stop offset="0.55" stopColor="#ff9ad5" />
        <stop offset="0.8" stopColor="#ffe29a" />
        <stop offset="1" stopColor="#7cf7ff" />
      </linearGradient>
      <radialGradient id="bubble-sheen" cx="0.5" cy="0.45" r="0.62">
        <stop offset="0.62" stopColor="#ffffff" stopOpacity="0" />
        <stop offset="0.9" stopColor="#bdf3ff" stopOpacity="0.08" />
        <stop offset="1" stopColor="#ffffff" stopOpacity="0.16" />
      </radialGradient>
    </defs>
  );
}

const radius = (room: Room) => Math.min(70, Math.min(room.w, room.h) * G * 0.32);

export const BubbleRoomShape = memo(function BubbleRoomShape({
  room, furniture, selected, invalid, occupancy, showLabel, showBoundary, construct,
}: { room: Room; furniture: Furniture[]; selected: boolean; invalid: boolean; occupancy: number | null; showLabel: boolean; showBoundary: boolean; construct: boolean }) {
  const x = room.x * G, y = room.y * G, w = room.w * G, h = room.h * G;
  const rx = radius(room);
  const ap = room.appearance;
  const acc = ap.accent;
  const clip = `bclip-${room.id}`;
  const labelW = Math.min(w - 24, room.name.length * 7.4 + 18);
  return (
    <g className={`room bubble${selected ? ' selected' : ''}${invalid ? ' invalid' : ''}`}>
      <clipPath id={clip}><rect x={x} y={y} width={w} height={h} rx={rx} /></clipPath>
      <rect x={x - 6} y={y - 6} width={w + 12} height={h + 12} rx={rx + 6} fill="none" stroke={acc} strokeOpacity={0.12 + ap.lighting * 0.12} strokeWidth={8} filter="url(#glow)" pointerEvents="none" />
      <g clipPath={`url(#${clip})`}>
        <rect data-kind="room" data-id={room.id} x={x} y={y} width={w} height={h} fill={`url(#fl-${ap.floor})`} opacity={0.42} />
        <rect x={x} y={y} width={w} height={h} fill={ap.floorColor || acc} opacity={ap.floorColor ? 0.22 : 0.06} pointerEvents="none" />
        <rect x={x} y={y} width={w} height={h} fill={ap.lightTemp ? kelvinColor(ap.lightTemp) : 'var(--light)'} opacity={0.03 + ap.lighting * 0.06} pointerEvents="none" />
        <g pointerEvents="none">
          {furniture.map((f) => {
            const rot = f.rotation === 90 || f.rotation === 270;
            return <FurnitureShape key={f.id} f={ap.furnitureMaterial && ap.furnitureMaterial !== 'default' && !f.material ? { ...f, material: ap.furnitureMaterial } : f} x={room.x + f.x} y={room.y + f.y} w={rot ? f.h : f.w} h={rot ? f.w : f.h} display={ap.displayColor} />;
          })}
        </g>
        <rect x={x} y={y} width={w} height={h} fill="url(#bubble-sheen)" pointerEvents="none" />
      </g>
      <g pointerEvents="none">
        <rect x={x} y={y} width={w} height={h} rx={rx} fill="none" stroke="url(#bubble-iris)" strokeWidth={2.5} strokeOpacity={0.85} />
        <rect x={x + 3} y={y + 3} width={w - 6} height={h - 6} rx={Math.max(0, rx - 3)} fill="none" stroke={acc} strokeOpacity={0.3} strokeWidth={1} />
        {/* glossy highlight: a short arc on the upper-left rim and a pin-point glint */}
        <path d={`M${x + 6},${y + rx * 1.05} Q${x + 6},${y + 6} ${x + rx * 1.05},${y + 6}`} fill="none" stroke="#ffffff" strokeOpacity={0.38} strokeWidth={2.5} strokeLinecap="round" />
        <circle cx={x + rx * 1.05 + 9} cy={y + 6} r={1.8} fill="#ffffff" opacity={0.5} />
        {room.doors.map((d) => {
          // where a tube meets the bubble: a soft iridescent socket instead of a door
          const s = doorSegment(room, d);
          const cx = ((s.a.x + s.b.x) / 2) * G, cy = ((s.a.y + s.b.y) / 2) * G;
          const r = (Math.hypot(s.b.x - s.a.x, s.b.y - s.a.y) * G) / 2 + 2;
          return <ellipse key={d.id} className="tube-socket" cx={cx} cy={cy} rx={d.side === 'n' || d.side === 's' ? r : 5} ry={d.side === 'n' || d.side === 's' ? 5 : r} fill="none" stroke="url(#bubble-iris)" strokeWidth={2} strokeOpacity={0.9} />;
        })}
      </g>
      {showBoundary && <rect x={x + 6} y={y + 6} width={w - 12} height={h - 12} rx={Math.max(0, rx - 6)} fill="none" stroke={acc} strokeOpacity={0.35} strokeWidth={1} strokeDasharray={construct ? '4 4' : undefined} pointerEvents="none" />}
      {invalid && <rect className="pulse" x={x - 2} y={y - 2} width={w + 4} height={h + 4} rx={rx + 2} fill="rgba(255,93,115,.12)" stroke="var(--danger)" strokeWidth={3} pointerEvents="none" />}
      {selected && <rect x={x - 4} y={y - 4} width={w + 8} height={h + 8} rx={rx + 4} fill="none" stroke="var(--accent)" strokeWidth={2} filter="url(#glow)" pointerEvents="none" />}
      {showLabel && (
        <g pointerEvents="none">
          <rect x={x + w / 2 - labelW / 2} y={y - 9} width={labelW} height={18} rx={9} fill="var(--label-bg)" stroke={acc} strokeOpacity={0.7} />
          <text x={x + w / 2} y={y + 4} textAnchor="middle" className="room-label" fill={acc}>{room.name.toUpperCase()}</text>
          {occupancy !== null && (
            <g>
              <circle cx={x + w / 2 + labelW / 2 + 12} cy={y} r={9} fill="var(--label-bg)" stroke={acc} strokeOpacity={0.7} />
              <text x={x + w / 2 + labelW / 2 + 12} y={y + 4} className="room-label" textAnchor="middle" fill={occupancy ? acc : 'var(--muted)'}>{occupancy}</text>
            </g>
          )}
        </g>
      )}
    </g>
  );
});

/** A hallway drawn as a glass transport tube with an iridescent rim and a faint flow of light. */
export const TubeShape = memo(function TubeShape({ c, selected }: { c: Corridor; selected?: boolean }) {
  if (c.points.length < 2) return null;
  const px = corridorPx(c);
  const pts = px.map((p) => `${p.x},${p.y}`).join(' ');
  const w = c.width * G;
  const broken = c.status === 'broken';
  const g = -w * 0.24;
  return (
    <g data-kind="corridor" data-id={c.id} className="corridor tube">
      <polyline points={pts} fill="none" stroke="#7cf7ff" strokeOpacity={0.08} strokeWidth={w + 12} strokeLinecap="round" strokeLinejoin="round" pointerEvents="none" />
      <polyline points={pts} fill="none" stroke={broken ? 'var(--danger)' : c.status === 'warning' ? 'var(--warn)' : 'url(#bubble-iris)'} strokeOpacity={0.6} strokeWidth={w + 3} strokeLinecap="round" strokeLinejoin="round" />
      <polyline points={pts} fill="none" stroke="var(--tube-glass)" strokeWidth={w - 1} strokeLinecap="round" strokeLinejoin="round" />
      <polyline className="tube-flow" points={pts} fill="none" stroke="#c8f8ff" strokeOpacity={c.blocked ? 0 : 0.3} strokeWidth={2} strokeDasharray="3 21" strokeLinecap="round" pointerEvents="none" />
      <polyline points={pts} transform={`translate(${g} ${g})`} fill="none" stroke="#ffffff" strokeOpacity={0.22} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" pointerEvents="none" />
      {c.blocked && <polyline points={pts} fill="none" stroke="url(#hazard)" strokeWidth={w - 2} strokeLinecap="round" pointerEvents="none" />}
      {selected && <polyline points={pts} fill="none" stroke="var(--accent)" strokeWidth={w + 8} strokeOpacity={0.25} strokeLinecap="round" strokeLinejoin="round" filter="url(#glow)" pointerEvents="none" />}
      {broken && <polyline points={pts} fill="none" stroke="var(--danger)" strokeWidth={3} strokeDasharray="6 6" pointerEvents="none" />}
    </g>
  );
});
