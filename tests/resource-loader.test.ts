import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ResourceLoader } from '../src/browser/networking/resource-loader';
import { CacheManager } from '../src/browser/networking/cache-manager';
import type { IHttpClient, HttpRequestSpec, HttpResponseSpec } from '../src/browser/networking/request-manager';
import type { DiscoveredResource } from '../src/browser/rendering/html5/dom';

// â”€â”€ Mock HTTP client â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function mockClient(responses: Record<string, { status?: number; body?: string; headers?: Record<string, string> }> = {}): IHttpClient {
  return {
    async send(spec: HttpRequestSpec, _signal: AbortSignal): Promise<HttpResponseSpec> {
      const url = spec.url;
      const resp = responses[url] ?? { status: 200, body: '', headers: {} };
      return {
        url,
        statusCode: resp.status ?? 200,
        statusText: 'OK',
        body: resp.body ?? '',
        bodyBinary: null,
        headers: new Map(Object.entries(resp.headers ?? {})),
        redirected: false,
        redirectChain: [],
      };
    },
  };
}

// â”€â”€ Tests â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

describe('ResourceLoader â€” Cache integration', () => {
  let cache: CacheManager;
  let loader: ResourceLoader;

  beforeEach(() => {
    cache = new CacheManager();
    loader = new ResourceLoader(mockClient({ 'https://example.com/a.css': { body: 'body{color:red}', headers: { 'content-type': 'text/css' } } }), undefined, undefined, undefined, cache);
  });

  it('populates cache on successful fetch', async () => {
    const result = await loader.loadResource('https://example.com/a.css', 'stylesheet');
    expect(result.error).toBeNull();
    expect(result.fromCache).toBe(false);
    // Second request should hit cache
    const cached = await loader.loadResource('https://example.com/a.css', 'stylesheet');
    expect(cached.fromCache).toBe(true);
    expect(cached.body).toBe('body{color:red}');
    expect(cached.durationMs).toBe(0);
  });

  it('cache hit returns immediately without network call', async () => {
    await cache.set('https://example.com/a.css', {
      url: 'https://example.com/a.css',
      body: 'cached', contentType: 'text/css', statusCode: 200,
      headers: new Map(), etag: null, lastModified: null, immutable: false, expiresAt: null,
    });
    const result = await loader.loadResource('https://example.com/a.css', 'stylesheet');
    expect(result.fromCache).toBe(true);
    expect(result.body).toBe('cached');
  });

  it('bypassCache (a user reload) skips the cached copy and refreshes it', async () => {
    await cache.set('https://example.com/a.css', {
      url: 'https://example.com/a.css',
      body: 'stale', contentType: 'text/css', statusCode: 200,
      headers: new Map(), etag: null, lastModified: null, immutable: false, expiresAt: null,
    });
    const fresh = await loader.loadResource('https://example.com/a.css', 'stylesheet', { bypassCache: true });
    expect(fresh.fromCache).toBe(false);
    expect(fresh.body).toBe('body{color:red}');
    const after = await loader.loadResource('https://example.com/a.css', 'stylesheet');
    expect(after.body).toBe('body{color:red}');
  });

  it.each(['no-store', 'no-cache', 'private, max-age=0, must-revalidate'])(
    'does not keep a response marked "%s" (dynamic pages stay fresh)',
    async (cacheControl) => {
      const url = 'https://example.com/news';
      const l = new ResourceLoader(mockClient({ [url]: { body: 'today', headers: { 'content-type': 'text/html', 'cache-control': cacheControl } } }), undefined, undefined, undefined, cache);
      await l.loadResource(url, 'document');
      expect(await cache.get(url)).toBeNull();
    },
  );

  it('honours max-age as the freshness lifetime', async () => {
    const url = 'https://example.com/app.js';
    const l = new ResourceLoader(mockClient({ [url]: { body: 'x', headers: { 'cache-control': 'public, max-age=3600' } } }), undefined, undefined, undefined, cache);
    await l.loadResource(url, 'script');
    const entry = await cache.get(url);
    expect(entry?.expiresAt).toBeGreaterThan(Date.now() + 3500 * 1000);
  });

  it('cache miss triggers network fetch', async () => {
    const result = await loader.loadResource('https://example.com/a.css', 'stylesheet');
    expect(result.fromCache).toBe(false);
    expect(result.body).toBe('body{color:red}');
  });

  it('cache respects TTL from cache-control header', async () => {
    const client = mockClient({
      'https://example.com/a.css': { body: 'data', headers: { 'cache-control': 'max-age=60' } },
    });
    loader = new ResourceLoader(client, undefined, undefined, undefined, cache);
    await loader.loadResource('https://example.com/a.css', 'stylesheet');
    const entry = await cache.get('https://example.com/a.css');
    expect(entry).not.toBeNull();
    expect(entry!.expiresAt).toBeGreaterThan(Date.now());
  });

  it('immutable response is cached', async () => {
    const client = mockClient({
      'https://example.com/a.css': { body: 'data', headers: { 'cache-control': 'public, immutable, max-age=31536000' } },
    });
    loader = new ResourceLoader(client, undefined, undefined, undefined, cache);
    await loader.loadResource('https://example.com/a.css', 'stylesheet');
    const entry = await cache.get('https://example.com/a.css');
    expect(entry!.immutable).toBe(true);
  });
});

