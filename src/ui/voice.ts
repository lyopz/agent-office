// Speech to text for the command center's mic button. The desktop app hears you with Windows'
// own offline speech recognition (desktop/listen.ps1); a browser uses its Web Speech API.
import { getDesktopBridge } from '../persistence/desktopBridge';

export type Heard = { ok: true; text: string } | { ok: false; error: string };

type Recognition = { lang: string; interimResults: boolean; maxAlternatives: number; onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null; onerror: ((e: { error: string }) => void) | null; onend: (() => void) | null; start(): void; stop(): void };
const browserRecognition = (): (new () => Recognition) | null => {
  const w = globalThis as unknown as { SpeechRecognition?: new () => Recognition; webkitSpeechRecognition?: new () => Recognition };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
};

export const canListen = (): boolean => !!getDesktopBridge()?.voice || !!browserRecognition();

let stopBrowser: (() => void) | null = null;

/** Listen for one phrase and return what was said. */
export function listen(): Promise<Heard> {
  const desktop = getDesktopBridge();
  if (desktop?.voice) return desktop.voice.listen().catch((e: unknown) => ({ ok: false as const, error: String((e as Error)?.message ?? e) }));
  const Rec = browserRecognition();
  if (!Rec) return Promise.resolve({ ok: false, error: 'Voice input is not available here. Use the desktop app, or Chrome or Edge.' });
  return new Promise((resolve) => {
    const r = new Rec();
    r.lang = navigator.language || 'en-US'; r.interimResults = false; r.maxAlternatives = 1;
    let done = false;
    const finish = (h: Heard) => { if (!done) { done = true; stopBrowser = null; resolve(h); } };
    r.onresult = (e) => { const text = Array.from(e.results).map((x) => x[0]?.transcript ?? '').join(' ').trim(); finish(text ? { ok: true, text } : { ok: false, error: "Didn't catch that. Press the mic and speak again." }); };
    r.onerror = (e) => finish({ ok: false, error: e.error === 'not-allowed' ? 'The microphone is blocked for this page.' : e.error === 'no-speech' ? "Didn't hear anything. Press the mic and speak again." : `Voice input failed (${e.error}).` });
    r.onend = () => finish({ ok: false, error: "Didn't catch that. Press the mic and speak again." });
    stopBrowser = () => r.stop();
    r.start();
  });
}

export function stopListening() {
  const desktop = getDesktopBridge();
  if (desktop?.voice) void desktop.voice.stop();
  stopBrowser?.();
}

/** Read text aloud with the system's voices. */
export function say(text: string) {
  if (!('speechSynthesis' in globalThis)) return;
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text.slice(0, 1200));
  u.pitch = 0.8; u.rate = 1;
  speechSynthesis.speak(u);
}
