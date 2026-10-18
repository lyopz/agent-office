// Headquarters cosmetics layered onto the base character: long garments,
// armour, shoulders, gloves, belts, face markings, robotics, accessories and
// restrained effects. Every view reads the same Appearance, so an outfit looks
// like the same outfit from the front, the side and above.
import type { Appearance } from '../model/types';
import { shade } from './color';

export interface XCtx { a: Appearance; s: Record<string, unknown>; gid: string; frame: number }

export const handColor = (a: Appearance) => (a.gloves && a.gloves !== 'none' ? a.gloveColor : a.skinTone);
const trim = (a: Appearance) => a.trimColor || a.accent;
const has = (a: Appearance, id: string) => (a.accessories ?? []).includes(id);
const fxOn = (a: Appearance) => a.effects ?? { aura: false, holoOutline: false, eyeGlow: false, particles: false, energyAccents: false, robotics: false, intensity: 0.4 };

/** Garments drawn behind the legs (robes and long coats hang to the floor). */
export function FrontBack({ c, x0, tw }: { c: XCtx; x0: number; tw: number }) {
  const { a, s } = c;
  const fx = fxOn(a);
  const k = fx.intensity ?? 0.4;
  return (
    <g>
      {fx.aura && <ellipse cx={50} cy={92} rx={tw + 6} ry={62} fill={a.accent} opacity={0.12 + k * 0.18} filter={`url(#${c.gid}-glow)`} />}
      {a.top === 'robe' && <path d={`M${x0 - 3},62 L${x0 + tw + 3},62 L${x0 + tw + 9},148 L${x0 - 9},148 Z`} fill={a.topColor} {...s} />}
      {a.top === 'longcoat' && <path d={`M${x0 - 2},62 L${x0 + tw + 2},62 L${x0 + tw + 6},132 L${x0 - 6},132 Z`} fill={shade(a.topColor, -0.08)} {...s} />}
      {a.top === 'robe' && <path d={`M50,62 L50,148`} stroke={trim(a)} strokeWidth={2} />}
    </g>
  );
}

