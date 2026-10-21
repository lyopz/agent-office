// Types for the parts of openai-images.mjs the tests use.
export const IMAGE_USD: { low: number; medium: number; high: number };
export function generateImage(input: { prompt: string; quality?: 'low' | 'medium' | 'high'; size?: string; transparent?: boolean }, deps?: { key?: string; fetch?: typeof fetch }):
  Promise<{ b64: string; usd: number; model: string; quality: string; size: string; estimated: boolean }>;
