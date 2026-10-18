// Procedural character renderer. One canonical `Appearance` drives genuinely
// different drawings per view (front, side, three-quarter, top-down, portrait);
// side and top views are drawn from their own geometry, never a rotated sprite.
import { memo, useId } from 'react';
import type { Appearance, ViewMode } from '../model/types';
import { shade } from './color';
import { EquipmentExtra, FrontBack, FrontBody, FrontFaceExtras, FrontOver, SideExtras, TopExtras, handColor } from './extras';

export type Pose = 'idle' | 'walk' | 'work';

export interface CharacterProps {
  a: Appearance;
  view: ViewMode;
  pose?: Pose;
  frame?: number;              // walk/work animation frame 0..3
  facing?: 'left' | 'right';
  heading?: 'up' | 'down' | 'left' | 'right'; // top view orientation
  size?: number;               // rendered height in px
  assetUrl?: string | null;    // approved artwork for this view, if any
  title?: string;
}

interface Ctx { a: Appearance; s: { stroke: string; strokeWidth: number; strokeLinejoin: 'round'; strokeLinecap: 'round' }; gid: string; pose: Pose; frame: number }

const TW = { slim: 28, average: 34, broad: 42 } as const;
const TD = { slim: 20, average: 24, broad: 30 } as const;

function strokeFor(a: Appearance) {
  const neon = a.artStyle === 'neon';
  return { stroke: neon ? a.accent : '#061009', strokeWidth: a.outline * (a.artStyle === 'realistic' ? 0.6 : 1), strokeLinejoin: 'round' as const, strokeLinecap: 'round' as const };
}

function Defs({ c }: { c: Ctx }) {
  return (
    <defs>
      <linearGradient id={`${c.gid}-shade`} x1="0" x2="1" y1="0" y2="0">
        <stop offset="0" stopColor="#000" stopOpacity="0" />
        <stop offset="1" stopColor="#000" stopOpacity={c.a.shading === 'none' ? 0 : 0.32} />
      </linearGradient>
      <linearGradient id={`${c.gid}-light`} x1="0" x2="0" y1="0" y2="1">
        <stop offset="0" stopColor="#fff" stopOpacity={c.a.artStyle === 'realistic' ? 0.22 : 0.1} />
        <stop offset="1" stopColor="#fff" stopOpacity="0" />
      </linearGradient>
      <filter id={`${c.gid}-glow`} x="-30%" y="-30%" width="160%" height="160%">
        <feGaussianBlur stdDeviation="1.6" result="b" />
        <feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge>
      </filter>
    </defs>
  );
}

/** Shading overlay for a shape: soft gradient or a hard half-tone, per appearance.shading. */
function Shade({ c, children }: { c: Ctx; children: React.ReactElement }) {
  if (c.a.shading === 'none' || c.a.artStyle === 'flat') return null;
  return <g fill={c.a.shading === 'hard' ? 'rgba(0,0,0,.22)' : `url(#${c.gid}-shade)`} stroke="none" style={c.a.shading === 'hard' ? { clipPath: 'inset(0 0 0 50%)' } : undefined}>{children}</g>;
}

function legColor(a: Appearance) { return a.top === 'coverall' ? a.topColor : a.bottomColor; }
function sleeveColor(a: Appearance) { return a.top === 'vest' ? shade(a.topColor, 0.35) : a.topColor; }

// ---------------- FRONT / THREE-QUARTER ----------------

function FrontHairBack({ c, hx }: { c: Ctx; hx: number }) {
  const { a, s } = c;
  if (a.hairStyle === 'long') return <rect x={hx - 19} y={26} width={38} height={42} rx={12} fill={shade(a.hairColor, -0.15)} {...s} />;
  if (a.hairStyle === 'ponytail') return <ellipse cx={hx + 18} cy={44} rx={5} ry={10} fill={shade(a.hairColor, -0.15)} {...s} />;
  return null;
}

function FrontHair({ c, hx }: { c: Ctx; hx: number }) {
  const { a, s } = c;
  const cap = `M${hx - 17},36 Q${hx - 18},15 ${hx},15 Q${hx + 18},15 ${hx + 17},36 Q${hx + 9},23 ${hx},24 Q${hx - 9},23 ${hx - 17},36 Z`;
  switch (a.hairStyle) {
    case 'bald': return <ellipse cx={hx - 5} cy={22} rx={5} ry={3} fill="#fff" opacity={0.18} />;
    case 'buzz': return <path d={cap} fill={a.hairColor} opacity={0.75} />;
    case 'short': return <path d={cap} fill={a.hairColor} {...s} />;
    case 'long': return <><path d={cap} fill={a.hairColor} {...s} /><rect x={hx - 19} y={28} width={6} height={30} rx={3} fill={a.hairColor} {...s} /><rect x={hx + 13} y={28} width={6} height={30} rx={3} fill={a.hairColor} {...s} /></>;
    case 'bun': return <><circle cx={hx} cy={13} r={7} fill={a.hairColor} {...s} /><path d={cap} fill={a.hairColor} {...s} /></>;
    case 'ponytail': return <path d={cap} fill={a.hairColor} {...s} />;
    case 'mohawk': return <rect x={hx - 4} y={8} width={8} height={22} rx={4} fill={a.hairColor} {...s} />;
    case 'curly': return <g fill={a.hairColor} {...s}>{[-14, -7, 0, 7, 14].map((dx, i) => <circle key={i} cx={hx + dx} cy={20 + Math.abs(dx) * 0.5} r={7} />)}</g>;
  }
}

