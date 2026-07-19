import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NavigationBridge, NavigationBridgeEventBus, DEFAULT_BRIDGE_CONFIG } from '../src/ui/components/navigation-bridge';
import { NavigationController, NavigationState, NavigationType } from '../src/browser/navigation/navigation-controller';
import { UrlParser } from '../src/browser/navigation/url-parser';
import { TabManager } from '../src/browser/tabs/tab-manager';
import { AddressBar } from '../src/ui/components/address-bar/address-bar';
import { Toolbar } from '../src/ui/components/toolbar/toolbar';

function createHarness() {
  const parser = new UrlParser();
  const nav = new NavigationController(parser);
  const tabs = new TabManager();
  const addressBar = new AddressBar();
  const toolbar = new Toolbar();
  // Create a default tab so activeTab is never null during navigation.
  const defaultTab = tabs.createTab('about:blank');
  tabs.activateTab(defaultTab.id);
  const bridge = new NavigationBridge(nav, tabs, addressBar, toolbar);
  return { parser, nav, tabs, addressBar, toolbar, bridge };
}

describe('NavigationBridge', () => {
  it('should start with empty state', () => {
    const { bridge } = createHarness();
    expect(bridge.currentUrl).toBe('');
    expect(bridge.isLoading).toBe(false);
    expect(bridge.canGoBack).toBe(false);
    expect(bridge.canGoForward).toBe(false);
  });

  it('navigate should update address bar and toolbar state', async () => {
    const { bridge, addressBar, toolbar } = createHarness();
    await bridge.navigate('https://example.com');

    expect(bridge.currentUrl).toBe('https://example.com/');
    expect(addressBar.state.value).toBe('https://example.com/');
    expect(toolbar.state.canGoBack).toBe(false);
  });

  it('navigate should create a tab entry', async () => {
    const { bridge, tabs } = createHarness();
    await bridge.navigate('https://example.com');

    const tab = tabs.activeTab;
    expect(tab).not.toBeNull();
    expect(tab!.url).toBe('https://example.com/');
  });

  it('second navigate should enable canGoBack', async () => {
    const { bridge, toolbar } = createHarness();
    await bridge.navigate('https://example.com/first');
    await bridge.navigate('https://example.com/second');

    expect(toolbar.state.canGoBack).toBe(true);
    expect(toolbar.state.canGoForward).toBe(false);
  });

  it('goBack should navigate to previous entry', async () => {
    const { bridge, addressBar, toolbar } = createHarness();
    await bridge.navigate('https://example.com/first');
    await bridge.navigate('https://example.com/second');

    bridge.goBack();

    expect(bridge.currentUrl).toBe('https://example.com/first');
    expect(addressBar.state.value).toBe('https://example.com/first');
    expect(toolbar.state.canGoBack).toBe(false);
    expect(toolbar.state.canGoForward).toBe(true);
  });

  it('goForward should navigate to next entry', async () => {
    const { bridge, addressBar, toolbar } = createHarness();
    await bridge.navigate('https://example.com/first');
    await bridge.navigate('https://example.com/second');
    bridge.goBack();

    bridge.goForward();

    expect(bridge.currentUrl).toBe('https://example.com/second');
    expect(addressBar.state.value).toBe('https://example.com/second');
    expect(toolbar.state.canGoForward).toBe(false);
  });

  it('goBack should be a no-op when at start', async () => {
    const { bridge, addressBar } = createHarness();
    await bridge.navigate('https://example.com');
    const urlBefore = bridge.currentUrl;

    bridge.goBack();

    expect(bridge.currentUrl).toBe(urlBefore);
  });

  it('goForward should be a no-op when at end', async () => {
    const { bridge } = createHarness();
    await bridge.navigate('https://example.com');

    bridge.goForward();

    expect(bridge.canGoForward).toBe(false);
  });

  it('search query should navigate to search engine URL', async () => {
    const { bridge, tabs } = createHarness();
    await bridge.navigate('hello world');

    const tab = tabs.activeTab;
    expect(tab).not.toBeNull();
    expect(tab!.url).toContain('duckduckgo.com');
    expect(tab!.url).toContain('hello%20world');
  });

  it('search should emit searchSubmitted event', async () => {
    const { bridge } = createHarness();
    const handler = vi.fn();
    bridge.on('searchSubmitted', handler);

    await bridge.navigate('test query');

    expect(handler).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'searchSubmitted', query: 'test query' }),
    );
  });

  it('navigate should emit urlNavigated event', async () => {
    const { bridge } = createHarness();
    const handler = vi.fn();
    bridge.on('urlNavigated', handler);

    await bridge.navigate('https://example.com');

    expect(handler).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'urlNavigated', url: 'https://example.com/' }),
    );
  });

  it('navigate should emit navigationFailed for blocked protocols', async () => {
    const { bridge } = createHarness();
    const handler = vi.fn();
    bridge.on('navigationFailed', handler);

    await bridge.navigate('javascript:alert(1)');

    expect(handler).toHaveBeenCalled();
  });

  it('address bar input should trigger navigation', async () => {
    const { bridge, addressBar } = createHarness();
    const handler = vi.fn();
    bridge.on('urlNavigated', handler);

    addressBar.setValue('https://example.com');

    // Wait for async navigation.
    await new Promise(r => setTimeout(r, 50));
    expect(handler).toHaveBeenCalled();
  });

  it('toolbar back button should trigger goBack', async () => {
    const { bridge, toolbar } = createHarness();
    await bridge.navigate('https://example.com/first');
    await bridge.navigate('https://example.com/second');

    toolbar.goBack();

    expect(bridge.currentUrl).toBe('https://example.com/first');
  });

  it('toolbar forward button should trigger goForward', async () => {
    const { bridge, toolbar } = createHarness();
    await bridge.navigate('https://example.com/first');
    await bridge.navigate('https://example.com/second');
    bridge.goBack();

    toolbar.goForward();

    expect(bridge.currentUrl).toBe('https://example.com/second');
  });

  it('syncFromActiveTab should update UI from tab state', async () => {
    const { bridge, tabs, addressBar, toolbar } = createHarness();
    const tab = tabs.createTab('https://other.com');
    tabs.activateTab(tab.id);

    bridge.syncFromActiveTab();

    expect(addressBar.state.value).toBe('https://other.com');
  });

  it('should update secure state for HTTPS URLs', async () => {
    const { bridge, addressBar } = createHarness();
    await bridge.navigate('https://example.com');

    expect(addressBar.state.secure).toBe(true);
  });

  it('should update secure state for HTTP URLs', async () => {
    const { bridge, addressBar } = createHarness();
    await bridge.navigate('http://insecure.com');

    expect(addressBar.state.secure).toBe(false);
  });

  it('dispose should clean up', async () => {
    const { bridge } = createHarness();
    await bridge.navigate('https://example.com');

    bridge.dispose();

    const handler = vi.fn();
    bridge.on('urlNavigated', handler);
    // Should not throw after dispose.
    expect(() => bridge.on('urlNavigated', handler)).not.toThrow();
  });
});

