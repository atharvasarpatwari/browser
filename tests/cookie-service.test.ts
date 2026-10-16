import { afterEach, describe, expect, it, vi } from 'vitest';
import { CookieJar } from '../src/browser/networking/cookie-jar';
import {
  CookieAwareHttpClient,
  CookieService,
  setScriptCookieProvider,
  type KeyValueStorage,
} from '../src/browser/networking/cookie-service';
import type { HttpRequestSpec, HttpResponseSpec, IHttpClient } from '../src/browser/networking/request-manager';
import { RawSocketHttpClient } from '../src/browser/networking/raw-socket-http-client';
import { HtmlParser } from '../src/browser/rendering/html-parser';
import { DomTree } from '../src/browser/rendering/dom-tree';
import { runJS } from '../src/browser/js/index';

const SITE = 'https://shop.test/account/login';

function memoryStorage(): KeyValueStorage & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => { data.set(k, v); } };
}

function response(url: string, statusCode: number, setCookies: string[], extra: Record<string, string> = {}): HttpResponseSpec {
  return {
    url, statusCode, statusText: '', body: '', bodyBinary: null, redirected: false, redirectChain: [],
    headers: new Map(Object.entries(extra)), setCookies,
  };
}

describe('CookieJar — document.cookie API', () => {
  it('hides HttpOnly cookies from scripts and refuses HttpOnly writes', () => {
    const jar = new CookieJar();
    jar.setFromResponse(SITE, ['sid=secret; Path=/; HttpOnly', 'theme=dark; Path=/']);
    expect(jar.getScriptCookieString(SITE)).toBe('theme=dark');
    expect(jar.getCookieHeader(SITE)).toContain('sid=secret');

    expect(jar.setFromScript(SITE, 'evil=1; HttpOnly')).toBe(false);
    expect(jar.setFromScript(SITE, 'sid=stolen; Path=/')).toBe(false); // can't overwrite an HttpOnly cookie
    expect(jar.getCookieHeader(SITE)).toContain('sid=secret');

    expect(jar.setFromScript(SITE, 'lang=en; Path=/')).toBe(true);
    expect(jar.getScriptCookieString(SITE)).toBe('theme=dark; lang=en');
  });

  it('uses the RFC 6265 default-path (request directory) when Path is absent', () => {
    const jar = new CookieJar();
    jar.setFromResponse('https://shop.test/app/login', ['a=1']);
    expect(jar.getCookieHeader('https://shop.test/app/cart')).toBe('a=1');
    expect(jar.getCookieHeader('https://shop.test/other')).toBe('');
  });

  it('serialize/restore keeps persistent cookies and drops session ones', () => {
    const jar = new CookieJar();
    jar.setFromResponse(SITE, ['keep=1; Max-Age=3600; Path=/', 'session=1; Path=/']);
    const copy = new CookieJar();
    expect(copy.restore(jar.serialize())).toBe(1);
    expect(copy.getCookieHeader(SITE)).toBe('keep=1');
    expect(copy.restore('not json')).toBe(0);
  });
});

describe('CookieService', () => {
  afterEach(() => vi.useRealTimers());

  it('persists the normal jar (debounced) and restores it on the next launch', () => {
    vi.useFakeTimers();
    const storage = memoryStorage();
    const first = new CookieService(storage);
    first.jar.setFromResponse(SITE, ['login=yes; Max-Age=86400; Path=/']);
    expect(storage.data.size).toBe(0);
    vi.advanceTimersByTime(600);
    expect(new CookieService(storage).jar.getCookieHeader(SITE)).toBe('login=yes');
  });

  it('gives each incognito session its own empty, unsaved jar', () => {
    const storage = memoryStorage();
    const svc = new CookieService(storage);
    svc.jar.setFromResponse(SITE, ['login=normal; Max-Age=86400; Path=/']);
    svc.setIncognito(true);
    expect(svc.jar.getCookieHeader(SITE)).toBe('');
    svc.jar.setFromResponse(SITE, ['login=private; Max-Age=86400; Path=/']);
    svc.flush();
    svc.setIncognito(false);
    expect(svc.jar.getCookieHeader(SITE)).toBe('login=normal');
    expect(storage.data.get('nova-cookie-jar')).not.toContain('private');
    svc.setIncognito(true);
    expect(svc.jar.getCookieHeader(SITE)).toBe('');
  });
});

