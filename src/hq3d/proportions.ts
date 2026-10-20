// Body proportions for the original 3D character styles. Pure numbers so the
// silhouettes can be checked in tests: chibi has the big head, sleek the long
// legs, blocky the square limbs, heroic the broad shoulders.
import type { Appearance, BodyStyle } from '../model/types';

export interface StyleProportions {
  head: [number, number, number];   // w, h, d
  torso: [number, number, number];  // w (shoulders), h, d
  waist: number;                    // waist width as a fraction of torso width
  arm: [number, number];            // length, thickness
  leg: [number, number];            // length, thickness
  neck: number;
  blocky: boolean;                  // square limbs and head
  height: number;                   // total height at appearance.height = 1, world units
}

export const BODY_STYLE_TABLE: Record<BodyStyle, StyleProportions> = {
  heroic: { head: [0.3, 0.33, 0.31], torso: [0.5, 0.46, 0.26], waist: 0.72, arm: [0.6, 0.12], leg: [0.66, 0.15], neck: 0.06, blocky: false, height: 1.62 },
  blocky: { head: [0.4, 0.38, 0.38], torso: [0.52, 0.5, 0.26], waist: 1, arm: [0.5, 0.22], leg: [0.5, 0.24], neck: 0.02, blocky: true, height: 1.5 },
  chibi: { head: [0.56, 0.54, 0.52], torso: [0.36, 0.32, 0.26], waist: 0.9, arm: [0.3, 0.12], leg: [0.3, 0.15], neck: 0.03, blocky: false, height: 1.25 },
  sleek: { head: [0.26, 0.3, 0.28], torso: [0.38, 0.5, 0.22], waist: 0.78, arm: [0.66, 0.09], leg: [0.8, 0.11], neck: 0.07, blocky: false, height: 1.66 },
};

export const DEFAULT_BODY_STYLE: BodyStyle = 'heroic';

export interface BodyDims {
  style: BodyStyle; blocky: boolean; scale: number;
  headW: number; headH: number; headD: number; neck: number;
  torsoW: number; torsoH: number; torsoD: number; waistW: number;
  armLen: number; armW: number; legLen: number; legW: number;
  hipY: number; shoulderY: number; headY: number; total: number;
}

const BUILD_WIDTH: Record<Appearance['build'], number> = { slim: 0.88, average: 1, broad: 1.16 };

/** World-space body measurements for an appearance. */
export function bodyDims(a: Pick<Appearance, 'bodyStyle' | 'build' | 'height'>): BodyDims {
  const style = a.bodyStyle ?? DEFAULT_BODY_STYLE;
  const p = BODY_STYLE_TABLE[style] ?? BODY_STYLE_TABLE[DEFAULT_BODY_STYLE];
  const bw = BUILD_WIDTH[a.build] ?? 1;
  const raw = p.leg[0] + p.torso[1] + p.neck + p.head[1];
  const h = Math.max(0.8, Math.min(1.2, a.height || 1));
  const scale = (p.height * h) / raw;
  const s = (v: number) => v * scale;
  const legLen = s(p.leg[0]), torsoH = s(p.torso[1]), neck = s(p.neck), headH = s(p.head[1]);
  return {
    style, blocky: p.blocky, scale,
    headW: s(p.head[0]), headH, headD: s(p.head[2]), neck,
    torsoW: s(p.torso[0]) * bw, torsoH, torsoD: s(p.torso[2]) * (0.9 + bw * 0.1), waistW: s(p.torso[0]) * bw * p.waist,
    armLen: s(p.arm[0]), armW: s(p.arm[1]) * bw, legLen, legW: s(p.leg[1]) * bw,
    hipY: legLen, shoulderY: legLen + torsoH, headY: legLen + torsoH + neck, total: legLen + torsoH + neck + headH,
  };
}

/** Head-to-body ratio (head height / total height): the main silhouette cue between styles. */
export function headRatio(a: Pick<Appearance, 'bodyStyle' | 'build' | 'height'>): number { const d = bodyDims(a); return d.headH / d.total; }
