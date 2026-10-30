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
    r.dispatchPageEvent(btn, 'click');
    (r as unknown as { reflowController: { processFrame(): void } }).reflowController.processFrame();
    expect(html.attributes.get('data-color')).toBe('red');
    expect(domTree.getElementsByTagName('header')[0]!.computedStyle!.get('background-image')).toContain('#d13438');
    r.dispose();
  });
});
