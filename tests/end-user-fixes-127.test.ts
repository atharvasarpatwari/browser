/**
 * Fixes for root causes from the end-user test pass (doc/2026-10-21-nova-android-1.26-end-user-test-results.md):
 * RC-3 failed loads render blank, RC-5 zero tabs, RC-13 library not re-pushed after startup.
 */
import { describe, expect, it, vi } from 'vitest';
import { PageLoader } from '../src/browser/engine/page-loader';
import { BrowserWindowPage } from '../src/ui/pages/browser-window';
import { BookmarkService } from '../src/browser/bookmarks/bookmark-services';
import { HistoryService } from '../src/browser/history/history-service';

const loaderReturning = (result: Record<string, unknown>) => new PageLoader({
  loadResource: vi.fn().mockResolvedValue({
    url: 'https://x.test/', kind: 'document', statusCode: 200, contentType: 'text/html', body: '<p>ok</p>',
    bodyBinary: null, headers: new Map(), loadedAt: 0, durationMs: 1, fromCache: false, error: null, ...result,
  }),
} as never);

describe('RC-3: a failed load is an error, not an empty page', () => {
  it('throws for network failures (status 0 / error), so pageLoadError and the error page fire', async () => {
    await expect(loaderReturning({ statusCode: 0, body: '', error: 'Unable to resolve host "nonexistent.invalid"' })
      .load('https://nonexistent.invalid/', new AbortController().signal)).rejects.toThrow(/resolve host/);
    await expect(loaderReturning({ statusCode: 0, body: '', error: null })
      .load('https://x.test/', new AbortController().signal)).rejects.toThrow(/did not respond/);
  });

  it('an HTTP error with an empty body becomes a short "HTTP 404 Not Found" page; a real body is kept', async () => {
    const empty = await loaderReturning({ statusCode: 404, body: '', contentType: '', url: 'https://httpbin.org/status/404' }).load('https://httpbin.org/status/404', new AbortController().signal);
    expect(empty.statusCode).toBe(404);
    expect(empty.contentType).toBe('text/html');
    expect(empty.body).toContain('HTTP 404 Not Found');
    expect(empty.body).toContain('httpbin.org');
    const real = await loaderReturning({ statusCode: 404, body: '<h1>Custom 404</h1>' }).load('https://x.test/nope', new AbortController().signal);
    expect(real.body).toBe('<h1>Custom 404</h1>');
  });
});

describe('RC-5 / RC-13: BrowserWindowPage', () => {
  async function mounted() {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const page = new BrowserWindowPage({ hideChromeUI: true });
    await page.mount(host);
    return page;
  }

  it('closing the last tab opens a fresh one instead of leaving zero', async () => {
    const page = await mounted();
    const tabs = () => (page as unknown as { tabManager: { count: number; tabs: readonly { id: string }[]; activeTabId: string | null } }).tabManager;
    page.createTab('https://example.com/');
    for (const t of [...tabs().tabs]) page.closeTab(t.id);
    expect(tabs().count).toBe(1);
    expect(tabs().activeTabId).toBe(tabs().tabs[0]!.id);
  });

  it('connecting the bookmark/history services re-announces the library, so early readers see saved data', async () => {
    const page = await mounted();
    const changed = vi.fn();
    page.onLibraryChanged(changed);
    page.setBookmarkService(new BookmarkService());
    page.setHistoryService(new HistoryService());
    expect(changed).toHaveBeenCalledTimes(2);
  });
});
