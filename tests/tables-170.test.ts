/**
 * 1.70: a 20-case probe of table layout (11 passed) plus the parser's column groups. Fixes:
 * <colgroup>/<col>/<caption> parsing, border-collapse default, explicit and % cell widths, rowspan
 * placement and heights, header/footer group order, <col> widths, vertical-align in cells.
 */
import { describe, expect, it, vi } from 'vitest';
import { DomTree } from '../src/browser/rendering/dom-tree';
import { HtmlParser } from '../src/browser/rendering/html-parser';
import { CssParser } from '../src/browser/rendering/css-parser';
import { LayoutEngine } from '../src/browser/rendering/layout-engine';
import { PaintEngine } from '../src/browser/rendering/paint-engine';
import { PageRenderer } from '../src/browser/engine/page-renderer';

type B = { x: number; y: number; width: number; height: number };
const CASES: Array<[string, string, (b: (id: string) => B) => unknown]> = [
  ['width 100% table', '<table id="t" style="width:100%;border-spacing:0"><tr><td>a</td></tr></table>', (b) => b('t').width === 600],
  ['two equal cells in fixed-width table', '<table style="width:400px;border-spacing:0;table-layout:fixed"><tr><td id="a">a</td><td id="c">b</td></tr></table>', (b) => b('a').width === 200 && b('c').x === 200],
  ['explicit cell width', '<table style="width:400px;border-spacing:0"><tr><td id="a" style="width:100px">a</td><td id="c">b</td></tr></table>', (b) => b('a').width === 100 && b('c').width === 300],
  ['% cell width', '<table style="width:400px;border-spacing:0"><tr><td id="a" style="width:25%">a</td><td>b</td></tr></table>', (b) => b('a').width === 100],
  ['colspan', '<table style="width:300px;border-spacing:0;table-layout:fixed"><tr><td>a</td><td>b</td><td>c</td></tr><tr><td id="s" colspan="2">x</td><td>y</td></tr></table>', (b) => b('s').width === 200],
  ['rowspan', '<table style="border-spacing:0"><tr><td id="r" rowspan="2" style="height:10px">a</td><td style="height:30px">b</td></tr><tr><td style="height:30px">c</td></tr></table>', (b) => b('r').height >= 60],
  ['rowspan pushes next row cell right', '<table style="border-spacing:0;table-layout:fixed;width:200px"><tr><td rowspan="2">a</td><td>b</td></tr><tr><td id="c">c</td></tr></table>', (b) => b('c').x === 100],
  ['row height = tallest cell', '<table style="border-spacing:0"><tr><td id="a">a</td><td style="height:50px">b</td></tr></table>', (b) => b('a').height === 50],
  ['border-spacing', '<table style="border-spacing:10px;table-layout:fixed;width:230px"><tr><td id="a">a</td><td id="c">b</td></tr></table>', (b) => b('a').x === 10 && b('c').x === 120],
  ['border-collapse no spacing', '<table style="border-collapse:collapse;width:200px;table-layout:fixed"><tr><td id="a">a</td><td id="c">b</td></tr></table>', (b) => b('c').x === 100],
  ['cell padding', '<table style="border-spacing:0"><tr><td id="a" style="padding:10px;line-height:20px">a</td></tr></table>', (b) => b('a').height === 40],
  ['caption above', '<table style="border-spacing:0"><caption id="cap" style="line-height:20px">C</caption><tr><td id="a">a</td></tr></table>', (b) => b('a').y >= 20],
  ['thead/tbody/tfoot order', '<table style="border-spacing:0"><tfoot><tr><td id="f" style="line-height:20px">f</td></tr></tfoot><tbody><tr><td id="m" style="line-height:20px">m</td></tr></tbody><thead><tr><td id="h" style="line-height:20px">h</td></tr></thead></table>', (b) => b('h').y < b('m').y && b('m').y < b('f').y],
  ['auto layout: wide content gets more', '<table style="width:400px;border-spacing:0"><tr><td id="a">a</td><td id="c">a much longer cell with many words in it</td></tr></table>', (b) => b('c').width > b('a').width],
  ['table shrinks to content', '<table id="t" style="border-spacing:0"><tr><td>ab</td></tr></table>', (b) => b('t').width < 100],
  ['margin auto centres table', '<table id="t" style="width:200px;margin:0 auto;border-spacing:0"><tr><td>a</td></tr></table>', (b) => b('t').x === 200],
  ['display:table on divs', '<div style="display:table;width:200px"><div style="display:table-row"><div id="a" style="display:table-cell">a</div><div id="c" style="display:table-cell">b</div></div></div>', (b) => b('c').x > 0 && b('c').y === b('a').y],
  ['vertical-align middle cell', '<table style="border-spacing:0"><tr><td style="height:100px;vertical-align:middle"><span id="s" style="display:inline-block;height:20px;width:5px"></span></td></tr></table>', (b) => b('s').y >= 35 && b('s').y <= 45],
  ['empty cells still take width', '<table style="width:300px;border-spacing:0;table-layout:fixed"><tr><td></td><td id="c">x</td><td></td></tr></table>', (b) => b('c').x === 100],
  ['col width', '<table style="border-spacing:0;table-layout:fixed;width:300px"><colgroup><col style="width:200px"><col></colgroup><tr><td id="a">a</td><td>b</td></tr></table>', (b) => b('a').width === 200],
];

