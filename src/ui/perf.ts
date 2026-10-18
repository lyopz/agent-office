// Lightweight performance counters for the diagnostics panel. Nothing here
// touches React state on the hot path; the panel polls these numbers.
type Sample = { at: number; ms: number };
const series: Record<string, Sample[]> = {};
export const perfCounts: Record<string, number> = {};
let frames: number[] = [];

export function markFrame(kind: string, ms: number, counts?: Record<string, number>) {
  const now = performance.now();
  if (kind === 'render') frames.push(now);
  else (series[kind] ??= []).push({ at: now, ms });
  if (counts) Object.assign(perfCounts, counts);
  if (frames.length > 240) frames = frames.slice(-120);
  for (const k of Object.keys(series)) if (series[k].length > 200) series[k] = series[k].slice(-100);
}

export function perfSnapshot() {
  const now = performance.now();
  const recent = frames.filter((t) => now - t < 1000);
  const stat = (k: string) => {
    const xs = (series[k] ?? []).slice(-50).map((s) => s.ms);
    if (!xs.length) return null;
    const sorted = xs.slice().sort((a, b) => a - b);
    return { last: xs[xs.length - 1], avg: xs.reduce((a, b) => a + b, 0) / xs.length, p95: sorted[Math.floor(sorted.length * 0.95)] ?? sorted[sorted.length - 1], n: xs.length };
  };
  return { rendersPerSec: recent.length, viewport: stat('viewport'), commit: stat('commit'), tick: stat('tick'), counts: { ...perfCounts } };
}