function FrontHeadwear({ c, hx }: { c: Ctx; hx: number }) {
  const { a, s } = c;
  const col = a.headwearColor;
  switch (a.headwear) {
    case 'none': return null;
    case 'cap': return <g {...s}><path d={`M${hx - 17},28 Q${hx},6 ${hx + 17},28 Z`} fill={col} /><ellipse cx={hx + 4} cy={28} rx={20} ry={3.5} fill={shade(col, -0.2)} /></g>;
    case 'hardhat': return <g {...s}><path d={`M${hx - 17},27 Q${hx - 16},8 ${hx},8 Q${hx + 16},8 ${hx + 17},27 Z`} fill={col} /><rect x={hx - 22} y={25} width={44} height={5} rx={2.5} fill={shade(col, -0.15)} /><rect x={hx - 2.5} y={9} width={5} height={17} fill={shade(col, 0.25)} stroke="none" /></g>;
    case 'helmet': return <g {...s}><path d={`M${hx - 19},40 Q${hx - 20},8 ${hx},8 Q${hx + 20},8 ${hx + 19},40 L${hx + 15},40 Q${hx},30 ${hx - 15},40 Z`} fill={col} /><rect x={hx - 14} y={31} width={28} height={7} rx={3} fill={a.accent} opacity={0.35} /></g>;
    case 'beanie': return <g {...s}><path d={`M${hx - 17},28 Q${hx},4 ${hx + 17},28 Z`} fill={col} /><rect x={hx - 18} y={24} width={36} height={6} rx={3} fill={shade(col, -0.2)} /></g>;
    case 'headset': return <g {...s}><path d={`M${hx - 17},36 Q${hx},4 ${hx + 17},36`} fill="none" stroke={col} strokeWidth={3} /><rect x={hx - 20} y={32} width={6} height={10} rx={2} fill={col} /><rect x={hx + 14} y={32} width={6} height={10} rx={2} fill={col} /><path d={`M${hx + 17},41 Q${hx + 14},49 ${hx + 5},48`} fill="none" stroke={col} strokeWidth={1.6} /></g>;
  }
}

function FrontFace({ c, hx, turn }: { c: Ctx; hx: number; turn: number }) {
  const { a, s } = c;
  const ex = 6.5 - turn * 2.5, sh = turn * 4;
  const eyeL = hx - ex + sh, eyeR = hx + ex + sh;
  const farScale = 1 - turn * 0.5;
  const eye = (x: number, sc: number) => {
    switch (a.eyeStyle) {
      case 'dot': return <circle cx={x} cy={38} r={1.9 * sc} fill={a.eyeColor} />;
      case 'almond': return <ellipse cx={x} cy={38} rx={2.8 * sc} ry={1.7} fill={a.eyeColor} />;
      case 'wide': return <g><ellipse cx={x} cy={38} rx={3.3 * sc} ry={2.6} fill="#f4f4ef" /><circle cx={x + 0.4} cy={38.2} r={1.6 * sc} fill={a.eyeColor} /></g>;
      case 'visor': return null;
    }
  };
  const browY = 32.5;
  const brow = (x: number, sc: number, flip: number) => a.brows === 'none' ? null :
    <path d={a.brows === 'angled' ? `M${x - 3 * sc},${browY + flip} L${x + 3 * sc},${browY - flip}` : `M${x - 3 * sc},${browY} Q${x},${browY - 1.4} ${x + 3 * sc},${browY}`} stroke={shade(a.hairColor, -0.1)} strokeWidth={a.brows === 'thick' ? 2.2 : 1.2} fill="none" strokeLinecap="round" />;
  return (
    <g>
      {eye(eyeL, turn > 0 ? 1 : 1)}{eye(eyeR, turn > 0 ? farScale : 1)}
      {a.eyeStyle === 'visor' && <rect x={hx - 12 + sh} y={35} width={24} height={6} rx={3} fill={a.accent} filter={`url(#${c.gid}-glow)`} />}
      {brow(eyeL, 1, 0.8)}{brow(eyeR, turn > 0 ? farScale : 1, -0.8)}
      {turn > 0 ? <path d={`M${hx + sh + 4},39 L${hx + sh + 6.5},44 L${hx + sh + 3},44.5`} fill="none" stroke={shade(a.skinTone, -0.35)} strokeWidth={1.2} /> : <ellipse cx={hx} cy={43} rx={1.4} ry={1} fill={shade(a.skinTone, -0.3)} />}
      <path d={`M${hx - 3.5 + sh},48 Q${hx + sh},50 ${hx + 3.5 + sh},48`} fill="none" stroke={shade(a.skinTone, -0.45)} strokeWidth={1.3} strokeLinecap="round" />
      {a.facialHair === 'stubble' && <path d={`M${hx - 13},42 Q${hx},62 ${hx + 13},42 Q${hx},52 ${hx - 13},42`} fill={a.hairColor} opacity={0.28} />}
      {a.facialHair === 'beard' && <path d={`M${hx - 15},38 Q${hx - 14},60 ${hx + sh},58 Q${hx + 14},60 ${hx + 15},38 Q${hx + 12},50 ${hx + sh},51 Q${hx - 12},50 ${hx - 15},38 Z`} fill={a.hairColor} {...s} />}
      {(a.facialHair === 'mustache' || a.facialHair === 'beard') && <path d={`M${hx - 5 + sh},46 Q${hx + sh},43.5 ${hx + 5 + sh},46`} stroke={a.hairColor} strokeWidth={2.4} fill="none" strokeLinecap="round" />}
      {a.glasses === 'round' && <g fill="none" stroke="#0b0f0c" strokeWidth={1.2}><circle cx={eyeL} cy={38} r={4.4} /><circle cx={eyeR} cy={38} r={4.4 * (turn ? farScale : 1)} /><path d={`M${eyeL + 4.4},38 L${eyeR - 4.4},38`} /></g>}
      {a.glasses === 'square' && <g fill="none" stroke="#0b0f0c" strokeWidth={1.2}><rect x={eyeL - 4.5} y={34.5} width={9} height={7} rx={1} /><rect x={eyeR - 4.5} y={34.5} width={9 * (turn ? farScale : 1)} height={7} rx={1} /><path d={`M${eyeL + 4.5},38 L${eyeR - 4.5},38`} /></g>}
      {a.glasses === 'visor' && <rect x={hx - 15 + sh} y={33.5} width={30} height={8} rx={4} fill={a.accent} opacity={0.85} filter={`url(#${c.gid}-glow)`} />}
    </g>
  );
}