describe('NavigationBridgeEventBus', () => {
  it('should emit to registered handlers', () => {
    const bus = new NavigationBridgeEventBus();
    const handler = vi.fn();
    bus.on('urlNavigated', handler);
    bus.emit({ kind: 'urlNavigated', url: 'https://example.com' });
    expect(handler).toHaveBeenCalledWith({ kind: 'urlNavigated', url: 'https://example.com' });
  });

  it('should not call handlers for other event types', () => {
    const bus = new NavigationBridgeEventBus();
    const handler = vi.fn();
    bus.on('searchSubmitted', handler);
    bus.emit({ kind: 'urlNavigated', url: 'https://example.com' });
    expect(handler).not.toHaveBeenCalled();
  });

  it('off should remove a handler', () => {
    const bus = new NavigationBridgeEventBus();
    const handler = vi.fn();
    bus.on('navigationStarted', handler);
    bus.off('navigationStarted', handler);
    bus.emit({ kind: 'navigationStarted', url: 'https://example.com' });
    expect(handler).not.toHaveBeenCalled();
  });

  it('should not throw when emitting with no handlers', () => {
    const bus = new NavigationBridgeEventBus();
    expect(() => bus.emit({ kind: 'urlNavigated', url: 'https://example.com' })).not.toThrow();
  });

  it('dispose should clear all channels', () => {
    const bus = new NavigationBridgeEventBus();
    const handler = vi.fn();
    bus.on('navigationCompleted', handler);
    bus.dispose();
    bus.emit({ kind: 'navigationCompleted', url: 'https://example.com', elapsedMs: 0 });
    expect(handler).not.toHaveBeenCalled();
  });

  it('handler exceptions should not break other handlers', () => {
    const bus = new NavigationBridgeEventBus();
    const badHandler = vi.fn(() => { throw new Error('handler error'); });
    const goodHandler = vi.fn();
    bus.on('urlNavigated', badHandler);
    bus.on('urlNavigated', goodHandler);

    bus.emit({ kind: 'urlNavigated', url: 'https://example.com' });

    expect(badHandler).toHaveBeenCalled();
    expect(goodHandler).toHaveBeenCalled();
  });
});

