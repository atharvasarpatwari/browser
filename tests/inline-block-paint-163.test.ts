/**
 * An inline-block paints atomically (CSS 2.2 Appendix E): its block children were level-2 blocks of
 * the parent context, painted before the inline-block's own (level 4) background, which covered
 * them — a <button> or a card link with a <div> label showed an empty box.
 */
import { describe, expect, it, vi } from 'vitest';
import { DomTree } from '../src/browser/rendering/dom-tree';
import { HtmlParser } from '../src/browser/rendering/html-parser';
import { CssParser } from '../src/browser/rendering/css-parser';
import { LayoutEngine } from '../src/browser/rendering/layout-engine';
import { PaintEngine } from '../src/browser/rendering/paint-engine';
import { PageRenderer } from '../src/browser/engine/page-renderer';

async function paintOf(body: string) {
  const paint = new PaintEngine();
  const r = new PageRenderer({ htmlParser: new HtmlParser(), domTree: new DomTree(), cssParser: new CssParser(), layoutEngine: new LayoutEngine(), paintEngine: paint, svgDecode: async () => null,
    resourceLoader: { loadResource: vi.fn(), loadBatch: vi.fn(), loadStylesheet: vi.fn().mockResolvedValue(''), loadScript: vi.fn().mockResolvedValue(''), loadImage: vi.fn(), getPriority: vi.fn(), setMaxConcurrent: vi.fn(), on: vi.fn(), off: vi.fn(), dispose: vi.fn() },
    prioritizer: { submit: vi.fn(), submitBatch: vi.fn(), submitPreload: vi.fn(), submitPrefetch: vi.fn(), submitPreconnect: vi.fn(), clear: vi.fn(), dispose: vi.fn() } } as never);
  r.setViewport(600, 600, 1);
  await r.render({ url: 'http://t.local/', statusCode: 200, contentType: 'text/html', body: `<html><body style="margin:0">${body}</body></html>`, headers: new Map(), loadedAt: 0 } as never, new AbortController().signal);
  const cmds = paint.compositeFrame();
  r.dispose();
  const fill = (re: RegExp) => cmds.findIndex((c) => c.type === 'setFillStyle' && re.test(String(c.params[0]).toLowerCase()));
  const text = (t: string) => cmds.findIndex((c) => c.type === 'fillText' && String(c.params[0]) === t);
  return { fill, text };
}

describe('inline-block paints its content over its own background', () => {
  it.each([
    ['<button> with a <div> label', '<button style="background:#0000ff;color:#fff"><div>label</div></button>'],
    ['an inline-block link holding a block', '<a href="#" style="display:inline-block;background:#0000ff"><div>label</div></a>'],
    ['inline-flex with a block item', '<span style="display:inline-flex;background:#0000ff"><div>label</div></span>'],
  ])('%s', async (_name, body) => {
    const { fill, text } = await paintOf(body);
    expect(text('label')).toBeGreaterThan(-1);
    expect(fill(/0000ff|0, 0, 255/)).toBeLessThan(text('label'));
  });

  it('a block child\'s own background also paints over the inline-block\'s', async () => {
    const { fill } = await paintOf('<span style="display:inline-block;background:#0000ff;padding:4px"><div style="background:#00ff00">x</div></span>');
    expect(fill(/0000ff|0, 0, 255/)).toBeLessThan(fill(/00ff00|0, 255, 0/));
  });
});

