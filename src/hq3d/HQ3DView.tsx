// The explorable 3D headquarters: walk the rooms and tubes in first or third
// person, look at a display or agent and press E to open it, and fast-travel
// through the tube network from the tube map. Loaded lazily (default export)
// so three.js is only fetched when the 3D view opens.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { Eye, HelpCircle, Map as MapIcon, MapPin, Sparkles, X } from 'lucide-react';
import { useStore } from '../store/store';
import { useBriefing } from '../ui/BriefingBoard';
import { useArcade } from '../ui/ArcadeHost';
import { FURNITURE_META } from '../model/catalog';
import { buildNav } from '../engine/navigation';
import { HQScene, type Target } from './scene';
import { PlayerController, forwardOf, inputFromKeys, type CameraMode } from './controls';
import { nearestWalkableWorld } from './collision';
import { describeScene, polylineLength, spawnPoint, THEME_INFO, type SceneDesc, type XZ } from './layout';
import { fastTravelRoute } from './travel';
import type { GameId } from '../model/types';
import './hq3d.css';

export interface HQ3DViewProps {
  /** Room to fly to (or cut to, with reduced motion) when it changes. */
  focusRoomId?: string | null;
  onFocusDone?: () => void;
}

interface Hud { roomId: string | null; name: string; team: string; tagline: string; inTube: boolean }

const HANDLED = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ShiftLeft', 'ShiftRight', 'Space', 'KeyV', 'KeyT', 'KeyE', 'KeyM', 'KeyH']);
const prefersReduced = () => typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
const loadPref = (k: string, d: boolean) => { try { const v = localStorage.getItem(k); return v === null ? d : v === '1'; } catch { return d; } };
const savePref = (k: string, v: boolean) => { try { localStorage.setItem(k, v ? '1' : '0'); } catch { /* storage unavailable */ } };

