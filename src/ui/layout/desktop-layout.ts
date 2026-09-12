import type { IDisposable } from '../../app/dependency-container';

interface DesktopLayoutConfig {
  readonly showMenuBar: boolean;
  readonly showBookmarkBar: boolean;
  readonly showStatusBar: boolean;
  readonly defaultWidth: number;
  readonly defaultHeight: number;
  readonly minWidth: number;
  readonly minHeight: number;
  /** Brand name shown in the window title bar (centered label). */
  readonly brandName?: string;
}

const DEFAULT_DESKTOP_CONFIG: DesktopLayoutConfig = {
  showMenuBar: true,
  showBookmarkBar: false,
  showStatusBar: true,
  defaultWidth: 1280,
  defaultHeight: 720,
  minWidth: 400,
  minHeight: 300,
  brandName: 'Nova Browser',
};

interface DesktopLayoutAreas {
  readonly titleBar: HTMLElement | null;
  readonly toolbar: HTMLElement | null;
  readonly tabBar: HTMLElement | null;
  readonly bookmarkBar: HTMLElement | null;
  readonly content: HTMLElement | null;
  readonly statusBar: HTMLElement | null;
  readonly sidebar: HTMLElement | null;
  readonly devtools: HTMLElement | null;
}

type DesktopLayoutEventType = 'resized' | 'sidebarToggled' | 'devtoolsToggled';

interface DesktopLayoutEvent {
  readonly kind: DesktopLayoutEventType;
  readonly data: Readonly<Record<string, unknown>>;
}

interface IDesktopLayout extends IDisposable {
  readonly config: DesktopLayoutConfig;
  readonly areas: DesktopLayoutAreas;
  readonly isSidebarOpen: boolean;
  readonly isDevtoolsOpen: boolean;

  attach(container: HTMLElement): void;
  detach(): void;
  toggleSidebar(): void;
  toggleDevtools(): void;
  resize(width: number, height: number): void;
  getContentSize(): { width: number; height: number };
  on(type: DesktopLayoutEventType, handler: (event: DesktopLayoutEvent) => void): void;
  off(type: DesktopLayoutEventType, handler: (event: DesktopLayoutEvent) => void): void;
}

type DesktopLayoutEventHandler = (event: DesktopLayoutEvent) => void;

class DesktopLayoutEventBus {
  private readonly channels = new Map<DesktopLayoutEventType, Set<DesktopLayoutEventHandler>>();

  on(type: DesktopLayoutEventType, handler: DesktopLayoutEventHandler): void {
    if (!this.channels.has(type)) this.channels.set(type, new Set());
    this.channels.get(type)!.add(handler);
  }

  off(type: DesktopLayoutEventType, handler: DesktopLayoutEventHandler): void {
    this.channels.get(type)?.delete(handler);
  }

  emit(event: DesktopLayoutEvent): void {
    const handlers = this.channels.get(event.kind);
    if (!handlers) return;
    for (const h of handlers) {
      try { h(event); } catch (err) {
        console.error(`[DesktopLayout] Handler threw on "${event.kind}":`, err);
      }
    }
  }

  dispose(): void { this.channels.clear(); }
}

class DesktopLayout implements IDesktopLayout {
  readonly config: DesktopLayoutConfig;
  private readonly bus = new DesktopLayoutEventBus();
  private container: HTMLElement | null = null;

  private _titleBar: HTMLElement | null = null;
  private _toolbar: HTMLElement | null = null;
  private _tabBar: HTMLElement | null = null;
  private _bookmarkBar: HTMLElement | null = null;
  private _content: HTMLElement | null = null;
  private _statusBar: HTMLElement | null = null;
  private _sidebar: HTMLElement | null = null;
  private _devtools: HTMLElement | null = null;
  private _sidebarOpen = false;
  private _devtoolsOpen = false;

  constructor(config?: Partial<DesktopLayoutConfig>) {
    this.config = { ...DEFAULT_DESKTOP_CONFIG, ...config };
  }

  get areas(): DesktopLayoutAreas {
    return {
      titleBar: this._titleBar,
      toolbar: this._toolbar,
      tabBar: this._tabBar,
      bookmarkBar: this._bookmarkBar,
      content: this._content,
      statusBar: this._statusBar,
      sidebar: this._sidebar,
      devtools: this._devtools,
    };
  }

  get isSidebarOpen(): boolean { return this._sidebarOpen; }
  get isDevtoolsOpen(): boolean { return this._devtoolsOpen; }

