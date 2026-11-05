/**
 * 1.85, from the live tablet check of 1.84 (Wikipedia: blue rings around the page-tool icons, the
 * wordmark under the search box, citation markers as dots) and the saved MDN and IANA pages.
 */
import { describe, expect, it, vi } from 'vitest';
import { DomTree } from '../src/browser/rendering/dom-tree';
import type { DomElement } from '../src/browser/rendering/dom-tree';
import { HtmlParser } from '../src/browser/rendering/html-parser';
import { CssParser } from '../src/browser/rendering/css-parser';
import { LayoutEngine } from '../src/browser/rendering/layout-engine';
import { PaintEngine } from '../src/browser/rendering/paint-engine';
import { PageRenderer } from '../src/browser/engine/page-renderer';

async function render(body: string, width = 800) {
  const domTree = new DomTree(); const layout = new LayoutEngine(); const paint = new PaintEngine();
  const r = new PageRenderer({ htmlParser: new HtmlParser(), domTree, cssParser: new CssParser(), layoutEngine: layout, paintEngine: paint, svgDecode: async () => null,
    resourceLoader: { loadResource: vi.fn(), loadBatch: vi.fn(), loadStylesheet: vi.fn().mockResolvedValue(''), loadScript: vi.fn().mockResolvedValue(''), loadImage: vi.fn(), getPriority: vi.fn(), setMaxConcurrent: vi.fn(), on: vi.fn(), off: vi.fn(), dispose: vi.fn() },
    prioritizer: { submit: vi.fn(), submitBatch: vi.fn(), submitPreload: vi.fn(), submitPrefetch: vi.fn(), submitPreconnect: vi.fn(), clear: vi.fn(), dispose: vi.fn() } } as never);
  r.setViewport(width, 600, 1);
  await r.render({ url: 'http://t.local/', statusCode: 200, contentType: 'text/html', headers: new Map(), loadedAt: 0, body: `<!doctype html><html><body style="margin:0;font:16px/20px sans-serif">${body}</body></html>` } as never, new AbortController().signal);
  const el = (id: string) => domTree.getElementById(id)! as DomElement;
  const box = (id: string) => layout.getLayoutBox(el(id).domId)!;
  const texts = () => paint.compositeFrame().filter((c) => c.type === 'fillText').map((c) => String(c.params[0]));
  return { el, box, texts, domTree, r };
}

describe('selectors: :not() inside :is()/:where()', () => {
  it('matches the right elements (querySelectorAll and the cascade)', async () => {
    const { domTree, el, r } = await render(`<style>a:where(:not([role='button']):not(.x)):focus-visible{outline:solid 2px red}</style>
      <a id="p" href="#">p</a><a id="b" role="button" href="#x">b</a><a id="h" class="q">h</a>`);
    const ids = (s: string) => domTree.querySelectorAll(s).map((e) => e.attributes.get('id')).join(',');
    expect(ids("a:where(:not([role='button']))")).toBe('p,h');
    expect(ids('a:is(:not([role=button]))')).toBe('p,h');
    expect(ids('a:where(:not(.q))')).toBe('p,b');
    expect(ids('a:is(:not(#p))')).toBe('b,h');
    expect(el('b').computedStyle?.get('outline-style')).not.toBe('solid'); // was a 2px focus ring
    r.dispose();
  });
});

describe('font-size units', () => {
  it('rem, pt and vw font sizes compute to px, so em children size from them', async () => {
    const { el, r } = await render('<p id="p" style="font-size:1rem"><sup id="s" style="font-size:.75em">1</sup></p><p id="t" style="font-size:12pt">t</p><p id="v" style="font-size:2vw">v</p>');
    expect(el('p').computedStyle?.get('font-size')).toBe('16px');
    expect(el('s').computedStyle?.get('font-size')).toBe('12px'); // was 0.75px: Wikipedia's [1] markers
    expect(el('t').computedStyle?.get('font-size')).toBe('16px');
    expect(el('v').computedStyle?.get('font-size')).toBe('16px');
    r.dispose();
  });
});

