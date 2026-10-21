// Interface themes: they style the app chrome. Brain Red is the default so every page matches the brain.
import type { AppearanceSettings, ThemeDef, ThemeTokens } from './types';

interface Seed { id: string; name: string; accent: string; accent2: string; bg: string; panel: string; text: string; lightBg: string; lightAccent: string }

const SEEDS: Seed[] = [
  // the brain's own look, and the default: the whole app matches the brain page
  { id: 'brain-red', name: 'Brain Red', accent: '#ff354f', accent2: '#5bcfff', bg: '#070708', panel: '#0d0c0e', text: '#f4edf0', lightBg: '#f6f0f1', lightAccent: '#b4142c' },
  { id: 'obsidian-green', name: 'Obsidian Green', accent: '#39ff88', accent2: '#4cc9ff', bg: '#030605', panel: '#070c0a', text: '#d9f7e6', lightBg: '#eef3ef', lightAccent: '#0f7a45' },
  { id: 'titanium-cyan', name: 'Titanium Cyan', accent: '#4cd6ff', accent2: '#a7b4c2', bg: '#0b0e12', panel: '#11161c', text: '#e2ecf4', lightBg: '#eef2f5', lightAccent: '#0b6f94' },
  { id: 'cyberpunk-violet', name: 'Cyberpunk Violet', accent: '#c07bff', accent2: '#ff6fb5', bg: '#0a0612', panel: '#120a1e', text: '#efe4ff', lightBg: '#f4f0f8', lightAccent: '#7a32c4' },
  { id: 'industrial-amber', name: 'Industrial Amber', accent: '#ffb347', accent2: '#ff7a3d', bg: '#0d0a06', panel: '#15110a', text: '#f6ead8', lightBg: '#f6f2ea', lightAccent: '#9a5a00' },
  { id: 'arctic-blue', name: 'Arctic Blue', accent: '#7cc7ff', accent2: '#c8e6ff', bg: '#070b12', panel: '#0d1420', text: '#e6f1ff', lightBg: '#f0f5fb', lightAccent: '#1f5fa8' },
  { id: 'classic-terminal', name: 'Classic Terminal', accent: '#33ff33', accent2: '#ffcc00', bg: '#000000', panel: '#050805', text: '#c8ffc8', lightBg: '#f2f5f0', lightAccent: '#1d6b1d' },
  { id: 'warm-executive', name: 'Warm Executive', accent: '#d4a84a', accent2: '#e8d5b0', bg: '#0e0c0a', panel: '#171410', text: '#f2ebe0', lightBg: '#f7f3ec', lightAccent: '#8a6420' },
  { id: 'monochrome-minimal', name: 'Monochrome Minimal', accent: '#e8e8e8', accent2: '#9a9a9a', bg: '#0a0a0a', panel: '#121212', text: '#ededed', lightBg: '#f4f4f4', lightAccent: '#2a2a2a' },
];

function hex(n: number) { return Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0'); }
export function parseHex(c: string): [number, number, number] | null {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(c.trim());
  if (!m) return null;
  const s = m[1].length === 3 ? m[1].split('').map((x) => x + x).join('') : m[1];
  return [parseInt(s.slice(0, 2), 16), parseInt(s.slice(2, 4), 16), parseInt(s.slice(4, 6), 16)];
}
export function mix(a: string, b: string, t: number) {
  const x = parseHex(a), y = parseHex(b);
  if (!x || !y) return a;
  return `#${hex(x[0] + (y[0] - x[0]) * t)}${hex(x[1] + (y[1] - x[1]) * t)}${hex(x[2] + (y[2] - x[2]) * t)}`;
}

/** WCAG relative luminance contrast ratio between two colours (1..21). */
export function contrast(a: string, b: string): number {
  const lum = (c: string) => {
    const p = parseHex(c); if (!p) return 0;
    const [r, g, bl] = p.map((v) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; });
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
  };
  const [l1, l2] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (l1 + 0.05) / (l2 + 0.05);
}

