import type { IDisposable } from '../../../app/dependency-container';
import type { IToolbar, ToolbarState, ToolbarEventUnion } from './toolbar';

interface ToolbarViewConfig {
  readonly containerId: string;
  readonly showTrafficLights: boolean;
  readonly showShieldButton: boolean;
  readonly showBookmarkButton: boolean;
  readonly brandName?: string;
}

const DEFAULT_VIEW_CONFIG: ToolbarViewConfig = {
  containerId: 'toolbar',
  showTrafficLights: true,
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

class ToolbarView implements IToolbarView {
  private readonly config: ToolbarViewConfig;
  private readonly model: IToolbar;
  private container: HTMLElement | null = null;
  private backBtn: HTMLButtonElement | null = null;
  private fwdBtn: HTMLButtonElement | null = null;
  private reloadBtn: HTMLButtonElement | null = null;
  private shieldBtn: HTMLElement | null = null;
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
      this.reloadBtn.textContent = state.loading ? '×' : '↻';
      this.reloadBtn.title = state.loading ? 'Stop' : 'Reload';
    }
    if (this.shieldBtn) {
      this.shieldBtn.style.color = state.shieldEnabled ? 'var(--green-400)' : '';
    }
  }

  setEventHandler(handler: (event: ToolbarEventUnion) => void): void {
    this.eventHandler = handler;
  }

  private build(): void {
    if (!this.container) return;
    this.container.innerHTML = '';
    this.container.className = 'nova-navbar';

    if (this.config.showTrafficLights) {
      const trafficLights = document.createElement('div');
      trafficLights.className = 'nova-wc';
      for (const cls of ['nova-wc-close', 'nova-wc-minimize', 'nova-wc-maximize']) {
        const dot = document.createElement('span');
        dot.className = `nova-wc-btn ${cls}`;
        trafficLights.appendChild(dot);
      }
      this.container.appendChild(trafficLights);
    }

    this.backBtn = this.createNavButton('◀', 'Back', !this.model.state.canGoBack);
    this.backBtn.addEventListener('click', () => this.dispatchEvent({ kind: 'back' }));
    this.container.appendChild(this.backBtn);

    this.fwdBtn = this.createNavButton('▶', 'Forward', !this.model.state.canGoForward);
    this.fwdBtn.addEventListener('click', () => this.dispatchEvent({ kind: 'forward' }));
    this.container.appendChild(this.fwdBtn);

    this.reloadBtn = this.createNavButton('↻', 'Reload', false);
    this.reloadBtn.addEventListener('click', () => {
      if (this.model.state.loading) {
        this.dispatchEvent({ kind: 'stop' });
      } else {
        this.dispatchEvent({ kind: 'reload' });
      }
    });
    this.container.appendChild(this.reloadBtn);

    const addressBarArea = document.createElement('div');
    addressBarArea.className = 'address-bar-slot';
    addressBarArea.style.cssText = 'flex:1;min-width:0;';
    this.container.appendChild(addressBarArea);

    if (this.config.showBookmarkButton) {
      this.bookmarkBtn = this.createNavButton('☆', 'Bookmark this page', false);
      this.bookmarkBtn.addEventListener('click', () => this.dispatchEvent({ kind: 'bookmarkAdd' }));
      this.container.appendChild(this.bookmarkBtn);
    }

    if (this.config.showShieldButton) {
      this.shieldBtn = this.createNavButton('🛡️', `${this.config.brandName ?? 'Nova'} Shield`, false);
      this.shieldBtn.style.color = this.model.state.shieldEnabled ? 'var(--green-400)' : '';
      this.shieldBtn.addEventListener('click', () => this.dispatchEvent({ kind: 'shieldToggle', enabled: !this.model.state.shieldEnabled }));
      this.container.appendChild(this.shieldBtn);
    }
  }

  private createNavButton(text: string, title: string, disabled: boolean): HTMLButtonElement {
    const btn = document.createElement('button');
    btn.className = 'nova-nav-btn';
    btn.textContent = text;
    btn.title = title;
    btn.disabled = disabled;
    return btn;
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
