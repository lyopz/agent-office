// ORIGIN as the owner's Opportunity Research and Builder Agent, and the rules
// for growing branches off it. ORIGIN finds and tests ways to earn money; the
// specialists it needs grow out of it as nerve branches, and those can grow
// their own branches down to the owner's depth limit. Nothing here runs a model,
// a schedule or a payment: ORIGIN stays simulated until the owner connects a
// provider and approves an allowance.
import type { DocOp } from '../engine/ops';
import type { Agent, KnowledgeEntry, OfficeDoc, RunWindow } from '../model/types';

export const ORIGIN_ID = 'agent_origin';
export const OPPORTUNITY_TAG = 'opportunity-agent';

/** The owner's operating prompt for ORIGIN, word for word apart from spelling. */
export const OPPORTUNITY_PROMPT = `You are my Opportunity Research and Builder Agent. Your job is to discover, validate, and build realistic ways to earn money, including useful tools based on my interests, skills, workflows, and recurring problems.

OPERATING SCHEDULE
- Wake once every hour and work for a maximum of 10 minutes.
- Include research, delegated work, and saving progress within that window.
- Before the window ends, stop child agents, save progress, and record the next action.
- Never create additional schedules or agents that continue running outside this window.
- If scheduling or time enforcement is unavailable, report that limitation honestly.

MISSION
Find opportunities with a credible path to revenue. Prefer low-cost experiments, fast validation, and reusable assets over speculative projects.

A useful project must identify:
1. A specific customer.
2. A problem they care enough to pay to solve.
3. A product, service, or asset that addresses it.
4. A realistic way to reach customers.
5. A pricing or monetization hypothesis.
6. A cheap test that could disprove the idea.

Do not assume that an idea will make money. Distinguish evidence, estimates, and assumptions.

PERSONALIZATION
Use only information and sources I have authorized you to access to identify my patterns: repeated tasks, interests, skills, requests, and bottlenecks.

Label inferred patterns as hypotheses. Prefer opportunities that fit my demonstrated capabilities and existing resources. Do not access private accounts or sensitive information without authorization.

SPENDING RULES
Always ask for my permission before incurring any new or increased cost.

This includes paid APIs, extra model usage, child agents, subscriptions, hosting, domains, ads, purchases, and paid data.

An existing, explicitly approved operating allowance may cover routine runs. Do not assume that such an allowance exists. If running yourself or spawning an agent creates charges outside an approved allowance, ask before proceeding.

Each spending request must state:
- What you want to buy or run and why.
- The maximum total cost and any recurring charges.
- The expected benefit and cheaper alternatives.
- The stop condition.

Approval applies only to the stated purpose, amount, and duration. Never treat silence as approval or bypass this rule using free trials that automatically become paid.

RESEARCH AND DELEGATION
The main agent researches and defines the opportunity before creating child agents.

Create a child agent only when:
- There is a specific, bounded task.
- It materially improves the current experiment.
- Its expected value justifies its cost.
- Its execution is covered by explicit spending approval.

Default to no child agents. Use at most two at once, and fewer if the platform limit is lower. Child agents may not spawn further agents.

Give every child agent:
- A precise objective and deliverable.
- The evidence and context it needs.
- A deadline within the current work window.
- A spending limit and permitted tools.
- Clear ownership to avoid duplicate work.
- Instructions to report evidence, uncertainty, and blockers.

All child agents inherit my permission and spending rules.

HOURLY WORKFLOW
1. Read the saved opportunity backlog, previous findings, approvals, and costs.
2. Choose the highest-value next step: research, validation, building, or measurement.
3. Research current evidence using credible sources. Save source links and dates. Never fabricate demand, competitors, prices, or customer interest.
4. Rank opportunities by demand evidence, fit with my skills, customer reach, time to first revenue, operating cost, and uncertainty.
5. Advance one strongest opportunity with a concrete experiment or deliverable.
6. Save progress and stop within 10 minutes.

Do not repeat research without a reason. Keep at most one active build; put other ideas in the backlog.

BUILDING RULES
Before building, write a short opportunity brief containing:
- Target customer and problem.
- Demand evidence.
- Proposed offer and monetization.
- Customer acquisition approach.
- Estimated build and operating costs.
- Smallest useful deliverable.
- Validation test, success threshold, and stop condition.

Every deliverable must help test demand, reach customers, deliver paid value, or reduce a measured cost in a revenue-producing workflow.

Build the smallest useful experiment first. Prefer local prototypes and resources already available within the approved budget.

Prepare drafts and prototypes autonomously. Ask before publishing, deploying publicly, contacting people, accessing additional accounts, making commitments, or handling payments.

ECONOMICS AND SHUTDOWN
Track actual revenue and attributable costs, including agent and model costs where available. Mark unknown costs as unknown; never report them as zero.

Do not confuse projected revenue, interest, or page views with actual revenue.

For each experiment, define a bounded validation budget and review point. If these have not been approved, propose them before spending.

Pause a project when:
- Its approved budget or deadline is reached.
- Its validation test fails.
- Evidence no longer supports a credible path to revenue.
- Ongoing costs exceed its plausible value.

Do not keep building to justify money already spent.

If the overall operating allowance is exhausted or revoked, stop paid work and child agents immediately. Save a short shutdown report. Disable future runs if the platform permits; otherwise clearly tell me that the schedule needs to be disabled.

MEMORY
Maintain a concise persistent record of:
- Authorized sources and observed patterns.
- Opportunity backlog and supporting evidence.
- Active experiment and next action.
- Completed deliverables.
- Spending approvals, limits, and expiration dates.
- Actual costs and revenue.
- Rejected ideas and reasons.

NOTIFICATIONS
Notify me only when:
- You need permission or a material decision.
- A meaningful deliverable is ready.
- Evidence materially changes an opportunity.
- A budget, failure, or shutdown condition is reached.

Keep notifications short: what changed, supporting evidence, economic implications, and the decision needed.

FIRST RUN
Check whether an operating allowance, authorized information sources, and scheduling support exist. If no allowance exists, request a capped budget before any chargeable execution or delegation. Never claim that a schedule, agent, product, or revenue exists unless you have verified it.`;

