export const MEMEZ: string;
export const usableFor: (licence: string) => 'print' | 'reference';
export interface SourceFolder { id: string; label: string; path: string; builtin?: boolean; addedAt?: string }
export interface SourceFile { ref: string; folder: string; name: string; bytes: number; kind: 'png' | 'jpg'; usable: 'print' | 'reference' | 'owner'; title: string | null; page: string | null; licence: string; savedBy: string | null; at: string; note: string | null }
export function sourceFolders(s: Record<string, unknown>, dataDir: string): SourceFolder[];
export function addSourceFolder(s: Record<string, unknown>, f: { path: string; label?: string }): SourceFolder;
export function removeSourceFolder(s: Record<string, unknown>, id: string): boolean;
export function listSourceFiles(folder: SourceFolder, limit?: number): SourceFile[];
export function sourcesPublic(s: Record<string, unknown>, dataDir: string): { id: string; label: string; path: string; builtin: boolean; exists: boolean; files: number; printable: number; reference: number; notes: number; recent: SourceFile[] }[];
export function readSourceFile(folders: SourceFolder[], ref: string): { buf: Buffer; kind: 'png' | 'jpg'; meta: Record<string, unknown> | null; ref: string; owner: boolean } | null;
export function deleteSourceFile(folders: SourceFolder[], ref: string): boolean;
export function saveSourceImage(folder: SourceFolder, input: Record<string, unknown>, by?: Record<string, unknown> | null, deps?: { fetch?: unknown }): Promise<{ ref: string; usable: 'print' | 'reference'; width: number; height: number; bytes: number }>;
export const SOURCE_LIST_TOOL: { name: string; description: string; input_schema: Record<string, unknown> };
export const SOURCE_SAVE_TOOL: { name: string; description: string; input_schema: Record<string, unknown> };
export const SOURCE_TOOLS: { name: string }[];
export function runSourceTool(name: string, input: Record<string, unknown>, s: Record<string, unknown>, dataDir: string, by?: Record<string, unknown> | null, deps?: { fetch?: unknown }): Promise<{ content: string; isError: boolean }>;
export function sourcesBrief(s: Record<string, unknown>, dataDir: string): string;
export function saveMemeNote(folder: SourceFolder, info: Record<string, unknown>, by?: Record<string, unknown> | null): Record<string, unknown> & { ref: string };
export function listMemeNotes(folder: SourceFolder, limit?: number): Record<string, unknown>[];
export const SOURCE_NOTE_TOOL: { name: string; description: string; input_schema: Record<string, unknown> };
