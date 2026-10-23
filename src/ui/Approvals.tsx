// Approvals: everything that waits for the owner's Yes or No (To decide), what was decided, and
// the design setup (style notes, source folders). Designs the agents made pop up here as cards; Yes
// has the agent that made it build the Printify product and list it on the store (the Yes is the
// approval), No discards it. Products made outside that flow still wait for the Publish button.
// Budgets (cap, added funds, image and Canva limits, per-branch budgets) are defined here and shown
// under Settings. Everything comes from JARVIS's runner (useOrigin); nothing is simulated.
import { useMemo, useState } from 'react';
import { BadgeCheck, Check, CircleDollarSign, FolderOpen, Images, Palette, Plus, Repeat, Trash2, X, AlertTriangle } from 'lucide-react';
import { useStore } from '../store/store';
import { useOrigin } from '../brain/useOrigin';
import { designDecision, designUrl, mockupUrl, publishDecision, runnerStatus, setBudgets, setDesignStyle, sourceAction, sourceUrl, type DesignEntry, type PublishRequest, type RunnerStatus, type SourceFile } from '../brain/originLink';
import { ORIGIN_ID } from '../brain/opportunity';
import { usd } from './Dashboard';
import { PageTabs, TabPanel, usePageTab } from './PageTabs';

const when = (iso: string) => new Date(iso).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

/** An image the runner holds (a design file or a Printify mockup), shown as a local blob. */
function RunnerImage({ load, id, alt, cls = 'approval-img' }: { load: (id: string) => Promise<string | null>; id: string; alt: string; cls?: string }) {
  const [src, setSrc] = useState<string | null>(null);
  useMemo(() => { void load(id).then(setSrc); }, [load, id]);
  return src ? <img className={cls} src={src} alt={alt} /> : <div className={`${cls} is-empty`} aria-hidden />;
}

/** Which Approvals tab holds a section (a finished task's Open button names the section). */
export function approvalsTabFor(anchor: string | null | undefined): 'decide' | 'decided' | 'setup' {
  return anchor === 'approvals-decided' ? 'decided' : anchor === 'approvals-sources' ? 'setup' : 'decide';
}