/** Torso details for the new tops, plus shoulders, belts and chest accessories. */
export function FrontBody({ c, x0, tw, step }: { c: XCtx; x0: number; tw: number; step: number }) {
  const { a, s } = c;
  const cx = x0 + tw / 2, y0 = 58, h = 44;
  const tc = trim(a);
  const fx = fxOn(a);
  const parts: React.ReactNode[] = [];
  switch (a.top) {
    case 'jacket': parts.push(<g key="jk"><path d={`M${cx - 8},${y0} L${cx - 2},${y0 + 18} L${cx - 2},${y0 + h} M${cx + 8},${y0} L${cx + 2},${y0 + 18} L${cx + 2},${y0 + h}`} stroke={shade(a.topColor, -0.4)} strokeWidth={1.4} fill="none" /><rect x={cx - 2} y={y0 + 2} width={4} height={h - 2} fill={shade(a.topColor, 0.25)} stroke="none" /><rect x={x0} y={y0 + h - 6} width={tw} height={3} fill={tc} stroke="none" opacity={0.8} /></g>); break;
    case 'robe': parts.push(<g key="rb"><path d={`M${cx - 9},${y0} L${cx},${y0 + 26} L${cx + 9},${y0}`} fill="none" stroke={tc} strokeWidth={2} /><rect x={x0} y={y0 + 34} width={tw} height={4} fill={tc} stroke="none" opacity={0.85} /></g>); break;
    case 'longcoat': parts.push(<g key="lc"><path d={`M${cx - 9},${y0} L${cx - 3},${y0 + 16} M${cx + 9},${y0} L${cx + 3},${y0 + 16}`} stroke={tc} strokeWidth={1.6} fill="none" />{[0, 1, 2].map((i) => <circle key={i} cx={cx + 4} cy={y0 + 18 + i * 8} r={1.3} fill={tc} stroke="none" />)}</g>); break;
    case 'armor': parts.push(<g key="ar">{[0, 1, 2].map((i) => <rect key={i} x={x0 + 2} y={y0 + 6 + i * 12} width={tw - 4} height={9} rx={3} fill={shade(a.topColor, 0.12 - i * 0.06)} {...s} />)}<rect x={cx - 5} y={y0 + 4} width={10} height={14} rx={2} fill={tc} opacity={0.7} stroke="none" /></g>); break;
  }
  if (a.top === 'suit' || has(a, 'illuminated-tie')) {
    const glow = has(a, 'illuminated-tie');
    parts.push(<path key="tie" d={`M${cx - 1.5},${y0 + 3} L${cx + 1.5},${y0 + 3} L${cx + 2.5},${y0 + 20} L${cx},${y0 + 24} L${cx - 2.5},${y0 + 20} Z`} fill={tc} stroke="none" filter={glow ? `url(#${c.gid}-glow)` : undefined} />);
  }
  if (a.belt === 'belt') parts.push(<g key="bt" {...s}><rect x={x0 - 1} y={95} width={tw + 2} height={5} fill={shade(a.bottomColor, -0.4)} /><rect x={cx - 3} y={95} width={6} height={5} fill={tc} /></g>);
  if (a.belt === 'utility') parts.push(<g key="ub" {...s}><rect x={x0 - 1} y={95} width={tw + 2} height={6} fill="#2e2a22" />{[x0 + 1, cx - 3, x0 + tw - 7].map((x, i) => <rect key={i} x={x} y={97} width={6} height={8} rx={1} fill="#4a4230" />)}</g>);
  if (a.belt === 'harness' || has(a, 'tool-harness')) parts.push(<g key="hn" stroke="#3a3326" strokeWidth={3} fill="none"><path d={`M${x0 + 3},${y0 + 2} L${x0 + tw - 3},${y0 + 36} M${x0 + tw - 3},${y0 + 2} L${x0 + 3},${y0 + 36}`} /><circle cx={cx} cy={y0 + 19} r={3} fill={tc} stroke="none" /></g>);
  if (has(a, 'tool-harness')) parts.push(<g key="tools" {...s}><rect x={x0 - 2} y={y0 + 30} width={4} height={12} fill="#9aa4a8" /><rect x={x0 + tw - 2} y={y0 + 30} width={4} height={10} fill="#d9772b" /></g>);
  if (has(a, 'data-cartridges')) parts.push(<g key="dc">{[0, 1, 2, 3].map((i) => <rect key={i} x={x0 + 3 + i * ((tw - 6) / 4)} y={93} width={(tw - 6) / 4 - 1.5} height={7} rx={1} fill={i % 2 ? a.accent : shade(a.accent, -0.4)} {...s} />)}</g>);
  if (has(a, 'rank-insignia')) parts.push(<path key="ri" d={`M${x0 + 4},${y0 + 10} l3,-3 l3,3 M${x0 + 4},${y0 + 14} l3,-3 l3,3`} stroke={tc} strokeWidth={1.4} fill="none" />);
  if (has(a, 'exec-insignia')) parts.push(<path key="ei" d={`M${x0 + tw - 10},${y0 + 8} l3,-4 l3,4 l-3,4 z`} fill="#d4a84a" stroke="#6b4e12" strokeWidth={0.8} />);
  if (has(a, 'lapel-pin')) parts.push(<circle key="lp" cx={x0 + tw - 8} cy={y0 + 14} r={1.8} fill={tc} />);
  if (has(a, 'data-device')) parts.push(<rect key="dd" x={x0 + 4} y={y0 + 24} width={6} height={9} rx={1} fill="#0d1a14" stroke={a.accent} strokeWidth={0.8} />);
  if (has(a, 'holo-badge')) parts.push(<g key="hb" opacity={0.85}><rect x={x0 - 12} y={y0 + 6 + (c.frame % 2)} width={9} height={11} rx={1.5} fill={a.accent} opacity={0.35} stroke={a.accent} strokeWidth={0.8} filter={`url(#${c.gid}-glow)`} /><rect x={x0 - 10} y={y0 + 9 + (c.frame % 2)} width={5} height={1.4} fill="#fff" /></g>);
  if (fx.energyAccents) parts.push(<g key="ea" opacity={0.5 + (fx.intensity ?? 0.4) * 0.5}><rect x={x0} y={y0 + 6} width={2} height={h - 12} fill={a.accent} filter={`url(#${c.gid}-glow)`} /><rect x={x0 + tw - 2} y={y0 + 6} width={2} height={h - 12} fill={a.accent} filter={`url(#${c.gid}-glow)`} /></g>);
  // shoulders sit over the sleeves
  if (a.shoulders && a.shoulders !== 'none') {
    const big = a.shoulders === 'armored';
    const col = a.shoulders === 'metallic' ? '#9aa4ad' : a.shoulders === 'armored' ? shade(a.topColor, 0.15) : shade(a.topColor, -0.12);
    for (const x of [x0 - (big ? 11 : 8), x0 + tw - (big ? 3 : 4)]) parts.push(<rect key={`sh${x}`} x={x} y={y0 - 3} width={big ? 14 : 12} height={big ? 11 : 8} rx={4} fill={col} {...s} />);
    if (big) parts.push(<g key="sh-trim">{[x0 - 11, x0 + tw - 3].map((x) => <rect key={x} x={x + 1} y={y0 + 5} width={12} height={2} fill={tc} stroke="none" />)}</g>);
  }
  if (has(a, 'shoulder-patch')) parts.push(<rect key="spch" x={x0 + tw + 1} y={y0 + 8} width={6} height={6} rx={1} fill={tc} {...s} />);
  if (has(a, 'wrist-display')) parts.push(<rect key="wd" x={x0 + tw} y={y0 + 30 - step} width={8} height={4} rx={1} fill={a.accent} filter={`url(#${c.gid}-glow)`} />);
  if (fxOn(a).robotics) parts.push(<g key="rj" fill="#9aa4ad" stroke="#2a3036" strokeWidth={0.8}><circle cx={x0 - 4} cy={62} r={2.4} /><circle cx={x0 + tw + 4} cy={62} r={2.4} /><circle cx={x0 + tw / 4} cy={122} r={2.2} /><circle cx={x0 + (3 * tw) / 4} cy={122} r={2.2} /></g>);
  return <g>{parts}</g>;
}

