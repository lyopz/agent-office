import { useCallback, useEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { GAME_META } from './types';
import type { EndReason, GameId, Input } from './types';
import type { GameState } from './session';
import * as flappy from './flappy';
import * as pong from './pong';
import * as pacman from './pacman';

type SessionEnd = { game: GameId; score: number; durationSec: number; result: EndReason | 'abandoned' };

const SCALE = 2; // canvas backing-store pixels per logical unit

const SIZE: Record<GameId, { w: number; h: number }> = {
  flappy: { w: flappy.W, h: flappy.H },
  pong: { w: pong.W, h: pong.H },
  pacman: { w: pacman.COLS * pacman.TILE, h: pacman.ROWS * pacman.TILE },
};
const DIR_KEYS: Record<string, Input> = {
  ArrowUp: { up: true },
  ArrowLeft: { left: true },
  ArrowDown: { down: true },
  ArrowRight: { right: true },
};

const REASON_TEXT: Record<EndReason, string> = {
  crash: 'crashed',
  caught: 'caught by a ghost',
  cleared: 'maze cleared!',
  win: 'you win!',
  lose: 'the CPU wins',
  'score-cap': 'score cap reached',
  'time-limit': 'time limit reached',
};

// Human play only: no score caps or time limits (Pong is still first to 11).
function initGame(game: GameId, seed: number): GameState {
  if (game === 'flappy') return flappy.init(seed, undefined);
  if (game === 'pong') return pong.init(seed, undefined);
  return pacman.init(seed, undefined);
}

function stepGame(game: GameId, s: GameState, input: Input, dt: number): GameState {
  if (game === 'flappy') return flappy.step(s as flappy.FlappyState, input, dt);
  if (game === 'pong') return pong.step(s as pong.PongState, input, dt);
  return pacman.step(s as pacman.PacState, input, dt);
}

function drawFlappy(ctx: CanvasRenderingContext2D, s: flappy.FlappyState) {
  ctx.fillStyle = '#4ec0ca';
  ctx.fillRect(0, 0, s.w, s.h);
  ctx.fillStyle = '#73bf2e';
  for (const p of s.pipes) {
    ctx.fillRect(p.x, 0, flappy.PIPE_W, p.gapY - flappy.GAP / 2);
    ctx.fillRect(p.x, p.gapY + flappy.GAP / 2, flappy.PIPE_W, s.h);
  }
  ctx.fillStyle = '#ded895';
  ctx.fillRect(0, s.h - flappy.GROUND, s.w, flappy.GROUND);
  ctx.fillStyle = '#f8d020';
  ctx.beginPath();
  ctx.arc(flappy.BIRD_X, s.y, flappy.R, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#fff';
  ctx.font = 'bold 32px monospace';
  ctx.textAlign = 'center';
  ctx.fillText(String(s.score), s.w / 2, 60);
  if (!s.started) {
    ctx.font = '14px monospace';
    ctx.fillText('Press Space to start', s.w / 2, s.h / 2 + 40);
  }
}

function drawPong(ctx: CanvasRenderingContext2D, s: pong.PongState) {
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, s.w, s.h);
  ctx.fillStyle = '#fff';
  for (let y = 0; y < s.h; y += 16) ctx.fillRect(s.w / 2 - 1, y, 2, 8);
  ctx.fillRect(pong.PX, s.py, pong.PW, pong.PH);
  ctx.fillRect(pong.CX, s.cy, pong.PW, pong.PH);
  ctx.fillRect(s.bx - pong.BR, s.by - pong.BR, pong.BR * 2, pong.BR * 2);
  ctx.font = 'bold 28px monospace';
  ctx.textAlign = 'center';
  ctx.fillText(String(s.score), s.w / 4, 40);
  ctx.fillText(String(s.cpu), (s.w * 3) / 4, 40);
}

const GHOST_COLORS = ['#ff0000', '#ffb8ff', '#ffb852', '#00ffff'];

function drawPacman(ctx: CanvasRenderingContext2D, s: pacman.PacState) {
  const T = pacman.TILE;
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, s.w, s.h);
  for (let y = 0; y < pacman.ROWS; y++) {
    for (let x = 0; x < pacman.COLS; x++) {
      if (pacman.isWall(x, y)) {
        ctx.fillStyle = '#2121de';
        ctx.fillRect(x * T + 1, y * T + 1, T - 2, T - 2);
        continue;
      }
      const p = s.pellets[y * pacman.COLS + x];
      if (!p) continue;
      ctx.fillStyle = '#ffb897';
      ctx.beginPath();
      ctx.arc(x * T + T / 2, y * T + T / 2, p === 2 ? 4 : 1.8, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  const pp = pacman.posOf(s.pac);
  const facing = [-Math.PI / 2, Math.PI, Math.PI / 2, 0][s.pac.dir] ?? 0;
  const mouth = 0.25 + 0.2 * Math.abs(Math.sin(s.elapsed * 12));
  ctx.fillStyle = '#ffff00';
  ctx.beginPath();
  ctx.moveTo(pp.x * T + T / 2, pp.y * T + T / 2);
  ctx.arc(pp.x * T + T / 2, pp.y * T + T / 2, T / 2 - 1, facing + mouth, facing - mouth + Math.PI * 2);
  ctx.fill();
  s.ghosts.forEach((g, i) => {
    const gp = pacman.posOf(g);
    const cx = gp.x * T + T / 2;
    const cy = gp.y * T + T / 2;
    ctx.fillStyle = g.scared ? (s.fright < 2 && Math.floor(s.elapsed * 6) % 2 ? '#fff' : '#2121ff') : GHOST_COLORS[i % 4];
    ctx.beginPath();
    ctx.arc(cx, cy - 1, T / 2 - 1, Math.PI, 0);
    ctx.lineTo(cx + T / 2 - 1, cy + T / 2 - 1);
    ctx.lineTo(cx - T / 2 + 1, cy + T / 2 - 1);
    ctx.fill();
  });
  ctx.fillStyle = '#ffff00';
  for (let i = 0; i < s.lives; i++) ctx.fillRect(4 + i * 10, s.h - 6, 6, 4);
}

function draw(game: GameId, ctx: CanvasRenderingContext2D, s: GameState) {
  ctx.setTransform(SCALE, 0, 0, SCALE, 0, 0);
  if (game === 'flappy') drawFlappy(ctx, s as flappy.FlappyState);
  else if (game === 'pong') drawPong(ctx, s as pong.PongState);
  else drawPacman(ctx, s as pacman.PacState);
}

const CAPTURED = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', ' ', 'Spacebar']);

export function ArcadeModal({
  game,
  onClose,
  onSessionEnd,
}: {
  game: GameId;
  onClose: () => void;
  onSessionEnd?: (s: SessionEnd) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const [first] = useState(() => initGame(game, Date.now()));
  const stateRef = useRef<GameState>(first);
  const reportedRef = useRef(false);
  const keysRef = useRef<Input>({});
  const flapRef = useRef(false);
  const lastDirRef = useRef<string | null>(null);
  const endRef = useRef(onSessionEnd);
  endRef.current = onSessionEnd;
  const [score, setScore] = useState(0);
  const [over, setOver] = useState<EndReason | null>(null);

  // Report the current session once: its end reason, or 'abandoned' if it was in progress.
  const report = useCallback(
    (s: GameState) => {
      if (reportedRef.current) return;
      if (!s.over && s.elapsed <= 0) return;
      reportedRef.current = true;
      endRef.current?.({
        game,
        score: s.score,
        durationSec: Math.round(s.elapsed * 10) / 10,
        result: s.over && s.reason ? s.reason : 'abandoned',
      });
    },
    [game],
  );

  const restart = useCallback(() => {
    report(stateRef.current);
    stateRef.current = initGame(game, Date.now());
    reportedRef.current = false;
    flapRef.current = false;
    setScore(0);
    setOver(null);
    canvasRef.current?.focus();
  }, [game, report]);

  const close = useCallback(() => {
    report(stateRef.current);
    onClose();
  }, [onClose, report]);

  // New game when the game id changes; abandoned report on unmount.
  useEffect(() => {
    stateRef.current = initGame(game, Date.now());
    reportedRef.current = false;
    setScore(0);
    setOver(null);
    return () => report(stateRef.current);
  }, [game, report]);

  useEffect(() => {
    (canvasRef.current ?? dialogRef.current)?.focus();
  }, []);

  // Keyboard: held directions, flap as a press edge, Escape closes.
  useEffect(() => {
    const set = (e: KeyboardEvent, down: boolean) => {
      const k = keysRef.current;
      if (e.key === 'ArrowUp' || e.key === 'w' || e.key === 'W') k.up = down;
      else if (e.key === 'ArrowDown' || e.key === 's' || e.key === 'S') k.down = down;
      else if (e.key === 'ArrowLeft') k.left = down;
      else if (e.key === 'ArrowRight') k.right = down;
      if (e.key in DIR_KEYS) {
        if (down) lastDirRef.current = e.key;
        else if (lastDirRef.current === e.key) lastDirRef.current = null;
      }
      if (down && !e.repeat && (e.key === ' ' || e.key === 'Spacebar' || e.key === 'ArrowUp')) flapRef.current = true;
    };
    const onDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        close();
        return;
      }
      if (CAPTURED.has(e.key)) e.preventDefault();
      set(e, true);
    };
    const onUp = (e: KeyboardEvent) => {
      if (CAPTURED.has(e.key)) e.preventDefault();
      set(e, false);
    };
    window.addEventListener('keydown', onDown);
    window.addEventListener('keyup', onUp);
    return () => {
      window.removeEventListener('keydown', onDown);
      window.removeEventListener('keyup', onUp);
    };
  }, [close]);

  // Animation loop: step the pure logic with real dt, then draw.
  useEffect(() => {
    let raf = 0;
    let last = performance.now();
    const frame = (now: number) => {
      const dt = (now - last) / 1000;
      last = now;
      const prev = stateRef.current;
      if (!prev.over) {
        // Pac-Man steers by the most recently pressed arrow; the others read held keys.
        const dirKey = lastDirRef.current;
        const held = game === 'pacman' ? (dirKey ? DIR_KEYS[dirKey] : {}) : keysRef.current;
        const input: Input = { ...held, flap: flapRef.current };
        flapRef.current = false;
        const next = stepGame(game, prev, input, dt);
        stateRef.current = next;
        if (next.score !== prev.score) setScore(next.score);
        if (next.over) {
          setOver(next.reason);
          report(next);
        }
      }
      const ctx = canvasRef.current?.getContext('2d');
      if (ctx) draw(game, ctx, stateRef.current);
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [game, report]);

  const meta = GAME_META[game];
  const { w, h } = SIZE[game];
  const btn: CSSProperties = {
    background: '#2a2f3a',
    color: '#e8ecf3',
    border: '1px solid #444b5a',
    borderRadius: 6,
    padding: '6px 14px',
    cursor: 'pointer',
    font: 'inherit',
  };

  return (
    <div
      className="arcade-overlay"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 1000,
        background: 'rgba(0,0,0,0.6)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 16,
      }}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) close();
      }}
    >
      <div
        ref={dialogRef}
        className="arcade-panel"
        role="dialog"
        aria-modal="true"
        aria-label={meta.title}
        tabIndex={-1}
        style={{
          background: '#14161c',
          color: '#e8ecf3',
          borderRadius: 12,
          padding: 16,
          maxWidth: '100%',
          maxHeight: '100%',
          display: 'flex',
          flexDirection: 'column',
          gap: 10,
          boxShadow: '0 12px 40px rgba(0,0,0,0.5)',
          fontFamily: 'system-ui, sans-serif',
        }}
      >
        <div className="arcade-header" style={{ display: 'flex', alignItems: 'baseline', gap: 12 }}>
          <h2 className="arcade-title" style={{ margin: 0, fontSize: 18, flex: 1 }}>
            {meta.title}
          </h2>
          <span className="arcade-score" style={{ fontVariantNumeric: 'tabular-nums' }}>
            Score: {score}
          </span>
        </div>
        <div className="arcade-stage" style={{ position: 'relative', alignSelf: 'center' }}>
          <canvas
            ref={canvasRef}
            className="arcade-canvas"
            width={w * SCALE}
            height={h * SCALE}
            tabIndex={0}
            style={{
              display: 'block',
              width: `min(${w * 1.5}px, 86vw, calc((80vh - 120px) * ${w / h}))`,
              aspectRatio: `${w} / ${h}`,
              imageRendering: 'pixelated',
              outline: 'none',
              borderRadius: 4,
            }}
          />
          {over && (
            <div
              className="arcade-gameover"
              style={{
                position: 'absolute',
                inset: 0,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 12,
                background: 'rgba(0,0,0,0.65)',
                borderRadius: 4,
              }}
            >
              <div style={{ fontSize: 20, fontWeight: 700 }}>Game over — {REASON_TEXT[over]}</div>
              <button type="button" className="arcade-btn" style={btn} onClick={restart}>
                Restart
              </button>
            </div>
          )}
        </div>
        <div className="arcade-footer" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span className="arcade-hint" style={{ flex: 1, fontSize: 12, opacity: 0.75 }}>
            {meta.controls} · Esc to close
          </span>
          <button type="button" className="arcade-btn" style={btn} onClick={restart}>
            Restart
          </button>
          <button type="button" className="arcade-btn" style={btn} onClick={close}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