describe('<details> toggle event and open property', () => {
  async function page(body: string) {
    const domTree = new DomTree();
    const r = new PageRenderer({ htmlParser: new HtmlParser(), domTree, cssParser: new CssParser(), layoutEngine: new LayoutEngine(), paintEngine: new PaintEngine(), svgDecode: async () => null,
      resourceLoader: { loadResource: vi.fn(), loadBatch: vi.fn(), loadStylesheet: vi.fn().mockResolvedValue(''), loadScript: vi.fn().mockResolvedValue(''), loadImage: vi.fn(), getPriority: vi.fn(), setMaxConcurrent: vi.fn(), on: vi.fn(), off: vi.fn(), dispose: vi.fn() },
      prioritizer: { submit: vi.fn(), submitBatch: vi.fn(), submitPreload: vi.fn(), submitPrefetch: vi.fn(), submitPreconnect: vi.fn(), clear: vi.fn(), dispose: vi.fn() } } as never);
    r.setViewport(600, 600, 1);
    await r.render({ url: 'http://t.local/', statusCode: 200, contentType: 'text/html', body: `<html><body>${body}</body></html>`, headers: new Map(), loadedAt: 0 } as never, new AbortController().signal);
    return { domTree, r, log: () => domTree.getElementById('log')!.attributes.get('data-log') ?? '' };
  }
  const script = '<p id="log"></p><script>var d = document.getElementById("d"), out = [];' +
    'function note(s) { out.push(s); document.getElementById("log").setAttribute("data-log", out.join(",")); }' +
    'd.addEventListener("toggle", function (e) { note("toggle:" + d.open + ":" + e.target.id); });' +
    'document.addEventListener("toggle", function () { note("bubbled"); });';

  it('a summary tap fires toggle on the details (not bubbling); open reads the state', async () => {
    const { domTree, r, log } = await page('<details id="d"><summary id="s">More</summary>Body</details>' + script + '</script>');
    r.dispatchPageEvent(domTree.getElementById('s')!, 'click');
    r.dispatchPageEvent(domTree.getElementById('s')!, 'click');
    expect(log()).toBe('toggle:true:d,toggle:false:d');
    r.dispose();
  });

  it('setting details.open opens it and fires toggle once; setting the same value does nothing', async () => {
    const { domTree, r, log } = await page('<details id="d"><summary>More</summary>Body</details>' + script +
      'd.open = true; d.open = true; note("attr:" + d.hasAttribute("open")); d.open = false;</script>');
    expect(log()).toBe('toggle:true:d,attr:true,toggle:false:d');
    expect(domTree.getElementById('d')!.attributes.has('open')).toBe(false);
    r.dispose();
  });
});

describe('inline svg edited by a script', () => {
  it('is redrawn with the new markup (attribute change, appended shape), once per change', async () => {
    const decoded: string[] = [];
    const decode = async (m: string) => { decoded.push(m); return { data: new Uint8ClampedArray(4), width: 1, height: 1 }; };
    const domTree = new DomTree();
    const r = new PageRenderer({ htmlParser: new HtmlParser(), domTree, cssParser: new CssParser(), layoutEngine: new LayoutEngine(), paintEngine: new PaintEngine(), svgDecode: decode,
      resourceLoader: { loadResource: vi.fn(), loadBatch: vi.fn(), loadStylesheet: vi.fn().mockResolvedValue(''), loadScript: vi.fn().mockResolvedValue(''), loadImage: vi.fn(), getPriority: vi.fn(), setMaxConcurrent: vi.fn(), on: vi.fn(), off: vi.fn(), dispose: vi.fn() },
      prioritizer: { submit: vi.fn(), submitBatch: vi.fn(), submitPreload: vi.fn(), submitPrefetch: vi.fn(), submitPreconnect: vi.fn(), clear: vi.fn(), dispose: vi.fn() } } as never);
    r.setViewport(600, 600, 1);
    await r.render({ url: 'http://t.local/', statusCode: 200, contentType: 'text/html', headers: new Map(), loadedAt: 0,
      body: '<html><body><svg width="40" height="40" viewBox="0 0 40 40"><circle id="c" cx="20" cy="20" r="5"/></svg><button id="b">go</button><script>' +
        'var n = 0; document.getElementById("b").addEventListener("click", function () { n++;' +
        ' if (n === 1) document.getElementById("c").setAttribute("r", "15");' +
        ' else { var rect = document.createElementNS("http://www.w3.org/2000/svg", "rect"); rect.setAttribute("width", "9"); document.querySelector("svg").appendChild(rect); } });</script></body></html>' } as never,
      new AbortController().signal);
    const frame = () => (r as unknown as { reflowController: { processFrame(): void } }).reflowController.processFrame();
    const settle = async () => { frame(); for (let i = 0; i < 5; i++) await new Promise((res) => setTimeout(res, 0)); frame(); };
    await settle();
    const atLoad = decoded.length;
    expect(atLoad).toBeGreaterThan(0);
    await settle();
    expect(decoded.length).toBe(atLoad); // nothing changed: no redraw
    r.dispatchPageEvent(domTree.getElementById('b')!, 'click');
    await settle();
    expect(decoded.length).toBe(atLoad + 1);
    expect(decoded[decoded.length - 1]).toContain('r="15"');
    r.dispatchPageEvent(domTree.getElementById('b')!, 'click');
    await settle();
    expect(decoded.length).toBe(atLoad + 2);
    expect(decoded[decoded.length - 1]).toContain('<rect');
    r.dispose();
  });
});
