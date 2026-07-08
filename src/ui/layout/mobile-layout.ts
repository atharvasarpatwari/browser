import type { IDisposable } from '../../app/dependency-container';

interface MobileLayoutConfig {
  readonly showAddressBar: boolean;
  readonly showNavigationBar: boolean;
  readonly defaultWidth: number;
  readonly defaultHeight: number;
  readonly bottomNavHeight: number;
}

const DEFAULT_MOBILE_CONFIG: MobileLayoutConfig = {
  showAddressBar: true,
  showNavigationBar: true,
  defaultWidth: 375,
  defaultHeight: 812,
  bottomNavHeight: 50,
};

interface MobileLayoutAreas {
  readonly statusBar: HTMLElement | null;
  readonly addressBar: HTMLElement | null;
  readonly content: HTMLElement | null;
  readonly bottomNav: HTMLElement | null;
  readonly tabSwitcher: HTMLElement | null;
}

type MobileLayoutEventType = 'resized' | 'tabSwitcherToggled' | 'orientationChanged';

interface MobileLayoutEvent {
  readonly kind: MobileLayoutEventType;
  readonly data: Readonly<Record<string, unknown>>;
}

interface IMobileLayout extends IDisposable {
  readonly config: MobileLayoutConfig;
  readonly areas: MobileLayoutAreas;
  readonly isTabSwitcherOpen: boolean;
  readonly orientation: 'portrait' | 'landscape';

  attach(container: HTMLElement): void;
  detach(): void;
  toggleTabSwitcher(): void;
  resize(width: number, height: number): void;
  getContentSize(): { width: number; height: number };
  on(type: MobileLayoutEventType, handler: (event: MobileLayoutEvent) => void): void;
  off(type: MobileLayoutEventType, handler: (event: MobileLayoutEvent) => void): void;
}

type MobileLayoutEventHandler = (event: MobileLayoutEvent) => void;

class MobileLayoutEventBus {
  private readonly channels = new Map<MobileLayoutEventType, Set<MobileLayoutEventHandler>>();

  on(type: MobileLayoutEventType, handler: MobileLayoutEventHandler): void {
    if (!this.channels.has(type)) this.channels.set(type, new Set());
    this.channels.get(type)!.add(handler);
  }

  off(type: MobileLayoutEventType, handler: MobileLayoutEventHandler): void {
    this.channels.get(type)?.delete(handler);
  }

  emit(event: MobileLayoutEvent): void {
    const handlers = this.channels.get(event.kind);
    if (!handlers) return;
    for (const h of handlers) {
      try { h(event); } catch (err) {
        console.error(`[MobileLayout] Handler threw on "${event.kind}":`, err);
      }
    }
  }

  dispose(): void { this.channels.clear(); }
}

class MobileLayout implements IMobileLayout {
  readonly config: MobileLayoutConfig;
  private readonly bus = new MobileLayoutEventBus();
  private container: HTMLElement | null = null;

  private _statusBar: HTMLElement | null = null;
  private _addressBar: HTMLElement | null = null;
  private _content: HTMLElement | null = null;
  private _bottomNav: HTMLElement | null = null;
  private _tabSwitcher: HTMLElement | null = null;
  private _tabSwitcherOpen = false;
  private _orientation: 'portrait' | 'landscape' = 'portrait';

  constructor(config?: Partial<MobileLayoutConfig>) {
    this.config = { ...DEFAULT_MOBILE_CONFIG, ...config };
  }

  get areas(): MobileLayoutAreas {
    return {
      statusBar: this._statusBar,
      addressBar: this._addressBar,
      content: this._content,
      bottomNav: this._bottomNav,
      tabSwitcher: this._tabSwitcher,
    };
  }

  get isTabSwitcherOpen(): boolean { return this._tabSwitcherOpen; }
  get orientation(): 'portrait' | 'landscape' { return this._orientation; }

  attach(container: HTMLElement): void {
    this.container = container;
    this.container.className = 'mobile-layout';
    this.container.style.cssText = 'display:flex;flex-direction:column;height:100%;overflow:hidden;';
    this.build();
    this.updateOrientation();
  }

