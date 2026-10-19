// Game and 3D asset production: assignment → creation → preview → review →
// approval → export → integration. Agents advance the stages they own by
// finishing tasks; review and approval belong to the owner. A stage reached
// by simulated work stays marked simulated: an asset only counts as real once
// a produced file has been attached and verified (via the Blender bridge).
import type { Agent, AssetJob, AssetKind, AssetStage, OfficeDoc, RuntimeState, Task } from '../model/types';
import { uid } from '../model/defaults';
import { createTask, log } from './simulation';

const BLENDER_KINDS: AssetKind[] = ['character', 'prop', 'cosmetic', 'environment', 'animation'];
export const isBlenderKind = (k: AssetKind) => BLENDER_KINDS.includes(k);

export const STAGE_LABEL: Record<AssetStage, string> = {
  assigned: 'Assigned', creating: 'In creation', preview: 'Preview', review: 'Awaiting review', approved: 'Approved',
  exported: 'Exported', integrated: 'Integrated', rejected: 'Changes requested',
};

/** The task that moves an asset out of its current stage, and who may do it. */
function stageWork(a: AssetJob): { verb: string; next: AssetStage; jobKind: Task['jobKind']; units: number; integrator?: boolean } | null {
  const blender = isBlenderKind(a.kind);
  switch (a.stage) {
    case 'assigned': case 'rejected': return { verb: blender ? 'Block out' : 'Draft', next: 'creating', jobKind: 'standard', units: 60 };
    case 'creating': return { verb: blender ? 'Model and texture' : a.kind === 'luau-script' ? 'Script' : 'Build', next: 'preview', jobKind: 'standard', units: 110 };
    case 'preview': return { verb: blender ? 'Render preview of' : 'Playtest', next: 'review', jobKind: blender ? 'render' : 'standard', units: 90 };
    case 'approved': return { verb: blender ? 'Export' : 'Package', next: 'exported', jobKind: 'standard', units: 50 };
    case 'exported': return { verb: 'Integrate and test', next: 'integrated', jobKind: 'standard', units: 70, integrator: true };
    default: return null; // review needs the owner; integrated is done
  }
}

export function createAsset(rt: RuntimeState, a: Omit<AssetJob, 'id' | 'stage' | 'history' | 'real' | 'notes'> & Partial<Pick<AssetJob, 'id' | 'notes'>>, now = new Date()): AssetJob {
  const job: AssetJob = { notes: '', ...a, id: a.id ?? uid('asset'), stage: 'assigned', history: [{ stage: 'assigned', at: now.toISOString(), by: null, simulated: false }], real: null };
  rt.assets = { ...rt.assets, [job.id]: job };
  return job;
}

const busy = (rt: RuntimeState, assetId: string) => Object.values(rt.tasks).some((t) => t.assetId === assetId && t.status !== 'done' && t.status !== 'cancelled');

/** Next production task for this agent, if any asset is waiting on them. */
export function productionTask(doc: OfficeDoc, rt: RuntimeState, agent: Agent): Task | null {
  const integrator = agent.archetype === 'qa-integrator';
  for (const job of Object.values(rt.assets)) {
    const w = stageWork(job);
    if (!w || busy(rt, job.id)) continue;
    const mine = w.integrator ? (integrator || (job.ownerAgentId === agent.id && !Object.values(doc.agents).some((x) => x.archetype === 'qa-integrator' && x.enabled))) : job.ownerAgentId === agent.id;
    if (!mine) continue;
    return createTask(rt, {
      name: `${w.verb} ${job.name}`, agentId: agent.id, assetId: job.id, jobKind: w.jobKind, workUnits: w.units,
      projectId: job.projectId, costPerUnit: 0.02, description: `Production stage: ${STAGE_LABEL[job.stage]} → ${STAGE_LABEL[w.next]}`,
      destination: { roomId: agent.schedule.assignedRoomId, workstationId: agent.schedule.preferredWorkstationId },
    });
  }
  return null;
}

/** Called when a task finishes: move its asset to the next stage. */
export function completeAssetTask(doc: OfficeDoc, rt: RuntimeState, t: Task, now = new Date()) {
  const job = t.assetId ? rt.assets[t.assetId] : undefined; if (!job) return;
  const w = stageWork(job); if (!w) return;
  const next: AssetJob = { ...job, stage: w.next, history: [...job.history, { stage: w.next, at: now.toISOString(), by: t.agentId, simulated: t.simulated }].slice(-200) };
  rt.assets = { ...rt.assets, [job.id]: next };
  const who = t.agentId ? doc.agents[t.agentId]?.identity.name : 'An agent';
  log(rt, { kind: 'production', agentId: t.agentId, simulated: t.simulated, message: `${who} moved “${job.name}” to ${STAGE_LABEL[w.next]}${t.simulated ? ' (simulated: no file produced)' : ''}` });
}

/** The owner's review decision. Rejection sends the asset back for changes. */
export function reviewAsset(rt: RuntimeState, id: string, approve: boolean, note = '', now = new Date()) {
  const job = rt.assets[id]; if (!job || job.stage !== 'review') return false;
  const stage: AssetStage = approve ? 'approved' : 'rejected';
  rt.assets = { ...rt.assets, [id]: { ...job, stage, notes: note || job.notes, history: [...job.history, { stage, at: now.toISOString(), by: null, simulated: false }] } };
  log(rt, { kind: 'production', agentId: null, simulated: false, message: `Owner ${approve ? 'approved' : 'requested changes to'} “${job.name}”` });
  return true;
}

/** Attach a real output file (reported by the Blender bridge). Only this makes an asset count as real. */
export function attachRealFile(rt: RuntimeState, id: string, file: string, now = new Date()) {
  const job = rt.assets[id]; if (!job) return false;
  rt.assets = { ...rt.assets, [id]: { ...job, real: { file, verifiedAt: now.toISOString() } } };
  log(rt, { kind: 'production', agentId: null, simulated: false, message: `Real output attached to “${job.name}”: ${file}` });
  return true;
}

/** Human-readable truth about an asset: how far it got, and whether anything real exists. */
export function assetTruth(job: AssetJob): string {
  if (job.real) return `Real file: ${job.real.file}`;
  const simulated = job.history.some((h) => h.simulated);
  return simulated ? 'Simulated progress only: no Blender or Roblox file has been produced' : 'Not started';
}
