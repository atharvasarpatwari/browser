// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'node:events';
import { createServer } from 'node:http';
import { createGzip } from 'node:zlib';
import type { AddressInfo } from 'node:net';
import {
  DevProxyHttpClient,
  isBrowserContext,
} from '../src/browser/networking/dev-proxy-http-client';
import {
  createNovaDevProxyMiddleware,
  parseNovaProxyTarget,
  buildNovaProxyUrl,
  NOVA_PROXY_PATH,
  type NovaProxyMiddleware,
} from '../vite-plugins/nova-dev-proxy';
import type { HttpRequestSpec, IHttpClient } from '../src/browser/networking/request-manager';

interface InvokeResult {
  status: number;
  headers: Record<string, unknown>;
  body: string;
  bodyBuf: Buffer;
  nextCalled: boolean;
}

function invokeMiddleware(
  middleware: NovaProxyMiddleware,
  init: { method?: string; url: string; headers?: Record<string, string> },
): Promise<InvokeResult> {
  const req = new EventEmitter() as EventEmitter & {
    method: string;
    url: string;
    headers: Record<string, string>;
  };
  req.method = init.method ?? 'GET';
  req.url = init.url;
  req.headers = init.headers ?? {};

  const chunks: Buffer[] = [];
  const headers: Record<string, unknown> = {};
  let nextCalled = false;
  let settled = false;

  const res = new EventEmitter() as EventEmitter & {
    statusCode: number;
    statusMessage: string;
    headersSent: boolean;
    writableEnded: boolean;
    setHeader: (k: string, v: unknown) => void;
    getHeader: (k: string) => unknown;
    end: (c?: Buffer | string) => void;
  };
  res.statusCode = 200;
  res.statusMessage = '';
  res.headersSent = false;
  res.writableEnded = false;
  res.setHeader = (k: string, v: unknown) => {
    headers[k.toLowerCase()] = v;
  };
  res.getHeader = (k: string) => headers[k.toLowerCase()];
  res.end = (c?: Buffer | string) => {
    if (c !== undefined) chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(String(c)));
    if (!settled) {
      settled = true;
      // eslint-disable-next-line @typescript-eslint/no-use-before-define
      done();
    }
  };
  let done!: () => void;
  const promise = new Promise<InvokeResult>((resolve) => {
    done = () =>
      resolve({
        status: res.statusCode,
        headers,
        body: Buffer.concat(chunks).toString('utf-8'),
        bodyBuf: Buffer.concat(chunks),
        nextCalled,
      });
  });

  middleware(req as never, res as never, () => {
    nextCalled = true;
    if (!settled) {
      settled = true;
      done();
    }
  });
  req.emit('end');

  return promise;
}

describe('parseNovaProxyTarget', () => {
  it('extracts ?url= query form', () => {
    expect(parseNovaProxyTarget('/__nova_proxy/?url=https%3A%2F%2Fexample.com%2F')).toBe(
      'https://example.com/',
    );
  });

  it('extracts path-encoded form', () => {
    expect(parseNovaProxyTarget('/__nova_proxy/https%3A%2F%2Fexample.com%2Fa%3Fb%3D1')).toBe(
      'https://example.com/a?b=1',
    );
  });

  it('rejects non-proxy paths', () => {
    expect(parseNovaProxyTarget('/src/app/main.ts')).toBeNull();
    expect(parseNovaProxyTarget('/__nova_proxyx/?url=x')).toBeNull();
  });

  it('rejects non-http(s) targets', () => {
    expect(parseNovaProxyTarget(`/__nova_proxy/?url=${encodeURIComponent('data:text/html,x')}`)).toBeNull();
    expect(parseNovaProxyTarget(`/__nova_proxy/?url=${encodeURIComponent('javascript:void(0)')}`)).toBeNull();
    expect(parseNovaProxyTarget(`/__nova_proxy/?url=${encodeURIComponent('nova:settings')}`)).toBeNull();
  });

  it('buildNovaProxyUrl round-trips', () => {
    const url = buildNovaProxyUrl('http://localhost:5173', 'https://example.com/path?a=1&b=2');
    expect(url.startsWith('http://localhost:5173')).toBe(true);
    expect(parseNovaProxyTarget(url.slice('http://localhost:5173'.length))).toBe(
      'https://example.com/path?a=1&b=2',
    );
  });
});

