// @vitest-environment node
// Node's built-in Request/FormData/Blob serialize bodies like a real browser
// (happy-dom's don't), which is exactly what nova-bridge.js relies on.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const SHIM = readFileSync(path.resolve(__dirname, '../android/bridge/nova-bridge.js'), 'utf8');

interface NativeCall { id: string; method: string; url: string; headers: Record<string, string>; body: Buffer | null }

/** Loads the shim into a fake `window` whose NovaFetchBridge records calls and answers 200 "ok". */
function loadShim(reply: Record<string, unknown> = { status: 200, headers: { 'Content-Type': 'text/plain' }, bodyText: 'ok' }) {
  const calls: NativeCall[] = [];
  const win: Record<string, any> = { fetch: async () => new Response('real fetch') };
  win.NovaFetchBridge = {
    fetch(id: string, method: string, url: string, headersJson: string, _redirect: string, bodyBase64: string | null) {
      calls.push({ id, method, url, headers: JSON.parse(headersJson), body: bodyBase64 == null ? null : Buffer.from(bodyBase64, 'base64') });
      queueMicrotask(() => win.__novaFetchResolve(id, reply));
    },
    abort() {},
  };
  new Function('window', SHIM)(win);
  return { fetch: win.fetch as typeof fetch, calls };
}

describe('nova-bridge.js request bodies', () => {
  it('sends FormData as multipart with its boundary (was silently dropped)', async () => {
    const { fetch, calls } = loadShim();
    const form = new FormData();
    form.append('field', 'value');
    form.append('upload', new Blob(['file-bytes'], { type: 'text/plain' }), 'a.txt');
    expect(await (await fetch('https://example.com/form', { method: 'POST', body: form })).text()).toBe('ok');
    const ct = calls[0].headers['Content-Type'];
    expect(ct).toMatch(/^multipart\/form-data; boundary=/);
    const text = calls[0].body!.toString('utf8');
    expect(text).toContain(ct.split('boundary=')[1]);
    expect(text).toContain('name="field"');
    expect(text).toContain('file-bytes');
  });

  it('sends binary bodies byte-for-byte', async () => {
    const { fetch, calls } = loadShim();
    await fetch('https://example.com/bin', { method: 'PUT', body: new Uint8Array([0, 255, 128, 10]) });
    expect([...calls[0].body!]).toEqual([0, 255, 128, 10]);
    await fetch('https://example.com/blob', { method: 'POST', body: new Blob([new Uint8Array([7, 8, 9])]) });
    expect([...calls[1].body!]).toEqual([7, 8, 9]);
  });

  it('adds the implied Content-Type but never overrides the engine’s, and keeps forbidden headers', async () => {
    const { fetch, calls } = loadShim();
    await fetch('https://example.com/q', { method: 'POST', body: new URLSearchParams({ a: '1', b: 'two' }) });
    expect(calls[0].body!.toString()).toBe('a=1&b=two');
    expect(calls[0].headers['Content-Type']).toBe('application/x-www-form-urlencoded;charset=UTF-8');

    await fetch('https://example.com/json', {
      method: 'PATCH',
      body: '{"x":1}',
      headers: { 'content-type': 'application/json', Cookie: 'sid=1', Referer: 'https://example.com/' },
    });
    expect(calls[1].method).toBe('PATCH');
    expect(calls[1].body!.toString()).toBe('{"x":1}');
    expect(calls[1].headers).toEqual({ 'content-type': 'application/json', Cookie: 'sid=1', Referer: 'https://example.com/' });
  });

  it('sends no body for GET and leaves non-http URLs to the real fetch', async () => {
    const { fetch, calls } = loadShim();
    await fetch('https://example.com/get');
    expect(calls[0].body).toBeNull();
    expect(await (await fetch('./assets/local.js')).text()).toBe('real fetch');
    expect(calls).toHaveLength(1);
  });

  it('rejects an already-aborted request without calling native', async () => {
    const { fetch, calls } = loadShim();
    const ctl = new AbortController();
    ctl.abort();
    await expect(fetch('https://example.com/x', { method: 'POST', body: 'x', signal: ctl.signal })).rejects.toThrow(/Aborted/);
    expect(calls).toHaveLength(0);
  });
});

describe('nova-bridge.js responses', () => {
  // Kotlin sends bodyText "" for an empty body; new Response("", { status: 304 }) throws, which
  // rejected every 204/304 (and so every cache revalidation) on Android.
  it.each([204, 304])('resolves a %i with an empty body instead of rejecting', async (status) => {
    const { fetch } = loadShim({ status, headers: { ETag: '"v1"' }, bodyText: '' });
    const res = await fetch('https://example.com/a.css', { headers: { 'If-None-Match': '"v1"' } });
    expect(res.status).toBe(status);
    expect(res.headers.get('etag')).toBe('"v1"');
  });
});