function fromSeed(s: Seed): ThemeDef {
  const dark: ThemeTokens = {
    bg: s.bg, bg2: mix(s.bg, s.panel, 0.5), panel: s.panel, accent: s.accent, accent2: s.accent2, text: s.text,
    border: mix(s.panel, s.accent, 0.28), selection: mix(s.panel, s.accent, 0.35),
    success: '#39d98a', warning: '#ffd166', error: '#ff5d73', highlight: s.accent2,
  };
  const light: ThemeTokens = {
    bg: s.lightBg, bg2: mix(s.lightBg, '#ffffff', 0.5), panel: '#ffffff', accent: s.lightAccent, accent2: mix(s.accent2, '#000000', 0.35), text: '#14181a',
    border: mix('#ffffff', s.lightAccent, 0.25), selection: mix('#ffffff', s.lightAccent, 0.18),
    success: '#16794a', warning: '#8a5a00', error: '#b4232f', highlight: mix(s.accent2, '#000000', 0.25),
  };
  return { id: s.id, name: s.name, builtin: true, dark, light };
}

export const BUILTIN_THEMES: ThemeDef[] = SEEDS.map(fromSeed);

export function defaultAppearanceSettings(): AppearanceSettings {
  return { mode: 'dark', themeId: 'brain-red', themes: BUILTIN_THEMES.map((t) => JSON.parse(JSON.stringify(t))), brainColors: {} };
}

export function resolveMode(mode: AppearanceSettings['mode'], prefersDark: boolean): 'dark' | 'light' {
  return mode === 'system' ? (prefersDark ? 'dark' : 'light') : mode;
}

export function activeTheme(s: AppearanceSettings): ThemeDef {
  return s.themes.find((t) => t.id === s.themeId) ?? s.themes[0] ?? BUILTIN_THEMES[0];
}

export interface ContrastIssue { pair: string; ratio: number; min: number }
/** Checks text and interactive colours stay legible (WCAG AA: 4.5 text, 3 for UI accents). */
export function contrastIssues(t: ThemeTokens): ContrastIssue[] {
  const checks: [string, string, string, number][] = [
    ['Text on background', t.text, t.bg, 4.5], ['Text on panels', t.text, t.panel, 4.5],
    ['Accent on background', t.accent, t.bg, 3], ['Accent on panels', t.accent, t.panel, 3],
    ['Error on panels', t.error, t.panel, 3], ['Warning on panels', t.warning, t.panel, 3], ['Success on panels', t.success, t.panel, 3],
  ];
  return checks.map(([pair, a, b, min]) => ({ pair, ratio: contrast(a, b), min })).filter((c) => c.ratio < c.min);
}

/** CSS custom properties for the interface. */
export function themeVars(t: ThemeTokens, mode: 'dark' | 'light'): Record<string, string> {
  const dark = mode === 'dark';
  const raise = (k: number) => mix(t.panel, t.text, k);
  return {
    '--bg': t.bg, '--panel': t.panel, '--panel-2': dark ? mix(t.panel, t.bg2, 0.6) : t.bg2, '--panel-3': raise(dark ? 0.05 : 0.04), '--raised': raise(dark ? 0.09 : 0.07),
    '--border': t.border, '--border-strong': mix(t.border, t.accent, 0.5),
    '--text': t.text, '--text-dim': mix(t.text, t.panel, 0.22), '--muted': mix(t.text, t.panel, 0.42), '--muted-2': mix(t.text, t.panel, 0.65),
    '--accent': t.accent, '--accent-dim': mix(t.accent, t.panel, 0.45), '--accent-blue': t.accent2, '--accent-orange': dark ? '#ff9f43' : '#a8520a', '--accent-purple': dark ? '#b57bff' : '#6b2fb0',
    '--danger': t.error, '--warn': t.warning, '--success': t.success, '--focus': t.highlight, '--selection': t.selection, '--highlight': t.highlight,
    '--label-bg': dark ? 'rgba(0,0,0,.65)' : 'rgba(255,255,255,.85)',
    '--scanline': dark ? 'rgba(0,0,0,.18)' : 'rgba(0,0,0,0)',
    'color-scheme': mode,
  };
}

/**
 * Saves made before Brain Red existed (2026-10-21) carried the old green default. They get the new
 * theme added, and switch to it when the old default was still in use; a theme the owner chose stays.
 */
export function withBrainTheme(s: AppearanceSettings): AppearanceSettings {
  if (s.themes.some((t) => t.id === 'brain-red')) return s;
  const brain = JSON.parse(JSON.stringify(BUILTIN_THEMES[0])) as ThemeDef;
  return { ...s, themes: [brain, ...s.themes], themeId: s.themeId === 'obsidian-green' ? 'brain-red' : s.themeId };
}
