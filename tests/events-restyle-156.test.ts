/**
 * Found on the OPPO tablet with 1.55: clicks never reached `document` listeners, and a click
 * handler's style change never repainted. See doc/2026-10-31-nova-android-1.55-*.md.
 */
import { describe, expect, it, vi } from 'vitest';
import { DomTree } from '../src/browser/rendering/dom-tree';
import { HtmlParser } from '../src/browser/rendering/html-parser';
import { CssParser } from '../src/browser/rendering/css-parser';
import { LayoutEngine } from '../src/browser/rendering/layout-engine';
import { PaintEngine } from '../src/browser/rendering/paint-engine';
import { PageRenderer } from '../src/browser/engine/page-renderer';

async function render(body: string, css = '') {
  const domTree = new DomTree();
  const paint = new PaintEngine();
  const r = new PageRenderer({ htmlParser: new HtmlParser(), domTree, cssParser: new CssParser(), layoutEngine: new LayoutEngine(), paintEngine: paint, svgDecode: async () => null,
    resourceLoader: { loadResource: vi.fn(), loadBatch: vi.fn(), loadStylesheet: vi.fn().mockResolvedValue(css), loadScript: vi.fn().mockResolvedValue(''), loadImage: vi.fn(), getPriority: vi.fn(), setMaxConcurrent: vi.fn(), on: vi.fn(), off: vi.fn(), dispose: vi.fn() },
    prioritizer: { submit: vi.fn(), submitBatch: vi.fn(), submitPreload: vi.fn(), submitPrefetch: vi.fn(), submitPreconnect: vi.fn(), clear: vi.fn(), dispose: vi.fn() } } as never);
  r.setViewport(600, 600, 1);
  await r.render({ url: 'http://t.local/', statusCode: 200, contentType: 'text/html', body: `<html><head><style>${css}</style></head><body style="margin:0">${body}</body></html>`, headers: new Map(), loadedAt: 0 } as never, new AbortController().signal);
  return { domTree, paint, r, frame: () => (r as unknown as { reflowController: { processFrame(): void } }).reflowController.processFrame() };
}

describe('click events reach document listeners', () => {
  it('bubbling ends at document, capture starts there; stopPropagation still stops it; once works', async () => {
    const { domTree, r } = await render('<div id="wrap"><button id="b">b</button></div><p id="out"></p><script>' +
      'var log = []; var out = document.getElementById("out");' +
      'document.addEventListener("click", function (e) { log.push("doc-bubble:" + e.target.id); out.setAttribute("data-log", log.join(",")); });' +
      'document.addEventListener("click", function () { log.push("doc-capture"); }, true);' +
      'document.addEventListener("click", function () { log.push("doc-once"); }, { once: true });' +
      'document.getElementById("wrap").addEventListener("click", function (e) { if (e.target.id === "stop") e.stopPropagation(); });' +
      '</script>');
    const b = domTree.getElementById('b')!;
    r.dispatchPageEvent(b, 'click');
    r.dispatchPageEvent(b, 'click');
    expect(domTree.getElementById('out')!.attributes.get('data-log')).toBe('doc-capture,doc-bubble:b,doc-once,doc-capture,doc-bubble:b');
    r.dispose();
  });
});

describe('a click handler that changes a style repaints it', () => {
  it.each([['static', ''], ['position: relative (a stacking-tree background)', 'position:relative;']])('el.style.background from a click is painted on the next frame (%s)', async (_label, pos) => {
    const { domTree, paint, r, frame } = await render('<header id="h" style="' + pos + 'height:50px;background:#16a34a"></header><button id="b">go</button><script>' +
      'document.getElementById("b").addEventListener("click", function () { document.getElementById("h").style.background = "#dc2626"; });</script>');
    const fills = () => paint.compositeFrame().filter((c) => c.type === 'setFillStyle').map((c) => String(c.params[0]).toLowerCase());
    frame(); // as on a device: a frame runs first and clears the style-dirty flags every element starts with
    expect(fills().some((f) => f.includes('dc2626') || f.includes('220, 38, 38'))).toBe(false);
    r.dispatchPageEvent(domTree.getElementById('b')!, 'click');
    frame();
    expect(fills().some((f) => f.includes('dc2626') || f.includes('220, 38, 38'))).toBe(true);
    r.dispose();
  });
});

describe('script changes after the first frame restyle what they affect', () => {
  it('classList toggle with a descendant selector, and a + sibling selector', async () => {
    const { domTree, r, frame } = await render(
      '<nav id="nav"><ul id="menu"><li>a</li></ul></nav><input id="cb"><p id="sib">s</p><button id="b">go</button><script>' +
      'document.getElementById("b").addEventListener("click", function () { document.getElementById("nav").classList.add("open"); document.getElementById("cb").setAttribute("data-on", "1"); });</script>',
      '#menu{display:none} .open #menu{display:block} #cb[data-on] + #sib{color:#ff0000}');
    frame();
    expect(domTree.getElementById('menu')!.computedStyle!.get('display')).toBe('none');
    r.dispatchPageEvent(domTree.getElementById('b')!, 'click');
    frame();
    expect(domTree.getElementById('menu')!.computedStyle!.get('display')).toBe('block');
    expect(domTree.getElementById('menu')!.layoutBox!.height).toBeGreaterThan(0);
    expect(domTree.getElementById('sib')!.computedStyle!.get('color')).toBe('#ff0000');
    r.dispose();
  });
});
