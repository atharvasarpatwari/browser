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
import type { IUrlParser } from '../../browser/navigation/url-parser';
import type { IContentRenderer } from '../components/content-renderer/content-renderer';
import type { SearchResult } from '../components/content-renderer/content-renderer';

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
import { UrlParser } from '../../browser/navigation/url-parser';
import { ContentRenderer } from '../components/content-renderer/content-renderer';

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

  private readonly parser: IUrlParser;
  private contentRenderer: IContentRenderer | null = null;
  private contentArea: HTMLElement | null = null;
  private currentUrl = '';
  private contentNavigateHandler: ((e: Event) => void) | null = null;

  constructor(config?: Partial<BrowserWindowPageConfig>) {
    this.config = { ...DEFAULT_PAGE_CONFIG, ...config };
    this.parser = new UrlParser();
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
          } else if (e.kind === 'search' && 'query' in e) {
            void this.navigate(e.query);
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
      this.contentArea = areas.content;
      this.contentRenderer = new ContentRenderer();
      this.contentRenderer.attach(areas.content);
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
    this.addressBarView?.dispose();
    this.tabStripView?.dispose();
    this.bookmarkBarView?.dispose();
    this.statusBarView?.dispose();
    this.toolbarView?.dispose();
    this.trackerBlocker?.dispose();
    this.adBlocker?.dispose();
    this.tabManager?.dispose();
    this.contentRenderer?.dispose();
    if (this.contentArea && this.contentNavigateHandler) {
      this.contentArea.removeEventListener('nova-navigate', this.contentNavigateHandler);
    }
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
    this.contentRenderer = null;
    this.contentArea = null;
    this.contentNavigateHandler = null;
    this.layout = null;
    this._mounted = false;
  }

  async navigate(url: string): Promise<void> {
    if (!this.container || !this.tabManager) return;
    const tab = this.tabManager.activeTab;
    if (!tab) return;

    this.currentUrl = url;
    this.toolbar?.setLoading(true);
    this.statusBar?.setStatus(`Loading ${url}...`);
    this.statusBar?.setUrl(url);
    tab.setLoading(true);

    // Show loading state in content area.
    this.contentRenderer?.renderLoading(url);

    // ── Search query detection ────────────────────────────────────────────
    if (this.parser.isSearchQuery(url)) {
      const searchUrl = this.parser.buildSearchUrl(url);
      const results = this.generateSearchResults(url);

      this.addressBar?.setValue(url);
      this.addressBar?.setLoading(false);

      const protocol = 'HTTPS';
      this.statusBar?.setProtocol(protocol);
      this.statusBar?.setSecure(true);
      this.statusBar?.setUrl(searchUrl);

      tab.setUrl(searchUrl);
      tab.setTitle(`${url} - Nova Search`);

      // Simulate brief network delay for realism.
      await new Promise(r => setTimeout(r, 150));

      this.contentRenderer?.renderSearchResults(url, searchUrl, results);

      this.toolbar?.setLoading(false);
      this.toolbar?.setCanGoBack(tab.canGoBack());
      this.toolbar?.setCanGoForward(tab.canGoForward());
      this.statusBar?.setStatus('Done');
      this.syncAll();
      return;
    }

    // ── URL navigation ────────────────────────────────────────────────────
    let normalizedUrl = url;
    try {
      normalizedUrl = this.parser.normalize(url);
    } catch {
      // If normalize fails, try with https:// prefix.
      if (!url.startsWith('http')) normalizedUrl = `https://${url}`;
    }

    this.addressBar?.setValue(url);

    // Determine protocol and security from the URL.
    let protocol = 'HTTPS';
    let isSecure = true;
    try {
      const urlObj = new URL(normalizedUrl);
      protocol = this.getProtocolLabel(urlObj.protocol);
      isSecure = this.isSecureProtocol(urlObj.protocol);
    } catch {
      protocol = 'HTTPS';
      isSecure = true;
    }

    this.statusBar?.setProtocol(protocol);
    this.statusBar?.setSecure(isSecure);

    tab.setUrl(normalizedUrl);

    try {
      const parsed = this.parser.parse(url);
      tab.setTitle(parsed.hostname || url);
    } catch {
      tab.setTitle(url);
    }

    // ── Render content based on URL type ──────────────────────────────────
    try {
      await this.renderUrlContent(normalizedUrl);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.contentRenderer?.renderError('Navigation Failed', message, normalizedUrl);
    }

    this.toolbar?.setLoading(false);
    this.toolbar?.setCanGoBack(tab.canGoBack());
    this.toolbar?.setCanGoForward(tab.canGoForward());
    this.statusBar?.setStatus('Done');
    this.syncAll();
  }

  /**
   * Render content based on the URL's protocol and type.
   */
  private async renderUrlContent(url: string): Promise<void> {
    try {
      const parsed = this.parser.parse(url);

      // Special pages: about:blank, nova://, etc.
      if (parsed.isSpecialPage) {
        if (parsed.normalized === 'about:blank') {
          this.contentRenderer?.clear();
        } else {
          this.contentRenderer?.renderHtml(
            `<html><body style="font-family:system-ui;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;background:#f8f9fa;">
              <div style="text-align:center;color:#5f6368;">
                <h2 style="margin:0 0 8px;">Nova Browser</h2>
                <p style="margin:0;">${parsed.normalized}</p>
              </div>
            </body></html>`,
            { title: parsed.normalized },
          );
        }
        return;
      }

      // Data URLs: render directly.
      if (parsed.protocol === 'data:') {
        this.contentRenderer?.renderHtml(
          `<html><body style="margin:0;"><iframe src="${url}" style="width:100%;height:100vh;border:none;"></iframe></body></html>`,
          { title: 'Data URL' },
        );
        return;
      }

      // File URLs: show file info.
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

      // HTTP/HTTPS: render a page with the URL info.
      if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
        this.contentRenderer?.renderHtml(
          `<html><body style="font-family:system-ui;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;background:#f8f9fa;">
            <div style="text-align:center;color:#5f6368;">
              <div style="font-size:48px;margin-bottom:16px;">🌐</div>
              <h2 style="margin:0 0 8px;">${parsed.hostname}</h2>
              <p style="margin:0 0 16px;word-break:break-all;max-width:500px;">${url}</p>
              <p style="margin:0;font-size:12px;color:#9aa0a6;">Page loaded via Nova Browser</p>
            </div>
          </body></html>`,
          { title: parsed.hostname || url },
        );
        return;
      }

      // All other protocols: show protocol info.
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
   * Generate search result entries for a given query.
   */
  private generateSearchResults(query: string): readonly SearchResult[] {
    const words = query.toLowerCase().split(/\s+/).filter(w => w.length > 0);
    const results: SearchResult[] = [];

    results.push({
      title: query,
      url: `https://duckduckgo.com/?q=${encodeURIComponent(query)}`,
      snippet: `Search for "${query}" on DuckDuckGo — the privacy-focused search engine that doesn't track you.`,
    });

    if (words.length <= 4) {
      results.push({
        title: `${query} — Wikipedia`,
        url: `https://en.wikipedia.org/wiki/${encodeURIComponent(query.replace(/\s+/g, '_'))}`,
        snippet: `Wikipedia article about ${query}. Read about the history, concepts, and related topics.`,
      });
    }

    const programmingTerms = ['javascript', 'python', 'typescript', 'html', 'css', 'react', 'node', 'api', 'database', 'sql', 'git', 'docker', 'algorithm', 'function', 'class', 'array', 'string', 'loop', 'variable', 'error', 'debug', 'test', 'deploy', 'server', 'client'];
    if (words.some(w => programmingTerms.includes(w))) {
      results.push({
        title: `${query} — Stack Overflow`,
        url: `https://stackoverflow.com/search?q=${encodeURIComponent(query)}`,
        snippet: `Questions and answers about ${query} on Stack Overflow, the largest developer community.`,
      });
    }

    const newsTerms = ['news', 'today', 'latest', 'recent', 'breaking', 'update', 'report'];
    if (words.some(w => newsTerms.includes(w))) {
      results.push({
        title: `${query} — Latest News`,
        url: `https://news.google.com/search?q=${encodeURIComponent(query)}`,
        snippet: `Get the latest news and updates about ${query} from sources around the world.`,
      });
    }

    const tutorialTerms = ['how', 'tutorial', 'guide', 'learn', 'example', 'setup', 'install', 'create', 'build', 'make'];
    if (words.some(w => tutorialTerms.includes(w))) {
      results.push({
        title: `${query} — Tutorial`,
        url: `https://www.google.com/search?q=${encodeURIComponent(query + ' tutorial')}`,
        snippet: `Step-by-step tutorial and guide for ${query}. Learn with examples and best practices.`,
      });
    }

    const shopTerms = ['buy', 'price', 'cheap', 'best', 'review', 'compare', 'deal'];
    if (words.some(w => shopTerms.includes(w))) {
      results.push({
        title: `${query} — Reviews & Prices`,
        url: `https://www.google.com/search?q=${encodeURIComponent(query + ' reviews')}`,
        snippet: `Compare prices, read reviews, and find the best deals for ${query}.`,
      });
    }

    results.push({
      title: `${query} — Documentation`,
      url: `https://developer.mozilla.org/search?q=${encodeURIComponent(query)}`,
      snippet: `Official documentation and reference materials for ${query}.`,
    });

    return results;
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

  dispose(): void {
    void this.unmount();
  }
}

export { BrowserWindowPage, DEFAULT_PAGE_CONFIG };
export type { IBrowserWindowPage, BrowserWindowPageConfig };
