import type { IDisposable } from '../../app/dependency-container';
import type { ITabManager } from '../../browser/tabs/tab-manager';
import type { IDesktopLayout } from '../layout/desktop-layout';
import type { IAddressBar } from '../components/address-bar/address-bar';
import type { ITabStrip } from '../components/tab-strip/tab-strip';
import type { IBookmarkBar } from '../components/bookmark-bar/bookmark-bar';
import type { IStatusBar } from '../components/status-bar/status-bar';
import type { IToolbar } from '../components/toolbar/toolbar';
import type { ITrackerBlocker } from '../../browser/security/tracker-blocker';
import type { IAdBlocker } from '../../browser/security/ad-blocker';

import { TabManager } from '../../browser/tabs/tab-manager';
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
import { TrackerBlocker } from '../../browser/security/tracker-blocker';
import { AdBlocker } from '../../browser/security/ad-blocker';

interface BrowserWindowPageConfig {
  readonly containerId: string;
  readonly showDevtools: boolean;
  readonly showSidebar: boolean;
  readonly showBookmarkBar: boolean;
  readonly showMenuBar: boolean;
}

const DEFAULT_PAGE_CONFIG: BrowserWindowPageConfig = {
  containerId: 'browser-app',
  showDevtools: false,
  showSidebar: false,
  showBookmarkBar: true,
  showMenuBar: true,
};

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
}

class BrowserWindowPage implements IBrowserWindowPage {
  readonly config: BrowserWindowPageConfig;
  private tabManager: ITabManager | null = null;
  private layout: IDesktopLayout | null = null;
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

  constructor(config?: Partial<BrowserWindowPageConfig>) {
    this.config = { ...DEFAULT_PAGE_CONFIG, ...config };
  }

  get isMounted(): boolean { return this._mounted; }

  async mount(container: HTMLElement): Promise<void> {
    this.container = container;
    this.container.className = 'browser-window';
    this.container.style.cssText = 'display:flex;flex-direction:column;height:100%;width:100%;overflow:hidden;';

    this.layout = new DesktopLayout({
      showMenuBar: this.config.showMenuBar,
      showBookmarkBar: this.config.showBookmarkBar,
      showStatusBar: true,
    });
    this.layout.attach(this.container);

    const areas = this.layout.areas;

    this.tabManager = new TabManager();

    this.trackerBlocker = new TrackerBlocker();
    this.adBlocker = new AdBlocker();

    this.toolbar = new Toolbar();
    if (areas.toolbar) {
      this.toolbarView = new ToolbarView(this.toolbar);
      this.toolbarView.attach(areas.toolbar);
      this.toolbarView.setEventHandler((e) => {
        switch (e.kind) {
          case 'back': this.goBack(); break;
          case 'forward': this.goForward(); break;
          case 'reload': this.reload(); break;
          case 'stop': this.stop(); break;
          case 'shieldToggle':
            this.trackerBlocker?.setEnabled(e.enabled);
            this.adBlocker?.setEnabled(e.enabled);
            this.statusBar?.setStatus(e.enabled ? 'Shield enabled' : 'Shield disabled');
            break;
          case 'bookmarkAdd':
            if (this.tabManager?.activeTab) {
              const tab = this.tabManager.activeTab;
              this.bookmarkBar?.addBookmark(tab.title || tab.url, tab.url);
              this.syncBookmarkBar();
            }
            break;
        }
      });
    }

    this.tabStrip = new TabStrip(this.tabManager);
    if (areas.tabBar) {
      this.tabStripView = new TabStripView(this.tabStrip);
      this.tabStripView.attach(areas.tabBar);
      this.tabStripView.setEventHandler((e) => {
        switch (e.kind) {
          case 'tabSelected':
            this.tabManager?.activateTab(e.tabId);
            this.syncToolbar();
            break;
          case 'tabClosed':
            this.tabManager?.removeTab(e.tabId);
            if (this.tabManager && this.tabManager.count === 0) {
              this.tabManager.createTab();
            }
            this.syncAll();
            break;
          case 'newTabRequested':
            this.tabManager?.createTab();
            this.syncAll();
            break;
        }
      });
    }

    this.addressBar = new AddressBar();
    if (areas.toolbar) {
      this.addressBarView = new AddressBarView(this.addressBar);
      const addressSlot = areas.toolbar.querySelector('.address-bar-slot');
      if (addressSlot) {
        this.addressBarView.attach(addressSlot as HTMLElement);
        this.addressBarView.setEventHandler((e) => {
          if (e.kind === 'navigate' && 'url' in e) {
            void this.navigate(e.url);
          } else if (e.kind === 'reload') {
            this.reload();
          } else if (e.kind === 'stop') {
            this.stop();
          }
        });
      }
    }

    this.bookmarkBar = new BookmarkBar();
    if (areas.bookmarkBar) {
      this.bookmarkBarView = new BookmarkBarView(this.bookmarkBar);
      this.bookmarkBarView.attach(areas.bookmarkBar);
      this.bookmarkBarView.setEventHandler((e) => {
        if (e.kind === 'bookmarkClicked') {
          void this.navigate(e.bookmark.url);
        }
      });
    }

    this.statusBar = new StatusBar();
    if (areas.statusBar) {
      this.statusBarView = new StatusBarView(this.statusBar);
      this.statusBarView.attach(areas.statusBar);
      this.statusBarView.setEventHandler((e) => {
        if (e.kind === 'shieldClicked') {
          this.toolbar?.toggleShield();
        }
      });
    }

    this.tabManager.on('tabCreated', () => this.syncAll());
    this.tabManager.on('tabRemoved', () => this.syncAll());
    this.tabManager.on('tabActivated', () => this.syncAll());

    this.tabManager.createTab();

    if (areas.content) {
      this.renderNewTabPage(areas.content);
    }

    this._mounted = true;
  }

