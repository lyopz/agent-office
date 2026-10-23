// JARVIS's runner and the brains it oversees: every brain's agents and tasks, layouts that wait for
// the owner's Yes, and a daily look at how one brain could grow.
import { beforeAll, describe, expect, test } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as brains from '../server/brains.mjs';

let runner: typeof import('../server/origin-runner.mjs');
let file: string;
const write = (state: object) => fs.writeFileSync(file, JSON.stringify(state));
const read = () => JSON.parse(fs.readFileSync(file, 'utf8'));
beforeAll(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'brains-'));
  file = path.join(dir, 'state.json');
  process.env.ORIGIN_MONTHLY_CAP_USD = '15';
  process.env.ORIGIN_DATA_DIR = dir;
  runner = await import('../server/origin-runner.mjs');
});
const month = new Date().toISOString().slice(0, 7);
const base = { instructions: 'x'.repeat(200), memory: '', nextAction: '', tasks: [], skillFiles: [], agentProposals: [], ledger: { month, spentUsd: 0, unknownCostRuns: 0 }, runs: [], lastScheduledAt: null };
const agent = (id: string, name: string, extra = {}) => ({ id, name, title: name, kind: 'skill', prompt: `${name} prompt`, ...extra });

describe('brains: JARVIS oversees every brain', () => {
  test("a check-in brings every brain's agents; open work follows an agent that moved to another brain; a deleted brain is dropped", () => {
    const s: any = { ...base, brainId: 'head', brains: { gone: { name: 'Old' } }, tasks: [
      { id: 't1', title: 'Scout memes', status: 'approved', agentId: 'a_scout', brainId: 'head' },
      { id: 't2', title: 'Old done', status: 'done', agentId: 'a_scout', brainId: 'head' },
    ] };
    s.brainId = 'head';
    brains.syncBrains(s, { brainName: 'The Brain', head: true, agents: [agent('v_music', 'Beat Lab')],
      brains: [{ id: 'store', name: 'Meme Tee Store', lead: 'jarvis', purpose: 'Etsy shirts', agents: [agent('agent_origin', 'JARVIS'), agent('v_store', 'Meme Tee Store'), agent('a_scout', 'Meme Scout')] }] });
    expect(s.agents.map((a: any) => `${a.id}@${a.brainId}`)).toEqual(['v_music@head', 'v_store@store', 'a_scout@store']);
    expect(s.brains.head).toMatchObject({ head: true, name: 'The Brain' });
    expect(s.brains.store).toMatchObject({ head: false, lead: 'jarvis', purpose: 'Etsy shirts' });
    expect(s.brains.gone).toBeUndefined();
    expect(s.tasks[0].brainId).toBe('store');
    expect(s.tasks[1].brainId).toBe('head'); // finished work stays where it was done
    expect(brains.headBrainId(s)).toBe('head');
    // the store's task runs while the head brain is open
    expect(runner.nextTask(s)).toMatchObject({ id: 't1' });
    expect(brains.brainsBrief(s)).toMatch(/\[head\] The Brain \(YOUR HEAD BRAIN/);
    expect(brains.brainsBrief(s)).toMatch(/Meme Tee Store: Etsy shirts\. Run by you \(JARVIS\) until the owner hooks up another agent\. 2 agents, 1 open tasks/);
  });

  test("a brain's own task is worked as its lead once the owner hooked one up", () => {
    const s: any = { ...base, brainId: 'head', brains: { store: { name: 'Store', lead: 'v_store' } }, agents: [agent('v_store', 'Meme Tee Store', { brainId: 'store' })] };
    expect(brains.leadOf(s, { brainId: 'store' })).toMatchObject({ id: 'v_store' });
    s.brains.store.lead = 'jarvis';
    expect(brains.leadOf(s, { brainId: 'store' })).toBeNull();
  });

  test('build a brain: the owner asks, JARVIS designs it in a run, and the layout waits for the Yes', async () => {
    write({ ...base, brainId: 'head', brains: { head: { name: 'The Brain', head: true } } });
    const [code, out] = await runner.brainsAction({ action: 'plan', ask: 'a mug store for dog owners' }, { file });
    expect(code).toBe(200);
    expect(out.task).toMatchObject({ kind: 'brain-plan', status: 'approved', focus: true, brainId: 'head' });
    const plan = { name: 'Mug Shop', purpose: 'Dog mugs.', research: ['dog mug trends'], reason: 'Mugs sell.',
      agents: [{ name: 'Mug Researcher', specialty: 'Research', skill: 'Research', purpose: 'Find what sells', degenSkills: ['idea-refine', 'NOT A SKILL'] }],
      firstTasks: [{ title: 'Find 5 themes', detail: 'with evidence', agent: 'Mug Researcher' }] };
    let brief = '';
    const fetch = async (_u: string, init: any) => { brief = JSON.parse(init.body).messages[0].content; return { ok: true, status: 200, json: async () => ({ content: [{ type: 'text', text: '```json\n' + JSON.stringify({ memory: 'm', summary: 's', brainPlan: plan }) + '\n```' }], usage: { input_tokens: 10, output_tokens: 5 }, stop_reason: 'end_turn' }) }; };
    const r = await runner.runOnce('focus', { fetch, file, key: 'test' } as any);
    expect(r.ok).toBe(true);
    expect(brief).toMatch(/BUILD A BRAIN \(the owner asked for it\): design a new brain for: a mug store for dog owners/);
    const s = read();
    expect(s.tasks[0].status).toBe('done');
    expect(s.brainProposals).toHaveLength(1);
    expect(s.brainProposals[0]).toMatchObject({ kind: 'new', name: 'Mug Shop', status: 'proposed', agents: [{ name: 'Mug Researcher', degenSkills: ['idea-refine'] }] });
    // nothing was built: no agent, no task for the new brain yet
    expect(s.tasks).toHaveLength(1);

    // the owner says Yes: the app built the brain and says where; its first task is queued there
    const [c2, o2] = await runner.brainsAction({ action: 'approve', id: s.brainProposals[0].id, brainId: 'b_mug', agentIds: { 'mug shop': 'v_mug', 'mug researcher': 'a_mug' } }, { file });
    expect(c2).toBe(200);
    expect(o2.ok).toBe(true);
    const s2 = read();
    expect(s2.brainProposals[0]).toMatchObject({ status: 'approved', brainId: 'b_mug' });
    expect(s2.tasks.find((t: any) => t.via === 'brain-plan')).toMatchObject({ title: 'Mug Researcher: Find 5 themes', agentId: 'a_mug', brainId: 'b_mug', status: 'approved' });
    expect(s2.brains.b_mug.agents.map((a: any) => a.id)).toEqual(['a_mug']);
    // the library skill it named is handed to that agent in the new brain (when the library is readable here)
    const given = s2.skillFiles.find((f: any) => f.skillKey === 'degen_idea_refine');
    if (given) expect(given).toMatchObject({ brainId: 'b_mug', agentIds: ['a_mug'] }); else expect(o2.errors.join(' ')).toMatch(/idea-refine/);
    // a decided layout can't be decided again
    expect((await runner.brainsAction({ action: 'reject', id: s.brainProposals[0].id }, { file }))[0]).toBe(409);
  });

  test('once a day per brain JARVIS researches how one brain could grow; the change waits for the Yes', () => {
    const now = Date.parse('2026-10-23T12:00:00Z');
    const s: any = { ...base, tasks: [], brains: { head: { name: 'The Brain', head: true }, store: { name: 'Store', evolvedAt: '2026-10-23T00:00:00Z' }, mug: { name: 'Mug Shop' } } };
    const t = brains.queueEvolve(s, { approve: true, now });
    expect(t).toMatchObject({ kind: 'brain-evolve', brainId: 'mug', status: 'approved', by: 'origin' });
    expect(brains.queueEvolve(s, { approve: true, now })).toBeNull(); // one at a time
    t!.status = 'done';
    expect(brains.queueEvolve(s, { approve: true, now })).toBeNull(); // the store was looked at 12 hours ago, the head never is
    expect(brains.queueEvolve(s, { approve: false, now: now + 13 * 3_600_000 })).toMatchObject({ brainId: 'store', status: 'proposed' });

    const task = { id: 'tx', kind: 'brain-evolve', brainId: 'mug', status: 'approved' };
    s.agents = [agent('v_mug', 'Mug Shop', { brainId: 'mug', kind: 'venture' })];
    expect(brains.brainTaskBrief(s, task, { skills: [{ name: 'idea-refine' }] })).toMatch(/EVOLVE THE "Mug Shop" BRAIN[\s\S]*idea-refine/);
    // nothing worth changing: no proposal, but the research list and note are kept
    expect(brains.takeBrainOutput(s, task, { brainChange: { note: 'all good', research: ['prices'] } })).toBeNull();
    expect(s.brains.mug).toMatchObject({ research: ['prices'], lastNote: 'all good' });
    const p = brains.takeBrainOutput(s, task, { brainChange: { note: 'ads would help', addAgents: [{ name: 'Mug Ads', skill: 'Advertising' }], addDegenSkills: [{ skill: 'brand', agents: ['Mug Shop'] }] } });
    expect(p).toMatchObject({ kind: 'change', brainId: 'mug', addAgents: [{ name: 'Mug Ads' }], addDegenSkills: [{ skill: 'brand', agents: ['Mug Shop'] }] });
    expect(task.status).toBe('done');
    expect(brains.brainsPublic(s).others.find((b: any) => b.id === 'mug')).toMatchObject({ lastNote: 'ads would help' });
  });

  test('an owner can ask for a growth review of one brain now', async () => {
    write({ ...base, brainId: 'head', brains: { head: { name: 'The Brain', head: true }, store: { name: 'Store', evolvedAt: new Date().toISOString() } } });
    const [code, out] = await runner.brainsAction({ action: 'evolve', brainId: 'store' }, { file });
    expect(code).toBe(200);
    expect(out.task).toMatchObject({ kind: 'brain-evolve', brainId: 'store', status: 'approved', by: 'owner' });
    expect((await runner.brainsAction({ action: 'evolve', brainId: 'head' }, { file }))[0]).toBe(409);
  });
});
