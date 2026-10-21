// Kokoro: a free, offline neural voice with natural-sounding voices, run on this PC with Node
// (kokoro-js). The desktop app keeps one of these running and sends it lines of JSON:
//   {"id":1,"text":"Hello","voice":"af_heart"}  ->  {"id":1,"ok":true,"wav":"<base64>"}
// `--warm` downloads the model once (into %LOCALAPPDATA%\the-brain\kokoro) and exits;
// `--voices` prints the voices as JSON. Nothing leaves the PC after the download.
import path from 'node:path';
import os from 'node:os';
import readline from 'node:readline';

const MODEL = 'onnx-community/Kokoro-82M-v1.0-ONNX';
const DTYPE = process.env.ORIGIN_KOKORO_DTYPE || 'fp32';
export const CACHE = process.env.ORIGIN_KOKORO_DIR || path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'the-brain', 'kokoro');
export const DEFAULT_VOICE = 'am_michael';

/** The voices Kokoro ships with: id -> label. */
export const VOICES = {
  af_heart: 'Heart (American, female)', af_bella: 'Bella (American, female)', af_nicole: 'Nicole (American, female, soft)', af_sarah: 'Sarah (American, female)', af_sky: 'Sky (American, female)', af_nova: 'Nova (American, female)', af_jessica: 'Jessica (American, female)', af_kore: 'Kore (American, female)', af_aoede: 'Aoede (American, female)', af_river: 'River (American, female)', af_alloy: 'Alloy (American, female)',
  am_michael: 'Michael (American, male)', am_adam: 'Adam (American, male)', am_eric: 'Eric (American, male)', am_liam: 'Liam (American, male)', am_onyx: 'Onyx (American, male, deep)', am_echo: 'Echo (American, male)', am_fenrir: 'Fenrir (American, male)', am_puck: 'Puck (American, male)', am_santa: 'Santa (American, male)',
  bm_george: 'George (British, male)', bm_daniel: 'Daniel (British, male)', bm_lewis: 'Lewis (British, male)', bm_fable: 'Fable (British, male)', bf_emma: 'Emma (British, female)', bf_isabella: 'Isabella (British, female)', bf_alice: 'Alice (British, female)', bf_lily: 'Lily (British, female)',
};

let ttsPromise = null;
async function tts() {
  if (!ttsPromise) ttsPromise = (async () => {
    const { KokoroTTS, env } = await import('kokoro-js');
    env.cacheDir = CACHE;
    return KokoroTTS.from_pretrained(MODEL, { dtype: DTYPE, device: 'cpu' });
  })();
  return ttsPromise;
}

/** Text to WAV (base64). */
export async function speak(text, voice) {
  const t = await tts();
  const v = VOICES[voice] ? voice : DEFAULT_VOICE;
  const input = String(text || '').replace(/\s+/g, ' ').trim().slice(0, 3000);
  if (!input) throw new Error('Nothing to say.');
  const audio = await t.generate(input, { voice: v });
  return Buffer.from(audio.toWav()).toString('base64');
}

const out = (o) => process.stdout.write(`${JSON.stringify(o)}\n`);

if (process.argv[1] && import.meta.url.endsWith(path.basename(process.argv[1]))) {
  const mode = process.argv[2];
  if (mode === '--voices') { out({ voices: VOICES }); }
  else if (mode === '--warm') {
    console.log(`Downloading the Kokoro voice model (${DTYPE}, about ${DTYPE === 'fp32' ? '330' : '90'} MB) into ${CACHE}...`);
    tts().then(async (t) => { await t.generate('Ready.', { voice: DEFAULT_VOICE }); console.log('Kokoro is ready.'); process.exit(0); })
      .catch((e) => { console.error(`Kokoro failed: ${e?.message || e}`); process.exit(1); });
  } else {
    // serve requests until stdin closes
    const rl = readline.createInterface({ input: process.stdin });
    out({ ready: true });
    rl.on('line', async (line) => {
      let req; try { req = JSON.parse(line); } catch { return; }
      try { out({ id: req.id, ok: true, wav: await speak(req.text, req.voice) }); }
      catch (e) { out({ id: req.id, ok: false, error: String(e?.message || e).slice(0, 300) }); }
    });
    rl.on('close', () => process.exit(0));
  }
}
