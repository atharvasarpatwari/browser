/**
 * Auto table columns size to their content (CSS 2.2 §17.5.2.2); they were shared equally
 * whatever they held. See doc/2026-10-30-nova-android-1.49-*.md.
 */
import { describe, expect, it, vi } from 'vitest';
import { DomTree } from '../src/browser/rendering/dom-tree';
import { HtmlParser } from '../src/browser/rendering/html-parser';
import { CssParser } from '../src/browser/rendering/css-parser';
import { LayoutEngine } from '../src/browser/rendering/layout-engine';
import { PaintEngine } from '../src/browser/rendering/paint-engine';
import { PageRenderer } from '../src/browser/engine/page-renderer';

async function render(body: string, width = 424) {
  const domTree = new DomTree();
  const r = new PageRenderer({ htmlParser: new HtmlParser(), domTree, cssParser: new CssParser(), layoutEngine: new LayoutEngine(), paintEngine: new PaintEngine(), svgDecode: async () => null,
    resourceLoader: { loadResource: vi.fn(), loadBatch: vi.fn(), loadStylesheet: vi.fn().mockResolvedValue(''), loadScript: vi.fn().mockResolvedValue(''), loadImage: vi.fn(), getPriority: vi.fn(), setMaxConcurrent: vi.fn(), on: vi.fn(), off: vi.fn(), dispose: vi.fn() },
    prioritizer: { submit: vi.fn(), submitBatch: vi.fn(), submitPreload: vi.fn(), submitPrefetch: vi.fn(), submitPreconnect: vi.fn(), clear: vi.fn(), dispose: vi.fn() } } as never);
  r.setViewport(width, 800, 1);
  await r.render({ url: 'http://t.local/', statusCode: 200, contentType: 'text/html', body: `<html><head><style>body{margin:0}</style></head><body>${body}</body></html>`, headers: new Map(), loadedAt: 0 } as never, new AbortController().signal);
  r.dispose();
  const w = (id: string) => domTree.getElementById(id)!.layoutBox!.width;
  return { domTree, w };
}

describe('auto table layout', () => {
  it('a small table shrinks to its content instead of spanning the page', async () => {
    const { w } = await render('<table id="t"><tr><td id="a">1</td><td id="b">2</td></tr></table>');
    expect(w('t')).toBeLessThan(100);
    expect(w('a')).toBeLessThan(40);
  });

  it('an infobox: the short label column stays narrow, the long value column gets the rest', async () => {
    const long = 'Safari, Chrome, Firefox, Edge, Opera, Samsung Internet and many other web browsers for phones';
    const { w } = await render(`<table id="t"><tr><th id="l">Type</th><td id="v">${long}</td></tr><tr><th>Released</th><td>1990</td></tr></table>`);
    expect(w('t')).toBeLessThanOrEqual(424);
    expect(w('l')).toBeLessThan(w('v') / 2);  // was a 50/50 split
    expect(w('l')).toBeGreaterThan(30);        // still fits "Released"
  });

  it('explicit widths still win, and a width: 100% table still fills the line', async () => {
    const { w } = await render('<table id="t" style="width:100%"><tr><td id="a" style="width:100px">a</td><td id="b">b</td></tr></table>');
    expect(w('t')).toBeGreaterThan(400);
    expect(w('a')).toBeGreaterThanOrEqual(100);
  });
});
