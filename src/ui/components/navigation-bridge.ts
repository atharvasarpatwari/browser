/**
 * @file src/ui/components/navigation-bridge.ts
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * RESPONSIBILITY
 * ─────────────────────────────────────────────────────────────────────────────
 * Orchestrate the data flow between:
 *   • Toolbar       (back / forward / reload / stop / shield)
 *   • AddressBar    (URL input, suggestions, validation)
 *   • NavigationController (history stack, guards, state machine)
 *   • TabManager    (per-tab navigation state)
 *   • StatusBar     (protocol, security, status text)
 *
 *   ┌──────────┐   events    ┌──────────────────┐   actions    ┌──────────────────┐
 *   │ Toolbar  │────────────▶│                  │─────────────▶│ Navigation       │
 *   └──────────┘             │ NavigationBridge │              │ Controller       │
 *   ┌──────────┐   events    │                  │   state      └──────────────────┘
 *   │AddressBar│────────────▶│   (this file)    │─────────────▶┌──────────────────┐
 *   └──────────┘             │                  │              │ TabManager       │
 *                            └──────────────────┘              └──────────────────┘
 *                                  │    │
 *                                  ▼    ▼
 *                            ┌──────────────────┐
 *                            │    StatusBar      │
 *                            └──────────────────┘
 *
 * Does NOT:
 *   • Render DOM (Views' job)
 *   • Parse URLs (UrlParser's job)
 *   • Manage tab creation/removal (TabManager's job)
 * ─────────────────────────────────────────────────────────────────────────────
 */

import type { IDisposable } from '../../app/dependency-container';
import type { INavigationController, NavigationEvent } from '../../browser/navigation/navigation-controller';
import type { ITabManager } from '../../browser/tabs/tab-manager';
import type { ITabSession } from '../../browser/tabs/tab-session';
import type { IAddressBar, AddressBarEventUnion } from './address-bar/address-bar';
import type { IToolbar, ToolbarEventUnion } from './toolbar/toolbar';
import type { IStatusBar } from './status-bar/status-bar';

// ─────────────────────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────────────────────

type BridgeEventType =
  | 'urlNavigated'
  | 'searchSubmitted'
  | 'navigationStarted'
  | 'navigationCompleted'
  | 'navigationFailed'
  | 'historyChanged';

interface BridgeEvent {
  readonly kind: BridgeEventType;
}

interface UrlNavigatedEvent extends BridgeEvent {
  readonly kind: 'urlNavigated';
  readonly url: string;
}

interface SearchSubmittedEvent extends BridgeEvent {
  readonly kind: 'searchSubmitted';
  readonly query: string;
}

interface NavigationStartedEvent extends BridgeEvent {
  readonly kind: 'navigationStarted';
  readonly url: string;
}

interface NavigationCompletedEvent extends BridgeEvent {
  readonly kind: 'navigationCompleted';
  readonly url: string;
  readonly elapsedMs: number;
}

interface NavigationFailedEvent extends BridgeEvent {
  readonly kind: 'navigationFailed';
  readonly url: string;
  readonly error: Error;
}

interface HistoryChangedEvent extends BridgeEvent {
  readonly kind: 'historyChanged';
  readonly canGoBack: boolean;
  readonly canGoForward: boolean;
  readonly historyLength: number;
}

type BridgeEventUnion =
  | UrlNavigatedEvent
  | SearchSubmittedEvent
  | NavigationStartedEvent
  | NavigationCompletedEvent
  | NavigationFailedEvent
  | HistoryChangedEvent;

interface NavigationBridgeConfig {
  /** Default search engine URL. Must contain %s placeholder. */
  readonly searchEngineUrl: string;
  /** Whether to show loading state in the address bar. */
  readonly showLoadingInAddressBar: boolean;
  /** Whether to update status bar protocol/security on navigation. */
  readonly updateStatusBar: boolean;
}

const DEFAULT_BRIDGE_CONFIG: NavigationBridgeConfig = {
  searchEngineUrl: 'https://duckduckgo.com/?q=%s',
  showLoadingInAddressBar: true,
  updateStatusBar: true,
};

// ─────────────────────────────────────────────────────────────────────────────
// EVENT BUS
// ─────────────────────────────────────────────────────────────────────────────

type BridgeEventHandler = (event: BridgeEventUnion) => void;

class NavigationBridgeEventBus {
  private readonly channels = new Map<BridgeEventType, Set<BridgeEventHandler>>();