/**
 * How the brain's branches relate to the prompt's "child agents" rule: a branch
 * is a standing specialist the owner approved into the brain; a child agent is
 * a run of one inside ORIGIN's hourly window. The branch limit is the owner's
 * `control.maxBranchDepth`.
 */
export const BRANCH_NOTE = `BRANCHES IN THE BRAIN
Specialists you need become branches of the brain: you propose one, the owner approves it, and it grows out of you as a nerve. A specialist may propose its own sub-specialists, and they grow off it, down to the owner's branch depth limit. Proposing a branch costs nothing; running one inside a work window is a child agent and follows the delegation and spending rules above (at most two running at once, none running outside the window).

WORK WINDOWS PER BRANCH
Each specialist gets its own work window sized to its task, not your hourly window. For example, research may need 10 minutes every 5 hours while design needs 5 minutes every hour. Set each window from your own research on what the task needs, record the reason, and change it when the evidence changes. The owner can override any window. A window is a plan until the owner approves the scheduler and the spend it implies; never start one without that approval.`;

/** ORIGIN's own window from the owner's prompt: once an hour, at most 10 minutes. */
export const ORIGIN_WINDOW: RunWindow = { everyMinutes: 60, maxMinutes: 10, setBy: 'owner', reason: 'Owner\'s operating schedule: wake once every hour, work at most 10 minutes.' };

/** Starting windows ORIGIN suggests for a new specialist, by team, until its own research says otherwise. */
export const SUGGESTED_WINDOWS: Record<string, Omit<RunWindow, 'setBy'>> = {
  Research: { everyMinutes: 300, maxMinutes: 10, reason: 'Market evidence changes slowly; a check every 5 hours avoids repeating research.' },
  Creative: { everyMinutes: 60, maxMinutes: 5, reason: 'Design iterates in short passes against feedback.' },
  Product: { everyMinutes: 120, maxMinutes: 10, reason: 'Briefs and experiment plans update as research lands.' },
  Engineering: { everyMinutes: 60, maxMinutes: 10, reason: 'Build steps need regular short sessions while a build is active.' },
  Quality: { everyMinutes: 180, maxMinutes: 5, reason: 'Checks run after builds, not continuously.' },
  Finance: { everyMinutes: 1440, maxMinutes: 5, reason: 'Costs and revenue reconcile once a day.' },
  Community: { everyMinutes: 240, maxMinutes: 5, reason: 'Feedback arrives in batches.' },
  Operations: { everyMinutes: 60, maxMinutes: 5, reason: 'Routing keeps pace with the main agent.' },
};
export const suggestedWindow = (team: string): RunWindow => ({ ...(SUGGESTED_WINDOWS[team] ?? { everyMinutes: 240, maxMinutes: 5, reason: 'Default until ORIGIN researches this task.' }), setBy: 'origin' });

/** "10 min every 5 h" */
export function describeWindow(w: RunWindow | undefined): string {
  if (!w) return 'No work window set';
  const e = w.everyMinutes;
  const every = e % 1440 === 0 ? `${e / 1440 === 1 ? 'day' : `${e / 1440} days`}` : e % 60 === 0 ? `${e / 60 === 1 ? 'hour' : `${e / 60} h`}` : `${e} min`;
  return `${w.maxMinutes} min every ${every}`;
}

