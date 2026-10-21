// Types for the parts of printify.mjs the tests use.
export const PRINTIFY_TOOLS: { name: string }[];
export function svgToPng(svg: string, deps?: { resvg?: unknown }): Promise<{ png: Buffer; width: number; height: number } | null>;
export function runPrintifyTool(name: string, input: Record<string, unknown>, deps?: { config?: Record<string, unknown>; fetch?: unknown }): Promise<{ content: string; isError: boolean }>;
export function deleteProduct(shop: number | string | null, productId: string, deps?: unknown): Promise<boolean>;
export function archiveUpload(imageId: string, deps?: unknown): Promise<boolean>;