  on(type: BridgeEventType, handler: BridgeEventHandler): void {
    if (!this.channels.has(type)) this.channels.set(type, new Set());
    this.channels.get(type)!.add(handler);
  }

  off(type: BridgeEventType, handler: BridgeEventHandler): void {
    this.channels.get(type)?.delete(handler);
  }

  emit(event: BridgeEventUnion): void {
    const handlers = this.channels.get(event.kind);
    if (!handlers) return;
    for (const h of handlers) {
      try { h(event); } catch (err) {
        console.error(`[NavigationBridge] Handler threw on "${event.kind}":`, err);
      }
    }
  }

  dispose(): void { this.channels.clear(); }
}

// ─────────────────────────────────────────────────────────────────────────────
// PUBLIC CONTRACT
// ─────────────────────────────────────────────────────────────────────────────

interface INavigationBridge extends IDisposable {
  /** Current URL of the active tab. */
  readonly currentUrl: string;
  /** Whether a navigation is in progress. */
  readonly isLoading: boolean;
  /** Whether the active tab can go back. */
  readonly canGoBack: boolean;
  /** Whether the active tab can go forward. */
  readonly canGoForward: boolean;

  /** Navigate to a URL. Handles search query detection, normalization, and validation. */
  navigate(url: string): Promise<void>;
  /** Go back in history. */
  goBack(): void;
  /** Go forward in history. */
  goForward(): void;
  /** Reload the current page. */
  reload(): void;
  /** Stop the current navigation. */
  stop(): void;

  /** Sync all UI state from the current tab. Call after tab switch. */
  syncFromActiveTab(): void;

  on(type: BridgeEventType, handler: (event: BridgeEventUnion) => void): void;
  off(type: BridgeEventType, handler: (event: BridgeEventUnion) => void): void;
}

// ─────────────────────────────────────────────────────────────────────────────
// CONCRETE IMPLEMENTATION
// ─────────────────────────────────────────────────────────────────────────────

class NavigationBridge implements INavigationBridge {
  private readonly nav: INavigationController;
  private readonly tabs: ITabManager;
  private readonly addressBar: IAddressBar;
  private readonly toolbar: IToolbar;
  private readonly statusBar: IStatusBar | null;
  private readonly bus = new NavigationBridgeEventBus();
  private readonly config: NavigationBridgeConfig;

  private _currentUrl = '';
  private _isLoading = false;
  private _navigating = false;
  private _searchMode = false;
  private _searchQuery = '';

  private disposables: IDisposable[] = [];

  constructor(
    nav: INavigationController,
    tabs: ITabManager,
    addressBar: IAddressBar,
    toolbar: IToolbar,
    statusBar?: IStatusBar | null,
    config?: Partial<NavigationBridgeConfig>,
  ) {
    this.nav = nav;
    this.tabs = tabs;
    this.addressBar = addressBar;
    this.toolbar = toolbar;
    this.statusBar = statusBar ?? null;
    this.config = { ...DEFAULT_BRIDGE_CONFIG, ...config };

    this.wireToolbarEvents();
    this.wireAddressBarEvents();
    this.wireNavigationEvents();
    this.wireTabManagerEvents();
  }

  // ── Accessors ──────────────────────────────────────────────────────────────

  get currentUrl(): string { return this._currentUrl; }
  get isLoading(): boolean { return this._isLoading; }
  get canGoBack(): boolean { return this.nav.canGoBack(); }
  get canGoForward(): boolean { return this.nav.canGoForward(); }

  // ── Actions ────────────────────────────────────────────────────────────────

