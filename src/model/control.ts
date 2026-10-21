// Defaults for the emergency stop and team colours.
import type { ControlSettings } from './types';

/** Colours for the teams agents work in; a team without one gets a palette colour. */
export const DEPARTMENT_COLORS: Record<string, string> = {
  Command: '#ff3b5c', Ventures: '#ffb347', Research: '#5ad1ff', Product: '#b57bff', Creative: '#ff6fb5', Engineering: '#ff9f43',
  Quality: '#4cc9ff', Finance: '#ffd166', Community: '#4ff0d0', Operations: '#39ff88', '3D Design': '#ff9f43', Advertising: '#ff6fb5',
};

export function defaultControl(): ControlSettings {
  return { emergencyStop: false };
}
