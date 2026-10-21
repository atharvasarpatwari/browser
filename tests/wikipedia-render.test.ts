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
  const layoutEngine = new LayoutEngine();
  const renderer = new PageRenderer({
    htmlParser: new HtmlParser(), domTree, cssParser: new CssParser(), layoutEngine, paintEngine,
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
  return { q, cmds, texts, layoutEngine };
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

  it('a float nested in a block is cleared by a later sibling, and an overflow:hidden box contains its floats', async () => {
    const { q } = await render(page(`<div id="w"><div><div style="float:left;width:100px;height:80px"></div></div><div id="clear" style="clear:both">after</div></div>
      <div id="bfc" style="overflow:hidden"><div style="float:left;width:50px;height:60px"></div></div>`));
    const wy = q('#w').layoutBox!.y;
    expect(q('#clear').layoutBox!.y).toBeGreaterThanOrEqual(wy + 80);
    expect(q('#bfc').layoutBox!.height).toBeGreaterThanOrEqual(60);
  });

  it('a float placed below earlier floats takes its content with it, and keeps its own text', async () => {
    const { q, cmds } = await render(page(`<ul style="margin:0;padding:0">
      <li id="a" style="float:left;width:100%;list-style:none"><div>first</div></li>
      <li id="b" style="float:left;width:100%;list-style:none"><div id="bd">second</div></li>
      <li id="c" style="float:left;width:100%;list-style:none">third</li></ul>`));
    expect(q('#b').layoutBox!.y).toBeGreaterThan(q('#a').layoutBox!.y);
    expect(q('#bd').layoutBox!.y).toBe(q('#b').layoutBox!.y);
    const third = cmds.find((c) => c.type === 'fillText' && c.params[0] === 'third');
    expect(third).toBeTruthy();
    expect(third!.params[2] as number).toBeGreaterThan(q('#c').layoutBox!.y);
  });

  it('an inline child of a flex container is a flex item, and inline-flex is an atomic inline box', async () => {
    const { q } = await render(page(`<div style="display:flex"><img id="i" width="40" height="20" style="width:40px;height:20px"><span id="s">t</span></div>
      <p>before <a id="f" style="display:inline-flex;overflow:hidden;padding:4px"><b>icon</b></a> after</p>`));
    expect(q('#i').layoutBox!.width).toBe(40);
    expect(q('#s').layoutBox!.x).toBeGreaterThanOrEqual(q('#i').layoutBox!.x + 40);
    const f = q('#f').layoutBox!;
    expect(f.width).toBeGreaterThan(20);
    expect(f.height).toBeGreaterThan(10);
  });

  it('min-height and max-height apply (block, inline-block, border-box)', async () => {
    const { q } = await render(page(`<div id="a" style="min-height:120px">x</div><div id="b" style="max-height:10px">tall<br>text<br>here</div>
      <span id="c" style="display:inline-block;min-height:32px;padding:4px;box-sizing:border-box">s</span>`));
    expect(q('#a').layoutBox!.height).toBe(120);
    expect(q('#b').layoutBox!.height).toBe(10);
    expect(q('#c').layoutBox!.height).toBe(32);
  });

  it('a block-level <select> shows its chosen option, not every option as page text', async () => {
    const { texts } = await render(page('<select style="display:block"><option>20 items</option><option>50 items</option></select>'));
    expect(texts.join(' ')).toContain('20 items');
    expect(texts.join(' ')).not.toContain('50');
  });

  it('a flex item with auto basis and width is as wide as its content, not 0', async () => {
    const { q } = await render(page(`<div style="display:flex"><div id="t">A web browser is an application for accessing websites.</div></div>`));
    expect(q('#t').layoutBox!.width).toBeGreaterThan(200);
    expect(q('#t').layoutBox!.height).toBeLessThan(40); // one line, not one word per line
  });
});

