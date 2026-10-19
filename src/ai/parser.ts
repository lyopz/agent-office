// Local, rule-based command interpreter ("Simulated AI"). Turns plain English
// into structured DocOps/RuntimeOps with explicit object IDs. It never touches
// state directly: the console previews, validates and applies the plan.
import type { Agent, Appearance, Corridor, OfficeDoc, Personality, Point, Room, RoomType } from '../model/types';
import { applyOps, findFreeSpot, type DocOp } from '../engine/ops';
import { doorFacing, manhattan, polylineCells, rectsOverlap, roomCenter } from '../engine/geometry';
import { pickHub } from '../engine/validate';
import { ROOM_META, uid } from '../model/defaults';
import type { RuntimeOp, Selection } from '../store/store';
import { remodel } from './remodel';

export type Plan =
  | { kind: 'plan'; ops: DocOp[]; runtimeOps: RuntimeOp[]; explanation: string[]; needsConfirm: boolean; label: string }
  | { kind: 'clarify'; question: string; options: { label: string; command: string }[] }
  | { kind: 'unsupported'; message: string; alternatives: string[] };

export interface ParseContext {
  doc: OfficeDoc;
  selection: Selection;
  idleAgentIds: string[];
  lastAgentId?: string | null;
  lastRoomIds?: string[];
}

