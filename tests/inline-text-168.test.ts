/**
 * 1.68: a 34-case probe of inline text layout (20 passed). Fixes: text beside floats, inline
 * padding/margin/border, text-indent, breaking long words, word-spacing, dir="rtl", tabs, ch/ex.
 * Positions use Node's text measurer (spaces ~2px, "0" ~5.3px), so expectations are relative.
 */
import { describe, expect, it, vi } from 'vitest';
import { DomTree } from '../src/browser/rendering/dom-tree';
import { HtmlParser } from '../src/browser/rendering/html-parser';
import { CssParser } from '../src/browser/rendering/css-parser';
import { LayoutEngine } from '../src/browser/rendering/layout-engine';
import { PaintEngine } from '../src/browser/rendering/paint-engine';
import { PageRenderer } from '../src/browser/engine/page-renderer';

type Ctx = { box: (id: string) => { x: number; y: number; width: number; height: number }; text: (t: string) => { x: number; y: number } | null; texts: () => string[] };
// [name, html, check returning true when right, description of expectation]
const CASES: Array<[string, string, (c: Ctx) => unknown]> = [
  ['text-align center', '<p style="text-align:center;margin:0">abc</p>', (c) => { const t = c.text('abc'); return t && t.x > 270 && t.x < 300; }],
  ['text-align right', '<p style="text-align:right;margin:0">abc</p>', (c) => { const t = c.text('abc'); return t && t.x > 560; }],
  ['text-align end', '<p style="text-align:end;margin:0">abc</p>', (c) => { const t = c.text('abc'); return t && t.x > 560; }],
  ['direction rtl aligns right', '<p dir="rtl" style="margin:0">abc</p>', (c) => { const t = c.text('abc'); return t && t.x > 560; }],
  ['text-indent', '<p style="text-indent:30px;margin:0">abc</p>', (c) => c.text('abc')?.x === 30],
  ['text-indent %', '<p style="text-indent:10%;margin:0">abc</p>', (c) => c.text('abc')?.x === 60],
  ['line-height px', '<p id="t" style="line-height:24px;margin:0">abc</p>', (c) => c.box('t').height === 24],
  ['font shorthand line-height', '<p id="t" style="font:700 20px/30px sans-serif;margin:0">abc</p>', (c) => c.box('t').height === 30],
  ['wraps in narrow box', '<p id="t" style="width:60px;margin:0;line-height:20px">aaa bbb ccc ddd</p>', (c) => c.box('t').height >= 40],
  ['nowrap one line', '<p id="t" style="width:60px;white-space:nowrap;margin:0;line-height:20px">aaa bbb ccc ddd</p>', (c) => c.box('t').height === 20],
  ['pre newline', '<p id="t" style="white-space:pre;margin:0;line-height:20px">a\nb</p>', (c) => c.box('t').height === 40],
  ['pre-wrap keeps spaces', '<p style="white-space:pre-wrap;margin:0">a     b</p>', (c) => { const b = c.text('b'); return b && b.x > 12; }], // collapsed spaces would put b at ~7
  ['pre-line newline, collapses spaces', '<p id="t" style="white-space:pre-line;margin:0;line-height:20px">a    b\nc</p>', (c) => c.box('t').height === 40],
  ['word-break break-all', '<p id="t" style="width:40px;word-break:break-all;margin:0;line-height:20px">aaaaaaaaaaaaaaaa</p>', (c) => c.box('t').height >= 40],
  ['overflow-wrap anywhere', '<p id="t" style="width:40px;overflow-wrap:anywhere;margin:0;line-height:20px">aaaaaaaaaaaaaaaa</p>', (c) => c.box('t').height >= 40],
  ['overflow-wrap break-word', '<p id="t" style="width:40px;overflow-wrap:break-word;margin:0;line-height:20px">aaaaaaaaaaaaaaaa</p>', (c) => c.box('t').height >= 40],
  ['long word overflows by default', '<p id="t" style="width:40px;margin:0;line-height:20px">aaaaaaaaaaaaaaaa</p>', (c) => c.box('t').height === 20],
  ['inline padding shifts text', '<p style="margin:0"><span style="padding-left:10px">a</span>b</p>', (c) => { const a = c.text('a'); return a && a.x === 10; }],
  ['inline margin shifts text', '<p style="margin:0"><span style="margin-left:20px">a</span></p>', (c) => c.text('a')?.x === 20],
  ['letter-spacing widens', '<p style="margin:0;letter-spacing:10px"><span>ab</span>c</p>', (c) => { const t = c.text('c') ?? c.text('abc'); return t && t.x >= 20; }],
  ['word-spacing', '<p style="margin:0;word-spacing:20px">a b</p>', (c) => { const b = c.text('b'); return b && b.x >= 24; }],
  ['br two lines', '<p id="t" style="margin:0;line-height:20px">a<br>b</p>', (c) => c.box('t').height === 40],
  ['nested em font-size', '<p style="font-size:10px;margin:0"><span id="t" style="font-size:2em;display:inline-block">x</span></p>', (c) => c.box('t').height >= 20],
  ['ch unit', '<div id="t" style="width:10ch;height:1px"></div>', (c) => c.box('t').width > 40 && c.box('t').width < 110], // ten "0" advances
  ['ex unit', '<div id="t" style="width:10ex;height:1px"></div>', (c) => c.box('t').width > 60 && c.box('t').width < 110],
  ['inline image raises line', '<p id="t" style="margin:0;line-height:20px">a<img width="50" height="60" alt=""></p>', (c) => c.box('t').height >= 60],
  ['text wraps around float', '<div style="float:left;width:100px;height:50px"></div><p style="margin:0">text</p>', (c) => { const t = c.text('text'); return t && t.x >= 100; }],
  ['clear both below float', '<div style="float:left;width:100px;height:50px"></div><p id="t" style="clear:both;margin:0">x</p>', (c) => c.box('t').y >= 50],
  ['inline-block % width', '<div style="width:400px"><span id="t" style="display:inline-block;width:50%;height:5px"></span></div>', (c) => c.box('t').width === 200],
  ['justify spreads first line', '<p style="width:200px;text-align:justify;margin:0">aa bb cc dd ee ff gg hh ii jj kk ll mm</p>', (c) => { const ts = c.texts(); return ts.length > 0; }],
  ['vertical-align middle', '<p id="p" style="margin:0;line-height:20px">a<span id="t" style="display:inline-block;height:60px;width:10px;vertical-align:middle"></span></p>', (c) => c.box('p').height >= 60],
  ['min-height', '<p id="t" style="min-height:100px;margin:0">a</p>', (c) => c.box('t').height === 100],
  ['max-height clips box', '<p id="t" style="max-height:10px;overflow:hidden;margin:0;line-height:20px">a<br>b</p>', (c) => c.box('t').height === 10],
  ['tab in pre', '<pre style="margin:0">a\tb</pre>', (c) => { const b = c.text('b'); return b && b.x > 15; }], // a + 7 spaces to the 8-column stop
];

