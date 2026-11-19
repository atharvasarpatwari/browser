import type { IDisposable } from '../../app/dependency-container';

interface IBack extends IDisposable {
  execute(): boolean;
  canGoBack(): boolean;
  onEvent(handler: BackEventHandler): () => void;
}

type BackEventKind = 'navigated' | 'unavailable';
interface BackEvent {
  readonly kind: BackEventKind;
}

type BackEventHandler = (event: BackEvent) => void;

interface NavigationControllerLike {
  back(): { success: boolean };
  canGoBack(): boolean;
}

class Back implements IBack {
  private controller: NavigationControllerLike;
  private handlers = new Set<BackEventHandler>();

  constructor(controller: NavigationControllerLike) {
    this.controller = controller;
  }

  execute(): boolean {
    if (!this.controller.canGoBack()) {
      this.emit({ kind: 'unavailable' });
      return false;
    }
    const result = this.controller.back();
    if (result.success) {
      this.emit({ kind: 'navigated' });
      return true;
    }
    this.emit({ kind: 'unavailable' });
    return false;
  }

  canGoBack(): boolean {
    return this.controller.canGoBack();
  }

  onEvent(handler: BackEventHandler): () => void {
    this.handlers.add(handler);
    return () => { this.handlers.delete(handler); };
  }

  private emit(event: BackEvent): void {
    for (const h of this.handlers) {
      try { h(event); } catch { /* swallow */ }
    }
  }

  dispose(): void {
    this.handlers.clear();
  }
}

export { Back };
export type { IBack, BackEvent, BackEventKind, BackEventHandler, NavigationControllerLike };
