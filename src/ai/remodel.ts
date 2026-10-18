// Remodelling commands for the object library: place, replace, arrange and
// restyle objects in plain English. Each handler returns ops computed against
// the current layout, so the console can preview them and undo is one step.
import type { Furniture, FurnitureMaterial, FurnitureType, OfficeDoc, Room, RoomType } from '../model/types';
import { FURNITURE_TYPES } from '../model/types';
import { FURNITURE_META, MATERIAL_COLOR } from '../model/catalog';
import { applyOps, type DocOp } from '../engine/ops';
import { findObjectSpot } from '../engine/spatial';
import { uid } from '../model/defaults';

export type RemodelResult = null | { ops: DocOp[]; label: string; notes: string[] } | { error: string } | { clarify: { question: string; options: { label: string; command: string }[] } };

const STOP = new Set(['a', 'an', 'the', 'new', 'another', 'some', 'every', 'each', 'all', 'of', 'with', 'my', 'our', 'to', 'in', 'into']);
const singular = (w: string) => (w.length > 3 && w.endsWith('es') && /(ch|sh|x)es$/.test(w) ? w.slice(0, -2) : w.length > 3 && w.endsWith('s') && !w.endsWith('ss') ? w.slice(0, -1) : w);
const toks = (s: string) => s.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w && !STOP.has(w)).map(singular);

const ALIASES: Record<string, FurnitureType> = { workstation: 'desk', 'executive desk': 'exec-desk', 'exec desk': 'exec-desk', 'command desk': 'exec-desk', 'server rack': 'server-rack', 'tube': 'tube-station', 'pneumatic tube': 'tube-station', monitor: 'monitors', 'holo desk': 'holo-desk', 'hologram desk': 'holo-desk' };
const MATERIALS: [RegExp, FurnitureMaterial][] = [[/black titanium/, 'black-titanium'], [/titanium/, 'titanium'], [/graphite/, 'graphite'], [/walnut|wood/, 'walnut'], [/white composite|white/, 'white-composite'], [/brass|gold/, 'brass']];
const QUALIFIER_ROOM: [RegExp, RoomType][] = [[/librar/, 'library'], [/research/, 'research'], [/exec|president/, 'executive'], [/engineer/, 'engineering'], [/financ|cfo/, 'finance'], [/design/, 'design'], [/studio|creative/, 'studio'], [/market/, 'market'], [/server/, 'server'], [/break|lounge/, 'break']];
const MATERIAL_WORDS = new Set(['black', 'titanium', 'graphite', 'walnut', 'wood', 'white', 'composite', 'brass', 'gold', 'wider', 'wide', 'larger', 'bigger', 'smaller', 'narrower']);

/** Best object type for a phrase like "librarian archive terminal" or "plants". */
export function objectType(phrase: string): FurnitureType | null {
  const p = phrase.toLowerCase().trim();
  for (const [k, v] of Object.entries(ALIASES)) if (new RegExp(`\\b${k}s?$`).test(p)) return v;
  const ws = toks(p).filter((w) => !MATERIAL_WORDS.has(w));
  if (!ws.length) return null;
  const noun = ws[ws.length - 1];
  let best: FurnitureType | null = null, bestScore = 0;
  for (const t of FURNITURE_TYPES) {
    const label = new Set([...toks(FURNITURE_META[t].label), ...t.split('-')]);
    if (!label.has(noun)) continue;
    const score = ws.filter((w) => label.has(w)).length * 10 - label.size; // prefer the tightest label
    if (score > bestScore) { best = t; bestScore = score; }
  }
  return best;
}

function material(t: string): FurnitureMaterial | undefined { for (const [re, m] of MATERIALS) if (re.test(t)) return m; return undefined; }
const label = (f: Pick<Furniture, 'type' | 'label' | 'workstation'>) => f.label ?? f.workstation?.name ?? FURNITURE_META[f.type]?.label ?? f.type;

function roomsByText(doc: OfficeDoc, text: string, findRooms: (doc: OfficeDoc, t: string) => Room[]): Room[] {
  const named = findRooms(doc, text);
  if (named.length) return named;
  for (const [re, type] of QUALIFIER_ROOM) if (re.test(text)) { const r = Object.values(doc.rooms).filter((x) => x.type === type); if (r.length) return r; }
  return [];
}

const WALL: Record<string, 'n' | 's' | 'e' | 'w'> = { back: 'n', rear: 'n', north: 'n', top: 'n', front: 's', south: 's', bottom: 's', left: 'w', west: 'w', right: 'e', east: 'e' };

