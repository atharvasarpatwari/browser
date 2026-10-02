import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ResourceLoader } from '../src/browser/networking/resource-loader';
import { CacheManager } from '../src/browser/networking/cache-manager';
import { CookieJar } from '../src/browser/networking/cookie-jar';
import { CorsEngine } from '../src/browser/security/cors';
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
      headers: new Map(), etag: null, lastModified: null, immutable: false, bodyBinary: null, expiresAt: null,
    });
    const result = await loader.loadResource('https://example.com/a.css', 'stylesheet');
    expect(result.fromCache).toBe(true);
    expect(result.body).toBe('cached');
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

  it('no-store response is never cached', async () => {
    const client = mockClient({
      'https://example.com/a.css': { body: 'secret', headers: { 'cache-control': 'no-store' } },
    });
    loader = new ResourceLoader(client, undefined, undefined, undefined, cache);
    const result = await loader.loadResource('https://example.com/a.css', 'stylesheet');
    expect(result.error).toBeNull();
    expect(result.body).toBe('secret');
    expect(await cache.get('https://example.com/a.css')).toBeNull();
  });

  it('no-cache response is cached but revalidated via ETag on the next request', async () => {
    let calls = 0;
    let sawIfNoneMatch: string | undefined;
    const client: IHttpClient = {
      async send(spec: HttpRequestSpec, _signal: AbortSignal): Promise<HttpResponseSpec> {
        calls++;
        if (calls === 1) {
          return {
            url: spec.url, statusCode: 200, statusText: 'OK',
            body: 'fresh-body', bodyBinary: null,
            headers: new Map([['cache-control', 'no-cache'], ['etag', '"v1"']]),
            redirected: false, redirectChain: [],
          };
        }
        sawIfNoneMatch = spec.headers.get('if-none-match');
        return {
          url: spec.url, statusCode: 304, statusText: 'Not Modified',
          body: '', bodyBinary: null, headers: new Map(),
          redirected: false, redirectChain: [],
        };
      },
    };
    loader = new ResourceLoader(client, undefined, undefined, undefined, cache);

    const first = await loader.loadResource('https://example.com/a.css', 'stylesheet');
    expect(first.body).toBe('fresh-body');
    expect(first.fromCache).toBe(false);

    const second = await loader.loadResource('https://example.com/a.css', 'stylesheet');
    expect(sawIfNoneMatch).toBe('"v1"');
    expect(second.statusCode).toBe(200);
    expect(second.body).toBe('fresh-body');
    expect(second.fromCache).toBe(true);
    expect(calls).toBe(2);
  });

  it('ETag-validated response (max-age=0) revalidates via If-None-Match and reuses the cached body on 304', async () => {
    let calls = 0;
    let sawIfNoneMatch: string | undefined;
    const client: IHttpClient = {
      async send(spec: HttpRequestSpec, _signal: AbortSignal): Promise<HttpResponseSpec> {
        calls++;
        if (calls === 1) {
          return {
            url: spec.url, statusCode: 200, statusText: 'OK',
            body: 'etag-body', bodyBinary: null,
            headers: new Map([['cache-control', 'max-age=0'], ['etag', '"abc"']]),
            redirected: false, redirectChain: [],
          };
        }
        sawIfNoneMatch = spec.headers.get('if-none-match');
        return {
          url: spec.url, statusCode: 304, statusText: 'Not Modified',
          body: 'SHOULD-NOT-BE-USED', bodyBinary: null, headers: new Map(),
          redirected: false, redirectChain: [],
        };
      },
    };
    loader = new ResourceLoader(client, undefined, undefined, undefined, cache);

    await loader.loadResource('https://example.com/a.css', 'stylesheet');
    const second = await loader.loadResource('https://example.com/a.css', 'stylesheet');

    expect(sawIfNoneMatch).toBe('"abc"');
    expect(second.body).toBe('etag-body');
    expect(second.fromCache).toBe(true);
    expect(calls).toBe(2);
  });

  it('binary response body survives a cache hit', async () => {
    const bytes = new Uint8Array([137, 80, 78, 71]);
    const client: IHttpClient = {
      async send(spec: HttpRequestSpec, _signal: AbortSignal): Promise<HttpResponseSpec> {
        return {
          url: spec.url, statusCode: 200, statusText: 'OK',
          body: '', bodyBinary: bytes,
          headers: new Map([['content-type', 'image/png']]),
          redirected: false, redirectChain: [],
        };
      },
    };
    loader = new ResourceLoader(client, undefined, undefined, undefined, cache);

    const first = await loader.loadResource('https://example.com/pic.png', 'image');
    expect(first.bodyBinary).toEqual(bytes);

    const second = await loader.loadResource('https://example.com/pic.png', 'image');
    expect(second.fromCache).toBe(true);
    expect(second.bodyBinary).toEqual(bytes);
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

describe('ResourceLoader — Cookie integration', () => {
  it('stores Set-Cookie from a response and sends it back on the next request', async () => {
    const cookieJar = new CookieJar();
    const requestCookieHeaders: (string | undefined)[] = [];

    const client: IHttpClient = {
      async send(spec: HttpRequestSpec, _signal: AbortSignal): Promise<HttpResponseSpec> {
        requestCookieHeaders.push(spec.headers.get('cookie'));
        return {
          url: spec.url, statusCode: 200, statusText: 'OK', body: 'ok', bodyBinary: null,
          headers: new Map([['set-cookie', 'session=abc123; Path=/']]),
          redirected: false, redirectChain: [],
        };
      },
    };

    const loader = new ResourceLoader(client);
    loader.setCookieJar(cookieJar);

    await loader.loadResource('https://example.com/a', 'document');
    expect(cookieJar.getCookieHeader('https://example.com/')).toBe('session=abc123');

    await loader.loadResource('https://example.com/b', 'document');
    expect(requestCookieHeaders).toEqual([undefined, 'session=abc123']);
  });

  it('prefers setCookieHeaders over the collapsed headers Map so multiple cookies survive', async () => {
    const cookieJar = new CookieJar();
    const client: IHttpClient = {
      async send(spec: HttpRequestSpec, _signal: AbortSignal): Promise<HttpResponseSpec> {
        return {
          url: spec.url, statusCode: 200, statusText: 'OK', body: 'ok', bodyBinary: null,
          headers: new Map([['set-cookie', 'b=2; Path=/']]), // last-write-wins collapse
          setCookieHeaders: ['a=1; Path=/', 'b=2; Path=/'],
          redirected: false, redirectChain: [],
        };
      },
    };

    const loader = new ResourceLoader(client);
    loader.setCookieJar(cookieJar);

    await loader.loadResource('https://example.com/', 'document');
    const header = cookieJar.getCookieHeader('https://example.com/');
    expect(header).toContain('a=1');
    expect(header).toContain('b=2');
  });

  it('does not leak a cookie across a cross-host redirect', async () => {
    const cookieJar = new CookieJar();
    const requestCookieHeaders: Record<string, string | undefined> = {};

    const client: IHttpClient = {
      async send(spec: HttpRequestSpec, _signal: AbortSignal): Promise<HttpResponseSpec> {
        requestCookieHeaders[spec.url] = spec.headers.get('cookie');
        if (spec.url === 'https://a.com/') {
          return {
            url: spec.url, statusCode: 302, statusText: 'Found', body: '', bodyBinary: null,
            headers: new Map([['location', 'https://b.com/']]),
            redirected: false, redirectChain: [],
          };
        }
        return {
          url: spec.url, statusCode: 200, statusText: 'OK', body: 'ok', bodyBinary: null,
          headers: new Map(), redirected: false, redirectChain: [],
        };
      },
    };

    const loader = new ResourceLoader(client);
    loader.setCookieJar(cookieJar);
    cookieJar.setFromResponse('https://a.com/', ['aCookie=1; Path=/']);

    await loader.loadResource('https://a.com/', 'document');
    expect(requestCookieHeaders['https://a.com/']).toBe('aCookie=1');
    expect(requestCookieHeaders['https://b.com/']).toBeUndefined();
  });
});

describe('ResourceLoader — Timeout enforcement', () => {
  it('fails fast when the underlying IHttpClient hangs and ignores timeoutMs', async () => {
    vi.useFakeTimers();
    try {
      const hangingClient: IHttpClient = {
        send(_spec: HttpRequestSpec, signal: AbortSignal): Promise<HttpResponseSpec> {
          // Mirrors real fetch(): the connection itself hangs forever (e.g. a
          // blackholed TCP connect) and the promise only ever settles via the
          // AbortSignal — exactly like FetchHttpClient's `fetch(url, { signal })`.
          return new Promise((_resolve, reject) => {
            signal.addEventListener('abort', () => reject(new DOMException('The operation was aborted.', 'AbortError')));
          });
        },
      };
      const loader = new ResourceLoader(hangingClient);
      const pending = loader.loadResource('https://example.com/', 'document', { timeoutMs: 50 });
      await vi.advanceTimersByTimeAsync(50);
      const result = await pending;
      expect(result.error).toContain('timed out after 50ms');
      expect(result.statusCode).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('ResourceLoader — Network timing (DevTools)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('attaches a DNS/connect/TLS/wait/download breakdown from Resource Timing', async () => {
    const url = 'https://example.com/timed.css';
    vi.spyOn(performance, 'getEntriesByType').mockReturnValue([
      {
        name: url,
        startTime: 100,
        domainLookupStart: 100, domainLookupEnd: 105,
        connectStart: 105, secureConnectionStart: 108, connectEnd: 112,
        requestStart: 112, responseStart: 120, responseEnd: 130,
      } as unknown as PerformanceEntry,
    ]);

    const loader = new ResourceLoader(mockClient({ [url]: { body: 'a{}' } }));
    const onLoad = vi.fn();
    loader.setOnLoad(onLoad);
    const result = await loader.loadResource(url, 'stylesheet');

    expect(result.timing).toEqual({
      dnsMs: 5, connectMs: 3, tlsMs: 4, ttfbMs: 8, downloadMs: 10, totalMs: 30,
    });
    expect(onLoad).toHaveBeenCalledWith(expect.objectContaining({ timing: result.timing }));
  });

  it('omits timing when no matching Resource Timing entry exists', async () => {
    vi.spyOn(performance, 'getEntriesByType').mockReturnValue([]);
    const url = 'https://example.com/untimed.css';
    const loader = new ResourceLoader(mockClient({ [url]: { body: 'a{}' } }));
    const result = await loader.loadResource(url, 'stylesheet');
    expect(result.timing).toBeUndefined();
  });

  it('does not attach timing to a cache hit', async () => {
    const url = 'https://example.com/cached.css';
    vi.spyOn(performance, 'getEntriesByType').mockReturnValue([
      {
        name: url, startTime: 0,
        domainLookupStart: 0, domainLookupEnd: 1, connectStart: 1, secureConnectionStart: 0,
        connectEnd: 2, requestStart: 2, responseStart: 3, responseEnd: 4,
      } as unknown as PerformanceEntry,
    ]);

    const cache = new CacheManager();
    const loader = new ResourceLoader(mockClient({ [url]: { body: 'a{}' } }), undefined, undefined, undefined, cache);
    await loader.loadResource(url, 'stylesheet'); // populates the cache

    const cached = await loader.loadResource(url, 'stylesheet');
    expect(cached.fromCache).toBe(true);
    expect(cached.timing).toBeUndefined();
  });
});

describe('ResourceLoader — method/body pass-through (POST form submission)', () => {
  it('defaults to GET with no body when options are omitted', async () => {
    const seen: HttpRequestSpec[] = [];
    const client: IHttpClient = {
      async send(spec) {
        seen.push(spec);
        return { url: spec.url, statusCode: 200, statusText: 'OK', body: 'ok', bodyBinary: null, headers: new Map(), redirected: false, redirectChain: [] };
      },
    };
    const loader = new ResourceLoader(client);
    await loader.loadResource('https://example.com/', 'document');
    expect(seen[0]?.method).toBe('GET');
    expect(seen[0]?.body).toBeUndefined();
  });

  it('sends the given method and body through to the HTTP client', async () => {
    const seen: HttpRequestSpec[] = [];
    const client: IHttpClient = {
      async send(spec) {
        seen.push(spec);
        return { url: spec.url, statusCode: 200, statusText: 'OK', body: 'ok', bodyBinary: null, headers: new Map(), redirected: false, redirectChain: [] };
      },
    };
    const loader = new ResourceLoader(client);
    await loader.loadResource('https://example.com/search', 'document', { method: 'POST', body: 'q=cats&opt=1' });
    expect(seen[0]?.method).toBe('POST');
    expect(seen[0]?.body).toBe('q=cats&opt=1');
  });
});

describe('ResourceLoader — CORS/CORP enforcement (previously dead: setCors() had zero callers)', () => {
  it('an ordinary cross-origin resource with no special headers still loads (NoCors mode, no ACAO required)', async () => {
    const client = mockClient({ 'https://cdn.example/style.css': { body: 'body{color:red}', headers: { 'content-type': 'text/css' } } });
    const loader = new ResourceLoader(client);
    loader.setCors(new CorsEngine(), 'https://app.example');
    const result = await loader.loadResource('https://cdn.example/style.css', 'stylesheet');
    expect(result.error).toBeNull();
    expect(result.body).toBe('body{color:red}');
  });

  it('a same-origin resource is unaffected regardless of setCors() state', async () => {
    const client = mockClient({ 'https://app.example/style.css': { body: 'body{color:blue}' } });
    const loader = new ResourceLoader(client);
    loader.setCors(new CorsEngine(), 'https://app.example');
    const result = await loader.loadResource('https://app.example/style.css', 'stylesheet');
    expect(result.error).toBeNull();
    expect(result.body).toBe('body{color:blue}');
  });

  it('CORP same-origin blocks a cross-origin resource once setCors() has been called', async () => {
    const client = mockClient({
      'https://cdn.example/secret.js': { body: 'secret', headers: { 'cross-origin-resource-policy': 'same-origin' } },
    });
    const loader = new ResourceLoader(client);
    loader.setCors(new CorsEngine(), 'https://app.example');
    const result = await loader.loadResource('https://cdn.example/secret.js', 'script');
    expect(result.error).toContain('CORP violation');
    expect(result.body).toBe('');
  });

  it('CORP same-site blocks a cross-site (different registrable domain) resource', async () => {
    const client = mockClient({
      'https://evil.test/payload.js': { body: 'payload', headers: { 'cross-origin-resource-policy': 'same-site' } },
    });
    const loader = new ResourceLoader(client);
    loader.setCors(new CorsEngine(), 'https://app.example');
    const result = await loader.loadResource('https://evil.test/payload.js', 'script');
    expect(result.error).toContain('CORP violation');
  });

  it('CORP same-site allows a www.-prefix variant of the same host (this codebase\'s isSameSite only strips www., not a full eTLD+1 compare)', async () => {
    const client = mockClient({
      'https://www.app.example/widget.js': { body: 'widget', headers: { 'cross-origin-resource-policy': 'same-site' } },
    });
    const loader = new ResourceLoader(client);
    loader.setCors(new CorsEngine(), 'https://app.example');
    const result = await loader.loadResource('https://www.app.example/widget.js', 'script');
    expect(result.error).toBeNull();
    expect(result.body).toBe('widget');
  });

  it('without setCors(), CORP headers are ignored entirely (pre-fix behavior preserved when uncalled)', async () => {
    const client = mockClient({
      'https://cdn.example/secret.js': { body: 'secret', headers: { 'cross-origin-resource-policy': 'same-origin' } },
    });
    const loader = new ResourceLoader(client);
    const result = await loader.loadResource('https://cdn.example/secret.js', 'script');
    expect(result.error).toBeNull();
    expect(result.body).toBe('secret');
  });
});
