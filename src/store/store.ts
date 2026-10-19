// Application state. Three layers, kept deliberately separate:
//  - doc      : persistent, undoable office (layout, agents' profiles/appearance)
//  - runtime  : persistent simulation state (tasks, positions, activity log); not undoable
//  - ui       : ephemeral view state (selection, camera, tools) — never saved
import { create } from 'zustand';
import type { AlertSeverity, ArcadeSession, AssetKind, GameId, OfficeDoc, RuntimeState, Task } from '../model/types';
import { agentArcadeAttempt, isArcade, recordArcadeSession } from '../engine/arcadePolicy';
import { attachRealFile, createAsset, reviewAsset } from '../engine/production';
import { departmentId } from '../model/control';
import { acknowledgeAlert, raiseAlert, resolveAlert, testAlert, type AlertInput } from '../engine/alerts';
import { decideApproval, recordUsage, requestAction, type ActionRequest } from '../engine/governance';
import { dispatchViaTube } from '../engine/tubes';
import { applyOps, type DocOp } from '../engine/ops';
import { newErrors, validate, type Issue } from '../engine/validate';
import { buildNav, type NavGraph } from '../engine/navigation';
import { createTask, emptyRuntime, goTo, log, reconcileLayout, step, syncRuntime } from '../engine/simulation';
import { sampleOffice, seedSampleRuntime } from '../model/sample';
import { emptyOffice } from '../model/defaults';
import { createRepository, type LoadResult, type OfficeRepository, type Preferences, type SaveResult } from '../persistence/repository';
import { exportOffice, parseOffice } from '../model/schema';
import { markFrame } from '../ui/perf';

export type Selection =
  | { kind: 'none' }
  | { kind: 'room'; ids: string[] }
  | { kind: 'corridor'; id: string }
  | { kind: 'furniture'; id: string; ids?: string[] }
  | { kind: 'door'; roomId: string; doorId: string }
  | { kind: 'agent'; id: string };

/** Every furniture id in the selection (multi-select keeps the primary in `id`). */
export function selectedFurniture(sel: Selection): string[] { return sel.kind === 'furniture' ? (sel.ids?.length ? sel.ids : [sel.id]) : []; }

export type Tool = 'select' | 'room' | 'hallway' | 'door' | 'furniture' | 'workstation' | 'agent' | 'connect' | 'pan';
export type GlobalView = 'auto' | 'top' | 'front' | 'side' | 'three-quarter';

export interface HistoryEntry { doc: OfficeDoc; label: string }

export interface CommitResult { ok: boolean; summary: string[]; errors: string[]; conflicts: Issue[]; doc?: OfficeDoc }

export interface Preview { doc: OfficeDoc; ops: DocOp[]; runtimeOps: RuntimeOp[]; label: string; summary: string[]; issues: Issue[]; source: 'ai' | 'conflict' }

export type RuntimeOp =
  | { op: 'agent.goTo'; agentId: string; roomId: string | null; workstationId?: string | null }
  | { op: 'task.create'; agentId: string | null; name: string; description?: string; priority?: Task['priority']; roomId?: string | null; workstationId?: string | null; simulated?: boolean; deadline?: string; dependencies?: string[]; id?: string; projectId?: string | null; handoff?: Task['handoff']; costPerUnit?: number; workUnits?: number; viaTube?: boolean; fromAgentId?: string | null }
  | { op: 'task.update'; id: string; patch: Partial<Pick<Task, 'priority' | 'status' | 'agentId' | 'name' | 'description' | 'deadline'>> }
  | { op: 'alert.ack'; id: string } | { op: 'alert.resolve'; id: string } | { op: 'alert.test'; severity: AlertSeverity }
  | { op: 'alert.raise'; input: AlertInput }
  | { op: 'approval.decide'; id: string; approve: boolean }
  | { op: 'action.request'; request: ActionRequest }
  | { op: 'usage.record'; agentId: string | null; projectId: string | null; taskId?: string | null; credits: number; kind?: 'model' | 'tool' | 'purchase'; simulated?: boolean }
  | { op: 'task.dispatchTube'; taskId: string; fromAgentId: string | null }
  | { op: 'task.fail'; id: string; reason: string }
  | { op: 'tasks.batch'; departmentId: string; name: string; count: number; workUnits?: number; projectId?: string | null }
  | { op: 'asset.create'; name: string; kind: AssetKind; ownerAgentId: string | null; projectId?: string | null }
  | { op: 'asset.review'; id: string; approve: boolean; note?: string }
  | { op: 'asset.attachFile'; id: string; file: string }
  | { op: 'arcade.agentPlay'; agentId: string; game: GameId }
  | { op: 'arcade.recordSession'; game: GameId; score: number; durationSec: number; result: ArcadeSession['result'] }
  | { op: 'history.undo' } | { op: 'history.redo' };

