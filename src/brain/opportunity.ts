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
 * The owner's branching rules. Only ORIGIN starts branches, and each one is a
 * venture: a business or project ORIGIN took on (say, Roblox development). A
 * venture may only add the skill agents it needs to succeed (research, 3D
 * modelling, design, ads…); it can't start a different business, and skill
 * agents can't add anyone. Running any of them inside a work window is a child
 * agent and follows the prompt's delegation and spending rules.
 */
export const BRANCH_NOTE = `BRANCHES IN THE BRAIN
Only you start branches. Each branch is a venture: one business or project you took on after researching it, such as Roblox development, and you need the owner's approval to start it. A venture may add only the skill agents it needs to succeed, such as research, 3D modelling, design or ads, and every skill agent works for that venture alone. Teach every venture you create how to create agents, using the blueprint below. Skill agents can't create agents; they file skill requests, their venture checks relevance, and the owner decides. A venture can never start a different business; it sends any new business idea to your backlog instead. Skill agents cannot create agents. Proposing a branch costs nothing; running one inside a work window is a child agent and follows the delegation and spending rules above (at most two running at once, none running outside the window).

WORK WINDOWS PER BRANCH
Each venture and skill agent gets its own work window sized to its task, not your hourly window. For example, research may need 10 minutes every 5 hours while design needs 5 minutes every hour. Set each window from your own research on what the task needs, record the reason, and change it when the evidence changes. The owner can override any window. A window is a plan until the owner approves the scheduler and the spend it implies; never start one without that approval.`;

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
  '3D Design': { everyMinutes: 120, maxMinutes: 10, reason: 'Models take longer passes but not every hour.' },
  Advertising: { everyMinutes: 360, maxMinutes: 5, reason: 'Ad results need hours of data between checks.' },
  Ventures: { everyMinutes: 60, maxMinutes: 5, reason: 'A venture checks its skill agents\' progress and plans the next step.' },
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
      ai: { executionMode: 'manual-approval', agentInstructions: `${OPPORTUNITY_PROMPT}\n\n${BRANCH_NOTE}\n\n${AGENT_BLUEPRINT}`, systemInstructions: `You are ORIGIN, the owner's Opportunity Research and Builder Agent and the root of this brain.\n\n${OPPORTUNITY_PROMPT}\n\n${BRANCH_NOTE}\n\n${AGENT_BLUEPRINT}\n\nBe accurate about what is simulated and what has actually run.` },
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

/** How to design an agent; ORIGIN uses it for ventures, ventures for their skill agents. */
export const AGENT_BLUEPRINT = `HOW TO CREATE AN AGENT
Propose a new agent only for a specific, lasting need. Give it: a short name; one specialty; the exact outcome it owns and the deliverable it hands back; the evidence and context it starts with; its permitted tools; a work window sized to the task, with the reason; a spending limit (zero until the owner approves one); and what it must escalate. Check that no existing agent already owns the work. The owner approves every new agent before it exists. A venture you create must know this same blueprint so it can design its own skill agents.`;

/** How a skill agent asks for help it can't create itself. */
export const SKILL_REQUESTS = `REQUESTING A NEW SKILL
You cannot create agents. If your venture needs a skill nobody covers, file a skill request with your venture: the skill, a name, and how it helps the venture. Your venture checks whether it is relevant to the venture; if so, the owner decides.`;

/** How a venture handles its skill agents' requests. */
export const VENTURE_REVIEW = `REVIEWING SKILL REQUESTS
When one of your skill agents files a skill request, judge only whether it helps this venture succeed. If it does, mark it relevant with one line of reasoning, and it goes to the owner to approve. If it belongs to a different business or adds nothing here, mark it not relevant and say why. Never create the agent yourself before the owner approves.`;

export type BranchKind = 'root' | 'core' | 'venture' | 'skill';

/** ORIGIN is the root; agents with no branch record are ORIGIN's core staff, who don't grow branches. */
export function branchKind(doc: OfficeDoc, id: string): BranchKind | null {
  const a = doc.agents[id];
  if (!a) return null;
  return id === ORIGIN_ID ? 'root' : a.branch?.kind ?? 'core';
}

/** What may grow off `parentId`: ORIGIN starts ventures, a venture adds skills, nobody else adds anything. */
export function growKind(doc: OfficeDoc, parentId: string): 'venture' | 'skill' | null {
  const k = branchKind(doc, parentId);
  return k === 'root' ? 'venture' : k === 'venture' ? 'skill' : null;
}

