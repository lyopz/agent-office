// 3D headquarters: pure layout, collision, travel and character logic (no WebGL needed).
import { sampleOffice } from '../src/model/sample';
import { applyOps } from '../src/engine/ops';
import { buildNav, canStep } from '../src/engine/navigation';
import { key } from '../src/engine/geometry';
import type { OfficeDoc, Room } from '../src/model/types';
import { BODY_STYLES, HAIR_STYLES_3D, EXPRESSIONS } from '../src/model/types';
import { DEFAULT_APPEARANCE, withAppearance } from '../src/model/defaults';
import { bandCentreOffset, describeScene, describeTube, roomAtWorld, roomTheme, spawnPoint, spawnRoom, throneRoom, tubeSize, wallSegments } from '../src/hq3d/layout';
import { cellOf, inTube, isPosValid, moveWithCollision, nearestWalkableWorld } from '../src/hq3d/collision';
import { fastTravelRoute, glideSpeed, sampleRoute } from '../src/hq3d/travel';
import { BODY_STYLE_TABLE, bodyDims, headRatio } from '../src/hq3d/proportions';
import { animateCharacter, buildCharacter, getRig, poseForStatus } from '../src/hq3d/character3d';
import { PlayerController, inputFromKeys } from '../src/hq3d/controls';

const roomByType = (d: OfficeDoc, t: string) => Object.values(d.rooms).find((r) => (r.type as string) === t)!;

describe('scene description', () => {
  const doc = sampleOffice();
  const scene = describeScene(doc);

  test('one descriptor per room and per corridor, with a bubble shell for the bubble preset', () => {
    expect(scene.bubble).toBe(true);
    expect(scene.rooms).toHaveLength(Object.keys(doc.rooms).length);
    expect(scene.tubes).toHaveLength(Object.keys(doc.corridors).length);
    for (const r of scene.rooms) {
      expect(r.dome).not.toBeNull();
      // the shell contains every corner of the room
      const { a, b } = r.dome!;
      expect((r.w / 2 / a) ** 6 + (r.d / 2 / b) ** 6).toBeLessThan(1);
      expect(r.sign.y).toBeGreaterThan(r.dome!.height);
      expect(r.name.length).toBeGreaterThan(0);
      expect(r.team.length).toBeGreaterThan(0);
    }
  });

  test('tubes are at least as wide as the corridor, start and end at doorways, and stay orthogonal', () => {
    for (const c of Object.values(doc.corridors)) {
      const t = describeTube(doc, c)!;
      expect(t.floorWidth).toBeGreaterThanOrEqual(c.width);
      expect(t.radius * 2).toBeGreaterThan(1.6 + 0.4); // a 1.6-unit character fits with headroom
      for (let i = 1; i < t.points.length; i++) {
        const a = t.points[i - 1], b = t.points[i];
        expect(Math.abs(a.x - b.x) < 1e-6 || Math.abs(a.z - b.z) < 1e-6).toBe(true);
      }
      for (const [end, ep] of [[t.ends[0], c.start], [t.ends[1], c.end]] as const) {
        if (ep.kind !== 'door') continue;
        const room = doc.rooms[ep.roomId]; const door = room.doors.find((d) => d.id === ep.doorId)!;
        const onWall = door.side === 'n' ? end.z === room.y : door.side === 's' ? end.z === room.y + room.h : door.side === 'w' ? end.x === room.x : end.x === room.x + room.w;
        expect(onWall).toBe(true);
        expect(end.label).toBe(room.name);
      }
    }
  });

  test('tube cross-section and band centre', () => {
    expect(tubeSize(2).floorWidth).toBeGreaterThanOrEqual(2);
    expect(tubeSize(3).floorWidth).toBeGreaterThanOrEqual(3);
    expect(bandCentreOffset(2)).toBe(1);
    expect(bandCentreOffset(3)).toBe(0.5);
  });

  test('grid preset: walls with gaps exactly where the doors are', () => {
    const s = describeScene(applyOps(doc, [{ op: 'settings.update', patch: { layoutPreset: 'grid' } }]).doc);
    for (const r of Object.values(doc.rooms)) {
      const segs = wallSegments(r);
      const total = segs.reduce((n, w) => n + Math.hypot(w.x2 - w.x1, w.z2 - w.z1), 0);
      expect(total).toBeCloseTo(2 * (r.w + r.h) - r.doors.reduce((n, d) => n + d.width, 0), 5);
    }
    expect(s.rooms.every((r) => !r.dome && r.walls.length > 0)).toBe(true);
  });

  test('room themes come from type, name and purpose', () => {
    expect(roomTheme({ type: 'royal-lounge', name: 'x', purpose: '' })).toBe('royal');
    expect(roomTheme({ type: 'throne-room' as never, name: 'x', purpose: '' })).toBe('royal');
    expect(roomTheme({ type: 'roblox-dev' as never, name: 'x', purpose: '' })).toBe('dev');
    expect(roomTheme({ type: 'typography' as never, name: 'x', purpose: '' })).toBe('type');
    expect(roomTheme({ type: 'roblox-build' as never, name: 'x', purpose: '' })).toBe('building');
    expect(roomTheme({ type: 'ad-studio' as never, name: 'x', purpose: '' })).toBe('ads');
    expect(roomTheme({ type: '3d-design' as never, name: 'x', purpose: '' })).toBe('model3d');
    expect(roomTheme({ type: 'game-design' as never, name: 'x', purpose: '' })).toBe('gamedesign');
    expect(roomTheme({ type: 'custom', name: 'Typography and Fonts', purpose: '' })).toBe('type');
    expect(roomTheme({ type: 'custom', name: 'Campaign studio', purpose: 'Advertising and creative images' })).toBe('ads');
    expect(roomTheme({ type: 'custom', name: 'Hall', purpose: '' }, ['throne'])).toBe('royal');
  });
});

