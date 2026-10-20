// The agent brain: teams as lobes, agents as balls, links for handoffs and
// reporting lines, and the agents' Graph POW.
import { describe, expect, test } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { robloxHQ, sampleOffice } from '../src/model/sample';
import { buildNav } from '../src/engine/navigation';
import { createTask, emptyRuntime, syncRuntime } from '../src/engine/simulation';
import { BALL_R, brainEdges, layoutBrain } from '../src/brain/brainLayout';
import { BallIcon, ballColor, moodFor } from '../src/brain/Ball';
import { TEMPLATE_SWAPS, agentGraphPowHtml, buildAgentGraph, MAX_WORK } from '../src/brain/agentGraph';
import { layoutPow } from '../src/brain/powLayout';
import template from '../tools/graph-pow/template.html?raw';
import type { OfficeDoc, RuntimeState } from '../src/model/types';

function runtimeFor(doc: OfficeDoc): RuntimeState { const rt = emptyRuntime(); syncRuntime(doc, rt, buildNav(doc)); return rt; }

describe('agent brain layout', () => {
  test('every agent gets a spot inside its team lobe, and no two balls overlap', () => {
    for (const doc of [sampleOffice(), robloxHQ()]) {
      const L = layoutBrain(doc, null);
      expect(Object.keys(L.nodes).sort()).toEqual(Object.keys(doc.agents).sort());
      const depts = new Set(Object.values(doc.agents).map((a) => a.identity.department));
      expect(L.lobes.map((l) => l.name).sort()).toEqual([...depts].sort());
      const nodes = Object.values(L.nodes);
      for (const n of nodes) {
        const lobe = L.lobes.find((l) => l.id === n.lobeId)!;
        expect(Math.hypot(n.x - lobe.x, n.y - lobe.y)).toBeLessThanOrEqual(lobe.r);
        expect(n.x).toBeGreaterThan(0); expect(n.y).toBeGreaterThan(0);
        expect(n.x).toBeLessThan(L.width); expect(n.y).toBeLessThan(L.height);
      }
      for (let i = 0; i < nodes.length; i++) for (let j = i + 1; j < nodes.length; j++) {
        expect(Math.hypot(nodes[i].x - nodes[j].x, nodes[i].y - nodes[j].y)).toBeGreaterThan(BALL_R * 2);
      }
    }
  });

  test('lobes keep clear of each other and of the knowledge core', () => {
    const L = layoutBrain(robloxHQ(), null);
    for (const l of L.lobes) expect(Math.hypot(l.x - L.core.x, l.y - L.core.y)).toBeGreaterThan(l.r + L.core.r);
    for (let i = 0; i < L.lobes.length; i++) for (let j = i + 1; j < L.lobes.length; j++) {
      const a = L.lobes[i], b = L.lobes[j];
      expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeGreaterThan(a.r + b.r);
    }
  });

  test('the layout is deterministic and grows with the team', () => {
    const doc = sampleOffice();
    expect(layoutBrain(doc, null)).toEqual(layoutBrain(doc, null));
    const big = structuredClone(doc);
    const proto = Object.values(doc.agents)[0];
    for (let i = 0; i < 60; i++) big.agents[`clone_${i}`] = { ...structuredClone(proto), id: `clone_${i}`, identity: { ...proto.identity, name: `Clone ${i}` } };
    expect(layoutBrain(big, null).width).toBeGreaterThan(layoutBrain(doc, null).width);
  });

  test('links show reporting lines and handoffs, live while the work is moving', () => {
    const doc = sampleOffice();
    const rt = runtimeFor(doc);
    const reports = brainEdges(doc, rt).filter((e) => e.kind === 'reports');
    expect(reports.length).toBe(Object.values(doc.agents).filter((a) => a.skills.supervisorId && doc.agents[a.skills.supervisorId]).length);
    const [a, b] = Object.keys(doc.agents);
    const t = createTask(rt, { name: 'Draft the brief', agentId: b, priority: 'normal', handoff: { request: 'x', why: 'y', known: '', deliverable: 'brief', acceptance: 'ok', fromAgentId: a } });
    const hand = brainEdges(doc, rt).find((e) => e.kind === 'handoff')!;
    expect(hand).toMatchObject({ from: a, to: b, weight: 1, live: true });
    rt.tasks[t.id].status = 'done';
    expect(brainEdges(doc, rt).find((e) => e.kind === 'handoff')!.live).toBe(false);
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
