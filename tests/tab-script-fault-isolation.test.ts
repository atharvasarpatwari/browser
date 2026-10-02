/**
 * Establishes the real baseline for doc/crash-isolation-scoping.md's step 2:
 * "intentionally throw inside one tab's page script and assert that a second,
 * unrelated open tab is still interactive afterward."
 *
 * Nova's real architecture (confirmed in doc/2026-09-12-devtools-network-tab.md
 * and main.ts's DI wiring) is ONE shared PageRenderer/DomTree/LayoutEngine/
 * PaintEngine for the whole app — tabs don't get independent live engine
 * instances (TabContext's per-tab engines exist but are never read by
 * PageRenderer). So "does tab A's crash affect tab B" concretely means: after
 * rendering a page whose script throws, does the SAME shared pipeline still
 * render a completely unrelated page correctly on the next navigation?
 */
import { describe, it, expect, vi } from 'vitest';
import { PageRenderer } from '../src/browser/engine/page-renderer';
import { HtmlParser } from '../src/browser/rendering/html-parser';
import { DomTree } from '../src/browser/rendering/dom-tree';
import type { DomElement } from '../src/browser/rendering/dom-tree';
import { CssParser } from '../src/browser/rendering/css-parser';
import { LayoutEngine } from '../src/browser/rendering/layout-engine';
import { PaintEngine } from '../src/browser/rendering/paint-engine';
import { ResourceLoader } from '../src/browser/networking/resource-loader';
import { ResourcePrioritizer } from '../src/browser/networking/resource-prioritizer';

function makeRenderer() {
  return new PageRenderer({
    htmlParser: new HtmlParser(),
    domTree: new DomTree(),
    cssParser: new CssParser(),
    layoutEngine: new LayoutEngine(),
    paintEngine: new PaintEngine(),
    resourceLoader: new ResourceLoader(),
    prioritizer: new ResourcePrioritizer(),
  });
}

describe('Multi-tab script fault isolation (real pipeline, shared engine)', () => {
  it('a throwing script in one navigation does not stop the next navigation from rendering', async () => {
    const renderer = makeRenderer();
    const signal = new AbortController().signal;

    // "Tab A": a page whose script throws immediately.
    const crashingPage = {
      url: 'https://a.example/',
      statusCode: 200,
      contentType: 'text/html',
      body: '<html><body><h1>Tab A</h1><script>null.x.y;</script></body></html>',
      headers: new Map(),
      loadedAt: Date.now(),
    };

    await expect(renderer.render(crashingPage, signal)).resolves.not.toThrow();

    const domAfterCrash = renderer.getDomTree().getDocument();
    expect(domAfterCrash?.bodyElement).not.toBeNull();

    // "Tab B": a completely unrelated, well-behaved page navigated to next,
    // through the SAME renderer instance (Nova's real, shared-engine shape).
    const healthyPage = {
      url: 'https://b.example/',
      statusCode: 200,
      contentType: 'text/html',
      body: '<html><body><h1 id="ok">Tab B still works</h1></body></html>',
      headers: new Map(),
      loadedAt: Date.now(),
    };

    await renderer.render(healthyPage, signal);

    const domAfterHealthy = renderer.getDomTree().getDocument();
    const h1 = domAfterHealthy?.bodyElement?.children.find(
      (c): c is DomElement => c.nodeType === 'element' && (c as DomElement).tagName === 'h1',
    );
    expect(h1).toBeDefined();
  });

  it("a throwing script's error surfaces to the console instead of vanishing silently", async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const renderer = makeRenderer();
      const signal = new AbortController().signal;

      await renderer.render(
        {
          url: 'https://a.example/',
          statusCode: 200,
          contentType: 'text/html',
          body: '<html><body><script>null.x.y;</script></body></html>',
          headers: new Map(),
          loadedAt: Date.now(),
        },
        signal,
      );

      // Not asserting exact wording — just that the fault was observable
      // somewhere, not swallowed with zero trace.
      expect(spy).toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
  });
});