describe('DevProxyHttpClient', () => {
  beforeEach(() => {
    (globalThis as Record<string, unknown>).window = {
      location: { origin: 'http://localhost:5173' },
    };
  });

  afterEach(() => {
    delete (globalThis as Record<string, unknown>).window;
  });

  it('rewrites http(s) requests through the proxy in a browser dev context', async () => {
    expect(isBrowserContext()).toBe(true);
    const inner: IHttpClient = {
      send: vi.fn(async (req: HttpRequestSpec) => ({
        url: req.url,
        statusCode: 200,
        statusText: 'OK',
        headers: new Map(),
        body: '',
        bodyBinary: null,
        redirected: false,
        redirectChain: [],
      })),
    };
    const client = new DevProxyHttpClient(inner);
    await client.send(
      { url: 'https://example.com/', method: 'GET', headers: new Map(), timeoutMs: 1000 },
      new AbortController().signal,
    );
    const sent = (inner.send as ReturnType<typeof vi.fn>).mock.calls[0][0] as HttpRequestSpec;
    expect(sent.url.startsWith('http://localhost:5173' + NOVA_PROXY_PATH + '?url=')).toBe(true);
    expect(sent.url).toContain(encodeURIComponent('https://example.com/'));
  });

  it('does not rewrite non-http(s) schemes', async () => {
    const inner: IHttpClient = {
      send: vi.fn(async (req: HttpRequestSpec) => ({
        url: req.url,
        statusCode: 200,
        statusText: 'OK',
        headers: new Map(),
        body: '',
        bodyBinary: null,
        redirected: false,
        redirectChain: [],
      })),
    };
    const client = new DevProxyHttpClient(inner);
    await client.send(
      { url: 'data:text/html,hello', method: 'GET', headers: new Map(), timeoutMs: 1000 },
      new AbortController().signal,
    );
    const sent = (inner.send as ReturnType<typeof vi.fn>).mock.calls[0][0] as HttpRequestSpec;
    expect(sent.url).toBe('data:text/html,hello');
  });
});

describe('novaDevProxyMiddleware (end-to-end against a local server)', () => {
  let server: ReturnType<typeof createServer>;
  let base: string;
  let middleware: NovaProxyMiddleware;

  beforeAll(async () => {
    server = createServer((req, res) => {
      const url = req.url ?? '/';
      if (url === '/hello') {
        res.writeHead(200, { 'content-type': 'text/plain' });
        res.end('hello from upstream');
        return;
      }
      if (url === '/start') {
        res.writeHead(302, { location: '/final' });
        res.end();
        return;
      }
      if (url === '/final') {
        res.writeHead(200, { 'content-type': 'text/plain' });
        res.end('final-body');
        return;
      }
      if (url === '/gzip') {
        res.writeHead(200, { 'content-type': 'text/plain', 'content-encoding': 'gzip' });
        const gz = createGzip();
        gz.pipe(res);
        gz.end('compressed payload');
        return;
      }
      if (url === '/binary') {
        res.writeHead(200, { 'content-type': 'image/png' });
        res.end(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x01, 0x02, 0x03]));
        return;
      }
      res.writeHead(404, { 'content-type': 'text/plain' });
      res.end('not found');
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const addr = server.address() as AddressInfo;
    base = `http://127.0.0.1:${addr.port}`;
    middleware = createNovaDevProxyMiddleware();
  });

  afterAll(async () => {
    await new Promise<void>((resolve, reject) =>
      server.close((err) => (err ? reject(err) : resolve())),
    );
  });

  function proxiedPath(target: string): string {
    return `${NOVA_PROXY_PATH}?url=${encodeURIComponent(target)}`;
  }

  it('forwards a plain GET and returns upstream status + body', async () => {
    const result = await invokeMiddleware(middleware, { url: proxiedPath(`${base}/hello`) });
    expect(result.status).toBe(200);
    expect(result.body).toBe('hello from upstream');
    expect(result.headers['x-nova-proxy-url']).toBe(`${base}/hello`);
    expect(result.headers['access-control-allow-origin']).toBe('*');
  });

  it('follows redirects server-side and reports the final URL', async () => {
    const result = await invokeMiddleware(middleware, { url: proxiedPath(`${base}/start`) });
    expect(result.status).toBe(200);
    expect(result.body).toBe('final-body');
    expect(result.headers['x-nova-proxy-url']).toBe(`${base}/final`);
  });

  it('decompresses gzip upstream bodies (undici strips content-encoding)', async () => {
    const result = await invokeMiddleware(middleware, { url: proxiedPath(`${base}/gzip`) });
    expect(result.status).toBe(200);
    expect(result.body).toBe('compressed payload');
    expect(result.headers['content-encoding']).toBeUndefined();
  });

  it('passes binary bodies through byte-for-byte', async () => {
    const result = await invokeMiddleware(middleware, { url: proxiedPath(`${base}/binary`) });
    expect(result.bodyBuf).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x01, 0x02, 0x03]));
    expect(result.headers['content-type']).toBe('image/png');
  });

  it('returns 502 when the upstream is unreachable', async () => {
    const result = await invokeMiddleware(middleware, { url: proxiedPath('http://127.0.0.1:1/') });
    expect(result.status).toBe(502);
  });

  it('calls next() for non-proxy paths', async () => {
    const result = await invokeMiddleware(middleware, { url: '/src/app/main.ts' });
    expect(result.nextCalled).toBe(true);
  });
});