  async navigate(url: string): Promise<void> {
    const trimmed = url.trim();
    if (trimmed.length === 0) return;
    if (this._navigating) return; // re-entrancy guard
    this._navigating = true;

    // Search query detection: if the input is not a valid URL, treat as search.
    const isSearch = this._isSearchQuery(trimmed);

    if (isSearch) {
      this._searchMode = true;
      this._searchQuery = trimmed;
      const searchUrl = this.config.searchEngineUrl.replace('%s', encodeURIComponent(trimmed));

      // Navigate to the search URL through the controller so the engine pipeline loads it.
      const result = await this.nav.navigate(searchUrl);

      if (result.success && result.entry) {
        this.addressBar.setValue(trimmed);
        this.addressBar.setLoading(true);
        this.toolbar.setLoading(true);
        this._setLoading(true);
        this._currentUrl = result.entry.url;

        if (this.config.updateStatusBar) {
          this.statusBar?.setStatus(`Searching: ${trimmed}`);
          this.statusBar?.setUrl(result.entry.url);
          this._updateSecureState(result.entry.url);
        }

        this.bus.emit({ kind: 'searchSubmitted', query: trimmed });

        const tab = this.tabs.activeTab;
        if (tab) {
          tab.setUrl(result.entry.url);
          tab.setTitle(`${trimmed} - Search`);
          tab.setLoading(true);
        }
      } else {
        const error = result.error ?? new Error('Search navigation failed');
        this.addressBar.setValue(trimmed);

        if (this.config.updateStatusBar) {
          this.statusBar?.setStatus(`Failed: ${error.message}`);
        }

        this.bus.emit({ kind: 'navigationFailed', url: searchUrl, error });
      }

      this.addressBar.setLoading(false);
      this.toolbar.setLoading(false);
      this._setLoading(false);
      this._searchMode = false;
      this._searchQuery = '';
      this._navigating = false;
      return;
    }

    // Blocked protocol check.
    if (this._isBlockedProtocol(trimmed)) {
      this._navigating = false;
      const error = new Error(`Blocked protocol: ${trimmed.split(':')[0]}`);
      this.bus.emit({ kind: 'navigationFailed', url: trimmed, error });
      if (this.config.updateStatusBar) {
        this.statusBar?.setStatus(`Blocked: ${error.message}`);
      }
      return;
    }

    // Normal URL navigation.
    this.addressBar.setValue(trimmed);
    this.addressBar.setLoading(true);
    this.toolbar.setLoading(true);
    this._setLoading(true);

    const result = await this.nav.navigate(trimmed);

    if (result.success && result.entry) {
      this._currentUrl = result.entry.url;
      this.addressBar.setValue(result.entry.url);
      this._updateSecureState(result.entry.url);

      const tab = this.tabs.activeTab;
      if (tab) {
        tab.setUrl(result.entry.url);
        tab.setTitle(result.entry.parsedUrl.hostname || result.entry.url);
        tab.setLoading(false);
      }

      if (this.config.updateStatusBar) {
        this.statusBar?.setUrl(result.entry.url);
        this.statusBar?.setStatus('Done');
      }

      this.bus.emit({ kind: 'urlNavigated', url: result.entry.url });
    } else {
      const error = result.error ?? new Error('Navigation failed');
      this.addressBar.setValue(trimmed);

      if (this.config.updateStatusBar) {
        this.statusBar?.setStatus(`Failed: ${error.message}`);
      }

      this.bus.emit({ kind: 'navigationFailed', url: trimmed, error });
    }

    this.addressBar.setLoading(false);
    this.toolbar.setLoading(false);
    this._setLoading(false);
    this._navigating = false;
  }

  goBack(): void {
    if (!this.nav.canGoBack()) return;

    this._navigating = true;
    const result = this.nav.back();
    if (result.success && result.entry) {
      this._currentUrl = result.entry.url;
      this.addressBar.setValue(result.entry.url);
      this._updateSecureState(result.entry.url);
      this._syncToolbarState();

      const tab = this.tabs.activeTab;
      if (tab) {
        tab.setUrl(result.entry.url);
        tab.setTitle(result.entry.parsedUrl.hostname || result.entry.url);
      }

      if (this.config.updateStatusBar) {
        this.statusBar?.setUrl(result.entry.url);
        this.statusBar?.setStatus('Done');
      }

      this.bus.emit({ kind: 'urlNavigated', url: result.entry.url });
    }
    this._navigating = false;
  }

  goForward(): void {
    if (!this.nav.canGoForward()) return;

    this._navigating = true;
    const result = this.nav.forward();
    if (result.success && result.entry) {
      this._currentUrl = result.entry.url;
      this.addressBar.setValue(result.entry.url);
      this._updateSecureState(result.entry.url);
      this._syncToolbarState();

      const tab = this.tabs.activeTab;
      if (tab) {
        tab.setUrl(result.entry.url);
        tab.setTitle(result.entry.parsedUrl.hostname || result.entry.url);
      }

      if (this.config.updateStatusBar) {
        this.statusBar?.setUrl(result.entry.url);
        this.statusBar?.setStatus('Done');
      }

      this.bus.emit({ kind: 'urlNavigated', url: result.entry.url });
    }
    this._navigating = false;
  }