describe('collision against the navigation grid', () => {
  const doc = sampleOffice();
  const nav = buildNav(doc);
  const room = roomByType(doc, 'research');

  test('walking into a wall without a door keeps you inside the room and slides along it', () => {
    // west wall of the research lab has no door
    const start = { x: room.x + 1.5, z: room.y + room.h / 2 };
    const r = moveWithCollision(nav, start, -5, 0);
    expect(r.blocked).toBe(true);
    expect(roomAtWorld(doc, r.x, r.z)?.id).toBe(room.id);
    expect(r.x).toBeGreaterThan(room.x);
    const slide = moveWithCollision(nav, start, -5, 1);
    expect(slide.z).toBeGreaterThan(start.z + 0.5); // kept the along-wall component
  });

  test('every position visited is legal and never crosses a region except through a door', () => {
    let p = { x: room.x + room.w / 2, z: room.y + room.h / 2 };
    for (let i = 0; i < 400; i++) {
      const a = (i * 2.399) % (Math.PI * 2);
      const q = moveWithCollision(nav, p, Math.cos(a) * 0.4, Math.sin(a) * 0.4);
      const from = cellOf(p.x, p.z), to = cellOf(q.x, q.z);
      if (from.x !== to.x || from.y !== to.y) {
        const ok = Math.abs(from.x - to.x) + Math.abs(from.y - to.y) === 1 ? canStep(nav, from, to) : true;
        expect(ok).toBe(true);
      }
      expect(nav.walkable.has(key(to.x, to.y))).toBe(true);
      p = q;
    }
  });

  test('a door lets you out into the tube', () => {
    const door = room.doors.find((d) => d.side === 'e')!;
    const z = room.y + door.offset + door.width / 2;
    let p = { x: room.x + room.w - 1.5, z };
    for (let i = 0; i < 20; i++) p = moveWithCollision(nav, p, 0.25, 0);
    expect(inTube(nav, p)).toBe(true);
    expect(isPosValid(nav, cellOf(p.x, p.z), p.x, p.z)).toBe(true);
  });

  test('nearest walkable cell rescues a position inside furniture', () => {
    const f = Object.values(doc.furniture).find((x) => x.blocking && doc.rooms[x.roomId])!;
    const r = doc.rooms[f.roomId];
    const p = nearestWalkableWorld(nav, { x: r.x + f.x + 0.5, z: r.y + f.y + 0.5 })!;
    expect(nav.walkable.has(key(Math.floor(p.x), Math.floor(p.z)))).toBe(true);
  });
});

