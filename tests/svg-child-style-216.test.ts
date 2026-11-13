/**
 * 2.16: an inline svg's shapes were serialized with their attributes only, so what the page's stylesheet
 * gave them (`nav>button>svg line { stroke: currentColor; stroke-width: 4 }`, the hamburger icon on
 * adblock.turtlecute.org) never reached the decoder: the icon was blank.
 */
import { expect, it, vi } from 'vitest';
import { DomTree } from '../src/browser/rendering/dom-tree';
import { HtmlParser } from '../src/browser/rendering/html-parser';
import { CssParser } from '../src/browser/rendering/css-parser';
import { LayoutEngine } from '../src/browser/rendering/layout-engine';
import { PaintEngine } from '../src/browser/rendering/paint-engine';
import { PageRenderer } from '../src/browser/engine/page-renderer';

const CSS =
  'nav>button{display:inline-flex;align-items:center;font-size:.875em;margin:0!important;min-width:auto;padding:.5rem}' +
  'nav>button>svg line{stroke:currentColor;stroke-linecap:round;stroke-width:4;transform-origin:12px 12px}' +
  'nav>button svg line:first-child{opacity:0;transform:translateY(-100%)}' +
  'button,input[type=button]{background:#1492ff;color:#fff;min-width:100px;height:2.6rem}';

const HTML =
  `<html><head><style>${CSS}</style></head><body><nav><button id="b"><svg id="s" viewBox="0 0 24 24" width="24" height="24">` +
  '<line x1="3" y1="6" x2="21" y2="6"></line><line x1="3" y1="12" x2="21" y2="12"></line>' +
  '<path id="p" d="M1 1L2 2" stroke="red"></path></svg></button></nav></body></html>';

async function run() {
  let markup = '';
  const domTree = new DomTree();
  const r = new PageRenderer({ htmlParser: new HtmlParser(), domTree, cssParser: new CssParser(), layoutEngine: new LayoutEngine(), paintEngine: new PaintEngine(),
    svgDecode: async (m: string) => { markup = m; return { data: new Uint8ClampedArray(4 * 48 * 48).fill(255), width: 48, height: 48 }; },
    resourceLoader: { loadResource: vi.fn(), loadBatch: vi.fn(), loadStylesheet: vi.fn().mockResolvedValue(CSS), loadScript: vi.fn().mockResolvedValue(''), loadImage: vi.fn(), getPriority: vi.fn(), setMaxConcurrent: vi.fn(), on: vi.fn(), off: vi.fn(), dispose: vi.fn() },
    prioritizer: { submit: vi.fn(), submitBatch: vi.fn(), submitPreload: vi.fn(), submitPrefetch: vi.fn(), submitPreconnect: vi.fn(), clear: vi.fn(), dispose: vi.fn() } } as never);
  r.setViewport(423, 822, 2);
  await r.render({ url: 'http://t.local/', statusCode: 200, contentType: 'text/html', headers: new Map(), loadedAt: 0, body: HTML } as never, new AbortController().signal);
  const button = domTree.getElementById('b') as unknown as { computedStyle: Map<string, string>; layoutBox: { width: number } };
  const svgBox = (domTree.getElementById('s') as unknown as { layoutBox: { width: number; height: number } }).layoutBox;
  const out = { markup, minWidth: button.computedStyle.get('min-width'), width: button.layoutBox.width, svgWidth: svgBox.width, svgHeight: svgBox.height };
  r.dispose();
  return out;
}

it('shapes styled by the stylesheet carry the style into the serialized svg', async () => {
  const { markup } = await run();
  const lines = markup.match(/<line[^>]*>/g) ?? [];
  expect(lines).toHaveLength(2);
  expect(lines[0]).toMatch(/style="[^"]*stroke:[^;"]+/);
  expect(lines[0]).toMatch(/stroke-width:4/);
  expect(lines[0]).toMatch(/opacity:0/);
  expect(lines[1]).toMatch(/stroke-width:4/);
});

it('a shape styled only by its attributes is left as it was', async () => {
  const { markup } = await run();
  expect(markup).toContain('<path id="p" d="M1 1L2 2" stroke="red"></path>');
});

it('nav>button min-width:auto beats button min-width:100px', async () => {
  const { minWidth, width } = await run();
  expect(minWidth).toBe('auto');
  expect(width).toBeLessThan(100);
});

it('an svg sized by its width and height attributes keeps that size as a flex item', async () => {
  // Its content width measured 0 (an svg's children are never laid out), so the icons next to the result rows
  // and the hamburger lines were 0 px wide and never drawn.
  const { svgWidth, svgHeight, markup } = await run();
  expect(svgWidth).toBe(24);
  expect(svgHeight).toBe(24);
  expect(markup).not.toBe('');
});
