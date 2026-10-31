/**
 * Found on the OPPO tablet with 1.57 (fixed in 1.58): httpforever's fixed `right: .9rem` switcher jumped to the top
 * left when its theme button swapped icons (an attribute on <html> toggling svg display).
 */
import { describe, expect, it, vi } from 'vitest';
import { DomTree } from '../src/browser/rendering/dom-tree';
import { HtmlParser } from '../src/browser/rendering/html-parser';
import { CssParser } from '../src/browser/rendering/css-parser';
import { LayoutEngine } from '../src/browser/rendering/layout-engine';
import { PaintEngine } from '../src/browser/rendering/paint-engine';
import { PageRenderer } from '../src/browser/engine/page-renderer';

const render = (body: string, css = '') => renderWith(new PaintEngine(), body, css);

async function renderWith(paint: PaintEngine, body: string, css = '', svgDecode: (m: string) => Promise<unknown> = async () => null) {
  const domTree = new DomTree();
  const layout = new LayoutEngine();
  const r = new PageRenderer({ htmlParser: new HtmlParser(), domTree, cssParser: new CssParser(), layoutEngine: layout, paintEngine: paint, svgDecode,
    resourceLoader: { loadResource: vi.fn(), loadBatch: vi.fn(), loadStylesheet: vi.fn().mockResolvedValue(css), loadScript: vi.fn().mockResolvedValue(''), loadImage: vi.fn(), getPriority: vi.fn(), setMaxConcurrent: vi.fn(), on: vi.fn(), off: vi.fn(), dispose: vi.fn() },
    prioritizer: { submit: vi.fn(), submitBatch: vi.fn(), submitPreload: vi.fn(), submitPrefetch: vi.fn(), submitPreconnect: vi.fn(), clear: vi.fn(), dispose: vi.fn() } } as never);
  r.setViewport(600, 600, 1);
  await r.render({ url: 'http://t.local/', statusCode: 200, contentType: 'text/html', body: `<html><head><style>${css}</style></head><body style="margin:0">${body}</body></html>`, headers: new Map(), loadedAt: 0 } as never, new AbortController().signal);
  return { domTree, layout, r, frame: () => (r as unknown as { reflowController: { processFrame(): void } }).reflowController.processFrame() };
}

const CSS = '.switcher{position:fixed;top:14px;right:14px;z-index:20;display:flex;gap:8px}' +
  '.sw-btn{display:grid;place-items:center;width:38px;height:38px;padding:0;border:1px solid #999}' +
  '.ic{width:19px;height:19px} #t .ic-sun{display:none} html[data-mode="light"] #t .ic-sun{display:block} html[data-mode="light"] #t .ic-auto{display:none}';

describe('a fixed right-anchored box keeps its place when a descendant restyles', () => {
  it('the theme button icon swap leaves the switcher at the right edge', async () => {
    const { domTree, layout, r, frame } = await render(
      '<div class="switcher" id="sw"><button id="t" class="sw-btn"><svg class="ic ic-sun" viewBox="0 0 24 24"><circle cx="12" cy="12" r="4"/></svg><svg class="ic ic-auto" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/></svg></button>' +
      '<button id="c" class="sw-btn"></button></div><header style="height:200px;background:#16a34a"></header><script>' +
      'document.getElementById("t").addEventListener("click", function () { document.documentElement.setAttribute("data-mode", "light"); });</script>', CSS);
    frame();
    const sw = () => layout.getLayoutBox(domTree.getElementById('sw')!.domId)!;
    const right = (id: string) => { const b = layout.getLayoutBox(domTree.getElementById(id)!.domId)!; return b.x + b.width; };
    expect(sw().x + sw().width).toBeCloseTo(586, 0);
    expect(right('c')).toBeCloseTo(586, 0);
    r.dispatchPageEvent(domTree.getElementById('t')!, 'click');
    frame();
    expect(sw().x + sw().width).toBeCloseTo(586, 0);
    expect(sw().width).toBeLessThan(100);
    expect(right('c')).toBeCloseTo(586, 0);
    r.dispose();
  });
});

describe('<details> / <summary>', () => {
  const texts = (paint: PaintEngine) => paint.compositeFrame().filter((c) => c.type === 'fillText').map((c) => String(c.params[0]));

  it('a summary has a ▸ marker inside it, and a tap opens the details (▾, body shown); a second tap closes it', async () => {
    const paint = new PaintEngine();
    const { domTree, r, frame } = await renderWith(paint, '<details id="d"><summary id="s">More</summary><p>Body text</p></details><p>after</p>');
    frame();
    expect(texts(paint).join('|')).toContain('▸');
    expect(texts(paint).join('|')).not.toContain('Body');
    r.dispatchPageEvent(domTree.getElementById('s')!, 'click');
    frame();
    expect(domTree.getElementById('d')!.attributes.has('open')).toBe(true);
    expect(texts(paint).join('|')).toContain('▾');
    expect(texts(paint).join('|')).toContain('Body');
    r.dispatchPageEvent(domTree.getElementById('s')!, 'click');
    frame();
    expect(domTree.getElementById('d')!.attributes.has('open')).toBe(false);
    expect(texts(paint).join('|')).not.toContain('Body');
    r.dispose();
  });

  it('list-style: none hides the marker; preventDefault keeps it closed; a link inside does not toggle', async () => {
    const paint = new PaintEngine();
    const { domTree, r, frame } = await renderWith(paint,
      '<details id="d"><summary id="s">More <a id="a">link</a></summary><p>Body</p></details><script>document.getElementById("s").addEventListener("click", function (e) { if (window.block) e.preventDefault(); });</script>',
      'summary{list-style:none}');
    frame();
    expect(texts(paint).join('|')).not.toContain('▸');
    r.dispatchPageEvent(domTree.getElementById('a')!, 'click');
    expect(domTree.getElementById('d')!.attributes.has('open')).toBe(false);
    r.dispose();
  });

  it('list-style-position: inside puts the bullet in the line, not the margin', async () => {
    const paint = new PaintEngine();
    const { r, frame } = await renderWith(paint, '<ul style="list-style-position:inside;padding:0;margin:0"><li>one</li></ul>');
    frame();
    const bullet = paint.compositeFrame().find((c) => c.type === 'fillText' && String(c.params[0]).includes('•'));
    expect(bullet).toBeDefined();
    expect(Number(bullet!.params[1])).toBeGreaterThanOrEqual(0);
    r.dispose();
  });
});

