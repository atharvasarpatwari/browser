/**
 * Page scripts run in the production renderer configuration.
 *
 * Regression for: main.ts built PageRenderer with `new HtmlSanitizer()`, which
 * strips <script> before executeAllScripts, so no page script ever ran in the
 * app, while every other renderer test (built without a sanitizer) still passed.
 * These tests use the same sanitizer config main.ts uses.
 */
import { describe, expect, it, vi } from 'vitest';
import { PageRenderer } from '../src/browser/engine/page-renderer';
import type { PageRendererDependencies } from '../src/browser/engine/page-renderer';
import type { PageLoadResult } from '../src/browser/engine/browser-engine';
import { HtmlParser } from '../src/browser/rendering/html-parser';
import { DomTree } from '../src/browser/rendering/dom-tree';
import { HtmlSanitizer } from '../src/browser/security/html-sanitizer';
import { createCspEnforcement } from '../src/browser/security/csp-enforcement';

function deps(domTree: DomTree, overrides: Partial<PageRendererDependencies> = {}) {
  const order: string[] = [];
  const d = {
    htmlParser: new HtmlParser(),
    domTree,
    // Same config as src/app/main.ts.
    sanitizer: new HtmlSanitizer({ keepScriptElements: true }),
    cssParser: {
      parseStylesheet: vi.fn().mockReturnValue({ rules: [], url: null }),
      parseInlineStyle: vi.fn().mockReturnValue(new Map()),
      extractStylesFromDocument: vi.fn().mockReturnValue([]),
      computeStyles: vi.fn().mockReturnValue(new Map()),
      computeStylesForElement: vi.fn().mockReturnValue(new Map()),
      getCss5Parser: vi.fn().mockReturnValue({ parseSelector: vi.fn().mockReturnValue(null) }),
      dispose: vi.fn(),
    },
    layoutEngine: {
      layout: vi.fn(() => order.push('layout')), layoutIncremental: vi.fn().mockReturnValue(new Set()),
      getLayoutBox: vi.fn(), getElementAtPoint: vi.fn(), getConfig: vi.fn(), updateConfig: vi.fn(), dispose: vi.fn(),
    },
    paintEngine: {
      paint: vi.fn(() => order.push('paint')), paintIncremental: vi.fn().mockReturnValue(new Set()),
      getLayers: vi.fn().mockReturnValue([]), getLayerById: vi.fn(), compositeFrame: vi.fn().mockReturnValue([]),
      rasterize: vi.fn(), rasterizeAsync: vi.fn().mockResolvedValue({}), resize: vi.fn(), getConfig: vi.fn(),
      updateConfig: vi.fn(), on: vi.fn(), off: vi.fn(), setOpacityResolver: vi.fn(), setTransformResolver: vi.fn(), dispose: vi.fn(),
    },
    resourceLoader: {
      loadResource: vi.fn(), loadBatch: vi.fn(), loadStylesheet: vi.fn().mockResolvedValue(''),
      loadScript: vi.fn().mockResolvedValue('document.getElementById("out").setAttribute("data-ext", "yes");'),
      loadImage: vi.fn(), getPriority: vi.fn(), setMaxConcurrent: vi.fn(), on: vi.fn(), off: vi.fn(), dispose: vi.fn(),
    },
    prioritizer: { submit: vi.fn(), submitBatch: vi.fn(), submitPreload: vi.fn(), submitPrefetch: vi.fn(), submitPreconnect: vi.fn(), clear: vi.fn(), dispose: vi.fn() },
    onFrameRendered: vi.fn(() => order.push('frame')),
    ...overrides,
  } as unknown as PageRendererDependencies;
  return { d, order };
}

function page(body: string, headers: Record<string, string> = {}): PageLoadResult {
  return {
    url: 'https://shop.test/app', statusCode: 200, contentType: 'text/html', loadedAt: Date.now(),
    body: `<html><body><p id="out">x</p>${body}</body></html>`,
    headers: new Map([['content-type', 'text/html'], ...Object.entries(headers)]),
  };
}

const attr = (domTree: DomTree, name: string) => domTree.getElementById('out')?.attributes.get(name) ?? null;

describe('page scripts with the production sanitizer', () => {
  it('runs inline scripts, sharing globals between scripts on the page', async () => {
    const domTree = new DomTree();
    await new PageRenderer(deps(domTree).d).render(page(
      '<script>var lib = { mark: function (v) { document.getElementById("out").setAttribute("data-ran", v); } };</script>' +
      '<script>lib.mark("yes");</script>',
    ), new AbortController().signal);
    expect(attr(domTree, 'data-ran')).toBe('yes');
  });

  it('paints the script-free page before running scripts', async () => {
    const domTree = new DomTree();
    const { d, order } = deps(domTree);
    await new PageRenderer(d).render(page('<script>document.getElementById("out").setAttribute("data-ran", "1");</script>'), new AbortController().signal);
    expect(order.slice(0, 3)).toEqual(['layout', 'paint', 'frame']);
    expect(order.filter((o) => o === 'paint').length).toBeGreaterThanOrEqual(2);
  });

  it('does not add an extra paint for pages without scripts', async () => {
    const domTree = new DomTree();
    const { d, order } = deps(domTree);
    await new PageRenderer(d).render(page(''), new AbortController().signal);
    expect(order.filter((o) => o === 'paint')).toHaveLength(1);
  });

  it('still strips inline on* handlers and <object>', async () => {
    const domTree = new DomTree();
    await new PageRenderer(deps(domTree).d).render(page('<a id="a" onclick="x()">a</a><object id="o"></object>'), new AbortController().signal);
    expect(domTree.getElementById('a')?.attributes.has('onclick')).toBe(false);
    expect(domTree.getElementById('o')).toBeNull();
  });

  it('enforces CSP: inline blocked without nonce, nonce allows, external allowed by script-src URL', async () => {
    const domTree = new DomTree();
    const csp = createCspEnforcement();
    const { d } = deps(domTree, { scriptEnforcer: csp.scriptEnforcer, resourceEnforcer: csp.resourceEnforcer, policyStore: csp.policyStore });
    await new PageRenderer(d).render(page(
      '<script>document.getElementById("out").setAttribute("data-plain", "ran");</script>' +
      '<script nonce="n0nce">document.getElementById("out").setAttribute("data-nonce", "ran");</script>' +
      '<script src="/app.js"></script>',
      { 'content-security-policy': "script-src 'self' 'nonce-n0nce'" },
    ), new AbortController().signal);
    expect(attr(domTree, 'data-plain')).toBeNull();
    expect(attr(domTree, 'data-nonce')).toBe('ran');
    expect(attr(domTree, 'data-ext')).toBe('yes');
  });

  it('skips remaining scripts once the 3 s per-page budget is spent', async () => {
    const domTree = new DomTree();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      await new PageRenderer(deps(domTree).d).render(page(
        '<script>var t = Date.now(); while (Date.now() - t < 3100) {}</script>' +
        '<script>document.getElementById("out").setAttribute("data-last", "1");</script>',
      ), new AbortController().signal);
      expect(attr(domTree, 'data-last')).toBeNull();
      expect(warn.mock.calls.some((c) => String(c[0]).includes('budget'))).toBe(true);
    } finally {
      warn.mockRestore();
    }
  }, 20_000);
});
