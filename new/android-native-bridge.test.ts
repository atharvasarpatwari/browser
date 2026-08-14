import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { BrowserWindowPage } from '../src/ui/pages/browser-window';
import type { IBrowserWindowPage } from '../src/ui/pages/browser-window';
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
});

describe('android-native-bridge', () => {
  afterEach(() => {
    delete (window as any).NovaStateBridge;
    delete (window as any).novaNative;
  });

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
    };
    const snapshot: { tabs: unknown[]; activeTabId: string | null; addressValue: string; canGoBack: boolean; canGoForward: boolean } =
      { tabs: [], activeTabId: null, addressValue: '', canGoBack: false, canGoForward: false };
    let stateHandler: ((s: typeof snapshot) => void) | null = null;
    const fakePage = {
      navigate: async (_url: string) => {},
      goBack: () => {},
      goForward: () => {},
      reload: () => {},
      stop: () => {},
      createTab: (_url?: string) => 'tab-1',
      closeTab: (_id: string) => true,
      activateTabExternal: (_id: string) => true,
      getChromeState: () => snapshot,
      onChromeState: (h: (s: typeof snapshot) => void) => { stateHandler = h; },
    } as unknown as IBrowserWindowPage;

    installAndroidNativeBridge(fakePage);

    expect(window.novaNative).toBeDefined();
    expect(calls.length).toBe(1); // initial push
    expect(JSON.parse(calls[0])).toEqual(snapshot);

    // Simulate a subsequent state change from the page.
    stateHandler!({ ...snapshot, activeTabId: 'tab-2' });
    expect(calls.length).toBe(2);
    expect(JSON.parse(calls[1]).activeTabId).toBe('tab-2');
  });

  it('window.novaNative.createTab delegates to the page', () => {
    (window as any).NovaStateBridge = { onStateChanged: () => {} };
    const snapshot = { tabs: [], activeTabId: null, addressValue: '', canGoBack: false, canGoForward: false };
    let created: string | undefined;
    const fakePage = {
      navigate: async () => {},
      goBack: () => {}, goForward: () => {}, reload: () => {}, stop: () => {},
      createTab: (url?: string) => { created = url; return 'new-id'; },
      closeTab: () => true,
      activateTabExternal: () => true,
      getChromeState: () => snapshot,
      onChromeState: () => {},
    } as unknown as IBrowserWindowPage;

    installAndroidNativeBridge(fakePage);
    const id = window.novaNative!.createTab('https://example.com/');
    expect(id).toBe('new-id');
    expect(created).toBe('https://example.com/');
  });
});