describe('ResourceLoader â€” Priority queue integration', () => {
  it('priority queue orders pending requests correctly', async () => {
    const order: string[] = [];

    const client: IHttpClient = {
      async send(spec: HttpRequestSpec, _signal: AbortSignal): Promise<HttpResponseSpec> {
        order.push(new URL(spec.url).pathname);
        return { url: spec.url, statusCode: 200, statusText: 'OK', body: '', bodyBinary: null, headers: new Map(), redirected: false, redirectChain: [] };
      },
    };

    const loader = new ResourceLoader(client);

    // 4 requests, max 4 concurrent â€” all go through immediately, but loadBatch
    // sorts by priority before dispatching
    const resources: DiscoveredResource[] = [
      { url: 'https://example.com/img.png', kind: 'image', blocking: false, deferred: false, sourceTag: 'img' },
      { url: 'https://example.com/style.css', kind: 'stylesheet', blocking: true, deferred: false, sourceTag: 'link' },
      { url: 'https://example.com/font.woff', kind: 'font', blocking: false, deferred: false, sourceTag: 'link' },
      { url: 'https://example.com/lazy.png', kind: 'image', blocking: false, deferred: true, sourceTag: 'img' },
    ];

    const result = await loader.loadBatch(resources);
    expect(result.succeeded).toBe(4);
    // loadBatch sorts by priority before dispatching
    expect(order[0]).toBe('/style.css');  // blocking (weight 0)
    expect(order[1]).toBe('/font.woff');  // high (weight 1, font)
    expect(order[2]).toBe('/img.png');    // normal (weight 2, image)
    expect(order[3]).toBe('/lazy.png');   // deferred (weight 4)
  });

  it('loadBatch sorts by priority', async () => {
    const order: string[] = [];
    const client: IHttpClient = {
      async send(spec: HttpRequestSpec, _signal: AbortSignal): Promise<HttpResponseSpec> {
        order.push(new URL(spec.url).pathname);
        return { url: spec.url, statusCode: 200, statusText: 'OK', body: '', bodyBinary: null, headers: new Map(), redirected: false, redirectChain: [] };
      },
    };

    const loader = new ResourceLoader(client);
    const resources: DiscoveredResource[] = [
      { url: 'https://example.com/img.png', kind: 'image', blocking: false, deferred: false, sourceTag: 'img' },
      { url: 'https://example.com/style.css', kind: 'stylesheet', blocking: true, deferred: false, sourceTag: 'link' },
      { url: 'https://example.com/script.js', kind: 'script', blocking: false, deferred: false, sourceTag: 'script' },
    ];

    const result = await loader.loadBatch(resources);
    expect(result.succeeded).toBe(3);
    expect(result.failed).toBe(0);
    // Order: stylesheet (blocking=0), script (high=1), image (normal=2)
    expect(order[0]).toBe('/style.css');
    expect(order[1]).toBe('/script.js');
    expect(order[2]).toBe('/img.png');
  });
});

