// Provider-independent AI layer. Every provider returns a Plan of structured
// operations; nothing a provider says is applied without validation.
import { z } from 'zod';
import { interpret, type ParseContext, type Plan } from './parser';
import { stripSecrets } from '../model/schema';
import type { DocOp } from '../engine/ops';
import type { RuntimeOp } from '../store/store';

export interface AIProvider {
  id: string;
  label: string;
  kind: 'sim' | 'live' | 'off';
  plan(command: string, ctx: ParseContext): Promise<Plan>;
}

export const DOC_OPS = [
  'room.create', 'room.update', 'room.delete', 'room.duplicate', 'door.add', 'door.update', 'door.delete',
  'corridor.create', 'corridor.update', 'corridor.delete', 'corridor.setEndpoint', 'corridors.realign', 'rooms.connect',
  'room.connectToCorridor', 'furniture.add', 'furniture.update', 'furniture.delete', 'agent.create', 'agent.update',
  'agent.delete', 'agent.duplicate', 'agent.assignRoom', 'workstation.assign', 'settings.update', 'office.rename',
] as const;
const RUNTIME_OPS = ['agent.goTo', 'task.create', 'task.update', 'history.undo', 'history.redo'] as const;

const planSchema = z.object({
  kind: z.enum(['plan', 'clarify', 'unsupported']).default('plan'),
  ops: z.array(z.object({ op: z.enum(DOC_OPS) }).passthrough()).max(60).default([]),
  runtimeOps: z.array(z.object({ op: z.enum(RUNTIME_OPS) }).passthrough()).max(60).default([]),
  explanation: z.array(z.string().max(400)).max(30).default([]),
  question: z.string().max(400).optional(),
  options: z.array(z.object({ label: z.string(), command: z.string() })).max(8).optional(),
  message: z.string().max(600).optional(),
});

/** Local rule-based interpreter. Clearly a simulation: no model is called. */
export const mockProvider: AIProvider = {
  id: 'mock', label: 'Simulated AI (local rules)', kind: 'sim',
  async plan(command, ctx) { return interpret(command, ctx); },
};

export const offProvider: AIProvider = {
  id: 'off', label: 'Disconnected', kind: 'off',
  async plan() { return { kind: 'unsupported', message: 'The AI provider is disconnected. Manual construction and profile editing still work; reconnect in Settings to use commands.', alternatives: [] }; },
};

/** Summarise the office for a remote model: ids, names and geometry only — never secrets. */
export function contextForModel(ctx: ParseContext) {
  const d = ctx.doc;
  return stripSecrets({
    rooms: Object.values(d.rooms).map((r) => ({ id: r.id, name: r.name, type: r.type, x: r.x, y: r.y, w: r.w, h: r.h, doors: r.doors })),
    corridors: Object.values(d.corridors).map((c) => ({ id: c.id, name: c.name, width: c.width, start: c.start, end: c.end, routing: c.routing, blocked: c.blocked })),
    workstations: Object.values(d.furniture).filter((f) => f.workstation).map((f) => ({ id: f.id, roomId: f.roomId, name: f.workstation!.name, assignedAgentId: f.workstation!.assignedAgentId })),
    agents: Object.values(d.agents).map((a) => ({ id: a.id, name: a.identity.name, title: a.identity.title, department: a.identity.department, appearance: a.appearance, personality: a.personality })),
    selection: ctx.selection, idleAgentIds: ctx.idleAgentIds,
  });
}

/**
 * Live provider: calls a server-side proxy (server/ai-proxy.mjs) that holds the
 * API key. The browser never sees credentials. The response is schema-checked
 * and then validated again by applying it to a draft office.
 */
export function remoteProvider(endpoint: string): AIProvider {
  return {
    id: 'remote', label: 'Live model via server proxy', kind: 'live',
    async plan(command, ctx) {
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), 30000);
      try {
        const res = await fetch(endpoint, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ command, context: contextForModel(ctx) }), signal: ctl.signal });
        if (res.status === 429) return { kind: 'unsupported', message: 'The AI proxy is rate-limiting requests. Try again shortly, or switch to the simulated provider.', alternatives: [] };
        if (!res.ok) return { kind: 'unsupported', message: `AI proxy error ${res.status}. Nothing was changed.`, alternatives: [] };
        const parsed = planSchema.safeParse(await res.json());
        if (!parsed.success) return { kind: 'unsupported', message: 'The model returned operations that failed schema validation, so nothing was applied.', alternatives: [] };
        const p = parsed.data;
        if (p.kind === 'clarify') return { kind: 'clarify', question: p.question ?? 'Can you clarify?', options: p.options ?? [] };
        if (p.kind === 'unsupported') return { kind: 'unsupported', message: p.message ?? 'Not supported', alternatives: [] };
        return { kind: 'plan', ops: p.ops as unknown as DocOp[], runtimeOps: p.runtimeOps as unknown as RuntimeOp[], explanation: p.explanation, needsConfirm: true, label: `AI: ${command.slice(0, 48)}` };
      } catch (e) {
        return { kind: 'unsupported', message: `Could not reach the AI proxy (${(e as Error).name === 'AbortError' ? 'timed out' : 'offline'}). Nothing was changed; manual editing still works.`, alternatives: [] };
      } finally { clearTimeout(timer); }
    },
  };
}

export function getProvider(id: string, endpoint = '/api/ai/plan'): AIProvider {
  if (id === 'remote') return remoteProvider(endpoint);
  if (id === 'off') return offProvider;
  return mockProvider;
}

export function providerStatus(id: string): { kind: 'sim' | 'live' | 'off'; label: string; detail: string } {
  if (id === 'remote') return { kind: 'live', label: 'AI: live proxy', detail: 'Console commands go to a model through the server-side proxy.' };
  if (id === 'off') return { kind: 'off', label: 'AI: off', detail: 'AI provider disconnected. Manual editing works.' };
  return { kind: 'sim', label: 'Commands: local', detail: 'Console commands are read by local rules on this computer. No model is called for them; ORIGIN runs on its own live runner.' };
}
