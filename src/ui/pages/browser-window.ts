import type { IDisposable } from '../../app/dependency-container';
import type { ITabManager } from '../../browser/tabs/tab-manager';
import type { IDesktopLayout, DesktopLayoutAreas } from '../layout/desktop-layout';
import type { IMobileLayout, MobileLayoutAreas } from '../layout/mobile-layout';
import type { IAddressBar } from '../components/address-bar/address-bar';
import type { ITabStrip } from '../components/tab-strip/tab-strip';
import type { IBookmarkBar } from '../components/bookmark-bar/bookmark-bar';
import type { IStatusBar } from '../components/status-bar/status-bar';
import type { IToolbar } from '../components/toolbar/toolbar';
import type { ITrackerBlocker } from '../../browser/security/tracker-blocker';
import type { IAdBlocker } from '../../browser/security/ad-blocker';
import type { IUrlParser } from '../../browser/navigation/url-parser';
import type { IContentRenderer } from '../components/content-renderer/content-renderer';
import type { INavigationBridge } from '../components/navigation-bridge';
import type { IBrowserEngine, EngineEvent } from '../../browser/engine/browser-engine';
import type { INavigationController } from '../../browser/navigation/navigation-controller';
import type { IPaintEngine } from '../../browser/rendering/paint-engine';
import type { IDownloadManager } from '../../browser/downloads/download-manager';
import type { IBookmarkService } from '../../browser/bookmarks/bookmark-services';
import type { IHistoryService } from '../../browser/history/history-service';
import type { IZoomManager } from '../../browser/navigation-controls/zoom';
import type { IWindowControls } from '../../platform/shared/window-controls';

import { TabManager } from '../../browser/tabs/tab-manager';
import { TabSessionBridge } from '../../browser/tabs/tab-session-bridge';
import { TabPersistenceManager, MemoryStore } from '../../browser/tabs/tab-persistence';
import { TabContextManager } from '../../browser/engine/tab-context';
import { AddressBar } from '../components/address-bar/address-bar';
import { AddressBarView } from '../components/address-bar/address-bar.view';
import { TabStrip } from '../components/tab-strip/tab-strip';
import { TabStripView } from '../components/tab-strip/tab-strip.view';
import { BookmarkBar } from '../components/bookmark-bar/bookmark-bar';
import { BookmarkBarView } from '../components/bookmark-bar/bookmark-bar.view';
import { StatusBar } from '../components/status-bar/status-bar';
import { StatusBarView } from '../components/status-bar/status-bar.view';
import { Toolbar } from '../components/toolbar/toolbar';
import { ToolbarView } from '../components/toolbar/toolbar.view';
import { DesktopLayout } from '../layout/desktop-layout';
import { MobileLayout } from '../layout/mobile-layout';
import { TrackerBlocker } from '../../browser/security/tracker-blocker';
import { AdBlocker } from '../../browser/security/ad-blocker';
import { UrlParser } from '../../browser/navigation/url-parser';
import { NavigationController } from '../../browser/navigation/navigation-controller';
import { NavigationBridge } from '../components/navigation-bridge';
import { ContentRenderer } from '../components/content-renderer/content-renderer';
import { DevToolsPanel } from '../components/devtools-panel/devtools-panel';
import { NavigationFetcher } from '../components/navigation-fetcher';
import { ContextMenu, type ContextMenuItem } from '../components/context-menu/context-menu';
import { ZoomManager } from '../../browser/navigation-controls/zoom';
import { FindInPage } from '../../browser/navigation-controls/find-in-page';
import { FindBar } from '../components/find-bar/find-bar';
import { IncognitoManager, type IIncognitoManager } from '../../browser/settings/incognito';
import type { DomElement, DomNode, DomTextNode } from '../../browser/rendering/dom-tree';
import type { ILayoutEngine } from '../../browser/rendering/layout-engine';
import { SettingsPage } from './settings-page';
import { DownloadsPage } from './downloads-page';
import { NewTabPage } from './new-tab-page';
import { ResearchPage } from './research-page';
import type { ISettingsPage } from './settings-page';
import type { IResearchPage } from './research-page';
import type { ISettingsService } from '../../browser/storage/settings-service';
import type { IBrowserName } from '../../browser/config/browser-name';
import type { IResearchService } from '../../browser/research/research-types';

interface BrowserWindowPageConfig {
  readonly containerId: string;
  readonly showDevtools: boolean;
  readonly showSidebar: boolean;
  readonly showBookmarkBar: boolean;
  readonly showMenuBar: boolean;
  /**
   * When true, mount() always builds the desktop chrome (Toolbar/TabStrip/
   * AddressBar/BookmarkBar/StatusBar, fully wired) regardless of viewport
   * width, instead of switching to MobileLayout under 768px. Used when an
   * external native shell (the Android app) hosts this page full-screen and
   * wants the exact same chrome desktop uses — see android-native-bridge.ts,
   * which is also the escape hatch a couple of this chrome's own menu
   * actions (Downloads, Incognito) use to hand off to native-only
   * functionality (real file downloads) that has no web equivalent.
   */
  readonly forceDesktopChrome: boolean;
}

const DEFAULT_PAGE_CONFIG: BrowserWindowPageConfig = {
  containerId: 'browser-app',
  showDevtools: false,
  showSidebar: false,
  showBookmarkBar: true,
  showMenuBar: true,
  forceDesktopChrome: false,
};

/** Search-URL templates keyed by the `defaultSearchEngine` setting value. */
const SEARCH_URL_TEMPLATES: Record<string, string> = {
  google: 'https://www.google.com/search?q=%s',
  bing: 'https://www.bing.com/search?q=%s',
  duckduckgo: 'https://duckduckgo.com/?q=%s',
};

/** Serializable snapshot pushed to onChromeState() listeners (e.g. a native host bridge). */
interface ChromeStateSnapshot {
  readonly tabs: ReadonlyArray<{
    readonly id: string;
    readonly url: string;
    readonly title: string;
    readonly active: boolean;
    readonly pinned: boolean;
    readonly loading: boolean;
    /** Load error from the last failed navigation, null when the tab is healthy. */
    readonly error: { readonly code: string; readonly description: string; readonly url: string } | null;
  }>;
  readonly activeTabId: string | null;
  readonly addressValue: string;
  readonly canGoBack: boolean;
  readonly canGoForward: boolean;
  /** New-tab/home URL resolved from the `homePage` setting. */
  readonly homeUrl: string;
  /** Default search URL template with a `%s` placeholder (see `defaultSearchEngine`). */
  readonly searchTemplate: string;
  /** True while an incognito (private) session is active. */
  readonly incognito: boolean;
}

/**
 * Element info resolved for a context-menu (long-press) position. At least one
 * of link/image fields is non-null whenever the engine can identify a target.
 */
interface ContextTarget {
  readonly linkUrl: string | null;
  readonly linkText: string | null;
  readonly imageUrl: string | null;
  readonly imageAlt: string | null;
}

interface IBrowserWindowPage extends IDisposable {
  readonly config: BrowserWindowPageConfig;
  readonly isMounted: boolean;
  mount(container: HTMLElement): Promise<void>;
  unmount(): Promise<void>;
  navigate(url: string): Promise<void>;
  reload(): void;
  goBack(): void;
  goForward(): void;
  stop(): void;
  setSettingsService(service: ISettingsService): void;
  setBrowserEngine(engine: IBrowserEngine): void;
  setNavigationController(controller: INavigationController): void;
  setPaintEngine(engine: IPaintEngine): void;
  setDownloadManager(manager: IDownloadManager): void;
  setBookmarkService(service: IBookmarkService): void;
  setHistoryService(service: IHistoryService): void;
  setTrackerBlocker(blocker: ITrackerBlocker): void;
  setAdBlocker(blocker: IAdBlocker): void;
  setWindowControls(controls: IWindowControls): void;
  setBrowserName(name: IBrowserName): void;
  setResearchService(service: IResearchService): void;

  // ── External chrome bridge (native shells driving this page's tabs/nav) ────
  /** Push-based state: fires on every syncAll() (tab created/removed/activated, url changed, etc). */
  onChromeState(handler: (snapshot: ChromeStateSnapshot) => void): void;
  offChromeState(handler: (snapshot: ChromeStateSnapshot) => void): void;
  /** Pull-based: get the current state without waiting for the next change. */
  getChromeState(): ChromeStateSnapshot;
  createTab(url?: string): string;
  closeTab(tabId: string): boolean;
  activateTabExternal(tabId: string): boolean;

  // ── Incognito (private browsing) session toggle for external chrome ────────
  setIncognitoExternal(enabled: boolean): void;
  isIncognito(): boolean;

  // ── Context-menu (long-press) element resolution for external chrome ───────
  /** Resolve the link/image under page coordinates, if any. Returns null when no target is found. */
  resolveContextTarget(x: number, y: number): ContextTarget | null;

  // ── Bookmarks/history for external chrome (shared with desktop's own data) ──
  onLibraryChanged(handler: () => void): void;
  offLibraryChanged(handler: () => void): void;
  listBookmarksExternal(): Promise<ReadonlyArray<{ id: string; title: string; url: string }>>;
  addBookmarkExternal(title: string, url: string): Promise<void>;
  removeBookmarkExternal(id: string): Promise<void>;
  isBookmarkedExternal(url: string): Promise<boolean>;
  listHistoryExternal(maxResults?: number): Promise<ReadonlyArray<{ id: string; title: string; url: string; visitedAt: number }>>;
  removeHistoryEntryExternal(id: string): Promise<void>;
  clearHistoryExternal(): Promise<void>;

  // ── Find-in-page for external chrome (native shells drive their own find UI) ──
  findInPageExternal(query: string): { current: number; total: number };
  findNextExternal(): { current: number; total: number };
  findPreviousExternal(): { current: number; total: number };
  closeFindExternal(): void;
  /** Opens this page's own find bar — used by the main menu's "Find in Page"
   *  entry, since touch devices have no Ctrl+F to fall back on. */
  showFindBarExternal(): void;
}

