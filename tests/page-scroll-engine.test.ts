import { describe, it, expect, vi } from 'vitest';
import { HtmlParser } from '../src/browser/rendering/html-parser';
import { DomTree } from '../src/browser/rendering/dom-tree';
import type { DomDocument, DomElement } from '../src/browser/rendering/dom-tree';
import { LayoutEngine } from '../src/browser/rendering/layout-engine';
import { PaintEngine } from '../src/browser/rendering/paint-engine';

const VIEWPORT = { width: 400, height: 300 };

function buildDoc(spacerHeight: number): { doc: DomDocument; tree: DomTree } {
  const tree = new DomTree();
  const doc: DomDocument = tree.buildFromHtml(new HtmlParser().parse('<html><body><div id="spacer"></div><div id="bar"></div></body></html>').document);
  const style = (id: string, entries: Record<string, string>): void => {
    const el = tree.getElementById(id) as DomElement;
    tree.setComputedStyle(el, new Map([...(el.computedStyle ?? []), ...Object.entries(entries)]));
  };
  if (doc.bodyElement) tree.setComputedStyle(doc.bodyElement, new Map([...(doc.bodyElement.computedStyle ?? []), ['margin', '0'], ['display', 'block']]));
  style('spacer', { display: 'block', height: `${spacerHeight}px` });
  style('bar', { display: 'block', height: '100px', 'background-color': '#ff0000' });
  new LayoutEngine({ viewportWidth: VIEWPORT.width, viewportHeight: VIEWPORT.height, defaultFontSize: 16 }).layout(doc, tree);
  return { doc, tree };
}

/** A page `spacerHeight + 100` px tall: empty space, then a 100 px red bar at its bottom. */
function paintPage(spacerHeight = 1000): PaintEngine {
  const paint = new PaintEngine(VIEWPORT);
  paint.paint(buildDoc(spacerHeight).doc);
  return paint;
}

const pixel = (img: ImageData, x: number, y: number): [number, number, number] => {
  const i = (y * img.width + x) * 4;
  return [img.data[i]!, img.data[i + 1]!, img.data[i + 2]!];
};
const WHITE: [number, number, number] = [255, 255, 255];
const RED: [number, number, number] = [255, 0, 0];

describe('PaintEngine scrolling', () => {
  it('knows how tall the document is and how far it can scroll', () => {
    const scroll = paintPage().getScroll();
    expect(scroll.documentHeight).toBeGreaterThanOrEqual(1100);
    expect(scroll.viewportHeight).toBe(VIEWPORT.height);
    expect(scroll.max).toBe(Math.ceil(scroll.documentHeight) - VIEWPORT.height);
    expect(scroll.y).toBe(0);
  });

  it('keeps the offset inside the document, whole pixels, and ignores nonsense', () => {
    const paint = paintPage();
    const { max } = paint.getScroll();
    expect(paint.setScroll(250.4)).toBe(250);
    expect(paint.setScroll(-40)).toBe(0);
    expect(paint.setScroll(1e9)).toBe(max);
    expect(paint.setScroll(Number.NaN)).toBe(0);
    expect(paint.setScroll(Infinity)).toBe(0);
  });

  it('a page that fits the viewport cannot scroll, and is painted exactly as before', () => {
    const paint = paintPage(100); // 200 px tall
    expect(paint.getScroll().max).toBe(0);
    expect(paint.setScroll(500)).toBe(0);
    const frame = paint.rasterize();
    expect([frame.width, frame.height]).toEqual([VIEWPORT.width, VIEWPORT.height]);
    expect(pixel(frame, 10, 150)).toEqual(RED);
  });

  it('shows one viewport of the page: the bar below the fold appears once scrolled to it', () => {
    const paint = paintPage();
    const top = paint.rasterize();
    expect([top.width, top.height]).toEqual([VIEWPORT.width, VIEWPORT.height]);
    expect(pixel(top, 10, 250)).toEqual(WHITE);

    paint.setScroll(paint.getScroll().max); // 1100 − 300 = 800: the bar (y 1000-1100) sits at 200-300
    const bottom = paint.rasterize();
    expect([bottom.width, bottom.height]).toEqual([VIEWPORT.width, VIEWPORT.height]);
    expect(pixel(bottom, 10, 250)).toEqual(RED);
    expect(pixel(bottom, 10, 100)).toEqual(WHITE);
  });

  it('scrolls by exactly the offset', () => {
    const paint = paintPage();
    paint.setScroll(850); // clamps to 800, the bar starts at row 200
    const frame = paint.rasterize();
    expect(pixel(frame, 10, 199)).toEqual(WHITE);
    expect(pixel(frame, 10, 200)).toEqual(RED);
    paint.setScroll(700); // the bar starts at row 300: just out of view
    expect(pixel(paint.rasterize(), 10, 299)).toEqual(WHITE);
  });

  it('rasterises the page once, not at every scroll position, until it changes', () => {
    const { doc } = buildDoc(1000);
    const paint = new PaintEngine(VIEWPORT);
    paint.paint(doc);
    const composite = vi.spyOn(paint, 'compositeFrame');
    paint.rasterize();
    for (const y of [100, 300, 500, 800]) { paint.setScroll(y); paint.rasterize(); }
    expect(composite).toHaveBeenCalledTimes(1);
    paint.paint(doc); // the page changed
    paint.rasterize();
    expect(composite).toHaveBeenCalledTimes(2);
  });

  it('hands out a copy of the window: drawing the next frame does not alter an earlier one', () => {
    const paint = paintPage();
    const first = paint.rasterize();
    const before = pixel(first, 10, 250);
    paint.setScroll(800);
    paint.rasterize();
    expect(pixel(first, 10, 250)).toEqual(before);
  });

  it('clamps an offset that no longer fits after a repaint of a shorter page', () => {
    const paint = paintPage();
    paint.setScroll(800);
    paint.paint(buildDoc(100).doc);
    expect(paint.getScroll()).toMatchObject({ y: 0, max: 0 });
    expect(paint.rasterize().height).toBe(VIEWPORT.height);
  });

  it('stops at a maximum page height rather than allocating without limit', () => {
    const paint = new PaintEngine(VIEWPORT);
    paint.paint(buildDoc(30_000).doc);
    const scroll = paint.getScroll();
    expect(scroll.documentHeight).toBeGreaterThan(30_000);
    expect(scroll.max).toBe(16_384 - VIEWPORT.height);
  });
});
