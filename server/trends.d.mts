// Types for the parts of trends.mjs the app and tests use.
export const GOOGLE_TRENDS_TOOL: { name: string; description: string; input_schema: Record<string, unknown> };
export const ASSETS_TOOL: { name: string; description: string; input_schema: Record<string, unknown> };
export const TREND_TOOLS: { name: string }[];
export const COPYRIGHT_RULES: string;
export interface PublicAsset { title: string | null; creator: string | null; licence: string; source: string; page: string; file: string; preview: string | null; width?: number; height?: number; about: string | null }
export function commonsAssets(query: string, limit: number, deps?: { fetch?: unknown }): Promise<PublicAsset[]>;
export function openverseAssets(query: string, limit: number, deps?: { fetch?: unknown }): Promise<PublicAsset[]>;
export function publicDomainAssets(input: { query: string; limit?: number }, deps?: { fetch?: unknown }): Promise<{ query: string; licence_filter: string; items: PublicAsset[]; notes: string[]; note: string }>;
export const TREND_SOURCES: string;
export function trendTask(task: { title?: string; detail?: string } | null | undefined, agentName?: string): boolean;
export function parseTrendsRss(xml: string): { title: string; traffic: string | null; published: string | null; news: { title: string; source: string; url: string }[] }[];
export function googleTrends(input?: { geo?: string; limit?: number }, deps?: { fetch?: unknown }): Promise<{ source: string; url: string; fetchedAt: string; items: ReturnType<typeof parseTrendsRss> }>;
export function runTrendTool(name: string, input: Record<string, unknown>, deps?: { fetch?: unknown }): Promise<{ content: string; isError: boolean }>;
export const MEMES_TOOL: { name: string; description: string; input_schema: Record<string, unknown> };
export function trendTools(conn?: ReturnType<typeof trendsPublic>): { name: string; description: string; input_schema: Record<string, unknown> }[];
export function trendsPublic(): { google: boolean; memes: boolean; instagram: { configured: boolean; kind: 'instagram' | 'facebook' | null; hashtags: boolean; username: string | null; hashtagsLeft: number | null; expiresAt: string | null; renews: boolean; refreshedAt: string | null; refreshError: string | null }; pinterest: { configured: boolean; username: string | null; board: string | null; canSave: boolean; expiresAt: string | null; renews: boolean; refreshedAt: string | null; refreshError: string | null } };
export function trendSources(conn?: ReturnType<typeof trendsPublic>): string;
export function popularMemes(input?: Record<string, unknown>, deps?: { fetch?: unknown }): Promise<Record<string, unknown>>;
export const TRADEMARK_TOOL: { name: string; description: string; input_schema: Record<string, unknown> };
export function trademarkCheck(input: Record<string, unknown>, deps?: Record<string, unknown>): Promise<Record<string, unknown>>;
