/**
 * Flex/grid gap, :is()/:not() selector lists, @supports values. See
 * doc/2026-10-30-nova-android-1.53-*.md.
 */
import { describe, expect, it, vi } from 'vitest';
import { DomTree } from '../src/browser/rendering/dom-tree';
import { HtmlParser } from '../src/browser/rendering/html-parser';
import { CssParser } from '../src/browser/rendering/css-parser';
import { LayoutEngine } from '../src/browser/rendering/layout-engine';
import { PaintEngine } from '../src/browser/rendering/paint-engine';
import { PageRenderer } from '../src/browser/engine/page-renderer';
import { evaluateSupportsCondition } from '../src/browser/rendering/css5/cascade';

async function render(css: string, body: string) {
  const domTree = new DomTree();
  const r = new PageRenderer({ htmlParser: new HtmlParser(), domTree, cssParser: new CssParser(), layoutEngine: new LayoutEngine(), paintEngine: new PaintEngine(), svgDecode: async () => null,
    resourceLoader: { loadResource: vi.fn(), loadBatch: vi.fn(), loadStylesheet: vi.fn().mockResolvedValue(''), loadScript: vi.fn().mockResolvedValue(''), loadImage: vi.fn(), getPriority: vi.fn(), setMaxConcurrent: vi.fn(), on: vi.fn(), off: vi.fn(), dispose: vi.fn() },
    prioritizer: { submit: vi.fn(), submitBatch: vi.fn(), submitPreload: vi.fn(), submitPrefetch: vi.fn(), submitPreconnect: vi.fn(), clear: vi.fn(), dispose: vi.fn() } } as never);
  r.setViewport(400, 800, 1);
  await r.render({ url: 'http://t.local/', statusCode: 200, contentType: 'text/html', body: `<html><head><style>body{margin:0}${css}</style></head><body>${body}</body></html>`, headers: new Map(), loadedAt: 0 } as never, new AbortController().signal);
  r.dispose();
  return { box: (id: string) => domTree.getElementById(id)!.layoutBox!, style: (id: string, p: string) => domTree.getElementById(id)!.computedStyle!.get(p) };
}

describe('gap', () => {
  it('flex gap spaces items; two values set row and column gaps', async () => {
    const { box, style } = await render('#f{display:flex;gap:10px} #f div{width:50px;height:10px} #g{gap:4px 8px}', '<div id="f"><div id="a"></div><div id="b"></div></div><div id="g"></div>');
    expect(box('b').x - box('a').x).toBe(60); // was 50: touching
    expect([style('g', 'row-gap'), style('g', 'column-gap')]).toEqual(['4px', '8px']);
  });
});

describe('selector lists in :is() / :not() / :where()', () => {
  it('each listed selector matches (the comma was dropped, making a descendant selector)', async () => {
    const { style } = await render(':is(.a, .b){color:#ff0000} p:not(.a, .b){color:#0000ff} :where(#w, #z) span{font-style:italic}',
      '<p id="pa" class="a">a</p><p id="pb" class="b">b</p><p id="pc">c</p><div id="w"><span id="s">s</span></div>');
    expect([style('pa', 'color'), style('pb', 'color'), style('pc', 'color')]).toEqual(['#ff0000', '#ff0000', '#0000ff']);
    expect(style('s', 'font-style')).toBe('italic');
  });
});

describe('@supports', () => {
  it('known properties with values Nova supports are true; unknown properties and values are false', () => {
    expect(evaluateSupportsCondition('(display: grid)')).toBe(true);
    expect(evaluateSupportsCondition('(display: nonsense)')).toBe(false);
    expect(evaluateSupportsCondition('(display: contents)')).toBe(false);
    expect(evaluateSupportsCondition('(position: sticky) and (gap: 1rem)')).toBe(true);
    expect(evaluateSupportsCondition('(not-a-property: 1)')).toBe(false);
    expect(evaluateSupportsCondition('not (display: nonsense)')).toBe(true);
  });
});
