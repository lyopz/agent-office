// Money per branch: real sales from Printify orders, never guessed revenue, fees shown as estimates.
import { describe, expect, test } from 'vitest';
import { moneyByAgent, salesFromOrders, ETSY_LISTING_USD } from '../server/money.mjs';

const order = { id: 'o1', status: 'fulfilled', created_at: '2026-10-21', total_price: 1200, total_shipping: 400, total_tax: 0, line_items: [
  { product_id: 'p1', quantity: 2, metadata: { title: 'Cat Mug', price: 1800 } },
  { product_id: 'p9', quantity: 1, metadata: { title: 'Old Tee' } },
] };

describe('money', () => {
  test('each sale line goes to the agent that made the product; unknown prices stay unknown', () => {
    const lines = salesFromOrders([order, { ...order, id: 'o2', status: 'canceled' }], [{ productId: 'p1', agentId: 'a1', agentName: 'Designer' }]);
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatchObject({ agentId: 'a1', revenueUsd: 36, quantity: 2, costUsd: 10.67 });
    expect(lines[1]).toMatchObject({ agentId: null, revenueUsd: null, costUsd: 5.33 });
  });

  test('spent and earned per agent: Claude, images, listing fees, production, estimated sale fees, owner entries', () => {
    const s = {
      totals: { claude: { a1: 0.5 }, images: { a1: 0.1 } },
      publishRequests: [{ productId: 'p1', agentId: 'a1', status: 'published' }, { productId: 'p2', agentId: 'a1', status: 'waiting' }],
      sales: salesFromOrders([order], [{ productId: 'p1', agentId: 'a1' }]),
      moneyEntries: [{ agentId: 'a1', kind: 'income', usd: 10 }, { agentId: 'a1', kind: 'expense', usd: 2 }],
    };
    const m = moneyByAgent(s).a1;
    expect(m).toMatchObject({ claudeUsd: 0.5, imageUsd: 0.1, revenueUsd: 36, productionUsd: 10.67, manualIncomeUsd: 10, manualExpenseUsd: 2, orders: 1, itemsSold: 2, listed: 1 });
    expect(m.listingFeesUsd).toBeCloseTo(ETSY_LISTING_USD * 3, 6);
    expect(m.saleFeesEstUsd).toBeCloseTo(36 * 0.095 + 0.25, 4);
    expect(moneyByAgent(s)['']).toMatchObject({ unpricedItems: 1, revenueUsd: 0 });
  });
});
