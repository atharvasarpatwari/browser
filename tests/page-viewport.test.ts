/**
 * PageRenderer.setViewport: the Android shell lays pages out at the phone's size
 * instead of a 1920-wide desktop page shrunk to fit (unreadable, no mobile @media).
 */
import { describe, expect, it, vi } from 'vitest';
import { PageRenderer } from '../src/browser/engine/page-renderer';
import type { PageRendererDependencies } from '../src/browser/engine/page-renderer';
import { HtmlParser } from '../src/browser/rendering/html-parser';
import { DomTree } from '../src/browser/rendering/dom-tree';
import { CssParser } from '../src/browser/rendering/css-parser';
import { LayoutEngine } from '../src/browser/rendering/layout-engine';
import { PaintEngine } from '../src/browser/rendering/paint-engine';

function makeRenderer() {
  const domTree = new DomTree();
  const layoutEngine = new LayoutEngine();
  const paintEngine = new PaintEngine();
  const onFrameRendered = vi.fn();
  const renderer = new PageRenderer({
    htmlParser: new HtmlParser(),
    domTree,
    cssParser: new CssParser(),
    layoutEngine,
    paintEngine,
    resourceLoader: {
      loadResource: vi.fn(), loadBatch: vi.fn(), loadStylesheet: vi.fn().mockResolvedValue(''), loadScript: vi.fn().mockResolvedValue(''),
      loadImage: vi.fn(), getPriority: vi.fn(), setMaxConcurrent: vi.fn(), on: vi.fn(), off: vi.fn(), dispose: vi.fn(),
    },
    prioritizer: { submit: vi.fn(), submitBatch: vi.fn(), submitPreload: vi.fn(), submitPrefetch: vi.fn(), submitPreconnect: vi.fn(), clear: vi.fn(), dispose: vi.fn() },
    onFrameRendered,
  } as unknown as PageRendererDependencies);
  return { renderer, domTree, layoutEngine, paintEngine, onFrameRendered };
}

const PAGE = `<html><head><style>
  p { color: rgb(0, 0, 255); }
  @media (max-width: 600px) { p { color: rgb(255, 0, 0); } }
</style></head><body><p id="t">Hello</p></body></html>`;

const load = (url = 'https://example.com/') => ({
  url, statusCode: 200, contentType: 'text/html', body: PAGE, headers: new Map([['content-type', 'text/html']]), loadedAt: Date.now(),
});

const colorOf = (domTree: DomTree) => (domTree.getElementById('t')?.computedStyle as Map<string, string> | undefined)?.get('color');

describe('PageRenderer.setViewport', () => {
  it('keeps the 1920x1080 desktop default, so desktop @media rules apply', async () => {
    const { renderer, domTree } = makeRenderer();
    await renderer.render(load(), new AbortController().signal);
    expect(renderer.getViewport()).toEqual({ width: 1920, height: 1080 });
    expect(colorOf(domTree)).toBe('rgb(0, 0, 255)');
  });

  it('lays the page out at the phone width: layout, paint (with DPR) and mobile @media rules', async () => {
    const { renderer, domTree, layoutEngine, paintEngine } = makeRenderer();
    renderer.setViewport(412, 800, 2.5);
    await renderer.render(load(), new AbortController().signal);
    expect(layoutEngine.getConfig()).toMatchObject({ viewportWidth: 412, viewportHeight: 800 });
    expect(paintEngine.getConfig()).toMatchObject({ width: 412, height: 800, devicePixelRatio: 2.5 });
    expect(colorOf(domTree)).toBe('rgb(255, 0, 0)');
    const body = domTree.getDocument()?.bodyElement;
    expect(body?.layoutBox?.width).toBeLessThanOrEqual(412);
  });

  it('re-lays out the current page when the size changes (e.g. rotation), and ignores no-op calls', async () => {
    const { renderer, domTree, onFrameRendered } = makeRenderer();
    await renderer.render(load(), new AbortController().signal);
    expect(colorOf(domTree)).toBe('rgb(0, 0, 255)');
    onFrameRendered.mockClear();
    renderer.setViewport(400, 800, 2);
    expect(colorOf(domTree)).toBe('rgb(255, 0, 0)');
    expect(onFrameRendered).toHaveBeenCalledTimes(1);
    renderer.setViewport(400, 800, 2);
    expect(onFrameRendered).toHaveBeenCalledTimes(1);
  });
});
