import { memo, useEffect, useMemo, useState } from 'react';
import { useStore } from '../store/store';
import { Character } from '../characters/Character';
import type { AgentStatus, Rect, ViewMode } from '../model/types';
import { useShallow } from 'zustand/react/shallow';
import { assetStore } from '../persistence/repository';
import { G } from './OfficeLayers';
import { CAPSULE_LINGER, capsulePos } from '../engine/tubes';
import { tubeDepth } from './TubeLayers';
import { SPRITE_FRAMES, SPRITE_H, SPRITE_W, bundledSprite, frameFor, lookKey, useSpriteLibrary } from '../characters/sprites';

/** The Blender sprite sheet for this exact look, if one exists and rendered characters are on. */
function useSpriteSheet(a: Parameters<typeof lookKey>[0] | undefined, enabled: boolean) {
  const key = useMemo(() => (a && enabled ? lookKey(a) : null), [a, enabled]);
  const imported = useSpriteLibrary((s) => (key ? s.imported.has(key) : false));
  const stored = useAsset(key && imported && !bundledSprite(key) ? `sprite_${key}` : null);
  return key ? bundledSprite(key) ?? stored : null;
}

export const STATUS_COLOR: Record<AgentStatus, string> = {
  idle: 'var(--muted)', working: 'var(--accent)', walking: 'var(--accent-blue)', thinking: 'var(--accent-purple)',
  communicating: 'var(--accent-orange)', researching: 'var(--accent-blue)', waiting: 'var(--warn)', blocked: 'var(--danger)', error: 'var(--danger)', paused: 'var(--muted-2)',
};

export function useAsset(assetId: string | undefined | null) {
  const [url, setUrl] = useState<string | null>(assetId ? assetStore.peek(assetId) : null);
  useEffect(() => {
    let live = true;
    if (!assetId) { setUrl(null); return; }
    assetStore.get(assetId).then((u) => { if (live) setUrl(u); });
    return () => { live = false; };
  }, [assetId]);
  return url;
}

export function resolveView(global: string, preferred: ViewMode): Exclude<ViewMode, 'portrait'> {
  const v = global === 'auto' ? preferred : (global as ViewMode);
  return v === 'portrait' ? 'front' : v;
}

interface SpriteRt { x: number; y: number; status: AgentStatus; heading: 'left' | 'right' | 'up' | 'down'; atDesk: boolean; tube: number }

