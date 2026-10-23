import type { AgentStatus } from '../model/types';

/** The colour of each agent status, shared by the brain menus and profiles. */
export const STATUS_COLOR: Record<AgentStatus, string> = {
  idle: 'var(--muted)', working: 'var(--accent)', thinking: 'var(--accent-purple)',
  communicating: 'var(--accent-orange)', researching: 'var(--accent-blue)', waiting: 'var(--warn)', blocked: 'var(--danger)', error: 'var(--danger)', paused: 'var(--muted-2)',
};
