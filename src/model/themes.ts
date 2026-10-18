// Interface themes and room palettes. Interface themes style the app chrome and
// the default office surfaces; room palettes style one room. Characters keep
// their own explicit colours, so no theme ever changes how an agent looks.
import type { AppearanceSettings, OfficeColors, RoomAppearance, ThemeDef, ThemeTokens } from './types';

interface Seed { id: string; name: string; accent: string; accent2: string; bg: string; panel: string; text: string; floor: string; wall: string; lightBg: string; lightAccent: string }

const SEEDS: Seed[] = [
  { id: 'obsidian-green', name: 'Obsidian Green', accent: '#39ff88', accent2: '#4cc9ff', bg: '#030605', panel: '#070c0a', text: '#d9f7e6', floor: '#08120d', wall: '#1f6f45', lightBg: '#eef3ef', lightAccent: '#0f7a45' },
  { id: 'titanium-cyan', name: 'Titanium Cyan', accent: '#4cd6ff', accent2: '#a7b4c2', bg: '#0b0e12', panel: '#11161c', text: '#e2ecf4', floor: '#0e141a', wall: '#3a5566', lightBg: '#eef2f5', lightAccent: '#0b6f94' },
  { id: 'cyberpunk-violet', name: 'Cyberpunk Violet', accent: '#c07bff', accent2: '#ff6fb5', bg: '#0a0612', panel: '#120a1e', text: '#efe4ff', floor: '#120b1c', wall: '#4a2a6e', lightBg: '#f4f0f8', lightAccent: '#7a32c4' },
  { id: 'industrial-amber', name: 'Industrial Amber', accent: '#ffb347', accent2: '#ff7a3d', bg: '#0d0a06', panel: '#15110a', text: '#f6ead8', floor: '#16110a', wall: '#6e4a1f', lightBg: '#f6f2ea', lightAccent: '#9a5a00' },
  { id: 'arctic-blue', name: 'Arctic Blue', accent: '#7cc7ff', accent2: '#c8e6ff', bg: '#070b12', panel: '#0d1420', text: '#e6f1ff', floor: '#0c1422', wall: '#2c4a72', lightBg: '#f0f5fb', lightAccent: '#1f5fa8' },
  { id: 'classic-terminal', name: 'Classic Terminal', accent: '#33ff33', accent2: '#ffcc00', bg: '#000000', panel: '#050805', text: '#c8ffc8', floor: '#020602', wall: '#1a5c1a', lightBg: '#f2f5f0', lightAccent: '#1d6b1d' },
  { id: 'warm-executive', name: 'Warm Executive', accent: '#d4a84a', accent2: '#e8d5b0', bg: '#0e0c0a', panel: '#171410', text: '#f2ebe0', floor: '#14110d', wall: '#5a4630', lightBg: '#f7f3ec', lightAccent: '#8a6420' },
  { id: 'monochrome-minimal', name: 'Monochrome Minimal', accent: '#e8e8e8', accent2: '#9a9a9a', bg: '#0a0a0a', panel: '#121212', text: '#ededed', floor: '#111111', wall: '#3a3a3a', lightBg: '#f4f4f4', lightAccent: '#2a2a2a' },
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
  const officeDark: OfficeColors = { floor: s.floor, wall: s.wall, door: s.accent, corridor: mix(s.floor, s.accent, 0.06), lighting: s.accent };
  const officeLight: OfficeColors = { floor: mix(s.lightBg, '#c8ccc8', 0.35), wall: mix(s.wall, '#ffffff', 0.25), door: s.lightAccent, corridor: mix(s.lightBg, '#ffffff', 0.6), lighting: '#ffe9b0' };
  return { id: s.id, name: s.name, builtin: true, dark, light, office: { dark: officeDark, light: officeLight } };
}

export const BUILTIN_THEMES: ThemeDef[] = SEEDS.map(fromSeed);