interface State {
  doc: OfficeDoc;
  past: HistoryEntry[];
  future: HistoryEntry[];
  lastSaved: { doc: OfficeDoc; at: string } | null;
  dirty: boolean;
  runtime: RuntimeState;
  nav: NavGraph;
  issues: Issue[];
  prefs: Preferences;
  // ui
  mode: 'simulate' | 'construct';
  tool: Tool;
  furnitureType: string;
  placeRotation: 0 | 90 | 180 | 270;
  selection: Selection;
  camera: { x: number; y: number; zoom: number };
  view: GlobalView;
  layers: { grid: boolean; snap: boolean; boundaries: boolean; paths: boolean; occupancy: boolean; labels: boolean; perf: boolean };
  preview: Preview | null;
  conflict: { ops: DocOp[]; label: string; issues: Issue[] } | null;
  profileAgentId: string | null;
  profileTab: string;
  page: 'office' | 'dashboard' | 'control' | 'settings';
  toast: { id: number; text: string; level: 'info' | 'warn' | 'error' } | null;
  hallwayDraft: { roomId: string; doorId: string } | null;

  commit(ops: DocOp[], label: string, opts?: { force?: boolean; silent?: boolean }): CommitResult;
  dryRun(ops: DocOp[]): CommitResult;
  runRuntimeOps(ops: RuntimeOp[]): string[];
  undo(): void; redo(): void;
  setUi(p: Partial<Pick<State, 'mode' | 'tool' | 'selection' | 'camera' | 'view' | 'preview' | 'conflict' | 'profileAgentId' | 'profileTab' | 'page' | 'furnitureType' | 'placeRotation' | 'hallwayDraft'>>): void;
  setLayer(k: keyof State['layers'], v: boolean): void;
  setPrefs(p: Partial<Preferences>): void;
  notify(text: string, level?: 'info' | 'warn' | 'error'): void;
  tick(): void;
  /** Write the office now (skipped when unchanged since the last save). Returns null when it could not save. */
  save(): SaveResult | null;
  /** save() for the Save now button / Ctrl+S: same, plus a toast saying what happened. */
  saveNow(): void;
  /** Set when the saved office was damaged on load; saving stays off until the user chooses. */
  recovery: Extract<LoadResult, { status: 'corrupt' }> | null;
  resolveRecovery(choice: 'backup' | 'fresh'): void;
  saveError: string | null;
  saveVersion(name: string): void;
  restoreVersion(id: string): boolean;
  resetToSaved(): void;
  loadDoc(doc: OfficeDoc, label: string, runtime?: Partial<RuntimeState> | null): void;
  importText(text: string): { ok: boolean; errors: string[]; warnings: string[] };
  exportText(): string;
  newOffice(sample: boolean): void;
}

export const repo: OfficeRepository = createRepository();

const DEFAULT_PREFS: Preferences = { autosave: true, viewMode: 'auto', showDashboard: true, aiProvider: 'mock', autoApplySafe: true, simSpeed: 1, simRunning: true, demoTasks: true, characterStyle: 'rendered' };

