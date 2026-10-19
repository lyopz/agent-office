import { flappy, pong, pacman, botInput, canAgentPlay, defaultArcadeConfig, recordSession } from '../src/arcade';
import type { ArcadeConfig, ArcadeSession, GameState, Input } from '../src/arcade';

const DT = 1 / 60;

// Drive a game with a policy until it ends (or a step budget runs out).
function run<S extends GameState>(s: S, step: (s: S, i: Input, dt: number) => S, policy: (s: S) => Input, max = 200_000) {
  for (let i = 0; i < max && !s.over; i++) s = step(s, policy(s), DT);
  return s;
}

test('each game is deterministic for a seed', () => {
  const a1 = run(flappy.init(7), flappy.step, (s) => botInput('flappy', s), 3000);
  const a2 = run(flappy.init(7), flappy.step, (s) => botInput('flappy', s), 3000);
  expect(a2).toEqual(a1);
  const p1 = run(pong.init(7), pong.step, (s) => botInput('pong', s), 3000);
  const p2 = run(pong.init(7), pong.step, (s) => botInput('pong', s), 3000);
  expect(p2).toEqual(p1);
  const m1 = run(pacman.init(7), pacman.step, (s) => botInput('pacman', s), 3000);
  const m2 = run(pacman.init(7), pacman.step, (s) => botInput('pacman', s), 3000);
  expect(m2).toEqual(m1);
});

test('human Pong is a match to exactly 11', () => {
  for (const seed of [1, 2, 3]) {
    let s = pong.init(seed);
    let maxSeen = 0;
    for (let i = 0; i < 400_000 && !s.over; i++) {
      s = pong.step(s, botInput('pong', s), DT);
      maxSeen = Math.max(maxSeen, s.score, s.cpu);
    }
    expect(s.over).toBe(true);
    expect(maxSeen).toBe(11);
    expect(Math.max(s.score, s.cpu)).toBe(11);
    expect(s.reason).toBe(s.score === 11 ? 'win' : 'lose');
  }
  // An idle player loses 0-11.
  const idle = run(pong.init(9), pong.step, () => ({}));
  expect([idle.score, idle.cpu, idle.reason]).toEqual([0, 11, 'lose']);
});

test('Flappy with limits stops at the score cap and freezes after over', () => {
  const s = run(flappy.init(42, { maxScore: 3, maxSessionSec: 600 }), flappy.step, (x) => botInput('flappy', x));
  expect(s.over).toBe(true);
  expect(s.reason).toBe('score-cap');
  expect(s.score).toBe(3);
  let t = s;
  for (let i = 0; i < 500; i++) t = flappy.step(t, { flap: i % 7 === 0 }, DT);
  expect(t).toBe(s);
  expect(t.score).toBe(3);
});

test('human Flappy has no cap and ends on a crash', () => {
  const s = run(flappy.init(5), flappy.step, (x) => (x.started ? {} : { flap: true }));
  expect(s.reason).toBe('crash');
  expect(s.limits).toBeNull();
});

test('time limit ends agent sessions at maxSessionSec', () => {
  const lim = { maxScore: 1_000_000, maxSessionSec: 5 };
  const p = run(pong.init(1, lim), pong.step, (x) => botInput('pong', x));
  expect([p.reason, p.elapsed]).toEqual(['time-limit', 5]);
  const m = run(pacman.init(1, lim), pacman.step, () => ({}));
  expect([m.reason, m.elapsed]).toEqual(['time-limit', 5]);
  // Flappy agent session starts immediately; hovering along the bot path still hits the timer.
  const f = run(flappy.init(1, { maxScore: 1000, maxSessionSec: 2 }), flappy.step, (x) => botInput('flappy', x));
  expect([f.reason, f.elapsed]).toEqual(['time-limit', 2]);
});

test('Pac-Man pellets score 10 and the game ends caught or cleared', () => {
  let s = pacman.init(3);
  while (s.score === 0) s = pacman.step(s, { left: true }, DT);
  expect(s.score).toBe(10);
  const before = s.left;
  while (s.score === 10) s = pacman.step(s, { left: true }, DT);
  expect(s.score).toBe(20);
  expect(s.left).toBe(before - 1);

  for (const seed of [1, 2, 3, 4]) {
    const end = run(pacman.init(seed), pacman.step, (x) => botInput('pacman', x));
    expect(end.over).toBe(true);
    expect(['caught', 'cleared']).toContain(end.reason);
    if (end.reason === 'caught') expect(end.lives).toBe(0);
    else expect(end.left).toBe(0);
  }
  // Standing still gets caught three times.
  const idle = run(pacman.init(1), pacman.step, () => ({}));
  expect([idle.reason, idle.lives]).toEqual(['caught', 0]);
});

