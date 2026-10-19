// 2D operations overview: every room grouped by team with who works there and
// what it connects to. Pick a room to inspect it on the plan or enter it in 3D.
import { useMemo, useState } from 'react';
import { Box, ChevronDown, ChevronUp, Crosshair } from 'lucide-react';
import { useStore } from '../store/store';
import { roomTeam } from '../engine/autosort';
import { setHqView } from './HqSwitch';
import { G } from '../viewport/OfficeLayers';

const KEY = 'agent-office:overview-open';
const readOpen = () => { try { return localStorage.getItem(KEY) !== '0'; } catch { return true; } };

export function OverviewPanel() {
  const doc = useStore((s) => s.doc);
  const selected = useStore((s) => (s.selection.kind === 'room' && s.selection.ids.length === 1 ? s.selection.ids[0] : null));
  const [open, setOpen] = useState(readOpen);
  const toggle = () => { setOpen(!open); try { localStorage.setItem(KEY, open ? '0' : '1'); } catch { /* fine */ } };

  const teams = useMemo(() => {
    const links = new Map<string, Set<string>>();
    for (const c of Object.values(doc.corridors)) {
      if (c.start.kind !== 'door' || c.end.kind !== 'door') continue;
      const a = c.start.roomId, b = c.end.roomId;
      (links.get(a) ?? links.set(a, new Set()).get(a)!).add(b);
      (links.get(b) ?? links.set(b, new Set()).get(b)!).add(a);
    }
    const by = new Map<string, { id: string; name: string; accent: string; agents: number; links: string[] }[]>();
    for (const r of Object.values(doc.rooms)) {
      const t = roomTeam(doc, r);
      const agents = Object.values(doc.agents).filter((a) => a.schedule.assignedRoomId === r.id).length;
      (by.get(t) ?? by.set(t, []).get(t)!).push({ id: r.id, name: r.name, accent: r.appearance.accent, agents, links: [...(links.get(r.id) ?? [])].map((id) => doc.rooms[id]?.name).filter(Boolean) as string[] });
    }
    return [...by.entries()].sort((p, q) => q[1].length - p[1].length || p[0].localeCompare(q[0]));
  }, [doc]);

  const inspect = (id: string) => {
    const s = useStore.getState(); const r = s.doc.rooms[id]; if (!r) return;
    const z = s.camera.zoom;
    const el = document.querySelector('.viewport');
    const w = el?.clientWidth ?? 900, h = el?.clientHeight ?? 600;
    s.setUi({ selection: { kind: 'room', ids: [id] }, camera: { zoom: z, x: w / 2 - (r.x + r.w / 2) * G * z, y: h / 2 - (r.y + r.h / 2) * G * z } });
  };

  return (
    <aside className={`overview-panel${open ? '' : ' closed'}`} aria-label="Operations overview">
      <header className="row">
        <strong>Operations</strong>
        <span className="small muted">{Object.keys(doc.rooms).length} rooms · {teams.length} teams</span>
        <span className="spacer" />
        {selected && doc.rooms[selected] && <button className="btn sm primary" onClick={() => setHqView('3d', selected)} title="Walk into this room in the 3D headquarters"><Box size={13} />Enter {doc.rooms[selected].name}</button>}
        <button className="btn icon sm" aria-expanded={open} aria-label={open ? 'Collapse overview' : 'Expand overview'} onClick={toggle}>{open ? <ChevronDown size={14} /> : <ChevronUp size={14} />}</button>
      </header>
      {open && (
        <div className="overview-teams">
          {teams.map(([team, rooms]) => (
            <section key={team}>
              <h4>{team}</h4>
              <ul>
                {rooms.map((r) => (
                  <li key={r.id} className={selected === r.id ? 'sel' : undefined}>
                    <i style={{ background: r.accent }} aria-hidden />
                    <span className="ov-name">{r.name}<small className="muted"> · {r.agents} agent{r.agents === 1 ? '' : 's'}{r.links.length ? ` · links ${r.links.slice(0, 3).join(', ')}${r.links.length > 3 ? '…' : ''}` : ''}</small></span>
                    <button className="btn icon sm" aria-label={`Inspect ${r.name}`} title="Inspect on the plan" onClick={() => inspect(r.id)}><Crosshair size={13} /></button>
                    <button className="btn icon sm" aria-label={`Enter ${r.name} in 3D`} title="Enter in 3D" onClick={() => setHqView('3d', r.id)}><Box size={13} /></button>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </aside>
  );
}
