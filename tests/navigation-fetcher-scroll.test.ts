import { describe, it, expect, vi } from 'vitest';
import { NavigationFetcher } from '../src/ui/components/navigation-fetcher';
import { RouteType } from '../src/browser/navigation/router';
import type { IBrowserEngine } from '../src/browser/engine/browser-engine';
import type { IContentRenderer } from '../src/ui/components/content-renderer/content-renderer';
import type { IPaintEngine } from '../src/browser/rendering/paint-engine';
import type { INavigationController } from '../src/browser/navigation/navigation-controller';

type Handler = (event: unknown) => void;

/** A fetcher over a paint engine that remembers its scroll offset, and a way to play engine / navigation events at it. */
function setup() {
  const handlers: Record<string, Handler[]> = {};
  const on = (type: string, h: Handler) => { (handlers[type] ??= []).push(h); };
  const off = (type: string, h: Handler) => { handlers[type] = (handlers[type] ?? []).filter((x) => x !== h); };
  let y = 0;
  const setScroll = vi.fn((to: number) => { y = to; return to; });
  const paint = {
    rasterize: () => ({ width: 4, height: 4, data: new Uint8ClampedArray(64) }),
    setScroll,
    getScroll: () => ({ y, max: 5000, viewportHeight: 1080, documentHeight: 6080 }),
  } as unknown as IPaintEngine;
  const fetcher = new NavigationFetcher(
    { on, off } as unknown as IBrowserEngine,
    { renderFromImageData: vi.fn(), renderHtml: vi.fn(), renderError: vi.fn(), renderLoading: vi.fn() } as unknown as IContentRenderer,
    paint,
    { on, off } as unknown as INavigationController,
  );
  fetcher.start();
  const emit = (kind: string, payload: Record<string, unknown>) => { for (const h of handlers[kind] ?? []) h({ kind, ...payload }); };
  return {
    fetcher,
    setScroll,
    /** The user scrolls the page on screen. */
    scrollTo: (to: number) => { y = to; },
    /** A navigation starts (the page on screen is about to be left). */
    leave: () => emit('navigationStarted', { request: { url: 'https://example.com/next' } }),
    /** A page is ready: its history entry has this id. */
    show: (id: string, type = RouteType.WebContent) => emit('pageLoadReady', { session: { entry: { id, url: `https://example.com/${id}` }, routeResult: { type, pageId: 'x', title: 't' } }, elapsedMs: 1 }),
    repaint: (id: string) => emit('pageRepainted', { session: { entry: { id, url: `https://example.com/${id}` }, routeResult: { type: RouteType.WebContent, pageId: 'x', title: 't' } } }),
  };
}

describe('NavigationFetcher scroll position', () => {
  it('a new page starts at the top', () => {
    const t = setup();
    t.show('a');
    expect(t.setScroll).toHaveBeenLastCalledWith(0);
  });

  it('Back returns to where the page was left, and a page not seen before still starts at the top', () => {
    const t = setup();
    t.show('a');
    t.scrollTo(1200);
    t.leave();
    t.show('b');
    expect(t.setScroll).toHaveBeenLastCalledWith(0);
    t.scrollTo(300);
    t.leave();
    t.show('a'); // Back
    expect(t.setScroll).toHaveBeenLastCalledWith(1200);
    t.leave();
    t.show('b'); // Forward
    expect(t.setScroll).toHaveBeenLastCalledWith(300);
  });

  it('a repaint of the page on screen leaves the scroll alone', () => {
    const t = setup();
    t.show('a');
    t.setScroll.mockClear();
    t.repaint('a');
    expect(t.setScroll).not.toHaveBeenCalled();
  });

  it('a built-in page is not a bitmap page: nothing is saved or restored for it', () => {
    const t = setup();
    t.show('a');
    t.scrollTo(900);
    t.show('settings', RouteType.InternalPage);
    expect(t.setScroll).toHaveBeenCalledTimes(1); // only the first page's reset
  });
});
