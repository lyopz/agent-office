import { useStore } from '../store/store';
import { boundsOf } from '../engine/geometry';
import { G, corridorPx } from './OfficeLayers';

const W = 180, H = 120;

export function Minimap({ width, height }: { width: number; height: number }) {
  const doc = useStore((s) => s.doc);
  const cam = useStore((s) => s.camera);
  const agents = useStore((s) => s.runtime.agents);
  const rooms = Object.values(doc.rooms);
  const b = boundsOf(rooms, 4);
  const sc = Math.min(W / (b.w * G), H / (b.h * G));
  const ox = (W - b.w * G * sc) / 2 - b.x * G * sc, oy = (H - b.h * G * sc) / 2 - b.y * G * sc;
  // visible world rect
  const vx = -cam.x / cam.zoom, vy = -cam.y / cam.zoom, vw = width / cam.zoom, vh = height / cam.zoom;
  const jump = (e: React.PointerEvent<SVGSVGElement>) => {
    if (e.buttons !== 1 && e.type !== 'pointerdown') return;
    const r = e.currentTarget.getBoundingClientRect();
    const wx = (e.clientX - r.left - ox) / sc, wy = (e.clientY - r.top - oy) / sc;
    useStore.getState().setUi({ camera: { ...cam, x: -(wx - vw / 2) * cam.zoom, y: -(wy - vh / 2) * cam.zoom } });
  };
  return (
    <svg className="minimap" width={W} height={H} onPointerDown={jump} onPointerMove={jump} aria-label="Minimap: click to navigate" role="img">
      <rect width={W} height={H} fill="rgba(0,0,0,.75)" />
      <g transform={`translate(${ox} ${oy}) scale(${sc})`}>
        {Object.values(doc.corridors).map((c) => c.points.length > 1 && <polyline key={c.id} points={corridorPx(c).map((p) => `${p.x},${p.y}`).join(' ')} fill="none" stroke="var(--hall-edge)" strokeWidth={c.width * G} />)}
        {rooms.map((r) => <rect key={r.id} x={r.x * G} y={r.y * G} width={r.w * G} height={r.h * G} fill="var(--panel-2)" stroke={r.appearance.accent} strokeWidth={G / 3} />)}
        {Object.entries(agents).map(([id, a]) => <circle key={id} cx={(a.pos.x + 0.5) * G} cy={(a.pos.y + 0.5) * G} r={G * 0.6} fill={doc.agents[id]?.appearance.accent ?? 'var(--accent)'} />)}
        <rect x={vx} y={vy} width={vw} height={vh} fill="rgba(57,255,136,.06)" stroke="var(--accent)" strokeWidth={2 / sc} />
      </g>
    </svg>
  );
}
