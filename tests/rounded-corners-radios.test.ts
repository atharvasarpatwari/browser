/**
 * Found on the device (Realme RMX5264, httpbin's form):
 * - border-radius was ignored, so radio buttons, rounded buttons and cards painted square;
 * - picking a radio unticked the others but only the tapped one was redrawn, so two looked selected.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { Rasterizer } from '../src/browser/rendering/rasterizer';
import type { PaintCommand } from '../src/browser/rendering/paint-engine';
import { PaintEngine } from '../src/browser/rendering/paint-engine';
import { HtmlParser } from '../src/browser/rendering/html-parser';
import { DomTree } from '../src/browser/rendering/dom-tree';
import { CssParser } from '../src/browser/rendering/css-parser';
import { LayoutEngine } from '../src/browser/rendering/layout-engine';
import { PageRenderer } from '../src/browser/engine/page-renderer';
import { controlKind, toggleControl, controlChecked } from '../src/browser/rendering/form-controls';

const cmd = (type: string, ...params: unknown[]) => ({ type, params }) as PaintCommand;
const alphaAt = (img: ImageData, x: number, y: number) => img.data[(y * img.width + x) * 4 + 3]!;

describe('border-radius in the rasterizer', () => {
  it('clips fills to the rounded box while set, and not after it is cleared', () => {
    const r = new Rasterizer({ width: 40, height: 20, backgroundColor: 'transparent' });
    const rad = { w: 10, h: 10 };
    const img = r.rasterize([
      cmd('setBorderRadius', { topLeft: rad, topRight: rad, bottomRight: rad, bottomLeft: rad }, 0, 0, 20, 20),
      cmd('setFillStyle', '#ff0000'),
      cmd('fillRect', 0, 0, 20, 20),
      cmd('setBorderRadius', null, 0, 0, 0, 0),
      cmd('fillRect', 20, 0, 20, 20),
    ]);
    expect(alphaAt(img, 0, 0)).toBe(0);      // rounded corner
    expect(alphaAt(img, 10, 10)).toBe(255);  // centre
    expect(alphaAt(img, 20, 0)).toBe(255);   // square again after the radius is cleared
    const edge = alphaAt(img, 2, 3);         // on the curve: partly covered (anti-aliased)
    expect(edge).toBeGreaterThan(0);
    expect(edge).toBeLessThan(255);
  });
});

describe('rounded borders (found on the phone, 1.35)', () => {
  const rad = (r: number) => ({ topLeft: { w: r, h: r }, topRight: { w: r, h: r }, bottomRight: { w: r, h: r }, bottomLeft: { w: r, h: r } });

  it('a 1px border at a fractional x keeps its left side (pixel centre just outside the box)', () => {
    const r = new Rasterizer({ width: 40, height: 20, backgroundColor: 'white' });
    const img = r.rasterize([
      cmd('setBorderRadius', rad(2), 10.9, 2, 20, 12),
      cmd('setFillStyle', '#000000'),
      cmd('fillRect', 10.9, 3, 1, 10),
    ]);
    const red = (x: number, y: number) => img.data[(y * 40 + x) * 4]!;
    expect(red(10, 8)).toBeLessThan(128);
  });

  it('a uniform rounded border is a ring: outline drawn, middle empty', () => {
    const r = new Rasterizer({ width: 13, height: 13, backgroundColor: 'white' });
    const img = r.rasterize([cmd('setFillStyle', '#000000'), cmd('fillRoundedRing', rad(6.5), 0, 0, 13, 13, 1, 1, 1, 1)]);
    const dark = (x: number, y: number) => img.data[(y * 13 + x) * 4]! < 128;
    expect(dark(6, 0)).toBe(true);   // top of the circle
    expect(dark(0, 6)).toBe(true);   // left
    expect(dark(6, 6)).toBe(false);  // hole
    expect(dark(0, 0)).toBe(false);  // outside the circle
  });

  it('a ring at a fractional y has no stray pixel below it', () => {
    const r = new Rasterizer({ width: 13, height: 15, backgroundColor: 'white' });
    const img = r.rasterize([cmd('setFillStyle', '#000000'), cmd('fillRoundedRing', rad(6.5), 0, 0.13, 13, 13, 1, 1, 1, 1)]);
    expect(img.data[(13 * 13 + 6) * 4]!).toBeGreaterThan(200); // row 13 (centre 13.5) is below the box (ends at 13.13)
  });
});

describe('border-radius on a page', () => {
  it('a rounded div paints with transparent corners', async () => {
    const paint = new PaintEngine();
    const renderer = new PageRenderer({ htmlParser: new HtmlParser(), domTree: new DomTree(), cssParser: new CssParser(), layoutEngine: new LayoutEngine(), paintEngine: paint,
      resourceLoader: { loadResource: vi.fn(), loadBatch: vi.fn(), loadStylesheet: vi.fn().mockResolvedValue(''), loadScript: vi.fn().mockResolvedValue(''), loadImage: vi.fn(), getPriority: vi.fn(), setMaxConcurrent: vi.fn(), on: vi.fn(), off: vi.fn(), dispose: vi.fn() },
      prioritizer: { submit: vi.fn(), submitBatch: vi.fn(), submitPreload: vi.fn(), submitPrefetch: vi.fn(), submitPreconnect: vi.fn(), clear: vi.fn(), dispose: vi.fn() } } as never);
    renderer.setViewport(100, 100, 1);
    await renderer.render({ url: 'https://example.com/', statusCode: 200, contentType: 'text/html',
      body: '<html><body style="margin:0;background:transparent"><div style="width:40px;height:40px;background:#ff0000;border-radius:20px"></div></body></html>',
      headers: new Map(), loadedAt: 0 } as never, new AbortController().signal);
    renderer.dispose();
    const img = new Rasterizer({ width: 100, height: 100, backgroundColor: 'transparent' }).rasterize(paint.compositeFrame());
    const red = (x: number, y: number) => { const i = (y * 100 + x) * 4; return img.data[i]! > 200 && img.data[i + 1]! < 60 && img.data[i + 3]! > 200; };
    expect(red(20, 20)).toBe(true);
    expect(red(1, 1)).toBe(false);
    expect(red(38, 38)).toBe(false);
  });
});

describe('radio groups', () => {
  it('picking a radio returns every control it changed, so all of them are redrawn', () => {
    const domTree = new DomTree();
    domTree.buildFromHtml((new HtmlParser().parse(readFileSync('tests/fixtures/httpbin-form-2026/index.html', 'utf8')) as unknown as { document: never }).document);
    const radios = domTree.getElementsByTagName('input').filter((el) => controlKind(el) === 'radio');
    expect(toggleControl(radios[0]!)).toEqual([radios[0]]);
    const changed = toggleControl(radios[1]!);
    expect(changed).toContain(radios[1]);
    expect(changed).toContain(radios[0]); // the one it unticked
    expect(radios.map(controlChecked)).toEqual([false, true, false]);
  });
});
