/**
 * 1.69: a 40-case pixel probe of painting (28 passed). Fixes: static transforms (translations),
 * currentColor in any property, color-mix(), outlines, gradient + colour layers, background-clip,
 * inset box-shadows, the linear gradient line, stop normalization and px stops in repeating
 * gradients. Known gaps: scale/rotate and rounded clipping of children aren't drawn.
 */
import { describe, expect, it, vi } from 'vitest';
import { DomTree } from '../src/browser/rendering/dom-tree';
import { HtmlParser } from '../src/browser/rendering/html-parser';
import { CssParser } from '../src/browser/rendering/css-parser';
import { LayoutEngine } from '../src/browser/rendering/layout-engine';
import { PaintEngine } from '../src/browser/rendering/paint-engine';
import { PageRenderer } from '../src/browser/engine/page-renderer';

type RGB = [number, number, number];
// [name, body html, [x, y, expected rgb, tolerance][]]
const CASES: Array<[string, string, Array<[number, number, RGB, number?]>]> = [
  ['background-color', '<div style="width:50px;height:50px;background:#f00"></div>', [[25, 25, [255, 0, 0]], [75, 25, [255, 255, 255]]]],
  ['border', '<div style="width:50px;height:50px;border:10px solid #00f;background:#f00"></div>', [[3, 3, [0, 0, 255]], [35, 35, [255, 0, 0]]]],
  ['border sides', '<div style="width:50px;height:50px;border:10px solid;border-color:#f00 #0f0 #00f #ff0"></div>', [[35, 3, [255, 0, 0]], [66, 35, [0, 255, 0]], [35, 66, [0, 0, 255]], [3, 35, [255, 255, 0]]]],
  ['border-radius 50%', '<div style="width:100px;height:100px;border-radius:50%;background:#f00"></div>', [[3, 3, [255, 255, 255]], [50, 50, [255, 0, 0]]]],
  ['linear-gradient to right', '<div style="width:100px;height:20px;background:linear-gradient(to right,#f00,#00f)"></div>', [[2, 10, [250, 0, 5], 20], [97, 10, [5, 0, 250], 20]]],
  ['linear-gradient 180deg', '<div style="width:20px;height:100px;background:linear-gradient(180deg,#f00,#00f)"></div>', [[10, 2, [250, 0, 5], 20], [10, 97, [5, 0, 250], 20]]],
  ['radial-gradient', '<div style="width:100px;height:100px;background:radial-gradient(#f00,#00f)"></div>', [[50, 50, [255, 0, 0], 25], [2, 2, [0, 0, 255], 40]]],
  ['opacity 0.5', '<div style="width:50px;height:50px;background:#f00;opacity:0.5"></div>', [[25, 25, [255, 128, 128], 8]]],
  ['rgba background', '<div style="width:50px;height:50px;background:rgba(255,0,0,0.5)"></div>', [[25, 25, [255, 128, 128], 8]]],
  ['#rrggbbaa', '<div style="width:50px;height:50px;background:#ff000080"></div>', [[25, 25, [255, 127, 127], 8]]],
  ['#rgb', '<div style="width:50px;height:50px;background:#0f0"></div>', [[25, 25, [0, 255, 0]]]],
  ['hsl', '<div style="width:50px;height:50px;background:hsl(240 100% 50%)"></div>', [[25, 25, [0, 0, 255], 3]]],
  ['hwb', '<div style="width:50px;height:50px;background:hwb(0 0% 0%)"></div>', [[25, 25, [255, 0, 0], 3]]],
  ['named rebeccapurple', '<div style="width:50px;height:50px;background:rebeccapurple"></div>', [[25, 25, [102, 51, 153], 2]]],
  ['oklch (Tailwind v4)', '<div style="width:50px;height:50px;background:oklch(62.8% 0.2577 29.23)"></div>', [[25, 25, [255, 0, 0], 12]]],
  ['oklab', '<div style="width:50px;height:50px;background:oklab(62.8% 0.2249 0.1258)"></div>', [[25, 25, [255, 0, 0], 12]]],
  ['color-mix', '<div style="width:50px;height:50px;background:color-mix(in srgb, #f00 50%, #00f)"></div>', [[25, 25, [128, 0, 128], 6]]],
  ['var() color', '<div style="--c:#00f;width:50px;height:50px;background:var(--c)"></div>', [[25, 25, [0, 0, 255]]]],
  ['currentColor border', '<div style="color:#0f0;width:50px;height:50px;border:10px solid currentColor"></div>', [[3, 3, [0, 255, 0]]]],
  ['transparent', '<div style="width:50px;height:50px;background:transparent"></div>', [[25, 25, [255, 255, 255]]]],
  ['visibility hidden', '<div style="width:50px;height:50px;background:#f00;visibility:hidden"></div>', [[25, 25, [255, 255, 255]]]],
  ['z-index order', '<div style="position:relative"><div style="position:absolute;width:50px;height:50px;background:#f00;z-index:2"></div><div style="position:absolute;width:50px;height:50px;background:#00f;z-index:1"></div></div>', [[25, 25, [255, 0, 0]]]],
  ['negative z-index behind', '<div style="position:relative;width:50px;height:50px"><div style="position:absolute;inset:0;background:#f00;z-index:-1"></div><span>x</span></div><div style="position:relative;top:-50px;width:50px;height:50px;background:#00f;opacity:0.5"></div>', [[40, 40, [128, 0, 128], 10]]],
  ['overflow hidden clips', '<div style="width:50px;height:50px;overflow:hidden"><div style="width:150px;height:150px;background:#f00"></div></div>', [[25, 25, [255, 0, 0]], [80, 25, [255, 255, 255]], [25, 80, [255, 255, 255]]]],
  ['box-shadow', '<div style="width:50px;height:50px;background:#f00;box-shadow:20px 20px 0 #00f"></div>', [[65, 65, [0, 0, 255], 10]]],
  ['box-shadow inset', '<div style="width:50px;height:50px;background:#f00;box-shadow:inset 0 0 0 10px #00f"></div>', [[3, 25, [0, 0, 255], 10], [25, 25, [255, 0, 0]]]],
  ['outline', '<div style="margin:20px;width:50px;height:50px;outline:5px solid #0f0"></div>', [[17, 40, [0, 255, 0], 10]]],
  ['transform translate', '<div style="width:50px;height:50px;background:#f00;transform:translateX(100px)"></div>', [[25, 25, [255, 255, 255]], [125, 25, [255, 0, 0]]]],
  ['body background fills canvas', '<style>body{background:#ff0}</style><div style="height:10px"></div>', [[100, 190, [255, 255, 0]]]],
  ['html background', '<style>html{background:#0ff}</style><div style="height:10px"></div>', [[100, 190, [0, 255, 255]]]],
  ['multiple backgrounds', '<div style="width:100px;height:50px;background:linear-gradient(to right,transparent 50%,#00f 50%),#f00"></div>', [[20, 25, [255, 0, 0]], [80, 25, [0, 0, 255]]]],
  ['parent opacity affects child', '<div style="opacity:0.5"><div style="width:50px;height:50px;background:#f00"></div></div>', [[25, 25, [255, 128, 128], 8]]],
  ['clip-path circle', '<div style="width:100px;height:100px;background:#f00;clip-path:circle(50%)"></div>', [[3, 3, [255, 255, 255]], [50, 50, [255, 0, 0]]]],
  ['filter grayscale', '<div style="width:50px;height:50px;background:#f00;filter:grayscale(1)"></div>', [[25, 25, [54, 54, 54], 30]]],
  ['background-clip content-box', '<div style="width:50px;height:50px;padding:10px;background:#f00;background-clip:content-box"></div>', [[3, 3, [255, 255, 255]], [35, 35, [255, 0, 0]]]],
  ['dashed border visible', '<div style="width:50px;height:50px;border:6px dashed #00f"></div>', [[3, 15, [0, 0, 255], 40]]],
  ['repeating-linear-gradient', '<div style="width:40px;height:20px;background:repeating-linear-gradient(to right,#f00 0 10px,#00f 10px 20px)"></div>', [[5, 10, [255, 0, 0], 20], [15, 10, [0, 0, 255], 20], [25, 10, [255, 0, 0], 20]]],
  ['translate(-50%,-50%) centring', '<div style="position:relative;width:200px;height:200px"><div style="position:absolute;top:50%;left:50%;width:40px;height:40px;background:#f00;transform:translate(-50%,-50%)"></div></div>', [[100, 100, [255, 0, 0]], [125, 125, [255, 255, 255]], [85, 85, [255, 0, 0]]]],
  ['linear-gradient midpoint is half-way', '<div style="width:100px;height:20px;background:linear-gradient(to right,#f00,#00f)"></div>', [[50, 10, [128, 0, 128], 12], [25, 10, [191, 0, 64], 14]]],
  ['automatic stops keep their order', '<div style="width:100px;height:20px;background:linear-gradient(to right,#f00 10%,#00f,#0f0 90%)"></div>', [[50, 10, [0, 0, 255], 12]]],
];


