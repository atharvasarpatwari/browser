import { describe, it, expect, vi } from 'vitest';
import type { Mock } from 'vitest';
import { Router, RouteType, isEngineRendered } from '../src/browser/navigation/router';
import { NavigationController } from '../src/browser/navigation/navigation-controller';
import type { INavigationController } from '../src/browser/navigation/navigation-controller';
import { UrlParser } from '../src/browser/navigation/url-parser';
import { NavigationFetcher } from '../src/ui/components/navigation-fetcher';
import type { IContentRenderer } from '../src/ui/components/content-renderer/content-renderer';
import type { IBrowserEngine } from '../src/browser/engine/browser-engine';
import type { IPaintEngine } from '../src/browser/rendering/paint-engine';

describe('isEngineRendered', () => {
  it('is true only for routes the engine fetches and renders itself', () => {
    const rendered = [
      RouteType.WebContent, RouteType.LocalFile, RouteType.WebSocket, RouteType.SecureFileTransfer,
      RouteType.Usenet, RouteType.LegacyProtocol, RouteType.Gateway,
    ];
    for (const type of Object.values(RouteType)) {
      expect(isEngineRendered(type), type).toBe(rendered.includes(type));
    }
  });
});

describe('router: built-in pages that take a query string', () => {
  const router = new Router();
  const dispatch = async (url: string) => {
    const nav = new NavigationController(new UrlParser());
    await nav.navigate(url);
    return router.dispatch(nav.getCurrentEntry()!);
  };

  it.each([
    ['nova://search', 'search'],
    ['nova://search?q=react%20hooks', 'search'],
    ['nova://search/?q=x', 'search'],
    ['nova://search#top', 'search'],
    ['nova://research', 'research'],
    ['nova://research?q=quantum%20computing', 'research'],
  ])('%s is the built-in "%s" page', async (url, pageId) => {
    const result = await dispatch(url);
    expect(result.type).toBe(RouteType.InternalPage);
    expect(result.pageId).toBe(pageId);
  });

  it('does not claim look-alike addresses', async () => {
    for (const url of ['nova://searching', 'nova://search-engine?q=1', 'nova://researcher?q=1']) {
      expect((await dispatch(url)).type, url).not.toBe(RouteType.InternalPage);
    }
  });

  it('still routes the existing built-in pages', async () => {
    for (const url of ['nova://settings', 'nova://downloads', 'nova://history', 'nova://bookmarks', 'nova://extensions']) {
      expect((await dispatch(url)).type, url).toBe(RouteType.InternalPage);
    }
    expect((await dispatch('about:newtab')).type).toBe(RouteType.NewTabPage);
    expect((await dispatch('about:blank')).type).toBe(RouteType.BlankPage);
    expect((await dispatch('https://example.com/')).type).toBe(RouteType.WebContent);
  });
});

describe('NavigationFetcher: the page bitmap never replaces a built-in page', () => {
  type Handler = (event: unknown) => void;
  type Renderer = { [K in 'renderFromImageData' | 'renderHtml' | 'renderError' | 'renderLoading']: Mock<(...args: unknown[]) => void> };

  const setup = () => {
    const handlers: Record<string, Handler[]> = {};
    const on = (type: string, h: Handler) => { (handlers[type] ??= []).push(h); };
    const off = (type: string, h: Handler) => { handlers[type] = (handlers[type] ?? []).filter((x) => x !== h); };
    const renderer: Renderer = {
      renderFromImageData: vi.fn<(...args: unknown[]) => void>(),
      renderHtml: vi.fn<(...args: unknown[]) => void>(),
      renderError: vi.fn<(...args: unknown[]) => void>(),
      renderLoading: vi.fn<(...args: unknown[]) => void>(),
    };
    const paint = { rasterize: () => ({ width: 4, height: 4, data: new Uint8ClampedArray(64) }) } as unknown as IPaintEngine;
    const fetcher = new NavigationFetcher(
      { on, off } as unknown as IBrowserEngine,
      renderer as unknown as IContentRenderer,
      paint,
      { on, off } as unknown as INavigationController,
    );
    fetcher.start();
    const emit = (kind: string, type: RouteType | null, url = 'https://example.com/') => {
      const session = { entry: { url }, finalUrl: undefined, routeResult: type === null ? null : { type, pageId: 'x', title: 't' } };
      for (const h of handlers[kind] ?? []) h({ kind, session, elapsedMs: 1 });
    };
    return { renderer, fetcher, emit, handlers };
  };

  it.each([RouteType.WebContent, RouteType.LocalFile, RouteType.Gateway])('paints the bitmap for %s pages', (type) => {
    const { renderer, emit } = setup();
    emit('pageLoadReady', type);
    expect(renderer.renderFromImageData).toHaveBeenCalledTimes(1);
    expect(renderer.renderFromImageData.mock.calls[0]![1]).toBe(true); // a fresh canvas for a new page
    emit('pageRepainted', type);
    expect(renderer.renderFromImageData).toHaveBeenCalledTimes(2);
    expect(renderer.renderFromImageData.mock.calls[1]![1]).toBe(false); // repaints reuse it
  });

  it.each([
    RouteType.InternalPage, RouteType.NewTabPage, RouteType.BlankPage, RouteType.Unknown,
    RouteType.ErrorPage, RouteType.ExternalProtocol, RouteType.DataUri, RouteType.BlobUrl,
  ])('leaves %s pages to the window', (type) => {
    const { renderer, emit } = setup();
    emit('pageLoadReady', type, 'nova://settings');
    emit('pageRepainted', type, 'nova://settings');
    expect(renderer.renderFromImageData).not.toHaveBeenCalled();
    expect(renderer.renderHtml).not.toHaveBeenCalled();
  });

  it('still paints when the session has no route yet (older engines)', () => {
    const { renderer, emit } = setup();
    emit('pageLoadReady', null);
    expect(renderer.renderFromImageData).toHaveBeenCalledTimes(1);
  });

  it('keeps showing load errors, whatever the route', () => {
    const { renderer, handlers } = setup();
    for (const h of handlers.pageLoadError ?? []) {
      h({ kind: 'pageLoadError', session: { entry: { url: 'https://x.test/' } }, error: new Error('boom') });
    }
    expect(renderer.renderError).toHaveBeenCalledWith('Page Load Failed', 'boom', 'https://x.test/');
  });

  it('stops listening once disposed', () => {
    const { fetcher, handlers, renderer, emit } = setup();
    fetcher.dispose();
    expect(handlers.pageLoadReady).toEqual([]);
    emit('pageLoadReady', RouteType.WebContent);
    expect(renderer.renderFromImageData).not.toHaveBeenCalled();
  });
});
