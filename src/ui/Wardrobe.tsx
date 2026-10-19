// Cosmetic inventory and outfits for one agent. Cosmetics change only how the
// agent looks; functional equipment is shown with the tool it needs and can
// only be worn when that tool is granted.
import { useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import { useStore } from '../store/store';
import type { Agent, CosmeticCategory, CosmeticItem, Rarity } from '../model/types';
import { ACCESSORY } from '../model/cosmetics';
import { withAppearance, uid } from '../model/defaults';
import { Character } from '../characters/Character';
import { assetStore } from '../persistence/repository';
import { useAsset } from '../viewport/AgentsLayer';
import { confirmAction } from './primitives';
import { lockedUniform } from '../engine/ops';
import { Lock } from 'lucide-react';

/** Shown wherever an agent's look can be edited while a locked uniform is on. */
export function UniformBanner({ agent }: { agent: Agent }) {
  const doc = useStore((s) => s.doc);
  const u = lockedUniform(doc, agent);
  if (!u) return null;
  return (
    <div className="uniform-banner" role="status">
      <Lock size={14} aria-hidden />
      <span className="grow"><b>{agent.identity.name}</b> is wearing the locked <b>{u.name}</b>. Its clothing, accessories and effects can't be changed piece by piece. Face, hair and body can still be edited.</span>
      <button className="btn sm" onClick={() => useStore.getState().commit([{ op: 'agent.removeUniform', id: agent.id }], `Take off ${u.name}`)}>Take off uniform</button>
    </div>
  );
}

const CATS: { id: CosmeticCategory | 'all' | 'equipped'; label: string }[] = [
  { id: 'all', label: 'All' }, { id: 'equipped', label: 'Wearing' }, { id: 'head', label: 'Head & face' }, { id: 'clothing', label: 'Clothing' }, { id: 'accessory', label: 'Accessories' }, { id: 'effect', label: 'Effects' },
];
const RARITY_COLOR: Record<Rarity, string> = { common: 'var(--muted)', uncommon: 'var(--accent)', rare: 'var(--accent-blue)', legendary: 'var(--warn)' };

export function toolFor(it: CosmeticItem) { return it.functionalTool ?? (it.accessoryId ? ACCESSORY[it.accessoryId]?.functionalTool : undefined); }

/** Is this item currently part of the agent's look? */
export function isWearing(a: Agent, it: CosmeticItem) {
  if (it.accessoryId) return a.appearance.accessories.includes(it.accessoryId);
  if (!it.patch) return false;
  return Object.entries(it.patch).every(([k, v]) => {
    const cur = (a.appearance as unknown as Record<string, unknown>)[k];
    if (k === 'effects' && v && typeof v === 'object') return Object.entries(v).every(([e, ev]) => e === 'intensity' || (cur as Record<string, unknown>)?.[e] === ev);
    return JSON.stringify(cur) === JSON.stringify(v);
  });
}

function Swatch({ a, it }: { a: Agent; it: CosmeticItem }) {
  const url = useAsset(it.assetId ?? undefined);
  if (url) return <img src={url} alt="" width={44} height={44} style={{ objectFit: 'contain' }} />;
  const look = withAppearance(a.appearance, it.patch ?? {});
  if (it.accessoryId && !look.accessories.includes(it.accessoryId)) look.accessories = [...look.accessories, it.accessoryId];
  return <Character a={look} view="portrait" size={44} title={it.name} />;
}

export function Wardrobe({ agent }: { agent: Agent }) {
  const doc = useStore((s) => s.doc);
  const { commit, notify } = useStore.getState();
  const [cat, setCat] = useState<(typeof CATS)[number]['id']>('all');
  const [q, setQ] = useState('');
  const [rarity, setRarity] = useState<Rarity | ''>('');
  const [collection, setCollection] = useState('');
  const [outfitName, setOutfitName] = useState('');
  const collections = useMemo(() => [...new Set(doc.cosmetics.map((c) => c.collection).filter(Boolean))] as string[], [doc.cosmetics]);
  const items = doc.cosmetics.filter((it) => {
    if (cat === 'equipped' ? !isWearing(agent, it) : cat !== 'all' && it.category !== cat) return false;
    if (rarity && (it.rarity ?? 'common') !== rarity) return false;
    if (collection && it.collection !== collection) return false;
    const n = q.trim().toLowerCase();
    return !n || it.name.toLowerCase().includes(n) || (it.tags ?? []).some((t) => t.includes(n)) || (it.collection ?? '').toLowerCase().includes(n);
  });
  const others = Object.values(doc.agents).filter((x) => x.id !== agent.id);
  const outfits = doc.outfitTemplates;
  const uniform = lockedUniform(doc, agent);

  const addCustom = async (file: File | null, name: string, category: CosmeticCategory) => {
    let assetId: string | null = null;
    if (file) {
      if (!/^image\/(png|jpeg|webp|svg\+xml|gif)$/.test(file.type) || file.size > 2_000_000) { notify('Use a PNG, JPEG, WebP, GIF or SVG under 2 MB', 'error'); return; }
      const url = await new Promise<string>((res) => { const r = new FileReader(); r.onload = () => res(r.result as string); r.readAsDataURL(file); });
      assetId = uid('asset'); await assetStore.put(assetId, url);
    }
    // a custom item captures the agent's current colours for its slot so it can be re-applied later
    const slotPatch = category === 'clothing' ? { top: agent.appearance.top, topColor: agent.appearance.topColor, trimColor: agent.appearance.trimColor } : category === 'head' ? { headwear: agent.appearance.headwear, headwearColor: agent.appearance.headwearColor, glasses: agent.appearance.glasses } : category === 'effect' ? { effects: { ...agent.appearance.effects } } : { accent: agent.appearance.accent };
    commit([{ op: 'cosmetic.upsert', item: { id: uid('cos'), name, category, slot: category === 'clothing' ? 'top' : category === 'head' ? 'headwear' : category === 'effect' ? 'effects' : 'accent', patch: slotPatch, rarity: 'common', custom: true, assetId, collection: 'Custom' } }], `Add custom item ${name}`);
  };

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <UniformBanner agent={agent} />
      <div className="card">
        <h4>Outfits</h4>
        <p className="note">An outfit changes clothing, accessories and effects only. Name, role, face, responsibilities and permissions stay exactly as they are.</p>
        <div className="row wrap">
          <input type="text" aria-label="Outfit name" placeholder={`${agent.identity.name} outfit`} value={outfitName} onChange={(e) => setOutfitName(e.target.value)} style={{ maxWidth: 220 }} />
          <button className="btn sm primary" onClick={() => { commit([{ op: 'outfit.save', name: outfitName.trim() || `${agent.identity.name} outfit`, fromAgentId: agent.id }], 'Save outfit'); setOutfitName(''); }}>Save current outfit</button>
          <button className="btn sm" onClick={() => commit([{ op: 'outfit.save', name: `${agent.identity.department} uniform`, fromAgentId: agent.id, kind: 'uniform', department: agent.identity.department, approved: false }], 'Propose uniform')}>Propose as {agent.identity.department} uniform</button>
          <button className="btn sm" onClick={() => commit([{ op: 'agent.restoreAppearance', id: agent.id }], `Restore ${agent.identity.name}'s default look`)}>Restore default appearance</button>
        </div>
        <div className="outfit-list">
          {outfits.map((t) => (
            <div key={t.id} className="outfit-row">
              <span className="grow"><b>{t.name}</b> {t.locked && <span className="chip locked-chip"><Lock size={10} aria-hidden /> locked</span>}{uniform?.id === t.id && <span className="chip">wearing</span>} {t.kind === 'uniform' && <span className="chip">{t.approved ? 'approved uniform' : 'uniform · needs approval'}{t.department ? ` · ${t.department}` : ''}</span>}{t.occasion && <span className="chip">{t.occasion}</span>}</span>
              <button className="btn sm" onClick={() => commit([{ op: 'outfit.apply', outfitId: t.id, agentIds: [agent.id] }], `Dress ${agent.identity.name} in ${t.name}`)}>Wear</button>
              <select aria-label={`Apply ${t.name} to another agent`} value="" onChange={(e) => e.target.value && commit([{ op: 'outfit.apply', outfitId: t.id, agentIds: [e.target.value] }], `Apply ${t.name}`)}>
                <option value="">Apply to…</option>{others.map((o) => <option key={o.id} value={o.id}>{o.identity.name}</option>)}
              </select>
              {t.kind === 'uniform' && !t.approved && <button className="btn sm" onClick={() => commit([{ op: 'outfit.update', id: t.id, patch: { approved: true } }], `Approve ${t.name}`)}>Approve</button>}
              {t.kind === 'uniform' && t.approved && t.department && <button className="btn sm" onClick={() => commit([{ op: 'uniform.applyDepartment', outfitId: t.id, department: t.department! }], `Issue ${t.name}`)}>Issue to {t.department}</button>}
              <select aria-label={`Occasion for ${t.name}`} value={t.occasion ?? ''} onChange={(e) => commit([{ op: 'outfit.update', id: t.id, patch: { occasion: e.target.value || undefined } }], 'Tag outfit')}>
                <option value="">No occasion</option>{['Spring', 'Summer', 'Autumn', 'Winter', 'Holiday', 'Launch day', 'Board meeting'].map((o) => <option key={o}>{o}</option>)}
              </select>
              <button className="btn sm" onClick={() => commit([{ op: 'outfit.duplicate', id: t.id }], 'Duplicate outfit')}>Duplicate</button>
              {!t.locked && <button className="btn sm danger" onClick={() => commit([{ op: 'template.delete', id: t.id }], 'Delete outfit')}>Delete</button>}
            </div>
          ))}
          {!outfits.length && <p className="note">No saved outfits yet.</p>}
        </div>
      </div>
      <div className="card">
        <div className="row wrap" style={{ marginBottom: 8 }}>
          <h4 style={{ margin: 0 }}>Cosmetic inventory</h4>
          <span className="spacer" />
          <div className="obj-lib-search" style={{ maxWidth: 220 }}><Search size={13} aria-hidden /><input type="search" aria-label="Search cosmetics" placeholder="Search" value={q} onChange={(e) => setQ(e.target.value)} /></div>
          <select aria-label="Rarity" value={rarity} onChange={(e) => setRarity(e.target.value as Rarity | '')}><option value="">Any rarity</option>{(['common', 'uncommon', 'rare', 'legendary'] as Rarity[]).map((r) => <option key={r}>{r}</option>)}</select>
          <select aria-label="Collection" value={collection} onChange={(e) => setCollection(e.target.value)}><option value="">All collections</option>{collections.map((c) => <option key={c}>{c}</option>)}</select>
        </div>
        <div className="chips" role="tablist">{CATS.map((c) => <button key={c.id} role="tab" aria-selected={cat === c.id} className="chip-btn" onClick={() => setCat(c.id)}>{c.label}</button>)}</div>
        <p className="note">Four sci-fi pieces per slot. Rarity is only a label for collecting. It never changes what an agent may do.</p>
        <div className="cos-grid">
          {items.map((it) => {
            const tool = toolFor(it);
            const locked = !!tool && !agent.permissions.allowedTools.includes(tool);
            const wearing = isWearing(agent, it);
            return (
              <div key={it.id} className={`cos-item${wearing ? ' on' : ''}`}>
                <Swatch a={agent} it={it} />
                <div className="grow" style={{ minWidth: 0 }}>
                  <div className="ellipsis" title={it.name}>{it.name}</div>
                  <div className="small" style={{ color: RARITY_COLOR[it.rarity ?? 'common'] }}>{it.rarity ?? 'common'}{it.collection ? ` · ${it.collection}` : ''}</div>
                  {tool && <div className="small" style={{ color: locked ? 'var(--warn)' : 'var(--accent)' }}>{locked ? `Needs “${tool}” tool` : `Equipment · ${tool}`}</div>}
                </div>
                {uniform
                  ? <button className="btn sm" disabled title={`Locked by the ${uniform.name}`}>{wearing ? 'Remove' : 'Wear'}</button>
                  : wearing
                  ? <button className="btn sm" onClick={() => commit([{ op: 'cosmetic.remove', itemId: it.id, agentId: agent.id }], `Remove ${it.name}`)}>Remove</button>
                  : <button className="btn sm" disabled={locked} title={locked ? `Grant the ${tool} tool in Permissions to wear this` : undefined} onClick={() => commit([{ op: 'cosmetic.apply', itemId: it.id, agentIds: [agent.id] }], `Equip ${it.name}`)}>Wear</button>}
                {it.custom && <button className="btn icon sm danger" aria-label={`Delete ${it.name}`} onClick={() => confirmAction({ title: `Delete ${it.name}?`, confirmLabel: 'Delete', danger: true, body: 'Agents keep their current look; the item just leaves the inventory.', onConfirm: () => commit([{ op: 'cosmetic.delete', id: it.id }], 'Delete cosmetic') })}>×</button>}
              </div>
            );
          })}
          {!items.length && <p className="note">Nothing matches.</p>}
        </div>
        <CustomItemForm onAdd={addCustom} />
      </div>
    </div>
  );
}

function CustomItemForm({ onAdd }: { onAdd: (file: File | null, name: string, cat: CosmeticCategory) => void }) {
  const [name, setName] = useState('');
  const [cat, setCat] = useState<CosmeticCategory>('clothing');
  const [file, setFile] = useState<File | null>(null);
  return (
    <div className="row wrap" style={{ marginTop: 10 }}>
      <span className="label">Custom item</span>
      <input type="text" aria-label="Custom item name" placeholder="Name" value={name} onChange={(e) => setName(e.target.value)} style={{ maxWidth: 180 }} />
      <select aria-label="Custom item category" value={cat} onChange={(e) => setCat(e.target.value as CosmeticCategory)}><option value="clothing">Clothing</option><option value="head">Head & face</option><option value="accessory">Accessory colour</option><option value="effect">Effects</option></select>
      <label className="btn sm">{file ? file.name.slice(0, 18) : 'Upload artwork'}<input type="file" accept="image/*" hidden onChange={(e) => setFile(e.target.files?.[0] ?? null)} /></label>
      <button className="btn sm primary" disabled={!name.trim()} onClick={() => { onAdd(file, name.trim(), cat); setName(''); setFile(null); }}>Save from current look</button>
    </div>
  );
}
