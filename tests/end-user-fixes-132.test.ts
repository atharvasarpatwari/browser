/**
 * End-user fixes from doc/2026-10-21-nova-android-1.26-end-user-test-results.md, round 1.32:
 * RC-4 http:// upgrade with fallback, RC-9 tabs restored, RC-14 smooth image scaling, RC-17 dark mode.
 */
import { describe, expect, it, vi, afterEach } from 'vitest';
import { SecurityLayer } from '../src/browser/media/security-layer';
import { NavigationController } from '../src/browser/navigation/navigation-controller';
import { UrlParser } from '../src/browser/navigation/url-parser';
import { BrowserWindowPage } from '../src/ui/pages/browser-window';
import { Rasterizer } from '../src/browser/rendering/rasterizer';
import type { PaintCommand } from '../src/browser/rendering/paint-engine';
import { setPreferredColorScheme } from '../src/browser/rendering/color-scheme';
import { PageRenderer } from '../src/browser/engine/page-renderer';
import { HtmlParser } from '../src/browser/rendering/html-parser';
import { DomTree } from '../src/browser/rendering/dom-tree';
import { CssParser } from '../src/browser/rendering/css-parser';
import { LayoutEngine } from '../src/browser/rendering/layout-engine';
import { PaintEngine } from '../src/browser/rendering/paint-engine';
import { runJS } from '../src/browser/js/index';

describe('RC-4: http:// navigations', () => {
  it('load over https:// instead of doing nothing', async () => {
    const layer = new SecurityLayer();
    const nav = new NavigationController(new UrlParser());
    nav.addGuard(layer.navigationGuard);
    const result = await nav.navigate('http://example.com/page');
    expect(result.success).toBe(true);
    expect(nav.getCurrentEntry()?.url).toBe('https://example.com/page');
  });

  it('fall back to http:// for the host when the https load fails; HSTS hosts never fall back', async () => {
    const layer = new SecurityLayer();
    const nav = new NavigationController(new UrlParser());
    nav.addGuard(layer.navigationGuard);
    await nav.navigate('http://neverssl.example/');
    expect(layer.fallbackToHttp('https://neverssl.example/')).toBe('http://neverssl.example/');
    expect(layer.checkNavigation('http://neverssl.example/other').allowed).toBe(true);
    await nav.navigate('http://neverssl.example/other');
    expect(nav.getCurrentEntry()?.url).toBe('http://neverssl.example/other');

    await nav.navigate('http://google.com/'); // HSTS preloaded
    expect(nav.getCurrentEntry()?.url).toBe('https://google.com/');
    expect(layer.fallbackToHttp('https://google.com/')).toBeNull();
  });
});

describe('RC-9: open tabs survive a restart', () => {
  let container: HTMLElement | undefined;
  afterEach(() => { container?.remove(); localStorage.clear(); });

  it('restores the tabs and the active one after remounting', async () => {
    localStorage.clear();
    container = document.createElement('div');
    document.body.appendChild(container);
    const first = new BrowserWindowPage({ hideChromeUI: true });
    await first.mount(container);
    first.createTab('https://a.example/');
    const b = first.createTab('https://b.example/');
    first.createTab('https://c.example/');
    first.activateTabExternal(b);
    (first as unknown as { tabPersistence: { saveNow(): void } }).tabPersistence.saveNow();
    const before = first.getChromeState();
    await first.unmount?.();

    const second = new BrowserWindowPage({ hideChromeUI: true });
    await second.mount(container);
    const after = second.getChromeState();
    expect(after.tabs.map((t) => t.url)).toEqual(before.tabs.map((t) => t.url));
    expect(after.tabs.find((t) => t.id === after.activeTabId)?.url).toBe('https://b.example/');
    await second.unmount?.();
  });

  it('does not save tabs while incognito', async () => {
    localStorage.clear();
    container = document.createElement('div');
    document.body.appendChild(container);
    const page = new BrowserWindowPage({ hideChromeUI: true });
    await page.mount(container);
    page.setIncognitoExternal(true);
    page.createTab('https://secret.example/');
    (page as unknown as { tabPersistence: { saveNow(): void } }).tabPersistence.saveNow();
    expect(localStorage.getItem('nova-tab-persistence') ?? '').not.toContain('secret.example');
    await page.unmount?.();
  });
});

