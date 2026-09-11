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
    this.zoomEl = null;
    this.shieldBtn = null;
  }

  update(state: StatusBarState): void {
    if (this.statusTextEl) this.statusTextEl.textContent = state.statusText;
    if (this.urlEl) this.urlEl.textContent = state.hoverUrl || '';
    if (this.blockedCountEl) this.blockedCountEl.textContent = String(state.blockedCount);
    if (this.blockedEl) {
      this.blockedEl.className = 'nova-statusbar-item';
      this.blockedEl.style.color = state.blockedCount > 0 ? 'var(--green-400)' : '';
    }
    if (this.protocolEl) this.protocolEl.textContent = state.protocol;
    if (this.secureEl) {
      this.secureEl.textContent = state.secure ? '🔒 Secure' : '🔓 Not secure';
    }
    if (this.zoomEl) this.zoomEl.textContent = `${state.zoom}%`;
  }

  setEventHandler(handler: (event: StatusBarEventUnion) => void): void {
    this.eventHandler = handler;
  }

  private build(): void {
    if (!this.container) return;
    this.container.innerHTML = '';
    this.container.className = 'nova-statusbar';

    this.statusTextEl = document.createElement('span');
    this.statusTextEl.textContent = this.model.state.statusText;
    this.container.appendChild(this.statusTextEl);

    this.urlEl = document.createElement('span');
    this.urlEl.className = 'nova-statusbar-url';
    this.container.appendChild(this.urlEl);

    this.blockedEl = document.createElement('span');
    this.blockedEl.className = 'nova-statusbar-item';
    this.blockedEl.title = `Requests blocked by ${this.config.brandName ?? 'Nova'} Shield`;
    this.blockedEl.style.cursor = 'pointer';
    this.blockedCountEl = document.createElement('span');
    this.blockedCountEl.textContent = '0';
    this.blockedEl.appendChild(document.createTextNode('🛡 '));
    this.blockedEl.appendChild(this.blockedCountEl);
    this.blockedEl.appendChild(document.createTextNode(' blocked'));
    this.container.appendChild(this.blockedEl);

    const rightGroup = document.createElement('div');
    rightGroup.className = 'nova-statusbar-right';

    if (this.config.showShieldButton) {
      this.shieldBtn = document.createElement('button');
      this.shieldBtn.className = 'nova-addrbar-btn';
      this.shieldBtn.title = `${this.config.brandName ?? 'Nova'} Shield — click to toggle`;
      this.shieldBtn.textContent = '🛡️';
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
    this.secureEl.textContent = this.model.state.secure ? '🔒 Secure' : '🔓 Not secure';
    rightGroup.appendChild(this.secureEl);

    if (this.config.showZoom) {
      const zoomGroup = document.createElement('span');
      zoomGroup.className = 'nova-statusbar-item';

      const zoomOut = document.createElement('button');
      zoomOut.className = 'nova-addrbar-btn';
      zoomOut.textContent = '−';
      zoomOut.title = 'Zoom out';
      zoomOut.addEventListener('click', () => {
        const current = this.model.state.zoom;
        if (current > 50) this.dispatchEvent({ kind: 'zoomChanged', zoom: current - 10 });
      });

      this.zoomEl = document.createElement('span');
      this.zoomEl.textContent = `${this.model.state.zoom}%`;
      this.zoomEl.style.cssText = 'min-width:32px;text-align:center;cursor:default;';

      const zoomIn = document.createElement('button');
      zoomIn.className = 'nova-addrbar-btn';
      zoomIn.textContent = '+';
      zoomIn.title = 'Zoom in';
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
