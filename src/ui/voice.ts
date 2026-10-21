// JARVIS's voice. Speaking: Piper's free offline natural voices in the desktop app (after
// npm.cmd run get-voices), or OpenAI's human voices when the owner's OpenAI key is set (via the
// runner on this PC; the key never reaches the app), else the computer's own voices. Hearing:
// OpenAI transcription when the key is set, else Windows' offline speech recognition
// (desktop/listen.ps1) in the desktop app, or the Web Speech API in a browser.
import { getDesktopBridge } from '../persistence/desktopBridge';
import { useOrigin } from '../brain/useOrigin';

export type Heard = { ok: true; text: string } | { ok: false; error: string };
export interface VoiceStatus { configured: boolean; voices: string[]; defaultVoice: string; spentUsd: number; capUsd: number }

const BASE = typeof location !== 'undefined' && /^https?:$/.test(location.protocol) ? '/api/origin' : 'http://127.0.0.1:8788/api/origin';
const PREF = 'jarvis:voice';
const WAKE_PREF = 'jarvis:wake';

/** The runner's voice status: whether OpenAI voice is set up, its voices and this month's spend. */
export const voiceStatus = (): VoiceStatus | null => ((useOrigin.getState().status as unknown as { voice?: VoiceStatus } | null)?.voice ?? null);
const openaiVoice = () => !!voiceStatus()?.configured;

/** The owner's pick in Settings: `piper:<voice>`, `openai:<voice>` or `system:<name>`; empty is automatic. Kept on this device. */
export function voicePref(): string { try { return localStorage.getItem(PREF) || ''; } catch { return ''; } }
export function setVoicePref(v: string) { try { localStorage.setItem(PREF, v); } catch { /* storage unavailable */ } }

type Recognition = { lang: string; interimResults: boolean; maxAlternatives: number; onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null; onerror: ((e: { error: string }) => void) | null; onend: (() => void) | null; start(): void; stop(): void };
const browserRecognition = (): (new () => Recognition) | null => {
  const w = globalThis as unknown as { SpeechRecognition?: new () => Recognition; webkitSpeechRecognition?: new () => Recognition };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
};
const canRecord = () => typeof MediaRecorder !== 'undefined' && !!navigator.mediaDevices?.getUserMedia;

export const canListen = (): boolean => (openaiVoice() && canRecord()) || !!getDesktopBridge()?.voice || !!browserRecognition();

let stopCurrent: (() => void) | null = null;

/** Listen for one phrase and return what was said. */
export function listen(): Promise<Heard> {
  stopSpeaking(); // barge-in: JARVIS goes quiet the moment you want to talk
  if (openaiVoice() && canRecord()) return listenOpenAI();
  const desktop = getDesktopBridge();
  if (desktop?.voice) return desktop.voice.listen().catch((e: unknown) => ({ ok: false as const, error: String((e as Error)?.message ?? e) }));
  // Electron and Brave have the Web Speech API but no speech service behind it, so it always fails there
  if (/Electron/.test(navigator.userAgent)) return Promise.resolve({ ok: false, error: 'Voice needs the newest desktop app. Close The Brain completely and open it again from its shortcut.' });
  if ((navigator as { brave?: unknown }).brave) return Promise.resolve({ ok: false, error: "Brave doesn't support voice typing. Use the desktop app (its shortcut), or Chrome or Edge." });
  const Rec = browserRecognition();
  if (!Rec) return Promise.resolve({ ok: false, error: 'Voice input is not available here. Use the desktop app, or Chrome or Edge.' });
  return new Promise((resolve) => {
    const r = new Rec();
    r.lang = navigator.language || 'en-US'; r.interimResults = false; r.maxAlternatives = 1;
    let done = false;
    const finish = (h: Heard) => { if (!done) { done = true; stopCurrent = null; resolve(h); } };
    r.onresult = (e) => { const text = Array.from(e.results).map((x) => x[0]?.transcript ?? '').join(' ').trim(); finish(text ? { ok: true, text } : { ok: false, error: "Didn't catch that. Press the mic and speak again." }); };
    r.onerror = (e) => finish({ ok: false, error: e.error === 'not-allowed' ? 'The microphone is blocked for this page.' : e.error === 'no-speech' ? "Didn't hear anything. Press the mic and speak again." : e.error === 'network' ? 'Voice typing needs Chrome or Edge online, or the desktop app.' : `Voice input failed (${e.error}).` });
    r.onend = () => finish({ ok: false, error: "Didn't catch that. Press the mic and speak again." });
    stopCurrent = () => r.stop();
    r.start();
  });
}