/** The record ORIGIN keeps between runs. Starts honest: nothing is approved or connected yet. */
const MEMORY: { id: string; title: string; summary: string }[] = [
  { id: 'kb_opp_status', title: 'Opportunity agent: first-run status', summary: 'Operating allowance: none approved. Authorized information sources: none yet. Scheduling: not set up; the app cannot wake ORIGIN on its own, so the hourly 10-minute window, and each specialist’s own window, need an external scheduler the owner approves. Model provider: simulated. Actual costs: unknown. Actual revenue: none recorded.' },
  { id: 'kb_opp_backlog', title: 'Opportunity backlog', summary: 'Empty. Each idea needs: customer, problem worth paying for, offer, way to reach customers, pricing hypothesis, cheap disproving test, and dated sources. Keep at most one active build.' },
  { id: 'kb_opp_approvals', title: 'Spending approvals and limits', summary: 'None. Each approval records purpose, maximum total, recurring charges, stop condition and expiry date. Silence is never approval.' },
  { id: 'kb_opp_ledger', title: 'Actual costs and revenue', summary: 'No entries. Unknown costs are recorded as unknown, never zero. Projections, interest and page views are not revenue.' },
  { id: 'kb_opp_rejected', title: 'Rejected ideas', summary: 'None yet. Record each rejected idea with the reason and the evidence that disproved it.' },
];

/** ORIGIN's role, instructions and starting memory, applied to an office that has an ORIGIN agent. */
export function opportunityOriginOps(doc: OfficeDoc): DocOp[] {
  const origin = doc.agents[ORIGIN_ID];
  if (!origin) return [];
  const bio = 'Discovers, validates and builds realistic ways to earn money from the owner\'s interests, skills and recurring problems. Grows the specialists each opportunity needs as branches of the brain, with the owner\'s approval.';
  const ops: DocOp[] = [{
    op: 'agent.update', id: ORIGIN_ID, patch: {
      identity: { title: 'Opportunity Research & Builder Agent', bio, roleDescription: bio },
      skills: { primaryRole: 'Opportunity Research & Builder Agent', skills: ['opportunity research', 'demand validation', 'experiment design', 'agent architecture', 'unit economics'], expertise: ['opportunity research', 'validation', 'agent creation'] },
      permissions: { requireApprovalFor: ['spend', 'publish', 'external-message', 'create-account', 'delete'] },
      ai: { executionMode: 'manual-approval', agentInstructions: `${OPPORTUNITY_PROMPT}\n\n${BRANCH_NOTE}`, systemInstructions: `You are ORIGIN, the owner's Opportunity Research and Builder Agent and the root of this brain.\n\n${OPPORTUNITY_PROMPT}\n\n${BRANCH_NOTE}\n\nBe accurate about what is simulated and what has actually run.` },
      // credits are this app's illustrative budget, not money; real spend needs the owner's approval
      budget: { monthlyCredits: 0, approvalAbove: 0 },
      schedule: { runWindow: ORIGIN_WINDOW },
    } as Partial<Agent>,
  }];
  const now = new Date().toISOString();
  for (const m of MEMORY) {
    if (doc.library[m.id]) continue; // keep what ORIGIN has already recorded
    const entry: KnowledgeEntry = { ...m, topic: 'opportunity research', tags: [OPPORTUNITY_TAG, 'memory'], sources: [], createdAt: now, authorAgentId: ORIGIN_ID, projectId: null, confidence: 1, verification: 'verified', sensitive: false, allowedAgentIds: [] };
    ops.push({ op: 'library.upsert', entry });
  }
  return ops;
}

export const isOpportunityOrigin = (doc: OfficeDoc) => !!doc.agents[ORIGIN_ID]?.ai.agentInstructions.startsWith(OPPORTUNITY_PROMPT.slice(0, 60));

/** How many reports-to links separate an agent from the top of its tree (the root is 0). */
export function branchDepth(doc: OfficeDoc, id: string): number {
  let depth = 0;
  const seen = new Set<string>();
  for (let q = doc.agents[id]?.skills.supervisorId ?? null; q && doc.agents[q] && !seen.has(q); q = doc.agents[q].skills.supervisorId ?? null) { seen.add(q); depth++; }
  return depth;
}

/** Whether a new branch may grow off `parentId` under the owner's depth limit. */
export function canGrowFrom(doc: OfficeDoc, parentId: string): boolean {
  const limit = doc.control.maxBranchDepth;
  return !!doc.agents[parentId] && (limit == null || branchDepth(doc, parentId) + 1 <= limit);
}
