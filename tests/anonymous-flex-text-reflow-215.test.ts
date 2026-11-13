/**
 * 2.15: after the first incremental reflow, bare text in a flex container (an anonymous wrapper) was laid out
 * on its own at x=0 with the viewport's width: nav links, buttons and result rows on adblock.turtlecute.org
 * jumped to the left or centre of the realme tablet's screen.
 */
import { expect, it, vi } from 'vitest';
import { DomTree } from '../src/browser/rendering/dom-tree';
import { HtmlParser } from '../src/browser/rendering/html-parser';
import { CssParser } from '../src/browser/rendering/css-parser';
import { LayoutEngine } from '../src/browser/rendering/layout-engine';
import { PaintEngine } from '../src/browser/rendering/paint-engine';
import { PageRenderer } from '../src/browser/engine/page-renderer';

it('bare text in a centred flex item keeps its place across an incremental reflow', async () => {
  const domTree = new DomTree();
  const paint = new PaintEngine();
  const r = new PageRenderer({ htmlParser: new HtmlParser(), domTree, cssParser: new CssParser(), layoutEngine: new LayoutEngine(), paintEngine: paint, svgDecode: async () => null,
    resourceLoader: { loadResource: vi.fn(), loadBatch: vi.fn(), loadStylesheet: vi.fn().mockResolvedValue(''), loadScript: vi.fn().mockResolvedValue(''), loadImage: vi.fn(), getPriority: vi.fn(), setMaxConcurrent: vi.fn(), on: vi.fn(), off: vi.fn(), dispose: vi.fn() },
    prioritizer: { submit: vi.fn(), submitBatch: vi.fn(), submitPreload: vi.fn(), submitPrefetch: vi.fn(), submitPreconnect: vi.fn(), clear: vi.fn(), dispose: vi.fn() },
    userStylesheet: () => '' } as never);
  r.setViewport(400, 600, 1);
  await r.render({ url: 'http://t.local/', statusCode: 200, contentType: 'text/html', headers: new Map(), loadedAt: 0,
    body: '<html><head><style>body{margin:0;display:flex;flex-flow:column wrap}main{display:block}.fc{display:flex;justify-content:center}' +
          '.card{display:flex;flex-direction:column;width:240px;padding:1rem}.card span{display:flex;align-items:center;gap:.5rem}</style></head>' +
          '<body><main><div class="fc"><div class="card"><span><svg width="24" height="24"></svg> Hello 130</span><span><svg width="24" height="24"></svg> Second</span></div></div><p id="other">other</p></main></body></html>' } as never, new AbortController().signal);
  const helloX = () => {
    const c = paint.compositeFrame().find((q) => q.type === 'fillText' && String(q.params[0]).startsWith('Hello'));
    return c ? Number(c.params[1]) : -1;
  };
  await new Promise((f) => setTimeout(f, 100)); // the first incremental frame
  const before = helloX();
  expect(before).toBeGreaterThanOrEqual(80); // inside the card, which starts at x=80 (it was at x=0)
  const other = domTree.getElementById('other')!;
  domTree.markDirty(other, 'layout');
  r.requestReflow();
  await new Promise((f) => setTimeout(f, 100));
  expect(helloX()).toBe(before);
  r.dispose();
});
