/**
 * 1.65: a 41-case probe of everyday CSS layout against spec values. 26 passed before this round.
 */
import { describe, expect, it, vi } from 'vitest';
import { DomTree } from '../src/browser/rendering/dom-tree';
import { HtmlParser } from '../src/browser/rendering/html-parser';
import { CssParser } from '../src/browser/rendering/css-parser';
import { LayoutEngine } from '../src/browser/rendering/layout-engine';
import { PaintEngine } from '../src/browser/rendering/paint-engine';
import { PageRenderer } from '../src/browser/engine/page-renderer';
import { parseFlexShorthand } from '../src/browser/rendering/layout-engine';
import { resolveMathFunctions } from '../src/browser/rendering/css5/math-functions';
import { expandTrackList } from '../src/browser/rendering/formatting/grid-context';

type P = 'x' | 'y' | 'width' | 'height';
const CASES: Array<[string, string, string, P, number]> = [
  ['aspect-ratio', '<div id="t" style="width:200px;aspect-ratio:16/9"></div>', 't', 'height', 112.5],
  ['margin auto centre', '<div id="t" style="width:200px;margin:0 auto;height:10px"></div>', 't', 'x', 200],
  ['space-between', '<div style="display:flex;justify-content:space-between"><i style="width:50px;height:5px"></i><i id="t" style="width:50px;height:5px"></i><i style="width:50px;height:5px"></i></div>', 't', 'x', 275],
  ['flex-wrap', '<div style="display:flex;flex-wrap:wrap"><i style="width:250px;height:20px"></i><i style="width:250px;height:20px"></i><i id="t" style="width:250px;height:20px"></i></div>', 't', 'y', 20],
  ['flex:1', '<div style="display:flex"><i id="t" style="flex:1;height:5px"></i><i style="flex:1;height:5px"></i></div>', 't', 'width', 300],
  ['flex:2 vs 1', '<div style="display:flex"><i id="t" style="flex:2;height:5px"></i><i style="flex:1;height:5px"></i></div>', 't', 'width', 400],
  ['align-items center', '<div style="display:flex;align-items:center;height:100px"><i id="t" style="width:10px;height:20px"></i></div>', 't', 'y', 40],
  ['margin-left auto in flex', '<div style="display:flex"><i style="width:10px;height:5px"></i><i id="t" style="width:10px;height:5px;margin-left:auto"></i></div>', 't', 'x', 590],
  ['flex column', '<div style="display:flex;flex-direction:column"><i style="height:30px"></i><i id="t" style="height:30px"></i></div>', 't', 'y', 30],
  ['order', '<div style="display:flex"><i style="width:50px;height:5px"></i><i id="t" style="width:50px;height:5px;order:-1"></i></div>', 't', 'x', 0],
  ['flex gap', '<div style="display:flex;gap:10px"><i style="width:50px;height:5px"></i><i id="t" style="width:50px;height:5px"></i></div>', 't', 'x', 60],
  ['flex-basis', '<div style="display:flex"><i id="t" style="flex:0 0 120px;height:5px"></i></div>', 't', 'width', 120],
  ['grid 1fr x3', '<div style="display:grid;grid-template-columns:repeat(3,1fr)"><i></i><i id="t"></i><i></i></div>', 't', 'x', 200],
  ['grid auto-fill minmax', '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr))"><i></i><i></i><i></i><i id="t"></i></div>', 't', 'x', 450],
  ['grid fr + px', '<div style="display:grid;grid-template-columns:100px 1fr"><i></i><i id="t"></i></div>', 't', 'width', 500],
  ['grid areas', '<div style="display:grid;grid-template-columns:100px 1fr;grid-template-areas:\'a b\'"><i id="t" style="grid-area:b"></i><i style="grid-area:a"></i></div>', 't', 'x', 100],
  ['grid gap rows', '<div style="display:grid;grid-template-columns:1fr;row-gap:10px"><i style="height:20px"></i><i id="t" style="height:20px"></i></div>', 't', 'y', 30],
  ['grid span 2', '<div style="display:grid;grid-template-columns:repeat(3,100px)"><i id="t" style="grid-column:span 2"></i></div>', 't', 'width', 200],
  ['max-width', '<div id="t" style="width:50%;max-width:200px;height:5px"></div>', 't', 'width', 200],
  ['min-width', '<div id="t" style="width:10%;min-width:100px;height:5px"></div>', 't', 'width', 100],
  ['border-box', '<div id="t" style="box-sizing:border-box;width:100px;padding:10px;border:5px solid"></div>', 't', 'width', 100],
  ['content-box', '<div id="t" style="width:100px;padding:10px;border:5px solid"></div>', 't', 'width', 130],
  ['inline-blocks', '<span style="display:inline-block;width:100px;height:10px"></span><span id="t" style="display:inline-block;width:100px;height:10px"></span>', 't', 'x', 100],
  ['float left', '<div style="float:left;width:100px;height:50px"></div><p id="t" style="margin:0">text</p>', 't', 'x', 0],
  ['calc', '<div id="t" style="width:calc(100% - 40px);height:5px"></div>', 't', 'width', 560],
  ['min()', '<div id="t" style="width:min(300px, 80%);height:5px"></div>', 't', 'width', 300],
  ['vh', '<div id="t" style="height:50vh"></div>', 't', 'height', 380],
  ['vw', '<div id="t" style="width:50vw;height:5px"></div>', 't', 'width', 300],
  ['% height', '<div style="height:200px"><div id="t" style="height:50%"></div></div>', 't', 'height', 100],
  ['abs inset 0', '<div style="position:relative;width:300px;height:100px"><div id="t" style="position:absolute;inset:0"></div></div>', 't', 'width', 300],
  ['abs centre transform-free', '<div style="position:relative;width:300px;height:100px"><div id="t" style="position:absolute;left:0;right:0;margin:auto;width:100px;height:10px"></div></div>', 't', 'x', 100],
  ['abs centre vertical', '<div style="position:relative;width:300px;height:100px"><div id="t" style="position:absolute;inset:0;margin:auto;width:100px;height:40px"></div></div>', 't', 'y', 30],
  ['margin collapse', '<p style="margin:16px 0;height:20px"></p><p id="t" style="margin:16px 0;height:20px"></p>', 't', 'y', 52],
  ['line-height 2', '<p id="t" style="margin:0;font-size:16px;line-height:2">x</p>', 't', 'height', 32],
  ['fit-content', '<div style="display:block"><div id="t" style="width:fit-content;font-size:16px">abc</div></div>', 't', 'width', -1],
  ['display contents', '<div style="display:flex"><div style="display:contents"><i style="width:50px;height:5px"></i><i id="t" style="width:50px;height:5px"></i></div></div>', 't', 'x', 50],
  ['text-align center', '<div style="text-align:center"><span id="t" style="display:inline-block;width:100px;height:10px"></span></div>', 't', 'x', 250],
  ['padding %', '<div id="t" style="padding-left:10%;width:100px;height:5px"></div>', 't', 'width', 160],
  ['em padding', '<div id="t" style="font-size:20px;padding:1em;width:100px"></div>', 't', 'width', 140],
  ['flex shrink', '<div style="display:flex;width:300px"><i id="t" style="width:200px;height:5px"></i><i style="width:200px;height:5px"></i></div>', 't', 'width', 150],
  ['flex min-width 0 text', '<div style="display:flex;width:200px"><span id="t" style="flex:1">aaaa</span><span style="width:150px"></span></div>', 't', 'width', 50],
];

