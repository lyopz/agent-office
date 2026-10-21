// Types for the parts of canva.mjs the tests use.
export const CANVA_MCP: string;
export const CANVA_ALLOWED: string[];
export const CANVA_AI: string[];
export function toolName(canvaName: string): string;
export function canvaName(tool: string): string;
export function readRpc(text: string, contentType: string | null, id: number): any;
export function canvaRpc(method: string, params: unknown, deps?: Record<string, unknown>): Promise<any>;
export function resetCanvaSession(): void;
export function callCanva(tool: string, args: unknown, deps?: Record<string, unknown>): Promise<any>;
export function canvaFiles(r: unknown, tool: string, deps?: Record<string, unknown>): Promise<{ ext: string; b64: string }[]>;
export function canvaText(r: unknown): string;
export function canvaPublic(): { configured: boolean; connectedAt: string | null };