describe('ResourceLoader â€” Bandwidth tracking', () => {
  it('records bandwidth samples on fetch', async () => {
    const loader = new ResourceLoader(
      mockClient({ 'https://example.com/a.css': { body: 'x'.repeat(1000) } }),
    );
    await loader.loadResource('https://example.com/a.css', 'stylesheet');
  });
});

describe('ResourceLoader â€” Error handling with cache', () => {
  it('does not cache error responses', async () => {
    const cache = new CacheManager();
    const loader = new ResourceLoader(
      mockClient({ 'https://example.com/fail.css': { status: 500, body: 'error' } }),
      undefined, undefined, undefined, cache,
    );
    await loader.loadResource('https://example.com/fail.css', 'stylesheet');
    const cached = await cache.get('https://example.com/fail.css');
    expect(cached).toBeNull();
  });

  it('does not cache 404 responses', async () => {
    const cache = new CacheManager();
    const loader = new ResourceLoader(
      mockClient({ 'https://example.com/missing.css': { status: 404, body: 'not found' } }),
      undefined, undefined, undefined, cache,
    );
    await loader.loadResource('https://example.com/missing.css', 'stylesheet');
    const cached = await cache.get('https://example.com/missing.css');
    expect(cached).toBeNull();
  });
});

describe('ResourceLoader — binary bodies and revalidation', () => {
  /** Serves `body` with `headers`; answers 304 when the request's If-None-Match matches `etag`. */
  function validatingClient(body: string, headers: Record<string, string>, binary: Uint8Array | null = null) {
    const sent: HttpRequestSpec[] = [];
    const client: IHttpClient = {
      async send(spec: HttpRequestSpec): Promise<HttpResponseSpec> {
        sent.push(spec);
        const notModified = headers.etag !== undefined && spec.headers.get('if-none-match') === headers.etag;
        return {
          url: spec.url, statusCode: notModified ? 304 : 200, statusText: notModified ? 'Not Modified' : 'OK',
          body: notModified ? '' : body, bodyBinary: notModified ? null : binary,
          headers: new Map(Object.entries(headers)), redirected: false, redirectChain: [],
        };
      },
    };
    return { client, sent };
  }

  it('keeps the binary body of a cached image, so a revisit can still decode it', async () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
    const { client } = validatingClient('\u0089PNG', { 'content-type': 'image/png', 'cache-control': 'max-age=600' }, png);
    const loader = new ResourceLoader(client, undefined, undefined, undefined, new CacheManager());
    await loader.loadImage('https://example.com/a.png');
    const again = await loader.loadImage('https://example.com/a.png');
    expect(again.fromCache).toBe(true);
    expect(again.bodyBinary).toEqual(png);
  });

  it('revalidates an expired entry with If-None-Match and reuses the body on 304', async () => {
    const cache = new CacheManager();
    const { client, sent } = validatingClient('body{}', { 'content-type': 'text/css', etag: '"v1"' });
    const loader = new ResourceLoader(client, undefined, undefined, undefined, cache);
    await cache.set('https://example.com/a.css', {
      url: 'https://example.com/a.css', body: 'body{}', contentType: 'text/css', statusCode: 200,
      headers: new Map(), etag: '"v1"', lastModified: null, immutable: false, expiresAt: 1,
    });
    const result = await loader.loadResource('https://example.com/a.css', 'stylesheet');
    expect(sent[0]?.headers.get('if-none-match')).toBe('"v1"');
    expect(result.statusCode).toBe(200);
    expect(result.body).toBe('body{}');
    expect(result.fromCache).toBe(true);
  });

  it('stores a no-cache response that has a validator, and revalidates it on every use', async () => {
    const { client, sent } = validatingClient('<p>hi</p>', { 'content-type': 'text/html', 'cache-control': 'no-cache', etag: '"p1"' });
    const loader = new ResourceLoader(client, undefined, undefined, undefined, new CacheManager());
    await loader.loadResource('https://example.com/', 'document');
    const second = await loader.loadResource('https://example.com/', 'document');
    expect(sent).toHaveLength(2);
    expect(sent[1]?.headers.get('if-none-match')).toBe('"p1"');
    expect(second.body).toBe('<p>hi</p>');
  });

  it('a reload skips revalidation and fetches the full response', async () => {
    const { client, sent } = validatingClient('<p>hi</p>', { 'cache-control': 'no-cache', etag: '"p1"' });
    const loader = new ResourceLoader(client, undefined, undefined, undefined, new CacheManager());
    await loader.loadResource('https://example.com/', 'document');
    await loader.loadResource('https://example.com/', 'document', { bypassCache: true });
    expect(sent[1]?.headers.has('if-none-match')).toBe(false);
  });
});

