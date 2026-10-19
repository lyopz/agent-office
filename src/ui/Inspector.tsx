import { AlertTriangle, Copy, Navigation, Trash2, Wrench, XCircle } from 'lucide-react';
import { useState } from 'react';
import { GAME_META } from '../arcade/types';
import type { GameId } from '../model/types';
import { useArcade } from './ArcadeHost';
import { useStore } from '../store/store';
import { FURNITURE_TYPES, ROOM_TYPES, type Corridor, type CorridorEndpoint, type Furniture, type OfficeDoc, type Room } from '../model/types';
import { FURNITURE_META, ROOM_META, furniturePreset, uid } from '../model/defaults';
import type { DocOp } from '../engine/ops';
import { findFreeSpot } from '../engine/ops';
import { Character } from '../characters/Character';
import { STATUS_COLOR } from '../viewport/AgentsLayer';
import { ChipsInput, ColorField, NumberField, Section, SelectField, TextField, Toggle } from './primitives';
import { deleteSelection } from './actions';
import { centerOn } from './AgentPanel';

const ACCENTS = ['#39ff88', '#4cc9ff', '#ff9f43', '#b57bff', '#ff5d73', '#ffd166', '#8fa89a'];

function endpointLabel(doc: OfficeDoc, e: CorridorEndpoint) {
  if (e.kind === 'door') { const r = doc.rooms[e.roomId]; const d = r?.doors.find((x) => x.id === e.doorId); return r ? `${r.name} · ${d ? `${d.side.toUpperCase()} door` : 'missing door'}` : 'missing room'; }
  return `Joins ${doc.corridors[e.corridorId]?.name ?? 'missing hallway'}`;
}

function corridorRooms(doc: OfficeDoc, c: Corridor): string[] {
  return [c.start, c.end].flatMap((e) => (e.kind === 'door' ? [doc.rooms[e.roomId]?.name ?? '?'] : [`(${doc.corridors[e.corridorId]?.name ?? '?'})`]));
}

