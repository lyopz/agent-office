// Budgets, usage records and owner approvals. Spending is simulated unless a
// live integration records it; every record says which.
import type { ApprovalRequest, OfficeDoc, RuntimeState, UsageRecord } from '../model/types';
import { uid } from '../model/defaults';
import { log } from './simulation';
import { raiseAlert, resolveAlert } from './alerts';

export function projectSpend(rt: RuntimeState, projectId: string) {
  let s = 0; for (const u of rt.usage) if (u.projectId === projectId) s += u.credits; return s;
}
export function agentSpend(rt: RuntimeState, agentId: string, since?: string) {
  let s = 0; for (const u of rt.usage) if (u.agentId === agentId && (!since || u.at >= since)) s += u.credits; return s;
}
const monthStart = (d: Date) => new Date(d.getFullYear(), d.getMonth(), 1).toISOString();

export function recordUsage(doc: OfficeDoc, rt: RuntimeState, u: Omit<UsageRecord, 'id' | 'at' | 'simulated'> & { simulated?: boolean }, now = new Date()): UsageRecord {
  const rec: UsageRecord = { id: uid('use'), at: now.toISOString(), simulated: true, ...u };
  const prior = rt.usage.filter((x) => x.projectId === rec.projectId).slice(-20);
  rt.usage = [...rt.usage, rec].slice(-5000);
  const t = doc.alertSettings.thresholds;
  const recent = rt.usage.filter((x) => x.projectId === rec.projectId).slice(-5).map((x) => ({ kind: 'usage' as const, id: x.id, label: `${x.credits} credits · ${x.kind}` }));

  if (rec.projectId && doc.projects[rec.projectId]) {
    const p = doc.projects[rec.projectId];
    const spent = projectSpend(rt, p.id);
    const pct = p.budget > 0 ? (spent / p.budget) * 100 : 0;
    if (pct >= t.budgetCriticalPct) {
      raiseAlert(doc, rt, { key: `budget:${p.id}:over`, severity: 'critical', category: 'financial', title: `${p.name} is over budget`, description: `${Math.round(spent)} of ${p.budget} credits used (${Math.round(pct)}%).`, recommended: 'Pause the project or raise its budget.', projectId: p.id, agentId: rec.agentId, evidence: recent }, now);
    } else if (pct >= t.budgetWarnPct) {
      raiseAlert(doc, rt, { key: `budget:${p.id}:warn`, severity: 'warning', category: 'financial', title: `${p.name} has used ${Math.round(pct)}% of its budget`, description: `${Math.round(spent)} of ${p.budget} credits used.`, recommended: 'Review usage records before more work is queued.', projectId: p.id, agentId: rec.agentId, evidence: recent }, now);
    }
    if (prior.length >= 5) {
      const mean = prior.reduce((s, x) => s + x.credits, 0) / prior.length;
      if (mean > 0 && rec.credits > mean * t.spendRateFactor * 2) {
        raiseAlert(doc, rt, { key: `spend-spike:${p.id}`, severity: 'warning', category: 'financial', title: `Unusual spend on ${p.name}`, description: `${rec.credits} credits in one record; recent average is ${mean.toFixed(1)}.`, recommended: 'Check the task that produced this usage.', projectId: p.id, agentId: rec.agentId, taskId: rec.taskId, evidence: recent }, now);
      }
    }
  }
  if (rec.agentId && doc.agents[rec.agentId]) {
    const a = doc.agents[rec.agentId];
    const spent = agentSpend(rt, a.id, monthStart(now));
    if (a.budget.monthlyCredits > 0 && spent >= a.budget.monthlyCredits * (t.budgetWarnPct / 100)) {
      raiseAlert(doc, rt, { key: `agent-budget:${a.id}`, severity: spent >= a.budget.monthlyCredits ? 'high' : 'warning', category: 'financial', title: `${a.identity.name} has used ${Math.round((spent / a.budget.monthlyCredits) * 100)}% of this month's allowance`, description: `${Math.round(spent)} of ${a.budget.monthlyCredits} credits.`, recommended: 'Raise the allowance or reassign work.', agentId: a.id, evidence: recent }, now);
    }
  }
  return rec;
}

