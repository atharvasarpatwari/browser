/**
 * 1.84: CSS url() images. `background-image: url()` was never painted (only gradients) and
 * `mask-image: url()` icons (MDN, Wikipedia) were solid squares, then blank in 1.83. Stylesheet
 * url()s are now made absolute against the sheet, loaded after layout, and painted.
 */
import { describe, expect, it, vi } from 'vitest';
import { PNG } from 'pngjs';
import { DomTree } from '../src/browser/rendering/dom-tree';
import { HtmlParser } from '../src/browser/rendering/html-parser';
import { CssParser } from '../src/browser/rendering/css-parser';
import { LayoutEngine } from '../src/browser/rendering/layout-engine';
import { PaintEngine } from '../src/browser/rendering/paint-engine';
import { Rasterizer } from '../src/browser/rendering/rasterizer';
import { PageRenderer } from '../src/browser/engine/page-renderer';
import { decodeDataUrl, firstCssUrl } from '../src/browser/rendering/css-images';
import { containsDangerousCss, sanitizeStyleAttribute } from '../src/browser/security/html-sanitizer';

/** A w×h PNG data URL; `px(x, y)` gives [r, g, b, a]. */
function pngUrl(w: number, h: number, px: (x: number, y: number) => number[]): string {
  const png = new PNG({ width: w, height: h });
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) png.data.set(px(x, y), (y * w + x) * 4);
  return 'data:image/png;base64,' + PNG.sync.write(png).toString('base64');
}

async function render(html: string, css: Record<string, string> = {}, images: Record<string, string> = {}) {
  const domTree = new DomTree(); const paint = new PaintEngine();
  const loadImage = vi.fn(async (url: string) => {
    const d = images[url] ? decodeDataUrl(images[url]!) : null;
    return d ? { bodyBinary: d.bytes, contentType: d.type, error: null } : { bodyBinary: null, error: 'not found' };
  });
  const r = new PageRenderer({ htmlParser: new HtmlParser(), domTree, cssParser: new CssParser(), layoutEngine: new LayoutEngine(), paintEngine: paint, svgDecode: async () => null,
    resourceLoader: { loadResource: vi.fn(), loadBatch: vi.fn(), loadStylesheet: vi.fn().mockImplementation(async (u: string) => css[u] ?? ''), loadScript: vi.fn().mockResolvedValue(''), loadImage, getPriority: vi.fn(), setMaxConcurrent: vi.fn(), on: vi.fn(), off: vi.fn(), dispose: vi.fn() },
    prioritizer: { submit: vi.fn(), submitBatch: vi.fn(), submitPreload: vi.fn(), submitPrefetch: vi.fn(), submitPreconnect: vi.fn(), clear: vi.fn(), dispose: vi.fn() } } as never);
  r.setViewport(200, 100, 1);
  await r.render({ url: 'https://site.test/page/index.html', statusCode: 200, contentType: 'text/html', headers: new Map(), loadedAt: 0, body: html } as never, new AbortController().signal);
  const ras = new Rasterizer({ width: 200, height: 100, backgroundColor: 'white' });
  ras.rasterize(paint.compositeFrame());
  const pix = ras.getPixels();
  const at = (x: number, y: number) => Array.from(pix.slice((y * 200 + x) * 4, (y * 200 + x) * 4 + 3));
  r.dispose();
  return { at, loadImage };
}
const page = (style: string, body: string, head = '') => `<!doctype html><html><head>${head}<style>${style}</style></head><body style="margin:0">${body}</body></html>`;
const RED = pngUrl(4, 4, () => [255, 0, 0, 255]);
// Left half opaque, right half transparent: a mask that shows the left half only.
const HALF = pngUrl(4, 4, (x) => [0, 0, 0, x < 2 ? 255 : 0]);