/** Record until you stop talking (or press Speak again), then have OpenAI write it down. */
async function listenOpenAI(): Promise<Heard> {
  let stream: MediaStream;
  try { stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } }); }
  catch { return { ok: false, error: "Can't use the microphone. Plug one in, and in Windows Settings > Privacy & security > Microphone turn on access for desktop apps." }; }
  const mime = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/mp4'].find((m) => MediaRecorder.isTypeSupported(m)) ?? '';
  const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
  const chunks: Blob[] = [];
  rec.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
  const started = Date.now();
  // stop after 1.3 s of quiet once you've spoken, after 8 s if you never do, or at 30 s
  const ctx = new AudioContext();
  const meter = ctx.createAnalyser(); meter.fftSize = 1024;
  ctx.createMediaStreamSource(stream).connect(meter);
  const buf = new Uint8Array(meter.fftSize);
  let spoke = false, quietSince = Date.now();
  const stopped = new Promise<void>((resolve) => { rec.onstop = () => resolve(); });
  const timer = setInterval(() => {
    meter.getByteTimeDomainData(buf);
    let peak = 0; for (const v of buf) peak = Math.max(peak, Math.abs(v - 128));
    const now = Date.now();
    if (peak > 14) { spoke = true; quietSince = now; }
    if ((spoke && now - quietSince > 1300) || (!spoke && now - started > 8000) || now - started > 30000) stop();
  }, 100);
  const stop = () => { if (rec.state !== 'inactive') rec.stop(); };
  stopCurrent = stop;
  rec.start(250);
  await stopped;
  clearInterval(timer); stopCurrent = null;
  stream.getTracks().forEach((t) => t.stop()); void ctx.close();
  if (!spoke) return { ok: false, error: "Didn't hear anything. Press Speak and talk again." };
  const blob = new Blob(chunks, { type: rec.mimeType || 'audio/webm' });
  const audio = await toBase64(blob);
  try {
    const r = await fetch(`${BASE}/voice/transcribe`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ audio, mime: blob.type, seconds: (Date.now() - started) / 1000 }), signal: AbortSignal.timeout(60_000) });
    const out = await r.json() as { ok: boolean; text?: string; reason?: string };
    if (!out.ok) return { ok: false, error: out.reason || "Couldn't write down what you said." };
    return out.text ? { ok: true, text: out.text } : { ok: false, error: "Didn't catch that. Press Speak and talk again." };
  } catch { return { ok: false, error: "JARVIS's runner isn't answering, so it couldn't hear you." }; }
}

export function stopListening() {
  if (stopCurrent) { stopCurrent(); return; }
  const desktop = getDesktopBridge();
  if (desktop?.voice) void desktop.voice.stop();
}

function toBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => { const fr = new FileReader(); fr.onload = () => resolve(String(fr.result).split(',')[1] ?? ''); fr.onerror = reject; fr.readAsDataURL(blob); });
}

/** The voices on this computer, most human-sounding first (Windows' "Natural" and online voices beat the old SAPI ones). */
export function systemVoices(): SpeechSynthesisVoice[] {
  if (!('speechSynthesis' in globalThis)) return [];
  const score = (v: SpeechSynthesisVoice) => (/natural/i.test(v.name) ? 4 : 0) + (/online|neural/i.test(v.name) ? 2 : 0) + (/^en/i.test(v.lang) ? 1 : 0);
  return speechSynthesis.getVoices().slice().sort((a, b) => score(b) - score(a));
}

let playing: HTMLAudioElement | null = null;

