// Agents as bouncy balls: a glossy sphere in the agent's colour with a small
// face. The face follows the agent's look (eyes, mouth, cheeks, a hair tuft)
// and its mood follows what the agent is doing right now.
import { memo, useId } from 'react';
import type { AgentStatus, Appearance, Expression } from '../model/types';
import { shade } from '../characters/color';

export type Mood = Expression | 'sleepy' | 'worried' | 'thinking' | 'talking';

/** What the face shows: the resting expression, unless the agent's status says otherwise. */
export function moodFor(status: AgentStatus | undefined, rest: Expression = 'smile'): Mood {
  switch (status) {
    case 'working': return 'focused';
    case 'researching': return 'focused';
    case 'thinking': return 'thinking';
    case 'communicating': return 'talking';
    case 'error': case 'blocked': return 'worried';
    case 'paused': return 'sleepy';
    case 'waiting': return 'neutral';
    default: return rest;
  }
}

/** The ball's body colour: the agent's main colour, lifted to a bright, saturated tone so the face always reads. */
export function ballColor(a: Appearance): string {
  const hex = (a.topColor || a.accent || '#7cf7ff').trim();
  const m = /^#?([0-9a-f]{6}|[0-9a-f]{3})$/i.exec(hex);
  if (!m) return hex;
  const h6 = m[1].length === 3 ? m[1].split('').map((c) => c + c).join('') : m[1];
  const n = parseInt(h6, 16);
  const r = ((n >> 16) & 255) / 255, g = ((n >> 8) & 255) / 255, b = (n & 255) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2, d = max - min;
  let h = 0;
  if (d) h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  const s = d ? d / (1 - Math.abs(2 * l - 1)) : 0;
  // greys stay grey (just lighter); colours get enough light and saturation to glow
  const L = Math.max(l, 0.6), S = s < 0.08 ? s : Math.max(s, 0.55);
  const c = (1 - Math.abs(2 * L - 1)) * S, x = c * (1 - Math.abs(((h % 6) + 6) % 6 % 2 - 1)), o = L - c / 2;
  const hh = ((h % 6) + 6) % 6;
  const [R, G, B] = hh < 1 ? [c, x, 0] : hh < 2 ? [x, c, 0] : hh < 3 ? [0, c, x] : hh < 4 ? [0, x, c] : hh < 5 ? [x, 0, c] : [c, 0, x];
  const to = (v: number) => Math.round((v + o) * 255).toString(16).padStart(2, '0');
  return `#${to(R)}${to(G)}${to(B)}`;
}

/** Shared shading for every ball in one SVG. Render once, pass the same id to each AgentBall. */
export function BallDefs({ id }: { id: string }) {
  return (
    <defs>
      <radialGradient id={`${id}-shade`} cx="0.36" cy="0.3" r="0.78">
        <stop offset="0" stopColor="#ffffff" stopOpacity="0.55" />
        <stop offset="0.28" stopColor="#ffffff" stopOpacity="0.12" />
        <stop offset="0.7" stopColor="#000000" stopOpacity="0" />
        <stop offset="1" stopColor="#000000" stopOpacity="0.38" />
      </radialGradient>
    </defs>
  );
}

function Tuft({ style, color, r }: { style: Appearance['hairStyle']; color: string; r: number }) {
  const y = -r * 0.92;
  const s = r / 20;
  switch (style) {
    case 'bald': case 'buzz': return null;
    case 'spiky': case 'mohawk':
      return <path d={`M${-7 * s},${y + 3 * s} L${-4 * s},${y - 6 * s} L${-1 * s},${y + 1 * s} L${2 * s},${y - 8 * s} L${4 * s},${y + 1 * s} L${7 * s},${y - 5 * s} L${8 * s},${y + 4 * s}Z`} fill={color} />;
    case 'curly': case 'afro':
      return <g fill={color}>{[-6, 0, 6].map((dx) => <circle key={dx} cx={dx * s} cy={y - (dx ? 1 : 3) * s} r={4.2 * s} />)}</g>;
    case 'bun': case 'ponytail': case 'long': case 'braids':
      return <circle cx={0} cy={y - 3.5 * s} r={5 * s} fill={color} />;
    case 'twin-buns':
      return <g fill={color}><circle cx={-9 * s} cy={y + 1 * s} r={4.4 * s} /><circle cx={9 * s} cy={y + 1 * s} r={4.4 * s} /></g>;
    default: // short, swept, undercut: a little swoosh
      return <path d={`M${-8 * s},${y + 4 * s} Q${-2 * s},${y - 8 * s} ${9 * s},${y - 3 * s} Q${2 * s},${y - 1 * s} ${-8 * s},${y + 4 * s}Z`} fill={color} />;
  }
}

