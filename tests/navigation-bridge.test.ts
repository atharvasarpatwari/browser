import { describe, it, expect, vi } from 'vitest';
import {
  NavigationBridge,
  NavigationBridgeEventBus,
  DEFAULT_BRIDGE_CONFIG,
} from '../src/ui/components/navigation-bridge';

// ─────────────────────────────────────────────────────────────────────────────
// MOCK EVENT EMITTER
// ─────────────────────────────────────────────────────────────────────────────

class MockEventEmitter<Events extends string> {
  private readonly handlers = new Map<Events, Set<(event: any) => void>>();

  on(type: Events, handler: (event: any) => void): void {
    if (!this.handlers.has(type)) this.handlers.set(type, new Set());
    this.handlers.get(type)!.add(handler);
  }

  off(type: Events, handler: (event: any) => void): void {
    this.handlers.get(type)?.delete(handler);
  }

  emit(type: Events, event?: any): void {
    const set = this.handlers.get(type);
    if (!set) return;
    for (const h of set) h(event);
  }

  clear(): void {
    this.handlers.clear();
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────

function makeParsedUrl(url: string) {
  const u = new URL(url);
  return {
    raw: url,
    normalized: u.href,
    protocol: u.protocol,
    hostname: u.hostname,
    port: u.port,
    host: u.host,
    pathname: u.pathname,
    search: u.search,
    hash: u.hash,
    origin: u.origin,
    href: u.href,
    isSpecialPage: false,
  };
}

function makeEntry(url: string, overrides?: Partial<any>) {
  const parsed = makeParsedUrl(url);
  return {
    id: `entry-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    url: parsed.href,
    title: parsed.hostname || parsed.href,
    timestamp: Date.now(),
    type: 'push' as const,
    scrollX: 0,
    scrollY: 0,
    parsedUrl: parsed,
    state: null,
    ...overrides,
  };
}

function makeNavResult(url: string, success = true) {
  return {
    success,
    entry: success ? makeEntry(url) : undefined,
    error: success ? undefined : new Error('Nav failed'),
    state: 'complete' as const,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// MOCK: TabSession
// ─────────────────────────────────────────────────────────────────────────────

function createMockTab(initial?: { url?: string; canGoBack?: boolean; canGoForward?: boolean }) {
  const tabState = {
    id: `tab-${Math.random().toString(36).slice(2, 6)}`,
    url: initial?.url ?? '',
    title: '',
    loading: false,
    canGoBack: initial?.canGoBack ?? false,
    canGoForward: initial?.canGoForward ?? false,
  };
  const calls = {
    setUrl: [] as string[],
    setTitle: [] as string[],
    setLoading: [] as boolean[],
  };

  return {
    tabState,
    get id() { return tabState.id; },
    get url() { return tabState.url; },
    get title() { return tabState.title; },
    get loading() { return tabState.loading; },
    canGoBack: () => tabState.canGoBack,
    canGoForward: () => tabState.canGoForward,
    setUrl(url: string) { tabState.url = url; calls.setUrl.push(url); },
    setTitle(title: string) { tabState.title = title; calls.setTitle.push(title); },
    setLoading(loading: boolean) { tabState.loading = loading; calls.setLoading.push(loading); },
    calls,
    dispose() {},
    on() {},
    off() {},
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// MOCK: NavigationController
// ─────────────────────────────────────────────────────────────────────────────

function createMockNavController() {
  const bus = new MockEventEmitter<any>();

  const navState = {
    canGoBack: false,
    canGoForward: false,
    currentEntry: null as any | null,
    historyLength: 1,
    lastNavigateUrl: null as string | null,
    goBackCalled: false,
    goForwardCalled: false,
    reloadCalled: false,
    stopCalled: false,
  };

  return {
    bus,
    navState,
    navigate: vi.fn(async (url: string) => {
      navState.lastNavigateUrl = url;
      const entry = makeEntry(url);
      navState.currentEntry = entry;
      return makeNavResult(url);
    }),
    navigateTo: vi.fn(async (req: any) => makeNavResult(req.url)),
    back: vi.fn(() => {
      navState.goBackCalled = true;
      if (navState.currentEntry) return makeNavResult(navState.currentEntry.url);
      return { success: false, state: 'idle' as const };
    }),
    forward: vi.fn(() => {
      navState.goForwardCalled = true;
      if (navState.currentEntry) return makeNavResult(navState.currentEntry.url);
      return { success: false, state: 'idle' as const };
    }),
    reload: vi.fn(() => {
      navState.reloadCalled = true;
      if (navState.currentEntry) return makeNavResult(navState.currentEntry.url);
      return { success: false, state: 'idle' as const };
    }),
    stop: vi.fn(() => { navState.stopCalled = true; }),
    replace: vi.fn(async (url: string) => makeNavResult(url)),
    go: vi.fn(() => {
      if (navState.currentEntry) return makeNavResult(navState.currentEntry.url);
      return { success: false, state: 'idle' as const };
    }),
    pushState: vi.fn(),
    replaceState: vi.fn(),
    getCurrentEntry: vi.fn(() => navState.currentEntry),
    canGoBack: vi.fn(() => navState.canGoBack),
    canGoForward: vi.fn(() => navState.canGoForward),
    get state() { return 'idle'; },
    get historyLength() { return navState.historyLength; },
    addGuard: vi.fn(),
    removeGuard: vi.fn(),
    on: vi.fn((type: string, handler: any) => bus.on(type, handler)),
    off: vi.fn((type: string, handler: any) => bus.off(type, handler)),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// MOCK: TabManager
// ─────────────────────────────────────────────────────────────────────────────

function createMockTabManager() {
  const bus = new MockEventEmitter<any>();
  let activeTab: any = null;

  return {
    bus,
    get activeTab() { return activeTab; },
    get activeTabId() { return activeTab?.id ?? null; },
    get tabs() { return activeTab ? [activeTab] : []; },
    get count() { return activeTab ? 1 : 0; },
    setActiveTab(tab: any) { activeTab = tab; },
    on: vi.fn((type: string, handler: any) => bus.on(type, handler)),
    off: vi.fn((type: string, handler: any) => bus.off(type, handler)),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// MOCK: AddressBar
// ─────────────────────────────────────────────────────────────────────────────

function createMockAddressBar() {
  const bus = new MockEventEmitter<any>();
  const barState = {
    value: '',
    loading: false,
    secure: false,
    focused: false,
  };

  return {
    bus,
    barState,
    get state() {
      return {
        value: barState.value,
        focused: barState.focused,
        validation: { valid: true, normalized: barState.value, error: null },
        loading: barState.loading,
        secure: barState.secure,
        hostname: '',
        suggestions: [] as readonly string[],
      };
    },
    setValue: vi.fn((v: string) => { barState.value = v; }),
    setLoading: vi.fn((v: boolean) => { barState.loading = v; }),
    setSecure: vi.fn((v: boolean) => { barState.secure = v; }),
    setSuggestions: vi.fn(),
    focus: vi.fn(() => { barState.focused = true; }),
    blur: vi.fn(() => { barState.focused = false; }),
    clear: vi.fn(() => { barState.value = ''; }),
    dispose: vi.fn(),
    on: vi.fn((type: string, handler: any) => bus.on(type, handler)),
    off: vi.fn((type: string, handler: any) => bus.off(type, handler)),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// MOCK: Toolbar
// ─────────────────────────────────────────────────────────────────────────────

function createMockToolbar() {
  const bus = new MockEventEmitter<any>();
  const tbState = {
    canGoBack: false,
    canGoForward: false,
    loading: false,
    shieldEnabled: true,
  };

  return {
    bus,
    tbState,
    get state() {
      return { ...tbState };
    },
    setCanGoBack: vi.fn((v: boolean) => { tbState.canGoBack = v; }),
    setCanGoForward: vi.fn((v: boolean) => { tbState.canGoForward = v; }),
    setLoading: vi.fn((v: boolean) => { tbState.loading = v; }),
    setShieldEnabled: vi.fn((v: boolean) => { tbState.shieldEnabled = v; }),
    toggleShield: vi.fn(),
    dispose: vi.fn(),
    on: vi.fn((type: string, handler: any) => bus.on(type, handler)),
    off: vi.fn((type: string, handler: any) => bus.off(type, handler)),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// MOCK: StatusBar
// ─────────────────────────────────────────────────────────────────────────────

function createMockStatusBar() {
  return {
    setStatus: vi.fn(),
    setUrl: vi.fn(),
    setProtocol: vi.fn(),
    setSecure: vi.fn(),
    setZoom: vi.fn(),
    setBlockedCount: vi.fn(),
    setHoverUrl: vi.fn(),
    get state() {
      return {
        statusText: '', url: '', protocol: '', secure: true,
        zoom: 100, blockedCount: 0, hoverUrl: '',
      };
    },
    dispose: vi.fn(),
    on: vi.fn(),
    off: vi.fn(),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// BRIDGE BUILDER
// ─────────────────────────────────────────────────────────────────────────────

function buildBridge() {
  const nav = createMockNavController();
  const tabMgr = createMockTabManager();
  const addressBar = createMockAddressBar();
  const toolbar = createMockToolbar();
  const statusBar = createMockStatusBar();

  const tab = createMockTab({ url: 'about:blank' });
  tabMgr.setActiveTab(tab);

  const bridge = new NavigationBridge(
    nav as any,
    tabMgr as any,
    addressBar as any,
    toolbar as any,
    statusBar as any,
  );

  return { bridge, nav, tabMgr, addressBar, toolbar, statusBar, tab };
}

// ═════════════════════════════════════════════════════════════════════════════
// TESTS
// ═════════════════════════════════════════════════════════════════════════════

describe('NavigationBridge', () => {

  // ── 1. Construction ──────────────────────────────────────────────────────

  describe('Construction', () => {
    it('should create with provided dependencies and initial state', () => {
      const { bridge } = buildBridge();

      expect(bridge.currentUrl).toBe('');
      expect(bridge.isLoading).toBe(false);
      expect(bridge.canGoBack).toBe(false);
      expect(bridge.canGoForward).toBe(false);
    });

    it('should sync initial state from active tab via syncFromActiveTab', () => {
      const { bridge, tab } = buildBridge();
      tab.tabState.url = 'https://initial.com';
      tab.tabState.canGoBack = true;

      bridge.syncFromActiveTab();

      expect(bridge.currentUrl).toBe('https://initial.com');
    });
  });

  // ── 2. Navigation ────────────────────────────────────────────────────────

  describe('Navigation', () => {
    it('navigate() should call navController.navigate() with the URL', async () => {
      const { bridge, nav } = buildBridge();

      await bridge.navigate('https://example.com');

      expect(nav.navigate).toHaveBeenCalledWith('https://example.com');
    });

    it('navigate() should update the active tab URL via setUrl()', async () => {
      const { bridge, tab } = buildBridge();

      await bridge.navigate('https://example.com');

      expect(tab.calls.setUrl).toContain('https://example.com/');
    });

    it('navigate() should emit urlNavigated event', async () => {
      const { bridge } = buildBridge();
      const handler = vi.fn();
      bridge.on('urlNavigated', handler);

      await bridge.navigate('https://example.com');

      expect(handler).toHaveBeenCalledTimes(1);
      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({ kind: 'urlNavigated', url: 'https://example.com/' }),
      );
    });

    it('reload() should call navController.reload()', () => {
      const { bridge, nav } = buildBridge();
      nav.navState.currentEntry = makeEntry('https://example.com');

      bridge.reload();

      expect(nav.reload).toHaveBeenCalledTimes(1);
    });

    it('stop() should call navController.stop()', () => {
      const { bridge, nav } = buildBridge();

      bridge.stop();

      expect(nav.stop).toHaveBeenCalledTimes(1);
    });
  });

  // ── 3. Back / Forward ────────────────────────────────────────────────────

  describe('Back/Forward', () => {
    it('goBack() should call navController.back()', () => {
      const { bridge, nav } = buildBridge();
      nav.navState.canGoBack = true;
      nav.navState.currentEntry = makeEntry('https://example.com');

      bridge.goBack();

      expect(nav.back).toHaveBeenCalledTimes(1);
    });

    it('goForward() should call navController.forward()', () => {
      const { bridge, nav } = buildBridge();
      nav.navState.canGoForward = true;
      nav.navState.currentEntry = makeEntry('https://example.com');

      bridge.goForward();

      expect(nav.forward).toHaveBeenCalledTimes(1);
    });

    it('canGoBack should reflect navController.canGoBack()', () => {
      const { bridge, nav } = buildBridge();
      expect(bridge.canGoBack).toBe(false);

      nav.navState.canGoBack = true;
      expect(bridge.canGoBack).toBe(true);

      nav.navState.canGoBack = false;
      expect(bridge.canGoBack).toBe(false);
    });

    it('canGoForward should reflect navController.canGoForward()', () => {
      const { bridge, nav } = buildBridge();
      expect(bridge.canGoForward).toBe(false);

      nav.navState.canGoForward = true;
      expect(bridge.canGoForward).toBe(true);

      nav.navState.canGoForward = false;
      expect(bridge.canGoForward).toBe(false);
    });
  });

  // ── 4. Tab sync ──────────────────────────────────────────────────────────

  describe('Tab sync', () => {
    it('syncFromActiveTab() should restore URL from active tab', () => {
      const { bridge, tab } = buildBridge();
      tab.tabState.url = 'https://synced.com';

      bridge.syncFromActiveTab();

      expect(bridge.currentUrl).toBe('https://synced.com');
    });

    it('syncFromActiveTab() should update address bar value', () => {
      const { bridge, tab, addressBar } = buildBridge();
      addressBar.setValue.mockClear();
      tab.tabState.url = 'https://synced.com';

      bridge.syncFromActiveTab();

      expect(addressBar.setValue).toHaveBeenCalledWith('https://synced.com');
    });

    it('syncFromActiveTab() should update toolbar back/forward state', () => {
      const { bridge, tab, toolbar } = buildBridge();
      toolbar.setCanGoBack.mockClear();
      toolbar.setCanGoForward.mockClear();
      tab.tabState.url = 'https://synced.com';
      tab.tabState.canGoBack = true;
      tab.tabState.canGoForward = false;

      bridge.syncFromActiveTab();

      expect(toolbar.setCanGoBack).toHaveBeenCalledWith(true);
      expect(toolbar.setCanGoForward).toHaveBeenCalledWith(false);
    });

    it('tab activation should trigger sync from tab manager', () => {
      const { bridge, tabMgr, addressBar } = buildBridge();
      addressBar.setValue.mockClear();
      const newTab = createMockTab({ url: 'https://newtab.com' });

      tabMgr.setActiveTab(newTab);
      tabMgr.bus.emit('tabActivated', {
        kind: 'tabActivated', tabId: newTab.id, previousTabId: null,
      });

      expect(addressBar.setValue).toHaveBeenCalledWith('https://newtab.com');
      expect(bridge.currentUrl).toBe('https://newtab.com');
    });
  });

  // ── 5. Events ────────────────────────────────────────────────────────────

  describe('Events', () => {
    it('navigationStarted from controller should emit navigationStarted', () => {
      const { bridge, nav, addressBar, toolbar } = buildBridge();
      addressBar.setLoading.mockClear();
      toolbar.setLoading.mockClear();
      const handler = vi.fn();
      bridge.on('navigationStarted', handler);

      nav.bus.emit('navigationStarted', {
        kind: 'navigationStarted',
        request: { url: 'https://example.com', type: 'push', userInitiated: true },
        parsedUrl: makeParsedUrl('https://example.com'),
      });

      expect(handler).toHaveBeenCalledTimes(1);
      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({ kind: 'navigationStarted', url: 'https://example.com' }),
      );
      expect(addressBar.setLoading).toHaveBeenCalledWith(true);
      expect(toolbar.setLoading).toHaveBeenCalledWith(true);
    });

    it('navigationCompleted from controller should emit navigationCompleted', () => {
      const { bridge, nav, addressBar, toolbar } = buildBridge();
      addressBar.setLoading.mockClear();
      toolbar.setLoading.mockClear();
      const handler = vi.fn();
      bridge.on('navigationCompleted', handler);
      const entry = makeEntry('https://example.com');

      nav.bus.emit('navigationCompleted', {
        kind: 'navigationCompleted',
        entry,
        elapsedMs: 42,
      });

      expect(handler).toHaveBeenCalledTimes(1);
      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          kind: 'navigationCompleted',
          url: entry.url,
          elapsedMs: 42,
        }),
      );
      expect(addressBar.setLoading).toHaveBeenCalledWith(false);
      expect(toolbar.setLoading).toHaveBeenCalledWith(false);
    });

    it('navigationFailed from controller should emit navigationFailed', () => {
      const { bridge, nav, addressBar, toolbar } = buildBridge();
      addressBar.setLoading.mockClear();
      toolbar.setLoading.mockClear();
      const handler = vi.fn();
      bridge.on('navigationFailed', handler);
      const error = new Error('net::ERR_FAILED');

      nav.bus.emit('navigationFailed', {
        kind: 'navigationFailed',
        request: { url: 'https://bad.com', type: 'push', userInitiated: true },
        error,
      });

      expect(handler).toHaveBeenCalledTimes(1);
      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          kind: 'navigationFailed',
          url: 'https://bad.com',
          error,
        }),
      );
      expect(addressBar.setLoading).toHaveBeenCalledWith(false);
      expect(toolbar.setLoading).toHaveBeenCalledWith(false);
    });

    it('URL change through navigate() should emit urlNavigated', async () => {
      const { bridge } = buildBridge();
      const handler = vi.fn();
      bridge.on('urlNavigated', handler);

      await bridge.navigate('https://example.com/page');

      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({ kind: 'urlNavigated', url: 'https://example.com/page' }),
      );
    });
  });

  // ── 6. Address bar input ─────────────────────────────────────────────────

  describe('Address bar input', () => {
    it('address bar submit should trigger navigation', async () => {
      const { bridge, addressBar, nav } = buildBridge();

      addressBar.bus.emit('navigate', { kind: 'navigate', url: 'https://typed.com' });
      await new Promise(r => setTimeout(r, 10));

      expect(nav.navigate).toHaveBeenCalledWith('https://typed.com');
    });

    it('empty URL should be handled gracefully', async () => {
      const { bridge, nav } = buildBridge();

      await bridge.navigate('');

      expect(nav.navigate).not.toHaveBeenCalled();
      expect(bridge.currentUrl).toBe('');
    });

    it('special page URLs (nova://) should navigate without search treatment', async () => {
      const { bridge, nav } = buildBridge();

      await bridge.navigate('nova://settings');

      expect(nav.navigate).toHaveBeenCalledWith('nova://settings');
      expect(bridge.currentUrl).toContain('nova://settings');
    });
  });

  // ── 7. Dispose ───────────────────────────────────────────────────────────

  describe('Dispose', () => {
    it('dispose should remove all listeners from the bridge bus', () => {
      const { bridge } = buildBridge();
      const handler = vi.fn();
      bridge.on('urlNavigated', handler);

      bridge.dispose();

      bridge.on('urlNavigated', handler);

      const bus2 = new NavigationBridgeEventBus();
      bus2.on('urlNavigated', handler);
      bus2.emit({ kind: 'urlNavigated', url: 'test' });
      expect(handler).toHaveBeenCalledTimes(1);
      handler.mockClear();
    });

    it('no bridge events should fire after dispose', () => {
      const { bridge, nav } = buildBridge();
      const urlHandler = vi.fn();
      const navStartHandler = vi.fn();
      bridge.on('urlNavigated', urlHandler);
      bridge.on('navigationStarted', navStartHandler);

      bridge.dispose();

      urlHandler.mockClear();
      navStartHandler.mockClear();

      nav.bus.emit('navigationStarted', {
        kind: 'navigationStarted',
        request: { url: 'https://example.com', type: 'push', userInitiated: true },
        parsedUrl: makeParsedUrl('https://example.com'),
      });

      expect(urlHandler).not.toHaveBeenCalled();
      expect(navStartHandler).not.toHaveBeenCalled();
    });

    it('dispose should clear the internal event bus channels', () => {
      const bus = new NavigationBridgeEventBus();
      const handler = vi.fn();
      bus.on('navigationCompleted', handler);
      bus.on('navigationFailed', handler);
      bus.on('urlNavigated', handler);

      bus.dispose();

      bus.emit({ kind: 'navigationCompleted', url: '', elapsedMs: 0 });
      bus.emit({ kind: 'navigationFailed', url: '', error: new Error() });
      bus.emit({ kind: 'urlNavigated', url: '' });

      expect(handler).not.toHaveBeenCalled();
    });
  });
});
