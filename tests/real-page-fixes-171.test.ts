/**
 * 1.71: found by rendering the saved real pages (Wikipedia, IANA) through Nova in Node, with the
 * tablet unavailable: auto-width floats took the whole line, and empty inline spans took a line.
 */
import { describe, expect, it, vi } from 'vitest';
import { DomTree } from '../src/browser/rendering/dom-tree';
import { HtmlParser } from '../src/browser/rendering/html-parser';
import { CssParser } from '../src/browser/rendering/css-parser';
import { LayoutEngine } from '../src/browser/rendering/layout-engine';
import { PaintEngine } from '../src/browser/rendering/paint-engine';
import { PageRenderer } from '../src/browser/engine/page-renderer';

async function page(body: string) {
  const domTree = new DomTree(); const layout = new LayoutEngine();
  const r = new PageRenderer({ htmlParser: new HtmlParser(), domTree, cssParser: new CssParser(), layoutEngine: layout, paintEngine: new PaintEngine(), svgDecode: async () => null,
    resourceLoader: { loadResource: vi.fn(), loadBatch: vi.fn(), loadStylesheet: vi.fn().mockResolvedValue(''), loadScript: vi.fn().mockResolvedValue(''), loadImage: vi.fn(), getPriority: vi.fn(), setMaxConcurrent: vi.fn(), on: vi.fn(), off: vi.fn(), dispose: vi.fn() },
    prioritizer: { submit: vi.fn(), submitBatch: vi.fn(), submitPreload: vi.fn(), submitPrefetch: vi.fn(), submitPreconnect: vi.fn(), clear: vi.fn(), dispose: vi.fn() } } as never);
  r.setViewport(600, 760, 1);
  await r.render({ url: 'http://t.local/', statusCode: 200, contentType: 'text/html', headers: new Map(), loadedAt: 0, body: `<html><body style="margin:0">${body}</body></html>` } as never, new AbortController().signal);
  const box = (id: string) => layout.getLayoutBox(domTree.getElementById(id)!.domId)!;
  return { box, r };
}

describe('real-page layout fixes', () => {
  it('auto-width floats shrink to fit, so floated menu items sit in a row', async () => {
    const { box, r } = await page('<div id="n" style="float:right"><ul style="margin:0;padding:0"><li id="a" style="float:left">Domains</li><li id="b" style="float:left">Protocols</li></ul></div>');
    expect(box('a').width).toBeLessThan(100);
    expect(box('b').y).toBe(box('a').y);
    expect(box('b').x).toBeGreaterThan(box('a').x);
    expect(box('n').x + box('n').width).toBeCloseTo(600, 0);
    r.dispose();
  });

  it('an empty inline span or hidden inline takes no line (Wikipedia "As of 2026, …")', async () => {
    const { box, r } = await page('<p id="p" style="margin:0;line-height:20px;width:500px">As of 2026<sup style="display:none">[update]</sup><span></span>, the most used</p>');
    expect(box('p').height).toBe(20);
    r.dispose();
  });
});