describe('CSS layout matches the spec', () => {
  it.each(CASES)('%s', async (_name, html, id, prop, want) => {
    const domTree = new DomTree(); const layout = new LayoutEngine();
    const r = new PageRenderer({ htmlParser: new HtmlParser(), domTree, cssParser: new CssParser(), layoutEngine: layout, paintEngine: new PaintEngine(), svgDecode: async () => null,
      resourceLoader: { loadResource: vi.fn(), loadBatch: vi.fn(), loadStylesheet: vi.fn().mockResolvedValue(''), loadScript: vi.fn().mockResolvedValue(''), loadImage: vi.fn(), getPriority: vi.fn(), setMaxConcurrent: vi.fn(), on: vi.fn(), off: vi.fn(), dispose: vi.fn() },
      prioritizer: { submit: vi.fn(), submitBatch: vi.fn(), submitPreload: vi.fn(), submitPrefetch: vi.fn(), submitPreconnect: vi.fn(), clear: vi.fn(), dispose: vi.fn() } } as never);
    r.setViewport(600, 760, 1);
    await r.render({ url: 'http://t.local/', statusCode: 200, contentType: 'text/html', headers: new Map(), loadedAt: 0,
      body: `<html><head><style>i{display:block}</style></head><body style="margin:0">${html}</body></html>` } as never, new AbortController().signal);
    const got = layout.getLayoutBox(domTree.getElementById(id)!.domId)![prop];
    if (want === -1) { expect(got).toBeGreaterThan(0); expect(got).toBeLessThan(100); } // fit-content: the text's width
    else expect(Math.abs(got - want)).toBeLessThanOrEqual(1);
    r.dispose();
  });
});

describe('parsers behind those layouts', () => {
  it('flex shorthand per CSS Flexbox §7.2', () => {
    expect(parseFlexShorthand('0 0 120px')).toEqual({ grow: 0, shrink: 0, basis: '120px' });
    expect(parseFlexShorthand('none')).toEqual({ grow: 0, shrink: 0, basis: 'auto' });
    expect(parseFlexShorthand('1')).toEqual({ grow: 1, shrink: 1, basis: '0%' });
    expect(parseFlexShorthand('1 200px')).toEqual({ grow: 1, shrink: 1, basis: '200px' });
    expect(parseFlexShorthand('2 3')).toEqual({ grow: 2, shrink: 3, basis: '0%' });
    expect(parseFlexShorthand('120px')).toEqual({ grow: 1, shrink: 1, basis: '120px' });
  });
  it('math functions leave minmax() alone', () => {
    expect(resolveMathFunctions('repeat(auto-fill,minmax(150px,1fr))')).toBe('repeat(auto-fill,minmax(150px,1fr))');
    expect(resolveMathFunctions('max(10px, 20px)')).toBe('20px');
  });
  it('track lists: repeat, auto-fill and minmax expand to plain tracks', () => {
    expect(expandTrackList('repeat(3, minmax(0, 1fr))', 600, 0, 16)).toEqual(['1fr', '1fr', '1fr']);
    expect(expandTrackList('repeat(auto-fill,minmax(150px,1fr))', 600, 0, 16)).toEqual(['1fr', '1fr', '1fr', '1fr']);
    expect(expandTrackList('repeat(auto-fill, minmax(150px, 1fr))', 600, 20, 16)).toHaveLength(3);
    expect(expandTrackList('[a] 100px [b] fit-content(200px) 1fr', 600, 0, 16)).toEqual(['100px', 'auto', '1fr']);
  });
});