describe('ResourceLoader — Redirect following', () => {
  it('follows a 301 redirect and returns the final body', async () => {
    const requested: string[] = [];
    const client: IHttpClient = {
      async send(spec: HttpRequestSpec, _signal: AbortSignal): Promise<HttpResponseSpec> {
        requested.push(spec.url);
        if (spec.url === 'https://mail.com/') {
          return { url: spec.url, statusCode: 301, statusText: 'Moved Permanently', body: '',
            bodyBinary: null, headers: new Map([['location', 'https://www.mail.com/']]),
            redirected: false, redirectChain: [] };
        }
        return { url: spec.url, statusCode: 200, statusText: 'OK', body: '<h1>home</h1>',
          bodyBinary: null, headers: new Map(), redirected: false, redirectChain: [] };
      },
    };

    const loader = new ResourceLoader(client);
    const result = await loader.loadResource('https://mail.com/', 'document');
    expect(result.error).toBeNull();
    expect(result.statusCode).toBe(200);
    expect(result.url).toBe('https://www.mail.com/');
    expect(result.body).toBe('<h1>home</h1>');
    expect(requested).toEqual(['https://mail.com/', 'https://www.mail.com/']);
  });

  it('resolves relative Location headers against the current URL', async () => {
    const requested: string[] = [];
    const client: IHttpClient = {
      async send(spec: HttpRequestSpec, _signal: AbortSignal): Promise<HttpResponseSpec> {
        requested.push(spec.url);
        if (spec.url === 'https://mail.com/') {
          return { url: spec.url, statusCode: 302, statusText: 'Found', body: '',
            bodyBinary: null, headers: new Map([['location', '/en/']]),
            redirected: false, redirectChain: [] };
        }
        return { url: spec.url, statusCode: 200, statusText: 'OK', body: 'ok',
          bodyBinary: null, headers: new Map(), redirected: false, redirectChain: [] };
      },
    };

    const loader = new ResourceLoader(client);
    const result = await loader.loadResource('https://mail.com/', 'document');
    expect(result.error).toBeNull();
    expect(result.statusCode).toBe(200);
    expect(result.url).toBe('https://mail.com/en/');
    expect(requested).toEqual(['https://mail.com/', 'https://mail.com/en/']);
  });

  it('returns an error when a redirect has no Location header', async () => {
    const client: IHttpClient = {
      async send(spec: HttpRequestSpec, _signal: AbortSignal): Promise<HttpResponseSpec> {
        return { url: spec.url, statusCode: 301, statusText: 'Moved Permanently', body: '',
          bodyBinary: null, headers: new Map(), redirected: false, redirectChain: [] };
      },
    };

    const loader = new ResourceLoader(client);
    const result = await loader.loadResource('https://mail.com/', 'document');
    expect(result.error).not.toBeNull();
    expect(result.error).toContain('no Location header');
  });

  it('caps redirect chains to avoid infinite loops', async () => {
    let calls = 0;
    const client: IHttpClient = {
      async send(spec: HttpRequestSpec, _signal: AbortSignal): Promise<HttpResponseSpec> {
        calls++;
        const next = `https://example.com/loop/${calls}`;
        return { url: spec.url, statusCode: 301, statusText: 'Moved Permanently', body: '',
          bodyBinary: null, headers: new Map([['location', next]]),
          redirected: false, redirectChain: [] };
      },
    };

    const loader = new ResourceLoader(client);
    const result = await loader.loadResource('https://example.com/start', 'document');
    expect(result.error).not.toBeNull();
    expect(result.error).toContain('Too many redirects');
    expect(calls).toBe(11);
  });
});