function initial() {
  const loaded = repo.load();
  // a damaged save is reported (recovery dialog), never replaced: the sample below is only a placeholder
  const recovery = loaded.status === 'corrupt' ? loaded : null;
  const saved = loaded.status === 'ok' ? loaded : null;
  const doc = saved?.doc ?? sampleOffice();
  const runtime: RuntimeState = { ...emptyRuntime(), ...(saved?.runtime ?? {}) } as RuntimeState;
  runtime.events ??= []; runtime.tasks ??= {}; runtime.agents ??= {}; runtime.usage ??= []; runtime.approvals ??= {}; runtime.alerts ??= {}; runtime.capsules ??= {}; runtime.policyHeld ??= []; runtime.arcadeSessions ??= []; runtime.assets ??= {};
  const nav = buildNav(doc);
  syncRuntime(doc, runtime, nav);
  if (!saved) seedSampleRuntime(doc, runtime);
  if (!saved) log(runtime, { kind: 'system', agentId: null, simulated: false, message: 'Loaded sample office. Agents are simulated; no AI model is connected.' });
  let lastSaved = saved ? { doc, at: saved.savedAt } : null;
  if (loaded.status === 'empty') { try { lastSaved = { doc, at: repo.saveCurrent(doc, runtime).savedAt }; } catch { /* storage unavailable: stay unsaved */ } }
  return { doc, runtime, nav, lastSaved, recovery };
}

function cloneRuntime(rt: RuntimeState): RuntimeState {
  const agents: RuntimeState['agents'] = {};
  for (const [k, a] of Object.entries(rt.agents)) agents[k] = { ...a, pos: { ...a.pos }, path: a.path.slice() };
  const tasks: RuntimeState['tasks'] = {};
  for (const [k, t] of Object.entries(rt.tasks)) tasks[k] = { ...t };
  return { ...rt, agents, tasks, events: rt.events.slice(), usage: rt.usage, approvals: { ...rt.approvals }, alerts: { ...rt.alerts }, capsules: { ...rt.capsules }, assets: { ...rt.assets } };
}

function pruneTasks(rt: RuntimeState) {
  const finished = Object.values(rt.tasks).filter((t) => t.status === 'done' || t.status === 'cancelled').sort((a, b) => (a.completedAt ?? '').localeCompare(b.completedAt ?? ''));
  for (const t of finished.slice(0, Math.max(0, finished.length - 150))) delete rt.tasks[t.id];
}

