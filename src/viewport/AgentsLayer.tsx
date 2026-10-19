import { memo, useEffect, useState } from 'react';
import { useStore } from '../store/store';
import { Character } from '../characters/Character';
import type { AgentStatus, Rect, ViewMode } from '../model/types';
import { useShallow } from 'zustand/react/shallow';
import { assetStore } from '../persistence/repository';
import { G } from './OfficeLayers';
import { capsulePos } from '../engine/tubes';

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

interface SpriteRt { x: number; y: number; status: AgentStatus; heading: 'left' | 'right' | 'up' | 'down'; atDesk: boolean }

const AgentSprite = memo(function AgentSprite({ id, simple }: { id: string; simple: boolean }) {
  const agent = useStore((s) => s.doc.agents[id]);
  // subscribe to the few runtime fields we draw, so idle agents don't re-render every tick
  const rt = useStore(useShallow((s): SpriteRt | null => {
    const r = s.runtime.agents[id];
    return r ? { x: r.pos.x, y: r.pos.y, status: r.status, heading: r.heading, atDesk: r.status === 'working' && !!r.currentTaskId && !!s.runtime.tasks[r.currentTaskId]?.destination.workstationId } : null;
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
  const top = view === 'top';
  const shownView = turning && (view === 'side' || view === 'three-quarter') ? 'front' : view;
  const size = top ? G * 1.7 : G * 2.7 * a.height;
  const width = top ? size : size * 0.625;
  const tx = -width / 2, ty = top ? -size / 2 : G * 0.45 - size;
  // a working agent at a desk faces the desk
  const heading = rt.status === 'working' ? 'up' : rt.heading;
  return (
    <g data-kind="agent" data-id={id} className={`agent${agent.enabled ? '' : ' disabled'}${paused ? ' paused' : ''}`} style={{ cursor: 'pointer', transform: `translate(${cx}px, ${cy}px)`, ...glide }}>
      <ellipse cx={0} cy={top ? 0 : G * 0.4} rx={G * 0.62} ry={G * (top ? 0.62 : 0.24)} fill="none" stroke={col} strokeWidth={selected ? 3 : 1.5} opacity={selected ? 1 : 0.8} filter={selected ? 'url(#glow)' : undefined} />
      <g transform={`translate(${tx} ${ty})`}>
        {asset
          ? <image href={asset} width={width} height={size} preserveAspectRatio="xMidYMax meet" />
          : <Character a={a} view={shownView} pose={pose} frame={frame} facing={facing} heading={heading} size={size} title={agent.identity.name} />}
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

/** Task capsules travelling through the pneumatic tube network. */
export function CapsulesLayer() {
  const capsules = useStore((s) => s.runtime.capsules);
  const list = Object.values(capsules).filter((c) => c.status === 'in-transit');
  if (!list.length) return null;
  return (
    <g pointerEvents="none" className="capsules">
      {list.map((c) => {
        const p = capsulePos(c);
        return (
          <g key={c.id}>
            <polyline points={c.path.map((q) => `${q.x * G},${q.y * G}`).join(' ')} fill="none" stroke="#d4a84a" strokeOpacity={0.35} strokeWidth={3} strokeDasharray="2 4" />
            <rect x={p.x * G - 6} y={p.y * G - 3.5} width={12} height={7} rx={3.5} fill="#d4a84a" stroke="#6b4e12" filter="url(#glow)" />
          </g>
        );
      })}
    </g>
  );
}
