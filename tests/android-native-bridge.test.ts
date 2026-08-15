import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { BrowserWindowPage } from '../src/ui/pages/browser-window';
import type { IBrowserWindowPage } from '../src/ui/pages/browser-window';
import type { DomElement } from '../src/browser/rendering/dom-tree';
import { BookmarkService } from '../src/browser/bookmarks/bookmark-services';
import { HistoryService } from '../src/browser/history/history-service';
import { NavigationController } from '../src/browser/navigation/navigation-controller';
import { UrlParser } from '../src/browser/navigation/url-parser';
import { isNativeHostPresent, installAndroidNativeBridge } from '../src/app/android-native-bridge';

describe('BrowserWindowPage — native chrome bridge', () => {
  let container: HTMLElement;
  let page: IBrowserWindowPage;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  afterEach(async () => {
    await page?.unmount?.();
    container.remove();
  });

  it('hideChromeUI hides the toolbar/tab-bar DOM but keeps them mounted', async () => {
    page = new BrowserWindowPage({ hideChromeUI: true });
    await page.mount(container);
    // The page should mount successfully either way; the key behavioral
    // guarantee is that mounting does not throw and getChromeState() works
    // even when chrome is hidden.
    expect(page.isMounted).toBe(true);
    expect(() => page.getChromeState()).not.toThrow();
  });

  it('getChromeState() reflects the initial single tab', async () => {
    page = new BrowserWindowPage({ hideChromeUI: true });
    await page.mount(container);
    const state = page.getChromeState();
    expect(Array.isArray(state.tabs)).toBe(true);
    expect(typeof state.canGoBack).toBe('boolean');
    expect(typeof state.canGoForward).toBe('boolean');
  });

  it('getChromeState() exposes a per-tab loading flag (needed for the address-bar spinner)', async () => {
    page = new BrowserWindowPage({ hideChromeUI: true });
    await page.mount(container);
    const id = page.createTab('https://example.com/');
    const tab = page.getChromeState().tabs.find((t) => t.id === id);
    expect(tab).toBeDefined();
    expect(typeof tab!.loading).toBe('boolean');
  });

  it('getChromeState() exposes default homeUrl and searchTemplate when no settings service', async () => {
    page = new BrowserWindowPage({ hideChromeUI: true });
    await page.mount(container);
    const state = page.getChromeState();
    expect(state.homeUrl).toBe('about:blank');
    expect(state.searchTemplate).toBe('https://www.google.com/search?q=%s');
  });

  it('getChromeState() reflects the settingsService home page and default search engine', async () => {
    page = new BrowserWindowPage({ hideChromeUI: true });
    page.setSettingsService({
      getString: (key: string, fallback = '') => {
        if (key === 'homePage') return 'https://example.com/home';
        if (key === 'defaultSearchEngine') return 'duckduckgo';
        return fallback;
      },
    } as unknown as Parameters<typeof page.setSettingsService>[0]);
    await page.mount(container);
    const state = page.getChromeState();
    expect(state.homeUrl).toBe('https://example.com/home');
    expect(state.searchTemplate).toBe('https://duckduckgo.com/?q=%s');
  });

  it('createTab() adds a tab and returns its id', async () => {
    page = new BrowserWindowPage({ hideChromeUI: true });
    await page.mount(container);
    const before = page.getChromeState().tabs.length;
    const id = page.createTab('https://example.com/');
    expect(id).not.toBe('');
    const after = page.getChromeState();
    expect(after.tabs.length).toBe(before + 1);
    expect(after.tabs.some((t) => t.id === id)).toBe(true);
  });

  it('closeTab() removes a tab', async () => {
    page = new BrowserWindowPage({ hideChromeUI: true });
    await page.mount(container);
    const id = page.createTab('https://example.com/');
    const removed = page.closeTab(id);
    expect(removed).toBe(true);
    expect(page.getChromeState().tabs.some((t) => t.id === id)).toBe(false);
  });

  it('activateTabExternal() switches the active tab', async () => {
    page = new BrowserWindowPage({ hideChromeUI: true });
    await page.mount(container);
    const id = page.createTab('https://example.com/');
    const ok = page.activateTabExternal(id);
    expect(ok).toBe(true);
    expect(page.getChromeState().activeTabId).toBe(id);
  });

  it('onChromeState() fires on tab creation with a fresh snapshot', async () => {
    page = new BrowserWindowPage({ hideChromeUI: true });
    await page.mount(container);
    const snapshots: unknown[] = [];
    page.onChromeState((s) => snapshots.push(s));
    page.createTab('https://example.com/');
    expect(snapshots.length).toBeGreaterThan(0);
  });

  it('offChromeState() stops further notifications', async () => {
    page = new BrowserWindowPage({ hideChromeUI: true });
    await page.mount(container);
    let count = 0;
    const handler = () => { count++; };
    page.onChromeState(handler);
    page.createTab('https://a.example/');
    const afterFirst = count;
    page.offChromeState(handler);
    page.createTab('https://b.example/');
    expect(count).toBe(afterFirst);
  });

  it('getChromeState() exposes a per-tab error field, null for healthy tabs', async () => {
    page = new BrowserWindowPage({ hideChromeUI: true });
    await page.mount(container);
    const tab = page.getChromeState().tabs[0];
    expect(tab).toBeDefined();
    expect(tab!.error).toBeNull();
  });

  it('getChromeState() records a per-tab error when the active-tab navigation fails', async () => {
    page = new BrowserWindowPage({ hideChromeUI: true });
    await page.mount(container);
    const controller = new NavigationController(new UrlParser());
    page.setNavigationController(controller);
    const id = page.getChromeState().activeTabId!;
    await controller.navigate('not a valid url');
    const tab = page.getChromeState().tabs.find((t) => t.id === id);
    expect(tab!.error).not.toBeNull();
    expect(tab!.error!.url).toBe('not a valid url');
    expect(tab!.error!.description).toBeTruthy();
    expect(tab!.error!.code).toBeTruthy();
  });

  it('a subsequent successful navigation clears the per-tab error', async () => {
    page = new BrowserWindowPage({ hideChromeUI: true });
    await page.mount(container);
    const controller = new NavigationController(new UrlParser());
    page.setNavigationController(controller);
    const id = page.getChromeState().activeTabId!;
    await controller.navigate('not a valid url');
    expect(page.getChromeState().tabs.find((t) => t.id === id)!.error).not.toBeNull();
    await controller.navigate('about:blank');
    expect(page.getChromeState().tabs.find((t) => t.id === id)!.error).toBeNull();
  });

  it('errors are recorded per-tab and stay on the correct tab across switches', async () => {
    page = new BrowserWindowPage({ hideChromeUI: true });
    await page.mount(container);
    const controller = new NavigationController(new UrlParser());
    page.setNavigationController(controller);
    const firstId = page.getChromeState().activeTabId!;
    await controller.navigate('not a valid url');
    expect(page.getChromeState().tabs.find((t) => t.id === firstId)!.error).not.toBeNull();

    // A second tab is healthy even though the first carries an error.
    const secondId = page.createTab('https://example.com/');
    expect(page.getChromeState().tabs.find((t) => t.id === secondId)!.error).toBeNull();
    expect(page.getChromeState().tabs.find((t) => t.id === firstId)!.error).not.toBeNull();
  });

  it('records a per-tab error from engine pageLoadError and clears it on pageLoadStarted', async () => {
    page = new BrowserWindowPage({ hideChromeUI: true });
    await page.mount(container);
    const handlers: Record<string, Array<(e: unknown) => void>> = {};
    const fakeEngine = {
      on: (type: string, h: (e: unknown) => void) => { (handlers[type] ??= []).push(h); },
      off: (type: string, h: (e: unknown) => void) => {
        handlers[type] = (handlers[type] ?? []).filter((x) => x !== h);
      },
    } as unknown as Parameters<typeof page.setBrowserEngine>[0];
    page.setBrowserEngine(fakeEngine);
    const id = page.getChromeState().activeTabId!;

    handlers.pageLoadError![0]({
      kind: 'pageLoadError',
      session: { entry: { url: 'http://127.0.0.1:1/' } },
      error: new Error('connect ECONNREFUSED 127.0.0.1:1'),
    });
    expect(page.getChromeState().tabs.find((t) => t.id === id)!.error).toEqual({
      code: 'PageLoadError',
      description: 'connect ECONNREFUSED 127.0.0.1:1',
      url: 'http://127.0.0.1:1/',
    });

    handlers.pageLoadStarted![0]({
      kind: 'pageLoadStarted',
      session: { entry: { url: 'http://127.0.0.1:1/' } },
    });
    expect(page.getChromeState().tabs.find((t) => t.id === id)!.error).toBeNull();
  });

  it('bookmark add/remove round-trips through the real BookmarkService and fires onLibraryChanged', async () => {
    page = new BrowserWindowPage({ hideChromeUI: true });
    await page.mount(container);
    page.setBookmarkService(new BookmarkService());

    let changeCount = 0;
    page.onLibraryChanged(() => { changeCount++; });

    await page.addBookmarkExternal('Example', 'https://example.com/');
    expect(changeCount).toBeGreaterThan(0);

    const list = await page.listBookmarksExternal();
    expect(list.some((b) => b.url === 'https://example.com/' && b.title === 'Example')).toBe(true);

    expect(await page.isBookmarkedExternal('https://example.com/')).toBe(true);

    const id = list.find((b) => b.url === 'https://example.com/')!.id;
    await page.removeBookmarkExternal(id);
    expect(await page.isBookmarkedExternal('https://example.com/')).toBe(false);
  });

  it('history query/delete round-trips through the real HistoryService and fires onLibraryChanged', async () => {
    page = new BrowserWindowPage({ hideChromeUI: true });
    await page.mount(container);
    const historyService = new HistoryService();
    page.setHistoryService(historyService);

    let changeCount = 0;
    page.onLibraryChanged(() => { changeCount++; });

    await historyService.addVisit('https://example.com/', 'Example');
    expect(changeCount).toBeGreaterThan(0);

    const list = await page.listHistoryExternal();
    expect(list.some((h) => h.url === 'https://example.com/')).toBe(true);

    await page.clearHistoryExternal();
    expect(await page.listHistoryExternal()).toHaveLength(0);
  });

  it('setIncognitoExternal() toggles the incognito session and reflects in getChromeState()', async () => {
    page = new BrowserWindowPage({ hideChromeUI: true });
    await page.mount(container);
    expect(page.isIncognito()).toBe(false);
    expect(page.getChromeState().incognito).toBe(false);

    page.setIncognitoExternal(true);
    expect(page.isIncognito()).toBe(true);
    expect(page.getChromeState().incognito).toBe(true);

    page.setIncognitoExternal(false);
    expect(page.isIncognito()).toBe(false);
    expect(page.getChromeState().incognito).toBe(false);
  });

  it('resolveContextTarget() returns link URL/text from a layout hit-test', async () => {
    page = new BrowserWindowPage({ hideChromeUI: true });
    await page.mount(container);

    const anchor = {
      domId: 'a1',
      nodeType: 'element',
      tagName: 'A',
      attributes: new Map([['href', 'https://example.com/about']]),
      parent: null,
      children: [
        { domId: 't1', nodeType: 'text', text: 'About us', parent: null, children: [] },
      ],
    } as unknown as DomElement;

    const fakeEngine = {
      getPageLayoutEngine: () => ({
        getElementAtPoint: () => anchor,
      }),
    } as unknown as Parameters<typeof page.setBrowserEngine>[0];

    page.setBrowserEngine(fakeEngine);
    const target = page.resolveContextTarget(100, 100);
    expect(target).not.toBeNull();
    expect(target!.linkUrl).toBe('https://example.com/about');
    expect(target!.linkText).toBe('About us');
    expect(target!.imageUrl).toBeNull();
  });

  it('resolveContextTarget() returns image URL when the hit element is an img inside a link', async () => {
    page = new BrowserWindowPage({ hideChromeUI: true });
    await page.mount(container);

    const img = {
      domId: 'i1',
      nodeType: 'element',
      tagName: 'IMG',
      attributes: new Map([['src', 'https://cdn.example.com/pic.png'], ['alt', 'A picture']]),
      parent: {
        domId: 'a1',
        nodeType: 'element',
        tagName: 'A',
        attributes: new Map([['href', 'https://example.com/gallery']]),
        parent: null,
        children: [],
      },
      children: [],
    } as unknown as DomElement;

    const fakeEngine = {
      getPageLayoutEngine: () => ({
        getElementAtPoint: () => img,
      }),
    } as unknown as Parameters<typeof page.setBrowserEngine>[0];
    page.setBrowserEngine(fakeEngine);

    const target = page.resolveContextTarget(50, 50);
    expect(target!.linkUrl).toBe('https://example.com/gallery');
    expect(target!.imageUrl).toBe('https://cdn.example.com/pic.png');
    expect(target!.imageAlt).toBe('A picture');
  });

  it('resolveContextTarget() returns null when nothing is hit and when hit has no link/image', async () => {
    page = new BrowserWindowPage({ hideChromeUI: true });
    await page.mount(container);

    const fakeEngine = {
      getPageLayoutEngine: () => ({
        getElementAtPoint: () => null,
      }),
    } as unknown as Parameters<typeof page.setBrowserEngine>[0];
    page.setBrowserEngine(fakeEngine);
    expect(page.resolveContextTarget(10, 10)).toBeNull();

    const plain = {
      domId: 'd1',
      nodeType: 'element',
      tagName: 'DIV',
      attributes: new Map(),
      parent: null,
      children: [],
    } as unknown as DomElement;
    void plain;
    page.setBrowserEngine({
      getPageLayoutEngine: () => ({ getElementAtPoint: () => plain }),
    } as unknown as Parameters<typeof page.setBrowserEngine>[0]);
    expect(page.resolveContextTarget(10, 10)).toBeNull();
  });
});

