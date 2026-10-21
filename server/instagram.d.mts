export const HASHTAG_LIMIT: number;
export function instagramConfig(): Record<string, unknown> | null;
export function saveInstagram(cfg: Record<string, unknown>): void;
export function instagramPublic(cfg?: Record<string, unknown> | null): { configured: boolean; username: string | null; hashtagsLeft: number | null };
export function pingInstagram(cfg: Record<string, unknown>, fetch?: unknown): Promise<string>;
export const INSTAGRAM_TOOL: { name: string; description: string; input_schema: Record<string, unknown> };
export function instagramHashtag(input?: Record<string, unknown>, deps?: { config?: Record<string, unknown>; fetch?: unknown; save?: (cfg: Record<string, unknown>) => void }): Promise<Record<string, unknown>>;
