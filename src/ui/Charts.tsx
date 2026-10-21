// Charts: how the store is doing, drawn from what JARVIS's runner really recorded. Sales come from
// Printify's orders (pulled every hour, or now with the button), costs from the ledger, designs and
// ads from their lists. Nothing here is simulated; with no sales yet the charts say so.
import { useMemo, useState } from 'react';
import { BarChart3, RefreshCw, Table2 } from 'lucide-react';
import { useStore } from '../store/store';
import { useOrigin } from '../brain/useOrigin';
import { moneyAction, runnerStatus, type RunnerStatus, type SaleLine } from '../brain/originLink';
import { moneyByBranch } from '../brain/branchMoney';
import { usd } from './Dashboard';

/** The two series colours, validated together for colour-blind readers on the dark surface. */
export const EARNED = '#ea5068', SPENT = '#3f96cc';
const DAYS = 30;
const dayKey = (d: Date) => d.toISOString().slice(0, 10);
const shortDay = (key: string) => new Date(`${key}T12:00:00Z`).toLocaleDateString([], { month: 'short', day: 'numeric' });

/** Revenue, items and orders per day for the last 30 days (oldest first). */
export function salesByDay(sales: SaleLine[], now = new Date(), days = DAYS): { day: string; revenueUsd: number; items: number; orders: number }[] {
  const out = new Map<string, { day: string; revenueUsd: number; items: number; orders: Set<string> }>();
  for (let i = days - 1; i >= 0; i--) { const d = new Date(now); d.setUTCDate(d.getUTCDate() - i); const k = dayKey(d); out.set(k, { day: k, revenueUsd: 0, items: 0, orders: new Set() }); }
  for (const s of sales) {
    const k = String(s.at || '').slice(0, 10);
    const row = out.get(k);
    if (!row || s.status === 'canceled') continue;
    row.revenueUsd += s.revenueUsd ?? 0; row.items += s.quantity; row.orders.add(s.orderId);
  }
  return [...out.values()].map((r) => ({ day: r.day, revenueUsd: Math.round(r.revenueUsd * 100) / 100, items: r.items, orders: r.orders.size }));
}
/** The products that earned most, by revenue then items. */
export function topProducts(sales: SaleLine[], n = 6): { productId: string; title: string; revenueUsd: number; items: number }[] {
  const m = new Map<string, { productId: string; title: string; revenueUsd: number; items: number }>();
  for (const s of sales) {
    if (s.status === 'canceled') continue;
    const r = m.get(s.productId) ?? m.set(s.productId, { productId: s.productId, title: s.title, revenueUsd: 0, items: 0 }).get(s.productId)!;
    r.revenueUsd += s.revenueUsd ?? 0; r.items += s.quantity;
  }
  return [...m.values()].sort((a, b) => b.revenueUsd - a.revenueUsd || b.items - a.items).slice(0, n);
}

