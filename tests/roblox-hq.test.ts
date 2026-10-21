// Roblox development headquarters: the team rooms, the throne room at the
// centre and the owner's profile.
import { describe, expect, test } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ROBLOX_HQ_ROOMS, robloxHQ, sampleOffice } from '../src/model/sample';
import { validate } from '../src/engine/validate';
import { buildNav, reachableRooms, roomSpot } from '../src/engine/navigation';
import { applyOps } from '../src/engine/ops';
import { parseOffice, exportOffice } from '../src/model/schema';
import { builtinRoomTemplates } from '../src/model/defaults';
import { FURNITURE_META, ROOM_META } from '../src/model/catalog';
import { ARCHETYPE } from '../src/model/cosmetics';
import type { FurnitureType, RoomType } from '../src/model/types';
import { FurnitureShape } from '../src/viewport/OfficeLayers';
import { interpret } from '../src/ai/parser';

const R = ROBLOX_HQ_ROOMS;
const typesIn = (doc: ReturnType<typeof robloxHQ>, roomId: string) => new Set(Object.values(doc.furniture).filter((f) => f.roomId === roomId).map((f) => f.type));

describe('Roblox headquarters layout', () => {
  const doc = robloxHQ();

  test('builds with a throne room and seven team rooms, all reachable on foot, and no validation errors', () => {
    expect(Object.keys(doc.rooms).sort()).toEqual(Object.values(R).sort());
    expect(doc.settings.layoutPreset).toBe('bubble');
    expect(Object.values(doc.corridors).every((c) => c.status === 'ok')).toBe(true);
    expect(validate(doc).filter((i) => i.severity === 'error')).toEqual([]);
    expect(validate(doc).filter((i) => i.code === 'unreachable-room' || i.code === 'door-blocked')).toEqual([]);
    const nav = buildNav(doc);
    for (const from of Object.values(doc.rooms)) {
      const reach = reachableRooms(nav, roomSpot(nav, from)!);
      for (const to of Object.values(doc.rooms)) expect(reach.has(to.id), `${from.name} → ${to.name}`).toBe(true);
    }
  });

  test('every room has two ways in, so closing one tube never cuts a room off', () => {
    for (const c of Object.values(doc.corridors)) {
      const d = applyOps(doc, [{ op: 'corridor.update', id: c.id, patch: { blocked: true } }]).doc;
      const nav = buildNav(d);
      const reach = reachableRooms(nav, roomSpot(nav, d.rooms[R.throne])!);
      expect(Object.keys(d.rooms).every((id) => reach.has(id)), `blocking ${c.name}`).toBe(true);
    }
  });

  test('the throne room is central: its centre is the closest to the middle of the layout', () => {
    const rooms = Object.values(doc.rooms);
    const x0 = Math.min(...rooms.map((r) => r.x)), x1 = Math.max(...rooms.map((r) => r.x + r.w));
    const y0 = Math.min(...rooms.map((r) => r.y)), y1 = Math.max(...rooms.map((r) => r.y + r.h));
    const mid = { x: (x0 + x1) / 2, y: (y0 + y1) / 2 };
    const dist = (r: (typeof rooms)[number]) => Math.hypot(r.x + r.w / 2 - mid.x, r.y + r.h / 2 - mid.y);
    const nearest = rooms.slice().sort((a, b) => dist(a) - dist(b))[0];
    expect(nearest.id).toBe(R.throne);
    expect(dist(nearest)).toBeLessThan(1);
    // and it is the hub: more tubes meet there than at any other room
    const ends = (id: string) => Object.values(doc.corridors).filter((c) => (c.start.kind === 'door' && c.start.roomId === id) || (c.end.kind === 'door' && c.end.roomId === id)).length;
    for (const r of rooms) if (r.id !== R.throne) expect(ends(R.throne)).toBeGreaterThan(ends(r.id));
  });

  test("each team room carries the furniture that shows what the team does", () => {
    const want: Record<string, FurnitureType[]> = {
      [R.dev]: ['studio-workstation', 'build-preview', 'code-wall', 'test-station'],
      [R.research]: ['evidence-board', 'reference-stack', 'note-wall', 'archive-terminal'],
      [R.design]: ['level-layout-table', 'mechanics-board', 'prototype-pod', 'planning-desk'],
      [R.modeling]: ['blueprint-wall', 'wireframe-stand', 'material-swatches', 'preview-turntable', 'workstation-3d'],
      [R.type]: ['font-specimen-wall', 'type-scale-panel', 'lettering-desk', 'game-ui-preview'],
      [R.build]: ['modular-parts-rack', 'terrain-table', 'scale-figure', 'build-plan-board'],
      [R.ads]: ['campaign-board', 'concept-review-wall', 'image-draft-gallery', 'final-asset-display'],
      [R.throne]: ['throne', 'devil-bubble', 'war-table', 'command-display', 'dark-candelabra'],
    };
    for (const [roomId, types] of Object.entries(want)) {
      const have = typesIn(doc, roomId);
      for (const t of types) expect(have.has(t), `${doc.rooms[roomId].name} has ${t}`).toBe(true);
      // clear signage: every room has a labelled team sign
      expect(Object.values(doc.furniture).some((f) => f.roomId === roomId && f.type === 'team-sign' && f.label)).toBe(true);
    }
  });

  test('the throne sits inside the glowing bubble', () => {
    const fur = Object.values(doc.furniture).filter((f) => f.roomId === R.throne);
    const bubble = fur.find((f) => f.type === 'devil-bubble')!, throne = fur.find((f) => f.type === 'throne')!;
    expect(throne.x).toBeGreaterThan(bubble.x); expect(throne.y).toBeGreaterThan(bubble.y);
    expect(throne.x + throne.w).toBeLessThan(bubble.x + bubble.w); expect(throne.y + throne.h).toBeLessThan(bubble.y + bubble.h);
    expect(bubble.blocking).toBe(false); // a force field, not a wall: agents and the owner can walk up to the throne
  });

  test('every team has agents seated at workstations in their own room', () => {
    for (const roomId of Object.values(R)) {
      const seated = Object.values(doc.furniture).filter((f) => f.roomId === roomId && f.workstation?.assignedAgentId);
      expect(seated.length, doc.rooms[roomId].name).toBeGreaterThan(0);
      for (const f of seated) expect(doc.agents[f.workstation!.assignedAgentId!].schedule.assignedRoomId).toBe(roomId);
    }
    expect(Object.keys(doc.projects).length).toBeGreaterThanOrEqual(2);
  });

  test('survives export and import unchanged, and the classic sample still builds the same way', () => {
    const back = parseOffice(JSON.parse(exportOffice(doc)));
    expect(back.ok).toBe(true);
    if (back.ok) expect(Object.keys(back.doc.furniture).sort()).toEqual(Object.keys(doc.furniture).sort());
    const classic = sampleOffice();
    expect(classic.rooms.room_ops).toBeDefined();
    expect(Object.values(classic.rooms).some((r) => r.type === 'throne-room')).toBe(false);
  });
});

