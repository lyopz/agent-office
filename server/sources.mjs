// The owner's design sources: folders on this PC whose files the design agents may use. The built-in
// one is origin-data/memez; the owner can link more (their own ideas, photos and drawings). The trend
// scouts save images they find online into memez with a sidecar (<file>.json) that records the title,
// source page and licence: a public-domain or CC0 image is "print" (it can go on a shirt), anything
// else is "reference" (study the joke, remake it with a free image). The owner's own files carry no
// sidecar and are "owner": theirs to print. Declining a design made from a saved image deletes that
// one file and its sidecar; the owner's files are never deleted.
import fs from 'node:fs';
import path from 'node:path';
import { imageSize } from './caption.mjs';
import { secretsDir } from './key-file.mjs';

export const MEMEZ = 'memez';
const MAX_BYTES = 25_000_000;
const MAX_FILES = 300;
const IMAGE = /\.(png|jpe?g)$/i;
const PUBLIC_DOMAIN = /public domain|\bcc0\b|\bpdm\b|no known copyright/i;
const UA = 'the-brain/1.0 (one image saved to the owner\'s design sources)';

/** print when the licence allows a product, else reference (learn the joke only). */
export const usableFor = (licence) => (PUBLIC_DOMAIN.test(String(licence || '')) ? 'print' : 'reference');
const safeName = (n) => String(n || 'image').replace(/\.[^.]+$/, '').replace(/[^\w .-]/g, '_').replace(/^\.+/, '').slice(0, 80) || 'image';

/** The folders: memez first (inside the data folder), then the ones the owner linked. */
export function sourceFolders(s, dataDir) {
  return [{ id: MEMEZ, label: MEMEZ, path: path.join(dataDir, MEMEZ), builtin: true }, ...(s.sourceFolders || [])];
}
/** Link a folder on this PC. It must exist, be a folder, and not be the secrets folder. */
export function addSourceFolder(s, { path: p, label }) {
  const dir = path.resolve(String(p || '').trim());
  if (!p || !path.isAbsolute(String(p).trim())) throw new Error('Give the full path of a folder on this PC (for example C:\\Users\\you\\Pictures\\shirt ideas).');
  let st; try { st = fs.statSync(dir); } catch { throw new Error(`There is no folder at ${dir}.`); }
  if (!st.isDirectory()) throw new Error(`${dir} is a file, not a folder.`);
  const secrets = path.resolve(secretsDir());
  if (dir === secrets || dir.startsWith(secrets + path.sep)) throw new Error('The secrets folder cannot be a design source.');
  s.sourceFolders = s.sourceFolders || [];
  const have = s.sourceFolders.find((f) => path.resolve(f.path) === dir);
  if (have) return have;
  const f = { id: `src_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`, label: String(label || path.basename(dir) || 'folder').trim().slice(0, 60), path: dir, addedAt: new Date().toISOString() };
  s.sourceFolders.push(f);
  return f;
}
export function removeSourceFolder(s, id) {
  const before = (s.sourceFolders || []).length;
  s.sourceFolders = (s.sourceFolders || []).filter((f) => f.id !== id);
  return s.sourceFolders.length < before;
}

const readMeta = (file) => { try { return JSON.parse(fs.readFileSync(`${file}.json`, 'utf8')); } catch { return null; } };
/** The image files in one folder, with what each one may be used for. */
export function listSourceFiles(folder, limit = MAX_FILES) {
  let names; try { names = fs.readdirSync(folder.path); } catch { return []; }
  const out = [];
  for (const name of names.filter((n) => IMAGE.test(n)).sort().slice(0, limit)) {
    const file = path.join(folder.path, name);
    let st; try { st = fs.statSync(file); } catch { continue; }
    if (!st.isFile()) continue;
    const meta = readMeta(file);
    out.push({ ref: `${folder.id}/${name}`, folder: folder.id, name, bytes: st.size, kind: /\.png$/i.test(name) ? 'png' : 'jpg', usable: meta ? (meta.usable || usableFor(meta.licence)) : 'owner', title: meta?.title ?? null, page: meta?.page ?? null, licence: meta?.licence ?? (meta ? 'unknown' : 'the owner\'s own file'), savedBy: meta?.agentName ?? null, at: meta?.at ?? st.mtime.toISOString(), note: meta?.note ?? null, tags: Array.isArray(meta?.tags) ? meta.tags : [], taskId: meta?.taskId ?? null });
  }
  return out;
}
/** What the app shows: each folder with its counts, never the files' bytes. */
export function sourcesPublic(s, dataDir) {
  return sourceFolders(s, dataDir).map((f) => { const files = listSourceFiles(f); return { id: f.id, label: f.label, path: f.path, builtin: !!f.builtin, exists: fs.existsSync(f.path), files: files.length, printable: files.filter((x) => x.usable !== 'reference').length, reference: files.filter((x) => x.usable === 'reference').length, notes: listMemeNotes(f).length, recent: files.sort((a, b) => b.at.localeCompare(a.at)).slice(0, 8) }; });
}

