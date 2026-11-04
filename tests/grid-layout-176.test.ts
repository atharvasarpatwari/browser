/**
 * 1.76: a 32-case grid probe (13 passed first). Auto rows ignored content height (text grids were
 * 0px tall), auto/max-content columns ignored content width, justify-/align-content, grid-auto-rows/
 * -columns, column and dense auto-flow, order, negative and named lines, -start/-end longhands,
 * multi-row areas, the grid-template shorthand, margin:auto and auto-fit collapsing were missing.
 */
import { describe, expect, it, vi } from 'vitest';
import { DomTree } from '../src/browser/rendering/dom-tree';
import { HtmlParser } from '../src/browser/rendering/html-parser';
import { CssParser } from '../src/browser/rendering/css-parser';
import { LayoutEngine } from '../src/browser/rendering/layout-engine';
import { PaintEngine } from '../src/browser/rendering/paint-engine';
import { PageRenderer } from '../src/browser/engine/page-renderer';

type B = { x: number; y: number; width: number; height: number };
async function page(body: string) {
  const domTree = new DomTree(); const layout = new LayoutEngine();
  const r = new PageRenderer({ htmlParser: new HtmlParser(), domTree, cssParser: new CssParser(), layoutEngine: layout, paintEngine: new PaintEngine(), svgDecode: async () => null,
    resourceLoader: { loadResource: vi.fn(), loadBatch: vi.fn(), loadStylesheet: vi.fn().mockResolvedValue(''), loadScript: vi.fn().mockResolvedValue(''), loadImage: vi.fn(), getPriority: vi.fn(), setMaxConcurrent: vi.fn(), on: vi.fn(), off: vi.fn(), dispose: vi.fn() },
    prioritizer: { submit: vi.fn(), submitBatch: vi.fn(), submitPreload: vi.fn(), submitPrefetch: vi.fn(), submitPreconnect: vi.fn(), clear: vi.fn(), dispose: vi.fn() } } as never);
  r.setViewport(600, 760, 1);
  await r.render({ url: 'http://t.local/', statusCode: 200, contentType: 'text/html', headers: new Map(), loadedAt: 0, body: `<html><head><style>*{box-sizing:border-box}</style></head><body style="margin:0;font:16px/20px sans-serif">${body}</body></html>` } as never, new AbortController().signal);
  const box = (id: string): B => { const b = layout.getLayoutBox(domTree.getElementById(id)!.domId)!; return { x: b.x, y: b.y, width: b.width, height: b.height }; };
  return { box, r };
}

