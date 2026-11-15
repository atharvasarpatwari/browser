/**
 * 2.17: a page's lazy image loader kept running after the next navigation committed, so the left page's images
 * queued ahead of the new page's document fetch (BBC then GitHub: GitHub never loaded on the Pad).
 * stopPageScripts() (called on commit) must dispose that loader.
 */
import { expect, it, vi } from 'vitest';
import { DomTree } from '../src/browser/rendering/dom-tree';
import { HtmlParser } from '../src/browser/rendering/html-parser';
import { CssParser } from '../src/browser/rendering/css-parser';
import { LayoutEngine } from '../src/browser/rendering/layout-engine';
import { PaintEngine } from '../src/browser/rendering/paint-engine';
import { PageRenderer } from '../src/browser/engine/page-renderer';
import { LazyLoader } from '../src/browser/rendering/lazy-loader';

it('stopping the page disposes its lazy loader, so a left page loads no more images', async () => {
  const dispose = vi.spyOn(LazyLoader.prototype, 'dispose');
  const domTree = new DomTree();
  const r = new PageRenderer({ htmlParser: new HtmlParser(), domTree, cssParser: new CssParser(), layoutEngine: new LayoutEngine(), paintEngine: new PaintEngine(), svgDecode: async () => null,
    resourceLoader: { loadResource: vi.fn(), loadBatch: vi.fn(), loadStylesheet: vi.fn().mockResolvedValue(''), loadScript: vi.fn().mockResolvedValue(''), loadImage: vi.fn(), getPriority: vi.fn(), setMaxConcurrent: vi.fn(), on: vi.fn(), off: vi.fn(), dispose: vi.fn() },
    prioritizer: { submit: vi.fn(), submitBatch: vi.fn(), submitPreload: vi.fn(), submitPrefetch: vi.fn(), submitPreconnect: vi.fn(), clear: vi.fn(), dispose: vi.fn() },
    userStylesheet: () => '' } as never);
  r.setViewport(400, 600, 1);
  const imgs = Array.from({ length: 5 }, (_, i) => `<img src="/p${i}.png" width="10" height="10">`).join('');
  await r.render({ url: 'http://t.local/a', statusCode: 200, contentType: 'text/html', headers: new Map(), loadedAt: 0,
    body: `<html><body>${imgs}</body></html>` } as never, new AbortController().signal);
  expect((r as unknown as { lazyLoader: unknown }).lazyLoader).not.toBeNull();
  dispose.mockClear();
  r.stopPageScripts();
  expect(dispose).toHaveBeenCalled();
  expect((r as unknown as { lazyLoader: unknown }).lazyLoader).toBeNull();
  r.dispose();
  dispose.mockRestore();
});
