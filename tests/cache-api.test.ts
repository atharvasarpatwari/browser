import { describe, it, expect, vi } from 'vitest';
import { Interpreter } from '../src/browser/js/interpreter';
import { Environment } from '../src/browser/js/values';
import { EventLoop } from '../src/browser/js/event-loop';
import { Lexer } from '../src/browser/js/lexer';
import { Parser } from '../src/browser/js/parser';
import { createCacheStorage } from '../src/browser/js/cache-api';
import { createHeadersClass, createResponseClass, createRequestClass } from '../src/browser/js/fetch-api';

function createTestEnv(mockFetch?: any) {
  const eventLoop = new EventLoop();
  const interp = new Interpreter(undefined, eventLoop);
  const env = (interp as any).globalEnv as Environment;
  env.setLocal('Headers', createHeadersClass(eventLoop));
  env.setLocal('Response', createResponseClass(eventLoop));
  env.setLocal('Request', createRequestClass(eventLoop));
  env.setLocal('caches', createCacheStorage(eventLoop, mockFetch));
  return { interp, env, eventLoop };
}

async function flushAll(el: EventLoop) {
  let consecutiveEmpty = 0;
  for (let i = 0; i < 50 && consecutiveEmpty < 5; i++) {
    await new Promise<void>(r => setTimeout(r, 5));
    el.drainMicrotasks();
    consecutiveEmpty = el.microtaskCount === 0 ? consecutiveEmpty + 1 : 0;
  }
}

async function run(source: string, mockFetch?: any) {
  const { interp, env, eventLoop } = createTestEnv(mockFetch);
  const lexer = new Lexer(source);
  const parser = new Parser([], lexer);
  const program = parser.parse();
  interp.run(program);
  await flushAll(eventLoop);
  return { env, eventLoop };
}

function mockResp(body: string, init?: { status?: number; url?: string }) {
  return {
    ok: (init?.status ?? 200) >= 200 && (init?.status ?? 200) < 300,
    status: init?.status ?? 200,
    statusText: 'OK',
    url: init?.url ?? '',
    redirected: false,
    type: 'basic',
    headers: { forEach: (cb: (v: string, k: string) => void) => cb('text/plain', 'content-type') },
    text: async () => body,
  };
}

describe('Cache API (window.caches)', () => {
  it('put + match round-trips a real Response body, status, and headers', async () => {
    const { env } = await run(`
      var status, body, contentType;
      var done = false;
      caches.open('v1').then(function (cache) {
        var res = new Response('hello cache', { status: 201, headers: { 'Content-Type': 'text/plain' } });
        return cache.put('/greeting', res).then(function () {
          return cache.match('/greeting');
        });
      }).then(function (hit) {
        status = hit.status;
        contentType = hit.headers.get('content-type');
        return hit.text();
      }).then(function (text) {
        body = text;
        done = true;
      });
    `);
    expect(env.get('done')).toBe(true);
    expect(env.get('status')).toBe(201);
    expect(env.get('contentType')).toBe('text/plain');
    expect(env.get('body')).toBe('hello cache');
  });

  it('match returns undefined for a URL never cached', async () => {
    const { env } = await run(`
      var result = 'not set';
      caches.open('v1').then(function (cache) {
        return cache.match('/never-cached');
      }).then(function (hit) { result = hit; });
    `);
    expect(env.get('result')).toBeUndefined();
  });

  it('a cached response can be read more than once (each match() gives a fresh, unconsumed Response)', async () => {
    const { env } = await run(`
      var first, second;
      caches.open('v1').then(function (cache) {
        return cache.put('/x', new Response('data')).then(function () {
          return cache.match('/x');
        });
      }).then(function (hit1) {
        return hit1.text().then(function (t) { first = t; return caches.open('v1'); });
      }).then(function (cache) {
        return cache.match('/x');
      }).then(function (hit2) {
        return hit2.text();
      }).then(function (t) { second = t; });
    `);
    expect(env.get('first')).toBe('data');
    expect(env.get('second')).toBe('data');
  });

  it('delete removes a cached entry; caches.match searches across all named caches', async () => {
    const { env } = await run(`
      var foundBeforeDelete, foundAfterDelete, foundViaGlobalMatch;
      var cacheRef;
      caches.open('assets').then(function (cache) {
        cacheRef = cache;
        return cache.put('/app.js', new Response('console.log(1)'));
      }).then(function () {
        return caches.match('/app.js');
      }).then(function (hit) {
        foundViaGlobalMatch = !!hit;
        return cacheRef.match('/app.js');
      }).then(function (hit) {
        foundBeforeDelete = !!hit;
        return cacheRef.delete('/app.js');
      }).then(function () {
        return cacheRef.match('/app.js');
      }).then(function (hit) {
        foundAfterDelete = !!hit;
      });
    `);
    expect(env.get('foundViaGlobalMatch')).toBe(true);
    expect(env.get('foundBeforeDelete')).toBe(true);
    expect(env.get('foundAfterDelete')).toBe(false);
  });

  it('keys() lists cached URLs, and caches.keys() lists cache names', async () => {
    const { env } = await run(`
      var entryUrls, cacheNames;
      caches.open('v1').then(function (cache) {
        return cache.put('/a', new Response('a')).then(function () {
          return cache.put('/b', new Response('b'));
        }).then(function () { return cache.keys(); });
      }).then(function (keys) {
        entryUrls = keys.map(function (r) { return r.url; }).sort().join(',');
        return caches.keys();
      }).then(function (names) {
        cacheNames = names.join(',');
      });
    `);
    expect(env.get('entryUrls')).toBe('/a,/b');
    expect(env.get('cacheNames')).toBe('v1');
  });

  it('add() fetches a real URL through the platform fetch and stores the result', async () => {
    const fetchMock = vi.fn(async (url: string) => mockResp('fetched: ' + url, { url }));
    const { env } = await run(`
      var body;
      caches.open('v1').then(function (cache) {
        return cache.add('/from-network').then(function () {
          return cache.match('/from-network');
        });
      }).then(function (hit) { return hit.text(); })
        .then(function (t) { body = t; });
    `, fetchMock);
    expect(fetchMock).toHaveBeenCalledWith('/from-network');
    expect(env.get('body')).toBe('fetched: /from-network');
  });

  it('put rejects when the second argument is not a Response', async () => {
    const { env } = await run(`
      var errorMessage = null;
      caches.open('v1').then(function (cache) {
        return cache.put('/bad', 'not a response');
      }).catch(function (err) { errorMessage = String(err); });
    `);
    expect(env.get('errorMessage')).toMatch(/must be a Response/);
  });
});