/** Vertical bars for one measure per day; hover a bar for its value. */
function DayBars({ rows, value, label, color = EARNED, money = true }: { rows: { day: string; [k: string]: number | string }[]; value: string; label: string; color?: string; money?: boolean }) {
  const W = 600, H = 150, pad = { l: 36, r: 6, t: 8, b: 20 };
  const max = Math.max(1e-9, ...rows.map((r) => Number(r[value])));
  const bw = (W - pad.l - pad.r) / rows.length;
  const fmt = (n: number) => (money ? usd(n) : String(n));
  const total = rows.reduce((a, r) => a + Number(r[value]), 0);
  return (
    <figure className="chart">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${label} per day, last ${rows.length} days, total ${fmt(total)}`}>
        <line x1={pad.l} x2={W - pad.r} y1={H - pad.b} y2={H - pad.b} className="axis" />
        <text x={pad.l - 6} y={pad.t + 8} className="tick" textAnchor="end">{fmt(max)}</text>
        <text x={pad.l - 6} y={H - pad.b} className="tick" textAnchor="end">0</text>
        {rows.map((r, i) => {
          const v = Number(r[value]); const h = v > 0 ? Math.max(2, ((H - pad.t - pad.b) * v) / max) : 0;
          return <rect key={r.day} x={pad.l + i * bw + 1} y={H - pad.b - h} width={Math.max(1, bw - 2)} height={h} rx={2} fill={color} className="mark"><title>{`${shortDay(String(r.day))}: ${fmt(v)}`}</title></rect>;
        })}
        <text x={pad.l} y={H - 5} className="tick">{shortDay(String(rows[0].day))}</text>
        <text x={W - pad.r} y={H - 5} className="tick" textAnchor="end">{shortDay(String(rows[rows.length - 1].day))}</text>
      </svg>
      <figcaption>{label}: {fmt(total)} in {rows.length} days{total === 0 ? ' (nothing yet)' : ''}</figcaption>
    </figure>
  );
}

/** Horizontal bars, one or two series per row, with the values written beside them. */
function Bars({ rows, series, money = true }: { rows: { name: string; values: number[] }[]; series: { name: string; color: string }[]; money?: boolean }) {
  const max = Math.max(1e-9, ...rows.flatMap((r) => r.values));
  const fmt = (n: number) => (money ? usd(n) : String(n));
  if (!rows.length) return <p className="muted small">Nothing yet.</p>;
  return (
    <div className="hbars">
      {series.length > 1 && <div className="legend">{series.map((s) => <span key={s.name}><i style={{ background: s.color }} /> {s.name}</span>)}</div>}
      {rows.map((r) => <div key={r.name} className="hbar-row">
        <span className="hbar-name" title={r.name}>{r.name}</span>
        <div className="hbar-tracks">
          {r.values.map((v, i) => <div key={i} className="hbar-track" title={`${r.name}: ${series[i]?.name ?? ''} ${fmt(v)}`}><i style={{ width: `${(100 * v) / max}%`, background: series[i]?.color ?? EARNED }} /><span>{fmt(v)}</span></div>)}
        </div>
      </div>)}
    </div>
  );
}

function Meter({ label, value, cap, color }: { label: string; value: number; cap: number; color: string }) {
  const pct = cap > 0 ? Math.min(100, (100 * value) / cap) : 0;
  return <div className="meter"><div className="row"><span>{label}</span><span className="muted">{usd(value)} of {usd(cap)}</span></div><div className="meter-track" role="progressbar" aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100} aria-label={label}><i style={{ width: `${pct}%`, background: pct >= 90 ? 'var(--warn)' : color }} /></div></div>;
}

export function Charts() {
  const doc = useStore((s) => s.doc);
  const st = useOrigin((o) => o.status);
  const checked = useOrigin((o) => o.checked);
  const [table, setTable] = useState(false);
  const [busy, setBusy] = useState(false);
  const refresh = async () => useOrigin.setState({ status: await runnerStatus() });
  const pull = async () => {
    setBusy(true);
    const r = await moneyAction({ action: 'sync' });
    setBusy(false);
    useStore.getState().notify(!r ? 'The runner did not answer.' : r.ok ? 'Sales pulled from Printify.' : (r.error ?? 'Printify did not answer.'), r?.ok ? undefined : 'warn');
    void refresh();
  };
  const sales = st?.money?.sales ?? [];
  const days = useMemo(() => salesByDay(sales), [sales]);
  const products = useMemo(() => topProducts(sales), [sales]);
  const branches = useMemo(() => (st?.money ? moneyByBranch(doc.agents, st.money.byAgent).filter((b) => b.spentUsd > 0 || b.earnedUsd > 0) : []), [doc.agents, st?.money]);
  if (st === undefined && !checked) return <div className="dash"><div className="dash-head"><div><span className="kicker"><i />CHARTS</span><h2>Checking for JARVIS's runner…</h2></div></div></div>;
  if (!st) return <div className="dash"><div className="dash-head"><div><span className="kicker"><i />CHARTS</span><h2>No numbers: JARVIS is offline</h2><p>Start the runner on your PC with <code>npm.cmd run origin</code>, or open the desktop app. Sales, costs, designs and ads are charted from what it records.</p></div></div></div>;
  const last30 = days.reduce((a, r) => ({ revenueUsd: a.revenueUsd + r.revenueUsd, items: a.items + r.items, orders: a.orders + r.orders }), { revenueUsd: 0, items: 0, orders: 0 });
  const earned = branches.reduce((a, b) => a + b.earnedUsd, 0), spent = branches.reduce((a, b) => a + b.spentUsd, 0);
  const designs = st.designs ?? [], ads = st.ads ?? [];
  const count = <T extends { status?: string }>(xs: T[], s: string) => xs.filter((x) => x.status === s).length;
  const synced = st.money?.salesSync;
  return (
    <div className="dash charts">
      <div className="dash-head">
        <div><span className="kicker"><i />CHARTS</span><h2>Sales and costs</h2><p>Sales come from Printify's orders{synced?.at ? `, last pulled ${new Date(synced.at).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}` : ''}{synced?.error ? ` (last pull failed: ${synced.error})` : ''}. Revenue is what buyers paid; costs are Claude runs, images, listing fees, production and estimated Etsy fees.</p></div>
        <div className="actions">
          <button className="btn sm" aria-pressed={table} onClick={() => setTable((t) => !t)}><Table2 size={13} /> {table ? 'Charts' : 'Table'}</button>
          <button className="btn sm primary" disabled={busy || !st.printify?.configured} title={st.printify?.configured ? 'Pull the latest orders from Printify now' : 'Printify is not set up (npm.cmd run set-printify)'} onClick={() => void pull()}><RefreshCw size={13} /> {busy ? 'Pulling…' : 'Pull latest sales'}</button>
        </div>
      </div>
      <div className="card kpi span-3"><h4>Revenue, {DAYS} days</h4><div className="kpi-value">{usd(last30.revenueUsd)}</div><div className="small muted">{last30.items} item{last30.items === 1 ? '' : 's'} in {last30.orders} order{last30.orders === 1 ? '' : 's'}</div></div>
      <div className="card kpi span-3"><h4>Earned, all time</h4><div className="kpi-value">{usd(earned)}</div><div className="small muted">real sales and your own entries</div></div>
      <div className="card kpi span-3"><h4>Spent, all time</h4><div className="kpi-value">{usd(spent)}</div><div className="small muted">runs, images, fees, production</div></div>
      <div className="card kpi span-3"><h4>Net</h4><div className="kpi-value" style={{ color: earned - spent < 0 ? 'var(--warn)' : undefined }}>{usd(earned - spent)}</div><div className="small muted">{earned - spent < 0 ? 'the store has not paid for itself yet' : 'the store is ahead'}</div></div>
      <div className="card span-8"><h4><BarChart3 size={13} /> Revenue per day</h4>
        {table ? <table className="spend-table"><thead><tr><th>Day</th><th>Revenue</th><th>Items</th><th>Orders</th></tr></thead><tbody>{days.filter((d) => d.items > 0).map((d) => <tr key={d.day}><td>{shortDay(d.day)}</td><td>{usd(d.revenueUsd)}</td><td>{d.items}</td><td>{d.orders}</td></tr>)}{!days.some((d) => d.items > 0) && <tr><td colSpan={4} className="muted">No sales in the last {DAYS} days.</td></tr>}</tbody></table>
          : <><DayBars rows={days} value="revenueUsd" label="Revenue" /><DayBars rows={days} value="items" label="Items sold" color={SPENT} money={false} /></>}
      </div>
      <div className="card span-4"><h4>This month's budgets</h4>
        <Meter label="JARVIS and agents (Claude)" value={st.spentUsd} cap={st.capUsd} color={SPENT} />
        {st.images && <Meter label="Design images" value={st.images.spentUsd} cap={st.images.capUsd} color={SPENT} />}
        {st.canva?.configured && <div className="meter"><div className="row"><span>Canva AI designs</span><span className="muted">{st.canva.aiCalls} of {st.canva.limit}</span></div><div className="meter-track"><i style={{ width: `${Math.min(100, (100 * st.canva.aiCalls) / Math.max(1, st.canva.limit))}%`, background: SPENT }} /></div></div>}
        <p className="small muted">Budgets are set in Approvals. Runs stop at the cap.</p>
      </div>
      <div className="card span-6"><h4>Earned and spent per branch</h4>
        {table ? <table className="spend-table"><thead><tr><th>Branch</th><th>Earned</th><th>Spent</th><th>Net</th></tr></thead><tbody>{branches.map((b) => <tr key={b.id}><td>{b.name}</td><td>{usd(b.earnedUsd)}</td><td>{usd(b.spentUsd)}</td><td>{usd(b.netUsd)}</td></tr>)}</tbody></table>
          : <Bars rows={branches.map((b) => ({ name: b.name, values: [b.earnedUsd, b.spentUsd] }))} series={[{ name: 'Earned', color: EARNED }, { name: 'Spent', color: SPENT }]} />}
      </div>
      <div className="card span-6"><h4>Top products</h4>
        {table ? <table className="spend-table"><thead><tr><th>Product</th><th>Revenue</th><th>Items</th></tr></thead><tbody>{products.map((p) => <tr key={p.productId}><td>{p.title}</td><td>{usd(p.revenueUsd)}</td><td>{p.items}</td></tr>)}{!products.length && <tr><td colSpan={3} className="muted">No sales yet.</td></tr>}</tbody></table>
          : <Bars rows={products.map((p) => ({ name: p.title, values: [p.revenueUsd] }))} series={[{ name: 'Revenue', color: EARNED }]} />}
      </div>
      <div className="card span-6"><h4>Designs</h4>
        <Bars money={false} rows={[{ name: 'Waiting for you', values: [count(designs, 'waiting')] }, { name: 'Approved', values: [count(designs, 'approved')] }, { name: 'Listed on the store', values: [count(designs, 'published')] }, { name: 'Declined', values: [count(designs, 'rejected')] }]} series={[{ name: 'Designs', color: SPENT }]} />
        <p className="small muted">The last {designs.length} designs the runner keeps.</p>
      </div>
      <div className="card span-6"><h4>Ads</h4>
        <Bars money={false} rows={[{ name: 'Waiting for you', values: [count(ads, 'waiting')] }, { name: 'Approved', values: [count(ads, 'approved')] }, { name: 'Declined', values: [count(ads, 'rejected')] }]} series={[{ name: 'Ads', color: SPENT }]} />
        <p className="small muted">Approved ads are yours to post; the Ads tab has the copy.</p>
      </div>
    </div>
  );
}
export type { RunnerStatus };