function Equipment({ c, x, y, side }: { c: Ctx; x: number; y: number; side?: boolean }) {
  const { a, s } = c;
  switch (a.equipment) {
    case 'tablet': return <g {...s}><rect x={x - 6} y={y - 9} width={12} height={16} rx={2} fill="#0d1a14" /><rect x={x - 4} y={y - 7} width={8} height={11} fill={a.accent} opacity={0.6} stroke="none" /></g>;
    case 'wrench': return <g {...s}><rect x={x - 1.5} y={y - 2} width={3} height={18} rx={1.5} fill="#9aa4a8" /><path d={`M${x - 5},${y + 15} a5,5 0 1,0 10,0 l-2.5,0 l0,3 l-5,0 l0,-3 z`} fill="#9aa4a8" /></g>;
    case 'clipboard': return <g {...s}><rect x={x - 7} y={y - 8} width={14} height={18} rx={1.5} fill="#7a5a34" /><rect x={x - 5} y={y - 5} width={10} height={13} fill="#eee" stroke="none" /><rect x={x - 3} y={y - 9} width={6} height={3} fill="#bbb" /></g>;
    case 'laptop': return side
      ? <g {...s}><rect x={x - 2} y={y - 12} width={3} height={12} fill="#2a2f33" /><rect x={x - 2} y={y} width={16} height={2.5} fill="#3a4045" /></g>
      : <g {...s}><rect x={x - 9} y={y - 6} width={18} height={11} rx={1} fill="#2a2f33" /><rect x={x - 7} y={y - 4} width={14} height={7} fill={a.accent} opacity={0.45} stroke="none" /></g>;
    default: return <EquipmentExtra a={a} s={s} x={x} y={y} side={side} />;
  }
}

function TopDetails({ c, x0, w, y0, h }: { c: Ctx; x0: number; w: number; y0: number; h: number }) {
  const { a, s } = c;
  const cx = x0 + w / 2;
  switch (a.top) {
    case 'suit': return <g><path d={`M${cx - 7},${y0} L${cx},${y0 + 20} L${cx + 7},${y0}`} fill="#e9ecef" stroke="none" /><path d={`M${cx - 8},${y0} L${cx - 2},${y0 + 22} M${cx + 8},${y0} L${cx + 2},${y0 + 22}`} stroke={shade(a.topColor, -0.4)} strokeWidth={1.4} fill="none" /></g>;
    case 'labcoat': return <g><rect x={cx - 4} y={y0} width={8} height={h} fill={shade(a.topColor, -0.55)} stroke="none" /><path d={`M${cx - 4},${y0} L${cx - 4},${y0 + h + 22} M${cx + 4},${y0} L${cx + 4},${y0 + h + 22}`} stroke={shade(a.topColor, -0.25)} strokeWidth={1} /><rect x={x0 + 4} y={y0 + 24} width={7} height={6} fill="none" stroke={shade(a.topColor, -0.25)} /></g>;
    case 'hoodie': return <g {...s}><rect x={cx - 9} y={y0 + 28} width={18} height={9} rx={3} fill={shade(a.topColor, -0.15)} /><path d={`M${cx - 3},${y0 + 2} l0,10 M${cx + 3},${y0 + 2} l0,10`} stroke="#ddd" strokeWidth={1} /></g>;
    case 'coverall': return <g><rect x={x0 + 4} y={y0 + 8} width={8} height={7} fill={shade(a.topColor, -0.2)} {...s} /><rect x={x0 + w - 12} y={y0 + 8} width={8} height={7} fill={shade(a.topColor, -0.2)} {...s} /><path d={`M${cx},${y0 + 2} L${cx},${y0 + h}`} stroke={shade(a.topColor, -0.35)} strokeWidth={1.2} /></g>;
    case 'uniform': return <g><rect x={x0} y={y0 + 14} width={w} height={3} fill={a.accent} stroke="none" /><rect x={x0 + 4} y={y0 + 4} width={6} height={4} fill={a.accent} stroke="none" opacity={0.8} /></g>;
    case 'vest': return <g><rect x={x0 + 2} y={y0 + 18} width={w - 4} height={3} fill={a.accent} stroke="none" /><rect x={x0 + 2} y={y0 + 28} width={w - 4} height={3} fill={a.accent} stroke="none" /><rect x={cx - 3} y={y0} width={6} height={h} fill={shade(a.topColor, 0.35)} stroke="none" /></g>;
    case 'tshirt': return <path d={`M${cx - 6},${y0} Q${cx},${y0 + 6} ${cx + 6},${y0}`} fill="none" stroke={shade(a.topColor, -0.35)} strokeWidth={1.2} />;
  }
}

