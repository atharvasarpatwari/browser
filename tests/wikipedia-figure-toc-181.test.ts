/**
 * 1.81, the Wikipedia overlap seen on the tablet (1.80 round): the lead figure overlapped a narrow
 * column of text and the contents box. Four causes: a floated `display: table` was laid out as inline
 * content (image and caption side by side, the box a column wide); tables and BFC blocks were laid out
 * under floats instead of beside them; a nested list's first <li> closed the outer item (the tree
 * builder skipped ul/ol as special elements); and `height: 0` collapsed boxes grew to their content.
 */
import { describe, expect, it, vi } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { DomTree } from '../src/browser/rendering/dom-tree';
import type { DomElement } from '../src/browser/rendering/dom-tree';
import { HtmlParser } from '../src/browser/rendering/html-parser';
import { CssParser } from '../src/browser/rendering/css-parser';
import { LayoutEngine } from '../src/browser/rendering/layout-engine';
import { PaintEngine } from '../src/browser/rendering/paint-engine';
import { PageRenderer } from '../src/browser/engine/page-renderer';

async function render(html: string, loadCss: (url: string) => string = () => '', width = 600) {
  const domTree = new DomTree(); const layout = new LayoutEngine();
  const r = new PageRenderer({ htmlParser: new HtmlParser(), domTree, cssParser: new CssParser(), layoutEngine: layout, paintEngine: new PaintEngine(), svgDecode: async () => null,
    resourceLoader: { loadResource: vi.fn(), loadBatch: vi.fn(), loadStylesheet: vi.fn().mockImplementation(async (u: string) => loadCss(u)), loadScript: vi.fn().mockResolvedValue(''), loadImage: vi.fn(), getPriority: vi.fn(), setMaxConcurrent: vi.fn(), on: vi.fn(), off: vi.fn(), dispose: vi.fn() },
    prioritizer: { submit: vi.fn(), submitBatch: vi.fn(), submitPreload: vi.fn(), submitPrefetch: vi.fn(), submitPreconnect: vi.fn(), clear: vi.fn(), dispose: vi.fn() } } as never);
  r.setViewport(width, 1400, 1);
  await r.render({ url: 'http://t.local/', statusCode: 200, contentType: 'text/html', headers: new Map(), loadedAt: 0, body: html } as never, new AbortController().signal);
  const el = (id: string) => domTree.getElementById(id)!;
  const box = (id: string) => layout.getLayoutBox(el(id).domId)!;
  return { el, box, r };
}
const page = (body: string) => `<!doctype html><html><body style="margin:0;font:16px/20px sans-serif">${body}</body></html>`;

describe('floats and tables', () => {
  it('a floated display:table shrinks to its content and puts its caption below', async () => {
    const { box, r } = await render(page(
      '<figure id="f" style="display:table;float:right;margin:0"><span><span id="img" style="display:inline-block;width:250px;height:100px"></span></span>'
      + '<figcaption id="cap" style="display:table-caption;caption-side:bottom">A long caption that is much wider than the image above it when unwrapped</figcaption></figure><p id="p">text</p>'));
    expect(box('f').width).toBe(250);
    expect(box('f').x).toBe(350);
    expect(box('cap').y).toBeGreaterThanOrEqual(box('img').y + 100);
    expect(box('cap').width).toBeLessThanOrEqual(250);
    r.dispose();
  });
  it('a table beside a float is narrowed to the free band instead of running under the float', async () => {
    const { box, r } = await render(page('<div style="float:right;width:200px;height:300px"></div><div id="t" style="display:table;width:100%;background:#eee"><div style="display:table-cell">contents</div></div>'));
    expect(box('t').x + box('t').width).toBeLessThanOrEqual(400);
    r.dispose();
  });
  it('an overflow:hidden block beside a float goes beside it', async () => {
    const { box, r } = await render(page('<div style="float:left;width:150px;height:100px"></div><div id="b" style="overflow:hidden">beside</div>'));
    expect(box('b').x).toBe(150);
    expect(box('b').width).toBe(450);
    r.dispose();
  });
});

describe('tree builder: nested lists', () => {
  it('a nested list stays inside its item and the outer list continues', async () => {
    const { el, r } = await render(page('<ul id="o"><li id="a">A</li><li id="b">B<ul id="i"><li id="b1">B1</li></ul></li><li id="c">C</li></ul>'));
    expect(el('b1').parent).toBe(el('i'));
    expect(el('c').parent).toBe(el('o'));
    r.dispose();
  });
  it('dd/dt stop at special elements but pass through div', async () => {
    const { el, r } = await render(page('<dl id="l"><dt id="t">T</dt><div><dd id="d">D</dd></div></dl>'));
    expect((el('d').parent as DomElement).tagName.toLowerCase()).toBe('div');
    r.dispose();
  });
});

describe('collapsed boxes', () => {
  it('height: 0 is kept even when the content is taller', async () => {
    const { box, r } = await render(page('<ul id="u" style="height:0;visibility:hidden;margin:0"><li>a</li><li>b</li></ul><p id="p" style="margin:0">after</p>'));
    expect(box('u').height).toBe(0);
    expect(box('p').y).toBe(0);
    r.dispose();
  });
});

describe('Wikipedia "Web browser" (saved 2026, 1070px wide)', () => {
  it('floats the figure at the right edge, keeps the contents box beside it and collapsed', async () => {
    const dir = 'tests/fixtures/wikipedia-article-2026/';
    const files = readdirSync(dir);
    const css = (url: string) => {
      if (url.includes('load.php')) return readFileSync(dir + (url.includes('site.styles') ? 'style2.css' : 'style1.css'), 'utf8');
      const base = url.split(/[?#]/)[0]!.split('/').pop() ?? '';
      return files.includes(base) ? readFileSync(dir + base, 'utf8') : '';
    };
    const { el, box, r } = await render(readFileSync(dir + 'index.html', 'utf8'), css, 1070);
    const toc = box('toc');
    let fig: DomElement | null = null;
    const find = (n: DomElement) => { for (const c of n.children) { if (c.nodeType !== 'element') continue; const e = c as DomElement; if (!fig && e.tagName.toLowerCase() === 'figure') fig = e; find(e); } };
    find(el('bodyContent'));
    const f = (fig as unknown as DomElement).layoutBox!;
    expect(f.width).toBeLessThan(300);
    expect(f.x + f.width).toBeGreaterThan(950);
    expect(toc.x + toc.width).toBeLessThanOrEqual(f.x);
    expect(toc.height).toBeLessThan(80); // collapsed (height:0 list), not a 389px empty box
    r.dispose();
  }, 60000);
});