export default function HQ3DView({ focusRoomId, onFocusDone }: HQ3DViewProps) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const eng = useRef<{ scene: HQScene; ctrl: PlayerController; keys: Set<string> } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<CameraMode>(() => useStore.getState().doc.player?.camera ?? 'third');
  const [hud, setHud] = useState<Hud>({ roomId: null, name: '', team: '', tagline: '', inTube: false });
  const [target, setTarget] = useState<Target | null>(null);
  const [mapOpen, setMapOpen] = useState(false);
  const [inspectId, setInspectId] = useState<string | null>(null);
  const [bloom, setBloomState] = useState(() => loadPref('hq3d.glow', true));
  const [showMini, setShowMini] = useState(() => loadPref('hq3d.minimap', true));
  const [help, setHelp] = useState(() => loadPref('hq3d.help', true));
  const [locked, setLocked] = useState(false);
  const [announce, setAnnounce] = useState('');
  const [mini, setMini] = useState<{ p: XZ; yaw: number; agents: { id: string; x: number; z: number; color: string }[] }>({ p: { x: 0, z: 0 }, yaw: 0, agents: [] });
  const doc = useStore((s) => s.doc);
  const layout: SceneDesc = useMemo(() => describeScene(doc), [doc.rooms, doc.corridors, doc.furniture, doc.agents, doc.settings.layoutPreset]); // eslint-disable-line react-hooks/exhaustive-deps
  const targetRef = useRef<Target | null>(null);
  const hoverRef = useRef<{ x: number; y: number } | null>(null);
  const focusRef = useRef<{ id: string | null | undefined; done?: () => void }>({ id: null });
  focusRef.current.done = onFocusDone;
  const modeRef = useRef(mode); modeRef.current = mode;

  const reduced = useCallback(() => prefersReduced() || useStore.getState().doc.settings.animationIntensity === 'off', []);

  const travelTo = useCallback((roomId: string, done?: () => void) => {
    const e = eng.current; if (!e) return false;
    const s = useStore.getState();
    const route = fastTravelRoute(s.doc, buildNav(s.doc), e.ctrl.pos, roomId);
    if (!route) { s.notify(`No tube route to ${s.doc.rooms[roomId]?.name ?? 'that room'}`, 'warn'); done?.(); return false; }
    setMapOpen(false);
    setAnnounce(`Travelling to ${s.doc.rooms[roomId]?.name}`);
    e.ctrl.startGlide(route, reduced(), done);
    canvasRef.current?.focus();
    return true;
  }, [reduced]);

  const toggleMode = useCallback(() => {
    const next: CameraMode = modeRef.current === 'first' ? 'third' : 'first';
    setMode(next);
    if (eng.current) eng.current.ctrl.mode = next;
    if (next === 'third' && document.pointerLockElement) document.exitPointerLock();
    useStore.getState().commit([{ op: 'player.update', patch: { camera: next } }], next === 'first' ? 'First-person view' : 'Third-person view', { silent: true });
    setAnnounce(next === 'first' ? 'First-person view' : 'Third-person view');
  }, []);

  const interact = useCallback((t: Target | null) => {
    if (!t) return;
    if (document.pointerLockElement) document.exitPointerLock();
    eng.current?.keys.clear();
    if (t.kind === 'briefing') useBriefing.getState().show(t.id);
    else if (t.kind === 'arcade' && t.game) useArcade.getState().open(t.game as GameId);
    else if (t.kind === 'agent') useStore.getState().setUi({ profileAgentId: t.id, selection: { kind: 'agent', id: t.id } });
    else setInspectId(t.id);
  }, []);

  // ---------- engine lifecycle ----------
  useEffect(() => {
    const canvas = canvasRef.current, wrap = wrapRef.current;
    if (!canvas || !wrap) return;
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    } catch {
      setError('3D needs WebGL; use the 2D overview');
      return;
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
    const st = useStore.getState();
    const scene = new HQScene(renderer, st.doc, loadPref('hq3d.glow', true));
    const sp = spawnPoint(st.doc, buildNav(st.doc));
    const ctrl = new PlayerController(sp.pos, st.doc.player?.camera ?? 'third', sp.yaw);
    const keys = new Set<string>();
    eng.current = { scene, ctrl, keys };
    if (import.meta.env.DEV) (window as unknown as { __hq3d: unknown }).__hq3d = eng.current; // browser tests and debugging
    const size = () => { const r = wrap.getBoundingClientRect(); scene.resize(Math.max(1, r.width), Math.max(1, r.height)); };
    size();
    const ro = new ResizeObserver(size); ro.observe(wrap);

    const unsub = useStore.subscribe((s, prev) => {
      if (s.doc === prev.doc) return;
      scene.sync(s.doc);
      const p = nearestWalkableWorld(scene.nav, ctrl.pos);
      if (p && (Math.floor(p.x) !== Math.floor(ctrl.pos.x) || Math.floor(p.z) !== Math.floor(ctrl.pos.z))) ctrl.pos = p;
      if (s.doc.player?.camera && s.doc.player.camera !== ctrl.mode) { ctrl.mode = s.doc.player.camera; setMode(s.doc.player.camera); }
    });

    let raf = 0, last = performance.now(), t = 0, acc = 1, lastRoom: string | null | undefined, lastTube = false;
    let commitTimer: ReturnType<typeof setTimeout> | null = null;
    const ray = new THREE.Raycaster();
    const center = new THREE.Vector2(0, 0), hv = new THREE.Vector2();
    const loop = () => {
      const now = performance.now(); // rAF timestamps can stall in some embedders
      raf = requestAnimationFrame(loop);
      const dt = Math.min(0.05, (now - last) / 1000); last = now; t += dt;
      const s = useStore.getState();
      const red = reduced();
      ctrl.update(dt, scene.nav, inputFromKeys(keys));
      ctrl.applyCamera(scene.camera, scene.playerHeight * 0.92, dt, t, red);
      scene.frame(dt, t, s.runtime, ctrl, red);
      // HUD at ~8 Hz
      acc += dt;
      if (acc < 0.12) return;
      acc = 0;
      const rid = scene.currentRoomId;
      if (rid !== lastRoom || ctrl.tube !== lastTube) {
        lastRoom = rid; lastTube = ctrl.tube;
        const room = rid ? s.doc.rooms[rid] : null;
        const desc = room ? scene.roomDescs().find((d) => d.id === room.id) : null;
        setHud(room ? { roomId: room.id, name: room.name, team: desc?.team ?? '', tagline: desc ? THEME_INFO[desc.theme].tagline : '', inTube: false }
          : { roomId: null, name: ctrl.tube ? 'Bubble tube' : 'Outside', team: '', tagline: ctrl.tube ? 'Keep walking, or press T to fast-travel' : '', inTube: ctrl.tube });
        if (room) {
          setAnnounce(`Entered ${room.name}`);
          if (commitTimer) clearTimeout(commitTimer);
          commitTimer = setTimeout(() => {
            const cur = useStore.getState();
            if (cur.doc.rooms[room.id] && cur.doc.player?.lastRoomId !== room.id) cur.commit([{ op: 'player.update', patch: { lastRoomId: room.id } }], `Visited ${room.name}`, { silent: true });
          }, 2500);
        }
      }
      // what is the avatar looking at?
      let tg: Target | null = null;
      if (ctrl.mode === 'first') { ray.setFromCamera(center, scene.camera); tg = scene.pick(ray.ray, 5); }
      else if (hoverRef.current) { ray.setFromCamera(hv.set(hoverRef.current.x, hoverRef.current.y), scene.camera); tg = scene.pick(ray.ray, 16); }
      if (!tg) tg = scene.nearby(ctrl.pos, forwardOf(ctrl.yaw));
      if ((tg?.id ?? null) !== (targetRef.current?.id ?? null)) { targetRef.current = tg; setTarget(tg); }
      setMini({ p: { ...ctrl.pos }, yaw: ctrl.yaw, agents: scene.agentPositions() });
    };
    const start = () => { if (!raf) { last = performance.now(); raf = requestAnimationFrame(loop); } };
    const stop = () => { if (raf) cancelAnimationFrame(raf); raf = 0; };
    const onVis = () => { if (document.hidden) stop(); else start(); };
    document.addEventListener('visibilitychange', onVis);
    const onLock = () => setLocked(document.pointerLockElement === canvas);
    document.addEventListener('pointerlockchange', onLock);
    start();
    if (focusRef.current.id) { const id = focusRef.current.id; focusRef.current.id = null; setTimeout(() => travelTo(id, () => focusRef.current.done?.()), 0); }
    return () => {
      stop(); ro.disconnect(); unsub();
      if (commitTimer) clearTimeout(commitTimer);
      document.removeEventListener('visibilitychange', onVis);
      document.removeEventListener('pointerlockchange', onLock);
      if (document.pointerLockElement === canvas) document.exitPointerLock();
      scene.dispose(); renderer.dispose();
      eng.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => { eng.current?.scene.setBloom(bloom); savePref('hq3d.glow', bloom); }, [bloom]);
  useEffect(() => { savePref('hq3d.minimap', showMini); }, [showMini]);
  useEffect(() => { savePref('hq3d.help', help); }, [help]);

  // focus a room on request
  useEffect(() => {
    if (!focusRoomId) return;
    if (eng.current) travelTo(focusRoomId, () => focusRef.current.done?.());
    else focusRef.current.id = focusRoomId;
  }, [focusRoomId, travelTo]);

  // ---------- input ----------
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (!HANDLED.has(e.code) || e.ctrlKey || e.metaKey || e.altKey) return;
    e.stopPropagation();
    e.preventDefault(); // keep hotkeys from typing into fields they open (e.g. T focuses the tube-map search)
    const en = eng.current; if (!en) return;
    if (e.repeat && ['KeyV', 'KeyT', 'KeyE', 'KeyM', 'KeyH', 'Space'].includes(e.code)) return;
    switch (e.code) {
      case 'KeyV': toggleMode(); return;
      case 'KeyT': setMapOpen((o) => !o); return;
      case 'KeyE': interact(targetRef.current); return;
      case 'KeyM': setShowMini((v) => !v); return;
      case 'KeyH': setHelp((v) => !v); return;
      case 'Space': en.ctrl.jump(); return;
    }
    en.keys.add(e.code);
  };
  const onKeyUp = (e: React.KeyboardEvent) => { if (HANDLED.has(e.code)) { e.stopPropagation(); eng.current?.keys.delete(e.code); } };
  const drag = useRef<{ x: number; y: number; moved: number } | null>(null);
  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    e.currentTarget.focus();
    drag.current = { x: e.clientX, y: e.clientY, moved: 0 };
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* synthetic events */ }
  };
  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    hoverRef.current = { x: ((e.clientX - r.left) / r.width) * 2 - 1, y: -((e.clientY - r.top) / r.height) * 2 + 1 };
    const en = eng.current; if (!en) return;
    if (locked) { en.ctrl.look(e.movementX, e.movementY); return; }
    const d = drag.current; if (!d) return;
    const dx = e.clientX - d.x, dy = e.clientY - d.y;
    d.moved += Math.abs(dx) + Math.abs(dy); d.x = e.clientX; d.y = e.clientY;
    en.ctrl.look(dx * 1.1, dy * 1.1);
  };
  const onPointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const d = drag.current; drag.current = null;
    if (e.currentTarget.hasPointerCapture?.(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
    if (!d || d.moved > 6) return;
    if (locked) { interact(targetRef.current); return; }
    if (mode === 'first' && e.pointerType === 'mouse' && e.currentTarget.requestPointerLock) { try { void e.currentTarget.requestPointerLock(); } catch { /* not allowed here */ } return; }
    if (targetRef.current) interact(targetRef.current);
  };
  const pad = (k: string, on: boolean) => { const en = eng.current; if (!en) return; if (on) en.keys.add(k); else en.keys.delete(k); };

  const inspect = inspectId ? doc.furniture[inspectId] : undefined;
  const inspectMeta = inspect ? (FURNITURE_META as Record<string, { label: string; desc: string } | undefined>)[inspect.type] : undefined;
  const bounds = layout.bounds;
  const agentCount = (roomId: string) => doc.rooms[roomId]?.assignedAgentIds.length ?? 0;
  const sortedRooms = useMemo(() => layout.rooms.slice().sort((a, b) => (a.theme === 'royal' ? -1 : b.theme === 'royal' ? 1 : a.name.localeCompare(b.name))), [layout]);

  const mapSvg = (big: boolean) => (
    <svg className="hq3d-mapsvg" viewBox={`${bounds.x} ${bounds.y} ${bounds.w} ${bounds.h}`} role="img" aria-label="Map of rooms and bubble tubes" preserveAspectRatio="xMidYMid meet">
      {layout.tubes.map((t) => <polyline key={t.id} points={t.points.map((p) => `${p.x},${p.z}`).join(' ')} fill="none" stroke={t.blocked ? '#ff5d73' : '#7cf7ff'} strokeOpacity={0.55} strokeWidth={t.radius * 1.2} strokeLinecap="round" strokeLinejoin="round" />)}
      {layout.rooms.map((r) => (
        <g key={r.id} className="hq3d-maproom" onClick={big ? () => travelTo(r.id) : undefined}>
          <rect x={r.x} y={r.z} width={r.w} height={r.d} rx={layout.bubble ? Math.min(r.w, r.d) * 0.3 : 0.6} fill={r.accent} fillOpacity={r.id === hud.roomId ? 0.5 : 0.2} stroke={r.accent} strokeWidth={r.id === hud.roomId ? 0.8 : 0.4} />
          {big && <text x={r.cx} y={r.cz} textAnchor="middle" dominantBaseline="middle" fontSize={Math.max(1.5, Math.min(2.6, (r.w / Math.max(6, r.name.length)) * 1.7))} fill="#fff">{r.name}</text>}
        </g>
      ))}
      {mini.agents.map((a) => <circle key={a.id} cx={a.x} cy={a.z} r={big ? 0.55 : 0.7} fill={a.color} opacity={0.9} />)}
      <g transform={`translate(${mini.p.x} ${mini.p.z}) rotate(${(-mini.yaw * 180) / Math.PI})`}>
        <circle r={big ? 1.2 : 1.8} fill="#ffd166" stroke="#000" strokeWidth={0.3} />
        <path d={big ? 'M0,-3 L1.1,-1 L-1.1,-1 Z' : 'M0,-4.4 L1.6,-1.4 L-1.6,-1.4 Z'} fill="#ffd166" />
      </g>
    </svg>
  );

  if (error) {
    return (
      <div className="hq3d hq3d-error" role="alert">
        <div><strong>{error}</strong><p>Your browser or device could not start 3D graphics. Everything is still available in the 2D overview.</p></div>
      </div>
    );
  }

  const verb = target ? (target.verb === 'inspect' ? 'Inspect' : target.verb[0].toUpperCase() + target.verb.slice(1)) : '';
  return (
    <div className="hq3d" ref={wrapRef} role="application" aria-label="3D headquarters" data-mode={mode}>
      <canvas
        ref={canvasRef} className="hq3d-canvas" tabIndex={0}
        aria-label={`3D headquarters, ${mode}-person view.${hud.name ? ` You are in ${hud.name}.` : ''}`}
        aria-describedby="hq3d-help"
        onKeyDown={onKeyDown} onKeyUp={onKeyUp} onBlur={() => eng.current?.keys.clear()}
        onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerLeave={() => { hoverRef.current = null; }}
        onWheel={(e) => eng.current?.ctrl.zoom(e.deltaY)}
        onContextMenu={(e) => e.preventDefault()}
      />
      <div className="hq3d-sr" aria-live="polite">{announce}</div>
      <p id="hq3d-help" className="hq3d-sr">Click the scene to focus it. W A S D or arrow keys move, Shift runs, drag to look, V switches first and third person, T opens the tube map for fast travel, E interacts with what you face, Space jumps, Escape releases the mouse.</p>

      {mode === 'first' && <div className="hq3d-crosshair" aria-hidden="true" />}

      <div className="hq3d-room" aria-hidden="true">
        <div className="hq3d-room-name">{hud.inTube ? <span className="hq3d-dot" /> : <MapPin size={14} />}{hud.name || 'Headquarters'}</div>
        {hud.team && <div className="hq3d-room-team">{hud.team}</div>}
        {hud.tagline && <div className="hq3d-room-tag">{hud.tagline}</div>}
      </div>

      <div className="hq3d-tools" role="toolbar" aria-label="3D view controls">
        <button className="hq3d-btn" onClick={toggleMode} aria-pressed={mode === 'first'} title="Switch first / third person (V)"><Eye size={15} />{mode === 'first' ? 'First person' : 'Third person'}<kbd>V</kbd></button>
        <button className="hq3d-btn" onClick={() => setMapOpen(true)} title="Tube map and fast travel (T)"><MapIcon size={15} />Tube map<kbd>T</kbd></button>
        <button className="hq3d-btn icon" onClick={() => setBloomState((b) => !b)} aria-pressed={bloom} title={bloom ? 'Glow effects on (turn off for speed)' : 'Glow effects off'} aria-label="Glow effects"><Sparkles size={15} /></button>
        <button className="hq3d-btn icon" onClick={() => setHelp((h) => !h)} aria-pressed={help} title="Controls (H)" aria-label="Show controls"><HelpCircle size={15} /></button>
      </div>

      {help && (
        <div className="hq3d-help">
          <div><kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> / arrows move · <kbd>Shift</kbd> run · <kbd>Space</kbd> jump</div>
          <div>Drag to look{mode === 'first' ? ' · click to lock the mouse, Esc releases it' : ' · wheel to zoom'}</div>
          <div><kbd>E</kbd> interact · <kbd>V</kbd> view · <kbd>T</kbd> tube map · <kbd>M</kbd> minimap · <kbd>H</kbd> hide help</div>
        </div>
      )}

      {target && !mapOpen && (
        <button className="hq3d-prompt" onClick={() => interact(target)}>
          <kbd>E</kbd><span>{verb}</span><strong>{target.label}</strong>
        </button>
      )}

      {showMini && !mapOpen && (
        <button className="hq3d-mini" onClick={() => setMapOpen(true)} aria-label="Minimap: open the tube map">{mapSvg(false)}</button>
      )}

      <div className="hq3d-pad" aria-hidden="true">
        {([['pad-up', '▲'], ['pad-left', '◀'], ['pad-down', '▼'], ['pad-right', '▶']] as const).map(([k, s]) => (
          <button key={k} className={`hq3d-padbtn ${k}`} tabIndex={-1} onPointerDown={(e) => { e.preventDefault(); pad(k, true); }} onPointerUp={() => pad(k, false)} onPointerLeave={() => pad(k, false)} onPointerCancel={() => pad(k, false)}>{s}</button>
        ))}
      </div>

      {inspect && (
        <div className="hq3d-card" role="dialog" aria-label={`${inspect.label || inspectMeta?.label || inspect.type} details`}>
          <div className="hq3d-card-h"><strong>{inspect.label || inspect.workstation?.name || inspectMeta?.label || inspect.type}</strong><button className="hq3d-x" onClick={() => { setInspectId(null); canvasRef.current?.focus(); }} aria-label="Close"><X size={14} /></button></div>
          {inspectMeta?.desc && <p>{inspectMeta.desc}</p>}
          {inspect.workstation && <p className="muted">Workstation · {inspect.workstation.status}{inspect.workstation.assignedAgentId ? ` · ${doc.agents[inspect.workstation.assignedAgentId]?.identity.name ?? ''}` : ' · unassigned'}</p>}
          {inspect.tube && <p className="muted">Tube station · {inspect.tube.stationName} ({inspect.tube.department})</p>}
          <div className="hq3d-card-f">
            {inspect.workstation?.assignedAgentId && <button className="hq3d-btn" onClick={() => useStore.getState().setUi({ profileAgentId: inspect.workstation!.assignedAgentId })}>Open agent profile</button>}
            <button className="hq3d-btn" onClick={() => useStore.getState().setUi({ selection: { kind: 'furniture', id: inspect.id } })}>Select in inspector</button>
          </div>
        </div>
      )}

      {mapOpen && <TubeMap rooms={sortedRooms} map={mapSvg(true)} current={hud.roomId} agentCount={agentCount} length={layout.tubes.reduce((n, t) => n + polylineLength(t.points), 0)} onGo={(id) => travelTo(id)} onClose={() => { setMapOpen(false); canvasRef.current?.focus(); }} />}
    </div>
  );
}

