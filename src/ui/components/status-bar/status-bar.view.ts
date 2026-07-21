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
      this.blockedEl.className = state.blockedCount > 0 ? 'status-blocked has-blocks' : 'status-blocked';
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
    this.container.className = 'status-bar';
    this.container.style.cssText = 'height:24px;background:var(--bg-elevated);border-top:1px solid var(--border-subtle);display:flex;align-items:center;padding:0 10px;font-size:10px;color:var(--text-tertiary);flex-shrink:0;gap:14px;';

    this.statusTextEl = document.createElement('span');
    this.statusTextEl.className = 'status-text';
    this.statusTextEl.textContent = this.model.state.statusText;
    this.container.appendChild(this.statusTextEl);

    this.urlEl = document.createElement('span');
    this.urlEl.className = 'status-url';
    this.urlEl.style.cssText = 'flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;margin:0 8px;';
    this.container.appendChild(this.urlEl);

    this.blockedEl = document.createElement('span');
    this.blockedEl.className = 'status-blocked';
    this.blockedEl.title = `Requests blocked by ${this.config.brandName ?? 'Nova'} Shield`;
    this.blockedEl.style.cssText = 'display:flex;align-items:center;gap:4px;cursor:pointer;color:#4a8a4a;transition:all var(--t-fast);';
    this.blockedCountEl = document.createElement('span');
    this.blockedCountEl.className = 'sb-count';
    this.blockedCountEl.style.cssText = 'font-weight:600;min-width:14px;text-align:center;';
    this.blockedCountEl.textContent = '0';
    this.blockedEl.appendChild(document.createTextNode('🛡 '));
    this.blockedEl.appendChild(this.blockedCountEl);
    this.blockedEl.appendChild(document.createTextNode(' blocked'));
    this.container.appendChild(this.blockedEl);

    const rightGroup = document.createElement('div');
    rightGroup.className = 'status-right';
    rightGroup.style.cssText = 'display:flex;gap:12px;margin-left:auto;';

    if (this.config.showShieldButton) {
      this.shieldBtn = document.createElement('button');
      this.shieldBtn.className = 'addr-btn';
      this.shieldBtn.title = `${this.config.brandName ?? 'Nova'} Shield — click to toggle`;
      this.shieldBtn.textContent = '🛡️';
      this.shieldBtn.style.cssText = 'border:none;background:none;color:var(--text-tertiary);font-size:14px;cursor:pointer;padding:3px 5px;border-radius:var(--radius-sm);transition:all var(--t-fast);line-height:1;';
      this.shieldBtn.addEventListener('click', () => {
        this.dispatchEvent({ kind: 'shieldClicked' });
      });
      rightGroup.appendChild(this.shieldBtn);
    }

    if (this.config.showProtocol) {
      this.protocolEl = document.createElement('span');
      this.protocolEl.textContent = this.model.state.protocol;
      rightGroup.appendChild(this.protocolEl);
    }

    this.secureEl = document.createElement('span');
    this.secureEl.textContent = this.model.state.secure ? '🔒 Secure' : '🔓 Not secure';
    rightGroup.appendChild(this.secureEl);

    if (this.config.showZoom) {
      const zoomGroup = document.createElement('span');
      zoomGroup.style.cssText = 'display:flex;align-items:center;gap:2px;';

      const zoomOut = document.createElement('button');
      zoomOut.textContent = '−';
      zoomOut.title = 'Zoom out';
      zoomOut.style.cssText = 'border:none;background:none;color:var(--text-tertiary);font-size:13px;cursor:pointer;padding:1px 4px;border-radius:3px;line-height:1;';
      zoomOut.addEventListener('click', () => {
        const current = this.model.state.zoom;
        if (current > 50) this.dispatchEvent({ kind: 'zoomChanged', zoom: current - 10 });
      });

      this.zoomEl = document.createElement('span');
      this.zoomEl.textContent = `${this.model.state.zoom}%`;
      this.zoomEl.style.cssText = 'min-width:36px;text-align:center;cursor:default;font-size:12px;';

      const zoomIn = document.createElement('button');
      zoomIn.textContent = '+';
      zoomIn.title = 'Zoom in';
      zoomIn.style.cssText = 'border:none;background:none;color:var(--text-tertiary);font-size:13px;cursor:pointer;padding:1px 4px;border-radius:3px;line-height:1;';
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
