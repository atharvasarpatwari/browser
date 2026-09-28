/**
 * Real-pipeline coverage for HttpOnly cookie enforcement: document.cookie
 * (the only place page script reads cookies) must never expose an
 * HttpOnly-flagged cookie, while the real HTTP layer must keep sending it
 * over the wire exactly as before. No mocks: a real PageRenderer runs a
 * real <script> reading document.cookie against a real CookieJar.
 */
import { describe, it, expect } from 'vitest';
import { PageRenderer } from '../src/browser/engine/page-renderer';
import { HtmlParser } from '../src/browser/rendering/html-parser';
import { DomTree } from '../src/browser/rendering/dom-tree';
import { CssParser } from '../src/browser/rendering/css-parser';
import { LayoutEngine } from '../src/browser/rendering/layout-engine';
import { PaintEngine } from '../src/browser/rendering/paint-engine';
import { ResourceLoader } from '../src/browser/networking/resource-loader';
import { ResourcePrioritizer } from '../src/browser/networking/resource-prioritizer';
import { CookieJar } from '../src/browser/networking/cookie-jar';

function textOf(renderer: PageRenderer, id: string): string {
  const el = renderer.getDomTree()!.getElementById(id);
  return (el?.children.find((c) => c.nodeType === 'text') as { text?: string } | undefined)?.text ?? '';
}

describe('PageRenderer — HttpOnly cookies hidden from document.cookie, still sent over HTTP (real pipeline)', () => {
  it("a page script reading document.cookie never sees an HttpOnly cookie, but the cookie jar's HTTP-facing header still includes it", async () => {
    const url = 'https://example.test/';
    const cookieJar = new CookieJar();
    cookieJar.setFromResponse(url, [
      'session=secret; Path=/; HttpOnly',
      'theme=dark; Path=/',
    ]);
    const resourceLoader = new ResourceLoader();
    resourceLoader.setCookieJar(cookieJar);

    const renderer = new PageRenderer({
      htmlParser: new HtmlParser(),
      domTree: new DomTree(),
      cssParser: new CssParser(),
      layoutEngine: new LayoutEngine(),
      paintEngine: new PaintEngine(),
      resourceLoader,
      prioritizer: new ResourcePrioritizer(),
    });

    await renderer.render({
      url, statusCode: 200, contentType: 'text/html',
      body: `
        <html><body>
          <div id="log"></div>
          <script>document.getElementById('log').textContent = document.cookie;</script>
        </body></html>
      `,
      headers: new Map(), loadedAt: Date.now(),
    }, new AbortController().signal);

    const seenByScript = textOf(renderer, 'log');
    expect(seenByScript).toContain('theme=dark');
    expect(seenByScript).not.toContain('session=secret');

    // The real HTTP request path must still send the HttpOnly cookie —
    // HttpOnly hides a cookie from script, never from the network.
    const sentOverHttp = cookieJar.getCookieHeader(url);
    expect(sentOverHttp).toContain('session=secret');
    expect(sentOverHttp).toContain('theme=dark');
  });
});