describe('painting (pixels)', () => {
  it.each(CASES)('%s', async (_name, html, points) => {
    const domTree = new DomTree(); const paint = new PaintEngine();
    const r = new PageRenderer({ htmlParser: new HtmlParser(), domTree, cssParser: new CssParser(), layoutEngine: new LayoutEngine(), paintEngine: paint, svgDecode: async () => null,
      resourceLoader: { loadResource: vi.fn(), loadBatch: vi.fn(), loadStylesheet: vi.fn().mockResolvedValue(''), loadScript: vi.fn().mockResolvedValue(''), loadImage: vi.fn(), getPriority: vi.fn(), setMaxConcurrent: vi.fn(), on: vi.fn(), off: vi.fn(), dispose: vi.fn() },
      prioritizer: { submit: vi.fn(), submitBatch: vi.fn(), submitPreload: vi.fn(), submitPrefetch: vi.fn(), submitPreconnect: vi.fn(), clear: vi.fn(), dispose: vi.fn() } } as never);
    r.setViewport(200, 200, 1);
    await r.render({ url: 'http://t.local/', statusCode: 200, contentType: 'text/html', headers: new Map(), loadedAt: 0,
      body: `<html><head><meta name="color-scheme" content="light"></head><body style="margin:0">${html}</body></html>` } as never, new AbortController().signal);
    const img = paint.rasterize();
    for (const [x, y, want, tol = 4] of points) {
      const i = (y * img.width + x) * 4;
      const got = [img.data[i]!, img.data[i + 1]!, img.data[i + 2]!];
      expect(got.every((v, k) => Math.abs(v - want[k]!) <= tol), `(${x},${y}) ${got} want ${want}`).toBe(true);
    }
    r.dispose();
  });
});
