/**
 * 1.74: a 51-case positioning/sizing/margin probe (45 passed first). em in calc() used the parent's
 * font, aspect-ratio needed an explicit width, parent/first-child and empty-block margins didn't
 * collapse, vertical-align middle/top/bottom on inline-blocks and images was baseline, and
 * transformed ancestors didn't contain fixed boxes.
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
  ['abs top/left in relative', d('c', 'position:relative;margin:20px;height:100px', d('a', 'position:absolute;top:10px;left:15px;width:5px;height:5px')), (b) => b('a').x === 35 && b('a').y === 30],
  ['abs right/bottom', d('c', 'position:relative;width:200px;height:100px', d('a', 'position:absolute;right:10px;bottom:10px;width:20px;height:20px')), (b) => b('a').x === 170 && b('a').y === 70],
  ['abs left+right stretch', d('c', 'position:relative;width:200px;height:50px', d('a', 'position:absolute;left:10px;right:30px;height:5px')), (b) => b('a').width === 160],
  ['abs top+bottom stretch', d('c', 'position:relative;width:200px;height:100px', d('a', 'position:absolute;top:10px;bottom:20px;width:5px')), (b) => b('a').height === 70],
  ['abs inset:0 margin:auto centre', d('c', 'position:relative;width:200px;height:100px', d('a', 'position:absolute;inset:0;margin:auto;width:50px;height:20px')), (b) => b('a').x === 75 && b('a').y === 40],
  ['abs % width', d('c', 'position:relative;width:200px;height:100px', d('a', 'position:absolute;width:50%;height:10px')), (b) => b('a').width === 100],
  ['abs static position', d('c', 'position:relative;padding:10px', d('x', 'height:30px') + d('a', 'position:absolute;width:5px;height:5px')), (b) => b('a').y === 40 && b('a').x === 10],
  ['relative offset', d('c', '', d('a', 'position:relative;top:5px;left:7px;height:10px') + d('b', 'height:10px')), (b) => b('a').y === 5 && b('a').x === 7 && b('b').y === 10],
  ['fixed in viewport', d('c', 'height:2000px', d('a', 'position:fixed;bottom:0;right:0;width:50px;height:40px')), (b) => b('a').x === 550 && b('a').y === 720],
  ['abs nested containing block', d('c', 'position:relative;margin-left:50px;width:300px;height:100px', d('m', 'width:100px', d('a', 'position:absolute;right:0;top:0;width:10px;height:10px'))), (b) => b('a').x === 340],
  ['transform makes containing block', d('c', 'transform:translateX(0);margin-left:40px;width:300px;height:50px', d('a', 'position:fixed;left:10px;top:0;width:10px;height:10px')), (b) => b('a').x === 50],
  ['sticky stays in flow', d('c', '', d('a', 'position:sticky;top:0;height:20px') + d('b', 'height:10px')), (b) => b('b').y === 20],
  ['max-width', d('a', 'max-width:300px'), (b) => b('a').width === 300],
  ['min-width over width', d('a', 'width:100px;min-width:150px;height:5px'), (b) => b('a').width === 150],
  ['max-width beats width', d('a', 'width:500px;max-width:200px;height:5px'), (b) => b('a').width === 200],
  ['min-height', d('a', 'min-height:80px'), (b) => b('a').height === 80],
  ['max-height clamps', d('a', 'max-height:30px;overflow:hidden', d('x', 'height:100px')), (b) => b('a').height === 30],
  ['height % of definite parent', d('c', 'height:200px', d('a', 'height:50%')), (b) => b('a').height === 100],
  ['calc width', d('a', 'width:calc(100% - 40px);height:5px'), (b) => b('a').width === 560],
  ['calc nested', d('a', 'width:calc((100% - 20px) / 2);height:5px'), (b) => b('a').width === 290],
  ['calc em', d('a', 'font-size:10px;width:calc(2em + 5px);height:5px'), (b) => b('a').width === 25],
  ['min() max() clamp()', d('a', 'width:min(50%, 200px);height:5px') + d('b', 'width:max(10px, 20%);height:5px') + d('e', 'width:clamp(100px, 10%, 300px);height:5px'), (b) => b('a').width === 200 && b('b').width === 120 && b('e').width === 100],
  ['vw vh', d('a', 'width:50vw;height:10vh'), (b) => b('a').width === 300 && b('a').height === 76],
  ['rem', '<style>html{font-size:20px}</style>' + d('a', 'width:3rem;height:1rem'), (b) => b('a').width === 60 && b('a').height === 20],
  ['aspect-ratio', d('a', 'width:200px;aspect-ratio:2/1'), (b) => b('a').height === 100],
  ['aspect-ratio 16/9 auto width', d('a', 'aspect-ratio:16/9'), (b) => Math.round(b('a').height) === 338],
  ['margin auto centre block', d('a', 'width:200px;margin:0 auto;height:5px'), (b) => b('a').x === 200],
  ['margin-left auto right-align', d('a', 'width:200px;margin-left:auto;height:5px'), (b) => b('a').x === 400],
  ['negative margin', d('a', 'height:20px') + d('b', 'margin-top:-10px;height:20px'), (b) => b('b').y === 10],
  ['padding %', d('c', 'width:400px', d('a', 'padding-top:25%')), (b) => b('a').height === 100],
  ['display:contents', d('c', 'display:flex', '<div style="display:contents">' + d('a', 'width:50px;height:5px') + d('b', 'width:50px;height:5px') + '</div>'), (b) => b('b').x === 50 && b('b').y === b('a').y],
  ['visibility hidden keeps space', d('a', 'visibility:hidden;height:30px') + d('b', 'height:5px'), (b) => b('b').y === 30],
  ['::before block adds height', '<style>#a::before{content:"";display:block;height:25px}</style>' + d('a', ''), (b) => b('a').height === 25],
  ['::after clearfix', '<style>#c::after{content:"";display:table;clear:both}</style>' + d('c', '', d('a', 'float:left;width:10px;height:40px')), (b) => b('c').height === 40],
  ['overflow hidden contains float', d('c', 'overflow:hidden', d('a', 'float:left;width:10px;height:40px')), (b) => b('c').height === 40],
  ['display:flow-root contains float', d('c', 'display:flow-root', d('a', 'float:left;width:10px;height:40px')), (b) => b('c').height === 40],
  ['inline-block side by side', '<div id="c"><span id="a" style="display:inline-block;width:100px;height:20px"></span><span id="b" style="display:inline-block;width:100px;height:20px"></span></div>', (b) => b('b').y === b('a').y && b('b').x >= 100],
  ['inline-block vertical-align middle', '<div id="c" style="line-height:40px"><span id="a" style="display:inline-block;width:10px;height:10px;vertical-align:middle"></span>x</div>', (b) => b('a').y > 10 && b('a').y < 25],
  ['img block width 100%', d('c', 'width:300px', '<img id="a" style="display:block;width:100%;height:50px">'), (b) => b('a').width === 300],
  ['box-sizing content-box', '<div id="a" style="box-sizing:content-box;width:100px;padding:10px;border:5px solid;height:10px"></div>', (b) => b('a').width === 130 && b('a').height === 40],
  ['border-box', '<div id="a" style="box-sizing:border-box;width:100px;padding:10px;border:5px solid;height:50px"></div>', (b) => b('a').width === 100 && b('a').height === 50],
  ['margin collapse parent-child', d('c', '', d('a', 'margin-top:30px;height:10px')) + d('b', 'height:5px'), (b) => b('c').y === 30 && b('b').y === 40],
  ['no collapse with padding', d('c', 'padding-top:1px', d('a', 'margin-top:30px;height:10px')), (b) => b('a').y === 31],
  ['empty block margins collapse', d('a', 'margin-bottom:20px;height:5px') + d('e', 'margin:10px 0') + d('b', 'height:5px'), (b) => b('b').y === 25],
  ['line-height sets text height', d('a', 'line-height:30px', 'text'), (b) => b('a').height === 30],
  ['white-space nowrap no wrap', d('a', 'white-space:nowrap;width:50px', 'aaaa bbbb cccc dddd eeee'), (b) => b('a').height === 20],
  ['br line break', d('a', '', 'one<br>two<br>three'), (b) => b('a').height === 60],
  ['hidden attribute', '<div id="a" hidden style="height:20px"></div>' + d('b', 'height:5px'), (b) => b('b').y === 0],
  ['ul padding', '<ul id="a" style="margin:0"><li id="b">x</li></ul>', (b) => b('b').x === 40],
  ['h1 default margins', '<h1 id="a" style="font-size:32px;line-height:40px">T</h1>', (b) => Math.round(b('a').y) === 21],
  ['p default margins', '<p id="a" style="line-height:20px">x</p><p id="b" style="line-height:20px">y</p>', (b) => b('a').y === 16 && b('b').y === 52],
];

describe('positioning, sizing and margins (1.74 probe)', () => {
  it.each(CASES)('%s', async (_name, html, check) => {
    const { box, r } = await page(html);
    expect(check(box)).toBe(true);
    r.dispose();
  });
});
