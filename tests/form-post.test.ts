/**
 * RC-12: POST forms. They did nothing ("[Forms] POST submission is not supported yet").
 * See doc/2026-10-27-nova-android-1.33-*.md.
 */
import { describe, expect, it } from 'vitest';
import { encodeFormBody } from '../src/ui/pages/browser-window';
import { ResourceLoader } from '../src/browser/networking/resource-loader';
import { CacheManager } from '../src/browser/networking/cache-manager';
import type { IHttpClient, HttpRequestSpec, HttpResponseSpec } from '../src/browser/networking/request-manager';
import { NavigationController, NavigationType } from '../src/browser/navigation/navigation-controller';
import { UrlParser } from '../src/browser/navigation/url-parser';
import { Router } from '../src/browser/navigation/router';
import { BrowserEngine } from '../src/browser/engine/browser-engine';
import type { IPageLoader, PageLoadResult } from '../src/browser/engine/browser-engine';
import { DEFAULT_CONFIG } from '../src/app/app-shell';

const response = (url: string, status: number, body = '', headers: Record<string, string> = {}): HttpResponseSpec => ({
  url, statusCode: status, statusText: '', body, bodyBinary: null, headers: new Map(Object.entries(headers)), redirected: false, redirectChain: [],
});

describe('form body encoding', () => {
  const entries: [string, string][] = [['q', 'a b&c'], ['n', '1']];
  it('urlencoded by default', () => {
    expect(encodeFormBody(entries, '')).toEqual({ body: 'q=a+b%26c&n=1', contentType: 'application/x-www-form-urlencoded' });
  });
  it('multipart/form-data with a boundary', () => {
    const { body, contentType } = encodeFormBody(entries, 'multipart/form-data');
    const boundary = /boundary=(.+)$/.exec(contentType)![1]!;
    expect(body).toBe(`--${boundary}\r\nContent-Disposition: form-data; name="q"\r\n\r\na b&c\r\n--${boundary}\r\nContent-Disposition: form-data; name="n"\r\n\r\n1\r\n--${boundary}--\r\n`);
  });
  it('text/plain', () => {
    expect(encodeFormBody(entries, 'text/plain')).toEqual({ body: 'q=a b&c\r\nn=1\r\n', contentType: 'text/plain' });
  });
});

describe('ResourceLoader POST', () => {
  const recording = (handler: (spec: HttpRequestSpec) => HttpResponseSpec) => {
    const sent: HttpRequestSpec[] = [];
    const client: IHttpClient = { async send(spec) { sent.push(spec); return handler(spec); } };
    return { client, sent };
  };

  it('sends the method, body and content type, and never caches the response', async () => {
    const { client, sent } = recording((s) => response(s.url, 200, 'thanks', { 'content-type': 'text/html', 'cache-control': 'max-age=3600' }));
    const cache = new CacheManager();
    const loader = new ResourceLoader(client, undefined, undefined, undefined, cache);
    const opts = { method: 'POST', body: 'a=1', contentType: 'application/x-www-form-urlencoded' } as const;
    await loader.loadResource('https://ex.com/submit', 'document', opts);
    await loader.loadResource('https://ex.com/submit', 'document', opts);
    expect(sent).toHaveLength(2); // not served from cache
    expect(sent[0]!.method).toBe('POST');
    expect(sent[0]!.body).toBe('a=1');
    expect(sent[0]!.headers.get('content-type')).toBe('application/x-www-form-urlencoded');
    expect(await cache.get('https://ex.com/submit')).toBeFalsy();
  });

  it('303 after a POST continues as a GET without the body; 307 repeats the POST', async () => {
    const { client, sent } = recording((s) => s.url.endsWith('/submit')
      ? response(s.url, 303, '', { location: '/done' })
      : s.url.endsWith('/keep') ? response(s.url, 307, '', { location: '/kept' }) : response(s.url, 200, 'ok', { 'content-type': 'text/html' }));
    const loader = new ResourceLoader(client);
    const r = await loader.loadResource('https://ex.com/submit', 'document', { method: 'POST', body: 'a=1', contentType: 'text/plain' });
    expect(r.url).toBe('https://ex.com/done');
    expect(sent[1]!.method).toBe('GET');
    expect(sent[1]!.body).toBeUndefined();
    expect(sent[1]!.headers.has('content-type')).toBe(false);

    sent.length = 0;
    await loader.loadResource('https://ex.com/keep', 'document', { method: 'POST', body: 'b=2', contentType: 'text/plain' });
    expect(sent[1]!.method).toBe('POST');
    expect(sent[1]!.body).toBe('b=2');
  });
});

describe('BrowserEngine with a POST navigation', () => {
  it('sends the form once; going back to the result reuses the response', async () => {
    const calls: { url: string; post?: { body: string } }[] = [];
    const loader: IPageLoader = {
      async load(url, _signal, options): Promise<PageLoadResult> {
        calls.push({ url, post: options?.postData });
        return { url, statusCode: 200, contentType: 'text/html', body: `<html><body>${options?.postData ? 'result' : 'page'}</body></html>`, headers: new Map(), loadedAt: Date.now() };
      },
    };
    const nav = new NavigationController(new UrlParser());
    const engine = new BrowserEngine(nav, new Router(), DEFAULT_CONFIG);
    engine.setPageLoader(loader);
    await engine.initialize();
    const ready = () => new Promise<void>((res) => { const h = () => { engine.off('pageLoadReady', h); res(); }; engine.on('pageLoadReady', h); });

    let r = ready();
    await nav.navigateTo({ url: 'https://ex.com/order', type: NavigationType.Push, userInitiated: true, postData: { body: 'item=1', contentType: 'application/x-www-form-urlencoded' } });
    await r;
    r = ready();
    await nav.navigate('https://ex.com/next');
    await r;
    r = ready();
    nav.back();
    await r;

    const posts = calls.filter((c) => c.post);
    expect(posts).toHaveLength(1); // not resubmitted on back
    expect(posts[0]!.post!.body).toBe('item=1');
    expect(calls).toHaveLength(2);
    await engine.shutdown();
  });
});
