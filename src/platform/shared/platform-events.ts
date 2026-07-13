import type { IDisposable } from '../../app/dependency-container';

type PlatformEventType =
  | 'online' | 'offline'
  | 'focus' | 'blur'
  | 'resize' | 'fullscreenChange'
  | 'beforeUnload' | 'unload'
  | 'visibilityChange'
  | 'deviceMemoryChange'
  | 'batteryLow' | 'batteryCharging'
  | 'mediaKey'
  | 'networkChange';

interface PlatformEvent {
  readonly kind: PlatformEventType;
  readonly timestamp: number;
  readonly data: Readonly<Record<string, unknown>>;
}

interface IPlatformEvents extends IDisposable {
  readonly isOnline: boolean;
  readonly isFocused: boolean;
  readonly visibilityState: DocumentVisibilityState;
  readonly isFullscreen: boolean;
  start(): void;
  stop(): void;
  on(type: PlatformEventType, handler: (event: PlatformEvent) => void): void;
  off(type: PlatformEventType, handler: (event: PlatformEvent) => void): void;
}

type PlatformEventHandler = (event: PlatformEvent) => void;

class PlatformEventBus {
  private readonly channels = new Map<PlatformEventType, Set<PlatformEventHandler>>();

  on(type: PlatformEventType, handler: PlatformEventHandler): void {
    if (!this.channels.has(type)) this.channels.set(type, new Set());
    this.channels.get(type)!.add(handler);
  }

  off(type: PlatformEventType, handler: PlatformEventHandler): void {
    this.channels.get(type)?.delete(handler);
  }

  emit(event: PlatformEvent): void {
    const handlers = this.channels.get(event.kind);
    if (!handlers) return;
    for (const h of handlers) {
      try { h(event); } catch (err) {
        console.error(`[PlatformEvents] Handler threw on "${event.kind}":`, err);
      }
    }
  }

  dispose(): void { this.channels.clear(); }
}

class PlatformEvents implements IPlatformEvents {
  private readonly bus = new PlatformEventBus();
  private _running = false;

  private _isOnline = true;
  private _isFocused = true;
  private _visibilityState: DocumentVisibilityState = 'visible';
  private _isFullscreen = false;

  private boundHandlers: Array<[string, EventListener]> = [];

  get isOnline(): boolean { return this._isOnline; }
  get isFocused(): boolean { return this._isFocused; }
  get visibilityState(): DocumentVisibilityState { return this._visibilityState; }
  get isFullscreen(): boolean { return this._isFullscreen; }

  start(): void {
    if (this._running) return;
    this._running = true;

    if (typeof window === 'undefined') return;

    const add = (type: string, handler: EventListener) => {
      window.addEventListener(type, handler);
      this.boundHandlers.push([type, handler]);
    };

    add('online', () => {
      this._isOnline = true;
      this.bus.emit({ kind: 'online', timestamp: Date.now(), data: {} });
    });

    add('offline', () => {
      this._isOnline = false;
      this.bus.emit({ kind: 'offline', timestamp: Date.now(), data: {} });
    });

    add('focus', () => {
      this._isFocused = true;
      this.bus.emit({ kind: 'focus', timestamp: Date.now(), data: {} });
    });

    add('blur', () => {
      this._isFocused = false;
      this.bus.emit({ kind: 'blur', timestamp: Date.now(), data: {} });
    });

    add('resize', () => {
      this.bus.emit({
        kind: 'resize',
        timestamp: Date.now(),
        data: { width: window.innerWidth, height: window.innerHeight },
      });
    });

    add('beforeunload', (_e: Event) => {
      this.bus.emit({ kind: 'beforeUnload', timestamp: Date.now(), data: {} });
    });

    add('unload', () => {
      this.bus.emit({ kind: 'unload', timestamp: Date.now(), data: {} });
    });

    add('visibilitychange', () => {
      this._visibilityState = document.visibilityState;
      this.bus.emit({
        kind: 'visibilityChange',
        timestamp: Date.now(),
        data: { state: document.visibilityState },
      });
    });

    add('fullscreenchange', () => {
      this._isFullscreen = !!document.fullscreenElement;
      this.bus.emit({
        kind: 'fullscreenChange',
        timestamp: Date.now(),
        data: { fullscreen: this._isFullscreen },
      });
    });
  }

  stop(): void {
    if (!this._running) return;
    this._running = false;

    for (const [type, handler] of this.boundHandlers) {
      window.removeEventListener(type, handler);
    }
    this.boundHandlers = [];
  }

  on(type: PlatformEventType, handler: PlatformEventHandler): void {
    this.bus.on(type, handler);
  }

  off(type: PlatformEventType, handler: PlatformEventHandler): void {
    this.bus.off(type, handler);
  }

  dispose(): void {
    this.stop();
    this.bus.dispose();
  }
}

export { PlatformEvents, PlatformEventBus };
export type { IPlatformEvents, PlatformEvent, PlatformEventType };