  reload(): void {
    const current = this.nav.getCurrentEntry();
    if (!current) return;

    this.addressBar.setLoading(true);
    this.toolbar.setLoading(true);
    this._setLoading(true);

    const tab = this.tabs.activeTab;
    if (tab) tab.setLoading(true);

    if (this.config.updateStatusBar) {
      this.statusBar?.setStatus('Reloading...');
    }

    this.nav.reload();
  }

  stop(): void {
    this.nav.stop();
    this.addressBar.setLoading(false);
    this.toolbar.setLoading(false);
    this._setLoading(false);

    const tab = this.tabs.activeTab;
    if (tab) tab.setLoading(false);

    if (this.config.updateStatusBar) {
      this.statusBar?.setStatus('Stopped');
    }
  }

  syncFromActiveTab(): void {
    const tab = this.tabs.activeTab;
    this._navigating = true;
    if (!tab) {
      this._currentUrl = '';
      this.addressBar.clear();
      this.toolbar.setCanGoBack(false);
      this.toolbar.setCanGoForward(false);
      this._navigating = false;
      return;
    }

    this._currentUrl = tab.url;
    this.addressBar.setValue(tab.url);
    this.toolbar.setCanGoBack(tab.canGoBack());
    this.toolbar.setCanGoForward(tab.canGoForward());
    this.toolbar.setLoading(tab.loading);
    this._setLoading(tab.loading);
    this._updateSecureState(tab.url);
    this._navigating = false;

    if (this.config.updateStatusBar) {
      this.statusBar?.setUrl(tab.url);
      this.statusBar?.setStatus(tab.loading ? 'Loading...' : 'Done');
    }

    // Sync the shared NavigationController to the active tab's URL so that
    // back/forward operate on the correct tab's history going forward.
    const currentEntry = this.nav.getCurrentEntry();
    if (tab.url && currentEntry?.url !== tab.url) {
      this.nav.navigate(tab.url);
    }
  }

  // ── Events ─────────────────────────────────────────────────────────────────

  on(type: BridgeEventType, handler: (event: BridgeEventUnion) => void): void {
    this.bus.on(type, handler);
  }

  off(type: BridgeEventType, handler: (event: BridgeEventUnion) => void): void {
    this.bus.off(type, handler);
  }

  // ── Private: wire toolbar ──────────────────────────────────────────────────

  private wireToolbarEvents(): void {
    const handler = (e: ToolbarEventUnion) => {
      switch (e.kind) {
        case 'back': this.goBack(); break;
        case 'forward': this.goForward(); break;
        case 'reload': this.reload(); break;
        case 'stop': this.stop(); break;
      }
    };
    this.toolbar.on('back', handler);
    this.toolbar.on('forward', handler);
    this.toolbar.on('reload', handler);
    this.toolbar.on('stop', handler);
  }

  // ── Private: wire address bar ──────────────────────────────────────────────

  private wireAddressBarEvents(): void {
    const handler = (e: AddressBarEventUnion) => {
      // Guard: skip if the bridge itself triggered the event via setValue().
      if (this._navigating) return;
      switch (e.kind) {
        case 'navigate':
          void this.navigate((e as { readonly url: string }).url);
          break;
        case 'search':
          void this.navigate((e as { readonly query: string }).query);
          break;
        case 'reload':
          this.reload();
          break;
        case 'stop':
          this.stop();
          break;
      }
    };
    this.addressBar.on('navigate', handler);
    this.addressBar.on('search', handler);
    this.addressBar.on('reload', handler);
    this.addressBar.on('stop', handler);
  }

  // ── Private: wire navigation controller ────────────────────────────────────

