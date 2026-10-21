// Types for the parts of etsy.mjs the tests use.
export function searchListings(input: Record<string, unknown>, deps?: { config?: Record<string, unknown>; fetch?: unknown }): Promise<{ total: number; shown: number; medianPrice: number | null; listings: Record<string, unknown>[] }>;
export function authUrl(redirectUri: string): string | null;
