// Types for the parts of money.mjs the tests use.
export const ETSY_LISTING_USD: number;
export function etsySaleFeesUsd(revenueUsd: number, orders: number): number;
export function salesFromOrders(orders: unknown[], publishRequests?: unknown[]): { id: string; orderId: string; productId: string; title: string; quantity: number; revenueUsd: number | null; costUsd: number; agentId: string | null }[];
export function moneyByAgent(s: Record<string, unknown>): Record<string, { claudeUsd: number; imageUsd: number; listingFeesUsd: number; productionUsd: number; saleFeesEstUsd: number; revenueUsd: number; manualIncomeUsd: number; manualExpenseUsd: number; orders: number; itemsSold: number; unpricedItems: number; listed: number }>;
