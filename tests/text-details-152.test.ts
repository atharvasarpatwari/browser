/**
 * text-overflow: ellipsis, letter-spacing, <sup>/<sub> (all ignored). See
 * doc/2026-10-30-nova-android-1.52-*.md.
 */
import { describe, expect, it, vi } from 'vitest';
import { DomTree } from '../src/browser/rendering/dom-tree';
import { HtmlParser } from '../src/browser/rendering/html-parser';
import { CssParser } from '../src/browser/rendering/css-parser';
import { LayoutEngine } from '../src/browser/rendering/layout-engine';
import { PaintEngine } from '../src/browser/rendering/paint-engine';
import { PageRenderer } from '../src/browser/engine/page-renderer';

async function render(body: string) {
  const domTree = new DomTree();
  const paint = new PaintEngine();
  const r = new PageRenderer({ htmlParser: new HtmlParser(), domTree, cssParser: new CssParser(), layoutEngine: new LayoutEngine(), paintEngine: paint, svgDecode: async () => null,
    resourceLoader: { loadResource: vi.fn(), loadBatch: vi.fn(), loadStylesheet: vi.fn().mockResolvedValue(''), loadScript: vi.fn().mockResolvedValue(''), loadImage: vi.fn(), getPriority: vi.fn(), setMaxConcurrent: vi.fn(), on: vi.fn(), off: vi.fn(), dispose: vi.fn() },
    prioritizer: { submit: vi.fn(), submitBatch: vi.fn(), submitPreload: vi.fn(), submitPrefetch: vi.fn(), submitPreconnect: vi.fn(), clear: vi.fn(), dispose: vi.fn() } } as never);
  r.setViewport(300, 800, 1);
  await r.render({ url: 'http://t.local/', statusCode: 200, contentType: 'text/html', body: `<html><body style="margin:0">${body}</body></html>`, headers: new Map(), loadedAt: 0 } as never, new AbortController().signal);
  r.dispose();
  return { domTree, texts: paint.compositeFrame().filter((c) => c.type === 'fillText').map((c) => ({ t: String(c.params[0]), x: c.params[1] as number, y: c.params[2] as number, w: c.params[3] as number | undefined })) };
}

describe('text-overflow: ellipsis', () => {
  it('the run crossing the edge ends in "…", later runs are dropped, nothing passes the edge', async () => {
    const { texts } = await render('<p style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis;width:60px;margin:0">aaaaaa bbbbbbb ccccccc</p>');
    expect(texts.some((x) => x.t.endsWith('…'))).toBe(true);
    expect(texts.some((x) => x.t === 'ccccccc')).toBe(false);
    for (const x of texts) expect(x.x + (x.w ?? 0)).toBeLessThanOrEqual(60.5);
  });
  it('text that fits is untouched; without overflow:hidden nothing is cut', async () => {
    expect((await render('<p style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis;width:200px">short</p>')).texts.map((x) => x.t)).toEqual(['short']);
    expect((await render('<p style="white-space:nowrap;text-overflow:ellipsis;width:20px">longer words here</p>')).texts.some((x) => x.t.includes('…'))).toBe(false);
  });
});

describe('letter-spacing', () => {
  it('widens the text by the spacing per character, and paints each character at its place', async () => {
    const { domTree, texts } = await render('<span id="a" style="letter-spacing:10px">abc</span><br><span id="b">abc</span>');
    const wa = domTree.getElementById('a')!.layoutBox!.width, wb = domTree.getElementById('b')!.layoutBox!.width;
    expect(wa - wb).toBeCloseTo(30, 0);
    const chars = texts.filter((x) => ['a', 'b', 'c'].includes(x.t));
    expect(chars.length).toBe(3);
    expect(chars[1]!.x - chars[0]!.x).toBeGreaterThan(10);
  });
});

describe('<sup> and <sub>', () => {
  it('are smaller and raised / lowered off the baseline; their children are not shifted twice', async () => {
    const { texts, domTree } = await render('<p>x<sup>2</sup> H<sub>2</sub>O <sup><span>n</span></sup></p>');
    const x = texts.find((t) => t.t === 'x')!;
    const [sup, sub] = texts.filter((t) => t.t === '2');
    expect(sup!.y).toBeLessThan(x.y - 3);
    expect(sub!.y).toBeGreaterThan(x.y + 1);
    const n = texts.find((t) => t.t === 'n')!;
    expect(n.y).toBeCloseTo(sup!.y, 0);
    expect(domTree.getElementsByTagName('sup')[0]!.computedStyle!.get('font-size')).not.toBe(domTree.getElementsByTagName('p')[0]!.computedStyle!.get('font-size'));
  });
});
