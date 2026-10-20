// The main screen: the operation drawn as a connectome. Dense nerve fibres in
// each team's colour, tracts between teams that work together, and small
// glowing nodes for the information the agents produced. Signals fire along
// the nerves when work is handed over or finished. No agents are drawn here;
// they're listed in the agent menu beside it.
import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as RPointerEvent, type WheelEvent as RWheelEvent } from 'react';
import { create } from 'zustand';
import { Maximize, Minus, Network, Plus, X } from 'lucide-react';
import { useStore } from '../store/store';
import { buildConnectome, curve, infoNodes, infoPosition, teamLinks, teamOfAgent, teamsOf, tint, type Connectome, type InfoNode, type Path, type Pt } from './connectome';
import { openAgentGraphPow } from './agentGraph';
import '../styles/brain.css';

/** What the agent menu is pointing at, so the brain can light that team up. */
export const useBrainFocus = create<{ teamId: string | null; agentId: string | null }>(() => ({ teamId: null, agentId: null }));

interface Spark { path: Path; t: number; speed: number; color: string; size: number; land?: string }
interface Placed { node: InfoNode; x: number; y: number; r: number; color: string }

const reduceMotion = () => typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;

function useBrainData() {
  const agents = useStore((s) => s.doc.agents);
  const departments = useStore((s) => s.doc.departments);
  const library = useStore((s) => s.doc.library);
  // only the shape of the work matters for links and nodes, not every tick
  const workKey = useStore((s) => { let n = 0, h = 0; for (const t of Object.values(s.runtime.tasks)) { if (t.status === 'done') n++; if (t.handoff?.fromAgentId) h++; } return `${n}:${h}`; });
  const teams = useMemo(() => teamsOf({ agents, departments }), [agents, departments]);
  // the brain's shape comes from teams and reporting lines only, so it stays put as work moves
  const brain = useMemo(() => buildConnectome(teams, teamLinks({ agents }, null, teams)), [teams, agents]);
  const info = useMemo(() => infoNodes({ agents, departments, library }, useStore.getState().runtime, teams), [agents, departments, library, teams, workKey]); // eslint-disable-line react-hooks/exhaustive-deps
  return { teams, brain, info };
}

function drawStatic(ctx: CanvasRenderingContext2D, brain: Connectome, cam: { x: number; y: number; k: number }, dpr: number, focus: string | null) {
  const { width, height } = ctx.canvas;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, width, height);
  ctx.setTransform(dpr * cam.k, 0, 0, dpr * cam.k, dpr * cam.x, dpr * cam.y);
  ctx.globalCompositeOperation = 'lighter';
  const dim = (id: string) => (focus && focus !== id ? 0.22 : 1);
  for (const r of brain.regions) {
    const g = ctx.createRadialGradient(r.x, r.y, 0, r.x, r.y, Math.max(r.rx, r.ry));
    g.addColorStop(0, `${r.color}2e`); g.addColorStop(0.7, `${r.color}12`); g.addColorStop(1, `${r.color}00`);
    ctx.globalAlpha = dim(r.id);
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.ellipse(r.x, r.y, r.rx, r.ry, 0, 0, Math.PI * 2); ctx.fill();
  }
  const byId = Object.fromEntries(brain.regions.map((r) => [r.id, r]));
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  for (const t of brain.tracts) {
    const A = byId[t.a], B = byId[t.b];
    for (const p of t.curves) {
      const g = ctx.createLinearGradient(p[0], p[1], p[p.length - 2], p[p.length - 1]);
      g.addColorStop(0, A.color); g.addColorStop(1, B.color);
      ctx.strokeStyle = g;
      ctx.globalAlpha = Math.min(0.55, 0.14 + t.weight * 0.05) * (focus && focus !== t.a && focus !== t.b ? 0.25 : 1);
      ctx.lineWidth = t.weight ? 1.1 : 0.7;
      stroke(ctx, p);
    }
  }
  for (const f of brain.fibers) {
    ctx.globalAlpha = f.alpha * dim(f.regionId);
    ctx.strokeStyle = f.color;
    ctx.lineWidth = f.width;
    stroke(ctx, f.pts);
  }
  for (const d of brain.rim) {
    ctx.globalAlpha = 0.75 * (focus ? 0.35 : 1);
    ctx.fillStyle = d.color;
    ctx.beginPath(); ctx.arc(d.x, d.y, d.r, 0, Math.PI * 2); ctx.fill();
  }
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
}

