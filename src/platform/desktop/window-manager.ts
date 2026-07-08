import type { IDisposable } from '../../app/dependency-container';
import type { IWindow } from '../../app/app-shell';
import { BrowserWindow } from '../../app/app-shell';

type WindowState = 'normal' | 'minimized' | 'maximized' | 'fullscreen' | 'closed';

interface DesktopWindowInfo {
  readonly id: string;
  title: string;
  state: WindowState;
  x: number;
  y: number;
  width: number;
  height: number;
  isOpen: boolean;
  isFocused: boolean;
}

interface WindowCreateOptions {
  readonly title?: string;
  readonly x?: number;
  readonly y?: number;
  readonly width?: number;
  readonly height?: number;
  readonly maximized?: boolean;
  readonly fullscreen?: boolean;
  readonly frame?: boolean;
  readonly resizable?: boolean;
  readonly minimizable?: boolean;
  readonly maximizable?: boolean;
  readonly closable?: boolean;
}

type WindowManagerEventType =
  | 'windowCreated' | 'windowClosed' | 'windowActivated'
  | 'windowStateChanged' | 'windowBoundsChanged';

interface WindowManagerEvent {
  readonly kind: WindowManagerEventType;
  readonly windowId: string;
  readonly data: Readonly<Record<string, unknown>>;
}

interface IWindowManager extends IDisposable {
  readonly windows: readonly DesktopWindowInfo[];
  readonly activeWindowId: string | null;
  readonly count: number;

  createWindow(options?: WindowCreateOptions): IWindow;
  closeWindow(windowId: string): Promise<boolean>;
  activateWindow(windowId: string): boolean;
  minimizeWindow(windowId: string): boolean;
  maximizeWindow(windowId: string): boolean;
  restoreWindow(windowId: string): boolean;
  setWindowBounds(windowId: string, bounds: { x?: number; y?: number; width?: number; height?: number }): boolean;
  getWindowInfo(windowId: string): DesktopWindowInfo | null;
  getWindow(windowId: string): IWindow | null;
  on(type: WindowManagerEventType, handler: (event: WindowManagerEvent) => void): void;
  off(type: WindowManagerEventType, handler: (event: WindowManagerEvent) => void): void;
}

type WindowManagerEventHandler = (event: WindowManagerEvent) => void;

let _winSeq = 0;
function nextWinId(): string {
  return `win-${Date.now()}-${(++_winSeq).toString(36)}`;
}

class WindowManagerEventBus {
  private readonly channels = new Map<WindowManagerEventType, Set<WindowManagerEventHandler>>();

  on(type: WindowManagerEventType, handler: WindowManagerEventHandler): void {
    if (!this.channels.has(type)) this.channels.set(type, new Set());
    this.channels.get(type)!.add(handler);
  }

  off(type: WindowManagerEventType, handler: WindowManagerEventHandler): void {
    this.channels.get(type)?.delete(handler);
  }

  emit(event: WindowManagerEvent): void {
    const handlers = this.channels.get(event.kind);
    if (!handlers) return;
    for (const h of handlers) {
      try { h(event); } catch (err) {
        console.error(`[WindowManager] Handler threw on "${event.kind}":`, err);
      }
    }
  }

  dispose(): void { this.channels.clear(); }
}

interface ManagedWindow {
  window: IWindow;
  info: DesktopWindowInfo;
}

class WindowManager implements IWindowManager {
  private readonly managed = new Map<string, ManagedWindow>();
  private readonly bus = new WindowManagerEventBus();
  private _activeWindowId: string | null = null;

  get windows(): readonly DesktopWindowInfo[] {
    return [...this.managed.values()].map(m => ({ ...m.info }));
  }

  get activeWindowId(): string | null { return this._activeWindowId; }
  get count(): number { return this.managed.size; }

