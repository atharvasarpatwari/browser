/**
 * 1.64: found on the OPPO tablet with the 1.63 feature page (a closed <details> showed its text; the
 * summary's ▸ jumped to x=0 after a later frame) and by a 46-feature JS probe.
 */
import { describe, expect, it, vi } from 'vitest';
import { DomTree } from '../src/browser/rendering/dom-tree';
import { HtmlParser } from '../src/browser/rendering/html-parser';
import { CssParser } from '../src/browser/rendering/css-parser';
import { LayoutEngine } from '../src/browser/rendering/layout-engine';
import { PaintEngine } from '../src/browser/rendering/paint-engine';
import { PageRenderer } from '../src/browser/engine/page-renderer';

async function page(body: string, width = 1070) {
  const domTree = new DomTree();
  const paint = new PaintEngine();
  const r = new PageRenderer({ htmlParser: new HtmlParser(), domTree, cssParser: new CssParser(), layoutEngine: new LayoutEngine(), paintEngine: paint, svgDecode: async () => null,
    resourceLoader: { loadResource: vi.fn(), loadBatch: vi.fn(), loadStylesheet: vi.fn().mockResolvedValue(''), loadScript: vi.fn().mockResolvedValue(''), loadImage: vi.fn(), getPriority: vi.fn(), setMaxConcurrent: vi.fn(), on: vi.fn(), off: vi.fn(), dispose: vi.fn() },
    prioritizer: { submit: vi.fn(), submitBatch: vi.fn(), submitPreload: vi.fn(), submitPrefetch: vi.fn(), submitPreconnect: vi.fn(), clear: vi.fn(), dispose: vi.fn() } } as never);
  r.setViewport(width, 760, 2.25);
  await r.render({ url: 'http://t.local/', statusCode: 200, contentType: 'text/html', headers: new Map(), loadedAt: 0,
    body: `<html><body style="margin:12px">${body}</body></html>` } as never, new AbortController().signal);
  const frame = () => (r as unknown as { reflowController: { processFrame(): void } }).reflowController.processFrame();
  const textX = (t: string) => { const c = paint.compositeFrame().find((c) => c.type === 'fillText' && String(c.params[0]) === t); return c ? Math.round(Number(c.params[1])) : null; };
  const out = (id: string, attr = 'data-r') => domTree.getElementById(id)!.attributes.get(attr);
  return { domTree, r, frame, textX, out };
}

describe('closed <details>', () => {
  it('hides bare text, not only elements; opening shows it', async () => {
    const { domTree, r, frame, textX } = await page('<details><summary id="s">More</summary>Body text<p>para</p></details>');
    frame();
    expect(textX('Body')).toBeNull();
    expect(textX('para')).toBeNull();
    r.dispatchPageEvent(domTree.getElementById('s')!, 'click');
    frame();
    expect(textX('Body')).not.toBeNull();
    r.dispose();
  });
});

describe('generated boxes keep their place across later frames', () => {
  it('a summary marker stays at its text after unrelated clicks', async () => {
    const { domTree, r, frame, textX } = await page('<details><summary>Toggle me</summary>x</details><button id="b">go</button><p id="p">p</p>' +
      '<script>document.getElementById("b").addEventListener("click", function () { document.getElementById("p").setAttribute("data-n", "1"); });</script>');
    frame();
    expect(textX('▸')).toBe(12);
    for (let i = 0; i < 3; i++) { r.dispatchPageEvent(domTree.getElementById('b')!, 'click'); frame(); }
    expect(textX('▸')).toBe(12);
    r.dispose();
  });

  it('an author ::before box too', async () => {
    const { domTree, r, frame, textX } = await page('<style>.tag::before{content:"#"}</style><p class="tag">topic</p><button id="b">go</button>' +
      '<script>document.getElementById("b").addEventListener("click", function () { document.body.setAttribute("data-n", "1"); });</script>');
    frame();
    const before = textX('#');
    expect(before).toBe(12);
    r.dispatchPageEvent(domTree.getElementById('b')!, 'click'); frame(); frame();
    expect(textX('#')).toBe(before);
    r.dispose();
  });
});

describe('JS built-ins', () => {
  const run = async (expr: string) => {
    const { r, out } = await page(`<p id="o"></p><script>try { document.getElementById("o").setAttribute("data-r", String(${expr})); } catch (e) { document.getElementById("o").setAttribute("data-r", "THREW " + e); }</script>`, 600);
    const v = out('o');
    r.dispose();
    return v;
  };
  it('JSON.parse runs the reviver bottom-up and deletes keys it returns undefined for', async () => {
    expect(await run('JSON.stringify(JSON.parse(\'{"a":1,"b":{"c":2},"d":3}\', function (k, v) { return k === "d" ? undefined : typeof v === "number" ? v * 10 : v; }))')).toBe('{"a":10,"b":{"c":20}}');
  });
  it('JSON.parse throws a catchable SyntaxError on bad JSON', async () => {
    expect(await run('(function () { try { JSON.parse("{bad"); return "no throw"; } catch (e) { return (e instanceof SyntaxError) + ":" + e.name; } })()')).toBe('true:SyntaxError');
  });
  it('[NaN].includes(NaN) (SameValueZero), indexOf still -1', async () => {
    expect(await run('[1, NaN].includes(NaN) + "," + [NaN].indexOf(NaN)')).toBe('true,-1');
  });
  it('numeric separators', async () => {
    expect(await run('1_000 + 0xFF_FF + 0b1_0 + 1_0.5_0')).toBe(String(1000 + 0xffff + 2 + 10.5));
  });
  it('template.content holds the markup and can be cloned', async () => {
    expect(await run('(function () { var t = document.createElement("template"); t.innerHTML = "<li>one</li><li>two</li>"; var c = t.content.cloneNode(true); var ul = document.createElement("ul"); ul.appendChild(c); return t.content.firstChild.textContent + ":" + ul.children.length; })()')).toBe('one:2');
  });
});
