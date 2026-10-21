// Teams: agents grouped by the team (department) they work in. Each team gets
// its colour from DEPARTMENT_COLORS, or a stable palette colour by name.
import type { OfficeDoc } from '../model/types';
import { DEPARTMENT_COLORS } from '../model/control';

const PALETTE = ['#5ad2ff', '#b28cff', '#ff7ad6', '#ffc46b', '#78f7b0', '#7f9cff', '#ff9a74', '#4ff0d0', '#e0a8ff', '#c8f06e'];

export function hash(s: string) { let h = 2166136261; for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619); return h >>> 0; }

export interface Team { id: string; name: string; color: string; agentIds: string[] }

export function teamsOf(doc: Pick<OfficeDoc, 'agents'>): Team[] {
  const by = new Map<string, string[]>();
  for (const a of Object.values(doc.agents).sort((x, y) => x.identity.name.localeCompare(y.identity.name))) {
    const d = a.identity.department || 'Unassigned';
    by.set(d, [...(by.get(d) ?? []), a.id]);
  }
  return [...by.entries()].map(([name, agentIds]) => {
    const known = Object.entries(DEPARTMENT_COLORS).find(([k]) => k.toLowerCase() === name.toLowerCase())?.[1];
    // the brain's shaders need plain #rrggbb colours
    const color = known && /^#[0-9a-f]{6}$/i.test(known) ? known : PALETTE[hash(name) % PALETTE.length];
    return { id: `team:${name}`, name, color, agentIds };
  });
}

export const teamOfAgent = (teams: Team[], agentId: string | null | undefined) => (agentId ? teams.find((t) => t.agentIds.includes(agentId))?.id ?? null : null);