  private wireNavigationEvents(): void {
    const handler = (e: NavigationEvent) => {
      switch (e.kind) {
        case 'navigationStarted':
          this._setLoading(true);
          this.addressBar.setLoading(true);
          this.toolbar.setLoading(true);
          this.bus.emit({ kind: 'navigationStarted', url: e.request.url });
          break;

        case 'navigationCommitted': {
          this._currentUrl = e.entry.url;
          const wasNavigating = this._navigating;
          this._navigating = true;
          this.addressBar.setValue(e.entry.url);
          this._navigating = wasNavigating;
          this._updateSecureState(e.entry.url);
          break;
        }

        case 'navigationCompleted':
          this._setLoading(false);
          this.addressBar.setLoading(false);
          this.toolbar.setLoading(false);
          this._syncToolbarState();
          this.bus.emit({ kind: 'navigationCompleted', url: e.entry.url, elapsedMs: e.elapsedMs });
          break;

        case 'navigationFailed':
          this._setLoading(false);
          this.addressBar.setLoading(false);
          this.toolbar.setLoading(false);
          this.bus.emit({ kind: 'navigationFailed', url: e.request.url, error: e.error });
          break;

        case 'navigationStopped':
          this._setLoading(false);
          this.addressBar.setLoading(false);
          this.toolbar.setLoading(false);
          break;

        case 'canGoBackChanged':
        case 'canGoForwardChanged':
          this._syncToolbarState();
          this.bus.emit({
            kind: 'historyChanged',
            canGoBack: this.nav.canGoBack(),
            canGoForward: this.nav.canGoForward(),
            historyLength: this.nav.historyLength,
          });
          break;
      }
    };

    this.nav.on('navigationStarted', handler);
    this.nav.on('navigationCommitted', handler);
    this.nav.on('navigationCompleted', handler);
    this.nav.on('navigationFailed', handler);
    this.nav.on('navigationStopped', handler);
    this.nav.on('canGoBackChanged', handler);
    this.nav.on('canGoForwardChanged', handler);
  }

  // ── Private: wire tab manager ──────────────────────────────────────────────

  private wireTabManagerEvents(): void {
    const handler = () => { this.syncFromActiveTab(); };
    this.tabs.on('tabActivated', handler);
    this.tabs.on('tabRemoved', handler);
  }

  // ── Private: helpers ────────────────────────────────────────────────────────

  private _setLoading(loading: boolean): void {
    this._isLoading = loading;
  }

  private _syncToolbarState(): void {
    this.toolbar.setCanGoBack(this.nav.canGoBack());
    this.toolbar.setCanGoForward(this.nav.canGoForward());
  }

  private _updateSecureState(url: string): void {
    let isSecure = true;
    try {
      const urlObj = new URL(url);
      isSecure = urlObj.protocol === 'https:' ||
                 urlObj.protocol === 'wss:' ||
                 urlObj.protocol === 'file:' ||
                 urlObj.protocol === 'nova:' ||
                 urlObj.protocol === 'about:';
    } catch {
      isSecure = false;
    }
    this.addressBar.setSecure(isSecure);
    if (this.config.updateStatusBar) {
      this.statusBar?.setSecure(isSecure);
      this.statusBar?.setProtocol(this._getProtocolLabel(url));
    }
  }

  private _getProtocolLabel(url: string): string {
    try {
      const urlObj = new URL(url);
      const labels: Record<string, string> = {
        'https:': 'HTTPS', 'http:': 'HTTP', 'ws:': 'WS', 'wss:': 'WSS',
        'ftp:': 'FTP', 'file:': 'FILE', 'data:': 'DATA', 'nova:': 'NOVA',
        'about:': 'ABOUT',
      };
      return labels[urlObj.protocol] ?? urlObj.protocol.replace(':', '').toUpperCase();
    } catch {
      return '';
    }
  }

  private _isSearchQuery(input: string): boolean {
    // If it starts with a scheme (with or without //), it's a URL.
    if (/^[a-zA-Z][a-zA-Z0-9+\-.]*:/.test(input)) return false;
    // If it looks like a hostname (has a dot and a TLD), it's a URL.
    if (/^[a-zA-Z0-9]([a-zA-Z0-9-]*\.)+[a-zA-Z]{2,}/.test(input)) return false;
    // If it's localhost with optional port.
    if (/^localhost(:\d{1,5})?/.test(input)) return false;
    // If it's an IPv4 address.
    if (/^(\d{1,3}\.){3}\d{1,3}/.test(input)) return false;
    // Otherwise, treat as search query.
    return true;
  }

  private _isBlockedProtocol(url: string): boolean {
    try {
      const proto = new URL(url).protocol;
      return proto === 'javascript:' || proto === 'data:';
    } catch {
      return false;
    }
  }

  // ── Dispose ────────────────────────────────────────────────────────────────

  dispose(): void {
    this.bus.dispose();
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// EXPORTS
// ─────────────────────────────────────────────────────────────────────────────

export { NavigationBridge, NavigationBridgeEventBus, DEFAULT_BRIDGE_CONFIG };
export type {
  INavigationBridge,
  NavigationBridgeConfig,
  BridgeEventType,
  BridgeEventUnion,
};
