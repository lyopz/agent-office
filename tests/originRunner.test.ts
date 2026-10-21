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
    write({ ...base, autoTasks: false });
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

describe('origin runner: one task at a time, agent proposals and budget watch', () => {
  const approvedTask = (id: string, extra: object = {}) => ({ id, title: id, detail: '', status: 'approved', by: 'owner', createdAt: '', ...extra });

  test('a run works only on the oldest approved task and only that task can be completed', async () => {
    write({ ...base, tasks: [approvedTask('t1'), approvedTask('t2')] });
    let brief = '';
    const fetch = async (_u: string, init: any) => { brief = JSON.parse(init.body).messages[0].content; return reply(result({ memory: 'm', completedTaskIds: ['t1', 't2'], summary: 's' }), { input_tokens: 1000, output_tokens: 100 }); };
    await runner.runOnce('manual', { fetch, file, key: 'test' } as any);
    expect(brief).toMatch(/\[t1\]/);
    expect(brief).not.toMatch(/\[t2\]/);
    const s = read();
    expect(s.tasks.map((t: any) => t.status)).toEqual(['done', 'approved']);
    expect(s.tasks[0].spentUsd).toBeGreaterThan(0);
    expect(s.ledger.byAgent.agent_origin).toBeCloseTo(s.ledger.spentUsd, 6);
    expect(s.runs[0]).toMatchObject({ agentId: 'agent_origin', taskId: 't1' });
  });

  test('asking first: ORIGIN proposes one thing at a time, and nothing while something waits for the owner', async () => {
    const base_ = { ...base, autoAgents: false, autoTasks: false };
    write(base_);
    const agent = { parentId: 'agent_origin', name: 'ETSY', specialty: 'Etsy store', purpose: 'sell', skill: 'Ventures', bankSkillIds: ['skill_x'], everyMinutes: 60, maxMinutes: 5 };
    const fetch = async () => reply(result({ memory: 'm', proposedTasks: [{ title: 'a' }, { title: 'b' }], proposedAgent: agent, summary: 's' }), { input_tokens: 100, output_tokens: 10 });
    await runner.runOnce('manual', { fetch, file, key: 'test' } as any);
    let s = read();
    expect(s.tasks.map((t: any) => t.title)).toEqual(['a']);
    expect(s.agentProposals).toEqual([]);
    await runner.runOnce('manual', { fetch, file, key: 'test' } as any);
    s = read();
    expect(s.tasks).toHaveLength(1);
    write(base_);
    await runner.runOnce('manual', { fetch: async () => reply(result({ memory: 'm', proposedAgent: agent, summary: 's' }), { input_tokens: 100, output_tokens: 10 }), file, key: 'test' } as any);
    expect(read().agentProposals[0]).toMatchObject({ name: 'ETSY', parentId: 'agent_origin', status: 'proposed', bankSkillIds: ['skill_x'] });
  });

  test('budget watch stops a task by its spend pattern, without asking', () => {
    expect(runner.budgetWatch({ spentUsd: 1.6, runCosts: [0.8, 0.8], budgetUsd: 1.5 })).toMatch(/used its \$1\.50 budget/);
    expect(runner.budgetWatch({ spentUsd: 0.2, runCosts: [0.1, 0.1] })).toBeNull(); // too few runs to judge
    expect(runner.budgetWatch({ spentUsd: 0.3, runCosts: [0.1, 0.1, 0.1] }, new Date(Date.UTC(2026, 9, 2)))).toMatch(/by month end/);
    expect(runner.budgetWatch({ spentUsd: 0.003, runCosts: [0.001, 0.001, 0.001] }, new Date(Date.UTC(2026, 9, 2)))).toBeNull();
  });

  test('the runner stops a task past its budget, and ORIGIN can stop its task itself', async () => {
    write({ ...base, tasks: [approvedTask('t1', { spentUsd: 1.49, runCosts: [0.5, 0.5, 0.49], budgetUsd: 1.5 })] });
    const fetch = async () => reply(result({ memory: 'm', summary: 's' }), { input_tokens: 100_000, output_tokens: 1000 });
    const r = await runner.runOnce('manual', { fetch, file, key: 'test' } as any);
    let s = read();
    expect(s.tasks[0].status).toBe('stopped');
    expect(s.tasks[0].stopReason).toMatch(/Budget watch/);
    expect(r.ok && (r.run as any).notify).toMatch(/Stopped "t1"/);

    write({ ...base, tasks: [approvedTask('t2')] });
    await runner.runOnce('manual', { fetch: async () => reply(result({ memory: 'm', stopTaskIds: ['t2'], stopReason: 'costs rising, little value', summary: 's' }), { input_tokens: 100, output_tokens: 10 }), file, key: 'test' } as any);
    s = read();
    expect(s.tasks[0]).toMatchObject({ status: 'stopped', stopReason: 'ORIGIN stopped it: costs rising, little value' });
  });
});

