// Settings > JARVIS voice: pick how JARVIS sounds, and hear it before choosing.
import { useEffect, useState } from 'react';
import { Volume2 } from 'lucide-react';
import { useOrigin } from '../brain/useOrigin';
import { getDesktopBridge } from '../persistence/desktopBridge';
import { piperVoices, say, setVoicePref, systemVoices, voicePref, voiceStatus } from './voice';

const SAMPLE = "Hello, I'm JARVIS. Tell me what you need, and I'll get the team on it.";
/** "en_GB-alan-medium" reads as "Alan (British)". */
const piperLabel = (v: string) => { const [lang, who = v] = v.split('-'); const name = who.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()); return `${name} (${lang === 'en_GB' ? 'British' : lang === 'en_US' ? 'American' : lang})`; };

export function VoiceSettings() {
  useOrigin((s) => s.status); // re-render when the runner says whether OpenAI voice is set up
  const [pref, setPref] = useState(voicePref);
  const [piper, setPiper] = useState<string[]>([]);
  const [system, setSystem] = useState(() => systemVoices());
  useEffect(() => {
    void piperVoices().then(setPiper);
    const update = () => setSystem(systemVoices());
    if ('speechSynthesis' in globalThis) speechSynthesis.addEventListener('voiceschanged', update);
    return () => { if ('speechSynthesis' in globalThis) speechSynthesis.removeEventListener('voiceschanged', update); };
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
          {piper.length > 0 && <optgroup label="Natural voices, free and offline (Piper)">{piper.map((v) => <option key={v} value={`piper:${v}`}>{piperLabel(v)}</option>)}</optgroup>}
          {openai?.configured && <optgroup label="OpenAI human voices (about 1.5¢ a minute)">{openai.voices.map((v) => <option key={v} value={`openai:${v}`}>{v[0].toUpperCase() + v.slice(1)}</option>)}</optgroup>}
          {system.length > 0 && <optgroup label="This computer's voices">{system.map((v) => <option key={v.name} value={`system:${v.name}`}>{v.name}</option>)}</optgroup>}
        </select>
      </label>
      <button className="btn sm" style={{ marginTop: 8 }} onClick={() => void say(SAMPLE)}><Volume2 size={13} /> Hear it</button>
      {!piper.length && <p className="note">{desktop ? 'For a free, natural-sounding voice with no API key, run npm.cmd run get-voices once in the app folder. It downloads Piper and four voices, then they appear here.' : 'Free natural voices (Piper) work in the desktop app.'}</p>}
      {openai?.configured && <p className="note">OpenAI voice this month: ${openai.spentUsd.toFixed(3)} of its ${openai.capUsd.toFixed(2)} limit.</p>}
    </div>
  );
}
