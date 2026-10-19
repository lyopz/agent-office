// The hourly briefing board: opened from the briefing-board screen in the
// Royal Lounge or the Briefing button in the toolbar. It shows a snapshot from
// engine/briefing.ts, refreshed every 60 s while open and on demand.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Activity, Ban, CheckCircle2, Clock, Crown, RefreshCw, X } from 'lucide-react';
import { create } from 'zustand';
import { useStore } from '../store/store';
import {
  BRIEFING_BUCKETS, buildBriefing, countBuckets, filterItems, groupItems, taskHistory,
  type Briefing, type BriefingBucket, type BriefingFilter, type BriefingGrouping, type BriefingItem,
} from '../engine/briefing';

export const REFRESH_MS = 60_000;

export const useBriefing = create<{ open: boolean; furnitureId: string | null; show: (furnitureId?: string | null) => void; close: () => void }>((set) => ({
  open: false, furnitureId: null,
  show: (furnitureId = null) => set({ open: true, furnitureId }),
  close: () => set({ open: false, furnitureId: null }),
}));

const BUCKET_UI: Record<BriefingBucket, { label: string; icon: typeof Activity; cls: string }> = {
  done: { label: 'Done', icon: CheckCircle2, cls: 'b-done' },
  active: { label: 'Active', icon: Activity, cls: 'b-active' },
  blocked: { label: 'Blocked', icon: Ban, cls: 'b-blocked' },
  queued: { label: 'Queued', icon: Clock, cls: 'b-queued' },
};

