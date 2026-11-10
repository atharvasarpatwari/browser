/**
 * 2.05: the second style pass after scripts restyled every element (12 s on CNN on the tablet).
 * It is incremental now when the scripts left every <style> alone and removed nothing. Also: the
 * ad blocker's user stylesheet was dropped after scripts, and the first pass listed a page's
 * <style> rules before its linked sheets.
 */
import { describe, expect, it, vi } from 'vitest';
import { DomTree } from '../src/browser/rendering/dom-tree';
import { HtmlParser } from '../src/browser/rendering/html-parser';
import { CssParser } from '../src/browser/rendering/css-parser';
import { LayoutEngine } from '../src/browser/rendering/layout-engine';
import { PaintEngine } from '../src/browser/rendering/paint-engine';
import { PageRenderer } from '../src/browser/engine/page-renderer';

async function page(css: string, body: string, userCss = '') {
  const domTree = new DomTree();
  const r = new PageRenderer({ htmlParser: new HtmlParser(), domTree, cssParser: new CssParser(), layoutEngine: new LayoutEngine(), paintEngine: new PaintEngine(), svgDecode: async () => null,
    resourceLoader: { loadResource: vi.fn(), loadBatch: vi.fn(), loadStylesheet: vi.fn().mockResolvedValue(''), loadScript: vi.fn().mockResolvedValue(''), loadImage: vi.fn(), getPriority: vi.fn(), setMaxConcurrent: vi.fn(), on: vi.fn(), off: vi.fn(), dispose: vi.fn() },
    prioritizer: { submit: vi.fn(), submitBatch: vi.fn(), submitPreload: vi.fn(), submitPrefetch: vi.fn(), submitPreconnect: vi.fn(), clear: vi.fn(), dispose: vi.fn() },
    userStylesheet: () => userCss } as never);
  r.setViewport(400, 600, 1);
  await r.render({ url: 'http://t.local/', statusCode: 200, contentType: 'text/html', headers: new Map(), loadedAt: 0, body: `<html><head><style>${css}</style></head><body>${body}</body></html>` } as never, new AbortController().signal);
  const cs = (id: string, p: string) => domTree.getElementById(id)?.computedStyle?.get(p)?.replace(/\s/g, '');
  return { domTree, r, cs };
}

describe('style pass after scripts', () => {
  it('the user stylesheet (ad hiding) still applies after a page with scripts', async () => {
    const { r, cs } = await page('', '<div id="ad" class="sponsored">ad</div><p id="p">text</p><script>document.getElementById("p").setAttribute("data-x","1");</script>', '.sponsored{display:none !important}');
    expect(cs('ad', 'display')).toBe('none'); // was block: the rules were rebuilt without it
    expect(cs('p', 'display')).toBe('block');
    r.dispose();
  });

  it('restyles what scripts changed, and the siblings after it (+ and :nth-child)', async () => {
    const { r, cs } = await page('.on{color:rgb(1,2,3)} .on + p{color:rgb(4,5,6)} .n + .c{width:77px} li:nth-child(2){color:rgb(7,8,9)}',
      '<div id="a">a</div><p id="b">b</p><div id="c" class="c">c</div><ul><li id="l1">1</li><li id="l2">2</li></ul>' +
      '<script>' +
      'document.getElementById("a").className = "on";' +
      'var n = document.createElement("div"); n.className = "n"; document.body.insertBefore(n, document.getElementById("c"));' +
      'var li = document.createElement("li"); li.id = "l0"; var ul = document.getElementsByTagName("ul")[0]; ul.insertBefore(li, document.getElementById("l1"));' +
      '</script>');
    expect(cs('a', 'color')).toBe('rgb(1,2,3)');
    expect(cs('b', 'color')).toBe('rgb(4,5,6)');   // the sibling right after the changed element
    expect(cs('c', 'width')).toBe('77px');          // a node inserted before it: `.n + .c` now matches
    expect(cs('l1', 'color')).toBe('rgb(7,8,9)');   // l1 became the second item
    expect(cs('l2', 'color')).not.toBe('rgb(7,8,9)');
    r.dispose();
  });

  it('a script that removes a node still gets a correct restyle (full pass)', async () => {
    const { r, cs } = await page('li:first-child{color:rgb(1,1,1)}',
      '<ul><li id="l1">1</li><li id="l2">2</li></ul><script>var u = document.getElementsByTagName("ul")[0]; u.removeChild(document.getElementById("l1"));</script>');
    expect(cs('l2', 'color')).toBe('rgb(1,1,1)'); // l2 is the first item now
    r.dispose();
  });

  it('a style a script adds still applies', async () => {
    const { r, cs } = await page('p{color:rgb(1,1,1)}', '<p id="p">x</p><script>var s = document.createElement("style"); s.textContent = "p{color:rgb(2,2,2)}"; document.head.appendChild(s);</script>');
    expect(cs('p', 'color')).toBe('rgb(2,2,2)');
    r.dispose();
  });
});