describe('inline text layout', () => {
  it.each(CASES)('%s', async (_name, html, check) => {
    const domTree = new DomTree(); const layout = new LayoutEngine(); const paint = new PaintEngine();
    const r = new PageRenderer({ htmlParser: new HtmlParser(), domTree, cssParser: new CssParser(), layoutEngine: layout, paintEngine: paint, svgDecode: async () => null,
      resourceLoader: { loadResource: vi.fn(), loadBatch: vi.fn(), loadStylesheet: vi.fn().mockResolvedValue(''), loadScript: vi.fn().mockResolvedValue(''), loadImage: vi.fn(), getPriority: vi.fn(), setMaxConcurrent: vi.fn(), on: vi.fn(), off: vi.fn(), dispose: vi.fn() },
      prioritizer: { submit: vi.fn(), submitBatch: vi.fn(), submitPreload: vi.fn(), submitPrefetch: vi.fn(), submitPreconnect: vi.fn(), clear: vi.fn(), dispose: vi.fn() } } as never);
    r.setViewport(600, 760, 1);
    await r.render({ url: 'http://t.local/', statusCode: 200, contentType: 'text/html', headers: new Map(), loadedAt: 0,
      body: `<html><body style="margin:0;font:16px sans-serif">${html}</body></html>` } as never, new AbortController().signal);
    const cmds = paint.compositeFrame().filter((c) => c.type === 'fillText');
    const ctx: Ctx = {
      box: (id) => { const b = layout.getLayoutBox(domTree.getElementById(id)!.domId)!; return { x: Math.round(b.x), y: Math.round(b.y), width: Math.round(b.width), height: Math.round(b.height) }; },
      text: (t) => { const c = cmds.find((c) => String(c.params[0]) === t); return c ? { x: Math.round(Number(c.params[1])), y: Math.round(Number(c.params[2])) } : null; },
      texts: () => cmds.map((c) => `${c.params[0]}@${Math.round(Number(c.params[1]))},${Math.round(Number(c.params[2]))}`),
    };
    expect(check(ctx), ctx.texts().slice(0, 6).join(' | ')).toBeTruthy();
    r.dispose();
  });

  it('a padded inline span: its box covers its padding, the next text starts after it', async () => {
    const domTree = new DomTree(); const layout = new LayoutEngine(); const paint = new PaintEngine();
    const r = new PageRenderer({ htmlParser: new HtmlParser(), domTree, cssParser: new CssParser(), layoutEngine: layout, paintEngine: paint, svgDecode: async () => null,
      resourceLoader: { loadResource: vi.fn(), loadBatch: vi.fn(), loadStylesheet: vi.fn().mockResolvedValue(''), loadScript: vi.fn().mockResolvedValue(''), loadImage: vi.fn(), getPriority: vi.fn(), setMaxConcurrent: vi.fn(), on: vi.fn(), off: vi.fn(), dispose: vi.fn() },
      prioritizer: { submit: vi.fn(), submitBatch: vi.fn(), submitPreload: vi.fn(), submitPrefetch: vi.fn(), submitPreconnect: vi.fn(), clear: vi.fn(), dispose: vi.fn() } } as never);
    r.setViewport(600, 760, 1);
    await r.render({ url: 'http://t.local/', statusCode: 200, contentType: 'text/html', headers: new Map(), loadedAt: 0,
      body: '<html><body style="margin:0;font:16px sans-serif"><p style="margin:0">x<span id="s" style="padding:4px 10px;background:#ff0">tag</span>y</p></body></html>' } as never, new AbortController().signal);
    const cmds = paint.compositeFrame().filter((c) => c.type === 'fillText');
    const at = (t: string) => Number(cmds.find((c) => String(c.params[0]) === t)!.params[1]);
    const s = layout.getLayoutBox(domTree.getElementById('s')!.domId)!;
    expect(at('tag') - s.x).toBeCloseTo(10, 0);   // left padding inside the box
    expect(at('y')).toBeCloseTo(s.x + s.width, 0); // right padding before the next text
    expect(s.height).toBeGreaterThan(16);           // vertical padding grows the box
    r.dispose();
  });
});