function Eyes({ a, mood, r }: { a: Appearance; mood: Mood; r: number }) {
  const s = r / 20;
  const ex = 6.5 * s, ey = -2.5 * s;
  const ink = '#14121a';
  const look = mood === 'thinking' ? { x: 1.2 * s, y: -1.6 * s } : { x: 0, y: 0 };
  if (mood === 'sleepy') {
    return <g fill="none" stroke={ink} strokeWidth={1.6 * s} strokeLinecap="round">{[-ex, ex].map((x) => <path key={x} d={`M${x - 3 * s},${ey} Q${x},${ey + 2.6 * s} ${x + 3 * s},${ey}`} />)}</g>;
  }
  if (a.eyeStyle === 'visor') {
    return <rect x={-12 * s} y={ey - 3.2 * s} width={24 * s} height={6.4 * s} rx={3.2 * s} fill={ink} stroke={a.eyeColor} strokeWidth={1.2 * s}>
    </rect>;
  }
  const wide = a.eyeStyle === 'wide' || mood === 'surprised';
  return (
    <g>
      {[-ex, ex].map((x) => (
        <g key={x}>
          {wide ? (
            <>
              <ellipse cx={x} cy={ey} rx={3.6 * s} ry={4.2 * s} fill="#ffffff" />
              <circle cx={x + look.x} cy={ey + look.y + 0.4 * s} r={2.1 * s} fill={a.eyeColor || ink} />
              <circle cx={x + look.x + 0.6 * s} cy={ey + look.y - 0.6 * s} r={0.7 * s} fill="#ffffff" />
            </>
          ) : a.eyeStyle === 'almond' ? (
            <ellipse cx={x + look.x} cy={ey + look.y} rx={2.8 * s} ry={1.9 * s} fill={ink} transform={`rotate(${x < 0 ? -12 : 12} ${x} ${ey})`} />
          ) : (
            <>
              <circle cx={x + look.x} cy={ey + look.y} r={2.3 * s} fill={ink} />
              <circle cx={x + look.x + 0.7 * s} cy={ey + look.y - 0.7 * s} r={0.65 * s} fill="#ffffff" />
            </>
          )}
        </g>
      ))}
      {(mood === 'determined' || mood === 'worried' || mood === 'focused') && (
        <g stroke={ink} strokeWidth={1.4 * s} strokeLinecap="round">
          {[-ex, ex].map((x) => {
            const inner = x < 0 ? x + 3 * s : x - 3 * s, outer = x < 0 ? x - 3 * s : x + 3 * s;
            const tilt = mood === 'worried' ? -1.8 : mood === 'focused' ? 0 : 1.8;
            return <line key={x} x1={outer} y1={ey - 5 * s} x2={inner} y2={ey - 5 * s + tilt * s} />;
          })}
        </g>
      )}
    </g>
  );
}

function Mouth({ a, mood, r }: { a: Appearance; mood: Mood; r: number }) {
  const s = r / 20;
  const y = 6 * s;
  const w = (a.mouth === 'wide' ? 6 : a.mouth === 'full' ? 5 : 4) * s;
  const ink = '#14121a';
  const line = { fill: 'none', stroke: ink, strokeWidth: 1.6 * s, strokeLinecap: 'round' as const };
  switch (mood) {
    case 'grin': case 'talking':
      return <path d={`M${-w - s},${y - s} Q0,${y + 7 * s} ${w + s},${y - s}Z`} fill={ink} />;
    case 'surprised':
      return <ellipse cx={0} cy={y + s} rx={2.4 * s} ry={3 * s} fill={ink} />;
    case 'smirk':
      return <path d={`M${-w},${y + 0.5 * s} Q${w * 0.4},${y + 2 * s} ${w + s},${y - 2 * s}`} {...line} />;
    case 'worried':
      return <path d={`M${-w},${y + 2 * s} Q${-w / 2},${y - s} 0,${y + 1 * s} Q${w / 2},${y + 3 * s} ${w},${y}`} {...line} />;
    case 'sleepy':
      return <ellipse cx={0} cy={y + s} rx={1.6 * s} ry={1.2 * s} fill={ink} />;
    case 'neutral': case 'focused': case 'determined': case 'thinking':
      return <line x1={-w * 0.7} y1={y + s} x2={w * 0.7} y2={y + s} {...line} />;
    default: // smile
      return <path d={`M${-w},${y - 0.5 * s} Q0,${y + 4.5 * s} ${w},${y - 0.5 * s}`} {...line} />;
  }
}