function TubeMap({ rooms, map, current, agentCount, length, onGo, onClose }: { rooms: SceneDesc['rooms']; map: JSX.Element; current: string | null; agentCount: (id: string) => number; length: number; onGo: (id: string) => void; onClose: () => void }) {
  const [q, setQ] = useState('');
  const first = useRef<HTMLInputElement>(null);
  useEffect(() => { first.current?.focus(); }, []);
  const list = rooms.filter((r) => !q || `${r.name} ${r.team}`.toLowerCase().includes(q.toLowerCase()));
  return (
    <div className="hq3d-map" role="dialog" aria-modal="true" aria-label="Tube map" onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Escape') onClose(); }}>
      <div className="hq3d-map-h">
        <strong><MapIcon size={16} /> Tube map</strong>
        <span className="muted">{rooms.length} rooms · {Math.round(length)} m of bubble tube · choose a room to glide there</span>
        <button className="hq3d-x" onClick={onClose} aria-label="Close tube map"><X size={16} /></button>
      </div>
      <div className="hq3d-map-b">
        <div className="hq3d-map-svg">{map}</div>
        <div className="hq3d-map-list">
          <input ref={first} className="hq3d-search" placeholder="Find a room or team" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Find a room" />
          <ul>
            {list.map((r) => (
              <li key={r.id}>
                <button className="hq3d-dest" onClick={() => onGo(r.id)} aria-current={r.id === current ? 'location' : undefined} style={{ ['--acc' as string]: r.accent }}>
                  <span className="sw" />
                  <span className="n">{r.name}{r.id === current && <em> · you are here</em>}</span>
                  <span className="t">{r.team} · {agentCount(r.id)} agents</span>
                </button>
              </li>
            ))}
            {!list.length && <li className="muted">No rooms match.</li>}
          </ul>
        </div>
      </div>
    </div>
  );
}