const d = (id: string, style: string, inner = '') => `<div id="${id}" style="${style}">${inner}</div>`;
const g = (style: string, inner: string) => d('c', 'display:grid;width:600px;' + style, inner);
const CASES: Array<[string, string, (b: (id: string) => B) => boolean]> = [
  ['implicit column auto + place-content center', d('c', 'display:grid;place-content:center;width:200px;height:100px', d('a', 'width:20px;height:20px')), (b) => b('a').x === 90 && b('a').y === 40],
  ['justify-content center with px tracks', g('grid-template-columns:100px 100px;justify-content:center', d('a', 'height:5px') + d('b', 'height:5px')), (b) => b('a').x === 200 && b('b').x === 300],
  ['justify-content end', g('grid-template-columns:100px;justify-content:end', d('a', 'height:5px')), (b) => b('a').x === 500],
  ['justify-content space-between', g('grid-template-columns:100px 100px;justify-content:space-between', d('a', 'height:5px') + d('b', 'height:5px')), (b) => b('b').x === 500],
  ['align-content center', g('grid-template-rows:20px;height:100px;align-content:center', d('a', '')), (b) => b('a').y === 40],
  ['auto column sized to content', g('grid-template-columns:auto 1fr', d('a', 'width:120px;height:5px') + d('b', 'height:5px')), (b) => b('b').x === 120 && b('b').width === 480],
  ['max-content column', g('grid-template-columns:max-content 1fr', '<div id="a" style="height:5px;white-space:nowrap"><span style="display:inline-block;width:150px"></span></div>' + d('b', 'height:5px')), (b) => b('b').x === 150],
  ['minmax(100px, 1fr)', g('grid-template-columns:minmax(100px, 1fr) 300px', d('a', 'height:5px') + d('b', 'height:5px')), (b) => b('a').width === 300 && b('b').x === 300],
  ['minmax(0,1fr) equal', g('grid-template-columns:repeat(3, minmax(0, 1fr))', d('a', '') + d('b', '') + d('e', '')), (b) => b('b').x === 200 && b('e').x === 400],
  ['fr with gap', g('grid-template-columns:2fr 1fr;gap:30px', d('a', '') + d('b', '')), (b) => b('a').width === 380 && b('b').x === 410],
  ['grid-auto-rows', g('grid-template-columns:1fr;grid-auto-rows:40px', d('a', '') + d('b', '')), (b) => b('a').height === 40 && b('b').y === 40],
  ['grid-auto-columns with auto-flow column', g('grid-auto-flow:column;grid-auto-columns:100px', d('a', 'height:5px') + d('b', 'height:5px')), (b) => b('b').x === 100 && b('a').width === 100],
  ['grid-auto-flow dense', g('grid-template-columns:repeat(3,100px);grid-auto-flow:dense', d('a', 'grid-column:span 2;height:5px') + d('b', 'grid-column:span 2;height:5px') + d('e', 'height:5px')), (b) => b('e').x === 200 && b('e').y === 0],
  ['grid-column 1 / -1', g('grid-template-columns:repeat(3,1fr)', d('a', 'grid-column:1 / -1;height:5px') + d('b', 'height:5px')), (b) => b('a').width === 600 && b('b').y === 5],
  ['grid-column 2 / 4', g('grid-template-columns:repeat(4,100px)', d('a', 'grid-column:2 / 4;height:5px')), (b) => b('a').x === 100 && b('a').width === 200],
  ['grid-column-start + end', g('grid-template-columns:repeat(4,100px)', d('a', 'grid-column-start:3;grid-column-end:span 2;height:5px')), (b) => b('a').x === 200 && b('a').width === 200],
  ['grid-row span 2', g('grid-template-columns:100px 100px;grid-auto-rows:20px', d('a', 'grid-row:span 2') + d('b', '') + d('e', '')), (b) => b('a').height === 40 && b('e').x === 100 && b('e').y === 20],
  ['grid-area 4 values', g('grid-template-columns:repeat(3,100px);grid-template-rows:repeat(3,20px)', d('a', 'grid-area:2 / 2 / 4 / 4')), (b) => b('a').x === 100 && b('a').y === 20 && b('a').width === 200 && b('a').height === 40],
  ['named lines', g('grid-template-columns:[full-start] 50px [content-start] 1fr [content-end] 50px [full-end]', d('a', 'grid-column:content;height:5px') + d('b', 'grid-column:full;height:5px')), (b) => b('a').x === 50 && b('a').width === 500 && b('b').width === 600],
  ['template areas multi-row', g('grid-template-columns:100px 1fr;grid-template-rows:20px 30px;grid-template-areas:\'h h\' \'s m\'', d('a', 'grid-area:h') + d('b', 'grid-area:s') + d('e', 'grid-area:m')), (b) => b('a').width === 600 && b('b').y === 20 && b('e').x === 100 && b('e').height === 30],
  ['grid-template shorthand', g('grid-template:20px 30px / 100px 1fr', d('a', '') + d('b', '') + d('e', '')), (b) => b('b').x === 100 && b('e').y === 20 && b('e').height === 30],
  ['justify-self end', g('grid-template-columns:200px', d('a', 'justify-self:end;width:50px;height:5px')), (b) => b('a').x === 150],
  ['align-self center', g('grid-template-rows:100px', d('a', 'align-self:center;height:20px')), (b) => b('a').y === 40],
  ['justify-items center', g('grid-template-columns:200px 200px;justify-items:center', d('a', 'width:50px;height:5px')), (b) => b('a').x === 75],
  ['margin auto in grid cell', g('grid-template-columns:200px;grid-template-rows:100px', d('a', 'margin:auto;width:50px;height:20px')), (b) => b('a').x === 75 && b('a').y === 40],
  ['row height from content', g('grid-template-columns:1fr 1fr', d('a', '', 'one<br>two<br>three') + d('b', '')), (b) => b('b').height === b('a').height && b('a').height >= 50],
  ['order in grid', g('grid-template-columns:100px 100px', d('a', 'order:2;height:5px') + d('b', 'order:1;height:5px')), (b) => b('b').x === 0 && b('a').x === 100],
  ['inline-grid shrinks', '<span id="c" style="display:inline-grid;grid-template-columns:50px 50px"><span id="a"></span><span id="b"></span></span>', (b) => b('c').width === 100],
  ['grid container height auto = rows', g('grid-template-columns:1fr;row-gap:10px', d('a', 'height:20px') + d('b', 'height:30px')), (b) => b('c').height === 60],
  ['nested grid', g('grid-template-columns:300px 1fr', d('a', 'display:grid;grid-template-columns:1fr 1fr', d('b', 'height:5px') + d('e', 'height:5px'))), (b) => b('e').x === 150],
  ['abs child of grid uses padding box', d('c', 'display:grid;position:relative;width:200px;height:100px;padding:10px', d('a', 'position:absolute;top:0;left:0;width:5px;height:5px')), (b) => b('a').x === 0 && b('a').y === 0],
  ['repeat(auto-fit) collapses empty', g('grid-template-columns:repeat(auto-fit, minmax(100px, 1fr))', d('a', 'height:5px') + d('b', 'height:5px')), (b) => b('a').width === 300],
];

describe('CSS grid (1.76 probe)', () => {
  it.each(CASES)('%s', async (_name, html, check) => {
    const { box, r } = await page(html);
    expect(check(box)).toBe(true);
    r.dispose();
  });
});