describe('table layout', () => {
  it.each(CASES)('%s', async (_name, html, check) => {
    const domTree = new DomTree(); const layout = new LayoutEngine();
    const r = new PageRenderer({ htmlParser: new HtmlParser(), domTree, cssParser: new CssParser(), layoutEngine: layout, paintEngine: new PaintEngine(), svgDecode: async () => null,
      resourceLoader: { loadResource: vi.fn(), loadBatch: vi.fn(), loadStylesheet: vi.fn().mockResolvedValue(''), loadScript: vi.fn().mockResolvedValue(''), loadImage: vi.fn(), getPriority: vi.fn(), setMaxConcurrent: vi.fn(), on: vi.fn(), off: vi.fn(), dispose: vi.fn() },
      prioritizer: { submit: vi.fn(), submitBatch: vi.fn(), submitPreload: vi.fn(), submitPrefetch: vi.fn(), submitPreconnect: vi.fn(), clear: vi.fn(), dispose: vi.fn() } } as never);
    r.setViewport(600, 760, 1);
    await r.render({ url: 'http://t.local/', statusCode: 200, contentType: 'text/html', headers: new Map(), loadedAt: 0,
      body: `<html><head><style>td,th{padding:0}</style></head><body style="margin:0;font:16px sans-serif">${html}</body></html>` } as never, new AbortController().signal);
    const b = (id: string): B => { const x = layout.getLayoutBox(domTree.getElementById(id)!.domId)!; return { x: Math.round(x.x), y: Math.round(x.y), width: Math.round(x.width), height: Math.round(x.height) }; };
    expect(check(b)).toBeTruthy();
    r.dispose();
  });
});

describe('table parsing', () => {
  const tree = (html: string): string => {
    const doc = new HtmlParser().parse(`<html><body>${html}</body></html>`).document as unknown as { children: unknown[] };
    const walk = (n: { tagName?: string; children?: unknown[] }): string => (n.tagName ? `${n.tagName}(${(n.children ?? []).map((c) => walk(c as never)).filter(Boolean).join(',')})` : '');
    const body = (doc.children[0] as { children: unknown[] }).children.find((c) => (c as { tagName?: string }).tagName === 'body') as { children: unknown[] };
    return body.children.map((c) => walk(c as never)).filter(Boolean).join(',');
  };
  it('<colgroup> stays inside the table, before its rows', () => {
    expect(tree('<table><colgroup><col><col></colgroup><tr><td>a</td></tr></table><p>x</p>')).toBe('table(colgroup(col(),col()),tbody(tr(td()))),p()');
  });
  it('a bare <col> gets an implicit <colgroup>', () => {
    expect(tree('<table><col><tr><td>a</td></tr></table>')).toBe('table(colgroup(col()),tbody(tr(td())))');
  });
  it('<caption> is the table\'s first child', () => {
    expect(tree('<table><caption>c</caption><tr><td>a</td></tr></table>')).toBe('table(caption(),tbody(tr(td())))');
  });
});
