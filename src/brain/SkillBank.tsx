import { useRef, useState } from 'react';
import { degenAction } from './originLink';
import { Check, Download, Pencil, Plus, Trash2, Upload } from 'lucide-react';
import { useStore } from '../store/store';
import type { BankSkill } from '../model/types';
import { BUDGET_WATCH_ID, ORIGIN_ID, growKind } from './opportunity';

/** Read a SKILL.md: name and description from its frontmatter, the rest is the skill. */
export function parseSkillFile(text: string, fileName = ''): Pick<BankSkill, 'name' | 'description' | 'instructions'> {
  const m = text.replace(/\r\n/g, '\n').match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  const field = (k: string) => m?.[1].match(new RegExp(`^${k}:\\s*(.*)$`, 'm'))?.[1].trim().replace(/^["']|["']$/g, '') ?? '';
  const fallback = fileName.replace(/\.md$/i, '').replace(/^SKILL$/i, '') || 'New skill';
  return { name: (field('name') || fallback).slice(0, 80), description: field('description').slice(0, 1000), instructions: (m ? m[2] : text).trim().slice(0, 20_000) };
}

/** A bank skill as a SKILL.md file, the same shape the import reads. */
export function skillFileText(k: Pick<BankSkill, 'name' | 'description' | 'instructions'>): string {
  const q = (v: string) => JSON.stringify(v.replace(/\s+/g, ' ').trim());
  return `---\nname: ${q(k.name)}\ndescription: ${q(k.description)}\n---\n\n${k.instructions.trim()}\n`;
}
function download(k: BankSkill) {
  const url = URL.createObjectURL(new Blob([skillFileText(k)], { type: 'text/markdown;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url; a.download = `${k.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'skill'}.SKILL.md`; a.click();
  URL.revokeObjectURL(url);
}

const empty = { id: '', name: '', description: '', instructions: '', tags: '' };

/** Tick boxes for choosing bank skills, used wherever an agent is created or equipped. */
export function BankSkillPicker({ value, onChange }: { value: string[]; onChange: (ids: string[]) => void }) {
  const bank = useStore((s) => s.doc.skillBank);
  if (!bank.length) return <p className="creator-privacy">The skill bank is empty. Add skills in the Skill bank tab, then pick them here.</p>;
  return (
    <div className="bank-picker">
      {bank.map((k) => (
        <label key={k.id} className={`bank-chip${value.includes(k.id) ? ' on' : ''}`} title={k.description}>
          <input type="checkbox" checked={value.includes(k.id)} onChange={(e) => onChange(e.target.checked ? [...value, k.id] : value.filter((x) => x !== k.id))} />
          {k.name}
        </label>
      ))}
    </div>
  );
}

/**
 * The owner's skill bank. Skills added here are what JARVIS and ventures pick
 * from when they create agents, and what any agent can be equipped with.
 */
export default function SkillBank({ onNotice }: { onNotice: (text: string) => void }) {
  const doc = useStore((s) => s.doc);
  const [draft, setDraft] = useState(empty);
  const [equip, setEquip] = useState(ORIGIN_ID);
  const fileRef = useRef<HTMLInputElement>(null);
  const agent = doc.agents[equip];
  const users = (id: string) => Object.values(doc.agents).filter((a) => a.bankSkills?.includes(id)).map((a) => a.identity.name);

  const save = () => {
    const skill = { id: draft.id || `skill_${Date.now().toString(36)}`, name: draft.name, description: draft.description, instructions: draft.instructions, tags: draft.tags.split(',') };
    const r = useStore.getState().commit([{ op: 'skillBank.upsert', skill }], `${draft.id ? 'Update' : 'Add'} bank skill ${draft.name.trim()}`);
    if (!r.ok) { onNotice(r.errors.join(' · ')); return; }
    onNotice(draft.id ? `Updated ${draft.name.trim()}.` : `Added ${draft.name.trim()} to the bank.`);
    setDraft(empty);
  };

  const importFiles = async (files: FileList | null) => {
    if (!files?.length) return;
    const ops = [], names: string[] = [], skipped: string[] = [];
    for (const f of Array.from(files).slice(0, 20)) {
      if (f.size > 200_000 || !/\.(md|txt)$/i.test(f.name)) { skipped.push(f.name); continue; }
      const k = parseSkillFile(await f.text(), f.name);
      const existing = doc.skillBank.find((x) => x.name.toLowerCase() === k.name.toLowerCase());
      ops.push({ op: 'skillBank.upsert' as const, skill: { ...k, id: existing?.id ?? `skill_${Date.now().toString(36)}_${names.length}`, tags: existing?.tags ?? [] } });
      names.push(k.name);
    }
    const r = ops.length ? useStore.getState().commit(ops, `Import ${names.length} bank skill${names.length === 1 ? '' : 's'}`) : null;
    onNotice(r?.ok ? `Imported ${names.join(', ')}.${skipped.length ? ` Skipped ${skipped.join(', ')} (use .md files under 200 KB).` : ''}` : r ? r.errors.join(' · ') : 'Choose SKILL.md files (Markdown, under 200 KB).');
    if (fileRef.current) fileRef.current.value = '';
  };

  const setAgentSkills = (ids: string[]) => {
    const r = useStore.getState().commit([{ op: 'agent.setBankSkills', id: equip, skillIds: ids }], `Equip ${agent?.identity.name}`);
    if (!r.ok) onNotice(r.errors.join(' · '));
  };

  return (
    <div className="creator-body">
      <p className="creator-privacy">Every agent JARVIS or your ideas create also gets its own SKILL.md: JARVIS writes a detailed playbook for that agent's job in its next runs (one at a time), and it lands here, given to that agent. Add the skills your agents can use. When {doc.agents[ORIGIN_ID]?.identity.name ?? 'JARVIS'} or a venture creates an agent, it picks the skills that agent needs from this bank, so a research agent gets research skills and an Etsy store venture can build its own helpers. Only JARVIS runs live for now; every skill it has goes into its next run.</p>

      <span className="creator-kicker">YOUR SKILL LIBRARY (degen-skill)</span>
      <p className="creator-privacy">Your own library of ready-made skills (lyopz/degen-skill) can be handed to the agents whose job each one fits, design skills first: designers get design, brand, banner design and design systems; research agents get idea refining and the council; ads agents get brand and banner design. JARVIS can do it in its runs (skills_degen) and you can do it now. A skill you edited here is never overwritten. <button className="link-btn" onClick={() => void (async () => { const r = await degenAction('distribute'); onNotice(!r ? 'The runner did not answer.' : !r.ok ? (r.error ?? 'The library could not be read.') : r.given?.length ? `Given: ${r.given.map((g) => `${g.skill} → ${g.agents.join(', ')}`).join('; ')}. They land in the bank in a moment.` : 'Every agent already has the library skills that fit its role.'); })()}>Hand out library skills by role</button></p>

      <span className="creator-kicker">IN THE BANK ({doc.skillBank.length})</span>
      {doc.skillBank.length === 0 && <p className="creator-privacy">Nothing yet.</p>}
      <ul className="creator-request-log">
        {doc.skillBank.map((k) => {
          const u = users(k.id);
          return (
            <li key={k.id}>
              <b>{k.name}</b>{k.description ? `: ${k.description}` : ''}
              <span className="bank-meta"> · {u.length ? `used by ${u.join(', ')}` : 'not used yet'}</span>{' '}
              <button className="link-btn" onClick={() => download(k)}><Download size={12} /> SKILL.md</button>{' '}
              <button className="link-btn" onClick={() => setDraft({ id: k.id, name: k.name, description: k.description, instructions: k.instructions, tags: k.tags.join(', ') })}><Pencil size={12} /> edit</button>{' '}
              {k.id !== BUDGET_WATCH_ID && <button className="link-btn" onClick={() => { const r = useStore.getState().commit([{ op: 'skillBank.remove', id: k.id }], `Remove bank skill ${k.name}`); onNotice(r.ok ? `Removed ${k.name}.` : r.errors.join(' · ')); }}><Trash2 size={12} /> remove</button>}
            </li>
          );
        })}
      </ul>

      <span className="creator-kicker">{draft.id ? 'EDIT SKILL' : 'ADD A SKILL'}</span>
      <div className="creator-agent-grid">
        <label className="creator-field"><span>Name</span><input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder="e.g. Etsy listing writer" /></label>
        <label className="creator-field"><span>Tags (comma separated)</span><input value={draft.tags} onChange={(e) => setDraft({ ...draft, tags: e.target.value })} placeholder="e.g. etsy, copywriting" /></label>
        <label className="creator-field creator-wide"><span>When to use it (agents choose skills by this)</span><input value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} placeholder="e.g. Writing Etsy titles, tags and descriptions that match buyer searches" /></label>
        <label className="creator-field creator-wide"><span>Instructions</span><textarea rows={6} value={draft.instructions} onChange={(e) => setDraft({ ...draft, instructions: e.target.value })} placeholder="The steps, rules and checks the agent follows. A SKILL.md body works as is." /></label>
      </div>
      <input ref={fileRef} className="creator-file-input" type="file" multiple accept=".md,.txt,text/markdown,text/plain" onChange={(e) => void importFiles(e.target.files)} />
      <div className="creator-dialog-foot">
        <button className="creator-secondary" onClick={() => fileRef.current?.click()}><Upload size={14} /> Import SKILL.md files</button>
        {draft.id && <button className="creator-secondary" onClick={() => setDraft(empty)}>Cancel edit</button>}
        <button className="creator-primary" disabled={!draft.name.trim() || !draft.instructions.trim()} onClick={save}>{draft.id ? <Check size={14} /> : <Plus size={14} />} {draft.id ? 'Save skill' : 'Add to bank'}</button>
      </div>

      <span className="creator-kicker">GIVE SKILLS TO AN AGENT</span>
      <div className="creator-agent-grid">
        <label className="creator-field"><span>Agent</span><select value={equip} onChange={(e) => setEquip(e.target.value)}>
          {Object.values(doc.agents).filter((a) => a.id === ORIGIN_ID || a.branch).map((a) => <option key={a.id} value={a.id}>{a.identity.name}{a.id === ORIGIN_ID ? ' (main)' : growKind(doc, a.id) ? ' (venture)' : ''}</option>)}
        </select></label>
      </div>
      {agent && <BankSkillPicker value={agent.bankSkills ?? []} onChange={setAgentSkills} />}
    </div>
  );
}
