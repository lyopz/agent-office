// ORIGIN's live runner: the cost ledger, the monthly cap, approved tasks only, and saved notes.
import { beforeAll, describe, expect, test } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

let runner: typeof import('../server/origin-runner.mjs');
let file: string;
const write = (state: object) => fs.writeFileSync(file, JSON.stringify(state));
const read = () => JSON.parse(fs.readFileSync(file, 'utf8'));

beforeAll(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'origin-'));
  file = path.join(dir, 'state.json');
  process.env.ORIGIN_MONTHLY_CAP_USD = '15';
  runner = await import('../server/origin-runner.mjs');
});

const reply = (text: string, usage: object, stop = 'end_turn') => ({ ok: true, status: 200, json: async () => ({ content: [{ type: 'text', text }], usage, stop_reason: stop }) });
const result = (o: object) => '```json\n' + JSON.stringify(o) + '\n```';
const month = new Date().toISOString().slice(0, 7);
const base = { instructions: 'x'.repeat(200), memory: '', nextAction: '', tasks: [], ledger: { month, spentUsd: 0, unknownCostRuns: 0 }, runs: [], lastScheduledAt: null };

describe('origin runner', () => {
  test('prices Haiku 5.5 by prompt size and counts web searches; unknown models are unknown, not free', () => {
    expect(runner.costOf('claude-haiku-5-5', { input_tokens: 100_000, output_tokens: 10_000 })).toBeCloseTo(0.01 + 0.005, 6);
    expect(runner.costOf('claude-haiku-5-5', { input_tokens: 200_000, output_tokens: 10_000 })).toBeCloseTo(0.1 + 0.025, 6);
    expect(runner.costOf('claude-haiku-5-5', { input_tokens: 1000, output_tokens: 0, server_tool_use: { web_search_requests: 3 } })).toBeCloseTo(0.0001 + 0.03, 6);
    expect(runner.costOf('some-other-model', { input_tokens: 1 })).toBeNull();
  });

  test('with no approved task it proposes tasks without searching, and saves notes and cost', async () => {
    write(base);
    let sent: any = null;
    const fetch = async (_u: string, init: any) => { sent = JSON.parse(init.body); return reply(result({ memory: 'notes', nextAction: 'wait', proposedTasks: [{ title: 'Check Roblox tycoon demand', detail: 'search' }], summary: 'proposed one task' }), { input_tokens: 5000, output_tokens: 2000 }); };
    const r = await runner.runOnce('manual', { fetch, file, key: 'test' } as any);
    expect(r.ok).toBe(true);
    expect(sent.model).toBe('claude-haiku-5-5');
    expect(sent.tools).toBeUndefined();
    const s = read();
    expect(s.memory).toBe('notes');
    expect(s.tasks[0]).toMatchObject({ status: 'proposed', by: 'origin' });
    expect(s.ledger.spentUsd).toBeCloseTo(0.0005 + 0.001, 6);
  });

  test('approved tasks get web search and can be completed', async () => {
    write({ ...base, tasks: [{ id: 't1', title: 'Research', detail: '', status: 'approved', by: 'owner', createdAt: '' }] });
    let sent: any = null;
    const fetch = async (_u: string, init: any) => { sent = JSON.parse(init.body); return reply(result({ memory: 'm', completedTaskIds: ['t1'], summary: 's' }), { input_tokens: 1000, output_tokens: 100, server_tool_use: { web_search_requests: 2 } }); };
    await runner.runOnce('manual', { fetch, file, key: 'test' } as any);
    expect(sent.tools[0]).toMatchObject({ type: 'web_search_20250305', max_uses: 5 });
    const s = read();
    expect(s.tasks[0].status).toBe('done');
    expect(s.runs[0].searches).toBe(2);
  });

  test('the monthly cap stops runs before any call is made', async () => {
    write({ ...base, ledger: { month, spentUsd: 14.9, unknownCostRuns: 0 } });
    let calls = 0;
    const r = await runner.runOnce('schedule', { fetch: async () => { calls++; return reply('', {}); }, file, key: 'test' } as any);
    expect(r.ok).toBe(false);
    expect(calls).toBe(0);
  });

  test('a run stops calling the model before it could pass its own spending limit', async () => {
    write({ ...base, tasks: [{ id: 't1', title: 'Research', detail: '', status: 'approved', by: 'owner', createdAt: '' }] });
    let calls = 0;
    // every call pauses and costs about $0.15, so only a couple fit under the $0.50 run limit
    const fetch = async () => { calls++; return reply('', { input_tokens: 200_000, output_tokens: 0, server_tool_use: { web_search_requests: 5 } }, 'pause_turn'); };
    const r = await runner.runOnce('manual', { fetch, file, key: 'test' } as any);
    expect(r.ok && r.run.status).toBe('run-budget-reached');
    expect(read().ledger.spentUsd).toBeLessThanOrEqual(0.5);
    expect(calls).toBeLessThanOrEqual(3);
  });
});