  attach(container: HTMLElement): void {
    this.container = container;
    this.container.className = 'desktop-layout';
    this.build();
  }

  detach(): void {
    if (this.container) {
      this.container.innerHTML = '';
      this.container = null;
    }
    this._titleBar = null;
    this._toolbar = null;
    this._tabBar = null;
    this._bookmarkBar = null;
    this._content = null;
    this._statusBar = null;
    this._sidebar = null;
    this._devtools = null;
  }

  toggleSidebar(): void {
    this._sidebarOpen = !this._sidebarOpen;
    if (this._sidebar) {
      this._sidebar.classList.toggle('open', this._sidebarOpen);
    }
    this.bus.emit({ kind: 'sidebarToggled', data: { open: this._sidebarOpen } });
  }

  toggleDevtools(): void {
    this._devtoolsOpen = !this._devtoolsOpen;
    if (this._devtools) {
      this._devtools.style.display = this._devtoolsOpen ? 'flex' : 'none';
    }
    this.bus.emit({ kind: 'devtoolsToggled', data: { open: this._devtoolsOpen } });
  }

  resize(width: number, height: number): void {
    if (this.container) {
      this.container.style.width = `${width}px`;
      this.container.style.height = `${height}px`;
    }
    this.bus.emit({ kind: 'resized', data: { width, height } });
  }

  getContentSize(): { width: number; height: number } {
    if (!this._content) return { width: 0, height: 0 };
    return {
      width: this._content.clientWidth,
      height: this._content.clientHeight,
    };
  }

  on(type: DesktopLayoutEventType, handler: DesktopLayoutEventHandler): void {
    this.bus.on(type, handler);
  }

  off(type: DesktopLayoutEventType, handler: DesktopLayoutEventHandler): void {
    this.bus.off(type, handler);
  }

  private build(): void {
    if (!this.container) return;

    const chrome = document.createElement('div');
    chrome.className = 'nova-chrome';

    this._titleBar = this.createChildSection('nova-titlebar', chrome);
    this.buildTitleBar(this._titleBar);

    this._tabBar = this.createChildSection('nova-tabbar', chrome);

    this._toolbar = this.createChildSection('nova-navbar', chrome);

    if (this.config.showBookmarkBar) {
      this._bookmarkBar = this.createChildSection('nova-bookbar', chrome);
    }

    this.container.appendChild(chrome);

    const mainArea = document.createElement('div');
    mainArea.className = 'nova-content-area';
    mainArea.style.cssText = 'display:flex;flex:1;overflow:hidden;position:relative;';

    this._sidebar = document.createElement('div');
    this._sidebar.className = 'nova-sidebar';
    mainArea.appendChild(this._sidebar);

    this._content = document.createElement('div');
    this._content.className = 'content-area';
    this._content.style.cssText = 'flex:1;overflow:auto;position:relative;';
    mainArea.appendChild(this._content);

    this.container.appendChild(mainArea);

    this._devtools = document.createElement('div');
    this._devtools.className = 'devtools';
    this._devtools.style.cssText = 'display:none;height:300px;flex-shrink:0;';

    if (this.config.showStatusBar) {
      this._statusBar = this.createSection('nova-statusbar');
    }
  }

  /** Window chrome (title bar) built by the layout — no view model needed. */
  private buildTitleBar(el: HTMLElement): void {
    const wc = document.createElement('div');
    wc.className = 'nova-wc';
    for (const name of ['close', 'minimize', 'maximize']) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = `nova-wc-btn nova-wc-${name}`;
      btn.title = name === 'close' ? 'Close' : name === 'minimize' ? 'Minimize' : 'Maximize';
      wc.appendChild(btn);
    }
    el.appendChild(wc);

    const label = document.createElement('div');
    label.className = 'nova-titlebar-label';
    label.textContent = this.config.brandName ?? 'Nova Browser';
    el.appendChild(label);
  }

  private createSection(className: string): HTMLElement {
    const el = document.createElement('div');
    el.className = className;
    this.container?.appendChild(el);
    return el;
  }

  private createChildSection(className: string, parent: HTMLElement): HTMLElement {
    const el = document.createElement('div');
    el.className = className;
    parent.appendChild(el);
    return el;
  }

  dispose(): void {
    this.detach();
    this.bus.dispose();
  }
}

export { DesktopLayout, DEFAULT_DESKTOP_CONFIG, DesktopLayoutEventBus };
export type { IDesktopLayout, DesktopLayoutConfig, DesktopLayoutAreas, DesktopLayoutEvent, DesktopLayoutEventType };
