import type { IDisposable } from '../../../app/dependency-container';

type StatusBarEventType = 'shieldClicked' | 'zoomChanged';

interface StatusBarEvent {
  readonly kind: StatusBarEventType;
}

interface ShieldClickedEvent extends StatusBarEvent {
  readonly kind: 'shieldClicked';
}

interface ZoomChangedEvent extends StatusBarEvent {
  readonly kind: 'zoomChanged';
  readonly zoom: number;
}

type StatusBarEventUnion = ShieldClickedEvent | ZoomChangedEvent;

interface StatusBarState {
  readonly statusText: string;
  readonly url: string;
  readonly protocol: string;
  readonly secure: boolean;
  readonly zoom: number;
  readonly blockedCount: number;
  readonly hoverUrl: string;
}

interface IStatusBar extends IDisposable {
  readonly state: StatusBarState;
  setStatus(text: string): void;
  setUrl(url: string): void;
  setProtocol(protocol: string): void;
  setSecure(secure: boolean): void;
  setZoom(zoom: number): void;
  setBlockedCount(count: number): void;
  setHoverUrl(url: string): void;
  on(type: StatusBarEventType, handler: (event: StatusBarEventUnion) => void): void;
  off(type: StatusBarEventType, handler: (event: StatusBarEventUnion) => void): void;
}

type StatusBarEventHandler = (event: StatusBarEventUnion) => void;

class StatusBarEventBus {
  private readonly channels = new Map<StatusBarEventType, Set<StatusBarEventHandler>>();

  on(type: StatusBarEventType, handler: StatusBarEventHandler): void {
    if (!this.channels.has(type)) this.channels.set(type, new Set());
    this.channels.get(type)!.add(handler);
  }

  off(type: StatusBarEventType, handler: StatusBarEventHandler): void {
    this.channels.get(type)?.delete(handler);
  }

  emit(event: StatusBarEventUnion): void {
    const handlers = this.channels.get(event.kind);
    if (!handlers) return;
    for (const h of handlers) {
      try { h(event); } catch (err) {
        console.error(`[StatusBar] Handler threw on "${event.kind}":`, err);
      }
    }
  }

  dispose(): void { this.channels.clear(); }
}

class StatusBar implements IStatusBar {
  private readonly bus = new StatusBarEventBus();
  private _statusText = 'Ready';
  private _url = '';
  private _protocol = 'HTTPS';
  private _secure = true;
  private _zoom = 100;
  private _blockedCount = 0;
  private _hoverUrl = '';

  get state(): StatusBarState {
    return {
      statusText: this._statusText,
      url: this._url,
      protocol: this._protocol,
      secure: this._secure,
      zoom: this._zoom,
      blockedCount: this._blockedCount,
      hoverUrl: this._hoverUrl,
    };
  }

  setStatus(text: string): void { this._statusText = text; }
  setUrl(url: string): void { this._url = url; }
  setProtocol(protocol: string): void { this._protocol = protocol; }
  setSecure(secure: boolean): void { this._secure = secure; }
  setZoom(zoom: number): void { this._zoom = zoom; }
  setBlockedCount(count: number): void { this._blockedCount = count; }
  setHoverUrl(url: string): void { this._hoverUrl = url; }

  on(type: StatusBarEventType, handler: StatusBarEventHandler): void {
    this.bus.on(type, handler);
  }

  off(type: StatusBarEventType, handler: StatusBarEventHandler): void {
    this.bus.off(type, handler);
  }

  dispose(): void {
    this.bus.dispose();
  }
}

export { StatusBar, StatusBarEventBus };
export type {
  IStatusBar,
  StatusBarState,
  StatusBarEventUnion,
  StatusBarEventType,
};
