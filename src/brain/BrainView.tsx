// The main screen: the whole operation drawn as a brain. Teams are lobes,
// agents are bouncing balls, links show who reports to whom and who handed
// work to whom. Finished work rolls into the knowledge core in the middle,
// which opens Graph POW.
import { memo, useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as RPointerEvent, type WheelEvent as RWheelEvent } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { Maximize, Minus, Plus } from 'lucide-react';
import { useStore } from '../store/store';
import type { AgentStatus, Appearance } from '../model/types';
import { STATUS_COLOR } from '../viewport/AgentsLayer';
import { AgentBall, BallDefs, ballColor, moodFor } from './Ball';
import { BALL_R, brainEdges, edgePath, layoutBrain, pointOnEdge, type BrainLayout, type Pt } from './brainLayout';
import { fireAgentGraph, openAgentGraphPow } from './agentGraph';
import '../styles/brain.css';

const DEFS = 'brain';
const FLIGHT_MS = 900;

interface Flight { id: string; from: Pt; to: Pt; look: Appearance; start: number; landOn: string | null; core: boolean }

/** Layout depends only on who is in which team and who reports to whom, so balls stay put as work moves. */
function useLayout(): BrainLayout {
  const agents = useStore((s) => s.doc.agents);
  const departments = useStore((s) => s.doc.departments);
  return useMemo(() => layoutBrain({ agents, departments } as Parameters<typeof layoutBrain>[0], null), [agents, departments]);
}

function useEdges() {
  // re-derive only when the set of handoffs (or whether they're moving) changes
  const key = useStore((s) => Object.values(s.runtime.tasks).filter((t) => t.handoff?.fromAgentId && t.agentId).map((t) => `${t.handoff!.fromAgentId}>${t.agentId}:${t.status === 'done' || t.status === 'cancelled' || t.status === 'failed' ? 0 : 1}`).sort().join(','));
  const agents = useStore((s) => s.doc.agents);
  return useMemo(() => brainEdges({ agents } as Parameters<typeof brainEdges>[0], useStore.getState().runtime), [key, agents]); // eslint-disable-line react-hooks/exhaustive-deps
}

