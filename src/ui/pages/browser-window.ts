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
          if (e.bookmark.url) void this.navigate(e.bookmark.url);
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

    // Determine protocol and security from the URL.
    let protocol = 'HTTPS';
    let isSecure = true;
    try {
      const urlObj = new URL(url.startsWith('http') ? url : `https://${url}`);
      protocol = this.getProtocolLabel(urlObj.protocol);
      isSecure = this.isSecureProtocol(urlObj.protocol);
    } catch {
      // If URL parsing fails, assume HTTPS for bare input.
      protocol = 'HTTPS';
      isSecure = true;
    }

    this.statusBar?.setProtocol(protocol);
    this.statusBar?.setSecure(isSecure);

    tab.setUrl(url);
    tab.setLoading(true);

    await new Promise(r => setTimeout(r, 500));

    tab.setLoading(false);
    try {
      const hostname = new URL(url.startsWith('http') ? url : `https://${url}`).hostname;
      tab.setTitle(hostname);
    } catch {
      tab.setTitle(url);
    }

    this.toolbar?.setLoading(false);
    this.toolbar?.setCanGoBack(tab.canGoBack());
    this.toolbar?.setCanGoForward(tab.canGoForward());
    this.statusBar?.setStatus('Done');
    this.syncAll();
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