describe('team room catalogue', () => {
  const NEW_TYPES: RoomType[] = ['roblox-dev', 'game-design', '3d-design', 'typography', 'roblox-build', 'ad-studio', 'throne-room'];
  test('each new room type has a label, accent, distinct look and a built-in template with a preset', () => {
    const accents = new Set(NEW_TYPES.map((t) => ROOM_META[t].accent));
    expect(accents.size).toBe(NEW_TYPES.length);
    const tpls = builtinRoomTemplates();
    for (const t of NEW_TYPES) {
      const tpl = tpls.find((x) => x.type === t)!;
      expect(tpl, t).toBeDefined();
      expect(tpl.furniture.length, t).toBeGreaterThanOrEqual(4);
      expect(tpl.appearance.floorColor, t).toBeTruthy();
    }
  });

  test('new archetypes work in their own rooms', () => {
    const tpls = builtinRoomTemplates();
    for (const id of ['game-designer', 'type-designer', 'roblox-builder', 'ad-creative']) {
      const t = ARCHETYPE[id];
      expect(NEW_TYPES).toContain(t.roomType);
      // their room's preset already has free desks of the kind they use
      const desks = tpls.find((x) => x.type === t.roomType)!.furniture.filter((f) => f.type === t.workstation && f.workstation);
      expect(desks.length, id).toBeGreaterThanOrEqual(2);
    }
  });

  test('the AI console understands the new room names', () => {
    const doc = robloxHQ();
    const plan = interpret('add a plant to the throne room', { doc, selection: { kind: 'none' }, idleAgentIds: [] });
    expect(JSON.stringify(plan)).toContain(R.throne);
  });

  test('older saves (v6) gain the new room templates', () => {
    const v6 = JSON.parse(exportOffice(sampleOffice())).office ?? JSON.parse(exportOffice(sampleOffice()));
    v6.schemaVersion = 6;
    delete v6.player;
    v6.roomTemplates = v6.roomTemplates.filter((t: { type: string }) => !NEW_TYPES.includes(t.type as RoomType));
    const m = parseOffice(v6);
    expect(m.ok).toBe(true);
    if (m.ok) for (const t of NEW_TYPES) expect(m.doc.roomTemplates.some((x) => x.type === t), t).toBe(true);
  });

  test('every new object draws something in 2D', () => {
    const fresh = Object.keys(FURNITURE_META).slice(Object.keys(FURNITURE_META).indexOf('team-sign')) as FurnitureType[];
    expect(fresh.length).toBeGreaterThanOrEqual(30);
    for (const type of fresh) {
      const m = FURNITURE_META[type];
      const svg = renderToStaticMarkup(createElement('svg', null, createElement(FurnitureShape, { f: { id: 'x', type, color: m.color, label: 'TEAM' }, x: 0, y: 0, w: m.w, h: m.h })));
      expect((svg.match(/<(rect|circle|path|ellipse|line|text)/g) ?? []).length, type).toBeGreaterThan(2);
    }
  });
});

describe('owner avatar', () => {
  test('player.update edits the avatar and refuses an empty name', () => {
    const doc = robloxHQ();
    const r = applyOps(doc, [{ op: 'player.update', patch: { name: 'Queen Vex', appearance: { hairStyle: 'twin-buns', expression: 'grin', bodyStyle: 'chibi', cheeks: 'blush' } } }]);
    expect(r.errors).toEqual([]);
    expect(r.doc.player.name).toBe('Queen Vex');
    expect(r.doc.player.appearance.hairStyle).toBe('twin-buns');
    expect(r.doc.player.appearance.expression).toBe('grin');
    expect(r.doc.player.appearance.top).toBe(doc.player.appearance.top); // a patch only changes what it names
    const bad = applyOps(r.doc, [{ op: 'player.update', patch: { name: '   ' } }]);
    expect(bad.errors.length).toBeGreaterThan(0);
    expect(bad.doc.player.name).toBe('Queen Vex');
  });
});