/** Watches tasks: a finished task bounces its agent and rolls into the core; a handoff rolls a ball to the receiver. */
function useFlights(layout: BrainLayout) {
  const [flights, setFlights] = useState<Flight[]>([]);
  const [bounce, setBounce] = useState<Record<string, number>>({});
  const layoutRef = useRef(layout);
  layoutRef.current = layout;
  useEffect(() => {
    let prev = useStore.getState().runtime.tasks;
    return useStore.subscribe((s) => {
      const tasks = s.runtime.tasks;
      if (tasks === prev) return;
      const L = layoutRef.current;
      const now = performance.now();
      const add: Flight[] = [];
      const hop: string[] = [];
      for (const t of Object.values(tasks)) {
        const was = prev[t.id];
        if (was?.status === t.status) continue;
        const who = t.agentId ? L.nodes[t.agentId] : null;
        const agent = t.agentId ? s.doc.agents[t.agentId] : null;
        if (t.status === 'done' && who && agent) {
          hop.push(agent.id);
          add.push({ id: `${t.id}:done`, from: who, to: L.core, look: agent.appearance, start: now + 260, landOn: null, core: true });
          fireAgentGraph(agent.id);
        }
        const from = t.handoff?.fromAgentId;
        if (from && from !== t.agentId && (!was || t.status === 'in-transit') && t.status !== 'done' && L.nodes[from] && who) {
          const sender = s.doc.agents[from];
          if (sender) add.push({ id: `${t.id}:hand`, from: L.nodes[from], to: who, look: sender.appearance, start: now, landOn: t.agentId, core: false });
        }
      }
      prev = tasks;
      if (add.length) setFlights((f) => [...f.filter((x) => now - x.start < FLIGHT_MS), ...add].slice(-40));
      if (hop.length) setBounce((b) => { const n = { ...b }; for (const id of hop) n[id] = now; return n; });
    });
  }, []);
  // animation clock, only while something is flying
  const [, setFrame] = useState(0);
  useEffect(() => {
    if (!flights.length) return;
    let raf = 0;
    const loop = () => {
      const now = performance.now();
      const landed = flights.filter((f) => now - f.start >= FLIGHT_MS);
      if (landed.length) {
        setFlights((all) => all.filter((f) => now - f.start < FLIGHT_MS));
        const hits = landed.filter((f) => f.landOn).map((f) => f.landOn!);
        if (hits.length) setBounce((b) => { const n = { ...b }; for (const id of hits) n[id] = now; return n; });
        return;
      }
      setFrame((x) => x + 1);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [flights]);
  return { flights, bounce };
}

function useFit(ref: React.RefObject<HTMLDivElement | null>, layout: BrainLayout) {
  const [cam, setCam] = useState({ x: 0, y: 0, k: 1 });
  const fit = useCallback(() => {
    const el = ref.current; if (!el) return;
    const w = el.clientWidth, h = el.clientHeight;
    const k = Math.min(w / layout.width, h / layout.height) * 0.98;
    setCam({ k, x: (w - layout.width * k) / 2, y: (h - layout.height * k) / 2 });
  }, [ref, layout.width, layout.height]);
  useEffect(() => {
    fit();
    const el = ref.current; if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => fit());
    ro.observe(el);
    return () => ro.disconnect();
  }, [fit, ref]);
  return { cam, setCam, fit };
}

const Lobes = memo(function Lobes({ layout, counts }: { layout: BrainLayout; counts: Record<string, { busy: number; total: number }> }) {
  return (
    <g className="brain-lobes">
      {layout.lobes.map((l) => (
        <g key={l.id}>
          <circle cx={l.x} cy={l.y} r={l.r + 14} fill={`url(#${DEFS}-lobe)`} style={{ color: l.color }} />
          <circle cx={l.x} cy={l.y} r={l.r + 4} fill="none" stroke={l.color} strokeOpacity={0.28} strokeWidth={1.2} strokeDasharray="2 6" />
        </g>
      ))}
      {layout.lobes.map((l) => {
        const w = Math.max(80, l.name.length * 7.6 + 46);
        const c = counts[l.id] ?? { busy: 0, total: l.agentIds.length };
        return (
          <g key={`${l.id}-label`} className="lobe-label" transform={`translate(${l.x} ${l.y - l.r - 10})`}>
            <rect x={-w / 2} y={-11} width={w} height={22} rx={11} fill="var(--label-bg)" stroke={l.color} strokeOpacity={0.75} />
            <text x={-8} y={4} textAnchor="middle" fill={l.color}>{l.name.toUpperCase()}</text>
            <text x={w / 2 - 14} y={4} textAnchor="middle" className="lobe-count" fill={c.busy ? l.color : 'var(--muted)'}>{c.busy}/{c.total}</text>
          </g>
        );
      })}
    </g>
  );
});

function BrainShell({ layout }: { layout: BrainLayout }) {
  return (
    <g className="brain-shell" pointerEvents="none">
      <path d={layout.stem} fill={`url(#${DEFS}-tissue)`} stroke={`url(#${DEFS}-rim)`} strokeWidth={2} opacity={0.75} />
      <path d={layout.cerebellum} fill={`url(#${DEFS}-tissue)`} stroke={`url(#${DEFS}-rim)`} strokeWidth={2} />
      {layout.cerebellumFolds.map((d, i) => <path key={i} d={d} fill="none" stroke="var(--brain-fold)" strokeWidth={2.5} strokeLinecap="round" />)}
      <path d={layout.outline} fill={`url(#${DEFS}-tissue)`} />
      <path d={layout.outline} fill="none" stroke={`url(#${DEFS}-rim)`} strokeWidth={3} filter={`url(#${DEFS}-glow)`} opacity={0.9} />
      {layout.folds.map((d, i) => <path key={i} d={d} fill="none" stroke="var(--brain-fold)" strokeWidth={3} strokeLinecap="round" />)}
      {/* nerves from every lobe to the core */}
      {layout.lobes.map((l) => <path key={l.id} d={edgePath(l, layout.core, 0.12)} className="nerve" fill="none" stroke={l.color} strokeOpacity={0.22} strokeWidth={2} />)}
    </g>
  );
}

function Core({ layout, entries }: { layout: BrainLayout; entries: number }) {
  const { x, y, r } = layout.core;
  return (
    <g className="brain-core" transform={`translate(${x} ${y})`} role="button" tabIndex={0} aria-label="Open Graph POW, the map of what the agents know"
      onClick={() => openAgentGraphPow()} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openAgentGraphPow(); } }}>
      <circle r={r * 1.5} fill={`url(#${DEFS}-core)`} className="core-halo" />
      <circle r={r} fill="var(--panel)" stroke={`url(#${DEFS}-rim)`} strokeWidth={3} />
      {[0, 1, 2, 3, 4, 5].map((i) => { const a = (i / 6) * Math.PI * 2; return <circle key={i} cx={Math.cos(a) * r * 0.48} cy={Math.sin(a) * r * 0.48} r={3.2} fill="var(--accent-blue)" opacity={0.85} />; })}
      <circle r={6} fill="var(--accent)" />
      <text y={r + 18} textAnchor="middle" className="core-label">GRAPH POW</text>
      <text y={r + 32} textAnchor="middle" className="core-sub">{entries} pieces of knowledge</text>
    </g>
  );
}

interface BallInfo { status: AgentStatus; task: string | null }