const hhmm = (iso?: string) => (iso ? new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '—');
const stamp = (iso?: string) => (iso ? new Date(iso).toLocaleString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', month: 'short', day: 'numeric' }) : '—');

function BucketBadge({ bucket }: { bucket: BriefingBucket }) {
  const u = BUCKET_UI[bucket];
  return <span className={`bb-badge ${u.cls}`}><u.icon size={12} aria-hidden="true" />{u.label}</span>;
}

function itemTime(i: BriefingItem) {
  if (i.bucket === 'done') return `done ${hhmm(i.completedAt)}`;
  if (i.bucket === 'active') return i.eta ? `ETA ${hhmm(i.eta)}${i.etaBasis === 'estimate' ? ' (est.)' : ''}` : `started ${hhmm(i.startedAt)}`;
  if (i.bucket === 'blocked') return i.failedAt ? `failed ${hhmm(i.failedAt)}` : i.startedAt ? `started ${hhmm(i.startedAt)}` : `since ${hhmm(i.createdAt)}`;
  return `queued ${hhmm(i.createdAt)}`;
}

export function BriefingHost() {
  const open = useBriefing((s) => s.open);
  return open ? <BriefingBoard /> : null;
}

export function BriefingBoard() {
  const furnitureId = useBriefing((s) => s.furnitureId);
  const close = useBriefing((s) => s.close);
  const roomName = useStore((s) => (furnitureId ? s.doc.rooms[s.doc.furniture[furnitureId]?.roomId ?? '']?.name : undefined));
  const [brief, setBrief] = useState<Briefing>(() => snapshot());
  const [grouping, setGrouping] = useState<BriefingGrouping>('team');
  const [filter, setFilter] = useState<BriefingFilter>({});
  const [selected, setSelected] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  const refresh = useCallback(() => setBrief(snapshot()), []);
  useEffect(() => { const t = setInterval(refresh, REFRESH_MS); return () => clearInterval(t); }, [refresh]);

  // focus in on open, back to the opener on close
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    return () => { if (prev && document.contains(prev)) prev.focus(); };
  }, []);

  const onKeyDown = (e: React.KeyboardEvent) => {
    e.stopPropagation(); // office shortcuts (tools, delete, nudge) stay off while the board is open
    if (e.key === 'Escape') {
      if (selected) setSelected(null); else close();
      return;
    }
    if (e.key === 'Tab' && dialogRef.current) {
      const els = [...dialogRef.current.querySelectorAll<HTMLElement>('button:not([disabled]), select, [tabindex]:not([tabindex="-1"])')];
      if (!els.length) return;
      const first = els[0], last = els[els.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
  };

  const items = useMemo(() => filterItems(brief.items, filter), [brief, filter]);
  const groups = useMemo(() => groupItems(items, grouping), [items, grouping]);
  const counts = useMemo(() => countBuckets(filterItems(brief.items, { ...filter, bucket: null })), [brief, filter]);
  const sel = selected ? brief.items.find((i) => i.taskId === selected) : undefined;
  const filtered = !!(filter.team || filter.projectId || filter.bucket);

  return (
    <div className="overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) close(); }}>
      <div ref={dialogRef} className="modal briefing-modal" role="dialog" aria-modal="true" aria-labelledby="bb-title" aria-describedby="bb-sub" onKeyDown={onKeyDown}>
        <div className="panel-h bb-head">
          <Crown size={14} aria-hidden="true" className="bb-crown" />
          <span id="bb-title">Hourly briefing{roomName ? ` · ${roomName}` : ''}</span>
          <span className="spacer" />
          <span className="small muted bb-refreshed" aria-live="polite">Last refreshed {hhmm(brief.generatedAt)}</span>
          <button className="btn sm" onClick={refresh} title="Refresh now (also refreshes every 60 seconds)"><RefreshCw size={13} aria-hidden="true" />Refresh</button>
          <button ref={closeRef} className="btn icon sm" onClick={close} aria-label="Close briefing" title="Close (Esc)"><X size={14} /></button>
        </div>
        <p id="bb-sub" className="small muted bb-sub">
          Work from {hhmm(brief.windowStart)} to {hhmm(brief.windowEnd)}: completions in the last {brief.windowMinutes} minutes, plus everything active, blocked or queued now. Simulated work is marked.
        </p>

        <div className="bb-strip" role="group" aria-label="Totals by status (click to filter)">
          {BRIEFING_BUCKETS.map((b) => {
            const u = BUCKET_UI[b];
            return (
              <button key={b} className={`bb-stat ${u.cls}`} aria-pressed={filter.bucket === b} onClick={() => setFilter((f) => ({ ...f, bucket: f.bucket === b ? null : b }))}>
                <u.icon size={16} aria-hidden="true" />
                <span className="bb-stat-n">{counts[b]}</span>
                <span className="bb-stat-l">{u.label}</span>
              </button>
            );
          })}
        </div>

        <div className="bb-controls">
          <label className="row small">Team
            <select value={filter.team ?? ''} onChange={(e) => setFilter((f) => ({ ...f, team: e.target.value || null }))}>
              <option value="">All teams</option>
              {brief.teams.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </label>
          <label className="row small">Project
            <select value={filter.projectId ?? ''} onChange={(e) => setFilter((f) => ({ ...f, projectId: e.target.value || null }))}>
              <option value="">All projects</option>
              {brief.projects.map((p) => <option key={p.id ?? 'none'} value={p.id ?? 'none'}>{p.name}</option>)}
            </select>
          </label>
          <label className="row small">Status
            <select value={filter.bucket ?? ''} onChange={(e) => setFilter((f) => ({ ...f, bucket: (e.target.value || null) as BriefingBucket | null }))}>
              <option value="">All statuses</option>
              {BRIEFING_BUCKETS.map((b) => <option key={b} value={b}>{BUCKET_UI[b].label}</option>)}
            </select>
          </label>
          {filtered && <button className="btn sm" onClick={() => setFilter({})}>Clear filters</button>}
          <span className="spacer" />
          <div className="seg" role="group" aria-label="Group by">
            <button className="btn sm" aria-pressed={grouping === 'team'} onClick={() => setGrouping('team')}>By team</button>
            <button className="btn sm" aria-pressed={grouping === 'project'} onClick={() => setGrouping('project')}>By project</button>
          </div>
        </div>

        <div className="bb-body">
          <section className="bb-list" aria-label={`Work grouped by ${grouping}`}>
            {groups.length === 0 && <p className="muted small bb-empty">{filtered ? 'Nothing matches these filters.' : 'No work in this window yet. Run the simulation or assign tasks.'}</p>}
            {groups.map((g) => (
              <div key={g.key || 'none'} className="bb-group">
                <h3 className="bb-group-h">
                  <span>{g.label}</span>
                  <span className="bb-group-c small muted">{BRIEFING_BUCKETS.filter((b) => g.counts[b]).map((b) => `${g.counts[b]} ${BUCKET_UI[b].label.toLowerCase()}`).join(' · ')}</span>
                </h3>
                <ul className="bb-items">
                  {g.items.map((i) => (
                    <li key={i.taskId}>
                      <button className={`bb-item ${BUCKET_UI[i.bucket].cls}`} aria-pressed={selected === i.taskId} onClick={() => setSelected(selected === i.taskId ? null : i.taskId)}>
                        <BucketBadge bucket={i.bucket} />
                        <span className="bb-item-main">
                          <span className="bb-item-name">{i.taskName}{i.overdue && <span className="bb-flag"> · overdue</span>}</span>
                          <span className="small muted">{i.agentName}{grouping === 'team' ? ` · ${i.projectName}` : ` · ${i.team}`}{i.blockedReason ? ` · ${i.blockedReason}` : ''}</span>
                        </span>
                        <span className="small bb-item-time">{itemTime(i)}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </section>

          <aside className="bb-side" aria-label={sel ? 'Selected item' : 'Attention and idle agents'}>
            {sel ? <Detail item={sel} onClose={() => setSelected(null)} /> : <Overview brief={brief} onPick={setSelected} />}
          </aside>
        </div>
      </div>
    </div>
  );
}

function openProfile(agentId: string) {
  useBriefing.getState().close();
  useStore.getState().setUi({ profileAgentId: agentId });
}

function snapshot(): Briefing {
  const s = useStore.getState();
  return buildBriefing(s.doc, s.runtime, Date.now(), { msPerTick: 100 / (s.prefs.simSpeed || 1) });
}

function Overview({ brief, onPick }: { brief: Briefing; onPick: (id: string) => void }) {
  const roomName = useStore.getState().doc.rooms;
  return (
    <>
      <div className="card">
        <h4>Needs attention ({brief.attention.length})</h4>
        {brief.attention.length === 0 && <p className="small muted">No blockers right now.</p>}
        <ul className="bb-attn">
          {brief.attention.map((a, k) => (
            <li key={`${a.kind}${a.taskId ?? a.agentId}${k}`} className={`bb-attn-${a.severity}`}>
              <span className="bb-sev">{a.severity === 'high' ? '!! High' : '! Medium'}</span>{' '}
              {a.taskId ? <button className="linklike" onClick={() => onPick(a.taskId!)}>{a.message}</button> : <span>{a.message}</span>}
            </li>
          ))}
        </ul>
      </div>
      <div className="card">
        <h4>Idle agents ({brief.idleAgents.length})</h4>
        {brief.idleAgents.length === 0 && <p className="small muted">Everyone has work.</p>}
        <ul className="bb-idle small">
          {brief.idleAgents.slice(0, 40).map((a) => (
            <li key={a.agentId}><button className="linklike" onClick={() => openProfile(a.agentId)}>{a.name}</button> <span className="muted">· {a.team}{a.roomId && roomName[a.roomId] ? ` · ${roomName[a.roomId].name}` : ''}{a.lastCompletedAt ? ` · last done ${hhmm(a.lastCompletedAt)}` : ''}</span></li>
          ))}
          {brief.idleAgents.length > 40 && <li className="muted">and {brief.idleAgents.length - 40} more</li>}
        </ul>
      </div>
    </>
  );
}

function Detail({ item, onClose }: { item: BriefingItem; onClose: () => void }) {
  const rt = useStore.getState().runtime;
  const task = rt.tasks[item.taskId];
  const history = taskHistory(rt, item.taskId);
  const rows: [string, string][] = [
    ['Agent', `${item.agentName}${item.agentStatus ? ` (${item.agentStatus})` : ''}`],
    ['Team', item.team], ['Project', item.projectName], ['Priority', item.priority],
    ['Task status', `${item.status}${item.progress ? ` · ${item.progress}%` : ''}`],
    ['Created', stamp(item.createdAt)], ['Started', stamp(item.startedAt)],
    ...(item.completedAt ? [['Completed', stamp(item.completedAt)] as [string, string]] : []),
    ...(item.failedAt ? [['Failed', stamp(item.failedAt)] as [string, string]] : []),
    ...(item.eta ? [['ETA', `${stamp(item.eta)}${item.etaBasis === 'estimate' ? ' (estimate from work units)' : ' (from progress so far)'}`] as [string, string]] : []),
    ...(item.deadline ? [['Deadline', `${stamp(item.deadline)}${item.overdue ? ' · overdue' : ''}`] as [string, string]] : []),
  ];
  return (
    <div className="card bb-detail">
      <div className="row">
        <h4 className="grow" id="bb-detail-h">{item.taskName}</h4>
        <button className="btn icon sm" onClick={onClose} aria-label="Close details" title="Close details (Esc)"><X size={13} /></button>
      </div>
      <div className="row" style={{ gap: 6, marginBottom: 6 }}><BucketBadge bucket={item.bucket} />{item.simulated && <span className="badge sim">simulated</span>}</div>
      {item.blockedReason && <p className="small bb-reason"><Ban size={12} aria-hidden="true" /> {item.blockedReason}</p>}
      {task?.description && <p className="small">{task.description}</p>}
      {item.bucket !== 'done' && item.progress > 0 && <div className="bb-progress" role="progressbar" aria-label="Progress" aria-valuenow={item.progress} aria-valuemin={0} aria-valuemax={100}><i style={{ width: `${item.progress}%` }} /></div>}
      <dl className="bb-dl small">{rows.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl>
      {task?.handoff && (
        <div className="small" style={{ marginTop: 6 }}>
          <div className="label">Handoff</div>
          <div>{task.handoff.request}</div>
          <div className="muted">Deliverable: {task.handoff.deliverable} · Acceptance: {task.handoff.acceptance}</div>
        </div>
      )}
      <div className="label" style={{ marginTop: 8 }}>History</div>
      <ol className="bb-history small">
        {history.map((h, k) => <li key={k}><span className="muted">{hhmm(h.at)}</span> {h.label}</li>)}
      </ol>
      {item.agentId && <button className="btn sm" style={{ marginTop: 6 }} onClick={() => openProfile(item.agentId!)}>Open {item.agentName}'s profile</button>}
    </div>
  );
}