/** Piper's natural offline voices on this PC (desktop app, after npm.cmd run get-voices). */
export async function piperVoices(): Promise<string[]> {
  try { return (await getDesktopBridge()?.voice?.voices?.()) ?? []; } catch { return []; }
}
const PIPER_DEFAULT = 'en_GB-alan-medium';

/** Which voice JARVIS uses: the owner's pick, else Piper (free), else OpenAI (if set up), else this computer's best voice. */
async function chosenVoice(): Promise<{ kind: 'piper' | 'openai' | 'system'; name: string }> {
  const pref = voicePref();
  const [kind, ...rest] = pref.split(':'); const name = rest.join(':');
  const piper = await piperVoices();
  if (kind === 'piper' && piper.includes(name)) return { kind, name };
  if (kind === 'openai' && openaiVoice()) return { kind, name };
  if (kind === 'system') return { kind, name };
  if (piper.length) return { kind: 'piper', name: piper.includes(PIPER_DEFAULT) ? PIPER_DEFAULT : piper[0] };
  if (openaiVoice()) return { kind: 'openai', name: voiceStatus()?.defaultVoice ?? '' };
  return { kind: 'system', name: '' };
}

async function play(audio: string, mime: string) {
  playing = new Audio(`data:${mime};base64,${audio}`);
  await playing.play();
}

/** Read text aloud as JARVIS. Falls back to this computer's voice if the chosen one fails. */
export async function say(text: string): Promise<void> {
  stopSpeaking();
  const v = await chosenVoice();
  try {
    if (v.kind === 'piper') {
      const out = await getDesktopBridge()?.voice?.say?.(text, v.name);
      if (out?.ok) return await play(out.audio, out.mime);
    } else if (v.kind === 'openai') {
      const r = await fetch(`${BASE}/voice/speak`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text, voice: v.name }), signal: AbortSignal.timeout(60_000) });
      const out = await r.json() as { ok: boolean; audio?: string; mime?: string };
      if (out.ok && out.audio) return await play(out.audio, out.mime || 'audio/mpeg');
    }
  } catch { /* fall back to this computer's voice */ }
  sayLocally(text, v.kind === 'system' ? v.name : '');
}

function sayLocally(text: string, name: string) {
  if (!('speechSynthesis' in globalThis)) return;
  const u = new SpeechSynthesisUtterance(text.slice(0, 1200));
  const voices = systemVoices();
  const v = voices.find((x) => x.name === name) ?? voices[0];
  if (v) u.voice = v;
  u.rate = 1; u.pitch = 1;
  speechSynthesis.speak(u);
}

export function stopSpeaking() {
  if (playing) { playing.pause(); playing = null; }
  if ('speechSynthesis' in globalThis) speechSynthesis.cancel();
}


/** Hey JARVIS: a background listener for that phrase (desktop app on Windows), so you can talk without pressing Speak. */
export const wakeSupported = (): boolean => !!getDesktopBridge()?.voice?.wake;
export function wakePref(): boolean { try { return localStorage.getItem(WAKE_PREF) === '1'; } catch { return false; } }
export function setWakePref(on: boolean) { try { localStorage.setItem(WAKE_PREF, on ? '1' : '0'); } catch { /* storage unavailable */ } }
/** Turn the listener on or off. Returns an error message when it can't run. */
export async function setWake(on: boolean): Promise<string | null> {
  const v = getDesktopBridge()?.voice;
  if (!v?.wake) return on ? 'Hey JARVIS works in the desktop app on Windows.' : null;
  try { const r = await v.wake(on); return r.ok ? null : (r.error ?? "Hey JARVIS couldn't start."); } catch (e) { return String((e as Error)?.message ?? e); }
}
/** Call fn each time "Hey JARVIS" is heard, and onError when the listener stops. Returns the unsubscribe. */
export function onWake(fn: () => void, onError: (message: string) => void): () => void {
  const v = getDesktopBridge()?.voice;
  const offs = [v?.onWake?.(fn), v?.onWakeError?.(onError)];
  return () => offs.forEach((off) => off?.());
}
