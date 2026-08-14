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
import type { IBrowserEngine } from '../../browser/engine/browser-engine';
import type { INavigationController } from '../../browser/navigation/navigation-controller';
import type { IPaintEngine } from '../../browser/rendering/paint-engine';
import type { IDownloadManager } from '../../browser/downloads/download-manager';
import type { IBookmarkService } from '../../browser/bookmarks/bookmark-services';
import type { IHistoryService } from '../../browser/history/history-service';

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
import { NavigationFetcher } from '../components/navigation-fetcher';
import { ContextMenu, type ContextMenuItem } from '../components/context-menu/context-menu';
import { SettingsPage } from './settings-page';
import { DownloadsPage } from './downloads-page';
import type { ISettingsPage } from './settings-page';
import type { ISettingsService } from '../../browser/storage/settings-service';
import type { IBrowserName } from '../../browser/config/browser-name';

interface BrowserWindowPageConfig {
  readonly containerId: string;
  readonly showDevtools: boolean;
  readonly showSidebar: boolean;
  readonly showBookmarkBar: boolean;
  readonly showMenuBar: boolean;
  /**
   * When true, the page's own toolbar/tab-strip/bookmark-bar DOM is mounted
   * (so all the existing internal wiring — navigationBridge, syncAll(), tab
   * events — keeps working exactly as before) but hidden via CSS. Used when
   * an external native shell (e.g. the Android Compose chrome) is driving
   * navigation instead — see onChromeState()/createTab()/etc. below. Content
   * rendering is completely unaffected either way.
   */
  readonly hideChromeUI: boolean;
}

