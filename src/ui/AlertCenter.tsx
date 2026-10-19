// Alert centre: the bell in the top bar, a drawer of open alerts with their
// evidence and actions, and the bridge that turns alert notifications into
// sounds and desktop notifications.
import { useEffect, useState } from 'react';
import { Bell, BellRing, Volume2 } from 'lucide-react';
import { useStore } from '../store/store';
import type { Alert, AlertDelivery } from '../model/types';
import { onAlertNotify, openAlerts, planDeliveries } from '../engine/alerts';
import { installAudioUnlock, onSoundState, playSound, soundUnlocked, unlockAudio } from './sound';
import { roomCenter } from '../engine/geometry';
import { G } from '../viewport/OfficeLayers';

const SEV_COLOR = { critical: 'var(--danger)', high: 'var(--accent-orange)', warning: 'var(--warn)', info: 'var(--accent-blue)' } as const;
const DELIVERY_LABEL: Record<AlertDelivery['status'], string> = { delivered: 'delivered', shown: 'shown', queued: 'sent, awaiting confirmation', 'not-connected': 'not connected', 'permission-needed': 'needs permission', suppressed: 'held back' };

/** Plays sounds and shows desktop notifications for alerts, and repeats critical alarms until acknowledged. */
export function useAlertDelivery() {
  useEffect(() => {
    installAudioUnlock();
    const lastPlayed = new Map<string, number>();
    const off = onAlertNotify(({ alert, deliveries }) => {
      const s = useStore.getState().doc.alertSettings;
      for (const d of deliveries) {
        if (d.channel === 'sound' && d.status === 'delivered' && d.soundId) { playSound(d.soundId, s.sounds[alert.severity].volume * s.masterVolume, s.customSounds); lastPlayed.set(alert.id, Date.now()); }
        if (d.channel === 'desktop' && d.status === 'delivered' && typeof Notification !== 'undefined') { try { new Notification(`${alert.severity.toUpperCase()}: ${alert.title}`, { body: `${alert.description}\n${alert.recommended}`, tag: alert.key }); } catch { /* ignore */ } }
      }
    });
    const t = setInterval(() => {
      const { doc, runtime } = useStore.getState();
      const s = doc.alertSettings;
      for (const a of Object.values(runtime.alerts)) {
        if (a.status !== 'open' || !a.ackRequired) continue;
        const rep = s.sounds[a.severity].repeatSec; if (!rep) continue;
        if (Date.now() - (lastPlayed.get(a.id) ?? Date.parse(a.lastNotifiedAt)) < rep * 1000) continue;
        const d = planDeliveries(s, a, new Date()).find((x) => x.channel === 'sound');
        if (d?.status === 'delivered' && d.soundId) { playSound(d.soundId, s.sounds[a.severity].volume * s.masterVolume, s.customSounds); lastPlayed.set(a.id, Date.now()); }
      }
    }, 1000);
    return () => { off(); clearInterval(t); };
  }, []);
}

export function AlertBell() {
  const alerts = useStore((s) => s.runtime.alerts);
  const [open, setOpen] = useState(false);
  const [, force] = useState(0);
  useEffect(() => onSoundState(() => force((x) => x + 1)), []);
  const list = openAlerts({ alerts } as never);
  const unacked = list.filter((a) => a.status === 'open');
  const worst = unacked[0]?.severity;
  return (
    <div style={{ position: 'relative' }}>
      <button className="btn sm" aria-expanded={open} aria-label={`Alerts: ${unacked.length} need attention`} title="Alert centre" onClick={() => setOpen(!open)} style={worst ? { borderColor: SEV_COLOR[worst], color: SEV_COLOR[worst] } : undefined}>
        {unacked.length ? <BellRing size={14} /> : <Bell size={14} />}{unacked.length > 0 && <span className="count">{unacked.length}</span>}
      </button>
      {!soundUnlocked() && <button className="btn sm hide-sm" aria-label="Enable sound" title="Browsers block sound until you allow it" onClick={() => unlockAudio()}><Volume2 size={14} /><span className="sound-lbl">Enable sound</span></button>}
      {open && <AlertDrawer onClose={() => setOpen(false)} />}
    </div>
  );
}

function AlertDrawer({ onClose }: { onClose: () => void }) {
  const alerts = useStore((s) => s.runtime.alerts);
  const [showAll, setShowAll] = useState(false);
  const list = showAll ? Object.values(alerts).sort((a, b) => b.lastAt.localeCompare(a.lastAt)) : openAlerts({ alerts } as never);
  return (
    <div className="alert-drawer" role="dialog" aria-label="Alert centre">
      <div className="panel-h row"><span className="grow">Alerts</span>
        <label className="small row"><input type="checkbox" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} /> include resolved</label>
        <button className="btn sm" onClick={() => useStore.getState().setUi({ page: 'settings' })}>Sound settings</button>
        <button className="btn icon sm" aria-label="Close alerts" onClick={onClose}>×</button>
      </div>
      <div className="alert-list">
        {list.map((a) => <AlertCard key={a.id} a={a} />)}
        {!list.length && <p className="note" style={{ padding: 12 }}>Nothing needs your attention. Routine activity is in the activity log, not here.</p>}
      </div>
    </div>
  );
}

