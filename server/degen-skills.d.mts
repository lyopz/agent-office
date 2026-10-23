export const DEGEN_REPO: string;
export const DEGEN_ROLES: { role: string; test: RegExp; skills: string[] }[];
export function degenSkillsForRole(text: string): string[];
export function degenRolesOf(name: string): string[];
export function parseFrontmatter(md: string): { name: string; description: string; body: string };
export function degenDir(env?: Record<string, string | undefined>): string | null;
export interface DegenCatalog { from: 'local' | 'github'; dir: string | null; skills: { name: string; description: string; chars: number; roles: string[] }[] }
export function degenCatalog(deps?: { dir?: string | null; fetch?: unknown; fresh?: boolean }): Promise<DegenCatalog>;
export interface DegenSkill { name: string; title: string; description: string; body: string; chars: number; roles: string[]; from: 'local' | 'github' }
export function degenSkill(name: string, deps?: { dir?: string | null; fetch?: unknown }): Promise<DegenSkill>;
export function degenBankSkill(skill: DegenSkill): { skillKey: string; skillName: string; name: string; description: string; body: string; tags: string[] };
export const DEGEN_TOOL: { name: string; description: string; input_schema: Record<string, unknown> };
