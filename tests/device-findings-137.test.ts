/**
 * Found testing 1.35/1.36 on the Realme RMX5264 with http://httpforever.com: the first frame took
 * 33 s, the page was veiled grey, the header vanished, the hero painted black and the theme script
 * failed. See doc/2026-10-28-nova-android-1.37-*.md.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { runJS } from '../src/browser/js/index';
import { DomTree } from '../src/browser/rendering/dom-tree';
import { HtmlParser } from '../src/browser/rendering/html-parser';
import { CssParser } from '../src/browser/rendering/css-parser';
import { LayoutEngine } from '../src/browser/rendering/layout-engine';
import { PaintEngine } from '../src/browser/rendering/paint-engine';
import type { PaintCommand } from '../src/browser/rendering/paint-engine';
import { PageRenderer } from '../src/browser/engine/page-renderer';
import { Rasterizer } from '../src/browser/rendering/rasterizer';
import { parseGradient, evaluateGradient } from '../src/browser/rendering/css-gradients';

const run = (src: string) => {
  const domTree = new DomTree();
  const doc = domTree.buildFromHtml((new HtmlParser().parse('<html><body></body></html>') as unknown as { document: never }).document);
  const r = runJS(src, { document: doc, domTree } as never);
  if (r.error) throw new Error('script error: ' + r.error.message);
  return r.value;
};

async function renderFixture(dir: string, width = 424) {
  const domTree = new DomTree();
  const paint = new PaintEngine();
  const renderer = new PageRenderer({ htmlParser: new HtmlParser(), domTree, cssParser: new CssParser(), layoutEngine: new LayoutEngine(), paintEngine: paint,
    resourceLoader: { loadResource: vi.fn(), loadBatch: vi.fn(), loadStylesheet: vi.fn().mockResolvedValue(readFileSync(dir + 'style.css', 'utf8')), loadScript: vi.fn().mockResolvedValue(readFileSync(dir + 'theme.js', 'utf8')), loadImage: vi.fn(), getPriority: vi.fn(), setMaxConcurrent: vi.fn(), on: vi.fn(), off: vi.fn(), dispose: vi.fn() },
    prioritizer: { submit: vi.fn(), submitBatch: vi.fn(), submitPreload: vi.fn(), submitPrefetch: vi.fn(), submitPreconnect: vi.fn(), clear: vi.fn(), dispose: vi.fn() } } as never);
  renderer.setViewport(width, 900, 1);
  const errors: string[] = [];
  const spy = vi.spyOn(console, 'error').mockImplementation((...a: unknown[]) => { errors.push(a.map(String).join(' ')); });
  await renderer.render({ url: 'http://httpforever.com/', statusCode: 200, contentType: 'text/html', body: readFileSync(dir + 'index.html', 'utf8'), headers: new Map(), loadedAt: 0 } as never, new AbortController().signal);
  spy.mockRestore();
  renderer.dispose();
  return { domTree, paint, errors };
}

describe('contextual keywords are ordinary names', () => {
  it('get/set/of/from/as/static/async as variables and functions', () => {
    expect(run('function get(k){ return k; } get(3)')).toBe(3);
    expect(run('function set(k){ return k; } set(4)')).toBe(4);
    expect(run('var of = function(x){ return x; }; of(5)')).toBe(5);
    expect(run('var async = 1, get = 2, set = 3, of = 4, from = 5, as = 6; async + get + set + of + from + as')).toBe(21);
    expect(run('function async(x){ return x * 2; } async(7)')).toBe(14);
  });
  it('async arrows and getters still parse', () => {
    expect(run('var f = async x => x; var g = async (a, b) => a + b; typeof f + typeof g')).toBe('functionfunction');
    expect(run('var o = { get v(){ return 1; }, set v(x){} }; var m = new Map(); m.set("a", 2); o.v + m.get("a")')).toBe(3);
  });
});

describe('the httpforever.com page', () => {
  const F = 'tests/fixtures/httpforever-2026/';

  it('runs its theme script without errors', async () => {
    const { errors } = await renderFixture(F);
    expect(errors.filter((e) => e.includes('[ScriptEngine]'))).toEqual([]);
  });

  it('::before/::after rules do not style the element (the hero stayed in flow at the top)', async () => {
    const { domTree } = await renderFixture(F);
    const header = domTree.getElementsByTagName('header')[0]!;
    expect(header.computedStyle?.get('position')).toBe('relative');
    expect(header.computedStyle?.get('background-image')).toMatch(/^radial-gradient/);
    expect((header as unknown as { layoutBox: { y: number } }).layoutBox.y).toBe(0);
  });

  it('rasterizes a frame quickly (it took 33 s on the phone)', async () => {
    const { paint } = await renderFixture(F);
    const frame = paint.compositeFrame();
    const t0 = performance.now();
    new Rasterizer({ width: 424, height: 2000, backgroundColor: 'white' }).rasterize(frame);
    expect(performance.now() - t0).toBeLessThan(2500);
  }, 30_000);
});

describe('gradients', () => {
  it('hex and rgb stops with positions keep their colours (they parsed as black)', () => {
    const g = parseGradient('linear-gradient(90deg, #2f8f4e 0%, rgb(32, 107, 57) 100%)')!;
    expect(g.stops.map((s) => s.color.g)).toEqual([143, 107]);
    expect(parseGradient('linear-gradient(#fff 0 40%, #000 40%)')!.stops.map((s) => s.offset)).toEqual([0, 0.4, 0.4]);
  });
  it('a radial prelude (size at position) is not read as a colour stop', () => {
    const g = parseGradient('radial-gradient(120% 140% at 50% -20%, #46a35f 0%, #2f8f4e 45%, #206b39 100%)')!;
    expect(g.stops).toHaveLength(3);
    expect(g.position).toEqual({ cx: 0.5, cy: -0.2 });
    const c = evaluateGradient(g, 212, 10, 424, 258);
    expect(c.g).toBeGreaterThan(c.r); // green, not black
  });
});

describe('filters and box shadows stay on their element', () => {
  const cmd = (type: string, ...params: unknown[]) => ({ type, params }) as PaintCommand;

  it('a filter on one element leaves the rest of the page alone', () => {
    const img = new Rasterizer({ width: 40, height: 20, backgroundColor: 'white' }).rasterize([
      cmd('setFillStyle', '#ff0000'), cmd('fillRect', 0, 0, 40, 20),
      cmd('applyFilterList', [{ name: 'grayscale', value: 1 }], 0, 0, 10, 10),
    ]);
    const at = (x: number, y: number) => [img.data[(y * 40 + x) * 4], img.data[(y * 40 + x) * 4 + 1]];
    expect(at(30, 15)).toEqual([255, 0]); // untouched
  });

  it('an outer box-shadow is drawn around the element, not over it', () => {
    const img = new Rasterizer({ width: 60, height: 60, backgroundColor: 'white' }).rasterize([
      cmd('applyBoxShadow', { inset: false, offsetX: 0, offsetY: 4, blur: 8, spread: 0, color: { r: 0, g: 0, b: 0, a: 0.5 } }, 20, 20, 20, 20),
    ]);
    const red = (x: number, y: number) => img.data[(y * 60 + x) * 4]!;
    expect(red(30, 30)).toBe(255);          // under the element: untouched
    expect(red(30, 43)).toBeLessThan(250);  // just below it: shadow
  });
});