/** Face-level details: markings, robotics, masks, AR glasses, visors, earpieces, eye glow. */
export function FrontFaceExtras({ c, hx, turn }: { c: XCtx; hx: number; turn: number }) {
  const { a } = c;
  const ex = 6.5 - turn * 2.5, sh = turn * 4;
  const eyeL = hx - ex + sh, eyeR = hx + ex + sh;
  const out: React.ReactNode[] = [];
  switch (a.faceMarkings) {
    case 'freckles': out.push(<g key="fr" fill={shade(a.skinTone, -0.35)}>{[[-9, 43], [-7, 45], [-11, 45], [9, 43], [7, 45], [11, 45]].map(([dx, y], i) => <circle key={i} cx={hx + dx + sh} cy={y} r={0.7} />)}</g>); break;
    case 'scar': out.push(<path key="sc" d={`M${eyeR - 1},31 L${eyeR + 3},45`} stroke={shade(a.skinTone, -0.4)} strokeWidth={1.2} />); break;
    case 'tattoo': out.push(<path key="tt" d={`M${eyeL - 6},41 l2,4 l2,-4`} stroke={shade(a.accent, -0.3)} strokeWidth={1.2} fill="none" />); break;
    case 'circuit': out.push(<path key="ci" d={`M${eyeL - 7},42 l0,4 l4,0 M${eyeR + 7},42 l0,4 l-4,0 M${hx + sh},22 l0,5`} stroke={a.accent} strokeWidth={1} fill="none" opacity={0.85} />); break;
  }
  if (a.robotic === 'half-face' || a.robotic === 'full') out.push(<path key="rhf" d={a.robotic === 'full' ? `M${hx - 15},24 Q${hx},14 ${hx + 15},24 L${hx + 15},48 Q${hx},58 ${hx - 15},48 Z` : `M${hx + sh},19 Q${hx + 16},20 ${hx + 15},38 Q${hx + 13},53 ${hx + sh},55 Z`} fill="#8e99a3" opacity={a.robotic === 'full' ? 0.55 : 0.7} stroke="#2a3036" strokeWidth={0.8} />);
  if (a.robotic === 'jaw') out.push(<path key="rj" d={`M${hx - 11},46 Q${hx},58 ${hx + 11},46 L${hx + 9},52 Q${hx},58 ${hx - 9},52 Z`} fill="#8e99a3" stroke="#2a3036" strokeWidth={0.8} />);
  if (a.robotic === 'eyepiece' || a.robotic === 'half-face' || a.robotic === 'full') out.push(<circle key="rep" cx={eyeR} cy={38} r={3.6} fill="#1a1f24" stroke={a.accent} strokeWidth={1.4} />, <circle key="rep2" cx={eyeR} cy={38} r={1.4} fill={a.accent} filter={`url(#${c.gid}-glow)`} />);
  if (a.robotic === 'full') out.push(<circle key="rep3" cx={eyeL} cy={38} r={1.6} fill={a.accent} filter={`url(#${c.gid}-glow)`} />);
  if (fxOn(a).eyeGlow) out.push(<g key="eg" fill={a.accent} opacity={0.5 + (fxOn(a).intensity ?? 0.4) * 0.5} filter={`url(#${c.gid}-glow)`}><circle cx={eyeL} cy={38} r={2.2} /><circle cx={eyeR} cy={38} r={2.2} /></g>);
  if (a.headwear === 'mask') out.push(<path key="mk" d={`M${hx - 13},42 Q${hx},40 ${hx + 13},42 L${hx + 11},52 Q${hx},57 ${hx - 11},52 Z`} fill={a.headwearColor} stroke="#061009" strokeWidth={1} />);
  if (a.glasses === 'ar-glasses') out.push(<g key="ar"><rect x={eyeL - 5} y={34.5} width={10} height={7} rx={2} fill={a.accent} opacity={0.3} stroke="#cfe" strokeWidth={0.8} /><rect x={eyeR - 5} y={34.5} width={10} height={7} rx={2} fill={a.accent} opacity={0.3} stroke="#cfe" strokeWidth={0.8} /><path d={`M${eyeL + 5},37 L${eyeR - 5},37`} stroke="#cfe" strokeWidth={0.8} /></g>);
  if (has(a, 'diagnostic-visor')) out.push(<rect key="dv" x={hx - 14 + sh} y={33} width={28} height={7} rx={3} fill="#ff9f43" opacity={0.75} filter={`url(#${c.gid}-glow)`} />);
  if (has(a, 'comms-relay')) out.push(<g key="cr"><rect x={hx - 19} y={35} width={4} height={8} rx={2} fill="#2a3036" /><circle cx={hx - 17} cy={36} r={1.2} fill={a.accent} /></g>);
  return <g>{out}</g>;
}

