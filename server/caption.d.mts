export const CAPTION_TOOL: { name: string; description: string; input_schema: Record<string, unknown> };
export const IMAGE_HOSTS: RegExp[];
export function hostAllowed(url: string): boolean;
export function imageSize(buf: Buffer): { mime: string; width: number; height: number } | null;
export function wrapCaption(text: string, width: number, fontSize: number, maxLines?: number): string[];
export function captionSvg(o: { imageB64: string; mime: string; width: number; height: number; top?: string; bottom?: string; font?: string; uppercase?: boolean; color?: string; cutout?: boolean }): string;
export function captionImage(input: Record<string, unknown>, deps: { fetch?: unknown; svgToPng: (svg: string) => Promise<{ png: Buffer; width: number; height: number } | null>; readDesign?: (id: string) => { buf: Buffer; kind: string } | null; readSource?: (ref: string) => { buf: Buffer; kind: string; meta: Record<string, unknown> | null; ref: string } | null }): Promise<{ png: Buffer; width: number; height: number; source: string; sourceFile: string | null; sourceMeta: Record<string, unknown> | null; caption: string; original: { width: number; height: number; mime: string } }>;

export function cropBox(c: unknown, size: { width: number; height: number }): { x: number; y: number; w: number; h: number } | null;
