// Application state. Three layers, kept deliberately separate:
//  - doc      : persistent, undoable brain (agents, knowledge, skills, settings)
//  - runtime  : persistent work state (tasks, usage, approvals, activity log); not undoable
//  - ui       : ephemeral view state (selection, page, profile) — never saved
import { create } from 'zustand';
import type { AlertSeverity, OfficeDoc, RuntimeState, Task } from '../model/types';
import { acknowledgeAlert, raiseAlert, resolveAlert, testAlert, type AlertInput } from '../engine/alerts';
import { decideApproval, recordUsage, requestAction, type ActionRequest } from '../engine/governance';
import { applyOps, type DocOp } from '../engine/ops';
import { createTask, emptyRuntime, log, step, syncRuntime } from '../engine/simulation';
import { creatorBrain } from '../model/sample';
import { ORIGIN_ID } from '../brain/opportunity';
import { createRepository, type LoadResult, type OfficeRepository, type Preferences, type SaveResult } from '../persistence/repository';
import { exportOffice, parseOffice } from '../model/schema';
import { withBrainTheme } from '../model/themes';
import { libraryDocs, librarySkillBanks, listBrains, peekBrain, putBrain, removeBrain, takeBrain, type BrainSummary } from '../persistence/brains';
import { applyBrainChange, buildPlannedBrain, mergeIntoHead, newBrainId, pickHeadId, splitVenture, storeVentureIn, withLead, type BrainProposal } from '../brain/headBrain';
import { sharedSkillOps } from '../brain/brainUniverse';

export type Selection = { kind: 'none' } | { kind: 'agent'; id: string };

export interface HistoryEntry { doc: OfficeDoc; label: string }

export interface CommitResult { ok: boolean; summary: string[]; errors: string[]; doc?: OfficeDoc }

export type RuntimeOp =
  | { op: 'task.create'; agentId: string | null; name: string; description?: string; priority?: Task['priority']; simulated?: boolean; deadline?: string; dependencies?: string[]; id?: string; projectId?: string | null; handoff?: Task['handoff']; costPerUnit?: number; workUnits?: number }
  | { op: 'task.update'; id: string; patch: Partial<Pick<Task, 'priority' | 'status' | 'agentId' | 'name' | 'description' | 'deadline'>> }
  | { op: 'alert.ack'; id: string } | { op: 'alert.resolve'; id: string } | { op: 'alert.test'; severity: AlertSeverity }
  | { op: 'alert.raise'; input: AlertInput }
  | { op: 'approval.decide'; id: string; approve: boolean }
  | { op: 'action.request'; request: ActionRequest }
  | { op: 'usage.record'; agentId: string | null; projectId: string | null; taskId?: string | null; credits: number; kind?: 'model' | 'tool' | 'purchase'; simulated?: boolean }
  | { op: 'task.fail'; id: string; reason: string }
  | { op: 'history.undo' } | { op: 'history.redo' };

interface State {
  doc: OfficeDoc;
  past: HistoryEntry[];
  future: HistoryEntry[];
  lastSaved: { doc: OfficeDoc; at: string } | null;
  dirty: boolean;
  runtime: RuntimeState;
  prefs: Preferences;
  // ui
  selection: Selection;
  profileAgentId: string | null;
  profileTab: string;
  page: 'office' | 'universe' | 'dashboard' | 'charts' | 'approvals' | 'ads' | 'settings';

  commit(ops: DocOp[], label: string, opts?: { silent?: boolean }): CommitResult;
  dryRun(ops: DocOp[]): CommitResult;
  runRuntimeOps(ops: RuntimeOp[]): string[];
  undo(): void; redo(): void;
  setUi(p: Partial<Pick<State, 'selection' | 'profileAgentId' | 'profileTab' | 'page'>>): void;
  setPrefs(p: Partial<Preferences>): void;
  toast: { id: number; text: string; level: 'info' | 'warn' | 'error' } | null;
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
  /** Start a fresh brain with only JARVIS. */
  newBrain(): void;
  /** The other brains the owner started, kept in the brain library while this one is open. */
  brains: BrainSummary[];
  refreshBrains(): void;
  /** Keep the open brain in the library and start a new one that already knows the other brains' skills. */
  startNewBrain(name?: string): boolean;
  /** Add a new brain to the library (on the ring around the open one) without leaving the open brain. */
  addBrain(name?: string): BrainSummary | null;
  /** Keep the open brain in the library and open another one from it. */
  switchBrain(id: string): boolean;
  deleteBrain(id: string): boolean;
  /** Move a venture (the store one when none is named) out of the head brain into a brain of its own, run by JARVIS. Saves a version first. */
  moveVentureToBrain(ventureId?: string): BrainSummary | null;
  /** Put a moved brain's agents back into the head brain and remove that brain (the open brain must be the head). */
  moveBrainBack(id: string): boolean;
  /** Build the brain an approved layout describes; returns its id and its agents' ids by lowercase name. */
  buildBrain(p: BrainProposal): { brainId: string; agentIds: Record<string, string> } | null;
  /** Apply an approved change to a brain, open or in the library. */
  changeBrain(p: BrainProposal): { brainId: string; agentIds: Record<string, string> } | null;
  /** Change any brain, the open one (undoable) or one in the library. */
  updateBrain(id: string, fn: (doc: OfficeDoc) => OfficeDoc | null, label: string): boolean;
  /** Who runs a brain: 'jarvis' or one of its agents. */
  setBrainLead(id: string, lead: string): boolean;
}

