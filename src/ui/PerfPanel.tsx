// Performance diagnostics: frame rate, commit and simulation timings, and
// what the viewport is drawing. Polls counters so it never slows the hot path.
import { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { useStore } from '../store/store';
import { perfSnapshot } from './perf';

function useFps() {
  const [fps, setFps] = useState(0);
  useEffect(() => {
    let frames = 0, raf = 0, last = performance.now();
    const loop = (t: number) => { frames++; if (t - last >= 1000) { setFps(Math.round((frames * 1000) / (t - last))); frames = 0; last = t; } raf = requestAnimationFrame(loop); };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);
  return fps;
}

export function PerfPanel() {
  const fps = useFps();
  const [snap, setSnap] = useState(perfSnapshot());
  const doc = useStore((s) => s.doc);
  const { setLayer } = useStore.getState();
  useEffect(() => { const t = setInterval(() => setSnap(perfSnapshot()), 500); return () => clearInterval(t); }, []);
  const assets = Object.values(doc.agents).reduce((n, a) => n + Object.values(a.assets).filter(Boolean).length, 0);
  const docKb = Math.round(JSON.stringify(doc).length / 1024);
  const fmt = (x: { last: number; avg: number; p95: number } | null) => (x ? `${x.last.toFixed(1)} ms (avg ${x.avg.toFixed(1)}, p95 ${x.p95.toFixed(1)})` : '—');
  const rows: [string, string, boolean?][] = [
    ['Frame rate', `${fps} fps`, fps > 0 && fps < 30],
    ['Viewport renders', `${snap.rendersPerSec}/s`],
    ['Last edit commit', fmt(snap.commit), (snap.commit?.p95 ?? 0) > 50],
    ['Simulation tick', fmt(snap.tick), (snap.tick?.p95 ?? 0) > 16],
    ['Rooms drawn', `${snap.counts.rooms ?? '—'} of ${snap.counts.totalRooms ?? Object.keys(doc.rooms).length} (rest culled)`],
    ['Objects', String(Object.keys(doc.furniture).length)],
    ['Agents · tasks', `${Object.keys(doc.agents).length} · ${snap.counts.tasks ?? 0}`],
    ['Hallways', String(Object.keys(doc.corridors).length)],
    ['Uploaded images', String(assets)],
    ['Office file size', `${docKb} KB`, docKb > 2000],
  ];
  return (
    <aside className="perf-panel" aria-label="Performance diagnostics">
      <div className="panel-h row"><span>Performance</span><span className="spacer" /><button className="btn icon sm" aria-label="Close diagnostics" onClick={() => setLayer('perf', false)}><X size={13} /></button></div>
      <table className="kv"><tbody>{rows.map(([k, v, bad]) => <tr key={k}><td className="muted">{k}</td><td style={{ color: bad ? 'var(--warn)' : undefined }}>{v}</td></tr>)}</tbody></table>
      <p className="note">Drags move a preview only; the office is recalculated once on drop.</p>
    </aside>
  );
}