describe('spawn and fast travel', () => {
  test('spawn prefers the last room, then the throne room, then the first room', () => {
    const doc = sampleOffice();
    expect(spawnRoom(doc)?.id).toBe(throneRoom(doc)?.id);
    expect(throneRoom(doc)?.type).toBe('royal-lounge');
    const lib = roomByType(doc, 'library');
    const visited = applyOps(doc, [{ op: 'player.update', patch: { lastRoomId: lib.id } }]).doc;
    expect(spawnRoom(visited)?.id).toBe(lib.id);
    const throneRoomDoc: OfficeDoc = { ...doc, rooms: { ...doc.rooms, x: { ...lib, id: 'x', type: 'throne-room' as Room['type'] } } };
    expect(throneRoom(throneRoomDoc)?.id).toBe('x');
    const empty = { ...doc, rooms: {} };
    expect(spawnRoom(empty)).toBeNull();
  });

  test('the avatar spawns on a walkable cell in front of the throne', () => {
    const doc = sampleOffice();
    const nav = buildNav(doc);
    const s = spawnPoint(doc, nav);
    expect(s.roomId).toBe(throneRoom(doc)!.id);
    expect(nav.walkable.has(key(Math.floor(s.pos.x), Math.floor(s.pos.z)))).toBe(true);
  });

  test('fast travel routes through the tubes to every room without getting stuck', () => {
    const doc = sampleOffice();
    const nav = buildNav(doc);
    const from = spawnPoint(doc, nav).pos;
    for (const r of Object.values(doc.rooms)) {
      const route = fastTravelRoute(doc, nav, from, r.id);
      expect(route, r.name).not.toBeNull();
      expect(roomAtWorld(doc, route!.target.x, route!.target.z)?.id).toBe(r.id);
      if (r.id !== spawnPoint(doc, nav).roomId) expect(route!.viaTubes).toBe(true);
      const end = sampleRoute(route!.points, route!.length + 1);
      expect(end.done).toBe(true);
      expect(end.p.x).toBeCloseTo(route!.target.x); expect(end.p.z).toBeCloseTo(route!.target.z);
      expect(route!.length / glideSpeed(route!.length)).toBeLessThan(4);
    }
  });

  test('the controller glides along a route, or cuts straight there with reduced motion', () => {
    const doc = sampleOffice();
    const nav = buildNav(doc);
    const lib = roomByType(doc, 'library');
    const sp = spawnPoint(doc, nav);
    const route = fastTravelRoute(doc, nav, sp.pos, lib.id)!;
    const c = new PlayerController(sp.pos, 'third');
    let done = false;
    c.startGlide(route, false, () => { done = true; });
    for (let i = 0; i < 400 && !done; i++) c.update(1 / 30, nav, inputFromKeys(new Set()));
    expect(done).toBe(true);
    expect(roomAtWorld(doc, c.pos.x, c.pos.z)?.id).toBe(lib.id);
    const cut = new PlayerController(sp.pos, 'first');
    let cutDone = false;
    cut.startGlide(route, true, () => { cutDone = true; });
    expect(cutDone).toBe(true);
    expect(cut.pos).toEqual(route.target);
  });

  test('walking with keys moves the avatar and Shift runs faster', () => {
    const doc = sampleOffice();
    const nav = buildNav(doc);
    const sp = spawnPoint(doc, nav);
    const walk = new PlayerController(sp.pos, 'third', sp.yaw), run = new PlayerController(sp.pos, 'third', sp.yaw);
    for (let i = 0; i < 10; i++) { walk.update(1 / 30, nav, inputFromKeys(new Set(['KeyW']))); run.update(1 / 30, nav, inputFromKeys(new Set(['KeyW', 'ShiftLeft']))); }
    const dw = Math.hypot(walk.pos.x - sp.pos.x, walk.pos.z - sp.pos.z), dr = Math.hypot(run.pos.x - sp.pos.x, run.pos.z - sp.pos.z);
    expect(dw).toBeGreaterThan(0.3);
    expect(dr).toBeGreaterThan(dw);
  });
});

