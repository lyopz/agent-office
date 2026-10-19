import { applyLimits, clampDt, nextRand } from './types';
import type { BaseState, GameLimits, Input } from './types';

// '#' wall, '.' pellet, 'o' power pellet, ' ' empty, 'P' pac start, 'G' ghost home.
export const MAP = [
  '###################',
  '#o.......#.......o#',
  '#.##.###.#.###.##.#',
  '#.................#',
  '#.##.#.#####.#.##.#',
  '#....#...#...#....#',
  '####.###   ###.####',
  '####.#  GGG  #.####',
  '####.# ##### #.####',
  '#........#........#',
  '#.##.###.#.###.##.#',
  '#o.#.....P.....#.o#',
  '##.#.#.#####.#.#.##',
  '#....#...#...#....#',
  '###################',
];
export const COLS = MAP[0].length;
export const ROWS = MAP.length;
export const TILE = 16;

// Directions: 0 up, 1 left, 2 down, 3 right (classic tie-break order); -1 = stopped.
export const DX = [0, -1, 0, 1];
export const DY = [-1, 0, 1, 0];
const PAC_SPEED = 5;
const GHOST_SPEED = 4;
const SCARED_SPEED = 2.5;
const FRIGHT_SEC = 6;
const DEATH_PAUSE = 1;

export interface Mover {
  x: number; // tile the mover last left
  y: number;
  dir: number;
  t: number; // progress 0..1 toward the next tile in `dir`
}
export interface Pac extends Mover {
  want: number; // buffered turn
}
export interface Ghost extends Mover {
  homeX: number;
  homeY: number;
  scared: boolean;
}
export interface PacState extends BaseState {
  pac: Pac;
  ghosts: Ghost[];
  pellets: number[]; // per tile: 0 none, 1 pellet, 2 power pellet
  left: number;
  lives: number;
  fright: number;
  pause: number;
}

const find = (ch: string) =>
  MAP.flatMap((row, y) => [...row].flatMap((c, x) => (c === ch ? [{ x, y }] : [])));
const PAC_START = find('P')[0];
const GHOST_HOMES = find('G');
// Scatter corners per ghost.
const CORNERS = [
  { x: COLS - 2, y: 0 },
  { x: 1, y: 0 },
  { x: 1, y: ROWS - 1 },
];

export const isWall = (x: number, y: number) =>
  x < 0 || y < 0 || x >= COLS || y >= ROWS || MAP[y][x] === '#';
export const canMove = (x: number, y: number, d: number) => d >= 0 && !isWall(x + DX[d], y + DY[d]);
// Continuous position in tiles, for drawing and collisions.
export const posOf = (m: Mover) => ({
  x: m.x + (m.dir >= 0 ? DX[m.dir] * m.t : 0),
  y: m.y + (m.dir >= 0 ? DY[m.dir] * m.t : 0),
});

// Fresh pac and ghosts at their start tiles (used at start and after losing a life).
function actors(): Pick<PacState, 'pac' | 'ghosts' | 'fright'> {
  return {
    pac: { x: PAC_START.x, y: PAC_START.y, dir: -1, t: 0, want: -1 },
    ghosts: GHOST_HOMES.map((h) => ({ x: h.x, y: h.y, dir: -1, t: 0, homeX: h.x, homeY: h.y, scared: false })),
    fright: 0,
  };
}

export function init(seed: number, limits?: GameLimits): PacState {
  const pellets = MAP.flatMap((row) => [...row].map((c) => (c === '.' ? 1 : c === 'o' ? 2 : 0)));
  return {
    ...actors(),
    score: 0,
    elapsed: 0,
    over: false,
    reason: null,
    limits: limits ?? null,
    w: COLS * TILE,
    h: ROWS * TILE,
    rng: seed | 0,
    pellets,
    left: pellets.filter((p) => p > 0).length,
    lives: 3,
    pause: 0,
  };
}

function eat(s: PacState) {
  const i = s.pac.y * COLS + s.pac.x;
  const p = s.pellets[i];
  if (!p) return;
  s.pellets = s.pellets.slice();
  s.pellets[i] = 0;
  s.left -= 1;
  s.score += p === 2 ? 50 : 10;
  if (p === 2) {
    s.fright = FRIGHT_SEC;
    for (const g of s.ghosts) g.scared = true;
  }
}