export const repo: OfficeRepository = createRepository();

const DEFAULT_PREFS: Preferences = { autosave: true, showDashboard: true, simSpeed: 1, simRunning: true };

function initial() {
  const loaded = repo.load();
  // a damaged save is reported (recovery dialog), never replaced: the sample below is only a placeholder
  const recovery = loaded.status === 'corrupt' ? loaded : null;
  const saved = loaded.status === 'ok' ? loaded : null;
  const doc = withHead(withOrigin(saved?.doc ?? creatorBrain())); // first run opens the user-led agent brain
  const runtime: RuntimeState = { ...emptyRuntime(), ...(saved?.runtime ?? {}) } as RuntimeState;
  runtime.events ??= []; runtime.tasks ??= {}; runtime.agents ??= {}; runtime.usage ??= []; runtime.approvals ??= {}; runtime.alerts ??= {};
  cleanRuntime(runtime, doc);
  syncRuntime(doc, runtime);
  if (!saved) log(runtime, { kind: 'system', agentId: null, simulated: false, message: 'Started a new brain with JARVIS.' });
  let lastSaved = saved ? { doc, at: saved.savedAt } : null;
  if (loaded.status === 'empty') { try { lastSaved = { doc, at: repo.saveCurrent(doc, runtime).savedAt }; } catch { /* storage unavailable: stay unsaved */ } }
  return { doc, runtime, lastSaved, recovery };
}

/** JARVIS's head brain is marked once: the original brain (or the biggest one the owner started), whether it is open or in the library. */
function withHead(doc: OfficeDoc): OfficeDoc {
  let lib: OfficeDoc[] = [];
  try { lib = libraryDocs(); } catch { /* storage unavailable */ }
  if (doc.head || lib.some((d) => d.head)) return doc;
  const id = pickHeadId([doc, ...lib]);
  if (id === doc.id) return { ...doc, head: true };
  const b = id ? peekBrain(id) : null;
  if (b) { try { putBrain({ ...b.doc, head: true }, b.runtime); } catch { /* marked next time */ } }
  return doc;
}
const ownerPlan = (): OfficeDoc['plan'] => ({ purpose: '', lead: 'jarvis', createdBy: 'owner', createdAt: new Date().toISOString(), research: [], history: [] });

/** The brain always has JARVIS at its core; a save without it gets a fresh JARVIS. */
function withOrigin(doc: OfficeDoc): OfficeDoc {
  if (!doc.agents[ORIGIN_ID]) return { ...doc, agents: { ...doc.agents, [ORIGIN_ID]: creatorBrain().agents[ORIGIN_ID] } };
  return renamedLeader({ ...doc, appearance: withBrainTheme(doc.appearance) });
}

/** The owner renamed ORIGIN to JARVIS (2026-10-21); older saves get the new name in its profile, every agent's instructions and the skill bank. */
export function renamedLeader(doc: OfficeDoc): OfficeDoc {
  const has = /\bORIGIN\b/;
  const lead = doc.agents[ORIGIN_ID];
  const stale = (lead && lead.identity.name === 'ORIGIN') || Object.values(doc.agents).some((a) => has.test(a.ai.systemInstructions) || has.test(a.ai.agentInstructions)) || doc.skillBank.some((k) => has.test(k.description) || has.test(k.instructions));
  if (!stale) return doc;
  const agents = Object.fromEntries(Object.entries(doc.agents).map(([id, a]) => [id, {
    ...a,
    identity: id === ORIGIN_ID && a.identity.name === 'ORIGIN' ? { ...a.identity, name: 'JARVIS' } : a.identity,
    ai: { ...a.ai, systemInstructions: a.ai.systemInstructions.replace(/\bORIGIN\b/g, 'JARVIS'), agentInstructions: a.ai.agentInstructions.replace(/\bORIGIN\b/g, 'JARVIS') },
  }]));
  const skillBank = doc.skillBank.map((k) => ({ ...k, description: k.description.replace(/\bORIGIN\b/g, 'JARVIS'), instructions: k.instructions.replace(/\bORIGIN\b/g, 'JARVIS') }));
  return { ...doc, agents, skillBank };
}

