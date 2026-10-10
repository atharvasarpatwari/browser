import type { IDisposable } from '../../../app/dependency-container';
import type { IStatusBar, StatusBarState, StatusBarEventUnion } from './status-bar';

interface StatusBarViewConfig {
  readonly containerId: string;
  readonly showShieldButton: boolean;
  readonly showProtocol: boolean;
  readonly showZoom: boolean;
  readonly brandName?: string;
}

const DEFAULT_VIEW_CONFIG: StatusBarViewConfig = {
  containerId: 'status-bar',
  showShieldButton: true,
  showProtocol: true,
  showZoom: true,
};

interface IStatusBarView extends IDisposable {
  readonly element: HTMLElement | null;
  attach(container: HTMLElement): void;
  detach(): void;
  update(state: StatusBarState): void;
  setEventHandler(handler: (event: StatusBarEventUnion) => void): void;
}

const ICON_SHIELD =
  '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><path d="M8 1.5l5.5 2.5v4.3c0 3.2-2.3 5.4-5.5 6.2-3.2-.8-5.5-3-5.5-6.2V4z"/></svg>';

class StatusBarView implements IStatusBarView {
  private readonly config: StatusBarViewConfig;
  private readonly model: IStatusBar;
  private container: HTMLElement | null = null;
  private statusTextEl: HTMLElement | null = null;
  private urlEl: HTMLElement | null = null;
  private blockedEl: HTMLElement | null = null;
  private blockedCountEl: HTMLElement | null = null;
  private protocolEl: HTMLElement | null = null;
  private secureEl: HTMLElement | null = null;
  private secureDotEl: HTMLElement | null = null;
  private secureTextEl: HTMLElement | null = null;
  private zoomEl: HTMLElement | null = null;
  private shieldBtn: HTMLElement | null = null;
  private eventHandler: ((event: StatusBarEventUnion) => void) | null = null;

  constructor(model: IStatusBar, config?: Partial<StatusBarViewConfig>) {
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
    this.statusTextEl = null;
    this.urlEl = null;
    this.blockedEl = null;
    this.blockedCountEl = null;
    this.protocolEl = null;
    this.secureEl = null;
    this.secureDotEl = null;
    this.secureTextEl = null;
    this.zoomEl = null;
    this.shieldBtn = null;
  }

  update(state: StatusBarState): void {
    if (this.statusTextEl) this.statusTextEl.textContent = state.statusText;
    if (this.urlEl) this.urlEl.textContent = state.hoverUrl || '';
    if (this.blockedCountEl) this.blockedCountEl.textContent = String(state.blockedCount);
    if (this.blockedEl) {
      this.blockedEl.style.color = state.blockedCount > 0 ? 'var(--green-400)' : 'var(--tx-tertiary)';
    }
    if (this.protocolEl) this.protocolEl.textContent = state.protocol;
    if (this.secureDotEl) {
      this.secureDotEl.className = `nova-status-dot ${state.secure ? 'secure' : 'danger'}`;
    }
    if (this.secureTextEl) this.secureTextEl.textContent = state.secure ? 'Secure' : 'Not secure';
    if (this.zoomEl) this.zoomEl.textContent = `${state.zoom}%`;
  }

  setEventHandler(handler: (event: StatusBarEventUnion) => void): void {
    this.eventHandler = handler;
  }

