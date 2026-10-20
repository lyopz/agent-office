// A turntable 3D preview of one appearance. The three.js renderer is loaded on
// demand (dynamic import) so the 2D app doesn't pay for it until a preview is shown.
import { useEffect, useRef, useState } from 'react';
import type { Appearance } from '../model/types';
import type { PreviewHandle } from './previewRenderer';
import './hq3d.css';

export interface AvatarPreview3DProps { appearance: Appearance; height?: number; autoRotate?: boolean; label?: string }

const reducedMotion = () => typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

export function AvatarPreview3D({ appearance, height = 320, autoRotate, label }: AvatarPreview3DProps) {
  const wrap = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const handle = useRef<PreviewHandle | null>(null);
  const latest = useRef(appearance); latest.current = appearance;
  const [failed, setFailed] = useState(false);
  const rotate = autoRotate ?? !reducedMotion();
  const rotRef = useRef(rotate); rotRef.current = rotate;

  useEffect(() => {
    let alive = true;
    import('./previewRenderer').then(({ createPreview }) => {
      if (!alive || !canvas.current || !wrap.current) return;
      const h = createPreview(canvas.current, wrap.current, latest.current, { autoRotate: rotRef.current, reduced: reducedMotion() });
      if (!h) { setFailed(true); return; }
      handle.current = h;
    }).catch(() => setFailed(true));
    return () => { alive = false; handle.current?.dispose(); handle.current = null; };
  }, []);
  useEffect(() => { handle.current?.setAppearance(appearance); }, [appearance]);
  useEffect(() => { handle.current?.setAutoRotate(rotate); }, [rotate]);

  const drag = useRef<number | null>(null);
  return (
    <div
      ref={wrap} className="avatar-preview-3d" style={{ height }} role="img" aria-label={label ?? 'Avatar preview'}
      tabIndex={0}
      onKeyDown={(e) => { if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { e.preventDefault(); e.stopPropagation(); handle.current?.rotateBy(e.key === 'ArrowLeft' ? -0.3 : 0.3); } }}
      onPointerDown={(e) => { drag.current = e.clientX; try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* synthetic */ } }}
      onPointerMove={(e) => { if (drag.current === null) return; handle.current?.rotateBy((e.clientX - drag.current) * 0.012); drag.current = e.clientX; }}
      onPointerUp={() => { drag.current = null; }}
      onPointerCancel={() => { drag.current = null; }}
    >
      <canvas ref={canvas} aria-hidden="true" />
      {failed && <div className="ap-fallback">3D preview needs WebGL</div>}
    </div>
  );
}

export default AvatarPreview3D;
