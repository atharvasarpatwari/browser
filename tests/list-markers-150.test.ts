/**
 * List markers and CSS counters (no list had a bullet or number). See
 * doc/2026-10-30-nova-android-1.50-*.md.
 */
import { describe, expect, it, vi } from 'vitest';
import { DomTree } from '../src/browser/rendering/dom-tree';
import { HtmlParser } from '../src/browser/rendering/html-parser';
import { CssParser } from '../src/browser/rendering/css-parser';
import { LayoutEngine } from '../src/browser/rendering/layout-engine';
import { PaintEngine } from '../src/browser/rendering/paint-engine';
import { PageRenderer } from '../src/browser/engine/page-renderer';
import { markerText } from '../src/browser/rendering/list-markers';

async function render(body: string) {
  const domTree = new DomTree();
  const paint = new PaintEngine();
  const r = new PageRenderer({ htmlParser: new HtmlParser(), domTree, cssParser: new CssParser(), layoutEngine: new LayoutEngine(), paintEngine: paint, svgDecode: async () => null,
    resourceLoader: { loadResource: vi.fn(), loadBatch: vi.fn(), loadStylesheet: vi.fn().mockResolvedValue(''), loadScript: vi.fn().mockResolvedValue(''), loadImage: vi.fn(), getPriority: vi.fn(), setMaxConcurrent: vi.fn(), on: vi.fn(), off: vi.fn(), dispose: vi.fn() },
    prioritizer: { submit: vi.fn(), submitBatch: vi.fn(), submitPreload: vi.fn(), submitPrefetch: vi.fn(), submitPreconnect: vi.fn(), clear: vi.fn(), dispose: vi.fn() } } as never);
  r.setViewport(424, 800, 1);
  await r.render({ url: 'http://t.local/', statusCode: 200, contentType: 'text/html', body: `<html><body>${body}</body></html>`, headers: new Map(), loadedAt: 0 } as never, new AbortController().signal);
  const texts = paint.compositeFrame().filter((c) => c.type === 'fillText').map((c) => [String(c.params[0]), c.params[1] as number, c.params[2] as number] as const);
  return { domTree, texts, r };
}

describe('marker text', () => {
  it('bullets, numbers, letters, roman numerals, strings, none', () => {
    expect(['disc', 'circle', 'square'].map((t) => markerText(t, 1))).toEqual(['•', '◦', '▪']);
    expect(markerText('decimal', 12)).toBe('12.');
    expect(markerText('decimal-leading-zero', 7)).toBe('07.');
    expect([markerText('lower-alpha', 1), markerText('lower-alpha', 27), markerText('upper-alpha', 2)]).toEqual(['a.', 'aa.', 'B.']);
    expect([markerText('lower-roman', 4), markerText('upper-roman', 1994)]).toEqual(['iv.', 'MCMXCIV.']);
    expect(markerText('"– "', 3)).toBe('– ');
    expect(markerText('none', 1)).toBeNull();
  });
});

describe('list items', () => {
  it('<ul> gets bullets and <ol> numbers, left of the content on the first line', async () => {
    const { texts, domTree } = await render('<ul><li id="a">one</li><li>two</li></ul><ol><li id="b">x</li><li>y</li></ol>');
    expect(texts.filter(([t]) => t === '•')).toHaveLength(2);
    expect(texts.map(([t]) => t)).toEqual(expect.arrayContaining(['1.', '2.']));
    const one = texts.find(([t]) => t === 'one')!, bullet = texts.find(([t]) => t === '•')!;
    expect(bullet[1]).toBeLessThan(one[1]);            // left of the text
    expect(bullet[2]).toBeCloseTo(one[2], 0);          // on its baseline
    expect(domTree.getElementById('a')!.computedStyle!.get('display')).toBe('list-item');
  });

  it('<ol start>, reversed, <li value> and type="a"', async () => {
    const markers = async (h: string) => (await render(h)).texts.map(([t]) => t).filter((t) => /\.$/.test(t));
    expect(await markers('<ol start="5"><li>a</li><li>b</li></ol>')).toEqual(['5.', '6.']);
    expect(await markers('<ol reversed><li>a</li><li>b</li><li>c</li></ol>')).toEqual(['3.', '2.', '1.']);
    expect(await markers('<ol><li>a</li><li value="10">b</li><li>c</li></ol>')).toEqual(['1.', '10.', '11.']);
    expect(await markers('<ol type="a"><li>a</li><li>b</li></ol>')).toEqual(['a.', 'b.']);
  });

  it('list-style: none (navigation menus) has no marker', async () => {
    const { texts } = await render('<ul style="list-style:none"><li>Home</li><li>About</li></ul>');
    expect(texts.map(([t]) => t)).toEqual(['Home', 'About']);
  });
});

describe('CSS counters', () => {
  it('counter() in ::before numbers items; counter-reset scopes per list; styles apply', async () => {
    const { texts } = await render('<style>ol.c{list-style:none;counter-reset:n} ol.c li::before{counter-increment:n;content:counter(n) ". "} h2{counter-increment:h} h2::before{content:counter(h, upper-roman) " "}</style>' +
      '<ol class="c"><li>p</li><li>q</li></ol><ol class="c"><li>r</li></ol><h2>Intro</h2><h2>Body</h2>');
    const t = texts.map(([s]) => s);
    expect(t.filter((s) => /^\d+\.$/.test(s))).toEqual(['1.', '2.', '1.']);
    expect(t).toEqual(expect.arrayContaining(['I', 'II']));
  });
});
