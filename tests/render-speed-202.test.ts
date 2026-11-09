/**
 * 2.02: CNN took 63 s to render offline (3.3x slower than now). The parser creates every node
 * style-dirty and the full style pass never cleared that, so the first frame after any load
 * restyled the whole page again; custom properties were rescanned per element; failed images kept
 * a full-size checkerboard placeholder.
 */
import { describe, expect, it, vi } from 'vitest';
import { DomTree } from '../src/browser/rendering/dom-tree';
import type { DomNode } from '../src/browser/rendering/dom-tree';
import { HtmlParser } from '../src/browser/rendering/html-parser';
import { CssParser } from '../src/browser/rendering/css-parser';
import { LayoutEngine } from '../src/browser/rendering/layout-engine';
import { PaintEngine } from '../src/browser/rendering/paint-engine';
import { PageRenderer } from '../src/browser/engine/page-renderer';
import { LazyLoader } from '../src/browser/rendering/lazy-loader';

async function page(body: string) {
  const domTree = new DomTree();
  const r = new PageRenderer({ htmlParser: new HtmlParser(), domTree, cssParser: new CssParser(), layoutEngine: new LayoutEngine(), paintEngine: new PaintEngine(), svgDecode: async () => null,
    resourceLoader: { loadResource: vi.fn(), loadBatch: vi.fn(), loadStylesheet: vi.fn().mockResolvedValue(''), loadScript: vi.fn().mockResolvedValue(''), loadImage: vi.fn().mockResolvedValue({ bodyBinary: null, error: 'offline' }), getPriority: vi.fn(), setMaxConcurrent: vi.fn(), on: vi.fn(), off: vi.fn(), dispose: vi.fn() },
    prioritizer: { submit: vi.fn(), submitBatch: vi.fn(), submitPreload: vi.fn(), submitPrefetch: vi.fn(), submitPreconnect: vi.fn(), clear: vi.fn(), dispose: vi.fn() } } as never);
  r.setViewport(400, 600, 1);
  await r.render({ url: 'http://t.local/', statusCode: 200, contentType: 'text/html', headers: new Map(), loadedAt: 0, body: `<html><body>${body}</body></html>` } as never, new AbortController().signal);
  return { domTree, r };
}

const all = (n: DomNode, out: DomNode[] = []): DomNode[] => { out.push(n); for (const c of n.children) all(c, out); return out; };

describe('render speed', () => {
  it('leaves no element style-dirty after the full style pass (the first frame restyled the whole page)', async () => {
    const { domTree, r } = await page('<div><p>a <b>b</b></p><ul><li>1</li><li>2</li></ul></div>');
    const dirty = all(domTree.getDocument()! as unknown as DomNode).filter((n) => n.nodeType === 'element' && n._dirtyStyle);
    expect(dirty).toHaveLength(0);
    r.dispose();
  });

  it('custom properties still inherit, override and feed var() through the shared per-parent map', async () => {
    const { domTree, r } = await page(`<style>:root{--c:rgb(1,2,3);--w:10px} .o{--c:rgb(9,9,9)} .x{color:var(--c);width:var(--w)} .k{--w:initial;width:var(--w, 7px)}</style>
      <div id="a" class="x">a</div><div class="o"><div id="b" class="x">b</div><div id="c" class="x k">c</div></div><div id="d" class="x">d</div>`);
    const cs = (id: string, p: string) => domTree.getElementById(id)!.computedStyle?.get(p)?.replace(/\s/g, '');
    expect(cs('a', 'color')).toBe('rgb(1,2,3)');
    expect(cs('b', 'color')).toBe('rgb(9,9,9)'); // overridden by its parent
    expect(cs('d', 'color')).toBe('rgb(1,2,3)'); // a sibling of that parent is not affected
    expect(cs('b', 'width')).toBe('10px');
    expect(cs('c', 'width')).toBe('7px'); // --w: initial → the fallback
    r.dispose();
  });

  it('a failed image draws nothing and reports error (no checkerboard placeholder)', async () => {
    const tree = new DomTree();
    const doc = tree.buildFromHtml(new HtmlParser().parse('<html><body><img id="i" src="https://img.example/x.jpg" width="200" height="100"></body></html>').document);
    new LayoutEngine().layout(doc, tree);
    const loader = new LazyLoader({ viewportWidth: 800, viewportHeight: 600 });
    loader.init(doc, tree, { loadImage: vi.fn().mockResolvedValue({ bodyBinary: null, error: 'offline' }) } as never, 'https://site.example/');
    const img = tree.getElementById('i')!;
    loader.observe(img);
    await new Promise((res) => setTimeout(res, 20));
    expect(img.loadingState).toBe('error');
    expect(img.imageData ?? null).toBeNull();
    loader.dispose();
  });

  // 2.03: a nested flex item's min-content measured its subtree, and every flex container above
  // measured that again, so nesting cost grew exponentially (deep menus on CNN).
  it('deeply nested flex containers lay out in bounded time and keep their widths', async () => {
    let html = '<span id="leaf" style="width:37px;display:block">x</span>';
    for (let i = 0; i < 14; i++) html = `<div style="display:flex">${html}<div style="display:flex"><span style="display:block;width:5px">y</span></div></div>`;
    const t0 = performance.now();
    const { domTree, r } = await page(html);
    const ms = performance.now() - t0;
    expect(domTree.getElementById('leaf')!.layoutBox?.width ?? 37).toBe(37);
    expect(ms).toBeLessThan(4000);
    r.dispose();
  });
});