describe('NavigationBridge config', () => {
  it('should use custom search engine URL', async () => {
    const parser = new UrlParser();
    const nav = new NavigationController(parser);
    const tabs = new TabManager();
    const defaultTab = tabs.createTab('about:blank');
    tabs.activateTab(defaultTab.id);
    const addressBar = new AddressBar();
    const toolbar = new Toolbar();
    const bridge = new NavigationBridge(nav, tabs, addressBar, toolbar, null, {
      searchEngineUrl: 'https://google.com/search?q=%s',
    });

    await bridge.navigate('test query');

    const tab = tabs.activeTab;
    expect(tab!.url).toContain('google.com');
    expect(tab!.url).toContain('test%20query');
  });

  it('should handle missing status bar gracefully', async () => {
    const parser = new UrlParser();
    const nav = new NavigationController(parser);
    const tabs = new TabManager();
    const defaultTab = tabs.createTab('about:blank');
    tabs.activateTab(defaultTab.id);
    const addressBar = new AddressBar();
    const toolbar = new Toolbar();
    const bridge = new NavigationBridge(nav, tabs, addressBar, toolbar, null);

    await expect(bridge.navigate('https://example.com')).resolves.not.toThrow();
  });
});

describe('NavigationBridge + TabManager integration', () => {
  it('should switch navigation context on tab activation', async () => {
    const { bridge, tabs, addressBar } = createHarness();
    await bridge.navigate('https://tab1.com');

    const tab2 = tabs.createTab('https://tab2.com');
    tabs.activateTab(tab2.id);

    expect(addressBar.state.value).toBe('https://tab2.com');
  });

  it('should maintain separate history per tab', async () => {
    const { bridge, tabs, addressBar } = createHarness();
    await bridge.navigate('https://tab1.com/first');
    await bridge.navigate('https://tab1.com/second');

    const tab2 = tabs.createTab();
    tabs.activateTab(tab2.id);
    await bridge.navigate('https://tab2.com/only');

    // Switch back to tab1 — syncFromActiveTab restores tab1's url.
    tabs.activateTab(tabs.tabs[0]!.id);

    expect(bridge.currentUrl).toBe('https://tab1.com/second');
    expect(addressBar.state.value).toBe('https://tab1.com/second');

    // Tab2 should still have its own URL.
    expect(tab2.url).toBe('https://tab2.com/only');
  });
});