describe('hit testing', () => {
  it('a tap goes to what is visible: not to hidden or clipped-away boxes over it', async () => {
    const { q, layoutEngine } = await render(page(`<div style="position:relative">
      <button id="b" style="width:120px;height:40px">Search</button>
      <a id="hidden" href="/login" style="position:absolute;top:0;left:0;width:200px;height:50px;visibility:hidden">Log in</a>
      <div style="position:absolute;top:0;left:0;width:1px;height:1px;overflow:hidden"><a id="clipped" href="/x" style="display:block;width:200px;height:50px">x</a></div>
    </div>`));
    const b = q('#b').layoutBox!;
    const hit = layoutEngine.getElementAtPoint(b.x + 20, b.y + 20);
    expect(hit?.attributes.get('id')).toBe('b');
  });
});

describe('hit testing follows paint order', () => {
  it('a positioned box laid over later in-flow content takes the tap, even inside a relative page wrapper', async () => {
    const { q, layoutEngine } = await render(page(`<div style="position:relative">
      <div style="height:30px"><button id="b" style="position:relative;height:60px;width:100px">Go</button></div>
      <div id="flow" style="height:100px;background:#eee">footer</div>
      <div id="top" style="position:absolute;top:150px;left:0;width:50px;height:20px;z-index:2"></div>
      <div id="under" style="position:absolute;top:150px;left:0;width:50px;height:20px;z-index:-1"></div></div>`));
    const b = q('#b').layoutBox!;
    expect(layoutEngine.getElementAtPoint(b.x + 10, b.y + b.height - 5)?.attributes.get('id')).toBe('b'); // overlaps #flow
    const t = q('#top').layoutBox!;
    expect(layoutEngine.getElementAtPoint(t.x + 5, t.y + 5)?.attributes.get('id')).toBe('top');
  });
});

describe('paint order', () => {
  it('a positioned (z-index:auto) box paints its in-flow children after its own background', async () => {
    const { cmds } = await render(page('<button style="position:relative;background:#36c;color:#fff;border:0"><span>Go</span></button>'));
    const bg = cmds.findIndex((c) => c.type === 'setFillStyle' && /#36c|51,\s*102,\s*204/i.test(String(c.params[0])));
    const label = cmds.findIndex((c) => c.type === 'fillText' && c.params[0] === 'Go');
    expect(bg).toBeGreaterThanOrEqual(0);
    expect(label).toBeGreaterThan(bg);
  });

  it('a z-indexed descendant of a z-index:auto box still stacks above later siblings', async () => {
    const { cmds } = await render(page(`<div style="position:relative"><div style="position:absolute;z-index:5;top:0;left:0;width:50px;height:50px;background:#f00"></div></div>
      <div style="position:relative;width:100px;height:100px;background:#0f0"></div>`));
    const red = cmds.findIndex((c) => c.type === 'setFillStyle' && /#f00|255,\s*0,\s*0/.test(String(c.params[0])));
    const green = cmds.findIndex((c) => c.type === 'setFillStyle' && /#0f0|0,\s*255,\s*0/.test(String(c.params[0])));
    expect(red).toBeGreaterThan(green);
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

  it('the results page lays out each result in a line or two, with its snippet text', async () => {
    const R = 'tests/fixtures/wikipedia-results-2026/';
    const html = readFileSync(R + 'index.html', 'utf8');
    const css = (u: string) => readFileSync(R + (u.includes('site.styles') ? 'style2.css' : 'style1.css'), 'utf8');
    const { q, texts } = await render(html, css, 1000);
    expect(q('.mw-search-results-container').layoutBox!.height).toBeLessThan(4000); // was ~23,000px
    expect(texts).toEqual(expect.arrayContaining(['application', 'accessing']));
    expect(q('select').layoutBox!.height).toBeGreaterThanOrEqual(32); // min-height, and font-size:1rem resolved
    expect(texts).toContain('20 items');
  }, 30000);
});