describe('origin runner: console questions', () => {
  test('ORIGIN answers a question about its task at any time, on the same cap, without changing tasks', async () => {
    write({ ...base, tasks: [{ id: 't1', title: 'Etsy demand', detail: 'check', status: 'approved', by: 'owner', createdAt: '' }] });
    let sent: any = null;
    const fetch = async (_u: string, init: any) => { sent = JSON.parse(init.body); return reply('About halfway.', { input_tokens: 4000, output_tokens: 200 }); };
    const r = await runner.ask('How far along is the task?', { fetch, file, key: 'test' } as any);
    expect(r).toMatchObject({ ok: true, answer: 'About halfway.', taskTitle: 'Etsy demand' });
    expect(sent.tools).toBeUndefined();
    expect(sent.system).toMatch(/Your current task: Etsy demand/);
    const s = read();
    expect(s.tasks[0].status).toBe('approved');
    expect(s.ledger.spentUsd).toBeCloseTo(0.0004 + 0.0001, 6);
    expect(s.ledger.byAgent.agent_origin).toBeCloseTo(s.ledger.spentUsd, 6);
    expect(s.asks[0]).toMatchObject({ q: 'How far along is the task?', a: 'About halfway.' });
  });

  test("the owner's plain consent in the console approves work, worked as the venture, with the budget they named", async () => {
    write({ ...base, agents: [{ id: 'v1', name: 'etsy store', kind: 'venture' }], tasks: [{ id: 'p1', title: 'Validate demand', detail: '', status: 'proposed', by: 'origin', createdAt: '' }, { id: 't0', title: 'old', detail: '', status: 'approved', by: 'owner', createdAt: '', waitingOnOwner: true }] });
    const text = 'I will get the Etsy store going.\nAPPROVE {"title": "Get etsy store started", "detail": "first products", "agentId": "v1", "budgetUsd": 1, "approveIds": ["p1"]}';
    const r = await runner.ask('allow etsy store to run, 1 dollar approval', { fetch: async () => reply(text, { input_tokens: 1000, output_tokens: 100 }), file, key: 'test' } as any);
    expect(r).toMatchObject({ ok: true, answer: 'I will get the Etsy store going.', approved: ['Validate demand', 'Get etsy store started'] });
    const s = read();
    expect(s.tasks.find((t: any) => t.id === 'p1').status).toBe('approved');
    expect(s.tasks.find((t: any) => t.title === 'Get etsy store started')).toMatchObject({ status: 'approved', by: 'owner', agentId: 'v1', budgetUsd: 1 });
    expect(s.tasks.some((t: any) => t.waitingOnOwner)).toBe(false);
  });

  test('an answer without an APPROVE line changes no tasks', () => {
    expect(runner.parseConsent('Just an answer.')).toBeNull();
    expect(runner.parseConsent('APPROVE {broken')).toBeNull();
  });

  test('a question past the cap is refused before any call', async () => {
    write({ ...base, ledger: { month, spentUsd: 14.99, unknownCostRuns: 0 } });
    let calls = 0;
    const r = await runner.ask('hi', { fetch: async () => { calls++; return reply('x', {}); }, file, key: 'test' } as any);
    expect(r.ok).toBe(false);
    expect(calls).toBe(0);
  });

  test('changes the owner makes during a run are kept when the run saves', async () => {
    write({ ...base, tasks: [{ id: 't1', title: 'a', detail: '', status: 'approved', by: 'owner', createdAt: '' }, { id: 't2', title: 'b', detail: '', status: 'proposed', by: 'origin', createdAt: '' }] });
    const fetch = async () => {
      const mid = read(); mid.tasks[1].status = 'approved'; mid.ledger.spentUsd += 1; write(mid); // the owner approves t2 and a question is paid for mid-run
      return reply(result({ memory: 'm', summary: 's' }), { input_tokens: 1000, output_tokens: 100 });
    };
    await runner.runOnce('manual', { fetch, file, key: 'test' } as any);
    const s = read();
    expect(s.tasks[1].status).toBe('approved');
    expect(s.ledger.spentUsd).toBeGreaterThan(1);
    expect(s.tasks[0].runCosts).toHaveLength(1);
  });
});