export default function BrainView() {
  const layout = useLayout();
  const edges = useEdges();
  const agents = useStore((s) => s.doc.agents);
  const entries = useStore((s) => Object.keys(s.doc.library).length + Object.values(s.runtime.tasks).filter((t) => t.status === 'done').length);
  const selected = useStore((s) => (s.selection.kind === 'agent' ? s.selection.id : null));
  const info = useStore(useShallow((s) => {
    const out: Record<string, string> = {};
    for (const id of Object.keys(s.doc.agents)) {
      const r = s.runtime.agents[id];
      const t = r?.currentTaskId ? s.runtime.tasks[r.currentTaskId] : null;
      out[id] = `${s.doc.agents[id].enabled ? (r?.status ?? 'idle') : 'paused'}|${t?.name ?? ''}`;
    }
    return out;
  }));
  const parsed = useMemo(() => {
    const o: Record<string, BallInfo> = {};
    for (const [id, v] of Object.entries(info)) { const [status, task] = v.split('|'); o[id] = { status: status as AgentStatus, task: task || null }; }
    return o;
  }, [info]);
  const counts = useMemo(() => {
    const c: Record<string, { busy: number; total: number }> = {};
    for (const l of layout.lobes) c[l.id] = { busy: l.agentIds.filter((id) => ['working', 'researching', 'thinking', 'communicating'].includes(parsed[id]?.status)).length, total: l.agentIds.length };
    return c;
  }, [layout, parsed]);
  const { flights, bounce } = useFlights(layout);
  const wrap = useRef<HTMLDivElement>(null);
  const { cam, setCam, fit } = useFit(wrap, layout);
  const [hover, setHover] = useState<string | null>(null);
  const drag = useRef<{ x: number; y: number; cx: number; cy: number; moved: boolean } | null>(null);

  const zoomAt = (px: number, py: number, f: number) => setCam((c) => {
    const k = Math.max(0.25, Math.min(4, c.k * f));
    return { k, x: px - ((px - c.x) / c.k) * k, y: py - ((py - c.y) / c.k) * k };
  });
  const onWheel = (e: RWheelEvent) => {
    const r = wrap.current!.getBoundingClientRect();
    zoomAt(e.clientX - r.left, e.clientY - r.top, e.deltaY < 0 ? 1.12 : 1 / 1.12);
  };
  const onDown = (e: RPointerEvent) => { if (e.button !== 0) return; drag.current = { x: e.clientX, y: e.clientY, cx: cam.x, cy: cam.y, moved: false }; };
  const onMove = (e: RPointerEvent) => {
    const d = drag.current; if (!d) return;
    const dx = e.clientX - d.x, dy = e.clientY - d.y;
    if (!d.moved && Math.hypot(dx, dy) < 4) return;
    if (!d.moved) (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    d.moved = true;
    setCam((c) => ({ ...c, x: d.cx + dx, y: d.cy + dy }));
  };
  const onUp = () => { setTimeout(() => { drag.current = null; }, 0); };
  const pick = (id: string) => {
    if (drag.current?.moved) return;
    const s = useStore.getState();
    s.setUi({ selection: { kind: 'agent', id }, profileAgentId: id, profileTab: 'identity' });
  };

  const now = performance.now();
  const hoverAgent = hover ? agents[hover] : null;
  const hoverNode = hover ? layout.nodes[hover] : null;
  const ids = Object.keys(layout.nodes);

  return (
    <div className="brain-wrap" ref={wrap} onWheel={onWheel} onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerLeave={() => setHover(null)}>
      <svg className="brain-svg" width="100%" height="100%" role="img" aria-label={`Agent brain: ${ids.length} agents in ${layout.lobes.length} teams`}>
        <defs>
          <radialGradient id={`${DEFS}-tissue`} cx="0.45" cy="0.4" r="0.7">
            <stop offset="0" stopColor="var(--brain-tissue-1)" />
            <stop offset="1" stopColor="var(--brain-tissue-2)" />
          </radialGradient>
          <linearGradient id={`${DEFS}-rim`} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#7cf7ff" /><stop offset="0.35" stopColor="#a98bff" /><stop offset="0.7" stopColor="#ff9ad5" /><stop offset="1" stopColor="#7cf7ff" />
          </linearGradient>
          <radialGradient id={`${DEFS}-lobe`}>
            <stop offset="0" stopColor="currentColor" stopOpacity="0.2" />
            <stop offset="0.7" stopColor="currentColor" stopOpacity="0.08" />
            <stop offset="1" stopColor="currentColor" stopOpacity="0" />
          </radialGradient>
          <radialGradient id={`${DEFS}-core`}>
            <stop offset="0" stopColor="#7cf7ff" stopOpacity="0.45" />
            <stop offset="1" stopColor="#7cf7ff" stopOpacity="0" />
          </radialGradient>
          <filter id={`${DEFS}-glow`} x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="4" result="b" /><feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge></filter>
        </defs>
        <BallDefs id={DEFS} />
        <g transform={`translate(${cam.x} ${cam.y}) scale(${cam.k})`}>
          <BrainShell layout={layout} />
          <Lobes layout={layout} counts={counts} />
          <g className="brain-edges" pointerEvents="none">
            {edges.map((e) => {
              const a = layout.nodes[e.from], b = layout.nodes[e.to];
              if (!a || !b) return null;
              const hot = hover === e.from || hover === e.to || selected === e.from || selected === e.to;
              const col = e.kind === 'reports' ? 'var(--muted)' : ballColor(agents[e.from]?.appearance ?? ({} as Appearance));
              return <path key={e.id} d={edgePath(a, b)} fill="none" stroke={col} className={e.live ? 'edge live' : 'edge'}
                strokeOpacity={hot ? 0.9 : e.kind === 'reports' ? 0.28 : 0.45} strokeWidth={e.kind === 'reports' ? 1.2 : Math.min(5, 1.4 + e.weight * 0.6)} strokeDasharray={e.kind === 'reports' ? '3 5' : undefined} />;
            })}
          </g>
          <Core layout={layout} entries={entries} />
          <g className="brain-balls">
            {ids.map((id) => {
              const n = layout.nodes[id], a = agents[id], st = parsed[id];
              if (!a) return null;
              const status = st?.status ?? 'idle';
              const hopping = bounce[id] && now - bounce[id] < 1000;
              return (
                <g key={id} transform={`translate(${n.x} ${n.y})`} className={`ball-slot s-${status}${hopping ? ' hop' : ''}`} style={{ animationDelay: `${-(id.length * 0.37) % 3}s` }}
                  data-agent={id} role="button" tabIndex={0} aria-label={`${a.identity.name}, ${a.identity.title}: ${status}${st?.task ? `, ${st.task}` : ''}`}
                  onClick={() => pick(id)} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(id); } }}
                  onPointerEnter={() => setHover(id)} onPointerLeave={() => setHover((h) => (h === id ? null : h))}>
                  <g key={hopping ? bounce[id] : 0} className="ball-bob">
                    <AgentBall a={a.appearance} r={BALL_R} mood={moodFor(status, a.appearance.expression ?? 'smile')} defsId={DEFS} ring={STATUS_COLOR[status]} selected={selected === id} />
                  </g>
                  <text y={BALL_R + 16} textAnchor="middle" className="ball-name">{a.identity.name}</text>
                </g>
              );
            })}
          </g>
          <g className="brain-flights" pointerEvents="none">
            {flights.map((f) => {
              const t = Math.max(0, Math.min(1, (now - f.start) / FLIGHT_MS));
              if (t <= 0) return null;
              const e = t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
              const p = pointOnEdge(f.from, f.to, e);
              const hop = Math.abs(Math.sin(e * Math.PI * 3)) * 10 * (1 - e);
              return (
                <g key={f.id} transform={`translate(${p.x} ${p.y - hop}) rotate(${e * 540}) scale(${f.core ? 0.42 - e * 0.18 : 0.55})`} opacity={f.core ? 1 - e * 0.5 : 1}>
                  <AgentBall a={f.look} r={BALL_R} mood="grin" defsId={DEFS} />
                </g>
              );
            })}
          </g>
        </g>
      </svg>
      {hoverAgent && hoverNode && (
        <div className="brain-tip" style={{ left: cam.x + hoverNode.x * cam.k, top: cam.y + (hoverNode.y - BALL_R - 10) * cam.k }}>
          <b>{hoverAgent.identity.name}</b> <span className="muted">{hoverAgent.identity.title}</span>
          <div><span className="dot" style={{ background: STATUS_COLOR[parsed[hover!]?.status ?? 'idle'] }} />{parsed[hover!]?.status}{parsed[hover!]?.task ? `: ${parsed[hover!]?.task}` : ''}</div>
        </div>
      )}
      <div className="brain-legend small">
        <span><i className="lg-handoff" />handoffs</span>
        <span><i className="lg-reports" />reports to</span>
        <span>finished work rolls into Graph POW</span>
      </div>
      <div className="brain-zoom">
        <button className="btn icon sm" aria-label="Zoom in" onClick={() => zoomAt((wrap.current?.clientWidth ?? 0) / 2, (wrap.current?.clientHeight ?? 0) / 2, 1.25)}><Plus size={14} /></button>
        <button className="btn icon sm" aria-label="Zoom out" onClick={() => zoomAt((wrap.current?.clientWidth ?? 0) / 2, (wrap.current?.clientHeight ?? 0) / 2, 0.8)}><Minus size={14} /></button>
        <button className="btn icon sm" aria-label="Fit the brain to the screen" onClick={fit}><Maximize size={14} /></button>
      </div>
    </div>
  );
}