/** "memez/fish.png" → the folder and file name; no paths, only a name inside a known folder. */
function resolveRef(folders, ref) {
  const m = String(ref || '').match(/^([\w-]+)[\\/](.+)$/);
  const folder = m && folders.find((f) => f.id === m[1] || f.label === m[1]);
  const name = m && path.basename(m[2]);
  if (!folder || !name || name !== m[2] || !IMAGE.test(name)) return null;
  return { folder, name, file: path.join(folder.path, name) };
}
/** Read a source file for a design: its bytes and sidecar. */
export function readSourceFile(folders, ref) {
  const r = resolveRef(folders, ref);
  if (!r) return null;
  let buf; try { buf = fs.readFileSync(r.file); } catch { return null; }
  const meta = readMeta(r.file);
  return { buf, kind: /\.png$/i.test(r.name) ? 'png' : 'jpg', meta: meta ? { ...meta, usable: meta.usable || usableFor(meta.licence) } : null, ref: `${r.folder.id}/${r.name}`, owner: !meta };
}
/** Delete one saved image and its sidecar. Only files an agent saved (they have a sidecar); the owner's own files stay. */
export function deleteSourceFile(folders, ref) {
  const r = resolveRef(folders, ref);
  if (!r || !readMeta(r.file)) return false;
  try { fs.unlinkSync(r.file); } catch { return false; }
  try { fs.unlinkSync(`${r.file}.json`); } catch { /* the sidecar is gone already */ }
  return true;
}

