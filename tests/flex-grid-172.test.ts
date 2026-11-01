/**
 * 1.72: a 39-case flexbox/grid probe. Column containers used the page width as their main size
 * (every item as tall as the page was wide), row-reverse/column-reverse packed at the start, and
 * cross-axis auto margins (`margin: auto` centring) were ignored.
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
const CASES: Array<[string, string, (b: (id: string) => B) => boolean]> = [
  ['row equal flex:1', d('c', 'display:flex;width:600px', d('a', 'flex:1') + d('b', 'flex:1')), (b) => b('a').width === 300 && b('b').x === 300],
  ['flex-grow ratio 1:2', d('c', 'display:flex;width:600px', d('a', 'flex-grow:1') + d('b', 'flex-grow:2')), (b) => Math.abs(b('a').width - 200) < 1 && Math.abs(b('b').width - 400) < 1],
  ['flex-basis px + grow', d('c', 'display:flex;width:600px', d('a', 'flex:0 0 100px') + d('b', 'flex:1')), (b) => b('a').width === 100 && b('b').width === 500],
  ['shrink overflowing', d('c', 'display:flex;width:300px', d('a', 'width:200px') + d('b', 'width:200px')), (b) => b('a').width === 150 && b('b').width === 150],
  ['flex-shrink:0', d('c', 'display:flex;width:300px', d('a', 'width:200px;flex-shrink:0') + d('b', 'width:200px')), (b) => b('a').width === 200 && b('b').width === 100],
  ['gap', d('c', 'display:flex;width:600px;gap:20px', d('a', 'flex:1') + d('b', 'flex:1')), (b) => b('a').width === 290 && b('b').x === 310],
  ['justify center', d('c', 'display:flex;width:600px;justify-content:center', d('a', 'width:100px')), (b) => b('a').x === 250],
  ['justify space-between', d('c', 'display:flex;width:600px;justify-content:space-between', d('a', 'width:100px') + d('b', 'width:100px')), (b) => b('b').x === 500],
  ['justify space-evenly', d('c', 'display:flex;width:600px;justify-content:space-evenly', d('a', 'width:100px') + d('b', 'width:100px')), (b) => Math.abs(b('a').x - 133.33) < 1],
  ['justify flex-end', d('c', 'display:flex;width:600px;justify-content:flex-end', d('a', 'width:100px')), (b) => b('a').x === 500],
  ['align-items center', d('c', 'display:flex;height:100px;align-items:center', d('a', 'height:20px;width:10px')), (b) => b('a').y === 40],
  ['align-items stretch default', d('c', 'display:flex;height:100px', d('a', 'width:10px')), (b) => b('a').height === 100],
  ['align-self flex-end', d('c', 'display:flex;height:100px', d('a', 'height:20px;width:10px;align-self:flex-end')), (b) => b('a').y === 80],
  ['margin-left:auto pushes right', d('c', 'display:flex;width:600px', d('a', 'width:100px') + d('b', 'width:100px;margin-left:auto')), (b) => b('b').x === 500],
  ['margin:auto centres', d('c', 'display:flex;width:600px;height:100px', d('a', 'width:100px;height:20px;margin:auto')), (b) => b('a').x === 250 && b('a').y === 40],
  ['column direction', d('c', 'display:flex;flex-direction:column', d('a', 'height:30px') + d('b', 'height:30px')), (b) => b('b').y === 30 && b('a').width === 600 && b('a').height === 30 && b('c').height === 60],
  ['column flex:1 fills height', d('c', 'display:flex;flex-direction:column;height:200px', d('a', 'height:50px') + d('b', 'flex:1')), (b) => b('b').height === 150],
  ['column-reverse', d('c', 'display:flex;flex-direction:column-reverse', d('a', 'height:30px') + d('b', 'height:30px')), (b) => b('b').y === 0 && b('a').y === 30 && b('c').height === 60],
  ['column justify center', d('c', 'display:flex;flex-direction:column;justify-content:center;height:100px', d('a', 'height:20px')), (b) => b('a').y === 40],
  ['column align-items center', d('c', 'display:flex;flex-direction:column;align-items:center', d('a', 'width:100px;height:20px')), (b) => b('a').x === 250 && b('c').height === 20],
  ['column text items stack', d('c', 'display:flex;flex-direction:column', d('a', '', 'Hello') + d('b', '', 'World')), (b) => b('a').height === 20 && b('b').y === 20 && b('c').height === 40],
  ['row-reverse', d('c', 'display:flex;flex-direction:row-reverse;width:600px', d('a', 'width:100px') + d('b', 'width:100px')), (b) => b('a').x === 500 && b('b').x === 400],
  ['wrap', d('c', 'display:flex;flex-wrap:wrap;width:300px', d('a', 'width:200px;height:10px') + d('b', 'width:200px;height:10px')), (b) => b('b').y === 10 && b('b').x === 0],
  ['wrap + row-gap', d('c', 'display:flex;flex-wrap:wrap;width:300px;gap:5px 0', d('a', 'width:200px;height:10px') + d('b', 'width:200px;height:10px')), (b) => b('b').y === 15],
  ['order', d('c', 'display:flex;width:600px', d('a', 'width:100px;order:2') + d('b', 'width:100px;order:1')), (b) => b('b').x === 0 && b('a').x === 100],
  ['min-width:0 text item shrinks', d('c', 'display:flex;width:200px', d('a', 'flex:1;min-width:0;white-space:nowrap;overflow:hidden', 'averyveryverylongwordthatoverflowsthebox') + d('b', 'width:50px')), (b) => b('b').x === 150],
  ['inline-flex shrink-wraps', '<span id="c" style="display:inline-flex;gap:10px"><span id="a" style="width:50px"></span><span id="b" style="width:50px"></span></span>', (b) => b('c').width === 110],
  ['grid 3 equal fr', d('c', 'display:grid;grid-template-columns:1fr 1fr 1fr;width:600px', d('a', '') + d('b', '') + d('e', '')), (b) => b('b').x === 200 && b('e').x === 400],
  ['grid repeat + gap', d('c', 'display:grid;grid-template-columns:repeat(2,1fr);gap:20px;width:600px', d('a', 'height:10px') + d('b', 'height:10px') + d('e', 'height:10px')), (b) => b('b').x === 310 && b('e').y === 30],
  ['grid px + fr', d('c', 'display:grid;grid-template-columns:100px 1fr;width:600px', d('a', '') + d('b', '')), (b) => b('b').x === 100 && b('b').width === 500],
  ['grid column span', d('c', 'display:grid;grid-template-columns:repeat(3,1fr);width:600px', d('a', 'grid-column:span 2;height:10px') + d('b', 'height:10px')), (b) => b('a').width === 400 && b('b').x === 400],
  ['grid explicit placement', d('c', 'display:grid;grid-template-columns:repeat(3,1fr);width:600px', d('a', 'grid-column:3;grid-row:1;height:10px')), (b) => b('a').x === 400],
  ['grid auto-fill minmax', d('c', 'display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));width:600px', d('a', 'height:10px') + d('b', '') + d('e', '') + d('f', '') + d('g', 'height:10px')), (b) => b('b').x === 150 && b('g').x === 0 && b('g').y > 0],
  ['grid template areas', d('c', 'display:grid;grid-template-columns:100px 1fr;grid-template-areas:\'s m\';width:600px', d('a', 'grid-area:m') + d('b', 'grid-area:s')), (b) => b('a').x === 100 && b('b').x === 0],
  ['grid place-items center', d('c', 'display:grid;place-items:center;width:600px;height:100px', d('a', 'width:100px;height:20px')), (b) => b('a').x === 250 && b('a').y === 40],
  ['grid rows template', d('c', 'display:grid;grid-template-rows:50px 1fr;height:200px', d('a', '') + d('b', '')), (b) => b('b').y === 50 && b('b').height === 150],
  ['grid row height = tallest', d('c', 'display:grid;grid-template-columns:1fr 1fr', d('a', 'height:40px') + d('b', '') + d('e', 'height:10px')), (b) => b('b').height === 40 && b('e').y === 40],
  ['flex item percentage width', d('c', 'display:flex;width:600px', d('a', 'width:25%')), (b) => b('a').width === 150],
  ['flex padding container', d('c', 'display:flex;width:600px;padding:10px', d('a', 'flex:1')), (b) => b('a').x === 10 && b('a').width === 580],
];

describe('flexbox and grid layout (1.72 probe)', () => {
  it.each(CASES)('%s', async (_name, html, check) => {
    const { box, r } = await page(html);
    expect(check(box)).toBe(true);
    r.dispose();
  });
});
