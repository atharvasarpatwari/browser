/**
 * 1.78, found on the tablet: ImageData.data was the host Uint8ClampedArray, which page scripts
 * can't index (no property map), so getImageData(...).data[i] was undefined and every canvas pixel
 * read failed. It is now a page typed array over the same bytes.
 */
import { describe, expect, it, vi } from 'vitest';
import { DomTree } from '../src/browser/rendering/dom-tree';
import { HtmlParser } from '../src/browser/rendering/html-parser';
import { CssParser } from '../src/browser/rendering/css-parser';
import { LayoutEngine } from '../src/browser/rendering/layout-engine';
import { PaintEngine } from '../src/browser/rendering/paint-engine';
import { PageRenderer } from '../src/browser/engine/page-renderer';

async function run(body: string): Promise<string> {
  const domTree = new DomTree();
  const r = new PageRenderer({ htmlParser: new HtmlParser(), domTree, cssParser: new CssParser(), layoutEngine: new LayoutEngine(), paintEngine: new PaintEngine(), svgDecode: async () => null,
    resourceLoader: { loadResource: vi.fn(), loadBatch: vi.fn(), loadStylesheet: vi.fn().mockResolvedValue(''), loadScript: vi.fn().mockResolvedValue(''), loadImage: vi.fn(), getPriority: vi.fn(), setMaxConcurrent: vi.fn(), on: vi.fn(), off: vi.fn(), dispose: vi.fn() },
    prioritizer: { submit: vi.fn(), submitBatch: vi.fn(), submitPreload: vi.fn(), submitPrefetch: vi.fn(), submitPreconnect: vi.fn(), clear: vi.fn(), dispose: vi.fn() } } as never);
  r.setViewport(600, 400, 1);
  await r.render({ url: 'http://t.local/', statusCode: 200, contentType: 'text/html', headers: new Map(), loadedAt: 0, body: `<html><body><div id="out"></div>${body}</body></html>` } as never, new AbortController().signal);
  const out = domTree.getElementById('out')!;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const text = (out.children as any[]).map((p) => (p.children ?? []).map((t: any) => t.text ?? '').join('')).join('');
  r.dispose();
  return text;
}

describe('canvas ImageData from page scripts', () => {
  const canvas = (fill: string) => `var cv = document.createElement('canvas'); cv.width = 40; cv.height = 20;
    var x = cv.getContext('2d'); x.fillStyle = '#000'; x.beginPath(); x.rect(0, 0, 30, 20); x.rect(10, 0, 30, 20); x.${fill};`;
  it('reads pixel alpha: nonzero fills the overlap', async () => {
    expect(await run(`<script>${canvas('fill()')} var p = document.createElement('p'); p.textContent = String(x.getImageData(20, 10, 1, 1).data[3]); document.getElementById('out').appendChild(p);</script>`)).toBe('255');
  });
  it('reads pixel alpha: evenodd leaves the overlap empty', async () => {
    expect(await run(`<script>${canvas("fill('evenodd')")} var d = x.getImageData(0, 10, 40, 1).data; var p = document.createElement('p'); p.textContent = d[20 * 4 + 3] + ',' + d[5 * 4 + 3] + ',' + d.length; document.getElementById('out').appendChild(p);</script>`)).toBe('0,255,160');
  });
  it('writes through: edited data put back with putImageData', async () => {
    expect(await run(`<script>var cv = document.createElement('canvas'); cv.width = 2; cv.height = 1; var x = cv.getContext('2d');
      var img = x.getImageData(0, 0, 2, 1); img.data[3] = 200; img.data[0] = 255; x.putImageData(img, 0, 0);
      var q = x.getImageData(0, 0, 1, 1).data; var p = document.createElement('p'); p.textContent = q[0] + ',' + q[3]; document.getElementById('out').appendChild(p);</script>`)).toBe('255,200');
  });
});