function Front({ c, turn }: { c: Ctx; turn: number }) {
  const { a, s, pose, frame } = c;
  const tw = TW[a.build];
  const x0 = 50 - tw / 2, hx = 50 + turn * 5;
  const step = pose === 'walk' ? [0, 3, 0, -3][frame % 4] : 0;
  const typing = pose === 'work' && (a.workPose === 'typing' || a.workPose === 'tinkering');
  const bob = pose === 'work' ? (frame % 2) * 1.5 : 0;
  const leg = legColor(a);
  const shorts = a.bottom === 'shorts' && a.top !== 'coverall';
  const skirt = a.bottom === 'skirt' && a.top !== 'coverall';
  const lw = tw / 2 - 2;
  const legEndL = 146 - Math.max(0, step), legEndR = 146 - Math.max(0, -step);
  const boots = a.shoes === 'boots';
  const sleeve = sleeveColor(a);
  const armTop = 60;
  const crossed = pose === 'idle' && a.idlePose === 'arms-crossed';
  const hips = pose === 'idle' && a.idlePose === 'hands-hips';
  return (
    <g>
      {/* legs */}
      {[{ x: x0 + 2, end: legEndL }, { x: 51, end: legEndR }].map((l, i) => (
        <g key={i}>
          <rect x={l.x} y={98} width={lw - 1} height={l.end - 98} fill={shorts || skirt ? a.skinTone : leg} {...s} />
          {shorts && <rect x={l.x} y={98} width={lw - 1} height={20} fill={leg} {...s} />}
          <rect x={l.x - 1.5} y={l.end - (boots ? 9 : 2)} width={lw + 2} height={boots ? 14 : 7} rx={a.shoes === 'dress' ? 2 : 3} fill={a.shoeColor} {...s} />
        </g>
      ))}
      <FrontBack c={c} x0={x0} tw={tw} />
      {skirt && <path d={`M${x0 + 1},98 L${x0 + tw - 1},98 L${x0 + tw + 4},124 L${x0 - 4},124 Z`} fill={a.bottomColor} {...s} />}
      {a.top === 'labcoat' && <path d={`M${x0 - 2},62 L${x0 + tw + 2},62 L${x0 + tw + 5},124 L${x0 - 5},124 Z`} fill={a.topColor} {...s} />}
      {/* far arm / near arm */}
      {!crossed && [{ x: x0 - 8, sw: step, side: -1 }, { x: x0 + tw, sw: -step, side: 1 }].map((arm, i) => {
        if (hips) return <g key={i}><path d={`M${arm.x + 4},${armTop} L${arm.x + 4 + arm.side * 6},${82} L${arm.x + 4 - arm.side * 1},${96}`} stroke={sleeve} strokeWidth={8} fill="none" strokeLinecap="round" /><circle cx={arm.x + 4 - arm.side} cy={96} r={4.2} fill={handColor(a)} {...s} /></g>;
        if (typing) return <g key={i}><rect x={arm.x} y={armTop} width={8} height={22} rx={4} fill={sleeve} {...s} /><rect x={i ? arm.x - 12 : arm.x} y={78 + bob * (i ? -1 : 1)} width={20} height={7} rx={3.5} fill={sleeve} {...s} /><circle cx={i ? arm.x - 12 : arm.x + 20} cy={81.5 + bob * (i ? -1 : 1)} r={4} fill={handColor(a)} {...s} /></g>;
        const len = 36 + arm.sw;
        return <g key={i}><rect x={arm.x} y={armTop} width={8} height={len} rx={4} fill={a.top === 'tshirt' ? a.skinTone : sleeve} {...s} />{a.top === 'tshirt' && <rect x={arm.x} y={armTop} width={8} height={12} rx={3} fill={sleeve} {...s} />}<circle cx={arm.x + 4} cy={armTop + len + 2} r={4.4} fill={handColor(a)} {...s} /></g>;
      })}
      {/* torso */}
      <rect x={x0} y={58} width={tw} height={44} rx={7} fill={a.top === 'vest' ? shade(a.topColor, 0.35) : a.topColor} {...s} />
      {a.top === 'vest' && <><rect x={x0} y={58} width={tw / 2 - 3} height={44} rx={6} fill={a.topColor} {...s} /><rect x={50 + 3} y={58} width={tw / 2 - 3} height={44} rx={6} fill={a.topColor} {...s} /></>}
      <TopDetails c={c} x0={x0} w={tw} y0={58} h={44} />
      <Shade c={c}><rect x={x0} y={58} width={tw} height={44} rx={7} /></Shade>
      <rect x={x0} y={58} width={tw} height={20} rx={7} fill={`url(#${c.gid}-light)`} stroke="none" />
      <FrontBody c={c} x0={x0} tw={tw} step={step} />
      {a.equipment === 'toolbelt' && <g {...s}><rect x={x0 - 1} y={96} width={tw + 2} height={6} fill="#3a2a14" /><rect x={x0 + 2} y={99} width={7} height={9} fill="#5a4020" /><rect x={x0 + tw - 9} y={99} width={7} height={9} fill="#5a4020" /></g>}
      {a.jewelry === 'badge' && <rect x={x0 + 5} y={66} width={7} height={9} rx={1} fill={a.accent} {...s} />}
      {a.jewelry === 'necklace' && <path d="M43,60 Q50,70 57,60" fill="none" stroke="#e8c45a" strokeWidth={1.4} />}
      {crossed && <g><rect x={x0 - 4} y={74} width={tw + 8} height={10} rx={5} fill={shade(sleeve, -0.1)} {...s} /><circle cx={x0 + 2} cy={79} r={4} fill={handColor(a)} {...s} /><circle cx={x0 + tw - 2} cy={79} r={4} fill={handColor(a)} {...s} /></g>}
      {!typing && !crossed && !hips && <Equipment c={c} x={x0 + tw + 4} y={armTop + 38 - step} />}
      {typing && a.equipment === 'laptop' && <Equipment c={c} x={50} y={88} />}
      {/* neck + head */}
      <rect x={45} y={50} width={10} height={10} fill={shade(a.skinTone, -0.12)} {...s} />
      {a.top === 'hoodie' && <path d={`M${x0 + 3},62 Q50,48 ${x0 + tw - 3},62`} fill={shade(a.topColor, -0.2)} {...s} />}
      <FrontHairBack c={c} hx={hx} />
      {turn === 0 ? <><circle cx={hx - 16} cy={39} r={3.5} fill={a.skinTone} {...s} /><circle cx={hx + 16} cy={39} r={3.5} fill={a.skinTone} {...s} /></> : <circle cx={hx - 15} cy={39} r={3.5} fill={a.skinTone} {...s} />}
      {a.jewelry === 'earrings' && <><circle cx={hx - 16} cy={44} r={1.6} fill={a.accent} />{turn === 0 && <circle cx={hx + 16} cy={44} r={1.6} fill={a.accent} />}</>}
      {a.faceShape === 'square'
        ? <rect x={hx - 15} y={19} width={30} height={35} rx={8} fill={a.skinTone} {...s} />
        : <ellipse cx={hx} cy={37} rx={a.faceShape === 'round' ? 17 : 15} ry={18} fill={a.skinTone} {...s} />}
      <Shade c={c}><ellipse cx={hx} cy={37} rx={15} ry={18} /></Shade>
      <FrontFace c={c} hx={hx} turn={turn} />
      <FrontFaceExtras c={c} hx={hx} turn={turn} />
      <FrontHair c={c} hx={hx} />
      <FrontHeadwear c={c} hx={hx} />
      <FrontOver c={c} hx={hx} x0={x0} tw={tw} step={step} />
    </g>
  );
}