describe('flex: min/max sizes and border-box units', () => {
  it('a min-width item keeps its width and the next item starts after it', async () => {
    const { box, r } = await render('<div style="display:flex"><div id="a" style="min-width:160px">x</div><div id="b" style="flex-grow:1;width:100%">S</div></div>');
    expect(box('a').width).toBe(160);
    expect(box('b').x).toBe(160); // was 3: drawn over the logo box
    r.dispose();
  });
  it('an item does not shrink below its min-content (a float inside)', async () => {
    const { box, r } = await render('<div style="display:flex"><div id="a"><a style="float:left;width:140px;height:20px"></a></div><div id="b" style="width:100%">S</div></div>');
    expect(box('a').width).toBe(140);
    expect(box('b').x).toBe(140);
    r.dispose();
  });
  it('padding and border are part of a content-box item\'s size', async () => {
    const { box, r } = await render('<div style="display:flex"><div id="a" style="width:100px;border:5px solid;padding:5px"></div><div id="b">S</div></div>');
    expect(box('a').width).toBe(120);
    expect(box('b').x).toBe(120);
    r.dispose();
  });
  it('max-width caps a growing item', async () => {
    const { box, r } = await render('<div style="display:flex;width:600px"><div id="a" style="flex-grow:1;max-width:100px">a</div><div id="b" style="flex-grow:1">b</div></div>');
    expect(box('a').width).toBe(100);
    expect(box('b').width).toBe(500);
    r.dispose();
  });
  it('a flex-container item is measured as flex (its items side by side)', async () => {
    const { box, r } = await render('<div style="display:flex"><ol id="a" style="display:flex;list-style:none;padding:0;margin:0"><li>Web</li><li>HTML</li></ol><div id="b">X</div></div>');
    expect(box('b').x).toBe(box('a').width);
    expect(box('a').height).toBe(20); // one line, not stacked
    r.dispose();
  });
  it('a trailing right margin counts in a measured width', async () => {
    const { box, r } = await render('<div style="display:flex"><div id="a" style="display:flex"><span>Web</span><i style="display:block;width:20px;height:10px;margin:0 4px"></i></div><div id="b">X</div></div>');
    expect(box('b').x).toBeGreaterThanOrEqual(box('a').x + box('a').width);
    expect(box('a').width).toBeGreaterThanOrEqual(28 + 10);
    r.dispose();
  });
});

describe('inline-flex and inline-block sizing', () => {
  it('justify-content:center does not widen a shrink-to-fit button', async () => {
    const { box, r } = await render('<div><label id="a" style="display:inline-flex;justify-content:center"><span style="display:inline-block;width:20px;height:20px"></span></label></div>');
    expect(box('a').width).toBe(20); // was the whole line
    r.dispose();
  });
  it('min-width applies to inline-blocks', async () => {
    const { box, r } = await render('<div><a id="a" style="display:inline-flex;min-width:44px"><span style="display:inline-block;width:20px;height:20px"></span></a></div>');
    expect(box('a').width).toBe(44);
    r.dispose();
  });
  it('a percentage width inside a shrink-to-fit box is auto while measuring', async () => {
    const { box, r } = await render('<div style="display:flex"><div id="a"><span style="display:inline-flex"><button style="display:inline-flex;width:100%">t</button></span></div><div id="b">X</div></div>');
    expect(box('a').width).toBeLessThan(100); // was the row's width
    r.dispose();
  });
});

describe('text directly in flex and grid containers', () => {
  it('is laid out and painted as an anonymous item', async () => {
    const { box, texts, r } = await render('<div id="a" style="display:flex;justify-content:center;width:300px">Mid</div><span id="i" style="display:inline-flex;padding:0 10px">Hello world</span><div style="display:grid">Grid text</div>');
    expect(texts()).toEqual(expect.arrayContaining(['Mid', 'Hello', 'world', 'Grid', 'text']));
    expect(box('a').height).toBe(20);
    expect(box('i').width).toBeGreaterThan(40); // was its padding only
    r.dispose();
  });
});

describe('<template>', () => {
  it('its content is not rendered and stays inside it', async () => {
    const { el, texts, r } = await render('<template id="t"><i id="i">Hidden</i></template><p>Shown</p>');
    expect(texts()).not.toContain('Hidden');
    expect(el('i').parent).toBe(el('t'));
    r.dispose();
  });
  it('an unclosed element inside does not keep it open', async () => {
    const { el, r } = await render('<template id="t"><div>x</template><p id="p">after</p>');
    expect(el('p').parent).not.toBe(el('t'));
    r.dispose();
  });
  it('declarative shadow DOM renders the shadow tree with slotted light children', async () => {
    const { texts, r } = await render('<x-btn><template shadowrootmode="open"><b>Icon</b><span hidden><slot></slot></span><i><slot name="n">Fallback</slot></i></template>Hidden label<em slot="n">Named</em></x-btn><x-f><template shadowrootmode="open"><slot name="z">Fallback</slot></template></x-f>');
    const t = texts();
    expect(t).toContain('Icon');
    expect(t).toContain('Named');
    expect(t).toContain('Fallback');
    expect(t).not.toContain('Hidden');
    r.dispose();
  });
});
