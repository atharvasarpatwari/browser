import type { IDisposable } from '../../app/dependency-container';
import type { IAppShell } from '../../app/app-shell';
import type { IBrowserEngine } from '../../browser/engine/browser-engine';
import type { ITabManager } from '../../browser/tabs/tab-manager';
import type { IDesktopLayout } from '../layout/desktop-layout';
import type { IAddressBar } from '../components/address-bar/address-bar';

interface BrowserWindowPageConfig {
  readonly containerId: string;
  readonly showDevtools: boolean;
  readonly showSidebar: boolean;
}

const DEFAULT_PAGE_CONFIG: BrowserWindowPageConfig = {
  containerId: 'browser-app',
  showDevtools: false,
  showSidebar: false,
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
  private shell: IAppShell | null = null;
  private engine: IBrowserEngine | null = null;
  private tabManager: ITabManager | null = null;
  private layout: IDesktopLayout | null = null;
  private addressBar: IAddressBar | null = null;
  private container: HTMLElement | null = null;
  private _mounted = false;

  constructor(
    config?: Partial<BrowserWindowPageConfig>,
  ) {
    this.config = { ...DEFAULT_PAGE_CONFIG, ...config };
  }

  get isMounted(): boolean { return this._mounted; }

  async mount(container: HTMLElement): Promise<void> {
    this.container = container;
    this.container.className = 'browser-window';
    this.container.style.cssText = 'display:flex;flex-direction:column;height:100%;width:100%;overflow:hidden;background:#fff;';

    const titleBar = document.createElement('div');
    titleBar.className = 'window-title-bar';
    titleBar.style.cssText = 'display:flex;align-items:center;padding:4px 8px;background:#e8e8e8;border-bottom:1px solid #ccc;flex-shrink:0;gap:6px;';

    const trafficLights = document.createElement('div');
    trafficLights.style.cssText = 'display:flex;gap:4px;margin-right:8px;';
    for (const color of ['#ff5f56', '#ffbd2e', '#27c93f']) {
      const dot = document.createElement('span');
      dot.style.cssText = `width:10px;height:10px;border-radius:50%;background:${color};display:inline-block;`;
      trafficLights.appendChild(dot);
    }
    titleBar.appendChild(trafficLights);

    const navButtons = document.createElement('div');
    navButtons.style.cssText = 'display:flex;gap:2px;';
    const navActions = [
      { text: '◀', action: 'back' },
      { text: '▶', action: 'forward' },
      { text: '↻', action: 'reload' },
    ];
    for (const btn of navActions) {
      const el = document.createElement('button');
      el.textContent = btn.text;
      el.style.cssText = 'border:none;background:none;font-size:14px;cursor:pointer;padding:2px 6px;';
      el.addEventListener('click', () => {
        switch (btn.action) {
          case 'back': this.goBack(); break;
          case 'forward': this.goForward(); break;
          case 'reload': this.reload(); break;
        }
      });
      navButtons.appendChild(el);
    }
    titleBar.appendChild(navButtons);

    const addressInput = document.createElement('input');
    addressInput.type = 'text';
    addressInput.style.cssText = 'flex:1;margin:0 8px;padding:4px 8px;border:1px solid #ccc;border-radius:4px;font-size:13px;';
    addressInput.placeholder = 'Search or enter URL';
    addressInput.addEventListener('keydown', (e: KeyboardEvent) => {
      if (e.key === 'Enter') {
        const value = addressInput.value.trim();
        if (value) void this.navigate(value);
        addressInput.blur();
      }
    });
    titleBar.appendChild(addressInput);

    this.container.appendChild(titleBar);

    const webviewArea = document.createElement('div');
    webviewArea.className = 'webview-area';
    webviewArea.style.cssText = 'flex:1;overflow:auto;position:relative;background:#fff;display:flex;align-items:center;justify-content:center;';
    webviewArea.innerHTML = '<span style="color:#999;font-size:14px;">Page content will appear here</span>';
    this.container.appendChild(webviewArea);

    const statusBar = document.createElement('div');
    statusBar.className = 'status-bar';
    statusBar.style.cssText = 'height:22px;background:#e8e8e8;border-top:1px solid #ccc;display:flex;align-items:center;padding:0 8px;font-size:11px;color:#666;flex-shrink:0;';
    statusBar.textContent = 'Ready';
    this.container.appendChild(statusBar);

    this._mounted = true;
  }

  async unmount(): Promise<void> {
    if (this.container) {
      this.container.innerHTML = '';
    }
    this._mounted = false;
  }

  async navigate(url: string): Promise<void> {
    const addressInput = this.container?.querySelector('input[type="text"]') as HTMLInputElement;
    if (addressInput) addressInput.value = url;
    if (this.container) {
      const webview = this.container.querySelector('.webview-area');
      if (webview) {
        const status = this.container.querySelector('.status-bar');
        if (status) status.textContent = `Loading ${url}...`;
        webview.innerHTML = `<div style="padding:20px;text-align:center;color:#666;"><p>Navigating to:</p><p style="font-weight:bold;color:#333;">${url}</p></div>`;
        await new Promise(r => setTimeout(r, 500));
        if (status) status.textContent = 'Done';
      }
    }
  }

  reload(): void {
    const status = this.container?.querySelector('.status-bar');
    if (status) status.textContent = 'Reloading...';
    setTimeout(() => { if (status) status.textContent = 'Ready'; }, 300);
  }

  goBack(): void {
    const status = this.container?.querySelector('.status-bar');
    if (status) status.textContent = 'Going back...';
  }

  goForward(): void {
    const status = this.container?.querySelector('.status-bar');
    if (status) status.textContent = 'Going forward...';
  }

  stop(): void {
    const status = this.container?.querySelector('.status-bar');
    if (status) status.textContent = 'Stopped';
  }

  dispose(): void {
    void this.unmount();
  }
}

export { BrowserWindowPage, DEFAULT_PAGE_CONFIG };
export type { IBrowserWindowPage, BrowserWindowPageConfig };
