// Real resource measurements only. The browser can report this tab's JS heap
// (Chromium) and the device's core count; system RAM, CPU and GPU figures need
// the local Blender bridge, which reads them from the operating system. Anything
// that can't be measured is reported as unavailable, never estimated.
import { useEffect, useState } from 'react';

export interface BrowserMetrics { heapUsedMb: number | null; heapLimitMb: number | null; deviceMemoryGb: number | null; cores: number | null }
export interface BridgeMetrics {
  ram: { usedMb: number; totalMb: number }; cpu: { utilPct: number | null; cores: number };
  gpu: { name: string; memUsedMb: number; memTotalMb: number; utilPct: number }[] | null;
  blenderJobs: number; measuredAt: string;
}
export interface BridgeJob { id: string; kind: 'render' | 'export' | 'characters'; file?: string; output?: string; outputs?: string[]; status: 'running' | 'cancelling' | 'completed' | 'failed' | 'cancelled'; startedAt: string; endedAt: string | null; log: string }
export interface BridgeState { status: 'off' | 'checking' | 'connected' | 'unreachable'; blender: string | null; metrics: BridgeMetrics | null; jobs: BridgeJob[]; error?: string }

export function browserMetrics(): BrowserMetrics {
  const mem = (performance as unknown as { memory?: { usedJSHeapSize: number; jsHeapSizeLimit: number } }).memory;
  const nav = navigator as Navigator & { deviceMemory?: number };
  return {
    heapUsedMb: mem ? Math.round(mem.usedJSHeapSize / 1048576) : null,
    heapLimitMb: mem ? Math.round(mem.jsHeapSizeLimit / 1048576) : null,
    deviceMemoryGb: nav.deviceMemory ?? null,
    cores: nav.hardwareConcurrency || null,
  };
}

async function getJson<T>(url: string): Promise<T> {
  const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 4000);
  try { const r = await fetch(url, { signal: ctl.signal }); if (!r.ok) throw new Error(`HTTP ${r.status}`); return await r.json() as T; }
  finally { clearTimeout(t); }
}

export async function bridgeRequest<T>(base: string, path: string, body?: unknown): Promise<T> {
  const r = await fetch(base.replace(/\/$/, '') + path, body ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : undefined);
  const data = await r.json();
  if (!r.ok) throw new Error((data as { error?: string }).error ?? `HTTP ${r.status}`);
  return data as T;
}

/** Polls the bridge while a URL is configured and the page is visible. */
export function useBridge(url: string, everyMs = 5000): BridgeState & { refresh: () => void } {
  const [st, setSt] = useState<BridgeState>({ status: url ? 'checking' : 'off', blender: null, metrics: null, jobs: [] });
  const [nonce, setNonce] = useState(0);
  useEffect(() => {
    if (!url) { setSt({ status: 'off', blender: null, metrics: null, jobs: [] }); return; }
    const base = url.replace(/\/$/, '');
    let live = true;
    const poll = async () => {
      if (document.hidden) return;
      try {
        const [h, metrics, jobs] = await Promise.all([getJson<{ blender: string | null }>(`${base}/health`), getJson<BridgeMetrics>(`${base}/metrics`), getJson<BridgeJob[]>(`${base}/jobs`)]);
        if (live) setSt({ status: 'connected', blender: h.blender, metrics, jobs });
      } catch (e) { if (live) setSt((s) => ({ ...s, status: 'unreachable', error: (e as Error).message })); }
    };
    poll();
    const t = setInterval(poll, everyMs);
    return () => { live = false; clearInterval(t); };
  }, [url, everyMs, nonce]);
  return { ...st, refresh: () => setNonce((n) => n + 1) };
}

export function useBrowserMetrics(everyMs = 2000) {
  const [m, setM] = useState(browserMetrics);
  useEffect(() => { const t = setInterval(() => setM(browserMetrics()), everyMs); return () => clearInterval(t); }, [everyMs]);
  return m;
}
