// Blender-rendered character sprites for the office view.
// Each sprite sheet is an 8-frame strip rendered by tools/blender/build_characters.py
// --sprites. A sheet belongs to one exact look: it is keyed by a hash of the
// appearance fields Blender draws, so editing a character's look falls back to
// the drawn character until it is rendered again, rather than showing a stale picture.
import { create } from 'zustand';
import type { Appearance } from '../model/types';
import { assetStore } from '../persistence/repository';

export const SPRITE_FRAMES = ['idle', 'walk0', 'walk1', 'walk2', 'walk3', 'sit', 'talk', 'work'] as const;
export type SpriteFrame = (typeof SPRITE_FRAMES)[number];
export const SPRITE_W = 128, SPRITE_H = 192;

// fields that only affect animation timing or the 2D drawing, not the rendered model
const IGNORED: (keyof Appearance)[] = ['facing', 'preferredView', 'animationSpeed', 'idlePose', 'walkPose', 'workPose', 'outline', 'artStyle', 'shading'];

function stable(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stable).join(',')}]`;
  if (v && typeof v === 'object') return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${stable((v as Record<string, unknown>)[k])}`).join(',')}}`;
  return JSON.stringify(v);
}

/** Short, stable key for the look Blender renders. */
export function lookKey(a: Appearance): string {
  const o: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(a)) if (!IGNORED.includes(k as keyof Appearance)) o[k] = v;
  const s = stable(o);
  let h1 = 0x811c9dc5, h2 = 0x01000193;
  for (let i = 0; i < s.length; i++) { const c = s.charCodeAt(i); h1 = Math.imul(h1 ^ c, 16777619); h2 = Math.imul(h2 ^ c, 2246822519); }
  return ((h1 >>> 0).toString(36) + (h2 >>> 0).toString(36)).slice(0, 12);
}

// sheets that ship with the app: src/characters/renders/<lookKey>.webp
const BUNDLED: Record<string, string> = Object.fromEntries(
  Object.entries(import.meta.glob('./renders/*.webp', { eager: true, query: '?url', import: 'default' }) as Record<string, string>)
    .map(([path, url]) => [path.split('/').pop()!.replace(/\.webp$/, ''), url]),
);

const LS = 'agent-office:sprites';
const loadKeys = (): string[] => { try { return JSON.parse(localStorage.getItem(LS) ?? '[]'); } catch { return []; } };

/** Sheets imported from the owner's own Blender renders, kept in the local asset store. */
export const useSpriteLibrary = create<{ imported: Set<string>; add: (key: string, dataUrl: string) => Promise<void> }>((set, get) => ({
  imported: new Set(loadKeys()),
  async add(key, dataUrl) {
    await assetStore.put(`sprite_${key}`, dataUrl);
    const next = new Set(get().imported); next.add(key);
    try { localStorage.setItem(LS, JSON.stringify([...next])); } catch { /* storage full: still usable this session */ }
    set({ imported: next });
  },
}));

export function bundledSprite(key: string) { return BUNDLED[key] ?? null; }
export function hasSprite(a: Appearance) { const k = lookKey(a); return !!BUNDLED[k] || useSpriteLibrary.getState().imported.has(k); }
export const bundledSpriteCount = () => Object.keys(BUNDLED).length;

export function frameFor(status: string, atDesk: boolean, walkFrame: number): SpriteFrame {
  if (status === 'walking') return SPRITE_FRAMES[1 + (walkFrame % 4)];
  if (status === 'working') return atDesk ? 'sit' : 'work';
  if (status === 'communicating') return 'talk';
  return 'idle';
}