function stroke(ctx: CanvasRenderingContext2D, p: Path) {
  ctx.beginPath();
  ctx.moveTo(p[0], p[1]);
  for (let i = 2; i < p.length; i += 2) ctx.lineTo(p[i], p[i + 1]);
  ctx.stroke();
}

function at(p: Path, t: number): Pt {
  const n = p.length / 2 - 1;
  const f = Math.max(0, Math.min(n, t * n)), i = Math.floor(f), u = f - i;
  const j = Math.min(n, i + 1);
  return { x: p[i * 2] + (p[j * 2] - p[i * 2]) * u, y: p[i * 2 + 1] + (p[j * 2 + 1] - p[i * 2 + 1]) * u };
}

export default function ConnectomeView() {
  const { teams, brain, info } = useBrainData();
  const focusTeam = useBrainFocus((s) => s.teamId);
  const focusAgent = useBrainFocus((s) => s.agentId);
  const wrap = useRef<HTMLDivElement>(null);
  const base = useRef<HTMLCanvasElement>(null);
  const live = useRef<HTMLCanvasElement>(null);
  const [cam, setCam] = useState({ x: 0, y: 0, k: 1 });
  const [size, setSize] = useState({ w: 800, h: 600 });
  const [hover, setHover] = useState<Placed | null>(null);
  const [picked, setPicked] = useState<string | null>(null);
  const drag = useRef<{ x: number; y: number; cx: number; cy: number; moved: boolean } | null>(null);
  const sparks = useRef<Spark[]>([]);
  const flashes = useRef<Map<string, number>>(new Map());
  const agents = useStore((s) => s.doc.agents);

  const regionById = useMemo(() => Object.fromEntries(brain.regions.map((r) => [r.id, r])), [brain]);
  const placed = useMemo<Placed[]>(() => info.flatMap((n) => {
    const r = regionById[n.regionId]; if (!r) return [];
    const p = infoPosition(r, n.id);
    return [{ node: n, ...p, r: n.kind === 'knowledge' ? 5.6 : n.important ? 4 : 2.6, color: tint(r.color, 0, 0.22) }];
  }), [info, regionById]);
  const placedRef = useRef(placed); placedRef.current = placed;
  const brainRef = useRef(brain); brainRef.current = brain;

  // fit the whole brain on screen, and again when the window changes size
  const fit = useCallback(() => {
    const el = wrap.current; if (!el) return;
    const xs = brain.regions.flatMap((r) => [r.x - r.rx, r.x + r.rx]), ys = brain.regions.flatMap((r) => [r.y - r.ry, r.y + r.ry]);
    if (!xs.length) return;
    const minX = Math.min(...xs) - 30, maxX = Math.max(...xs) + 30, minY = Math.min(...ys) - 40, maxY = Math.max(...ys) + 30;
    const k = Math.min(el.clientWidth / (maxX - minX), el.clientHeight / (maxY - minY));
    setCam({ k, x: (el.clientWidth - (maxX - minX) * k) / 2 - minX * k, y: (el.clientHeight - (maxY - minY) * k) / 2 - minY * k });
  }, [brain]);
  useEffect(() => {
    const el = wrap.current; if (!el) return;
    const measure = () => setSize({ w: el.clientWidth, h: el.clientHeight });
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(measure); ro.observe(el);
    return () => ro.disconnect();
  }, []);
  useEffect(fit, [fit, size.w, size.h]);

  // the nerve tangle is drawn once per camera or focus change
  const dpr = typeof devicePixelRatio === 'number' ? Math.min(2, devicePixelRatio) : 1;
  useEffect(() => {
    for (const c of [base.current, live.current]) { if (c) { c.width = Math.round(size.w * dpr); c.height = Math.round(size.h * dpr); } }
    const ctx = base.current?.getContext('2d');
    if (ctx) drawStatic(ctx, brain, cam, dpr, focusTeam);
  }, [brain, cam, size, dpr, focusTeam]);

  // signals: a handoff fires along the tract between the two teams; finished work runs to its new node and lights it
  useEffect(() => {
    let prev = useStore.getState().runtime.tasks;
    return useStore.subscribe((s) => {
      const tasks = s.runtime.tasks;
      if (tasks === prev) return;
      const B = brainRef.current;
      const byId = Object.fromEntries(B.regions.map((r) => [r.id, r]));
      for (const t of Object.values(tasks)) {
        const was = prev[t.id];
        if (was?.status === t.status) continue;
        const to = teamOfAgent(teams, t.agentId);
        const from = teamOfAgent(teams, t.handoff?.fromAgentId);
        if (from && to && t.handoff?.fromAgentId !== t.agentId && (!was || t.status === 'in-transit') && t.status !== 'done') {
          const tract = B.tracts.find((x) => (x.a === from && x.b === to) || (x.a === to && x.b === from));
          const color = tint(byId[from]?.color ?? '#ffffff', 0, 0.3);
          if (tract) {
            for (const c of tract.curves.slice(0, 3)) {
              const path = tract.a === from ? c : reversePath(c);
              sparks.current.push({ path, t: 0, speed: 0.012 + Math.random() * 0.006, color, size: 2.8 });
            }
          }
        }
        if (t.status === 'done' && to && byId[to]) {
          const r = byId[to];
          const id = `t:${t.id}`;
          const end = infoPosition(r, id);
          const start = { x: r.x + (Math.random() - 0.5) * r.rx * 0.5, y: r.y + (Math.random() - 0.5) * r.ry * 0.5 };
          const mid = { x: (start.x + end.x) / 2 + (Math.random() - 0.5) * 40, y: (start.y + end.y) / 2 + (Math.random() - 0.5) * 40 };
          sparks.current.push({ path: curve(start, mid, end, 16), t: 0, speed: 0.022, color: '#ffffff', size: 3, land: id });
        }
      }
      prev = tasks;
    });
  }, [teams]);

  // the live layer: info nodes, sparks and labels, every frame
  const camRef = useRef(cam); camRef.current = cam;
  const hoverRef = useRef<string | null>(null); hoverRef.current = hover?.node.id ?? picked;
  const focusRef = useRef({ team: focusTeam, agent: focusAgent }); focusRef.current = { team: focusTeam, agent: focusAgent };
  useEffect(() => {
    const ctx = live.current?.getContext('2d'); if (!ctx) return;
    const calm = reduceMotion();
    const fibersBy = new Map<string, Path[]>();
    for (const f of brain.fibers) (fibersBy.get(f.regionId) ?? fibersBy.set(f.regionId, []).get(f.regionId)!).push(f.pts);
    let raf = 0;
    const frame = () => {
      const c = camRef.current, B = brainRef.current, now = performance.now();
      const st = useStore.getState();
      // ambient firing: busier teams fire more
      if (!calm && sparks.current.length < 160) {
        for (const r of B.regions) {
          const busy = r.agentIds.filter((id) => { const s = st.runtime.agents[id]?.status; return s === 'working' || s === 'thinking' || s === 'researching' || s === 'communicating'; }).length;
          if (Math.random() < 0.03 + busy * 0.035) {
            const list = fibersBy.get(r.id);
            if (list?.length) sparks.current.push({ path: list[Math.floor(Math.random() * list.length)], t: 0, speed: 0.02 + Math.random() * 0.02, color: tint(r.color, 0, 0.35), size: 1.6 });
          }
        }
        if (Math.random() < 0.08 && B.tracts.length) {
          const t = B.tracts[Math.floor(Math.random() * B.tracts.length)];
          const p = t.curves[Math.floor(Math.random() * t.curves.length)];
          const reg = B.regions.find((x) => x.id === t.a);
          sparks.current.push({ path: Math.random() < 0.5 ? p : reversePath(p), t: 0, speed: 0.01 + Math.random() * 0.008, color: tint(reg?.color ?? '#fff', 0, 0.35), size: 2 });
        }
      }
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
      ctx.setTransform(dpr * c.k, 0, 0, dpr * c.k, dpr * c.x, dpr * c.y);
      ctx.globalCompositeOperation = 'lighter';
      // sparks with a short tail
      const keep: Spark[] = [];
      for (const s of sparks.current) {
        s.t += calm ? 1 : s.speed;
        if (s.t >= 1) { if (s.land) flashes.current.set(s.land, now); continue; }
        keep.push(s);
        const head = at(s.path, s.t), tail = at(s.path, Math.max(0, s.t - 0.12));
        ctx.globalAlpha = 0.55; ctx.strokeStyle = s.color; ctx.lineWidth = s.size * 0.9;
        ctx.beginPath(); ctx.moveTo(tail.x, tail.y); ctx.lineTo(head.x, head.y); ctx.stroke();
        ctx.globalAlpha = 1; ctx.fillStyle = '#ffffff';
        ctx.beginPath(); ctx.arc(head.x, head.y, s.size * 0.7, 0, Math.PI * 2); ctx.fill();
        ctx.globalAlpha = 0.35; ctx.fillStyle = s.color;
        ctx.beginPath(); ctx.arc(head.x, head.y, s.size * 2.2, 0, Math.PI * 2); ctx.fill();
      }
      sparks.current = keep;
      // information nodes: knowledge entries larger, important work brighter
      const f = focusRef.current, hot = hoverRef.current;
      for (const p of placedRef.current) {
        const mine = f.agent ? p.node.agentId === f.agent : f.team ? p.node.regionId === f.team : true;
        const flash = flashes.current.get(p.node.id);
        const age = flash ? (now - flash) / 900 : 1;
        if (flash && age >= 1) flashes.current.delete(p.node.id);
        ctx.globalAlpha = (mine ? 0.32 : 0.06) + (age < 1 ? (1 - age) * 0.6 : 0);
        ctx.fillStyle = p.color;
        ctx.beginPath(); ctx.arc(p.x, p.y, p.r * (2.6 + (age < 1 ? (1 - age) * 4 : 0)), 0, Math.PI * 2); ctx.fill();
        ctx.globalAlpha = mine ? 1 : 0.25;
        ctx.fillStyle = p.node.kind === 'knowledge' ? '#ffffff' : p.color;
        if (p.node.kind === 'knowledge') {
          ctx.beginPath(); ctx.moveTo(p.x, p.y - p.r); ctx.lineTo(p.x + p.r, p.y); ctx.lineTo(p.x, p.y + p.r); ctx.lineTo(p.x - p.r, p.y); ctx.closePath(); ctx.fill();
        } else { ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2); ctx.fill(); }
        if (hot === p.node.id) { ctx.globalAlpha = 1; ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 1.4 / c.k; ctx.beginPath(); ctx.arc(p.x, p.y, p.r + 4, 0, Math.PI * 2); ctx.stroke(); }
      }
      // team names, in screen space so they stay readable at any zoom
      ctx.globalCompositeOperation = 'source-over';
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.font = '600 11px "Fira Code", ui-monospace, monospace';
      ctx.textAlign = 'center';
      for (const r of B.regions) {
        const x = c.x + r.x * c.k, y = c.y + (r.y - r.ry * 0.82) * c.k;
        ctx.globalAlpha = f.team && f.team !== r.id ? 0.3 : 0.9;
        ctx.fillStyle = 'rgba(0,0,0,.55)';
        const w = ctx.measureText(r.name.toUpperCase()).width + 14;
        ctx.fillRect(x - w / 2, y - 10, w, 16);
        ctx.fillStyle = tint(r.color, 0, 0.18);
        ctx.fillText(r.name.toUpperCase(), x, y + 2);
      }
      ctx.globalAlpha = 1;
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [brain, dpr]);

  const toWorld = (e: { clientX: number; clientY: number }) => {
    const r = wrap.current!.getBoundingClientRect();
    return { x: (e.clientX - r.left - cam.x) / cam.k, y: (e.clientY - r.top - cam.y) / cam.k };
  };
  const hit = (e: { clientX: number; clientY: number }) => {
    const p = toWorld(e);
    let best: Placed | null = null, bd = Infinity;
    for (const n of placed) { const d = Math.hypot(n.x - p.x, n.y - p.y); if (d < n.r + 6 / cam.k && d < bd) { best = n; bd = d; } }
    return best;
  };
  const zoomAt = (px: number, py: number, f: number) => setCam((c) => {
    const k = Math.max(0.2, Math.min(6, c.k * f));
    return { k, x: px - ((px - c.x) / c.k) * k, y: py - ((py - c.y) / c.k) * k };
  });
  const onWheel = (e: RWheelEvent) => { const r = wrap.current!.getBoundingClientRect(); zoomAt(e.clientX - r.left, e.clientY - r.top, e.deltaY < 0 ? 1.12 : 1 / 1.12); };
  const onDown = (e: RPointerEvent) => { if (e.button === 0) drag.current = { x: e.clientX, y: e.clientY, cx: cam.x, cy: cam.y, moved: false }; };
  const onMove = (e: RPointerEvent) => {
    const d = drag.current;
    if (d) {
      const dx = e.clientX - d.x, dy = e.clientY - d.y;
      if (d.moved || Math.hypot(dx, dy) > 4) { d.moved = true; setCam((c) => ({ ...c, x: d.cx + dx, y: d.cy + dy })); return; }
    }
    setHover(hit(e));
  };
  const onUp = (e: RPointerEvent) => {
    const d = drag.current; drag.current = null;
    if (d && !d.moved) setPicked(hit(e)?.node.id ?? null);
  };

  const sel = picked ? placed.find((p) => p.node.id === picked) ?? null : null;
  const who = (id: string | null) => (id ? agents[id]?.identity.name ?? 'Unknown agent' : 'No author');
  const count = { k: info.filter((n) => n.kind === 'knowledge').length, w: info.filter((n) => n.kind === 'work').length };

  return (
    <div className="nerve-wrap" ref={wrap} onWheel={onWheel} onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerLeave={() => { setHover(null); drag.current = null; }}
      role="img" aria-label={`Agent brain: ${brain.regions.length} teams joined by ${brain.tracts.length} nerve tracts, with ${count.k} knowledge entries and ${count.w} pieces of finished work`}>
      <canvas ref={base} className="nerve-canvas" style={{ width: size.w, height: size.h }} />
      <canvas ref={live} className="nerve-canvas" style={{ width: size.w, height: size.h }} />
      {hover && !drag.current?.moved && (
        <div className="brain-tip" style={{ left: cam.x + hover.x * cam.k, top: cam.y + (hover.y - hover.r - 8) * cam.k }}>
          <b>{hover.node.title}</b>
          <div className="muted">{hover.node.kind === 'knowledge' ? 'Knowledge' : 'Finished work'} · {who(hover.node.agentId)}</div>
        </div>
      )}
      {sel && (
        <aside className="info-card" aria-label="Information">
          <header className="row">
            <span className="eyebrow">{sel.node.kind === 'knowledge' ? 'Knowledge' : 'Finished work'}{sel.node.important && sel.node.kind === 'work' ? ' · important' : ''}</span>
            <span className="spacer" />
            <button className="btn icon sm" aria-label="Close" onClick={() => setPicked(null)}><X size={14} /></button>
          </header>
          <h3>{sel.node.title}</h3>
          <p className="small muted">{who(sel.node.agentId)} · {regionById[sel.node.regionId]?.name} · {new Date(sel.node.at).toLocaleString()}</p>
          <p className={sel.node.summary ? 'small' : 'small muted'}>{sel.node.summary || 'No description.'}</p>
          <div className="row wrap">
            {sel.node.agentId && agents[sel.node.agentId] && <button className="btn sm" onClick={() => useStore.getState().setUi({ selection: { kind: 'agent', id: sel.node.agentId! }, profileAgentId: sel.node.agentId, profileTab: 'identity' })}>Open {who(sel.node.agentId)}</button>}
            <button className="btn sm" onClick={() => openAgentGraphPow(sel.node.agentId)}><Network size={13} />Show in Graph POW</button>
          </div>
        </aside>
      )}
      <div className="brain-legend small">
        <span><i className="lg-node" />finished work</span>
        <span><i className="lg-know" />knowledge</span>
        <span>signals fire along nerves when work is handed over or finished</span>
      </div>
      <div className="brain-zoom">
        <button className="btn icon sm" aria-label="Zoom in" onClick={() => zoomAt(size.w / 2, size.h / 2, 1.25)}><Plus size={14} /></button>
        <button className="btn icon sm" aria-label="Zoom out" onClick={() => zoomAt(size.w / 2, size.h / 2, 0.8)}><Minus size={14} /></button>
        <button className="btn icon sm" aria-label="Fit the brain to the screen" onClick={fit}><Maximize size={14} /></button>
      </div>
    </div>
  );
}

function reversePath(p: Path): Path {
  const out: Path = [];
  for (let i = p.length - 2; i >= 0; i -= 2) out.push(p[i], p[i + 1]);
  return out;
}