/** Things above the head and around the character: full helmets, assistants, holo panels, particles. */
export function FrontOver({ c, hx, x0, tw, step }: { c: XCtx; hx: number; x0: number; tw: number; step: number }) {
  const { a, s, frame } = c;
  const fx = fxOn(a); const k = fx.intensity ?? 0.4;
  const out: React.ReactNode[] = [];
  if (a.headwear === 'full-helmet') out.push(<g key="fh" {...s}><path d={`M${hx - 20},50 Q${hx - 22},8 ${hx},8 Q${hx + 22},8 ${hx + 20},50 Q${hx},58 ${hx - 20},50 Z`} fill={a.headwearColor} /><rect x={hx - 14} y={30} width={28} height={10} rx={5} fill={a.accent} opacity={0.55} /></g>);
  if (has(a, 'floating-assistant')) { const bob = [0, -1.5, 0, 1.5][frame % 4]; out.push(<g key="fa"><circle cx={x0 + tw + 14} cy={30 + bob} r={5} fill="#2a3036" stroke={a.accent} strokeWidth={1} /><circle cx={x0 + tw + 15.5} cy={29.5 + bob} r={1.6} fill={a.accent} filter={`url(#${c.gid}-glow)`} /><path d={`M${x0 + tw + 9},${26 + bob} l-3,-2 M${x0 + tw + 19},${26 + bob} l3,-2`} stroke="#9aa4ad" strokeWidth={1} /></g>); }
  const hand = { x: x0 + tw + 4, y: 98 - step };
  if (has(a, 'catalog-interface')) out.push(<g key="ci" opacity={0.85}><rect x={hand.x + 4} y={hand.y - 30} width={20} height={16} rx={2} fill={a.accent} opacity={0.22} stroke={a.accent} strokeWidth={0.8} filter={`url(#${c.gid}-glow)`} />{[0, 1, 2].map((i) => <rect key={i} x={hand.x + 7} y={hand.y - 27 + i * 4.5} width={14 - i * 3} height={1.4} fill={a.accent} />)}</g>);
  if (has(a, 'ledger-slate')) out.push(<g key="ls" {...s}><rect x={x0 - 18} y={74} width={12} height={16} rx={1.5} fill="#1b1c1f" />{[0, 1, 2].map((i) => <rect key={i} x={x0 - 16} y={77 + i * 4} width={8} height={1.2} fill="#d4a84a" stroke="none" />)}</g>);
  if (has(a, 'drafting-rig')) out.push(<g key="dr" stroke="#9aa4ad" strokeWidth={1.4} fill="none"><path d={`M${hand.x + 2},${hand.y - 4} L${hand.x + 16},${hand.y - 22} L${hand.x + 24},${hand.y - 14}`} /><circle cx={hand.x + 16} cy={hand.y - 22} r={1.6} fill={a.accent} stroke="none" /></g>);
  if (fx.holoOutline) out.push(<rect key="ho" x={x0 - 10} y={10} width={tw + 20} height={140} rx={14} fill="none" stroke={a.accent} strokeOpacity={0.25 + k * 0.4} strokeDasharray="3 4" />);
  if (fx.particles) out.push(<g key="pt" fill={a.accent} opacity={0.4 + k * 0.5}>{[0, 1, 2, 3, 4].map((i) => <circle key={i} cx={x0 - 6 + ((i * 17 + frame * 5) % (tw + 14))} cy={30 + ((i * 29 + frame * 7) % 100)} r={1.1} />)}</g>);
  return <g>{out}</g>;
}

