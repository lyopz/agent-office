// Types for the parts of openai-voice.mjs the tests use.
export const VOICE_CAP_USD: number;
export function voiceRoute(url: string, body: unknown, dir: string, deps?: { key?: string; fetch?: typeof fetch }): Promise<[number, { ok: boolean; audio?: string; mime?: string; text?: string; usd?: number; reason?: string }]>;
export function loadVoice(dir: string): { month: string; spentUsd: number; log: { kind: string; usd: number }[] };
