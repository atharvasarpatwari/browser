/**
 * 1.86, from the saved Python documentation page at 412px: the hamburger menu was a black square
 * (a `<span>` flex item kept `display: inline`, so its `height: 2px` was ignored), and the fixed
 * mobile bar (`position: fixed; width: 100%`) was its parent's width, not the viewport's.
 */
import { describe, expect, it, vi } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { DomTree } from '../src/browser/rendering/dom-tree';
import { HtmlParser } from '../src/browser/rendering/html-parser';
import { CssParser } from '../src/browser/rendering/css-parser';
import { LayoutEngine } from '../src/browser/rendering/layout-engine';
import { PaintEngine } from '../src/browser/rendering/paint-engine';
import { PageRenderer } from '../src/browser/engine/page-renderer';

async function render(html: string, width = 412, css: (u: string) => string = () => '') {
  const domTree = new DomTree(); const layout = new LayoutEngine();
  const r = new PageRenderer({ htmlParser: new HtmlParser(), domTree, cssParser: new CssParser(), layoutEngine: layout, paintEngine: new PaintEngine(), svgDecode: async () => null,
    resourceLoader: { loadResource: vi.fn(), loadBatch: vi.fn(), loadStylesheet: vi.fn().mockImplementation(async (u: string) => css(u)), loadScript: vi.fn().mockResolvedValue(''), loadImage: vi.fn(), getPriority: vi.fn(), setMaxConcurrent: vi.fn(), on: vi.fn(), off: vi.fn(), dispose: vi.fn() },
    prioritizer: { submit: vi.fn(), submitBatch: vi.fn(), submitPreload: vi.fn(), submitPrefetch: vi.fn(), submitPreconnect: vi.fn(), clear: vi.fn(), dispose: vi.fn() } } as never);
  r.setViewport(width, 600, 1);
  await r.render({ url: 'http://t.local/', statusCode: 200, contentType: 'text/html', headers: new Map(), loadedAt: 0, body: html } as never, new AbortController().signal);
  const el = (id: string) => domTree.getElementById(id)!;
  const box = (id: string) => layout.getLayoutBox(el(id).domId)!;
  return { el, box, domTree, r };
}
const page = (body: string) => `<!doctype html><html><body style="margin:0;font:16px/20px sans-serif">${body}</body></html>`;

describe('flex and grid items are blockified', () => {
  it('a span flex item keeps its height', async () => {
    const { el, box, r } = await render(page('<label style="display:flex;align-items:center;width:40px;padding:8px;box-sizing:border-box"><span id="a" style="height:2px;width:100%;background:#000"></span></label>'));
    expect(el('a').computedStyle?.get('display')).toBe('block');
    expect(box('a').height).toBe(2); // was a line tall
    expect(box('a').width).toBe(24);
    r.dispose();
  });
  it('inline-flex and inline-block items become flex and block; grid items too', async () => {
    const { el, r } = await render(page('<div style="display:flex"><span id="a" style="display:inline-flex">a</span><span id="b" style="display:inline-block">b</span></div><div style="display:grid"><em id="c">c</em></div><div><span id="d">d</span></div>'));
    expect(el('a').computedStyle?.get('display')).toBe('flex');
    expect(el('b').computedStyle?.get('display')).toBe('block');
    expect(el('c').computedStyle?.get('display')).toBe('block');
    expect(el('d').computedStyle?.get('display')).toBe('inline'); // not an item: unchanged
    r.dispose();
  });
});

describe('positioned boxes resolve percentages against their containing block', () => {
  it('position: fixed; width: 100% is the viewport width', async () => {
    const { box, r } = await render(page('<div style="padding:0 16px"><div id="a" style="position:fixed;top:0;left:0;width:100%;height:10px"></div></div>'));
    expect(box('a').width).toBe(412); // was the parent's 380
    r.dispose();
  });
  it('an absolute box uses its positioned ancestor, not the block it sits in', async () => {
    const { box, r } = await render(page('<div style="position:relative;width:300px"><div style="width:100px"><div id="a" style="position:absolute;left:0;top:0;width:50%;height:10px"></div></div></div>'));
    expect(box('a').width).toBe(150); // 50% of 300, not of 100
    r.dispose();
  });
});

describe('Python docs tutorial (saved 2026, 412px)', () => {
  it('the hamburger is three bars and the mobile bar spans the viewport', async () => {
    const dir = 'tests/fixtures/pydoc-tutorial-2026/';
    const files = readdirSync(dir);
    const css = (url: string) => { const b = url.split(/[?#]/)[0]!.split('/').pop() ?? ''; return files.includes(b) ? readFileSync(dir + b, 'utf8') : ''; };
    const { domTree, r } = await render(readFileSync(dir + 'index.html', 'utf8'), 412, css);
    const bar = domTree.querySelector('.toggler__label > span')!;
    expect(bar.layoutBox!.height).toBe(2);
    const nav = domTree.querySelector('.mobile-nav')!;
    expect(nav.layoutBox!.width).toBe(412);
    r.dispose();
  }, 60000);
});