export function EquipmentExtra({ a, s, x, y, side }: { a: Appearance; s: Record<string, unknown>; x: number; y: number; side?: boolean }) {
  switch (a.equipment) {
    case 'briefcase': return <g {...s}><rect x={x - 8} y={y} width={side ? 6 : 16} height={12} rx={1.5} fill="#2a1e14" /><path d={`M${x - 3},${y} l0,-3 l${side ? 2 : 6},0 l0,3`} fill="none" stroke="#2a1e14" strokeWidth={1.5} /><rect x={x - 1} y={y + 4} width={2} height={2} fill="#d4a84a" stroke="none" /></g>;
    case 'drafting-tablet': return <g {...s}><rect x={x - 9} y={y - 11} width={side ? 4 : 18} height={22} rx={1.5} fill="#e8eef0" /><path d={`M${x - 6},${y - 6} l${side ? 1 : 10},0 M${x - 6},${y - 2} l${side ? 1 : 7},4`} stroke="#2b6cb0" strokeWidth={1} /></g>;
    case 'holo-catalog': return <g><rect x={x - 8} y={y - 14} width={16} height={12} rx={2} fill={a.accent} opacity={0.25} stroke={a.accent} strokeWidth={0.8} />{[0, 1].map((i) => <rect key={i} x={x - 5} y={y - 11 + i * 4} width={10 - i * 3} height={1.4} fill={a.accent} />)}<rect x={x - 3} y={y - 2} width={6} height={3} rx={1} fill="#2a3036" /></g>;
    default: return null;
  }
}

