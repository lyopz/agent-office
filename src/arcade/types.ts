// Shared types and helpers for the arcade mini-games.

export type GameId = 'flappy' | 'pacman' | 'pong';

export interface GameLimits {
  maxScore: number;
  maxSessionSec: number;
}

// Caps that apply only to automated (agent) sessions; human play passes no limits.
export const DEFAULT_LIMITS: Record<GameId, GameLimits> = {
  flappy: { maxScore: 100, maxSessionSec: 180 },
  pacman: { maxScore: 10000, maxSessionSec: 300 },
  pong: { maxScore: 11, maxSessionSec: 300 },
};

export type EndReason = 'crash' | 'caught' | 'cleared' | 'win' | 'lose' | 'score-cap' | 'time-limit';

// `flap` is a press edge: true for exactly one step.
export interface Input {
  up?: boolean;
  down?: boolean;
  left?: boolean;
  right?: boolean;
  flap?: boolean;
}

export const GAME_META: Record<GameId, { title: string; controls: string }> = {
  flappy: { title: 'Flappy Bird', controls: 'Space or ↑ to flap' },
  pacman: { title: 'Pac-Man', controls: 'Arrow keys to steer' },
  pong: { title: 'Pong', controls: '↑/↓ or W/S to move · first to 11 wins' },
};

// Fields every game state carries.
export interface BaseState {
  score: number;
  elapsed: number;
  over: boolean;
  reason: EndReason | null;
  limits: GameLimits | null;
  w: number;
  h: number;
  rng: number;
}

// mulberry32: returns [value in 0..1, next seed]. Keeps games deterministic per seed.
export function nextRand(seed: number): [number, number] {
  const t = (seed + 0x6d2b79f5) | 0;
  let r = Math.imul(t ^ (t >>> 15), 1 | t);
  r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
  return [((r ^ (r >>> 14)) >>> 0) / 4294967296, t];
}

export const clampDt = (dt: number) => Math.min(Math.max(dt, 0), 0.05);

// Enforce agent-session caps: clamp score, end on score cap or time limit.
export function applyLimits<S extends BaseState>(s: S): S {
  if (!s.limits) return s;
  const { maxScore, maxSessionSec } = s.limits;
  let out = s.score > maxScore ? { ...s, score: maxScore } : s;
  if (out.over) return out;
  if (out.score >= maxScore) out = { ...out, over: true, reason: 'score-cap' };
  else if (out.elapsed >= maxSessionSec) {
    out = { ...out, elapsed: maxSessionSec, over: true, reason: 'time-limit' };
  }
  return out;
}
