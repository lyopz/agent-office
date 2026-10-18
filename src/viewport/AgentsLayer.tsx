import { memo, useEffect, useState } from 'react';
import { useStore } from '../store/store';
import { Character } from '../characters/Character';
import type { AgentStatus, ViewMode } from '../model/types';
import { assetStore } from '../persistence/repository';
import { G } from './OfficeLayers';

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

const AgentSprite = memo(function AgentSprite({ id }: { id: string }) {
  const agent = useStore((s) => s.doc.agents[id]);
  const rt = useStore((s) => s.runtime.agents[id]);
  const tick = useStore((s) => s.runtime.tick);
  const global = useStore((s) => s.view);
  const selected = useStore((s) => s.selection.kind === 'agent' && s.selection.id === id);
  const labels = useStore((s) => s.layers.labels);
  const view = agent ? resolveView(global, agent.appearance.preferredView) : 'top';
  const asset = useAsset(agent?.assets[view]?.assetId);
  const [facing, setFacing] = useState<'left' | 'right'>(agent?.appearance.facing ?? 'right');
  useEffect(() => { if (rt?.heading === 'left' || rt?.heading === 'right') setFacing(rt.heading); }, [rt?.heading]);
  if (!agent || !rt) return null;
  const a = agent.appearance;
  const cx = (rt.pos.x + 0.5) * G, cy = (rt.pos.y + 0.5) * G;
  const pose = rt.status === 'walking' ? 'walk' : rt.status === 'working' ? 'work' : 'idle';
  const frame = Math.floor((tick * a.animationSpeed) / 2) % 4;
  const top = view === 'top';
  const size = top ? G * 1.7 : G * 2.7 * a.height;
  const width = top ? size : size * 0.625;
  const tx = cx - width / 2, ty = top ? cy - size / 2 : cy + G * 0.45 - size;
  const col = STATUS_COLOR[rt.status];
  // a working agent at a desk faces the desk; in front view show their back-free working pose
  const heading = rt.status === 'working' ? 'up' : rt.heading;
  return (
    <g data-kind="agent" data-id={id} className={`agent${agent.enabled ? '' : ' disabled'}`} style={{ cursor: 'pointer' }}>
      <ellipse cx={cx} cy={cy + (top ? 0 : G * 0.4)} rx={G * 0.62} ry={G * (top ? 0.62 : 0.24)} fill="none" stroke={col} strokeWidth={selected ? 3 : 1.5} opacity={selected ? 1 : 0.8} filter={selected ? 'url(#glow)' : undefined} />
      <g transform={`translate(${tx} ${ty})`}>
        {asset
          ? <image href={asset} width={width} height={size} preserveAspectRatio="xMidYMax meet" />
          : <Character a={a} view={view} pose={pose} frame={frame} facing={facing} heading={heading} size={size} title={agent.identity.name} />}
      </g>
      {asset === null && agent.assets[view] && <text x={cx} y={ty - 2} textAnchor="middle" className="tag">fallback</text>}
      {(rt.status === 'thinking' || rt.status === 'communicating' || rt.status === 'error') && (
        <g transform={`translate(${cx + G * 0.4} ${ty - 6})`}>
          <rect x={-2} y={-12} width={rt.status === 'error' ? 14 : 20} height={14} rx={4} fill="rgba(0,0,0,.8)" stroke={col} />
          <text x={rt.status === 'error' ? 5 : 8} y={-1.5} textAnchor="middle" className="bubble" fill={col}>{rt.status === 'error' ? '!' : rt.status === 'thinking' ? '···' : '⇄'}</text>
        </g>
      )}
      {labels && (
        <g pointerEvents="none">
          <rect x={cx - agent.identity.name.length * 3.4 - 5} y={cy + G * 0.62} width={agent.identity.name.length * 6.8 + 10} height={13} rx={2} fill="rgba(0,0,0,.75)" stroke={col} strokeOpacity={0.7} />
          <text x={cx} y={cy + G * 0.62 + 10} textAnchor="middle" className="agent-label" fill={col}>{agent.identity.name}</text>
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

export function AgentsLayer() {
  const ids = useStore((s) => Object.keys(s.doc.agents).join('|'));
  const order = useStore((s) => s.runtime.agents);
  // draw back-to-front so standing characters overlap correctly
  const sorted = ids ? ids.split('|').sort((a, b) => (order[a]?.pos.y ?? 0) - (order[b]?.pos.y ?? 0)) : [];
  return <g>{sorted.map((id) => <AgentSprite key={id} id={id} />)}</g>;
}
