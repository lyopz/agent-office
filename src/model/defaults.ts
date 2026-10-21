import { nanoid } from 'nanoid';
import type { Agent, OfficeDoc } from './types';
import { defaultAppearanceSettings } from './themes';
import { defaultAlertSettings } from './alertDefaults';
import { defaultControl } from './control';

export const uid = (prefix: string) => `${prefix}_${nanoid(8)}`;
export const now = () => new Date().toISOString();

/** Starter templates for new agents. Only a blank agent is offered; ORIGIN and its ventures fill it in. */
export const ARCHETYPE: Record<string, { id: string; label: string }> = {
  custom: { id: 'custom', label: 'Blank (custom)' },
};

export function makeAgent(name: string, title: string, department: string): Agent {
  return {
    id: uid('agent'),
    enabled: true,
    identity: {
      name, title, department, roleDescription: `${title} in ${department}.`, bio: '', createdAt: now(),
      profileImageAssetId: null, status: 'active',
    },
    personality: {
      traits: ['focused'], communicationStyle: 'concise', formality: 50, humor: 30, creativity: 50, detail: 60,
      riskTolerance: 40, initiative: 55, collaboration: 'team', decisionMaking: 'data-driven',
      workHabits: 'Works in focused blocks and reports progress at milestones.',
      workingHours: { start: '09:00', end: '17:00' }, responseStyle: 'Short status updates with evidence.',
    },
    skills: {
      primaryRole: title, secondaryRoles: [], skills: [], tools: ['terminal'], expertise: [],
      taskPermissions: ['execute-assigned'], workloadLimit: 5, priorityRules: 'Critical first, then FIFO.',
      escalationRules: 'Escalate to supervisor after 2 failed attempts.', teams: [department], supervisorId: null,
    },
    ai: {
      provider: 'simulated', model: 'simulated-local', systemInstructions: 'You are an agent working inside The Brain.',
      agentInstructions: '', toolPermissions: ['terminal'], contextLimit: 32000, responseConstraints: 'Plain text, under 200 words.',
      executionMode: 'manual-approval', errorHandling: 'retry', maxRetries: 2,
    },
    memory: [],
    schedule: { workStart: '09:00', workEnd: '17:00', breakEveryMin: 120, breakLengthMin: 15 },
    permissions: { allowedTools: ['terminal'], contactableAgentIds: 'all', requireApprovalFor: ['delete', 'external-message'], canEditOthers: false },
    budget: { monthlyCredits: 150, approvalAbove: 25 },
  };
}

/** A new agent from a starter template. The owner can change every field afterwards. */
export function agentFromArchetype(archetypeId: string, name: string): Agent {
  const a = makeAgent(name, 'Generalist', 'Operations');
  a.archetype = ARCHETYPE[archetypeId]?.id ?? 'custom';
  return a;
}

export function emptyOffice(name = 'The Brain'): OfficeDoc {
  return {
    schemaVersion: 8, id: uid('brain'), name, agents: {}, appearance: defaultAppearanceSettings(), alertSettings: defaultAlertSettings(),
    projects: {}, library: {}, control: defaultControl(), skillRequests: [], skillBank: [],
  };
}