export function remodel(t: string, doc0: OfficeDoc, selectedRooms: Room[], findRooms: (doc: OfficeDoc, t: string) => Room[]): RemodelResult {
  let doc = doc0;
  const ops: DocOp[] = []; const notes: string[] = [];
  const add = (o: DocOp[]) => { const r = applyOps(doc, o); if (r.errors.length) return r.errors[0]; doc = r.doc; ops.push(...o); notes.push(...r.summary); return null; };
  const scopeRooms = (text: string) => {
    if (/\b(everywhere|every room|all rooms|whole office|entire office|office-wide|throughout)\b/.test(text)) return Object.values(doc.rooms);
    const r = roomsByText(doc, text, findRooms); return r.length ? r : selectedRooms;
  };

  // 1. "add a librarian archive terminal against the back wall [of the library]"
  let m = /^(?:add|put|place|install|mount)\s+(?:a |an |another )?(.+?)\s+(?:against|along|on|by)\s+the\s+(back|rear|front|left|right|north|south|east|west|top|bottom)\s+wall(?:\s+(?:of|in)\s+(?:the\s+)?(.+))?$/.exec(t);
  if (m) {
    const type = objectType(m[1]); if (!type) return { error: `I don't know an object called “${m[1]}”. Open the object library to browse them.` };
    const room = roomsByText(doc, `${m[3] ?? ''} ${m[1]}`, findRooms)[0] ?? selectedRooms[0];
    if (!room) return { clarify: { question: `Which room should the ${FURNITURE_META[type].label.toLowerCase()} go in?`, options: Object.values(doc.rooms).slice(0, 6).map((r) => ({ label: r.name, command: `${m![0]} of the ${r.name}` })) } };
    const side = WALL[m[2]];
    const rotation = side === 'e' || side === 'w' ? 90 : 0;
    const spot = findObjectSpot(doc, room, type, { wall: side, rotation }) ?? findObjectSpot(doc, room, type, { wall: side });
    if (!spot) return { error: `There's no free space on the ${m[2]} wall of ${room.name}` };
    const e = add([{ op: 'furniture.add', roomId: room.id, type, x: spot.x, y: spot.y, rotation: spot.rotation }]); if (e) return { error: e };
    return { ops, label: `Add ${FURNITURE_META[type].label}`, notes: [`${FURNITURE_META[type].label} against the ${m[2]} wall of ${room.name}`] };
  }

  // 2. "add a tube station beside every research desk"
  m = /^(?:add|put|place|install)\s+(?:a |an )?(.+?)\s+(?:beside|next to|by|near|alongside)\s+(?:every|each|all(?: the)?)\s+(.+?)$/.exec(t);
  if (m) {
    const type = objectType(m[1]); if (!type) return { error: `I don't know an object called “${m[1]}”.` };
    const targetPhrase = m[2];
    const targetType = objectType(targetPhrase);
    const qualRooms = roomsByText(doc, targetPhrase, findRooms);
    const wsOnly = /\b(desk|workstation)s?\b/.test(targetPhrase);
    const targets = Object.values(doc.furniture).filter((f) => {
      if (wsOnly) { if (FURNITURE_META[f.type]?.fn !== 'workstation') return false; }
      else if (targetType && f.type !== targetType) return false;
      return !qualRooms.length || qualRooms.some((r) => r.id === f.roomId) || (targetType != null && f.type === targetType && !wsOnly);
    });
    if (!targets.length) return { error: `I couldn't find any ${targetPhrase} in this office` };
    let placed = 0, skipped = 0;
    for (const f of targets) {
      const room = doc.rooms[f.roomId];
      const already = Object.values(doc.furniture).some((o) => o.roomId === f.roomId && o.type === type && Math.abs(o.x - f.x) + Math.abs(o.y - f.y) <= 3);
      if (already) { skipped++; continue; }
      const spot = findObjectSpot(doc, room, type, { near: { x: f.x + f.w, y: f.y } });
      if (!spot || add([{ op: 'furniture.add', roomId: room.id, type, x: spot.x, y: spot.y }])) { skipped++; continue; }
      placed++;
    }
    if (!placed) return { error: skipped ? `Every ${targetPhrase} already has a ${FURNITURE_META[type].label.toLowerCase()} nearby` : 'No free space beside those objects' };
    return { ops, label: `Add ${placed} ${FURNITURE_META[type].label}${placed > 1 ? 's' : ''}`, notes: [`Placed ${placed} ${FURNITURE_META[type].label.toLowerCase()}${placed > 1 ? 's' : ''} beside ${targets.length} ${targetPhrase}${skipped ? `; ${skipped} skipped (already had one or no space)` : ''}`] };
  }

  // 3. "replace the executive desk with a wider black titanium desk"
  m = /^(?:replace|swap|upgrade)\s+(?:the\s+|my\s+)?(.+?)\s+(?:with|for)\s+(?:a |an )?(.+)$/.exec(t);
  if (m) {
    const fromType = objectType(m[1]);
    let toType = objectType(m[2]) ?? fromType;
    // "a wider black titanium desk" names a style, not a new kind: keep the executive desk an executive desk
    const kindWords = toks(m[2]).filter((w) => !MATERIAL_WORDS.has(w) && w !== 'dark' && w !== 'light');
    if (fromType && kindWords.length <= 1 && new Set([...toks(FURNITURE_META[fromType].label), ...fromType.split('-')]).has(kindWords[0] ?? '')) toType = fromType;
    if (!fromType || !toType) return null;
    const rooms = roomsByText(doc, m[1], findRooms);
    const cands = Object.values(doc.furniture).filter((f) => f.type === fromType && (!rooms.length || rooms.some((r) => r.id === f.roomId)));
    const f = cands[0] ?? Object.values(doc.furniture).find((x) => x.type === fromType);
    if (!f) return { error: `There's no ${m[1]} to replace` };
    const room = doc.rooms[f.roomId];
    const meta = FURNITURE_META[toType];
    let w = toType === f.type ? f.w : meta.w; const h = toType === f.type ? f.h : meta.h;
    if (/\b(wider|wide|larger|bigger)\b/.test(m[2])) w += 1;
    if (/\b(narrower|smaller)\b/.test(m[2])) w = Math.max(1, w - 1);
    const mat = material(m[2]);
    // keep the same id so workstation assignments and agents' desks are preserved
    let x = f.x;
    const rot = f.rotation === 90 || f.rotation === 270;
    if (x + (rot ? h : w) > room.w) x = Math.max(0, room.w - (rot ? h : w));
    const patch: Partial<Furniture> = { type: toType, w, h, x, ...(mat ? { material: mat, color: MATERIAL_COLOR[mat] ?? f.color } : {}) };
    const e = add([{ op: 'furniture.update', id: f.id, patch }]); if (e) return { error: e };
    return { ops, label: `Replace ${label(f)}`, notes: [`Replaced ${label(f)} with a ${w}×${h} ${mat ? mat.replace('-', ' ') + ' ' : ''}${meta.label.toLowerCase()}; its assignment${f.workstation?.assignedAgentId ? ` to ${doc.agents[f.workstation.assignedAgentId]?.identity.name}` : ''} is kept`] };
  }

  // 5. "make the lighting warmer and the floor dark graphite [in the library]"
  if (/\b(lighting|lights?|floor|walls?)\b/.test(t) && /\b(warm|warmer|cool|cooler|cold|brighter|dimmer|darker|lighter|graphite|carpet|wood|tile|metal|marble|concrete|colou?r|navy|black|white)\b/.test(t) && /^(make|set|change|turn|use|give|paint)\b/.test(t)) {
    const inM = /\b(?:in|for|of)\s+(?:the\s+)?([a-z ]+?)(?:\s+room)?$/.exec(t);
    const rooms = scopeRooms(inM ? inM[1] : t);
    const targets = rooms.length ? rooms : Object.values(doc.rooms);
    const changes: string[] = [];
    for (const r of targets) {
      const ap: Partial<Room['appearance']> = {};
      if (/warm/.test(t)) { ap.lightTemp = Math.max(2400, (r.appearance.lightTemp ?? 4500) - 1200); }
      if (/cool|cold/.test(t)) ap.lightTemp = Math.min(6500, (r.appearance.lightTemp ?? 4500) + 1200);
      if (/brighter/.test(t)) ap.lighting = Math.min(1, r.appearance.lighting + 0.2);
      if (/dimmer/.test(t)) ap.lighting = Math.max(0, r.appearance.lighting - 0.2);
      const floorM = /floor\s+(?:to\s+|in\s+)?(?:a\s+)?([a-z ]+?)(?:\s+and\b|$)/.exec(t);
      if (floorM) {
        const f = floorM[1];
        if (/graphite/.test(f)) { ap.floor = 'metal'; ap.floorColor = /dark/.test(f) ? '#1b1c1f' : '#2a2c30'; }
        else if (/carpet/.test(f)) ap.floor = 'carpet'; else if (/wood/.test(f)) ap.floor = 'wood'; else if (/tile|marble/.test(f)) ap.floor = 'tile'; else if (/metal|steel/.test(f)) ap.floor = 'metal'; else if (/concrete|plain/.test(f)) ap.floor = 'plain';
        if (/navy/.test(f)) ap.floorColor = '#0d1830'; else if (/black/.test(f)) ap.floorColor = '#111214'; else if (/white/.test(f)) ap.floorColor = '#d9dde0';
      }
      if (Object.keys(ap).length) { const e = add([{ op: 'room.update', id: r.id, patch: { appearance: ap } }]); if (e) return { error: e }; }
    }
    if (/warm/.test(t)) changes.push('warmer lighting'); if (/cool|cold/.test(t)) changes.push('cooler lighting');
    if (/floor/.test(t)) changes.push('new floor');
    if (!ops.length) return null;
    return { ops, label: 'Restyle rooms', notes: [`${changes.join(' and ') || 'Restyled'} in ${targets.length === Object.keys(doc.rooms).length ? 'every room' : targets.map((r) => r.name).join(', ')}`] };
  }

  // 6. "arrange the desks in two aligned rows [in the research lab]"
  m = /^(?:arrange|line up|organi[sz]e|lay out)\s+(?:the\s+|all\s+)?(.+?)\s+(?:in|into)\s+(one|two|three|four|\d+)\s+(?:aligned\s+|neat\s+|even\s+)?rows?(?:\s+in\s+(?:the\s+)?(.+))?$/.exec(t);
  if (m) {
    const n = ({ one: 1, two: 2, three: 3, four: 4 } as Record<string, number>)[m[2]] ?? Number(m[2]);
    const type = objectType(m[1]);
    const wsOnly = /\b(desk|workstation)s?\b/.test(m[1]);
    const rooms = m[3] ? roomsByText(doc, m[3], findRooms) : selectedRooms.length ? selectedRooms : Object.values(doc.rooms);
    let total = 0;
    for (const r of rooms) {
      const ids = Object.values(doc.furniture).filter((f) => f.roomId === r.id && (wsOnly ? FURNITURE_META[f.type]?.fn === 'workstation' : f.type === type)).map((f) => f.id);
      if (ids.length < 2) continue;
      const e = add([{ op: 'furniture.arrange', ids, rows: n }]); if (e) { notes.push(`${r.name}: ${e}`); continue; }
      total += ids.length;
    }
    if (!total) return { error: `I couldn't find two or more ${m[1]} to arrange${m[3] ? ` in ${m[3]}` : ''}` };
    return { ops, label: `Arrange ${m[1]} in ${n} rows`, notes };
  }

  // 7. "add plants without blocking doors [in every room]"
  m = /^(?:add|put|place)\s+(?:some\s+|a few\s+)?(plants?|lamps?|floor lights?|sculptures?)(?:\s+(?:to|in|around)\s+(?:the\s+)?(.+?))?(?:\s+(?:without|but don't|not)\s+block(?:ing)?\s+(?:the\s+|any\s+)?doors?)?(?:\s+(?:to|in|around)\s+(?:the\s+)?(.+?))?$/.exec(t);
  if (m && (/without|block/.test(t) || /\bplants\b/.test(m[1]))) {
    const type = objectType(m[1])!;
    const where = m[2] ?? m[3];
    const rooms = where ? scopeRooms(where) : selectedRooms.length ? selectedRooms : Object.values(doc.rooms);
    let placed = 0;
    for (const r of rooms) {
      for (const corner of [{ x: 0, y: 0 }, { x: r.w - 1, y: r.h - 1 }]) {
        const spot = findObjectSpot(doc, r, type, { near: corner });
        if (spot && Math.abs(spot.x - corner.x) + Math.abs(spot.y - corner.y) <= Math.max(r.w, r.h) / 2) { if (!add([{ op: 'furniture.add', roomId: r.id, type, x: spot.x, y: spot.y, id: uid('fur') }])) placed++; }
      }
    }
    if (!placed) return { error: 'No free corners that keep doorways clear' };
    return { ops, label: `Add ${placed} ${FURNITURE_META[type].label.toLowerCase()}s`, notes: [`Placed ${placed} ${FURNITURE_META[type].label.toLowerCase()}${placed > 1 ? 's' : ''} in ${rooms.length} room${rooms.length > 1 ? 's' : ''}, keeping every doorway clear`] };
  }
  return null;
}
