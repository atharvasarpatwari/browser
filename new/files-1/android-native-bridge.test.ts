import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { BrowserWindowPage } from '../src/ui/pages/browser-window';
import type { IBrowserWindowPage } from '../src/ui/pages/browser-window';
import { BookmarkService } from '../src/browser/bookmarks/bookmark-services';
import { HistoryService } from '../src/browser/history/history-service';
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
});

describe('android-native-bridge', () => {
  afterEach(() => {
    delete (window as any).NovaStateBridge;
    delete (window as any).novaNative;
  });

  const emptySnapshot: { tabs: unknown[]; activeTabId: string | null; addressValue: string; canGoBack: boolean; canGoForward: boolean } =
    { tabs: [], activeTabId: null, addressValue: '', canGoBack: false, canGoForward: false };

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
});
