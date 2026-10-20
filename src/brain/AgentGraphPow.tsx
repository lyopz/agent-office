// Graph POW inside the app, for agents: a glowing map of every agent, the work
// they finished and the knowledge they wrote. It updates live; when an agent
// finishes something its links fire. "Save page" exports the same graph as a
// standalone Graph POW page.
import { useEffect, useMemo, useRef, useState, type PointerEvent as RPointerEvent, type WheelEvent as RWheelEvent } from 'react';
import { Download, Maximize, Search, X } from 'lucide-react';
import { useStore } from '../store/store';
import { LINK_KINDS, agentGraphPowHtml, buildAgentGraph, closeAgentGraphPow, useGraphPow, type AgentLinkKind, type PowData } from './agentGraph';
import { layoutPow } from './powLayout';

const KIND_COLOR = Object.fromEntries(LINK_KINDS.map((k) => [k.id, k.color])) as Record<AgentLinkKind, string>;

/** Rebuilt when agents change or a task finishes, not on every simulation tick. */
function useGraphData(): PowData {
  const doc = useStore((s) => s.doc);
  const key = useStore((s) => Object.values(s.runtime.tasks).filter((t) => t.status === 'done' || t.handoff?.fromAgentId).length);
  return useMemo(() => buildAgentGraph(doc, useStore.getState().runtime), [doc, key]); // eslint-disable-line react-hooks/exhaustive-deps
}