function RoomInspector({ room }: { room: Room }) {
  const doc = useStore((s) => s.doc);
  const { commit } = useStore.getState();
  const up = (patch: Extract<DocOp, { op: 'room.update' }>['patch'], label = `Edit ${room.name}`) => commit([{ op: 'room.update', id: room.id, patch }], label);
  const halls = Object.values(doc.corridors).filter((c) => [c.start, c.end].some((e) => e.kind === 'door' && e.roomId === room.id));
  const furniture = room.furnitureIds.map((id) => doc.furniture[id]).filter(Boolean);
  const [assign, setAssign] = useState('');
  return (
    <>
      <Section title="Room" actions={<><button className="btn icon sm" title="Duplicate room" aria-label="Duplicate room" onClick={() => commit([{ op: 'room.duplicate', id: room.id }], `Duplicate ${room.name}`)}><Copy size={13} /></button><button className="btn icon sm danger" title="Delete room" aria-label="Delete room" onClick={deleteSelection}><Trash2 size={13} /></button></>}>
        <TextField label="Name" field="room-name" value={room.name} onCommit={(name) => up({ name }, 'Rename room')} />
        <div className="field-row">
          <SelectField label="Type" value={room.type} options={ROOM_TYPES.map((t) => ({ value: t, label: ROOM_META[t].label }))} onChange={(type) => up({ type })} />
          <SelectField label="Special" value={room.special ?? 'none'} options={['none', 'restores-energy', 'quiet-zone', 'restricted']} onChange={(v) => up({ special: v === 'none' ? undefined : v })} />
        </div>
        <TextField label="Purpose" value={room.purpose} onCommit={(purpose) => up({ purpose })} />
        <div className="field-row" style={{ ['--cols' as string]: 4 }}>
          <NumberField label="X" value={room.x} onCommit={(x) => up({ x }, `Move ${room.name}`)} field="room-x" />
          <NumberField label="Y" value={room.y} onCommit={(y) => up({ y }, `Move ${room.name}`)} />
          <NumberField label="W" value={room.w} min={3} max={80} onCommit={(w) => up({ w }, `Resize ${room.name}`)} field="room-w" />
          <NumberField label="H" value={room.h} min={3} max={80} onCommit={(h) => up({ h }, `Resize ${room.name}`)} />
        </div>
      </Section>
      <Section title="Appearance">
        <div className="field-row">
          <SelectField label="Floor" field="room-floor" value={room.appearance.floor} options={['grid', 'tile', 'carpet', 'metal', 'wood', 'plain'] as const} onChange={(floor) => up({ appearance: { floor } })} />
          <SelectField label="Walls" value={room.walls.style} options={['solid', 'glass'] as const} onChange={(style) => up({ walls: { style } })} />
        </div>
        <ColorField label="Accent" value={room.appearance.accent} swatches={ACCENTS} onChange={(accent) => up({ appearance: { accent } })} />
        <ColorField label="Wall colour" value={room.appearance.wallColor} swatches={['#1f6f45', '#235a7a', '#6b3f1c', '#4b2d6b', '#2c3a33']} onChange={(wallColor) => up({ appearance: { wallColor } })} />
        <NumberField label="Lighting (0–1)" value={room.appearance.lighting} min={0} max={1} step={0.1} onCommit={(lighting) => up({ appearance: { lighting } })} />
      </Section>
      <Section title={`Doors (${room.doors.length})`} actions={<button className="btn sm" onClick={() => commit([{ op: 'door.add', roomId: room.id, side: 's', offset: 1, width: 2 }], 'Add door')}>+ Door</button>}>
        {room.doors.map((d) => (
          <div key={d.id} className="field-row" style={{ ['--cols' as string]: 4, alignItems: 'end' }}>
            <SelectField label="Side" value={d.side} options={['n', 's', 'e', 'w'] as const} onChange={(side) => commit([{ op: 'door.update', roomId: room.id, doorId: d.id, patch: { side } }], 'Move door')} />
            <NumberField label="Offset" value={d.offset} min={0} onCommit={(offset) => commit([{ op: 'door.update', roomId: room.id, doorId: d.id, patch: { offset } }], 'Move door')} />
            <NumberField label="Width" value={d.width} min={1} max={6} onCommit={(width) => commit([{ op: 'door.update', roomId: room.id, doorId: d.id, patch: { width } }], 'Resize door')} />
            <button className="btn sm danger" style={{ marginBottom: 8 }} onClick={() => { useStore.getState().setUi({ selection: { kind: 'door', roomId: room.id, doorId: d.id } }); deleteSelection(); }}>Remove</button>
          </div>
        ))}
      </Section>
      <Section title={`Connections (${halls.length})`}>
        {halls.length === 0 && <p className="note">Not connected. Use the hallway tool (H) or the AI console to connect this room.</p>}
        {halls.map((c) => <div key={c.id} className="row small" style={{ padding: '3px 0' }}><span className="dot" style={{ color: c.status === 'ok' ? 'var(--accent)' : 'var(--danger)' }} /><button className="btn ghost sm grow" style={{ justifyContent: 'flex-start' }} onClick={() => useStore.getState().setUi({ selection: { kind: 'corridor', id: c.id } })}>{c.name}</button><span className="muted">{corridorRooms(doc, c).filter((n) => n !== room.name).join(', ')}</span></div>)}
      </Section>
      <Section title={`Assigned agents (${room.assignedAgentIds.length})`}>
        <div className="chips">{room.assignedAgentIds.map((id) => doc.agents[id] && <span key={id} className="chip">{doc.agents[id].identity.name}<button aria-label="Unassign" onClick={() => commit([{ op: 'agent.assignRoom', agentId: id, roomId: null }], 'Unassign agent')}>×</button></span>)}</div>
        <div className="row" style={{ marginTop: 6 }}>
          <select aria-label="Assign agent" data-field="room-assign" value={assign} onChange={(e) => setAssign(e.target.value)}><option value="">Assign agent…</option>{Object.values(doc.agents).filter((a) => !room.assignedAgentIds.includes(a.id)).map((a) => <option key={a.id} value={a.id}>{a.identity.name}</option>)}</select>
          <button className="btn sm" disabled={!assign} onClick={() => { commit([{ op: 'agent.assignRoom', agentId: assign, roomId: room.id }], 'Assign agent'); setAssign(''); }}>Assign</button>
        </div>
      </Section>
      <Section title={`Furniture (${furniture.length})`} actions={<button className="btn sm" title="Add the default furniture set for this room type" onClick={() => commit(furniturePreset(room.type, room.w, room.h).map((f) => ({ op: 'furniture.add', roomId: room.id, type: f.type, x: f.x, y: f.y, workstationName: f.workstation?.name })), 'Apply furniture preset')}>Preset</button>}>
        {furniture.map((f) => <div key={f.id} className="row small" style={{ padding: '2px 0' }}><button className="btn ghost sm grow" style={{ justifyContent: 'flex-start' }} onClick={() => useStore.getState().setUi({ selection: { kind: 'furniture', id: f.id } })}>{f.workstation ? `▣ ${f.workstation.name}` : FURNITURE_META[f.type].label}</button><span className="muted mono-num">{f.x},{f.y}</span></div>)}
        <button className="btn sm" style={{ marginTop: 6 }} onClick={() => {
          const tpl = { id: uid('tpl'), name: `${room.name} template`, type: room.type, w: room.w, h: room.h, appearance: { ...room.appearance }, furniture: furniture.map(({ id: _i, roomId: _r, ...rest }) => ({ ...rest, workstation: rest.workstation ? { ...rest.workstation, assignedAgentId: null } : undefined })) };
          if (commit([{ op: 'template.saveRoom', template: tpl }], 'Save room template').ok) useStore.getState().notify(`Saved template “${tpl.name}”`);
        }}>Save as template</button>
      </Section>
    </>
  );
}

