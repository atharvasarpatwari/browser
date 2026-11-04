/**
 * 1.80, found by loading Hacker News live on the tablet: the orange header covered the page, ranks
 * sat at the end of the previous row and titles ran into their points line. Six causes: nested
 * tables broke the tree builder (insertion-mode reset and `<tr>` in a row), `<center>` had no UA
 * style (an inline holding the table), block-level tables inside inlines were flowed as text, no
 * presentational attributes were applied (width, bgcolor, cellspacing, align …), a nested table
 * measured one border-spacing too narrow, and `line-height: 12pt` became 12 × the font size.
 */
import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { DomTree } from '../src/browser/rendering/dom-tree';
import type { DomElement } from '../src/browser/rendering/dom-tree';
import { HtmlParser } from '../src/browser/rendering/html-parser';
import { CssParser } from '../src/browser/rendering/css-parser';
import { LayoutEngine } from '../src/browser/rendering/layout-engine';
import { PaintEngine } from '../src/browser/rendering/paint-engine';
import { PageRenderer } from '../src/browser/engine/page-renderer';

async function render(html: string, css = '', width = 600) {
  const domTree = new DomTree(); const layout = new LayoutEngine();
  const r = new PageRenderer({ htmlParser: new HtmlParser(), domTree, cssParser: new CssParser(), layoutEngine: layout, paintEngine: new PaintEngine(), svgDecode: async () => null,
    resourceLoader: { loadResource: vi.fn(), loadBatch: vi.fn(), loadStylesheet: vi.fn().mockResolvedValue(css), loadScript: vi.fn().mockResolvedValue(''), loadImage: vi.fn(), getPriority: vi.fn(), setMaxConcurrent: vi.fn(), on: vi.fn(), off: vi.fn(), dispose: vi.fn() },
    prioritizer: { submit: vi.fn(), submitBatch: vi.fn(), submitPreload: vi.fn(), submitPrefetch: vi.fn(), submitPreconnect: vi.fn(), clear: vi.fn(), dispose: vi.fn() } } as never);
  r.setViewport(width, 900, 1);
  await r.render({ url: 'http://t.local/', statusCode: 200, contentType: 'text/html', headers: new Map(), loadedAt: 0, body: html } as never, new AbortController().signal);
  const el = (id: string) => domTree.getElementById(id)!;
  const box = (id: string) => layout.getLayoutBox(el(id).domId)!;
  return { el, box, r };
}
const page = (body: string) => `<!doctype html><html><body style="margin:0;font:16px/20px sans-serif">${body}</body></html>`;
const parentTag = (e: DomElement) => (e.parent as DomElement).tagName.toLowerCase();

describe('tree builder: nested tables', () => {
  it('rows after a nested table belong to the outer table, not the cell before them', async () => {
    const { el, r } = await render(page('<table id="o"><tr><td id="h"><table><tr><td>a</td></tr></table></td></tr><tr id="s"></tr><tr id="b"><td>x</td></tr></table>'));
    expect(parentTag(el('b'))).toBe('tbody');
    expect(el('b').parent).toBe(el('s').parent);
    r.dispose();
  });
  it('a <tr> opened while a row is open ends that row (<tr .../> is not self-closing)', async () => {
    const { el, r } = await render(page("<table><tr><td>a</td></tr><tr style='height:10px'/><tr id=\"b\"><td>x</td></tr></table>"));
    expect(parentTag(el('b'))).toBe('tbody');
    r.dispose();
  });
});