function movePac(s: PacState, dt: number) {
  const m = s.pac;
  // Reversing is allowed mid-tile.
  if (m.dir >= 0 && m.want === (m.dir + 2) % 4 && m.t > 0) {
    m.x += DX[m.dir];
    m.y += DY[m.dir];
    m.t = 1 - m.t;
    m.dir = m.want;
  }
  const choose = () => (canMove(m.x, m.y, m.want) ? m.want : canMove(m.x, m.y, m.dir) ? m.dir : -1);
  if (m.dir < 0) m.dir = choose();
  if (m.dir < 0) return;
  m.t += PAC_SPEED * dt;
  while (m.t >= 1) {
    m.x += DX[m.dir];
    m.y += DY[m.dir];
    m.t -= 1;
    eat(s);
    m.dir = choose();
    if (m.dir < 0) {
      m.t = 0;
      break;
    }
  }
}

function ghostTarget(s: PacState, i: number, g: Ghost) {
  const p = s.pac;
  const scatter = s.elapsed % 27 < 7;
  if (scatter) return CORNERS[i % CORNERS.length];
  if (i === 1 && p.dir >= 0) return { x: p.x + DX[p.dir] * 4, y: p.y + DY[p.dir] * 4 };
  if (i === 2 && Math.hypot(g.x - p.x, g.y - p.y) < 5) return CORNERS[2];
  return { x: p.x, y: p.y };
}

// At a tile centre: no reversing unless it is a dead end; scared ghosts wander randomly.
function chooseGhostDir(s: PacState, i: number, g: Ghost) {
  const back = g.dir >= 0 ? (g.dir + 2) % 4 : -1;
  let opts = [0, 1, 2, 3].filter((d) => d !== back && canMove(g.x, g.y, d));
  if (!opts.length) opts = back >= 0 && canMove(g.x, g.y, back) ? [back] : [];
  if (!opts.length) return -1;
  if (g.scared) {
    const [r, rng] = nextRand(s.rng);
    s.rng = rng;
    return opts[Math.floor(r * opts.length)];
  }
  const tg = ghostTarget(s, i, g);
  let best = opts[0];
  let bestD = Infinity;
  for (const d of opts) {
    const dd = (g.x + DX[d] - tg.x) ** 2 + (g.y + DY[d] - tg.y) ** 2;
    if (dd < bestD) {
      bestD = dd;
      best = d;
    }
  }
  return best;
}

function moveGhost(s: PacState, i: number, dt: number) {
  const g = s.ghosts[i];
  if (g.dir < 0) g.dir = chooseGhostDir(s, i, g);
  if (g.dir < 0) return;
  g.t += (g.scared ? SCARED_SPEED : GHOST_SPEED) * dt;
  while (g.t >= 1) {
    g.x += DX[g.dir];
    g.y += DY[g.dir];
    g.t -= 1;
    g.dir = chooseGhostDir(s, i, g);
    if (g.dir < 0) {
      g.t = 0;
      break;
    }
  }
}

export function step(prev: PacState, input: Input, dt: number): PacState {
  if (prev.over) return prev;
  dt = clampDt(dt);
  const s: PacState = { ...prev, pac: { ...prev.pac }, ghosts: prev.ghosts.map((g) => ({ ...g })) };
  s.elapsed += dt;

  const want = input.up ? 0 : input.left ? 1 : input.down ? 2 : input.right ? 3 : -1;
  if (want >= 0) s.pac.want = want;

  if (s.pause > 0) {
    s.pause = Math.max(0, s.pause - dt);
    return applyLimits(s);
  }

  if (s.fright > 0) {
    s.fright = Math.max(0, s.fright - dt);
    if (s.fright === 0) for (const g of s.ghosts) g.scared = false;
  }
  movePac(s, dt);
  s.ghosts.forEach((_, i) => moveGhost(s, i, dt));

  // Collisions in continuous space.
  const pp = posOf(s.pac);
  for (const g of s.ghosts) {
    const gp = posOf(g);
    if (Math.hypot(gp.x - pp.x, gp.y - pp.y) > 0.7) continue;
    if (g.scared) {
      s.score += 200;
      Object.assign(g, { x: g.homeX, y: g.homeY, dir: -1, t: 0, scared: false });
    } else {
      s.lives -= 1;
      if (s.lives <= 0) {
        s.over = true;
        s.reason = 'caught';
      } else {
        Object.assign(s, actors());
        s.pause = DEATH_PAUSE;
      }
      break;
    }
  }
  if (!s.over && s.left === 0) {
    s.over = true;
    s.reason = 'cleared';
  }
  return applyLimits(s);
}
