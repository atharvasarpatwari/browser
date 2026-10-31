/**
 * Found on the OPPO tablet with 1.54 (httpforever.com): the hero wave sat over the URL pill (absolute
 * boxes used the content box, not the padding box) and stayed a rectangle, and white streaks ran
 * across the top of the page (clip-path blanked a sheared strip of the whole buffer).
 * See doc/2026-10-31-nova-android-1.55-*.md.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { DomTree } from '../src/browser/rendering/dom-tree';
import { HtmlParser } from '../src/browser/rendering/html-parser';
import { CssParser } from '../src/browser/rendering/css-parser';
import { LayoutEngine } from '../src/browser/rendering/layout-engine';
import { PaintEngine } from '../src/browser/rendering/paint-engine';
import type { PaintCommand } from '../src/browser/rendering/paint-engine';
import { PageRenderer } from '../src/browser/engine/page-renderer';
import { Rasterizer } from '../src/browser/rendering/rasterizer';

async function render(html: string, css = '', js = '', width = 400) {
  const domTree = new DomTree();
  const paint = new PaintEngine();
  const r = new PageRenderer({ htmlParser: new HtmlParser(), domTree, cssParser: new CssParser(), layoutEngine: new LayoutEngine(), paintEngine: paint, svgDecode: async () => null,
    resourceLoader: { loadResource: vi.fn(), loadBatch: vi.fn(), loadStylesheet: vi.fn().mockResolvedValue(css), loadScript: vi.fn().mockResolvedValue(js), loadImage: vi.fn(), getPriority: vi.fn(), setMaxConcurrent: vi.fn(), on: vi.fn(), off: vi.fn(), dispose: vi.fn() },
    prioritizer: { submit: vi.fn(), submitBatch: vi.fn(), submitPreload: vi.fn(), submitPrefetch: vi.fn(), submitPreconnect: vi.fn(), clear: vi.fn(), dispose: vi.fn() } } as never);
  r.setViewport(width, 700, 1);
  await r.render({ url: 'http://t.local/', statusCode: 200, contentType: 'text/html', body: html, headers: new Map(), loadedAt: 0 } as never, new AbortController().signal);
  r.dispose();
  return { domTree, paint };
}

describe('absolute boxes use the padding box', () => {
  it('left/right/bottom: 0 reach the padding edges, not the content edges', async () => {
    const { domTree } = await render('<html><body style="margin:0"><div id="p" style="position:relative;padding:20px 30px 40px;border:2px solid #000;height:100px"><div id="a" style="position:absolute;left:0;right:0;bottom:0;height:10px"></div></div></body></html>');
    const p = domTree.getElementById('p')!.layoutBox!, a = domTree.getElementById('a')!.layoutBox!;
    expect(a.x).toBe(p.x + 2);
    expect(a.width).toBe(p.width - 4);
    expect(a.y + a.height).toBeCloseTo(p.y + p.height - 2, 0);
  });

  it("httpforever's wave sits at the hero's bottom edge, full width, below the URL pill", async () => {
    const F = 'tests/fixtures/httpforever-2026/';
    const { domTree } = await render(readFileSync(F + 'index.html', 'utf8'), readFileSync(F + 'style.css', 'utf8'), readFileSync(F + 'theme.js', 'utf8'), 1070);
    const byClass = (c: string) => { let hit: { layoutBox: { x: number; y: number; width: number; height: number } } | null = null; const w = (n: { attributes?: Map<string, string>; children?: unknown[] }) => { if (hit) return; if ((n.attributes?.get('class') ?? '').split(' ').includes(c)) hit = n as never; for (const k of (n.children ?? []) as never[]) w(k); }; w(domTree.getElementsByTagName('html')[0] as never); return hit!.layoutBox; };
    const hero = byClass('hero'), wave = byClass('hero__wave'), url = byClass('hero__url');
    expect(wave.width).toBe(hero.width);
    expect(wave.y + wave.height).toBeCloseTo(hero.y + hero.height + 1, 0);
    expect(wave.y).toBeGreaterThan(url.y + url.height); // it covered the pill
  });
});

describe('clip-path shapes only its element', () => {
  const cmd = (type: string, ...params: unknown[]) => ({ type, params }) as PaintCommand;
  it('ellipse: corners keep what was under the element; nothing outside the element changes', () => {
    const img = new Rasterizer({ width: 100, height: 60, backgroundColor: 'white' }).rasterize([
      cmd('setFillStyle', '#00ff00'), cmd('fillRect', 0, 0, 100, 60),
      cmd('beginClipShape', 10, 20, 80, 40),
      cmd('setFillStyle', '#000000'), cmd('fillRect', 10, 20, 80, 40),
      cmd('applyClipShape', { type: 'ellipse', rx: 75, ry: 100, rxPct: true, ryPct: true, cx: 0.5, cy: 1 }, 10, 20, 80, 40),
    ]);
    const g = (x: number, y: number) => img.data[(y * 100 + x) * 4 + 1]!;
    expect(g(12, 22)).toBe(255);   // top-left corner of the element: outside the ellipse, green kept
    expect(g(50, 55)).toBe(0);     // bottom middle: inside, black
    expect(g(5, 5)).toBe(255);     // outside the element: untouched
    expect(g(95, 2)).toBe(255);    // the top of the page is not blanked (the white streaks)
    expect(img.data[(2 * 100 + 95) * 4 + 3]).toBe(255);
  });

  it('an applyClipShape without its begin (old command streams) changes nothing', () => {
    const img = new Rasterizer({ width: 40, height: 20, backgroundColor: 'white' }).rasterize([
      cmd('setFillStyle', '#ff0000'), cmd('fillRect', 0, 0, 40, 20),
      cmd('applyClipShape', { type: 'circle', r: 5, cx: 0.5, cy: 0.5 }, 0, 0, 10, 10),
    ]);
    expect(Array.from(img.data.slice(0, 4))).toEqual([255, 0, 0, 255]);
  });
});

describe('text-overflow: ellipsis when the crossing run is a space (tablet: no "…" shown)', () => {
  it('the word before the edge takes the ellipsis instead of nothing', async () => {
    const { getTextMeasurer } = await import('../src/browser/rendering/formatting/text-measure');
    const w = Math.ceil(getTextMeasurer().measure('This sentence is far too', 16, 'sans-serif', 'normal').width) + 1;
    const { paint } = await render(`<html><body style="margin:0"><div style="font:16px sans-serif;width:${w}px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">This sentence is far too long for its box</div></body></html>`);
    const texts = paint.compositeFrame().filter((c) => c.type === 'fillText').map((c) => ({ t: String(c.params[0]), x: c.params[1] as number, w: c.params[3] as number }));
    expect(texts.some((x) => x.t.endsWith('…'))).toBe(true);
    expect(texts.some((x) => x.t === 'long')).toBe(false);
    for (const x of texts) expect(x.x + (x.w ?? 0)).toBeLessThanOrEqual(w + 0.5);
  });
});
