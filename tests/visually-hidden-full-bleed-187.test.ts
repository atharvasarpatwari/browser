/**
 * 1.87, from the saved W3C homepage: visually-hidden labels (`position: absolute; width: 1px;
 * height: 1px; overflow: hidden; white-space: nowrap`) were 300px columns of single letters, and
 * full-bleed bands (`width: 100vw; margin: 0 -50vw; left: 50%`) stopped short of the right edge.
 */
import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { DomTree } from '../src/browser/rendering/dom-tree';
import { HtmlParser } from '../src/browser/rendering/html-parser';
import { CssParser } from '../src/browser/rendering/css-parser';
import { LayoutEngine } from '../src/browser/rendering/layout-engine';
import { PaintEngine } from '../src/browser/rendering/paint-engine';
import { PageRenderer } from '../src/browser/engine/page-renderer';

async function render(html: string, width = 412, css: (u: string) => string = () => '') {
  const domTree = new DomTree(); const layout = new LayoutEngine();
  const r = new PageRenderer({ htmlParser: new HtmlParser(), domTree, cssParser: new CssParser(), layoutEngine: layout, paintEngine: new PaintEngine(), svgDecode: async () => null,
    resourceLoader: { loadResource: vi.fn(), loadBatch: vi.fn(), loadStylesheet: vi.fn().mockImplementation(async (u: string) => css(u)), loadScript: vi.fn().mockResolvedValue(''), loadImage: vi.fn().mockResolvedValue({ bodyBinary: null, error: 'offline' }), getPriority: vi.fn(), setMaxConcurrent: vi.fn(), on: vi.fn(), off: vi.fn(), dispose: vi.fn() },
    prioritizer: { submit: vi.fn(), submitBatch: vi.fn(), submitPreload: vi.fn(), submitPrefetch: vi.fn(), submitPreconnect: vi.fn(), clear: vi.fn(), dispose: vi.fn() } } as never);
  r.setViewport(width, 800, 1);
  await r.render({ url: 'http://t.local/', statusCode: 200, contentType: 'text/html', headers: new Map(), loadedAt: 0, body: html } as never, new AbortController().signal);
  const box = (id: string) => layout.getLayoutBox(domTree.getElementById(id)!.domId)!;
  return { box, domTree, r };
}
const page = (body: string) => `<!doctype html><html><head><style>*{overflow-wrap:break-word}</style></head><body style="margin:0;font:16px/20px sans-serif">${body}</body></html>`;
const HIDDEN = 'position:absolute;width:1px;height:1px;overflow:hidden;white-space:nowrap;clip-path:inset(50%)';

describe('visually-hidden text', () => {
  it('a 1x1 overflow:hidden positioned box keeps its height', async () => {
    const { box, r } = await render(page(`<a href="#" id="a" style="${HIDDEN}">Skip to content</a><p id="p">Body</p>`));
    expect(box('a').height).toBe(1); // was the height of its wrapped text
    expect(box('a').width).toBe(1);
    r.dispose();
  });
  it('white-space:nowrap text never breaks between letters, even under overflow-wrap:break-word', async () => {
    const { box, r } = await render(page('<div style="width:20px"><span id="s" style="white-space:nowrap">Standards</span></div>'));
    expect(box('s').height).toBeLessThan(25); // one line (its content area)…
    expect(box('s').width).toBeGreaterThan(20); // …overflowing the 20px box
    r.dispose();
  });
  it('without nowrap a long word still breaks under break-word', async () => {
    const { box, r } = await render(page('<div style="width:20px"><span id="s">Standards</span></div>'));
    expect(box('s').height).toBeGreaterThan(20);
    r.dispose();
  });
});

describe('specified widths are not capped at the containing block', () => {
  it('a full-bleed band spans the viewport', async () => {
    const { box, r } = await render(page('<main style="padding:0 21px"><div id="b" style="position:relative;left:50%;width:100vw;margin:0 -50vw;height:10px;background:#eee"></div></main>'));
    expect(box('b').width).toBe(412); // was 370
    expect(box('b').x).toBe(0);
    r.dispose();
  });
  it('a fixed-width block wider than its parent overflows it', async () => {
    const { box, r } = await render(page('<div style="width:100px"><div id="w" style="width:300px;height:5px"></div></div>'));
    expect(box('w').width).toBe(300);
    r.dispose();
  });
  it('a fixed-width block keeps its width while a table cell measures its minimum', async () => {
    const { box, r } = await render(page('<table><tr><td id="c"><div style="width:10px;height:10px"></div></td><td>long text in the other column of this table here</td></tr></table>'));
    expect(box('c').width).toBeGreaterThanOrEqual(10); // HN's 10px vote arrow was measured 1px
    r.dispose();
  });
});

describe('W3C homepage (saved 2026)', () => {
  it('hidden labels are 1x1 and the members band spans the viewport at 412', async () => {
    const dir = 'tests/fixtures/w3c-home-2026/';
    const css = (u: string) => (u.includes('core.css') ? readFileSync(dir + 'core.css', 'utf8') : '');
    const { domTree, r } = await render(readFileSync(dir + 'index.html', 'utf8'), 412, css);
    for (const el of domTree.querySelectorAll('.visuallyhidden, .skip-link')) {
      if (el.layoutBox) expect(el.layoutBox.height).toBeLessThanOrEqual(1);
    }
    const band = domTree.querySelector('.component--members')!;
    expect(band.layoutBox!.width).toBe(412);
    r.dispose();
  }, 60000);
});
