/**
 * ::before / ::after generated content (never rendered before 1.44). See
 * doc/2026-10-30-nova-android-1.44-*.md.
 */
import { describe, expect, it, vi } from 'vitest';
import { DomTree } from '../src/browser/rendering/dom-tree';
import { HtmlParser } from '../src/browser/rendering/html-parser';
import { CssParser } from '../src/browser/rendering/css-parser';
import { LayoutEngine } from '../src/browser/rendering/layout-engine';
import { PaintEngine } from '../src/browser/rendering/paint-engine';
import { PageRenderer } from '../src/browser/engine/page-renderer';
import { contentText } from '../src/browser/rendering/generated-content';

async function render(html: string, js = '') {
  const domTree = new DomTree();
  const paint = new PaintEngine();
  const renderer = new PageRenderer({ htmlParser: new HtmlParser(), domTree, cssParser: new CssParser(), layoutEngine: new LayoutEngine(), paintEngine: paint, svgDecode: async () => null,
    resourceLoader: { loadResource: vi.fn(), loadBatch: vi.fn(), loadStylesheet: vi.fn().mockResolvedValue(''), loadScript: vi.fn().mockResolvedValue(js), loadImage: vi.fn(), getPriority: vi.fn(), setMaxConcurrent: vi.fn(), on: vi.fn(), off: vi.fn(), dispose: vi.fn() },
    prioritizer: { submit: vi.fn(), submitBatch: vi.fn(), submitPreload: vi.fn(), submitPrefetch: vi.fn(), submitPreconnect: vi.fn(), clear: vi.fn(), dispose: vi.fn() } } as never);
  renderer.setViewport(424, 900, 1);
  await renderer.render({ url: 'http://test.local/', statusCode: 200, contentType: 'text/html', body: html, headers: new Map(), loadedAt: 0 } as never, new AbortController().signal);
  renderer.dispose();
  const texts = paint.compositeFrame().filter((c) => c.type === 'fillText').map((c) => String(c.params[0]));
  return { domTree, paint, texts };
}

describe('content values', () => {
  const host = { attributes: new Map([['href', '/x'], ['data-n', '3']]) } as never;
  it('strings, escapes, attr() and quotes', () => {
    expect(contentText('"\\201C" "a\\"b" \'c\'', host)).toBe('“a"bc');
    expect(contentText('"\\2014 \\A0x"', host)).toBe('— x'); // one space ends a hex escape
    expect(contentText('" (" attr(href) ")"', host)).toBe(' (/x)');
    expect(contentText('open-quote "q" close-quote', host)).toBe('“q”');
    expect(contentText('counter(item) ". "', host)).toBe('. ');
    expect(contentText('""', host)).toBe('');
  });
  it('none, normal and invalid values make no box', () => {
    expect(contentText('none', host)).toBeNull();
    expect(contentText('normal', host)).toBeNull();
    expect(contentText('bogus', host)).toBeNull();
  });
});

describe('::before / ::after boxes', () => {
  it('are laid out and painted with the element: separators, bullets, labels', async () => {
    const { texts, domTree } = await render('<html><head><style>li::before{content:"\\2022  "} .crumb + .crumb::before{content:"\\203A"} a.ext::after{content:" (" attr(href) ")"} p:after{content:"!"}</style></head><body><ul><li id="l">One</li></ul><span class="crumb">Home</span><span class="crumb" id="c2">Docs</span><a class="ext" href="/x">link</a><p>Hi</p></body></html>');
    expect(texts).toContain('•');
    expect(texts).toContain('›');
    expect(texts.join(' ')).toContain('(/x)');
    expect(texts.slice(texts.indexOf('Hi'), texts.indexOf('Hi') + 2)).toEqual(['Hi', '!']); // its own run, right after the content
    const before = domTree.getElementById('l')!.pseudoBefore!;
    const li = domTree.getElementById('l')!.layoutBox!;
    expect(before.layoutBox!.x).toBeGreaterThanOrEqual(li.x);
    expect(before.layoutBox!.y).toBeCloseTo(li.y, 0);
  });

  it('are not DOM children: scripts, textContent and queries see only the page', async () => {
    const { domTree } = await render('<html><head><style>#p::before{content:"X"} #p::after{content:"Y"}</style></head><body><p id="p">mid</p><p id="out"></p></body></html>',
      '');
    const p = domTree.getElementById('p')!;
    expect(p.children).toHaveLength(1);
    expect(p.pseudoBefore?.tagName).toBe('::before');
    expect(p.pseudoAfter?.tagName).toBe('::after');
    const { runJS } = await import('../src/browser/js/index');
    const r = runJS('var p = document.getElementById("p"); p.textContent + "|" + p.childNodes.length + "|" + document.querySelectorAll("*").length', { document: domTree.getDocument(), domTree } as never);
    expect(String(r.value).split('|').slice(0, 2)).toEqual(['mid', '1']);
  });

  it('no content, no box; legacy single-colon works; the element itself is not styled', async () => {
    const { domTree } = await render('<html><head><style>#a::before{color:red} #b:before{content:"B"} #b::before{position:absolute}</style></head><body><div id="a">a</div><div id="b">b</div></body></html>');
    expect(domTree.getElementById('a')!.pseudoBefore).toBeNull();
    const b = domTree.getElementById('b')!;
    expect(b.pseudoBefore?.children).toHaveLength(1);
    expect(b.computedStyle?.get('position') ?? 'static').toBe('static');
  });

  it('an empty decorative box: positioned over its host with a background', async () => {
    const { paint, domTree } = await render('<html><head><style>body{margin:0} .card{position:relative;height:100px} .card::before{content:"";position:absolute;top:0;left:0;right:0;height:4px;background:#ff0000}</style></head><body><div class="card" id="c"></div></body></html>');
    const box = domTree.getElementById('c')!.pseudoBefore!.layoutBox!;
    expect([box.x, box.y, box.width, box.height]).toEqual([0, 0, 424, 4]);
    const cmds = paint.compositeFrame();
    const i = cmds.findIndex((c) => c.type === 'setFillStyle' && /ff0000|255, ?0, ?0/i.test(String(c.params[0])));
    expect(i).toBeGreaterThan(-1);
  });

  it('inherits from its host (colour, font size)', async () => {
    const { domTree } = await render('<html><head><style>#h{color:#123456;font-size:20px} #h::after{content:"*"}</style></head><body><div id="h">t</div></body></html>');
    const s = domTree.getElementById('h')!.pseudoAfter!.computedStyle!;
    expect(s.get('color')).toBe('#123456');
    expect(s.get('font-size')).toBe('20px');
  });
});