/** Download one image into a source folder with its sidecar. Any https URL; the licence decides what it may be used for. */
export async function saveSourceImage(folder, input, by, deps = {}) {
  const url = String(input.image_url || '').trim();
  if (!/^https:\/\//i.test(url)) throw new Error('Give the https URL of the image file itself.');
  const title = String(input.title || '').trim().slice(0, 140);
  const page = String(input.page || '').trim().slice(0, 300);
  const licence = String(input.licence || 'unknown').trim().slice(0, 80);
  if (!title || !page) throw new Error('Record the title and the page it came from, so the owner knows what this is.');
  const f = deps.fetch ?? globalThis.fetch;
  const r = await f(url, { headers: { 'user-agent': UA }, signal: AbortSignal.timeout(25_000) });
  if (!r.ok) throw new Error(`The image could not be fetched (${r.status}).`);
  const buf = Buffer.from(await r.arrayBuffer());
  if (buf.length > MAX_BYTES) throw new Error('That image is too large (over 25 MB).');
  const size = imageSize(buf);
  if (!size) throw new Error('That file is not a PNG or JPEG image.');
  const ext = size.mime === 'image/png' ? 'png' : 'jpg';
  fs.mkdirSync(folder.path, { recursive: true });
  let name = `${safeName(input.file_name || title)}.${ext}`;
  for (let i = 2; fs.existsSync(path.join(folder.path, name)); i++) name = `${safeName(input.file_name || title)}-${i}.${ext}`;
  const usable = usableFor(licence);
  const meta = { title, page, url, licence, usable, note: String(input.note || '').slice(0, 400), tags: Array.isArray(input.tags) ? input.tags.map((t) => String(t).toLowerCase().trim().slice(0, 30)).filter(Boolean).slice(0, 12) : [], agentId: by?.agentId ?? null, agentName: by?.agentName ?? 'JARVIS', taskId: by?.taskId ?? null, at: new Date().toISOString(), width: size.width, height: size.height };
  fs.writeFileSync(path.join(folder.path, name), buf);
  fs.writeFileSync(path.join(folder.path, `${name}.json`), JSON.stringify(meta, null, 2));
  return { ref: `${folder.id}/${name}`, usable, width: size.width, height: size.height, bytes: buf.length };
}

// ---------- meme notes: the info of a meme (source, caption, stats, licence), kept even when no image is saved ----------
const NOTES = 'notes';
const slug = (t) => String(t || 'meme').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'meme';
/** Write one meme's info to <folder>/notes/<slug>-<time>.json. */
export function saveMemeNote(folder, info, by = null) {
  const dir = path.join(folder.path, NOTES);
  fs.mkdirSync(dir, { recursive: true });
  const str = (v, n) => (v == null ? null : String(v).trim().slice(0, n) || null);
  const note = { title: str(info.title, 160) || 'meme', platform: str(info.platform, 40), page: str(info.page, 300), caption: str(info.caption, 600), stats: info.stats && typeof info.stats === 'object' ? info.stats : str(info.stats, 300), licence: str(info.licence, 80) || 'unknown (someone\'s post)', pinId: str(info.pinId ?? info.pin_id, 64), file: str(info.file, 200), note: str(info.note, 600), savedBy: by?.agentName ?? info.savedBy ?? 'JARVIS', taskId: by?.taskId ?? null, at: new Date().toISOString() };
  const name = `${slug(note.title)}-${Date.now().toString(36)}.json`;
  fs.writeFileSync(path.join(dir, name), JSON.stringify(note, null, 2));
  return { ref: `${folder.id}/${NOTES}/${name}`, ...note };
}
/** The notes in a folder, newest first. */
export function listMemeNotes(folder, limit = 50) {
  const dir = path.join(folder.path, NOTES);
  let names; try { names = fs.readdirSync(dir).filter((n) => n.endsWith('.json')); } catch { return []; }
  const out = [];
  for (const n of names) { try { out.push({ ref: `${folder.id}/${NOTES}/${n}`, ...JSON.parse(fs.readFileSync(path.join(dir, n), 'utf8')) }); } catch { /* skip a broken note */ } }
  return out.sort((a, b) => String(b.at).localeCompare(String(a.at))).slice(0, limit);
}
export const SOURCE_NOTE_TOOL = {
  name: 'source_note',
  description: "Save a meme's info to the owner's memez folder without saving its picture: title, platform, source page, caption, stats (likes, comments, score), licence, and why it matters. Use it for every meme worth remembering from Instagram, TikTok roundups, Reddit or Pinterest, so nothing is lost even when the image is someone's work. (A Pinterest pin saved with trends_pinterest gets its note written automatically.)",
  input_schema: { type: 'object', properties: { title: { type: 'string' }, platform: { type: 'string', description: 'instagram, tiktok, reddit, pinterest, imgflip, web' }, page: { type: 'string', description: 'the post or page URL' }, caption: { type: 'string' }, stats: { type: 'object', description: 'e.g. {"likes": 1200, "comments": 40}' }, licence: { type: 'string' }, pin_id: { type: 'string' }, note: { type: 'string', description: 'the joke, the trend, where it is rising, what to make of it' } }, required: ['title', 'page'] },
};

export const SOURCE_LIST_TOOL = {
  name: 'files_source',
  description: "The owner's design sources: the memez folder (images the scouts saved, with licence) and any folder the owner linked (their own files). Each file says what it may be used for: print (public domain or CC0, can go on a shirt), owner (the owner's own file, theirs to print), or reference (someone else's work: learn the joke, never print it). Use a print or owner file in design_caption_image with source_file.",
  input_schema: { type: 'object', properties: { folder: { type: 'string', description: 'one folder id or label, default all' }, query: { type: 'string', description: 'search words (any of them) in the file name, title, note or tags; best matches first' }, limit: { type: 'integer', minimum: 1, maximum: 100 } } },
};
export const SOURCE_SAVE_TOOL = {
  name: 'source_save',
  description: "Save an image you found online into the owner's memez folder for the design agents, with its title, source page and licence: a meme template from trends_memes (image link), a picture post from Reddit, a free image from assets_public_domain, or any other https image file. A public-domain or CC0 image is saved as print and may go on a shirt; anything else (a meme, a post, a photo someone owns) is saved as reference: the designers may open it and make a draft (caption, crop) so the owner sees the idea, but it is flagged and never listed for sale as it is; to sell it, remake it with a free image or their own drawing. If the owner declines a design made from a saved image, that file is deleted.",
  input_schema: { type: 'object', properties: { image_url: { type: 'string', description: 'the https URL of the image file itself' }, file_name: { type: 'string' }, title: { type: 'string' }, page: { type: 'string', description: 'the page it was found on' }, licence: { type: 'string', description: 'as stated by the source, e.g. "Public domain", "CC0", "CC BY 4.0", or "unknown (someone\'s post)"' }, note: { type: 'string', description: 'why it matters: the joke, the trend, where it is rising' }, tags: { type: 'array', items: { type: 'string' }, description: 'search words for the designers: the theme, the subject, the joke (e.g. ["frog", "monday", "tired"])' }, folder: { type: 'string', description: 'folder id, default memez' } }, required: ['image_url', 'title', 'page'] },
};
export const SOURCE_TOOLS = [SOURCE_LIST_TOOL, SOURCE_SAVE_TOOL, SOURCE_NOTE_TOOL];

/** Run one of the source tools for an agent. */
export async function runSourceTool(name, input, s, dataDir, by, deps = {}) {
  const folders = sourceFolders(s, dataDir);
  try {
    if (name === SOURCE_LIST_TOOL.name) {
      const pick = input.folder ? folders.filter((f) => f.id === input.folder || f.label === input.folder) : folders;
      const q = String(input.query || '').toLowerCase().trim();
      const limit = Math.max(1, Math.min(100, Number(input.limit) || 40));
      // any of the words may match the name, title, note or tags; files matching more words come first
      const words = q.split(/[\s,]+/).filter((w) => w.length > 1);
      const hits = (x) => { const hay = `${x.name} ${x.title || ''} ${x.note || ''} ${(x.tags || []).join(' ')}`.toLowerCase(); return words.filter((w) => hay.includes(w)).length; };
      const files = pick.flatMap((f) => listSourceFiles(f)).map((x) => ({ ...x, score: words.length ? hits(x) : 0 })).filter((x) => !words.length || x.score > 0).sort((a, b) => b.score - a.score || b.at.localeCompare(a.at)).slice(0, limit);
      const notes = pick.flatMap((f) => listMemeNotes(f, 30)).filter((x) => !q || `${x.title} ${x.caption || ''} ${x.note || ''}`.toLowerCase().includes(q)).slice(0, limit);
      return { content: JSON.stringify({ folders: folders.map((f) => ({ id: f.id, label: f.label })), files: files.map(({ ref, usable, title, licence, page, note, tags, savedBy, at, kind }) => ({ ref, usable, title, licence, page, note, tags, savedBy, at, kind })), notes: notes.map(({ ref, title, platform, page, caption, stats, licence, pinId, note, savedBy, at }) => ({ ref, title, platform, page, caption, stats, licence, pinId, note, savedBy, at })), note: 'print and owner files may go on a shirt (design_caption_image source_file); a reference file can be drafted on with the same tool but the draft is never sold as it is.' }), isError: false };
    }
    if (name === SOURCE_NOTE_TOOL.name) {
      if (!String(input.title || '').trim() || !String(input.page || '').trim()) return { content: 'Give the title and the page URL.', isError: true };
      const r = saveMemeNote(folders[0], input, by);
      return { content: JSON.stringify({ saved: true, ref: r.ref, note: 'The info is kept in the memez folder; the picture was not saved.' }), isError: false };
    }
    if (name === SOURCE_SAVE_TOOL.name) {
      const folder = folders.find((f) => f.id === (input.folder || MEMEZ) || f.label === input.folder) || folders[0];
      const r = await saveSourceImage(folder, input, by, deps);
      return { content: JSON.stringify({ saved: true, ...r, note: r.usable === 'print' ? 'Public domain or CC0: the designers may caption it.' : 'Saved as reference only: the designers learn the joke from it and remake it with a free image or their own drawing; it never goes on a product.' }), isError: false };
    }
    return { content: `Unknown source tool ${name}`, isError: true };
  } catch (e) { return { content: `${name}: ${e.message}`, isError: true }; }
}

/** The sentence in every design brief about the source folders. */
export function sourcesBrief(s, dataDir) {
  const list = sourceFolders(s, dataDir).map((f) => { const files = listSourceFiles(f); return `${f.label}: ${files.length} file${files.length === 1 ? '' : 's'}${files.length ? ` (${files.filter((x) => x.usable !== 'reference').length} printable, ${files.filter((x) => x.usable === 'reference').length} reference)` : ''}`; });
  return ` SOURCE FOLDERS (the owner's design sources on their PC: ${list.join('; ')}): files_source lists them. Any file can be opened with design_caption_image (source_file; caption, crop): a file marked print or owner may go on a shirt; a file marked reference is someone else's work, so a design made from it is a DRAFT the owner sees (flagged, never listed for sale); to sell the joke, remake it with a free image or your own drawing. Scouts save what they find with source_save (title, page and licence recorded; anything not public domain or CC0 is saved as reference) and keep a meme's info without its picture with source_note. When the owner declines a design made from a saved image, that one file is deleted.`;
}