/** The venture an agent belongs to: itself for a venture, its venture for a skill agent. */
export function ventureOf(doc: OfficeDoc, id: string): string | null {
  const a = doc.agents[id];
  if (!a) return null;
  return a.branch?.kind === 'venture' ? id : a.branch?.kind === 'skill' ? a.branch.ventureId : null;
}

/** The skills a venture can add, each a team in the brain. */
export const SKILL_TEAMS = ['Research', '3D Design', 'Creative', 'Advertising', 'Engineering', 'Product', 'Quality', 'Finance', 'Community'] as const;
export const SKILL_LABELS: Record<string, string> = { '3D Design': '3D modelling', Creative: 'Design', Advertising: 'Ads & marketing', Product: 'Product & game design' };
export const VENTURE_TEAM = 'Ventures';

export function ventureInstructions(name: string, focus: string) {
  return `You are ${name}, the venture branch for: ${focus}. ORIGIN started you. Work only on this venture. You may propose skill agents only for skills this venture needs to succeed, such as research, 3D modelling, design or ads; each works for this venture alone. You may not start or pursue a different business; send any new business idea to ORIGIN's backlog. The owner approves every new skill agent.\n\n${VENTURE_REVIEW}`;
}
export function skillInstructions(name: string, skill: string, venture: string, purpose: string) {
  return `You are ${name}, the ${skill} skill for the ${venture} venture. ${purpose}\n\nWork only on ${skill} for ${venture}. You cannot create agents or start other ventures; raise anything outside your skill with ${venture}.`;
}

export interface BranchSpec { id: string; name: string; specialty: string; purpose: string; skill: string; window: RunWindow }

/** The ops that add a venture under ORIGIN or a skill agent under a venture, following the branch rules. */
export function branchAgentOps(doc: OfficeDoc, parentId: string, spec: BranchSpec): { ops: DocOp[]; error: string | null } {
  const kind = growKind(doc, parentId);
  if (!kind) return { ops: [], error: 'Only ORIGIN can start a venture, and only a venture can add skill agents.' };
  const parentName = doc.agents[parentId].identity.name;
  const team = kind === 'venture' ? VENTURE_TEAM : spec.skill;
  const scope = kind === 'venture' ? ventureInstructions(spec.name, spec.specialty) : skillInstructions(spec.name, SKILL_LABELS[spec.skill] ?? spec.skill, parentName, spec.purpose);
  const brief = `${kind === 'venture' ? `${spec.purpose}\n\n` : ''}${scope}\n\n${kind === 'venture' ? AGENT_BLUEPRINT : SKILL_REQUESTS}\n\nRole: ${spec.specialty}. For research, cite current sources with publication dates and URLs; separate evidence, assumptions and recommendations. State uncertainty, costs and success criteria. Never claim work ran if it was only planned. Never spend, publish, contact people externally, create accounts or delete data without owner approval.`;
  const tools = ['web-research', 'library-search', 'reports'];
  return {
    error: null,
    ops: [
      { op: 'agent.createFromArchetype', archetype: 'custom', name: spec.name, id: spec.id },
      { op: 'agent.update', id: spec.id, patch: {
        branch: { kind, ventureId: kind === 'venture' ? spec.id : parentId },
        identity: { title: spec.specialty, department: team, bio: spec.purpose, roleDescription: brief },
        skills: { primaryRole: spec.specialty, supervisorId: parentId, teams: [team], skills: [spec.specialty], expertise: [spec.purpose], tools, taskPermissions: ['draft', 'research', 'recommend'], priorityRules: 'Owner priorities first; make costs and evidence visible.', escalationRules: 'Escalate unclear scope, missing research access, safety issues and any action requiring approval.' },
        schedule: { runWindow: spec.window },
        permissions: { allowedTools: tools, requireApprovalFor: ['spend', 'publish', 'external-message', 'create-account', 'delete'] },
        ai: { provider: 'simulated', executionMode: 'manual-approval', agentInstructions: brief, systemInstructions: `You are ${spec.name}, ${kind === 'venture' ? 'a venture branch started by' : 'a skill agent reporting to'} ${parentName}. ${brief}`, toolPermissions: tools },
      } },
    ],
  };
}
