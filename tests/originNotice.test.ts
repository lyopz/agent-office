// Brain notifications come only from ORIGIN's live runner, and only for what the owner must see.
import { describe, expect, test } from 'vitest';
import { originNotice } from '../src/brain/useOrigin';
import type { RunnerStatus } from '../src/brain/originLink';

const base: RunnerStatus = { configured: true, model: 'claude-haiku-5-5', capUsd: 15, everyMinutes: 120, maxMinutes: 10, schedule: true, spentUsd: 1, unknownCostRuns: 0, month: '2026-10', running: null, synced: true, memory: '', nextAction: '', tasks: [], runs: [], nextScheduledAt: null };
const run = (id: string, notify: string | null) => ({ id, trigger: 'schedule' as const, startedAt: 'a', endedAt: 'b', costUsd: 0.01, costKnown: true, searches: 0, status: 'ok', summary: 's', notify });

describe('ORIGIN notifications', () => {
  test('the first status and quiet runs say nothing', () => {
    expect(originNotice(null, { ...base, runs: [run('r1', 'hi')] })).toBeNull();
    expect(originNotice(base, { ...base, runs: [run('r2', null)] })).toBeNull();
    expect(originNotice(base, { ...base, spentUsd: 2 })).toBeNull();
  });
  test('a flagged run, a proposed task and the cap each notify once', () => {
    expect(originNotice(base, { ...base, runs: [run('r3', 'Found a lead')] })?.text).toBe('JARVIS: Found a lead');
    const withTask = { ...base, tasks: [{ id: 't1', title: 'Buy a domain', detail: '', status: 'proposed' as const, by: 'origin' as const, createdAt: 'x' }] };
    expect(originNotice(base, withTask)?.text).toMatch(/approval: Buy a domain/);
    expect(originNotice(withTask, withTask)).toBeNull();
    expect(originNotice(base, { ...base, spentUsd: 12.5 })?.level).toBe('warn');
    expect(originNotice({ ...base, spentUsd: 12.5 }, { ...base, spentUsd: 13 })).toBeNull();
    expect(originNotice({ ...base, spentUsd: 14 }, { ...base, spentUsd: 15 })?.text).toMatch(/hit its \$15 monthly cap/);
  });
});
