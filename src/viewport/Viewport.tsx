// Interactive office viewport: pan/zoom, selection, drag-to-move, resize
// handles, room creation, hallway editing, doors, furniture and agent placement.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { selectedFurniture, useStore } from '../store/store';
import { useArcade } from '../ui/ArcadeHost';
import { useBriefing } from '../ui/BriefingBoard';
import type { Furniture, Point, Rect, Room } from '../model/types';
import type { DocOp } from '../engine/ops';
import { applyOps } from '../engine/ops';
import { boundsOf, clampDoor, rectsOverlap, snap } from '../engine/geometry';
import { AgentPaths, AgentsLayer, CapsulesLayer, useSimplified } from './AgentsLayer';
import { CorridorShape, FloorPatterns, FurnitureShape, G, RoomShape, corridorPx, useFurnitureByRoom } from './OfficeLayers';
import { checkPlacement, footprint } from '../engine/spatial';
import { FURNITURE_META } from '../model/catalog';
import { markFrame } from '../ui/perf';
import { ContextMenu, type MenuTarget } from './ContextMenu';
import { Minimap } from './Minimap';

type Drag =
  | { type: 'pan'; sx: number; sy: number; cam: { x: number; y: number } }
  | { type: 'rooms'; ids: string[]; start: Point; d: Point; moved: boolean }
  | { type: 'resize'; id: string; handle: string; start: Point; r0: Rect; r: Rect }
  | { type: 'create'; start: Point; cur: Point }
  | { type: 'furniture'; ids: string[]; start: Point; d: Point }
  | { type: 'marquee'; start: Point; cur: Point; add: string[] }
  | { type: 'segment'; id: string; index: number; start: Point; points: Point[]; horizontal: boolean; d: number }
  | { type: 'door'; roomId: string; doorId: string; start: Point; offset0: number; offset: number };

const HANDLES = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];

export function fitCamera(rooms: Room[], width: number, height: number) {
  const b = boundsOf(rooms, 2);
  const zoom = Math.max(0.25, Math.min(1.6, Math.min(width / (b.w * G), height / (b.h * G))));
  return { zoom, x: (width - b.w * G * zoom) / 2 - b.x * G * zoom, y: (height - b.h * G * zoom) / 2 - b.y * G * zoom };
}

