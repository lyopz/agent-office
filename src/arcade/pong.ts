import { applyLimits, clampDt, nextRand } from './types';
import type { BaseState, GameLimits, Input } from './types';

export const W = 400;
export const H = 300;
export const PW = 8;
export const PH = 56;
export const PX = 16;
export const CX = W - 16 - PW;
export const BR = 5;
export const WIN = 11;
const PLAYER_SPEED = 280;
const CPU_SPEED = 190;
const START_SPEED = 220;
const MAX_SPEED = 560;
const SERVE_DELAY = 0.8;

export interface PongState extends BaseState {
  py: number; // player paddle top
  cy: number; // cpu paddle top
  bx: number;
  by: number;
  vx: number;
  vy: number;
  cpu: number;
  serve: number; // seconds until the ball moves
}

// Centre the ball and aim it at `dir` (-1 player, 1 cpu) with a small random angle.
function serve(s: PongState, dir: number) {
  const [r, rng] = nextRand(s.rng);
  s.rng = rng;
  const a = (r - 0.5) * 0.7;
  s.bx = W / 2;
  s.by = H / 2;
  s.vx = dir * START_SPEED * Math.cos(a);
  s.vy = START_SPEED * Math.sin(a);
  s.serve = SERVE_DELAY;
}

export function init(seed: number, limits?: GameLimits): PongState {
  const s: PongState = {
    score: 0,
    elapsed: 0,
    over: false,
    reason: null,
    limits: limits ?? null,
    w: W,
    h: H,
    rng: seed | 0,
    py: (H - PH) / 2,
    cy: (H - PH) / 2,
    bx: W / 2,
    by: H / 2,
    vx: 0,
    vy: 0,
    cpu: 0,
    serve: 0,
  };
  serve(s, -1);
  return s;
}

// Bounce off a paddle; the hit offset sets the angle and each hit speeds the ball up.
function hit(s: PongState, top: number, dir: number) {
  const speed = Math.min(Math.hypot(s.vx, s.vy) * 1.05, MAX_SPEED);
  const off = Math.max(-1, Math.min(1, (s.by - (top + PH / 2)) / (PH / 2)));
  const a = off * 1.0;
  s.vx = dir * speed * Math.cos(a);
  s.vy = speed * Math.sin(a);
}

const clampPaddle = (y: number) => Math.max(0, Math.min(H - PH, y));

export function step(prev: PongState, input: Input, dt: number): PongState {
  if (prev.over) return prev;
  dt = clampDt(dt);
  const s: PongState = { ...prev };
  s.elapsed += dt;

  const move = (input.down ? 1 : 0) - (input.up ? 1 : 0);
  s.py = clampPaddle(s.py + move * PLAYER_SPEED * dt);

  // CPU tracks the ball only while it approaches, otherwise drifts to centre.
  const target = s.vx > 0 ? s.by : H / 2;
  const diff = target - (s.cy + PH / 2);
  const cap = CPU_SPEED * dt;
  s.cy = clampPaddle(s.cy + Math.max(-cap, Math.min(cap, diff)));

  if (s.serve > 0) {
    s.serve = Math.max(0, s.serve - dt);
  } else {
    const ox = s.bx;
    s.bx += s.vx * dt;
    s.by += s.vy * dt;
    if (s.by < BR) {
      s.by = BR;
      s.vy = Math.abs(s.vy);
    } else if (s.by > H - BR) {
      s.by = H - BR;
      s.vy = -Math.abs(s.vy);
    }
    const inSpan = (top: number) => s.by >= top - BR && s.by <= top + PH + BR;
    // Crossing tests so a fast ball cannot tunnel through a paddle.
    const pFace = PX + PW;
    if (s.vx < 0 && ox - BR >= pFace && s.bx - BR < pFace && inSpan(s.py)) {
      s.bx = pFace + BR;
      hit(s, s.py, 1);
    } else if (s.vx > 0 && ox + BR <= CX && s.bx + BR > CX && inSpan(s.cy)) {
      s.bx = CX - BR;
      hit(s, s.cy, -1);
    }
    if (s.bx < -BR * 2) {
      s.cpu += 1;
      serve(s, -1);
    } else if (s.bx > W + BR * 2) {
      s.score += 1;
      serve(s, 1);
    }
  }

  // A match is always first to 11, with or without agent limits.
  if (s.score >= WIN) {
    s.score = WIN;
    s.over = true;
    s.reason = 'win';
  } else if (s.cpu >= WIN) {
    s.over = true;
    s.reason = 'lose';
  }
  return applyLimits(s);
}
