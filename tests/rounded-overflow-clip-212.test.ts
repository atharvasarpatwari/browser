/**
 * 2.12: `overflow:hidden` with `border-radius` clipped children to a square (round avatars, the
 * ad-block test's gauge drew its liquid as a box).
 */
import { expect, it, vi } from 'vitest';
import { Rasterizer } from '../src/browser/rendering/rasterizer';
import { PaintEngine } from '../src/browser/rendering/paint-engine';
import { HtmlParser } from '../src/browser/rendering/html-parser';
import { DomTree } from '../src/browser/rendering/dom-tree';
import { CssParser } from '../src/browser/rendering/css-parser';
import { LayoutEngine } from '../src/browser/rendering/layout-engine';
import { PageRenderer } from '../src/browser/engine/page-renderer';

async function render(body: string) {
  const paint = new PaintEngine();
  const renderer = new PageRenderer({ htmlParser: new HtmlParser(), domTree: new DomTree(), cssParser: new CssParser(), layoutEngine: new LayoutEngine(), paintEngine: paint,
    resourceLoader: { loadResource: vi.fn(), loadBatch: vi.fn(), loadStylesheet: vi.fn().mockResolvedValue(''), loadScript: vi.fn().mockResolvedValue(''), loadImage: vi.fn(), getPriority: vi.fn(), setMaxConcurrent: vi.fn(), on: vi.fn(), off: vi.fn(), dispose: vi.fn() },
    prioritizer: { submit: vi.fn(), submitBatch: vi.fn(), submitPreload: vi.fn(), submitPrefetch: vi.fn(), submitPreconnect: vi.fn(), clear: vi.fn(), dispose: vi.fn() } } as never);
  renderer.setViewport(100, 100, 1);
  await renderer.render({ url: 'https://example.com/', statusCode: 200, contentType: 'text/html',
    body: `<html><body style="margin:0;background:transparent">${body}</body></html>`, headers: new Map(), loadedAt: 0 } as never, new AbortController().signal);
  renderer.dispose();
  const img = new Rasterizer({ width: 100, height: 100, backgroundColor: 'transparent' }).rasterize(paint.compositeFrame());
  return (x: number, y: number) => { const i = (y * 100 + x) * 4; return img.data[i]! > 200 && img.data[i + 1]! < 60 && img.data[i + 3]! > 200; };
}

it('a square child of a round overflow:hidden box is cut to the circle', async () => {
  const red = await render('<div style="width:40px;height:40px;border-radius:50%;overflow:hidden"><div style="width:40px;height:40px;background:#ff0000"></div></div>');
  expect(red(20, 20)).toBe(true);
  expect(red(1, 1)).toBe(false);
  expect(red(38, 38)).toBe(false);
});

it('without overflow:hidden the child is not clipped', async () => {
  const red = await render('<div style="width:40px;height:40px;border-radius:50%"><div style="width:40px;height:40px;background:#ff0000"></div></div>');
  expect(red(1, 1)).toBe(true);
});
