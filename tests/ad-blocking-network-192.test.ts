/**
 * 1.92: the ad blocker only checked the address of the page being opened, so the ads inside pages
 * (scripts, images, iframes, fetch/XHR to ad networks) always loaded.
 */
import { describe, expect, it, vi } from 'vitest';
import { AdBlocker, adHidingCss, installNetworkAdBlocking } from '../src/browser/security/ad-blocker';
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
});
