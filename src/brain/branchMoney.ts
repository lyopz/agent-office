// Money per main branch: everything an agent spent or earned counts toward the main branch it
// grew from (the agent under JARVIS at the top of its line). JARVIS's own spend is its own row.
import type { Agent } from '../model/types';
import type { MoneyRow } from './originLink';
import { ORIGIN_ID } from './opportunity';

export interface BranchMoney {
  id: string; name: string;
  claudeUsd: number; imageUsd: number; listingFeesUsd: number; productionUsd: number; saleFeesEstUsd: number; manualExpenseUsd: number;
  revenueUsd: number; manualIncomeUsd: number;
  spentUsd: number; earnedUsd: number; netUsd: number;
  orders: number; itemsSold: number; unpricedItems: number; listed: number;
}

/** The main branch an agent belongs to: JARVIS itself, the agent under JARVIS its line grew from, or null when it is gone. */
export function mainBranchOf(agents: Record<string, Agent>, id: string): string | null {
  if (id === ORIGIN_ID) return ORIGIN_ID;
  let cur = id;
  for (let i = 0; i < 50; i++) {
    const a = agents[cur];
    if (!a) return null;
    const up = a.skills.supervisorId;
    if (!up || up === ORIGIN_ID || !agents[up]) return cur;
    cur = up;
  }
  return cur;
}

const zero = (id: string, name: string): BranchMoney => ({ id, name, claudeUsd: 0, imageUsd: 0, listingFeesUsd: 0, productionUsd: 0, saleFeesEstUsd: 0, manualExpenseUsd: 0, revenueUsd: 0, manualIncomeUsd: 0, spentUsd: 0, earnedUsd: 0, netUsd: 0, orders: 0, itemsSold: 0, unpricedItems: 0, listed: 0 });

/**
 * One row per main branch, JARVIS first, then the branches by net, then sales no agent made
 * and agents that are no longer in the brain. Spent includes estimated Etsy sale fees; earned
 * is only real sales and the owner's own entries.
 */
export function moneyByBranch(agents: Record<string, Agent>, byAgent: Record<string, MoneyRow>): BranchMoney[] {
  const rows = new Map<string, BranchMoney>();
  const row = (id: string, name: string) => rows.get(id) ?? rows.set(id, zero(id, name)).get(id)!;
  row(ORIGIN_ID, agents[ORIGIN_ID]?.identity.name ?? 'JARVIS');
  for (const a of Object.values(agents)) if (a.id !== ORIGIN_ID && mainBranchOf(agents, a.id) === a.id) row(a.id, a.identity.name);
  for (const [id, m] of Object.entries(byAgent)) {
    const top = id === '' ? '' : mainBranchOf(agents, id);
    const r = top === '' ? row('', 'Sales no agent made') : top ? row(top, agents[top]?.identity.name ?? top) : row('gone', 'Agents no longer in the brain');
    for (const k of ['claudeUsd', 'imageUsd', 'listingFeesUsd', 'productionUsd', 'saleFeesEstUsd', 'manualExpenseUsd', 'revenueUsd', 'manualIncomeUsd', 'orders', 'itemsSold', 'unpricedItems', 'listed'] as const) r[k] += m[k] ?? 0;
  }
  for (const r of rows.values()) {
    r.spentUsd = r.claudeUsd + r.imageUsd + r.listingFeesUsd + r.productionUsd + r.saleFeesEstUsd + r.manualExpenseUsd;
    r.earnedUsd = r.revenueUsd + r.manualIncomeUsd;
    r.netUsd = r.earnedUsd - r.spentUsd;
  }
  const order = (r: BranchMoney) => (r.id === ORIGIN_ID ? 0 : r.id === '' || r.id === 'gone' ? 2 : 1);
  return [...rows.values()].sort((a, b) => order(a) - order(b) || b.netUsd - a.netUsd || a.name.localeCompare(b.name));
}
