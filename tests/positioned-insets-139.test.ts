/**
 * Positioned boxes anchored by `right` or `bottom` (found on the phone with httpforever.com, 1.37:
 * the fixed theme switcher sat top-left). See doc/2026-10-30-nova-android-1.38-1.39-*.md.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { DomTree } from '../src/browser/rendering/dom-tree';
import { HtmlParser } from '../src/browser/rendering/html-parser';
import { CssParser } from '../src/browser/rendering/css-parser';
import { LayoutEngine } from '../src/browser/rendering/layout-engine';
import { PaintEngine } from '../src/browser/rendering/paint-engine';
import { PageRenderer } from '../src/browser/engine/page-renderer';

async function render(html: string, css = '', js = '', width = 424) {
  const domTree = new DomTree();
  const renderer = new PageRenderer({ htmlParser: new HtmlParser(), domTree, cssParser: new CssParser(), layoutEngine: new LayoutEngine(), paintEngine: new PaintEngine(),
    resourceLoader: { loadResource: vi.fn(), loadBatch: vi.fn(), loadStylesheet: vi.fn().mockResolvedValue(css), loadScript: vi.fn().mockResolvedValue(js), loadImage: vi.fn(), getPriority: vi.fn(), setMaxConcurrent: vi.fn(), on: vi.fn(), off: vi.fn(), dispose: vi.fn() },
    prioritizer: { submit: vi.fn(), submitBatch: vi.fn(), submitPreload: vi.fn(), submitPrefetch: vi.fn(), submitPreconnect: vi.fn(), clear: vi.fn(), dispose: vi.fn() } } as never);
  renderer.setViewport(width, 900, 1);
  await renderer.render({ url: 'http://test.local/', statusCode: 200, contentType: 'text/html', body: html, headers: new Map(), loadedAt: 0 } as never, new AbortController().signal);
  renderer.dispose();
  return domTree;
}
const boxOf = (t: DomTree, id: string) => (t.getElementById(id) as unknown as { layoutBox: { x: number; y: number; width: number; height: number } }).layoutBox;

describe('right / bottom insets', () => {
  it("httpforever's fixed switcher sits at the top right", async () => {
    const F = 'tests/fixtures/httpforever-2026/';
    const tree = await render(readFileSync(F + 'index.html', 'utf8'), readFileSync(F + 'style.css', 'utf8'), readFileSync(F + 'theme.js', 'utf8'));
    const sw = tree.getElementsByTagName('div').find((d) => (d as unknown as { attributes: Map<string, string> }).attributes.get('class')?.split(/\s+/).includes('switcher'))!;
    const b = (sw as unknown as { layoutBox: { x: number; width: number } }).layoutBox;
    expect(b.width).toBeLessThan(300);                     // as wide as its buttons, not the page
    expect(b.x + b.width).toBeGreaterThan(424 - 0.9 * 16 - 2); // right: .9rem
    expect(b.x + b.width).toBeLessThan(424 - 0.9 * 16 + 2);
  });

  it('an auto-width box with right: 10px shrinks to its content and ends 10px from the edge', async () => {
    const t = await render('<html><body style="margin:0"><div id="a" style="position:absolute;top:0;right:10px;padding:4px"><span>abc</span></div></body></html>');
    const a = boxOf(t, 'a');
    expect(a.width).toBeLessThan(100);
    expect(a.x + a.width).toBeCloseTo(414, 0);
  });

  it('a box with left set shrinks to its content too', async () => {
    const t = await render('<html><body style="margin:0"><div id="a" style="position:absolute;top:0;left:20px">abc</div></body></html>');
    const a = boxOf(t, 'a');
    expect(a.x).toBe(20);
    expect(a.width).toBeLessThan(100);
  });

  it('bottom: 0 puts the box above the bottom edge, children included', async () => {
    const t = await render('<html><body style="margin:0"><div id="p" style="position:relative;height:300px"><div id="a" style="position:absolute;bottom:0;left:0;width:50px"><div id="c" style="height:40px"></div></div></div></body></html>');
    const a = boxOf(t, 'a');
    expect(a.y + a.height).toBeCloseTo(300, 0);
    expect(boxOf(t, 'c').y).toBeCloseTo(260, 0);
  });

  it('bottom with an explicit height', async () => {
    const t = await render('<html><body style="margin:0"><div id="p" style="position:relative;height:300px"><div id="a" style="position:absolute;bottom:20px;left:0;width:50px;height:30px"></div></div></body></html>');
    expect(boxOf(t, 'a').y).toBeCloseTo(250, 0);
  });
});

describe('page-load errors in plain words (the error page showed raw Java exceptions)', () => {
  it('maps the fetch bridge exceptions seen on the phone', async () => {
    const { friendlyNetworkError } = await import('../src/browser/engine/page-loader');
    expect(friendlyNetworkError('java.net.SocketTimeoutException: failed to connect to neverssl.com/34.223.124.45 (port 80) after 30000ms')).toBe('The site took too long to respond.');
    expect(friendlyNetworkError('java.net.UnknownHostException: Unable to resolve host "nope.invalid"')).toMatch(/Couldn't find this site/);
    expect(friendlyNetworkError('javax.net.ssl.SSLHandshakeException: Connection closed by peer')).toMatch(/secure connection/);
    expect(friendlyNetworkError('java.net.ConnectException: Failed to connect to /10.0.0.1:80')).toBe("Couldn't connect to the site.");
    expect(friendlyNetworkError('java.io.IOException: unexpected end of stream on http://x/...')).toMatch(/connection closed/);
    expect(friendlyNetworkError('Network error')).toBeNull();
  });
});