// ---------------- SIDE (profile, facing right) ----------------

function Side({ c }: { c: Ctx }) {
  const { a, s, pose, frame } = c;
  const td = TD[a.build];
  const swing = pose === 'walk' ? [22, 8, -22, -8][frame % 4] : 0;
  const leg = legColor(a);
  const boots = a.shoes === 'boots';
  const sleeve = sleeveColor(a);
  const far = (col: string) => shade(col, -0.3);
  const legShape = (angle: number, col: string, key: string) => (
    <g key={key} transform={`rotate(${angle} 50 100)`}>
      <rect x={45} y={98} width={10} height={46} rx={4} fill={a.bottom === 'shorts' && a.top !== 'coverall' ? a.skinTone : col} {...s} />
      {a.bottom === 'shorts' && a.top !== 'coverall' && <rect x={45} y={98} width={10} height={18} rx={3} fill={col} {...s} />}
      <path d={boots ? 'M44,134 L56,134 L56,144 L66,145 L66,151 L44,151 Z' : a.shoes === 'dress' ? 'M44,143 L57,143 Q66,146 64,151 L44,151 Z' : 'M44,142 L56,142 Q67,144 66,151 L44,151 Z'} fill={col === leg ? a.shoeColor : far(a.shoeColor)} {...s} />
    </g>
  );
  const work = pose === 'work';
  const armAngle = work ? (a.workPose === 'reading' ? -60 : -78 + (frame % 2) * 6) : pose === 'idle' && a.idlePose === 'arms-crossed' ? -55 : -swing;
  const bodyX = 50 - td / 2;
  return (
    <g>
      {/* far limbs */}
      <SideExtras c={c} bodyX={bodyX} td={td} layer="back" />
      {legShape(-swing, far(leg), 'far-leg')}
      <g transform={`rotate(${work ? armAngle + 8 : swing} 50 62)`}><rect x={46} y={60} width={8} height={36} rx={4} fill={far(sleeve)} {...s} /><circle cx={50} cy={98} r={4} fill={far(handColor(a))} {...s} /></g>
      {legShape(swing, leg, 'near-leg')}
      {a.top === 'labcoat' && <path d={`M${bodyX - 2},62 L${bodyX + td + 1},62 L${bodyX + td + 2},104 L${bodyX - 6},124 Z`} fill={a.topColor} {...s} />}
      {a.bottom === 'skirt' && a.top !== 'coverall' && <path d={`M${bodyX},98 L${bodyX + td},98 L${bodyX + td + 5},122 L${bodyX - 5},122 Z`} fill={a.bottomColor} {...s} />}
      {/* torso */}
      <rect x={bodyX} y={58} width={td} height={44} rx={8} fill={a.topColor} {...s} />
      {a.top === 'vest' && <><rect x={bodyX} y={76} width={td} height={3} fill={a.accent} /><rect x={bodyX} y={86} width={td} height={3} fill={a.accent} /></>}
      {a.top === 'uniform' && <rect x={bodyX} y={72} width={td} height={3} fill={a.accent} />}
      {a.top === 'suit' && <path d={`M${bodyX + td - 3},60 L${bodyX + td - 7},80`} stroke={shade(a.topColor, -0.45)} strokeWidth={1.5} />}
      {a.top === 'coverall' && <rect x={bodyX + td - 9} y={70} width={7} height={7} fill={shade(a.topColor, -0.2)} {...s} />}
      {a.equipment === 'toolbelt' && <g {...s}><rect x={bodyX - 1} y={95} width={td + 2} height={6} fill="#3a2a14" /><rect x={bodyX - 3} y={98} width={8} height={10} fill="#5a4020" /></g>}
      {a.jewelry === 'badge' && <rect x={bodyX + td - 7} y={66} width={5} height={8} rx={1} fill={a.accent} {...s} />}
      <Shade c={c}><rect x={bodyX} y={58} width={td} height={44} rx={8} /></Shade>
      <rect x={bodyX} y={58} width={td} height={18} rx={8} fill={`url(#${c.gid}-light)`} stroke="none" />
      <SideExtras c={c} bodyX={bodyX} td={td} layer="body" />
      {a.top === 'hoodie' && <path d={`M${bodyX - 4},66 Q${bodyX - 6},52 ${bodyX + 8},54`} fill={shade(a.topColor, -0.2)} {...s} />}
      {/* near arm */}
      <g transform={`rotate(${armAngle} 50 62)`}>
        <rect x={46} y={60} width={8} height={36} rx={4} fill={a.top === 'tshirt' ? a.skinTone : sleeve} {...s} />
        {a.top === 'tshirt' && <rect x={46} y={60} width={8} height={12} rx={3} fill={sleeve} {...s} />}
        <circle cx={50} cy={98} r={4.4} fill={handColor(a)} {...s} />
        {!(pose === 'idle' && a.idlePose === 'arms-crossed') && <g transform="translate(0 0)"><Equipment c={c} x={50} y={100} side /></g>}
      </g>
      {/* head */}
      <rect x={46} y={50} width={9} height={10} fill={shade(a.skinTone, -0.12)} {...s} />
      {a.hairStyle === 'long' && <path d="M36,30 Q34,58 44,66 L52,64 L50,32 Z" fill={shade(a.hairColor, -0.1)} {...s} />}
      {a.hairStyle === 'ponytail' && <path d="M38,30 Q26,40 30,62 Q35,64 37,58 Q34,44 42,34 Z" fill={a.hairColor} {...s} />}
      {a.hairStyle === 'bun' && <circle cx={37} cy={24} r={7} fill={a.hairColor} {...s} />}
      <path d={a.faceShape === 'square' ? 'M38,22 Q38,18 44,18 L60,18 Q66,18 66,26 L66,34 L70,40 L66,42 L66,48 Q64,54 56,54 L44,54 Q38,54 38,46 Z' : 'M38,32 Q38,18 52,18 Q66,18 66,30 L67,35 L71,40 L67,42 Q67,54 54,55 Q40,55 38,42 Z'} fill={a.skinTone} {...s} />
      <Shade c={c}><ellipse cx={46} cy={38} rx={10} ry={16} /></Shade>
      <circle cx={46} cy={39} r={3.6} fill={shade(a.skinTone, -0.08)} {...s} />
      {a.jewelry === 'earrings' && <circle cx={46} cy={44} r={1.6} fill={a.accent} />}
      {a.eyeStyle === 'visor'
        ? <rect x={55} y={34} width={13} height={6} rx={3} fill={a.accent} filter={`url(#${c.gid}-glow)`} />
        : <ellipse cx={60} cy={37} rx={a.eyeStyle === 'wide' ? 2.2 : 1.8} ry={a.eyeStyle === 'almond' ? 1.4 : 2} fill={a.eyeColor} />}
      {a.brows !== 'none' && <path d={a.brows === 'angled' ? 'M56,32 L63,30.5' : 'M56,31.5 Q60,30 63,31.5'} stroke={a.hairColor} strokeWidth={a.brows === 'thick' ? 2.2 : 1.2} fill="none" strokeLinecap="round" />}
      <path d="M62,48 L66,47.5" stroke={shade(a.skinTone, -0.45)} strokeWidth={1.3} strokeLinecap="round" />
      {a.facialHair === 'beard' && <path d="M48,44 Q50,58 60,56 Q67,53 67,46 L63,48 Q56,50 52,44 Z" fill={a.hairColor} {...s} />}
      {a.facialHair === 'stubble' && <path d="M48,44 Q52,57 62,55 Q67,52 67,46 Q58,50 48,44" fill={a.hairColor} opacity={0.28} />}
      {(a.facialHair === 'mustache' || a.facialHair === 'beard') && <path d="M61,45.5 L67,45" stroke={a.hairColor} strokeWidth={2.4} strokeLinecap="round" />}
      {a.glasses === 'round' && <g fill="none" stroke="#0b0f0c" strokeWidth={1.2}><circle cx={60} cy={37} r={4.2} /><path d="M56,37 L47,38" /></g>}
      {a.glasses === 'square' && <g fill="none" stroke="#0b0f0c" strokeWidth={1.2}><rect x={56} y={33.5} width={8} height={7} rx={1} /><path d="M56,37 L47,38" /></g>}
      {a.glasses === 'visor' && <rect x={52} y={33} width={18} height={8} rx={4} fill={a.accent} opacity={0.85} filter={`url(#${c.gid}-glow)`} />}
      {/* hair profile */}
      {a.hairStyle === 'short' || a.hairStyle === 'long' || a.hairStyle === 'ponytail' || a.hairStyle === 'bun'
        ? <path d="M37,40 Q35,15 54,16 Q68,17 67,29 Q58,23 50,25 Q45,29 45,40 Z" fill={a.hairColor} {...s} /> : null}
      {a.hairStyle === 'buzz' && <path d="M38,36 Q37,17 54,17 Q66,18 66,27 Q56,22 48,25 Q42,29 42,36 Z" fill={a.hairColor} opacity={0.75} />}
      {a.hairStyle === 'mohawk' && <path d="M40,24 Q44,6 58,10 Q64,12 64,20 Q54,15 46,24 Z" fill={a.hairColor} {...s} />}
      {a.hairStyle === 'curly' && <g fill={a.hairColor} {...s}>{[[40, 26], [46, 19], [54, 17], [61, 20], [39, 35]].map(([x, y], i) => <circle key={i} cx={x} cy={y} r={7} />)}</g>}
      {/* headwear profile */}
      {a.headwear === 'cap' && <g {...s}><path d="M37,29 Q38,9 54,10 Q67,11 67,27 Z" fill={a.headwearColor} /><path d="M64,25 L80,27 L80,29 L64,29 Z" fill={shade(a.headwearColor, -0.2)} /></g>}
      {a.headwear === 'hardhat' && <g {...s}><path d="M37,27 Q38,7 53,7 Q67,8 67,27 Z" fill={a.headwearColor} /><rect x={32} y={25} width={41} height={5} rx={2.5} fill={shade(a.headwearColor, -0.15)} /><rect x={44} y={9} width={14} height={4} rx={2} fill={shade(a.headwearColor, 0.25)} stroke="none" /></g>}
      {a.headwear === 'helmet' && <g {...s}><path d="M35,44 Q34,8 53,8 Q70,8 70,32 L70,36 L52,36 L50,44 Z" fill={a.headwearColor} /><rect x={58} y={28} width={13} height={9} rx={3} fill={a.accent} opacity={0.4} /></g>}
      {a.headwear === 'beanie' && <g {...s}><path d="M37,28 Q38,6 53,7 Q67,8 67,28 Z" fill={a.headwearColor} /><rect x={36} y={24} width={32} height={6} rx={3} fill={shade(a.headwearColor, -0.2)} /></g>}
      {a.headwear === 'headset' && <g {...s}><path d="M42,32 Q46,10 60,16" fill="none" stroke={a.headwearColor} strokeWidth={3} /><rect x={42} y={33} width={8} height={11} rx={3} fill={a.headwearColor} /><path d="M48,43 Q56,52 64,48" fill="none" stroke={a.headwearColor} strokeWidth={1.6} /></g>}
      <SideExtras c={c} bodyX={bodyX} td={td} layer="head" />
    </g>
  );
}

