/**
 * 1.75: a 61-case cascade / CSS values probe (51 passed first). Logical properties (padding-inline,
 * margin-block, inline-size…) were dropped; invalid declarations replaced valid ones; var() to a
 * missing property left an empty value instead of acting as unset; `all:`, `@supports selector()`,
 * flex longhands and <small>'s UA size were missing.
 */
import { describe, expect, it, vi } from 'vitest';
import { DomTree } from '../src/browser/rendering/dom-tree';
import { HtmlParser } from '../src/browser/rendering/html-parser';
import { CssParser } from '../src/browser/rendering/css-parser';
import { LayoutEngine } from '../src/browser/rendering/layout-engine';
import { PaintEngine } from '../src/browser/rendering/paint-engine';
import { PageRenderer } from '../src/browser/engine/page-renderer';

type Q = { cs: (id: string, prop: string) => string | undefined; w: (id: string) => number; h: (id: string) => number; x: (id: string) => number };
async function page(css: string, body: string) {
  const domTree = new DomTree(); const layout = new LayoutEngine();
  const r = new PageRenderer({ htmlParser: new HtmlParser(), domTree, cssParser: new CssParser(), layoutEngine: layout, paintEngine: new PaintEngine(), svgDecode: async () => null,
    resourceLoader: { loadResource: vi.fn(), loadBatch: vi.fn(), loadStylesheet: vi.fn().mockResolvedValue(''), loadScript: vi.fn().mockResolvedValue(''), loadImage: vi.fn(), getPriority: vi.fn(), setMaxConcurrent: vi.fn(), on: vi.fn(), off: vi.fn(), dispose: vi.fn() },
    prioritizer: { submit: vi.fn(), submitBatch: vi.fn(), submitPreload: vi.fn(), submitPrefetch: vi.fn(), submitPreconnect: vi.fn(), clear: vi.fn(), dispose: vi.fn() } } as never);
  r.setViewport(600, 760, 1);
  await r.render({ url: 'http://t.local/', statusCode: 200, contentType: 'text/html', headers: new Map(), loadedAt: 0, body: `<html><head><style>${css}</style></head><body style="margin:0">${body}</body></html>` } as never, new AbortController().signal);
  const el = (id: string) => domTree.getElementById(id)!;
  const box = (id: string) => layout.getLayoutBox(el(id).domId)!;
  const q: Q = { cs: (id, p) => el(id).computedStyle?.get(p), w: (id) => box(id).width, h: (id) => box(id).height, x: (id) => box(id).x };
  return { q, r };
}
const rgb = (v: string | undefined) => (v ?? '').replace(/\s+/g, '').toLowerCase();
const CASES: Array<[string, string, string, (q: Q) => unknown]> = [
  // inheritance & keywords
  ['color inherits', '#p{color:rgb(255,0,0)}', '<div id="p"><span id="a">x</span></div>', (q) => rgb(q.cs('a', 'color')) === 'rgb(255,0,0)' || q.cs('a', 'color')],
  ['border not inherited', '#p{border:2px solid red}', '<div id="p"><span id="a">x</span></div>', (q) => (q.cs('a', 'border-top-width') ?? '0px') === '0px' || q.cs('a', 'border-top-width')],
  ['inherit keyword', '#p{width:200px} #a{width:inherit;height:5px}', '<div id="p"><div id="a"></div></div>', (q) => q.w('a') === 200 || q.w('a')],
  ['initial keyword', '#p{color:red} #a{color:initial}', '<div id="p"><span id="a">x</span></div>', (q) => /^(rgb\(0,0,0\)|#000|#000000|black|canvastext)$/.test(rgb(q.cs('a', 'color'))) || q.cs('a', 'color')],
  ['unset inherited prop', '#p{color:rgb(0,0,255)} #a{color:unset}', '<div id="p"><span id="a">x</span></div>', (q) => rgb(q.cs('a', 'color')) === 'rgb(0,0,255)' || q.cs('a', 'color')],
  ['unset non-inherited', '#a{display:unset}', '<div id="a">x</div>', (q) => q.cs('a', 'display') === 'inline' || q.cs('a', 'display')],
  ['all: unset', '#a{all:unset}', '<div id="a" style="">x</div>', (q) => q.cs('a', 'display') === 'inline' || q.cs('a', 'display')],
  ['font-size em chain', '#p{font-size:20px} #a{font-size:1.5em}', '<div id="p"><div id="a">x</div></div>', (q) => q.cs('a', 'font-size') === '30px' || q.cs('a', 'font-size')],
  ['font-size %', '#p{font-size:20px} #a{font-size:50%}', '<div id="p"><div id="a">x</div></div>', (q) => q.cs('a', 'font-size') === '10px' || q.cs('a', 'font-size')],
  ['line-height number inherits as factor', '#p{font-size:10px;line-height:2} #a{font-size:20px}', '<div id="p"><div id="a">x</div></div>', (q) => q.h('a') === 40 || q.h('a')],
  // custom properties
  ['var basic', ':root{--w:123px} #a{width:var(--w);height:5px}', '<div id="a"></div>', (q) => q.w('a') === 123 || q.w('a')],
  // 1.92: custom property names are case-sensitive; they were lowercased, so Google's
  // var(--bbQxAb) found nothing (footer links white on the tablet, black offline).
  ['var mixed-case name', ':root{--bbQxAb:rgb(78,80,89)} #a{color:var(--bbQxAb)}', '<span id="a">x</span>', (q) => rgb(q.cs('a', 'color')) === 'rgb(78,80,89)' || q.cs('a', 'color')],
  ['var names differing only in case stay distinct', ':root{--W:50px;--w:20px} #a{width:var(--W);height:5px}', '<div id="a"></div>', (q) => q.w('a') === 50 || q.w('a')],
  ['var mixed-case inline', '#a{width:var(--Wd);height:5px}', '<div id="a" style="--Wd:44px"></div>', (q) => q.w('a') === 44 || q.w('a')],
  ['var fallback', '#a{width:var(--nope, 77px);height:5px}', '<div id="a"></div>', (q) => q.w('a') === 77 || q.w('a')],
  ['var nested fallback', '#a{width:var(--x, var(--y, 66px));height:5px}', '<div id="a"></div>', (q) => q.w('a') === 66 || q.w('a')],
  ['var inherits', '#p{--c:rgb(0,128,0)} #a{color:var(--c)}', '<div id="p"><span id="a">x</span></div>', (q) => rgb(q.cs('a', 'color')) === 'rgb(0,128,0)' || q.cs('a', 'color')],
  ['var in calc', ':root{--g:10px} #a{width:calc(var(--g) * 3);height:5px}', '<div id="a"></div>', (q) => q.w('a') === 30 || q.w('a')],
  ['var overridden in child scope', ':root{--w:10px} #p{--w:40px} #a{width:var(--w);height:5px}', '<div id="p"><div id="a"></div></div>', (q) => q.w('a') === 40 || q.w('a')],
  ['var references var', ':root{--a:12px;--b:var(--a)} #a{width:var(--b);height:5px}', '<div id="a"></div>', (q) => q.w('a') === 12 || q.w('a')],
  ['var in shorthand', ':root{--m:0 0 0 30px} #a{margin:var(--m);height:5px}', '<div id="a"></div>', (q) => q.x('a') === 30 || q.x('a')],
  ['invalid var → unset', '#p{color:rgb(1,2,3)} #a{color:var(--missing)}', '<div id="p"><span id="a">x</span></div>', (q) => rgb(q.cs('a', 'color')) === 'rgb(1,2,3)' || q.cs('a', 'color')],
  // specificity & order
  ['id beats class', '#a{width:100px} .c{width:200px} #a{height:5px}', '<div id="a" class="c"></div>', (q) => q.w('a') === 100 || q.w('a')],
  ['later wins same specificity', '.c{width:100px;height:5px} .c{width:150px}', '<div id="a" class="c"></div>', (q) => q.w('a') === 150 || q.w('a')],
  ['!important beats id', '#a{width:100px;height:5px} div{width:50px !important}', '<div id="a"></div>', (q) => q.w('a') === 50 || q.w('a')],
  ['inline beats id', '#a{width:100px;height:5px}', '<div id="a" style="width:70px"></div>', (q) => q.w('a') === 70 || q.w('a')],
  ['!important beats inline', '#a{width:100px !important;height:5px}', '<div id="a" style="width:70px"></div>', (q) => q.w('a') === 100 || q.w('a')],
  [':where zero specificity', ':where(#a){width:100px} div{width:60px;height:5px}', '<div id="a"></div>', (q) => q.w('a') === 60 || q.w('a')],
  [':is takes max specificity', ':is(#a, .x){width:100px} .y{width:60px} div{height:5px}', '<div id="a" class="y"></div>', (q) => q.w('a') === 100 || q.w('a')],
  ['@layer: unlayered wins', '@layer base{#a{width:100px}} div{width:60px;height:5px}', '<div id="a"></div>', (q) => q.w('a') === 60 || q.w('a')],
  // at-rules
  ['@media min-width match', '@media (min-width: 500px){#a{width:100px}} #a{height:5px}', '<div id="a"></div>', (q) => q.w('a') === 100 || q.w('a')],
  ['@media max-width no match', '#a{width:100px;height:5px} @media (max-width: 500px){#a{width:50px}}', '<div id="a"></div>', (q) => q.w('a') === 100 || q.w('a')],
  ['@media range syntax', '@media (width >= 500px){#a{width:100px}} #a{height:5px}', '<div id="a"></div>', (q) => q.w('a') === 100 || q.w('a')],
  ['@media and/or/not', '@media screen and (min-width: 100px), print{#a{width:90px}} @media not print{#a{height:5px}}', '<div id="a"></div>', (q) => (q.w('a') === 90 && q.h('a') === 5) || [q.w('a'), q.h('a')]],
  ['@media orientation', '@media (orientation: portrait){#a{width:80px}} #a{height:5px}', '<div id="a"></div>', (q) => q.w('a') === 80 || q.w('a')],
  ['@supports match', '@supports (display: grid){#a{width:100px}} #a{height:5px}', '<div id="a"></div>', (q) => q.w('a') === 100 || q.w('a')],
  ['@supports not', '@supports not (display: nonsense){#a{width:110px}} #a{height:5px}', '<div id="a"></div>', (q) => q.w('a') === 110 || q.w('a')],
  ['@supports selector()', '@supports selector(:has(a)){#a{width:120px}} #a{height:5px}', '<div id="a"></div>', (q) => q.w('a') === 120 || q.w('a')],
  ['nested @media in @supports', '@supports (display:flex){@media (min-width:1px){#a{width:130px}}} #a{height:5px}', '<div id="a"></div>', (q) => q.w('a') === 130 || q.w('a')],
  ['CSS nesting &', '.p{ & #a{width:140px;height:5px} }', '<div class="p"><div id="a"></div></div>', (q) => q.w('a') === 140 || q.w('a')],
  ['CSS nesting implicit', '.p{ #a{width:150px;height:5px} }', '<div class="p"><div id="a"></div></div>', (q) => q.w('a') === 150 || q.w('a')],
  // shorthands
  ['margin 3 values', '#a{margin:1px 2px 3px;height:5px}', '<div id="a"></div>', (q) => (q.cs('a', 'margin-left') === '2px' && q.cs('a', 'margin-bottom') === '3px') || [q.cs('a', 'margin-left'), q.cs('a', 'margin-bottom')]],
  ['padding-inline', '#a{padding-inline:7px;height:5px}', '<div id="a"></div>', (q) => q.cs('a', 'padding-left') === '7px' && q.cs('a', 'padding-right') === '7px' || [q.cs('a', 'padding-left'), q.cs('a', 'padding-right')]],
  ['margin-block', '#a{margin-block:9px;height:5px} #b{height:5px}', '<div id="a"></div><div id="b"></div>', (q) => q.cs('a', 'margin-top') === '9px' && q.cs('a', 'margin-bottom') === '9px' || [q.cs('a', 'margin-top'), q.cs('a', 'margin-bottom')]],
  ['inline-size', '#a{inline-size:111px;block-size:12px}', '<div id="a"></div>', (q) => (q.w('a') === 111 && q.h('a') === 12) || [q.w('a'), q.h('a')]],
  ['border shorthand', '#a{border:3px dashed rgb(0,0,255)}', '<div id="a"></div>', (q) => (q.cs('a', 'border-left-width') === '3px' && q.cs('a', 'border-left-style') === 'dashed') || [q.cs('a', 'border-left-width'), q.cs('a', 'border-left-style')]],
  ['border-width 2 values', '#a{border-style:solid;border-width:1px 4px}', '<div id="a"></div>', (q) => q.cs('a', 'border-right-width') === '4px' || q.cs('a', 'border-right-width')],
  ['font shorthand', '#a{font:italic bold 20px/30px serif}', '<div id="a">x</div>', (q) => (q.cs('a', 'font-size') === '20px' && q.cs('a', 'font-style') === 'italic' && /700|bold/.test(q.cs('a', 'font-weight') ?? '') && q.h('a') === 30) || [q.cs('a', 'font-size'), q.cs('a', 'font-style'), q.cs('a', 'font-weight'), q.h('a')]],
  ['background shorthand color', '#a{background:url(x.png) no-repeat center / cover rgb(0,255,0)}', '<div id="a"></div>', (q) => rgb(q.cs('a', 'background-color')) === 'rgb(0,255,0)' || q.cs('a', 'background-color')],
  ['flex shorthand none', '#a{flex:none}', '<div style="display:flex"><div id="a"></div></div>', (q) => (q.cs('a', 'flex-grow') === '0' && q.cs('a', 'flex-shrink') === '0') || [q.cs('a', 'flex-grow'), q.cs('a', 'flex-shrink')]],
  ['inset shorthand', '#a{position:absolute;inset:5px 10px;}', '<div style="position:relative;width:200px;height:100px"><div id="a"></div></div>', (q) => (q.w('a') === 180 && q.h('a') === 90) || [q.w('a'), q.h('a')]],
  ['gap shorthand 2 values', '#c{display:flex;flex-wrap:wrap;gap:4px 8px;width:100px} #a,#b{width:40px;height:10px}', '<div id="c"><div id="a"></div><div id="b"></div></div>', (q) => q.x('b') === 48 || q.x('b')],
  // colours
  ['hex 3', '#a{color:#f00}', '<span id="a">x</span>', (q) => /^(rgb\(255,0,0\)|#f00|#ff0000)$/.test(rgb(q.cs('a', 'color'))) || q.cs('a', 'color')],
  ['hsl', '#a{color:hsl(120, 100%, 25%)}', '<span id="a">x</span>', (q) => /^(rgb\(0,128,0\)|rgb\(0,127,0\)|#008000|hsl.*)$/.test(rgb(q.cs('a', 'color'))) || q.cs('a', 'color')],
  ['currentColor in border', '#a{color:rgb(9,9,9);border:1px solid currentColor}', '<div id="a"></div>', (q) => /rgb\(9,9,9\)|#090909/.test(rgb(q.cs('a', 'border-top-color'))) || q.cs('a', 'border-top-color')],
  // misc
  ['display:none on ancestor hides child box', '#p{display:none}', '<div id="p"><div id="a" style="height:10px"></div></div><div id="b" style="height:5px"></div>', (q) => q.cs('b', 'height') === '5px'],
  ['attribute selector case-insensitive', '[data-x="ABC" i]{width:88px;height:5px}', '<div id="a" data-x="abc"></div>', (q) => q.w('a') === 88 || q.w('a')],
  ['::first-line no crash', 'p::first-line{color:red} #a{width:10px;height:5px}', '<p>x</p><div id="a"></div>', (q) => q.w('a') === 10],
  ['comments and weird whitespace', '/* c */ #a /* c */ { width : 101px ; height:5px /* c */ }', '<div id="a"></div>', (q) => q.w('a') === 101 || q.w('a')],
  ['invalid declaration ignored', '#a{width:90px;width:banana;height:5px}', '<div id="a"></div>', (q) => q.w('a') === 90 || q.w('a')],
  ['UA: button inline-block', '', '<button id="a">b</button>', (q) => q.cs('a', 'display') === 'inline-block' || q.cs('a', 'display')],
  ['UA: h2 bold 1.5em', '', '<h2 id="a">x</h2>', (q) => (q.cs('a', 'font-size') === '24px' && /700|bold/.test(q.cs('a', 'font-weight') ?? '')) || [q.cs('a', 'font-size'), q.cs('a', 'font-weight')]],
  ['UA: small 0.83em-ish', '', '<small id="a">x</small>', (q) => /^1[23](\.\d+)?px$/.test(q.cs('a', 'font-size') ?? '') || q.cs('a', 'font-size')],
];

describe('cascade, custom properties, at-rules, shorthands (1.75 probe)', () => {
  it.each(CASES)('%s', async (_name, css, body, check) => {
    const { q, r } = await page(css, body);
    expect(check(q)).toBe(true);
    r.dispose();
  });
});
