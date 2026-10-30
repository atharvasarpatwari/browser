/**
 * Inline <svg> is rasterized through the image decoder (httpforever's logo and theme icons were
 * blank). See doc/2026-10-30-nova-android-1.43-*.md.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { DomTree } from '../src/browser/rendering/dom-tree';
import { HtmlParser } from '../src/browser/rendering/html-parser';
import { CssParser } from '../src/browser/rendering/css-parser';
import { LayoutEngine } from '../src/browser/rendering/layout-engine';
import { PaintEngine } from '../src/browser/rendering/paint-engine';
import { PageRenderer } from '../src/browser/engine/page-renderer';
import { serializeInlineSvg, type SvgDecode } from '../src/browser/rendering/inline-svg';

async function render(html: string, svgDecode: SvgDecode, css = '', js = '', dpr = 2) {
  const domTree = new DomTree();
  const paint = new PaintEngine();
  const renderer = new PageRenderer({ htmlParser: new HtmlParser(), domTree, cssParser: new CssParser(), layoutEngine: new LayoutEngine(), paintEngine: paint, svgDecode,
    resourceLoader: { loadResource: vi.fn(), loadBatch: vi.fn(), loadStylesheet: vi.fn().mockResolvedValue(css), loadScript: vi.fn().mockResolvedValue(js), loadImage: vi.fn(), getPriority: vi.fn(), setMaxConcurrent: vi.fn(), on: vi.fn(), off: vi.fn(), dispose: vi.fn() },
    prioritizer: { submit: vi.fn(), submitBatch: vi.fn(), submitPreload: vi.fn(), submitPrefetch: vi.fn(), submitPreconnect: vi.fn(), clear: vi.fn(), dispose: vi.fn() } } as never);
  renderer.setViewport(424, 900, dpr);
  await renderer.render({ url: 'http://test.local/', statusCode: 200, contentType: 'text/html', body: html, headers: new Map(), loadedAt: 0 } as never, new AbortController().signal);
  renderer.dispose();
  return { domTree, paint };
}

const red = (w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4).fill(255), width: w, height: h });

describe('inline <svg>', () => {
  it('serializes as a standalone image: case restored, colour resolved, sized in device pixels', async () => {
    let markup = '';
    const { domTree } = await render(
      '<html><body style="color:#123456"><svg id="s" class="ic" viewBox="0 0 24 24" style="width:24px;height:24px"><linearGradient id="g" gradientUnits="userSpaceOnUse"></linearGradient><path d="M1 1L2 2" stroke="currentColor"/><script>void 0</script></svg></body></html>',
      async (m) => { markup = m; return red(48, 48); });
    expect(markup).toMatch(/^<svg id="s" viewBox="0 0 24 24" xmlns="http:\/\/www.w3.org\/2000\/svg" width="48" height="48" style="[^"]*color:#123456/);
    expect(markup).toContain('<linearGradient id="g" gradientUnits="userSpaceOnUse">');
    expect(markup).toContain('<path d="M1 1L2 2" stroke="currentColor"></path>');
    expect(markup).not.toContain('script');
    const svg = domTree.getElementById('s')!;
    expect(svg.loadingState).toBe('loaded');
    expect(svg.imageData?.width).toBe(48);
  });

  it('is painted as an image at its box; hidden and nested svgs are skipped', async () => {
    const calls: string[] = [];
    const { paint } = await render(
      '<html><body style="margin:0"><svg viewBox="0 0 10 10" width="20" height="10"><svg viewBox="0 0 1 1"></svg></svg><svg style="display:none" viewBox="0 0 1 1"></svg></body></html>',
      async (m) => { calls.push(m); return red(40, 20); });
    expect(calls).toHaveLength(1);
    const draw = paint.compositeFrame().find((c) => c.type === 'drawImage')!;
    expect(draw.params.slice(1)).toEqual([0, 0, 20, 10]);
  });

  it("httpforever's brand mark and visible theme icon are drawn", async () => {
    const F = 'tests/fixtures/httpforever-2026/';
    const seen: string[] = [];
    await render(readFileSync(F + 'index.html', 'utf8'), async (m) => { seen.push(m.slice(0, 120)); return red(4, 4); }, readFileSync(F + 'style.css', 'utf8'), readFileSync(F + 'theme.js', 'utf8'));
    expect(seen.some((m) => m.includes('viewBox="0 0 24 24"'))).toBe(true);
    expect(seen.length).toBeGreaterThanOrEqual(2); // the brand mark + the shown theme glyph (the others are display:none)
  });

  it('a decoder failure leaves the svg blank, not broken', async () => {
    const { domTree } = await render('<html><body><svg id="s" width="10" height="10"></svg></body></html>', async () => { throw new Error('bad svg'); });
    expect(domTree.getElementById('s')!.loadingState).not.toBe('loaded');
  });

  it('serializeInlineSvg escapes attribute values and text', () => {
    const svg = { tagName: 'svg', nodeType: 'element', attributes: new Map([['aria-label', 'a "b" <c>']]), children: [{ nodeType: 'element', tagName: 'text', attributes: new Map(), children: [{ nodeType: 'text', text: '1 < 2 & 3' }] }], computedStyle: null } as never;
    const out = serializeInlineSvg(svg, 5, 5);
    expect(out).toContain('aria-label="a &quot;b&quot; &lt;c&gt;"');
    expect(out).toContain('<text>1 &lt; 2 &amp; 3</text>');
  });
});

describe('SVG images are rasterized at their display size (Wikipedia wordmark was blurry)', () => {
  it('scales up to cover the requested size, keeps the aspect and reports the natural size', async () => {
    const { ImageDecoder } = await import('../src/browser/image/decoder');
    const g = globalThis as Record<string, unknown>;
    const saved = { Image: g.Image, cib: g.createImageBitmap, oc: g.OffscreenCanvas, cu: URL.createObjectURL, ru: URL.revokeObjectURL };
    let drawn: number[] = [];
    g.createImageBitmap = async () => { throw new Error('rejects SVG blobs'); };
    g.OffscreenCanvas = class {
      constructor(public width: number, public height: number) {}
      getContext() { const { width, height } = this; return { drawImage: (_i: unknown, ...a: number[]) => { drawn = a; }, getImageData: () => ({ data: new Uint8ClampedArray(width * height * 4) }) }; }
    };
    g.Image = class { naturalWidth = 119; naturalHeight = 18; src = ''; async decode() {} };
    URL.createObjectURL = () => 'blob:x';
    URL.revokeObjectURL = () => {};
    try {
      const svg = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg" width="119" height="18"/>');
      const big = await new ImageDecoder().decode(svg, 'image/svg+xml', { width: 357, height: 54 });
      expect([big!.width, big!.height, big!.naturalWidth, big!.naturalHeight]).toEqual([357, 54, 119, 18]);
      expect(drawn).toEqual([0, 0, 357, 54]);
      const placeholder = await new ImageDecoder().decode(svg, 'image/svg+xml', { width: 100, height: 100 });
      expect(placeholder!.width / placeholder!.height).toBeCloseTo(119 / 18, 1); // aspect kept
      const plain = await new ImageDecoder().decode(svg, 'image/svg+xml');
      expect([plain!.width, plain!.height]).toEqual([119, 18]);
    } finally {
      g.Image = saved.Image; g.createImageBitmap = saved.cib; g.OffscreenCanvas = saved.oc;
      URL.createObjectURL = saved.cu; URL.revokeObjectURL = saved.ru;
      if (saved.cib === undefined) delete g.createImageBitmap;
      if (saved.oc === undefined) delete g.OffscreenCanvas;
      if (saved.Image === undefined) delete g.Image;
    }
  });
});