function CorridorInspector({ c }: { c: Corridor }) {
  const doc = useStore((s) => s.doc);
  const { commit } = useStore.getState();
  const up = (patch: Extract<DocOp, { op: 'corridor.update' }>['patch'], label = `Edit ${c.name}`) => commit([{ op: 'corridor.update', id: c.id, patch }], label);
  const mode = doc.settings.hallwayMode;
  return (
    <>
      <Section title="Hallway" actions={<button className="btn icon sm danger" aria-label="Delete hallway" title="Delete hallway" onClick={deleteSelection}><Trash2 size={13} /></button>}>
        <TextField label="Name" value={c.name} onCommit={(name) => up({ name })} />
        <div className="field-row">
          <NumberField label="Width (cells)" value={c.width} min={doc.settings.minCorridorWidth} max={8} onCommit={(width) => up({ width }, `Width of ${c.name}`)} />
          <SelectField label="Routing" value={c.routing} options={[{ value: 'auto', label: 'Automatic' }, { value: 'manual', label: 'Manual' }] as const} onChange={(routing) => up({ routing }, `${c.name} routing`)} />
        </div>
        {mode !== 'hybrid' && <p className="note warn">Office hallway mode is <b>{mode}</b>, which overrides this hallway's own routing setting.</p>}
        {c.routing === 'manual' && <button className="btn sm primary" onClick={() => up({ routing: 'auto' }, `Return ${c.name} to automatic`)}>Return to automatic routing</button>}
        <div className="row wrap" style={{ marginTop: 8 }}>
          <Toggle label="Main corridor (hybrid: kept manual)" checked={c.isMain} onChange={(isMain) => up({ isMain })} />
          <Toggle label="Blocked" checked={c.blocked} onChange={(blocked) => up({ blocked }, blocked ? `Block ${c.name}` : `Reopen ${c.name}`)} />
        </div>
      </Section>
      <Section title="Route">
        <div className="kv">
          <span>Status</span><span style={{ color: c.status === 'ok' ? 'var(--accent)' : c.status === 'warning' ? 'var(--warn)' : 'var(--danger)' }}>{c.status}{c.statusMessage ? ` — ${c.statusMessage}` : ''}</span>
          <span>Start</span><span>{endpointLabel(doc, c.start)}</span>
          <span>End</span><span>{endpointLabel(doc, c.end)}</span>
          <span>Rooms</span><span>{corridorRooms(doc, c).join(' ↔ ')}</span>
          <span>Segments</span><span>{Math.max(0, c.points.length - 1)} ({c.points.length - 2 > 0 ? `${c.points.length - 2} turn(s)` : 'straight'})</span>
        </div>
        <p className="note">In Construct mode drag the blue segment handles to edit the route by hand; ends stay attached to their doorways.</p>
        <details><summary className="small muted">Route points</summary>
          {c.points.map((p, i) => (
            <div key={i} className="field-row" style={{ ['--cols' as string]: 2 }}>
              <NumberField label={`P${i} x`} value={p.x} onCommit={(x) => up({ points: c.points.map((q, j) => (j === i ? { ...q, x } : q)) }, 'Edit route point')} />
              <NumberField label={`P${i} y`} value={p.y} onCommit={(y) => up({ points: c.points.map((q, j) => (j === i ? { ...q, y } : q)) }, 'Edit route point')} />
            </div>
          ))}
        </details>
        <button className="btn sm" style={{ marginTop: 6 }} onClick={() => commit([{ op: 'corridors.realign' }], 'Realign hallways')}>Realign hallways</button>
      </Section>
    </>
  );
}

function FurnitureInspector({ f }: { f: Furniture }) {
  const doc = useStore((s) => s.doc);
  const { commit } = useStore.getState();
  const up = (patch: Extract<DocOp, { op: 'furniture.update' }>['patch'], label = 'Edit furniture') => commit([{ op: 'furniture.update', id: f.id, patch }], label);
  const ws = f.workstation;
  return (
    <>
      <Section title={ws ? 'Workstation' : 'Furniture'} actions={<button className="btn icon sm danger" aria-label="Delete" onClick={deleteSelection}><Trash2 size={13} /></button>}>
        <div className="field-row">
          <SelectField label="Type" value={f.type} options={FURNITURE_TYPES.map((t) => ({ value: t, label: FURNITURE_META[t].label }))} onChange={(type) => up({ type, w: FURNITURE_META[type].w, h: FURNITURE_META[type].h })} />
          <SelectField label="Room" value={f.roomId} options={Object.values(doc.rooms).map((r) => ({ value: r.id, label: r.name }))} onChange={(roomId) => up({ roomId, x: 1, y: 1 }, 'Move furniture')} />
        </div>
        <div className="field-row" style={{ ['--cols' as string]: 4 }}>
          <NumberField label="X" value={f.x} min={0} onCommit={(x) => up({ x }, 'Move furniture')} />
          <NumberField label="Y" value={f.y} min={0} onCommit={(y) => up({ y }, 'Move furniture')} />
          <NumberField label="W" value={f.w} min={1} max={10} onCommit={(w) => up({ w }, 'Resize furniture')} />
          <NumberField label="H" value={f.h} min={1} max={10} onCommit={(h) => up({ h }, 'Resize furniture')} />
        </div>
        <div className="field-row">
          <SelectField label="Rotation" value={String(f.rotation) as '0'} options={['0', '90', '180', '270'] as const} onChange={(r) => up({ rotation: Number(r) as 0 }, 'Rotate furniture')} />
          <ColorField label="Colour" value={f.color} onChange={(color) => up({ color })} />
        </div>
        <Toggle label="Blocks movement" checked={f.blocking} onChange={(blocking) => up({ blocking })} />
        {!ws && !f.arcade && <div style={{ marginTop: 8 }}><button className="btn sm" onClick={() => up({ workstation: { name: `${doc.rooms[f.roomId]?.name ?? ''} Station` } }, 'Make workstation')}>Make workstation</button></div>}
      </Section>
      {f.type === 'arcade-cabinet' && (
        <Section title="Arcade machine">
          <SelectField label="Game" value={f.arcade?.game ?? 'pong'} options={(Object.keys(GAME_META) as GameId[]).map((g) => ({ value: g, label: GAME_META[g].title }))} onChange={(game) => up({ arcade: { game, theme: f.arcade?.theme ?? 'neon' } }, 'Change arcade game')} />
          <SelectField label="Screen theme" value={(f.arcade?.theme ?? 'neon') as 'neon'} options={['neon', 'classic', 'synthwave', 'mono'] as const} onChange={(theme) => up({ arcade: { game: f.arcade?.game ?? 'pong', theme } }, 'Arcade theme')} />
          <button className="btn sm primary" onClick={() => useArcade.getState().open(f.arcade?.game ?? 'pong')}>Play {GAME_META[f.arcade?.game ?? 'pong'].title}</button>
          <p className="note">For you only. Agents can’t be sent to or assigned this machine; attempts are blocked and logged.</p>
        </Section>
      )}
      {ws && (
        <Section title="Workstation">
          <TextField label="Name" value={ws.name} onCommit={(name) => up({ workstation: { name } })} />
          <SelectField label="Assigned agent" value={ws.assignedAgentId ?? ''} options={[{ value: '', label: 'Unassigned' }, ...Object.values(doc.agents).map((a) => ({ value: a.id, label: a.identity.name }))]} onChange={(v) => commit([{ op: 'workstation.assign', furnitureId: f.id, agentId: v || null }], 'Assign workstation')} />
          <SelectField label="Status" value={ws.status} options={['online', 'offline', 'maintenance'] as const} onChange={(status) => up({ workstation: { status } })} />
          <ChipsInput label="Equipment" values={ws.equipment} onChange={(equipment) => up({ workstation: { equipment } })} />
          <ChipsInput label="Connected services" values={ws.services} onChange={(services) => up({ workstation: { services } })} />
          <button className="btn sm" onClick={() => up({ workstation: null }, 'Remove workstation role')}>Remove workstation role</button>
        </Section>
      )}
    </>
  );
}

function AgentInspector({ id }: { id: string }) {
  const doc = useStore((s) => s.doc);
  const a = doc.agents[id];
  const r = useStore((s) => s.runtime.agents[id]);
  const task = useStore((s) => (r?.currentTaskId ? s.runtime.tasks[r.currentTaskId] : undefined));
  const { setUi, commit, runRuntimeOps, notify } = useStore.getState();
  const [dest, setDest] = useState('');
  const [taskName, setTaskName] = useState('');
  if (!a) return null;
  return (
    <>
      <Section title="Agent">
        <div className="row" style={{ alignItems: 'flex-start' }}>
          <div className="portrait" style={{ width: 72, height: 72, borderColor: a.appearance.accent }}><Character a={a.appearance} view="portrait" size={72} /></div>
          <div className="grow">
            <div className="agent-name" style={{ fontSize: 16 }}>{a.identity.name}</div>
            <div className="muted small">{a.identity.title} · {a.identity.department}</div>
            <div className="status" style={{ color: STATUS_COLOR[r?.status ?? 'idle'], marginTop: 4 }}><i className="dot" />{r?.status}{r?.statusMessage ? ` — ${r.statusMessage}` : ''}</div>
          </div>
        </div>
        <div className="kv" style={{ marginTop: 8 }}>
          <span>Location</span><span>{r?.roomId ? doc.rooms[r.roomId]?.name : 'Hallway'}</span>
          <span>Assigned room</span><span>{a.schedule.assignedRoomId ? doc.rooms[a.schedule.assignedRoomId]?.name : '—'}</span>
          <span>Workstation</span><span>{a.schedule.preferredWorkstationId ? doc.furniture[a.schedule.preferredWorkstationId]?.workstation?.name : '—'}</span>
          <span>Current task</span><span>{task ? `${task.name} (${Math.round(task.progress)}%)${task.simulated ? ' · simulated' : ''}` : '—'}</span>
          <span>Energy</span><span>{Math.round(r?.energy ?? 0)}%</span>
        </div>
        <div className="row wrap" style={{ marginTop: 8 }}>
          <button className="btn sm primary" onClick={() => setUi({ profileAgentId: id, profileTab: 'identity' })}>Open full profile</button>
          <button className="btn sm" onClick={() => setUi({ profileAgentId: id, profileTab: 'appearance' })}>Appearance</button>
          <button className="btn sm" onClick={() => r && centerOn(r.pos.x, r.pos.y)}>Locate</button>
          <button className="btn sm" onClick={() => commit([{ op: 'agent.update', id, patch: { enabled: !a.enabled } }], a.enabled ? `Pause ${a.identity.name}` : `Resume ${a.identity.name}`)}>{a.enabled ? 'Pause' : 'Resume'}</button>
        </div>
      </Section>
      <Section title="Go to room">
        <div className="row">
          <select aria-label="Destination room" value={dest} onChange={(e) => setDest(e.target.value)}><option value="">Choose room…</option>{Object.values(doc.rooms).map((rm) => <option key={rm.id} value={rm.id}>{rm.name}</option>)}</select>
          <button className="btn sm" disabled={!dest} onClick={() => notify(runRuntimeOps([{ op: 'agent.goTo', agentId: id, roomId: dest }])[0])}><Navigation size={13} />Go</button>
        </div>
      </Section>
      <Section title="Quick task">
        <div className="row">
          <input type="text" placeholder="Task name" value={taskName} onChange={(e) => setTaskName(e.target.value)} aria-label="Task name" />
          <button className="btn sm" disabled={!taskName.trim()} onClick={() => { runRuntimeOps([{ op: 'task.create', agentId: id, name: taskName.trim(), roomId: a.schedule.assignedRoomId, workstationId: a.schedule.preferredWorkstationId }]); setTaskName(''); }}>Assign</button>
        </div>
        <p className="note">Tasks run in the simulator unless a live provider is connected and the agent uses it.</p>
      </Section>
    </>
  );
}

function OfficeInspector() {
  const doc = useStore((s) => s.doc);
  const { commit } = useStore.getState();
  return (
    <>
      <Section title="Office">
        <div className="kv">
          <span>Rooms</span><span>{Object.keys(doc.rooms).length}</span>
          <span>Hallways</span><span>{Object.keys(doc.corridors).length}</span>
          <span>Furniture</span><span>{Object.keys(doc.furniture).length}</span>
          <span>Agents</span><span>{Object.keys(doc.agents).length}</span>
        </div>
        <div className="field-row" style={{ marginTop: 8 }}>
          <NumberField label="Default hall width" value={doc.settings.defaultCorridorWidth} min={1} max={6} onCommit={(v) => commit([{ op: 'settings.update', patch: { defaultCorridorWidth: v } }], 'Office settings')} />
          <NumberField label="Min hall width" value={doc.settings.minCorridorWidth} min={1} max={4} onCommit={(v) => commit([{ op: 'settings.update', patch: { minCorridorWidth: v } }], 'Office settings')} />
        </div>
        <Toggle label="Enforce layout boundary (80×60)" checked={!!doc.settings.bounds} onChange={(on) => commit([{ op: 'settings.update', patch: { bounds: on ? { x: -10, y: -10, w: 80, h: 60 } : null } }], 'Layout boundary')} />
        <p className="note" style={{ marginTop: 8 }}>Click a room, hallway, desk or agent to inspect it. Right-click for actions. Switch to <b>Construct</b> (B) to move and resize.</p>
      </Section>
      <Section title="Room templates">
        <div style={{ display: 'grid', gap: 4 }}>
          {doc.roomTemplates.map((t) => (
            <div key={t.id} className="row small"><span className="dot" style={{ color: t.appearance.accent }} /><span className="grow">{t.name}</span><span className="muted">{t.w}×{t.h}</span>
              <button className="btn sm" onClick={() => { const p = findFreeSpot(doc, { x: 0, y: 0, w: t.w, h: t.h }); commit([{ op: 'room.create', type: t.type, templateId: t.id, x: p.x, y: p.y, w: t.w, h: t.h }], `Insert ${t.name}`); }}>Insert</button></div>
          ))}
        </div>
      </Section>
    </>
  );
}

export function IssuesList() {
  const issues = useStore((s) => s.issues);
  const { commit, setUi } = useStore.getState();
  const doc = useStore((s) => s.doc);
  const select = (ids: string[]) => {
    const room = ids.find((i) => doc.rooms[i]); const cor = ids.find((i) => doc.corridors[i]);
    if (room) setUi({ selection: { kind: 'room', ids: [room] } }); else if (cor) setUi({ selection: { kind: 'corridor', id: cor } });
  };
  return (
    <Section title={`Validation (${issues.length})`}>
      {issues.length === 0 && <p className="note">No problems: rooms don't overlap, hallways connect, every room is reachable.</p>}
      {issues.slice(0, 30).map((i) => (
        <div key={i.id} className={`issue ${i.severity}`}>
          <span className="ico">{i.severity === 'error' ? <XCircle size={13} /> : <AlertTriangle size={13} />}</span>
          <div>
            <button className="btn ghost sm msg" style={{ padding: 0, height: 'auto', whiteSpace: 'normal', textAlign: 'left' }} onClick={() => select(i.objectIds)}>{i.message}</button>
            {i.fix && <div><button className="btn sm" style={{ marginTop: 3 }} onClick={() => commit(i.fix!.ops, i.fix!.label)}><Wrench size={12} />{i.fix.label}</button></div>}
          </div>
        </div>
      ))}
    </Section>
  );
}

export function Inspector() {
  const selection = useStore((s) => s.selection);
  const doc = useStore((s) => s.doc);
  let body: React.ReactNode = <OfficeInspector />;
  let title = 'Office inspector';
  if (selection.kind === 'room') {
    if (selection.ids.length === 1 && doc.rooms[selection.ids[0]]) { body = <RoomInspector room={doc.rooms[selection.ids[0]]} />; title = 'Room inspector'; }
    else if (selection.ids.length > 1) { title = `${selection.ids.length} rooms`; body = <Section title="Multi-select"><p className="note">Drag any selected room to move them together; spacing is preserved. Use the align and distribute tools in the toolbar.</p><div className="chips">{selection.ids.map((id) => <span key={id} className="chip">{doc.rooms[id]?.name}</span>)}</div></Section>; }
  } else if (selection.kind === 'corridor' && doc.corridors[selection.id]) { body = <CorridorInspector c={doc.corridors[selection.id]} />; title = 'Hallway inspector'; }
  else if (selection.kind === 'furniture' && doc.furniture[selection.id]) { body = <FurnitureInspector f={doc.furniture[selection.id]} />; title = doc.furniture[selection.id].workstation ? 'Workstation inspector' : 'Furniture inspector'; }
  else if (selection.kind === 'agent' && doc.agents[selection.id]) { body = <AgentInspector id={selection.id} />; title = 'Agent inspector'; }
  else if (selection.kind === 'door') {
    const room = doc.rooms[selection.roomId]; const d = room?.doors.find((x) => x.id === selection.doorId);
    if (room && d) { title = 'Door inspector'; body = <Section title={`Door on ${room.name}`} actions={<button className="btn icon sm danger" aria-label="Delete door" onClick={deleteSelection}><Trash2 size={13} /></button>}><div className="field-row" style={{ ['--cols' as string]: 3 }}><SelectField label="Side" value={d.side} options={['n', 's', 'e', 'w'] as const} onChange={(side) => useStore.getState().commit([{ op: 'door.update', roomId: room.id, doorId: d.id, patch: { side } }], 'Move door')} /><NumberField label="Offset" value={d.offset} min={0} onCommit={(offset) => useStore.getState().commit([{ op: 'door.update', roomId: room.id, doorId: d.id, patch: { offset } }], 'Move door')} /><NumberField label="Width" value={d.width} min={1} max={6} onCommit={(width) => useStore.getState().commit([{ op: 'door.update', roomId: room.id, doorId: d.id, patch: { width } }], 'Resize door')} /></div><p className="note">Drag the orange handle along the wall in Construct mode. Connected hallways follow the door.</p></Section>; }
  }
  return (
    <aside className="panel right inspector" aria-label="Inspector">
      <div className="panel-h">{title}</div>
      {body}
      <IssuesList />
    </aside>
  );
}
