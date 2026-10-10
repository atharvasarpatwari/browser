import type { IDisposable } from '../../../app/dependency-container';
import type { IToolbar, ToolbarState, ToolbarEventUnion } from './toolbar';

interface ToolbarViewConfig {
  readonly containerId: string;
  readonly showShieldButton: boolean;
  readonly showBookmarkButton: boolean;
  readonly brandName?: string;
}

const DEFAULT_VIEW_CONFIG: ToolbarViewConfig = {
  containerId: 'toolbar',
  showShieldButton: true,
  showBookmarkButton: true,
};

interface IToolbarView extends IDisposable {
  readonly element: HTMLElement | null;
  attach(container: HTMLElement): void;
  detach(): void;
  update(state: ToolbarState): void;
  setEventHandler(handler: (event: ToolbarEventUnion) => void): void;
}

const ICON_BACK =
  '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M10 3.5L5.5 8l4.5 4.5"/></svg>';
const ICON_FORWARD =
  '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M6 3.5l4.5 4.5L6 12.5"/></svg>';
const ICON_RELOAD =
  '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M13.5 8a5.5 5.5 0 1 1-1.6-3.9"/><path d="M13 2.2v3.3h-3.3"/></svg>';
const ICON_STAR =
  '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"><path d="M8 1.8l1.9 3.9 4.3.6-3.1 3 0.7 4.3L8 11.1l-3.8 2 0.7-4.3-3.1-3 4.3-.6z"/></svg>';
const ICON_SHIELD =
  '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><path d="M8 1.5l5.5 2.5v4.3c0 3.2-2.3 5.4-5.5 6.2-3.2-.8-5.5-3-5.5-6.2V4z"/></svg>';

class ToolbarView implements IToolbarView {
  private readonly config: ToolbarViewConfig;
  private readonly model: IToolbar;
  private container: HTMLElement | null = null;
  private backBtn: HTMLButtonElement | null = null;
  private fwdBtn: HTMLButtonElement | null = null;
  private reloadBtn: HTMLButtonElement | null = null;
  private shieldBtn: HTMLButtonElement | null = null;
  private bookmarkBtn: HTMLElement | null = null;
  private eventHandler: ((event: ToolbarEventUnion) => void) | null = null;

  constructor(model: IToolbar, config?: Partial<ToolbarViewConfig>) {
    this.model = model;
    this.config = { ...DEFAULT_VIEW_CONFIG, ...config };
  }

  get element(): HTMLElement | null {
    return this.container;
  }

  attach(container: HTMLElement): void {
    this.container = container;
    this.build();
  }

  detach(): void {
    if (this.container) {
      this.container.innerHTML = '';
      this.container = null;
    }
    this.backBtn = null;
    this.fwdBtn = null;
    this.reloadBtn = null;
    this.shieldBtn = null;
    this.bookmarkBtn = null;
  }

  update(state: ToolbarState): void {
    if (this.backBtn) this.backBtn.disabled = !state.canGoBack;
    if (this.fwdBtn) this.fwdBtn.disabled = !state.canGoForward;
    if (this.reloadBtn) {
      this.reloadBtn.classList.toggle('loading', state.loading);
      this.reloadBtn.title = state.loading ? 'Stop' : 'Reload';
    }
    this.updateShield(state.shieldEnabled);
  }

  setEventHandler(handler: (event: ToolbarEventUnion) => void): void {
    this.eventHandler = handler;
  }

  private build(): void {
    if (!this.container) return;
    this.container.innerHTML = '';

    this.backBtn = this.createNavButton(ICON_BACK, 'Back', !this.model.state.canGoBack);
    this.backBtn.addEventListener('click', () => this.dispatchEvent({ kind: 'back' }));
    this.container.appendChild(this.backBtn);

    this.fwdBtn = this.createNavButton(ICON_FORWARD, 'Forward', !this.model.state.canGoForward);
    this.fwdBtn.addEventListener('click', () => this.dispatchEvent({ kind: 'forward' }));
    this.container.appendChild(this.fwdBtn);

    this.reloadBtn = this.createNavButton(ICON_RELOAD, 'Reload', false);
    this.reloadBtn.addEventListener('click', () => {
      if (this.model.state.loading) {
        this.dispatchEvent({ kind: 'stop' });
      } else {
        this.dispatchEvent({ kind: 'reload' });
      }
    });
    this.container.appendChild(this.reloadBtn);

    const addressSlot = document.createElement('div');
    addressSlot.className = 'address-bar-slot nova-addressbar';
    addressSlot.style.cssText = 'flex:1;min-width:0;';
    this.container.appendChild(addressSlot);

    if (this.config.showBookmarkButton) {
      this.bookmarkBtn = document.createElement('button');
      this.bookmarkBtn.setAttribute('type', 'button');
      this.bookmarkBtn.className = 'nova-star';
      this.bookmarkBtn.innerHTML = ICON_STAR;
      this.bookmarkBtn.title = 'Bookmark this page';
      this.bookmarkBtn.addEventListener('click', () => this.dispatchEvent({ kind: 'bookmarkAdd' }));
      this.container.appendChild(this.bookmarkBtn);
    }

    const divider = document.createElement('div');
    divider.className = 'nova-toolbar-divider';
    this.container.appendChild(divider);

    if (this.config.showShieldButton) {
      this.shieldBtn = this.createNavButton(ICON_SHIELD, `${this.config.brandName ?? 'Nova'} Shield`, false);
      this.updateShield(this.model.state.shieldEnabled);
      this.shieldBtn.addEventListener('click', () => {
        this.dispatchEvent({ kind: 'shieldToggle', enabled: !this.model.state.shieldEnabled });
      });
      this.container.appendChild(this.shieldBtn);
    }

    const menuBtn = document.createElement('button');
    menuBtn.type = 'button';
    menuBtn.className = 'nova-menu-btn nova-nav-btn';
    menuBtn.title = 'Menu';
    for (let i = 0; i < 3; i++) {
      menuBtn.appendChild(document.createElement('span'));
    }
    menuBtn.addEventListener('click', () => this.dispatchEvent({ kind: 'menuClick' }));
    this.container.appendChild(menuBtn);
  }

  private createNavButton(svg: string, title: string, disabled: boolean): HTMLButtonElement {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'nova-nav-btn';
    btn.title = title;
    btn.disabled = disabled;
    btn.innerHTML = svg;
    return btn;
  }

  private updateShield(enabled: boolean): void {
    if (this.shieldBtn) {
      this.shieldBtn.style.color = enabled ? 'var(--green-400)' : '';
    }
  }

  private dispatchEvent(event: ToolbarEventUnion): void {
    if (this.eventHandler) {
      this.eventHandler(event);
    }
  }

  dispose(): void {
    this.detach();
    this.eventHandler = null;
  }
}

export { ToolbarView, DEFAULT_VIEW_CONFIG };
export type { IToolbarView, ToolbarViewConfig };