  detach(): void {
    if (this.container) {
      this.container.innerHTML = '';
      this.container = null;
    }
    this._statusBar = null;
    this._addressBar = null;
    this._content = null;
    this._bottomNav = null;
    this._tabSwitcher = null;
  }

  toggleTabSwitcher(): void {
    this._tabSwitcherOpen = !this._tabSwitcherOpen;
    if (this._tabSwitcher) {
      this._tabSwitcher.style.display = this._tabSwitcherOpen ? 'flex' : 'none';
    }
    if (this._content) {
      this._content.style.display = this._tabSwitcherOpen ? 'none' : 'flex';
    }
    this.bus.emit({ kind: 'tabSwitcherToggled', data: { open: this._tabSwitcherOpen } });
  }

  resize(width: number, height: number): void {
    if (this.container) {
      this.container.style.width = `${width}px`;
      this.container.style.height = `${height}px`;
    }
    this.updateOrientation();
    this.bus.emit({ kind: 'resized', data: { width, height } });
  }

  getContentSize(): { width: number; height: number } {
    if (!this._content) return { width: 0, height: 0 };
    const bottomNavH = this.config.showNavigationBar ? this.config.bottomNavHeight : 0;
    return {
      width: this._content.clientWidth,
      height: this.container
        ? this.container.clientHeight - bottomNavH - (this.config.showAddressBar ? 44 : 0) - 20
        : 0,
    };
  }

  on(type: MobileLayoutEventType, handler: MobileLayoutEventHandler): void {
    this.bus.on(type, handler);
  }

  off(type: MobileLayoutEventType, handler: MobileLayoutEventHandler): void {
    this.bus.off(type, handler);
  }

  private build(): void {
    if (!this.container) return;

    this._statusBar = document.createElement('div');
    this._statusBar.className = 'mobile-status-bar';
    this._statusBar.style.cssText = 'height:20px;background:#000;flex-shrink:0;';
    this.container.appendChild(this._statusBar);

    if (this.config.showAddressBar) {
      this._addressBar = document.createElement('div');
      this._addressBar.className = 'mobile-address-bar';
      this._addressBar.style.cssText = 'height:44px;flex-shrink:0;display:flex;align-items:center;padding:0 8px;';
      this.container.appendChild(this._addressBar);
    }

    this._tabSwitcher = document.createElement('div');
    this._tabSwitcher.className = 'tab-switcher';
    this._tabSwitcher.style.cssText = 'display:none;flex:1;overflow:auto;';
    this.container.appendChild(this._tabSwitcher);

    this._content = document.createElement('div');
    this._content.className = 'mobile-content';
    this._content.style.cssText = 'flex:1;overflow:auto;position:relative;';
    this.container.appendChild(this._content);

    if (this.config.showNavigationBar) {
      this._bottomNav = document.createElement('div');
      this._bottomNav.className = 'bottom-nav';
      this._bottomNav.style.cssText = `height:${this.config.bottomNavHeight}px;flex-shrink:0;display:flex;align-items:center;justify-content:space-around;background:#f5f5f5;border-top:1px solid #ddd;`;

      const navButtons = ['◀', '▶', '☰', '🔍', '✕'];
      for (const label of navButtons) {
        const btn = document.createElement('button');
        btn.textContent = label;
        btn.style.cssText = 'border:none;background:none;font-size:18px;padding:8px;cursor:pointer;';
        this._bottomNav.appendChild(btn);
      }

      this.container.appendChild(this._bottomNav);
    }
  }

  private updateOrientation(): void {
    if (!this.container) return;
    const newOrientation = this.container.clientWidth > this.container.clientHeight
      ? 'landscape' : 'portrait';
    if (newOrientation !== this._orientation) {
      this._orientation = newOrientation;
      this.bus.emit({ kind: 'orientationChanged', data: { orientation: this._orientation } });
    }
  }

  dispose(): void {
    this.detach();
    this.bus.dispose();
  }
}

export { MobileLayout, DEFAULT_MOBILE_CONFIG, MobileLayoutEventBus };
export type { IMobileLayout, MobileLayoutConfig, MobileLayoutAreas, MobileLayoutEvent, MobileLayoutEventType };