describe('characters', () => {
  test('body styles have distinct, original proportions', () => {
    const base = DEFAULT_APPEARANCE;
    const ratio = (s: (typeof BODY_STYLES)[number]) => headRatio({ ...base, bodyStyle: s });
    expect(ratio('chibi')).toBeGreaterThan(ratio('blocky'));
    expect(ratio('blocky')).toBeGreaterThan(ratio('heroic'));
    expect(ratio('heroic')).toBeGreaterThan(ratio('sleek'));
    expect(BODY_STYLE_TABLE.blocky.blocky).toBe(true);
    const heroic = bodyDims({ ...base, bodyStyle: 'heroic' }), sleek = bodyDims({ ...base, bodyStyle: 'sleek' });
    expect(heroic.torsoW / heroic.total).toBeGreaterThan(sleek.torsoW / sleek.total);
    expect(sleek.legLen / sleek.total).toBeGreaterThan(heroic.legLen / heroic.total);
    // undefined body style falls back to heroic; height and build scale it
    expect(bodyDims({ ...base, bodyStyle: undefined }).total).toBeCloseTo(heroic.total);
    expect(bodyDims({ ...base, height: 1.1 }).total).toBeGreaterThan(bodyDims({ ...base, height: 0.9 }).total);
    expect(bodyDims({ ...base, build: 'broad' }).torsoW).toBeGreaterThan(bodyDims({ ...base, build: 'slim' }).torsoW);
  });

  test('every body style, 3D hair style and expression builds a rigged character', () => {
    const hair = [...HAIR_STYLES_3D, 'bald', 'buzz', 'short', 'long', 'bun', 'ponytail', 'mohawk', 'curly'] as const;
    let i = 0;
    for (const bodyStyle of BODY_STYLES) for (const hairStyle of hair) {
      const expression = EXPRESSIONS[i++ % EXPRESSIONS.length];
      const a = withAppearance(DEFAULT_APPEARANCE, { bodyStyle, hairStyle, expression, mouth: 'wide', nose: 'broad', cheeks: 'blush', headwear: i % 5 === 0 ? 'cap' : 'none', glasses: i % 4 === 0 ? 'round' : 'none' });
      const g = buildCharacter(a);
      const rig = getRig(g)!;
      expect(rig).toBeDefined();
      expect(g.userData.height).toBeCloseTo(bodyDims(a).total);
      expect(rig.eyes.length).toBeGreaterThan(0);
      expect(rig.mouth).not.toBeNull();
    }
  });

  test('hair styles change the silhouette', () => {
    const size = (hairStyle: string) => {
      const g = buildCharacter(withAppearance(DEFAULT_APPEARANCE, { hairStyle: hairStyle as never }));
      let n = 0; g.traverse(() => n++); return n;
    };
    expect(size('afro')).not.toBe(size('bald'));
    expect(size('braids')).toBeGreaterThan(size('buzz'));
    expect(size('spiky')).toBeGreaterThan(size('short'));
  });

  test('walking swings the legs; statuses map to poses', () => {
    const g = buildCharacter(DEFAULT_APPEARANCE);
    const rig = getRig(g)!;
    animateCharacter(g, 'walk', 0.2);
    const a = rig.legL.rotation.x;
    animateCharacter(g, 'walk', 0.4);
    expect(rig.legL.rotation.x).not.toBeCloseTo(a);
    expect(Math.sign(rig.legL.rotation.x)).toBe(-Math.sign(rig.legR.rotation.x));
    expect(poseForStatus('working', false, false)).toBe('work');
    expect(poseForStatus('walking', true, true)).toBe('ride');
    expect(poseForStatus('blocked', false, false)).toBe('alert');
  });
});
