// Each main branch adds up the money of every agent that grew from it.
import { describe, expect, test } from 'vitest';
import { mainBranchOf, moneyByBranch } from '../src/brain/branchMoney';
import { ORIGIN_ID } from '../src/brain/opportunity';

const ag = (id: string, sup: string | null, name = id) => ({ id, identity: { name }, skills: { supervisorId: sup } }) as any;
const agents = { [ORIGIN_ID]: ag(ORIGIN_ID, null, 'JARVIS'), v1: ag('v1', ORIGIN_ID, 'Etsy Store'), s1: ag('s1', 'v1', 'SEO'), s2: ag('s2', 's1', 'Sub'), v2: ag('v2', ORIGIN_ID, 'Roblox') };
const m = (o: object) => ({ claudeUsd: 0, imageUsd: 0, listingFeesUsd: 0, productionUsd: 0, saleFeesEstUsd: 0, revenueUsd: 0, manualIncomeUsd: 0, manualExpenseUsd: 0, orders: 0, itemsSold: 0, unpricedItems: 0, listed: 0, ...o });

describe('money by branch', () => {
  test('agents count toward the main branch they grew from', () => {
    expect(mainBranchOf(agents, 's2')).toBe('v1');
    expect(mainBranchOf(agents, 'v2')).toBe('v2');
    expect(mainBranchOf(agents, ORIGIN_ID)).toBe(ORIGIN_ID);
    expect(mainBranchOf(agents, 'gone')).toBeNull();
  });

  test('spent, earned and net per branch; JARVIS first, then by net', () => {
    const rows = moneyByBranch(agents, { v1: m({ claudeUsd: 1 }), s2: m({ imageUsd: 0.5, revenueUsd: 40, productionUsd: 15 }), [ORIGIN_ID]: m({ claudeUsd: 2 }), x: m({ claudeUsd: 0.1 }), '': m({ revenueUsd: 5 }) });
    expect(rows.map((r) => r.id)).toEqual([ORIGIN_ID, 'v1', 'v2', '', 'gone']);
    expect(rows[1]).toMatchObject({ name: 'Etsy Store', spentUsd: 16.5, earnedUsd: 40, netUsd: 23.5 });
    expect(rows[0]).toMatchObject({ spentUsd: 2, earnedUsd: 0 });
  });
});