  private build(): void {
    if (!this.container) return;
    this.container.innerHTML = '';

    this.statusTextEl = document.createElement('span');
    this.statusTextEl.className = 'nova-statusbar-item';
    this.statusTextEl.textContent = this.model.state.statusText;
    this.container.appendChild(this.statusTextEl);

    this.urlEl = document.createElement('span');
    this.urlEl.className = 'nova-statusbar-url';
    this.container.appendChild(this.urlEl);

    this.blockedEl = document.createElement('span');
    this.blockedEl.className = 'nova-statusbar-item';
    this.blockedEl.title = `Requests blocked by ${this.config.brandName ?? 'Nova'} Shield`;
    this.blockedEl.style.cssText = 'cursor:pointer;color:var(--tx-tertiary);';
    this.blockedEl.innerHTML = ICON_SHIELD;
    this.blockedCountEl = document.createElement('span');
    this.blockedCountEl.style.cssText = 'font-weight:600;min-width:14px;text-align:center;';
    this.blockedCountEl.textContent = '0';
    this.blockedEl.appendChild(this.blockedCountEl);
    this.blockedEl.appendChild(document.createTextNode(' blocked'));
    this.container.appendChild(this.blockedEl);

    const rightGroup = document.createElement('div');
    rightGroup.className = 'nova-statusbar-right';

    if (this.config.showShieldButton) {
      this.shieldBtn = document.createElement('button');
      this.shieldBtn.setAttribute('type', 'button');
      this.shieldBtn.className = 'nova-statusbar-item';
      this.shieldBtn.title = `${this.config.brandName ?? 'Nova'} Shield — click to toggle`;
      this.shieldBtn.style.background = 'none';
      this.shieldBtn.style.border = 'none';
      this.shieldBtn.style.color = 'var(--tx-tertiary)';
      this.shieldBtn.style.cursor = 'pointer';
      this.shieldBtn.style.padding = '0';
      this.shieldBtn.innerHTML = ICON_SHIELD;
      this.shieldBtn.addEventListener('click', () => {
        this.dispatchEvent({ kind: 'shieldClicked' });
      });
      rightGroup.appendChild(this.shieldBtn);
    }

    if (this.config.showProtocol) {
      this.protocolEl = document.createElement('span');
      this.protocolEl.className = 'nova-statusbar-item';
      this.protocolEl.textContent = this.model.state.protocol;
      rightGroup.appendChild(this.protocolEl);
    }

    this.secureEl = document.createElement('span');
    this.secureEl.className = 'nova-statusbar-item';
    this.secureDotEl = document.createElement('span');
    this.secureDotEl.className = `nova-status-dot ${this.model.state.secure ? 'secure' : 'danger'}`;
    this.secureTextEl = document.createElement('span');
    this.secureTextEl.textContent = this.model.state.secure ? 'Secure' : 'Not secure';
    this.secureEl.appendChild(this.secureDotEl);
    this.secureEl.appendChild(this.secureTextEl);
    rightGroup.appendChild(this.secureEl);

    if (this.config.showZoom) {
      const zoomGroup = document.createElement('span');
      zoomGroup.className = 'nova-statusbar-item';

      const zoomOut = document.createElement('button');
      zoomOut.type = 'button';
      zoomOut.textContent = '−';
      zoomOut.title = 'Zoom out';
      zoomOut.style.cssText = 'border:none;background:none;color:var(--tx-tertiary);font-size:13px;cursor:pointer;padding:0 3px;line-height:1;';
      zoomOut.addEventListener('click', () => {
        const current = this.model.state.zoom;
        if (current > 50) this.dispatchEvent({ kind: 'zoomChanged', zoom: current - 10 });
      });

      this.zoomEl = document.createElement('span');
      this.zoomEl.textContent = `${this.model.state.zoom}%`;
      this.zoomEl.style.cssText = 'min-width:36px;text-align:center;cursor:default;font-size:11px;';

      const zoomIn = document.createElement('button');
      zoomIn.type = 'button';
      zoomIn.textContent = '+';
      zoomIn.title = 'Zoom in';
      zoomIn.style.cssText = 'border:none;background:none;color:var(--tx-tertiary);font-size:13px;cursor:pointer;padding:0 3px;line-height:1;';
      zoomIn.addEventListener('click', () => {
        const current = this.model.state.zoom;
        if (current < 200) this.dispatchEvent({ kind: 'zoomChanged', zoom: current + 10 });
      });

      zoomGroup.appendChild(zoomOut);
      zoomGroup.appendChild(this.zoomEl);
      zoomGroup.appendChild(zoomIn);
      rightGroup.appendChild(zoomGroup);
    }

    this.container.appendChild(rightGroup);
  }

  private dispatchEvent(event: StatusBarEventUnion): void {
    if (this.eventHandler) {
      this.eventHandler(event);
    }
  }

  dispose(): void {
    this.detach();
    this.eventHandler = null;
  }
}

export { StatusBarView, DEFAULT_VIEW_CONFIG };
export type { IStatusBarView, StatusBarViewConfig };