describe('origin runner: SKILL.md tasks', () => {
  test('a SKILL.md task gets the writing rules and its file is kept for the app', async () => {
    write({ ...base, tasks: [{ id: 't1', title: "Write ETSY's SKILL.md", detail: 'Venture: ETSY', status: 'approved', by: 'owner', createdAt: '', kind: 'skill-file', agentId: 'agent_etsy', agentName: 'ETSY' }] });
    let brief = '';
    const fetch = async (_u: string, init: any) => { brief = JSON.parse(init.body).messages[0].content; return reply(result({ memory: 'm', skillFile: { name: 'Etsy playbook', description: 'store', body: `# Run the store\n${'Step. '.repeat(50)}` }, completedTaskIds: ['t1'], summary: 's' }), { input_tokens: 1000, output_tokens: 1000 }); };
    await runner.runOnce('manual', { fetch, file, key: 'test' } as any);
    expect(brief).toMatch(/write the SKILL\.md for the agent "ETSY"/);
    const s = read();
    expect(s.tasks[0].status).toBe('done');
    expect(brief).toMatch(/Recurring workflows/);
    expect(s.skillFiles[0]).toMatchObject({ agentId: 'agent_etsy', agentIds: ['agent_etsy'], name: 'Etsy playbook', status: 'new', version: 2 });
  });

  test('a task given to an agent is worked as that agent, with its synced SKILL.md', async () => {
    const agents = [{ id: 'agent_etsy', name: 'ETSY', prompt: 'You are ETSY.\n## Etsy playbook\nList weekly.' }];
    for (const task of [{ id: 't1', title: 'ETSY: plan the next listings', agentId: 'agent_etsy' }, { id: 't2', title: 'ETSY: plan the next listings' }]) {
      write({ ...base, agents, tasks: [{ detail: '', status: 'approved', by: 'owner', createdAt: '', ...task }] });
      let brief = '';
      await runner.runOnce('manual', { fetch: async (_u: string, init: any) => { brief = JSON.parse(init.body).messages[0].content; return reply(result({ memory: 'm', summary: 's' }), { input_tokens: 10, output_tokens: 10 }); }, file, key: 'test' } as any);
      expect(brief).toMatch(/WORK THIS TASK AS ETSY/);
      expect(brief).toMatch(/List weekly\./);
    }
    write({ ...base, agents, tasks: [{ id: 't3', title: 'Research Etsy fees', detail: '', status: 'approved', by: 'owner', createdAt: '' }] });
    let brief = '';
    await runner.runOnce('manual', { fetch: async (_u: string, init: any) => { brief = JSON.parse(init.body).messages[0].content; return reply(result({ memory: 'm', summary: 's' }), { input_tokens: 10, output_tokens: 10 }); }, file, key: 'test' } as any);
    expect(brief).not.toMatch(/WORK THIS TASK AS/);
  });
});

