import { useRef, useState } from 'react';
import { FileText, Upload, X } from 'lucide-react';

export interface OwnSkillFile { fileName: string; name: string; description: string; body: string }

const MAX_BYTES = 200_000;

/** Name and description from a SKILL.md: its frontmatter if it has one, else its first heading and paragraph. */
export function readSkillMarkdown(fileName: string, text: string): OwnSkillFile {
  const raw = text.replace(/\r\n/g, '\n');
  const fm = raw.match(/^---\n([\s\S]*?)\n---\n?/);
  const field = (k: string) => fm?.[1].match(new RegExp(`^${k}:\\s*(.+)$`, 'm'))?.[1].trim().replace(/^["']|["']$/g, '') ?? '';
  const body = (fm ? raw.slice(fm[0].length) : raw).trim();
  const heading = body.match(/^#\s+(.+)$/m)?.[1].trim() ?? '';
  const para = body.split('\n\n').map((p) => p.trim()).find((p) => p && !p.startsWith('#')) ?? '';
  return {
    fileName,
    name: (field('name') || heading || fileName.replace(/\.(md|markdown|txt)$/i, '')).slice(0, 80),
    description: (field('description') || para.replace(/\s+/g, ' ')).slice(0, 300),
    body: body.slice(0, 40_000),
  };
}

/** Drop a .md file here or pick one: the owner's own SKILL.md for an agent. */
export function SkillFileDrop({ value, onChange, label = 'Attach a SKILL.md (.md)' }: { value: OwnSkillFile | null; onChange: (f: OwnSkillFile | null) => void; label?: string }) {
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const [error, setError] = useState('');
  const take = async (file?: File | null) => {
    setError('');
    if (!file) return;
    if (!/\.(md|markdown|txt)$/i.test(file.name)) { setError('Use a Markdown file (.md).'); return; }
    if (file.size > MAX_BYTES) { setError('That file is over 200 KB.'); return; }
    const f = readSkillMarkdown(file.name, await file.text());
    if (f.body.length < 20) { setError('That file is empty.'); return; }
    onChange(f);
  };
  return (
    <div className={`skill-drop${over ? ' over' : ''}`}
      onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)}
      onDrop={(e) => { e.preventDefault(); setOver(false); void take(e.dataTransfer.files?.[0]); }}>
      <input ref={input} type="file" accept=".md,.markdown,.txt,text/markdown,text/plain" hidden onChange={(e) => { void take(e.target.files?.[0]); e.target.value = ''; }} />
      {value
        ? <><FileText size={14} aria-hidden /><span className="grow"><b>{value.name}</b> · {value.fileName} · {Math.round(value.body.length / 1000)}k characters</span><button type="button" className="btn icon sm ghost" aria-label="Remove the attached file" onClick={() => onChange(null)}><X size={13} /></button></>
        : <><Upload size={14} aria-hidden /><span className="grow">Drop a .md file here, or</span><button type="button" className="btn sm" onClick={() => input.current?.click()}>{label}</button></>}
      {error && <span className="skill-drop-error" role="alert">{error}</span>}
    </div>
  );
}
