/**
 * 1.92: the ad blocker only checked the address of the page being opened, so the ads inside pages
 * (scripts, images, iframes, fetch/XHR to ad networks) always loaded.
 */
import { describe, expect, it, vi } from 'vitest';
import { AdBlocker, adHidingCss, installNetworkAdBlocking, SITE_HIDING_SELECTORS } from '../src/browser/security/ad-blocker';
import { DomTree } from '../src/browser/rendering/dom-tree';
import { HtmlParser } from '../src/browser/rendering/html-parser';
import { CssParser } from '../src/browser/rendering/css-parser';
import { LayoutEngine } from '../src/browser/rendering/layout-engine';
import { PaintEngine } from '../src/browser/rendering/paint-engine';
import { PageRenderer } from '../src/browser/engine/page-renderer';

const ok = () => Promise.resolve(new Response('ok'));

describe('network ad blocking', () => {
  it('fails requests to ad networks and lets the rest through', async () => {
    const target = { fetch: vi.fn(ok) as unknown as typeof fetch };
    const pageFetch = vi.fn();
    installNetworkAdBlocking(new AdBlocker(), pageFetch, target);
    await expect(target.fetch('https://securepubads.g.doubleclick.net/tag/js/gpt.js')).rejects.toThrow(/ad blocker/);
    await expect(target.fetch(new URL('https://pagead2.googlesyndication.com/pagead/show_ads.js'))).rejects.toThrow(TypeError);
    await expect(target.fetch('https://en.wikipedia.org/wiki/Main_Page')).resolves.toBeInstanceOf(Response);
    expect(pageFetch).toHaveBeenCalledWith(target.fetch); // page fetch() goes through the same check
  });

  it('turning the blocker off lets ads through; uninstalling restores fetch', async () => {
    const base = vi.fn(ok) as unknown as typeof fetch;
    const target = { fetch: base };
    const blocker = new AdBlocker();
    const uninstall = installNetworkAdBlocking(blocker, undefined, target);
    blocker.setEnabled(false);
    await expect(target.fetch('https://securepubads.g.doubleclick.net/tag/js/gpt.js')).resolves.toBeInstanceOf(Response);
    uninstall();
    expect(target.fetch).toBe(base);
  });

  it('ad slots are hidden on the page; the rest of the page is not', async () => {
    const blocker = new AdBlocker();
    const domTree = new DomTree(); const layout = new LayoutEngine();
    const r = new PageRenderer({ htmlParser: new HtmlParser(), domTree, cssParser: new CssParser(), layoutEngine: layout, paintEngine: new PaintEngine(), svgDecode: async () => null,
      resourceLoader: { loadResource: vi.fn(), loadBatch: vi.fn(), loadStylesheet: vi.fn().mockResolvedValue(''), loadScript: vi.fn().mockResolvedValue(''), loadImage: vi.fn(), getPriority: vi.fn(), setMaxConcurrent: vi.fn(), on: vi.fn(), off: vi.fn(), dispose: vi.fn() },
      prioritizer: { submit: vi.fn(), submitBatch: vi.fn(), submitPreload: vi.fn(), submitPrefetch: vi.fn(), submitPreconnect: vi.fn(), clear: vi.fn(), dispose: vi.fn() },
      userStylesheet: () => adHidingCss(blocker) } as never);
    r.setViewport(400, 600, 1);
    const body = `<html><body style="margin:0">
      <ins id="ad" class="adsbygoogle" style="display:block;height:250px" data-ad-client="ca-pub-1"></ins>
      <iframe id="fr" src="https://tpc.googlesyndication.com/x" style="height:90px"></iframe>
      <div id="thread_1" class="Header banner" style="height:40px">real content</div></body></html>`;
    const render = () => r.render({ url: 'http://t.local/', statusCode: 200, contentType: 'text/html', headers: new Map(), loadedAt: 0, body } as never, new AbortController().signal);
    await render();
    const cs = (id: string) => domTree.getElementById(id)!.computedStyle?.get('display');
    expect(cs('ad')).toBe('none');
    expect(cs('fr')).toBe('none');
    expect(cs('thread_1')).toBe('block'); // broad patterns like [id*="ad_"] / [class*="banner"] are not used
    blocker.setEnabled(false);
    await render();
    expect(cs('ad')).toBe('block');
    r.dispose();
  });

  // 1.94: sponsored search results are served inside the results page, so only hiding removes them.
  it('sponsored search results are hidden on Google, Bing and DuckDuckGo; organic results stay', async () => {
    const blocker = new AdBlocker();
    const domTree = new DomTree();
    const r = new PageRenderer({ htmlParser: new HtmlParser(), domTree, cssParser: new CssParser(), layoutEngine: new LayoutEngine(), paintEngine: new PaintEngine(), svgDecode: async () => null,
      resourceLoader: { loadResource: vi.fn(), loadBatch: vi.fn(), loadStylesheet: vi.fn().mockResolvedValue(''), loadScript: vi.fn().mockResolvedValue(''), loadImage: vi.fn(), getPriority: vi.fn(), setMaxConcurrent: vi.fn(), on: vi.fn(), off: vi.fn(), dispose: vi.fn() },
      prioritizer: { submit: vi.fn(), submitBatch: vi.fn(), submitPreload: vi.fn(), submitPrefetch: vi.fn(), submitPreconnect: vi.fn(), clear: vi.fn(), dispose: vi.fn() },
      userStylesheet: (url: string) => adHidingCss(blocker, url) } as never);
    r.setViewport(400, 800, 1);
    const cs = (id: string) => domTree.getElementById(id)!.computedStyle?.get('display');
    const page = (url: string, body: string) => r.render({ url, statusCode: 200, contentType: 'text/html', headers: new Map(), loadedAt: 0, body: `<html><body>${body}</body></html>` } as never, new AbortController().signal);

    await page('https://www.google.co.in/search?q=shoes', '<div id="tads"><div id="g-ad">Sponsored</div></div><div id="g-org" class="g">result</div>');
    expect(cs('tads')).toBe('none');
    expect(cs('g-org')).toBe('block');
    await page('https://www.bing.com/search?q=shoes', '<ol id="b_results"><li id="b-ad" class="b_ad">ad</li><li id="b-org" class="b_algo">result</li></ol>');
    expect(cs('b-ad')).toBe('none');
    expect(cs('b-org')).not.toBe('none');
    await page('https://duckduckgo.com/?q=shoes', '<div id="d-ad" class="result result--ad">ad</div><div id="d-org" class="result">result</div>');
    expect(cs('d-ad')).toBe('none');
    expect(cs('d-org')).toBe('block');
    // Site selectors stay on their site: a news page with class "ads" or id "tads" is not touched.
    await page('https://news.example/', '<div id="tads">tads</div><div id="x" class="ads">x</div>');
    expect(cs('tads')).toBe('block');
    expect(SITE_HIDING_SELECTORS.length).toBeGreaterThan(3);
    r.dispose();
  });

  it('search ad click-through links are blocked', () => {
    const b = new AdBlocker();
    expect(b.shouldBlock('https://www.google.com/aclk?sa=l&ai=abc').blocked).toBe(true);
    expect(b.shouldBlock('https://www.bing.com/aclk?ld=e8').blocked).toBe(true);
    expect(b.shouldBlock('https://duckduckgo.com/y.js?ad_domain=shoes.example').blocked).toBe(true);
    expect(b.shouldBlock('https://www.google.com/search?q=shoes').blocked).toBe(false);
  });

  // 1.99: per-tab counts. The wrapper reports what it stopped and which list stopped it.
  it('reports ad-list and tracker-list stops with their kind', async () => {
    const target = { fetch: vi.fn(ok) as unknown as typeof fetch };
    const seen: string[] = [];
    const trackers = { shouldBlock: (u: string) => u.includes('analytics.example') ? { blocked: true, category: 'analytics' }
      : u.includes('adserver.example') ? { blocked: true, category: 'ad' } : { blocked: false } };
    installNetworkAdBlocking(new AdBlocker(), undefined, target, { trackers, onBlocked: (k, _u, byList) => seen.push(`${k}:${byList}`) });
    await expect(target.fetch('https://securepubads.g.doubleclick.net/gpt.js')).rejects.toThrow(/ad blocker/);
    await expect(target.fetch('https://analytics.example/collect')).rejects.toThrow(/tracker blocker/); // page beacons are blocked too
    await expect(target.fetch('https://adserver.example/x')).rejects.toThrow(/ad blocker/);
    await expect(target.fetch('https://example.org/')).resolves.toBeInstanceOf(Response);
    expect(seen).toEqual(['ad:false', 'tracker:true', 'ad:true']);
  });
});