const ROOM_SYNONYMS: [RegExp, RoomType][] = [
  [/\b(royal lounge|king'?s lounge|throne room|briefing room)\b/, 'royal-lounge'],
  [/\b(engineering|engineer)\b/, 'engineering'], [/\b(library|archive|librarian)\b/, 'library'], [/\b(executive|exec suite|president)\b/, 'executive'],
  [/\b(finance|treasury|accounting)\b/, 'finance'], [/\bdesign lab\b|\bdesign\b/, 'design'], [/\b(studio|creative)\b/, 'studio'], [/\b(market intel|market|analytics)\b/, 'market'],
  [/\b(research|lab|laboratory)\b/, 'research'], [/\bserver/, 'server'], [/\b(conference|meeting)\b/, 'meeting'],
  [/\b(main office|operations|ops|control)\b/, 'operations'], [/\b(break|kitchen|lounge)\b/, 'break'], [/\bworkshop\b/, 'workshop'],
  [/\b(reception|lobby|front desk)\b/, 'reception'], [/\bstorage\b/, 'storage'], [/\bsecurity\b/, 'security'],
  [/\b(private office|agent office|office for)\b/, 'office'],
];

const COLORS: Record<string, string> = {
  red: '#c62f3a', orange: '#d9772b', yellow: '#f2c230', gold: '#d4a017', green: '#2e8b57', lime: '#39ff88', teal: '#1d8a85',
  blue: '#2b6cb0', navy: '#1c2a4a', cyan: '#4cc9ff', purple: '#6b3fa0', violet: '#8a5cd6', pink: '#e86aa0', magenta: '#c2389a',
  white: '#e8eef0', black: '#16181a', grey: '#6b7377', gray: '#6b7377', silver: '#b8c0c4', brown: '#6b4423', blonde: '#e3c27a',
  blond: '#e3c27a', auburn: '#8a3b1e', ginger: '#c4622d', khaki: '#a69a6b', olive: '#5a6b2e', denim: '#3a5a8a', beige: '#d8c8a8',
};

const norm = (s: string) => s.toLowerCase().replace(/[’']/g, "'").replace(/\s+/g, ' ').trim();
const words = (s: string) => norm(s).split(/[^a-z0-9]+/).filter(Boolean);

// ---------- entity resolution ----------

function scoreRoom(room: Room, text: string): number {
  const t = norm(text);
  const nameWords = words(room.name).filter((w) => !['room', 'the'].includes(w));
  let score = 0;
  if (t.includes(norm(room.name))) score += 10;
  const hits = nameWords.filter((w) => new RegExp(`\\b${w}`).test(t)).length;
  if (nameWords.length && hits === nameWords.length) score += 6; else score += hits * 2;
  for (const [re, type] of ROOM_SYNONYMS) if (re.test(t) && room.type === type) score += 4;
  return score;
}

function findRooms(doc: OfficeDoc, text: string, exclude: string[] = []): Room[] {
  const scored = Object.values(doc.rooms).filter((r) => !exclude.includes(r.id)).map((r) => ({ r, s: scoreRoom(r, text) })).filter((x) => x.s > 0);
  if (!scored.length) return [];
  const best = Math.max(...scored.map((x) => x.s));
  return scored.filter((x) => x.s === best).map((x) => x.r);
}

function findAgents(doc: OfficeDoc, text: string, ctx: ParseContext): Agent[] {
  const t = norm(text);
  const agents = Object.values(doc.agents);
  const byName = agents.filter((a) => new RegExp(`\\b${norm(a.identity.name).replace(/[^a-z0-9 ]/g, '')}\\b`).test(t));
  if (byName.length) return byName;
  if (/\b(this|that|selected) (character|agent|person)\b|\b(him|her|them|it|his|its)\b|\bthe (character|agent)\b/.test(t)) {
    if (ctx.selection.kind === 'agent' && doc.agents[ctx.selection.id]) return [doc.agents[ctx.selection.id]];
    if (ctx.lastAgentId && doc.agents[ctx.lastAgentId]) return [doc.agents[ctx.lastAgentId]];
    return [];
  }
  const m = /\bthe (\w+(?: \w+)?) (agent|character|engineer|analyst|mechanic|designer|officer)\b/.exec(t) ?? /\b(lead|research|server|systems|design|facilities|front office|comms|security) agent\b/.exec(t);
  if (m) {
    const key = m[1];
    const hit = agents.filter((a) => norm(`${a.identity.title} ${a.identity.department} ${a.skills.primaryRole}`).includes(key));
    if (hit.length) return hit;
    if (key === 'lead') return agents.filter((a) => /lead|head|chief|coordinator/i.test(a.identity.title));
  }
  return [];
}

function findCorridors(doc: OfficeDoc, text: string, ctx: ParseContext, rooms: Room[]): Corridor[] {
  const t = norm(text);
  const all = Object.values(doc.corridors);
  const byName = all.filter((c) => t.includes(norm(c.name)));
  if (byName.length) return byName;
  if (/\bmain (corridor|hallway|hall)\b/.test(t)) { const m = all.filter((c) => c.isMain || /main/i.test(c.name)); if (m.length) return m; }
  if (ctx.selection.kind === 'corridor' && doc.corridors[ctx.selection.id] && /\b(this|the|that) (hallway|corridor|hall)\b/.test(t)) return [doc.corridors[ctx.selection.id]];
  if (rooms.length >= 2) {
    const ids = rooms.map((r) => r.id);
    const between = all.filter((c) => [c.start, c.end].every((e) => e.kind === 'door' && ids.includes(e.roomId)));
    if (between.length) return between;
  }
  if (rooms.length === 1) return all.filter((c) => [c.start, c.end].some((e) => e.kind === 'door' && e.roomId === rooms[0].id));
  return [];
}

// ---------- placement ----------

type Rel = 'left' | 'right' | 'above' | 'below' | 'beside' | 'near';

export function placeRelative(doc: OfficeDoc, room: Room, target: Room, rel: Rel, gap = 4): Point {
  const cand = (r: Exclude<Rel, 'beside' | 'near'>): Point => {
    if (r === 'left') return { x: target.x - room.w - gap, y: target.y };
    if (r === 'right') return { x: target.x + target.w + gap, y: target.y };
    if (r === 'above') return { x: target.x, y: target.y - room.h - gap };
    return { x: target.x, y: target.y + target.h + gap };
  };
  const options: Exclude<Rel, 'beside' | 'near'>[] = rel === 'beside' ? ['right', 'left'] : rel === 'near' ? ['right', 'left', 'below', 'above'] : [rel];
  let best: Point | null = null; let bestCost = Infinity;
  for (const o of options) {
    const want = cand(o);
    const got = findFreeSpot(doc, { ...want, w: room.w, h: room.h }, room.id, 2);
    const cost = manhattan(want, got) + (o === options[0] ? 0 : 0.5);
    if (cost < bestCost) { bestCost = cost; best = got; }
  }
  return best!;
}

// ---------- appearance & personality vocab ----------

export function appearanceFromText(text: string, current: Appearance): { patch: Partial<Appearance>; notes: string[] } {
  const t = norm(text);
  const p: Partial<Appearance> = {};
  const notes: string[] = [];
  const has = (re: RegExp) => re.test(t);
  // archetypes first, specific items override them
  if (has(/\bmechanic|technician|engineer in work/)) Object.assign(p, { top: 'coverall', topColor: '#d9772b', shoes: 'boots', shoeColor: '#4a3020', equipment: 'wrench' });
  if (has(/\boil ?field|oil rig|roughneck/)) Object.assign(p, { headwear: 'hardhat', headwearColor: '#f2c230', topColor: '#b85a1c' });
  if (has(/\brugged\b/)) { if (current.facialHair === 'none') p.facialHair = 'stubble'; p.shading = 'hard'; }
  if (has(/\b(scientist|researcher)\b/)) Object.assign(p, { top: 'labcoat', topColor: '#e8eef0', glasses: 'round', equipment: 'clipboard' });
  if (has(/\b(executive|businessman|businesswoman|manager)\b/)) Object.assign(p, { top: 'suit', topColor: '#1c2230', bottomColor: '#1c2230', shoes: 'dress', shoeColor: '#111111' });
  if (has(/\bsecurity guard\b/)) Object.assign(p, { top: 'vest', headwear: 'helmet', shoes: 'boots' });
  if (has(/\b(hacker|netrunner|cyberpunk)\b/)) Object.assign(p, { top: 'hoodie', glasses: 'visor', artStyle: 'neon' });
  // clothing
  if (has(/work ?clothes|coverall|overall|jumpsuit/)) p.top = 'coverall';
  if (has(/lab ?coat/)) { p.top = 'labcoat'; p.topColor ??= '#e8eef0'; }
  if (has(/\bsuit\b/)) p.top = 'suit';
  if (has(/hoodie/)) p.top = 'hoodie';
  if (has(/t-?shirt|tee\b/)) p.top = 'tshirt';
  if (has(/\buniform\b/)) p.top = 'uniform';
  if (has(/\bvest\b|hi-?vis/)) p.top = 'vest';
  if (has(/\bshorts\b/)) p.bottom = 'shorts';
  if (has(/\bskirt\b/)) p.bottom = 'skirt';
  if (has(/\b(pants|trousers|jeans)\b/)) p.bottom = 'pants';
  if (has(/\bboots?\b/)) { p.shoes = 'boots'; p.shoeColor ??= '#4a3020'; }
  if (has(/sneakers|trainers/)) p.shoes = 'sneakers';
  if (has(/dress shoes|loafers/)) p.shoes = 'dress';
  // headwear
  if (has(/hard ?hat/)) { p.headwear = 'hardhat'; p.headwearColor ??= '#f2c230'; }
  else if (has(/\bhelmet\b/)) p.headwear = 'helmet';
  else if (has(/\bbeanie\b/)) p.headwear = 'beanie';
  else if (has(/\bheadset\b/)) p.headwear = 'headset';
  else if (has(/\bcap\b|baseball cap/)) p.headwear = 'cap';
  if (has(/\b(no|remove( the)?|without( a)?|take off( the)?) (hat|helmet|headwear|cap|hard ?hat)/)) p.headwear = 'none';
  // face
  if (has(/\bvisor\b/)) p.glasses = 'visor';
  else if (has(/square glasses/)) p.glasses = 'square';
  else if (has(/\bglasses|spectacles/)) p.glasses = 'round';
  if (has(/\b(no|remove( the)?|without) glasses/)) p.glasses = 'none';
  if (has(/\bbeard\b/)) p.facialHair = 'beard';
  if (has(/mustache|moustache/)) p.facialHair = 'mustache';
  if (has(/stubble/)) p.facialHair = 'stubble';
  if (has(/clean[- ]shaven|shave|no beard/)) p.facialHair = 'none';
  // hair
  const hairMap: [RegExp, Appearance['hairStyle']][] = [[/\bbald\b/, 'bald'], [/buzz ?cut|buzzed/, 'buzz'], [/long hair/, 'long'], [/short hair/, 'short'], [/\bbun\b/, 'bun'], [/pony ?tail/, 'ponytail'], [/mohawk/, 'mohawk'], [/curly|afro/, 'curly']];
  for (const [re, v] of hairMap) if (has(re)) p.hairStyle = v;
  const hc = /\b(\w+) hair\b/.exec(t); if (hc && COLORS[hc[1]]) p.hairColor = COLORS[hc[1]];
  const tc = /\b(\w+) (shirt|jacket|coverall|coveralls|top|outfit|clothes|work clothes|hoodie|suit|uniform|vest)\b/.exec(t); if (tc && COLORS[tc[1]]) p.topColor = COLORS[tc[1]];
  const hw = /\b(\w+) (hard ?hat|helmet|cap|beanie)\b/.exec(t); if (hw && COLORS[hw[1]]) p.headwearColor = COLORS[hw[1]];
  const ac = /\b(\w+) (accent|glow|highlights?)\b/.exec(t); if (ac && COLORS[ac[1]]) p.accent = COLORS[ac[1]];
  // equipment
  if (has(/tool ?belt/)) p.equipment = 'toolbelt';
  else if (has(/\bwrench|spanner/)) p.equipment = 'wrench';
  else if (has(/\btablet\b/)) p.equipment = 'tablet';
  else if (has(/clipboard/)) p.equipment = 'clipboard';
  else if (has(/\blaptop\b/)) p.equipment = 'laptop';
  // build
  if (has(/\btaller\b|\btall\b/)) p.height = Math.min(1.15, current.height + 0.08);
  if (has(/\bshorter\b/)) p.height = Math.max(0.85, current.height - 0.08);
  if (has(/\b(slim|thin|lean)\b/)) p.build = 'slim';
  if (has(/\b(broad|muscular|stocky|burly)\b/)) p.build = 'broad';
  // presentation
  if (has(/side[- ]?(view|facing|profile)|in profile/)) { p.preferredView = 'side'; notes.push('Side-view walking sprite is drawn from the same profile'); }
  else if (has(/front[- ]?(view|facing)/)) p.preferredView = 'front';
  else if (has(/top[- ]?down|overhead/)) p.preferredView = 'top';
  else if (has(/three[- ]quarter|3\/4/)) p.preferredView = 'three-quarter';
  if (has(/facing left/)) p.facing = 'left';
  if (has(/facing right/)) p.facing = 'right';
  if (has(/\brealistic\b/)) { p.artStyle = 'realistic'; p.shading = 'soft'; }
  if (has(/\bneon\b/)) p.artStyle = 'neon';
  if (has(/\bflat\b/)) p.artStyle = 'flat';
  if (has(/\b(pixel[- ]?(art|style)|pixelated|8[- ]?bit|retro sprite)\b/)) p.artStyle = 'pixel';
  if (has(/walks? faster|brisk/)) p.walkPose = 'brisk';
  if (has(/walks? slower|casual walk/)) p.walkPose = 'casual';
  // drop no-op keys
  for (const k of Object.keys(p) as (keyof Appearance)[]) if (p[k] === current[k]) delete p[k];
  return { patch: p, notes };
}

const PERSONALITY_PRESETS: { name: string; patch: Partial<Personality> }[] = [
  { name: 'Calm strategist', patch: { traits: ['calm', 'strategic', 'patient'], communicationStyle: 'concise', formality: 65, humor: 20, creativity: 55, detail: 75, riskTolerance: 30, initiative: 60, decisionMaking: 'data-driven' } },
  { name: 'Energetic optimist', patch: { traits: ['upbeat', 'energetic', 'encouraging'], communicationStyle: 'friendly', formality: 25, humor: 75, creativity: 70, detail: 45, riskTolerance: 60, initiative: 80, decisionMaking: 'intuitive' } },
  { name: 'Meticulous auditor', patch: { traits: ['meticulous', 'skeptical', 'precise'], communicationStyle: 'detailed', formality: 80, humor: 10, creativity: 30, detail: 95, riskTolerance: 15, initiative: 45, decisionMaking: 'data-driven' } },
  { name: 'Bold innovator', patch: { traits: ['bold', 'inventive', 'restless'], communicationStyle: 'technical', formality: 35, humor: 55, creativity: 95, detail: 40, riskTolerance: 85, initiative: 90, decisionMaking: 'intuitive' } },
  { name: 'Team diplomat', patch: { traits: ['diplomatic', 'empathetic', 'organised'], communicationStyle: 'friendly', formality: 55, humor: 45, creativity: 50, detail: 60, riskTolerance: 35, initiative: 55, collaboration: 'team', decisionMaking: 'consensus' } },
];

function personalityFromText(text: string, cur: Personality): Partial<Personality> | null {
  const t = norm(text);
  const p: Partial<Personality> = {};
  const traits = new Set(cur.traits);
  const adj: [RegExp, () => void][] = [
    [/more formal|formal\b/, () => { p.formality = Math.min(100, cur.formality + 25); p.communicationStyle = 'formal'; }],
    [/less formal|casual|relaxed/, () => { p.formality = Math.max(0, cur.formality - 25); }],
    [/funn(y|ier)|humou?r/, () => { p.humor = Math.min(100, cur.humor + 30); traits.add('witty'); }],
    [/serious/, () => { p.humor = Math.max(0, cur.humor - 30); traits.add('serious'); }],
    [/creative/, () => { p.creativity = Math.min(100, cur.creativity + 25); traits.add('creative'); }],
    [/cautious|careful/, () => { p.riskTolerance = Math.max(0, cur.riskTolerance - 25); traits.add('cautious'); }],
    [/bold|risk[- ]taking|daring/, () => { p.riskTolerance = Math.min(100, cur.riskTolerance + 25); traits.add('bold'); }],
    [/proactive|initiative/, () => { p.initiative = Math.min(100, cur.initiative + 25); traits.add('proactive'); }],
    [/detail[- ]oriented|meticulous/, () => { p.detail = Math.min(100, cur.detail + 25); traits.add('meticulous'); }],
    [/friendl(y|ier)|warm/, () => { p.communicationStyle = 'friendly'; traits.add('warm'); }],
    [/concise|brief|terse/, () => { p.communicationStyle = 'concise'; }],
    [/detailed|thorough/, () => { p.communicationStyle = 'detailed'; }],
  ];
  for (const [re, fn] of adj) if (re.test(t)) fn();
  if (Object.keys(p).length || traits.size !== cur.traits.length) { p.traits = [...traits]; return p; }
  return null;
}

function jobDescription(a: Agent): string {
  const s = a.skills.skills.length ? ` Core skills: ${a.skills.skills.join(', ')}.` : '';
  return `${a.identity.title} in ${a.identity.department}. Owns ${a.identity.department.toLowerCase()} work end to end, reports to the lead coordinator, and escalates blockers early.${s}`;
}

// ---------- clause handling ----------

const VERBS = 'move|make|add|create|build|connect|extend|widen|narrow|rename|delete|remove|block|unblock|reopen|give|change|turn|assign|send|undo|redo|realign|align|put|place|resize|shrink|enlarge|set|keep|have|update|go';
const SPLIT = new RegExp(`(?:[.;]\\s+|,\\s*(?:and\\s+|then\\s+)?|\\s+and\\s+then\\s+|\\s+then\\s+|\\s+and\\s+)(?=(?:${VERBS})\\b)`, 'i');

export function splitClauses(cmd: string): string[] {
  const parts = cmd.split(SPLIT).map((s) => s.trim().replace(/[.!]+$/, '')).filter(Boolean);
  // "widen the hallway and align it with …": a pronoun clause stays with the hallway it refers to
  const out: string[] = [];
  for (const p of parts) {
    const prev = out[out.length - 1];
    if (prev && /^(align|straighten|extend|widen|narrow)\s+(it|them)\b/i.test(p) && /(hall|corridor|wing)/i.test(prev)) out[out.length - 1] = `${prev} and ${p}`;
    else out.push(p);
  }
  return out;
}

interface Acc { ops: DocOp[]; rt: RuntimeOp[]; notes: string[]; confirm: boolean; doc: OfficeDoc; lastRooms: string[]; lastAgent: string | null; newRoomId?: string; labels: string[] }

function relFrom(t: string): Rel | null {
  if (/\bto the left of\b|\bleft of\b|\bwest of\b/.test(t)) return 'left';
  if (/\bto the right of\b|\bright of\b|\beast of\b/.test(t)) return 'right';
  if (/\babove\b|\bnorth of\b/.test(t)) return 'above';
  if (/\bbelow\b|\bunder\b|\bsouth of\b/.test(t)) return 'below';
  if (/\bbeside\b|\bnext to\b|\badjacent to\b/.test(t)) return 'beside';
  if (/\bnear\b|\bclose to\b/.test(t)) return 'near';
  return null;
}

function push(acc: Acc, ops: DocOp[]): string | null {
  const r = applyOps(acc.doc, ops);
  if (r.errors.length) return r.errors[0];
  acc.doc = r.doc; acc.ops.push(...ops); acc.notes.push(...r.summary);
  return null;
}

type ClauseResult = null | { clarify: Plan } | { error: string };

function clause(raw: string, ctx: ParseContext, acc: Acc): ClauseResult {
  const t = norm(raw);
  const doc = acc.doc;
  const c2: ParseContext = { ...ctx, doc, lastAgentId: acc.lastAgent ?? ctx.lastAgentId, lastRoomIds: acc.lastRooms.length ? acc.lastRooms : ctx.lastRoomIds };
  const selRoom = ctx.selection.kind === 'room' ? ctx.selection.ids.map((id) => doc.rooms[id]).filter(Boolean) : [];
  const them = (c2.lastRoomIds ?? []).map((id) => doc.rooms[id]).filter(Boolean);

  // keep … (constraint clause)
  if (/^keep\b/.test(t)) { acc.notes.push(`Preserved: ${raw.replace(/^keep\s+/i, '')}`); return null; }
  if (/^(undo|revert)\b/.test(t)) { acc.rt.push({ op: 'history.undo' }); acc.notes.push('Undo the last change'); acc.labels.push('Undo'); return null; }
  if (/^redo\b/.test(t)) { acc.rt.push({ op: 'history.redo' }); acc.notes.push('Redo'); acc.labels.push('Redo'); return null; }
  if (/realign|repair (the |all )?(hall|corridor)|fix (the )?(hall|corridor)/.test(t)) { const e = push(acc, [{ op: 'corridors.realign' }]); acc.confirm = true; acc.labels.push('Realign hallways'); return e ? { error: e } : null; }

  // move every idle agent to an available workstation
  if (/\b(every|all|each) idle agents?\b/.test(t) && /workstation|desk/.test(t)) {
    const free = Object.values(doc.furniture).filter((f) => f.workstation && f.workstation.status === 'online' && !f.workstation.assignedAgentId);
    const idle = ctx.idleAgentIds.filter((id) => doc.agents[id]);
    if (!idle.length) { acc.notes.push('No agents are idle right now'); return null; }
    let i = 0;
    for (const id of idle) {
      const a = doc.agents[id];
      const own = a.schedule.preferredWorkstationId && doc.furniture[a.schedule.preferredWorkstationId];
      const target = own || free[i++];
      if (!target) { acc.notes.push(`No free workstation left for ${a.identity.name}`); continue; }
      if (!own) { const e = push(acc, [{ op: 'workstation.assign', furnitureId: target.id, agentId: id }]); if (e) return { error: e }; }
      acc.rt.push({ op: 'agent.goTo', agentId: id, roomId: target.roomId, workstationId: target.id });
      acc.notes.push(`${a.identity.name} → ${target.workstation!.name}`);
    }
    acc.labels.push('Send idle agents to workstations');
    return null;
  }

  // block / unblock hallway
  if (/^(block|close|unblock|reopen|open)\b/.test(t) && /(hall|corridor|wing)/.test(t)) {
    const rooms = findRooms(doc, t);
    const cs = findCorridors(doc, t, c2, rooms);
    if (!cs.length) return { clarify: { kind: 'clarify', question: 'Which hallway should I change?', options: Object.values(doc.corridors).slice(0, 6).map((c) => ({ label: c.name, command: `${t.split(' ')[0]} ${c.name}` })) } };
    const blocked = /^(block|close)/.test(t);
    const e = push(acc, cs.slice(0, 1).map((c) => ({ op: 'corridor.update', id: c.id, patch: { blocked } }) as DocOp));
    acc.labels.push(`${blocked ? 'Block' : 'Reopen'} ${cs[0].name}`);
    return e ? { error: e } : null;
  }

  // hallway width / alignment
  if (/(hall|corridor)/.test(t) && /(wider|widen|narrow|width|align|extend|straighten)/.test(t)) {
    const rooms = findRooms(doc, t);
    let cs = findCorridors(doc, t, c2, rooms.length ? rooms : them);
    if (!cs.length && /\bthe (hallway|corridor)\b/.test(t)) cs = Object.values(doc.corridors).filter((c) => c.isMain).slice(0, 1);
    const ops: DocOp[] = [];
    if (/extend|between/.test(t) && (rooms.length >= 2 || them.length >= 2) && !cs.length) {
      const [a, b] = rooms.length >= 2 ? rooms : them;
      ops.push({ op: 'rooms.connect', a: a.id, b: b.id });
    }
    if (!cs.length && !ops.length) return { clarify: { kind: 'clarify', question: 'Which hallway do you mean?', options: Object.values(doc.corridors).slice(0, 6).map((c) => ({ label: c.name, command: raw.replace(/the (hallway|corridor)/i, c.name) })) } };
    for (const c of cs.slice(0, 1)) {
      const m = /width (?:to |of )?(\d+)/.exec(t);
      const width = m ? Number(m[1]) : /wider|widen/.test(t) ? c.width + 1 : /narrow/.test(t) ? Math.max(doc.settings.minCorridorWidth, c.width - 1) : c.width;
      if (width !== c.width) ops.push({ op: 'corridor.update', id: c.id, patch: { width } });
      const alignM = /align (?:it |this |the hallway )?with (?:the )?(.+?)(?: entrance| door|$)/.exec(t);
      if (alignM) {
        const target = findRooms(doc, alignM[1])[0];
        if (!target) return { clarify: { kind: 'clarify', question: `Which room's entrance should ${c.name} align with?`, options: Object.values(doc.rooms).slice(0, 6).map((r) => ({ label: r.name, command: `${raw.split(/align/i)[0]}align it with the ${r.name} entrance` })) } };
        const touches = [c.start, c.end].some((e) => e.kind === 'door' && e.roomId === target.id);
        if (touches) { if (c.routing === 'manual') ops.push({ op: 'corridor.update', id: c.id, patch: { routing: 'auto' } }); acc.notes.push(c.routing === 'manual' ? `${c.name} already serves ${target.name}; switching it to automatic routing so it runs straight to the door` : `${c.name} already connects to the ${target.name} entrance`); }
        else {
          // re-attach the end closest to the target room to that room's entrance
          const pts = polylineCells(c.points);
          const center = roomCenter(target);
          const which = pts.length && manhattan(pts[0], center) < manhattan(pts[pts.length - 1], center) ? 'start' : 'end';
          let door = target.doors[0];
          const doorOps: DocOp[] = [];
          if (!door) { const want = doorFacing(target, pts[0] ?? center); const id = uid('door'); doorOps.push({ op: 'door.add', roomId: target.id, side: want.side, offset: want.offset, width: want.width, id }); door = { id, ...want }; }
          ops.push(...doorOps, { op: 'corridor.setEndpoint', id: c.id, which, endpoint: { kind: 'door', roomId: target.id, doorId: door.id } });
        }
      }
      if (c.routing === 'manual' && /straighten|realign/.test(t)) ops.push({ op: 'corridor.update', id: c.id, patch: { routing: 'auto' } });
    }
    if (!ops.length) { acc.notes.push('Hallway already matches that request'); return null; }
    const e = push(acc, ops); acc.confirm = true; acc.labels.push('Edit hallway');
    return e ? { error: e } : null;
  }

  // connect rooms
  if (/^connect\b/.test(t)) {
    const parts = t.replace(/^connect\s+/, '').split(/\s+(?:to|and|with)\s+/);
    if (parts.length >= 2) {
      const a = findRooms(doc, parts[0])[0] ?? selRoom[0];
      const corridorTarget = findCorridors(doc, parts[1], c2, []).filter(() => /hall|corridor/.test(parts[1]));
      if (a && corridorTarget.length) { const e = push(acc, [{ op: 'room.connectToCorridor', roomId: a.id, corridorId: corridorTarget[0].id }]); acc.confirm = true; acc.labels.push(`Connect ${a.name}`); return e ? { error: e } : null; }
      const b = findRooms(doc, parts[1], a ? [a.id] : [])[0];
      if (a && b) { const e = push(acc, [{ op: 'rooms.connect', a: a.id, b: b.id }]); acc.confirm = true; acc.lastRooms = [a.id, b.id]; acc.labels.push(`Connect ${a.name} and ${b.name}`); return e ? { error: e } : null; }
    }
    return { clarify: { kind: 'clarify', question: 'Which two rooms should I connect?', options: [] } };
  }

  // object-library remodelling (place against walls, beside every X, replace, restyle, arrange, plants)
  const isRoomAsk = /^(?:create|add|build|make)\s+(?:a |an )?(?:new )?(lounge|break room|kitchen|[a-z ]*\broom|[a-z ]*\boffice|[a-z ]*\blab|library|studio|workshop)\b/.test(t) && !/\b(desk|terminal|station|table|plant|lamp|display|kiosk|rack|shelf|seat|chair)\b/.test(t.split(/\s+(?:beside|next to|near|to the|above|below)\s+/)[0]);
  if (!isRoomAsk) {
    const rm = remodel(t, doc, selRoom.length ? selRoom : them, (d, x) => findRooms(d, x));
    if (rm && 'clarify' in rm) return { clarify: { kind: 'clarify', ...rm.clarify } };
    if (rm && 'error' in rm) return rm;
    if (rm) {
      const r = applyOps(acc.doc, rm.ops); if (r.errors.length) return { error: r.errors[0] };
      acc.doc = r.doc; acc.ops.push(...rm.ops); acc.notes.push(...rm.notes); acc.confirm = true; acc.labels.push(rm.label);
      return null;
    }
  }

  // create room
  const createM = /^(?:create|add|build|make)\s+(?:a |an )?(?:new )?(.+?)(?:\s+room)?(?:\s+for\s+(.+?))?(?:\s+(?:connected|linked|attached) to\s+(.+?))?(?:\s+((?:to the )?(?:left|right) of|above|below|beside|next to|near)\s+(.+))?$/.exec(t);
  if (createM && /room|office|lab|laboratory|workshop|lobby|reception|storage|kitchen|lounge|library|studio|suite/.test(createM[1] + ' ' + t) && !/\b(desk|workstation|plant|chair|server rack|whiteboard|shelf|cabinet|furniture)\b/.test(createM[1])) {
    const what = createM[1];
    let type: RoomType = 'custom';
    for (const [re, ty] of ROOM_SYNONYMS) if (re.test(what) || (ty === 'office' && /office/.test(what) && !/main office/.test(what))) { type = ty; break; }
    if (/private office|office for/.test(t)) type = 'office';
    const forAgent = createM[2] ? findAgents(doc, createM[2], c2)[0] ?? findAgents(doc, `the ${createM[2]}`, c2)[0] : undefined;
    if (createM[2] && !forAgent) {
      return { clarify: { kind: 'clarify', question: `Who is the ${type === 'office' ? 'office' : 'room'} for?`, options: Object.values(doc.agents).slice(0, 6).map((a) => ({ label: a.identity.name, command: `create a private office for ${a.identity.name}` })) } };
    }
    const sizes: Partial<Record<RoomType, [number, number]>> = { office: [7, 6], server: [8, 6], research: [10, 7], meeting: [9, 7], storage: [6, 5], break: [8, 6], workshop: [9, 7], security: [7, 6], reception: [9, 6] };
    const [w, h] = sizes[type] ?? [8, 6];
    const name = forAgent ? `${forAgent.identity.name} Private Office` : /\blounge\b/.test(what) ? 'Lounge' : type === 'custom' ? `${what.replace(/\b\w/g, (m) => m.toUpperCase())} Room` : ROOM_META[type].label;
    const relTarget = createM[5] ? findRooms(doc, createM[5])[0] : undefined;
    const rel = createM[4] ? relFrom(createM[4]) : null;
    const anchorRoom = relTarget ?? (forAgent?.schedule.assignedRoomId ? doc.rooms[forAgent.schedule.assignedRoomId] : undefined) ?? pickHub(doc);
    const probe = { x: anchorRoom ? anchorRoom.x : 0, y: anchorRoom ? anchorRoom.y : 0, w, h } as Room;
    const pos = anchorRoom ? placeRelative(doc, { ...probe, id: '__new' }, anchorRoom, rel ?? 'near') : findFreeSpot(doc, probe);
    const id = uid('room');
    const ops: DocOp[] = [{ op: 'room.create', id, type, name, x: pos.x, y: pos.y, w, h, preset: !forAgent }];
    if (forAgent) {
      const deskId = uid('fur');
      ops.push({ op: 'furniture.add', roomId: id, type: 'desk', x: 1, y: 1, id: deskId, workstationName: `${forAgent.identity.name}'s Desk` },
        { op: 'furniture.add', roomId: id, type: 'cabinet', x: w - 2, y: 1 }, { op: 'furniture.add', roomId: id, type: 'plant', x: w - 2, y: h - 2 },
        { op: 'workstation.assign', furnitureId: deskId, agentId: forAgent.id });
      acc.rt.push({ op: 'agent.goTo', agentId: forAgent.id, roomId: id, workstationId: deskId });
      acc.lastAgent = forAgent.id;
    }
    const corridorM = createM[3] ? findCorridors(doc, createM[3], c2, []) : [];
    const connectRoom = createM[3] && !corridorM.length ? findRooms(doc, createM[3])[0] : undefined;
    if (corridorM.length) ops.push({ op: 'room.connectToCorridor', roomId: id, corridorId: corridorM[0].id });
    else if (connectRoom) ops.push({ op: 'rooms.connect', a: connectRoom.id, b: id });
    else if (anchorRoom) ops.push({ op: 'rooms.connect', a: anchorRoom.id, b: id });
    const e = push(acc, ops);
    if (e) return { error: e };
    acc.confirm = true; acc.newRoomId = id; acc.lastRooms = [id]; acc.labels.push(`Create ${name}`);
    return null;
  }

  // add furniture / workstation to a room
  const furnM = /^(?:add|put|place)\s+(?:a |an |another )?(desk|workstation|plant|chair|server rack|whiteboard|shelf|cabinet|lamp|sofa|computer|monitors?|conference table|workbench)\s+(?:to|in|into)\s+(?:the )?(.+)$/.exec(t);
  if (furnM) {
    const room = findRooms(doc, furnM[2])[0] ?? selRoom[0];
    if (!room) return { clarify: { kind: 'clarify', question: 'Which room should it go in?', options: Object.values(doc.rooms).slice(0, 6).map((r) => ({ label: r.name, command: `add a ${furnM[1]} to the ${r.name}` })) } };
    const type = ({ workstation: 'desk', 'server rack': 'server-rack', monitor: 'monitors', monitors: 'monitors', 'conference table': 'conference-table' } as Record<string, string>)[furnM[1]] ?? furnM[1];
    // first free spot inside the room
    const taken = room.furnitureIds.map((fid) => doc.furniture[fid]).filter(Boolean);
    let spot = { x: 1, y: 1 };
    outer: for (let y = 1; y < room.h - 1; y++) for (let x = 1; x < room.w - 2; x++) {
      if (!taken.some((f) => rectsOverlap({ x, y, w: 2, h: 1 }, { x: f.x, y: f.y, w: f.w, h: f.h }, 0))) { spot = { x, y }; break outer; }
    }
    const e = push(acc, [{ op: 'furniture.add', roomId: room.id, type: type as never, x: spot.x, y: spot.y, workstationName: furnM[1] === 'workstation' ? `${room.name} Desk` : undefined }]);
    acc.confirm = true; acc.labels.push(`Add ${furnM[1]}`);
    return e ? { error: e } : null;
  }

  // delete room
  const delM = /^(?:delete|remove|demolish)\s+(?:the\s+)?(.+)$/.exec(t);
  if (delM && !/\b(hat|glasses|beard|helmet|cap)\b/.test(t)) {
    const rooms = findRooms(doc, delM[1]);
    const cs = /(hall|corridor)/.test(delM[1]) ? findCorridors(doc, delM[1], c2, []) : [];
    if (cs.length) { const e = push(acc, [{ op: 'corridor.delete', id: cs[0].id }]); acc.confirm = true; acc.labels.push(`Delete ${cs[0].name}`); return e ? { error: e } : null; }
    if (rooms.length === 1) { const e = push(acc, [{ op: 'room.delete', id: rooms[0].id, cascade: true }]); acc.confirm = true; acc.labels.push(`Delete ${rooms[0].name}`); acc.notes.push('Destructive: needs your confirmation'); return e ? { error: e } : null; }
    if (rooms.length > 1) return { clarify: { kind: 'clarify', question: 'Which room should I delete?', options: rooms.map((r) => ({ label: r.name, command: `delete ${r.name}` })) } };
  }

  // rename
  const renM = /^rename\s+(?:the\s+)?(.+?)\s+to\s+(.+)$/.exec(raw.trim().replace(/\.$/, ''));
  if (renM) {
    const newName = renM[2].replace(/^["“']|["”']$/g, '').trim();
    const agent = findAgents(doc, renM[1], c2)[0];
    if (agent) { const e = push(acc, [{ op: 'agent.update', id: agent.id, patch: { identity: { name: newName } } }]); acc.labels.push('Rename agent'); return e ? { error: e } : null; }
    const room = findRooms(doc, renM[1])[0];
    if (room) { const e = push(acc, [{ op: 'room.update', id: room.id, patch: { name: newName } }]); acc.labels.push('Rename room'); return e ? { error: e } : null; }
    const c = findCorridors(doc, renM[1], c2, [])[0];
    if (c) { const e = push(acc, [{ op: 'corridor.update', id: c.id, patch: { name: newName } }]); acc.labels.push('Rename hallway'); return e ? { error: e } : null; }
    return { error: `I couldn't find “${renM[1]}”` };
  }

  // resize room
  const sizeM = /(?:make|resize|set)\s+(?:the\s+)?(.+?)\s+(?:to\s+)?(bigger|larger|smaller|wider|taller|narrower|shorter|(\d+)\s*(?:x|by)\s*(\d+))/.exec(t);
  if (sizeM && !findAgents(doc, sizeM[1], c2).length) {
    const room = findRooms(doc, sizeM[1])[0] ?? selRoom[0];
    if (room) {
      let { w, h } = room;
      if (sizeM[3]) { w = Number(sizeM[3]); h = Number(sizeM[4]); }
      else if (/bigger|larger/.test(sizeM[2])) { w += 2; h += 2; } else if (sizeM[2] === 'smaller') { w = Math.max(3, w - 2); h = Math.max(3, h - 2); }
      else if (sizeM[2] === 'wider') w += 2; else if (sizeM[2] === 'narrower') w = Math.max(3, w - 2); else if (sizeM[2] === 'taller') h += 2; else if (sizeM[2] === 'shorter') h = Math.max(3, h - 2);
      const e = push(acc, [{ op: 'room.update', id: room.id, patch: { w, h } }]); acc.confirm = true; acc.lastRooms = [room.id]; acc.labels.push(`Resize ${room.name}`);
      return e ? { error: e } : null;
    }
  }

  // move: rooms (spatial) or agents (navigation)
  const moveM = /^(?:move|put|place|shift|send|bring)\s+(?:the\s+)?(.+?)\s+(to(?: the)? (?:left|right) of|left of|right of|west of|east of|north of|south of|above|below|beside|next to|adjacent to|near|close to|to|into|in)\s+(?:the\s+)?(.+)$/.exec(t);
  if (moveM) {
    const [, subj, prep, obj] = moveM;
    const agents = findAgents(doc, subj, c2);
    const subjRooms = agents.length ? [] : findRooms(doc, subj);
    if (agents.length) {
      const a = agents[0];
      acc.lastAgent = a.id;
      // "to the new workstation" / "to a workstation" / "to <room>"
      if (/workstation|desk/.test(obj)) {
        const inRooms = /\bnew\b/.test(obj) && acc.newRoomId ? [acc.newRoomId] : acc.lastRooms.length ? acc.lastRooms : [];
        const free = Object.values(acc.doc.furniture).filter((f) => f.workstation && (!f.workstation.assignedAgentId || f.workstation.assignedAgentId === a.id) && (!inRooms.length || inRooms.includes(f.roomId)));
        const ws = free[0];
        if (!ws) return { error: 'No free workstation found for that agent' };
        const e = push(acc, [{ op: 'workstation.assign', furnitureId: ws.id, agentId: a.id }]);
        if (e) return { error: e };
        acc.rt.push({ op: 'agent.goTo', agentId: a.id, roomId: ws.roomId, workstationId: ws.id });
        acc.notes.push(`${a.identity.name} walks to ${ws.workstation!.name}`);
        acc.labels.push(`Move ${a.identity.name}`);
        return null;
      }
      const room = findRooms(acc.doc, obj)[0];
      if (!room) return { clarify: { kind: 'clarify', question: `Where should ${a.identity.name} go?`, options: Object.values(doc.rooms).slice(0, 6).map((r) => ({ label: r.name, command: `send ${a.identity.name} to the ${r.name}` })) } };
      if (/assign/.test(t)) push(acc, [{ op: 'agent.assignRoom', agentId: a.id, roomId: room.id }]);
      acc.rt.push({ op: 'agent.goTo', agentId: a.id, roomId: room.id });
      acc.notes.push(`${a.identity.name} walks to ${room.name}`);
      acc.labels.push(`Send ${a.identity.name} to ${room.name}`);
      return null;
    }
    const roomList = subjRooms.length ? subjRooms : /\b(this|selected|it)\b/.test(subj) ? selRoom : [];
    if (!roomList.length) return { clarify: { kind: 'clarify', question: `I couldn't tell which room or agent “${subj}” is. Which one?`, options: [...Object.values(doc.rooms).slice(0, 4).map((r) => ({ label: r.name, command: raw.replace(subj, r.name) }))] } };
    if (roomList.length > 1 && subjRooms.length) return { clarify: { kind: 'clarify', question: `Several rooms match “${subj}”. Which one?`, options: roomList.map((r) => ({ label: r.name, command: raw.replace(subj, r.name) })) } };
    const room = roomList[0];
    const rel = relFrom(prep + ' ');
    const absM = /^\(?\s*(-?\d+)\s*,\s*(-?\d+)\s*\)?$/.exec(obj);
    let pos: Point | null = null;
    if (absM) pos = { x: Number(absM[1]), y: Number(absM[2]) };
    else {
      const target = findRooms(acc.doc, obj, [room.id])[0];
      if (!target) return { clarify: { kind: 'clarify', question: `Move ${room.name} relative to which room?`, options: Object.values(doc.rooms).filter((r) => r.id !== room.id).slice(0, 6).map((r) => ({ label: r.name, command: `move the ${room.name} ${rel === 'left' ? 'to the left of' : rel ?? 'beside'} the ${r.name}` })) } };
      pos = placeRelative(acc.doc, room, target, rel ?? 'beside');
      acc.lastRooms = [room.id, target.id];
    }
    const e = push(acc, [{ op: 'room.update', id: room.id, patch: pos }]);
    if (e) return { error: e };
    acc.confirm = true; acc.labels.push(`Move ${room.name}`);
    return null;
  }
  const nudgeM = /^move\s+(?:the\s+)?(.+?)\s+(left|right|up|down)(?:\s+by)?\s*(\d+)?/.exec(t);
  if (nudgeM) {
    const room = findRooms(doc, nudgeM[1])[0] ?? selRoom[0];
    if (room) {
      const n = Number(nudgeM[3] ?? 2);
      const d = { left: [-n, 0], right: [n, 0], up: [0, -n], down: [0, n] }[nudgeM[2] as 'left']!;
      const e = push(acc, [{ op: 'room.update', id: room.id, patch: { x: room.x + d[0], y: room.y + d[1] } }]);
      acc.confirm = true; acc.labels.push(`Move ${room.name}`); acc.lastRooms = [room.id];
      return e ? { error: e } : null;
    }
  }

  // agent profile: personality / job description / department
  if (/personality|job description|role description|department|job title|\btitle\b|bio/.test(t)) {
    const agents = findAgents(doc, t, c2);
    if (!agents.length) return { clarify: { kind: 'clarify', question: 'Which agent should I update?', options: Object.values(doc.agents).slice(0, 6).map((a) => ({ label: a.identity.name, command: raw.replace(/\b(the|this|that) (agent|character)\b|\b(him|her|them|it)\b/i, a.identity.name) })) } };
    const a = agents[0]; acc.lastAgent = a.id;
    const patch: Record<string, unknown> = {};
    if (/personality/.test(t)) {
      const specific = personalityFromText(t, a.personality);
      if (specific) { patch.personality = specific; }
      else {
        const pick = PERSONALITY_PRESETS.find((p) => !p.patch.traits!.some((tr) => a.personality.traits.includes(tr))) ?? PERSONALITY_PRESETS[0];
        patch.personality = pick.patch; acc.notes.push(`Proposed personality: ${pick.name} (${pick.patch.traits!.join(', ')})`); acc.confirm = true;
      }
    }
    const deptM = /(?:to|into) the (\w+(?: \w+)?) (?:department|team)/.exec(t) ?? /department (?:to )?(\w+(?: \w+)?)/.exec(t);
    if (deptM) patch.identity = { ...(patch.identity as object), department: deptM[1].replace(/\b\w/g, (m) => m.toUpperCase()) };
    const titleM = /(?:job )?title (?:to )?["“]?([^"”]+)["”]?$/.exec(raw);
    if (titleM && /title/.test(t)) patch.identity = { ...(patch.identity as object), title: titleM[1].trim() };
    if (/job description|role description/.test(t)) {
      const draft = { ...a, identity: { ...a.identity, ...(patch.identity as object) } } as Agent;
      patch.identity = { ...(patch.identity as object), roleDescription: jobDescription(draft) };
      acc.notes.push('Drafted a new job description from the role, department and skills');
      acc.confirm = true;
    }
    if (!Object.keys(patch).length) return { error: 'Tell me what to change, e.g. “make ATLAS more formal”' };
    const e = push(acc, [{ op: 'agent.update', id: a.id, patch }]);
    acc.labels.push(`Update ${a.identity.name}'s profile`);
    return e ? { error: e } : null;
  }

  // appearance
  const look = /(make|change|turn|give|dress|put|update|switch|set)\b/.test(t);
  if (look) {
    const agents = findAgents(doc, t, c2);
    const base = agents[0] ?? (ctx.selection.kind === 'agent' ? doc.agents[ctx.selection.id] : undefined);
    const probe = appearanceFromText(t, (base ?? Object.values(doc.agents)[0])?.appearance ?? ({} as Appearance));
    if (Object.keys(probe.patch).length) {
      if (!base) return { clarify: { kind: 'clarify', question: 'Which character should I change? Select one in the office or pick:', options: Object.values(doc.agents).slice(0, 6).map((a) => ({ label: a.identity.name, command: raw.replace(/\b(this|that|the) (character|agent)\b|\b(him|her|them)\b/i, a.identity.name) })) } };
      acc.lastAgent = base.id;
      const { patch, notes } = appearanceFromText(t, base.appearance);
      const e = push(acc, [{ op: 'agent.update', id: base.id, patch: { appearance: patch } }]);
      if (e) return { error: e };
      acc.notes.push(`Appearance only: ${Object.entries(patch).map(([k, v]) => `${k} → ${v}`).join(', ')}`, ...notes, 'Name, role, personality, tasks and memories are unchanged');
      acc.labels.push(`Restyle ${base.identity.name}`);
      return null;
    }
    const pers = agents[0] ? personalityFromText(t, agents[0].personality) : null;
    if (pers && agents[0]) { const e = push(acc, [{ op: 'agent.update', id: agents[0].id, patch: { personality: pers } }]); acc.labels.push(`Update ${agents[0].identity.name}`); return e ? { error: e } : null; }
  }

  // tasks: "have ATLAS research X" / "assign X to ATLAS"
  const taskM = /^(?:have|ask|tell|assign)\s+(\w+)\s+(?:to\s+)?(.+)$/.exec(t);
  if (taskM) {
    const a = findAgents(doc, taskM[1], c2)[0];
    if (a) {
      const name = taskM[2].replace(/^(to|a task:?)\s+/, '');
      acc.rt.push({ op: 'task.create', agentId: a.id, name: name[0].toUpperCase() + name.slice(1), roomId: a.schedule.assignedRoomId, workstationId: a.schedule.preferredWorkstationId, simulated: true });
      acc.notes.push(`Queued “${name}” for ${a.identity.name} (runs in the simulator)`);
      acc.labels.push(`Task for ${a.identity.name}`); acc.lastAgent = a.id;
      return null;
    }
  }

  return { error: `I couldn't map “${raw}” to an editing operation.` };
}

export const EXAMPLES = [
  'Move the research room to the left of the main office',
  'Make the hallway wider and align it with the conference room entrance',
  'Create a private office for the lead agent',
  'Change this character into a realistic side-view mechanic wearing work clothes',
  'Give ATLAS a different personality and update its job description',
  'Move every idle agent to an available workstation',
  'Add a server room connected to the main corridor',
  'Undo the last layout change',
  'Block the east wing',
  'Send RUSTY to the break room',
];

export function interpret(command: string, ctx: ParseContext): Plan {
  const cmd = command.trim();
  if (!cmd) return { kind: 'unsupported', message: 'Type a command.', alternatives: EXAMPLES.slice(0, 3) };
  if (/^(help|\?|what can you do)/i.test(cmd)) return { kind: 'unsupported', message: 'I can edit rooms, hallways, furniture, agent profiles and appearance, and direct agents. Try one of these:', alternatives: EXAMPLES };
  const acc: Acc = { ops: [], rt: [], notes: [], confirm: false, doc: ctx.doc, lastRooms: [], lastAgent: null, labels: [] };
  for (const part of splitClauses(cmd)) {
    const r = clause(part, ctx, acc);
    if (r && 'clarify' in r) return r.clarify;
    if (r && 'error' in r) {
      if (acc.ops.length || acc.rt.length) { acc.notes.push(`Skipped: ${r.error}`); continue; }
      return { kind: 'unsupported', message: r.error, alternatives: EXAMPLES.slice(0, 4) };
    }
  }
  const geometric = acc.ops.some((o) => /^(room\.|door\.|corridor|rooms\.|furniture\.)/.test(o.op) || o.op === 'agent.delete');
  return { kind: 'plan', ops: acc.ops, runtimeOps: acc.rt, explanation: acc.notes, needsConfirm: acc.confirm || geometric || acc.ops.length > 3, label: `AI: ${acc.labels.join(', ') || 'changes'}` };
}
