// Settings > JARVIS voice: pick how JARVIS sounds, and hear it before choosing.
import { useEffect, useState } from 'react';
import { Volume2 } from 'lucide-react';
import { useOrigin } from '../brain/useOrigin';
import { getDesktopBridge } from '../persistence/desktopBridge';
import { localVoices, say, setVoicePref, systemVoices, voicePref, voiceStatus } from './voice';

const SAMPLE = "Hello, I'm JARVIS. Tell me what you need, and I'll get the team on it. Research is done, and the first three designs are ready for you to look at.";
/** "piper:en_GB-alan-medium" reads as "Alan (British)"; "kokoro:am_michael" as "Michael (American, male)". */
const label = (full: string) => {
  const [engine, v] = [full.slice(0, full.indexOf(':')), full.slice(full.indexOf(':') + 1)];
  const cap = (x: string) => x.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
  if (engine === 'kokoro') { const [tag, who = v] = v.split('_'); return `${cap(who)} (${tag[0] === 'b' ? 'British' : 'American'}, ${tag[1] === 'f' ? 'female' : 'male'})`; }
  const [lang, who = v] = v.split('-'); return `${cap(who)} (${lang === 'en_GB' ? 'British' : lang === 'en_US' ? 'American' : lang})`;
};

export function VoiceSettings() {
  useOrigin((s) => s.status); // re-render when the runner says whether OpenAI voice is set up
  const [pref, setPref] = useState(voicePref);
  const [local, setLocal] = useState<string[]>([]);
  const [system, setSystem] = useState(() => systemVoices());
  useEffect(() => {
    void localVoices().then(setLocal);
    // get-voices may still be downloading: keep checking until Kokoro shows up
    const poll = setInterval(() => { void localVoices().then((v) => { setLocal(v); if (v.some((x) => x.startsWith('kokoro:'))) clearInterval(poll); }); }, 5000);
    const update = () => setSystem(systemVoices());
    if ('speechSynthesis' in globalThis) speechSynthesis.addEventListener('voiceschanged', update);
    return () => { clearInterval(poll); if ('speechSynthesis' in globalThis) speechSynthesis.removeEventListener('voiceschanged', update); };
  }, []);
  const openai = voiceStatus();
  const pick = (v: string) => { setPref(v); setVoicePref(v); void say(SAMPLE); };
  const desktop = !!getDesktopBridge()?.voice?.say;
  return (
    <div className="card span-6">
      <h4>JARVIS voice</h4>
      <label className="field"><span>Voice</span>
        <select value={pref} onChange={(e) => pick(e.target.value)}>
          <option value="">Automatic (best one available)</option>
          {local.some((v) => v.startsWith('kokoro:')) && <optgroup label="Natural voices, free and offline (Kokoro)">{local.filter((v) => v.startsWith('kokoro:')).map((v) => <option key={v} value={v}>{label(v)}</option>)}</optgroup>}
          {local.some((v) => v.startsWith('piper:')) && <optgroup label="Simpler offline voices (Piper)">{local.filter((v) => v.startsWith('piper:')).map((v) => <option key={v} value={v}>{label(v)}</option>)}</optgroup>}
          {openai?.configured && <optgroup label="OpenAI human voices (about 1.5¢ a minute)">{openai.voices.map((v) => <option key={v} value={`openai:${v}`}>{v[0].toUpperCase() + v.slice(1)}</option>)}</optgroup>}
          {system.length > 0 && <optgroup label="This computer's voices">{system.map((v) => <option key={v.name} value={`system:${v.name}`}>{v.name}</option>)}</optgroup>}
        </select>
      </label>
      <button className="btn sm" style={{ marginTop: 8 }} onClick={() => void say(SAMPLE)}><Volume2 size={13} /> Hear it</button>
      {!local.some((v) => v.startsWith('kokoro:')) && <p className="note">{desktop ? 'For natural voices with no API key, run npm.cmd run get-voices once in the app folder. It downloads Kokoro (28 voices, about 330 MB) and they appear here.' : 'Free natural voices (Kokoro) work in the desktop app.'}</p>}
      {openai?.configured && <p className="note">OpenAI voice this month: ${openai.spentUsd.toFixed(3)} of its ${openai.capUsd.toFixed(2)} limit.</p>}
    </div>
  );
}