export interface ActionRequest { agentId: string; action: string; detail: string; amount?: number; projectId?: string | null; taskId?: string | null; tool?: boolean }

/** Why (if at all) this action needs the owner. Consequential = listed, over the spend limit, or a tool the agent isn't allowed. */
export function approvalReason(doc: OfficeDoc, r: ActionRequest): string | null {
  const a = doc.agents[r.agentId]; if (!a) return 'Unknown agent';
  if (a.permissions.requireApprovalFor.includes(r.action)) return `“${r.action}” always needs owner approval for ${a.identity.name}`;
  if (r.amount != null && r.amount > a.budget.approvalAbove) return `${r.amount} credits exceeds ${a.identity.name}'s approval limit of ${a.budget.approvalAbove}`;
  if (r.tool && !a.permissions.allowedTools.includes(r.action) && !a.skills.tools.includes(r.action)) return `${a.identity.name} isn't authorised to use “${r.action}”`;
  return null;
}

/** Either clears the action to run, or files an approval request and pauses the task. */
export function requestAction(doc: OfficeDoc, rt: RuntimeState, r: ActionRequest, now = new Date()): { allowed: true } | { allowed: false; approval: ApprovalRequest } {
  const reason = approvalReason(doc, r);
  if (!reason) return { allowed: true };
  const dup = Object.values(rt.approvals).find((x) => x.status === 'pending' && x.agentId === r.agentId && x.action === r.action && x.taskId === (r.taskId ?? null));
  if (dup) return { allowed: false, approval: dup };
  const ap: ApprovalRequest = { id: uid('appr'), at: now.toISOString(), agentId: r.agentId, action: r.action, detail: r.detail, amount: r.amount, projectId: r.projectId ?? null, taskId: r.taskId ?? null, reason, status: 'pending' };
  rt.approvals = { ...rt.approvals, [ap.id]: ap };
  if (r.taskId && rt.tasks[r.taskId]) {
    rt.tasks[r.taskId] = { ...rt.tasks[r.taskId], status: 'waiting-approval' };
    const ar = rt.agents[r.agentId];
    if (ar?.currentTaskId === r.taskId) { ar.currentTaskId = null; ar.status = 'waiting'; ar.statusMessage = 'Waiting for owner approval'; }
  }
  const name = doc.agents[r.agentId]?.identity.name ?? r.agentId;
  log(rt, { kind: 'approval', agentId: r.agentId, simulated: false, level: 'warn', message: `${name} requests approval: ${r.action} — ${r.detail}` });
  raiseAlert(doc, rt, { key: `approval:${ap.id}`, severity: 'high', category: 'project', title: `Approval needed: ${r.action}`, description: `${name}: ${r.detail}. ${reason}.`, recommended: 'Approve or reject in the alert centre.', agentId: r.agentId, projectId: ap.projectId, taskId: ap.taskId, approvalId: ap.id, evidence: r.taskId ? [{ kind: 'task', id: r.taskId, label: rt.tasks[r.taskId]?.name ?? r.taskId }] : [] }, now);
  return { allowed: false, approval: ap };
}

export function decideApproval(doc: OfficeDoc, rt: RuntimeState, id: string, approve: boolean, now = new Date()) {
  const ap = rt.approvals[id]; if (!ap || ap.status !== 'pending') return false;
  rt.approvals = { ...rt.approvals, [id]: { ...ap, status: approve ? 'approved' : 'rejected', decidedAt: now.toISOString() } };
  if (ap.taskId && rt.tasks[ap.taskId]) rt.tasks[ap.taskId] = { ...rt.tasks[ap.taskId], status: approve ? 'queued' : 'cancelled' };
  if (ap.agentId && rt.agents[ap.agentId]?.status === 'waiting') { rt.agents[ap.agentId].status = 'idle'; rt.agents[ap.agentId].statusMessage = undefined; }
  for (const a of Object.values(rt.alerts)) if (a.approvalId === id) resolveAlert(rt, a.id);
  log(rt, { kind: 'approval', agentId: ap.agentId, simulated: false, message: `Owner ${approve ? 'approved' : 'rejected'}: ${ap.action} (${doc.agents[ap.agentId ?? '']?.identity.name ?? 'agent'})` });
  return true;
}
