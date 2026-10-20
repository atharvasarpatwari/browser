/**
 * Tapping the rendered page did nothing on Android (1.20 on the tablet: "Learn more" never
 * navigated): the page is one bitmap and only the long-press menu hit-tested it.
 * activateAt() hit-tests the tap, fires `click` through the page's scripts, then follows links.
 */
import { describe, expect, it, vi } from 'vitest';
import { BrowserWindowPage } from '../src/ui/pages/browser-window';
import { PageRenderer } from '../src/browser/engine/page-renderer';
import type { PageRendererDependencies } from '../src/browser/engine/page-renderer';
import { HtmlParser } from '../src/browser/rendering/html-parser';
import { DomTree } from '../src/browser/rendering/dom-tree';
import type { DomElement } from '../src/browser/rendering/dom-tree';
import { CssParser } from '../src/browser/rendering/css-parser';
import { LayoutEngine } from '../src/browser/rendering/layout-engine';
import { PaintEngine } from '../src/browser/rendering/paint-engine';

async function renderPage(html: string) {
  const domTree = new DomTree();
  const renderer = new PageRenderer({
    htmlParser: new HtmlParser(), domTree, cssParser: new CssParser(), layoutEngine: new LayoutEngine(), paintEngine: new PaintEngine(),
    resourceLoader: {
      loadResource: vi.fn(), loadBatch: vi.fn(), loadStylesheet: vi.fn().mockResolvedValue(''), loadScript: vi.fn().mockResolvedValue(''),
      loadImage: vi.fn(), getPriority: vi.fn(), setMaxConcurrent: vi.fn(), on: vi.fn(), off: vi.fn(), dispose: vi.fn(),
    },
    prioritizer: { submit: vi.fn(), submitBatch: vi.fn(), submitPreload: vi.fn(), submitPrefetch: vi.fn(), submitPreconnect: vi.fn(), clear: vi.fn(), dispose: vi.fn() },
  } as unknown as PageRendererDependencies);
  await renderer.render({ url: 'https://example.com/dir/page', statusCode: 200, contentType: 'text/html', body: html, headers: new Map(), loadedAt: 0 } as never, new AbortController().signal);
  const byId = (id: string) => domTree.getElementById(id) as DomElement;
  return { renderer, domTree, byId };
}

describe('PageRenderer.dispatchPageEvent', () => {
  it('runs the page\'s click listeners and reports preventDefault()', async () => {
    const { renderer, byId } = await renderPage(`<html><body><a id="a" href="/x">x</a><button id="b">b</button>
      <script>
        document.getElementById('b').addEventListener('click', function () { document.body.setAttribute('data-clicked', 'yes'); });
        document.getElementById('a').addEventListener('click', function (e) { e.preventDefault(); });
      </script></body></html>`);
    expect(renderer.dispatchPageEvent(byId('b'), 'click')).toBe(true);
    expect(renderer.dispatchPageEvent(byId('a'), 'click')).toBe(false);
  });
});

describe('BrowserWindowPage.activateAt', () => {
  async function pageWith(hit: DomElement | null, notCanceled = true) {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const page = new BrowserWindowPage({ hideChromeUI: true });
    await page.mount(host);
    const canvas = document.createElement('canvas');
    canvas.width = 400; canvas.height = 400;
    (page as unknown as { contentArea: HTMLElement }).contentArea.appendChild(canvas);
    canvas.getBoundingClientRect = () => ({ left: 0, top: 0, width: 400, height: 400, right: 400, bottom: 400, x: 0, y: 0, toJSON() {} });
    const dispatchPageEvent = vi.fn(() => notCanceled);
    (page as unknown as { browserEngine: unknown }).browserEngine = {
      getPageLayoutEngine: () => ({ getElementAtPoint: () => hit }),
      dispatchPageEvent,
    };
    const navigate = vi.spyOn(page, 'navigate').mockResolvedValue();
    const createTab = vi.spyOn(page, 'createTab').mockReturnValue('t');
    vi.spyOn(page as unknown as { resolveContextUrl: (h: string) => string }, 'resolveContextUrl').mockImplementation((h) => new URL(h, 'https://example.com/dir/page').href);
    return { page, navigate, createTab, dispatchPageEvent };
  }

  const link = async (attrs: string) => {
    const { byId } = await renderPage(`<html><body><a id="a" ${attrs}><span id="s">go</span></a></body></html>`);
    return byId('s');
  };

  it('follows the link around the tapped element, resolved against the page', async () => {
    const { page, navigate, dispatchPageEvent } = await pageWith(await link('href="next.html"'));
    expect(page.activateAt(10, 10)).toBe('link');
    expect(dispatchPageEvent).toHaveBeenCalledWith(expect.anything(), 'click');
    expect(navigate).toHaveBeenCalledWith('https://example.com/dir/next.html');
  });

  it('opens target=_blank links in a new tab', async () => {
    const { page, createTab, navigate } = await pageWith(await link('href="/n" target="_blank"'));
    page.activateAt(10, 10);
    expect(createTab).toHaveBeenCalledWith('https://example.com/n');
    expect(navigate).not.toHaveBeenCalled();
  });

  it('does not navigate when a page script cancelled the click, or for javascript:/# links', async () => {
    const cancelled = await pageWith(await link('href="/n"'), false);
    expect(cancelled.page.activateAt(10, 10)).toBe('scripted');
    expect(cancelled.navigate).not.toHaveBeenCalled();
    for (const href of ['javascript:void(0)', '#top']) {
      const p = await pageWith(await link(`href="${href}"`));
      expect(p.page.activateAt(10, 10)).toBe('none');
      expect(p.navigate).not.toHaveBeenCalled();
    }
  });

  it('maps the tap through the page scroll', async () => {
    const { page } = await pageWith(null);
    (page as unknown as { paintEngine: unknown }).paintEngine = { getScroll: () => ({ y: 250 }) };
    expect(page.clientToPage(10, 20)).toEqual({ x: 10, y: 270 });
  });
});
