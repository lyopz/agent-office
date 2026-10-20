import { memo, useEffect, useState } from 'react';
import { useStore } from '../store/store';
import { AgentBall, BallDefs, ballColor, moodFor } from '../brain/Ball';
import type { AgentStatus, Rect, ViewMode } from '../model/types';
import { useShallow } from 'zustand/react/shallow';
import { assetStore } from '../persistence/repository';
import { G } from './OfficeLayers';
import { CAPSULE_LINGER, capsulePos } from '../engine/tubes';
import { tubeDepth } from './TubeLayers';

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

interface SpriteRt { x: number; y: number; status: AgentStatus; heading: 'left' | 'right' | 'up' | 'down'; tube: number }

/** An agent on the floor plan: a ball that rolls between rooms, with the face showing what it's doing. */
const AgentSprite = memo(function AgentSprite({ id, simple }: { id: string; simple: boolean }) {
  const agent = useStore((s) => s.doc.agents[id]);
  // subscribe to the few runtime fields we draw, so idle agents don't re-render every tick
  const rt = useStore(useShallow((s): SpriteRt | null => {
    const r = s.runtime.agents[id];
    if (!r) return null;
    // bubble campus: outside a room the agent rides a transport tube; depth eases them in and out at the ends
    const tube = s.doc.settings.layoutPreset === 'bubble' && !r.roomId ? Math.round(tubeDepth(s.doc.rooms, r.pos) * 8) / 8 : 0;
    return { x: r.pos.x, y: r.pos.y, status: r.status, heading: r.heading, tube };
  }));
  const speed = useStore((s) => s.prefs.simSpeed);
  const selected = useStore((s) => s.selection.kind === 'agent' && s.selection.id === id);
  const labels = useStore((s) => s.layers.labels);
  if (!agent || !rt) return null;
  const a = agent.appearance;
  const cx = (rt.x + 0.5) * G, cy = (rt.y + 0.5) * G;
  const col = STATUS_COLOR[rt.status];
  const paused = rt.status === 'paused';
  // walking agents glide between simulation ticks instead of jumping cell to cell
  const glide = rt.status === 'walking' ? { transition: `transform ${Math.round(100 / speed)}ms linear` } : undefined;
  const r = G * 0.4;
  if (simple) {
    return (
      <g data-kind="agent" data-id={id} className={`agent simple${paused ? ' paused' : ''}`} style={{ cursor: 'pointer', transform: `translate(${cx}px, ${cy}px)`, ...glide }}>
        <circle r={r} fill={ballColor(a)} stroke={selected ? 'var(--accent)' : col} strokeWidth={selected ? 3 : 1.5} />
        {labels && <text y={G * 0.85} textAnchor="middle" className="agent-label" fill={col}>{agent.identity.name}</text>}
      </g>
    );
  }
  const pod = rt.tube;
  // a rolling ball rocks a little as it travels
  const roll = rt.status === 'walking' ? ((rt.x + rt.y) * 120) % 360 : 0;
  return (
    <g data-kind="agent" data-id={id} className={`agent ball${agent.enabled ? '' : ' disabled'}${paused ? ' paused' : ''}${pod ? ' in-tube' : ''} s-${rt.status}`} style={{ cursor: 'pointer', transform: `translate(${cx}px, ${cy}px)`, ...glide }}>
      {pod > 0 && <circle r={r + 6} fill="rgba(160,235,255,.10)" stroke="url(#bubble-iris)" strokeWidth={1.6} opacity={pod} pointerEvents="none" />}
      <g className="ball-bob" transform={pod ? `scale(${1 - pod * 0.3})` : undefined}>
        <g transform={roll ? `rotate(${roll * 0.08})` : undefined}>
          <AgentBall a={a} r={r} mood={moodFor(rt.status, a.expression ?? 'smile')} defsId="floor-ball" ring={col} selected={selected} />
        </g>
      </g>
      {(rt.status === 'error' || paused) && (
        <g transform={`translate(${r * 0.9} ${-r - 6})`}>
          <rect x={-2} y={-12} width={rt.status === 'error' ? 14 : 20} height={14} rx={4} fill="var(--label-bg)" stroke={col} />
          <text x={rt.status === 'error' ? 5 : 8} y={-1.5} textAnchor="middle" className="bubble" fill={col}>{rt.status === 'error' ? '!' : 'II'}</text>
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
  return <g><BallDefs id="floor-ball" />{order.map((id) => <AgentSprite key={id} id={id} simple={simple} />)}</g>;
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
