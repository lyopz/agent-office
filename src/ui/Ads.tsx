// Ads: for the clothing you approved and listed, the agents write ads (copy, hashtags, shot lists)
// for inexpensive reach, and each one waits here for your Yes or No. Nothing is posted or paid for by
// the app: an approved ad is saved on your PC and copied from here when you post it yourself.
// The ads agent is created from here too, under your store venture, with the Ad strategy playbook.
import { useMemo, useState } from 'react';
import { Check, Clock, Copy, Megaphone, Sparkles, UserPlus, X } from 'lucide-react';
import { useStore } from '../store/store';
import { useOrigin } from '../brain/useOrigin';
import { adDecision, designUrl, makeAds, mockupUrl, runnerStatus, syncOrigin, taskAction, type AdEntry, type PublishRequest } from '../brain/originLink';
import { branchAgentOps, branchKind, suggestedWindow } from '../brain/opportunity';
import { AD_ROLE } from '../brain/builtinSkills';
import type { OfficeDoc } from '../model/types';
import { PageTabs, TabPanel, usePageTab } from './PageTabs';

const CHANNEL: Record<AdEntry['channel'], string> = { tiktok: 'TikTok', instagram_reels: 'Instagram Reels', instagram_post: 'Instagram post', pinterest: 'Pinterest', etsy_ads: 'Etsy Ads', facebook_ads: 'Facebook / Instagram ads', other: 'Other' };
const when = (iso: string) => new Date(iso).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

