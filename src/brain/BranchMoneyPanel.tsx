import { useState } from 'react';
import { Plus, RefreshCw, X } from 'lucide-react';
import type { Agent } from '../model/types';
import { moneyAction, type RunnerStatus } from './originLink';
import { moneyByBranch, mainBranchOf, type BranchMoney } from './branchMoney';

const usd = (n: number) => `${n < 0 ? '-' : ''}$${Math.abs(n).toFixed(Math.abs(n) < 1 && n !== 0 ? 3 : 2)}`;

/**
 * Spent and earned for each main branch, all time. Spent: Claude, ChatGPT images, Etsy listing
 * fees, Printify production and shipping, Etsy's sale fees (estimated) and the owner's own costs.
 * Earned: only what buyers paid (Printify orders from the shop) and the owner's own entries.
 */
export function BranchMoneyPanel({ st, agents, onDone }: { st: RunnerStatus; agents: Record<string, Agent>; onDone: (notice: string) => void }) {
  const [open, setOpen] = useState<string | null>(null);
  const [kind, setKind] = useState<'income' | 'expense'>('income');
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const money = st.money;
  if (!money) return null;
  const rows = moneyByBranch(agents, money.byAgent);
  const sync = async () => {
    setBusy(true);
    const r = await moneyAction({ action: 'sync' });
    setBusy(false);
    onDone(!r ? 'The runner did not answer.' : r.ok ? 'Sales updated from Printify.' : `Printify did not return orders: ${r.error ?? 'unknown error'}`);
  };
  const add = async (r: BranchMoney) => {
    const v = Number(amount);
    if (!(v > 0)) return;
    const x = await moneyAction({ action: 'add', agentId: r.id, kind, usd: v, note });
    setAmount(''); setNote('');
    onDone(x?.ok ? `Added ${usd(v)} ${kind === 'income' ? 'earned' : 'spent'} to ${r.name}.` : 'The runner did not answer.');
  };
  const sync0 = money.salesSync;
  return <>
    <span className="creator-kicker">MONEY BY BRANCH · ALL TIME</span>
    <p className="creator-privacy">Earned is only what buyers paid (orders from your shop through Printify) plus income you add. Etsy's sale fees are estimated (about 9.5% + $0.25 an order).{' '}
      {st.printify?.configured ? <>Sales {sync0 ? `checked ${new Date(sync0.at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}${sync0.error ? ` (failed: ${sync0.error})` : ''}` : 'not checked yet'}. <button className="link-btn" disabled={busy} onClick={() => void sync()}><RefreshCw size={11} /> {busy ? 'Checking…' : 'Check sales now'}</button></> : 'Set up Printify to pull real sales.'}</p>
    <table className="spend-table money-table">
      <thead><tr><th>Branch</th><th>Spent</th><th>Earned</th><th>Net</th></tr></thead>
      <tbody>{rows.map((r) => <MoneyRows key={r.id || 'none'} r={r} open={open === r.id} toggle={() => setOpen(open === r.id ? null : r.id)} />)}</tbody>
    </table>
    {open !== null && (() => {
      const r = rows.find((x) => x.id === open);
      if (!r || r.id === '' || r.id === 'gone') return null;
      const mine = money.entries.filter((m) => (mainBranchOf(agents, m.agentId) ?? m.agentId) === r.id);
      const sales = money.sales.filter((l) => l.agentId && mainBranchOf(agents, l.agentId) === r.id).slice(0, 10);
      return <div className="money-detail">
        <ul className="creator-request-log">
          <li>Claude (agents' work): {usd(r.claudeUsd)}</li>
          <li>ChatGPT images: {usd(r.imageUsd)}</li>
          <li>Etsy listing fees: {usd(r.listingFeesUsd)} ({r.listed} listed{r.itemsSold ? `, ${r.itemsSold} sold` : ''})</li>
          <li>Printify production and shipping: {usd(r.productionUsd)}</li>
          <li>Etsy sale fees (estimate): {usd(r.saleFeesEstUsd)}</li>
          {r.manualExpenseUsd > 0 && <li>Your costs: {usd(r.manualExpenseUsd)}</li>}
          <li><b>Sales: {usd(r.revenueUsd)}</b> from {r.orders} order{r.orders === 1 ? '' : 's'}{r.unpricedItems ? ` (${r.unpricedItems} item${r.unpricedItems === 1 ? '' : 's'} without a price from Printify, not counted; add them below)` : ''}</li>
          {r.manualIncomeUsd > 0 && <li><b>Your income: {usd(r.manualIncomeUsd)}</b></li>}
        </ul>
        {sales.length > 0 && <ul className="creator-request-log">{sales.map((l) => <li key={l.id}>{l.at.slice(0, 10)} · {l.title} ×{l.quantity} · {l.revenueUsd == null ? 'price not reported' : usd(l.revenueUsd)} · cost {usd(l.costUsd)}{l.agentName ? ` · ${l.agentName}` : ''}</li>)}</ul>}
        {mine.length > 0 && <ul className="creator-request-log">{mine.map((m) => <li key={m.id}>{m.at.slice(0, 10)} · {m.kind === 'income' ? 'earned' : 'spent'} {usd(m.usd)}{m.note ? ` · ${m.note}` : ''} <button className="link-btn" aria-label="Remove this entry" onClick={() => void moneyAction({ action: 'remove', id: m.id }).then((x) => onDone(x?.ok ? 'Removed.' : 'The runner did not answer.'))}><X size={11} /></button></li>)}</ul>}
        <form className="creator-request-row" style={{ justifyContent: 'flex-start' }} onSubmit={(e) => { e.preventDefault(); void add(r); }}>
          <select value={kind} onChange={(e) => setKind(e.target.value as 'income' | 'expense')} aria-label="Earned or spent" style={{ flex: '0 0 96px' }}><option value="income">Earned</option><option value="expense">Spent</option></select>
          <input type="number" min={0} step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="$" aria-label="Amount in dollars" style={{ flex: '0 0 90px' }} />
          <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="What for (optional)" aria-label="Note" maxLength={200} />
          <button className="creator-secondary" disabled={!(Number(amount) > 0)}><Plus size={13} /> Add to {r.name}</button>
        </form>
      </div>;
    })()}
  </>;
}

function MoneyRows({ r, open, toggle }: { r: BranchMoney; open: boolean; toggle: () => void }) {
  const detail = r.id !== '' && r.id !== 'gone';
  return <tr className={r.netUsd > 0 ? 'up' : ''}>
    <td>{detail ? <button className="link-btn" aria-expanded={open} onClick={toggle}>{r.name}</button> : r.name}</td>
    <td>{usd(r.spentUsd)}</td><td>{usd(r.earnedUsd)}</td><td className={r.netUsd < 0 ? 'neg' : r.netUsd > 0 ? 'pos' : ''}>{usd(r.netUsd)}</td>
  </tr>;
}
