// Renders the office's characters in the owner's real Blender through the local
// bridge. Only appearance data is sent (no profile, memory or settings), and a
// picture is shown only once Blender has actually written the file.
import { useEffect, useState } from 'react';
import { lookKey, useSpriteLibrary } from '../characters/sprites';
import type { Appearance } from '../model/types';
import { useStore } from '../store/store';
import { bridgeRequest, type BridgeJob, type useBridge } from './resources';

const MAX = 60;

export function characterRoster(agents: ReturnType<typeof useStore.getState>['doc']['agents'], ids?: string[]) {
  return {
    characters: Object.values(agents)
      .filter((a) => !ids || ids.includes(a.id))
      .slice(0, MAX)
      .map((a) => ({ id: a.id, name: a.identity.name, title: a.identity.title, appearance: a.appearance })),
  };
}

export function CharacterRenders({ bridge }: { bridge: ReturnType<typeof useBridge> }) {
  const doc = useStore((s) => s.doc);
  const { notify } = useStore.getState();
  const base = doc.control.blenderBridgeUrl.replace(/\/$/, '');
  const [scope, setScope] = useState<'leads' | 'all'>('leads');
  const [busy, setBusy] = useState(false);
  const real = bridge.status === 'connected' && !!bridge.blender;
  const jobs = bridge.jobs.filter((j) => j.kind === 'characters');
  const latest = jobs[jobs.length - 1];
  const done = jobs.slice().reverse().find((j) => j.status === 'completed' && j.outputs?.length);
  // one of each role plus every non-floor agent; the floor's look-alikes add nothing to a lineup
  const leadIds = Object.values(doc.agents).filter((a) => a.identity.department !== 'Operations Floor' || a.id === 'agent_ops1').map((a) => a.id);
  const count = scope === 'all' ? Math.min(MAX, Object.keys(doc.agents).length) : leadIds.length;

  const start = async () => {
    setBusy(true);
    try {
      const roster = characterRoster(doc.agents, scope === 'all' ? undefined : leadIds);
      const j = await bridgeRequest<{ id: string }>(base, '/jobs', { kind: 'characters', roster, sprites: true, name: `${roster.characters.length} characters` });
      notify(`Blender is rendering ${roster.characters.length} characters (${j.id})`);
      bridge.refresh();
    } catch (e) { notify((e as Error).message, 'error'); }
    finally { setBusy(false); }
  };

  // bring finished sprite sheets into the office as soon as Blender is done
  const [imported, setImported] = useState<Record<string, number>>({});
  useEffect(() => {
    if (!done || imported[done.id] !== undefined || !done.outputs?.some((f) => f.endsWith('_sprites.webp'))) return;
    setImported((m) => ({ ...m, [done.id]: -1 }));
    importSprites(base, done).then((n) => { setImported((m) => ({ ...m, [done.id]: n })); if (n) notify(`${n} Blender characters are now in the office`); })
      .catch((e) => { setImported((m) => ({ ...m, [done.id]: 0 })); notify(`Couldn't bring the renders into the office: ${(e as Error).message}`, 'error'); });
  }, [done, base, imported, notify]);

  return (
    <>
      <h3>Character renders</h3>
      <p className="note">Rendering also makes animated sprites (walk, sit, talk, work). They replace the drawn characters in the office for every agent whose look matches the render. Change someone's look and they go back to the drawn version until you render again.</p>
      {!real && <p className="note">Rendering the characters needs Blender on your computer. Start the bridge (see Resources) and these become real Blender renders with a GLB file per character.</p>}
      <div className="row wrap">
        <select aria-label="Which characters" value={scope} onChange={(e) => setScope(e.target.value as 'leads' | 'all')}>
          <option value="leads">Every role ({leadIds.length})</option>
          <option value="all">Everyone (up to {MAX})</option>
        </select>
        <button className="btn sm primary" disabled={!real || busy || latest?.status === 'running'} onClick={start}>Render {count} characters in Blender</button>
        {latest && <span className={`rstate rstate-${latest.status}`}>{latest.status === 'running' ? 'rendering…' : latest.status}</span>}
        {latest?.status === 'failed' && <span className="small" style={{ color: 'var(--warn)' }}>{(latest.log ?? '').split('\n').filter(Boolean).slice(-1)[0]}</span>}
      </div>
      {done && imported[done.id] > 0 && <p className="small ok">{imported[done.id]} rendered characters are in the office. Switch between them and the drawn ones with Characters in the office toolbar.</p>}
      {done && <RenderGallery base={base} job={done} />}
    </>
  );
}

