/**
 * 1.83, MDN (seen live in 1.80, reproduced from a saved copy): dark bars over the article, solid
 * squares after the nav labels, a 1016px outlined box behind the header, and inline <code>
 * backgrounds covering the lines around them. Causes:
 * - an absolutely positioned inline's static position was the line start;
 * - `content: "…" / "alt"` rendered the alt text;
 * - mask-image url() icons painted as solid squares;
 * - `#rgba` hex colours were black;
 * - percentage heights of auto-height parents resolved against the width (inline-block, float, flex);
 * - inline boxes were a whole line tall.
 */
import { describe, expect, it, vi } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { DomTree } from '../src/browser/rendering/dom-tree';
import { HtmlParser } from '../src/browser/rendering/html-parser';
import { CssParser } from '../src/browser/rendering/css-parser';
import { LayoutEngine } from '../src/browser/rendering/layout-engine';
import { PaintEngine } from '../src/browser/rendering/paint-engine';
import { PageRenderer } from '../src/browser/engine/page-renderer';
import { parseColor } from '../src/browser/rendering/rasterizer';

async function render(html: string, loadCss: (url: string) => string = () => '', width = 600) {
  const domTree = new DomTree(); const layout = new LayoutEngine(); const paint = new PaintEngine();
  const r = new PageRenderer({ htmlParser: new HtmlParser(), domTree, cssParser: new CssParser(), layoutEngine: layout, paintEngine: paint, svgDecode: async () => null,
    resourceLoader: { loadResource: vi.fn(), loadBatch: vi.fn(), loadStylesheet: vi.fn().mockImplementation(async (u: string) => loadCss(u)), loadScript: vi.fn().mockResolvedValue(''), loadImage: vi.fn(), getPriority: vi.fn(), setMaxConcurrent: vi.fn(), on: vi.fn(), off: vi.fn(), dispose: vi.fn() },
    prioritizer: { submit: vi.fn(), submitBatch: vi.fn(), submitPreload: vi.fn(), submitPrefetch: vi.fn(), submitPreconnect: vi.fn(), clear: vi.fn(), dispose: vi.fn() } } as never);
  r.setViewport(width, 1600, 1);
  await r.render({ url: 'http://t.local/', statusCode: 200, contentType: 'text/html', headers: new Map(), loadedAt: 0, body: html } as never, new AbortController().signal);
  const box = (id: string) => layout.getLayoutBox(domTree.getElementById(id)!.domId)!;
  const rects = () => paint.compositeFrame().filter((c) => c.type === 'fillRect').map((c) => c.params as number[]);
  return { box, rects, domTree, r };
}
const page = (css: string, body: string) => `<!doctype html><html><head><style>${css}</style></head><body style="margin:0;font:16px/24px sans-serif">${body}</body></html>`;
const EXT = '.external{padding-right:1.125em;position:relative}.external:after{background-color:red;content:"";height:1em;position:absolute;width:1em}';

describe('generated icons', () => {
  it('an absolutely positioned ::after with no offsets sits where the line had got to', async () => {
    const { rects, r } = await render(page(EXT, '<div style="height:200px"></div><p style="margin:0">Read the <a class="external" href="#">Notice</a> now</p>'));
    const icon = rects().find((p) => p[2] === 16 && p[3] === 16)!;
    expect(icon[0]).toBeGreaterThan(60); // after "Read the Notice", not at the line start
    expect(icon[1]).toBe(200);
    r.dispose();
  });
  it('content alt text after "/" is not rendered', async () => {
    const css = '.external{position:relative}.external:after{content:"\\2192" / " (external)"}';
    const { domTree, r } = await render(page(css, '<p><a id="a" class="external" href="#">Notice</a></p>'));
    const after = (domTree.getElementById('a') as unknown as { pseudoAfter: { children: Array<{ text: string }> } }).pseudoAfter;
    expect(after.children[0]!.text).toBe('→');
    r.dispose();
  });
  it('a background drawn through an unloaded mask-image url() paints nothing', async () => {
    const { rects, r } = await render(page('i{display:inline-block;width:20px;height:20px;background-color:#123456;mask-image:url(icon.svg)}', '<p>Menu<i></i></p>'));
    expect(rects().some((p) => p[2] === 20 && p[3] === 20)).toBe(false);
    r.dispose();
  });
});

describe('colours', () => {
  it('#rgba has an alpha channel', () => {
    expect(parseColor('#0000').a).toBe(0);
    expect(parseColor('#f008')).toMatchObject({ r: 255, g: 0, b: 0 });
    expect(parseColor('#f008').a).toBeCloseTo(0x88 / 255);
  });
});

describe('percentage heights of auto-height parents behave as auto', () => {
  for (const display of ['inline-flex', 'inline-block']) {
    it(display, async () => {
      const { box, r } = await render(page('', `<div id="t" style="width:600px"><span id="s" style="display:${display};height:100%;width:100%"><span>xx</span></span></div>`));
      expect(box('s').height).toBe(24);
      expect(box('t').height).toBe(24);
      r.dispose();
    });
  }
  it('a float', async () => {
    const { box, r } = await render(page('', '<div style="width:600px"><div id="f" style="float:left;width:300px;height:100%">xx</div></div>'));
    expect(box('f').height).toBe(24);
    r.dispose();
  });
  it('a flex item in a flex row of auto height', async () => {
    const { box, r } = await render(page('', '<div style="display:flex;width:600px"><div id="i" style="height:100%;width:50px">xx</div></div>'));
    expect(box('i').height).toBe(24);
    r.dispose();
  });
  it('still resolves against a definite parent height', async () => {
    const { box, r } = await render(page('', '<div style="height:80px;width:600px"><span id="s" style="display:inline-block;height:50%">xx</span></div>'));
    expect(box('s').height).toBe(40);
    r.dispose();
  });
});

describe('inline boxes', () => {
  it('an inline element is its content area tall, not the line height', async () => {
    const { box, r } = await render(page('', '<p style="margin:0;line-height:40px">a <code id="c" style="padding:2px 4px;background:#eee">code</code> b</p>'));
    expect(box('c').height).toBeLessThan(26); // 16px content area + 4px padding, not 40 + 4
    expect(box('c').height).toBeGreaterThan(18);
    r.dispose();
  });
});

describe('MDN "HTML" reference (saved 2026)', () => {
  it('has no bars over the article and no ballooned header toggle', async () => {
    const dir = 'tests/fixtures/mdn-html-2026/';
    const files = readdirSync(dir);
    const css = (url: string) => { const b = url.split(/[?#]/)[0]!.split('/').pop() ?? ''; return files.includes(b) ? readFileSync(dir + b, 'utf8') : ''; };
    for (const w of [412, 1070]) {
      const { rects, domTree, r } = await render(readFileSync(dir + 'index.html', 'utf8'), css, w);
      expect(rects().filter((p) => p[2]! <= 30 && p[3]! >= 60), `w=${w}`).toEqual([]);
      let toggle: { layoutBox: { height: number } | null } | null = null;
      const find = (n: { tagName?: string; children?: unknown[] }) => {
        if (n.tagName?.toLowerCase() === 'mdn-toggle-sidebar') toggle = n as never;
        for (const c of n.children ?? []) find(c as never);
      };
      find(domTree.getDocument() as never);
      expect(toggle!.layoutBox!.height, `w=${w}`).toBeLessThan(60); // was 1016
      r.dispose();
    }
  }, 120000);
});
