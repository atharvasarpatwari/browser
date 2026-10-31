/**
 * DOMContentLoaded and load were never fired, and document.dispatchEvent threw: httpforever's
 * colour button did nothing on the phone (1.46). See doc/2026-10-30-nova-android-1.47-*.md.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { DomTree } from '../src/browser/rendering/dom-tree';
import { HtmlParser } from '../src/browser/rendering/html-parser';
import { CssParser } from '../src/browser/rendering/css-parser';
import { LayoutEngine } from '../src/browser/rendering/layout-engine';
import { PaintEngine } from '../src/browser/rendering/paint-engine';
import { PageRenderer } from '../src/browser/engine/page-renderer';

async function render(html: string, css = '', js = '') {
  const domTree = new DomTree();
  const r = new PageRenderer({ htmlParser: new HtmlParser(), domTree, cssParser: new CssParser(), layoutEngine: new LayoutEngine(), paintEngine: new PaintEngine(), svgDecode: async () => null,
    resourceLoader: { loadResource: vi.fn(), loadBatch: vi.fn(), loadStylesheet: vi.fn().mockResolvedValue(css), loadScript: vi.fn().mockResolvedValue(js), loadImage: vi.fn(), getPriority: vi.fn(), setMaxConcurrent: vi.fn(), on: vi.fn(), off: vi.fn(), dispose: vi.fn() },
    prioritizer: { submit: vi.fn(), submitBatch: vi.fn(), submitPreload: vi.fn(), submitPrefetch: vi.fn(), submitPreconnect: vi.fn(), clear: vi.fn(), dispose: vi.fn() } } as never);
  r.setViewport(423, 822, 1);
  await r.render({ url: 'http://test.local/', statusCode: 200, contentType: 'text/html', body: html, headers: new Map(), loadedAt: 0 } as never, new AbortController().signal);
  return { domTree, r };
}

describe('page load events', () => {
  it('DOMContentLoaded (document, bubbling to window) and load (window + onload) fire once, in order', async () => {
    const { domTree, r } = await render('<html><body><p id="out"></p><script>' +
      'var log = [];' +
      'document.addEventListener("DOMContentLoaded", function (e) { log.push("dcl:" + e.type); });' +
      'window.addEventListener("load", function () { log.push("load"); });' +
      'window.onload = function () { log.push("onload"); document.getElementById("out").setAttribute("data-log", log.join(",")); };' +
      '</script></body></html>');
    expect(domTree.getElementById('out')!.attributes.get('data-log')).toBe('dcl:DOMContentLoaded,load,onload');
    r.dispose();
  });

  it('document.dispatchEvent works (it threw on the document node)', async () => {
    const { domTree, r } = await render('<html><body><p id="out"></p><script>' +
      'document.addEventListener("x", function () { document.getElementById("out").setAttribute("data-x", "1"); });' +
      'document.dispatchEvent(new Event("x"));</script></body></html>');
    expect(domTree.getElementById('out')!.attributes.get('data-x')).toBe('1');
    r.dispose();
  });

  it("httpforever's colour button switches the page to red", async () => {
    const F = 'tests/fixtures/httpforever-2026/';
    const { domTree, r } = await render(readFileSync(F + 'index.html', 'utf8'), readFileSync(F + 'style.css', 'utf8'), readFileSync(F + 'theme.js', 'utf8'));
    const html = domTree.getElementsByTagName('html')[0]!;
    const btn = domTree.getElementById('colorBtn')!;
    expect(btn.attributes.get('aria-label')).toBe('Switch to red colour'); // relabel() ran on DOMContentLoaded
    (r as unknown as { reflowController: { processFrame(): void } }).reflowController.processFrame(); // a frame first, as on a device
    r.dispatchPageEvent(btn, 'click');
    (r as unknown as { reflowController: { processFrame(): void } }).reflowController.processFrame();
    expect(html.attributes.get('data-color')).toBe('red');
    expect(domTree.getElementsByTagName('header')[0]!.computedStyle!.get('background-image')).toContain('#d13438');
    r.dispose();
  });
});

describe('CSS math with mixed units (httpforever: 12 px logo, oversized brand name)', () => {
  it('clamp/min/max/calc resolve against the real viewport and the root font size', async () => {
    const { resolveMathFunctions } = await import('../src/browser/rendering/css5/math-functions');
    const ctx = { fontSize: 18, rootFontSize: 16, viewportWidth: 423, viewportHeight: 822 };
    expect(resolveMathFunctions('clamp(2.2rem, 6vw, 3rem)', ctx)).toBe('35.2px');
    expect(resolveMathFunctions('clamp(1.5rem, 1rem + 3vw, 2.6rem)', ctx)).toBe('28.69px');
    expect(resolveMathFunctions('min(100%, 600px)', ctx)).toBe('min(100%, 600px)'); // left for layout, not "100%"
    expect(resolveMathFunctions('max(1rem, 10px)', ctx)).toBe('16px');
  });

  it('the cascade uses the page viewport and rem = the root size; layout resolves calc with %', async () => {
    const { domTree, r } = await render('<html><head><style>html{font-size:16px} body{margin:0;font-size:18px} #a{width:clamp(2.2rem,6vw,3rem);height:10px} #b{width:calc(100% - 2rem);height:10px} #c{width:min(50%, 100px);height:10px}</style></head><body><div id="a"></div><div id="b"></div><div id="c"></div></body></html>');
    const w = (id: string) => Math.round(domTree.getElementById(id)!.layoutBox!.width);
    expect(w('a')).toBe(35);       // 2.2rem with rem = 16 (was 12 at a 1920 px viewport)
    expect(w('b')).toBe(423 - 32); // was 0
    expect(w('c')).toBe(100);
    r.dispose();
  });
});

describe('grid: auto rows stretch to a definite height (the theme icon sat at the top of its button)', () => {
  it('place-items: center in a fixed-height grid centres the item vertically', async () => {
    const { domTree, r } = await render('<html><head><style>body{margin:0} #g{display:grid;place-items:center;width:40px;height:40px;box-sizing:border-box;border:1px solid #000}</style></head><body><div id="g"><svg id="i" width="16" height="16"></svg></div></body></html>');
    const g = domTree.getElementById('g')!.layoutBox!, i = domTree.getElementById('i')!.layoutBox!;
    expect(i.x - g.x).toBeCloseTo(12, 0);
    expect(i.y - g.y).toBeCloseTo(12, 0); // was 1: the row was 16 px tall
    r.dispose();
  });
  it('explicit rows and align-content: start are left alone', async () => {
    const { domTree, r } = await render('<html><head><style>body{margin:0} #g{display:grid;height:100px;align-content:start} #h{display:grid;height:100px;grid-template-rows:20px}</style></head><body><div id="g"><div id="a">a</div></div><div id="h"><div id="b">b</div></div></body></html>');
    expect(domTree.getElementById('a')!.layoutBox!.height).toBeLessThan(40);
    expect(domTree.getElementById('b')!.layoutBox!.height).toBeLessThan(40);
    r.dispose();
  });
});