/** Profile-view extras. */
export function SideExtras({ c, bodyX, td, layer }: { c: XCtx; bodyX: number; td: number; layer: 'back' | 'body' | 'head' }) {
  const { a, s, frame } = c;
  const fx = fxOn(a); const k = fx.intensity ?? 0.4; const tc = trim(a);
  if (layer === 'back') return (
    <g>
      {fx.aura && <ellipse cx={50} cy={92} rx={td + 10} ry={62} fill={a.accent} opacity={0.12 + k * 0.18} filter={`url(#${c.gid}-glow)`} />}
      {a.top === 'robe' && <path d={`M${bodyX - 3},62 L${bodyX + td + 2},62 L${bodyX + td + 6},148 L${bodyX - 9},148 Z`} fill={a.topColor} {...s} />}
      {a.top === 'longcoat' && <path d={`M${bodyX - 2},62 L${bodyX + td + 1},62 L${bodyX + td + 3},130 L${bodyX - 7},132 Z`} fill={shade(a.topColor, -0.08)} {...s} />}
    </g>
  );
  if (layer === 'body') return (
    <g>
      {a.top === 'armor' && [0, 1, 2].map((i) => <rect key={i} x={bodyX + 1} y={64 + i * 12} width={td - 2} height={9} rx={3} fill={shade(a.topColor, 0.12 - i * 0.06)} {...s} />)}
      {a.top === 'jacket' && <path d={`M${bodyX + td - 2},60 L${bodyX + td - 6},84`} stroke={tc} strokeWidth={1.5} />}
      {a.top === 'robe' && <rect x={bodyX} y={92} width={td} height={4} fill={tc} />}
      {a.belt === 'belt' && <rect x={bodyX - 1} y={95} width={td + 2} height={5} fill={shade(a.bottomColor, -0.4)} {...s} />}
      {a.belt === 'utility' && <g {...s}><rect x={bodyX - 1} y={95} width={td + 2} height={6} fill="#2e2a22" /><rect x={bodyX + td - 6} y={97} width={7} height={8} fill="#4a4230" /></g>}
      {(a.belt === 'harness' || has(a, 'tool-harness')) && <path d={`M${bodyX + 2},60 L${bodyX + td - 2},96`} stroke="#3a3326" strokeWidth={3} />}
      {has(a, 'data-cartridges') && <g>{[0, 1].map((i) => <rect key={i} x={bodyX + 2 + i * 7} y={93} width={6} height={7} rx={1} fill={a.accent} {...s} />)}</g>}
      {has(a, 'holo-badge') && <rect x={bodyX + td + 3} y={66 + (frame % 2)} width={7} height={10} rx={1.5} fill={a.accent} opacity={0.35} stroke={a.accent} strokeWidth={0.8} filter={`url(#${c.gid}-glow)`} />}
      {fx.energyAccents && <rect x={bodyX + td - 2} y={64} width={2} height={32} fill={a.accent} opacity={0.5 + k * 0.5} filter={`url(#${c.gid}-glow)`} />}
      {a.shoulders && a.shoulders !== 'none' && <rect x={bodyX - 2} y={55} width={td + 4} height={a.shoulders === 'armored' ? 11 : 8} rx={4} fill={a.shoulders === 'metallic' ? '#9aa4ad' : shade(a.topColor, a.shoulders === 'armored' ? 0.15 : -0.12)} {...s} />}
      {fx.robotics && <g fill="#9aa4ad" stroke="#2a3036" strokeWidth={0.8}><circle cx={50} cy={62} r={2.4} /><circle cx={50} cy={122} r={2.2} /></g>}
    </g>
  );
  return (
    <g>
      {a.faceMarkings === 'circuit' && <path d="M50,42 l4,0 l0,4" stroke={a.accent} strokeWidth={1} fill="none" />}
      {a.faceMarkings === 'scar' && <path d="M57,30 L59,44" stroke={shade(a.skinTone, -0.4)} strokeWidth={1.2} />}
      {(a.robotic === 'half-face' || a.robotic === 'full') && <path d="M50,20 Q66,18 67,32 L70,40 L66,44 Q64,54 54,55 L50,55 Z" fill="#8e99a3" opacity={0.6} stroke="#2a3036" strokeWidth={0.8} />}
      {a.robotic === 'jaw' && <path d="M52,46 Q58,56 66,48 L66,52 Q60,58 52,52 Z" fill="#8e99a3" stroke="#2a3036" strokeWidth={0.8} />}
      {a.robotic !== 'none' && a.robotic !== 'jaw' && a.robotic && <circle cx={60} cy={37} r={3.4} fill="#1a1f24" stroke={a.accent} strokeWidth={1.3} />}
      {fx.eyeGlow && <circle cx={60} cy={37} r={2.2} fill={a.accent} filter={`url(#${c.gid}-glow)`} />}
      {a.headwear === 'mask' && <path d="M52,42 L68,41 L68,50 Q60,56 52,52 Z" fill={a.headwearColor} {...s} />}
      {a.glasses === 'ar-glasses' && <g><rect x={55} y={33.5} width={10} height={7} rx={2} fill={a.accent} opacity={0.3} stroke="#cfe" strokeWidth={0.8} /><path d="M55,36 L47,37" stroke="#cfe" strokeWidth={0.8} /></g>}
      {has(a, 'diagnostic-visor') && <rect x={52} y={32} width={18} height={7} rx={3} fill="#ff9f43" opacity={0.75} filter={`url(#${c.gid}-glow)`} />}
      {has(a, 'comms-relay') && <rect x={43} y={35} width={5} height={8} rx={2} fill="#2a3036" />}
      {a.headwear === 'full-helmet' && <g {...s}><path d="M34,48 Q32,8 53,8 Q72,8 72,34 L72,48 Q60,58 34,48 Z" fill={a.headwearColor} /><rect x={58} y={28} width={14} height={10} rx={4} fill={a.accent} opacity={0.55} /></g>}
      {has(a, 'floating-assistant') && <g><circle cx={30} cy={28 + [0, -1.5, 0, 1.5][frame % 4]} r={5} fill="#2a3036" stroke={a.accent} strokeWidth={1} /><circle cx={32} cy={27.5 + [0, -1.5, 0, 1.5][frame % 4]} r={1.6} fill={a.accent} /></g>}
      {fx.particles && <g fill={a.accent} opacity={0.4 + k * 0.5}>{[0, 1, 2, 3].map((i) => <circle key={i} cx={30 + ((i * 19 + frame * 5) % 42)} cy={30 + ((i * 31 + frame * 7) % 100)} r={1.1} />)}</g>}
    </g>
  );
}