function RenderGallery({ base, job }: { base: string; job: BridgeJob }) {
  const doc = useStore((s) => s.doc);
  const files = job.outputs ?? [];
  const url = (p: string) => `${base}/files/${p.split('/').map(encodeURIComponent).join('/')}`;
  const lineup = files.find((f) => f.endsWith('lineup.png'));
  const shots = files.filter((f) => f.endsWith('.png') && !f.endsWith('lineup.png'));
  const glb = (png: string) => files.find((f) => f === png.replace(/\.png$/, '.glb'));
  return (
    <div className="char-renders">
      <p className="small ok">Rendered by Blender{job.endedAt ? ` at ${new Date(job.endedAt).toLocaleTimeString()}` : ''}. Files are in your Blender projects folder under exports/{files[0]?.split('/').slice(0, -1).join('/')}.</p>
      {files.some((f) => f.endsWith('characters.blend')) && (
        <div className="row"><button className="btn sm primary" onClick={async () => {
          try { await bridgeRequest(base, `/jobs/${job.id}/open`, {}); useStore.getState().notify('Opening the scene in Blender on your computer'); }
          catch (e) { useStore.getState().notify((e as Error).message, 'error'); }
        }}>Open in Blender</button><span className="small muted">Opens characters.blend with every character, ready to edit.</span></div>
      )}
      {lineup && <a href={url(lineup)} target="_blank" rel="noreferrer"><img className="lineup" src={url(lineup)} alt="Lineup of every rendered character" /></a>}
      <div className="char-grid">
        {shots.map((f) => {
          const id = f.split('/').pop()!.replace(/\.png$/, '');
          const a = doc.agents[id];
          const g = glb(f);
          return (
            <figure key={f}>
              <img src={url(f)} alt={a ? `${a.identity.name} rendered in Blender` : id} loading="lazy" />
              <figcaption>{a?.identity.name ?? id}{g && <> · <a href={url(g)} download>GLB</a></>}</figcaption>
            </figure>
          );
        })}
      </div>
    </div>
  );
}

/** Copies a job's sprite sheets into the local asset store, keyed by the look that was rendered. */
async function importSprites(base: string, job: BridgeJob): Promise<number> {
  const dir = (job.outputs ?? [])[0]?.split('/').slice(0, -1).join('/');
  if (!dir) return 0;
  const url = (p: string) => `${base}/files/${p.split('/').map(encodeURIComponent).join('/')}`;
  const r = await fetch(url(`${dir}/roster.json`));
  if (!r.ok) throw new Error(`roster HTTP ${r.status}`);
  const roster = await r.json() as { characters: { id: string; appearance: Appearance }[] };
  const { add } = useSpriteLibrary.getState();
  let n = 0;
  for (const c of roster.characters) {
    const f = `${dir}/${c.id}_sprites.webp`;
    if (!job.outputs?.includes(f)) continue;
    const res = await fetch(url(f));
    if (!res.ok) continue;
    const blob = await res.blob();
    const data = await new Promise<string>((ok) => { const fr = new FileReader(); fr.onload = () => ok(fr.result as string); fr.readAsDataURL(blob); });
    await add(lookKey(c.appearance), data);
    n++;
  }
  return n;
}