export function defaultAppearanceSettings(): AppearanceSettings {
  return { mode: 'dark', themeId: 'obsidian-green', themes: BUILTIN_THEMES.map((t) => JSON.parse(JSON.stringify(t))) };
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

/** CSS custom properties for the interface + default office surfaces. */
export function themeVars(t: ThemeTokens, o: OfficeColors, mode: 'dark' | 'light'): Record<string, string> {
  const dark = mode === 'dark';
  const raise = (k: number) => mix(t.panel, t.text, k);
  return {
    '--bg': t.bg, '--panel': t.panel, '--panel-2': dark ? mix(t.panel, t.bg2, 0.6) : t.bg2, '--panel-3': raise(dark ? 0.05 : 0.04), '--raised': raise(dark ? 0.09 : 0.07),
    '--border': t.border, '--border-strong': mix(t.border, t.accent, 0.5),
    '--text': t.text, '--text-dim': mix(t.text, t.panel, 0.22), '--muted': mix(t.text, t.panel, 0.42), '--muted-2': mix(t.text, t.panel, 0.65),
    '--accent': t.accent, '--accent-dim': mix(t.accent, t.panel, 0.45), '--accent-blue': t.accent2, '--accent-orange': dark ? '#ff9f43' : '#a8520a', '--accent-purple': dark ? '#b57bff' : '#6b2fb0',
    '--danger': t.error, '--warn': t.warning, '--success': t.success, '--focus': t.highlight, '--selection': t.selection, '--highlight': t.highlight,
    '--floor-grid': o.floor, '--floor-tile': mix(o.floor, t.text, 0.02), '--floor-carpet': mix(o.floor, '#2b3a6b', 0.12), '--floor-metal': mix(o.floor, '#9aa4a8', 0.06),
    '--floor-wood': mix(o.floor, '#8a5a2a', 0.12), '--floor-plain': o.floor,
    '--floor-line': `color-mix(in srgb, ${t.accent} ${dark ? 7 : 14}%, transparent)`,
    '--hall-floor': o.corridor, '--hall-line': `color-mix(in srgb, ${t.accent} ${dark ? 10 : 16}%, transparent)`, '--hall-edge': mix(o.corridor, t.accent, dark ? 0.3 : 0.45),
    '--grid-line': `color-mix(in srgb, ${t.accent} ${dark ? 4.5 : 9}%, transparent)`,
    '--screen': `color-mix(in srgb, ${t.accent} 70%, transparent)`,
    '--wall': o.wall, '--door': o.door, '--light': o.lighting,
    '--label-bg': dark ? 'rgba(0,0,0,.65)' : 'rgba(255,255,255,.85)',
    '--scanline': dark ? 'rgba(0,0,0,.18)' : 'rgba(0,0,0,0)',
    'color-scheme': mode,
  };
}

/** Lighting temperature (K) to an overlay colour. */
export function kelvinColor(k: number): string {
  const t = Math.max(0, Math.min(1, (k - 2200) / (6500 - 2200)));
  return mix('#ffb35a', '#bfe0ff', t);
}

export interface RoomPalette { id: string; name: string; patch: Partial<RoomAppearance> }
export const ROOM_PALETTES: RoomPalette[] = [
  { id: 'library-navy', name: 'Library navy (navy, silver, cyan)', patch: { floor: 'tile', floorColor: '#0d1830', wallColor: '#9aa8bc', accent: '#5ad1ff', lightTemp: 5600, lighting: 0.55, doorColor: '#5ad1ff', displayColor: '#5ad1ff', furnitureMaterial: 'titanium', windowTint: '#1c3a66', effect: 'ambient-glow' } },
  { id: 'executive-titanium', name: 'Executive (black titanium, gold)', patch: { floor: 'carpet', floorColor: '#121315', wallColor: '#2a2c30', accent: '#d4a84a', lightTemp: 3200, lighting: 0.5, doorColor: '#d4a84a', displayColor: '#f2d48a', furnitureMaterial: 'black-titanium', windowTint: '#3a2e18', effect: 'none' } },
  { id: 'engineering-foundry', name: 'Foundry (graphite, orange)', patch: { floor: 'metal', floorColor: '#1a1b1d', wallColor: '#4a3a2a', accent: '#ff9f43', lightTemp: 4200, lighting: 0.7, doorColor: '#ff9f43', displayColor: '#ffb36a', furnitureMaterial: 'graphite', effect: 'scanlines' } },
  { id: 'studio-neon', name: 'Studio neon (violet, pink)', patch: { floor: 'wood', floorColor: '#1a0f1e', wallColor: '#4a2a5e', accent: '#ff6fb5', lightTemp: 4000, lighting: 0.6, doorColor: '#ff6fb5', displayColor: '#c07bff', furnitureMaterial: 'white-composite', effect: 'particles' } },
  { id: 'clean-lab', name: 'Clean lab (white, teal)', patch: { floor: 'tile', floorColor: '#d8e0e2', wallColor: '#a8b8bc', accent: '#1d8a85', lightTemp: 6200, lighting: 0.8, doorColor: '#1d8a85', displayColor: '#39d0c8', furnitureMaterial: 'white-composite', effect: 'none' } },
  { id: 'warm-lounge', name: 'Warm lounge (walnut, amber)', patch: { floor: 'wood', floorColor: '#20160e', wallColor: '#5a4026', accent: '#ffd166', lightTemp: 2700, lighting: 0.45, doorColor: '#ffd166', displayColor: '#ffd166', furnitureMaterial: 'walnut', effect: 'ambient-glow' } },
];