describe('inline svg drawn after load', () => {
  it('an icon hidden at load is rasterized once a script shows it, and again when its colour changes', async () => {
    const decoded: string[] = [];
    const decode = async (m: string) => { decoded.push(m); return { data: new Uint8ClampedArray(4), width: 1, height: 1 }; };
    const { domTree, r, frame } = await renderWith(new PaintEngine(),
      '<button id="b"><svg id="sun" class="ic" viewBox="0 0 24 24"><circle cx="12" cy="12" r="4"/></svg></button><script>' +
      'document.getElementById("b").addEventListener("click", function () { document.documentElement.setAttribute("data-mode", document.documentElement.getAttribute("data-mode") ? "dark" : "light"); });</script>',
      '.ic{width:20px;height:20px} #sun{display:none} [data-mode] #sun{display:block} [data-mode="dark"] #sun{color:#fff}', decode);
    const settle = async () => { frame(); for (let i = 0; i < 5; i++) await new Promise((res) => setTimeout(res, 0)); };
    await settle();
    expect(decoded).toHaveLength(0);
    r.dispatchPageEvent(domTree.getElementById('b')!, 'click');
    await settle();
    expect(decoded).toHaveLength(1);
    await settle();
    expect(decoded).toHaveLength(1); // not redrawn every frame
    r.dispatchPageEvent(domTree.getElementById('b')!, 'click');
    await settle();
    expect(decoded).toHaveLength(2);
    expect(domTree.getElementById('sun')!.imageData).toBeTruthy();
    r.dispose();
  });
});

describe('paint order inside a display:grid button', () => {
  it('its blockified children (a label span, a display:block icon) paint over its background, not under it', async () => {
    const paint = new PaintEngine();
    const { r, frame } = await renderWith(paint,
      '<button style="display:grid;place-items:center;width:60px;height:40px;background:#0000ff"><span>T</span></button>' +
      '<div style="display:flex;background:#00ff00;width:100px"><p style="margin:0">flexlabel</p></div>');
    frame();
    const cmds = paint.compositeFrame();
    const bg = (c: string) => cmds.findIndex((x) => x.type === 'setFillStyle' && /0000ff|0, 0, 255|00ff00|0, 255, 0/i.test(String(x.params[0])) && String(x.params[0]).toLowerCase().includes(c));
    const text = (t: string) => cmds.findIndex((x) => x.type === 'fillText' && String(x.params[0]) === t);
    expect(bg('0000ff') === -1 ? bg('0, 0, 255') : bg('0000ff')).toBeLessThan(text('T'));
    expect(bg('00ff00') === -1 ? bg('0, 255, 0') : bg('00ff00')).toBeLessThan(text('flexlabel'));
    expect(text('T')).toBeGreaterThan(-1);
    r.dispose();
  });

  it('the text of a grid item is drawn, in its own column (it stayed at the grid origin, or vanished)', async () => {
    const paint = new PaintEngine();
    const { r, frame } = await renderWith(paint, '<div style="display:grid;grid-template-columns:100px 100px;width:200px"><span>A</span><span>B</span><a href="#"><b>C</b></a></div>');
    frame();
    const x = (t: string) => Number(paint.compositeFrame().find((c) => c.type === 'fillText' && String(c.params[0]) === t)?.params[1] ?? NaN);
    expect(x('A')).toBeLessThan(100);
    expect(x('B')).toBeGreaterThanOrEqual(100);
    expect(x('C')).toBeLessThan(100);
    r.dispose();
  });
});

describe('self-closing tags inside <svg>', () => {
  it('<circle/><path/> are siblings, not nested; <br/> and <div/> in HTML are unchanged', () => {
    const parser = new HtmlParser();
    const doc = parser.parse('<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="4"/><path d="M1 1"/><g><rect/></g></svg><div/>after<br/>x').document;
    const find = (n: any, tag: string): any => n.tagName === tag ? n : (n.children ?? []).map((c: any) => find(c, tag)).find(Boolean);
    const svg = find(doc, 'svg');
    expect(svg.children.filter((c: any) => c.tagName).map((c: any) => c.tagName)).toEqual(['circle', 'path', 'g']);
    expect(find(svg, 'g').children.map((c: any) => c.tagName)).toEqual(['rect']);
    // HTML ignores the flag: the <div/> stays open and takes "after"
    expect(find(doc, 'div').children.some((c: any) => c.text === 'after' || c.data === 'after' || c.value === 'after')).toBe(true);
  });
});
