// Alert engine. Pure functions over (doc settings, runtime). Decides grouping,
// escalation and which channels an alert goes to. It never claims a delivery it
// can't confirm: channels with no connected service are recorded as such.
import type { Alert, AlertCategory, AlertDelivery, AlertSettings, AlertSeverity, DeliveryChannel, OfficeDoc, RuntimeState } from '../model/types';
import { SEVERITY_ORDER } from '../model/alertDefaults';
import { uid } from '../model/defaults';
import { log } from './simulation';

export interface AlertInput {
  key: string; severity: AlertSeverity; category: AlertCategory;
  title: string; description: string; recommended: string;
  agentId?: string | null; projectId?: string | null; taskId?: string | null; approvalId?: string | null;
  evidence?: Alert['evidence']; test?: boolean;
}

/** What the browser can do right now; the UI fills this in, tests pass a fake. */
export interface DeliveryEnv { soundUnlocked: boolean; desktopPermission: 'granted' | 'denied' | 'default' | 'unsupported'; connected: Partial<Record<DeliveryChannel, boolean>> }
export const HEADLESS_ENV: DeliveryEnv = { soundUnlocked: true, desktopPermission: 'unsupported', connected: {} };

export interface Notification { alert: Alert; deliveries: AlertDelivery[]; reason: 'new' | 'repeat' | 'escalated' }
type Listener = (n: Notification) => void;
const listeners = new Set<Listener>();
/** The UI subscribes here to play sounds and show desktop notifications. */
export function onAlertNotify(fn: Listener) { listeners.add(fn); return () => { listeners.delete(fn); }; }
let env: DeliveryEnv = HEADLESS_ENV;
export function setDeliveryEnv(e: Partial<DeliveryEnv>) { env = { ...env, ...e }; }
export function deliveryEnv() { return env; }

const sev = (s: AlertSeverity) => SEVERITY_ORDER[s];

function minutes(hhmm: string) { const [h, m] = hhmm.split(':').map(Number); return (h || 0) * 60 + (m || 0); }
/** Is `now` inside a daily window? Windows may wrap past midnight. */
export function inWindow(now: Date, start: string, end: string) {
  const t = now.getHours() * 60 + now.getMinutes(), s = minutes(start), e = minutes(end);
  return s <= e ? t >= s && t < e : t >= s || t < e;
}

/** Which channels this alert reaches, and honestly what happened on each. */
export function planDeliveries(settings: AlertSettings, a: Pick<Alert, 'severity' | 'category' | 'test'>, now: Date, e: DeliveryEnv = env): AlertDelivery[] {
  const out: AlertDelivery[] = [];
  const critical = a.severity === 'critical';
  for (const [ch, cfg] of Object.entries(settings.channels) as [DeliveryChannel, AlertSettings['channels'][DeliveryChannel]][]) {
    if (!cfg.enabled) continue;
    if (sev(a.severity) < sev(cfg.minSeverity)) continue;
    if (ch === 'in-app') { out.push({ channel: ch, status: 'shown' }); continue; }
    if (ch === 'sound') {
      const s = settings.sounds[a.severity];
      const muted = settings.muted[a.category] && !critical;
      const quiet = settings.quietHours.enabled && inWindow(now, settings.quietHours.start, settings.quietHours.end) && !critical;
      const outside = settings.soundSchedule.enabled && !inWindow(now, settings.soundSchedule.start, settings.soundSchedule.end) && !critical;
      const below = sev(a.severity) < sev(settings.minSoundSeverity) && !a.test;
      if (muted || quiet || outside || below || s.soundId === 'none') { out.push({ channel: ch, status: 'suppressed', detail: muted ? 'category muted' : quiet ? 'quiet hours' : outside ? 'outside sound schedule' : below ? 'below sound threshold' : 'silent sound selected' }); continue; }
      out.push(e.soundUnlocked ? { channel: ch, status: 'delivered', soundId: s.soundId } : { channel: ch, status: 'permission-needed', detail: 'Browser blocked audio until you click “Enable sound”', soundId: s.soundId });
      continue;
    }
    if (ch === 'desktop') {
      out.push(e.desktopPermission === 'granted' ? { channel: ch, status: 'delivered' } : e.desktopPermission === 'unsupported' ? { channel: ch, status: 'not-connected', detail: 'Desktop notifications unavailable here' } : { channel: ch, status: 'permission-needed', detail: 'Allow notifications in Alert settings' });
      continue;
    }
    // email, messaging, push need a server-side service; we never pretend they were sent
    out.push(e.connected[ch] ? { channel: ch, status: 'queued', detail: `Handed to ${ch} service; awaiting confirmation` } : { channel: ch, status: 'not-connected', detail: `No ${ch} service connected` });
  }
  return out;
}

function emit(n: Notification) { for (const l of listeners) { try { l(n); } catch { /* a broken listener must not stop alerts */ } } }

/**
 * Raise or group an alert. An open alert with the same key inside the cooldown
 * window is updated (count, evidence) instead of creating a duplicate. Critical
 * alerts always notify; grouped repeats of lesser alerts stay quiet.
 */
