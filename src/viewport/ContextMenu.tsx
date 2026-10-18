import { useEffect, useRef } from 'react';
import { useStore } from '../store/store';
import { findFreeSpot } from '../engine/ops';
import type { Point } from '../model/types';
import { confirmAction } from '../ui/primitives';

export type MenuTarget =
  | { kind: 'room'; id: string } | { kind: 'corridor'; id: string } | { kind: 'furniture'; id: string }
  | { kind: 'agent'; id: string } | { kind: 'canvas'; at: Point };

interface Item { label: string; run: () => void; danger?: boolean; disabled?: boolean }

export function ContextMenu({ x, y, target, onClose }: { x: number; y: number; target: MenuTarget; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const s = useStore.getState();
  const doc = useStore((st) => st.doc);
  useEffect(() => {
    ref.current?.querySelector('button')?.focus();
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onClose]);

  const items: Item[] = [];
  const focusInspector = (field?: string) => setTimeout(() => (document.querySelector(field ? `[data-field="${field}"]` : '.inspector input') as HTMLInputElement | null)?.focus(), 30);
  if (target.kind === 'room') {
    const r = doc.rooms[target.id];
    if (!r) return null;
    items.push(
      { label: 'Rename', run: () => focusInspector('room-name') },
      { label: 'Resize…', run: () => { s.setUi({ mode: 'construct' }); focusInspector('room-w'); } },
      { label: 'Duplicate', run: () => s.commit([{ op: 'room.duplicate', id: r.id }], `Duplicate ${r.name}`) },
      { label: 'Connect hallway…', run: () => s.setUi({ tool: 'hallway', mode: 'construct', hallwayDraft: { roomId: r.id, doorId: '' } }) },
      { label: 'Change appearance', run: () => focusInspector('room-floor') },
      { label: 'Assign agent…', run: () => focusInspector('room-assign') },
      { label: 'Delete room', danger: true, run: () => {
        const hallways = Object.values(doc.corridors).filter((c) => [c.start, c.end].some((e) => e.kind === 'door' && e.roomId === r.id)).length;
        confirmAction({ title: `Delete ${r.name}?`, danger: true, confirmLabel: 'Delete room',
          body: `This removes its ${r.furnitureIds.length} furniture item(s)${hallways ? ` and ${hallways} connected hallway(s)` : ''}. Assigned agents become unassigned and walk elsewhere. You can undo this.`,
          onConfirm: () => s.commit([{ op: 'room.delete', id: r.id, cascade: true }], `Delete ${r.name}`) });
      } },
    );
  } else if (target.kind === 'corridor') {
    const c = doc.corridors[target.id];
    if (!c) return null;
    items.push(
      { label: 'Widen (+1)', run: () => s.commit([{ op: 'corridor.update', id: c.id, patch: { width: c.width + 1 } }], `Widen ${c.name}`) },
      { label: 'Narrow (−1)', run: () => s.commit([{ op: 'corridor.update', id: c.id, patch: { width: c.width - 1 } }], `Narrow ${c.name}`), disabled: c.width <= doc.settings.minCorridorWidth },
      { label: c.routing === 'auto' ? 'Switch to manual routing' : 'Return to automatic routing', run: () => s.commit([{ op: 'corridor.update', id: c.id, patch: { routing: c.routing === 'auto' ? 'manual' : 'auto' } }], `${c.name} routing`) },
      { label: c.blocked ? 'Reopen hallway' : 'Block hallway', run: () => s.commit([{ op: 'corridor.update', id: c.id, patch: { blocked: !c.blocked } }], c.blocked ? `Reopen ${c.name}` : `Block ${c.name}`) },
      { label: c.isMain ? 'Unmark main corridor' : 'Mark as main corridor', run: () => s.commit([{ op: 'corridor.update', id: c.id, patch: { isMain: !c.isMain } }], `${c.name} main flag`) },
      { label: 'Delete hallway', danger: true, run: () => s.commit([{ op: 'corridor.delete', id: c.id }], `Delete ${c.name}`) },
    );
  } else if (target.kind === 'furniture') {
    const f = doc.furniture[target.id];
    if (!f) return null;
    items.push(
      { label: 'Rotate 90°', run: () => s.commit([{ op: 'furniture.update', id: f.id, patch: { rotation: (((f.rotation + 90) % 360) as 0 | 90 | 180 | 270) } }], 'Rotate furniture') },
      { label: f.workstation ? 'Remove workstation role' : 'Make workstation', run: () => s.commit([{ op: 'furniture.update', id: f.id, patch: { workstation: f.workstation ? null : { name: `${doc.rooms[f.roomId]?.name ?? ''} Station` } } }], 'Workstation') },
      { label: 'Delete', danger: true, run: () => s.commit([{ op: 'furniture.delete', id: f.id }], 'Delete furniture') },
    );
  } else if (target.kind === 'agent') {
    const a = doc.agents[target.id];
    if (!a) return null;
    items.push(
      { label: 'Open profile', run: () => s.setUi({ profileAgentId: a.id, profileTab: 'identity' }) },
      { label: 'Change appearance', run: () => s.setUi({ profileAgentId: a.id, profileTab: 'appearance' }) },
      ...Object.values(doc.rooms).slice(0, 12).map((r) => ({ label: `Go to ${r.name}`, run: () => s.notify(s.runRuntimeOps([{ op: 'agent.goTo', agentId: a.id, roomId: r.id }])[0]) })),
      { label: a.enabled ? 'Pause agent' : 'Resume agent', run: () => s.commit([{ op: 'agent.update', id: a.id, patch: { enabled: !a.enabled } }], a.enabled ? `Pause ${a.identity.name}` : `Resume ${a.identity.name}`) },
    );
  } else {
    const at = target.at;
    items.push(
      { label: 'Create room here', run: () => { const p = findFreeSpot(doc, { x: at.x, y: at.y, w: 8, h: 6 }); s.commit([{ op: 'room.create', type: 'custom', x: p.x, y: p.y, w: 8, h: 6, name: `Room ${Object.keys(doc.rooms).length + 1}` }], 'Create room'); } },
      ...doc.roomTemplates.slice(0, 6).map((t) => ({ label: `Insert ${t.name}`, run: () => { const p = findFreeSpot(doc, { x: at.x, y: at.y, w: t.w, h: t.h }); s.commit([{ op: 'room.create', type: t.type, templateId: t.id, x: p.x, y: p.y, w: t.w, h: t.h }], `Insert ${t.name}`); } })),
      { label: 'Realign hallways', run: () => s.commit([{ op: 'corridors.realign' }], 'Realign hallways') },
    );
  }

  return (
    <div ref={ref} className="ctx-menu" style={{ left: x, top: y }} role="menu" onPointerDown={(e) => e.stopPropagation()}>
      {items.map((it) => (
        <button key={it.label} role="menuitem" disabled={it.disabled} className={it.danger ? 'danger' : ''} onClick={() => { it.run(); onClose(); }}>{it.label}</button>
      ))}
    </div>
  );
}