class BrowserWindowPage implements IBrowserWindowPage {
  readonly config: BrowserWindowPageConfig;
  private tabManager: ITabManager | null = null;
  private layout: IDesktopLayout | IMobileLayout | null = null;
  private layoutType: 'desktop' | 'mobile' = 'desktop';
  private addressBar: IAddressBar | null = null;
  private tabStrip: ITabStrip | null = null;
  private bookmarkBar: IBookmarkBar | null = null;
  private statusBar: IStatusBar | null = null;
  private zoomManager: IZoomManager | null = null;
  private findInPage: FindInPage | null = null;
  private findBar: FindBar | null = null;
  private findHighlightEl: HTMLElement | null = null;
  private toolbar: IToolbar | null = null;
  private trackerBlocker: ITrackerBlocker | null = null;
  private adBlocker: IAdBlocker | null = null;
  private addressBarView: AddressBarView | null = null;
  private tabStripView: TabStripView | null = null;
  private bookmarkBarView: BookmarkBarView | null = null;
  private statusBarView: StatusBarView | null = null;
  private toolbarView: ToolbarView | null = null;
  private container: HTMLElement | null = null;
  private _mounted = false;

  private readonly parser: IUrlParser;
  private contentRenderer: IContentRenderer | null = null;
  private devToolsPanel: DevToolsPanel | null = null;
  // Ctrl/Cmd+Shift+J — deliberately not F12 or Ctrl+Shift+I, both of which
  // Electron's default View menu binds to the *host* Chromium DevTools
  // (and would fire instead of ever reaching this page-level listener).
  private readonly onDevToolsKeydown = (e: KeyboardEvent): void => {
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'j') {
      e.preventDefault();
      (this.layout as IDesktopLayout | null)?.toggleDevtools?.();
    }
  };
  // Standard browser chrome shortcuts: Ctrl/Cmd+T (new tab), Ctrl/Cmd+W
  // (close tab), Ctrl+Tab / Ctrl+Shift+Tab (cycle tabs), F11 (fullscreen).
  private readonly onBrowserShortcutsKeydown = (e: KeyboardEvent): void => {
    const mod = e.ctrlKey || e.metaKey;
    if (mod && e.key.toLowerCase() === 't') {
      e.preventDefault();
      this.tabManager?.createTab();
      this.syncAll();
    } else if (mod && e.key.toLowerCase() === 'w') {
      e.preventDefault();
      const activeId = this.tabManager?.activeTabId;
      if (activeId && this.tabManager) {
        this.tabManager.removeTab(activeId);
        if (this.tabManager.count === 0) this.tabManager.createTab();
        this.navigationBridge?.syncFromActiveTab();
        this.syncAll();
      }
    } else if (e.ctrlKey && e.key === 'Tab') {
      e.preventDefault();
      this.cycleTab(e.shiftKey ? -1 : 1);
    } else if (e.key === 'F11') {
      e.preventDefault();
      void this.windowControls?.toggleFullscreen();
    } else if (mod && e.key.toLowerCase() === 'f') {
      e.preventDefault();
      this.showFindBar();
    }
  };

  private showFindBar(): void {
    if (!this.findBar || !this.contentArea) return;
    const rect = this.contentArea.getBoundingClientRect();
    this.findBar.setPosition(rect.top + 8, window.innerWidth - rect.right + 8);
    this.findBar.show();
  }

  private runFind(query: string): { current: number; total: number } {
    const domTree = this.browserEngine?.getPageDomTree?.();
    if (!this.findInPage || !domTree) return { current: -1, total: 0 };
    const result = this.findInPage.findInDom(domTree, query);
    this.findBar?.setMatchCount(result.activeIndex, result.total);
    this.highlightCurrentMatch();
    return { current: result.activeIndex, total: result.total };
  }

  private advanceFind(direction: 'next' | 'previous'): { current: number; total: number } {
    if (direction === 'next') this.findInPage?.findNext();
    else this.findInPage?.findPrevious();
    const current = this.findInPage?.getCurrentIndex() ?? -1;
    const total = this.findInPage?.getMatchCount() ?? 0;
    this.findBar?.setMatchCount(current, total);
    this.highlightCurrentMatch();
    return { current, total };
  }

  private closeFind(): void {
    this.findBar?.hide();
    this.findInPage?.clear();
    if (this.findHighlightEl) this.findHighlightEl.style.display = 'none';
  }

  // ── Find-in-page for external chrome (e.g. Android's own find UI) ──────────

  findInPageExternal(query: string): { current: number; total: number } {
    return this.runFind(query);
  }

  findNextExternal(): { current: number; total: number } {
    return this.advanceFind('next');
  }

  findPreviousExternal(): { current: number; total: number } {
    return this.advanceFind('previous');
  }

  closeFindExternal(): void {
    this.closeFind();
  }

  showFindBarExternal(): void {
    this.showFindBar();
  }

  private highlightCurrentMatch(): void {
    const match = this.findInPage?.getActiveMatch();
    if (!match?.elementDomId || !this.findHighlightEl || !this.contentArea) {
      if (this.findHighlightEl) this.findHighlightEl.style.display = 'none';
      return;
    }
    const layoutEngine = this.browserEngine?.getPageLayoutEngine?.();
    const box = layoutEngine?.getLayoutBox(match.elementDomId);
    const scale = this.contentRenderer?.getBufferToViewportScale?.();
    if (!box || !scale) {
      this.findHighlightEl.style.display = 'none';
      return;
    }
    const contentRect = this.contentArea.getBoundingClientRect();
    this.findHighlightEl.style.display = 'block';
    this.findHighlightEl.style.left = `${contentRect.left + box.x * scale.scaleX}px`;
    this.findHighlightEl.style.top = `${contentRect.top + box.y * scale.scaleY}px`;
    this.findHighlightEl.style.width = `${box.width * scale.scaleX}px`;
    this.findHighlightEl.style.height = `${box.height * scale.scaleY}px`;
  }

  private cycleTab(direction: 1 | -1): void {
    if (!this.tabManager) return;
    const tabs = this.tabManager.tabs;
    if (tabs.length < 2) return;
    const activeId = this.tabManager.activeTabId;
    const currentIndex = activeId ? this.tabManager.getTabIndex(activeId) : -1;
    const nextIndex = (currentIndex + direction + tabs.length) % tabs.length;
    this.tabManager.activateTab(tabs[nextIndex]!.id);
    this.navigationBridge?.syncFromActiveTab();
    this.syncAll();
  }
  private contentArea: HTMLElement | null = null;
  private currentUrl = '';
  private contentNavigateHandler: ((e: Event) => void) | null = null;
  private activeSettingsPage: ISettingsPage | null = null;
  private activeDownloadsPage: DownloadsPage | null = null;
  private activeNewTabPage: NewTabPage | null = null;
  private activeResearchPage: IResearchPage | null = null;
  private activeContentPanel: HTMLElement | null = null;
  private settingsService: ISettingsService | null = null;
  private navigationBridge: INavigationBridge | null = null;
  private navigationFetcher: NavigationFetcher | null = null;
  private pipelineController: INavigationController | null = null;
  private localController: INavigationController | null = null;
  private readonly onBridgeUrlNavigated = (e: { readonly kind: string; readonly url?: string }) => {
    // The address bar's own Enter-key path drives navigation through
    // NavigationBridge directly (not through this.navigate()), so it never
    // otherwise reaches handleContentForUrl() — internal nova://* pages typed
    // straight into the address bar would just sit on whatever was already
    // rendered. Route it here too so both entry points behave the same way.
    if (e.kind === 'urlNavigated' && e.url && this.parser.isSpecialPage(e.url)) {
      this.handleContentForUrl(e.url);
    }
    this.syncAll();
  };

  /** Per-tab load errors (keyed by tab id) recorded from navigationFailed bridge events. */
  private readonly tabErrors = new Map<string, { code: string; description: string; url: string }>();

  /** Engine-bus handlers (unregistered on re-set so a long-lived page leaks no subscriptions). */
  private readonly engineLoadErrorHandler = (event: EngineEvent): void => {
    if (event.kind !== 'pageLoadError') return;
    const activeTabId = this.tabManager?.activeTabId ?? null;
    if (activeTabId) {
      this.tabErrors.set(activeTabId, {
        code: 'PageLoadError',
        description: event.error?.message || 'The page could not be loaded.',
        url: event.session.finalUrl ?? event.session.entry.url,
      });
    }
    this.syncAll();
  };
  private readonly engineLoadStartedHandler = (event: EngineEvent): void => {
    if (event.kind !== 'pageLoadStarted') return;
    const activeTabId = this.tabManager?.activeTabId ?? null;
    if (activeTabId) this.tabErrors.delete(activeTabId);
    this.syncAll();
  };
  private readonly engineConsoleMessageHandler = (event: EngineEvent): void => {
    if (event.kind !== 'consoleMessage') return;
    this.devToolsPanel?.addEntry(event.entry);
  };
  private readonly engineNetworkEntryHandler = (event: EngineEvent): void => {
    if (event.kind !== 'networkEntry') return;
    this.devToolsPanel?.addNetworkEntry(event.entry);
  };

  /**
   * Tracks navigation failure/success on the bridge so pushed ChromeStateSnapshot
   * objects can carry a per-tab `error` (drives the native error page). The bridge
   * operates on the active tab, so events are attributed to it.
   */
  private readonly onBridgeNavState = (event: { kind: string; url?: string; error?: Error }): void => {
    const activeTabId = this.tabManager?.activeTabId ?? null;
    switch (event.kind) {
      case 'navigationStarted':
      case 'navigationCompleted':
      case 'urlNavigated':
        if (activeTabId) this.tabErrors.delete(activeTabId);
        break;
      case 'navigationFailed':
        if (activeTabId) {
          this.tabErrors.set(activeTabId, {
            code: event.error?.name || 'NavigationError',
            description: event.error?.message || 'The page could not be loaded.',
            url: event.url ?? this.currentUrl,
          });
        }
        break;
    }
    this.syncAll();
  };

  // DI-injected services
  private browserEngine: IBrowserEngine | null = null;
  private navController: INavigationController | null = null;
  private paintEngine: IPaintEngine | null = null;
  private downloadManager: IDownloadManager | null = null;
  private bookmarkService: IBookmarkService | null = null;
  private historyService: IHistoryService | null = null;
  private suggestTimer: ReturnType<typeof setTimeout> | null = null;
  private suggestSeq = 0;
  private browserName: IBrowserName | null = null;
  private diTrackerBlocker: ITrackerBlocker | null = null;
  private windowControls: IWindowControls | null = null;
  private diAdBlocker: IAdBlocker | null = null;
  private researchService: IResearchService | null = null;
  private downloadsEventHandler: ((event: { kind: string }) => void) | null = null;
  private historyEventHandler: ((event: { kind: string }) => void) | null = null;
  private bookmarkEventHandler: ((event: { kind: string }) => void) | null = null;
  private contextMenu: ContextMenu | null = null;
  private incognitoManager: IIncognitoManager | null = null;
  private tabSessionBridge: TabSessionBridge | null = null;
  private tabPersistence: TabPersistenceManager | null = null;
  private contextManager: TabContextManager | null = null;
  private readonly chromeStateHandlers = new Set<(snapshot: ChromeStateSnapshot) => void>();
  private readonly libraryChangedHandlers = new Set<() => void>();

  constructor(config?: Partial<BrowserWindowPageConfig>) {
    this.config = { ...DEFAULT_PAGE_CONFIG, ...config };
    this.parser = new UrlParser();
  }

  get isMounted(): boolean { return this._mounted; }

  async mount(container: HTMLElement): Promise<void> {
    this.container = container;
    this.container.className = 'browser-window';
    this.container.style.cssText = 'display:flex;flex-direction:column;height:100%;width:100%;overflow:hidden;';

    // Detect mobile viewport: use MobileLayout when width < 768px — unless
    // forceDesktopChrome (the Android native host) says to always use the
    // real desktop chrome instead of MobileLayout's unfinished stub.
    const isMobile = typeof window !== 'undefined' && window.innerWidth < 768 && !this.config.forceDesktopChrome;
    this.layoutType = isMobile ? 'mobile' : 'desktop';

    if (isMobile) {
      this.layout = new MobileLayout();
    } else {
      this.layout = new DesktopLayout({
        showMenuBar: this.config.showMenuBar,
        showBookmarkBar: this.config.showBookmarkBar,
        showStatusBar: true,
      });
    }
    this.layout.attach(this.container);

    const areas = (isMobile
      ? (this.layout as IMobileLayout).areas
      : (this.layout as IDesktopLayout).areas) as DesktopLayoutAreas & MobileLayoutAreas;

    this.tabManager = new TabManager();
    this.contextManager = new TabContextManager();
    this.tabSessionBridge = new TabSessionBridge(this.tabManager, this.contextManager);
    this.tabPersistence = new TabPersistenceManager(new MemoryStore());
    this.tabPersistence.startAutoSave(this.tabManager);
    const savedTabs = this.tabPersistence.restoreTabs();
    if (savedTabs && savedTabs.tabs.length > 0) {
      for (const tabState of savedTabs.tabs) {
        const tab = this.tabManager.createTab(tabState.url, tabState.pinned);
        if (tabState.title) tab.setTitle(tabState.title);
        if (tabState.groupId) tab.setGroupId(tabState.groupId);
      }
      if (savedTabs.activeTabId && this.tabManager.getTab(savedTabs.activeTabId)) {
        this.tabManager.activateTab(savedTabs.activeTabId);
      }
    }
    this.trackerBlocker = new TrackerBlocker();
    this.adBlocker = new AdBlocker();
    this.toolbar = new Toolbar();
    this.tabStrip = new TabStrip(this.tabManager);
    this.addressBar = new AddressBar();
    this.bookmarkBar = new BookmarkBar(this.bookmarkService ?? undefined);
    this.statusBar = new StatusBar();
    this.zoomManager = new ZoomManager();
    this.zoomManager.onEvent((event) => {
      this.statusBar?.setZoom(event.zoom);
      this.statusBarView?.update(this.statusBar!.state);
      this.contentRenderer?.setZoom(event.zoom / 100);
    });

    this.findInPage = new FindInPage();
    this.findBar = new FindBar();
    this.findBar.attach(this.container);
    this.findBar.onQueryChange((query) => this.runFind(query));
    this.findBar.onNext(() => this.advanceFind('next'));
    this.findBar.onPrevious(() => this.advanceFind('previous'));
    this.findBar.onClose(() => this.closeFind());

    this.findHighlightEl = document.createElement('div');
    this.findHighlightEl.style.cssText = 'position:fixed; display:none; background:rgba(255,214,0,0.35); border:2px solid rgba(255,180,0,0.9); pointer-events:none; z-index:499;';
    this.container.appendChild(this.findHighlightEl);

    if (isMobile) {
      // Mobile: attach address bar to mobile header slot, content to content area
      if (areas.addressBar) {
        this.addressBarView = new AddressBarView(this.addressBar);
        this.addressBarView.attach(areas.addressBar);
      }
      if (areas.content) {
        this.contentArea = areas.content;
      }
      if (areas.statusBar) {
        this.statusBarView = new StatusBarView(this.statusBar);
        this.statusBarView.attach(areas.statusBar);
      }
    } else {
      if (areas.toolbar) {
        // Traffic lights are macOS-style window controls (close/minimize/
        // maximize) — meaningless on a full-screen Android host with no
        // window to control, so the native host disables them here rather
        // than showing three inert dots.
        this.toolbarView = new ToolbarView(this.toolbar, { showTrafficLights: !this.config.forceDesktopChrome });
        this.toolbarView.attach(areas.toolbar);
        this.toolbarView.setEventHandler((e) => {
          switch (e.kind) {
            case 'back':
              this.goBack();
              break;
            case 'forward':
              this.goForward();
              break;
            case 'reload':
              this.reload();
              break;
            case 'stop':
              this.stop();
              break;
            case 'home':
              this.toolbar?.goHome();
              break;
            case 'shieldToggle':
              this.toolbar?.toggleShield();
              break;
            case 'bookmarkAdd':
              this.toolbar?.addBookmark();
              break;
            case 'menuClick':
              this.showMainMenu(e.x, e.y);
              break;
          }
        });
      }
      if (areas.tabBar) {
        this.tabStripView = new TabStripView(this.tabStrip);
        this.tabStripView.attach(areas.tabBar);
        this.tabStripView.setEventHandler((e) => {
          switch (e.kind) {
            case 'tabSelected':
              this.tabManager?.activateTab(e.tabId);
              this.navigationBridge?.syncFromActiveTab();
              break;
            case 'tabClosed':
              this.tabManager?.removeTab(e.tabId);
              this.syncAll();
              break;
            case 'newTabRequested':
              this.tabManager?.createTab();
              this.syncAll();
              break;
            case 'contextMenu':
              this.showTabContextMenu(e.tabId, e.x, e.y);
              break;
          }
        });
      }
      if (areas.toolbar) {
        this.addressBarView = new AddressBarView(this.addressBar);
        const addressSlot = areas.toolbar.querySelector('.address-bar-slot');
        if (addressSlot) {
          this.addressBarView.attach(addressSlot as HTMLElement);
        }
      }
      if (areas.bookmarkBar) {
        this.bookmarkBarView = new BookmarkBarView(this.bookmarkBar);
        this.bookmarkBarView.attach(areas.bookmarkBar);
        this.bookmarkBarView.setEventHandler((e) => {
          if (e.kind === 'bookmarkClicked') {
            if (e.bookmark.url) void this.navigate(e.bookmark.url);
          }
        });
      }
      if (areas.statusBar) {
        this.statusBarView = new StatusBarView(this.statusBar);
        this.statusBarView.attach(areas.statusBar);
        this.statusBarView.setEventHandler((e) => {
          if (e.kind === 'shieldClicked') {
            this.toolbar?.toggleShield();
          } else if (e.kind === 'zoomChanged') {
            this.zoomManager?.setZoom(e.zoom);
          }
        });
      }
    }

    // A brand-new tab's content never rendered at all — NavigationBridge
    // only calls syncFromActiveTab() (address bar text, tab-strip, nav-
    // history state) on 'tabActivated'/'tabRemoved', which updates chrome
    // but never reaches handleContentForUrl(); the only thing that actually
    // paints content is this page's own navigate(), which nothing called on
    // tab creation. Every "new tab" (the +, Ctrl+T, the menu, or the
    // startup default) looked right in the address bar and tab strip while
    // the content area kept showing whatever the previous tab last painted.
    this.tabManager.on('tabCreated', (event) => {
      this.syncAll();
      if (event.kind === 'tabCreated') void this.navigate(event.tab.url);
    });
    this.tabManager.on('tabRemoved', () => this.syncAll());
    this.tabManager.on('tabActivated', () => this.syncAll());

    // Use DI-provided NavigationController when available (wired to the engine,
    // history service and CSP guards); otherwise fall back to a local controller.
    // The pipeline is re-synced when DI setters deliver services after mount().
    this.syncNavigationPipeline();

    // Wire toolbar events through the bridge (shield + bookmark remain local).
    this.toolbar.on('shieldToggle', (e) => {
      const enabled = (e as { readonly kind: 'shieldToggle'; readonly enabled: boolean }).enabled;
      // Use DI-registered blockers (shared with engine middleware) when available,
      // fall back to local instances.
      const tb = this.diTrackerBlocker ?? this.trackerBlocker;
      const ab = this.diAdBlocker ?? this.adBlocker;
      tb?.setEnabled(enabled);
      ab?.setEnabled(enabled);
      this.statusBar?.setStatus(enabled ? 'Shield enabled' : 'Shield disabled');
    });
    this.toolbar.on('bookmarkAdd', () => {
      if (this.tabManager?.activeTab) {
        const tab = this.tabManager.activeTab;
        this.bookmarkBar?.addBookmark(tab.title || tab.url, tab.url);
        this.syncBookmarkBar();
      }
    });
    this.toolbar.on('home', () => {
      void this.navigate(this.getHomeUrl());
    });
    this.toolbar.on('menuClick', (e) => {
      const { x, y } = e as { readonly kind: 'menuClick'; readonly x: number; readonly y: number };
      this.showMainMenu(x, y);
    });

    // Wire address bar keyboard shortcuts.
    this.addressBarView?.setNavigationCallbacks({
      onBack: () => this.goBack(),
      onForward: () => this.goForward(),
      onReload: () => this.reload(),
      onStop: () => this.stop(),
      onInput: (query) => this.updateAddressSuggestions(query),
    });

    if (!savedTabs) this.tabManager.createTab();

    if (areas.content) {
      this.contentArea = areas.content;
      this.contentRenderer = new ContentRenderer();
      this.contentRenderer.attach(areas.content);
      if (this.browserName) {
        this.contentRenderer.setBrandName(this.browserName.name);
        this.browserName.onNameChanged((name) => {
          this.contentRenderer?.setBrandName(name);
        });
      }
      this.contentRenderer.setLinkHoverHandler((url) => {
        this.statusBar?.setHoverUrl(url ?? '');
      });
      this.contentRenderer.setClickHandler((x, y) => {
        this.browserEngine?.dispatchPointerEvent?.('click', x, y);
      });
      this.contentRenderer.setContextMenuHandler((bufX, bufY, viewX, viewY) => {
        this.showPageContextMenu(bufX, bufY, viewX, viewY);
      });
      this.contentRenderer.renderNewTab();

      // Listen for navigation events from rendered content (e.g. search result links).
      this.contentNavigateHandler = (e: Event) => {
        const detail = (e as CustomEvent).detail;
        if (detail?.url) {
          void this.navigate(detail.url);
        }
      };
      areas.content.addEventListener('nova-navigate', this.contentNavigateHandler);
    }

    if (areas.devtools) {
      this.devToolsPanel = new DevToolsPanel();
      this.devToolsPanel.attach(areas.devtools);
      this.devToolsPanel.setDomTreeProvider(() => this.browserEngine?.getPageDomTree?.() ?? null);
      window.addEventListener('keydown', this.onDevToolsKeydown);
    }
    window.addEventListener('keydown', this.onBrowserShortcutsKeydown);

    this._mounted = true;
  }

  async unmount(): Promise<void> {
    if (this.suggestTimer) clearTimeout(this.suggestTimer);
    this.navigationFetcher?.dispose();
    this.cleanupSettingsPage();
    this.cleanupDownloadsPage();
    this.cleanupContentPanel();
    this.navigationBridge?.dispose();
    this.addressBarView?.dispose();
    this.tabStripView?.dispose();
    this.bookmarkBarView?.dispose();
    this.statusBarView?.dispose();
    this.toolbarView?.dispose();
    this.trackerBlocker?.dispose();
    this.adBlocker?.dispose();
    this.tabSessionBridge?.dispose();
    this.tabPersistence?.dispose();
    this.tabManager?.dispose();
    this.contextManager?.dispose();
    this.contentRenderer?.dispose();
    this.devToolsPanel?.dispose();
    this.findBar?.dispose();
    this.findInPage?.dispose();
    this.findHighlightEl?.remove();
    window.removeEventListener('keydown', this.onDevToolsKeydown);
    window.removeEventListener('keydown', this.onBrowserShortcutsKeydown);
    if (this.contentArea && this.contentNavigateHandler) {
      this.contentArea.removeEventListener('nova-navigate', this.contentNavigateHandler);
    }
    this.layout?.dispose();
    if (this.container) {
      this.container.innerHTML = '';
    }
    this.navigationFetcher = null;
    this.navigationBridge = null;
    this.addressBarView = null;
    this.tabStripView = null;
    this.bookmarkBarView = null;
    this.statusBarView = null;
    this.toolbarView = null;
    this.trackerBlocker = null;
    this.adBlocker = null;
    this.tabManager = null;
    this.tabSessionBridge = null;
    this.tabPersistence = null;
    this.contextManager = null;
    this.contentRenderer = null;
    this.devToolsPanel = null;
    this.findBar = null;
    this.findInPage = null;
    this.findHighlightEl = null;
    this.contentArea = null;
    this.contentNavigateHandler = null;
    this.layout = null;
    this._mounted = false;
  }

  async navigate(url: string): Promise<void> {
    if (this.navigationBridge) {
      await this.navigationBridge.navigate(url);
      const currentUrl = this.navigationBridge.currentUrl;
      if (currentUrl) {
        this.handleContentForUrl(currentUrl);
      }
      this.syncAll();
      return;
    }
  }

  /**
   * Route content rendering based on URL scheme.
   * HTTP/HTTPS go through the BrowserEngine pipeline.
   * Internal pages (nova://, about:) are rendered directly.
   */
  private handleContentForUrl(url: string): void {
    try {
      const parsed = this.parser.parse(url);

      // Special pages
      if (parsed.isSpecialPage) {
        this.renderSpecialPage(parsed.normalized, url);
        return;
      }

      // Data URLs
      if (parsed.protocol === 'data:') {
        this.contentRenderer?.renderHtml(
          `<html><body style="margin:0;"><iframe src="${url}" style="width:100%;height:100vh;border:none;"></iframe></body></html>`,
          { title: 'Data URL' },
        );
        return;
      }

      // File URLs
      if (parsed.protocol === 'file:') {
        this.contentRenderer?.renderHtml(
          `<html><body style="font-family:system-ui;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;background:#f8f9fa;">
            <div style="text-align:center;color:#5f6368;">
              <div style="font-size:48px;margin-bottom:16px;">📁</div>
              <h2 style="margin:0 0 8px;">Local File</h2>
              <p style="margin:0;word-break:break-all;max-width:500px;">${parsed.pathname}</p>
            </div>
          </body></html>`,
          { title: parsed.pathname || 'Local File' },
        );
        return;
      }

      // HTTP/HTTPS: content is rendered by the engine pipeline via NavigationFetcher.
      // If the engine is not available, show a fallback.
      if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
        if (!this.browserEngine) {
          this.contentRenderer?.renderHtml(
            `<html><body style="font-family:system-ui;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;background:#f8f9fa;">
              <div style="text-align:center;color:#5f6368;">
                <h2 style="margin:0 0 8px;">${parsed.hostname}</h2>
                <p style="margin:0;word-break:break-all;max-width:500px;">${url}</p>
                <p style="margin:0;font-size:12px;color:#9aa0a6;">Engine not connected</p>
              </div>
            </body></html>`,
            { title: parsed.hostname || url },
          );
        }
        return;
      }

      // Other protocols
      this.contentRenderer?.renderHtml(
        `<html><body style="font-family:system-ui;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;background:#f8f9fa;">
          <div style="text-align:center;color:#5f6368;">
            <div style="font-size:48px;margin-bottom:16px;">🔗</div>
            <h2 style="margin:0 0 8px;">${parsed.protocol.replace(':', '').toUpperCase()} Protocol</h2>
            <p style="margin:0;word-break:break-all;max-width:500px;">${url}</p>
          </div>
        </body></html>`,
        { title: parsed.protocol + url },
      );
    } catch {
      this.contentRenderer?.renderError(
        'Unable to Load',
        `The URL "${url}" could not be parsed.`,
        url,
      );
    }
  }

  /**
   * Render internal pages (nova://, about:).
   */
  private renderSpecialPage(page: string, url: string): void {
    this.cleanupContentPanel();

    switch (page) {
      case 'about:blank':
        this.contentRenderer?.clear();
        break;

      case 'about:newtab':
      case 'nova://newtab':
        this.renderNewTabPage();
        break;

      case 'nova://settings':
      case 'about:settings':
        this.renderSettingsPanel();
        break;

      case 'nova://downloads':
        this.renderDownloadsPanel();
        break;

      case 'nova://research':
        this.renderResearchPanel();
        break;

      case 'nova://history':
        this.renderHistoryPanel();
        break;

      case 'nova://bookmarks':
        this.renderBookmarksPanel();
        break;

      default:
        this.contentRenderer?.renderHtml(
          `<html><body style="font-family:system-ui;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;background:#f8f9fa;">
            <div style="text-align:center;color:#5f6368;">
              <h2 style="margin:0 0 8px;">${this.browserName?.name ?? 'Nova Browser'}</h2>
              <p style="margin:0;">${page}</p>
            </div>
          </body></html>`,
          { title: page },
        );
        break;
    }
  }

  private renderSettingsPanel(): void {
    if (!this.contentArea) return;
    this.cleanupContentPanel();
    const container = document.createElement('div');
    container.style.cssText = 'width:100%;height:100%;';
    this.contentArea.appendChild(container);
    this.activeContentPanel = container;
    this.activeSettingsPage = new SettingsPage();
    this.activeSettingsPage.mount(container);
    if (this.settingsService) {
      this.settingsService.init(this.activeSettingsPage);
    }
  }

  private renderNewTabPage(): void {
    if (!this.contentArea) return;
    this.cleanupContentPanel();
    const container = document.createElement('div');
    container.style.cssText = 'width:100%;height:100%;';
    this.contentArea.appendChild(container);
    this.activeContentPanel = container;
    this.activeNewTabPage = new NewTabPage();

    const searchEngine = this.settingsService?.getString('defaultSearchEngine', 'google') ?? 'google';
    this.activeNewTabPage.setSearchEngine(searchEngine);

    this.activeNewTabPage.mount(container);

    this.activeNewTabPage.on('navigate', (event) => {
      if (event.url) this.navigate(event.url);
    });

    this.activeNewTabPage.on('tileAction', async (event) => {
      if (event.action === 'openInNewTab' && event.url) {
        this.createTab(event.url);
      } else if (event.action === 'remove' && event.url && this.bookmarkService) {
        const bm = await this.bookmarkService.getBookmarkByUrl(event.url);
        if (bm) await this.bookmarkService.removeBookmark(bm.id);
        await this.loadNewTabData();
      } else if (event.action === 'add' && event.url && event.title && this.bookmarkService) {
        await this.bookmarkService.addBookmark(event.title, event.url);
        await this.loadNewTabData();
      }
    });

    this.activeNewTabPage.on('searchEngineChanged', (event) => {
      if (event.engine) {
        this.settingsService?.setValue('defaultSearchEngine', event.engine);
      }
    });

    this.loadNewTabData();
  }

  private async loadNewTabData(): Promise<void> {
    if (!this.activeNewTabPage?.isMounted) return;
    try {
      const bookmarks = await this.bookmarkService?.getChildren() ?? [];
      this.activeNewTabPage.setBookmarks(bookmarks.filter(b => !b.folder && b.url));
      const frequent = await this.historyService?.getFrecents(8) ?? [];
      this.activeNewTabPage.setHistoryEntries(frequent);
    } catch {
      // Silently ignore — data sections will simply be empty
    }
  }

  /** Debounced live address-bar suggestions from real bookmark + history matches. */
  private updateAddressSuggestions(query: string): void {
    if (this.suggestTimer) clearTimeout(this.suggestTimer);

    const trimmed = query.trim();
    if (trimmed.length === 0) {
      this.addressBar?.setSuggestions([]);
      if (this.addressBar) this.addressBarView?.update(this.addressBar.state);
      return;
    }

    const seq = ++this.suggestSeq;
    this.suggestTimer = setTimeout(() => {
      void this.fetchAddressSuggestions(trimmed, seq);
    }, 150);
  }

  private async fetchAddressSuggestions(query: string, seq: number): Promise<void> {
    let urls: string[] = [];
    try {
      const [bookmarks, history] = await Promise.all([
        this.bookmarkService?.search(query) ?? Promise.resolve([]),
        this.historyService?.query({ query, maxResults: 6 }) ?? Promise.resolve({ entries: [], totalCount: 0, hasMore: false }),
      ]);
      const bookmarkUrls = bookmarks.filter(b => !b.folder && b.url).map(b => b.url!);
      const historyUrls = history.entries.map(e => e.url);
      urls = [...new Set([...bookmarkUrls, ...historyUrls])];
    } catch {
      urls = [];
    }

    // A newer keystroke's query already started — drop this stale result.
    if (seq !== this.suggestSeq) return;

    this.addressBar?.setSuggestions(urls);
    if (this.addressBar) this.addressBarView?.update(this.addressBar.state);
  }

  private renderDownloadsPanel(): void {
    if (!this.contentArea) return;
    this.cleanupContentPanel();
    const container = document.createElement('div');
    container.style.cssText = 'width:100%;height:100%;';
    this.contentArea.appendChild(container);
    this.activeContentPanel = container;
    this.activeDownloadsPage = new DownloadsPage();

    const items = this.downloadManager?.items ?? [];
    this.activeDownloadsPage.mount(container, items);

    if (this.downloadManager) {
      this.downloadsEventHandler = (event: { kind: string }) => {
        if (this.activeDownloadsPage && this.downloadManager) {
          this.activeDownloadsPage.updateItems(this.downloadManager.items);
        }
      };
      this.downloadManager.on('downloadCreated', this.downloadsEventHandler);
      this.downloadManager.on('downloadProgress', this.downloadsEventHandler);
      this.downloadManager.on('downloadCompleted', this.downloadsEventHandler);
      this.downloadManager.on('downloadFailed', this.downloadsEventHandler);
      this.downloadManager.on('downloadCancelled', this.downloadsEventHandler);
      this.downloadManager.on('downloadPaused', this.downloadsEventHandler);
    }

    this.activeDownloadsPage.on('downloadAction', async (event) => {
      if (!this.downloadManager || !event.downloadId) return;
      switch (event.action) {
        case 'pause': await this.downloadManager.pause(event.downloadId); break;
        case 'resume': await this.downloadManager.resume(event.downloadId); break;
        case 'cancel': await this.downloadManager.cancel(event.downloadId); break;
        case 'remove': await this.downloadManager.remove(event.downloadId); break;
        case 'openFile': break;
        case 'showInFolder': break;
      }
    });
  }

  private renderResearchPanel(): void {
    if (!this.contentArea) return;
    this.cleanupContentPanel();
    const container = document.createElement('div');
    container.style.cssText = 'width:100%;height:100%;';
    this.contentArea.appendChild(container);
    this.activeContentPanel = container;
    this.activeResearchPage = new ResearchPage();
    if (this.researchService) {
      this.activeResearchPage.setResearchService(this.researchService);
    }
    if (this.settingsService) {
      const maxSearches = this.settingsService.getNumber('researchMaxSearches', 10);
      const model = this.settingsService.getString('researchModel', undefined);
      const options: { maxSearches?: number; model?: string } = {};
      if (maxSearches !== 10) options.maxSearches = maxSearches;
      if (model) options.model = model;
      if (Object.keys(options).length > 0) {
        this.activeResearchPage.setResearchOptions(options);
      }
    }
    this.activeResearchPage.mount(container);

    this.activeResearchPage.on('externalNavigation', (event) => {
      if (event.url) this.navigate(event.url);
    });
  }

  private renderHistoryPanel(): void {
    if (!this.contentArea) return;
    this.cleanupContentPanel();
    const container = document.createElement('div');
    container.style.cssText = 'width:100%;height:100%;overflow-y:auto;font-family:var(--font-ui,system-ui,sans-serif);background:var(--bg-body,#060810);color:var(--text-primary,#fff);';
    this.contentArea.appendChild(container);
    this.activeContentPanel = container;

    // This panel (and Bookmarks below) used to hardcode a light desktop
    // theme (#fff/#202124/...) regardless of the app's actual dark-glass
    // theme every other page uses — a leftover from before that theme
    // existed. Now uses the same CSS custom properties as the toolbar/tab
    // strip/new-tab page, so it no longer looks like a different app.
    const header = document.createElement('div');
    header.style.cssText = 'display:flex;align-items:center;justify-content:space-between;gap:12px;padding:20px 24px 12px;position:sticky;top:0;background:var(--bg-body,#060810);z-index:1;border-bottom:1px solid var(--border-subtle,rgba(255,255,255,.06));';

    const title = document.createElement('h1');
    title.textContent = 'History';
    title.style.cssText = 'margin:0;font-size:20px;color:var(--text-primary,#fff);';
    header.appendChild(title);

    const searchInput = document.createElement('input');
    searchInput.type = 'search';
    searchInput.placeholder = 'Search history';
    searchInput.style.cssText = 'padding:8px 12px;border:1px solid var(--border-default,rgba(255,255,255,.1));border-radius:var(--radius-md,6px);font-size:14px;width:280px;max-width:50vw;outline:none;background:var(--bg-elevated,#161d30);color:var(--text-primary,#fff);';
    header.appendChild(searchInput);

    container.appendChild(header);

    const listContainer = document.createElement('div');
    listContainer.style.cssText = 'padding:0 24px;';
    container.appendChild(listContainer);

    const renderList = async () => {
      if (!this.historyService) return;
      const query = searchInput.value.trim();
      let entries;
      if (query) {
        const result = await this.historyService.query({ query, maxResults: 200 });
        entries = result.entries;
      } else {
        entries = await this.historyService.getRecent(200);
      }
      listContainer.innerHTML = '';
      if (entries.length === 0) {
        const empty = document.createElement('div');
        empty.style.cssText = 'text-align:center;padding:60px 20px;color:var(--text-tertiary,#8a87a3);';
        empty.innerHTML = '<div style="font-size:48px;margin-bottom:16px;">🕐</div><p>No history entries yet</p>';
        listContainer.appendChild(empty);
        return;
      }
      for (const entry of entries) {
        const row = document.createElement('div');
        row.style.cssText = 'display:flex;align-items:center;padding:10px 12px;border-bottom:1px solid var(--border-subtle,rgba(255,255,255,.06));cursor:pointer;gap:12px;border-radius:var(--radius-sm,4px);transition:background .1s;';
        row.addEventListener('mouseenter', () => { row.style.background = 'var(--bg-hover,rgba(255,255,255,.05))'; });
        row.addEventListener('mouseleave', () => { row.style.background = ''; });

        const favicon = document.createElement('div');
        favicon.style.cssText = 'width:16px;height:16px;border-radius:50%;background:var(--bg-elevated,#161d30);flex-shrink:0;';
        row.appendChild(favicon);

        const info = document.createElement('div');
        info.style.cssText = 'flex:1;min-width:0;';

        const titleEl = document.createElement('div');
        titleEl.style.cssText = 'font-size:14px;color:var(--text-primary,#fff);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
        titleEl.textContent = entry.title || entry.url;
        info.appendChild(titleEl);

        const urlEl = document.createElement('div');
        urlEl.style.cssText = 'font-size:12px;color:var(--text-secondary,#a6a3c4);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
        urlEl.textContent = entry.url;
        info.appendChild(urlEl);

        row.appendChild(info);

        const time = document.createElement('div');
        time.style.cssText = 'font-size:12px;color:var(--text-tertiary,#8a87a3);flex-shrink:0;white-space:nowrap;';
        time.textContent = new Date(entry.lastVisitTime).toLocaleString();
        row.appendChild(time);

        row.addEventListener('click', () => {
          void this.navigate(entry.url);
        });

        listContainer.appendChild(row);
      }
    };

    void renderList();
    searchInput.addEventListener('input', () => void renderList());
  }

  private renderBookmarksPanel(): void {
    if (!this.contentArea) return;
    this.cleanupContentPanel();
    const container = document.createElement('div');
    container.style.cssText = 'width:100%;height:100%;overflow-y:auto;font-family:var(--font-ui,system-ui,sans-serif);background:var(--bg-body,#060810);color:var(--text-primary,#fff);';
    this.contentArea.appendChild(container);
    this.activeContentPanel = container;

    const header = document.createElement('div');
    header.style.cssText = 'display:flex;align-items:center;justify-content:space-between;gap:12px;padding:20px 24px 12px;position:sticky;top:0;background:var(--bg-body,#060810);z-index:1;border-bottom:1px solid var(--border-subtle,rgba(255,255,255,.06));';

    const title = document.createElement('h1');
    title.textContent = 'Bookmarks';
    title.style.cssText = 'margin:0;font-size:20px;color:var(--text-primary,#fff);';
    header.appendChild(title);

    const searchInput = document.createElement('input');
    searchInput.type = 'search';
    searchInput.placeholder = 'Search bookmarks';
    searchInput.style.cssText = 'padding:8px 12px;border:1px solid var(--border-default,rgba(255,255,255,.1));border-radius:var(--radius-md,6px);font-size:14px;width:280px;max-width:50vw;outline:none;background:var(--bg-elevated,#161d30);color:var(--text-primary,#fff);';
    header.appendChild(searchInput);

    container.appendChild(header);

    const listContainer = document.createElement('div');
    listContainer.style.cssText = 'padding:0 24px;';
    container.appendChild(listContainer);

    const renderList = async () => {
      if (!this.bookmarkService) return;
      const query = searchInput.value.trim();
      let entries;
      if (query) {
        entries = await this.bookmarkService.search(query);
      } else {
        entries = await this.bookmarkService.getChildren(null);
      }
      listContainer.innerHTML = '';
      if (entries.length === 0) {
        const empty = document.createElement('div');
        empty.style.cssText = 'text-align:center;padding:60px 20px;color:var(--text-tertiary,#8a87a3);';
        empty.innerHTML = '<div style="font-size:48px;margin-bottom:16px;">⭐</div><p>No bookmarks yet</p><p style="font-size:13px;">Add bookmarks by clicking the star icon in the address bar</p>';
        listContainer.appendChild(empty);
        return;
      }
      for (const entry of entries) {
        const row = document.createElement('div');
        row.style.cssText = 'display:flex;align-items:center;padding:10px 12px;border-bottom:1px solid var(--border-subtle,rgba(255,255,255,.06));cursor:pointer;gap:12px;border-radius:var(--radius-sm,4px);transition:background .1s;';
        row.addEventListener('mouseenter', () => { row.style.background = 'var(--bg-hover,rgba(255,255,255,.05))'; });
        row.addEventListener('mouseleave', () => { row.style.background = ''; });

        const icon = document.createElement('div');
        icon.style.cssText = 'font-size:16px;width:20px;text-align:center;flex-shrink:0;';
        icon.textContent = entry.url ? '⭐' : '📁';
        row.appendChild(icon);

        const info = document.createElement('div');
        info.style.cssText = 'flex:1;min-width:0;';

        const titleEl = document.createElement('div');
        titleEl.style.cssText = 'font-size:14px;color:var(--text-primary,#fff);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
        titleEl.textContent = entry.title;
        info.appendChild(titleEl);

        if (entry.url) {
          const urlEl = document.createElement('div');
          urlEl.style.cssText = 'font-size:12px;color:var(--text-secondary,#a6a3c4);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
          urlEl.textContent = entry.url;
          info.appendChild(urlEl);
        }

        row.appendChild(info);

        // Used to be opacity:0 by default, revealed only on mouse hover —
        // invisible and undiscoverable on a touchscreen, which has no hover
        // state at all, so there was no way to see or tap this on mobile.
        // Now always visible at a lower opacity, full opacity on hover/press,
        // so it works the same way regardless of input method.
        const removeBtn = document.createElement('button');
        removeBtn.textContent = '×';
        removeBtn.setAttribute('aria-label', `Remove ${entry.title || 'bookmark'}`);
        removeBtn.style.cssText = 'border:none;background:none;cursor:pointer;font-size:20px;line-height:1;color:var(--text-tertiary,#8a87a3);padding:6px 8px;border-radius:var(--radius-sm,4px);opacity:.55;transition:opacity .15s,background .15s,color .15s;';
        removeBtn.addEventListener('mouseenter', () => { removeBtn.style.opacity = '1'; removeBtn.style.background = 'var(--bg-hover,rgba(255,255,255,.05))'; removeBtn.style.color = 'var(--text-danger,#f87171)'; });
        removeBtn.addEventListener('mouseleave', () => { removeBtn.style.opacity = '.55'; removeBtn.style.background = ''; removeBtn.style.color = 'var(--text-tertiary,#8a87a3)'; });
        removeBtn.addEventListener('click', async (e) => {
          e.stopPropagation();
          if (entry.id) await this.bookmarkService?.removeBookmark(entry.id);
          void renderList();
        });
        row.appendChild(removeBtn);

        if (entry.url) {
          row.addEventListener('click', () => {
            void this.navigate(entry.url!);
          });
        }

        listContainer.appendChild(row);
      }
    };

    void renderList();
    searchInput.addEventListener('input', () => void renderList());
  }

  private showPageContextMenu(bufX: number, bufY: number, viewX: number, viewY: number): void {
    if (!this.contextMenu) this.contextMenu = new ContextMenu();

    let target: ContextTarget | null = null;
    try {
      target = this.resolveContextTarget(bufX, bufY);
    } catch {
      target = null;
    }

    const items: ContextMenuItem[] = [
      { label: 'Back', icon: '◀', disabled: !this.toolbar?.state.canGoBack, action: () => this.goBack() },
      { label: 'Forward', icon: '▶', disabled: !this.toolbar?.state.canGoForward, action: () => this.goForward() },
      { label: 'Reload', icon: '↻', action: () => this.reload() },
    ];

    if (target?.linkUrl) {
      items.push(
        { separator: true },
        { label: 'Open Link in New Tab', icon: '＋', action: () => {
          this.tabManager?.createTab();
          void this.navigationBridge?.navigate(target!.linkUrl!);
          this.syncAll();
        }},
        { label: 'Copy Link Address', icon: '🔗', action: () => {
          void navigator.clipboard?.writeText(target!.linkUrl!).catch(() => {});
        }},
      );
    }

    if (target?.imageUrl) {
      items.push(
        { separator: true },
        { label: 'Copy Image Address', icon: '🖼️', action: () => {
          void navigator.clipboard?.writeText(target!.imageUrl!).catch(() => {});
        }},
      );
    }

    this.contextMenu.show(viewX, viewY, items);
  }

  private showMainMenu(x: number, y: number): void {
    if (!this.contextMenu) this.contextMenu = new ContextMenu();

    const items: ContextMenuItem[] = [
      { label: 'New Tab', icon: '＋', action: () => { this.tabManager?.createTab(); this.syncAll(); } },
      { separator: true },
      { label: 'Find in Page', icon: '🔍', action: () => this.showFindBar() },
      { label: 'Bookmarks', icon: '⭐', action: () => { void this.navigate('nova://bookmarks'); } },
      { label: 'History', icon: '🕘', action: () => { void this.navigate('nova://history'); } },
      {
        label: 'Downloads', icon: '⬇️', action: () => {
          // Downloads are natively owned on Android (a real file write via
          // the OS's own DownloadManager, tracked with pause/resume/share —
          // see NativeDownloader.kt) — the web-rendered nova://downloads
          // page has no idea those happened, so hand off to native instead
          // of navigating there. Desktop has no NovaStateBridge, so this
          // always falls through to the normal in-page navigation there.
          if (window.NovaStateBridge?.onDownloadsPageRequested) {
            window.NovaStateBridge.onDownloadsPageRequested();
          } else {
            void this.navigate('nova://downloads');
          }
        },
      },
      { separator: true },
      {
        label: this.incognitoManager?.isActive() ? 'Exit Incognito' : 'New Incognito Session',
        icon: '🕶️',
        action: () => {
          if (window.NovaStateBridge?.onIncognitoToggleRequested) {
            window.NovaStateBridge.onIncognitoToggleRequested();
          } else {
            this.setIncognitoExternal(!(this.incognitoManager?.isActive() ?? false));
          }
        },
      },
      { label: 'AI Research', icon: '🔎', action: () => { void this.navigate('nova://research'); } },
      { label: 'Settings', icon: '⚙️', action: () => { void this.navigate('nova://settings'); } },
    ];

    this.contextMenu.show(x, y, items);
  }

  private showTabContextMenu(tabId: string, x: number, y: number): void {
    if (!this.contextMenu) this.contextMenu = new ContextMenu();

    const tab = this.tabManager?.getTab(tabId);
    if (!tab) return;

    const items: ContextMenuItem[] = [
      { label: 'New Tab', icon: '＋', action: () => { this.tabManager?.createTab(); this.syncAll(); } },
      { separator: true },
      { label: tab.pinned ? 'Unpin Tab' : 'Pin Tab', icon: tab.pinned ? '🔓' : '📌', action: () => {
        this.tabManager?.setTabPinned(tabId, !tab.pinned);
        this.syncAll();
      }},
      { label: 'Reload', icon: '↻', action: () => { this.tabManager?.activateTab(tabId); this.reload(); } },
      { label: 'Duplicate', icon: '⧉', action: () => {
        const newTab = this.tabManager?.createTab();
        if (newTab && tab.url) {
          void this.navigationBridge?.navigate(tab.url);
        }
      }},
      { separator: true },
      { label: 'Close Tab', icon: '✕', action: () => {
        this.tabManager?.removeTab(tabId);
        if (this.tabManager && this.tabManager.count === 0) this.tabManager.createTab();
        this.syncAll();
      }},
      { label: 'Close Other Tabs', icon: '', action: () => {
        const tabs = this.tabManager?.tabs ?? [];
        for (const t of tabs) {
          if (t.id !== tabId) this.tabManager?.removeTab(t.id);
        }
        if (this.tabManager && this.tabManager.count === 0) this.tabManager.createTab();
        this.syncAll();
      }},
    ];

    this.contextMenu.show(x, y, items);
  }

  /**
   * Map a protocol scheme to a human-readable label for the status bar.
   */
  private getProtocolLabel(scheme: string): string {
    const labels: Record<string, string> = {
      'https:': 'HTTPS',
      'http:':  'HTTP',
      'ws:':    'WS',
      'wss:':   'WSS',
      'ftp:':   'FTP',
      'ftps:':  'FTPS',
      'sftp:':  'SFTP',
      'file:':  'FILE',
      'data:':  'DATA',
      'blob:':  'BLOB',
      'about:': 'ABOUT',
      'nova:':  'NOVA',
      'mailto:': 'MAILTO',
      'tel:':   'TEL',
      'sms:':   'SMS',
      'smsto:': 'SMS',
      'ssh:':   'SSH',
      'magnet:': 'MAGNET',
      'news:':  'NEWS',
      'nntp:':  'NNTP',
      'gopher:': 'GOPHER',
      'wais:':  'WAIS',
      // Gateway: Proxy
      'http-proxy:':  'HTTP-PROXY',
      'https-proxy:': 'HTTPS-PROXY',
      'socks4:':  'SOCKS4',
      'socks4a:': 'SOCKS4A',
      'socks5:':  'SOCKS5',
      'pac+http:':  'PAC',
      'pac+https:': 'PAC/TLS',
      'wpad:':    'WPAD',
      // Gateway: DNS
      'dns:':       'DNS',
      'dns+udp:':   'DNS/UDP',
      'dns+tcp:':   'DNS/TCP',
      'https+dns:': 'DoH',
      'tls+dns:':   'DoT',
      'quic+dns:':  'DoQ',
      'dnssec:':    'DNSSEC',
      'mdns:':      'mDNS',
      // Gateway: Tunnel
      'ssh-tunnel:': 'SSH-TUNNEL',
      'wg:':         'WIREGUARD',
      'openvpn:':    'OPENVPN',
      'ipsec:':      'IPSEC',
      'ikev2:':      'IKEV2',
      'l2tp:':       'L2TP',
      'gre:':        'GRE',
      'ipip:':       'IPIP',
      'vxlan:':      'VXLAN',
      'geneve:':     'GENEVE',
      '6to4:':       '6TO4',
      'isatap:':     'ISATAP',
      'teredo:':     'TEREDO',
      // Gateway: NAT
      'upnp:':     'UPnP',
      'nat-pmp:':  'NAT-PMP',
      'pcp:':      'PCP',
      'stun:':     'STUN',
      'stuns:':    'STUN/TLS',
      'turn:':     'TURN',
      'turns:':    'TURN/TLS',
      'ice:':      'ICE',
      // Gateway: Access
      'captive:':    'CAPTIVE',
      'radius:':     'RADIUS',
      'radiustls:':  'RADIUS/TLS',
      'tacacs:':     'TACACS+',
      'dot1x:':      '802.1X',
      'wispr:':      'WISPr',
      // Gateway: Load Balancer
      'health:':  'HEALTH',
      'consul:':  'CONSUL',
      // Gateway: CDN
      'cdn:':       'CDN',
      'cdn+push:':  'CDN-PUSH',
      'cdn+pull:':  'CDN-PULL',
      // Gateway: Discovery
      'ssdp:':    'SSDP',
      'bonjour:': 'BONJOUR',
      'avahi:':   'AVAHI',
      'dnssd:':   'DNS-SD',
    };
    return labels[scheme] ?? scheme.replace(':', '').toUpperCase();
  }

  /**
   * Determine whether a protocol scheme represents an encrypted connection.
   */
  private isSecureProtocol(scheme: string): boolean {
    const secureProtocols = new Set([
      'https:', 'wss:', 'ftps:', 'sftp:', 'ssh:',
      'file:', 'nova:', 'about:', 'data:', 'blob:',
      'mailto:', 'tel:', 'sms:', 'smsto:', 'magnet:',
      // Gateway: encrypted protocols
      'https-proxy:', 'pac+https:', 'tls+dns:', 'quic+dns:', 'https+dns:',
      'ssh-tunnel:', 'wg:', 'openvpn:', 'ipsec:', 'ikev2:', 'vxlan:', 'geneve:',
      'stuns:', 'turns:', 'captive:', 'radiustls:', 'tacacs:', 'wispr:',
      'consul:', 'cdn:', 'cdn+push:', 'cdn+pull:',
    ]);
    return secureProtocols.has(scheme);
  }

  reload(): void {
    this.navigationBridge?.reload();
  }

  goBack(): void {
    this.navigationBridge?.goBack();
  }

  goForward(): void {
    this.navigationBridge?.goForward();
  }

  stop(): void {
    this.navigationBridge?.stop();
  }

  private syncToolbar(): void {
    if (this.navigationBridge) {
      this.toolbar?.setCanGoBack(this.navigationBridge.canGoBack);
      this.toolbar?.setCanGoForward(this.navigationBridge.canGoForward);
    } else if (this.tabManager) {
      const tab = this.tabManager.activeTab;
      if (tab) {
        this.toolbar?.setCanGoBack(tab.canGoBack());
        this.toolbar?.setCanGoForward(tab.canGoForward());
      }
    }
    if (this.toolbar && this.toolbarView) {
      this.toolbarView.update(this.toolbar.state);
    }
  }

  private syncBookmarkBar(): void {
    this.bookmarkBarView?.update(this.bookmarkBar!.state);
  }

  private syncAll(): void {
    this.tabStrip?.syncWithManager();
    this.tabStripView?.update(this.tabStrip!.state);
    this.addressBarView?.update(this.addressBar!.state);
    this.syncToolbar();
    this.syncBookmarkBar();
    this.emitChromeState();
  }

  private emitChromeState(): void {
    if (this.chromeStateHandlers.size === 0) return;
    const snapshot = this.getChromeState();
    for (const handler of this.chromeStateHandlers) {
      try { handler(snapshot); } catch (err) {
        console.error('[BrowserWindowPage] onChromeState handler threw:', err);
      }
    }
  }

  onChromeState(handler: (snapshot: ChromeStateSnapshot) => void): void {
    this.chromeStateHandlers.add(handler);
  }

  offChromeState(handler: (snapshot: ChromeStateSnapshot) => void): void {
    this.chromeStateHandlers.delete(handler);
  }

  getChromeState(): ChromeStateSnapshot {
    const activeTabId = this.tabManager?.activeTabId ?? null;
    const currentTabs = this.tabManager?.tabs ?? [];
    const tabs = currentTabs.map((t) => ({
      id: t.id,
      url: t.url,
      title: t.title || t.url,
      active: t.id === activeTabId,
      pinned: t.pinned,
      loading: t.loading,
      error: this.tabErrors.get(t.id) ?? null,
    }));
    // Drop error entries for tabs that no longer exist (keeps the map bounded).
    if (this.tabErrors.size > 0) {
      const ids = new Set(currentTabs.map((t) => t.id));
      for (const id of [...this.tabErrors.keys()]) {
        if (!ids.has(id)) this.tabErrors.delete(id);
      }
    }
    return {
      tabs,
      activeTabId,
      addressValue: this.addressBar?.state.value ?? this.currentUrl,
      canGoBack: this.navigationBridge?.canGoBack ?? false,
      canGoForward: this.navigationBridge?.canGoForward ?? false,
      homeUrl: this.getHomeUrl(),
      searchTemplate: this.getSearchTemplate(),
      incognito: this.incognitoManager?.isActive() ?? false,
    };
  }

  /** Reads the `homePage` setting (fallback `about:blank`). */
  private getHomeUrl(): string {
    return this.settingsService?.getString('homePage', 'about:blank') || 'about:blank';
  }

  /** Resolves the `defaultSearchEngine` setting into a `%s` search URL template. */
  private getSearchTemplate(): string {
    const id = this.settingsService?.getString('defaultSearchEngine', 'google') || 'google';
    return SEARCH_URL_TEMPLATES[id] ?? SEARCH_URL_TEMPLATES.google;
  }

  createTab(url?: string): string {
    const tab = this.tabManager?.createTab(url);
    this.syncAll();
    return tab?.id ?? '';
  }

  closeTab(tabId: string): boolean {
    const result = this.tabManager?.removeTab(tabId) ?? false;
    this.syncAll();
    return result;
  }

  activateTabExternal(tabId: string): boolean {
    const result = this.tabManager?.activateTab(tabId) ?? false;
    this.navigationBridge?.syncFromActiveTab();
    this.syncAll();
    return result;
  }

  // ── Incognito (private browsing) ───────────────────────────────────────────

  setIncognitoExternal(enabled: boolean): void {
    if (!this.incognitoManager) this.incognitoManager = new IncognitoManager();
    if (enabled) {
      if (!this.incognitoManager.isActive()) this.incognitoManager.activate();
    } else {
      this.incognitoManager.deactivate();
    }
    this.syncAll();
  }

  isIncognito(): boolean {
    return this.incognitoManager?.isActive() ?? false;
  }

  // ── Context-menu (long-press) element resolution ───────────────────────────

  resolveContextTarget(x: number, y: number): ContextTarget | null {
    const layout: ILayoutEngine | null = this.browserEngine?.getPageLayoutEngine?.() ?? null;
    if (!layout) return null;
    const hit = layout.getElementAtPoint(x, y);
    if (!hit) return null;

    let link: DomElement | null = null;
    let image: DomElement | null = null;
    let node: DomElement | null = hit;
    let guard = 0;
    while (node && guard++ < 64) {
      const tag = node.tagName.toLowerCase();
      if (tag === 'a' && node.attributes.has('href')) link ??= node;
      if (tag === 'img' && node.attributes.has('src')) image ??= node;
      node = node.parent as DomElement | null;
    }
    if (!link && !image) return null;

    return {
      linkUrl: link ? this.resolveContextUrl(link.attributes.get('href')!) : null,
      linkText: link ? this.linkTextOf(link) : null,
      imageUrl: image ? this.resolveContextUrl(image.attributes.get('src')!) : null,
      imageAlt: image ? image.attributes.get('alt') ?? null : null,
    };
  }

  private resolveContextUrl(raw: string): string {
    try {
      return new URL(raw, this.currentUrl || undefined).href;
    } catch {
      return raw;
    }
  }

  /** Best-effort visible text of an anchor (deep-first text node scan, depth-capped). */
  private linkTextOf(el: DomElement): string | null {
    const parts: string[] = [];
    const walk = (node: DomNode, depth: number): void => {
      if (depth > 8 || parts.length > 32) return;
      if (node.nodeType === 'text') {
        const text = (node as DomTextNode).text;
        if (text.trim()) parts.push(text.trim());
      } else if (node.children) {
        for (const child of node.children) walk(child, depth + 1);
      }
    };
    walk(el, 0);
    const text = parts.join(' ').trim();
    return text.length > 0 ? text : (el.attributes.get('title') ?? null);
  }

  getActiveSettingsPage(): ISettingsPage | null {
    return this.activeSettingsPage;
  }

  setSettingsService(service: ISettingsService): void {
    this.settingsService = service;
  }

  setBrowserEngine(engine: IBrowserEngine): void {
    // Unsubscribe previous engine (a long-lived page may be re-wired). Optional
    // chaining keeps the call robust to hit-test-only fakes in tests.
    this.browserEngine?.off?.('pageLoadError', this.engineLoadErrorHandler);
    this.browserEngine?.off?.('pageLoadStarted', this.engineLoadStartedHandler);
    this.browserEngine?.off?.('consoleMessage', this.engineConsoleMessageHandler);
    this.browserEngine?.off?.('networkEntry', this.engineNetworkEntryHandler);
    this.browserEngine = engine;
    engine.on?.('pageLoadError', this.engineLoadErrorHandler);
    engine.on?.('pageLoadStarted', this.engineLoadStartedHandler);
    engine.on?.('consoleMessage', this.engineConsoleMessageHandler);
    engine.on?.('networkEntry', this.engineNetworkEntryHandler);
    this.syncNavigationPipeline();
  }

  setNavigationController(controller: INavigationController): void {
    this.navController = controller;
    this.syncNavigationPipeline();
  }

  setPaintEngine(engine: IPaintEngine): void {
    this.paintEngine = engine;
    this.syncNavigationPipeline();
  }

  /**
   * Build (or rebuild) the navigation pipeline — NavigationBridge +
   * NavigationFetcher — around the DI-provided NavigationController.
   *
   * The DI controller is wired to the BrowserEngine (which fetches on
   * navigationCommitted), the history service and CSP guards. mount() runs
   * before the DI setters, so it creates the pipeline with a local fallback
   * controller; once setNavigationController delivers the real controller we
   * dispose the stale pipeline and rebuild it so navigation events actually
   * reach the engine.
   */
  private syncNavigationPipeline(): void {
    const controller = this.navController ?? (this.localController ??= new NavigationController(this.parser));
    const hasBridge = !!this.navigationBridge;
    const needsFetcher = !!(this.browserEngine && this.paintEngine && this.contentRenderer);

    // Same controller and pipeline is complete — nothing to do.
    if (this.pipelineController === controller && hasBridge) {
      if (needsFetcher && !this.navigationFetcher) {
        this.navigationFetcher = new NavigationFetcher(
          this.browserEngine!,
          this.contentRenderer!,
          this.paintEngine!,
          controller,
          this.parser,
        );
        this.navigationFetcher.start();
      }
      return;
    }

    // Controller changed: dispose the stale pipeline before rebuilding.
    this.navigationFetcher?.dispose();
    this.navigationFetcher = null;
    this.navigationBridge?.dispose();
    this.navigationBridge = null;
    this.pipelineController = controller;

    if (this.tabManager && this.addressBar && this.toolbar) {
      this.navigationBridge = new NavigationBridge(
        controller,
        this.tabManager,
        this.addressBar,
        this.toolbar,
        this.statusBar,
      );
      // Re-render tab strip / toolbar / address bar after every successful
      // navigation (bridge-driven navigations bypass tabManager events).
      this.navigationBridge.on('urlNavigated', this.onBridgeUrlNavigated);
      // Also re-sync on loading start/end so pushed chrome-state snapshots
      // (e.g. to a native Android host) reflect the loading spinner promptly
      // instead of only updating on tab create/remove/activate/navigate. The
      // nav-state handler additionally records per-tab load errors for the
      // native error page.
      this.navigationBridge.on('navigationStarted', this.onBridgeNavState);
      this.navigationBridge.on('navigationCompleted', this.onBridgeNavState);
      this.navigationBridge.on('navigationFailed', this.onBridgeNavState);
      this.navigationBridge.on('urlNavigated', this.onBridgeNavState);
    }

    if (needsFetcher) {
      this.navigationFetcher = new NavigationFetcher(
        this.browserEngine!,
        this.contentRenderer!,
        this.paintEngine!,
        controller,
        this.parser,
      );
      this.navigationFetcher.start();
    }
  }

  setDownloadManager(manager: IDownloadManager): void {
    this.downloadManager = manager;
  }

  setBookmarkService(service: IBookmarkService): void {
    this.bookmarkService = service;
    // Sync the BookmarkBar model to use the same DI-registered service instance.
    this.bookmarkBar?.setService(service);
    const notify = () => this.emitLibraryChanged();
    service.on('bookmarkCreated', notify);
    service.on('bookmarkRemoved', notify);
    service.on('bookmarkUpdated', notify);
    service.on('bookmarkMoved', notify);
  }

  setHistoryService(service: IHistoryService): void {
    this.historyService = service;
    const notify = () => this.emitLibraryChanged();
    service.on('entryAdded', notify);
    service.on('entriesDeleted', notify);
    service.on('cleared', notify);
  }

  private emitLibraryChanged(): void {
    for (const handler of this.libraryChangedHandlers) {
      try { handler(); } catch (err) {
        console.error('[BrowserWindowPage] onLibraryChanged handler threw:', err);
      }
    }
  }

  onLibraryChanged(handler: () => void): void {
    this.libraryChangedHandlers.add(handler);
  }

  offLibraryChanged(handler: () => void): void {
    this.libraryChangedHandlers.delete(handler);
  }

  async listBookmarksExternal(): Promise<ReadonlyArray<{ id: string; title: string; url: string }>> {
    if (!this.bookmarkService) return [];
    const tree = await this.bookmarkService.getTree();
    const flat: Array<{ id: string; title: string; url: string }> = [];
    const walk = (nodes: readonly (typeof tree)[number][]): void => {
      for (const node of nodes) {
        if (!node.folder && node.url) flat.push({ id: node.id, title: node.title, url: node.url });
        if (node.children.length) walk(node.children);
      }
    };
    walk(tree);
    return flat;
  }

  async addBookmarkExternal(title: string, url: string): Promise<void> {
    await this.bookmarkService?.addBookmark(title, url);
  }

  async removeBookmarkExternal(id: string): Promise<void> {
    await this.bookmarkService?.removeBookmark(id);
  }

  async isBookmarkedExternal(url: string): Promise<boolean> {
    return (await this.bookmarkService?.isBookmarked(url)) ?? false;
  }

  async listHistoryExternal(maxResults = 200): Promise<ReadonlyArray<{ id: string; title: string; url: string; visitedAt: number }>> {
    if (!this.historyService) return [];
    const entries = await this.historyService.getRecent(maxResults);
    return entries.map((e) => ({ id: e.id, title: e.title, url: e.url, visitedAt: e.lastVisitTime }));
  }

  async removeHistoryEntryExternal(id: string): Promise<void> {
    await this.historyService?.deleteEntry(id);
  }

  async clearHistoryExternal(): Promise<void> {
    await this.historyService?.deleteAll();
  }

  setTrackerBlocker(blocker: ITrackerBlocker): void {
    this.diTrackerBlocker = blocker;
  }

  setAdBlocker(blocker: IAdBlocker): void {
    this.diAdBlocker = blocker;
  }

  setWindowControls(controls: IWindowControls): void {
    this.windowControls = controls;
  }

  setBrowserName(name: IBrowserName): void {
    this.browserName = name;
    // Update document title whenever the name changes
    name.onNameChanged((newName) => {
      document.title = newName;
    });
    document.title = name.name;
  }

  setResearchService(service: IResearchService): void {
    this.researchService = service;
  }

  private cleanupSettingsPage(): void {
    if (this.activeSettingsPage) {
      this.activeSettingsPage.dispose();
      this.activeSettingsPage = null;
    }
  }

  private cleanupDownloadsPage(): void {
    if (this.downloadsEventHandler && this.downloadManager) {
      this.downloadManager.off('downloadCreated', this.downloadsEventHandler);
      this.downloadManager.off('downloadProgress', this.downloadsEventHandler);
      this.downloadManager.off('downloadCompleted', this.downloadsEventHandler);
      this.downloadManager.off('downloadFailed', this.downloadsEventHandler);
      this.downloadManager.off('downloadCancelled', this.downloadsEventHandler);
      this.downloadManager.off('downloadPaused', this.downloadsEventHandler);
      this.downloadsEventHandler = null;
    }
    if (this.activeDownloadsPage) {
      this.activeDownloadsPage.unmount();
      this.activeDownloadsPage = null;
    }
  }

  private cleanupNewTabPage(): void {
    if (this.activeNewTabPage) {
      this.activeNewTabPage.dispose();
      this.activeNewTabPage = null;
    }
  }

  private cleanupResearchPage(): void {
    if (this.activeResearchPage) {
      this.activeResearchPage.dispose();
      this.activeResearchPage = null;
    }
  }

  private cleanupContentPanel(): void {
    this.cleanupSettingsPage();
    this.cleanupDownloadsPage();
    this.cleanupNewTabPage();
    this.cleanupResearchPage();
    this.activeContentPanel = null;
    // ContentRenderer may have left its own canvas/iframe/new-tab DOM in here
    // (e.g. the initial renderNewTab() call at mount, which never registers
    // with activeContentPanel) — clear the whole area so a special-page panel
    // never ends up stacked as a second child underneath it.
    if (this.contentArea) this.contentArea.innerHTML = '';
  }

  dispose(): void {
    void this.unmount();
  }
}

export { BrowserWindowPage, DEFAULT_PAGE_CONFIG };
export type { IBrowserWindowPage, BrowserWindowPageConfig };