test("the owner's tasks go before SKILL.md writing", () => {
  const t = (id: string, kind?: string) => ({ id, status: 'approved', kind });
  expect(runner.nextTask({ tasks: [t('s1', 'skill-file'), t('o1')] })).toMatchObject({ id: 'o1' });
  expect(runner.nextTask({ tasks: [t('s1', 'skill-file')] })).toMatchObject({ id: 's1' });
});

describe('origin runner: growing the brain on its own', () => {
  const agent = (name: string) => ({ parentId: 'agent_etsy', name, specialty: name, purpose: 'help the store', skill: 'Research', bankSkillIds: [], skillFile: { name: `${name} playbook`, description: 'd', body: 'x'.repeat(300) } });

  test('with auto-create on (the default) ORIGIN creates up to 3 agents a run for a venture, each with its SKILL.md', async () => {
    write(base);
    let brief = '';
    const fetch = async (_u: string, init: any) => { brief = JSON.parse(init.body).messages[0].content; return reply(result({ memory: 'm', proposedAgents: ['A', 'B', 'C', 'D', 'a'].map(agent), summary: 's' }), { input_tokens: 100, output_tokens: 10 }); };
    await runner.runOnce('manual', { fetch, file, key: 'test' } as any);
    expect(brief).toMatch(/GROWING THE BRAIN/);
    const s = read();
    expect(s.agentProposals.map((p: any) => p.name)).toEqual(['A', 'B', 'C']);
    expect(s.agentProposals.every((p: any) => p.auto && p.status === 'proposed' && p.skillFile)).toBe(true);
  });

  test('a task waiting on the owner steps aside so other work goes on, until the owner decides', async () => {
    write({ ...base, autoAgents: false, tasks: [{ id: 't1', title: 'grow the brain', detail: '', status: 'approved', by: 'owner', createdAt: '' }, { id: 's1', title: "Write X's SKILL.md", detail: 'Agent: X, Analyst.', status: 'approved', by: 'owner', createdAt: '', kind: 'skill-file', agentId: 'agent_x', agentName: 'X' }] });
    await runner.runOnce('manual', { fetch: async () => reply(result({ memory: 'm', proposedAgent: agent('V'), summary: 's' }), { input_tokens: 100, output_tokens: 10 }), file, key: 'test' } as any);
    let s = read();
    expect(s.tasks[0].waitingOnOwner).toBe(true);
    expect(runner.nextTask(s)).toMatchObject({ id: 's1' });
    s.agentProposals[0].status = 'rejected'; // decided: nothing pending any more
    expect(runner.nextTask(s)).toMatchObject({ id: 't1' });
  });

  test('agents with the same job share one SKILL.md, and early plain SKILL.md tasks are retired', async () => {
    const req = (id: string, name: string) => ({ id, title: `Write ${name}'s SKILL.md in full detail`, detail: `Agent: ${name}, Operations Agent. Purpose: Process routine tasks.`, status: 'approved', by: 'owner', createdAt: '', kind: 'skill-file', agentId: `agent_${name}`, agentName: name });
    write({ ...base, tasks: [{ id: 'old', title: "Write X's SKILL.md", detail: '', status: 'approved', by: 'owner', createdAt: '' }, req('a', 'OPS-01'), req('b', 'OPS-02'), { ...req('c', 'MESH'), detail: 'Agent: MESH, 3D Artist.' }] });
    let brief = '';
    const fetch = async (_u: string, init: any) => { brief = JSON.parse(init.body).messages[0].content; return reply(result({ memory: 'm', skillFile: { name: 'Operations playbook', description: 'd', body: 'x'.repeat(300) }, completedTaskIds: ['a'], summary: 's' }), { input_tokens: 100, output_tokens: 10 }); };
    await runner.runOnce('manual', { fetch, file, key: 'test' } as any);
    expect(brief).toMatch(/1 other agents do exactly the same job \(OPS-02\)/);
    const s = read();
    expect(s.tasks.map((t: any) => t.status)).toEqual(['done', 'done', 'done', 'approved']);
    expect(s.skillFiles[0].agentIds).toEqual(['agent_OPS-01', 'agent_OPS-02']);
  });
});

