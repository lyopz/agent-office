// Defaults for departments, executive control, the arcade and production.
import type { ArcadeSettings, ControlSettings, Department, OfficeDoc } from './types';

export const DEPARTMENT_COLORS: Record<string, string> = {
  Executive: '#d4a84a', Operations: '#39ff88', Finance: '#f2b544', Research: '#5ad1ff', Product: '#b57bff',
  Creative: '#ff6fb5', Engineering: '#ff9f43', 'Game Development': '#ff6fb5', '3D Design': '#ff9f43',
  'E-commerce': '#39d0c8', 'Operations Floor': '#39ff88', Marketing: '#ff8a5c',
};
/** Departments that keep the company running; resource policies never pause them automatically. */
export const ESSENTIAL = new Set(['Executive', 'Operations', 'Finance']);

export const departmentId = (name: string) => `dept_${name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'general'}`;

export function makeDepartment(name: string, extra: Partial<Department> = {}): Department {
  return {
    id: departmentId(name), name, color: DEPARTMENT_COLORS[name] ?? '#8a9a8f', description: '',
    mode: 'running', essential: ESSENTIAL.has(name), maxConcurrent: null, excludedAgentIds: [], renderPolicy: 'finish', ...extra,
  };
}

/** Every department named by an agent, plus the ones already configured. */
export function departmentList(doc: OfficeDoc): Department[] {
  const out = new Map(Object.values(doc.departments).map((d) => [d.id, d]));
  for (const a of Object.values(doc.agents)) {
    const id = departmentId(a.identity.department || 'General');
    if (!out.has(id)) out.set(id, makeDepartment(a.identity.department || 'General'));
  }
  return [...out.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export function departmentOf(doc: OfficeDoc, agentId: string): Department | null {
  const a = doc.agents[agentId]; if (!a) return null;
  const id = departmentId(a.identity.department || 'General');
  return doc.departments[id] ?? makeDepartment(a.identity.department || 'General');
}

export function defaultControl(): ControlSettings {
  return {
    emergencyStop: false,
    policy: { prioritizeRendering: false, backgroundLimit: 6, pauseNonessential: false, autoResume: true },
    simplifyAbove: 30,
    blenderBridgeUrl: '',
  };
}

/**
 * Agent arcade play may only be called token-free once a local, model-free
 * play path has been verified end to end. None has been yet, so this stays
 * false and the "token-free" policy can't be switched on.
 */
export const TOKEN_FREE_VERIFIED = false;

export function defaultArcade(): ArcadeSettings {
  return {
    policy: 'human-only',
    limits: { flappy: { maxScore: 100, maxSessionSec: 180 }, pacman: { maxScore: 10000, maxSessionSec: 300 }, pong: { maxScore: 11, maxSessionSec: 300 } },
    maxAgentMatchesPerDay: 3,
    tokenFreeVerified: TOKEN_FREE_VERIFIED,
  };
}