test('Pac-Man maze is fully connected', () => {
  const { MAP, COLS, ROWS, isWall, canMove, DX, DY } = pacman;
  const open: string[] = [];
  for (let y = 0; y < ROWS; y++) for (let x = 0; x < COLS; x++) if (!isWall(x, y)) open.push(`${x},${y}`);
  const start = MAP.findIndex((r) => r.includes('P'));
  const seen = new Set([`${MAP[start].indexOf('P')},${start}`]);
  const q = [...seen].map((k) => k.split(',').map(Number));
  while (q.length) {
    const [x, y] = q.shift()!;
    for (let d = 0; d < 4; d++) {
      const k = `${x + DX[d]},${y + DY[d]}`;
      if (canMove(x, y, d) && !seen.has(k)) {
        seen.add(k);
        q.push([x + DX[d], y + DY[d]]);
      }
    }
  }
  expect(seen.size).toBe(open.length);
});

describe('canAgentPlay', () => {
  const now = new Date(2026, 9, 19, 12, 0, 0);
  const session = (i: number, over: Partial<ArcadeSession> = {}): ArcadeSession => ({
    id: `s${i}`,
    agentId: 'a1',
    game: 'flappy',
    startedAt: new Date(2026, 9, 19, 9, i).toISOString(),
    durationSec: 10,
    score: 1,
    result: 'crash',
    reward: 0,
    ...over,
  });
  const tokenFree = (verified: boolean): ArcadeConfig => ({ ...defaultArcadeConfig(), policy: 'token-free', tokenFreeVerified: verified });

  test('defaults keep agent play off', () => {
    const cfg = defaultArcadeConfig();
    expect(cfg.policy).toBe('human-only');
    expect(cfg.tokenFreeVerified).toBe(false);
    expect(cfg.maxAgentMatchesPerDay).toBe(3);
    expect(canAgentPlay(cfg, [], 'a1', 'pong', now).ok).toBe(false);
    expect(canAgentPlay({ ...cfg, policy: 'agent-disabled', tokenFreeVerified: true }, [], 'a1', 'pong', now).ok).toBe(false);
  });

  test('token-free requires verification', () => {
    expect(canAgentPlay(tokenFree(false), [], 'a1', 'pong', now).ok).toBe(false);
    expect(canAgentPlay(tokenFree(true), [], 'a1', 'pong', now)).toEqual({ ok: true });
  });

  test('daily match limit counts abandoned sessions and spans games', () => {
    const cfg = tokenFree(true);
    const two = [session(1, { result: 'abandoned', durationSec: 0 }), session(2, { game: 'pong', result: 'abandoned' })];
    expect(canAgentPlay(cfg, two, 'a1', 'pacman', now).ok).toBe(true);
    const three = recordSession(two, session(3, { result: 'abandoned', durationSec: 1 }));
    const res = canAgentPlay(cfg, three, 'a1', 'pacman', now);
    expect(res.ok).toBe(false);
    // Other agents, the human, and other days are unaffected.
    expect(canAgentPlay(cfg, three, 'a2', 'pacman', now).ok).toBe(true);
    const yesterday = three.map((s) => ({ ...s, startedAt: new Date(2026, 9, 18, 9).toISOString() }));
    expect(canAgentPlay(cfg, yesterday, 'a1', 'pacman', now).ok).toBe(true);
  });

  test('daily play time per game is capped', () => {
    const cfg = { ...tokenFree(true), maxAgentMatchesPerDay: 5 };
    const long = [session(1, { durationSec: 180 * 5 })];
    expect(canAgentPlay(cfg, long, 'a1', 'flappy', now).ok).toBe(false);
    expect(canAgentPlay(cfg, long, 'a1', 'pong', now).ok).toBe(true);
  });

  test('recordSession keeps the last 500', () => {
    let list: ArcadeSession[] = [];
    for (let i = 0; i < 510; i++) list = recordSession(list, session(i, { agentId: null }));
    expect(list).toHaveLength(500);
    expect(list[0].id).toBe('s10');
  });
});
