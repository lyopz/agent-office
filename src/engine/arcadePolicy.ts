// Human-only arcade, enforced in code. Agents can't be routed to, assigned to
// or start an arcade machine; every attempt is rejected and logged. A future
// agent-play mode must pass canAgentPlay, which also requires a verified
// model-free play path (TOKEN_FREE_VERIFIED), session caps and daily limits.
import type { ArcadeSession, GameId, OfficeDoc, RuntimeState } from '../model/types';
import { canAgentPlay, recordSession } from '../arcade/session';
import { uid } from '../model/defaults';
import { log } from './simulation';

export const isArcade = (doc: OfficeDoc, furnitureId: string | null | undefined) => !!(furnitureId && doc.furniture[furnitureId]?.arcade);

/** An agent tried to use an arcade machine. Returns the decision; rejections are logged. */
export function agentArcadeAttempt(doc: OfficeDoc, rt: RuntimeState, agentId: string, game: GameId, via: string, now = new Date()): { ok: boolean; reason: string } {
  const name = doc.agents[agentId]?.identity.name ?? agentId;
  const r = canAgentPlay(doc.arcade, rt.arcadeSessions, agentId, game, now);
  if (!r.ok) {
    log(rt, { kind: 'policy', agentId, simulated: false, level: 'warn', message: `Blocked ${name} from the ${game} arcade machine (${via}): ${r.reason} Arcade machines are for the owner.` });
    return { ok: false, reason: r.reason };
  }
  return { ok: true, reason: 'Allowed by verified token-free policy' };
}

/** Record a finished arcade session (the owner's, or a future capped agent session). */
export function recordArcadeSession(rt: RuntimeState, s: Omit<ArcadeSession, 'id'>) {
  rt.arcadeSessions = recordSession(rt.arcadeSessions, { ...s, id: uid('play') });
}
