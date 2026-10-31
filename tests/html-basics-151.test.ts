/**
 * Everyday HTML/CSS that rendered wrong: [hidden], closed <details>, <br>, <pre> newlines,
 * white-space: nowrap, text-transform, pseudo-elements taking their host's UA styles.
 * See doc/2026-10-30-nova-android-1.51-*.md.
 */
import { describe, expect, it, vi } from 'vitest';
import { DomTree } from '../src/browser/rendering/dom-tree';
import { HtmlParser } from '../src/browser/rendering/html-parser';
import { CssParser } from '../src/browser/rendering/css-parser';
import { LayoutEngine } from '../src/browser/rendering/layout-engine';
import { PaintEngine } from '../src/browser/rendering/paint-engine';
import { PageRenderer } from '../src/browser/engine/page-renderer';

async function render(body: string, width = 300) {
  const domTree = new DomTree();
  const paint = new PaintEngine();
  const r = new PageRenderer({ htmlParser: new HtmlParser(), domTree, cssParser: new CssParser(), layoutEngine: new LayoutEngine(), paintEngine: paint, svgDecode: async () => null,
    resourceLoader: { loadResource: vi.fn(), loadBatch: vi.fn(), loadStylesheet: vi.fn().mockResolvedValue(''), loadScript: vi.fn().mockResolvedValue(''), loadImage: vi.fn(), getPriority: vi.fn(), setMaxConcurrent: vi.fn(), on: vi.fn(), off: vi.fn(), dispose: vi.fn() },
    prioritizer: { submit: vi.fn(), submitBatch: vi.fn(), submitPreload: vi.fn(), submitPrefetch: vi.fn(), submitPreconnect: vi.fn(), clear: vi.fn(), dispose: vi.fn() } } as never);
  r.setViewport(width, 800, 1);
  await r.render({ url: 'http://t.local/', statusCode: 200, contentType: 'text/html', body: `<html><body style="margin:0">${body}</body></html>`, headers: new Map(), loadedAt: 0 } as never, new AbortController().signal);
  r.dispose();
  const texts = paint.compositeFrame().filter((c) => c.type === 'fillText').map((c) => ({ t: String(c.params[0]), x: c.params[1] as number, y: c.params[2] as number }));
  return { domTree, texts, words: texts.map((x) => x.t).filter((t) => t.trim()) };
}

describe('content that should not show', () => {
  it('[hidden] is display:none (an author display still wins)', async () => {
    expect((await render('<p>a</p><p hidden>SECRET</p><div hidden style="display:block">shown</div>')).words).toEqual(['a', 'shown']);
  });
  it('a closed <details> shows only its <summary>; open shows everything', async () => {
    // The summary's disclosure marker (1.58) is drawn too: ▸ closed, ▾ open.
    expect((await render('<details><summary>Sum</summary><p>INNER</p></details>')).words.sort()).toEqual(['Sum', '▸']);
    expect((await render('<details open><summary>Sum</summary><p>INNER</p></details>')).words.sort()).toEqual(['INNER', 'Sum', '▾']);
  });
});

describe('line breaking', () => {
  it('<br> is one line break; <br><br> leaves one blank line', async () => {
    const one = (await render('<p>one<br>two</p>')).texts;
    const lh = one.find((x) => x.t === 'two')!.y - one.find((x) => x.t === 'one')!.y;
    expect(lh).toBeGreaterThan(10);
    expect(lh).toBeLessThan(40); // was two lines
    const two = (await render('<p>one<br><br>two</p>')).texts;
    expect(two.find((x) => x.t === 'two')!.y - two.find((x) => x.t === 'one')!.y).toBeCloseTo(2 * lh, 0);
  });
  it('<pre> keeps newlines and indentation', async () => {
    const { texts } = await render('<pre>line1\n  line2</pre>');
    const l1 = texts.find((x) => x.t === 'line1')!, l2 = texts.find((x) => x.t === 'line2')!;
    expect(l2.y).toBeGreaterThan(l1.y);
    expect(l2.x).toBeGreaterThan(l1.x); // the two spaces
  });
  it('white-space: nowrap stays on one line', async () => {
    const { texts } = await render('<p style="white-space:nowrap;width:50px">aaa bbb ccc ddd</p>');
    expect(new Set(texts.map((x) => x.y)).size).toBe(1);
  });
});

describe('text-transform and pseudo-element defaults', () => {
  it('uppercase / lowercase / capitalize', async () => {
    expect((await render('<p style="text-transform:uppercase">hello world</p><p style="text-transform:capitalize">hello (big) world</p><p style="text-transform:lowercase">LOUD</p>')).words)
      .toEqual(['HELLO', 'WORLD', 'Hello', '(Big)', 'World', 'loud']);
  });
  it("::before doesn't take its host's UA styles (a div's display, an li's list-item)", async () => {
    const { domTree, words } = await render('<style>#d::before{content:"x"} li::before{content:"-"}</style><div id="d">t</div><ul><li id="l">i</li></ul>');
    expect(domTree.getElementById('d')!.pseudoBefore!.computedStyle!.get('display')).toBe('inline');
    expect(domTree.getElementById('l')!.pseudoBefore!.computedStyle!.get('display')).toBe('inline');
    expect(words.filter((w) => w === '•')).toHaveLength(1); // one marker, not two
  });
});
