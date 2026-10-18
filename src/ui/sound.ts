// Alert sounds, synthesised with Web Audio so nothing has to download, plus
// uploaded custom sounds. Browsers block audio until the user interacts with
// the page; until then deliveries are recorded as "permission needed".
import { assetStore } from '../persistence/repository';
import { setDeliveryEnv } from '../engine/alerts';

let ctx: AudioContext | null = null;
let unlocked = false;
const listeners = new Set<() => void>();
export const onSoundState = (f: () => void) => { listeners.add(f); return () => { listeners.delete(f); }; };
export const soundUnlocked = () => unlocked;

export async function unlockAudio(): Promise<boolean> {
  try {
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return false;
    ctx ??= new AC();
    if (ctx.state === 'suspended') await ctx.resume();
    unlocked = ctx.state === 'running';
  } catch { unlocked = false; }
  setDeliveryEnv({ soundUnlocked: unlocked });
  listeners.forEach((f) => f());
  return unlocked;
}

/** Unlock on the first click or key press anywhere: that counts as the user's permission gesture. */
export function installAudioUnlock() {
  setDeliveryEnv({ soundUnlocked: false, desktopPermission: desktopPermission() });
  const once = () => { unlockAudio(); window.removeEventListener('pointerdown', once); window.removeEventListener('keydown', once); };
  window.addEventListener('pointerdown', once); window.addEventListener('keydown', once);
}

export function desktopPermission(): 'granted' | 'denied' | 'default' | 'unsupported' {
  return typeof Notification === 'undefined' ? 'unsupported' : Notification.permission;
}
export async function requestDesktop() {
  if (typeof Notification === 'undefined') return 'unsupported';
  const p = await Notification.requestPermission().catch(() => 'denied' as NotificationPermission);
  setDeliveryEnv({ desktopPermission: p });
  listeners.forEach((f) => f());
  return p;
}

type Note = { f: number; t: number; d: number; type?: OscillatorType; to?: number };
const PATTERNS: Record<string, Note[]> = {
  subtle: [{ f: 880, t: 0, d: 0.12 }, { f: 1320, t: 0.13, d: 0.16 }],
  blocked: [{ f: 660, t: 0, d: 0.18, type: 'triangle' }, { f: 440, t: 0.2, d: 0.26, type: 'triangle' }],
  finance: [0, 0.16, 0.32].map((t) => ({ f: 1040, t, d: 0.07, type: 'square' as OscillatorType })),
  critical: [0, 0.32, 0.64].flatMap((t) => [{ f: 880, t, d: 0.15, type: 'sawtooth' as OscillatorType }, { f: 660, t: t + 0.16, d: 0.15, type: 'sawtooth' as OscillatorType }]),
  ping: [{ f: 1500, t: 0, d: 0.1, to: 1200 }],
};

/** Play a built-in or uploaded sound. Returns false if the browser hasn't allowed audio yet. */
export async function playSound(id: string, volume: number, custom: { id: string; assetId: string }[] = []): Promise<boolean> {
  if (id === 'none') return true;
  if (!unlocked || !ctx) return false;
  const c = custom.find((x) => x.id === id);
  if (c) {
    const url = await assetStore.get(c.assetId); if (!url) return false;
    const el = new Audio(url); el.volume = Math.max(0, Math.min(1, volume));
    try { await el.play(); return true; } catch { return false; }
  }
  const notes = PATTERNS[id] ?? PATTERNS.subtle;
  const now = ctx.currentTime + 0.02;
  for (const n of notes) {
    const o = ctx.createOscillator(); const g = ctx.createGain();
    o.type = n.type ?? 'sine'; o.frequency.setValueAtTime(n.f, now + n.t);
    if (n.to) o.frequency.linearRampToValueAtTime(n.to, now + n.t + n.d);
    const peak = Math.max(0.0001, 0.25 * volume);
    g.gain.setValueAtTime(0.0001, now + n.t); g.gain.exponentialRampToValueAtTime(peak, now + n.t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, now + n.t + n.d);
    o.connect(g).connect(ctx.destination); o.start(now + n.t); o.stop(now + n.t + n.d + 0.02);
  }
  return true;
}