export function Approvals() {
  const [tab, setTab] = usePageTab('approvals', ['decide', 'decided', 'setup'] as const);
  const st = useOrigin((o) => o.status);
  const checked = useOrigin((o) => o.checked);
  const [busy, setBusy] = useState<string | null>(null);
  const refresh = async () => useOrigin.setState({ status: await runnerStatus() });
  const notify = (t: string, level?: 'warn') => useStore.getState().notify(t, level);
  const decide = async (d: DesignEntry, action: 'approve' | 'reject') => {
    setBusy(d.id);
    const r = await designDecision(d.id, action);
    setBusy(null);
    if (!r) notify('The runner did not answer.', 'warn');
    else if (!r.ok) notify(r.reason ?? 'That did not work.', 'warn');
    else notify(action === 'approve' ? (r.note ?? `Yes to "${d.title}": ${d.agentName} is making the product and will list it on your store.`) : `No to "${d.title}"${r.printify ? ` (${r.printify})` : ''}.`);
    void refresh();
  };
  const pickMeme = async (m: SourceFile, pick: 'yes' | 'no') => {
    setBusy(m.ref);
    const r = await sourceAction({ action: 'pick', file: m.ref, pick });
    setBusy(null);
    if (!r?.ok) notify(r?.error ?? 'The runner did not answer.', 'warn');
    void refresh();
  };
  const product = async (r: PublishRequest, action: 'publish' | 'reject') => {
    setBusy(r.id);
    const x = await publishDecision(r.id, action);
    setBusy(null);
    notify(!x ? 'The runner did not answer.' : !x.ok ? (x.reason ?? 'Printify did not publish it.') : action === 'publish' ? `Published "${r.title}" to your store.` : `"${r.title}" ${x.printify ?? 'removed'}.`, x?.ok ? undefined : 'warn');
    void refresh();
  };
  if (st === undefined && !checked) return <div className="dash"><div className="dash-head"><div><span className="kicker"><i />APPROVALS</span><h2>Checking for JARVIS's runner…</h2></div></div></div>;
  if (!st) return <div className="dash"><div className="dash-head"><div><span className="kicker"><i />APPROVALS</span><h2>Nothing to approve: JARVIS is offline</h2><p>Start the runner on your PC with <code>npm.cmd run origin</code>, or open the desktop app. Designs and products appear here as the agents make them.</p></div></div></div>;

  const designs = st.designs ?? [];
  const waiting = designs.filter((d) => d.status === 'waiting');
  const decided = [...designs.filter((d) => d.status && d.status !== 'waiting'), ...(st.publishRequests ?? []).filter((r) => r.status !== 'waiting' && !designs.some((d) => d.id === r.designId)).map((r) => ({ id: r.id, title: r.title, agentName: r.agentName, status: r.status === 'published' ? 'published' as const : 'rejected' as const, at: r.at, decidedAt: r.decidedAt, publishedAt: r.publishedAt, printify: r.printify ?? (r.status === 'published' ? 'listed on the store' : undefined), product: true }))].sort((a, b) => (b.publishedAt ?? b.decidedAt ?? b.at).localeCompare(a.publishedAt ?? a.decidedAt ?? a.at)).slice(0, 12);
  const products = (st.publishRequests ?? []).filter((r) => r.status === 'waiting');
  const taskOf = (id: string | null) => st.tasks.find((t) => t.id === id);
  const groups = [...new Map(waiting.map((d) => [d.taskId ?? '', d])).keys()];
  const memes = st.memePicks ?? [];
  const toDecide = waiting.length + products.length + memes.length;
  const placeName = { front_center: 'front, centred', full_front: 'full front', left_chest: 'left chest', back: 'back' } as const;

  return (
    <div className="dash approvals">
      <div className="dash-head">
        <div>
          <span className="kicker"><i />APPROVALS</span>
          <h2>{toDecide ? `${toDecide} waiting for your Yes or No` : 'Nothing waiting right now'}</h2>
          <p>Yes on a design: the agent that made it builds the Printify product and lists it on your store (that Yes is the approval; Etsy charges {usd(st.budgets?.listingFeeUsd ?? 0.2)} a listing). No deletes it from Printify too. Each ask shows at most 5 designs at a time; the agent makes more when you decide.</p>
        </div>
      </div>

      <PageTabs label="Approvals sections" value={tab} onChange={setTab} tabs={[
        { id: 'decide', label: 'To decide', icon: Check, count: toDecide, alert: true },
        { id: 'decided', label: 'Decided', icon: Repeat, count: decided.length },
        { id: 'setup', label: 'Design setup', icon: Palette },
      ]} />

      {tab === 'decide' && <TabPanel id="decide">
      {!toDecide && <div className="card span-12 empty-state"><Check size={22} /><b>All caught up</b><span>Memes, designs and products that wait for your Yes or No show up here.</span></div>}
      {memes.length > 0 && <section id="approvals-memes" className="card approval-group">
        <h4><Images size={13} /> Memes to pick <span className="count">{memes.length} found by the scouts · only your Yes picks get designed</span></h4>
        <div className="approval-grid">
          {memes.map((m) => <figure key={m.ref} className="approval-card">
            <RunnerImage load={sourceUrl} id={m.ref} alt={m.title ?? m.name} />
            <figcaption>
              <b>{m.title ?? m.name}</b>
              <span>{m.savedBy ?? 'a scout'} · {when(m.at)}{m.page ? <> · <a href={m.page} target="_blank" rel="noreferrer">source</a></> : null}</span>
              {m.tags?.length ? <span className="small muted">{m.tags.join(', ')}</span> : null}
              <div className="approval-actions">
                <button className="btn sm danger" disabled={busy === m.ref} onClick={() => void pickMeme(m, 'no')}><X size={13} /> No</button>
                <button className="btn sm primary" disabled={busy === m.ref} onClick={() => void pickMeme(m, 'yes')}><Check size={13} /> Yes, design it</button>
              </div>
            </figcaption>
          </figure>)}
        </div>
      </section>}

      {groups.map((taskId) => {
        const t = taskOf(taskId);
        const mine = waiting.filter((d) => (d.taskId ?? '') === taskId);
        return <section key={taskId || 'loose'} id={`approvals-task-${taskId}`} className="card approval-group">
          <h4><Images size={13} /> {t?.title ?? mine[0].taskTitle ?? 'Designs'} <span className="count">{mine.length} waiting{t?.count ? ` · asked for ${t.count}` : ''}{t?.everyMinutes ? ' · repeats' : ''}</span></h4>
          <div className="approval-grid">
            {mine.map((d) => <figure key={d.id} className="approval-card">
              <RunnerImage load={designUrl} id={d.id} alt={d.title} />
              <figcaption>
                <b>{d.title}</b>
                <span>{d.agentName} · {when(d.at)}{d.source === 'canva' ? ' · Canva' : d.source === 'caption' ? ' · captioned image' : d.kind === 'svg' ? ' · SVG' : ' · image'}{d.placement ? ` · prints ${placeName[d.placement]}` : ''}{d.memeType ? ` · ${d.memeType.replace(/_/g, ' ')}` : ''}</span>
                {d.sourceFile || d.assets?.length ? <div className="approval-source">
                  {d.sourceFile ? <RunnerImage load={sourceUrl} id={d.sourceFile} alt={`The image ${d.title} was made from`} cls="approval-source-img" /> : null}
                  <span className="small muted">Made from {d.assets?.length ? d.assets.map((x, i) => <span key={i}>{i ? ', ' : ''}{x.page ? <a href={x.page} target="_blank" rel="noreferrer">{x.title || 'an image'}</a> : (x.title || 'an image')}{x.licence ? ` (${x.licence})` : ''}</span>) : <>a saved image{d.rights === 'owner' ? ' of yours' : ''}</>}{d.sourceFile ? <> · <code>{d.sourceFile}</code></> : null}</span>
                </div> : <span className="small muted">{d.source === 'canva' ? `Made in Canva by ${d.agentName}` : `Drawn by ${d.agentName}, no source image`}</span>}
                {d.checkNote && <span className="small warn"><AlertTriangle size={11} /> Failed the shirt check twice: {d.checkNote.replace(/^shirt check: /, '')}</span>}
                {d.rights === 'reference' && <span className="small warn"><AlertTriangle size={11} /> Draft on someone's image: for the idea only, not for sale. Yes keeps it; it is not listed for sale as it is.</span>}
                <div className="approval-actions">
                  <button className="btn sm danger" disabled={busy === d.id} onClick={() => void decide(d, 'reject')}><X size={13} /> No</button>
                  <button className="btn sm primary" disabled={busy === d.id} onClick={() => void decide(d, 'approve')}><Check size={13} /> {d.rights === 'reference' ? 'Keep the draft' : 'Yes, make and list it'}</button>
                </div>
              </figcaption>
            </figure>)}
          </div>
        </section>;
      })}

      {products.length > 0 && <section className="card approval-group">
        <h4><BadgeCheck size={13} /> Products ready to publish <span className="count">{products.length}</span></h4>
        <div className="approval-grid">
          {products.map((r) => <figure key={r.id} className="approval-card">
            {r.image ? <RunnerImage load={mockupUrl} id={r.id} alt={`Mockup of ${r.title}`} /> : <div className="approval-img is-empty" aria-hidden />}
            <figcaption>
              <b>{r.title}</b>
              <span>{r.agentName}{r.priceUsd ? ` · ${usd(r.priceUsd)}` : ''} · {when(r.at)}</span>
              {r.why && <small>{r.why}</small>}
              <div className="approval-actions">
                <button className="btn sm danger" disabled={busy === r.id} onClick={() => void product(r, 'reject')}><X size={13} /> No, delete it</button>
                <button className="btn sm primary" disabled={busy === r.id} onClick={() => void product(r, 'publish')}><Check size={13} /> Publish</button>
              </div>
            </figcaption>
          </figure>)}
        </div>
      </section>}

      </TabPanel>}

      {tab === 'decided' && <TabPanel id="decided">
      {!decided.length && <div className="card span-12 empty-state"><Repeat size={22} /><b>Nothing decided yet</b><span>Your Yes and No answers are listed here.</span></div>}
      {decided.length > 0 && <section id="approvals-decided" className="card approval-group">
        <h4><Repeat size={13} /> Decided lately <span className="count">{decided.length}</span></h4>
        <ul className="approval-log">
          {decided.map((d) => <li key={d.id}><span className={`approval-state ${d.status}`}>{d.status === 'published' ? 'listed' : d.status === 'approved' ? 'making it' : 'no'}</span> <b>{d.title}</b> · {d.agentName} · {when(d.publishedAt ?? d.decidedAt ?? d.at)}{d.printify ? <> · {d.printify}</> : d.status === 'approved' ? <> · {taskOf(st.tasks.find((t) => t.designId === d.id)?.id ?? null)?.status === 'done' ? 'product made; waiting to publish' : 'the agent is making the product now'}</> : null}</li>)}
        </ul>
      </section>}

      </TabPanel>}

      {tab === 'setup' && <TabPanel id="setup"><DesignStyle st={st} onDone={() => void refresh()} /></TabPanel>}
    </div>
  );
}

/** The owner's budgets, changed whenever they top up; every change is logged by the runner and in force at once. */
/** The owner's taste in designs: the built-in guide, plus their own notes that every agent gets from the next run. */
function DesignStyle({ st, onDone }: { st: RunnerStatus; onDone: () => void }) {
  const d = st.designStyle;
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if (!d) return null;
  const value = note ?? d.note;
  const save = async () => {
    setBusy(true);
    const r = await setDesignStyle(value);
    setBusy(false);
    useStore.getState().notify(r?.ok ? (value.trim() ? 'Saved. Agents follow your note from their next design.' : 'Your note is cleared; the built-in style guide stays.') : 'The runner did not answer.', r?.ok ? undefined : 'warn');
    setNote(null);
    onDone();
  };
  return (
    <section className="card approval-group">
      <h4><Palette size={13} /> Design style <span className="count">what every agent is told before it draws</span></h4>
      <details><summary className="small">The built-in guide: modern, simple, funny (one flat drawing, a short lowercase caption like a fish captioned "fih")</summary><p className="note">{d.guide}</p></details>
      <label className="small" htmlFor="design-style-note">Your own notes, in your words <small>{d.at ? `last changed ${when(d.at)}` : 'none yet'}</small></label>
      <textarea id="design-style-note" rows={3} value={value} maxLength={2000} placeholder='e.g. "more animals, fewer food jokes", "navy and cream only", "add a tiny crown on everything"' onChange={(e) => setNote(e.target.value)} style={{ width: '100%' }} />
      <div className="approval-actions"><button className="btn sm primary" disabled={busy || note == null || note === d.note} onClick={() => void save()}><Check size={13} /> Save</button></div>
      <DesignSources st={st} onDone={onDone} />
    </section>
  );
}

/** The folders on the owner's PC the designers may draw from: memez (what the scouts save) and the owner's own linked folders. */
function DesignSources({ st, onDone }: { st: RunnerStatus; onDone: () => void }) {
  const [path, setPath] = useState('');
  const [label, setLabel] = useState('');
  const [busy, setBusy] = useState(false);
  const notify = (t: string, level?: 'warn') => useStore.getState().notify(t, level);
  const act = async (body: Parameters<typeof sourceAction>[0], done: string) => {
    setBusy(true);
    const r = await sourceAction(body);
    setBusy(false);
    notify(!r ? 'The runner did not answer.' : r.ok ? done : (r.error ?? 'That did not work.'), r?.ok ? undefined : 'warn');
    if (r?.ok) { setPath(''); setLabel(''); onDone(); }
  };
  const sources = st.sources ?? [];
  const usable = (u: string) => (u === 'print' ? 'can go on a shirt (public domain)' : u === 'owner' ? 'your own file: yours to print' : 'reference: drafts only, not for sale');
  return (
    <div className="design-sources" id="approvals-sources">
      <h4><FolderOpen size={13} /> Design sources <span className="count">folders on your PC the designers may use</span></h4>
      <p className="small muted">The scouts save images they find online into <b>memez</b> with the source and licence recorded: a public-domain or CC0 image can go on a shirt; anything else (meme templates, Reddit pictures, posts) is reference: the designers can caption and crop it as a draft you see here, flagged, but it is never listed as it is. Link your own folders too: your files are yours to print. Declining a design made from a saved image deletes that one image.</p>
      <ul className="creator-request-log">
        {sources.map((f) => <li key={f.id}>
          <b>{f.label}</b> <span className="small muted">{f.path}{!f.exists ? ' (not there yet)' : ''} · {f.files} image{f.files === 1 ? '' : 's'}{f.files ? `: ${f.printable} printable, ${f.reference} reference` : ''}{f.notes ? ` · ${f.notes} meme note${f.notes === 1 ? '' : 's'}` : ''}</span>
          {!f.builtin && <> <button className="link-btn" disabled={busy} onClick={() => void act({ action: 'remove', id: f.id }, `Unlinked ${f.label}; the files stay on your PC.`)}>unlink</button></>}
          {f.recent.length > 0 && <ul className="small">{f.recent.map((x) => <li key={x.ref}>{x.title ?? x.name} <span className="muted">· {usable(x.usable)}{x.savedBy ? ` · saved by ${x.savedBy}` : ''}</span> {x.savedBy && <button className="link-btn" disabled={busy} onClick={() => void act({ action: 'delete', file: x.ref }, `Deleted ${x.name}.`)}><Trash2 size={11} /> delete</button>}</li>)}</ul>}
        </li>)}
      </ul>
      <form className="row wrap" onSubmit={(e) => { e.preventDefault(); if (path.trim()) void act({ action: 'add', path: path.trim(), label: label.trim() || undefined }, `Linked ${label.trim() || path.trim()}. The designers see its files from their next run.`); }}>
        <input value={path} onChange={(e) => setPath(e.target.value)} placeholder="Full path of a folder on this PC, e.g. C:\Users\edpfl\Pictures\shirt ideas" aria-label="Folder path" style={{ flex: 1, minWidth: 220 }} />
        <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Name (optional)" aria-label="Folder name" maxLength={60} style={{ width: 140 }} />
        <button className="btn sm" type="submit" disabled={busy || !path.trim()}><Plus size={13} /> Link folder</button>
      </form>
    </div>
  );
}

export function Budgets({ st, agents, onDone }: { st: RunnerStatus; agents: Record<string, { identity: { name: string } }>; onDone: () => void }) {
  const b = st.budgets;
  const [cap, setCap] = useState('');
  const [add, setAdd] = useState('');
  const [img, setImg] = useState('');
  const [canva, setCanva] = useState('');
  const [branch, setBranch] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  if (!b) return null;
  const apply = async (patch: Parameters<typeof setBudgets>[0], msg: string) => {
    setBusy(true);
    const r = await setBudgets(patch);
    setBusy(false);
    useStore.getState().notify(r?.ok ? msg : 'The runner did not answer.', r?.ok ? undefined : 'warn');
    onDone();
  };
  const name = (id: string) => (id === ORIGIN_ID ? 'JARVIS' : agents[id]?.identity.name ?? id);
  const num = (v: string) => (v.trim() === '' ? null : Number(v));
  return (
    <section className="card approval-group budgets">
      <h4><CircleDollarSign size={13} /> Budgets <span className="count">this month: {usd(st.spentUsd)} of {usd(b.capUsd)} spent</span></h4>
      <div className="budget-grid">
        <form className="budget-row" onSubmit={(e) => { e.preventDefault(); const v = num(add); if (v && v > 0) { void apply({ addFundsUsd: v }, `Added ${usd(v)}: the cap is now ${usd(b.capUsd + v)}.`); setAdd(''); } }}>
          <label>Add funds to the monthly cap <small>you topped up; agents see the new cap at once</small></label>
          <input type="number" min={0} step="1" placeholder="$" value={add} onChange={(e) => setAdd(e.target.value)} aria-label="Dollars to add" />
          <button className="btn sm primary" disabled={busy || !(Number(add) > 0)}><Plus size={13} /> Add</button>
        </form>
        <form className="budget-row" onSubmit={(e) => { e.preventDefault(); const v = num(cap); if (v != null && v >= 0) { void apply({ capUsd: v }, `Monthly cap set to ${usd(v)}.`); setCap(''); } }}>
          <label>Monthly cap (Claude) <small>now {usd(b.capUsd)}{b.capUsd !== b.defaultCapUsd ? `, default ${usd(b.defaultCapUsd)}` : ''}</small></label>
          <input type="number" min={0} step="1" placeholder={String(b.capUsd)} value={cap} onChange={(e) => setCap(e.target.value)} aria-label="Monthly cap in dollars" />
          <button className="btn sm" disabled={busy || cap === ''}>Set</button>
        </form>
        <form className="budget-row" onSubmit={(e) => { e.preventDefault(); const v = num(img); if (v != null && v >= 0) { void apply({ imageCapUsd: v }, `Image limit set to ${usd(v)} a month.`); setImg(''); } }}>
          <label>ChatGPT images a month <small>billed to OpenAI; {usd(st.images?.spentUsd ?? 0)} of {usd(b.imageCapUsd)} used</small></label>
          <input type="number" min={0} step="1" placeholder={String(b.imageCapUsd)} value={img} onChange={(e) => setImg(e.target.value)} aria-label="Monthly image limit in dollars" />
          <button className="btn sm" disabled={busy || img === ''}>Set</button>
        </form>
        <form className="budget-row" onSubmit={(e) => { e.preventDefault(); const v = num(canva); if (v != null && v >= 0) { void apply({ canvaAiLimit: v }, `Canva limit set to ${Math.round(v)} AI designs a month.`); setCanva(''); } }}>
          <label>Canva AI designs a month <small>uses your Canva credits; {st.canva?.aiCalls ?? 0} of {b.canvaAiLimit} used</small></label>
          <input type="number" min={0} step="1" placeholder={String(b.canvaAiLimit)} value={canva} onChange={(e) => setCanva(e.target.value)} aria-label="Monthly Canva AI limit" />
          <button className="btn sm" disabled={busy || canva === ''}>Set</button>
        </form>
      </div>
      <h4 style={{ marginTop: 12 }}>Per branch <span className="count">a branch's tasks wait once its budget for the month is used; Claude work, images and {usd(b.listingFeeUsd)} a listing all count</span></h4>
      <div className="budget-grid">
        {b.branches.map((r) => <form key={r.id} className="budget-row" onSubmit={(e) => { e.preventDefault(); const v = num(branch[r.id] ?? ''); void apply({ branchBudgets: { [r.id]: v != null && v > 0 ? v : null } }, v != null && v > 0 ? `${name(r.id)} may spend ${usd(v)} a month.` : `${name(r.id)} has no budget of its own again (the cap still holds).`); setBranch((x) => ({ ...x, [r.id]: '' })); }}>
          <label>{name(r.id)} <small>{usd(r.spentUsd)} spent this month{r.budgetUsd != null ? ` of ${usd(r.budgetUsd)}` : ', no budget of its own'}</small></label>
          <input type="number" min={0} step="1" placeholder={r.budgetUsd != null ? String(r.budgetUsd) : 'none'} value={branch[r.id] ?? ''} onChange={(e) => setBranch((x) => ({ ...x, [r.id]: e.target.value }))} aria-label={`Monthly budget for ${name(r.id)}`} />
          <button className="btn sm" disabled={busy}>{(branch[r.id] ?? '').trim() === '' && r.budgetUsd != null ? 'Remove' : 'Set'}</button>
        </form>)}
      </div>
      {b.log.length > 0 && <ul className="approval-log"><li className="muted">Changes</li>{b.log.slice(0, 8).map((c) => <li key={c.id}>{when(c.at)} · {c.what}: {c.from == null ? 'none' : typeof c.from === 'number' && /limit$/i.test(c.what) && !/\$/.test(c.what) && c.what.includes('Canva') ? c.from : usd(c.from)} → {c.to == null ? 'none' : c.what.includes('Canva') ? c.to : usd(c.to)}</li>)}</ul>}
    </section>
  );
}