describe('android-native-bridge', () => {
  afterEach(() => {
    delete (window as any).NovaStateBridge;
    delete (window as any).novaNative;
  });

  const emptySnapshot: { tabs: unknown[]; activeTabId: string | null; addressValue: string; canGoBack: boolean; canGoForward: boolean; incognito: boolean } =
    { tabs: [], activeTabId: null, addressValue: '', canGoBack: false, canGoForward: false, incognito: false };

  function makeFakePage(overrides: Record<string, unknown> = {}) {
    return {
      navigate: async (_url: string) => {},
      goBack: () => {},
      goForward: () => {},
      reload: () => {},
      stop: () => {},
      createTab: (_url?: string) => 'tab-1',
      closeTab: (_id: string) => true,
      activateTabExternal: (_id: string) => true,
      getChromeState: () => emptySnapshot,
      onChromeState: (_h: unknown) => {},
      onLibraryChanged: (_h: unknown) => {},
      listBookmarksExternal: async () => [],
      addBookmarkExternal: async (_title: string, _url: string) => {},
      removeBookmarkExternal: async (_id: string) => {},
      isBookmarkedExternal: async (_url: string) => false,
      listHistoryExternal: async (_max?: number) => [],
      removeHistoryEntryExternal: async (_id: string) => {},
      clearHistoryExternal: async () => {},
      setIncognitoExternal: (_enabled: boolean) => {},
      isIncognito: () => false,
      resolveContextTarget: (_x: number, _y: number) => null,
      ...overrides,
    } as unknown as IBrowserWindowPage;
  }

  it('isNativeHostPresent() is false with no NovaStateBridge', () => {
    expect(isNativeHostPresent()).toBe(false);
  });

  it('isNativeHostPresent() is true once NovaStateBridge is registered', () => {
    (window as any).NovaStateBridge = { onStateChanged: () => {} };
    expect(isNativeHostPresent()).toBe(true);
  });

  it('installAndroidNativeBridge() is a no-op without a native host', () => {
    const fakePage = {
      onChromeState: () => { throw new Error('should not be called'); },
    } as unknown as IBrowserWindowPage;
    expect(() => installAndroidNativeBridge(fakePage)).not.toThrow();
    expect(window.novaNative).toBeUndefined();
  });

  it('installAndroidNativeBridge() wires window.novaNative and pushes initial state', () => {
    const calls: string[] = [];
    (window as any).NovaStateBridge = {
      onStateChanged: (json: string) => calls.push(json),
      onBookmarksChanged: () => {},
      onHistoryChanged: () => {},
    };
    let stateHandler: ((s: typeof emptySnapshot) => void) | null = null;
    const fakePage = makeFakePage({
      onChromeState: (h: (s: typeof emptySnapshot) => void) => { stateHandler = h; },
    });

    installAndroidNativeBridge(fakePage);

    expect(window.novaNative).toBeDefined();
    expect(calls.length).toBe(1); // initial push
    expect(JSON.parse(calls[0])).toEqual(emptySnapshot);

    // Simulate a subsequent state change from the page.
    stateHandler!({ ...emptySnapshot, activeTabId: 'tab-2' });
    expect(calls.length).toBe(2);
    expect(JSON.parse(calls[1]).activeTabId).toBe('tab-2');
  });

  it('window.novaNative.createTab delegates to the page', () => {
    (window as any).NovaStateBridge = { onStateChanged: () => {}, onBookmarksChanged: () => {}, onHistoryChanged: () => {} };
    let created: string | undefined;
    const fakePage = makeFakePage({
      createTab: (url?: string) => { created = url; return 'new-id'; },
    });

    installAndroidNativeBridge(fakePage);
    const id = window.novaNative!.createTab('https://example.com/');
    expect(id).toBe('new-id');
    expect(created).toBe('https://example.com/');
  });

  it('pushes bookmarks and history on install, and again whenever onLibraryChanged fires', async () => {
    const bookmarkCalls: string[] = [];
    const historyCalls: string[] = [];
    (window as any).NovaStateBridge = {
      onStateChanged: () => {},
      onBookmarksChanged: (json: string) => bookmarkCalls.push(json),
      onHistoryChanged: (json: string) => historyCalls.push(json),
    };
    let libraryHandler: (() => void) | null = null;
    const bookmarks = [{ id: 'b1', title: 'Example', url: 'https://example.com/' }];
    const history = [{ id: 'h1', title: 'Example', url: 'https://example.com/', visitedAt: 123 }];
    const fakePage = makeFakePage({
      onLibraryChanged: (h: () => void) => { libraryHandler = h; },
      listBookmarksExternal: async () => bookmarks,
      listHistoryExternal: async () => history,
    });

    installAndroidNativeBridge(fakePage);
    await Promise.resolve(); // let the initial pushBookmarks()/pushHistory() microtasks settle
    await Promise.resolve();

    expect(bookmarkCalls.length).toBe(1);
    expect(JSON.parse(bookmarkCalls[0])).toEqual(bookmarks);
    expect(historyCalls.length).toBe(1);
    expect(JSON.parse(historyCalls[0])).toEqual(history);

    libraryHandler!();
    await Promise.resolve();
    await Promise.resolve();

    expect(bookmarkCalls.length).toBe(2);
    expect(historyCalls.length).toBe(2);
  });

  it('window.novaNative.addBookmark delegates to the page', async () => {
    (window as any).NovaStateBridge = { onStateChanged: () => {}, onBookmarksChanged: () => {}, onHistoryChanged: () => {} };
    let addedTitle: string | undefined;
    let addedUrl: string | undefined;
    const fakePage = makeFakePage({
      addBookmarkExternal: async (title: string, url: string) => { addedTitle = title; addedUrl = url; },
    });
    installAndroidNativeBridge(fakePage);
    window.novaNative!.addBookmark('Example', 'https://example.com/');
    await Promise.resolve();
    expect(addedTitle).toBe('Example');
    expect(addedUrl).toBe('https://example.com/');
  });

  it('window.novaNative.clearHistory delegates to the page', async () => {
    (window as any).NovaStateBridge = { onStateChanged: () => {}, onBookmarksChanged: () => {}, onHistoryChanged: () => {} };
    let cleared = false;
    const fakePage = makeFakePage({
      clearHistoryExternal: async () => { cleared = true; },
    });
    installAndroidNativeBridge(fakePage);
    window.novaNative!.clearHistory();
    await Promise.resolve();
    expect(cleared).toBe(true);
  });

  it('window.novaNative.download forwards a download request to the native host', async () => {
    const downloadCalls: string[] = [];
    (window as any).NovaStateBridge = {
      onStateChanged: () => {},
      onBookmarksChanged: () => {},
      onHistoryChanged: () => {},
      onDownloadRequested: (json: string) => downloadCalls.push(json),
    };
    installAndroidNativeBridge(makeFakePage());

    window.novaNative!.download('https://example.com/file.pdf', JSON.stringify({ filename: 'file.pdf', mimeType: 'application/pdf' }));
    expect(downloadCalls.length).toBe(1);
    expect(JSON.parse(downloadCalls[0])).toEqual({
      url: 'https://example.com/file.pdf',
      filename: 'file.pdf',
      mimeType: 'application/pdf',
      referrer: null,
    });
  });

  it('window.novaNative.download tolerates a missing/invalid options JSON', () => {
    const downloadCalls: string[] = [];
    (window as any).NovaStateBridge = {
      onStateChanged: () => {},
      onBookmarksChanged: () => {},
      onHistoryChanged: () => {},
      onDownloadRequested: (json: string) => downloadCalls.push(json),
    };
    installAndroidNativeBridge(makeFakePage());

    window.novaNative!.download('https://example.com/data.zip');
    window.novaNative!.download('https://example.com/data2.zip', 'not-json{');
    expect(downloadCalls.length).toBe(2);
    expect(JSON.parse(downloadCalls[0])).toEqual({
      url: 'https://example.com/data.zip',
      filename: null,
      mimeType: null,
      referrer: null,
    });
    expect(JSON.parse(downloadCalls[1]).url).toBe('https://example.com/data2.zip');
  });

  it('window.novaNative.setIncognito delegates to the page and reflects in isIncognito', () => {
    (window as any).NovaStateBridge = { onStateChanged: () => {}, onBookmarksChanged: () => {}, onHistoryChanged: () => {} };
    const calls: boolean[] = [];
    const fakePage = makeFakePage({
      setIncognitoExternal: (enabled: boolean) => { calls.push(enabled); },
      isIncognito: () => true,
    });

    installAndroidNativeBridge(fakePage);
    window.novaNative!.setIncognito(true);
    window.novaNative!.setIncognito(false);
    expect(calls).toEqual([true, false]);
  });

  it('window.novaNative.openInNewTab delegates to the page createTab', () => {
    (window as any).NovaStateBridge = { onStateChanged: () => {}, onBookmarksChanged: () => {}, onHistoryChanged: () => {} };
    let createdUrl: string | undefined;
    const fakePage = makeFakePage({
      createTab: (url?: string) => { createdUrl = url; return 'new-tab'; },
    });

    installAndroidNativeBridge(fakePage);
    window.novaNative!.openInNewTab('https://example.com/new');
    expect(createdUrl).toBe('https://example.com/new');
  });

  it('contextmenu event on the document pushes onContextMenuRequested with the resolved target', () => {
    const menuCalls: string[] = [];
    (window as any).NovaStateBridge = {
      onStateChanged: () => {},
      onBookmarksChanged: () => {},
      onHistoryChanged: () => {},
      onContextMenuRequested: (json: string) => menuCalls.push(json),
    };
    const fakePage = makeFakePage({
      getChromeState: () => ({
        tabs: [{ id: 't1', url: 'https://example.com/', title: 'Example', active: true, pinned: false, loading: false }],
        activeTabId: 't1',
        addressValue: 'https://example.com/',
        canGoBack: false,
        canGoForward: false,
        incognito: false,
      }),
      resolveContextTarget: (_x: number, _y: number) => ({
        linkUrl: 'https://example.com/about',
        linkText: 'About us',
        imageUrl: null,
        imageAlt: null,
      }),
    });

    installAndroidNativeBridge(fakePage);
    document.dispatchEvent(new MouseEvent('contextmenu', {
      bubbles: true, cancelable: true, clientX: 120, clientY: 240,
    }));

    expect(menuCalls.length).toBe(1);
    expect(JSON.parse(menuCalls[0])).toEqual({
      x: 120,
      y: 240,
      pageUrl: 'https://example.com/',
      pageTitle: 'Example',
      linkUrl: 'https://example.com/about',
      linkText: 'About us',
      imageUrl: null,
      imageAlt: null,
    });
  });

  it('contextmenu on the document is prevented so no native WebView menu appears', () => {
    (window as any).NovaStateBridge = {
      onStateChanged: () => {},
      onBookmarksChanged: () => {},
      onHistoryChanged: () => {},
      onContextMenuRequested: () => {},
    };
    installAndroidNativeBridge(makeFakePage());

    const event = new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 10, clientY: 10 });
    document.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
  });

  it('contextmenu push is robust when the page has no layout engine (null target)', () => {
    const menuCalls: string[] = [];
    (window as any).NovaStateBridge = {
      onStateChanged: () => {},
      onBookmarksChanged: () => {},
      onHistoryChanged: () => {},
      onContextMenuRequested: (json: string) => menuCalls.push(json),
    };
    installAndroidNativeBridge(makeFakePage()); // resolveContextTarget -> null

    document.dispatchEvent(new MouseEvent('contextmenu', {
      bubbles: true, cancelable: true, clientX: 5, clientY: 5,
    }));
    expect(menuCalls.length).toBe(1);
    const payload = JSON.parse(menuCalls[0]);
    expect(payload.linkUrl).toBeNull();
    expect(payload.imageUrl).toBeNull();
  });
});
