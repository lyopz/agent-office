// Alert and sound settings: a sound per severity with preview, upload,
// volume, repeat and acknowledgement; muting, quiet hours and schedules;
// grouping, escalation and thresholds; and every delivery channel with its
// honest connection status.
import { useEffect, useState } from 'react';
import { Play } from 'lucide-react';
import { useStore } from '../store/store';
import type { AlertCategory, AlertSettings, AlertSeverity, DeliveryChannel } from '../model/types';
import { BUILTIN_SOUNDS, SEVERITIES, defaultAlertSettings } from '../model/alertDefaults';
import { assetStore } from '../persistence/repository';
import { uid } from '../model/defaults';
import { deliveryEnv } from '../engine/alerts';
import { desktopPermission, onSoundState, playSound, requestDesktop, soundUnlocked, unlockAudio } from './sound';
import { NumberField, Slider, Toggle, confirmAction } from './primitives';

const CATS: AlertCategory[] = ['operational', 'financial', 'project', 'informational'];
const CHANNELS: { id: DeliveryChannel; label: string }[] = [{ id: 'in-app', label: 'In-app' }, { id: 'sound', label: 'Sound' }, { id: 'desktop', label: 'Desktop notification' }, { id: 'email', label: 'Email' }, { id: 'messaging', label: 'Messaging' }, { id: 'push', label: 'Mobile push' }];
const SEV_LABEL: Record<AlertSeverity, string> = { critical: 'Critical', high: 'High priority', warning: 'Warning', info: 'Informational' };