// ---------------- TOP-DOWN ----------------

function Top({ c }: { c: Ctx }) {
  const { a, s, pose, frame } = c;
  const rx = { slim: 20, average: 24, broad: 28 }[a.build];
  const st = pose === 'walk' ? [6, 0, -6, 0][frame % 4] : 0;
  const hair = a.hairColor;
  return (
    <g>
      <ellipse cx={50} cy={56} rx={rx + 4} ry={18} fill="#000" opacity={0.35} stroke="none" />
      <TopExtras c={c} rx={rx} layer="under" />
      {/* feet peek out when walking */}
      {pose === 'walk' && <g {...s}><ellipse cx={42} cy={50 - st * 1.6} rx={4.5} ry={7} fill={a.shoeColor} /><ellipse cx={58} cy={50 + st * 1.6} rx={4.5} ry={7} fill={a.shoeColor} /></g>}
      {/* arms */}
      <g {...s}>
        <ellipse cx={50 - rx - 1} cy={52 + st} rx={5} ry={9} fill={a.top === 'tshirt' ? a.skinTone : sleeveColor(a)} />
        <ellipse cx={50 + rx + 1} cy={52 - st} rx={5} ry={9} fill={a.top === 'tshirt' ? a.skinTone : sleeveColor(a)} />
        <circle cx={50 - rx - 1} cy={44 + st} r={4} fill={handColor(a)} />
        <circle cx={50 + rx + 1} cy={44 - st} r={4} fill={handColor(a)} />
      </g>
      {a.top === 'labcoat' && <ellipse cx={50} cy={56} rx={rx + 2} ry={16} fill={a.topColor} {...s} />}
      <ellipse cx={50} cy={52} rx={rx} ry={13} fill={a.topColor} {...s} />
      {a.top === 'vest' && <path d={`M${50 - rx + 3},48 L${50 + rx - 3},48 M${50 - rx + 3},55 L${50 + rx - 3},55`} stroke={a.accent} strokeWidth={2.5} />}
      {a.top === 'uniform' && <path d={`M${50 - rx + 2},50 L${50 + rx - 2},50`} stroke={a.accent} strokeWidth={2.5} />}
      {a.top === 'hoodie' && <ellipse cx={50} cy={60} rx={11} ry={6} fill={shade(a.topColor, -0.2)} {...s} />}
      {a.equipment !== 'none' && a.equipment !== 'toolbelt' && <rect x={56} y={34} width={10} height={8} rx={2} fill={a.equipment === 'wrench' ? '#9aa4a8' : a.equipment === 'clipboard' ? '#7a5a34' : '#1a2420'} {...s} />}
      {/* head from above: nose bump shows facing */}
      <ellipse cx={50} cy={36} rx={3} ry={3} fill={a.skinTone} {...s} />
      <circle cx={50} cy={48} r={13} fill={a.skinTone} {...s} />
      {a.hairStyle === 'long' && <ellipse cx={50} cy={54} rx={14} ry={14} fill={hair} {...s} />}
      {a.hairStyle === 'ponytail' && <path d="M50,60 Q52,70 49,76" stroke={hair} strokeWidth={5} fill="none" strokeLinecap="round" />}
      {['short', 'long', 'ponytail', 'bun', 'curly'].includes(a.hairStyle) && <ellipse cx={50} cy={50} rx={12.5} ry={11.5} fill={hair} {...s} />}
      {a.hairStyle === 'buzz' && <circle cx={50} cy={49} r={12} fill={hair} opacity={0.6} />}
      {a.hairStyle === 'bun' && <circle cx={50} cy={60} r={5.5} fill={shade(hair, -0.1)} {...s} />}
      {a.hairStyle === 'curly' && <g fill={hair} {...s}>{[0, 72, 144, 216, 288].map((d) => <circle key={d} cx={50 + Math.cos((d * Math.PI) / 180) * 10} cy={50 + Math.sin((d * Math.PI) / 180) * 10} r={4.5} />)}</g>}
      {a.hairStyle === 'mohawk' && <rect x={47} y={36} width={6} height={25} rx={3} fill={hair} {...s} />}
      {a.hairStyle === 'bald' && <ellipse cx={46} cy={44} rx={4} ry={2.5} fill="#fff" opacity={0.25} />}
      {a.headwear === 'hardhat' && <g {...s}><circle cx={50} cy={48} r={17} fill={shade(a.headwearColor, -0.15)} /><circle cx={50} cy={48} r={13} fill={a.headwearColor} /><rect x={48} y={35} width={4} height={26} fill={shade(a.headwearColor, 0.25)} stroke="none" /></g>}
      {a.headwear === 'cap' && <g {...s}><path d="M41,40 Q50,30 59,40 L57,44 L43,44 Z" fill={shade(a.headwearColor, -0.2)} /><circle cx={50} cy={49} r={12.5} fill={a.headwearColor} /></g>}
      {a.headwear === 'helmet' && <g {...s}><circle cx={50} cy={48} r={15} fill={a.headwearColor} /><path d="M40,40 Q50,32 60,40" stroke={a.accent} strokeWidth={3} fill="none" /></g>}
      {a.headwear === 'beanie' && <g {...s}><circle cx={50} cy={49} r={13} fill={a.headwearColor} /><circle cx={50} cy={49} r={3.5} fill={shade(a.headwearColor, 0.3)} /></g>}
      {a.headwear === 'headset' && <path d="M37,48 Q50,40 63,48" stroke={a.headwearColor} strokeWidth={3} fill="none" />}
      {a.glasses === 'visor' && <path d="M40,40 Q50,35 60,40" stroke={a.accent} strokeWidth={3} fill="none" filter={`url(#${c.gid}-glow)`} />}
      <TopExtras c={c} rx={rx} layer="over" />
    </g>
  );
}