describe('<center>, block-level boxes in inlines, presentational attributes', () => {
  const row = '<table id="t" cellspacing="0" cellpadding="0"><tr><td id="a">1.</td><td id="c">Kitty title</td></tr><tr><td></td><td id="s">112 points</td></tr></table>';
  it('a table inside <center> is laid out as a table, its rows stacked', async () => {
    const { box, r } = await render(page(`<center>${row}</center>`));
    expect(box('a').y).toBe(box('c').y);
    expect(box('s').y).toBeGreaterThan(box('c').y);
    r.dispose();
  });
  it('a table in a <span> breaks the line like a block', async () => {
    const { box, r } = await render(page(`<span>before ${row} after</span>`));
    expect(box('a').y).toBe(box('c').y);
    expect(box('s').y).toBeGreaterThan(box('c').y);
    r.dispose();
  });
  it('<center> centres a table with a width', async () => {
    const { box, r } = await render(page('<center><table id="t" width="50%"><tr><td>x</td></tr></table></center>'));
    expect(box('t').width).toBe(300);
    expect(box('t').x).toBe(150);
    r.dispose();
  });
  it('width, bgcolor, cellspacing, cellpadding and align map to CSS', async () => {
    const { el, box, r } = await render(page('<table id="t" width="85%" bgcolor="#f6f6ef" cellspacing="0" cellpadding="3"><tr><td id="a" align="right" width="100">1.</td><td id="b" bgcolor="ff6600">x</td></tr></table>'));
    expect(box('t').width).toBeCloseTo(510, 0);
    expect(el('t').computedStyle?.get('background-color')).toBe('#f6f6ef');
    expect(el('b').computedStyle?.get('background-color')).toBe('#ff6600');
    expect(box('b').x).toBe(box('a').x + box('a').width); // no spacing
    expect(el('a').computedStyle?.get('padding-left')).toBe('3px');
    expect(el('a').computedStyle?.get('text-align')).toBe('right');
    r.dispose();
  });
  it('author CSS still overrides a presentational attribute', async () => {
    const { el, r } = await render(page('<style>#t{background-color:rgb(1,2,3)}</style><table id="t" bgcolor="#f00"><tr><td>x</td></tr></table>'));
    expect(el('t').computedStyle?.get('background-color')?.replace(/\s/g, '')).toBe('rgb(1,2,3)');
    r.dispose();
  });
  it('quirks mode: cells in <center> are not centred (no doctype)', async () => {
    const { el, r } = await render('<html><body><center><table><tr><td id="a">x</td></tr></table></center></body></html>');
    expect(el('a').computedStyle?.get('text-align')).toBe('start');
    r.dispose();
  });
});

describe('measuring and line-height', () => {
  it('a table nested in a table cell gets its full width (the last border-spacing counted)', async () => {
    const { box, r } = await render(page('<table><tr><td><table><tr><td id="c">Kitty title</td></tr></table></td></tr></table>'));
    expect(box('c').height).toBe(22); // one line: it wrapped to two
    r.dispose();
  });
  it('line-height with a unit is a length (pt converted), a percentage is of the font size', async () => {
    const { box, r } = await render(page('<div id="a" style="font-size:10px;line-height:12pt">x</div><div id="b" style="font-size:10px;line-height:150%">x</div><div id="c" style="font-size:10px;line-height:2">x</div>'));
    expect(box('a').height).toBe(16);
    expect(box('b').height).toBe(15);
    expect(box('c').height).toBe(20);
    r.dispose();
  });
});

describe('Hacker News front page (saved 2026-11-04)', () => {
  it('lays out like a browser: slim header, 85% table, rank and title on one row, points below', async () => {
    const dir = 'tests/fixtures/hn-2026/';
    const { el, box, r } = await render(readFileSync(dir + 'index.html', 'utf8'), readFileSync(dir + 'news.css', 'utf8'), 1070);
    const main = box('hnmain');
    expect(main.width).toBeGreaterThan(1070 * 0.8);
    expect(el('hnmain').computedStyle?.get('background-color')).toBe('#f6f6ef');
    const header = el('hnmain').children.find((c) => c.nodeType === 'element') as DomElement; // tbody
    const headerCell = ((header.children[0] as DomElement).children.find((c) => c.nodeType === 'element') as DomElement);
    expect(layoutHeight(headerCell)).toBeLessThan(40);
    const ranks = [...withClass(el('bigbox'), 'rank')];
    const titles = [...withClass(el('bigbox'), 'titleline')];
    expect(ranks.length).toBe(30);
    for (let i = 0; i < 5; i++) {
      const rank = (ranks[i]!.parent as DomElement), title = (titles[i]!.parent as DomElement);
      expect(Math.abs(layoutY(rank) - layoutY(title))).toBeLessThanOrEqual(1);
    }
    r.dispose();
    function layoutHeight(e: DomElement) { return e.layoutBox!.height; }
    function layoutY(e: DomElement) { return e.layoutBox!.y; }
  }, 60000);
});

/** Elements under `root` with class `cls`, in document order. */
function* withClass(root: DomElement, cls: string): Generator<DomElement> {
  for (const c of root.children) {
    if (c.nodeType !== 'element') continue;
    const e = c as DomElement;
    if ((e.attributes.get('class') ?? '').split(/\s+/).includes(cls)) yield e;
    yield* withClass(e, cls);
  }
}