/** Top-down extras: what you'd see from above. */
export function TopExtras({ c, rx, layer }: { c: XCtx; rx: number; layer: 'under' | 'over' }) {
  const { a, s, frame } = c;
  const fx = fxOn(a); const k = fx.intensity ?? 0.4;
  if (layer === 'under') return (
    <g>
      {fx.aura && <circle cx={50} cy={50} r={rx + 16} fill={a.accent} opacity={0.1 + k * 0.15} filter={`url(#${c.gid}-glow)`} />}
      {(a.top === 'robe' || a.top === 'longcoat') && <ellipse cx={50} cy={58} rx={rx + 4} ry={a.top === 'robe' ? 20 : 17} fill={shade(a.topColor, -0.08)} {...s} />}
    </g>
  );
  return (
    <g>
      {a.top === 'armor' && <path d={`M${50 - rx + 4},47 L${50 + rx - 4},47 M${50 - rx + 4},55 L${50 + rx - 4},55`} stroke={shade(a.topColor, 0.25)} strokeWidth={3} />}
      {a.shoulders && a.shoulders !== 'none' && <g {...s} fill={a.shoulders === 'metallic' ? '#9aa4ad' : shade(a.topColor, a.shoulders === 'armored' ? 0.15 : -0.12)}><ellipse cx={50 - rx + 2} cy={50} rx={a.shoulders === 'armored' ? 8 : 6} ry={7} /><ellipse cx={50 + rx - 2} cy={50} rx={a.shoulders === 'armored' ? 8 : 6} ry={7} /></g>}
      {a.headwear === 'full-helmet' && <g {...s}><circle cx={50} cy={48} r={15} fill={a.headwearColor} /><path d="M41,39 Q50,33 59,39" stroke={a.accent} strokeWidth={3} fill="none" /></g>}
      {a.headwear === 'mask' && <path d="M43,38 Q50,34 57,38" stroke={a.headwearColor} strokeWidth={3} fill="none" />}
      {has(a, 'floating-assistant') && <circle cx={50 + rx + 10} cy={34 + [0, -1, 0, 1][frame % 4]} r={4.5} fill="#2a3036" stroke={a.accent} strokeWidth={1} />}
      {has(a, 'holo-badge') && <rect x={50 - rx - 12} y={44} width={7} height={9} rx={1.5} fill={a.accent} opacity={0.4} />}
      {fx.holoOutline && <circle cx={50} cy={50} r={rx + 8} fill="none" stroke={a.accent} strokeOpacity={0.25 + k * 0.4} strokeDasharray="3 4" />}
      {fx.particles && <g fill={a.accent} opacity={0.4 + k * 0.5}>{[0, 1, 2, 3].map((i) => <circle key={i} cx={22 + ((i * 23 + frame * 5) % 56)} cy={22 + ((i * 37 + frame * 7) % 56)} r={1.1} />)}</g>}
    </g>
  );
}