export function raiseAlert(doc: OfficeDoc, rt: RuntimeState, input: AlertInput, now = new Date()): { alert: Alert; notified: boolean; grouped: boolean } {
  const s = doc.alertSettings;
  const iso = now.toISOString();
  const existing = Object.values(rt.alerts).find((a) => a.key === input.key && a.status !== 'resolved');
  if (existing && now.getTime() - Date.parse(existing.lastAt) <= s.cooldownSec * 1000) {
    const a = { ...existing, evidence: [...existing.evidence, ...(input.evidence ?? [])].slice(-20), count: existing.count + 1, lastAt: iso, description: input.description };
    let reason: Notification['reason'] | null = null;
    // repeated failures become more serious
    if (a.count >= s.thresholds.repeatedFailures && sev(a.severity) < sev('high') && input.category === 'operational') {
      a.severity = 'high'; a.ackRequired = true; a.escalationLevel = Math.max(1, a.escalationLevel); a.title = `Repeated: ${input.title}`; reason = 'escalated';
    }
    if (sev(input.severity) > sev(a.severity)) { a.severity = input.severity; reason = 'escalated'; }
    if (a.severity === 'critical' && !reason) {
      const rep = s.sounds.critical.repeatSec;
      if (rep > 0 && now.getTime() - Date.parse(a.lastNotifiedAt) >= rep * 1000) reason = 'repeat';
    }
    if (reason) { a.deliveries = planDeliveries(s, a, now); a.lastNotifiedAt = iso; a.status = 'open'; }
    rt.alerts[a.id] = a;
    if (reason) emit({ alert: a, deliveries: a.deliveries, reason });
    return { alert: a, notified: !!reason, grouped: true };
  }
  const a: Alert = {
    id: uid('alert'), key: input.key, severity: input.severity, category: input.category,
    title: input.title, description: input.description, recommended: input.recommended,
    firstAt: iso, lastAt: iso, count: 1,
    agentId: input.agentId ?? null, projectId: input.projectId ?? null, taskId: input.taskId ?? null, approvalId: input.approvalId ?? null,
    evidence: input.evidence ?? [], status: 'open',
    ackRequired: s.sounds[input.severity].ackRequired, escalationLevel: 0, lastNotifiedAt: iso,
    deliveries: [], test: input.test,
  };
  a.deliveries = planDeliveries(s, a, now);
  rt.alerts[a.id] = a;
  log(rt, { kind: 'alert', agentId: a.agentId ?? null, simulated: false, level: sev(a.severity) >= sev('high') ? 'error' : sev(a.severity) >= sev('warning') ? 'warn' : 'info', message: `${a.severity.toUpperCase()} alert: ${a.title}` });
  pruneAlerts(rt);
  emit({ alert: a, deliveries: a.deliveries, reason: 'new' });
  return { alert: a, notified: true, grouped: false };
}

/** Unacknowledged alerts that need acknowledgement climb a level each `afterSec`. */
export function escalateAlerts(doc: OfficeDoc, rt: RuntimeState, now = new Date()): Alert[] {
  const s = doc.alertSettings; const out: Alert[] = [];
  if (!s.escalation.enabled) return out;
  for (const a0 of Object.values(rt.alerts)) {
    if (a0.status !== 'open' || !a0.ackRequired || a0.escalationLevel >= s.escalation.maxLevel) continue;
    if (now.getTime() - Date.parse(a0.lastNotifiedAt) < s.escalation.afterSec * 1000) continue;
    const a = { ...a0, escalationLevel: a0.escalationLevel + 1, lastNotifiedAt: now.toISOString() };
    if (a.severity === 'high' && a.escalationLevel >= 2) a.severity = 'critical';
    a.deliveries = planDeliveries(s, a, now);
    rt.alerts[a.id] = a; out.push(a);
    log(rt, { kind: 'alert', agentId: a.agentId ?? null, simulated: false, level: 'error', message: `Escalated to level ${a.escalationLevel}: ${a.title}` });
    emit({ alert: a, deliveries: a.deliveries, reason: 'escalated' });
  }
  return out;
}

export function acknowledgeAlert(rt: RuntimeState, id: string) {
  const a = rt.alerts[id]; if (!a) return false;
  rt.alerts[id] = { ...a, status: 'acknowledged' };
  log(rt, { kind: 'alert', agentId: a.agentId ?? null, simulated: false, message: `Acknowledged: ${a.title}` });
  return true;
}
export function resolveAlert(rt: RuntimeState, id: string) {
  const a = rt.alerts[id]; if (!a) return false;
  rt.alerts[id] = { ...a, status: 'resolved' };
  return true;
}

function pruneAlerts(rt: RuntimeState) {
  const done = Object.values(rt.alerts).filter((a) => a.status === 'resolved').sort((a, b) => a.lastAt.localeCompare(b.lastAt));
  for (const a of done.slice(0, Math.max(0, done.length - 100))) delete rt.alerts[a.id];
}

export function openAlerts(rt: RuntimeState) {
  return Object.values(rt.alerts).filter((a) => a.status !== 'resolved').sort((a, b) => sev(b.severity) - sev(a.severity) || b.lastAt.localeCompare(a.lastAt));
}

/** Fire a clearly-labelled test alert through the configured pipeline. */
export function testAlert(doc: OfficeDoc, rt: RuntimeState, severity: AlertSeverity, now = new Date()) {
  return raiseAlert(doc, rt, { key: `test:${severity}:${now.getTime()}`, severity, category: 'informational', title: `Test ${severity} alert`, description: 'This is a test of your alert configuration.', recommended: 'Acknowledge to clear it.', test: true }, now);
}