describe('background-image: url()', () => {
  it('paints, repeating by default', async () => {
    const { at } = await render(page(`#b{width:40px;height:40px;background-image:url("${RED}")}`, '<div id="b"></div>'));
    expect(at(1, 1)).toEqual([255, 0, 0]);
    expect(at(30, 30)).toEqual([255, 0, 0]); // a tile, not just the first 4px
    expect(at(50, 10)).toEqual([255, 255, 255]);
  });
  it('no-repeat, sized and positioned', async () => {
    const { at } = await render(page(`#b{width:40px;height:40px;background:url(${RED}) no-repeat right bottom / 10px 10px}`, '<div id="b"></div>'));
    expect(at(35, 35)).toEqual([255, 0, 0]);
    expect(at(5, 5)).toEqual([255, 255, 255]);
  });
  it('a url relative to its stylesheet is fetched from the sheet\'s folder', async () => {
    const { at, loadImage } = await render(page('', '<div id="b"></div>', '<link rel="stylesheet" href="/static/css/site.css">'),
      { 'https://site.test/static/css/site.css': '#b{width:20px;height:20px;background:url(../img/dot.png)}' },
      { 'https://site.test/static/img/dot.png': RED });
    expect(loadImage).toHaveBeenCalledWith('https://site.test/static/img/dot.png');
    expect(at(5, 5)).toEqual([255, 0, 0]);
  });
});

describe('mask-image: url()', () => {
  it('shows the background colour through the mask', async () => {
    const { at } = await render(page(`#i{width:40px;height:40px;background-color:#0000ff;mask-image:url(${HALF});mask-size:cover}`, '<div id="i"></div>'));
    expect(at(5, 20)).toEqual([0, 0, 255]); // opaque half
    expect(at(35, 20)).toEqual([255, 255, 255]); // transparent half
  });
  it('a mask that fails to load hides the background', async () => {
    const { at } = await render(page('#i{width:40px;height:40px;background:#0000ff;mask-image:url(/missing.svg)}', '<div id="i"></div>'));
    expect(at(20, 20)).toEqual([255, 255, 255]);
  });
});

describe('parsing', () => {
  it('an unquoted data: URL keeps its ";base64" in a stylesheet and in a style attribute', async () => {
    const sheet = await render(page(`#b{width:20px;height:20px;background-image:url(${RED})}`, '<div id="b"></div>'));
    expect(sheet.at(5, 5), 'sheet').toEqual([255, 0, 0]);
    const inline = await render(page('', `<div style="width:20px;height:20px;background-image:url(${RED});color:blue"></div>`));
    expect(inline.at(5, 5), 'inline').toEqual([255, 0, 0]);
  });
  it('the background shorthand reads "position / size", spaced or not', async () => {
    for (const bg of [`url(${RED}) no-repeat right bottom / 10px 10px`, `url(${RED}) no-repeat right bottom/10px 10px`]) {
      const { at } = await render(page(`#b{width:40px;height:40px;background:${bg}}`, '<div id="b"></div>'));
      expect(at(35, 35), bg.slice(-30)).toEqual([255, 0, 0]);
      expect(at(5, 5)).toEqual([255, 255, 255]);
    }
  });
});

describe('inline style sanitizer', () => {
  it('allows data:image urls, still blocks other data: and javascript: urls', () => {
    expect(containsDangerousCss('background:url(data:image/png;base64,AAAA)')).toBe(false);
    expect(containsDangerousCss('background:url("data:image/svg+xml,%3Csvg/%3E")')).toBe(false);
    expect(containsDangerousCss('background:url(data:text/html,<script>)')).toBe(true);
    expect(containsDangerousCss('background:url(javascript:alert(1))')).toBe(true);
  });
  it('drops a blocked declaration whole, leaving no tail of it behind', () => {
    expect(sanitizeStyleAttribute('width:2px;background:url(data:text/html;base64,PHM+);color:red')).toBe('width:2px;color:red');
  });
});

describe('helpers', () => {
  it('firstCssUrl reads quoted and unquoted urls', () => {
    expect(firstCssUrl('url("a b.png"), linear-gradient(red, blue)')).toBe('a b.png');
    expect(firstCssUrl("url('x.svg')")).toBe('x.svg');
    expect(firstCssUrl('url(y.png) no-repeat')).toBe('y.png');
    expect(firstCssUrl('none')).toBeNull();
  });
  it('decodeDataUrl reads base64 and percent-encoded payloads', () => {
    expect(new TextDecoder().decode(decodeDataUrl('data:image/svg+xml,%3Csvg%2F%3E')!.bytes)).toBe('<svg/>');
    expect(decodeDataUrl('data:text/plain;base64,aGk=')!.bytes).toEqual(new Uint8Array([104, 105]));
  });
});