/** Older saves carried office state (positions, tubes, the arcade, production) and simulated work; drop both. */
function cleanRuntime(rt: RuntimeState, doc: OfficeDoc) {
  const old = rt as unknown as Record<string, unknown>;
  for (const k of ['capsules', 'policyHeld', 'arcadeSessions', 'assets']) delete old[k];
  for (const [id, a] of Object.entries(rt.agents)) rt.agents[id] = { status: a.status === ('walking' as string) ? 'idle' : a.status, currentTaskId: a.currentTaskId, statusMessage: a.statusMessage, waitTicks: a.waitTicks ?? 0 };
  for (const t of Object.values(rt.tasks)) {
    const o = t as unknown as Record<string, unknown>;
    for (const k of ['destination', 'deliveredVia', 'jobKind', 'assetId', 'checkpoint']) delete o[k];
    if (t.status === ('in-transit' as string)) t.status = 'queued';
    if (t.heldBy && t.heldBy !== 'emergency') t.heldBy = null;
  }
  // nothing is simulated: real work is JARVIS's, kept by its runner. Tasks made up in the browser,
  // and the usage, approvals and log lines they produced, are cleared.
  rt.tasks = {};
  rt.approvals = {};
  rt.alerts = {};
  rt.usage = rt.usage.filter((u) => !u.simulated);
  rt.events = rt.events.filter((e) => !e.simulated);
  for (const [id, a] of Object.entries(rt.agents)) if (doc.agents[id]) rt.agents[id] = { ...a, status: doc.agents[id].enabled ? 'idle' : 'paused', currentTaskId: null, statusMessage: undefined, waitTicks: 0 };
}

function cloneRuntime(rt: RuntimeState): RuntimeState {
  const agents: RuntimeState['agents'] = {};
  for (const [k, a] of Object.entries(rt.agents)) agents[k] = { ...a };
  const tasks: RuntimeState['tasks'] = {};
  for (const [k, t] of Object.entries(rt.tasks)) tasks[k] = { ...t };
  return { ...rt, agents, tasks, events: rt.events.slice(), usage: rt.usage, approvals: { ...rt.approvals }, alerts: { ...rt.alerts } };
}

function pruneTasks(rt: RuntimeState) {
  const finished = Object.values(rt.tasks).filter((t) => t.status === 'done' || t.status === 'cancelled').sort((a, b) => (a.completedAt ?? '').localeCompare(b.completedAt ?? ''));
  for (const t of finished.slice(0, Math.max(0, finished.length - 150))) delete rt.tasks[t.id];
}