describe('fixed overlay after a page-load reveal (found on the phone: httpforever cards lost their text, 1.41-1.43)', () => {
  it('animated stacking contexts stay out of the fixed overlay, so their text survives later frames', async () => {
    const { readFileSync } = await import('node:fs');
    const F = 'tests/fixtures/httpforever-2026/';
    const domTree = new DomTree();
    const paint = new PaintEngine();
    const renderer = new PageRenderer({ htmlParser: new HtmlParser(), domTree, cssParser: new CssParser(), layoutEngine: new LayoutEngine(), paintEngine: paint, svgDecode: async () => null,
      resourceLoader: { loadResource: vi.fn(), loadBatch: vi.fn(), loadStylesheet: vi.fn().mockResolvedValue(readFileSync(F + 'style.css', 'utf8')), loadScript: vi.fn().mockResolvedValue(readFileSync(F + 'theme.js', 'utf8')), loadImage: vi.fn(), getPriority: vi.fn(), setMaxConcurrent: vi.fn(), on: vi.fn(), off: vi.fn(), dispose: vi.fn() },
      prioritizer: { submit: vi.fn(), submitBatch: vi.fn(), submitPreload: vi.fn(), submitPrefetch: vi.fn(), submitPreconnect: vi.fn(), clear: vi.fn(), dispose: vi.fn() } } as never);
    renderer.setViewport(423, 822, 1.7);
    await renderer.render({ url: 'http://httpforever.com/', statusCode: 200, contentType: 'text/html', body: readFileSync(F + 'index.html', 'utf8'), headers: new Map(), loadedAt: 0 } as never, new AbortController().signal);
    const ink = () => {
      const img = paint.rasterize();
      let n = 0;
      for (let y = 300; y < 700; y++) for (let x = 40; x < 380; x++) if (img.data[(y * img.width + x) * 4]! < 100) n++;
      return n;
    };
    const before = ink();
    const ctrl = (renderer as unknown as { reflowController: { processFrame(): void } }).reflowController;
    let now = performance.now();
    const spy = vi.spyOn(performance, 'now').mockImplementation(() => now);
    try {
      for (let t = 0; t < 30; t++) { now += 100; ctrl.processFrame(); } // the 0.6 s rise, staggered to ~1 s
    } finally { spy.mockRestore(); }
    expect(before).toBeGreaterThan(1000);
    expect(ink()).toBeGreaterThan(before * 0.9); // was 0: opaque card backgrounds from the overlay
    const fixedRects = paint.compositeFrame('fixed').filter((c) => c.type === 'fillRect').map((c) => c.params as number[]);
    expect(fixedRects.every(([x, , w]) => x! > 300 && w! < 60)).toBe(true); // only the switcher's buttons
    renderer.dispose();
  }, 30000);
});

describe('combinators survive the stylesheet round trip (they all became descendant combinators)', () => {
  it('>, + and ~ with spaces around them keep their meaning', async () => {
    const { domTree } = await render('<html><head><style>#r > p{color:#ff0000} #h + p{color:#00ff00} #h ~ i{color:#0000ff}</style></head><body><div id="r"><p id="child">c</p><div><p id="nested">n</p></div></div><b id="h">h</b><p id="adj">a</p><p id="far">f</p><i id="sib">s</i></body></html>');
    const color = (id: string) => domTree.getElementById(id)!.computedStyle?.get('color');
    expect(color('child')).toBe('#ff0000');
    expect(color('nested')).not.toBe('#ff0000'); // a grandchild, not a child
    expect(color('adj')).toBe('#00ff00');
    expect(color('far')).not.toBe('#00ff00');    // not adjacent
    expect(color('sib')).toBe('#0000ff');
  });
});