describe('CookieAwareHttpClient', () => {
  function fakeServer(handler: (req: HttpRequestSpec) => HttpResponseSpec): IHttpClient & { seen: HttpRequestSpec[] } {
    const seen: HttpRequestSpec[] = [];
    return { seen, send: async (req) => { seen.push(req); return handler(req); } };
  }
  const get = (url: string, headers: Record<string, string> = {}): HttpRequestSpec =>
    ({ url, method: 'GET', headers: new Map(Object.entries(headers)), timeoutMs: 1000 });

  it('keeps cookies set on a redirect hop and sends them on the next request', async () => {
    const inner = fakeServer((req) => req.url.endsWith('/login')
      ? response(req.url, 302, ['sid=abc; Path=/', 'csrf=t; Path=/'], { location: '/home' })
      : response(req.url, 200, []));
    const client = new CookieAwareHttpClient(inner, new CookieService());
    const signal = new AbortController().signal;
    await client.send(get('https://shop.test/login'), signal);
    await client.send(get('https://shop.test/home'), signal);
    expect(inner.seen[0]!.headers.has('cookie')).toBe(false);
    expect(inner.seen[1]!.headers.get('cookie')).toBe('sid=abc; csrf=t');
  });

  it('never overrides a Cookie header the caller set itself', async () => {
    const inner = fakeServer((req) => response(req.url, 200, ['sid=abc; Path=/']));
    const client = new CookieAwareHttpClient(inner, new CookieService());
    const signal = new AbortController().signal;
    await client.send(get('https://shop.test/a'), signal);
    await client.send(get('https://shop.test/b', { Cookie: 'manual=1' }), signal);
    expect(inner.seen[1]!.headers.get('Cookie')).toBe('manual=1');
    expect(inner.seen[1]!.headers.has('cookie')).toBe(false);
  });
});

describe('RawSocketHttpClient response parsing', () => {
  it('keeps every Set-Cookie line (the headers Map keeps only the last)', async () => {
    const raw = new TextEncoder().encode([
      'HTTP/1.1 200 OK',
      'Set-Cookie: a=1; Path=/',
      'Set-Cookie: b=2; Expires=Wed, 21 Oct 2026 07:28:00 GMT; Path=/',
      'Set-Cookie: c=3; HttpOnly',
      'Content-Length: 0',
      '', '',
    ].join('\r\n'));
    const client = new RawSocketHttpClient({});
    const res = await (client as unknown as { parseHttpResponse(r: Uint8Array, u: string): Promise<HttpResponseSpec> })
      .parseHttpResponse(raw, 'https://shop.test/');
    expect(res.setCookies).toEqual(['a=1; Path=/', 'b=2; Expires=Wed, 21 Oct 2026 07:28:00 GMT; Path=/', 'c=3; HttpOnly']);
  });
});

describe('document.cookie binding', () => {
  afterEach(() => setScriptCookieProvider(null));

  it('reads and writes through the registered provider, scoped to the page', () => {
    const svc = new CookieService();
    svc.jar.setFromResponse('https://shop.test/', ['sid=secret; Path=/; HttpOnly', 'theme=dark; Path=/']);
    setScriptCookieProvider(svc);
    const domTree = new DomTree();
    const doc = domTree.buildFromHtml(new HtmlParser().parse('<p>hi</p>').document);

    const result = runJS('document.cookie = "lang=en; Path=/"; document.cookie = "x=1; HttpOnly"; document.cookie', {
      document: doc, domTree, pageOrigin: 'https://shop.test',
    });
    expect(result.error).toBeUndefined();
    expect(result.value).toBe('theme=dark; lang=en');
    expect(svc.jar.getCookieHeader('https://shop.test/')).toBe('sid=secret; theme=dark; lang=en');
  });

  it('is an empty string when no provider is installed', () => {
    const domTree = new DomTree();
    const doc = domTree.buildFromHtml(new HtmlParser().parse('<p>hi</p>').document);
    expect(runJS('document.cookie', { document: doc, domTree, pageOrigin: 'https://shop.test' }).value).toBe('');
  });
});