  async unmount(): Promise<void> {
    this.addressBarView?.dispose();
    this.tabStripView?.dispose();
    this.bookmarkBarView?.dispose();
    this.statusBarView?.dispose();
    this.toolbarView?.dispose();
    this.trackerBlocker?.dispose();
    this.adBlocker?.dispose();
    this.tabManager?.dispose();
    this.layout?.dispose();
    if (this.container) {
      this.container.innerHTML = '';
    }
    this.addressBarView = null;
    this.tabStripView = null;
    this.bookmarkBarView = null;
    this.statusBarView = null;
    this.toolbarView = null;
    this.trackerBlocker = null;
    this.adBlocker = null;
    this.tabManager = null;
    this.layout = null;
    this._mounted = false;
  }

  async navigate(url: string): Promise<void> {
    if (!this.container || !this.tabManager) return;
    const tab = this.tabManager.activeTab;
    if (!tab) return;

    this.addressBar?.setValue(url);
    this.toolbar?.setLoading(true);
    this.statusBar?.setStatus(`Loading ${url}...`);
    this.statusBar?.setUrl(url);

    tab.setUrl(url);
    tab.setLoading(true);

    await new Promise(r => setTimeout(r, 500));

    tab.setLoading(false);
    tab.setTitle(new URL(url.startsWith('http') ? url : `https://${url}`).hostname);

    this.toolbar?.setLoading(false);
    this.toolbar?.setCanGoBack(tab.canGoBack());
    this.toolbar?.setCanGoForward(tab.canGoForward());
    this.statusBar?.setStatus('Done');
    this.statusBar?.setSecure(url.startsWith('https'));
    this.syncAll();
  }

  reload(): void {
    if (!this.tabManager) return;
    const tab = this.tabManager.activeTab;
    if (tab) {
      this.toolbar?.setLoading(true);
      this.statusBar?.setStatus('Reloading...');
      setTimeout(() => {
        this.toolbar?.setLoading(false);
        this.statusBar?.setStatus('Done');
      }, 300);
    }
  }

  goBack(): void {
    this.statusBar?.setStatus('Going back...');
  }

  goForward(): void {
    this.statusBar?.setStatus('Going forward...');
  }

  stop(): void {
    this.toolbar?.setLoading(false);
    this.statusBar?.setStatus('Stopped');
  }

  private syncToolbar(): void {
    if (!this.tabManager) return;
    const tab = this.tabManager.activeTab;
    if (tab) {
      this.toolbar?.setCanGoBack(tab.canGoBack());
      this.toolbar?.setCanGoForward(tab.canGoForward());
    }
  }

  private syncBookmarkBar(): void {
    this.bookmarkBarView?.update(this.bookmarkBar!.state);
  }

  private syncAll(): void {
    this.tabStrip?.syncWithManager();
    this.tabStripView?.update(this.tabStrip!.state);
    this.syncToolbar();
    this.syncBookmarkBar();
  }

  private renderNewTabPage(contentArea: HTMLElement): void {
    contentArea.innerHTML = '';
    const placeholder = document.createElement('div');
    placeholder.className = 'webview-placeholder';
    placeholder.style.cssText = 'display:flex;flex-direction:column;align-items:center;justify-content:center;height:100%;padding:50px 20px;position:relative;overflow:hidden;';
    placeholder.innerHTML = `
      <div class="wv-logo" style="font-family:var(--font-display);font-size:42px;font-weight:700;letter-spacing:-.03em;margin-bottom:2px;background:linear-gradient(135deg,#f0eee6 0%,#9bb5ff 100%);-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text;">No<span>va</span></div>
      <div class="wv-sub" style="font-size:13px;color:var(--text-tertiary);margin-bottom:30px;letter-spacing:.3px;">Private & secure browsing</div>
      <div class="wv-search" style="display:flex;align-items:center;width:100%;max-width:440px;background:var(--bg-glass);border:.5px solid var(--border-default);border-radius:var(--radius-lg);padding:0 12px;margin-bottom:18px;transition:all var(--t-norm);backdrop-filter:blur(12px);">
        <span class="wv-search-icon" style="color:var(--text-tertiary);font-size:15px;margin-right:8px;">🔍</span>
        <input type="text" placeholder="Search the web..." style="flex:1;border:none;background:none;color:var(--text-primary);font-size:13px;padding:9px 0;outline:none;font-family:inherit;min-width:0;">
      </div>
    `;
    contentArea.appendChild(placeholder);
  }

  dispose(): void {
    void this.unmount();
  }
}

export { BrowserWindowPage, DEFAULT_PAGE_CONFIG };
export type { IBrowserWindowPage, BrowserWindowPageConfig };
