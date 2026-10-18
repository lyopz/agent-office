// Shared knowledge library. Agents check it before starting research so work
// isn't repeated, and sensitive entries are only readable by allowed agents.
import type { KnowledgeEntry, OfficeDoc } from '../model/types';

export function canRead(e: KnowledgeEntry, agentId: string | null) {
  return !e.sensitive || (agentId != null && e.allowedAgentIds.includes(agentId));
}

const STOP = new Set(['the', 'a', 'an', 'of', 'and', 'for', 'to', 'in', 'on', 'new', 'run', 'review', 'with']);
const words = (s: string) => s.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 2 && !STOP.has(w));

/** Entries relevant to a query that this agent may read, best first. */
export function searchLibrary(doc: OfficeDoc, query: string, agentId: string | null, limit = 5): { entry: KnowledgeEntry; score: number }[] {
  const q = new Set(words(query)); if (!q.size) return [];
  const out: { entry: KnowledgeEntry; score: number }[] = [];
  for (const e of Object.values(doc.library)) {
    if (!canRead(e, agentId)) continue;
    const hay = [...words(e.title), ...words(e.topic), ...e.tags.flatMap(words)];
    let score = 0; for (const w of hay) if (q.has(w)) score++;
    if (score) out.push({ entry: e, score: score + e.confidence });
  }
  return out.sort((a, b) => b.score - a.score).slice(0, limit);
}

/** A near-duplicate entry already in the library (same topic and overlapping title). */
export function findDuplicate(doc: OfficeDoc, title: string, topic: string): KnowledgeEntry | null {
  const t = new Set(words(title));
  for (const e of Object.values(doc.library)) {
    if (e.topic.toLowerCase() !== topic.toLowerCase()) continue;
    const w = words(e.title); const shared = w.filter((x) => t.has(x)).length;
    if (shared >= Math.max(1, Math.min(t.size, w.length) - 1)) return e;
  }
  return null;
}
