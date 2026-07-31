/**
 * @file window-controls.ts
 * @layer Platform — Shared
 *
 * Window display controls: fullscreen toggling, high-DPI scaling, and
 * resize tracking. Complements {@link PlatformEvents} (which only detects
 * `fullscreenchange`/`resize`) with an imperative fullscreen API, DPI-aware
 * coordinate conversion, and a debounced resize tracker.
 *
 * Lifecycle follows the platform convention: start()/stop()/dispose().
 */

import type { IDisposable } from '../../app/dependency-container';

type WindowControlEventType = 'fullscreenChange' | 'resize' | 'dpiChange';

interface WindowControlEvent {
  readonly kind: WindowControlEventType;
  readonly timestamp: number;
  readonly data: Readonly<Record<string, unknown>>;
}

interface IWindowControls extends IDisposable {
  readonly isFullscreen: boolean;
  readonly devicePixelRatio: number;
  readonly innerWidth: number;
  readonly innerHeight: number;
  start(): void;
  stop(): void;
  enterFullscreen(element?: HTMLElement): Promise<boolean>;
  exitFullscreen(): Promise<boolean>;
  toggleFullscreen(element?: HTMLElement): Promise<boolean>;
  cssToDevicePixels(cssWidth: number, cssHeight: number): { width: number; height: number };
  deviceToCssPixels(deviceWidth: number, deviceHeight: number): { width: number; height: number };
  on(type: WindowControlEventType, handler: (event: WindowControlEvent) => void): void;
  off(type: WindowControlEventType, handler: (event: WindowControlEvent) => void): void;
}

type WindowControlEventHandler = (event: WindowControlEvent) => void;

class WindowControlEventBus {
  private readonly channels = new Map<WindowControlEventType, Set<WindowControlEventHandler>>();

  on(type: WindowControlEventType, handler: WindowControlEventHandler): void {
    if (!this.channels.has(type)) this.channels.set(type, new Set());
    this.channels.get(type)!.add(handler);
  }

  off(type: WindowControlEventType, handler: WindowControlEventHandler): void {
    this.channels.get(type)?.delete(handler);
  }

  emit(event: WindowControlEvent): void {
    const handlers = this.channels.get(event.kind);
    if (!handlers) return;
    for (const h of handlers) {
      try { h(event); } catch (err) {
        console.error(`[WindowControls] Handler threw on "${event.kind}":`, err);
      }
    }
  }

  dispose(): void { this.channels.clear(); }
}

class WindowControls implements IWindowControls {
  private readonly bus = new WindowControlEventBus();
  private _running = false;

  private _isFullscreen = false;
  private _devicePixelRatio = 1;
  private _innerWidth = 0;
  private _innerHeight = 0;
  private resizeTimer: ReturnType<typeof setTimeout> | null = null;

  private boundHandlers: Array<[string, EventListener]> = [];
  private readonly target: Window;

  constructor(target: Window = typeof window === 'undefined' ? (globalThis as unknown as Window) : window) {
    this.target = target;
  }

  get isFullscreen(): boolean { return this._isFullscreen; }
  get devicePixelRatio(): number { return this._devicePixelRatio; }
  get innerWidth(): number { return this._innerWidth; }
  get innerHeight(): number { return this._innerHeight; }

  start(): void {
    if (this._running) return;
    this._running = true;

    this._devicePixelRatio = this.target.devicePixelRatio ?? 1;
    this._innerWidth = this.target.innerWidth ?? 0;
    this._innerHeight = this.target.innerHeight ?? 0;

    const add = (type: string, handler: EventListener) => {
      this.target.addEventListener(type, handler);
      this.boundHandlers.push([type, handler]);
    };

    add('resize', () => {
      if (this.resizeTimer) clearTimeout(this.resizeTimer);
      this.resizeTimer = setTimeout(() => {
        this._innerWidth = this.target.innerWidth;
        this._innerHeight = this.target.innerHeight;
        this.bus.emit({
          kind: 'resize',
          timestamp: Date.now(),
          data: { width: this._innerWidth, height: this._innerHeight },
        });
      }, 150);
    });

    add('fullscreenchange', () => {
      this._isFullscreen = !!this.target.document?.fullscreenElement;
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
      this.target.removeEventListener(type, handler);
    }
    this.boundHandlers = [];

    if (this.resizeTimer) {
      clearTimeout(this.resizeTimer);
      this.resizeTimer = null;
    }
  }

  async enterFullscreen(element?: HTMLElement): Promise<boolean> {
    if (this._isFullscreen) return true;
    try {
      const target = element ?? (this.target.document?.documentElement ?? null);
      if (!target) return false;
      await target.requestFullscreen();
      this._isFullscreen = true;
      return true;
    } catch (err) {
      console.error('[WindowControls] enterFullscreen failed:', err);
      return false;
    }
  }

  async exitFullscreen(): Promise<boolean> {
    if (!this._isFullscreen) return true;
    try {
      await this.target.document?.exitFullscreen();
      this._isFullscreen = false;
      return true;
    } catch (err) {
      console.error('[WindowControls] exitFullscreen failed:', err);
      return false;
    }
  }

  async toggleFullscreen(element?: HTMLElement): Promise<boolean> {
    return this._isFullscreen ? this.exitFullscreen() : this.enterFullscreen(element);
  }

  cssToDevicePixels(cssWidth: number, cssHeight: number): { width: number; height: number } {
    return {
      width: Math.round(cssWidth * this._devicePixelRatio),
      height: Math.round(cssHeight * this._devicePixelRatio),
    };
  }

  deviceToCssPixels(deviceWidth: number, deviceHeight: number): { width: number; height: number } {
    const scale = this._devicePixelRatio > 0 ? this._devicePixelRatio : 1;
    return {
      width: Math.round(deviceWidth / scale),
      height: Math.round(deviceHeight / scale),
    };
  }

  on(type: WindowControlEventType, handler: WindowControlEventHandler): void {
    this.bus.on(type, handler);
  }

  off(type: WindowControlEventType, handler: WindowControlEventHandler): void {
    this.bus.off(type, handler);
  }

  dispose(): void {
    this.stop();
    this.bus.dispose();
  }
}

export { WindowControls, WindowControlEventBus };
export type { IWindowControls, WindowControlEvent, WindowControlEventType };
