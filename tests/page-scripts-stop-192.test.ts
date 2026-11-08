/**
 * 1.92: a page's scripts kept running after the user navigated away (until the next page's own
 * scripts started). On the tablet, CNN's timers navigated GitHub and Netflix to CNN article paths
 * and kept the engine busy, so a page typed in the address bar took over a minute to start.
 */
import { describe, expect, it, vi } from 'vitest';
import { NavigationController } from '../src/browser/navigation/navigation-controller';
import { UrlParser } from '../src/browser/navigation/url-parser';
import { Router } from '../src/browser/navigation/router';
import { BrowserEngine } from '../src/browser/engine/browser-engine';
import type { IPageLoader, PageLoadResult } from '../src/browser/engine/browser-engine';
import { DEFAULT_CONFIG } from '../src/app/app-shell';
import { DomTree } from '../src/browser/rendering/dom-tree';
import { HtmlParser } from '../src/browser/rendering/html-parser';
import { CssParser } from '../src/browser/rendering/css-parser';
import { LayoutEngine } from '../src/browser/rendering/layout-engine';
import { PaintEngine } from '../src/browser/rendering/paint-engine';
import { PageRenderer } from '../src/browser/engine/page-renderer';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('leaving a page stops its scripts', () => {
  it('the engine stops the shown page\'s scripts as soon as a new navigation commits', async () => {
    const loader: IPageLoader = {
      async load(url): Promise<PageLoadResult> {
        if (url.includes('slow')) await new Promise(() => {}); // the next page is still downloading
        return { url, statusCode: 200, contentType: 'text/html', body: '<html><body>x</body></html>', headers: new Map(), loadedAt: Date.now() };
      },
    };
    const nav = new NavigationController(new UrlParser());
    const engine = new BrowserEngine(nav, new Router(), DEFAULT_CONFIG);
    engine.setPageLoader(loader);
    const stopPageScripts = vi.fn();
    engine.setPageRenderer({ render: async () => {}, getLayoutEngine: () => null, stopPageScripts });
    await engine.initialize();
    await nav.navigate('https://a.test/');
    await sleep(0);
    stopPageScripts.mockClear();
    await nav.navigate('https://slow.test/');
    expect(stopPageScripts).toHaveBeenCalledTimes(1); // before the slow page has arrived
    await engine.shutdown();
  });

  // 1.93: a timer was queued after the loop asked the host for a pump, so a page whose only async
  // work was setTimeout/setInterval never ran it (the host saw nothing due and slept).
  it('a lone setInterval on a page runs while it is shown, and never after it is stopped', async () => {
    const domTree = new DomTree();
    const r = new PageRenderer({ htmlParser: new HtmlParser(), domTree, cssParser: new CssParser(), layoutEngine: new LayoutEngine(), paintEngine: new PaintEngine(), svgDecode: async () => null,
      resourceLoader: { loadResource: vi.fn(), loadBatch: vi.fn(), loadStylesheet: vi.fn().mockResolvedValue(''), loadScript: vi.fn().mockResolvedValue(''), loadImage: vi.fn(), getPriority: vi.fn(), setMaxConcurrent: vi.fn(), on: vi.fn(), off: vi.fn(), dispose: vi.fn() },
      prioritizer: { submit: vi.fn(), submitBatch: vi.fn(), submitPreload: vi.fn(), submitPrefetch: vi.fn(), submitPreconnect: vi.fn(), clear: vi.fn(), dispose: vi.fn() } } as never);
    r.setViewport(400, 300, 1);
    const body = `<html><body><p id="c"></p><script>
      var n = 0; setInterval(function () { n++; document.getElementById('c').setAttribute('data-n', String(n)); }, 5);
    </script></body></html>`;
    await r.render({ url: 'http://t.local/', statusCode: 200, contentType: 'text/html', headers: new Map(), loadedAt: 0, body } as never, new AbortController().signal);
    const ticks = () => Number(domTree.getElementById('c')!.attributes.get('data-n') ?? 0);
    await sleep(100);
    expect(ticks()).toBeGreaterThan(1);
    r.stopPageScripts();
    const at = ticks();
    await sleep(80);
    expect(ticks()).toBe(at);
    r.dispose();
  });

  // 1.94: each external script was downloaded only after the previous one had arrived.
  it('external scripts download in parallel (once per URL) and still run in document order', async () => {
    const started: string[] = [];
    const release: Array<() => void> = [];
    const loadScript = vi.fn((url: string) => {
      started.push(url);
      return new Promise<string>((res) => release.push(() => res(`var e = document.getElementById('o'); e.setAttribute('data-r', (e.getAttribute('data-r') || '') + '${url.slice(-4)}');`)));
    });
    const domTree = new DomTree();
    const r = new PageRenderer({ htmlParser: new HtmlParser(), domTree, cssParser: new CssParser(), layoutEngine: new LayoutEngine(), paintEngine: new PaintEngine(), svgDecode: async () => null,
      resourceLoader: { loadResource: vi.fn(), loadBatch: vi.fn(), loadStylesheet: vi.fn().mockResolvedValue(''), loadScript, loadImage: vi.fn(), getPriority: vi.fn(), setMaxConcurrent: vi.fn(), on: vi.fn(), off: vi.fn(), dispose: vi.fn() },
      prioritizer: { submit: vi.fn(), submitBatch: vi.fn(), submitPreload: vi.fn(), submitPrefetch: vi.fn(), submitPreconnect: vi.fn(), clear: vi.fn(), dispose: vi.fn() } } as never);
    r.setViewport(400, 300, 1);
    const body = '<html><body><p id="o"></p><script src="/a.js"></script><script src="/b.js"></script><script src="/a.js"></script><script src="/c.js"></script></body></html>';
    const done = r.render({ url: 'http://t.local/', statusCode: 200, contentType: 'text/html', headers: new Map(), loadedAt: 0, body } as never, new AbortController().signal);
    await sleep(20);
    expect(started).toEqual(['http://t.local/a.js', 'http://t.local/b.js', 'http://t.local/c.js']); // all at once, a.js once
    for (const go of [...release].reverse()) go(); // they arrive in reverse order
    await done;
    expect(domTree.getElementById('o')!.attributes.get('data-r')).toBe('a.jsb.jsa.jsc.js'); // run in document order
    r.dispose();
  });
});
