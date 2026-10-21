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
    body: `${tasks.length} open task(s) will be returned to the unassigned queue. The agent's profile and ${a.memory.length} memory item(s) are removed from the brain. Undo restores the profile, but the tasks stay unassigned.`,
    onConfirm: () => {
      s.runRuntimeOps(tasks.map((t) => ({ op: 'task.update', id: t.id, patch: { agentId: null, status: 'queued' } })));
      s.commit([{ op: 'agent.delete', id }], `Delete ${a.identity.name}`);
      s.setUi({ selection: { kind: 'none' }, profileAgentId: null });
    },
  });
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
      if (mod && k === 's') { e.preventDefault(); s.saveNow(); return; }
      if (mod || e.altKey) return;
      if (k === 'escape') { s.setUi({ selection: { kind: 'none' } }); return; }
      if ((k === 'delete' || k === 'backspace') && s.selection.kind === 'agent') { e.preventDefault(); deleteAgent(s.selection.id); return; }
      if (k === '/') { e.preventDefault(); (document.getElementById('console-input') as HTMLInputElement | null)?.focus(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}
