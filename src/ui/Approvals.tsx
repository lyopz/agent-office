// Approvals: everything that waits for the owner's Yes or No, and the budgets the agents work
// within. Designs the agents made pop up here as cards; Yes has the agent that made it build the
// Printify product and list it on the store (the Yes is the approval), No discards it. Products
// made outside that flow still wait for the Publish button. Budgets are set here too, whenever the
// owner tops up: the monthly cap, funds added to it, the image and Canva limits, and per-branch
// budgets. Everything comes from JARVIS's runner (useOrigin); nothing is simulated.
import { useMemo, useState } from 'react';
import { BadgeCheck, Check, CircleDollarSign, Images, Plus, Repeat, X } from 'lucide-react';
import { useStore } from '../store/store';
import { useOrigin } from '../brain/useOrigin';
import { designDecision, designUrl, mockupUrl, publishDecision, runnerStatus, setBudgets, type DesignEntry, type PublishRequest, type RunnerStatus } from '../brain/originLink';
import { ORIGIN_ID } from '../brain/opportunity';
import { usd } from './Dashboard';

const when = (iso: string) => new Date(iso).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

/** An image the runner holds (a design file or a Printify mockup), shown as a local blob. */
function RunnerImage({ load, id, alt }: { load: (id: string) => Promise<string | null>; id: string; alt: string }) {
  const [src, setSrc] = useState<string | null>(null);
  useMemo(() => { void load(id).then(setSrc); }, [load, id]);
  return src ? <img className="approval-img" src={src} alt={alt} /> : <div className="approval-img is-empty" aria-hidden />;
}

export function Approvals() {
  const doc = useStore((s) => s.doc);
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
    else notify(action === 'approve' ? (r.note ?? `Yes to "${d.title}": ${d.agentName} is making the product and will list it on your store.`) : `No to "${d.title}".`);
    void refresh();
  };
  const product = async (r: PublishRequest, action: 'publish' | 'reject') => {
    setBusy(r.id);
    const x = await publishDecision(r.id, action);
    setBusy(null);
    notify(!x ? 'The runner did not answer.' : !x.ok ? (x.reason ?? 'Printify did not publish it.') : action === 'publish' ? `Published "${r.title}".` : 'Not published.', x?.ok ? undefined : 'warn');
    void refresh();
  };
  if (st === undefined && !checked) return <div className="dash"><div className="dash-head"><div><span className="kicker"><i />APPROVALS</span><h2>Checking for JARVIS's runner…</h2></div></div></div>;
  if (!st) return <div className="dash"><div className="dash-head"><div><span className="kicker"><i />APPROVALS</span><h2>Nothing to approve: JARVIS is offline</h2><p>Start the runner on your PC with <code>npm.cmd run origin</code>, or open the desktop app. Designs and products appear here as the agents make them.</p></div></div></div>;

  const designs = st.designs ?? [];
  const waiting = designs.filter((d) => d.status === 'waiting');
  const decided = designs.filter((d) => d.status && d.status !== 'waiting').slice(0, 12);
  const products = (st.publishRequests ?? []).filter((r) => r.status === 'waiting');
  const taskOf = (id: string | null) => st.tasks.find((t) => t.id === id);
  const groups = [...new Map(waiting.map((d) => [d.taskId ?? '', d])).keys()];

  return (
    <div className="dash approvals">
      <div className="dash-head">
        <div>
          <span className="kicker"><i />APPROVALS</span>
          <h2>{waiting.length + products.length ? `${waiting.length + products.length} waiting for your Yes or No` : 'Nothing waiting right now'}</h2>
          <p>Yes on a design: the agent that made it builds the Printify product and lists it on your store (that Yes is the approval; Etsy charges {usd(st.budgets?.listingFeeUsd ?? 0.2)} a listing). No discards it. Each ask shows at most 5 designs at a time; the agent makes more when you decide.</p>
        </div>
      </div>

      {groups.map((taskId) => {
        const t = taskOf(taskId);
        const mine = waiting.filter((d) => (d.taskId ?? '') === taskId);
        return <section key={taskId || 'loose'} className="card approval-group">
          <h4><Images size={13} /> {t?.title ?? mine[0].taskTitle ?? 'Designs'} <span className="count">{mine.length} waiting{t?.count ? ` · asked for ${t.count}` : ''}{t?.everyMinutes ? ' · repeats' : ''}</span></h4>
          <div className="approval-grid">
            {mine.map((d) => <figure key={d.id} className="approval-card">
              <RunnerImage load={designUrl} id={d.id} alt={d.title} />
              <figcaption>
                <b>{d.title}</b>
                <span>{d.agentName} · {when(d.at)}{d.source === 'canva' ? ' · Canva' : d.kind === 'svg' ? ' · SVG' : ' · image'}</span>
                <div className="approval-actions">
                  <button className="btn sm danger" disabled={busy === d.id} onClick={() => void decide(d, 'reject')}><X size={13} /> No</button>
                  <button className="btn sm primary" disabled={busy === d.id} onClick={() => void decide(d, 'approve')}><Check size={13} /> Yes, make and list it</button>
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
                <button className="btn sm danger" disabled={busy === r.id} onClick={() => void product(r, 'reject')}><X size={13} /> No</button>
                <button className="btn sm primary" disabled={busy === r.id} onClick={() => void product(r, 'publish')}><Check size={13} /> Publish</button>
              </div>
            </figcaption>
          </figure>)}
        </div>
      </section>}

      {decided.length > 0 && <section className="card approval-group">
        <h4><Repeat size={13} /> Decided lately <span className="count">{decided.length}</span></h4>
        <ul className="approval-log">
          {decided.map((d) => <li key={d.id}><span className={`approval-state ${d.status}`}>{d.status === 'published' ? 'listed' : d.status === 'approved' ? 'making it' : 'no'}</span> <b>{d.title}</b> · {d.agentName} · {when(d.publishedAt ?? d.decidedAt ?? d.at)}{d.status === 'approved' && <> · {taskOf(st.tasks.find((t) => t.designId === d.id)?.id ?? null)?.status === 'done' ? 'product made; waiting to publish' : 'the agent is making the product now'}</>}</li>)}
        </ul>
      </section>}

      <Budgets st={st} agents={doc.agents} onDone={() => void refresh()} />
    </div>
  );
}

/** The owner's budgets, changed whenever they top up; every change is logged by the runner and in force at once. */
function Budgets({ st, agents, onDone }: { st: RunnerStatus; agents: Record<string, { identity: { name: string } }>; onDone: () => void }) {
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
