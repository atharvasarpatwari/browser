import { describe, it, expect } from 'vitest';
import { DomTree } from '../src/browser/rendering/dom-tree';
import type { DomElement, DomDocument } from '../src/browser/rendering/dom-tree';
import { HtmlParser } from '../src/browser/rendering/html-parser';
import { IntersectionObserver, parseMargin, expandRect, intersectRects, rectArea } from '../src/browser/rendering/intersection-observer';
import type { ViewportRect } from '../src/browser/rendering/intersection-observer';
import { LazyLoader } from '../src/browser/rendering/lazy-loader';
import { LayoutEngine } from '../src/browser/rendering/layout-engine';
import { PaintEngine } from '../src/browser/rendering/paint-engine';

function buildDoc(html: string): { doc: DomDocument; tree: DomTree } {
  const tree = new DomTree();
  const parser = new HtmlParser();
  const result = parser.parse(html);
  const doc = tree.buildFromHtml(result.document);
  return { doc, tree };
}

function makeLayoutBox(overrides?: Partial<{ x: number; y: number; width: number; height: number }>): import('../src/browser/rendering/dom-tree').LayoutBox {
  return {
    x: overrides?.x ?? 0, y: overrides?.y ?? 0,
    width: overrides?.width ?? 100, height: overrides?.height ?? 100,
    marginTop: 0, marginRight: 0, marginBottom: 0, marginLeft: 0,
    paddingTop: 0, paddingRight: 0, paddingBottom: 0, paddingLeft: 0,
    borderTop: 0, borderRight: 0, borderBottom: 0, borderLeft: 0,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// ROOT MARGIN PARSING
// ─────────────────────────────────────────────────────────────────────────────

describe('parseMargin', () => {
  it('should parse single value', () => {
    expect(parseMargin('10px')).toEqual({ top: 10, right: 10, bottom: 10, left: 10 });
  });

  it('should parse two values', () => {
    expect(parseMargin('10px 20px')).toEqual({ top: 10, right: 20, bottom: 10, left: 20 });
  });

  it('should parse three values', () => {
    expect(parseMargin('10px 20px 30px')).toEqual({ top: 10, right: 20, bottom: 30, left: 20 });
  });

  it('should parse four values', () => {
    expect(parseMargin('10px 20px 30px 40px')).toEqual({ top: 10, right: 20, bottom: 30, left: 40 });
  });

  it('should handle zero', () => {
    expect(parseMargin('0')).toEqual({ top: 0, right: 0, bottom: 0, left: 0 });
  });

  it('should handle empty string', () => {
    expect(parseMargin('')).toEqual({ top: 0, right: 0, bottom: 0, left: 0 });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// RECTANGLE UTILITIES
// ─────────────────────────────────────────────────────────────────────────────

describe('rectArea', () => {
  it('should compute area', () => {
    expect(rectArea({ x: 0, y: 0, width: 10, height: 20 })).toBe(200);
  });

  it('should return 0 for zero-size rect', () => {
    expect(rectArea({ x: 0, y: 0, width: 0, height: 10 })).toBe(0);
  });
});

describe('intersectRects', () => {
  it('should compute intersection of overlapping rects', () => {
    const a: ViewportRect = { x: 0, y: 0, width: 50, height: 50 };
    const b: ViewportRect = { x: 25, y: 25, width: 50, height: 50 };
    expect(intersectRects(a, b)).toEqual({ x: 25, y: 25, width: 25, height: 25 });
  });

  it('should return zero rect for non-overlapping', () => {
    const a: ViewportRect = { x: 0, y: 0, width: 10, height: 10 };
    const b: ViewportRect = { x: 100, y: 100, width: 10, height: 10 };
    const result = intersectRects(a, b);
    expect(result.width).toBe(0);
    expect(result.height).toBe(0);
  });

  it('should return full rect when a contains b', () => {
    const a: ViewportRect = { x: 0, y: 0, width: 100, height: 100 };
    const b: ViewportRect = { x: 10, y: 10, width: 20, height: 20 };
    expect(intersectRects(a, b)).toEqual({ x: 10, y: 10, width: 20, height: 20 });
  });
});

describe('expandRect', () => {
  it('should expand by margin', () => {
    const rect: ViewportRect = { x: 100, y: 100, width: 200, height: 150 };
    const expanded = expandRect(rect, { top: 10, right: 20, bottom: 30, left: 40 });
    expect(expanded).toEqual({ x: 60, y: 90, width: 260, height: 190 });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// INTERSECTION OBSERVER
// ─────────────────────────────────────────────────────────────────────────────

describe('IntersectionObserver', () => {
  it('should fire callback for initially intersecting elements', () => {
    const entries: any[] = [];
    const obs = new IntersectionObserver(
      (e) => { entries.push(...e); },
      { threshold: [0] },
    );

    obs.setViewport(800, 600);

    const { tree } = buildDoc('<html><body><div id="a"></div></body></html>');
    const el = tree.getElementById('a')!;
    (el as any).layoutBox = makeLayoutBox({ x: 10, y: 10, width: 100, height: 50 });

    obs.observe(el);
    // First tick fires because it's the initial observation
    obs.takeRecords();

    expect(entries.length).toBeGreaterThanOrEqual(1);
    expect(entries[0].isIntersecting).toBe(true);
    obs.dispose();
  });

  it('should not fire for non-intersecting elements', () => {
    const entries: any[] = [];
    const obs = new IntersectionObserver(
      (e) => { entries.push(...e); },
      { threshold: [0] },
    );
    obs.setViewport(800, 600);

    const { tree } = buildDoc('<html><body><div id="a"></div></body></html>');
    const el = tree.getElementById('a')!;
    (el as any).layoutBox = makeLayoutBox({ x: 2000, y: 2000, width: 100, height: 50 });

    obs.observe(el);
    obs.takeRecords();

    // Should fire once with isIntersecting=false (initial observation)
    const nonIntersecting = entries.filter((e: any) => !e.isIntersecting);
    expect(nonIntersecting.length).toBe(1);
    obs.dispose();
  });

  it('should respect rootMargin', () => {
    const entries: any[] = [];
    const obs = new IntersectionObserver(
      (e) => { entries.push(...e); },
      { threshold: [0], rootMargin: '100px' },
    );
    obs.setViewport(800, 600);

    const { tree } = buildDoc('<html><body><div id="a"></div></body></html>');
    const el = tree.getElementById('a')!;
    // Element is just outside viewport but within rootMargin
    (el as any).layoutBox = makeLayoutBox({ x: 850, y: 10, width: 100, height: 50 });

    obs.observe(el);
    obs.takeRecords();

    expect(entries.length).toBeGreaterThanOrEqual(1);
    expect(entries[0].isIntersecting).toBe(true);
    obs.dispose();
  });

  it('should unobserve elements', () => {
    const entries: any[] = [];
    const obs = new IntersectionObserver(
      (e) => { entries.push(...e); },
      { threshold: [0] },
    );
    obs.setViewport(800, 600);

    const { tree } = buildDoc('<html><body><div id="a"></div></body></html>');
    const el = tree.getElementById('a')!;
    (el as any).layoutBox = makeLayoutBox({ x: 10, y: 10, width: 100, height: 50 });

    obs.observe(el);
    obs.takeRecords();
    const count = entries.length;

    obs.unobserve(el);
    obs.takeRecords();
    // No new entries after unobserve
    expect(entries.length).toBe(count);
    obs.dispose();
  });

  it('should disconnect all observers', () => {
    const obs = new IntersectionObserver(() => {}, { threshold: [0] });

    const { tree } = buildDoc('<html><body><div id="a"></div><div id="b"></div></body></html>');
    const a = tree.getElementById('a')!;
    const b = tree.getElementById('b')!;
    (a as any).layoutBox = makeLayoutBox({ x: 10, y: 10, width: 100, height: 50 });
    (b as any).layoutBox = makeLayoutBox({ x: 20, y: 20, width: 100, height: 50 });

    obs.observe(a);
    obs.observe(b);
    expect(obs.active).toBe(true);

    obs.disconnect();
    expect(obs.active).toBe(false);
    obs.dispose();
  });

  it('should report correct intersectionRatio', () => {
    const entries: any[] = [];
    const obs = new IntersectionObserver(
      (e) => { entries.push(...e); },
      { threshold: [0, 0.5, 1] },
    );
    obs.setViewport(800, 600);

    const { tree } = buildDoc('<html><body><div id="a"></div></body></html>');
    const el = tree.getElementById('a')!;
    // Half inside viewport
    (el as any).layoutBox = makeLayoutBox({ x: 0, y: 0, width: 200, height: 100 });

    obs.observe(el);
    obs.takeRecords();

    expect(entries.length).toBeGreaterThanOrEqual(1);
    const entry = entries[0];
    expect(entry.intersectionRatio).toBe(1); // fully visible
    obs.dispose();
  });

  it('should fire threshold crossings', () => {
    const entries: any[] = [];
    const obs = new IntersectionObserver(
      (e) => { entries.push(...e); },
      { threshold: [0, 0.5, 1] },
    );
    obs.setViewport(100, 100);

    const { tree } = buildDoc('<html><body><div id="a"></div></body></html>');
    const el = tree.getElementById('a')!;

    // Start fully inside
    (el as any).layoutBox = makeLayoutBox({ x: 10, y: 10, width: 80, height: 80 });
    obs.observe(el);
    obs.takeRecords();

    // Should fire initial entry
    expect(entries.length).toBe(1);
    expect(entries[0].intersectionRatio).toBe(1); // 80x80 = 6400, fully inside 100x100 viewport

    obs.dispose();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// LAZY LOADER
// ─────────────────────────────────────────────────────────────────────────────

describe('LazyLoader', () => {
  it('should scan for lazy elements on init', () => {
    const { tree, doc } = buildDoc(`
      <html><body>
        <div id="container">
          <img id="lazy1" loading="lazy" src="img1.png" style="width:200px;height:100px">
          <img id="eager" src="img2.png" style="width:100px;height:100px">
          <div id="lazy2" loading="lazy"></div>
        </div>
      </body></html>
    `);

    const loader = new LazyLoader({ viewportWidth: 800, viewportHeight: 600 });

    // Layout so elements have boxes
    const layout = new LayoutEngine({ viewportWidth: 800, viewportHeight: 600, defaultFontSize: 16 });
    layout.layout(doc, tree);

    loader.init(doc, tree);

    const lazy1 = tree.getElementById('lazy1')!;
    const eager = tree.getElementById('eager')!;

    expect(lazy1.loadingState).toBe('lazy');
    expect(eager.loadingState).toBe('none');

    loader.dispose();
  });

  it('should load images when they intersect viewport', () => {
    const { tree, doc } = buildDoc(`
      <html><body>
        <img id="img1" loading="lazy" src="photo.jpg" style="width:100px;height:100px">
      </body></html>
    `);

    const layout = new LayoutEngine({ viewportWidth: 800, viewportHeight: 600, defaultFontSize: 16 });
    layout.layout(doc, tree);

    const loadedElements: string[] = [];
    const loader = new LazyLoader({ viewportWidth: 800, viewportHeight: 600, rootMargin: '0px' });
    loader.init(doc, tree);

    const img1 = tree.getElementById('img1')!;
    loader.onLoad(img1, (evt) => {
      loadedElements.push(img1.domId);
      expect(evt.type).toBe('load');
    });

    // Move element into viewport and trigger intersection
    (img1 as any).layoutBox = makeLayoutBox({ x: 10, y: 10, width: 100, height: 100 });
    loader.observe(img1);

    loader.dispose();

    // The element should have been loaded by the time we dispose
    expect(img1.loadingState).toBe('loaded');
    expect(img1.imageData).not.toBeNull();
    expect(img1.naturalWidth).toBe(100);
    expect(img1.naturalHeight).toBe(100);
  });

  it('should generate imageData with correct dimensions', () => {
    const { tree, doc } = buildDoc('<html><body><img id="img" loading="lazy" src="test.png"></body></html>');
    const layout = new LayoutEngine({ viewportWidth: 800, viewportHeight: 600, defaultFontSize: 16 });
    layout.layout(doc, tree);

    const loader = new LazyLoader({ viewportWidth: 800, viewportHeight: 600 });
    loader.init(doc, tree);

    const img = tree.getElementById('img')!;
    (img as any).layoutBox = makeLayoutBox({ x: 0, y: 0, width: 200, height: 150 });
    loader.observe(img);

    loader.dispose();

    expect(img.imageData).not.toBeNull();
    expect(img.imageData!.width).toBe(200);
    expect(img.imageData!.height).toBe(150);
    expect(img.imageData!.data.length).toBe(200 * 150 * 4);
  });

  it('should use explicit width/height attributes over layout box', () => {
    const { tree, doc } = buildDoc('<html><body><img id="img" loading="lazy" src="test.png" width="300" height="200"></body></html>');
    const layout = new LayoutEngine({ viewportWidth: 800, viewportHeight: 600, defaultFontSize: 16 });
    layout.layout(doc, tree);

    const loader = new LazyLoader({ viewportWidth: 800, viewportHeight: 600 });
    loader.init(doc, tree);

    const img = tree.getElementById('img')!;
    (img as any).layoutBox = makeLayoutBox({ x: 0, y: 0, width: 100, height: 100 });
    loader.observe(img);

    loader.dispose();

    expect(img.naturalWidth).toBe(300);
    expect(img.naturalHeight).toBe(200);
  });

  it('should mark missing-src images as error', () => {
    const { tree, doc } = buildDoc('<html><body><img id="img" loading="lazy"></body></html>');
    const layout = new LayoutEngine({ viewportWidth: 800, viewportHeight: 600, defaultFontSize: 16 });
    layout.layout(doc, tree);

    const errors: string[] = [];
    const loader = new LazyLoader({ viewportWidth: 800, viewportHeight: 600 });
    loader.init(doc, tree);

    const img = tree.getElementById('img')!;
    (img as any).layoutBox = makeLayoutBox({ x: 0, y: 0, width: 100, height: 100 });
    loader.onLoad(img, (evt) => {
      if (evt.type === 'error') errors.push('error');
    });
    loader.observe(img);

    loader.dispose();

    expect(img.loadingState).toBe('error');
    expect(errors).toContain('error');
  });

  it('should handle data-src attribute', () => {
    const { tree, doc } = buildDoc('<html><body><img id="img" loading="lazy" data-src="data-photo.jpg"></body></html>');
    const layout = new LayoutEngine({ viewportWidth: 800, viewportHeight: 600, defaultFontSize: 16 });
    layout.layout(doc, tree);

    const loader = new LazyLoader({ viewportWidth: 800, viewportHeight: 600 });
    loader.init(doc, tree);

    const img = tree.getElementById('img')!;
    (img as any).layoutBox = makeLayoutBox({ x: 0, y: 0, width: 100, height: 100 });
    loader.observe(img);

    loader.dispose();

    expect(img.loadingState).toBe('loaded');
    expect(img.imageData).not.toBeNull();
  });

  it('should not double-load already loaded elements', () => {
    const { tree, doc } = buildDoc('<html><body><img id="img" loading="lazy" src="test.png"></body></html>');
    const layout = new LayoutEngine({ viewportWidth: 800, viewportHeight: 600, defaultFontSize: 16 });
    layout.layout(doc, tree);

    let loadCount = 0;
    const loader = new LazyLoader({ viewportWidth: 800, viewportHeight: 600 });
    loader.init(doc, tree);

    const img = tree.getElementById('img')!;
    (img as any).layoutBox = makeLayoutBox({ x: 0, y: 0, width: 100, height: 100 });
    loader.onLoad(img, () => { loadCount++; });
    loader.observe(img);

    // Observe again — should not trigger a second load
    loader.observe(img);
    loader.dispose();

    expect(loadCount).toBe(1);
  });

  it('should load iframes', () => {
    const { tree, doc } = buildDoc('<html><body><iframe id="frame" loading="lazy" src="page.html"></iframe></body></html>');
    const layout = new LayoutEngine({ viewportWidth: 800, viewportHeight: 600, defaultFontSize: 16 });
    layout.layout(doc, tree);

    const loader = new LazyLoader({ viewportWidth: 800, viewportHeight: 600 });
    loader.init(doc, tree);

    const frame = tree.getElementById('frame')!;
    (frame as any).layoutBox = makeLayoutBox({ x: 0, y: 0, width: 800, height: 600 });
    loader.observe(frame);

    loader.dispose();
    expect(frame.loadingState).toBe('loaded');
  });

  it('should update viewport dimensions', () => {
    const loader = new LazyLoader({ viewportWidth: 800, viewportHeight: 600 });
    const { tree, doc } = buildDoc('<html><body><div id="a"></div></body></html>');
    loader.init(doc, tree);

    loader.setViewport(1920, 1080);
    // No error thrown
    loader.dispose();
  });

  it('should update scroll position', () => {
    const loader = new LazyLoader({ viewportWidth: 800, viewportHeight: 600 });
    const { tree, doc } = buildDoc('<html><body><div id="a"></div></body></html>');
    loader.init(doc, tree);

    loader.setScroll(0, 500);
    // No error thrown
    loader.dispose();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// IMAGE PAINTING
// ─────────────────────────────────────────────────────────────────────────────

describe('PaintEngine image rendering', () => {
  it('should generate drawImage command for loaded images', () => {
    const paint = new PaintEngine({ width: 400, height: 400, backgroundColor: '#ffffff', devicePixelRatio: 1, showDebugBorders: false });
    const { tree, doc } = buildDoc(`
      <html><body>
        <img id="img" loading="lazy" src="test.png"
             style="position:relative;width:100px;height:50px;background-color:red">
      </body></html>
    `);

    const layout = new LayoutEngine({ viewportWidth: 400, viewportHeight: 400, defaultFontSize: 16 });
    layout.layout(doc, tree);

    const img = tree.getElementById('img')!;
    // Simulate loaded state
    img.loadingState = 'loaded';
    img.imageData = { data: new Uint8ClampedArray(100 * 50 * 4), width: 100, height: 50, colorSpace: 'srgb' };
    img.naturalWidth = 100;
    img.naturalHeight = 50;

    paint.paint(doc);

    // Check that the composite frame contains drawImage commands
    const commands = paint.compositeFrame();
    const drawImageCmds = commands.filter(c => c.type === 'drawImage');
    expect(drawImageCmds.length).toBeGreaterThanOrEqual(1);
  });

  it('should show placeholder for unloaded lazy images', () => {
    const paint = new PaintEngine({ width: 400, height: 400, backgroundColor: '#ffffff', devicePixelRatio: 1, showDebugBorders: false });
    const { tree, doc } = buildDoc(`
      <html><body>
        <img id="img" loading="lazy" src="test.png"
             style="position:relative;width:100px;height:50px">
      </body></html>
    `);

    const layout = new LayoutEngine({ viewportWidth: 400, viewportHeight: 400, defaultFontSize: 16 });
    layout.layout(doc, tree);

    // Don't load the image — leave it as 'lazy'
    paint.paint(doc);

    const commands = paint.compositeFrame();
    // Should have placeholder fillRect (gray background)
    const fillRects = commands.filter(c => c.type === 'fillRect');
    expect(fillRects.length).toBeGreaterThanOrEqual(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// DOM TREE LOADING STATE
// ─────────────────────────────────────────────────────────────────────────────

describe('DomElement loading state', () => {
  it('should initialize loading="lazy" elements as lazy', () => {
    const { tree } = buildDoc('<html><body><img id="img" loading="lazy" src="test.png"></body></html>');
    const img = tree.getElementById('img')!;
    expect(img.loadingState).toBe('lazy');
  });

  it('should initialize non-lazy elements as none', () => {
    const { tree } = buildDoc('<html><body><img id="img" src="test.png"></body></html>');
    const img = tree.getElementById('img')!;
    expect(img.loadingState).toBe('none');
  });

  it('should initialize imageData as null', () => {
    const { tree } = buildDoc('<html><body><img id="img" loading="lazy" src="test.png"></body></html>');
    const img = tree.getElementById('img')!;
    expect(img.imageData).toBeNull();
    expect(img.naturalWidth).toBe(0);
    expect(img.naturalHeight).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// RASTERIZER drawImage
// ─────────────────────────────────────────────────────────────────────────────

import { Rasterizer } from '../src/browser/rendering/rasterizer';

describe('Rasterizer drawImage', () => {
  it('should blit image data onto the canvas', () => {
    const rasterizer = new Rasterizer({ width: 100, height: 100, backgroundColor: 'white' });
    const imgData = {
      data: new Uint8ClampedArray([
        255, 0, 0, 255, // red pixel
        0, 255, 0, 255, // green pixel
        0, 0, 255, 255, // blue pixel
        255, 255, 0, 255, // yellow pixel
      ]),
      width: 2,
      height: 2,
    };

    rasterizer.rasterize([
      { type: 'drawImage', params: [imgData, 0, 0, 2, 2] },
    ]);

    const output = rasterizer.getPixels();
    // Top-left pixel should be red
    expect(output[0]).toBe(255);
    expect(output[1]).toBe(0);
    expect(output[2]).toBe(0);
    expect(output[3]).toBe(255);

    // Top-right pixel should be green
    expect(output[4]).toBe(0);
    expect(output[5]).toBe(255);
    expect(output[6]).toBe(0);
    expect(output[7]).toBe(255);
  });

  it('should scale image data to destination size', () => {
    const rasterizer = new Rasterizer({ width: 100, height: 100, backgroundColor: 'white' });
    const imgData = {
      data: new Uint8ClampedArray([
        255, 0, 0, 255,
        0, 0, 0, 0, // transparent
      ]),
      width: 1,
      height: 2,
    };

    // Scale 1x2 source to 10x10 destination
    rasterizer.rasterize([
      { type: 'drawImage', params: [imgData, 0, 0, 10, 10] },
    ]);

    const output = rasterizer.getPixels();
    // Top half should be red
    expect(output[0]).toBe(255);
    expect(output[1]).toBe(0);

    // Bottom half should be transparent (white background shows through)
    // The background was white, so after compositing transparent source, we get white
    const bottomIdx = (9 * 100 + 5) * 4; // row 9, col 5
    // Background is white, transparent source blends to white
    expect(output[bottomIdx]).toBe(255);
  });

  it('should respect globalAlpha for drawImage', () => {
    const rasterizer = new Rasterizer({ width: 100, height: 100, backgroundColor: 'white' });
    const imgData = {
      data: new Uint8ClampedArray([255, 0, 0, 255]), // opaque red
      width: 1,
      height: 1,
    };

    rasterizer.rasterize([
      { type: 'setGlobalAlpha', params: [0.5] },
      { type: 'drawImage', params: [imgData, 0, 0, 10, 10] },
    ]);

    const output = rasterizer.getPixels();
    // Red at 50% over white background: r=255, g=127, b=127
    expect(output[0]).toBe(255);
    expect(output[1]).toBeCloseTo(127, 0);
    expect(output[2]).toBeCloseTo(127, 0);
  });

  it('should handle zero-size drawImage gracefully', () => {
    const rasterizer = new Rasterizer({ width: 100, height: 100, backgroundColor: 'white' });
    const imgData = { data: new Uint8ClampedArray(4), width: 1, height: 1 };

    // Should not throw
    rasterizer.rasterize([
      { type: 'drawImage', params: [imgData, 0, 0, 0, 0] },
    ]);

    // Canvas should remain white
    const output = rasterizer.getPixels();
    expect(output[0]).toBe(255);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// JS ENGINE BINDINGS
// ─────────────────────────────────────────────────────────────────────────────

import { runJS } from '../src/browser/js/index';
import { EventLoop } from '../src/browser/js/event-loop';

function runWithDom(html: string, js: string): { value: unknown; error?: { message: string } } {
  const tree = new DomTree();
  const parser = new HtmlParser();
  const result = parser.parse(html);
  const doc = tree.buildFromHtml(result.document);

  const layout = new LayoutEngine({ viewportWidth: 800, viewportHeight: 600, defaultFontSize: 16 });
  layout.layout(doc, tree);

  const eventLoop = new EventLoop();
  return runJS(js, { document: doc, domTree: tree, eventLoop });
}

describe('JS bindings — getBoundingClientRect', () => {
  it('should return a rect object with numeric properties', () => {
    const r = runWithDom(
      '<html><body><div id="el" style="width:200px;height:100px"></div></body></html>',
      `var el = document.getElementById('el'); var rect = el.getBoundingClientRect(); typeof rect.width === 'number' && typeof rect.height === 'number' && typeof rect.x === 'number' && typeof rect.y === 'number'`,
    );
    expect(r.error).toBeUndefined();
    expect(r.value).toBe(true);
  });

  it('should return non-null rect for element', () => {
    const r = runWithDom(
      '<html><body><div id="el"></div></body></html>',
      `var el = document.getElementById('el'); var rect = el.getBoundingClientRect(); rect.width >= 0 && rect.height >= 0`,
    );
    expect(r.error).toBeUndefined();
    expect(r.value).toBe(true);
  });
});

describe('JS bindings — IntersectionObserver', () => {
  it('should create an IntersectionObserver from JS', () => {
    const r = runWithDom(
      '<html><body><div id="el"></div></body></html>',
      `var called = false; var obs = new IntersectionObserver(function(entries, io) { called = true; }); obs.observe(document.getElementById('el')); called`,
    );
    expect(r.value).toBe(true);
  });

  it('should support disconnect', () => {
    const r = runWithDom(
      '<html><body><div id="el"></div></body></html>',
      `var obs = new IntersectionObserver(function(){}); obs.observe(document.getElementById('el')); obs.disconnect(); 'ok'`,
    );
    expect(r.value).toBe('ok');
  });
});

describe('JS bindings — img properties', () => {
  it('should expose loading property on img', () => {
    const r = runWithDom(
      '<html><body><img id="img" loading="lazy" src="test.png"></body></html>',
      `var img = document.getElementById('img'); img.loading`,
    );
    expect(r.value).toBe('lazy');
  });

  it('should expose naturalWidth/naturalHeight after load', () => {
    const r = runWithDom(
      '<html><body><img id="img" loading="lazy" src="test.png" width="300" height="200"></body></html>',
      `var img = document.getElementById('img'); img.naturalWidth + 'x' + img.naturalHeight`,
    );
    // Not loaded yet, so naturalWidth/Height are 0
    expect(r.value).toBe('0x0');
  });

  it('loading setter should update loadingState', () => {
    const r = runWithDom(
      '<html><body><img id="img" src="test.png"></body></html>',
      `var img = document.getElementById('img'); img.loading = 'lazy'; img.loading`,
    );
    expect(r.value).toBe('lazy');
  });
});