const DEFAULT_PAGE_CONFIG: BrowserWindowPageConfig = {
  containerId: 'browser-app',
  showDevtools: false,
  showSidebar: false,
  showBookmarkBar: true,
  showMenuBar: true,
  hideChromeUI: false,
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
  }>;
  readonly activeTabId: string | null;
  readonly addressValue: string;
  readonly canGoBack: boolean;
  readonly canGoForward: boolean;
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
  setBrowserName(name: IBrowserName): void;

  // ── External chrome bridge (native shells driving this page's tabs/nav) ────
  /** Push-based state: fires on every syncAll() (tab created/removed/activated, url changed, etc). */
  onChromeState(handler: (snapshot: ChromeStateSnapshot) => void): void;
  offChromeState(handler: (snapshot: ChromeStateSnapshot) => void): void;
  /** Pull-based: get the current state without waiting for the next change. */
  getChromeState(): ChromeStateSnapshot;
  createTab(url?: string): string;
  closeTab(tabId: string): boolean;
  activateTabExternal(tabId: string): boolean;
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
  private contentArea: HTMLElement | null = null;
  private currentUrl = '';
  private contentNavigateHandler: ((e: Event) => void) | null = null;
  private activeSettingsPage: ISettingsPage | null = null;
  private activeDownloadsPage: DownloadsPage | null = null;
  private activeContentPanel: HTMLElement | null = null;
  private settingsService: ISettingsService | null = null;
  private navigationBridge: INavigationBridge | null = null;
  private navigationFetcher: NavigationFetcher | null = null;
  private pipelineController: INavigationController | null = null;
  private localController: INavigationController | null = null;
  private readonly onBridgeUrlNavigated = () => { this.syncAll(); };
  private readonly onBridgeLoadingChanged = () => { this.syncAll(); };

  // DI-injected services
  private browserEngine: IBrowserEngine | null = null;
  private navController: INavigationController | null = null;
  private paintEngine: IPaintEngine | null = null;
  private downloadManager: IDownloadManager | null = null;
  private bookmarkService: IBookmarkService | null = null;
  private historyService: IHistoryService | null = null;
  private browserName: IBrowserName | null = null;
  private diTrackerBlocker: ITrackerBlocker | null = null;
  private diAdBlocker: IAdBlocker | null = null;
  private downloadsEventHandler: ((event: { kind: string }) => void) | null = null;
  private historyEventHandler: ((event: { kind: string }) => void) | null = null;
  private bookmarkEventHandler: ((event: { kind: string }) => void) | null = null;
  private contextMenu: ContextMenu | null = null;
  private tabSessionBridge: TabSessionBridge | null = null;
  private tabPersistence: TabPersistenceManager | null = null;
  private contextManager: TabContextManager | null = null;
  private readonly chromeStateHandlers = new Set<(snapshot: ChromeStateSnapshot) => void>();

  constructor(config?: Partial<BrowserWindowPageConfig>) {
    this.config = { ...DEFAULT_PAGE_CONFIG, ...config };
    this.parser = new UrlParser();
  }

  get isMounted(): boolean { return this._mounted; }

  async mount(container: HTMLElement): Promise<void> {
    this.container = container;
    this.container.className = 'browser-window';
    this.container.style.cssText = 'display:flex;flex-direction:column;height:100%;width:100%;overflow:hidden;';

    // Detect mobile viewport: use MobileLayout when width < 768px
    const isMobile = typeof window !== 'undefined' && window.innerWidth < 768;
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
        this.toolbarView = new ToolbarView(this.toolbar);
        this.toolbarView.attach(areas.toolbar);
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
      if (this.config.hideChromeUI) {
        // Keep all internal wiring (navigationBridge, syncAll, tab events)
        // fully intact — just hide the rendered chrome, since an external
        // native shell (e.g. Android Compose) is driving navigation instead.
        if (areas.toolbar) areas.toolbar.style.display = 'none';
        if (areas.tabBar) areas.tabBar.style.display = 'none';
        if (areas.bookmarkBar) areas.bookmarkBar.style.display = 'none';
      }
      if (areas.statusBar) {
        this.statusBarView = new StatusBarView(this.statusBar);
        this.statusBarView.attach(areas.statusBar);
        this.statusBarView.setEventHandler((e) => {
          if (e.kind === 'shieldClicked') {
            this.toolbar?.toggleShield();
          } else if (e.kind === 'zoomChanged') {
            this.statusBar?.setZoom(e.zoom);
          }
        });
      }
    }

    this.tabManager.on('tabCreated', () => this.syncAll());
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

    // Wire address bar keyboard shortcuts.
    this.addressBarView?.setNavigationCallbacks({
      onBack: () => this.goBack(),
      onForward: () => this.goForward(),
      onReload: () => this.reload(),
      onStop: () => this.stop(),
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

    this._mounted = true;
  }

  async unmount(): Promise<void> {
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

      case 'nova://settings':
      case 'about:settings':
        this.renderSettingsPanel();
        break;

      case 'nova://downloads':
        this.renderDownloadsPanel();
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

  private renderHistoryPanel(): void {
    if (!this.contentArea) return;
    this.cleanupContentPanel();
    const container = document.createElement('div');
    container.style.cssText = 'width:100%;height:100%;overflow-y:auto;font-family:system-ui,-apple-system,sans-serif;';
    this.contentArea.appendChild(container);
    this.activeContentPanel = container;

    const header = document.createElement('div');
    header.style.cssText = 'display:flex;align-items:center;justify-content:space-between;padding:20px 24px 12px;position:sticky;top:0;background:#fff;z-index:1;border-bottom:1px solid #e8eaed;';

    const title = document.createElement('h1');
    title.textContent = 'History';
    title.style.cssText = 'margin:0;font-size:20px;color:#202124;';
    header.appendChild(title);

    const searchInput = document.createElement('input');
    searchInput.type = 'search';
    searchInput.placeholder = 'Search history';
    searchInput.style.cssText = 'padding:8px 12px;border:1px solid #dfe1e5;border-radius:8px;font-size:14px;width:280px;outline:none;';
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
        empty.style.cssText = 'text-align:center;padding:60px 20px;color:#9aa0a6;';
        empty.innerHTML = '<div style="font-size:48px;margin-bottom:16px;">🕐</div><p>No history entries yet</p>';
        listContainer.appendChild(empty);
        return;
      }
      for (const entry of entries) {
        const row = document.createElement('div');
        row.style.cssText = 'display:flex;align-items:center;padding:10px 12px;border-bottom:1px solid #f1f3f4;cursor:pointer;gap:12px;';
        row.addEventListener('mouseenter', () => { row.style.background = '#f8f9fa'; });
        row.addEventListener('mouseleave', () => { row.style.background = ''; });

        const favicon = document.createElement('div');
        favicon.style.cssText = 'width:16px;height:16px;border-radius:50%;background:#e8eaed;flex-shrink:0;';
        row.appendChild(favicon);

        const info = document.createElement('div');
        info.style.cssText = 'flex:1;min-width:0;';

        const titleEl = document.createElement('div');
        titleEl.style.cssText = 'font-size:14px;color:#202124;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
        titleEl.textContent = entry.title || entry.url;
        info.appendChild(titleEl);

        const urlEl = document.createElement('div');
        urlEl.style.cssText = 'font-size:12px;color:#5f6368;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
        urlEl.textContent = entry.url;
        info.appendChild(urlEl);

        row.appendChild(info);

        const time = document.createElement('div');
        time.style.cssText = 'font-size:12px;color:#9aa0a6;flex-shrink:0;white-space:nowrap;';
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
    container.style.cssText = 'width:100%;height:100%;overflow-y:auto;font-family:system-ui,-apple-system,sans-serif;';
    this.contentArea.appendChild(container);
    this.activeContentPanel = container;

    const header = document.createElement('div');
    header.style.cssText = 'display:flex;align-items:center;justify-content:space-between;padding:20px 24px 12px;position:sticky;top:0;background:#fff;z-index:1;border-bottom:1px solid #e8eaed;';

    const title = document.createElement('h1');
    title.textContent = 'Bookmarks';
    title.style.cssText = 'margin:0;font-size:20px;color:#202124;';
    header.appendChild(title);

    const searchInput = document.createElement('input');
    searchInput.type = 'search';
    searchInput.placeholder = 'Search bookmarks';
    searchInput.style.cssText = 'padding:8px 12px;border:1px solid #dfe1e5;border-radius:8px;font-size:14px;width:280px;outline:none;';
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
        empty.style.cssText = 'text-align:center;padding:60px 20px;color:#9aa0a6;';
        empty.innerHTML = '<div style="font-size:48px;margin-bottom:16px;">⭐</div><p>No bookmarks yet</p><p style="font-size:13px;">Add bookmarks by clicking the star icon in the address bar</p>';
        listContainer.appendChild(empty);
        return;
      }
      for (const entry of entries) {
        const row = document.createElement('div');
        row.style.cssText = 'display:flex;align-items:center;padding:10px 12px;border-bottom:1px solid #f1f3f4;cursor:pointer;gap:12px;';
        row.addEventListener('mouseenter', () => { row.style.background = '#f8f9fa'; });
        row.addEventListener('mouseleave', () => { row.style.background = ''; });

        const icon = document.createElement('div');
        icon.style.cssText = 'font-size:16px;width:20px;text-align:center;flex-shrink:0;';
        icon.textContent = entry.url ? '⭐' : '📁';
        row.appendChild(icon);

        const info = document.createElement('div');
        info.style.cssText = 'flex:1;min-width:0;';

        const titleEl = document.createElement('div');
        titleEl.style.cssText = 'font-size:14px;color:#202124;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
        titleEl.textContent = entry.title;
        info.appendChild(titleEl);

        if (entry.url) {
          const urlEl = document.createElement('div');
          urlEl.style.cssText = 'font-size:12px;color:#5f6368;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
          urlEl.textContent = entry.url;
          info.appendChild(urlEl);
        }

        row.appendChild(info);

        const removeBtn = document.createElement('button');
        removeBtn.textContent = '×';
        removeBtn.style.cssText = 'border:none;background:none;cursor:pointer;font-size:18px;color:#9aa0a6;padding:4px;opacity:0;transition:opacity 0.15s;';
        removeBtn.addEventListener('mouseenter', () => { removeBtn.style.opacity = '1'; });
        removeBtn.addEventListener('mouseleave', () => { removeBtn.style.opacity = '0'; });
        row.addEventListener('mouseenter', () => { removeBtn.style.opacity = '0.6'; });
        row.addEventListener('mouseleave', () => { removeBtn.style.opacity = '0'; });
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
    const tabs = (this.tabManager?.tabs ?? []).map((t) => ({
      id: t.id,
      url: t.url,
      title: t.title || t.url,
      active: t.id === this.tabManager?.activeTabId,
      pinned: t.pinned,
      loading: t.loading,
    }));
    return {
      tabs,
      activeTabId: this.tabManager?.activeTabId ?? null,
      addressValue: this.addressBar?.state.value ?? this.currentUrl,
      canGoBack: this.navigationBridge?.canGoBack ?? false,
      canGoForward: this.navigationBridge?.canGoForward ?? false,
    };
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

  getActiveSettingsPage(): ISettingsPage | null {
    return this.activeSettingsPage;
  }

  setSettingsService(service: ISettingsService): void {
    this.settingsService = service;
  }

  setBrowserEngine(engine: IBrowserEngine): void {
    this.browserEngine = engine;
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
      // instead of only updating on tab create/remove/activate/navigate.
      this.navigationBridge.on('navigationStarted', this.onBridgeLoadingChanged);
      this.navigationBridge.on('navigationCompleted', this.onBridgeLoadingChanged);
      this.navigationBridge.on('navigationFailed', this.onBridgeLoadingChanged);
    }

    if (needsFetcher) {
      this.navigationFetcher = new NavigationFetcher(
        this.browserEngine!,
        this.contentRenderer!,
        this.paintEngine!,
        controller,
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
  }

  setHistoryService(service: IHistoryService): void {
    this.historyService = service;
  }

  setTrackerBlocker(blocker: ITrackerBlocker): void {
    this.diTrackerBlocker = blocker;
  }

  setAdBlocker(blocker: IAdBlocker): void {
    this.diAdBlocker = blocker;
  }

  setBrowserName(name: IBrowserName): void {
    this.browserName = name;
    // Update document title whenever the name changes
    name.onNameChanged((newName) => {
      document.title = newName;
    });
    document.title = name.name;
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

  private cleanupContentPanel(): void {
    this.cleanupSettingsPage();
    this.cleanupDownloadsPage();
    if (this.activeContentPanel) {
      this.activeContentPanel.remove();
      this.activeContentPanel = null;
    }
  }

  dispose(): void {
    void this.unmount();
  }
}

export { BrowserWindowPage, DEFAULT_PAGE_CONFIG };
export type { IBrowserWindowPage, BrowserWindowPageConfig };
