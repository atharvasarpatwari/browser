/**
 * Bugs found by the 2026-10-21 end-user test pass on a phone (doc/2026-10-21-nova-android-1.26-end-user-test-results.md).
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

type Node = { nodeType: string; tagName?: string; children: Node[] };
const shape = (html: string): string => {
  const doc = (new HtmlParser().parse(html) as unknown as { document: { htmlElement: Node } }).document;
  const walk = (n: Node): string => n.nodeType !== 'element' ? '' :
    n.tagName! + (n.children.some((c) => c.nodeType === 'element') ? '(' + n.children.map(walk).filter(Boolean).join(' ') + ')' : '');
  return walk(doc.htmlElement);
};

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
  await renderer.render({ url: 'https://example.com/', statusCode: 200, contentType: 'text/html', body, headers: new Map(), loadedAt: 0 } as never, new AbortController().signal);
  const runs = paintEngine.compositeFrame().filter((c) => c.type === 'fillText').map((c) => ({ text: c.params[0] as string, x: c.params[1] as number }));
  return { q: (s: string) => domTree.querySelector(s) as DomElement, runs };
}

describe('RC-6: <link>/<meta> inside <body> keep the parser in body mode', () => {
  it('no spurious <body> after an in-body link or meta', () => {
    expect(shape('<html><body><section><link rel=x href=y><p>a</p></section></body></html>')).toBe('html(head body(section(link p)))');
    expect(shape('<html><body><div><p>a</p><meta itemprop=x><p>b</p></div></body></html>')).toBe('html(head body(div(p meta p)))');
    expect(shape('<html><body><span><link rel=x href=y></span><p>a</p></body></html>')).toBe('html(head body(span(link) p))');
  });

  it('a real Wikipedia article parses to a single <body>, lead text right under the title', async () => {
    const F = 'tests/fixtures/wikipedia-article-2026/';
    const html = readFileSync(F + 'index.html', 'utf8');
    let bodies = 0;
    const walk = (n: Node) => { if (n.nodeType !== 'element') return; if (n.tagName === 'body') bodies++; n.children.forEach(walk); };
    walk((new HtmlParser().parse(html) as unknown as { document: { htmlElement: Node } }).document.htmlElement);
    expect(bodies).toBe(1); // was 59
    const { q } = await render(html, (u) => readFileSync(F + (u.includes('site.styles') ? 'style2.css' : 'style1.css'), 'utf8'), 424);
    const h1 = q('h1').layoutBox!;
    const lead = [...q('section').children].find((c) => (c as DomElement).tagName === 'p' && !((c as DomElement).attributes.get('class') ?? '').includes('empty')) as DomElement;
    expect(lead.layoutBox!.y - (h1.y + h1.height)).toBeLessThan(200); // was ~900 px of blank
  }, 30000);
});

describe('RC-7: word spaces between inline elements', () => {
  it('keeps the space in </a> <a> and </b> <i>, and a newline collapses to one space', async () => {
    const a = await render('<p>the <a href="#">Wikipedia</a> <a href="#">web</a></p>');
    const wiki = a.runs.find((r) => r.text === 'Wikipedia')!;
    const web = a.runs.find((r) => r.text === 'web')!;
    expect(a.runs.some((r) => r.text === ' ' && r.x > wiki.x && r.x < web.x)).toBe(true);
    const b = await render('<p><b>bold</b>\n<i>italic</i></p>');
    const bold = b.runs.find((r) => r.text === 'bold')!;
    const italic = b.runs.find((r) => r.text === 'italic')!;
    expect(b.runs.some((r) => r.text === ' ' && r.x > bold.x && r.x < italic.x)).toBe(true);
  });

  it('whitespace between blocks still adds nothing', async () => {
    const { q } = await render('<div id="a" style="height:10px"></div>\n   \n<div id="b" style="height:10px"></div>');
    expect(q('#b').layoutBox!.y).toBe(q('#a').layoutBox!.y + 10);
  });
});

describe('line wrapping', () => {
  it('a width:100% inline-block after text wraps to its own line', async () => {
    const { q } = await render('<div style="width:400px">some text <span id="s" style="display:inline-block;width:100%">box</span></div>');
    const s = q('#s').layoutBox!;
    expect(s.x).toBeLessThan(20);
    expect(s.width).toBeLessThanOrEqual(400);
  });
});