const AgentSprite = memo(function AgentSprite({ id, simple }: { id: string; simple: boolean }) {
  const agent = useStore((s) => s.doc.agents[id]);
  // subscribe to the few runtime fields we draw, so idle agents don't re-render every tick
  const rt = useStore(useShallow((s): SpriteRt | null => {
    const r = s.runtime.agents[id];
    if (!r) return null;
    // bubble campus: outside a room the agent rides a transport tube; depth eases them in and out at the ends
    const tube = s.doc.settings.layoutPreset === 'bubble' && !r.roomId ? Math.round(tubeDepth(s.doc.rooms, r.pos) * 8) / 8 : 0;
    return { x: r.pos.x, y: r.pos.y, status: r.status, heading: r.heading, atDesk: r.status === 'working' && !!r.currentTaskId && !!s.runtime.tasks[r.currentTaskId]?.destination.workstationId, tube };
  }));
  const motion = useStore((s) => s.doc.settings.animationIntensity);
  const speed = useStore((s) => s.prefs.simSpeed);
  const animating = !!rt && motion !== 'off' && !simple && (rt.status === 'walking' || rt.status === 'working' || rt.status === 'communicating');
  const tick = useStore((s) => (animating ? s.runtime.tick : 0));
  const global = useStore((s) => s.view);
  const selected = useStore((s) => s.selection.kind === 'agent' && s.selection.id === id);
  const labels = useStore((s) => s.layers.labels);
  const view = agent ? resolveView(global, agent.appearance.preferredView) : 'top';
  const asset = useAsset(simple ? null : agent?.assets[view]?.assetId);
  const rendered = useStore((s) => (s.prefs.characterStyle ?? 'rendered') === 'rendered');
  // rendered sprites are 3/4 views; they replace the per-agent default, but an explicit top-down view stays drawn
  const sheet = useSpriteSheet(agent?.appearance, rendered && !simple && global !== 'top');
  const [facing, setFacing] = useState<'left' | 'right'>(agent?.appearance.facing ?? 'right');
  const [turning, setTurning] = useState(false);
  useEffect(() => {
    if (rt?.heading !== 'left' && rt?.heading !== 'right') return;
    setFacing((f) => { if (f !== rt.heading) { setTurning(true); setTimeout(() => setTurning(false), 160); } return rt.heading as 'left' | 'right'; });
  }, [rt?.heading]);
  if (!agent || !rt) return null;
  const a = agent.appearance;
  const cx = (rt.x + 0.5) * G, cy = (rt.y + 0.5) * G;
  const col = STATUS_COLOR[rt.status];
  const paused = rt.status === 'paused';
  // walking agents glide between simulation ticks instead of jumping cell to cell
  const glide = rt.status === 'walking' ? { transition: `transform ${Math.round(100 / speed)}ms linear` } : undefined;
  if (simple) {
    return (
      <g data-kind="agent" data-id={id} className={`agent simple${paused ? ' paused' : ''}`} style={{ cursor: 'pointer', transform: `translate(${cx}px, ${cy}px)`, ...glide }}>
        <circle r={G * 0.38} fill={a.topColor} stroke={selected ? 'var(--accent)' : col} strokeWidth={selected ? 3 : 1.5} />
        <circle r={G * 0.16} cy={-G * 0.05} fill={a.skinTone} />
        {labels && <text y={G * 0.85} textAnchor="middle" className="agent-label" fill={col}>{agent.identity.name}</text>}
      </g>
    );
  }
  const pose = rt.status === 'walking' ? 'walk' : rt.status === 'working' ? (rt.atDesk && view !== 'top' ? 'sit' : 'work') : rt.status === 'communicating' ? 'talk' : 'idle';
  const frame = !animating ? 0 : Math.floor((tick * a.animationSpeed) / (motion === 'subtle' ? 4 : 2)) % 4;
  const top = view === 'top' && !sheet;
  const shownView = turning && (view === 'side' || view === 'three-quarter') ? 'front' : view;
  const size = top ? G * 1.7 : G * 2.7 * a.height;
  const width = top ? size : size * 0.625;
  const tx = -width / 2, ty = top ? -size / 2 : G * 0.45 - size;
  // a working agent at a desk faces the desk
  const heading = rt.status === 'working' ? 'up' : rt.heading;
  // in a tube the agent is drawn into a travel pod: shrunk a little and wrapped in glass
  const pod = rt.tube;
  const shrink = 1 - pod * 0.38;
  const horiz = rt.heading === 'left' || rt.heading === 'right';
  return (
    <g data-kind="agent" data-id={id} className={`agent${agent.enabled ? '' : ' disabled'}${paused ? ' paused' : ''}${pod ? ' in-tube' : ''}`} style={{ cursor: 'pointer', transform: `translate(${cx}px, ${cy}px)`, ...glide }}>
      {pod > 0 && (
        <g className="tube-pod" opacity={pod} pointerEvents="none">
          {rt.status === 'walking' && [0, 1, 2].map((i) => {
            const back = rt.heading === 'right' ? -1 : rt.heading === 'left' ? 1 : 0, up = rt.heading === 'down' ? -1 : rt.heading === 'up' ? 1 : 0;
            const o = (i - 1) * 5;
            return <line key={i} className="pod-streak" x1={back * G * 0.6 + (horiz ? 0 : o)} y1={up * G * 0.6 + (horiz ? o : 0)} x2={back * G * (1.1 + i * 0.15) + (horiz ? 0 : o)} y2={up * G * (1.1 + i * 0.15) + (horiz ? o : 0)} stroke="#bff6ff" strokeOpacity={0.55} strokeWidth={1.5} strokeLinecap="round" />;
          })}
          <ellipse cx={0} cy={top ? 0 : -G * 0.25} rx={G * 0.62} ry={top ? G * 0.62 : G * 0.95} fill="rgba(160,235,255,.10)" stroke="url(#bubble-iris)" strokeWidth={1.6} />
          <path d={`M${-G * 0.35},${(top ? 0 : -G * 0.25) - G * 0.45} q${G * 0.15},${-G * 0.2} ${G * 0.4},${-G * 0.22}`} fill="none" stroke="#fff" strokeOpacity={0.5} strokeWidth={1.5} strokeLinecap="round" />
        </g>
      )}
      <g transform={pod ? `translate(0 ${top ? 0 : G * 0.4}) scale(${shrink}) translate(0 ${top ? 0 : -G * 0.4})` : undefined}>
      <ellipse cx={0} cy={top ? 0 : G * 0.4} rx={G * 0.62} ry={G * (top ? 0.62 : 0.24)} fill="none" stroke={col} strokeWidth={selected ? 3 : 1.5} opacity={selected ? 1 : 0.8} filter={selected ? 'url(#glow)' : undefined} />
      <g transform={`translate(${tx} ${ty})`}>
        {asset
          ? <image href={asset} width={width} height={size} preserveAspectRatio="xMidYMax meet" />
          : sheet
          ? <SpriteFrameImage sheet={sheet} frame={frameFor(paused ? 'idle' : rt.status, rt.atDesk, frame)} flip={facing === 'left' && !(rt.status === 'working' && rt.atDesk)} size={size} label={agent.identity.name} />
          : <Character a={a} view={shownView} pose={pose} frame={frame} facing={facing} heading={heading} size={size} title={agent.identity.name} />}
      </g>
      </g>
      {asset === null && agent.assets[view] && <text x={0} y={ty - 2} textAnchor="middle" className="tag">fallback</text>}
      {(rt.status === 'thinking' || rt.status === 'communicating' || rt.status === 'error' || paused) && (
        <g transform={`translate(${G * 0.4} ${ty - 6})`}>
          <rect x={-2} y={-12} width={rt.status === 'error' ? 14 : 20} height={14} rx={4} fill="var(--label-bg)" stroke={col} />
          <text x={rt.status === 'error' ? 5 : 8} y={-1.5} textAnchor="middle" className="bubble" fill={col}>{rt.status === 'error' ? '!' : paused ? 'II' : rt.status === 'thinking' ? '···' : '⇄'}</text>
        </g>
      )}
      {labels && (
        <g pointerEvents="none">
          <rect x={-agent.identity.name.length * 3.4 - 5} y={G * 0.62} width={agent.identity.name.length * 6.8 + 10} height={13} rx={2} fill="var(--label-bg)" stroke={col} strokeOpacity={0.7} />
          <text x={0} y={G * 0.62 + 10} textAnchor="middle" className="agent-label" fill={col}>{agent.identity.name}</text>
        </g>
      )}
    </g>
  );
});

