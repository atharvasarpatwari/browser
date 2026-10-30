/**
 * Inline flex items lost their text; place-items was never expanded. See
 * doc/2026-10-30-nova-android-1.45-*.md.
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
    resourceLoader: { loadResource: vi.fn(), loadBatch: vi.fn(), loadStylesheet: vi.fn().mockResolvedValue(''), loadScript: vi.fn().mockResolvedValue(''), loadImage: vi.fn(), getPriority: vi.fn(), setMaxConcurrent: vi.fn(), on: vi.fn(), off: vi.fn(), dispose: vi.fn() },
    prioritizer: { submit: vi.fn(), submitBatch: vi.fn(), submitPreload: vi.fn(), submitPrefetch: vi.fn(), submitPreconnect: vi.fn(), clear: vi.fn(), dispose: vi.fn() } } as never);
  r.setViewport(424, 800, 1);
  await r.render({ url: 'http://t.local/', statusCode: 200, contentType: 'text/html', body: `<html><head><style>body{margin:0}${css}</style></head><body>${body}</body></html>`, headers: new Map(), loadedAt: 0 } as never, new AbortController().signal);
  r.dispose();
  return { domTree, texts: paint.compositeFrame().filter((c) => c.type === 'fillText').map((c) => [String(c.params[0]), c.params[1] as number, c.params[2] as number] as const) };
}

describe('inline flex items keep their text (the brand name on httpforever was blank)', () => {
  it('a <span> in a flex or inline-flex container paints its text', async () => {
    for (const body of ['<div style="display:flex"><span id="s">Hello</span></div>', '<span style="display:inline-flex"><svg width="10" height="10"></svg><span id="s">HTTP&nbsp;Forever</span></span>']) {
      const { texts, domTree } = await render(body);
      const s = domTree.getElementById('s')!.layoutBox!;
      const t = texts.find(([w]) => /Hello|Forever/.test(w))!;
      expect(t).toBeDefined();
      expect(t[1]).toBeGreaterThanOrEqual(s.x - 0.5);
    }
  });

  it('a vertically centred item carries its content with it', async () => {
    const { texts, domTree } = await render('<div style="display:flex;align-items:center;height:100px"><div id="i"><b>mid</b></div></div>');
    const box = domTree.getElementById('i')!.layoutBox!;
    expect(box.y).toBeGreaterThan(30);
    const t = texts.find(([w]) => w === 'mid')!;
    expect(t[2]).toBeGreaterThan(box.y);
    expect(t[2]).toBeLessThan(box.y + box.height + 1);
  });
});

describe('place-items / place-content / place-self', () => {
  it('expand to align-* and justify-* (one value means both)', async () => {
    const { domTree } = await render('<div id="a" style="display:grid;place-items:center"></div><div id="b" style="place-content:start end"></div><div id="c" style="place-self:end"></div>');
    const st = (id: string) => domTree.getElementById(id)!.computedStyle!;
    expect([st('a').get('align-items'), st('a').get('justify-items')]).toEqual(['center', 'center']);
    expect([st('b').get('align-content'), st('b').get('justify-content')]).toEqual(['start', 'end']);
    expect([st('c').get('align-self'), st('c').get('justify-self')]).toEqual(['end', 'end']);
  });

  it('a grid item with place-items: center is centred horizontally', async () => {
    const { domTree } = await render('<div style="display:grid;place-items:center;width:100px;height:40px"><svg id="i" width="20" height="20"></svg></div>');
    expect(domTree.getElementById('i')!.layoutBox!.x).toBeCloseTo(40, 0);
  });
});

describe("CSP: only fetch directives fall back to default-src (httpforever's default-src 'none' blocked its own reload)", () => {
  it('navigations and form submits are not governed by default-src; fetches still are', async () => {
    const { CspPolicyStore } = await import('../src/browser/security/csp-policy-store');
    const { CspNavigationGuard } = await import('../src/browser/security/csp-navigation-guard');
    const { parseCspHeader, getEffectiveSources } = await import('../src/browser/security/csp-parser') as unknown as {
      parseCspHeader(h: string): never; getEffectiveSources(p: unknown, d: string): unknown[] | undefined };
    const header = "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; base-uri 'none'";
    const store = new CspPolicyStore();
    store.store('http://httpforever.com', parseCspHeader(header));
    const guard = new CspNavigationGuard(store);
    for (const type of ['reload', 'push', 'form-submit'] as const) {
      const r = guard.checkNavigation({ url: 'http://httpforever.com/', type, documentOrigin: 'http://httpforever.com', userInitiated: true } as never);
      expect([type, r.allowed]).toEqual([type, true]);
    }
    const policy = (parseCspHeader(header) as unknown as { policies?: unknown[] }).policies?.[0] ?? parseCspHeader(header);
    expect(getEffectiveSources(policy, 'connect-src')).toBeDefined();    // a fetch directive: default-src applies
    expect(getEffectiveSources(policy, 'form-action')).toBeUndefined();  // not a fetch directive
    store.dispose();
  });
});

describe('dark default text survives a restyle (example.com went black on #222 on the phone, 1.45)', () => {
  it('the incremental style pass keeps CanvasText white in dark mode', async () => {
    const { setPreferredColorScheme } = await import('../src/browser/rendering/color-scheme');
    try {
      setPreferredColorScheme('dark');
      const domTree = new DomTree();
      const r = new PageRenderer({ htmlParser: new HtmlParser(), domTree, cssParser: new CssParser(), layoutEngine: new LayoutEngine(), paintEngine: new PaintEngine(), svgDecode: async () => null,
        resourceLoader: { loadResource: vi.fn(), loadBatch: vi.fn(), loadStylesheet: vi.fn().mockResolvedValue(''), loadScript: vi.fn().mockResolvedValue(''), loadImage: vi.fn(), getPriority: vi.fn(), setMaxConcurrent: vi.fn(), on: vi.fn(), off: vi.fn(), dispose: vi.fn() },
        prioritizer: { submit: vi.fn(), submitBatch: vi.fn(), submitPreload: vi.fn(), submitPrefetch: vi.fn(), submitPreconnect: vi.fn(), clear: vi.fn(), dispose: vi.fn() } } as never);
      r.setViewport(424, 800, 1);
      const html = '<html><head><style>html{color-scheme:light dark;background:light-dark(#eee,#222)}body{font:16px/1.6 system-ui,sans-serif}</style></head><body><p id="p">This domain is for use in documentation examples.</p></body></html>';
      await r.render({ url: 'https://example.com/', statusCode: 200, contentType: 'text/html', body: html, headers: new Map(), loadedAt: 0 } as never, new AbortController().signal);
      const ctrl = (r as unknown as { reflowController: { processFrame(): void; markDirty(n: unknown, k: string): void } }).reflowController;
      const walk = (n: { nodeType: string; children: unknown[] }) => { if (n.nodeType === 'element') ctrl.markDirty(n, 'style'); for (const c of n.children as never[]) walk(c); };
      walk(domTree.getElementsByTagName('html')[0] as never);
      ctrl.processFrame();
      expect(domTree.getElementById('p')!.computedStyle?.get('color')).toMatch(/#ffffff|255, ?255, ?255/i);
      r.dispose();
    } finally {
      setPreferredColorScheme('light');
    }
  });
});

describe('tables: anonymous cells, real row heights, captions (Wikipedia figure caption overlapped the article, 1.45)', () => {
  it('a display:table <figure>: the image link gets an anonymous cell; the caption is full width, below, and taken into the height', async () => {
    const { domTree } = await render('<figure id="f" style="display:table;margin:0"><a id="a" href="#"><img width="200" height="100"></a><figcaption id="c" style="display:table-caption;caption-side:bottom">A web browser on a laptop displaying a page</figcaption></figure><p id="p">next</p>');
    const f = domTree.getElementById('f')!.layoutBox!, c = domTree.getElementById('c')!.layoutBox!, p = domTree.getElementById('p')!.layoutBox!;
    const img = domTree.getElementsByTagName('img')[0]!.layoutBox!;
    expect(img.height).toBe(100);                  // laid out (it was skipped)
    expect(c.width).toBeGreaterThan(300);          // not 0: one word per line
    expect(c.y).toBeGreaterThanOrEqual(img.y + 100 - 1); // caption-side: bottom on the caption
    expect(f.height).toBeGreaterThanOrEqual(120);   // was 0
    expect(p.y).toBeGreaterThanOrEqual(c.y + c.height - 1); // no overlap
  });

  it('a row is as tall as its tallest cell and every cell is stretched to it', async () => {
    const { domTree } = await render('<table id="t" style="border-spacing:0"><tr><td id="a">one<br>two<br>three<br>four</td><td id="b">x</td></tr><tr><td id="c">after</td></tr></table>');
    const a = domTree.getElementById('a')!.layoutBox!, b = domTree.getElementById('b')!.layoutBox!, c = domTree.getElementById('c')!.layoutBox!;
    expect(a.height).toBeGreaterThan(60);
    expect(b.height).toBeCloseTo(a.height, 0);
    expect(c.y).toBeGreaterThanOrEqual(a.y + a.height - 1);
  });
});

describe('HTML tables are tables (cells nested in each other; tables were blocks of inline text)', () => {
  const shape = (n: { nodeType: string; tagName?: string; children: unknown[] }): string =>
    n.nodeType !== 'element' ? '' : `${n.tagName}(${(n.children as never[]).map(shape).filter(Boolean).join(',')})`;
  const parse = (h: string) => {
    const t = new DomTree();
    const doc = t.buildFromHtml((new HtmlParser().parse(`<html><body>${h}</body></html>`) as unknown as { document: never }).document) as unknown as { bodyElement: never };
    return { t, body: doc.bodyElement };
  };
  it('text in a cell no longer takes the parser out of the table', () => {
    expect(shape(parse('<table><tr><td>1</td><td>2</td></tr></table>').body)).toBe('body(table(tbody(tr(td(),td()))))');
    expect(shape(parse('<table><tr><td>a<b>x</b><textarea>t</textarea></td><td>2</td></tr></table><p>after</p>').body))
      .toBe('body(table(tbody(tr(td(b(),textarea()),td()))),p())');
  });
  it('querySelector / querySelectorAll follow document order, not depth', () => {
    const { t } = parse('<div><div><section id="deep"></section></div></div><section id="shallow"></section>');
    expect(t.querySelector('section')?.attributes.get('id')).toBe('deep');
    expect(t.querySelectorAll('section').map((e) => e.attributes.get('id'))).toEqual(['deep', 'shallow']);
  });
  it('the UA gives table elements their table displays', async () => {
    const { domTree } = await render('<table id="t"><caption id="cap">c</caption><thead><tr><th id="h">H</th></tr></thead><tbody id="tb"><tr id="r"><td id="d">d</td></tr></tbody></table>');
    const d = (id: string) => domTree.getElementById(id)!.computedStyle!.get('display');
    expect([d('t'), d('cap'), d('tb'), d('r'), d('d'), d('h')]).toEqual(['table', 'table-caption', 'table-row-group', 'table-row', 'table-cell', 'table-cell']);
    expect(domTree.getElementById('h')!.computedStyle!.get('font-weight')).toMatch(/bold|700/);
  });
});
