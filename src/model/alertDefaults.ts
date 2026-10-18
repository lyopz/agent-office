import type { AlertSettings, AlertSeverity } from './types';

/** Built-in alarm sounds (synthesised in the browser, so nothing to download). */
export const BUILTIN_SOUNDS: { id: string; name: string; desc: string }[] = [
  { id: 'subtle', name: 'Subtle notification', desc: 'Soft two-note chime' },
  { id: 'blocked', name: 'Task blocked', desc: 'Falling two-tone' },
  { id: 'finance', name: 'Financial warning', desc: 'Three measured ticks' },
  { id: 'critical', name: 'Critical alarm', desc: 'Pulsing alarm' },
  { id: 'ping', name: 'Ping', desc: 'Single short ping' },
  { id: 'none', name: 'Silent', desc: 'No sound' },
];

export const SEVERITY_ORDER: Record<AlertSeverity, number> = { info: 0, warning: 1, high: 2, critical: 3 };
export const SEVERITIES: AlertSeverity[] = ['critical', 'high', 'warning', 'info'];

export function defaultAlertSettings(): AlertSettings {
  return {
    sounds: {
      critical: { soundId: 'critical', volume: 0.9, repeatSec: 30, ackRequired: true },
      high: { soundId: 'blocked', volume: 0.7, repeatSec: 0, ackRequired: true },
      warning: { soundId: 'finance', volume: 0.6, repeatSec: 0, ackRequired: false },
      info: { soundId: 'subtle', volume: 0.4, repeatSec: 0, ackRequired: false },
    },
    customSounds: [],
    masterVolume: 0.8,
    muted: {},
    quietHours: { enabled: false, start: '22:00', end: '07:00' },
    soundSchedule: { enabled: false, start: '08:00', end: '19:00' },
    cooldownSec: 120,
    escalation: { enabled: true, afterSec: 120, maxLevel: 3 },
    thresholds: { budgetWarnPct: 80, budgetCriticalPct: 100, spendRateFactor: 1.5, repeatedFailures: 3 },
    channels: {
      'in-app': { enabled: true, minSeverity: 'info' },
      sound: { enabled: true, minSeverity: 'warning' },
      desktop: { enabled: false, minSeverity: 'high' },
      email: { enabled: false, minSeverity: 'critical', target: '' },
      messaging: { enabled: false, minSeverity: 'critical', target: '' },
      push: { enabled: false, minSeverity: 'critical' },
    },
    minSoundSeverity: 'warning',
  };
}
