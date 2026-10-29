/**
 * Positioned boxes with no inset on an axis stay at their static position (they were centred in
 * their containing block). See doc/2026-10-30-nova-android-1.40-*.md.
 */
import { describe, expect, it, vi } from 'vitest';
import { DomTree } from '../src/browser/rendering/dom-tree';
import { HtmlParser } from '../src/browser/rendering/html-parser';
import { CssParser } from '../src/browser/rendering/css-parser';
import { LayoutEngine } from '../src/browser/rendering/layout-engine';
import { PaintEngine } from '../src/browser/rendering/paint-engine';
import { PageRenderer } from '../src/browser/engine/page-renderer';

async function render(html: string, css = '', js = '', width = 424) {
  const domTree = new DomTree();
  const renderer = new PageRenderer({ htmlParser: new HtmlParser(), domTree, cssParser: new CssParser(), layoutEngine: new LayoutEngine(), paintEngine: new PaintEngine(),
    resourceLoader: { loadResource: vi.fn(), loadBatch: vi.fn(), loadStylesheet: vi.fn().mockResolvedValue(css), loadScript: vi.fn().mockResolvedValue(js), loadImage: vi.fn(), getPriority: vi.fn(), setMaxConcurrent: vi.fn(), on: vi.fn(), off: vi.fn(), dispose: vi.fn() },
    prioritizer: { submit: vi.fn(), submitBatch: vi.fn(), submitPreload: vi.fn(), submitPrefetch: vi.fn(), submitPreconnect: vi.fn(), clear: vi.fn(), dispose: vi.fn() } } as never);
  renderer.setViewport(width, 900, 1);
  await renderer.render({ url: 'http://test.local/', statusCode: 200, contentType: 'text/html', body: html, headers: new Map(), loadedAt: 0 } as never, new AbortController().signal);
  renderer.dispose();
  return domTree;
}
const boxOf = (t: DomTree, id: string) => (t.getElementById(id) as unknown as { layoutBox: { x: number; y: number; width: number; height: number } }).layoutBox;

describe('static position', () => {
  it('a dropdown with only top: 100% sits under its button, at the left of its parent', async () => {
    const t = await render('<html><body style="margin:0"><div style="height:200px"></div><nav id="n" style="position:relative;margin-left:30px;height:40px"><ul id="m" style="position:absolute;top:100%;margin:0;padding:0;list-style:none"><li>One</li><li>Two</li></ul></nav><div style="height:900px"></div></body></html>');
    const m = boxOf(t, 'm');
    expect(m.x).toBe(30);
    expect(m.y).toBeCloseTo(240, 0);
    expect(m.width).toBeLessThan(100); // shrink-to-fit, not the page width
  });

  it('no insets at all: the box starts where it would have been in flow, children with it', async () => {
    const t = await render('<html><body style="margin:0"><div style="height:120px"></div><div id="p" style="position:relative;height:600px"><div style="height:50px"></div><div id="a" style="position:absolute"><div id="c" style="height:20px">x</div></div></div></body></html>');
    expect(boxOf(t, 'a').y).toBeCloseTo(170, 0);
    expect(boxOf(t, 'c').y).toBeCloseTo(170, 0);
    expect(boxOf(t, 'a').x).toBe(0);
  });

  it('left set, top auto: keeps its static y', async () => {
    const t = await render('<html><body style="margin:0"><div style="height:80px"></div><div id="a" style="position:absolute;left:15px">tip</div><div style="height:900px"></div></body></html>');
    expect(boxOf(t, 'a').x).toBe(15);
    expect(boxOf(t, 'a').y).toBeCloseTo(80, 0);
  });
});

describe('line breaking keeps punctuation with its word (found on the phone, 1.40)', () => {
  it('segments: "exist?" and "screen." stay whole; spaces are separate segments', async () => {
    const { segmentText, findBreakOpportunities } = await import('../src/browser/rendering/formatting/line-break');
    expect(segmentText('Why does this site exist?').map((s) => s.text)).toEqual(['Why', ' ', 'does', ' ', 'this', ' ', 'site', ' ', 'exist?']);
    expect(segmentText('the login screen.').map((s) => s.text)).toEqual(['the', ' ', 'login', ' ', 'screen.']);
    expect(segmentText("it's 3.5% (yes), a-b").map((s) => s.text)).toEqual(["it's", ' ', '3.5%', ' ', '(yes),', ' ', 'a-', 'b']);
    expect(findBreakOpportunities('( x').map((o) => o.index)).toEqual([0, 3]); // no break after "( "
    expect(segmentText('该域名').map((s) => s.text)).toEqual(['该', '域', '名']);
  });
});

describe('position: fixed stays on screen while the page scrolls (found on the phone, 1.40)', () => {
  it('is drawn at its viewport position after scrolling, and a tap there hits it', async () => {
    const domTree = new DomTree();
    const paint = new PaintEngine({ width: 200, height: 300 });
    const layout = new LayoutEngine();
    const renderer = new PageRenderer({ htmlParser: new HtmlParser(), domTree, cssParser: new CssParser(), layoutEngine: layout, paintEngine: paint,
      resourceLoader: { loadResource: vi.fn(), loadBatch: vi.fn(), loadStylesheet: vi.fn().mockResolvedValue(''), loadScript: vi.fn().mockResolvedValue(''), loadImage: vi.fn(), getPriority: vi.fn(), setMaxConcurrent: vi.fn(), on: vi.fn(), off: vi.fn(), dispose: vi.fn() },
      prioritizer: { submit: vi.fn(), submitBatch: vi.fn(), submitPreload: vi.fn(), submitPrefetch: vi.fn(), submitPreconnect: vi.fn(), clear: vi.fn(), dispose: vi.fn() } } as never);
    renderer.setViewport(200, 300, 1);
    const html = '<html><body style="margin:0;background:#fff"><div id="bar" style="position:fixed;top:0;left:0;width:200px;height:40px;background:#ff0000"></div><div style="height:3000px;background:#00ff00"></div></body></html>';
    await renderer.render({ url: 'http://test.local/', statusCode: 200, contentType: 'text/html', body: html, headers: new Map(), loadedAt: 0 } as never, new AbortController().signal);
    const px = (img: ImageData, x: number, y: number) => [img.data[(y * img.width + x) * 4], img.data[(y * img.width + x) * 4 + 1]];
    expect(px(paint.rasterize(), 100, 20)).toEqual([255, 0]);
    paint.setScroll(1000);
    const scrolled = paint.rasterize();
    expect(px(scrolled, 100, 20)).toEqual([255, 0]);  // still there (it scrolled away)
    expect(px(scrolled, 100, 200)).toEqual([0, 255]); // the page under it scrolled
    const bar = domTree.getElementById('bar');
    expect(layout.getElementAtPoint(100, 1020, 1000)).toBe(bar);
    expect(layout.getElementAtPoint(100, 1020, 1000)).not.toBe(null);
    expect(layout.getElementAtPoint(100, 20, 1000)).not.toBe(bar); // its old page position is page content now
    renderer.dispose();
  });
});