const HEADING_ROT = { up: 0, right: 90, down: 180, left: 270 } as const;

function CharacterImpl({ a, view, pose = 'idle', frame = 0, facing, heading = 'down', size = 64, assetUrl, title }: CharacterProps) {
  const gid = useId().replace(/:/g, '');
  const c: Ctx = { a, s: strokeFor(a), gid, pose, frame };
  const face = facing ?? a.facing;
  const pixel = a.artStyle === 'pixel';
  const glow = a.artStyle === 'neon' ? `url(#${gid}-glow)` : undefined;
  const common = { shapeRendering: pixel ? ('crispEdges' as const) : undefined, role: 'img', 'aria-label': title ?? `Character, ${view} view` };

  if (assetUrl) {
    const ratio = view === 'top' || view === 'portrait' ? 1 : 0.625;
    return <img src={assetUrl} alt={title ?? `Character art, ${view} view`} style={{ height: size, width: size * ratio, objectFit: 'contain', imageRendering: pixel ? 'pixelated' : undefined }} />;
  }
  if (view === 'top') {
    return (
      <svg viewBox="0 0 100 100" width={size} height={size} {...common}>
        <Defs c={c} />
        <g transform={`rotate(${HEADING_ROT[heading]} 50 50)`} filter={glow}><Top c={c} /></g>
      </svg>
    );
  }
  if (view === 'portrait') {
    return (
      <svg viewBox="14 2 72 76" width={size} height={size} {...common}>
        <Defs c={c} />
        <g filter={glow}><Front c={{ ...c, pose: 'idle' }} turn={0.3} /></g>
      </svg>
    );
  }
  const h = a.height;
  const flip = (view === 'side' || view === 'three-quarter') && face === 'left';
  return (
    <svg viewBox="0 0 100 160" width={size * 0.625} height={size} {...common}>
      <Defs c={c} />
      <ellipse cx={50} cy={152} rx={22} ry={4} fill="#000" opacity={0.35} />
      <g transform={`${flip ? 'translate(100 0) scale(-1 1) ' : ''}translate(50 152) scale(${0.92 + (h - 1) * 0.6} ${h}) translate(-50 -152)`} filter={glow}>
        {view === 'side' ? <Side c={c} /> : <Front c={c} turn={view === 'three-quarter' ? 0.35 : 0} />}
      </g>
    </svg>
  );
}

export const Character = memo(CharacterImpl);
