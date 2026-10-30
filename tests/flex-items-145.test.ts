/**
 * Inline flex items lost their text; place-items was never expanded. See
 * doc/2026-10-30-nova-android-1.45-*.md.
 */
import { describe, expect, it, vi } from 'vitest';
import { DomTree } from '../src/browser/rendering/dom-tree';
import { HtmlParser } from '../src/browser/rendering/html-parser';
import { CssParser } from '../src/browser/rendering/css-parser';
import { LayoutEngine } from '../src/browser/rendering/layout-engine';
import { PaintEngine } from '../src/browser/rendering/paint-engine';
import { PageRenderer } from '../src/browser/engine/page-renderer';

async function render(body: string, css = '') {
  const domTree = new DomTree();
  const paint = new PaintEngine();
  const r = new PageRenderer({ htmlParser: new HtmlParser(), domTree, cssParser: new CssParser(), layoutEngine: new LayoutEngine(), paintEngine: paint, svgDecode: async () => null,
    resourceLoader: { loadResource: vi.fn(), loadBatch: vi.fn(), loadStylesheet: vi.fn().mockResolvedValue(''), loadScript: vi.fn().mockResolvedValue(''), loadImage: vi.fn(), getPriority: vi.fn(), setMaxConcurrent: vi.fn(), on: vi.fn(), off: vi.fn(), dispose: vi.fn() },
    prioritizer: { submit: vi.fn(), submitBatch: vi.fn(), submitPreload: vi.fn(), submitPrefetch: vi.fn(), submitPreconnect: vi.fn(), clear: vi.fn(), dispose: vi.fn() } } as never);
  r.setViewport(424, 800, 1);
  await r.render({ url: 'http://t.local/', statusCode: 200, contentType: 'text/html', body: `<html><head><style>body{margin:0}${css}</style></head><body>${body}</body></html>`, headers: new Map(), loadedAt: 0 } as never, new AbortController().signal);
  r.dispose();
  return { domTree, texts: paint.compositeFrame().filter((c) => c.type === 'fillText').map((c) => [String(c.params[0]), c.params[1] as number, c.params[2] as number] as const) };
}

describe('inline flex items keep their text (the brand name on httpforever was blank)', () => {
  it('a <span> in a flex or inline-flex container paints its text', async () => {
    for (const body of ['<div style="display:flex"><span id="s">Hello</span></div>', '<span style="display:inline-flex"><svg width="10" height="10"></svg><span id="s">HTTP&nbsp;Forever</span></span>']) {
      const { texts, domTree } = await render(body);
      const s = domTree.getElementById('s')!.layoutBox!;
      const t = texts.find(([w]) => /Hello|Forever/.test(w))!;
      expect(t).toBeDefined();
      expect(t[1]).toBeGreaterThanOrEqual(s.x - 0.5);
    }
  });

  it('a vertically centred item carries its content with it', async () => {
    const { texts, domTree } = await render('<div style="display:flex;align-items:center;height:100px"><div id="i"><b>mid</b></div></div>');
    const box = domTree.getElementById('i')!.layoutBox!;
    expect(box.y).toBeGreaterThan(30);
    const t = texts.find(([w]) => w === 'mid')!;
    expect(t[2]).toBeGreaterThan(box.y);
    expect(t[2]).toBeLessThan(box.y + box.height + 1);
  });
});

describe('place-items / place-content / place-self', () => {
  it('expand to align-* and justify-* (one value means both)', async () => {
    const { domTree } = await render('<div id="a" style="display:grid;place-items:center"></div><div id="b" style="place-content:start end"></div><div id="c" style="place-self:end"></div>');
    const st = (id: string) => domTree.getElementById(id)!.computedStyle!;
    expect([st('a').get('align-items'), st('a').get('justify-items')]).toEqual(['center', 'center']);
    expect([st('b').get('align-content'), st('b').get('justify-content')]).toEqual(['start', 'end']);
    expect([st('c').get('align-self'), st('c').get('justify-self')]).toEqual(['end', 'end']);
  });

  it('a grid item with place-items: center is centred horizontally', async () => {
    const { domTree } = await render('<div style="display:grid;place-items:center;width:100px;height:40px"><svg id="i" width="20" height="20"></svg></div>');
    expect(domTree.getElementById('i')!.layoutBox!.x).toBeCloseTo(40, 0);
  });
});