  createWindow(options?: WindowCreateOptions): IWindow {
    const id = nextWinId();
    const bw = new BrowserWindow(id, options?.title ?? 'Nova Browser');

    const info: DesktopWindowInfo = {
      id,
      title: options?.title ?? 'Nova Browser',
      state: options?.fullscreen ? 'fullscreen' : options?.maximized ? 'maximized' : 'normal',
      x: options?.x ?? 100,
      y: options?.y ?? 100,
      width: options?.width ?? 1280,
      height: options?.height ?? 720,
      isOpen: false,
      isFocused: false,
    };

    this.managed.set(id, { window: bw, info });
    this.bus.emit({ kind: 'windowCreated', windowId: id, data: { title: info.title } });

    void bw.open().then(() => {
      const m = this.managed.get(id);
      if (m) {
        m.info.isOpen = true;
        m.info.isFocused = true;
        this._activeWindowId = id;
        this.bus.emit({ kind: 'windowActivated', windowId: id, data: {} });
      }
    });

    return bw;
  }

  async closeWindow(windowId: string): Promise<boolean> {
    const m = this.managed.get(windowId);
    if (!m) return false;

    await m.window.close();
    m.info.isOpen = false;
    m.info.state = 'closed';
    this.managed.delete(windowId);
    this.bus.emit({ kind: 'windowClosed', windowId, data: {} });

    if (this._activeWindowId === windowId) {
      const remaining = [...this.managed.keys()];
      this._activeWindowId = remaining.length > 0 ? remaining[remaining.length - 1]! : null;
    }

    return true;
  }

  activateWindow(windowId: string): boolean {
    const m = this.managed.get(windowId);
    if (!m || !m.info.isOpen) return false;

    m.info.isFocused = true;
    const prev = this._activeWindowId;
    this._activeWindowId = windowId;

    if (prev && prev !== windowId) {
      const prevM = this.managed.get(prev);
      if (prevM) prevM.info.isFocused = false;
    }

    m.window.focus();
    this.bus.emit({ kind: 'windowActivated', windowId, data: { previousId: prev } });
    return true;
  }

  minimizeWindow(windowId: string): boolean {
    const m = this.managed.get(windowId);
    if (!m) return false;
    m.info.state = 'minimized';
    this.bus.emit({ kind: 'windowStateChanged', windowId, data: { state: 'minimized' } });
    return true;
  }

  maximizeWindow(windowId: string): boolean {
    const m = this.managed.get(windowId);
    if (!m) return false;
    m.info.state = 'maximized';
    this.bus.emit({ kind: 'windowStateChanged', windowId, data: { state: 'maximized' } });
    return true;
  }

  restoreWindow(windowId: string): boolean {
    const m = this.managed.get(windowId);
    if (!m) return false;
    m.info.state = 'normal';
    this.bus.emit({ kind: 'windowStateChanged', windowId, data: { state: 'normal' } });
    return true;
  }

  setWindowBounds(windowId: string, bounds: { x?: number; y?: number; width?: number; height?: number }): boolean {
    const m = this.managed.get(windowId);
    if (!m) return false;

    if (bounds.x !== undefined) m.info.x = bounds.x;
    if (bounds.y !== undefined) m.info.y = bounds.y;
    if (bounds.width !== undefined) m.info.width = bounds.width;
    if (bounds.height !== undefined) m.info.height = bounds.height;

    this.bus.emit({ kind: 'windowBoundsChanged', windowId, data: { ...bounds } });
    return true;
  }

  getWindowInfo(windowId: string): DesktopWindowInfo | null {
    const m = this.managed.get(windowId);
    return m ? { ...m.info } : null;
  }

  getWindow(windowId: string): IWindow | null {
    const m = this.managed.get(windowId);
    return m?.window ?? null;
  }

  on(type: WindowManagerEventType, handler: WindowManagerEventHandler): void {
    this.bus.on(type, handler);
  }

  off(type: WindowManagerEventType, handler: WindowManagerEventHandler): void {
    this.bus.off(type, handler);
  }

  dispose(): void {
    const ids = [...this.managed.keys()];
    for (const id of ids) {
      this.managed.delete(id);
    }
    this.bus.dispose();
    this._activeWindowId = null;
  }
}

export { WindowManager, WindowManagerEventBus };
export type { IWindowManager, DesktopWindowInfo, WindowCreateOptions, WindowManagerEvent, WindowManagerEventType, WindowState };
