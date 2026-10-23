// Spending and profit for one branch, on the agent's own panel: what the branch has cost,
// what it has brought in, and the line between them. Numbers come from JARVIS's runner (the
// same ones as Money by branch); an agent deep in a branch shows its main branch's totals.
import { useMemo } from 'react';
import { useStore } from '../store/store';
import { useOrigin } from './useOrigin';
import { mainBranchOf, moneyByBranch, type BranchMoney } from './branchMoney';
import { ORIGIN_ID } from './opportunity';

const usd = (n: number) => `${n < 0 ? '-' : ''}$${Math.abs(n).toFixed(Math.abs(n) < 1 && n !== 0 ? 3 : 2)}`;

export function BranchMoneyCards({ agentId }: { agentId: string }) {
  const agents = useStore((s) => s.doc.agents);
  const status = useOrigin((s) => s.status);
  const rows = useMemo(() => (status?.money ? moneyByBranch(agents, status.money.byAgent) : []), [agents, status?.money]);
  const top = mainBranchOf(agents, agentId);
  const r: BranchMoney | undefined = rows.find((x) => x.id === top);
  const a = agents[agentId];
  if (!status) return <p className="note">JARVIS's runner isn't running, so there are no money numbers to show. Start it on your PC with npm.cmd run origin.</p>;
  if (!r) return <p className="note">No spending or sales for this branch yet.</p>;
  const branchName = top === ORIGIN_ID ? 'JARVIS' : agents[top!]?.identity.name ?? 'this branch';
  const sales = (status.money?.sales ?? []).filter((l) => l.agentId && mainBranchOf(agents, l.agentId) === r.id).slice(0, 6);
  const spend: [string, number][] = [
    ['Claude (agents\' work)', r.claudeUsd], ['ChatGPT images', r.imageUsd], ['Etsy listing fees', r.listingFeesUsd],
    ['Printify production and shipping', r.productionUsd], ['Etsy sale fees (estimate)', r.saleFeesEstUsd], ['Your costs', r.manualExpenseUsd],
  ];
  return (
    <div className="money-cards">
      {agentId !== top && <p className="note">{a?.identity.name} is part of the {branchName} branch; these are the branch's numbers, all time.</p>}
      <div className="money-card spend">
        <h4>Spending</h4>
        <div className="money-big">{usd(r.spentUsd)}</div>
        <ul>{spend.filter(([, v]) => v > 0).map(([k, v]) => <li key={k}><span>{k}</span><b>{usd(v)}</b></li>)}</ul>
        {r.spentUsd === 0 && <p className="note">Nothing spent yet.</p>}
        {r.listed > 0 && <p className="note">{r.listed} product{r.listed === 1 ? '' : 's'} listed.</p>}
      </div>
      <div className="money-card profit">
        <h4>Profit</h4>
        <div className={`money-big ${r.netUsd > 0 ? 'pos' : r.netUsd < 0 ? 'neg' : ''}`}>{usd(r.netUsd)}</div>
        <ul>
          <li><span>Sales ({r.orders} order{r.orders === 1 ? '' : 's'}{r.itemsSold ? `, ${r.itemsSold} item${r.itemsSold === 1 ? '' : 's'}` : ''})</span><b>{usd(r.revenueUsd)}</b></li>
          {r.manualIncomeUsd > 0 && <li><span>Your income</span><b>{usd(r.manualIncomeUsd)}</b></li>}
          <li><span>Earned</span><b>{usd(r.earnedUsd)}</b></li>
          <li><span>Minus spending</span><b>-{usd(r.spentUsd)}</b></li>
        </ul>
        {r.unpricedItems > 0 && <p className="note">{r.unpricedItems} sold item{r.unpricedItems === 1 ? '' : 's'} came without a price from Printify; add the amount under Money by branch in JARVIS's runs.</p>}
        {sales.length > 0 && <ul className="money-sales">{sales.map((l) => <li key={l.id}><span>{l.at.slice(0, 10)} · {l.title} ×{l.quantity}</span><b>{l.revenueUsd == null ? 'price not reported' : usd(l.revenueUsd)}</b></li>)}</ul>}
        {r.orders === 0 && <p className="note">No sales yet. Earned counts only what buyers paid and income you add.</p>}
      </div>
    </div>
  );
}