export function AlertSettingsPanel() {
  const s = useStore((st) => st.doc.alertSettings);
  const { commit, runRuntimeOps, notify } = useStore.getState();
  const [, force] = useState(0);
  useEffect(() => onSoundState(() => force((x) => x + 1)), []);
  const up = (patch: unknown, label = 'Alert settings') => commit([{ op: 'alerts.update', patch: patch as never }], label);
  const sounds = [...BUILTIN_SOUNDS.map((b) => ({ id: b.id, name: b.name })), ...s.customSounds.map((c) => ({ id: c.id, name: `${c.name} (uploaded)` }))];
  const preview = async (id: string, vol: number) => { if (!soundUnlocked()) await unlockAudio(); const ok = await playSound(id, vol * s.masterVolume, s.customSounds); if (!ok) notify('The browser blocked audio. Click “Enable sound” and try again.', 'warn'); };
  const upload = async (f: File) => {
    if (!/^audio\//.test(f.type)) { notify('Choose an audio file (MP3, WAV, OGG)', 'error'); return; }
    if (f.size > 1_000_000) { notify('Sounds must be under 1 MB', 'error'); return; }
    const url = await new Promise<string>((r) => { const fr = new FileReader(); fr.onload = () => r(fr.result as string); fr.readAsDataURL(f); });
    const assetId = uid('asset'); await assetStore.put(assetId, url);
    up({ customSounds: [...s.customSounds, { id: uid('snd'), name: f.name.replace(/\.[a-z0-9]+$/i, '').slice(0, 40), assetId }] }, 'Upload alert sound');
  };
  const env = deliveryEnv();
  const status = (ch: DeliveryChannel) => {
    if (ch === 'in-app') return { ok: true, text: 'Active' };
    if (ch === 'sound') return soundUnlocked() ? { ok: true, text: 'Ready' } : { ok: false, text: 'Blocked by browser until you enable sound' };
    if (ch === 'desktop') { const p = desktopPermission(); return p === 'granted' ? { ok: true, text: 'Allowed' } : p === 'unsupported' ? { ok: false, text: 'Not available in this browser' } : { ok: false, text: p === 'denied' ? 'Blocked in browser settings' : 'Permission not granted yet' }; }
    return env.connected[ch] ? { ok: true, text: 'Connected' } : { ok: false, text: 'Not connected. Needs a server-side service; nothing is sent from here.' };
  };
  return (
    <div className="dash">
      <div className="card span-12">
        <div className="row wrap"><h4 style={{ margin: 0 }}>Sounds by severity</h4><span className="spacer" />
          {!soundUnlocked() && <button className="btn sm primary" onClick={() => unlockAudio()}>Enable sound</button>}
          <label className="btn sm">Upload sound<input type="file" accept="audio/*" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) upload(f); e.target.value = ''; }} /></label>
        </div>
        <table className="data" style={{ marginTop: 8 }}>
          <thead><tr><th>Severity</th><th>Sound</th><th>Volume</th><th>Repeat every</th><th>Needs acknowledgement</th><th>Test</th></tr></thead>
          <tbody>{SEVERITIES.map((sev) => {
            const cfg = s.sounds[sev];
            return (
              <tr key={sev}>
                <td>{SEV_LABEL[sev]}</td>
                <td><select aria-label={`${SEV_LABEL[sev]} sound`} value={cfg.soundId} onChange={(e) => up({ sounds: { [sev]: { soundId: e.target.value } } })}>{sounds.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select>
                  <button className="btn icon sm" aria-label={`Preview ${SEV_LABEL[sev]} sound`} onClick={() => preview(cfg.soundId, cfg.volume)}><Play size={12} /></button></td>
                <td><input type="range" aria-label={`${SEV_LABEL[sev]} volume`} min={0} max={1} step={0.05} defaultValue={cfg.volume} onPointerUp={(e) => up({ sounds: { [sev]: { volume: Number((e.target as HTMLInputElement).value) } } })} onKeyUp={(e) => up({ sounds: { [sev]: { volume: Number((e.target as HTMLInputElement).value) } } })} /></td>
                <td><select aria-label={`${SEV_LABEL[sev]} repeat`} value={cfg.repeatSec} onChange={(e) => up({ sounds: { [sev]: { repeatSec: Number(e.target.value) } } })}>{[0, 15, 30, 60, 300].map((v) => <option key={v} value={v}>{v ? `${v}s until acknowledged` : 'never'}</option>)}</select></td>
                <td><input type="checkbox" aria-label={`${SEV_LABEL[sev]} requires acknowledgement`} checked={cfg.ackRequired} onChange={(e) => up({ sounds: { [sev]: { ackRequired: e.target.checked } } })} /></td>
                <td><button className="btn sm" onClick={async () => { if (!soundUnlocked()) await unlockAudio(); runRuntimeOps([{ op: 'alert.test', severity: sev }]); notify(`Sent a test ${sev} alert through your settings`); }}>Send test alert</button></td>
              </tr>
            );
          })}</tbody>
        </table>
        {s.customSounds.length > 0 && <div className="row wrap" style={{ marginTop: 6 }}><span className="label">Uploaded</span>{s.customSounds.map((c) => <span key={c.id} className="chip">{c.name} <button className="btn icon sm" aria-label={`Preview ${c.name}`} onClick={() => preview(c.id, 0.8)}><Play size={11} /></button><button className="btn icon sm danger" aria-label={`Delete ${c.name}`} onClick={() => up({ customSounds: s.customSounds.filter((x) => x.id !== c.id), sounds: Object.fromEntries(SEVERITIES.filter((v) => s.sounds[v].soundId === c.id).map((v) => [v, { soundId: 'subtle' }])) }, 'Delete sound')}>×</button></span>)}</div>}
        <Slider label="Master volume" value={s.masterVolume} min={0} max={1} step={0.05} format={(v) => `${Math.round(v * 100)}%`} onCommit={(masterVolume) => up({ masterVolume })} />
        <label className="field"><span>Make a sound only for alerts at or above</span>
          <select value={s.minSoundSeverity} onChange={(e) => up({ minSoundSeverity: e.target.value })}>{[...SEVERITIES].reverse().map((v) => <option key={v} value={v}>{SEV_LABEL[v]}</option>)}</select></label>
      </div>
      <div className="card span-6">
        <h4>Quiet and mute</h4>
        <p className="note">Critical alerts always sound, even when muted or in quiet hours.</p>
        <div className="row wrap">{CATS.map((c) => <Toggle key={c} label={`Mute ${c}`} checked={!!s.muted[c]} onChange={(v) => up({ muted: { [c]: v } })} />)}</div>
        <Toggle label="Quiet hours" checked={s.quietHours.enabled} onChange={(enabled) => up({ quietHours: { enabled } })} />
        <div className="field-row"><label className="field"><span>From</span><input type="time" value={s.quietHours.start} onChange={(e) => up({ quietHours: { start: e.target.value } })} /></label><label className="field"><span>To</span><input type="time" value={s.quietHours.end} onChange={(e) => up({ quietHours: { end: e.target.value } })} /></label></div>
        <Toggle label="Only play sounds during a schedule" checked={s.soundSchedule.enabled} onChange={(enabled) => up({ soundSchedule: { enabled } })} />
        <div className="field-row"><label className="field"><span>From</span><input type="time" value={s.soundSchedule.start} onChange={(e) => up({ soundSchedule: { start: e.target.value } })} /></label><label className="field"><span>To</span><input type="time" value={s.soundSchedule.end} onChange={(e) => up({ soundSchedule: { end: e.target.value } })} /></label></div>
      </div>
      <div className="card span-6">
        <h4>Grouping, escalation and thresholds</h4>
        <NumberField label="Group identical alerts within (seconds)" value={s.cooldownSec} min={0} max={3600} onCommit={(cooldownSec) => up({ cooldownSec })} />
        <Toggle label="Escalate unacknowledged alerts" checked={s.escalation.enabled} onChange={(enabled) => up({ escalation: { enabled } })} />
        <div className="field-row"><NumberField label="Escalate after (seconds)" value={s.escalation.afterSec} min={10} onCommit={(afterSec) => up({ escalation: { afterSec } })} /><NumberField label="Up to level" value={s.escalation.maxLevel} min={1} max={5} onCommit={(maxLevel) => up({ escalation: { maxLevel } })} /></div>
        <div className="field-row"><NumberField label="Budget warning at %" value={s.thresholds.budgetWarnPct} min={1} max={100} onCommit={(budgetWarnPct) => up({ thresholds: { budgetWarnPct } })} /><NumberField label="Budget critical at %" value={s.thresholds.budgetCriticalPct} min={1} max={500} onCommit={(budgetCriticalPct) => up({ thresholds: { budgetCriticalPct } })} /></div>
        <div className="field-row"><NumberField label="Repeated failures before escalation" value={s.thresholds.repeatedFailures} min={2} max={20} onCommit={(repeatedFailures) => up({ thresholds: { repeatedFailures } })} /><NumberField label="Unusual spend factor" value={s.thresholds.spendRateFactor} min={1} max={10} step={0.1} onCommit={(spendRateFactor) => up({ thresholds: { spendRateFactor } })} /></div>
      </div>
      <div className="card span-12">
        <h4>Delivery channels</h4>
        <table className="data"><thead><tr><th>Channel</th><th>On</th><th>For alerts at or above</th><th>Destination</th><th>Status</th></tr></thead><tbody>
          {CHANNELS.map(({ id, label }) => {
            const cfg = s.channels[id]; const st = status(id);
            return (
              <tr key={id}>
                <td>{label}</td>
                <td><input type="checkbox" aria-label={`${label} enabled`} checked={cfg.enabled} disabled={id === 'in-app'} onChange={(e) => up({ channels: { [id]: { enabled: e.target.checked } } })} /></td>
                <td><select aria-label={`${label} minimum severity`} value={cfg.minSeverity} onChange={(e) => up({ channels: { [id]: { minSeverity: e.target.value } } })}>{[...SEVERITIES].reverse().map((v) => <option key={v} value={v}>{SEV_LABEL[v]}</option>)}</select></td>
                <td>{(id === 'email' || id === 'messaging') ? <input type="text" aria-label={`${label} destination`} placeholder={id === 'email' ? 'owner@example.com' : 'channel or number'} defaultValue={cfg.target ?? ''} onBlur={(e) => e.target.value !== (cfg.target ?? '') && up({ channels: { [id]: { target: e.target.value } } })} /> : '—'}</td>
                <td style={{ color: st.ok ? 'var(--success)' : 'var(--warn)' }}>{st.text}{id === 'desktop' && desktopPermission() === 'default' && <> <button className="btn sm" onClick={() => requestDesktop()}>Allow</button></>}{id === 'sound' && !soundUnlocked() && <> <button className="btn sm" onClick={() => unlockAudio()}>Enable</button></>}</td>
              </tr>
            );
          })}
        </tbody></table>
        <p className="note">Email, messaging and push need a server-side delivery service, configured on the server so no credentials reach this page. Until one is connected, alerts record “not connected” for those channels instead of claiming they were sent.</p>
        <button className="btn sm" onClick={() => confirmAction({ title: 'Restore default alert settings?', confirmLabel: 'Restore', body: 'Sounds, thresholds and channels go back to their defaults. Uploaded sounds stay in the list. You can undo this.', onConfirm: () => commit([{ op: 'alerts.update', patch: { ...defaultAlertSettings(), customSounds: s.customSounds } as AlertSettings as never }], 'Restore alert defaults') })}>Restore defaults</button>
      </div>
    </div>
  );
}
