// JARVIS's voice, with the owner's OpenAI key (the same one set-openai saves for images).
// Speaking uses OpenAI's text-to-speech (a natural, human voice) and listening uses its
// transcription model. The key stays in the runner; the app only sends text or recorded audio
// to the runner on this PC and gets audio or text back. Voice is billed to the owner's OpenAI
// account, so it has its own small monthly cap and a cost log in origin-data/voice.json.
import fs from 'node:fs';
import path from 'node:path';
import { openaiConfig } from './openai-images.mjs';

export const TTS_MODEL = process.env.ORIGIN_TTS_MODEL || 'gpt-4o-mini-tts';
export const STT_MODEL = process.env.ORIGIN_STT_MODEL || 'gpt-4o-mini-transcribe';
export const VOICE_CAP_USD = Number(process.env.ORIGIN_VOICE_CAP_USD || 3);
/** OpenAI's voices for its speech model; the owner picks one in Settings. */
export const VOICES = ['ash', 'onyx', 'echo', 'ballad', 'verse', 'sage', 'coral', 'alloy', 'nova', 'shimmer', 'fable'];
export const DEFAULT_VOICE = 'ash';
/** OpenAI's published estimates: speech about $0.015 a minute, transcription about $0.003 a minute. */
const TTS_USD_PER_MIN = 0.015, STT_USD_PER_MIN = 0.003;
const WORDS_PER_MIN = 150;
const MAX_TEXT = 3000;
const LOG_KEEP = 200;
const STYLE = 'You are JARVIS, a calm, warm and quick-witted personal AI assistant. Speak naturally like a real person in conversation: relaxed pace, natural pauses, light warmth, never robotic or announcer-like.';

const month = () => new Date().toISOString().slice(0, 7);
const round6 = (n) => Math.round(n * 1e6) / 1e6;
const file = (dir) => path.join(dir, 'voice.json');

export function loadVoice(dir) {
  let v = null;
  try { v = JSON.parse(fs.readFileSync(file(dir), 'utf8')); } catch { /* first use */ }
  if (!v || typeof v !== 'object') v = {};
  if (v.month !== month()) { v.month = month(); v.spentUsd = 0; }
  v.log = Array.isArray(v.log) ? v.log : [];
  return v;
}
function saveVoice(dir, v) {
  fs.mkdirSync(dir, { recursive: true });
  const tmp = `${file(dir)}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(v));
  fs.renameSync(tmp, file(dir));
}

/** What the app may see: never the key. */
export function voicePublic(dir) {
  const v = loadVoice(dir);
  return { configured: !!openaiConfig()?.key, ttsModel: TTS_MODEL, sttModel: STT_MODEL, voices: VOICES, defaultVoice: DEFAULT_VOICE, month: v.month, spentUsd: round6(v.spentUsd || 0), capUsd: VOICE_CAP_USD };
}

const speechUsd = (text) => round6(Math.max(1, text.split(/\s+/).filter(Boolean).length) / WORDS_PER_MIN * TTS_USD_PER_MIN);
const listenUsd = (seconds) => round6(Math.max(1, Math.min(120, Number(seconds) || 10)) / 60 * STT_USD_PER_MIN);

async function failure(r) {
  let why = '';
  try { const e = await r.json(); why = String(e.error?.message || '').slice(0, 300); } catch { /* no body */ }
  return new Error(`OpenAI answered ${r.status}${why ? `: ${why}` : ''}`);
}

/** Text to speech. Returns MP3 as base64. */
export async function speak({ text, voice }, deps = {}) {
  const key = deps.key ?? openaiConfig()?.key;
  if (!key) throw new Error('OpenAI is not set up. Run npm.cmd run set-openai once.');
  const input = String(text || '').replace(/\s+/g, ' ').trim().slice(0, MAX_TEXT);
  if (!input) throw new Error('Nothing to say.');
  const f = deps.fetch ?? globalThis.fetch;
  const r = await f('https://api.openai.com/v1/audio/speech', {
    method: 'POST',
    headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
    body: JSON.stringify({ model: TTS_MODEL, voice: VOICES.includes(voice) ? voice : DEFAULT_VOICE, input, instructions: STYLE, response_format: 'mp3' }),
    signal: AbortSignal.timeout(60_000),
  });
  if (!r.ok) throw await failure(r);
  const b64 = Buffer.from(await r.arrayBuffer()).toString('base64');
  return { b64, usd: speechUsd(input), chars: input.length };
}

/** Recorded audio (base64) to text. */
export async function transcribe({ audio, mime, seconds }, deps = {}) {
  const key = deps.key ?? openaiConfig()?.key;
  if (!key) throw new Error('OpenAI is not set up. Run npm.cmd run set-openai once.');
  const bytes = Buffer.from(String(audio || ''), 'base64');
  if (bytes.length < 200) throw new Error("Didn't catch that. Press Speak and talk again.");
  const type = /^audio\/[\w.+-]+/.exec(String(mime || ''))?.[0] || 'audio/webm';
  const ext = type.includes('ogg') ? 'ogg' : type.includes('mp4') ? 'mp4' : type.includes('wav') ? 'wav' : 'webm';
  const form = new FormData();
  form.append('model', STT_MODEL);
  form.append('file', new Blob([bytes], { type }), `speech.${ext}`);
  const f = deps.fetch ?? globalThis.fetch;
  const r = await f('https://api.openai.com/v1/audio/transcriptions', { method: 'POST', headers: { authorization: `Bearer ${key}` }, body: form, signal: AbortSignal.timeout(60_000) });
  if (!r.ok) throw await failure(r);
  const data = await r.json();
  return { text: String(data.text || '').trim(), usd: listenUsd(seconds) };
}

/** The runner's voice routes: POST /api/origin/voice/speak and /api/origin/voice/transcribe. Returns [status, body]. */
export async function voiceRoute(url, body, dir, deps = {}) {
  const kind = url.endsWith('/speak') ? 'speak' : url.endsWith('/transcribe') ? 'transcribe' : null;
  if (!kind) return [404, { ok: false, reason: 'not found' }];
  if (!(deps.key ?? openaiConfig()?.key)) return [409, { ok: false, reason: 'OpenAI is not set up. Run npm.cmd run set-openai once.' }];
  const v = loadVoice(dir);
  const worst = kind === 'speak' ? speechUsd(String(body?.text || '').slice(0, MAX_TEXT)) : listenUsd(body?.seconds);
  if ((v.spentUsd || 0) + worst > VOICE_CAP_USD) return [409, { ok: false, reason: `JARVIS's voice reached this month's $${VOICE_CAP_USD.toFixed(2)} limit, so it uses the computer's voice until next month.` }];
  try {
    const out = kind === 'speak' ? await speak(body || {}, deps) : await transcribe(body || {}, deps);
    const now = loadVoice(dir); // re-read: another request may have spent since
    now.spentUsd = round6((now.spentUsd || 0) + out.usd);
    now.log = [...now.log, { at: new Date().toISOString(), kind, usd: out.usd, model: kind === 'speak' ? TTS_MODEL : STT_MODEL }].slice(-LOG_KEEP);
    saveVoice(dir, now);
    return [200, kind === 'speak' ? { ok: true, audio: out.b64, mime: 'audio/mpeg', usd: out.usd } : { ok: true, text: out.text, usd: out.usd }];
  } catch (e) {
    return [502, { ok: false, reason: String(e?.message || e).slice(0, 400) }];
  }
}
