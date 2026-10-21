export function pinterestConfig(): Record<string, unknown> | null;
export function savePinterest(cfg: Record<string, unknown>): void;
export function pinterestPublic(cfg?: Record<string, unknown> | null): { configured: boolean; username: string | null };
export function pingPinterest(cfg: Record<string, unknown>, fetch?: unknown): Promise<string>;
export const PINTEREST_TOOL: { name: string; description: string; input_schema: Record<string, unknown> };
export function pinterestTool(input?: Record<string, unknown>, deps?: { config?: Record<string, unknown>; fetch?: unknown }): Promise<Record<string, unknown>>;