export interface AgentBallProps {
  a: Appearance;
  r: number;
  mood?: Mood;
  /** Id passed to the BallDefs rendered in the same SVG. */
  defsId: string;
  /** Status colour for the ring around the ball; none when omitted. */
  ring?: string;
  selected?: boolean;
}

/** One agent ball centred on 0,0. Place it with a transform on a parent <g>. */
export const AgentBall = memo(function AgentBall({ a, r, mood = 'smile', defsId, ring, selected }: AgentBallProps) {
  const body = ballColor(a);
  const s = r / 20;
  return (
    <g className="agent-ball">
      <ellipse className="ball-shadow" cx={0} cy={r * 1.02} rx={r * 0.78} ry={r * 0.2} fill="#000" opacity={0.28} />
      <g className="ball-body">
        {ring && <circle r={r + 3.5 * s} fill="none" stroke={ring} strokeWidth={2.4 * s} opacity={0.9} />}
        {selected && <circle r={r + 7 * s} fill="none" stroke="var(--accent)" strokeWidth={2 * s} strokeDasharray={`${3 * s} ${3 * s}`} />}
        <Tuft style={a.hairStyle} color={a.hairColor} r={r} />
        <circle r={r} fill={body} stroke={shade(body, -0.45)} strokeWidth={1.2 * s} />
        <circle r={r} fill={`url(#${defsId}-shade)`} />
        <g className="ball-face">
          <Eyes a={a} mood={mood} r={r} />
          <Mouth a={a} mood={mood} r={r} />
          {(a.cheeks === 'blush' || mood === 'grin') && <g fill="#ff7aa8" opacity={0.55}><ellipse cx={-11 * s} cy={4 * s} rx={2.8 * s} ry={1.6 * s} /><ellipse cx={11 * s} cy={4 * s} rx={2.8 * s} ry={1.6 * s} /></g>}
          {a.faceMarkings === 'freckles' && <g fill={shade(body, -0.4)}>{[[-10, 1], [-8, 3], [-11, 4], [10, 1], [8, 3], [11, 4]].map(([x, y]) => <circle key={`${x},${y}`} cx={x * s} cy={y * s} r={0.7 * s} />)}</g>}
          {(a.glasses === 'round' || a.glasses === 'square') && a.eyeStyle !== 'visor' && (
            <g fill="none" stroke="#14121a" strokeWidth={1.1 * s}>
              {a.glasses === 'round' ? <><circle cx={-6.5 * s} cy={-2.5 * s} r={4.4 * s} /><circle cx={6.5 * s} cy={-2.5 * s} r={4.4 * s} /></> : <><rect x={-11 * s} y={-6.5 * s} width={9 * s} height={7.5 * s} rx={1.2 * s} /><rect x={2 * s} y={-6.5 * s} width={9 * s} height={7.5 * s} rx={1.2 * s} /></>}
              <line x1={-2 * s} y1={-3 * s} x2={2 * s} y2={-3 * s} />
            </g>
          )}
        </g>
        {mood === 'thinking' && <text x={r * 0.7} y={-r * 0.85} fontSize={9 * s} fill="var(--text)" className="ball-think">…</text>}
        {mood === 'sleepy' && <text x={r * 0.62} y={-r * 0.78} fontSize={8 * s} fill="var(--muted)" className="ball-zzz">z</text>}
      </g>
    </g>
  );
});

/** A standalone ball in its own small SVG, for lists, chips and profile headers. */
export function BallIcon({ a, size = 32, mood, ring, title }: { a: Appearance; size?: number; mood?: Mood; ring?: string; title?: string }) {
  const id = useId().replace(/[^a-zA-Z0-9_-]/g, '');
  const r = 20;
  const pad = ring ? 7 : 4;
  return (
    <svg className="ball-icon" width={size} height={size} viewBox={`${-r - pad} ${-r - pad - 4} ${(r + pad) * 2} ${(r + pad) * 2 + 4}`} role={title ? 'img' : undefined} aria-label={title || undefined} aria-hidden={title ? undefined : true}>
      {title && <title>{title}</title>}
      <BallDefs id={id} />
      <AgentBall a={a} r={r} mood={mood} defsId={id} ring={ring} />
    </svg>
  );
}
