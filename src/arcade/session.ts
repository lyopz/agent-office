// Ledger and policy for automated (agent) arcade sessions. Agent play is off by default.
import { DEFAULT_LIMITS } from './types';
import type { EndReason, GameId, GameLimits, Input } from './types';
import * as flappy from './flappy';
import * as pong from './pong';
import * as pacman from './pacman';

export type ArcadePolicy = 'human-only' | 'agent-disabled' | 'token-free';

export interface ArcadeConfig {
  policy: ArcadePolicy;
  limits: Record<GameId, GameLimits>;
  maxAgentMatchesPerDay: number;
  // Must be set only after confirming agent play spends no model tokens.
  tokenFreeVerified: boolean;
}

export function defaultArcadeConfig(): ArcadeConfig {
  return {
    policy: 'human-only',
    limits: { ...DEFAULT_LIMITS },
    maxAgentMatchesPerDay: 3,
    tokenFreeVerified: false,
  };
}

export interface ArcadeSession {
  id: string;
  agentId: string | null; // null = the human
  game: GameId;
  startedAt: string; // ISO timestamp
  durationSec: number;
  score: number;
  result: EndReason | 'abandoned';
  reward: number;
}

export type GameState = flappy.FlappyState | pong.PongState | pacman.PacState;

const dayKey = (d: Date) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;

export function canAgentPlay(
  cfg: ArcadeConfig,
  sessions: ArcadeSession[],
  agentId: string,
  game: GameId,
  now: Date,
): { ok: true } | { ok: false; reason: string } {
  if (cfg.policy !== 'token-free') return { ok: false, reason: `Agent play is off (policy: ${cfg.policy}).` };
  if (!cfg.tokenFreeVerified) return { ok: false, reason: 'Token-free play has not been verified.' };
  const today = dayKey(now);
  // Every session counts, including abandoned ones, so restarting cannot dodge the limit.
  const mine = sessions.filter((s) => s.agentId === agentId && dayKey(new Date(s.startedAt)) === today);
  if (mine.length >= cfg.maxAgentMatchesPerDay) {
    return { ok: false, reason: `Daily limit of ${cfg.maxAgentMatchesPerDay} matches reached.` };
  }
  const secs = mine.filter((s) => s.game === game).reduce((n, s) => n + s.durationSec, 0);
  if (secs >= cfg.limits[game].maxSessionSec * cfg.maxAgentMatchesPerDay) {
    return { ok: false, reason: `Daily play time for ${game} used up.` };
  }
  return { ok: true };
}

export function recordSession(sessions: ArcadeSession[], s: ArcadeSession): ArcadeSession[] {
  return [...sessions, s].slice(-500);
}

// Deterministic, local strategies (no model calls) that could drive future agent play.
export function botInput(game: 'flappy', state: flappy.FlappyState): Input;
export function botInput(game: 'pong', state: pong.PongState): Input;
export function botInput(game: 'pacman', state: pacman.PacState): Input;
export function botInput(game: GameId, state: GameState): Input;
export function botInput(game: GameId, state: GameState): Input {
  if (game === 'flappy') return flappyBot(state as flappy.FlappyState);
  if (game === 'pong') return pongBot(state as pong.PongState);
  return pacBot(state as pacman.PacState);
}

// Flap whenever the bird sinks below a point just under the next gap's centre.
function flappyBot(s: flappy.FlappyState): Input {
  const next = s.pipes.find((p) => p.x + flappy.PIPE_W > flappy.BIRD_X - flappy.R);
  const target = next ? next.gapY + flappy.GAP * 0.15 : s.h / 2;
  return { flap: s.y > target && s.vy > -60 };
}

// Follow the ball while it approaches, otherwise return to the middle.
function pongBot(s: pong.PongState): Input {
  const target = s.vx < 0 ? s.by : s.h / 2;
  const diff = target - (s.py + pong.PH / 2);
  return { up: diff < -4, down: diff > 4 };
}

const DIR_INPUT: Input[] = [{ up: true }, { left: true }, { down: true }, { right: true }];

// BFS to the nearest pellet, avoiding tiles next to dangerous ghosts; flee if boxed in.
function pacBot(s: pacman.PacState): Input {
  const { pac } = s;
  const { DX, DY, COLS, canMove } = pacman;
  const sx = pac.dir >= 0 && pac.t > 0 ? pac.x + DX[pac.dir] : pac.x;
  const sy = pac.dir >= 0 && pac.t > 0 ? pac.y + DY[pac.dir] : pac.y;
  const danger = new Set<number>();
  for (const g of s.ghosts) {
    if (g.scared) continue;
    const p = pacman.posOf(g);
    const gx = Math.round(p.x);
    const gy = Math.round(p.y);
    for (let d = -1; d < 4; d++) {
      const x = gx + (d >= 0 ? DX[d] : 0);
      const y = gy + (d >= 0 ? DY[d] : 0);
      danger.add(y * COLS + x);
    }
  }
  const back = pac.dir >= 0 ? (pac.dir + 2) % 4 : -1;
  const search = (allowBack: boolean) => {
    const seen = new Set([sy * COLS + sx]);
    const queue: { x: number; y: number; first: number }[] = [];
    for (let d = 0; d < 4; d++) {
      if ((d === back && !allowBack) || !canMove(sx, sy, d)) continue;
      const x = sx + DX[d];
      const y = sy + DY[d];
      if (danger.has(y * COLS + x)) continue;
      seen.add(y * COLS + x);
      queue.push({ x, y, first: d });
    }
    for (let i = 0; i < queue.length; i++) {
      const n = queue[i];
      if (s.pellets[n.y * COLS + n.x]) return n.first;
      for (let d = 0; d < 4; d++) {
        const x = n.x + DX[d];
        const y = n.y + DY[d];
        const k = y * COLS + x;
        if (!canMove(n.x, n.y, d) || seen.has(k) || danger.has(k)) continue;
        seen.add(k);
        queue.push({ x, y, first: n.first });
      }
    }
    return -1;
  };
  let dir = search(false);
  if (dir < 0) dir = search(true);
  if (dir < 0) {
    // Boxed in: step to the open neighbour farthest from the nearest ghost.
    let best = -1;
    let bestD = -1;
    for (let d = 0; d < 4; d++) {
      if (!canMove(sx, sy, d)) continue;
      const x = sx + DX[d];
      const y = sy + DY[d];
      const near = Math.min(...s.ghosts.map((g) => Math.hypot(g.x - x, g.y - y)));
      if (near > bestD) {
        bestD = near;
        best = d;
      }
    }
    dir = best;
  }
  return dir >= 0 ? DIR_INPUT[dir] : {};
}