function savePage(data: PowData) {
  const blob = new Blob([agentGraphPowHtml(data)], { type: 'text/html' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = `${(data.project || 'agents').replace(/[^\w-]+/g, '-').toLowerCase()}-graph-pow.html`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export function AgentGraphPow() {
  const open = useGraphPow((s) => s.open);
  if (!open) return null;
  return <GraphPowPanel />;
}

function GraphPowPanel() {
  const data = useGraphData();
  const layout = useMemo(() => layoutPow(data), [data]);
  const focus = useGraphPow((s) => s.focus);
  const pulses = useGraphPow((s) => s.pulses);
  const [kinds, setKinds] = useState<Set<AgentLinkKind>>(() => new Set(LINK_KINDS.map((k) => k.id)));
  const [hidden, setHidden] = useState<Set<string>>(() => new Set());
  const [selected, setSelected] = useState<string | null>(null);
  const [hover, setHover] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [labels, setLabels] = useState(false);
  const stage = useRef<HTMLDivElement>(null);
  const [cam, setCam] = useState({ x: 0, y: 0, k: 1 });
  const drag = useRef<{ x: number; y: number; cx: number; cy: number; moved: boolean } | null>(null);
  const node = useMemo(() => Object.fromEntries(data.files.map((f) => [f.id, f])), [data]);
  const groupColor = useMemo(() => Object.fromEntries(layout.lobes.map((l) => [l.id, l.color])), [layout]);

  const fit = () => {
    const el = stage.current; if (!el) return;
    const k = Math.min(el.clientWidth / layout.width, el.clientHeight / layout.height) * 0.96;
    setCam({ k, x: (el.clientWidth - layout.width * k) / 2, y: (el.clientHeight - layout.height * k) / 2 });
  };
  useEffect(fit, [layout.width, layout.height]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!focus) return;
    const id = data.files.find((f) => f.kind === 'agent' && f.agentId === focus)?.id;
    if (id) setSelected(id);
  }, [focus]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { if (selected) setSelected(null); else closeAgentGraphPow(); } };
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  }, [selected]);
  // drop pulses once their signals have landed
  const [, tick] = useState(0);
  useEffect(() => { if (!pulses.length) return; const t = setTimeout(() => tick((x) => x + 1), 1600); return () => clearTimeout(t); }, [pulses]);

  const nodeOn = (id: string) => !hidden.has(node[id]?.group);
  const links = data.links.filter((l) => (Object.keys(l.kinds) as AgentLinkKind[]).some((k) => kinds.has(k)) && nodeOn(l.s) && nodeOn(l.t));
  const focusId = hover ?? selected;
  const near = useMemo(() => {
    if (!focusId) return null;
    const s = new Set([focusId]);
    for (const l of links) { if (l.s === focusId) s.add(l.t); if (l.t === focusId) s.add(l.s); }
    return s;
  }, [focusId, links]);
  const hits = q.trim() ? data.files.filter((f) => `${f.id} ${f.role} ${f.purpose}`.toLowerCase().includes(q.trim().toLowerCase())).slice(0, 8) : [];

  const zoomAt = (px: number, py: number, f: number) => setCam((c) => { const k = Math.max(0.15, Math.min(5, c.k * f)); return { k, x: px - ((px - c.x) / c.k) * k, y: py - ((py - c.y) / c.k) * k }; });
  const onWheel = (e: RWheelEvent) => { const r = stage.current!.getBoundingClientRect(); zoomAt(e.clientX - r.left, e.clientY - r.top, e.deltaY < 0 ? 1.12 : 1 / 1.12); };
  const onDown = (e: RPointerEvent) => { drag.current = { x: e.clientX, y: e.clientY, cx: cam.x, cy: cam.y, moved: false }; };
  const onMove = (e: RPointerEvent) => {
    const d = drag.current; if (!d) return;
    const dx = e.clientX - d.x, dy = e.clientY - d.y;
    if (!d.moved && Math.hypot(dx, dy) < 4) return;
    d.moved = true; setCam((c) => ({ ...c, x: d.cx + dx, y: d.cy + dy }));
  };
  const onUp = () => { setTimeout(() => { drag.current = null; }, 0); };
  const choose = (id: string) => { if (drag.current?.moved) return; setSelected(id); setQ(''); };

  const now = Date.now();
  const live = pulses.filter((p) => now - p.at < 1600);
  const sel = selected ? node[selected] : null;
  const conns = sel ? data.links.filter((l) => l.s === sel.id || l.t === sel.id) : [];

  return (
    <div className="pow-overlay" role="dialog" aria-modal="true" aria-label="Graph POW: agents and their knowledge">
      <header className="pow-head">
        <div className="pow-brand"><b>Graph POW</b> <span>· {data.project} agents</span>
          <div className="pow-meta">{data.files.filter((f) => f.kind === 'agent').length} agents · {data.files.filter((f) => f.kind === 'work').length} finished tasks · {data.files.filter((f) => f.kind === 'knowledge').length} knowledge entries · {data.links.length} links</div>
        </div>
        <div className="pow-search">
          <Search size={14} aria-hidden />
          <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find an agent, task or knowledge" aria-label="Search the graph" />
          {hits.length > 0 && (
            <ul className="pow-results" role="listbox">
              {hits.map((h) => <li key={h.id}><button onClick={() => choose(h.id)}><span className="c-dot" style={{ background: groupColor[h.group] }} />{h.name}<span className="muted"> {h.role}</span></button></li>)}
            </ul>
          )}
        </div>
        <div className="pow-chips" role="group" aria-label="Link types">
          {LINK_KINDS.map((k) => (
            <button key={k.id} className="pow-chip" aria-pressed={kinds.has(k.id)} style={{ '--c': k.color } as React.CSSProperties}
              onClick={() => setKinds((s) => { const n = new Set(s); if (n.has(k.id)) n.delete(k.id); else n.add(k.id); return n; })}><i />{k.label}</button>
          ))}
        </div>
        <div className="pow-tools">
          <button className="btn sm" aria-pressed={labels} onClick={() => setLabels((v) => !v)}>All labels</button>
          <button className="btn sm" onClick={fit}><Maximize size={13} />Fit</button>
          <button className="btn sm" title="Save this graph as a standalone Graph POW page" onClick={() => savePage(data)}><Download size={13} />Save page</button>
          <button className="btn icon sm" aria-label="Close Graph POW" onClick={closeAgentGraphPow}><X size={15} /></button>
        </div>
        <div className="pow-chips teams" role="group" aria-label="Teams">
          {layout.lobes.map((l) => (
            <button key={l.id} className="pow-chip" aria-pressed={!hidden.has(l.id)} style={{ '--c': l.color } as React.CSSProperties} title="Double-click to show only this team"
              onClick={() => setHidden((s) => { const n = new Set(s); if (n.has(l.id)) n.delete(l.id); else n.add(l.id); return n; })}
              onDoubleClick={() => setHidden(new Set(layout.lobes.filter((x) => x.id !== l.id).map((x) => x.id)))}><i />{l.id}<b>{data.groups.find((g) => g.id === l.id)?.count}</b></button>
          ))}
        </div>
      </header>
      <div className="pow-stage" ref={stage} onWheel={onWheel} onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onClick={(e) => { if (e.target === e.currentTarget || (e.target as Element).tagName === 'svg') { if (!drag.current?.moved) setSelected(null); } }}>
        <svg width="100%" height="100%">
          <defs>
            <radialGradient id="pow-lobe"><stop offset="0" stopColor="currentColor" stopOpacity="0.22" /><stop offset="1" stopColor="currentColor" stopOpacity="0" /></radialGradient>
            <filter id="pow-glow" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="3" result="b" /><feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge></filter>
          </defs>
          <g transform={`translate(${cam.x} ${cam.y}) scale(${cam.k})`}>
            {layout.lobes.filter((l) => !hidden.has(l.id)).map((l) => (
              <g key={l.id} style={{ color: l.color }}>
                <circle cx={l.x} cy={l.y} r={l.r * 1.25} fill="url(#pow-lobe)" />
                <text x={l.x} y={l.y - l.r - 6} textAnchor="middle" className="pow-lobe-label" fill={l.color}>{l.id.toUpperCase()}</text>
              </g>
            ))}
            <g className="pow-links">
              {links.map((l) => {
                const a = layout.pos[l.s], b = layout.pos[l.t];
                if (!a || !b) return null;
                const on = near ? near.has(l.s) && near.has(l.t) && (l.s === focusId || l.t === focusId) : true;
                return <line key={`${l.s}>${l.t}`} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={KIND_COLOR[l.primary]} strokeOpacity={near ? (on ? 0.9 : 0.05) : 0.28} strokeWidth={on && near ? 1.8 : 1} />;
              })}
            </g>
            <g className="pow-signals" pointerEvents="none">
              {live.flatMap((p) => {
                const id = data.files.find((f) => f.kind === 'agent' && f.agentId === p.agentId)?.id;
                if (!id || !layout.pos[id]) return [];
                const a = layout.pos[id];
                return links.filter((l) => l.s === id || l.t === id).slice(0, 10).map((l) => {
                  const b = layout.pos[l.s === id ? l.t : l.s];
                  return (
                    <circle key={`${p.at}-${l.s}-${l.t}`} r={3} fill="#ffffff" filter="url(#pow-glow)">
                      <animateMotion dur="0.9s" fill="freeze" path={`M${a.x},${a.y} L${b.x},${b.y}`} />
                      <animate attributeName="opacity" values="1;1;0" dur="1.2s" fill="freeze" />
                    </circle>
                  );
                }).concat(<circle key={`${p.at}-flash`} cx={a.x} cy={a.y} r={a.r + 4} fill="none" stroke="#ffffff" strokeWidth={2} className="pow-flash" />);
              })}
            </g>
            <g className="pow-nodes">
              {data.files.filter((f) => nodeOn(f.id)).map((f) => {
                const p = layout.pos[f.id]; if (!p) return null;
                const col = groupColor[f.group] ?? '#5ad2ff';
                const dim = near && !near.has(f.id);
                const showLabel = f.kind === 'agent' || labels || f.id === focusId || (near?.has(f.id) ?? false);
                return (
                  <g key={f.id} transform={`translate(${p.x} ${p.y})`} opacity={dim ? 0.15 : 1} className={`pow-node k-${f.kind}${f.id === selected ? ' sel' : ''}`}
                    onClick={(e) => { e.stopPropagation(); choose(f.id); }} onPointerEnter={() => setHover(f.id)} onPointerLeave={() => setHover((h) => (h === f.id ? null : h))}>
                    {f.kind === 'knowledge'
                      ? <rect x={-p.r} y={-p.r} width={p.r * 2} height={p.r * 2} transform="rotate(45)" fill={col} fillOpacity={0.35} stroke={col} strokeWidth={1.5} />
                      : <circle r={p.r} fill={col} fillOpacity={f.kind === 'agent' ? 0.95 : 0.7} filter={f.kind === 'agent' ? 'url(#pow-glow)' : undefined} />}
                    {f.id === selected && <circle r={p.r + 5} fill="none" stroke="#ffffff" strokeWidth={1.5} />}
                    {showLabel && <text y={p.r + 12} textAnchor="middle" className={f.kind === 'agent' ? 'pow-label agent' : 'pow-label'}>{f.name}</text>}
                  </g>
                );
              })}
            </g>
          </g>
        </svg>
        {!data.files.length && <p className="pow-empty">No agents yet.</p>}
      </div>
      <aside className="pow-panel" aria-live="polite">
        {sel ? (
          <>
            <div className="eyebrow">{sel.role}</div>
            <h2>{sel.name}</h2>
            <div className="tagline"><span className="tag" style={{ '--c': groupColor[sel.group] } as React.CSSProperties}>{sel.group}</span>{sel.cluster && <span className="tag">{sel.cluster}</span>}{sel.at && <span className="tag">{new Date(sel.at).toLocaleString()}</span>}</div>
            <p className={sel.purpose ? 'purpose' : 'purpose none'}>{sel.purpose || 'No description yet.'}</p>
            {sel.kind === 'agent' && sel.agentId && <button className="btn sm" onClick={() => { useStore.getState().setUi({ profileAgentId: sel.agentId, profileTab: 'identity', selection: { kind: 'agent', id: sel.agentId! } }); closeAgentGraphPow(); }}>Open profile</button>}
            <h3>Connections <span>{conns.length}</span></h3>
            <ul className="pow-conns">
              {conns.slice(0, 40).map((l) => {
                const other = node[l.s === sel.id ? l.t : l.s];
                return (
                  <li key={`${l.s}>${l.t}`}><button onClick={() => choose(other.id)}>
                    <span className="c-dot" style={{ background: groupColor[other.group] }} />
                    <span className="c-name">{other.name}</span>
                    <span className="c-why">{l.s === sel.id ? '→ ' : '← '}{l.why[0] ?? l.primary}</span>
                  </button></li>
                );
              })}
            </ul>
          </>
        ) : (
          <>
            <div className="eyebrow">Overview</div>
            <h2>{data.project}</h2>
            <p className="purpose">Every agent, the work they finished and the knowledge they wrote. Each glowing lobe is a team. When an agent finishes work, its node lights up and signals fire along its links.</p>
            <h3>Most connected</h3>
            <ul className="pow-conns">
              {[...data.files].sort((a, b) => b.degree - a.degree).slice(0, 8).map((f) => (
                <li key={f.id}><button onClick={() => choose(f.id)}><span className="c-dot" style={{ background: groupColor[f.group] }} /><span className="c-name">{f.name}</span><span className="c-why">{f.degree} links · {f.role}</span></button></li>
              ))}
            </ul>
            <p className="hint small muted">Click a node to see its links. Scroll to zoom, drag to pan, Esc to close.</p>
          </>
        )}
      </aside>
    </div>
  );
}
