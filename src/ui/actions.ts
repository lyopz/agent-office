import { useEffect } from 'react';
import { useStore } from '../store/store';
import { confirmAction } from './primitives';

export function deleteAgent(id: string) {
  const s = useStore.getState();
  const a = s.doc.agents[id];
  if (!a) return;
  const tasks = Object.values(s.runtime.tasks).filter((t) => t.agentId === id && (t.status === 'queued' || t.status === 'active' || t.status === 'paused'));
  confirmAction({
    title: `Delete ${a.identity.name}?`, danger: true, confirmLabel: 'Delete agent',
    body: `${tasks.length} open task(s) will be returned to the unassigned queue. The agent's profile, ${a.memory.length} memory item(s) and appearance are removed from this office; its workstation becomes free. Undo restores the profile, but the tasks stay unassigned.`,
    onConfirm: () => {
      s.runRuntimeOps(tasks.map((t) => ({ op: 'task.update', id: t.id, patch: { agentId: null, status: 'queued' } })));
      s.commit([{ op: 'agent.delete', id }], `Delete ${a.identity.name}`);
      s.setUi({ selection: { kind: 'none' }, profileAgentId: null });
    },
  });
}

export function deleteSelection() {
  const s = useStore.getState();
  const sel = s.selection;
  if (sel.kind === 'room') {
    const names = sel.ids.map((id) => s.doc.rooms[id]?.name).join(', ');
    const furn = sel.ids.reduce((t, id) => t + (s.doc.rooms[id]?.furnitureIds.length ?? 0), 0);
    const halls = Object.values(s.doc.corridors).filter((c) => [c.start, c.end].some((e) => e.kind === 'door' && sel.ids.includes(e.roomId))).length;
    confirmAction({
      title: `Delete ${names}?`, danger: true, confirmLabel: 'Delete',
      body: `This removes ${furn} furniture item(s)${halls ? ` and ${halls} connected hallway(s)` : ''}. Assigned agents become unassigned. You can undo this.`,
      onConfirm: () => { s.commit(sel.ids.map((id) => ({ op: 'room.delete', id, cascade: true })), `Delete ${names}`); s.setUi({ selection: { kind: 'none' } }); },
    });
  } else if (sel.kind === 'corridor') { s.commit([{ op: 'corridor.delete', id: sel.id }], 'Delete hallway'); s.setUi({ selection: { kind: 'none' } }); }
  else if (sel.kind === 'furniture') { s.commit([{ op: 'furniture.delete', id: sel.id }], 'Delete furniture'); s.setUi({ selection: { kind: 'none' } }); }
  else if (sel.kind === 'door') {
    const r = s.commit([{ op: 'door.delete', roomId: sel.roomId, doorId: sel.doorId }], 'Delete door', { silent: true });
    if (!r.ok && r.errors.length) {
      confirmAction({ title: 'Door is in use', confirmLabel: 'Delete door and hallway', danger: true, body: r.errors[0], onConfirm: () => s.commit([{ op: 'door.delete', roomId: sel.roomId, doorId: sel.doorId, cascade: true }], 'Delete door') });
    } else s.setUi({ selection: { kind: 'none' } });
  } else if (sel.kind === 'agent') deleteAgent(sel.id);
}

export function useShortcuts() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.closest('input, textarea, select, [contenteditable="true"]')) return;
      const s = useStore.getState();
      const mod = e.ctrlKey || e.metaKey;
      const k = e.key.toLowerCase();
      if (mod && k === 'z') { e.preventDefault(); if (e.shiftKey) s.redo(); else s.undo(); return; }
      if (mod && k === 'y') { e.preventDefault(); s.redo(); return; }
      if (mod && k === 's') { e.preventDefault(); s.save(); s.notify('Saved'); return; }
      if (mod && k === 'd') {
        e.preventDefault();
        if (s.selection.kind === 'room') s.commit(s.selection.ids.map((id) => ({ op: 'room.duplicate', id })), 'Duplicate room');
        if (s.selection.kind === 'agent') s.commit([{ op: 'agent.duplicate', id: s.selection.id }], 'Duplicate agent');
        return;
      }
      if (mod || e.altKey) return;
      if (k === 'escape') { s.setUi({ selection: { kind: 'none' }, tool: 'select', hallwayDraft: null, preview: null }); return; }
      if (k === 'delete' || k === 'backspace') { if (s.mode === 'construct' || s.selection.kind === 'agent') { e.preventDefault(); deleteSelection(); } return; }
      if (k.startsWith('arrow') && s.selection.kind === 'room' && s.mode === 'construct') {
        e.preventDefault();
        const n = e.shiftKey ? 5 : 1;
        const d = { arrowleft: [-n, 0], arrowright: [n, 0], arrowup: [0, -n], arrowdown: [0, n] }[k]!;
        s.commit(s.selection.ids.map((id) => ({ op: 'room.update', id, patch: { x: s.doc.rooms[id].x + d[0], y: s.doc.rooms[id].y + d[1] } })), 'Nudge room');
        return;
      }
      const tools: Record<string, string> = { v: 'select', r: 'room', h: 'hallway', d: 'door', f: 'furniture', k: 'workstation', n: 'agent' };
      if (tools[k]) { if (k !== 'v') s.setUi({ mode: 'construct' }); s.setUi({ tool: tools[k] as never, hallwayDraft: null }); return; }
      if (k === 'b') { s.setUi({ mode: s.mode === 'construct' ? 'simulate' : 'construct', tool: 'select' }); return; }
      if (k === 'g') { s.setLayer('grid', !s.layers.grid); return; }
      if (k === 's' && e.shiftKey) { s.setLayer('snap', !s.layers.snap); return; }
      if (k === 'p') { s.setLayer('paths', !s.layers.paths); return; }
      if (k === '0') { window.dispatchEvent(new Event('ao-fit')); return; }
      if (k === '=' || k === '+') { s.setUi({ camera: { ...s.camera, zoom: Math.min(3, s.camera.zoom * 1.2) } }); return; }
      if (k === '-') { s.setUi({ camera: { ...s.camera, zoom: Math.max(0.2, s.camera.zoom / 1.2) } }); return; }
      if (k === '/' ) { e.preventDefault(); (document.getElementById('console-input') as HTMLInputElement | null)?.focus(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}
