export function rasterize(buf: Buffer, mime: string, deps?: Record<string, unknown>): Promise<{ pixels: Buffer; width: number; height: number } | null>;
export function edgeColour(pixels: Buffer, width: number, height: number): { colour: number[] | null; transparent: boolean };
export function removeFlatBackground(pixels: Buffer, width: number, height: number, tolerance?: number): number | null;
export function visibleBox(pixels: Buffer, width: number, height: number, margin?: number): { x: number; y: number; w: number; h: number } | null;
export function cropPixels(pixels: Buffer, width: number, box: { x: number; y: number; w: number; h: number }): Buffer;
export function encodePng(pixels: Buffer, width: number, height: number): Buffer;
export function cutoutImage(buf: Buffer, size: { mime: string; width: number; height: number }, deps?: Record<string, unknown>): Promise<{ png: Buffer; width: number; height: number; removed: number; trimmed: boolean } | null>;
