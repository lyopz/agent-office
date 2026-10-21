import { describe, expect, test } from 'vitest';
import { callCanva, canvaFiles, canvaRpc, readRpc, resetCanvaSession, toolName, canvaName } from '../server/canva.mjs';

const res = (body: unknown, init: { status?: number; headers?: Record<string, string> } = {}) => {
  const h = new Map(Object.entries(init.headers ?? { 'content-type': 'application/json' }));
  return { ok: (init.status ?? 200) < 400, status: init.status ?? 200, headers: { get: (k: string) => h.get(k.toLowerCase()) ?? null }, text: async () => (typeof body === 'string' ? body : JSON.stringify(body)), json: async () => body, arrayBuffer: async () => Buffer.from(String(body)) };
};
const config = () => ({ clientId: 'c1', tokenEndpoint: 'https://mcp.canva.com/token', accessToken: 'old', refreshToken: 'r1', expiresAt: Date.now() + 3_600_000 });

describe('canva', () => {
  test('tool names map both ways', () => {
    expect(toolName('export-design')).toBe('canva_export_design');
    expect(canvaName('canva_get_create_design_async_job')).toBe('get-create-design-async-job');
  });

  test('reads a reply from an event stream', () => {
    const text = 'event: message\ndata: {"jsonrpc":"2.0","method":"note"}\n\nevent: message\ndata: {"jsonrpc":"2.0","id":7,"result":{"ok":1}}\n\n';
    expect(readRpc(text, 'text/event-stream', 7)).toMatchObject({ result: { ok: 1 } });
  });

  test('starts a session, then renews an expired token once', async () => {
    resetCanvaSession();
    const cfg = config();
    const seen: string[] = [];
    let saved: any = null;
    const fetch = async (url: string, o: any) => {
      if (url.endsWith('/token')) { seen.push('refresh'); return res({ access_token: 'new', refresh_token: 'r2', expires_in: 3600 }); }
      const b = JSON.parse(o.body);
      const auth = o.headers.authorization;
      seen.push(`${b.method}:${auth}`);
      if (auth === 'Bearer old' && b.method === 'tools/list') return res({}, { status: 401 });
      if (b.method === 'initialize') return res({ jsonrpc: '2.0', id: b.id, result: {} }, { headers: { 'content-type': 'application/json', 'mcp-session-id': 's1' } });
      if (!b.id) return res('', { status: 202 });
      return res(`data: ${JSON.stringify({ jsonrpc: '2.0', id: b.id, result: { tools: [] } })}\n\n`, { headers: { 'content-type': 'text/event-stream' } });
    };
    const r = await canvaRpc('tools/list', {}, { fetch, config: cfg, save: (c: any) => { saved = c; } } as any);
    expect(r).toEqual({ tools: [] });
    expect(seen).toContain('refresh');
    expect(saved.refreshToken).toBe('r2');
    expect(seen.at(-1)).toBe('tools/list:Bearer new');
  });

  test('follows a create-design job until it finishes', async () => {
    resetCanvaSession();
    let polls = 0;
    const fetch = async (_u: string, o: any) => {
      const b = JSON.parse(o.body);
      if (b.method === 'initialize') return res({ jsonrpc: '2.0', id: b.id, result: {} });
      if (!b.id) return res('', { status: 202 });
      const name = b.params.name;
      const out = name === 'create-design' ? { job_id: 'j1', continuation_token: 'c0', status: 'in_progress', polling_policy: { wait_seconds: 1 } }
        : ++polls < 2 ? { job_id: 'j1', continuation_token: `c${polls}`, status: 'in_progress' } : { status: 'success', design: { id: 'DAAAAAAAAAA' } };
      return res({ jsonrpc: '2.0', id: b.id, result: { content: [{ type: 'text', text: JSON.stringify(out) }] } });
    };
    const r: any = await callCanva('canva_create_design', { query: 'Jersey Avenue poster' }, { fetch, config: config(), pollScale: 0 } as any);
    expect(polls).toBe(2);
    expect(r.content[0].text).toMatch(/DAAAAAAAAAA/);
  });

  test('downloads the PNG an export links to', async () => {
    const fetch = async (u: string) => (u.includes('export-download') ? res('PNGDATA', { headers: { 'content-type': 'image/png' } }) : res('nope', { status: 404 }));
    const files = await canvaFiles({ content: [{ type: 'text', text: 'Download: https://export-download.canva.com/abc/1.png?x=1' }] }, 'canva_export_design', { fetch } as any);
    expect(files).toHaveLength(1);
    expect(Buffer.from(files[0].b64, 'base64').toString()).toBe('PNGDATA');
  });
});