function AlertCard({ a }: { a: Alert }) {
  const doc = useStore((s) => s.doc);
  const rt = useStore((s) => s.runtime);
  const { runRuntimeOps, commit, setUi } = useStore.getState();
  const [open, setOpen] = useState(a.severity === 'critical');
  const agent = a.agentId ? doc.agents[a.agentId] : undefined;
  const project = a.projectId ? doc.projects[a.projectId] : undefined;
  const task = a.taskId ? rt.tasks[a.taskId] : undefined;
  const approval = a.approvalId ? rt.approvals[a.approvalId] : undefined;
  const roomId = a.roomId ?? (agent ? rt.agents[agent.id]?.roomId ?? agent.schedule.assignedRoomId : null);
  const openRoom = () => {
    const r = roomId ? doc.rooms[roomId] : undefined; if (!r) return;
    const c = roomCenter(r); const cam = useStore.getState().camera; const el = document.querySelector('.viewport');
    const w = el?.clientWidth ?? 800, h = el?.clientHeight ?? 600;
    setUi({ page: 'office', selection: agent ? { kind: 'agent', id: agent.id } : { kind: 'room', ids: [r.id] }, camera: { ...cam, x: w / 2 - c.x * G * cam.zoom, y: h / 2 - c.y * G * cam.zoom } });
  };
  return (
    <article className={`alert-card sev-${a.severity}${a.status !== 'open' ? ' done' : ''}`}>
      <header className="row" onClick={() => setOpen(!open)} style={{ cursor: 'pointer' }}>
        <span className="sev" style={{ background: SEV_COLOR[a.severity] }}>{a.severity}</span>
        <b className="grow">{a.title}{a.count > 1 && <span className="muted"> ×{a.count}</span>}</b>
        <span className="small muted">{new Date(a.lastAt).toLocaleTimeString()}</span>
      </header>
      <p className="small">{a.description}</p>
      <p className="small"><span className="muted">Recommended:</span> {a.recommended}</p>
      <div className="small muted">
        {a.category}{agent ? ` · ${agent.identity.name}` : ''}{project ? ` · ${project.name}` : ''}{task ? ` · task “${task.name}”` : ''}{a.escalationLevel ? ` · escalated ×${a.escalationLevel}` : ''}{a.test ? ' · test' : ''}{a.status !== 'open' ? ` · ${a.status}` : ''}
      </div>
      {open && (
        <div className="alert-detail">
          <div className="small"><span className="muted">First seen</span> {new Date(a.firstAt).toLocaleString()} · <span className="muted">last</span> {new Date(a.lastAt).toLocaleString()}</div>
          {a.evidence.length > 0 && <div className="small"><span className="muted">Evidence</span><ul>{a.evidence.slice(-6).map((e, i) => <li key={i}>{e.kind}: {e.label}</li>)}</ul></div>}
          <div className="small"><span className="muted">Delivery</span> {a.deliveries.map((d) => <span key={d.channel} className={`chip deliv-${d.status}`} title={d.detail}>{d.channel}: {DELIVERY_LABEL[d.status]}</span>)}</div>
        </div>
      )}
      <div className="row wrap" style={{ gap: 4, marginTop: 6 }}>
        {a.status === 'open' && <button className="btn sm primary" onClick={() => runRuntimeOps([{ op: 'alert.ack', id: a.id }])}>Acknowledge</button>}
        {approval?.status === 'pending' && <><button className="btn sm primary" onClick={() => runRuntimeOps([{ op: 'approval.decide', id: approval.id, approve: true }])}>Approve</button><button className="btn sm danger" onClick={() => runRuntimeOps([{ op: 'approval.decide', id: approval.id, approve: false }])}>Reject</button></>}
        {task && (task.status === 'failed' || task.status === 'paused') && <button className="btn sm" onClick={() => runRuntimeOps([{ op: 'task.update', id: task.id, patch: { status: 'queued' } }])}>Retry</button>}
        {task && <select aria-label="Reassign task" value="" onChange={(e) => e.target.value && runRuntimeOps([{ op: 'task.update', id: task.id, patch: { agentId: e.target.value, status: 'queued' } }])}><option value="">Reassign…</option>{Object.values(doc.agents).filter((x) => x.id !== task.agentId).map((x) => <option key={x.id} value={x.id}>{x.identity.name}</option>)}</select>}
        {project && project.status === 'active' && <button className="btn sm" onClick={() => commit([{ op: 'project.upsert', project: { ...project, status: 'paused' } }], `Pause ${project.name}`)}>Pause project</button>}
        {roomId && <button className="btn sm" onClick={openRoom}>Open room</button>}
        {a.severity !== 'critical' && !doc.alertSettings.muted[a.category] && <button className="btn sm" title="Mute sounds for this category (critical alerts always sound)" onClick={() => commit([{ op: 'alerts.update', patch: { muted: { [a.category]: true } } }], `Mute ${a.category} alerts`)}>Mute {a.category}</button>}
        {a.status !== 'resolved' && <button className="btn sm" onClick={() => runRuntimeOps([{ op: 'alert.resolve', id: a.id }])}>Resolve</button>}
      </div>
    </article>
  );
}
