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
  process.env.ORIGIN_DATA_DIR = dir;
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
    expect(s.tasks[0]).toMatchObject({ status: 'stopped', stopReason: 'JARVIS stopped it: costs rising, little value' });
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

  test('an older state that let JARVIS create agents freely now needs the owner for every agent', () => {
    write({ ...base, autoAgents: true });
    const s = runner.loadState(file);
    expect(s.autoAgents).toBe(false);
    expect(s.agentPolicy).toBe(2);
    expect(runner.loadState(file).autoAgents).toBe(false);
  });

  test('with auto-create turned on by the owner, ORIGIN creates up to 3 agents a run for a venture, each with its SKILL.md', async () => {
    write({ ...base, autoAgents: true, agentPolicy: 2 });
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

describe('origin runner: trends and free-to-use images', () => {
  test('a trend task gets the public-source rules, and trends_google runs through the runner', async () => {
    write({ ...base, agents: [{ id: 'ts', name: 'Trend Scout' }], tasks: [{ id: 't1', title: 'Trend Scout: TikTok and Instagram phrases for shirts', detail: '', status: 'approved', by: 'owner', agentId: 'ts', createdAt: '' }] });
    const bodies: any[] = [];
    const ran: any[] = [];
    const etsy = { tools: [{ name: 'trends_google', description: 'd', input_schema: { type: 'object', properties: {} } }], run: async () => ({ content: 'x', isError: false }), trends: async (name: string, input: any) => { ran.push([name, input]); return { content: '{"items":[]}', isError: false }; } };
    const fetch = async (_u: string, init: any) => {
      bodies.push(JSON.parse(init.body));
      if (bodies.length === 1) return { ok: true, status: 200, json: async () => ({ content: [{ type: 'tool_use', id: 'tu1', name: 'trends_google', input: { geo: 'US' } }], usage: { input_tokens: 100, output_tokens: 10 }, stop_reason: 'tool_use' }) };
      return reply(result({ memory: 'm', summary: 's' }), { input_tokens: 100, output_tokens: 10 });
    };
    const r: any = await runner.runOnce('manual', { fetch, file, key: 'test', etsy } as any);
    expect(ran).toEqual([['trends_google', { geo: 'US' }]]);
    expect(bodies[0].messages[0].content).toMatch(/TRENDS \(TikTok, Instagram and the rest\)/);
    expect(bodies[0].messages[0].content).toMatch(/never log in to a social site/);
    expect(bodies[0].messages[0].content).toMatch(/ORIGINAL ONLY/);
    expect(bodies[1].messages.at(-1).content[0]).toMatchObject({ type: 'tool_result', tool_use_id: 'tu1', content: '{"items":[]}' });
    expect(r.run).toMatchObject({ status: 'done', trendCalls: 1 });
  });

  test("every task brief carries the owner's design style guide, and their own note once they add one", async () => {
    write({ ...base, designStyle: 'navy and cream only', tasks: [{ id: 't1', title: 'Art', detail: '', status: 'approved', by: 'owner', createdAt: '' }] });
    const bodies: any[] = [];
    const fetch = async (_u: string, init: any) => { bodies.push(JSON.parse(init.body)); return reply(result({ memory: 'm', summary: 's' }), { input_tokens: 100, output_tokens: 10 }); };
    await runner.runOnce('manual', { fetch, file, key: 'test', etsy: { tools: [], run: async () => ({ content: 'x', isError: false }) } } as any);
    expect(bodies[0].messages[0].content).toMatch(/DESIGN STYLE .*captioned "fih"|"fih"/);
    expect(bodies[0].messages[0].content).toMatch(/THE OWNER ADDS: navy and cream only/);
  });

  test("the brief lists the designs the owner declined lately, so nobody remakes them", async () => {
    write({ ...base, designs: [{ id: 'd1', title: 'fih: a plain fish', status: 'rejected', decidedAt: new Date().toISOString(), at: '', kind: 'svg', fileName: 'a.svg', agentId: 'x', agentName: 'X', taskId: null, taskTitle: null, imageId: null }, { id: 'd2', title: 'honk goose', status: 'waiting', at: new Date().toISOString(), kind: 'svg', fileName: 'b.svg', agentId: 'x', agentName: 'X', taskId: null, taskTitle: null, imageId: null }], tasks: [{ id: 't1', title: 'Art', detail: '', status: 'approved', by: 'owner', createdAt: '' }] });
    const bodies: any[] = [];
    const fetch = async (_u: string, init: any) => { bodies.push(JSON.parse(init.body)); return reply(result({ memory: 'm', summary: 's' }), { input_tokens: 100, output_tokens: 10 }); };
    await runner.runOnce('manual', { fetch, file, key: 'test', etsy: { tools: [], run: async () => ({ content: 'x', isError: false }) } } as any);
    expect(bodies[0].messages[0].content).toMatch(/DECLINED BY THE OWNER LATELY .*"fih: a plain fish"/);
    expect(bodies[0].messages[0].content).not.toMatch(/"honk goose"/);
  });

  test('a task that is not about trends does not carry the trend sources, but keeps the copyright rule', async () => {
    write({ ...base, tasks: [{ id: 't1', title: 'Mug demand', detail: 'prices', status: 'approved', by: 'owner', createdAt: '' }] });
    const bodies: any[] = [];
    const fetch = async (_u: string, init: any) => { bodies.push(JSON.parse(init.body)); return reply(result({ memory: 'm', summary: 's' }), { input_tokens: 100, output_tokens: 10 }); };
    await runner.runOnce('manual', { fetch, file, key: 'test', etsy: { tools: [], run: async () => ({ content: 'x', isError: false }) } } as any);
    expect(bodies[0].messages[0].content).not.toMatch(/TRENDS \(TikTok/);
    expect(bodies[0].messages[0].content).toMatch(/ORIGINAL ONLY/);
  });

  test('a design saved with public-domain assets keeps their title, page and licence', async () => {
    write({ ...base, allowDrawnDesigns: true, tasks: [{ id: 't1', title: 'Art', detail: '', status: 'approved', by: 'owner', createdAt: '' }] });
    let n = 0;
    const fetch = async () => { n++; return n === 1 ? { ok: true, status: 200, json: async () => ({ content: [{ type: 'tool_use', id: 'd1', name: 'design_save', input: { svg: '<svg xmlns="http://www.w3.org/2000/svg"></svg>', title: 'Rose tee', assets: [{ title: 'Rosa gallica', page: 'https://commons/Rose', licence: 'Public domain' }] } }], usage: { input_tokens: 10, output_tokens: 5 }, stop_reason: 'tool_use' }) } : reply(result({ memory: 'm', summary: 's' }), { input_tokens: 10, output_tokens: 5 }); };
    await runner.runOnce('manual', { fetch, file, key: 'test', etsy: { tools: [{ name: 'design_save', description: 'd', input_schema: { type: 'object', properties: {} } }], run: async () => ({ content: 'x', isError: false }) } } as any);
    expect(read().designs[0]).toMatchObject({ title: 'Rose tee', assets: [{ title: 'Rosa gallica', page: 'https://commons/Rose', licence: 'Public domain' }] });
  });
});

describe('origin runner: more than one brain', () => {
  test("switching brains parks the other brain's tasks instead of stopping them, and only the open brain's tasks run", () => {
    const s: any = { ...base, brainId: 'b1', brains: { b1: { name: 'Store brain', agents: [{ id: 'a1', name: 'Designer' }] } }, agents: [{ id: 'a1', name: 'Designer' }],
      tasks: [{ id: 't1', title: 'Store work', detail: '', status: 'approved', by: 'owner', agentId: 'a1', brainId: 'b1', createdAt: '' }] };
    // the owner opens a second brain with its own agent
    s.brainId = 'b2'; s.brains.b2 = { name: 'Music brain', agents: [{ id: 'm1', name: 'Mixer' }] }; s.agents = [{ id: 'm1', name: 'Mixer' }];
    expect(runner.pruneGone(s, 'now')).toBe(0);
    expect(s.tasks[0].status).toBe('approved');
    expect(runner.nextTask(s)).toBeNull();
    s.tasks.push({ id: 't2', title: 'Music work', detail: '', status: 'approved', by: 'owner', agentId: 'm1', brainId: 'b2', createdAt: '' });
    expect(runner.nextTask(s)).toMatchObject({ id: 't2' });
    expect(runner.pickTasks(s).map((t: any) => t.id)).toEqual(['t2']);
    // back in the first brain, its task is ready again; a legacy task without a brain runs anywhere
    s.brainId = 'b1'; s.agents = [{ id: 'a1', name: 'Designer' }];
    expect(runner.nextTask(s)).toMatchObject({ id: 't1' });
    expect(runner.inBrain(s, { })).toBe(true);
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

describe('origin runner: the command center sets the focus', () => {
  test('the number of items the owner asked for is read from their words', () => {
    expect(runner.itemCount('i need 5 items for my etsy store')).toBe(5);
    expect(runner.itemCount('make three cat mugs')).toBe(3);
    expect(runner.itemCount('make 40 new shirts')).toBe(10);
    expect(runner.itemCount('find a niche in 2026')).toBeNull();
  });

  test('a command-center task goes first and alone, with no agents or self-tasks, and its products land in one list for the owner', async () => {
    write({ ...base, agents: [{ id: 'a1', name: 'Research' }], tasks: [
      { id: 'o1', title: 'Old owner task', detail: '', status: 'approved', by: 'owner', agentId: 'a1', createdAt: '' },
      { id: 'x1', title: 'ORIGIN self task', detail: '', status: 'approved', by: 'origin', createdAt: '' },
    ] });
    const s0 = runner.loadState(file);
    const focus: any = runner.addFocusTask(s0, { title: 'Make 2 items for my etsy store' });
    expect(focus).toMatchObject({ focus: true, by: 'owner', status: 'approved', count: 2 });
    fs.writeFileSync(file, JSON.stringify(s0));
    expect(runner.pickTasks(runner.loadState(file)).map((t: any) => t.id)).toEqual([focus.id]);

    const tools = { tools: [{ name: 'printify_create_product', description: 'd', input_schema: { type: 'object', properties: {} } }, { name: 'printify_request_publish', description: 'd', input_schema: { type: 'object', properties: {} } }], run: async () => ({ content: 'x', isError: false }), preview: async (id: string) => ({ image: `https://img/${id}.png`, priceUsd: 18 }) };
    let n = 0, brief = '';
    const fetch = async (_u: string, init: any) => {
      n++;
      if (n === 1) brief = JSON.parse(init.body).messages[0].content;
      if (n <= 2) return { ok: true, status: 200, json: async () => ({ content: [{ type: 'tool_use', id: `u${n}`, name: 'printify_request_publish', input: { product_id: `p${n}`, title: `Item ${n}` } }], usage: { input_tokens: 10, output_tokens: 5 }, stop_reason: 'tool_use' }) };
      return reply(result({ memory: 'm', proposedTasks: [{ title: 'Grow more' }], proposedAgents: [{ parentId: 'agent_origin', name: 'A' }, { parentId: 'agent_origin', name: 'B' }], completedTaskIds: [focus.id], summary: 's' }), { input_tokens: 10, output_tokens: 5 });
    };
    const r: any = await runner.runOnce('focus', { fetch, file, key: 'test', etsy: tools } as any);
    expect(brief).toMatch(/FOCUS: the owner gave you this task in the command center/);
    expect(brief).toMatch(/asked for 2 items/);
    expect(brief).not.toMatch(/EMPIRE MODE/);
    expect(r.run.workers).toHaveLength(1);
    const s = read();
    expect(s.publishRequests.map((x: any) => [x.taskId, x.title, x.image, x.priceUsd])).toEqual([[focus.id, 'Item 1', 'https://img/p1.png', 18], [focus.id, 'Item 2', 'https://img/p2.png', 18]]);
    expect(s.tasks.some((t: any) => t.title === 'Grow more')).toBe(false);
    expect(s.agentProposals).toHaveLength(1);
    expect(s.tasks.find((t: any) => t.id === focus.id).status).toBe('done');
    // with the focus done, the other work comes back
    expect(runner.pickTasks(s).map((t: any) => t.id)).toEqual(['o1', 'x1']);
  });

  test("the owner's words in the console become the focus task", () => {
    const s: any = { ...base, tasks: [], agents: [] };
    expect(runner.applyConsent(s, { title: 'Make 5 items', detail: 'for the store', count: 5 })).toEqual(['Make 5 items']);
    expect(s.tasks[0]).toMatchObject({ focus: true, count: 5, via: 'console' });
  });
});

describe('origin runner: design images and branch runs', () => {
  const imageTools = (made: any[]) => ({ tools: [{ name: 'design_generate_image', description: 'd', input_schema: { type: 'object', properties: {} } }], run: async () => ({ content: 'x', isError: false }), image: async (input: any) => { made.push(input); return { image_id: `img${made.length}`, usd: 0.05, model: 'gpt-image-2', quality: input.quality, size: '1024x1024' }; } });
  const callsTool = (inputs: object[]) => { let n = 0; return async () => { n++; return n <= inputs.length ? { ok: true, status: 200, json: async () => ({ content: [{ type: 'tool_use', id: `u${n}`, name: 'design_generate_image', input: inputs[n - 1] }], usage: { input_tokens: 10, output_tokens: 5 }, stop_reason: 'tool_use' }) } : reply(result({ memory: 'm', summary: 's' }), { input_tokens: 10, output_tokens: 5 }); }; };

  test('each image is logged with its cost on the image cap, not the Anthropic cap', async () => {
    write({ ...base, allowDrawnDesigns: true, agents: [{ id: 'd1', name: 'Designer' }], tasks: [{ id: 't1', title: 'Art', detail: '', status: 'approved', by: 'owner', agentId: 'd1', createdAt: '' }] });
    const made: any[] = [];
    const r: any = await runner.runOnce('manual', { fetch: callsTool([{ prompt: 'cat', quality: 'medium' }, { prompt: 'dog' }]), file, key: 'test', etsy: imageTools(made) } as any);
    const s = read();
    expect(made.map((x) => x.quality)).toEqual(['medium', 'medium']);
    expect(s.imageLog.map((e: any) => [e.agentName, e.usd, e.imageId, e.taskId])).toEqual([['Designer', 0.05, 'img1', 't1'], ['Designer', 0.05, 'img2', 't1']]);
    expect(s.images.spentUsd).toBeCloseTo(0.1, 6);
    expect(r.run).toMatchObject({ images: 2, imageUsd: 0.1 });
    expect(s.ledger.spentUsd).toBeLessThan(0.01);
  });

  test('past the image cap the agent is told to use SVG, and nothing is made', async () => {
    write({ ...base, allowDrawnDesigns: true, imageCapUsd: 0.05, images: { month, spentUsd: 0.04 }, tasks: [{ id: 't1', title: 'Art', detail: '', status: 'approved', by: 'owner', createdAt: '' }] });
    const made: any[] = [];
    const bodies: any[] = [];
    const inner = callsTool([{ prompt: 'cat' }]);
    await runner.runOnce('manual', { fetch: async (_u: string, init: any) => { bodies.push(JSON.parse(init.body)); return inner(); }, file, key: 'test', etsy: imageTools(made) } as any);
    expect(made).toHaveLength(0);
    expect(bodies[1].messages.at(-1).content[0]).toMatchObject({ is_error: true });
    expect(bodies[1].messages.at(-1).content[0].content).toMatch(/image cap/);
  });

  test("a branch's run works only that branch's tasks", async () => {
    write({ ...base, agents: [{ id: 'v1', name: 'Store' }, { id: 's1', name: 'Seo' }, { id: 'v2', name: 'Other' }], tasks: [
      { id: 'a', title: 'A', detail: '', status: 'approved', by: 'owner', agentId: 'v2', createdAt: '' },
      { id: 'b', title: 'B', detail: '', status: 'approved', by: 'owner', agentId: 's1', createdAt: '' },
    ] });
    const r: any = await runner.runOnce('manual', { fetch: async () => reply(result({ memory: 'm', summary: 's' }), { input_tokens: 10, output_tokens: 5 }), file, key: 'test', etsy: null, only: ['v1', 's1'] } as any);
    expect(r.run.workers.map((w: any) => w.taskId)).toEqual(['b']);
    const none: any = await runner.runOnce('manual', { fetch: async () => reply('', {}), file, key: 'test', etsy: null, only: ['zzz'] } as any);
    expect(none).toMatchObject({ ok: false });
  });
});

describe('origin runner: money', () => {
  test('spend is kept per agent for all time, and sales are pulled into the state', async () => {
    write({ ...base, ledger: { month, spentUsd: 0.2, unknownCostRuns: 0, byAgent: { a1: 0.2 } }, agents: [{ id: 'a1', name: 'Store' }], publishRequests: [{ productId: 'p1', agentId: 'a1', status: 'published' }], tasks: [{ id: 't1', title: 'T', detail: '', status: 'approved', by: 'owner', agentId: 'a1', createdAt: '' }] });
    await runner.runOnce('manual', { fetch: async () => reply(result({ memory: 'm', summary: 's' }), { input_tokens: 1000, output_tokens: 100 }), file, key: 'test', etsy: null } as any);
    let s = read();
    expect(s.totals.claude.a1).toBeGreaterThan(0.2);
    expect(s.totals.claude.a1).toBeCloseTo(s.ledger.byAgent.a1, 6);
    const r = await runner.syncSales({ file, listOrders: async () => [{ id: 'o1', status: 'fulfilled', total_price: 900, line_items: [{ product_id: 'p1', quantity: 1, metadata: { price: 2000 } }] }] });
    expect(r).toMatchObject({ ok: true, orders: 1 });
    s = read();
    expect(s.sales[0]).toMatchObject({ agentId: 'a1', revenueUsd: 20, costUsd: 9 });
    expect(s.salesSync.error).toBeNull();
  });
});

describe('origin runner: skills from the command center', () => {
  const store = [{ id: 'v1', name: 'STORE', kind: 'venture' }, { id: 'm1', name: 'Mockup & Design', ventureId: 'v1' }, { id: 'a1', name: 'Ads Research', ventureId: 'v1' }, { id: 'o1', name: 'Other' }];

  test('agents are found by name, loosely, and a venture team brings its agents', () => {
    const s: any = { agents: store };
    expect(runner.resolveAgents(s, ['mockup and design', 'ads research'])).toEqual({ ids: ['m1', 'a1'], unknown: [] });
    expect(runner.resolveAgents(s, ['STORE team']).ids.sort()).toEqual(['a1', 'm1', 'v1']);
    expect(runner.resolveAgents(s, ['all']).ids).toHaveLength(4);
    expect(runner.resolveAgents(s, ['Nobody']).unknown).toEqual(['Nobody']);
  });

  test('a SKILLS line in an answer queues the files and bank skills, and is not shown to the owner', async () => {
    write({ ...base, agents: store, tasks: [{ id: 'k1', kind: 'skill-file', agentId: 'm1', agentName: 'Mockup & Design', title: 'w', detail: '', status: 'approved', by: 'owner', createdAt: '' }] });
    const line = 'SKILLS ' + JSON.stringify({ files: ['STORE team'], bank: [{ name: 'Web research', description: 'find and cite sources', agents: ['STORE team'] }] });
    const r: any = await runner.ask('make a skill and a file for each agent', { fetch: async () => reply(`Writing them now.\n${line}`, { input_tokens: 10, output_tokens: 5 }), file, key: 'test' } as any);
    expect(r.answer).toBe('Writing them now.');
    expect(r.skills).toMatchObject({ bank: ['Web research'], unknown: [] });
    expect(r.skills.files.sort()).toEqual(['Ads Research', 'Mockup & Design', 'STORE']);
    const s = read();
    expect(s.tasks.filter((t: any) => t.kind === 'skill-file')).toHaveLength(3);
    expect(s.tasks.find((t: any) => t.id === 'k1').requested).toBe(true);
    expect(s.tasks.find((t: any) => t.kind === 'bank-skill')).toMatchObject({ skillName: 'Web research', requested: true });
    expect(runner.pickTasks(s)).toEqual([]);
  });

  test('a skills run writes them all, several at a time, and the bank skill goes to its agents', async () => {
    const body = 'x'.repeat(300);
    const fetch = async (_u: string, init: any) => { const p = JSON.parse(init.body).messages[0].content; return reply(result({ skillFile: { name: /bank called/.test(p) ? 'Web research' : 'Playbook', description: 'd', body } }), { input_tokens: 100, output_tokens: 100 }); };
    const r: any = await runner.runSkills('skills', { fetch, file, key: 'test' } as any);
    expect(r.ok).toBe(true);
    expect(r.run.skillsWritten).toHaveLength(4);
    const s = read();
    expect(s.tasks.filter((t: any) => (t.kind === 'skill-file' || t.kind === 'bank-skill') && t.status === 'approved')).toHaveLength(0);
    const bank = s.skillFiles.find((f: any) => f.bank);
    expect(bank).toMatchObject({ skillKey: 'web_research', name: 'Web research', status: 'new' });
    expect(bank.agentIds.sort()).toEqual(['a1', 'm1', 'v1']);
    expect(s.runs[0].trigger).toBe('skills');
  });
});

describe('origin runner: designs', () => {
  test('an agent saves an SVG design when the owner allows drawn designs; it is kept on disk and listed for the gallery', async () => {
    write({ ...base, allowDrawnDesigns: true, agents: [{ id: 'd1', name: 'Mockup & Design' }], tasks: [{ id: 't1', title: 'Jersey Avenue shirts', detail: '', status: 'approved', by: 'owner', agentId: 'd1', focus: true, createdAt: '' }] });
    const tools = { tools: [{ name: 'design_save', description: 'd', input_schema: { type: 'object', properties: {} } }], run: async () => ({ content: 'x', isError: false }) };
    let n = 0;
    const fetch = async () => { n++; return n === 1 ? { ok: true, status: 200, json: async () => ({ content: [{ type: 'tool_use', id: 'u1', name: 'design_save', input: { file_name: 'jersey-ave', svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><text>JA</text></svg>', title: 'Jersey Avenue script' } }], usage: { input_tokens: 10, output_tokens: 5 }, stop_reason: 'tool_use' }) } : reply(result({ memory: 'm', summary: 's' }), { input_tokens: 10, output_tokens: 5 }); };
    const r: any = await runner.runOnce('focus', { fetch, file, key: 'test', etsy: tools } as any);
    expect(r.run.designs).toBe(1);
    const d = read().designs[0];
    expect(d).toMatchObject({ kind: 'svg', fileName: 'jersey-ave.svg', title: 'Jersey Avenue script', agentName: 'Mockup & Design', taskId: 't1' });
    expect(fs.readFileSync(path.join(path.dirname(file), 'designs', `${d.id}.svg`), 'utf8')).toMatch(/<svg/);
  });

  test('drawn designs are off by default: an SVG is refused and the agent is sent to caption a found image', async () => {
    write({ ...base, agents: [{ id: 'd1', name: 'Mockup & Design' }], tasks: [{ id: 't1', title: 'Fish meme shirts', detail: 'funny fish', status: 'approved', by: 'owner', agentId: 'd1', focus: true, createdAt: '' }] });
    const tools = { tools: [{ name: 'design_save', description: 'd', input_schema: { type: 'object', properties: {} } }], run: async () => ({ content: 'x', isError: false }) };
    const seen: any[] = [];
    let n = 0;
    const fetch = async (_u: string, init: any) => { n++; seen.push(JSON.parse(init.body)); return n === 1 ? { ok: true, status: 200, json: async () => ({ content: [{ type: 'tool_use', id: 'u1', name: 'design_save', input: { svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><text>fih</text></svg>', title: 'fih' } }], usage: { input_tokens: 10, output_tokens: 5 }, stop_reason: 'tool_use' }) } : reply(result({ memory: 'm', summary: 's' }), { input_tokens: 10, output_tokens: 5 }); };
    await runner.runOnce('focus', { fetch, file, key: 'test', etsy: tools } as any);
    expect(read().designs ?? []).toHaveLength(0);
    const toolResult = seen[1].messages.at(-1).content[0];
    expect(toolResult.is_error).toBe(true);
    expect(toolResult.content).toMatch(/design_caption_image/);
    expect(seen[0].messages[0].content).toMatch(/THAT IS THE ONLY WAY ON THIS TASK/);
  });

  test('a task that asks for drawn art may still use design_save', () => {
    expect(runner.drawnAllowed({}, { title: 'Jersey Avenue logo and lettering', detail: '' })).toBe(true);
    expect(runner.drawnAllowed({}, { title: 'Fish meme shirts', detail: 'caption the funniest fish' })).toBe(false);
    expect(runner.drawnAllowed({ allowDrawnDesigns: true }, { title: 'Fish meme shirts', detail: '' })).toBe(true);
  });

  test('cancelling a task stops it and clears its waiting designs, keeping decided ones', () => {
    const s: any = { tasks: [{ id: 't1', title: 'Fish', status: 'approved', by: 'owner', focus: true, waitingOnOwner: true }], designs: [{ id: 'design_a', taskId: 't1', status: 'waiting' }, { id: 'design_b', taskId: 't1', status: 'approved' }, { id: 'design_c', taskId: 't2', status: 'waiting' }] };
    const r = runner.cancelTask(s, s.tasks[0], '2026-10-22T00:00:00.000Z');
    expect(r.cleared).toBe(1);
    expect(s.tasks[0]).toMatchObject({ status: 'stopped', stopReason: 'You cancelled it.' });
    expect(s.tasks[0].focus).toBeUndefined();
    expect(s.tasks[0].waitingOnOwner).toBeUndefined();
    expect(s.designs.map((d: any) => d.status)).toEqual(['rejected', 'approved', 'waiting']);
    expect(s.designs[0].printify).toBe('task cancelled');
  });
});

describe('origin runner: Canva', () => {
  const canvaTools = (calls: any[], owner = true) => ({
    tools: [{ name: 'canva_export_design', description: 'd', input_schema: { type: 'object', properties: {} } }],
    run: async () => ({ content: 'x', isError: false }),
    canva: async (name: string, input: any) => { calls.push({ name, input }); return { content: [{ type: 'text', text: '{"url":"https://export-download.canva.com/x.png"}' }] }; },
    canvaFiles: async () => [{ ext: 'png', b64: Buffer.from('png-bytes').toString('base64') }],
    upload: async () => ({ image_id: 'pf_img_1' }),
    owner,
  });
  const once = (name: string) => { let n = 0; return async () => { n++; return n === 1 ? { ok: true, status: 200, json: async () => ({ content: [{ type: 'tool_use', id: 'u1', name, input: { design_id: 'DAAAAAAAAAA', format: { type: 'png' } } }], usage: { input_tokens: 10, output_tokens: 5 }, stop_reason: 'tool_use' }) } : reply(result({ memory: 'm', summary: 's' }), { input_tokens: 10, output_tokens: 5 }); }; };

  test("an export from the owner's Canva is saved to the gallery and uploaded to Printify", async () => {
    write({ ...base, agents: [{ id: 'd1', name: 'Mockup & Design' }], tasks: [{ id: 't1', title: 'Jersey Avenue posters', detail: '', status: 'approved', by: 'owner', agentId: 'd1', focus: true, createdAt: '' }] });
    const calls: any[] = [];
    const r: any = await runner.runOnce('focus', { fetch: once('canva_export_design'), file, key: 'test', etsy: canvaTools(calls) } as any);
    expect(calls).toHaveLength(1);
    expect(r.run.canvaCalls).toBe(1);
    const s = read();
    expect(s.designs[0]).toMatchObject({ kind: 'png', source: 'canva', imageId: 'pf_img_1', taskId: 't1' });
    expect(s.canva.exports).toBe(1);
    expect(s.canvaLog[0]).toMatchObject({ tool: 'export-design', ok: true, files: 1 });
  });

  test('Canva is left out of tasks the owner did not give', async () => {
    write({ ...base, agents: [{ id: 'd1', name: 'Mockup & Design' }], tasks: [{ id: 't1', title: 'Research mugs', detail: '', status: 'approved', by: 'origin', agentId: 'd1', createdAt: '' }] });
    const calls: any[] = [];
    let sent: any = null;
    const f = once('canva_export_design');
    const fetch = async (_u: string, o: any) => { sent ??= JSON.parse(o.body); return f(); };
    await runner.runOnce('manual', { fetch, file, key: 'test', etsy: canvaTools(calls) } as any);
    expect((sent.tools || []).some((t: any) => t.name.startsWith('canva_'))).toBe(false);
    expect(calls).toHaveLength(0);
  });
});

describe('origin runner: approvals, repeats and budgets', () => {
  const agents = [{ id: 'v1', name: 'STORE', kind: 'venture' }, { id: 'd1', name: 'Mockup & Design', kind: 'skill', ventureId: 'v1' }];
  const saveTool = (file_name: string) => ({ content: [{ type: 'tool_use', id: `u_${file_name}`, name: 'design_save', input: { file_name, svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><text>x</text></svg>', title: file_name } }], usage: { input_tokens: 10, output_tokens: 5 }, stop_reason: 'tool_use' });
  const design = (i: number, status = 'waiting', extra: any = {}) => ({ id: `design_${i}`, kind: 'svg', fileName: `d${i}.svg`, title: `Design ${i}`, agentId: 'd1', agentName: 'Mockup & Design', taskId: 't1', taskTitle: 'Mom shirts', imageId: null, status, at: '2026-10-21T08:00:00.000Z', ...extra });

  test('"every hour" in the owner\'s words makes a repeating task, which comes back after it finishes', () => {
    expect(runner.repeatMinutes('make mom shirt designs every hour')).toBe(60);
    expect(runner.repeatMinutes('check prices every 2 days')).toBe(2880);
    expect(runner.repeatMinutes('make 5 shirts')).toBeNull();
    const s: any = { ...base, tasks: [] };
    const t: any = runner.addFocusTask(s, { title: 'Mom shirt designs from sales research', everyMinutes: 60 });
    expect(t.everyMinutes).toBe(60);
    Object.assign(t, { status: 'done', doneAt: '2026-10-21T08:00:00.000Z', steps: [{ text: 'a', done: true }], progress: 100 });
    expect(runner.reopenRepeats(s, Date.parse('2026-10-21T08:30:00Z'))).toHaveLength(0);
    const back = runner.reopenRepeats(s, Date.parse('2026-10-21T09:01:00Z'));
    expect(back).toHaveLength(1);
    expect(t).toMatchObject({ status: 'approved', focus: true, steps: [], progress: 0, repeats: 1 });
  });

  test('an ask may have five designs waiting at most; the sixth is refused and the task waits for the owner', async () => {
    write({ ...base, allowDrawnDesigns: true, agents, designs: [1, 2, 3, 4, 5].map((i) => design(i)), tasks: [{ id: 't1', title: 'Mom shirts', detail: '', status: 'approved', by: 'owner', agentId: 'd1', focus: true, createdAt: '' }] });
    const tools = { tools: [{ name: 'design_save', description: 'd', input_schema: { type: 'object', properties: {} } }], run: async () => ({ content: 'x', isError: false }) };
    const sent: any[] = [];
    let n = 0;
    const fetch = async (_u: string, o: any) => { sent.push(JSON.parse(o.body)); n++; return n === 1 ? { ok: true, status: 200, json: async () => saveTool('six') } : reply(result({ memory: 'm', summary: 's', waitingOnOwner: true }), { input_tokens: 10, output_tokens: 5 }); };
    await runner.runOnce('focus', { fetch, file, key: 'test', etsy: tools } as any);
    const res = sent[1].messages.at(-1).content[0];
    expect(res.is_error).toBe(true);
    expect(res.content).toMatch(/waiting for their Yes or No/);
    const s = read();
    expect(s.designs).toHaveLength(5);
    expect(s.tasks[0].waitingOnOwner).toBe(true);
    // five designs waiting count as pending, so the task steps aside until the owner decides
    expect(runner.pickTasks(s)).toHaveLength(0);
  });

  test("a product made for a design the owner said Yes to is published at once: the Yes was the approval", async () => {
    write({ ...base, agents, designs: [design(1, 'approved', { imageId: 'img1' })], tasks: [{ id: 'p1', title: 'Publish "Design 1"', detail: '', status: 'approved', by: 'owner', via: 'approval', focus: true, designId: 'design_1', agentId: 'd1', createdAt: '' }] });
    const published: any[] = [];
    const tools = { tools: [{ name: 'printify_request_publish', description: 'd', input_schema: { type: 'object', properties: {} } }], run: async () => ({ content: 'x', isError: false }), preview: async () => ({ priceUsd: 24.99 }), publish: async (_shop: any, id: string) => { published.push(id); } };
    let n = 0;
    const fetch = async () => { n++; return n === 1 ? { ok: true, status: 200, json: async () => ({ content: [{ type: 'tool_use', id: 'u1', name: 'printify_request_publish', input: { product_id: 'prod9', title: 'Mom Fuel Tee', why: 'fits' } }], usage: { input_tokens: 10, output_tokens: 5 }, stop_reason: 'tool_use' }) } : reply(result({ memory: 'm', summary: 's', completedTaskIds: ['p1'] }), { input_tokens: 10, output_tokens: 5 }); };
    await runner.runOnce('focus', { fetch, file, key: 'test', etsy: tools } as any);
    expect(published).toEqual(['prod9']);
    const s = read();
    expect(s.designs[0]).toMatchObject({ status: 'published', productId: 'prod9' });
    expect(s.publishRequests[0]).toMatchObject({ productId: 'prod9', status: 'published', designId: 'design_1' });
    expect(s.tasks[0].status).toBe('done');
  });

  test('spend is filed by branch, and a branch whose monthly budget is used up waits', () => {
    const s: any = { ...base, agents, ledger: { ...base.ledger, byAgent: { d1: 0.4, v1: 0.1, agent_origin: 0.2 } }, imageLog: [{ id: 'i1', at: new Date().toISOString(), agentId: 'd1', usd: 0.05 }], publishRequests: [{ id: 'pub1', agentId: 'd1', status: 'published', publishedAt: new Date().toISOString() }], tasks: [{ id: 't1', title: 'x', status: 'approved', by: 'owner', agentId: 'd1', createdAt: '' }] };
    expect(runner.branchOf(s, 'd1')).toBe('v1');
    expect(runner.branchOf(s, 'agent_origin')).toBe('agent_origin');
    expect(runner.branchSpentUsd(s, 'v1')).toBeCloseTo(0.75, 6);
    expect(runner.pickTasks(s)).toHaveLength(1);
    s.branchBudgets = { v1: 0.5 };
    expect(runner.pickTasks(s)).toHaveLength(0);
    s.branchBudgets = { v1: 2 };
    expect(runner.pickTasks(s)).toHaveLength(1);
  });

  test('the cap the owner set in the app is the one in force', async () => {
    write({ ...base, capUsd: 0.1, ledger: { ...base.ledger, spentUsd: 0.1 }, tasks: [{ id: 't1', title: 'x', detail: '', status: 'approved', by: 'owner', createdAt: '' }] });
    const r: any = await runner.runOnce('manual', { fetch: async () => { throw new Error('no call expected'); }, file, key: 'test' } as any);
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/\$0\.1 monthly cap is reached/);
  });
});

describe('origin runner: the owner\'s Yes and No reach Printify', () => {
  const d = (extra: any = {}) => ({ id: 'design_9', kind: 'svg', fileName: 'x.svg', title: 'Mom Fuel', agentId: 'd1', agentName: 'Mockup & Design', taskId: 't1', taskTitle: 'Mom shirts', imageId: 'img9', status: 'waiting', at: '2026-10-21T08:00:00.000Z', ...extra });
  const agents = [{ id: 'd1', name: 'Mockup & Design', kind: 'skill', ventureId: 'v1' }];

  test('No deletes the product and archives the upload in Printify, and says so', async () => {
    const gone: string[] = [], archived: string[] = [];
    const s: any = { ...base, agents, designs: [d({ productId: 'prod1' })], publishRequests: [{ id: 'pub1', productId: 'prod1', designId: 'design_9', status: 'waiting', title: 'Mom Fuel Tee', agentId: 'd1' }], tasks: [{ id: 't1', title: 'Mom shirts', status: 'approved', by: 'owner', agentId: 'd1', focus: true, waitingOnOwner: true, createdAt: '' }] };
    const r = await runner.decideDesign(s, 'design_9', 'reject', { deleteProduct: async (_shop: any, id: string) => { gone.push(id); }, archiveUpload: async (id: string) => { archived.push(id); } });
    expect(r.body).toMatchObject({ ok: true, printify: 'product deleted from Printify; upload archived in Printify' });
    expect(gone).toEqual(['prod1']); expect(archived).toEqual(['img9']);
    expect(s.designs[0].status).toBe('rejected');
    expect(s.publishRequests[0].status).toBe('deleted');
    expect(s.tasks[0].waitingOnOwner).toBeUndefined();
    expect(s.progressLog.at(-1).note).toMatch(/said No to "Mom Fuel"/);
  });

  test('Yes sends the design to Printify and gives the agent that made it the publish task', async () => {
    const s: any = { ...base, agents, designs: [d({ imageId: null })], tasks: [{ id: 't1', title: 'Mom shirts', detail: 'tees for moms', status: 'approved', by: 'owner', agentId: 'd1', focus: true, createdAt: '' }] };
    fs.mkdirSync(path.join(path.dirname(file), 'designs'), { recursive: true });
    fs.writeFileSync(path.join(path.dirname(file), 'designs', 'design_9.svg'), '<svg xmlns="http://www.w3.org/2000/svg"/>');
    const r = await runner.decideDesign(s, 'design_9', 'approve', { upload: async () => ({ image_id: 'img_new' }) });
    expect(r.body.ok).toBe(true);
    expect(s.designs[0]).toMatchObject({ status: 'approved', imageId: 'img_new', printify: 'in Printify; the product is being made' });
    const t = s.tasks.find((x: any) => x.designId === 'design_9');
    expect(t).toMatchObject({ status: 'approved', focus: true, agentId: 'd1', via: 'approval' });
    expect(t.detail).toMatch(/image_id img_new/);
  });

  test('Yes on a draft made from a reference image keeps it and sends nothing to Printify', async () => {
    const s: any = { ...base, agents, designs: [d({ imageId: null, rights: 'reference', sourceFile: 'memez/drake.jpg' })], tasks: [] };
    let uploaded = 0;
    const r = await runner.decideDesign(s, 'design_9', 'approve', { upload: async () => { uploaded++; return { image_id: 'img_new' }; } });
    expect(r.body).toMatchObject({ ok: true, draft: true });
    expect(uploaded).toBe(0);
    expect(s.designs[0]).toMatchObject({ status: 'approved', imageId: null, printify: expect.stringMatching(/not listed/) });
    expect(s.tasks.some((x: any) => x.designId === 'design_9')).toBe(false);
  });

  test('No on a waiting product deletes it from Printify', async () => {
    const gone: string[] = [];
    const s: any = { ...base, agents, designs: [], tasks: [] };
    const r: any = { id: 'pub2', productId: 'prod2', shopId: 7, status: 'waiting', title: 'Dad Tee', agentId: 'd1' };
    await runner.discardProduct(s, r, { deleteProduct: async (shop: any, id: string) => { gone.push(`${shop}:${id}`); } });
    expect(gone).toEqual(['7:prod2']);
    expect(r).toMatchObject({ status: 'deleted', printify: 'product deleted from Printify' });
  });
});

describe('ads for approved products', () => {
  const withProduct = () => ({ ...base, agents: [{ id: 'agent_ads', name: 'Ads & Reach', title: 'ads' }], designs: [{ id: 'design_1', kind: 'png', title: 'fih', status: 'published', productId: 'p1', agentId: 'agent_d', agentName: 'Design', at: '2026-10-21T00:00:00Z' }], publishRequests: [{ id: 'pub_1', productId: 'p1', designId: 'design_1', title: 'fih shirt', status: 'published', priceUsd: 24, agentId: 'agent_d', agentName: 'Design', at: '2026-10-21T00:00:00Z' }], tasks: [{ id: 'task_ads', title: 'Make ads for "fih shirt"', detail: '', status: 'approved', by: 'owner', agentId: 'agent_ads', createdAt: '2026-10-21T00:00:00Z' }], skillFiles: [], agentProposals: [], progressLog: [] });

  test('an ad is saved for an approved product only, five per ask, and the owner decides', () => {
    const s: any = withProduct();
    const task = s.tasks[0];
    expect(runner.adTask(task)).toBe(true);
    expect(runner.adTask({ title: 'Research Etsy prices', detail: '' })).toBe(false);
    expect(runner.adsBrief(s, task)).toMatch(/APPROVED PRODUCTS\): "fih shirt" \(product_id p1, design design_1, \$24\)/);
    expect(runner.saveAd(s, task, { product_id: 'nope', channel: 'tiktok', headline: 'h', primary_text: 't' }, null).isError).toBe(true);
    for (let i = 0; i < 5; i++) expect(runner.saveAd(s, task, { product_id: 'p1', channel: 'tiktok', format: 'short_video', headline: `hook ${i}`, primary_text: 'text', hashtags: ['#fih', 'fishshirt'], cta: 'link in bio', script: '1. shirt\n2. fish', cost_note: '$0 organic' }, null).isError).toBe(false);
    const sixth = runner.saveAd(s, task, { product_id: 'p1', channel: 'pinterest', headline: 'h', primary_text: 't' }, null);
    expect(sixth.isError).toBe(true);
    expect(sixth.content).toMatch(/waitingOnOwner/);
    expect(s.ads).toHaveLength(5);
    expect(s.ads[0]).toMatchObject({ channel: 'tiktok', hashtags: ['fih', 'fishshirt'], designId: 'design_1', agentName: 'Ads & Reach', status: 'waiting' });
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ads-'));
    const yes = runner.decideAd(s, s.ads[0].id, 'approve', { dir });
    expect(yes.ok).toBe(true);
    expect(s.ads[0].status).toBe('approved');
    expect(fs.readFileSync(path.join(dir, `${s.ads[0].id}.md`), 'utf8')).toMatch(/## Hook\nhook 0\n/);
    expect(runner.decideAd(s, s.ads[1].id, 'reject', { dir }).ok).toBe(true);
    expect(s.ads[1].status).toBe('rejected');
    expect(runner.decideAd(s, 'ad_missing', 'reject', { dir }).status).toBe(404);
    expect(runner.adMarkdown(s.ads[0])).toMatch(/Channel: tiktok · short_video/);
  });
});

describe('the skill library handed out by role', () => {
  test('every agent gets the library skills its role fits, once; designers first', async () => {
    process.env.DEGEN_SKILLS_DIR = '/home/claude/degen-skill';
    if (!fs.existsSync('/home/claude/degen-skill/skills')) return;
    const s: any = { ...base, agents: [{ id: 'agent_d', name: 'Mockup & Design', title: 'shirt graphics' }, { id: 'agent_p', name: 'Pricing', title: 'unit economics' }, { id: 'agent_t', name: 'Trend Scout', title: 'rising meme phrases' }], skillFiles: [], tasks: [] };
    const r = await runner.distributeDegen(s);
    expect(r.errors).toEqual([]);
    expect(r.given.map((g) => g.skill)).toEqual(['design', 'brand', 'banner-design', 'design-system', 'idea-refine', 'llm-council']);
    expect(r.given[0].agents).toEqual(['Mockup & Design']);
    const file = s.skillFiles.find((f: any) => f.skillKey === 'degen_design');
    expect(file).toMatchObject({ bank: true, from: 'degen', skillName: 'Design (degen)', agentIds: ['agent_d'], status: 'new' });
    expect(file.body.length).toBeGreaterThan(1000);
    expect(s.degenGiven.degen_design).toEqual(['agent_d']);
    // a second pass gives nothing new
    const again = await runner.distributeDegen(s);
    expect(again.given).toEqual([]);
    expect(s.skillFiles.filter((f: any) => f.skillKey === 'degen_design')).toHaveLength(1);
  });
});
