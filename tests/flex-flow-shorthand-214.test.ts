/**
 * 2.14: `flex-flow` was never expanded into flex-direction / flex-wrap, so `body { flex-flow: column wrap }`
 * laid its children out as a row (the ad-block test page's content ended up in an off-screen column on the realme tablet).
 */
import { expect, it, vi } from 'vitest';
import { DomTree } from '../src/browser/rendering/dom-tree';
import { HtmlParser } from '../src/browser/rendering/html-parser';
import { CssParser } from '../src/browser/rendering/css-parser';
import { LayoutEngine } from '../src/browser/rendering/layout-engine';
import { PaintEngine } from '../src/browser/rendering/paint-engine';
import { PageRenderer } from '../src/browser/engine/page-renderer';

async function layout(bodyCss: string) {
  const domTree = new DomTree();
  const r = new PageRenderer({ htmlParser: new HtmlParser(), domTree, cssParser: new CssParser(), layoutEngine: new LayoutEngine(), paintEngine: new PaintEngine(), svgDecode: async () => null,
    resourceLoader: { loadResource: vi.fn(), loadBatch: vi.fn(), loadStylesheet: vi.fn().mockResolvedValue(''), loadScript: vi.fn().mockResolvedValue(''), loadImage: vi.fn(), getPriority: vi.fn(), setMaxConcurrent: vi.fn(), on: vi.fn(), off: vi.fn(), dispose: vi.fn() },
    prioritizer: { submit: vi.fn(), submitBatch: vi.fn(), submitPreload: vi.fn(), submitPrefetch: vi.fn(), submitPreconnect: vi.fn(), clear: vi.fn(), dispose: vi.fn() }, userStylesheet: () => '' } as never);
  r.setViewport(424, 822, 1);
  await r.render({ url: 'http://t.local/', statusCode: 200, contentType: 'text/html', headers: new Map(), loadedAt: 0,
    body: `<html><head><style>html,body{margin:0}body{display:flex;${bodyCss}}</style></head><body><header style="height:81px">h</header><main><div style="height:966px">m</div></main></body></html>` } as never, new AbortController().signal);
  const box = (s: string) => (domTree.querySelector(s) as any).layoutBox as { x: number; y: number; width: number; height: number };
  const out = { header: box('header'), main: box('main'), style: (domTree.querySelector('body') as any).computedStyle as Map<string, string> };
  r.dispose();
  return out;
}

it('flex-flow: column wrap stacks the children in one column', async () => {
  const { header, main, style } = await layout('flex-flow:column wrap;min-height:100vh');
  expect(style.get('flex-direction')).toBe('column');
  expect(style.get('flex-wrap')).toBe('wrap');
  expect(header).toMatchObject({ x: 0, y: 0, width: 424 });
  expect(main).toMatchObject({ x: 0, y: 81, width: 424, height: 966 });
});

it('flex-flow takes its two parts in either order', async () => {
  const { style } = await layout('flex-flow:wrap-reverse column-reverse');
  expect(style.get('flex-direction')).toBe('column-reverse');
  expect(style.get('flex-wrap')).toBe('wrap-reverse');
});