export function Viewport() {
  const doc = useStore((s) => s.doc);
  const camera = useStore((s) => s.camera);
  const mode = useStore((s) => s.mode);
  const tool = useStore((s) => s.tool);
  const selection = useStore((s) => s.selection);
  const layers = useStore((s) => s.layers);
  const issues = useStore((s) => s.issues);
  const preview = useStore((s) => s.preview);
  const hallwayDraft = useStore((s) => s.hallwayDraft);
  const furnitureType = useStore((s) => s.furnitureType);
  const placeRotation = useStore((s) => s.placeRotation);
  const [hover, setHover] = useState<Point | null>(null);
  const runtimeAgents = useStore((s) => s.runtime.agents);
  const { setUi, commit, notify } = useStore.getState();
  const svgRef = useRef<SVGSVGElement>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number; target: MenuTarget } | null>(null);
  const [size, setSize] = useState({ w: 800, h: 600 });
  const spaceDown = useRef(false);
  const construct = mode === 'construct';
  const furnitureByRoom = useMemo(() => useFurnitureByRoom(doc), [doc.furniture]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const el = svgRef.current?.parentElement;
    if (!el) return;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    setSize({ w: el.clientWidth, h: el.clientHeight });
    const fitted = sessionStorage.getItem('ao-fitted');
    if (!fitted) { setUi({ camera: fitCamera(Object.values(useStore.getState().doc.rooms), el.clientWidth, el.clientHeight) }); try { sessionStorage.setItem('ao-fitted', '1'); } catch { /* ignore */ } }
    const kd = (e: KeyboardEvent) => { if (e.code === 'Space' && !(e.target as HTMLElement).closest('input,textarea,select')) spaceDown.current = true; };
    const ku = (e: KeyboardEvent) => { if (e.code === 'Space') spaceDown.current = false; };
    window.addEventListener('keydown', kd); window.addEventListener('keyup', ku);
    const onFit = () => setUi({ camera: fitCamera(Object.values(useStore.getState().doc.rooms), el.clientWidth, el.clientHeight) });
    window.addEventListener('ao-fit', onFit);
    return () => { ro.disconnect(); window.removeEventListener('keydown', kd); window.removeEventListener('keyup', ku); window.removeEventListener('ao-fit', onFit); };
  }, [setUi]);

  const toWorld = useCallback((clientX: number, clientY: number): Point => {
    const r = svgRef.current!.getBoundingClientRect();
    const cam = useStore.getState().camera;
    return { x: (clientX - r.left - cam.x) / (cam.zoom * G), y: (clientY - r.top - cam.y) / (cam.zoom * G) };
  }, []);
  const toCell = (p: Point) => ({ x: Math.floor(p.x), y: Math.floor(p.y) });

  // wheel zoom around the cursor (non-passive so we can preventDefault)
  useEffect(() => {
    const el = svgRef.current; if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const cam = useStore.getState().camera;
      const r = el.getBoundingClientRect();
      const mx = e.clientX - r.left, my = e.clientY - r.top;
      const z = Math.max(0.2, Math.min(3, cam.zoom * (e.deltaY < 0 ? 1.12 : 1 / 1.12)));
      setUi({ camera: { zoom: z, x: mx - ((mx - cam.x) / cam.zoom) * z, y: my - ((my - cam.y) / cam.zoom) * z } });
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [setUi]);

  const selectedRoomIds = selection.kind === 'room' ? selection.ids : [];
  const errorObjects = useMemo(() => new Set(issues.filter((i) => i.severity === 'error').flatMap((i) => i.objectIds)), [issues]);

  const roomFromPoint = (p: Point) => Object.values(doc.rooms).find((r) => p.x >= r.x && p.x < r.x + r.w && p.y >= r.y && p.y < r.y + r.h);

  const nearestWall = (room: Room, p: Point) => {
    const d = { n: Math.abs(p.y - room.y), s: Math.abs(p.y - (room.y + room.h)), w: Math.abs(p.x - room.x), e: Math.abs(p.x - (room.x + room.w)) };
    const side = (Object.keys(d) as ('n' | 's' | 'e' | 'w')[]).sort((a, b) => d[a] - d[b])[0];
    const along = side === 'n' || side === 's' ? p.x - room.x : p.y - room.y;
    return clampDoor(room, { id: '', side, offset: Math.floor(along) - 1, width: 2 });
  };

  const onPointerDown = (e: React.PointerEvent) => {
    setMenu(null);
    if (e.button === 2) return;
    const world = toWorld(e.clientX, e.clientY);
    const el = (e.target as Element).closest('[data-kind]') as HTMLElement | SVGElement | null;
    const kind = el?.getAttribute('data-kind');
    const id = el?.getAttribute('data-id') ?? '';
    (e.currentTarget as Element).setPointerCapture(e.pointerId);

    if (e.button === 1 || spaceDown.current || tool === 'pan') { setDrag({ type: 'pan', sx: e.clientX, sy: e.clientY, cam: { ...camera } }); return; }

    // creation tools
    if (construct && tool === 'room') { const c = toCell(world); setDrag({ type: 'create', start: c, cur: c }); return; }
    if (construct && (tool === 'furniture' || tool === 'workstation' || tool === 'agent' || tool === 'door')) {
      const room = roomFromPoint(world);
      if (!room) { notify('Click inside a room', 'warn'); return; }
      const c = toCell(world);
      if (tool === 'door') { const d = nearestWall(room, world); commit([{ op: 'door.add', roomId: room.id, side: d.side, offset: d.offset, width: d.width }], 'Add door'); return; }
      if (tool === 'agent') {
        const n = Object.keys(doc.agents).length + 1;
        const r = commit([{ op: 'agent.create', name: `AGENT-${String(n).padStart(2, '0')}`, title: 'Generalist', department: 'Operations', roomId: room.id }], 'Add agent');
        if (r.ok) notify('Agent created — open its profile to configure it');
        return;
      }
      const g = ghostFor(c);
      if (g && !g.check.ok && doc.settings.collisionRule === 'prevent') { notify(g.check.outside ? "That object doesn't fit there" : g.check.blocksDoor ? 'That would block a door' : 'That spot is taken — collisions are set to prevent', 'warn'); return; }
      const type = tool === 'workstation' ? 'desk' : (furnitureType as never);
      commit([{ op: 'furniture.add', roomId: room.id, type, x: g?.x ?? c.x - room.x, y: g?.y ?? c.y - room.y, rotation: placeRotation, workstationName: tool === 'workstation' ? `${room.name} Desk` : undefined }], `Place ${FURNITURE_META[type as keyof typeof FURNITURE_META]?.label ?? 'object'}`);
      if (g && !g.check.ok) notify(g.check.blocksDoor ? 'Placed, but it blocks a door' : 'Placed, overlapping another object', 'warn');
      return;
    }
    if (tool === 'hallway' || tool === 'connect') {
      const room = roomFromPoint(world);
      if (kind === 'corridor' && hallwayDraft) {
        commit([{ op: 'room.connectToCorridor', roomId: hallwayDraft.roomId, corridorId: id }], 'Connect hallway');
        setUi({ hallwayDraft: null }); return;
      }
      if (!room) { setUi({ hallwayDraft: null }); return; }
      if (!hallwayDraft) { setUi({ hallwayDraft: { roomId: room.id, doorId: kind === 'door' ? el!.getAttribute('data-door')! : '' }, selection: { kind: 'room', ids: [room.id] } }); notify(`Now click the room or hallway to connect ${room.name} to`); return; }
      if (room.id === hallwayDraft.roomId) return;
      const targetDoor = kind === 'door' ? el!.getAttribute('data-door') : null;
      if (hallwayDraft.doorId && targetDoor) commit([{ op: 'corridor.create', start: { kind: 'door', roomId: hallwayDraft.roomId, doorId: hallwayDraft.doorId }, end: { kind: 'door', roomId: room.id, doorId: targetDoor } }], 'Create hallway');
      else commit([{ op: 'rooms.connect', a: hallwayDraft.roomId, b: room.id }], 'Connect rooms');
      setUi({ hallwayDraft: null });
      return;
    }

    // selection + direct manipulation
    if (kind === 'handle' && selection.kind === 'room') {
      const r = doc.rooms[selection.ids[0]];
      setDrag({ type: 'resize', id: r.id, handle: el!.getAttribute('data-h')!, start: world, r0: { x: r.x, y: r.y, w: r.w, h: r.h }, r: { x: r.x, y: r.y, w: r.w, h: r.h } });
      return;
    }
    if (kind === 'seg' && selection.kind === 'corridor') {
      const c = doc.corridors[selection.id];
      const i = Number(el!.getAttribute('data-index'));
      setDrag({ type: 'segment', id: c.id, index: i, start: world, points: c.points.map((p) => ({ ...p })), horizontal: c.points[i].y === c.points[i + 1].y, d: 0 });
      return;
    }
    if (kind === 'door') {
      const roomId = el!.getAttribute('data-room')!, doorId = el!.getAttribute('data-door')!;
      setUi({ selection: { kind: 'door', roomId, doorId } });
      const d = doc.rooms[roomId].doors.find((x) => x.id === doorId)!;
      if (construct) setDrag({ type: 'door', roomId, doorId, start: world, offset0: d.offset, offset: d.offset });
      return;
    }
    if (kind === 'agent') { setUi({ selection: { kind: 'agent', id } }); return; }
    if (kind === 'furniture' && !construct && doc.furniture[id]?.arcade) {
      // arcade machines open the owner's game; agents can never trigger this path
      (e.currentTarget as Element).releasePointerCapture(e.pointerId);
      setUi({ selection: { kind: 'furniture', id, ids: [id] } });
      useArcade.getState().open(doc.furniture[id].arcade!.game);
      return;
    }
    if (kind === 'furniture' && !construct && doc.furniture[id]?.type === 'briefing-board') {
      (e.currentTarget as Element).releasePointerCapture(e.pointerId);
      setUi({ selection: { kind: 'furniture', id, ids: [id] } });
      useBriefing.getState().show(id);
      return;
    }
    if (kind === 'furniture') {
      const cur = selectedFurniture(selection);
      let ids = [id];
      if (e.shiftKey) ids = cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id];
      else if (cur.includes(id)) ids = cur;
      else { const gid = doc.furniture[id]?.groupId; if (gid) ids = Object.values(doc.furniture).filter((f) => f.groupId === gid).map((f) => f.id); }
      setUi({ selection: ids.length ? { kind: 'furniture', id: ids.includes(id) ? id : ids[0], ids } : { kind: 'none' } });
      if (construct && ids.includes(id)) setDrag({ type: 'furniture', ids, start: world, d: { x: 0, y: 0 } });
      return;
    }
    if (kind === 'corridor') { setUi({ selection: { kind: 'corridor', id } }); return; }
    if (kind === 'room') {
      let ids = [id];
      if (e.shiftKey && selection.kind === 'room') ids = selection.ids.includes(id) ? selection.ids.filter((x) => x !== id) : [...selection.ids, id];
      else if (selection.kind === 'room' && selection.ids.includes(id)) ids = selection.ids;
      setUi({ selection: ids.length ? { kind: 'room', ids } : { kind: 'none' } });
      if (construct && ids.includes(id)) setDrag({ type: 'rooms', ids, start: world, d: { x: 0, y: 0 }, moved: false });
      return;
    }
    if (construct && e.shiftKey) { setDrag({ type: 'marquee', start: world, cur: world, add: selectedFurniture(selection) }); return; }
    setUi({ selection: { kind: 'none' } });
    setDrag({ type: 'pan', sx: e.clientX, sy: e.clientY, cam: { ...camera } });
  };

  /** Where the object being placed would land, snapped to the room, and whether it fits. */
  const ghostFor = (c: Point) => {
    if (!(construct && (tool === 'furniture' || tool === 'workstation'))) return null;
    const room = roomFromPoint({ x: c.x + 0.5, y: c.y + 0.5 }); if (!room) return null;
    const type = (tool === 'workstation' ? 'desk' : furnitureType) as Furniture['type'];
    const meta = FURNITURE_META[type]; if (!meta) return null;
    const fp = footprint({ w: meta.w, h: meta.h, rotation: placeRotation });
    const x = Math.max(0, Math.min(room.w - fp.w, c.x - room.x)), y = Math.max(0, Math.min(room.h - fp.h, c.y - room.y));
    return { room, type, x, y, fp, check: checkPlacement(doc, room, { x, y, w: meta.w, h: meta.h, rotation: placeRotation, blocking: meta.blocking }) };
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!drag) {
      if (construct && (tool === 'furniture' || tool === 'workstation')) { const c = toCell(toWorld(e.clientX, e.clientY)); if (!hover || hover.x !== c.x || hover.y !== c.y) setHover(c); }
      return;
    }
    const snapOn = useStore.getState().layers.snap;
    if (drag.type === 'pan') { setUi({ camera: { ...camera, x: drag.cam.x + e.clientX - drag.sx, y: drag.cam.y + e.clientY - drag.sy } }); return; }
    const w = toWorld(e.clientX, e.clientY);
    const dx = w.x - (('start' in drag) ? drag.start.x : 0), dy = w.y - (('start' in drag) ? drag.start.y : 0);
    if (drag.type === 'rooms') {
      const d = { x: snap(dx, snapOn), y: snap(dy, snapOn) };
      if (d.x !== drag.d.x || d.y !== drag.d.y) setDrag({ ...drag, d, moved: true });
    } else if (drag.type === 'furniture') {
      const d = { x: Math.round(dx), y: Math.round(dy) };
      if (d.x !== drag.d.x || d.y !== drag.d.y) setDrag({ ...drag, d });
    } else if (drag.type === 'marquee') {
      setDrag({ ...drag, cur: w });
    } else if (drag.type === 'create') {
      setDrag({ ...drag, cur: toCell(w) });
    } else if (drag.type === 'resize') {
      const r = { ...drag.r0 };
      const ix = snap(dx, snapOn), iy = snap(dy, snapOn);
      if (drag.handle.includes('e')) r.w = Math.max(3, drag.r0.w + ix);
      if (drag.handle.includes('s')) r.h = Math.max(3, drag.r0.h + iy);
      if (drag.handle.includes('w')) { const nw = Math.max(3, drag.r0.w - ix); r.x = drag.r0.x + drag.r0.w - nw; r.w = nw; }
      if (drag.handle.includes('n')) { const nh = Math.max(3, drag.r0.h - iy); r.y = drag.r0.y + drag.r0.h - nh; r.h = nh; }
      if (r.x !== drag.r.x || r.y !== drag.r.y || r.w !== drag.r.w || r.h !== drag.r.h) setDrag({ ...drag, r });
    } else if (drag.type === 'segment') {
      const d = Math.round(drag.horizontal ? dy : dx);
      if (d !== drag.d) setDrag({ ...drag, d });
    } else if (drag.type === 'door') {
      const room = doc.rooms[drag.roomId]; const door = room.doors.find((x) => x.id === drag.doorId)!;
      const along = door.side === 'n' || door.side === 's' ? dx : dy;
      const off = clampDoor(room, { ...door, offset: drag.offset0 + Math.round(along) }).offset;
      if (off !== drag.offset) setDrag({ ...drag, offset: off });
    }
  };

  const dragOps = useMemo((): DocOp[] | null => {
    if (!drag) return null;
    if (drag.type === 'rooms' && drag.moved && (drag.d.x || drag.d.y)) return drag.ids.map((id) => ({ op: 'room.update', id, patch: { x: doc.rooms[id].x + drag.d.x, y: doc.rooms[id].y + drag.d.y } }));
    if (drag.type === 'resize') return [{ op: 'room.update', id: drag.id, patch: drag.r }];
    if (drag.type === 'segment' && drag.d) {
      const pts = segmentMove(drag.points, drag.index, drag.d, drag.horizontal);
      const ops: DocOp[] = [{ op: 'corridor.update', id: drag.id, patch: { points: pts, routing: 'manual' } }];
      if (doc.settings.hallwayMode === 'automatic') ops.unshift({ op: 'settings.update', patch: { hallwayMode: 'hybrid' } });
      return ops;
    }
    if (drag.type === 'door' && drag.offset !== drag.offset0) return [{ op: 'door.update', roomId: drag.roomId, doorId: drag.doorId, patch: { offset: drag.offset } }];
    return null;
  }, [drag, doc]); // eslint-disable-line react-hooks/exhaustive-deps

  // live preview of rerouted hallways while dragging
  const live = useMemo(() => (dragOps ? applyOps(doc, dragOps) : null), [dragOps, doc]);

  const onPointerUp = () => {
    if (!drag) return;
    const d = drag;
    setDrag(null);
    if (d.type === 'create') {
      const x = Math.min(d.start.x, d.cur.x), y = Math.min(d.start.y, d.cur.y);
      const w = Math.abs(d.cur.x - d.start.x) + 1, h = Math.abs(d.cur.y - d.start.y) + 1;
      if (w < 3 || h < 3) { notify('Drag out at least 3×3 cells to create a room', 'warn'); return; }
      const id = `room_${Date.now().toString(36)}`;
      const r = commit([{ op: 'room.create', id, type: 'custom', name: `Room ${Object.keys(doc.rooms).length + 1}`, x, y, w, h, preset: false }], 'Create room');
      if (r.ok) setUi({ selection: { kind: 'room', ids: [id] }, tool: 'select' });
      return;
    }
    if (d.type === 'marquee') {
      const r = { x: Math.min(d.start.x, d.cur.x), y: Math.min(d.start.y, d.cur.y), w: Math.abs(d.cur.x - d.start.x), h: Math.abs(d.cur.y - d.start.y) };
      const hit = Object.values(doc.furniture).filter((f) => { const rm = doc.rooms[f.roomId]; if (!rm) return false; const fp = footprint(f); return rectsOverlap(r, { x: rm.x + f.x, y: rm.y + f.y, w: fp.w, h: fp.h }); }).map((f) => f.id);
      const ids = [...new Set([...d.add, ...hit])];
      setUi({ selection: ids.length ? { kind: 'furniture', id: ids[0], ids } : { kind: 'none' } });
      if (hit.length) notify(`Selected ${ids.length} object${ids.length > 1 ? 's' : ''}`);
      return;
    }
    if (d.type === 'furniture') {
      if (!d.d.x && !d.d.y) return;
      if (d.ids.length === 1) {
        // a single object may be carried into another room
        const f = doc.furniture[d.ids[0]]; const room = doc.rooms[f.roomId];
        const wx = room.x + f.x + d.d.x, wy = room.y + f.y + d.d.y;
        const target = roomFromPoint({ x: wx, y: wy }) ?? room;
        commit([{ op: 'furniture.update', id: f.id, patch: { roomId: target.id, x: wx - target.x, y: wy - target.y } }], `Move ${f.label ?? f.workstation?.name ?? FURNITURE_META[f.type]?.label ?? 'object'}`);
      } else commit([{ op: 'furniture.moveMany', ids: d.ids, dx: d.d.x, dy: d.d.y }], `Move ${d.ids.length} objects`);
      return;
    }
    if (dragOps) {
      const label = d.type === 'rooms' ? (d.ids.length > 1 ? `Move ${d.ids.length} rooms` : `Move ${doc.rooms[d.ids[0]].name}`)
        : d.type === 'resize' ? `Resize ${doc.rooms[d.id].name}` : d.type === 'segment' ? 'Edit hallway route' : d.type === 'door' ? 'Move door' : 'Move furniture';
      commit(dragOps, label);
    }
  };

  const onContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    const el = (e.target as Element).closest('[data-kind]');
    const kind = el?.getAttribute('data-kind'); const id = el?.getAttribute('data-id') ?? '';
    const r = svgRef.current!.getBoundingClientRect();
    const world = toWorld(e.clientX, e.clientY);
    let target: MenuTarget = { kind: 'canvas', at: toCell(world) };
    if (kind === 'room') { target = { kind: 'room', id }; setUi({ selection: { kind: 'room', ids: [id] } }); }
    if (kind === 'corridor') { target = { kind: 'corridor', id }; setUi({ selection: { kind: 'corridor', id } }); }
    if (kind === 'furniture') { target = { kind: 'furniture', id }; setUi({ selection: { kind: 'furniture', id } }); }
    if (kind === 'agent') { target = { kind: 'agent', id }; setUi({ selection: { kind: 'agent', id } }); }
    setMenu({ x: e.clientX - r.left, y: e.clientY - r.top, target });
  };

  // geometry to draw (live drag result replaces the doc while dragging)
  const shown = live && live.errors.length === 0 ? live.doc : doc;
  const movingIds = new Set(drag?.type === 'rooms' ? drag.ids : drag?.type === 'resize' ? [drag.id] : []);
  const overlapping = new Set<string>();
  if (movingIds.size) {
    for (const id of movingIds) for (const o of Object.values(shown.rooms)) if (!movingIds.has(o.id) && rectsOverlap(shown.rooms[id], o)) { overlapping.add(id); overlapping.add(o.id); }
  }
  const affectedCorridors = new Set(Object.values(doc.corridors).filter((c) => [c.start, c.end].some((e) => e.kind === 'door' && movingIds.has(e.roomId))).map((c) => c.id));
  const occupancy = useMemo(() => {
    const m: Record<string, number> = {};
    for (const r of Object.values(runtimeAgents)) if (r.roomId) m[r.roomId] = (m[r.roomId] ?? 0) + 1;
    return m;
  }, [runtimeAgents]);

  // only draw what the camera can see
  const view = { x: -camera.x / (G * camera.zoom) - 2, y: -camera.y / (G * camera.zoom) - 2, w: size.w / (G * camera.zoom) + 4, h: size.h / (G * camera.zoom) + 4 };
  const visibleRooms = Object.values(shown.rooms).filter((r) => rectsOverlap(r, view));
  const visibleCorridors = Object.values(shown.corridors).filter((c) => { if (!c.points.length) return false; const b = boundsOf(c.points.map((p) => ({ x: p.x, y: p.y, w: 1, h: 1 })), c.width); return rectsOverlap(b, view); });

  // objects being dragged are drawn from an overlay at a transient offset; nothing is recalculated until drop
  const moving = drag?.type === 'furniture' ? drag : null;
  const movingSet = useMemo(() => new Set(moving?.ids ?? []), [moving?.ids]); // eslint-disable-line react-hooks/exhaustive-deps
  const furnitureFor = useMemo(() => {
    if (!movingSet.size) return furnitureByRoom;
    const m: Record<string, Furniture[]> = { ...furnitureByRoom };
    for (const id of movingSet) { const rid = doc.furniture[id]?.roomId; if (rid && m[rid] === furnitureByRoom[rid]) m[rid] = furnitureByRoom[rid].filter((f) => !movingSet.has(f.id)); }
    return m;
  }, [furnitureByRoom, movingSet, doc.furniture]);
  const movingShapes = moving ? moving.ids.map((id) => {
    const f = doc.furniture[id]; const r = f && doc.rooms[f.roomId]; if (!r) return null;
    const fp = footprint(f);
    const target = moving.ids.length === 1 ? roomFromPoint({ x: r.x + f.x + moving.d.x + 0.5, y: r.y + f.y + moving.d.y + 0.5 }) ?? r : r;
    const lx = r.x + f.x + moving.d.x - target.x, ly = r.y + f.y + moving.d.y - target.y;
    const chk = checkPlacement(doc, target, { x: lx, y: ly, w: f.w, h: f.h, rotation: f.rotation, blocking: f.blocking }, movingSet);
    return { f, x: target.x + lx, y: target.y + ly, fp, ok: chk.ok, room: target };
  }).filter(Boolean) as { f: Furniture; x: number; y: number; fp: { w: number; h: number }; ok: boolean; room: Room }[] : [];
  const ghost = !drag && hover ? ghostFor(hover) : null;
  const guideFor = (x: number, y: number, w: number, h: number, room: Room, ignore: Set<string>) => {
    const xs = new Set<number>(), ys = new Set<number>();
    for (const o of furnitureByRoom[room.id] ?? []) {
      if (ignore.has(o.id)) continue;
      const fp = footprint(o); const ox = room.x + o.x, oy = room.y + o.y;
      for (const a of [x, x + w / 2, x + w]) for (const b of [ox, ox + fp.w / 2, ox + fp.w]) if (Math.abs(a - b) < 1e-6) xs.add(a);
      for (const a of [y, y + h / 2, y + h]) for (const b of [oy, oy + fp.h / 2, oy + fp.h]) if (Math.abs(a - b) < 1e-6) ys.add(a);
    }
    return { xs: [...xs], ys: [...ys], room };
  };
  const guides = movingShapes.length ? guideFor(Math.min(...movingShapes.map((m) => m.x)), Math.min(...movingShapes.map((m) => m.y)), Math.max(...movingShapes.map((m) => m.x + m.fp.w)) - Math.min(...movingShapes.map((m) => m.x)), Math.max(...movingShapes.map((m) => m.y + m.fp.h)) - Math.min(...movingShapes.map((m) => m.y)), movingShapes[0].room, movingSet)
    : ghost ? guideFor(ghost.room.x + ghost.x, ghost.room.y + ghost.y, ghost.fp.w, ghost.fp.h, ghost.room, new Set()) : null;
  const selFurnIds = selectedFurniture(selection);

  const selRoom = selection.kind === 'room' && selection.ids.length === 1 ? shown.rooms[selection.ids[0]] : undefined;
  const selCorridor = selection.kind === 'corridor' ? shown.corridors[selection.id] : undefined;
  const selFurniture = selection.kind === 'furniture' ? shown.furniture[selection.id] : undefined;
  useEffect(() => { markFrame('render', 0, { rooms: visibleRooms.length, totalRooms: Object.keys(doc.rooms).length, objects: Object.keys(doc.furniture).length }); });
  const cursor = drag?.type === 'pan' ? 'grabbing' : construct && tool !== 'select' ? 'crosshair' : 'default';
  const gridPx = G * camera.zoom;

  return (
    <div className="viewport" data-mode={mode}>
      <svg ref={svgRef} width={size.w} height={size.h} onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={() => setDrag(null)} onPointerLeave={() => hover && setHover(null)} onContextMenu={onContextMenu} style={{ cursor, touchAction: 'none' }} aria-label="Office floor plan" role="application">
        <FloorPatterns />
        {layers.grid && (
          <>
            <defs><pattern id="bg-grid" width={gridPx} height={gridPx} patternUnits="userSpaceOnUse" x={camera.x % gridPx} y={camera.y % gridPx}><path d={`M${gridPx} 0 L0 0 0 ${gridPx}`} fill="none" stroke="var(--grid-line)" strokeWidth="1" /></pattern></defs>
            <rect width={size.w} height={size.h} fill="url(#bg-grid)" pointerEvents="none" />
          </>
        )}
        <g transform={`translate(${camera.x} ${camera.y}) scale(${camera.zoom})`}>
          {doc.settings.bounds && <rect x={doc.settings.bounds.x * G} y={doc.settings.bounds.y * G} width={doc.settings.bounds.w * G} height={doc.settings.bounds.h * G} fill="none" stroke="var(--warn)" strokeDasharray="10 6" opacity={0.5} />}
          <g>{visibleCorridors.map((c) => <CorridorShape key={c.id} c={c} selected={selCorridor?.id === c.id || affectedCorridors.has(c.id)} />)}</g>
          <g>{visibleRooms.map((r) => (
            <RoomShape key={r.id} room={r} furniture={live && live.errors.length === 0 ? Object.values(shown.furniture).filter((f) => f.roomId === r.id) : furnitureFor[r.id] ?? []}
              selected={selectedRoomIds.includes(r.id)} invalid={overlapping.has(r.id) || errorObjects.has(r.id)}
              occupancy={layers.occupancy ? occupancy[r.id] ?? 0 : null} showLabel={layers.labels} showBoundary={layers.boundaries} construct={construct} />
          ))}</g>
          {preview && (
            <g pointerEvents="none" className="ghost">
              {Object.values(preview.doc.corridors).map((c) => <CorridorShape key={c.id} c={c} ghost />)}
              {Object.values(preview.doc.rooms).map((r) => {
                const cur = doc.rooms[r.id];
                const changed = !cur || cur.x !== r.x || cur.y !== r.y || cur.w !== r.w || cur.h !== r.h;
                return changed ? <rect key={r.id} x={r.x * G} y={r.y * G} width={r.w * G} height={r.h * G} fill="color-mix(in srgb, var(--accent-blue) 12%, transparent)" stroke="var(--accent-blue)" strokeWidth={2} strokeDasharray="8 5" /> : null;
              })}
            </g>
          )}
          {construct && Object.values(shown.rooms).map((r) => r.doors.map((d) => {
            const dd = clampDoor(r, d);
            const horiz = d.side === 'n' || d.side === 's';
            const x = horiz ? (r.x + dd.offset) * G : (d.side === 'w' ? r.x : r.x + r.w) * G - 5;
            const y = horiz ? (d.side === 'n' ? r.y : r.y + r.h) * G - 5 : (r.y + dd.offset) * G;
            const sel = selection.kind === 'door' && selection.doorId === d.id;
            return <rect key={d.id} data-kind="door" data-room={r.id} data-door={d.id} x={x} y={y} width={horiz ? dd.width * G : 10} height={horiz ? 10 : dd.width * G} rx={3} className={`door-handle${sel ? ' sel' : ''}`} />;
          }))}
          {!moving && selFurnIds.map((id) => { const f = shown.furniture[id]; const r = f && shown.rooms[f.roomId]; if (!r) return null; const fp = footprint(f); return <rect key={id} x={(r.x + f.x) * G - 2} y={(r.y + f.y) * G - 2} width={fp.w * G + 4} height={fp.h * G + 4} fill="none" stroke={id === selFurniture?.id ? 'var(--accent)' : 'var(--accent-blue)'} strokeWidth={2} strokeDasharray="4 3" pointerEvents="none" />; })}
          {movingShapes.length > 0 && <g pointerEvents="none">{movingShapes.map((m) => <FurnitureShape key={m.f.id} f={m.f} x={m.x} y={m.y} w={m.fp.w} h={m.fp.h} ghost={m.ok ? 'ok' : 'bad'} />)}</g>}
          {ghost && <g pointerEvents="none"><FurnitureShape f={{ type: ghost.type, color: FURNITURE_META[ghost.type].color }} x={ghost.room.x + ghost.x} y={ghost.room.y + ghost.y} w={ghost.fp.w} h={ghost.fp.h} ghost={ghost.check.ok ? 'ok' : 'bad'} /><text x={(ghost.room.x + ghost.x) * G} y={(ghost.room.y + ghost.y) * G - 5} className="room-label" fill={ghost.check.ok ? 'var(--accent)' : 'var(--danger)'}>{FURNITURE_META[ghost.type].label}{ghost.check.ok ? '' : ghost.check.blocksDoor ? ' · blocks door' : ' · overlaps'}</text></g>}
          {guides && <g pointerEvents="none" stroke="var(--accent-blue)" strokeWidth={1} strokeDasharray="3 3" opacity={0.8}>{guides.xs.map((x) => <line key={`gx${x}`} x1={x * G} x2={x * G} y1={guides.room.y * G} y2={(guides.room.y + guides.room.h) * G} />)}{guides.ys.map((y) => <line key={`gy${y}`} y1={y * G} y2={y * G} x1={guides.room.x * G} x2={(guides.room.x + guides.room.w) * G} />)}</g>}
          {drag?.type === 'marquee' && <rect x={Math.min(drag.start.x, drag.cur.x) * G} y={Math.min(drag.start.y, drag.cur.y) * G} width={Math.abs(drag.cur.x - drag.start.x) * G} height={Math.abs(drag.cur.y - drag.start.y) * G} fill="color-mix(in srgb, var(--accent-blue) 10%, transparent)" stroke="var(--accent-blue)" strokeDasharray="5 4" pointerEvents="none" />}
          {construct && selRoom && HANDLES.map((h) => {
            const hx = h.includes('w') ? selRoom.x : h.includes('e') ? selRoom.x + selRoom.w : selRoom.x + selRoom.w / 2;
            const hy = h.includes('n') ? selRoom.y : h.includes('s') ? selRoom.y + selRoom.h : selRoom.y + selRoom.h / 2;
            return <rect key={h} data-kind="handle" data-h={h} x={hx * G - 6} y={hy * G - 6} width={12} height={12} className={`handle h-${h}`} />;
          })}
          {selCorridor && construct && selCorridor.points.length > 1 && corridorPx(selCorridor).slice(0, -1).map((p, i, arr) => {
            const q = corridorPx(selCorridor)[i + 1];
            void arr;
            const mx = (p.x + q.x) / 2, my = (p.y + q.y) / 2;
            const horiz = p.y === q.y;
            return <rect key={i} data-kind="seg" data-index={i} x={mx - (horiz ? 10 : 6)} y={my - (horiz ? 6 : 10)} width={horiz ? 20 : 12} height={horiz ? 12 : 20} rx={4} className="seg-handle" style={{ cursor: horiz ? 'ns-resize' : 'ew-resize' }} />;
          })}
          {selCorridor && corridorPx(selCorridor).map((p, i) => <circle key={`pt${i}`} cx={p.x} cy={p.y} r={4} className="route-point" pointerEvents="none" />)}
          {drag?.type === 'create' && (() => {
            const x = Math.min(drag.start.x, drag.cur.x), y = Math.min(drag.start.y, drag.cur.y);
            const w = Math.abs(drag.cur.x - drag.start.x) + 1, h = Math.abs(drag.cur.y - drag.start.y) + 1;
            const bad = Object.values(doc.rooms).some((r) => rectsOverlap({ x, y, w, h }, r)) || w < 3 || h < 3;
            return <g pointerEvents="none"><rect x={x * G} y={y * G} width={w * G} height={h * G} fill={bad ? 'color-mix(in srgb, var(--danger) 15%, transparent)' : 'color-mix(in srgb, var(--accent) 12%, transparent)'} stroke={bad ? 'var(--danger)' : 'var(--accent)'} strokeDasharray="6 4" strokeWidth={2} /><text x={x * G + 6} y={y * G - 6} className="room-label" fill="var(--accent)">{w}×{h}</text></g>;
          })()}
          {drag?.type === 'rooms' && drag.moved && drag.ids.map((id) => { const r = doc.rooms[id]; return <rect key={id} x={r.x * G} y={r.y * G} width={r.w * G} height={r.h * G} fill="none" stroke="var(--muted)" strokeDasharray="4 4" pointerEvents="none" />; })}
          {(drag?.type === 'rooms' || drag?.type === 'resize') && selRoom && <text x={selRoom.x * G} y={selRoom.y * G - 8} className="room-label" fill={overlapping.size ? 'var(--danger)' : 'var(--accent)'}>{`x ${selRoom.x}  y ${selRoom.y}  ${selRoom.w}×${selRoom.h}${overlapping.size ? '  OVERLAP' : ''}`}</text>}
          {layers.paths && <AgentPaths />}
          <AgentsLayer view={view} />
          <CapsulesLayer />
          {hallwayDraft && doc.rooms[hallwayDraft.roomId] && <rect x={doc.rooms[hallwayDraft.roomId].x * G - 4} y={doc.rooms[hallwayDraft.roomId].y * G - 4} width={doc.rooms[hallwayDraft.roomId].w * G + 8} height={doc.rooms[hallwayDraft.roomId].h * G + 8} fill="none" stroke="var(--accent-blue)" strokeWidth={3} strokeDasharray="10 6" className="march" pointerEvents="none" />}
        </g>
      </svg>
      <div className="scanlines" aria-hidden />
      {menu && <ContextMenu {...menu} onClose={() => setMenu(null)} />}
      <Minimap width={size.w} height={size.h} />
      <SimplifiedBadge view={view} />
      <div className="zoom-ctl" role="group" aria-label="Zoom">
        <button onClick={() => setUi({ camera: { ...camera, zoom: Math.min(3, camera.zoom * 1.2) } })} aria-label="Zoom in">+</button>
        <span>{Math.round(camera.zoom * 100)}%</span>
        <button onClick={() => setUi({ camera: { ...camera, zoom: Math.max(0.2, camera.zoom / 1.2) } })} aria-label="Zoom out">−</button>
        <button onClick={() => window.dispatchEvent(new Event('ao-fit'))} aria-label="Fit office to view">Fit</button>
      </div>
    </div>
  );
}

/** Move one segment of an orthogonal route perpendicular to itself, keeping the ends attached. */
export function segmentMove(points: Point[], index: number, d: number, horizontal: boolean): Point[] {
  const pts = points.map((p) => ({ ...p }));
  let i = index;
  // moving the first/last segment would detach a door: insert a stub so the end stays put
  if (i === 0) { pts.unshift({ ...pts[0] }); i = 1; }
  if (i + 1 === pts.length - 1) pts.push({ ...pts[pts.length - 1] });
  if (horizontal) { pts[i].y += d; pts[i + 1].y += d; } else { pts[i].x += d; pts[i + 1].x += d; }
  return pts;
}

function SimplifiedBadge({ view }: { view: Rect }) {
  const { simple, visible, limit } = useSimplified(view);
  if (!simple) return null;
  return <div className="lod-badge" role="status" title={`More than ${limit} agents are visible, so characters are drawn as simple markers. Zoom in or change the limit in Settings → Office.`}>Simplified view · {visible} agents</div>;
}
