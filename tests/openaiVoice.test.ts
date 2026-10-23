// JARVIS's OpenAI voice in the runner: speech and transcription go through the owner's key, cost is logged, and the cap holds.
import { describe, expect, test } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadVoice, voiceRoute } from '../server/openai-voice.mjs';

const dir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'voice-'));

describe('JARVIS voice (OpenAI)', () => {
  test('speaks text with the chosen voice and logs the cost', async () => {
    const d = dir();
    let sent: Record<string, unknown> = {};
    const fetch = (async (_u: string, init: RequestInit) => { sent = JSON.parse(String(init.body)); return new Response(new Uint8Array([1, 2, 3])); }) as unknown as typeof globalThis.fetch;
    const [code, out] = await voiceRoute('/api/origin/voice/speak', { text: 'Hello there, I am JARVIS.', voice: 'onyx' }, d, { key: 'k', fetch });
    expect(code).toBe(200);
    expect(out.audio).toBe(Buffer.from([1, 2, 3]).toString('base64'));
    expect(sent).toMatchObject({ voice: 'onyx', input: 'Hello there, I am JARVIS.' });
    expect(loadVoice(d).spentUsd).toBeGreaterThan(0);
    expect(loadVoice(d).log[0].kind).toBe('speak');
  });

  test('writes down recorded speech', async () => {
    const fetch = (async () => new Response(JSON.stringify({ text: 'make five mugs' }))) as unknown as typeof globalThis.fetch;
    const [code, out] = await voiceRoute('/api/origin/voice/transcribe', { audio: Buffer.alloc(500).toString('base64'), mime: 'audio/webm', seconds: 3 }, dir(), { key: 'k', fetch });
    expect(code).toBe(200);
    expect(out.text).toBe('make five mugs');
  });

  test('refuses without a key, and past the monthly cap', async () => {
    const d = dir();
    expect((await voiceRoute('/api/origin/voice/speak', { text: 'hi' }, d, { key: '' }))[0]).toBe(409);
    fs.writeFileSync(path.join(d, 'voice.json'), JSON.stringify({ month: new Date().toISOString().slice(0, 7), spentUsd: 99, log: [] }));
    const [code, out] = await voiceRoute('/api/origin/voice/speak', { text: 'hi' }, d, { key: 'k', fetch: (async () => { throw new Error('should not call'); }) as unknown as typeof globalThis.fetch });
    expect(code).toBe(409);
    expect(out.reason).toMatch(/limit/);
  });
});