export const useStore = create<State>((set, get) => {
  const init = initial();
  const loaded = repo.loadPrefs();
  const prefs = { ...DEFAULT_PREFS, ...loaded };
  // office-era preferences
  for (const k of ['characterStyle', 'hqView', 'viewMode', 'aiProvider', 'autoApplySafe', 'demoTasks']) delete (prefs as Record<string, unknown>)[k];
  // autosave (useAutosave in ui/SaveStatus.tsx) saves shortly after each change and on a 60 s interval

  const setDoc = (doc: OfficeDoc, patch: Partial<State> = {}) => {
    const runtime = cloneRuntime(get().runtime);
    syncRuntime(doc, runtime);
    set({ doc, runtime, dirty: true, ...patch });
  };

  return {
    ...init,
    past: [], future: [], dirty: false, saveError: null,
    prefs,
    selection: { kind: 'none' }, profileAgentId: null, profileTab: 'identity', page: 'office', toast: null,

    dryRun(ops) {
      const r = applyOps(get().doc, ops);
      if (r.errors.length) return { ok: false, summary: [], errors: r.errors };
      return { ok: true, summary: r.summary, errors: [], doc: r.doc };
    },

    commit(ops, label, opts = {}) {
      const { doc, past } = get();
      const res = get().dryRun(ops);
      if (!res.ok) { if (!opts.silent) get().notify(res.errors[0], 'error'); return res; }
      setDoc(res.doc!, { past: [...past, { doc, label }].slice(-100), future: [] });
      const rt = cloneRuntime(get().runtime);
      log(rt, { kind: 'change', agentId: null, simulated: false, message: `${label}: ${res.summary.join('; ') || 'no changes'}` });
      set({ runtime: rt });
      return res;
    },

    runRuntimeOps(ops) {
      const out: string[] = [];
      for (const o of ops) {
        if (o.op === 'history.undo') { get().undo(); out.push('Undid last change'); continue; }
        if (o.op === 'history.redo') { get().redo(); out.push('Redid change'); continue; }
        const { doc } = get();
        const rt = cloneRuntime(get().runtime);
        if (o.op === 'task.create') {
          const t = createTask(rt, { ...(o.id ? { id: o.id } : {}), name: o.name, description: o.description ?? '', agentId: o.agentId, priority: o.priority ?? 'normal', simulated: o.simulated ?? true, deadline: o.deadline, dependencies: o.dependencies ?? [], projectId: o.projectId ?? null, handoff: o.handoff, costPerUnit: o.costPerUnit, ...(o.workUnits ? { workUnits: o.workUnits } : {}) });
          log(rt, { kind: 'system', agentId: o.agentId, simulated: false, message: `Task “${t.name}” queued${o.agentId ? ` for ${doc.agents[o.agentId]?.identity.name}` : ''}` });
          out.push(`Queued task ${t.name}`);
        }
        if (o.op === 'task.update') {
          const t = rt.tasks[o.id];
          if (t) {
            const wasAgent = t.agentId;
            Object.assign(t, o.patch);
            if (o.patch.status === 'queued' && t.progress >= 100) t.progress = 0;
            if (wasAgent && (o.patch.agentId !== undefined && o.patch.agentId !== wasAgent || o.patch.status === 'cancelled' || o.patch.status === 'paused')) {
              const ar = rt.agents[wasAgent]; if (ar?.currentTaskId === t.id) { ar.currentTaskId = null; ar.status = 'idle'; }
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
      setDoc(e.doc, { past: past.slice(0, -1), future: [{ doc, label: e.label }, ...future] });
      get().notify(`Undid: ${e.label}`);
    },
    redo() {
      const { past, doc, future } = get();
      const e = future[0];
      if (!e) { get().notify('Nothing to redo'); return; }
      setDoc(e.doc, { past: [...past, { doc, label: e.label }], future: future.slice(1) });
      get().notify(`Redid: ${e.label}`);
    },

    setUi(p) { set(p as Partial<State>); },
    setPrefs(p) { const prefs = { ...get().prefs, ...p }; repo.savePrefs(prefs); set({ prefs }); },
    notify(text, level = 'info') { set({ toast: { id: Date.now(), text, level } }); },

    tick() {
      const rt = cloneRuntime(get().runtime);
      step(get().doc, rt);
      if (rt.tick % 100 === 0) pruneTasks(rt);
      set({ runtime: rt });
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
      get().notify(r.status === 'saved' ? 'Brain saved' : 'Already saved: nothing changed since the last save');
    },
    resolveRecovery(choice) {
      const rec = get().recovery;
      if (!rec) return;
      repo.resumeSaving();
      if (choice === 'backup' && rec.backup) get().loadDoc(rec.backup.doc, 'Restore backup', rec.backup.runtime ?? {});
      else get().newBrain();
      set({ recovery: null, past: [], future: [] });
      const r = get().save();
      get().notify(choice === 'backup' && rec.backup ? `Restored the backup from ${new Date(rec.backup.savedAt).toLocaleString()}${r ? '' : ' (not saved yet)'}` : `Started a fresh brain${r ? '' : ' (not saved yet)'}`, r ? 'info' : 'warn');
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
    loadDoc(loaded, label, runtime) {
      const doc = withOrigin(loaded);
      const prev = get().doc;
      if (runtime) {
        const rt = { ...emptyRuntime(), ...runtime } as RuntimeState;
        cleanRuntime(rt, doc); syncRuntime(doc, rt);
        set({ runtime: rt });
      }
      setDoc(doc, { past: [...get().past, { doc: prev, label }].slice(-100), future: [], selection: { kind: 'none' } });
    },
    importText(text) {
      let data: unknown;
      try { data = JSON.parse(text); } catch { return { ok: false, errors: ['Not valid JSON'], warnings: [] }; }
      const r = parseOffice(data);
      if (!r.ok) return { ok: false, errors: r.errors, warnings: [] };
      r.doc = withOrigin(r.doc);
      // an imported brain gets fresh runtime
      const prev = get().doc;
      const rt = emptyRuntime(); syncRuntime(r.doc, rt);
      log(rt, { kind: 'system', agentId: null, simulated: false, message: `Imported brain “${r.doc.name}”` });
      set({ runtime: rt });
      setDoc(r.doc, { past: [...get().past, { doc: prev, label: 'Import brain' }].slice(-100), future: [], selection: { kind: 'none' } });
      return { ok: true, errors: [], warnings: r.warnings };
    },
    exportText() {
      const { doc, runtime } = get();
      return exportOffice(doc, { runtime: { tasks: runtime.tasks } });
    },
    newBrain() {
      const doc = creatorBrain();
      const prev = get().doc;
      const rt = emptyRuntime(); syncRuntime(doc, rt);
      set({ runtime: rt });
      setDoc(doc, { past: [...get().past, { doc: prev, label: 'New brain' }].slice(-100), future: [], selection: { kind: 'none' }, page: 'office' });
    },
    brains: (() => { try { return listBrains(); } catch { return []; } })(),
    refreshBrains() { try { set({ brains: listBrains() }); } catch { /* storage unavailable */ } },
    startNewBrain(name) {
      const { doc: prev, runtime } = get();
      try { putBrain(prev, { tasks: runtime.tasks }); } catch (e) { get().notify((e as Error).message, 'error'); return false; }
      // the sample brain is frozen, so the new brain is a copy with its own id and name
      const doc = { ...creatorBrain(), id: newBrainId(), name: (name ?? '').trim() || `Brain ${listBrains().length + 1}`, head: false, plan: ownerPlan() };
      // a new brain grows from what the other brains learned
      const grown = applyOps(doc, sharedSkillOps(doc, [{ brainId: prev.id, brainName: prev.name, skills: prev.skillBank ?? [] }, ...librarySkillBanks()]));
      const rt = emptyRuntime(); syncRuntime(grown.doc, rt);
      log(rt, { kind: 'system', agentId: null, simulated: false, message: `Started the brain “${doc.name}” with JARVIS and ${grown.doc.skillBank.length} skills from the other brains.` });
      set({ runtime: rt });
      setDoc(grown.doc, { past: [...get().past, { doc: prev, label: 'Start new brain' }].slice(-100), future: [], selection: { kind: 'none' }, page: 'universe', brains: listBrains() });
      get().save();
      return true;
    },
    addBrain(name) {
      const { doc: open } = get();
      const doc = { ...creatorBrain(), id: newBrainId(), name: (name ?? '').trim() || `Brain ${listBrains().length + 2}`, head: false, plan: ownerPlan() };
      // like a started brain, it already knows what the open brain and the others learned
      const grown = applyOps(doc, sharedSkillOps(doc, [{ brainId: open.id, brainName: open.name, skills: open.skillBank ?? [] }, ...librarySkillBanks()]));
      try { putBrain(grown.doc, null); } catch (e) { get().notify((e as Error).message, 'error'); return null; }
      const brains = listBrains();
      set({ brains });
      return brains.find((b) => b.id === grown.doc.id) ?? null;
    },
    switchBrain(id) {
      const { doc: prev, runtime } = get();
      if (id === prev.id) return true;
      let target;
      try { target = takeBrain(id); } catch (e) { get().notify((e as Error).message, 'error'); return false; }
      if (!target) { get().notify('That brain is not in the library any more.', 'warn'); return false; }
      try { putBrain(prev, { tasks: runtime.tasks }); } catch (e) { try { putBrain(target.doc, target.runtime); } catch { /* keep going */ } get().notify((e as Error).message, 'error'); return false; }
      // what the other brains learned since this one was last open
      const grown = applyOps(target.doc, sharedSkillOps(target.doc, [{ brainId: prev.id, brainName: prev.name, skills: prev.skillBank ?? [] }, ...librarySkillBanks()]));
      get().loadDoc(grown.doc, `Open brain “${target.name}”`, target.runtime ?? {});
      set({ brains: listBrains() });
      get().save();
      return true;
    },
    deleteBrain(id) {
      let ok = false;
      if (peekBrain(id)?.doc.head) { get().notify('JARVIS\'s head brain cannot be deleted: it runs all the others.', 'warn'); return false; }
      try { ok = removeBrain(id); } catch (e) { get().notify((e as Error).message, 'error'); return false; }
      set({ brains: listBrains() });
      return ok;
    },
    moveVentureToBrain(ventureId) {
      const { doc: head } = get();
      if (!head.head) { get().notify('Open JARVIS\'s head brain to move a venture out of it.', 'warn'); return null; }
      const v = ventureId ?? storeVentureIn(head);
      if (!v) return null;
      const r = splitVenture(head, v, { name: head.agents[v]?.identity.name });
      if ('error' in r) { get().notify(r.error, 'warn'); return null; }
      // a version to go back to, then the new brain, then the head brain without the venture
      try { repo.saveVersion(`Before moving ${head.agents[v].identity.name} into its own brain`, head); putBrain(r.brain, null); } catch (e) { get().notify((e as Error).message, 'error'); return null; }
      setDoc(r.head, { past: [...get().past, { doc: head, label: `Move ${r.brain.name} into its own brain` }].slice(-100), future: [], selection: { kind: 'none' }, brains: listBrains() });
      const rt = cloneRuntime(get().runtime);
      log(rt, { kind: 'change', agentId: null, simulated: false, message: `Moved ${r.brain.name} and its ${Object.keys(r.brain.agents).length - 1} agents into a brain of its own. JARVIS runs it until you hook up another agent.` });
      set({ runtime: rt });
      get().save();
      return listBrains().find((b) => b.id === r.brain.id) ?? null;
    },
    moveBrainBack(id) {
      const { doc: head } = get();
      const b = peekBrain(id);
      if (!head.head || !b) { get().notify('Open JARVIS\'s head brain to move a brain back into it.', 'warn'); return false; }
      const merged = mergeIntoHead(head, b.doc);
      try { repo.saveVersion(`Before moving ${b.name} back`, head); removeBrain(id); } catch (e) { get().notify((e as Error).message, 'error'); return false; }
      setDoc(merged, { past: [...get().past, { doc: head, label: `Move ${b.name} back into ${head.name}` }].slice(-100), future: [], selection: { kind: 'none' }, brains: listBrains() });
      get().save();
      return true;
    },
    buildBrain(p) {
      const { doc: open } = get();
      const head = open.head ? open : libraryDocs().find((d) => d.head) ?? open;
      const r = buildPlannedBrain(head, p);
      if (!Object.keys(r.agentIds).length) { get().notify(`Couldn't build ${p.name}: ${r.errors.join('; ')}`, 'error'); return null; }
      const grown = applyOps(r.doc, sharedSkillOps(r.doc, [{ brainId: open.id, brainName: open.name, skills: open.skillBank ?? [] }, ...librarySkillBanks()]));
      try { putBrain(grown.doc, null); } catch (e) { get().notify((e as Error).message, 'error'); return null; }
      set({ brains: listBrains() });
      if (r.errors.length) get().notify(`Built ${p.name}, but: ${r.errors.join('; ')}`, 'warn');
      return { brainId: r.doc.id, agentIds: r.agentIds };
    },
    changeBrain(p) {
      if (!p.brainId) return null;
      let agentIds: Record<string, string> = {};
      let errors: string[] = [];
      const ok = get().updateBrain(p.brainId, (d) => { const r = applyBrainChange(d, p); agentIds = r.agentIds; errors = r.errors; return r.doc; }, `Grow ${p.name}`);
      if (errors.length) get().notify(`${p.name}: ${errors.join('; ')}`, 'warn');
      return ok ? { brainId: p.brainId, agentIds } : null;
    },
    updateBrain(id, fn, label) {
      const { doc: open } = get();
      if (id === open.id) {
        const next = fn(open);
        if (!next) return false;
        setDoc(next, { past: [...get().past, { doc: open, label }].slice(-100), future: [] });
        return true;
      }
      const b = peekBrain(id);
      if (!b) { get().notify('That brain is not in the library any more.', 'warn'); return false; }
      const next = fn(b.doc);
      if (!next) return false;
      try { putBrain(next, b.runtime); } catch (e) { get().notify((e as Error).message, 'error'); return false; }
      set({ brains: listBrains() });
      return true;
    },
    setBrainLead(id, lead) {
      let err: string | null = null;
      const ok = get().updateBrain(id, (d) => { const r = withLead(d, lead); if ('error' in r) { err = r.error; return null; } return r.doc; }, 'Change who runs the brain');
      if (err) get().notify(err, 'warn');
      return ok;
    },
  };
});

export const selectAgents = (s: State) => s.doc.agents;
