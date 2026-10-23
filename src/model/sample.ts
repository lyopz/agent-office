// The starting brain: only JARVIS, the main agent, at the core. Every other
// agent is a branch JARVIS grows (a venture) or one a venture adds (a skill).
import { produce } from 'immer';
import { applyOps } from '../engine/ops';
import { emptyOffice, makeAgent } from './defaults';
import type { OfficeDoc } from './types';
import { opportunityOriginOps } from '../brain/opportunity';

export const CREATOR_BRAIN_ID = 'office_creator_brain';

const ORIGIN_ROLE = { id: 'agent_origin', name: 'JARVIS', title: 'Agent Creator & Strategy Lead', department: 'Command', supervisorId: null, tools: ['web-research', 'library-search', 'planning', 'reports', 'messaging'], skills: ['agent architecture', 'domain research', 'requirements analysis', 'portfolio strategy'], bio: 'Turns an approved request or opportunity into a detailed agent specification, including role boundaries, tools, evidence needs, evaluation criteria and operating cost assumptions.', instructions: 'For each agent request, research the specific domain, separate verified facts from assumptions, design the smallest useful agent team, define inputs and deliverables, and provide a reviewable build plan. Never claim guaranteed revenue. Do not create accounts, manufacture player counts or engagement, spam communities, publish, spend, or send external messages without explicit owner approval.' };

/** A fresh brain with JARVIS alone, its charter and its playbook project. */
export function creatorBrain(): OfficeDoc {
  const doc = emptyOffice('The Brain');
  doc.id = CREATOR_BRAIN_ID;
  const role = ORIGIN_ROLE;
  const origin = makeAgent(role.name, role.title, role.department);
  origin.id = role.id;
  origin.identity.bio = role.bio;
  origin.identity.roleDescription = role.bio;
  origin.skills.supervisorId = role.supervisorId;
  origin.skills.primaryRole = role.title;
  origin.skills.skills = role.skills;
  origin.skills.expertise = role.skills;
  origin.skills.teams = [role.department];
  origin.skills.tools = role.tools;
  origin.permissions.allowedTools = role.tools;
  origin.permissions.requireApprovalFor = ['spend', 'publish', 'external-message', 'create-account', 'delete'];
  origin.ai.toolPermissions = role.tools;
  origin.ai.executionMode = 'manual-approval';
  origin.ai.agentInstructions = role.instructions;
  origin.ai.systemInstructions = `You are ${role.name}, ${role.title}, the main agent of the owner's brain. ${role.instructions} Be accurate about what is simulated and what has actually run.`;
  origin.budget = { monthlyCredits: 100, approvalAbove: 10 };

  const built = produce(doc, (draft) => {
    draft.agents = { [origin.id]: origin };
    draft.projects['proj_firm_playbook'] = {
      id: 'proj_firm_playbook', name: 'Brain Playbook', ownerAgentId: 'agent_origin', budget: 0, forecastSpend: 0, status: 'active',
      description: 'How JARVIS researches, grows ventures and asks the owner before acting. No external spend is authorized.',
    };
    draft.library['kb_firm_charter'] = {
      id: 'kb_firm_charter', title: 'Brain operating charter', topic: 'operations',
      summary: 'Build agents for specific outcomes; research with dated sources; keep claims and costs evidence-based; preserve human approval for external actions; measure genuine user value; never fake users, engagement or results.',
      tags: ['agent-creation', 'evidence', 'approvals', 'quality'], sources: [], createdAt: new Date().toISOString(), authorAgentId: 'agent_origin', projectId: 'proj_firm_playbook',
      confidence: 1, verification: 'verified', sensitive: false, allowedAgentIds: [],
    };
  });
  // JARVIS is the owner's Opportunity Research and Builder Agent
  const r = applyOps(built, opportunityOriginOps(built));
  if (r.errors.length) throw new Error(`creator brain: ${r.errors.join('; ')}`);
  return r.doc;
}