/** One frame of a Blender sprite strip, scaled to the character's height and mirrored when facing left. */
function SpriteFrameImage({ sheet, frame, flip, size, label }: { sheet: string; frame: (typeof SPRITE_FRAMES)[number]; flip: boolean; size: number; label: string }) {
  const i = SPRITE_FRAMES.indexOf(frame);
  // the strip's frames leave headroom above the head; scale so the figure matches the drawn character's height
  const h = size * 1.22, w = h * (SPRITE_W / SPRITE_H);
  const x = (size * 0.625 - w) / 2, y = size - h;
  return (
    <svg x={x} y={y} width={w} height={h} viewBox={`${i * SPRITE_W} 0 ${SPRITE_W} ${SPRITE_H}`} overflow="hidden" role="img" aria-label={`${label}, rendered`}>
      <g transform={flip ? `translate(${(2 * i + 1) * SPRITE_W} 0) scale(-1 1)` : undefined}>
        <image href={sheet} width={SPRITE_W * SPRITE_FRAMES.length} height={SPRITE_H} />
      </g>
    </svg>
  );
}

export function AgentPaths() {
  const agents = useStore((s) => s.runtime.agents);
  const doc = useStore((s) => s.doc);
  return (
    <g pointerEvents="none">
      {Object.entries(agents).filter(([, r]) => r.path.length).map(([id, r]) => (
        <polyline key={id} points={[r.pos, ...r.path].map((p) => `${(p.x + 0.5) * G},${(p.y + 0.5) * G}`).join(' ')}
          fill="none" stroke={doc.agents[id]?.appearance.accent ?? 'var(--accent)'} strokeWidth={2} strokeDasharray="4 5" opacity={0.75} />
      ))}
    </g>
  );
}

