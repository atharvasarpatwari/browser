/**
 * Real-page bugs found rendering Wikipedia's Special:Search (tests/fixtures/wikipedia-search-2026,
 * page + its two stylesheets as served 2026-10-20). Each was general, not Wikipedia-specific.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { PageRenderer } from '../src/browser/engine/page-renderer';
import type { PageRendererDependencies } from '../src/browser/engine/page-renderer';
import { HtmlParser } from '../src/browser/rendering/html-parser';
import { DomTree } from '../src/browser/rendering/dom-tree';
import type { DomElement } from '../src/browser/rendering/dom-tree';
import { CssParser } from '../src/browser/rendering/css-parser';
import { LayoutEngine } from '../src/browser/rendering/layout-engine';
import { PaintEngine } from '../src/browser/rendering/paint-engine';

const F = 'tests/fixtures/wikipedia-search-2026/';

async function render(body: string, sheets: (url: string) => string = () => '', width = 800) {
  const domTree = new DomTree();
  const paintEngine = new PaintEngine();
  const renderer = new PageRenderer({
    htmlParser: new HtmlParser(), domTree, cssParser: new CssParser(), layoutEngine: new LayoutEngine(), paintEngine,
    resourceLoader: {
      loadResource: vi.fn(), loadBatch: vi.fn(), loadStylesheet: vi.fn(async (u: string) => sheets(u)), loadScript: vi.fn().mockResolvedValue(''),
      loadImage: vi.fn(), getPriority: vi.fn(), setMaxConcurrent: vi.fn(), on: vi.fn(), off: vi.fn(), dispose: vi.fn(),
    },
    prioritizer: { submit: vi.fn(), submitBatch: vi.fn(), submitPreload: vi.fn(), submitPrefetch: vi.fn(), submitPreconnect: vi.fn(), clear: vi.fn(), dispose: vi.fn() },
  } as unknown as PageRendererDependencies);
  renderer.setViewport(width, 600, 1);
  await renderer.render({ url: 'https://en.wikipedia.org/wiki/Special:Search', statusCode: 200, contentType: 'text/html', body, headers: new Map(), loadedAt: 0 } as never, new AbortController().signal);
  const q = (sel: string) => domTree.querySelector(sel) as DomElement;
  const cmds = paintEngine.compositeFrame();
  const texts = cmds.filter((c) => c.type === 'fillText').map((c) => c.params[0] as string);
  return { q, cmds, texts };
}
const page = (html: string) => `<html><body>${html}</body></html>`;
const kids = (el: DomElement) => el.children.filter((c) => c.nodeType === 'element').map((c) => (c as DomElement).tagName);

describe('tree building', () => {
  it('</span>, </label> and other plain end tags close their element ("any other end tag")', async () => {
    const { q } = await render(page('<div id="d"><label for="x"><span class="a"></span><span></span></label><em>e</em><div>after</div></div>'));
    expect(kids(q('#d'))).toEqual(['label', 'em', 'div']);
    expect(kids(q('label'))).toEqual(['span', 'span']);
  });

  it('</form> clears the form pointer, so a second <form> on the page exists', async () => {
    const { q } = await render(page('<form id="a"><input name="x"></form><div><form id="b"><input name="y"></form></div>'));
    expect(q('#b')).toBeTruthy();
    expect(q('#b').children.some((c) => (c as DomElement).tagName === 'input')).toBe(true);
  });
});

describe('selectors', () => {
  it('a three-part selector needs all three parts (it used to drop the last)', async () => {
    const { q } = await render(`<html><head><style>.a .b .c { display: none }</style></head><body>
      <div class="a"><footer class="b" id="f"><p>text</p><span class="c" id="c">x</span></footer></div></body></html>`);
    expect(q('#f').computedStyle?.get('display')).toBe('block');
    expect(q('#c').computedStyle?.get('display')).toBe('none');
  });
});

describe('painting', () => {
  it('an overflow:hidden box clips only its own content, not everything painted after it', async () => {
    const { texts } = await render(page('<div style="overflow:hidden;width:1px;height:1px">hidden</div><p>later text</p>'));
    expect(texts.join(' ')).toContain('later');
  });

  it('screen-reader-only text (clip:rect(1px,1px,1px,1px)), visibility:hidden and opacity:0 paint nothing', async () => {
    const { cmds, texts } = await render(page(`
      <span style="position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(1px,1px,1px,1px)">sronly</span>
      <p style="visibility:hidden">invisible</p>
      <div style="position:fixed;top:0;left:0;right:0;bottom:0;width:800px;height:600px;background:rgba(0,0,0,0.8);opacity:0"></div>
      <p>shown</p>`));
    expect(texts).not.toContain('sronly');
    expect(texts).not.toContain('invisible');
    expect(texts).toContain('shown');
    expect(cmds.some((c) => c.type === 'setFillStyle' && String(c.params[0]).includes('0.8'))).toBe(false);
  });
});

describe('layout', () => {
  it('a display:table-cell lays out its content; a nowrap button is not squeezed below its label', async () => {
    const { q } = await render(page(`<div style="display:table-cell;width:1%"><span style="display:inline-block;white-space:nowrap">
      <button><span>Search now</span></button></span></div>`));
    const b = q('button').layoutBox!;
    expect(b).toBeTruthy();
    expect(b.width).toBeGreaterThan(40);
  });
});

describe('Wikipedia Special:Search with its own CSS', () => {
  it('paints the heading, the search form and the footer links', async () => {
    const html = readFileSync(F + 'index.html', 'utf8');
    const css = (u: string) => readFileSync(F + (u.includes('site.styles') ? 'style2.css' : 'style1.css'), 'utf8');
    const { q, texts } = await render(html, css, 1000);
    expect(q('form#search')).toBeTruthy();
    expect(q('#searchText input').layoutBox!.width).toBeGreaterThan(300);
    expect(texts.filter((t) => t === 'Search')).toHaveLength(2); // the page heading and the button
    expect(texts).toEqual(expect.arrayContaining(['Privacy', 'Terms', 'Desktop']));
  }, 30000);
});
