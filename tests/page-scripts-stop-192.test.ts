/**
 * 1.92: a page's scripts kept running after the user navigated away (until the next page's own
 * scripts started). On the tablet, CNN's timers navigated GitHub and Netflix to CNN article paths
 * and kept the engine busy, so a page typed in the address bar took over a minute to start.
 */
import { describe, expect, it, vi } from 'vitest';
import { NavigationController } from '../src/browser/navigation/navigation-controller';
import { UrlParser } from '../src/browser/navigation/url-parser';
import { Router } from '../src/browser/navigation/router';
import { BrowserEngine } from '../src/browser/engine/browser-engine';
import type { IPageLoader, PageLoadResult } from '../src/browser/engine/browser-engine';
import { DEFAULT_CONFIG } from '../src/app/app-shell';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('leaving a page stops its scripts', () => {
  it('the engine stops the shown page\'s scripts as soon as a new navigation commits', async () => {
    const loader: IPageLoader = {
      async load(url): Promise<PageLoadResult> {
        if (url.includes('slow')) await new Promise(() => {}); // the next page is still downloading
        return { url, statusCode: 200, contentType: 'text/html', body: '<html><body>x</body></html>', headers: new Map(), loadedAt: Date.now() };
      },
    };
    const nav = new NavigationController(new UrlParser());
    const engine = new BrowserEngine(nav, new Router(), DEFAULT_CONFIG);
    engine.setPageLoader(loader);
    const stopPageScripts = vi.fn();
    engine.setPageRenderer({ render: async () => {}, getLayoutEngine: () => null, stopPageScripts });
    await engine.initialize();
    await nav.navigate('https://a.test/');
    await sleep(0);
    stopPageScripts.mockClear();
    await nav.navigate('https://slow.test/');
    expect(stopPageScripts).toHaveBeenCalledTimes(1); // before the slow page has arrived
    await engine.shutdown();
  });
});