describe('origin runner: ORIGIN sees the real brain', () => {
  const agents = [{ id: 'agent_store', name: 'STORE', title: 'Etsy store', kind: 'venture', ventureId: 'agent_store', hasSkillFile: false, prompt: 'p' }];
  test('runs and console answers list the agents that exist, over ORIGIN\'s own notes', async () => {
    write({ ...base, memory: 'Agents existing: 0', agents });
    let brief = '', system = '';
    await runner.runOnce('manual', { fetch: async (_u: string, init: any) => { brief = JSON.parse(init.body).messages[0].content; return reply(result({ memory: 'm', summary: 's' }), { input_tokens: 10, output_tokens: 10 }); }, file, key: 'test' } as any);
    await runner.ask('what agents exist?', { fetch: async (_u: string, init: any) => { system = JSON.parse(init.body).system; return reply('STORE', { input_tokens: 10, output_tokens: 10 }); }, file, key: 'test' } as any);
    for (const text of [brief, system]) expect(text).toMatch(/AGENTS IN THE BRAIN NOW \(1 besides you[\s\S]*\[agent_store\] STORE: Etsy store \(venture\) \(SKILL\.md not written yet\)/);
  });

  test('SKILL.md requests for agents not in the open brain wait', () => {
    const req = (id: string, agentId: string) => ({ id, status: 'approved', kind: 'skill-file', agentId });
    expect(runner.nextTask({ agents, tasks: [req('gone', 'agent_nova'), req('here', 'agent_store')] } as any)).toMatchObject({ id: 'here' });
  });
});

test('every run also writes one SKILL.md in its own call, even while an owner task keeps the main work busy', async () => {
  const agents = [{ id: 'agent_store', name: 'STORE', title: 'Etsy store', kind: 'venture', prompt: 'p' }];
  write({ ...base, agents, tasks: [
    { id: 'o1', title: 'grow the brain', detail: '', status: 'approved', by: 'owner', createdAt: '' },
    { id: 's1', title: "Write STORE's SKILL.md", detail: 'Venture: STORE, Etsy store.', status: 'approved', by: 'owner', createdAt: '', kind: 'skill-file', agentId: 'agent_store', agentName: 'STORE' },
  ] });
  const bodies: any[] = [];
  const fetch = async (_u: string, init: any) => {
    const b = JSON.parse(init.body); bodies.push(b);
    return bodies.length === 1
      ? reply(result({ memory: 'm', summary: 'worked on o1' }), { input_tokens: 1000, output_tokens: 100 })
      : reply(result({ skillFile: { name: 'Etsy store playbook', description: 'd', body: '#'.repeat(300) } }), { input_tokens: 1000, output_tokens: 6000 });
  };
  const r = await runner.runOnce('manual', { fetch, file, key: 'test' } as any);
  expect(bodies).toHaveLength(2);
  expect(bodies[1].messages[0].content).toMatch(/Write the SKILL\.md for the agent "STORE"/);
  expect(r.ok && (r.run as any).skillFileFor).toBe('STORE');
  const s = read();
  expect(s.tasks.map((t: any) => t.status)).toEqual(['approved', 'done']);
  expect(s.skillFiles[0]).toMatchObject({ agentIds: ['agent_store'], name: 'Etsy store playbook' });
});

describe('origin runner: empire mode, progress and routing', () => {
  test('in empire mode ORIGIN approves its own task, owner tasks still go first, and at most 3 of its own are open', async () => {
    write({ ...base });
    const fetch = async () => reply(result({ memory: 'm', proposedTasks: [{ title: 'Find a niche' }], summary: 's' }), { input_tokens: 100, output_tokens: 10 });
    await runner.runOnce('manual', { fetch, file, key: 'test' } as any);
    let s = read();
    expect(s.tasks[0]).toMatchObject({ title: 'Find a niche', status: 'approved', by: 'origin' });
    expect(s.progressLog.at(-1).note).toMatch(/set itself a task/);
    s.tasks.push({ id: 'o1', title: 'mine', detail: '', status: 'approved', by: 'owner', createdAt: '' });
    expect(runner.nextTask(s)).toMatchObject({ id: 'o1' });
    s.tasks.push(...[1, 2].map((i) => ({ id: `x${i}`, title: `x${i}`, detail: '', status: 'approved', by: 'origin', createdAt: '' })));
    write(s);
    await runner.runOnce('manual', { fetch: async () => reply(result({ memory: 'm', proposedTasks: [{ title: 'Another' }], summary: 's' }), { input_tokens: 100, output_tokens: 10 }), file, key: 'test' } as any);
    expect(read().tasks.find((t: any) => t.title === 'Another').status).toBe('proposed');
  });

  test('a run records the task progress and a log line for the agent it worked as, and has web fetch', async () => {
    write({ ...base, agents: [{ id: 'v1', name: 'Etsy Store', kind: 'venture', prompt: 'p' }], tasks: [{ id: 't1', title: 'Research', detail: '', status: 'approved', by: 'owner', agentId: 'v1', createdAt: '' }] });
    let sent: any = null;
    const fetch = async (_u: string, init: any) => { sent ??= JSON.parse(init.body); return reply(result({ memory: 'm', progress: { percent: 35, note: 'Found 3 niches' }, summary: 's' }), { input_tokens: 100, output_tokens: 10 }); };
    await runner.runOnce('manual', { fetch, file, key: 'test', etsy: null } as any);
    const s = read();
    expect(sent.tools.map((t: any) => t.name)).toEqual(['web_search', 'web_fetch']);
    expect(s.tasks[0].progress).toBe(35);
    expect(s.progressLog.at(-1)).toMatchObject({ agentId: 'v1', agentName: 'Etsy Store', pct: 35, note: 'Found 3 niches', taskId: 't1' });
  });

  test('a question goes to the best-suited agent, answered with its own prompt and billed to it', async () => {
    write({ ...base, agents: [{ id: 'a1', name: 'Pricing Analyst', title: 'pricing', prompt: 'PRICING PROMPT' }, { id: 'a2', name: 'Listing Writer', title: 'copy', prompt: 'COPY PROMPT' }] });
    const bodies: any[] = [];
    const fetch = async (_u: string, init: any) => { const b = JSON.parse(init.body); bodies.push(b); return reply(bodies.length === 1 ? 'a1' : 'Charge $18.', { input_tokens: 100, output_tokens: 10 }); };
    const r = await runner.ask('what should we charge for mugs?', { fetch, file, key: 'test' } as any);
    expect(r).toMatchObject({ ok: true, answer: 'Charge $18.', by: 'Pricing Analyst' });
    expect(bodies[1].system).toMatch(/^PRICING PROMPT/);
    const s = read();
    expect(s.asks[0]).toMatchObject({ agentId: 'a1', by: 'Pricing Analyst' });
    expect(s.ledger.byAgent.a1).toBeGreaterThan(0);
  });

  test('naming an agent sends the question straight to it, with no routing call', async () => {
    write({ ...base, agents: [{ id: 'a2', name: 'Listing Writer', prompt: 'COPY PROMPT' }] });
    let calls = 0;
    const r = await runner.ask('listing writer, how are the titles going?', { fetch: async () => { calls++; return reply('Good.', { input_tokens: 10, output_tokens: 5 }); }, file, key: 'test' } as any);
    expect(r).toMatchObject({ by: 'Listing Writer' });
    expect(calls).toBe(1);
  });
});

describe('origin runner: a fresh brain', () => {
  test('work for agents that are no longer in the brain is closed, and ORIGIN\'s own work is kept', () => {
    const s: any = { agents: [{ id: 'v1', name: 'Store' }], tasks: [
      { id: 'a', title: "Write NOVA's SKILL.md in full detail", kind: 'skill-file', agentId: 'agent_nova', status: 'approved' },
      { id: 'b', title: 'Store task', agentId: 'v1', status: 'approved' },
      { id: 'c', title: 'ORIGIN task', status: 'approved' },
      { id: 'd', title: 'old', agentId: 'agent_idea_x', status: 'proposed', waitingOnOwner: true },
    ], agentProposals: [{ id: 'p1', parentId: 'agent_idea_x', status: 'proposed' }, { id: 'p2', parentId: 'agent_origin', status: 'proposed' }], skillFiles: [{ id: 'f', agentId: 'agent_nova', status: 'new' }] };
    expect(runner.pruneGone(s, 'now')).toBe(4);
    expect(s.tasks.map((t: any) => t.status)).toEqual(['stopped', 'approved', 'approved', 'stopped']);
    expect(s.tasks[0].stopReason).toBe('agent no longer in the brain');
    expect(s.agentProposals.map((p: any) => p.status)).toEqual(['rejected', 'proposed']);
    expect(s.skillFiles[0].status).toBe('imported');
  });
});

describe('origin runner: Etsy tools', () => {
  test('an agent calls etsy_search mid-run; the runner runs it and hands back the result', async () => {
    write({ ...base, tasks: [{ id: 't1', title: 'Mug demand', detail: '', status: 'approved', by: 'owner', createdAt: '' }] });
    const bodies: any[] = [];
    const ran: any[] = [];
    const etsy = { tools: [{ name: 'etsy_search', description: 'd', input_schema: { type: 'object', properties: {} } }], run: async (name: string, input: any) => { ran.push([name, input]); return { content: '{"total":1200}', isError: false }; } };
    const fetch = async (_u: string, init: any) => {
      bodies.push(JSON.parse(init.body));
      if (bodies.length === 1) return { ok: true, status: 200, json: async () => ({ content: [{ type: 'tool_use', id: 'tu1', name: 'etsy_search', input: { keywords: 'cat mug' } }], usage: { input_tokens: 100, output_tokens: 10 }, stop_reason: 'tool_use' }) };
      return reply(result({ memory: 'm', progress: { percent: 20, note: '1200 listings' }, summary: 's' }), { input_tokens: 100, output_tokens: 10 });
    };
    const r: any = await runner.runOnce('manual', { fetch, file, key: 'test', etsy } as any);
    expect(ran).toEqual([['etsy_search', { keywords: 'cat mug' }]]);
    expect(bodies[0].tools.map((t: any) => t.name)).toContain('etsy_search');
    expect(bodies[1].messages.at(-1).content[0]).toMatchObject({ type: 'tool_result', tool_use_id: 'tu1', content: '{"total":1200}' });
    expect(r.run).toMatchObject({ status: 'done', etsyCalls: 1 });
    expect(read().tasks[0].progress).toBe(20);
  });
});

describe('origin runner: Printify publish requests', () => {
  test('an agent asks to publish; the runner records it for the owner and tells them, without publishing', async () => {
    write({ ...base, tasks: [{ id: 't1', title: 'Make mugs', detail: '', status: 'approved', by: 'owner', createdAt: '' }] });
    const urls: string[] = [];
    const tools = { tools: [{ name: 'printify_request_publish', description: 'd', input_schema: { type: 'object', properties: {} } }], run: async () => ({ content: 'x', isError: false }) };
    let n = 0;
    const fetch = async (u: string) => {
      urls.push(u); n++;
      if (n === 1) return { ok: true, status: 200, json: async () => ({ content: [{ type: 'tool_use', id: 'a', name: 'printify_request_publish', input: { product_id: 'p1', title: 'Cat Mug', why: 'sells' } }], usage: { input_tokens: 10, output_tokens: 5 }, stop_reason: 'tool_use' }) };
      return reply(result({ memory: 'm', summary: 's' }), { input_tokens: 10, output_tokens: 5 });
    };
    const r: any = await runner.runOnce('manual', { fetch, file, key: 'test', etsy: tools } as any);
    expect(urls.every((u) => u.includes('anthropic'))).toBe(true);
    expect(read().publishRequests).toMatchObject([{ productId: 'p1', title: 'Cat Mug', status: 'waiting' }]);
    expect(r.run.notify).toMatch(/1 product ready for you to publish/);
  });
});

describe('origin runner: agents work side by side, through their plans', () => {
  test('each agent works its own task in the same run, and each is charged its own spend', async () => {
    write({ ...base, agents: [{ id: 'a1', name: 'Research' }, { id: 'a2', name: 'Copy' }], tasks: [
      { id: 't1', title: 'R1', detail: '', status: 'approved', by: 'owner', agentId: 'a1', createdAt: '' },
      { id: 't2', title: 'R2', detail: '', status: 'approved', by: 'owner', agentId: 'a1', createdAt: '' },
      { id: 't3', title: 'C1', detail: '', status: 'approved', by: 'owner', agentId: 'a2', createdAt: '' },
    ] });
    const seen: string[] = [];
    const fetch = async (_u: string, init: any) => { const b = JSON.parse(init.body); const m = b.messages[0].content.match(/\[(t\d)\]/); if (m) seen.push(m[1]); return reply(result({ memory: 'm', completedTaskIds: m ? [m[1]] : [], summary: 'ok' }), { input_tokens: 1000, output_tokens: 100 }); };
    const r: any = await runner.runOnce('manual', { fetch, file, key: 'test', etsy: null } as any);
    expect(seen.sort()).toEqual(['t1', 't3']);
    expect(r.run.workers.map((w: any) => w.agentName).sort()).toEqual(['Copy', 'Research']);
    const s = read();
    expect(s.tasks.map((t: any) => t.status)).toEqual(['done', 'approved', 'done']);
    expect(s.ledger.byAgent.a1).toBeGreaterThan(0);
    expect(s.ledger.byAgent.a2).toBeGreaterThan(0);
    expect(s.ledger.byDay[new Date().toISOString().slice(0, 10)]).toBeCloseTo(s.ledger.spentUsd, 6);
  });

  test('a task keeps going through its steps in one run while it is unfinished', async () => {
    write({ ...base, tasks: [{ id: 't1', title: 'Plan', detail: '', status: 'approved', by: 'owner', createdAt: '' }] });
    let n = 0;
    const fetch = async () => {
      n++;
      const steps = [1, 2, 3].map((i) => ({ text: `step ${i}`, done: i <= n }));
      return reply(result({ memory: 'm', steps, taskNotes: `after ${n}`, progress: { percent: n * 33 }, completedTaskIds: n === 3 ? ['t1'] : [], summary: 's' }), { input_tokens: 100, output_tokens: 10 });
    };
    const r: any = await runner.runOnce('manual', { fetch, file, key: 'test', etsy: null } as any);
    expect(n).toBe(3);
    expect(r.run.workers[0].rounds).toBe(3);
    const t = read().tasks[0];
    expect(t).toMatchObject({ status: 'done', progress: 100, notes: 'after 3' });
    expect(t.steps.every((x: any) => x.done)).toBe(true);
  });

  test("today's allowance is the day's share of what is left of the cap", () => {
    const s: any = { ledger: { spentUsd: 5, byDay: { '2026-10-21': 0.5 } } };
    const d = runner.dailyAllowance(s, new Date(Date.UTC(2026, 9, 21, 12)));
    expect(d.spentTodayUsd).toBe(0.5);
    expect(d.allowanceUsd).toBeCloseTo((10 + 0.5) / 11, 5);
  });
});