/**
 * Agents inside the visible area, back-to-front. Off-screen agents aren't drawn,
 * and when many are visible they switch to simple markers to stay responsive.
 */
export function AgentsLayer({ view }: { view: Rect }) {
  const order = useStore(useShallow((s) => {
    const out: string[] = [];
    for (const [id, r] of Object.entries(s.runtime.agents)) {
      if (!s.doc.agents[id]) continue;
      if (r.pos.x < view.x - 2 || r.pos.y < view.y - 3 || r.pos.x > view.x + view.w + 2 || r.pos.y > view.y + view.h + 2) continue;
      out.push(`${Math.round(r.pos.y * 4)}:${id}`);
    }
    return out.sort((a, b) => parseInt(a) - parseInt(b)).map((k) => k.slice(k.indexOf(':') + 1));
  }));
  const limit = useStore((s) => s.doc.control.simplifyAbove);
  const simple = limit > 0 && order.length > limit;
  return <g>{order.map((id) => <AgentSprite key={id} id={id} simple={simple} />)}</g>;
}

export function useSimplified(view: Rect) {
  const limit = useStore((s) => s.doc.control.simplifyAbove);
  const visible = useStore((s) => { let n = 0; for (const r of Object.values(s.runtime.agents)) if (r.pos.x >= view.x - 2 && r.pos.y >= view.y - 3 && r.pos.x <= view.x + view.w + 2 && r.pos.y <= view.y + view.h + 2) n++; return n; });
  return { simple: limit > 0 && visible > limit, visible, limit };
}

/** Work capsules on the mail network, then a brief delivery receipt where they land. */
export function CapsulesLayer() {
  const capsules = useStore((s) => s.runtime.capsules);
  const tick = useStore((s) => s.runtime.tick);
  const tasks = useStore((s) => s.runtime.tasks);
  const agents = useStore((s) => s.doc.agents);
  const list = Object.values(capsules);
  if (!list.length) return null;
  return (
    <g pointerEvents="none" className="capsules">
      {list.map((c) => {
        const p = capsulePos(c);
        const t = tasks[c.taskId];
        const who = c.recipientId ? agents[c.recipientId]?.identity.name ?? 'agent' : 'office';
        const urgent = t?.priority === 'critical' || t?.priority === 'high';
        if (c.status === 'delivered') {
          const age = tick - (c.deliveredTick ?? tick);
          const ok = c.acknowledged !== false;
          const text = ok ? `✓ Delivered · ${who}` : `! Not acknowledged · ${who}`;
          const w = text.length * 5.6 + 12;
          return (
            <g key={c.id} className="capsule-receipt" opacity={Math.max(0.2, 1 - age / CAPSULE_LINGER)} transform={`translate(${p.x * G} ${p.y * G - 16 - Math.min(age, 8)})`}>
              <rect x={-w / 2} y={-9} width={w} height={15} rx={7.5} fill="var(--label-bg)" stroke={ok ? 'var(--accent)' : 'var(--warn)'} />
              <text x={0} y={2} textAnchor="middle" className="bubble" fill={ok ? 'var(--accent)' : 'var(--warn)'}>{text}</text>
            </g>
          );
        }
        const ahead = c.path.slice(Math.floor(c.progress) + 1);
        return (
          <g key={c.id}>
            <title>{`Capsule: ${t?.name ?? 'work item'} → ${who} (in transit)`}</title>
            <polyline points={[p, ...ahead].map((q) => `${q.x * G},${q.y * G}`).join(' ')} fill="none" stroke="#ffd27a" strokeOpacity={0.7} strokeWidth={2} strokeDasharray="2 4" />
            <g transform={`translate(${p.x * G} ${p.y * G})`}>
              <rect x={-8} y={-5} width={16} height={10} rx={5} fill="#d4a84a" stroke="#6b4e12" filter="url(#glow)" />
              <path d="M-4,-2.5 h8 v5 h-8z M-4,-2.5 l4,3 l4,-3" fill="none" stroke="#3a2a08" strokeWidth={1} />
              {urgent && <rect x={-8} y={-5} width={3} height={10} rx={1.5} fill="var(--danger)" />}
              <text x={0} y={-8} textAnchor="middle" className="bubble" fill="#ffd27a">{who}</text>
            </g>
          </g>
        );
      })}
    </g>
  );
}
