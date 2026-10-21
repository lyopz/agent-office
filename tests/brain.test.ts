// The agent brain: team regions of nerve fibres, tracts between teams, the
// information nodes the agents produced, agent balls (profile and floor
// plan), and the agents' Graph POW.
import { describe, expect, test } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { robloxHQ, sampleOffice } from '../src/model/sample';
import { buildNav } from '../src/engine/navigation';
import { createTask, emptyRuntime, syncRuntime } from '../src/engine/simulation';
import { HEIGHT, MAX_WORK_NODES, WIDTH, buildConnectome, infoNodes, infoPosition, insideRegion, teamLinks, teamOfAgent, teamsOf, tint } from '../src/brain/connectome';
import { BallIcon, ballColor, moodFor } from '../src/brain/Ball';
import { TEMPLATE_SWAPS, agentGraphPowHtml, buildAgentGraph, MAX_WORK } from '../src/brain/agentGraph';
import { layoutPow } from '../src/brain/powLayout';
import template from '../tools/graph-pow/template.html?raw';
import type { OfficeDoc, RuntimeState } from '../src/model/types';

function runtimeFor(doc: OfficeDoc): RuntimeState { const rt = emptyRuntime(); syncRuntime(doc, rt, buildNav(doc)); return rt; }

describe('agent brain (connectome)', () => {
  test('every team becomes a region in its own colour, and no agent is drawn on the brain', () => {
    for (const doc of [sampleOffice(), robloxHQ()]) {
      const teams = teamsOf(doc);
      const brain = buildConnectome(teams, teamLinks(doc, null, teams));
      expect(brain.regions.map((r) => r.name).sort()).toEqual([...new Set(Object.values(doc.agents).map((a) => a.identity.department))].sort());
      for (const r of brain.regions) {
        expect(r.color).toMatch(/^#[0-9a-f]{6}$/i);
        expect(r.x - r.rx).toBeGreaterThan(-40); expect(r.x + r.rx).toBeLessThan(WIDTH + 40);
        expect(r.y - r.ry).toBeGreaterThan(-60); expect(r.y + r.ry).toBeLessThan(HEIGHT + 60);
        // a dense tangle of fibres, all inside their region
        const mine = brain.fibers.filter((f) => f.regionId === r.id);
        expect(mine.length).toBeGreaterThan(80);
        for (const f of mine) for (let i = 0; i < f.pts.length; i += 2) expect(insideRegion(r, { x: f.pts[i], y: f.pts[i + 1] })).toBeLessThan(1.12);
      }
      // the brain has no agents in it: regions only carry ids for the menu's highlighting
      expect(JSON.stringify(brain)).not.toContain('appearance');
    }
  });

  test('nerve tracts join teams that report to or hand work to each other, thicker with more traffic', () => {
    const doc = sampleOffice();
    const rt = runtimeFor(doc);
    const teams = teamsOf(doc);
    const base = teamLinks(doc, rt, teams);
    const sup = Object.values(doc.agents).find((a) => a.skills.supervisorId && teamOfAgent(teams, a.id) !== teamOfAgent(teams, a.skills.supervisorId))!;
    const pair = [teamOfAgent(teams, sup.id)!, teamOfAgent(teams, sup.skills.supervisorId)!].sort();
    const before = base.find((l) => [l.a, l.b].sort().join() === pair.join())!;
    expect(before.weight).toBeGreaterThan(0);
    createTask(rt, { name: 'Hand over the brief', agentId: sup.skills.supervisorId!, priority: 'normal', handoff: { request: 'x', why: 'y', known: '', deliverable: 'brief', acceptance: 'ok', fromAgentId: sup.id } });
    const after = teamLinks(doc, rt, teams).find((l) => [l.a, l.b].sort().join() === pair.join())!;
    expect(after.weight).toBe(before.weight + 1);
    const brain = buildConnectome(teams, teamLinks(doc, rt, teams));
    const tract = brain.tracts.find((t) => [t.a, t.b].sort().join() === pair.join())!;
    expect(tract.curves.length).toBeGreaterThan(3);
    // every region is wired into the rest of the brain
    for (const r of brain.regions) expect(brain.tracts.some((t) => t.a === r.id || t.b === r.id)).toBe(true);
  });

  test('the same office always grows the same brain', () => {
    const doc = robloxHQ();
    const teams = teamsOf(doc);
    expect(buildConnectome(teams, teamLinks(doc, null, teams))).toEqual(buildConnectome(teams, teamLinks(doc, null, teams)));
  });

  test('finished work and knowledge become information nodes in the team that made them, and stay put', () => {
    const doc = sampleOffice();
    const rt = runtimeFor(doc);
    const teams = teamsOf(doc);
    const agentId = Object.keys(doc.agents)[0];
    const t = createTask(rt, { name: 'Ship the patch', agentId, priority: 'high' });
    Object.assign(rt.tasks[t.id], { status: 'done', completedAt: new Date().toISOString() });
    const nodes = infoNodes(doc, rt, teams);
    const work = nodes.find((n) => n.id === `t:${t.id}`)!;
    expect(work).toMatchObject({ kind: 'work', title: 'Ship the patch', regionId: teamOfAgent(teams, agentId), important: true });
    expect(nodes.filter((n) => n.kind === 'knowledge').length).toBe(Object.keys(doc.library).length);
    const brain = buildConnectome(teams, teamLinks(doc, rt, teams));
    const region = brain.regions.find((r) => r.id === work.regionId)!;
    const p = infoPosition(region, work.id);
    expect(insideRegion(region, p)).toBeLessThan(1);
    expect(infoPosition(region, work.id)).toEqual(p);
    for (let i = 0; i < MAX_WORK_NODES + 30; i++) { const x = createTask(rt, { name: `Job ${i}`, agentId, priority: 'low' }); Object.assign(rt.tasks[x.id], { status: 'done', completedAt: new Date(2030, 0, 1, 0, i).toISOString() }); }
    expect(infoNodes(doc, rt, teams).filter((n) => n.kind === 'work').length).toBe(MAX_WORK_NODES);
  });

  test('tint shifts hue and keeps a valid colour', () => {
    expect(tint('#ff0000', 120)).toBe('#00ff00');
    expect(tint('#336699', 0)).toBe('#336699');
    expect(tint('not-a-colour', 30)).toBe('not-a-colour');
  });
});

describe('agent balls', () => {
  test('ball colours are lifted so dark outfits still give a bright ball with a readable face', () => {
    const lum = (hex: string) => { const n = parseInt(hex.slice(1), 16); return (((n >> 16) & 255) * 0.299 + ((n >> 8) & 255) * 0.587 + (n & 255) * 0.114) / 255; };
    for (const a of Object.values(robloxHQ().agents)) expect(lum(ballColor(a.appearance)), a.identity.name).toBeGreaterThan(0.38);
    expect(ballColor({ ...sampleOffice().agents.agent_rusty.appearance, topColor: '#ff0000' })).toBe('#ff3333');
  });

  test('the face follows what the agent is doing', () => {
    expect(moodFor('working')).toBe('focused');
    expect(moodFor('paused')).toBe('sleepy');
    expect(moodFor('error')).toBe('worried');
    expect(moodFor('idle', 'grin')).toBe('grin');
    const a = sampleOffice().agents.agent_rusty.appearance;
    const faces = new Set((['idle', 'working', 'thinking', 'communicating', 'error', 'paused'] as const).map((s) => renderToStaticMarkup(createElement(BallIcon, { a, mood: moodFor(s) }))));
    expect(faces.size).toBe(6);
  });

  test('balls are drawn in the agent’s own colour and tuft colour, and differ between agents', () => {
    const doc = sampleOffice();
    const [x, y] = Object.values(doc.agents);
    const draw = (id: string) => renderToStaticMarkup(createElement(BallIcon, { a: doc.agents[id].appearance }));
    expect(draw(x.id)).toContain(ballColor(x.appearance));
    expect(draw(x.id)).not.toBe(draw(y.id));
    const plain = renderToStaticMarkup(createElement(BallIcon, { a: { ...x.appearance, hairStyle: 'bald' } }));
    expect(renderToStaticMarkup(createElement(BallIcon, { a: { ...x.appearance, hairStyle: 'spiky', hairColor: '#123456' } }))).toContain('#123456');
    expect(plain).not.toContain('#123456');
  });
});

describe('agent Graph POW', () => {
  test('agents, finished work and knowledge become linked nodes', () => {
    const doc = sampleOffice();
    const rt = runtimeFor(doc);
    const [a, b] = Object.keys(doc.agents);
    const t = createTask(rt, { name: 'Ship the patch', agentId: b, priority: 'high', handoff: { request: 'x', why: 'y', known: '', deliverable: 'A patched build', acceptance: 'ok', fromAgentId: a } });
    Object.assign(rt.tasks[t.id], { status: 'done', completedAt: new Date().toISOString() });
    const g = buildAgentGraph(doc, rt);
    expect(g.files.filter((f) => f.kind === 'agent').length).toBe(Object.keys(doc.agents).length);
    const work = g.files.find((f) => f.kind === 'work')!;
    expect(work).toMatchObject({ name: 'Ship the patch', agentId: b, purpose: 'A patched build' });
    const owner = g.files.find((f) => f.kind === 'agent' && f.agentId === b)!;
    expect(g.links.some((l) => l.s === owner.id && l.t === work.id && l.kinds.made)).toBe(true);
    expect(g.links.some((l) => l.kinds.handoff && l.t === owner.id)).toBe(true);
    expect(g.files.filter((f) => f.kind === 'knowledge').length).toBe(Object.keys(doc.library).length);
    // ids are unique and every link points at a node
    expect(new Set(g.files.map((f) => f.id)).size).toBe(g.files.length);
    const ids = new Set(g.files.map((f) => f.id));
    expect(g.links.every((l) => ids.has(l.s) && ids.has(l.t))).toBe(true);
    // degrees match the links
    for (const f of g.files) expect(f.degree).toBe(new Set(g.links.filter((l) => l.s === f.id || l.t === f.id).map((l) => (l.s === f.id ? l.t : l.s))).size);
    // every node has a position on the map
    const L = layoutPow(g);
    expect(Object.keys(L.pos).sort()).toEqual([...ids].sort());
  });

  test('finished work is capped so a long-running office stays readable', () => {
    const doc = sampleOffice();
    const rt = runtimeFor(doc);
    const id = Object.keys(doc.agents)[0];
    for (let i = 0; i < MAX_WORK + 40; i++) { const t = createTask(rt, { name: `Job ${i}`, agentId: id, priority: 'low' }); Object.assign(rt.tasks[t.id], { status: 'done', completedAt: new Date(2026, 0, 1, 0, i).toISOString() }); }
    const g = buildAgentGraph(doc, rt);
    expect(g.files.filter((f) => f.kind === 'work').length).toBe(MAX_WORK);
    expect(g.files.some((f) => f.name === `Job ${MAX_WORK + 39}`)).toBe(true); // newest kept
  });

  test('the standalone page uses the agent wording, and agent text cannot break out of the data block', () => {
    for (const [from] of TEMPLATE_SWAPS) expect(template.split(from).length - 1, from.slice(0, 60)).toBe(1);
    const doc = structuredClone(sampleOffice());
    const evil = Object.keys(doc.agents)[0];
    doc.agents[evil].identity.name = '</script><script>alert(1)</script>';
    const html = agentGraphPowHtml(buildAgentGraph(doc, runtimeFor(doc)));
    expect(html).not.toContain('<script>alert(1)');
    expect(html).toContain('Find an agent, task or knowledge');
    expect(html).not.toContain('__GRAPH_DATA__');
    const json = /<script id="graph-data" type="application\/json">([\s\S]*?)<\/script>/.exec(html)![1];
    expect(JSON.parse(json).files.some((f: { name: string }) => f.name.includes('alert(1)'))).toBe(true);
  });
});
