// Money per agent, for each branch's spent and earned: Claude and image spend from the runner's
// own totals, Etsy listing fees for products the owner published, real sales from Printify orders
// on the connected shop, and the owner's own entries. Revenue is only ever what buyers paid
// (from orders) or what the owner typed in; estimates are only used for fees, and say so.

/** Etsy charges this to list an item (and again when it sells and auto-renews). */
export const ETSY_LISTING_USD = 0.2;
/** Etsy's transaction fee and US payment processing on a sale: an estimate, shown as one. */
export const etsySaleFeesUsd = (revenueUsd, orders) => revenueUsd * (0.065 + 0.03) + 0.25 * orders;
const cents = (n) => (Number.isFinite(Number(n)) ? Number(n) / 100 : 0);
const r2 = (n) => Math.round(n * 100) / 100;
const SKIP = new Set(['canceled', 'cancelled', 'payment-not-received', 'quality-declined']);

/**
 * Printify orders as sale lines, each filed under the agent that made the product (null when no
 * agent made it). What Printify charged (production, shipping, tax) is split over the order's
 * lines by their share of the price buyers paid.
 */
export function salesFromOrders(orders, publishRequests = []) {
  const byProduct = new Map(publishRequests.map((p) => [String(p.productId), p]));
  const lines = [];
  for (const o of orders || []) {
    if (!o || SKIP.has(String(o.status || '').toLowerCase())) continue;
    const items = Array.isArray(o.line_items) ? o.line_items : [];
    const paid = items.map((li) => (li.metadata?.price != null ? cents(li.metadata.price) * (Number(li.quantity) || 1) : null));
    const known = paid.reduce((x, v) => x + (v ?? 0), 0);
    const charged = cents(o.total_price) + cents(o.total_shipping) + cents(o.total_tax);
    const qty = items.reduce((x, li) => x + (Number(li.quantity) || 1), 0);
    items.forEach((li, i) => {
      const p = byProduct.get(String(li.product_id));
      // split by price when every line has one, else by quantity
      const share = paid.every((v) => v != null) && known > 0 ? paid[i] / known : (Number(li.quantity) || 1) / qty;
      lines.push({
        id: `${o.id}:${i}`, orderId: String(o.id), at: String(o.created_at || ''), status: String(o.status || ''),
        productId: String(li.product_id || ''), title: String(li.metadata?.title || p?.title || 'Item').slice(0, 140), quantity: Number(li.quantity) || 1,
        // null when Printify didn't report what the buyer paid: never guessed
        revenueUsd: paid[i] == null ? null : r2(paid[i]), costUsd: r2(charged * share),
        agentId: p?.agentId ?? null, agentName: p?.agentName ?? null,
      });
    });
  }
  return lines;
}

/** Spent and earned per agent id ('' for sales no agent made). */
export function moneyByAgent(s) {
  const out = {};
  const row = (id) => (out[id ?? ''] ??= { claudeUsd: 0, imageUsd: 0, listingFeesUsd: 0, productionUsd: 0, saleFeesEstUsd: 0, revenueUsd: 0, manualIncomeUsd: 0, manualExpenseUsd: 0, orders: 0, itemsSold: 0, unpricedItems: 0, listed: 0 });
  for (const [id, usd] of Object.entries(s.totals?.claude || {})) row(id).claudeUsd += usd;
  for (const [id, usd] of Object.entries(s.totals?.images || {})) row(id).imageUsd += usd;
  for (const p of s.publishRequests || []) if (p.status === 'published') { const x = row(p.agentId); x.listingFeesUsd += ETSY_LISTING_USD; x.listed++; }
  const orders = {};
  for (const l of s.sales || []) {
    const x = row(l.agentId);
    x.productionUsd += l.costUsd; x.itemsSold += l.quantity;
    if (l.revenueUsd == null) x.unpricedItems += l.quantity; else x.revenueUsd += l.revenueUsd;
    // a sold listing renews automatically on Etsy
    x.listingFeesUsd += ETSY_LISTING_USD * l.quantity;
    (orders[l.agentId ?? ''] ??= new Set()).add(l.orderId);
  }
  for (const [id, set] of Object.entries(orders)) { out[id].orders = set.size; out[id].saleFeesEstUsd = etsySaleFeesUsd(out[id].revenueUsd, set.size); }
  for (const m of s.moneyEntries || []) { const x = row(m.agentId); if (m.kind === 'income') x.manualIncomeUsd += m.usd; else x.manualExpenseUsd += m.usd; }
  for (const x of Object.values(out)) for (const k of Object.keys(x)) if (k.endsWith('Usd')) x[k] = Math.round(x[k] * 1e4) / 1e4;
  return out;
}
