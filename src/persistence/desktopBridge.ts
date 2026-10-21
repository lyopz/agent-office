// The API the desktop app's preload script (desktop/preload.cjs) exposes as `window.officeDesktop`.
// Every save call is synchronous IPC to the main process, which owns the files under
// <userData>/saves with fixed names. The renderer can never name a path.

export type DesktopWriteResult = { ok: true; savedAt?: string } | { ok: false; error: string };
export interface DesktopSaveInfo { dir: string; current: string; backup: string; hasCurrent: boolean; hasBackup: boolean; damaged: string[] }

export interface OfficeDesktopBridge {
  readonly version: number;
  readonly platform: string;
  readonly saves: {
    read(): string | null;
    readBackup(): string | null;
    /** rotateBackup defaults to true; false keeps the backup when the current save is known to be damaged. */
    write(text: string, opts?: { rotateBackup?: boolean }): DesktopWriteResult;
    keepDamaged(text: string): { ok: boolean; name?: string; error?: string };
    info(): DesktopSaveInfo;
  };
  /** Voice input (asynchronous). Missing in desktop builds from before it was added. */
  readonly voice?: {
    listen(): Promise<{ ok: true; text: string } | { ok: false; error: string }>;
    stop(): Promise<boolean>;
    /** Piper voice names installed on this PC (missing in builds from before Piper). */
    voices?(): Promise<string[]>;
    say?(text: string, name?: string): Promise<{ ok: true; audio: string; mime: string } | { ok: false; error: string }>;
    /** Hey JARVIS wake phrase (missing in older builds). */
    wake?(on: boolean): Promise<{ ok: boolean; error?: string }>;
    onWake?(fn: () => void): () => void;
    onWakeError?(fn: (message: string) => void): () => void;
  };
}

export function getDesktopBridge(): OfficeDesktopBridge | null {
  try {
    const b = (globalThis as { officeDesktop?: OfficeDesktopBridge }).officeDesktop;
    return b && typeof b.saves?.write === 'function' ? b : null;
  } catch { return null; }
}
