// Types for the parts of printify.mjs the tests use.
export const PRINTIFY_TOOLS: { name: string }[];
export function runPrintifyTool(name: string, input: Record<string, unknown>, deps?: { config?: Record<string, unknown>; fetch?: unknown }): Promise<{ content: string; isError: boolean }>;
