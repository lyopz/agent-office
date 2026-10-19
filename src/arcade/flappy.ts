import { applyLimits, clampDt, nextRand } from './types';
import type { BaseState, GameLimits, Input } from './types';

export const W = 288;
export const H = 512;
export const GROUND = 40;
export const BIRD_X = 70;
export const R = 11;
export const PIPE_W = 52;
export const GAP = 130;
const GRAVITY = 1100;
const FLAP = -330;
const MAX_FALL = 520;
const SPEED = 130;
const SPACING = 180;

// gapY is the centre of the opening.
export interface Pipe {
  x: number;
  gapY: number;
  passed: boolean;
}

export interface FlappyState extends BaseState {
  y: number;
  vy: number;
  pipes: Pipe[];
  // Human play waits for the first flap; agent sessions start immediately.
  started: boolean;
}

export function init(seed: number, limits?: GameLimits): FlappyState {
  return {
    score: 0,
    elapsed: 0,
    over: false,
    reason: null,
    limits: limits ?? null,
    w: W,
    h: H,
    rng: seed | 0,
    y: H / 2 - 40,
    vy: 0,
    pipes: [],
    started: !!limits,
  };
}

function gapFor(r: number) {
  const lo = 60 + GAP / 2;
  const hi = H - GROUND - 60 - GAP / 2;
  return lo + r * (hi - lo);
}

export function step(prev: FlappyState, input: Input, dt: number): FlappyState {
  if (prev.over) return prev;
  if (!prev.started && !input.flap) return prev;
  dt = clampDt(dt);
  const s: FlappyState = { ...prev, started: true, pipes: prev.pipes.map((p) => ({ ...p })) };
  s.elapsed += dt;

  if (input.flap) s.vy = FLAP;
  s.vy = Math.min(s.vy + GRAVITY * dt, MAX_FALL);
  s.y += s.vy * dt;

  // Scroll, drop off-screen pipes, spawn new ones at a fixed spacing.
  for (const p of s.pipes) p.x -= SPEED * dt;
  s.pipes = s.pipes.filter((p) => p.x + PIPE_W > -10);
  const last = s.pipes[s.pipes.length - 1];
  if (!last || last.x + SPACING <= W + PIPE_W) {
    const [r, rng] = nextRand(s.rng);
    s.rng = rng;
    s.pipes.push({ x: last ? last.x + SPACING : W + 60, gapY: gapFor(r), passed: false });
  }

  for (const p of s.pipes) {
    if (!p.passed && p.x + PIPE_W < BIRD_X - R) {
      p.passed = true;
      s.score += 1;
    }
  }

  // Collisions: floor, ceiling, pipe bodies.
  let crash = s.y - R <= 0 || s.y + R >= H - GROUND;
  for (const p of s.pipes) {
    const overlapX = BIRD_X + R > p.x && BIRD_X - R < p.x + PIPE_W;
    if (overlapX && (s.y - R < p.gapY - GAP / 2 || s.y + R > p.gapY + GAP / 2)) crash = true;
  }
  if (crash) {
    s.over = true;
    s.reason = 'crash';
  }
  return applyLimits(s);
}