export const useStore = create<State>((set, get) => {
  const init = initial();
  const prefs = { ...DEFAULT_PREFS, ...repo.loadPrefs() };
  // autosave runs on a 60 s interval (useAutosave in ui/SaveStatus.tsx), not on every change

  const setDoc = (doc: OfficeDoc, prevDoc: OfficeDoc, patch: Partial<State> = {}) => {
    const runtime = cloneRuntime(get().runtime);
    const nav = reconcileLayout(prevDoc, doc, runtime);
    set({ doc, runtime, nav, issues: validate(doc), dirty: true, ...patch });
  };

  return {
    ...init,
    past: [], future: [], dirty: false, saveError: null,
    issues: validate(init.doc),
    prefs,
    mode: 'simulate', tool: 'select', furnitureType: 'desk', placeRotation: 0, selection: { kind: 'none' },
    camera: { x: -40, y: -40, zoom: 0.8 },
    view: (prefs.viewMode as GlobalView) ?? 'auto',
    layers: { grid: true, snap: true, boundaries: true, paths: false, occupancy: true, labels: true, perf: false },
    preview: null, conflict: null, profileAgentId: null, profileTab: 'identity', page: 'office', toast: null, hallwayDraft: null,

    dryRun(ops) {
      const { doc, issues } = get();
      const r = applyOps(doc, ops);
      if (r.errors.length) return { ok: false, summary: [], errors: r.errors, conflicts: [] };
      const after = validate(r.doc);
      return { ok: true, summary: r.summary, errors: [], conflicts: newErrors(issues, after), doc: r.doc };
    },

    commit(ops, label, opts = {}) {
      const t0 = performance.now();
      const { doc, past } = get();
      const res = get().dryRun(ops);
      if (!res.ok) { if (!opts.silent) get().notify(res.errors[0], 'error'); return res; }
      if (res.conflicts.length && !opts.force) {
        set({ conflict: { ops, label, issues: res.conflicts } });
        return { ...res, ok: false };
      }
      setDoc(res.doc!, doc, { past: [...past, { doc, label }].slice(-100), future: [], conflict: null });
      const rt = cloneRuntime(get().runtime);
      log(rt, { kind: 'layout', agentId: null, simulated: false, message: `${label}: ${res.summary.join('; ') || 'no changes'}` });
      set({ runtime: rt });
      markFrame('commit', performance.now() - t0);
      return res;
    },

    runRuntimeOps(ops) {
      const out: string[] = [];
      for (const o of ops) {
        if (o.op === 'history.undo') { get().undo(); out.push('Undid last change'); continue; }
        if (o.op === 'history.redo') { get().redo(); out.push('Redid change'); continue; }
        const { doc, nav } = get();
        const rt = cloneRuntime(get().runtime);
        if ((o.op === 'agent.goTo' || o.op === 'task.create') && o.agentId && isArcade(doc, o.workstationId)) {
          const g = doc.furniture[o.workstationId!].arcade!.game;
          out.push(agentArcadeAttempt(doc, rt, o.agentId, g, o.op === 'agent.goTo' ? 'move request' : 'task').reason);
          set({ runtime: rt }); continue;
        }
        if (o.op === 'arcade.agentPlay') out.push(agentArcadeAttempt(doc, rt, o.agentId, o.game, 'play request').reason);
        if (o.op === 'arcade.recordSession') { recordArcadeSession(rt, { agentId: null, game: o.game, startedAt: new Date(Date.now() - o.durationSec * 1000).toISOString(), durationSec: o.durationSec, score: o.score, result: o.result, reward: 0 }); out.push('Session recorded'); }
        if (o.op === 'asset.create') { const a = createAsset(rt, { name: o.name, kind: o.kind, ownerAgentId: o.ownerAgentId, projectId: o.projectId ?? null }); log(rt, { kind: 'production', agentId: o.ownerAgentId, simulated: false, message: `New production item “${a.name}” assigned${o.ownerAgentId ? ` to ${doc.agents[o.ownerAgentId]?.identity.name}` : ''}` }); out.push(`Created ${a.name}`); }
        if (o.op === 'asset.review') out.push(reviewAsset(rt, o.id, o.approve, o.note) ? (o.approve ? 'Approved' : 'Changes requested') : 'Not awaiting review');
        if (o.op === 'asset.attachFile') out.push(attachRealFile(rt, o.id, o.file) ? 'Attached' : 'Asset not found');
        if (o.op === 'tasks.batch') {
          const members = Object.values(doc.agents).filter((a) => departmentId(a.identity.department || 'General') === o.departmentId && a.enabled);
          if (!members.length) out.push('No agents in that department');
          else {
            const n = Math.max(1, Math.min(200, Math.floor(o.count)));
            for (let i = 0; i < n; i++) {
              const a = members[i % members.length];
              createTask(rt, { name: n > 1 ? `${o.name} (${i + 1}/${n})` : o.name, agentId: a.id, workUnits: o.workUnits ?? 40, projectId: o.projectId ?? null, costPerUnit: 0.01, simulated: true, destination: { roomId: a.schedule.assignedRoomId, workstationId: a.schedule.preferredWorkstationId } });
            }
            log(rt, { kind: 'system', agentId: null, simulated: false, message: `Batch: queued ${n} × “${o.name}” across ${Math.min(n, members.length)} agents` });
            out.push(`Queued ${n} tasks across ${Math.min(n, members.length)} agents`);
          }
        }
        if (o.op === 'agent.goTo') out.push(goTo(doc, rt, nav, o.agentId, o.roomId, o.workstationId ?? null).message);
        if (o.op === 'task.create') {
          const t = createTask(rt, { ...(o.id ? { id: o.id } : {}), name: o.name, description: o.description ?? '', agentId: o.agentId, priority: o.priority ?? 'normal', destination: { roomId: o.roomId ?? null, workstationId: o.workstationId ?? null }, simulated: o.simulated ?? true, deadline: o.deadline, dependencies: o.dependencies ?? [], projectId: o.projectId ?? null, handoff: o.handoff, costPerUnit: o.costPerUnit, ...(o.workUnits ? { workUnits: o.workUnits } : {}) });
          log(rt, { kind: 'system', agentId: o.agentId, simulated: false, message: `Task “${t.name}” queued${o.agentId ? ` for ${doc.agents[o.agentId]?.identity.name}` : ''}` });
          out.push(`Queued task ${t.name}`);
          if (o.viaTube) out.push(dispatchViaTube(doc, rt, t.id, o.fromAgentId ?? null).message);
        }
        if (o.op === 'task.update') {
          const t = rt.tasks[o.id];
          if (t) {
            const wasAgent = t.agentId;
            Object.assign(t, o.patch);
            if (o.patch.status === 'queued' && t.progress >= 100) t.progress = 0;
            if (wasAgent && (o.patch.agentId !== undefined && o.patch.agentId !== wasAgent || o.patch.status === 'cancelled' || o.patch.status === 'paused')) {
              const ar = rt.agents[wasAgent]; if (ar?.currentTaskId === t.id) { ar.currentTaskId = null; ar.status = 'idle'; ar.path = []; ar.destination = null; }
              if (o.patch.agentId) t.status = 'queued';
            }
            log(rt, { kind: 'config', agentId: t.agentId, simulated: false, message: `Task “${t.name}” updated: ${Object.entries(o.patch).map(([k, v]) => `${k}=${v}`).join(', ')}` });
            out.push(`Updated task ${t.name}`);
          }
        }
        if (o.op === 'alert.ack') out.push(acknowledgeAlert(rt, o.id) ? 'Acknowledged' : 'Alert not found');
        if (o.op === 'alert.resolve') out.push(resolveAlert(rt, o.id) ? 'Resolved' : 'Alert not found');
        if (o.op === 'alert.test') out.push(testAlert(doc, rt, o.severity).alert.title);
        if (o.op === 'alert.raise') out.push(raiseAlert(doc, rt, o.input).alert.id);
        if (o.op === 'approval.decide') out.push(decideApproval(doc, rt, o.id, o.approve) ? (o.approve ? 'Approved' : 'Rejected') : 'Already decided');
        if (o.op === 'action.request') { const r = requestAction(doc, rt, o.request); out.push(r.allowed ? 'Allowed' : `Approval requested: ${r.approval.reason}`); }
        if (o.op === 'usage.record') out.push(recordUsage(doc, rt, { agentId: o.agentId, projectId: o.projectId, taskId: o.taskId ?? null, credits: o.credits, kind: o.kind ?? 'model', simulated: o.simulated }).id);
        if (o.op === 'task.dispatchTube') out.push(dispatchViaTube(doc, rt, o.taskId, o.fromAgentId).message);
        if (o.op === 'task.fail') {
          const t = rt.tasks[o.id];
          if (t) {
            const failures = (t.failures ?? 0) + 1;
            rt.tasks[o.id] = { ...t, status: 'failed', failures };
            const name = t.agentId ? doc.agents[t.agentId]?.identity.name ?? 'agent' : 'unassigned';
            log(rt, { kind: 'task-failed', agentId: t.agentId, simulated: t.simulated, level: 'error', message: `“${t.name}” failed (${name}): ${o.reason}` });
            raiseAlert(doc, rt, { key: `task-fail:${t.agentId}:${t.name}`, severity: 'warning', category: 'operational', title: `“${t.name}” failed`, description: o.reason, recommended: 'Retry, or reassign it to another agent.', agentId: t.agentId, taskId: t.id, projectId: t.projectId ?? null, evidence: [{ kind: 'event', id: rt.events[rt.events.length - 1].id, label: o.reason }] });
            out.push(`Recorded failure of ${t.name}`);
          }
        }
        set({ runtime: rt });
      }
      return out;
    },

    undo() {
      const { past, doc, future } = get();
      const e = past[past.length - 1];
      if (!e) { get().notify('Nothing to undo'); return; }
      setDoc(e.doc, doc, { past: past.slice(0, -1), future: [{ doc, label: e.label }, ...future] });
      get().notify(`Undid: ${e.label}`);
    },
    redo() {
      const { past, doc, future } = get();
      const e = future[0];
      if (!e) { get().notify('Nothing to redo'); return; }
      setDoc(e.doc, doc, { past: [...past, { doc, label: e.label }], future: future.slice(1) });
      get().notify(`Redid: ${e.label}`);
    },

    setUi(p) { set(p as Partial<State>); },
    setLayer(k, v) { set({ layers: { ...get().layers, [k]: v } }); },
    setPrefs(p) { const prefs = { ...get().prefs, ...p }; repo.savePrefs(prefs); set({ prefs }); },
    notify(text, level = 'info') { set({ toast: { id: Date.now(), text, level } }); },

    tick() {
      const t0 = performance.now();
      const { doc, nav, prefs } = get();
      const rt = cloneRuntime(get().runtime);
      step(doc, rt, nav, { demoTasks: prefs.demoTasks });
      if (rt.tick % 100 === 0) pruneTasks(rt);
      set({ runtime: rt });
      markFrame('tick', performance.now() - t0, { agents: Object.keys(rt.agents).length, tasks: Object.keys(rt.tasks).length, events: rt.events.length });
    },

    save() {
      const { doc, runtime, recovery } = get();
      if (recovery || repo.savingSuspended) return null;
      try {
        const r = repo.saveCurrent(doc, runtime);
        set({ lastSaved: { doc, at: r.savedAt }, dirty: false, saveError: null });
        return r;
      } catch (e) {
        const msg = (e as Error).message;
        if (get().saveError !== msg) get().notify(msg, 'error');
        set({ saveError: msg });
        return null;
      }
    },
    saveNow() {
      if (get().recovery) { get().notify('Saving is paused until you choose how to recover the damaged save.', 'warn'); return; }
      const r = get().save();
      if (!r) { const e = get().saveError; if (e) get().notify(e, 'error'); return; }
      get().notify(r.status === 'saved' ? 'Office saved' : 'Already saved: nothing changed since the last save');
    },
    resolveRecovery(choice) {
      const rec = get().recovery;
      if (!rec) return;
      repo.resumeSaving();
      if (choice === 'backup' && rec.backup) get().loadDoc(rec.backup.doc, 'Restore backup', rec.backup.runtime ?? {});
      else get().newOffice(true);
      set({ recovery: null, past: [], future: [] });
      const r = get().save();
      get().notify(choice === 'backup' && rec.backup ? `Restored the backup from ${new Date(rec.backup.savedAt).toLocaleString()}${r ? '' : ' (not saved yet)'}` : `Started a fresh office${r ? '' : ' (not saved yet)'}`, r ? 'info' : 'warn');
    },
    saveVersion(name) {
      try { repo.saveVersion(name, get().doc); get().save(); get().notify(`Saved version “${name}”`); }
      catch (e) { get().notify((e as Error).message, 'error'); }
    },
    restoreVersion(id) {
      const d = repo.loadVersion(id);
      if (!d) { get().notify('That version could not be loaded', 'error'); return false; }
      get().loadDoc(d, 'Restore version');
      return true;
    },
    resetToSaved() {
      const s = get().lastSaved;
      if (!s) { get().notify('No saved version yet', 'warn'); return; }
      get().loadDoc(s.doc, 'Reset to last save');
    },
    loadDoc(doc, label, runtime) {
      const prev = get().doc;
      if (runtime) {
        const rt = { ...emptyRuntime(), ...runtime } as RuntimeState;
        const nav = buildNav(doc); syncRuntime(doc, rt, nav);
        set({ runtime: rt });
      }
      setDoc(doc, prev, { past: [...get().past, { doc: prev, label }].slice(-100), future: [], selection: { kind: 'none' } });
    },
    importText(text) {
      let data: unknown;
      try { data = JSON.parse(text); } catch { return { ok: false, errors: ['Not valid JSON'], warnings: [] }; }
      const r = parseOffice(data);
      if (!r.ok) return { ok: false, errors: r.errors, warnings: [] };
      // imported office gets fresh runtime; agents start at their workstations
      const prev = get().doc;
      const rt = emptyRuntime(); const nav = buildNav(r.doc); syncRuntime(r.doc, rt, nav);
      log(rt, { kind: 'system', agentId: null, simulated: false, message: `Imported office “${r.doc.name}”` });
      set({ runtime: rt });
      setDoc(r.doc, prev, { past: [...get().past, { doc: prev, label: 'Import office' }].slice(-100), future: [], selection: { kind: 'none' } });
      return { ok: true, errors: [], warnings: r.warnings };
    },
    exportText() {
      const { doc, runtime } = get();
      return exportOffice(doc, { runtime: { tasks: runtime.tasks } });
    },
    newOffice(sample) {
      const doc = sample ? sampleOffice() : emptyOffice('Blank Office');
      const prev = get().doc;
      const rt = emptyRuntime(); const nav = buildNav(doc); syncRuntime(doc, rt, nav);
      if (sample) seedSampleRuntime(doc, rt);
      set({ runtime: rt });
      setDoc(doc, prev, { past: [...get().past, { doc: prev, label: 'New office' }].slice(-100), future: [], selection: { kind: 'none' } });
    },
  };
});

export const selectAgents = (s: State) => s.doc.agents;