/** The agent that makes ads, by its role words; null when none exists yet. */
export const adsAgentOf = (doc: OfficeDoc) => Object.values(doc.agents).find((a) => a.id !== 'agent_origin' && AD_ROLE.test(`${a.identity.name} ${a.identity.title}`)) ?? null;
/** The venture the ads agent belongs under: the store, or the first venture. */
export const storeVentureOf = (doc: OfficeDoc) => { const v = Object.values(doc.agents).filter((a) => branchKind(doc, a.id) === 'venture'); return v.find((a) => /store|etsy|shop|merch|cloth|shirt|apparel/i.test(`${a.identity.name} ${a.identity.title}`)) ?? v[0] ?? null; };
/** The ad as text to paste where it is posted. */
export const adText = (ad: AdEntry) => [ad.headline, '', ad.primaryText, ad.hashtags.length ? `\n${ad.hashtags.map((h) => `#${h}`).join(' ')}` : '', ad.cta ? `\n${ad.cta}` : ''].join('\n').replace(/\n{3,}/g, '\n\n').trim();

function RunnerImage({ load, id, alt }: { load: (id: string) => Promise<string | null>; id: string; alt: string }) {
  const [src, setSrc] = useState<string | null>(null);
  useMemo(() => { void load(id).then(setSrc); }, [load, id]);
  return src ? <img className="approval-img" src={src} alt={alt} /> : <div className="approval-img is-empty" aria-hidden />;
}

function AdCard({ ad, busy, onDecide }: { ad: AdEntry; busy: boolean; onDecide?: (a: 'approve' | 'reject') => void }) {
  const copy = async () => { try { await navigator.clipboard.writeText(adText(ad)); useStore.getState().notify('Ad text copied.'); } catch { useStore.getState().notify('Could not copy; select the text instead.', 'warn'); } };
  return (
    <figure className="approval-card ad-card">
      {ad.designId ? <RunnerImage load={designUrl} id={ad.designId} alt={`Design for ${ad.productTitle}`} /> : <div className="approval-img is-empty" aria-hidden />}
      <figcaption>
        <div className="row wrap"><span className="badge live">{CHANNEL[ad.channel] ?? ad.channel}</span>{ad.format && <span className="small muted">{ad.format.replace('_', ' ')}</span>}<span className="small muted">· {ad.costNote || 'cost not stated'}</span></div>
        <b>{ad.headline}</b>
        <p className="ad-text">{ad.primaryText}</p>
        {ad.hashtags.length > 0 && <p className="small muted">{ad.hashtags.map((h) => `#${h}`).join(' ')}</p>}
        {ad.cta && <p className="small"><b>Call to action:</b> {ad.cta}</p>}
        {ad.script && <details><summary className="small">Shot list</summary><pre className="ad-script">{ad.script}</pre></details>}
        {ad.why && <details><summary className="small">Why this reaches buyers cheaply</summary><p className="small muted">{ad.why}</p></details>}
        <span className="small muted">For {ad.productTitle} · {ad.agentName} · {when(ad.at)}{ad.file ? ` · saved on your PC` : ''}</span>
        <div className="row wrap">
          {onDecide && <><button className="btn sm primary" disabled={busy} onClick={() => onDecide('approve')}><Check size={13} /> Yes, I'll post it</button><button className="btn sm" disabled={busy} onClick={() => onDecide('reject')}><X size={13} /> No</button></>}
          <button className="btn sm" onClick={() => void copy()}><Copy size={13} /> Copy text</button>
        </div>
      </figcaption>
    </figure>
  );
}

export function Ads() {
  const doc = useStore((s) => s.doc);
  const [tab, setTab] = usePageTab('ads', ['waiting', 'approved', 'products'] as const);
  const st = useOrigin((o) => o.status);
  const checked = useOrigin((o) => o.checked);
  const [busy, setBusy] = useState<string | null>(null);
  const notify = (t: string, level?: 'warn') => useStore.getState().notify(t, level);
  const refresh = async () => useOrigin.setState({ status: await runnerStatus() });
  const agent = adsAgentOf(doc);
  const venture = storeVentureOf(doc);
  const decide = async (ad: AdEntry, action: 'approve' | 'reject') => {
    setBusy(ad.id);
    const r = await adDecision(ad.id, action);
    setBusy(null);
    notify(!r ? 'The runner did not answer.' : !r.ok ? (r.error ?? 'That did not work.') : action === 'approve' ? `Approved "${ad.headline}". Copy the text here when you post it; it is also saved in origin-data/ads on your PC.` : `Declined "${ad.headline}".`, r?.ok ? undefined : 'warn');
    void refresh();
  };
  const make = async (products: PublishRequest[]) => {
    setBusy('make');
    const r = await makeAds(products.map((p) => p.productId), agent?.id ?? null);
    setBusy(null);
    notify(!r ? 'The runner did not answer.' : !r.ok ? (r.error ?? 'That did not work.') : `${agent?.identity.name ?? 'JARVIS'} is making ads for ${products.length === 1 ? `"${products[0].title}"` : `${products.length} products`}; they appear here for your Yes or No.`, r?.ok ? undefined : 'warn');
    void refresh();
  };
  const createAgent = async () => {
    if (!venture) { notify('Start a venture first (your store): the ads agent works for it.', 'warn'); return; }
    const id = `agent_ads_${Date.now().toString(36)}`;
    const name = 'Ads & Reach';
    const r = branchAgentOps(doc, venture.id, { id, name, specialty: 'inexpensive-reach ads and marketing for approved products', purpose: `Find the cheapest ways to reach buyers for ${venture.identity.name}'s approved, listed products, and write the ads: short-video hooks and scripts, Pinterest pins, captions and hashtags, and small paid tests only when a product already sells. Every ad waits for the owner in the Ads tab; the owner posts it.`, skill: 'Advertising', window: suggestedWindow('Advertising') });
    if (r.error) { notify(r.error, 'warn'); return; }
    const c = useStore.getState().commit(r.ops, `Create ${name}`);
    if (!c.ok) { notify(c.errors.join(' · '), 'warn'); return; }
    await syncOrigin(useStore.getState().doc);
    await taskAction({ action: 'add', title: `${name}: find the best inexpensive way to reach buyers for our shirts`, detail: `Research, with current sources and dates, the cheapest ways a small print-on-demand shirt store reaches buyers in ${new Date().getFullYear()}: organic TikTok and Reels (hooks, posting cadence, what converts), Pinterest pins, Etsy Ads at the minimum budget, and anything else that costs little. End with a one-page plan: the first three things to do, what each costs, how success is measured, and a kill rule. Then make ads for the approved products with ad_save.`, agentId: id, agentName: name });
    notify(`${name} works for ${venture.identity.name} now, with the Ad strategy playbook. Its first task: find the best inexpensive way to reach buyers.`);
    void refresh();
  };
  if (st === undefined && !checked) return <div className="dash"><div className="dash-head"><div><span className="kicker"><i />ADS</span><h2>Checking for JARVIS's runner…</h2></div></div></div>;
  if (!st) return <div className="dash"><div className="dash-head"><div><span className="kicker"><i />ADS</span><h2>No ads: JARVIS is offline</h2><p>Start the runner on your PC with <code>npm.cmd run origin</code>, or open the desktop app. Ads for your approved clothing appear here for your Yes or No.</p></div></div></div>;
  const products = (st.publishRequests ?? []).filter((r) => r.status === 'published');
  const ads = st.ads ?? [];
  const waiting = ads.filter((a) => a.status === 'waiting'), approved = ads.filter((a) => a.status === 'approved'), declined = ads.filter((a) => a.status === 'rejected');
  const adsFor = (productId: string) => ads.filter((a) => a.productId === productId && a.status !== 'rejected').length;
  return (
    <div className="dash approvals ads">
      <div className="dash-head">
        <div><span className="kicker"><i />ADS</span><h2>Ads for your approved clothing</h2><p>Every product you said Yes to is here. The ads agent writes ads for inexpensive reach; each waits for your Yes or No. Nothing is posted or paid for by the app: an approved ad is saved on your PC and you post it yourself.</p></div>
        <div className="actions">
          {agent ? <span className="badge live" title={agent.identity.title}>{agent.identity.name}</span> : <button className="btn sm" onClick={() => void createAgent()} disabled={busy === 'agent'}><UserPlus size={13} /> Create the ads agent</button>}
          <button className="btn sm primary" disabled={!products.length || busy === 'make'} onClick={() => void make(products)}><Sparkles size={13} /> Make ads for all approved clothing</button>
        </div>
      </div>
      {!agent && <div className="card span-12"><p className="small muted">No ads agent yet. <b>Create the ads agent</b> adds one under {venture?.identity.name ?? 'your store venture'} with the built-in Ad strategy playbook (your click is the approval), and its first task is to find the best inexpensive way to reach buyers. Until then JARVIS makes the ads itself.</p></div>}
      <PageTabs label="Ads sections" value={tab} onChange={setTab} tabs={[
        { id: 'waiting', label: 'Waiting for you', icon: Clock, count: waiting.length, alert: true },
        { id: 'approved', label: 'Approved', icon: Check, count: approved.length },
        { id: 'products', label: 'Approved clothing', icon: Megaphone, count: products.length },
      ]} />
      {tab === 'products' && <TabPanel id="products">
      <div className="card span-12 approval-group"><h4><Megaphone size={13} /> Approved clothing <span className="count">{products.length}</span></h4>
        {!products.length && <p className="small muted">Nothing listed yet. Say Yes to a design in Approvals; once it is listed on your store it shows here and ads can be made for it.</p>}
        <div className="approval-grid">
          {products.map((r) => <figure key={r.id} className="approval-card">
            {r.image ? <RunnerImage load={mockupUrl} id={r.id} alt={`Mockup of ${r.title}`} /> : <div className="approval-img is-empty" aria-hidden />}
            <figcaption><b>{r.title}</b><span className="small muted">{r.priceUsd ? `$${r.priceUsd} · ` : ''}listed {when(r.publishedAt ?? r.at)} · {adsFor(r.productId)} ad{adsFor(r.productId) === 1 ? '' : 's'}</span>
              <div className="row"><button className="btn sm" disabled={busy === 'make'} onClick={() => void make([r])}><Sparkles size={13} /> Make ads</button></div></figcaption>
          </figure>)}
        </div>
      </div>
      </TabPanel>}
      {tab === 'waiting' && <TabPanel id="waiting">
      <div className="card span-12 approval-group"><h4>Waiting for your Yes or No <span className="count">{waiting.length}</span></h4>
        {!waiting.length && <p className="small muted">No ads waiting. Press Make ads on a product, or wait for the ads agent's next run.</p>}
        <div className="approval-grid">{waiting.map((ad) => <AdCard key={ad.id} ad={ad} busy={busy === ad.id} onDecide={(a) => void decide(ad, a)} />)}</div>
      </div>
      </TabPanel>}
      {tab === 'approved' && <TabPanel id="approved">
      <div className="card span-12 approval-group"><h4>Approved: yours to post <span className="count">{approved.length}</span></h4>
        {!approved.length && <p className="small muted">Approved ads stay here with their copy, and as files in origin-data/ads on your PC.</p>}
        <div className="approval-grid">{approved.map((ad) => <AdCard key={ad.id} ad={ad} busy={false} />)}</div>
        {declined.length > 0 && <p className="small muted">{declined.length} declined ad{declined.length === 1 ? '' : 's'} ({declined.slice(0, 5).map((a) => `"${a.headline}"`).join(', ')}{declined.length > 5 ? ', …' : ''}).</p>}
      </div>
      </TabPanel>}
    </div>
  );
}