describe('RC-14: shrunk images are averaged, not aliased', () => {
  it('a 1-pixel black/white checkerboard shrunk 4× comes out mid-grey', () => {
    const size = 8;
    const data = new Uint8ClampedArray(size * size * 4);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const v = (x + y) % 2 === 0 ? 0 : 255;
        data.set([v, v, v, 255], (y * size + x) * 4);
      }
    }
    const r = new Rasterizer({ width: 2, height: 2, backgroundColor: 'transparent' });
    const img = r.rasterize([{ type: 'drawImage', params: [{ data, width: size, height: size }, 0, 0, 2, 2] } as PaintCommand]);
    for (let i = 0; i < 4; i++) {
      expect(Math.abs(img.data[i * 4]! - 128)).toBeLessThanOrEqual(2);
      expect(img.data[i * 4 + 3]).toBe(255);
    }
  });

  it('transparent pixels do not darken the average', () => {
    const data = new Uint8ClampedArray([255, 0, 0, 255, 0, 0, 0, 0, 255, 0, 0, 255, 0, 0, 0, 0]); // red / transparent
    const r = new Rasterizer({ width: 1, height: 1, backgroundColor: 'transparent' });
    const img = r.rasterize([{ type: 'drawImage', params: [{ data, width: 2, height: 2 }, 0, 0, 1, 1] } as PaintCommand]);
    expect(img.data[0]).toBeGreaterThan(250); // pure red, half coverage
    expect(Math.abs(img.data[3]! - 128)).toBeLessThanOrEqual(2);
  });
});

describe('RC-17: pages follow the dark-mode setting', () => {
  afterEach(() => setPreferredColorScheme('light'));

  const render = async (html: string) => {
    const domTree = new DomTree();
    const renderer = new PageRenderer({ htmlParser: new HtmlParser(), domTree, cssParser: new CssParser(), layoutEngine: new LayoutEngine(), paintEngine: new PaintEngine(),
      resourceLoader: { loadResource: vi.fn(), loadBatch: vi.fn(), loadStylesheet: vi.fn().mockResolvedValue(''), loadScript: vi.fn().mockResolvedValue(''), loadImage: vi.fn(), getPriority: vi.fn(), setMaxConcurrent: vi.fn(), on: vi.fn(), off: vi.fn(), dispose: vi.fn() },
      prioritizer: { submit: vi.fn(), submitBatch: vi.fn(), submitPreload: vi.fn(), submitPrefetch: vi.fn(), submitPreconnect: vi.fn(), clear: vi.fn(), dispose: vi.fn() } } as never);
    renderer.setViewport(424, 800, 1);
    await renderer.render({ url: 'https://example.com/', statusCode: 200, contentType: 'text/html', body: html, headers: new Map(), loadedAt: 0 } as never, new AbortController().signal);
    renderer.dispose();
    return domTree;
  };
  const page = '<html><head><style>:root{color-scheme:light dark} #a{color:light-dark(#111111,#eeeeee)} @media (prefers-color-scheme: dark){ #b{color:#ff0000} }</style></head><body><p id="a">a</p><p id="b">b</p></body></html>';

  it('light-dark() and prefers-color-scheme use the dark values when the phone is dark', async () => {
    setPreferredColorScheme('dark');
    const dark = await render(page);
    expect(dark.getElementById('a')?.computedStyle?.get('color')).toMatch(/eeeeee|238, ?238, ?238/i);
    expect(dark.getElementById('b')?.computedStyle?.get('color')).toMatch(/ff0000|255, ?0, ?0/i);

    setPreferredColorScheme('light');
    const light = await render(page);
    expect(light.getElementById('a')?.computedStyle?.get('color')).toMatch(/111111|17, ?17, ?17/i);
    expect(light.getElementById('b')?.computedStyle?.get('color')).not.toMatch(/ff0000|255, ?0, ?0/i);
  });

  it('page scripts see the same preference through matchMedia', () => {
    setPreferredColorScheme('dark');
    const domTree = new DomTree();
    const doc = domTree.buildFromHtml((new HtmlParser().parse('<html><body></body></html>') as unknown as { document: never }).document);
    const r = runJS('matchMedia("(prefers-color-scheme: dark)").matches', { document: doc, domTree } as never);
    expect(r.value).toBe(true);
  });
});
