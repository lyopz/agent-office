// The owner's design sources: the memez folder, linked folders, saved images with their licence, and deletion.
import { describe, expect, test } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { SOURCE_TOOLS, addSourceFolder, deleteSourceFile, listMemeNotes, listSourceFiles, readSourceFile, removeSourceFolder, runSourceTool, saveMemeNote, saveSourceImage, sourceFolders, sourcesBrief, sourcesPublic, usableFor } from '../server/sources.mjs';

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from('0000000d49484452', 'hex'), Buffer.from([0, 0, 0, 40, 0, 0, 0, 30]), Buffer.alloc(16)]);
const fetchPng = async () => ({ ok: true, status: 200, arrayBuffer: async () => PNG.buffer.slice(PNG.byteOffset, PNG.byteOffset + PNG.byteLength) });
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'sources-'));

describe('design sources', () => {
  test('the licence decides what a saved image is for', () => {
    expect(usableFor('Public domain')).toBe('print');
    expect(usableFor('CC0 1.0')).toBe('print');
    expect(usableFor('CC BY 4.0')).toBe('reference');
    expect(usableFor('unknown (someone\'s post)')).toBe('reference');
  });

  test('memez is always first; the owner links real folders only, never the secrets folder', () => {
    const dir = tmp(); const s: Record<string, unknown> = {};
    expect(sourceFolders(s, dir).map((f) => f.id)).toEqual(['memez']);
    const own = path.join(dir, 'ideas'); fs.mkdirSync(own);
    const f = addSourceFolder(s, { path: own, label: 'shirt ideas' });
    expect(f.label).toBe('shirt ideas');
    expect(addSourceFolder(s, { path: own }).id).toBe(f.id); // the same folder twice is one folder
    expect(() => addSourceFolder(s, { path: path.join(dir, 'nope') })).toThrow(/no folder/);
    expect(() => addSourceFolder(s, { path: 'relative/path' })).toThrow(/full path/);
    expect(sourceFolders(s, dir)).toHaveLength(2);
    expect(removeSourceFolder(s, f.id)).toBe(true);
    expect(sourceFolders(s, dir)).toHaveLength(1);
  });

  test('a scout saves an image with its sidecar; public domain is print, a post is reference; declining deletes only that file', async () => {
    const dir = tmp(); const s: Record<string, unknown> = {};
    const [memez] = sourceFolders(s, dir);
    const a = await saveSourceImage(memez, { image_url: 'https://i.pinimg.com/x/fish.png', title: 'A fish', page: 'https://www.pinterest.com/pin/1/', licence: 'Public domain' }, { agentName: 'You' }, { fetch: fetchPng, owner: true });
    const b = await saveSourceImage(memez, { image_url: 'https://example.com/meme.png', title: 'Fih meme', page: 'https://example.com/post', licence: 'unknown (someone\'s post)', note: 'the fih joke', joke: 'a fish misspelled as fih' }, { agentName: 'Trend Scout' }, { fetch: fetchPng });
    expect(a).toMatchObject({ ref: 'memez/A fish.png', usable: 'print', width: 40, height: 30 });
    expect(b.usable).toBe('reference');
    fs.writeFileSync(path.join(memez.path, 'mine.png'), PNG); // the owner's own file, no sidecar
    const files = listSourceFiles(memez);
    expect(files.map((f) => [f.name, f.usable, f.pick])).toEqual([['A fish.png', 'print', 'yes'], ['Fih meme.png', 'reference', 'waiting'], ['mine.png', 'owner', 'owner']]);
    expect(readSourceFile([memez], 'memez/mine.png')).toMatchObject({ owner: true, meta: null, kind: 'png' });
    expect(readSourceFile([memez], 'memez/../secret.png')).toBeNull();
    expect(readSourceFile([memez], 'memez/Fih meme.png')?.meta).toMatchObject({ usable: 'reference', title: 'Fih meme' });
    expect(deleteSourceFile([memez], 'memez/mine.png')).toBe(false); // never the owner's files
    expect(deleteSourceFile([memez], 'memez/Fih meme.png')).toBe(true);
    expect(fs.existsSync(path.join(memez.path, 'Fih meme.png.json'))).toBe(false);
    expect(listSourceFiles(memez).map((f) => f.name)).toEqual(['A fish.png', 'mine.png']);
    const pub = sourcesPublic(s, dir);
    expect(pub[0]).toMatchObject({ id: 'memez', files: 2, printable: 2, reference: 0 });
    expect(sourcesBrief(s, dir)).toMatch(/memez: 2 files \(2 the owner picked or owns, 0 waiting for their pick\)/);
    expect(await saveSourceImage(memez, { image_url: 'http://insecure/x.png', title: 't', page: 'p' }, null, { fetch: fetchPng }).catch((e) => e.message)).toMatch(/https/);
    expect(await saveSourceImage(memez, { image_url: 'https://x/y.png', title: '', page: 'p' }, null, { fetch: fetchPng }).catch((e) => e.message)).toMatch(/title and the page/);
  });

  test('the agent tools list and save; a find that is not a meme is refused before and after it is fetched', async () => {
    const dir = tmp(); const s: Record<string, unknown> = {};
    const save = (input: Record<string, unknown>, judge?: unknown) => runSourceTool('source_save', input, s, dir, { agentName: 'Trend Scout' }, { fetch: fetchPng, judge } as any);
    expect((await save({ image_url: 'https://upload.wikimedia.org/x.png', title: 'Old map', page: 'https://commons.wikimedia.org/x', licence: 'unknown', joke: 'old map lol' })).content).toMatch(/not memes/);
    expect((await save({ image_url: 'https://x/y.png', title: 'Old map', page: 'https://x/p', licence: 'Public domain', joke: 'old map lol' })).content).toMatch(/public-domain or CC0 picture is old art/);
    expect((await save({ image_url: 'https://x/y.png', title: 'Cat', page: 'https://x/p', licence: 'unknown' })).content).toMatch(/say the joke/);
    const seen: any[] = [];
    const refuse = async (_b: Buffer, mime: string, info: any) => { seen.push([mime, info.joke]); return { keep: false, why: 'a plain cat photo, no joke' }; };
    expect((await save({ image_url: 'https://x/y.png', title: 'Cat', page: 'https://x/p', licence: 'unknown', joke: 'it is a cat' }, refuse)).content).toMatch(/not a meme for the store \(a plain cat photo/);
    expect(seen).toEqual([['image/png', 'it is a cat']]);
    expect(fs.existsSync(path.join(dir, 'memez'))).toBe(false);
    const saved = await save({ image_url: 'https://i.redd.it/y.png', title: 'Monday frog', page: 'https://reddit.com/r/memes/1', licence: 'unknown', joke: 'frog dreading monday' }, async () => ({ keep: true, why: 'classic reaction meme' }));
    expect(JSON.parse(saved.content)).toMatchObject({ saved: true, usable: 'reference', ref: 'memez/Monday frog.png' });
    const list = await runSourceTool('files_source', { query: 'frog' }, s, dir, null);
    expect(JSON.parse(list.content).files).toEqual([expect.objectContaining({ ref: 'memez/Monday frog.png', pick: 'waiting', savedBy: 'Trend Scout' })]);
  });

  test('what was never a meme is moved to memez/removed, not deleted', async () => {
    const { purgeNotMemes, removeSourceFile } = await import('../server/sources.mjs');
    const dir = tmp(); const s: Record<string, unknown> = {};
    const [memez] = sourceFolders(s, dir);
    fs.mkdirSync(memez.path, { recursive: true });
    const put = (name: string, meta: object) => { fs.writeFileSync(path.join(memez.path, name), PNG); fs.writeFileSync(path.join(memez.path, `${name}.json`), JSON.stringify(meta)); };
    put('ear.png', { title: 'ear', url: 'https://upload.wikimedia.org/ear.png', page: 'https://commons.wikimedia.org/ear', licence: 'Public domain' });
    put('cat.png', { title: 'cat', url: 'https://x/cat.png', page: 'https://x', licence: 'CC0' });
    put('meme.png', { title: 'meme', url: 'https://i.imgflip.com/m.png', page: 'https://imgflip.com/m', licence: 'unknown' });
    put('doodle.png', { title: 'doodle', url: 'https://i.imgflip.com/d.png', page: 'https://imgflip.com/d', licence: 'unknown' });
    fs.writeFileSync(path.join(memez.path, 'mine.png'), PNG);
    expect(purgeNotMemes(s, dir).sort()).toEqual(['memez/cat.png', 'memez/ear.png']);
    expect(removeSourceFile(sourceFolders(s, dir), 'memez/doodle.png')).toBe(true);
    expect(removeSourceFile(sourceFolders(s, dir), 'memez/mine.png')).toBe(false); // never the owner's own files
    expect(listSourceFiles(memez).map((f) => f.name)).toEqual(['meme.png', 'mine.png']);
    expect(fs.readdirSync(path.join(memez.path, 'removed')).sort()).toEqual(['cat.png', 'cat.png.json', 'doodle.png', 'doodle.png.json', 'ear.png', 'ear.png.json']);
  });

  test("a meme's info is kept as a note in memez/notes without its picture, listed newest first and counted", async () => {
    const dir = tmp(); const s: Record<string, unknown> = {};
    const [memez] = sourceFolders(s, dir);
    expect(SOURCE_TOOLS.map((t) => t.name)).toEqual(['files_source', 'source_save', 'source_note']);
    const first = saveMemeNote(memez, { title: 'fih shirt', platform: 'instagram', page: 'https://www.instagram.com/p/x/', caption: 'fih', stats: { likes: 1200, comments: 40 }, note: 'rising' }, { agentName: 'Scout', taskId: 't1' });
    expect(first.ref).toMatch(/^memez\/notes\/fih-shirt-/);
    expect(first.licence).toBe("unknown (someone's post)");
    expect(fs.readdirSync(path.join(dir, 'memez'))).toEqual(['notes']);
    await new Promise((ok) => setTimeout(ok, 5));
    const r = await runSourceTool('source_note', { title: 'fish dinner', page: 'https://www.pinterest.com/pin/2/', platform: 'pinterest', pin_id: '2', licence: 'CC0' }, s, dir, { agentName: 'Scout', taskId: 't2' });
    expect(r.isError).toBe(false);
    expect(JSON.parse(r.content)).toMatchObject({ saved: true, ref: expect.stringMatching(/^memez\/notes\/fish-dinner-/) });
    const bad = await runSourceTool('source_note', { title: 'no page' }, s, dir, null);
    expect(bad.isError).toBe(true);
    const notes = listMemeNotes(memez);
    expect(notes.map((n) => n.title)).toEqual(['fish dinner', 'fih shirt']);
    expect(notes[0]).toMatchObject({ pinId: '2', licence: 'CC0', savedBy: 'Scout', taskId: 't2' });
    expect(notes[1].stats).toEqual({ likes: 1200, comments: 40 });
    const listed = JSON.parse((await runSourceTool('files_source', { query: 'fih' }, s, dir, null)).content);
    expect(listed.files).toEqual([]);
    expect(listed.notes.map((n: any) => n.title)).toEqual(['fih shirt']);
    expect(sourcesPublic(s, dir)[0]).toMatchObject({ id: 'memez', notes: 2 });
  });
});

describe('the owner picks the memes', () => {
  test('a saved meme waits for a pick; files_source lists Yes picks and never No; the owner\'s own files need no pick', async () => {
    const { memesToPick, setSourcePick } = await import('../server/sources.mjs');
    const dir = tmp(); const s: Record<string, unknown> = {};
    const memez = sourceFolders(s, dir)[0];
    await saveSourceImage(memez, { image_url: 'https://i.pinimg.com/a.png', title: 'Doodle cat', page: 'https://pin/1', licence: 'unknown', joke: 'cat judging you' }, null, { fetch: fetchPng });
    await saveSourceImage(memez, { image_url: 'https://i.pinimg.com/b.png', title: 'Doodle dog', page: 'https://pin/2', licence: 'unknown', joke: 'dog on fire, this is fine' }, null, { fetch: fetchPng });
    fs.writeFileSync(path.join(memez.path, 'mine.png'), PNG);
    expect(memesToPick(s, dir).map((x) => x.title).sort()).toEqual(['Doodle cat', 'Doodle dog']);
    expect(setSourcePick(sourceFolders(s, dir), 'memez/Doodle cat.png', 'yes')).toEqual({ ref: 'memez/Doodle cat.png', pick: 'yes' });
    setSourcePick(sourceFolders(s, dir), 'memez/Doodle dog.png', 'no');
    expect(setSourcePick(sourceFolders(s, dir), 'memez/mine.png', 'yes')).toBeNull(); // the owner's own file
    expect(memesToPick(s, dir)).toEqual([]);
    const list = async (picks?: string) => JSON.parse((await runSourceTool('files_source', picks ? { picks } : {}, s, dir, null)).content).files.map((f: any) => `${f.ref}:${f.pick}`).sort();
    expect(await list()).toEqual(['memez/Doodle cat.png:yes', 'memez/mine.png:owner']);
    expect(await list('yes')).toEqual(['memez/Doodle cat.png:yes', 'memez/mine.png:owner']);
    expect(await list('waiting')).toEqual([]);
    expect(sourcesBrief(s, dir)).toMatch(/THE OWNER PICKS THE MEMES/);
  });
});
