import type { IDisposable } from '../../../app/dependency-container';

type ToolbarEventType =
  | 'back' | 'forward' | 'reload' | 'stop'
  | 'shieldToggle' | 'menuClick' | 'bookmarkAdd';

interface ToolbarEvent {
  readonly kind: ToolbarEventType;
}

interface BackEvent extends ToolbarEvent { readonly kind: 'back'; }
interface ForwardEvent extends ToolbarEvent { readonly kind: 'forward'; }
interface ReloadEvent extends ToolbarEvent { readonly kind: 'reload'; }
interface StopEvent extends ToolbarEvent { readonly kind: 'stop'; }
interface ShieldToggleEvent extends ToolbarEvent { readonly kind: 'shieldToggle'; readonly enabled: boolean; }
interface MenuClickEvent extends ToolbarEvent { readonly kind: 'menuClick'; }
interface BookmarkAddEvent extends ToolbarEvent { readonly kind: 'bookmarkAdd'; }

type ToolbarEventUnion =
  | BackEvent | ForwardEvent | ReloadEvent | StopEvent
  | ShieldToggleEvent | MenuClickEvent | BookmarkAddEvent;

interface ToolbarState {
  readonly canGoBack: boolean;
  readonly canGoForward: boolean;
  readonly loading: boolean;
  readonly shieldEnabled: boolean;
}

interface IToolbar extends IDisposable {
  readonly state: ToolbarState;
  setCanGoBack(can: boolean): void;
  setCanGoForward(can: boolean): void;
  setLoading(loading: boolean): void;
  setShieldEnabled(enabled: boolean): void;
  toggleShield(): void;
  on(type: ToolbarEventType, handler: (event: ToolbarEventUnion) => void): void;
  off(type: ToolbarEventType, handler: (event: ToolbarEventUnion) => void): void;
}

type ToolbarEventHandler = (event: ToolbarEventUnion) => void;

class ToolbarEventBus {
  private readonly channels = new Map<ToolbarEventType, Set<ToolbarEventHandler>>();

  on(type: ToolbarEventType, handler: ToolbarEventHandler): void {
    if (!this.channels.has(type)) this.channels.set(type, new Set());
    this.channels.get(type)!.add(handler);
  }

  off(type: ToolbarEventType, handler: ToolbarEventHandler): void {
    this.channels.get(type)?.delete(handler);
  }

  emit(event: ToolbarEventUnion): void {
    const handlers = this.channels.get(event.kind);
    if (!handlers) return;
    for (const h of handlers) {
      try { h(event); } catch (err) {
        console.error(`[Toolbar] Handler threw on "${event.kind}":`, err);
      }
    }
  }

  dispose(): void { this.channels.clear(); }
}

class Toolbar implements IToolbar {
  private readonly bus = new ToolbarEventBus();
  private _canGoBack = false;
  private _canGoForward = false;
  private _loading = false;
  private _shieldEnabled = true;

  get state(): ToolbarState {
    return {
      canGoBack: this._canGoBack,
      canGoForward: this._canGoForward,
      loading: this._loading,
      shieldEnabled: this._shieldEnabled,
    };
  }

  setCanGoBack(can: boolean): void { this._canGoBack = can; }
  setCanGoForward(can: boolean): void { this._canGoForward = can; }
  setLoading(loading: boolean): void { this._loading = loading; }
  setShieldEnabled(enabled: boolean): void { this._shieldEnabled = enabled; }

  goBack(): void { this.bus.emit({ kind: 'back' }); }
  goForward(): void { this.bus.emit({ kind: 'forward' }); }
  reload(): void { this.bus.emit({ kind: 'reload' }); }
  stop(): void { this.bus.emit({ kind: 'stop' }); }
  toggleShield(): void {
    this._shieldEnabled = !this._shieldEnabled;
    this.bus.emit({ kind: 'shieldToggle', enabled: this._shieldEnabled });
  }
  showMenu(): void { this.bus.emit({ kind: 'menuClick' }); }
  addBookmark(): void { this.bus.emit({ kind: 'bookmarkAdd' }); }

  on(type: ToolbarEventType, handler: ToolbarEventHandler): void {
    this.bus.on(type, handler);
  }

  off(type: ToolbarEventType, handler: ToolbarEventHandler): void {
    this.bus.off(type, handler);
  }

  dispose(): void {
    this.bus.dispose();
  }
}

export { Toolbar, ToolbarEventBus };
export type {
  IToolbar,
  ToolbarState,
  ToolbarEventUnion,
  ToolbarEventType,
};
