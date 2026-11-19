import type { IDisposable } from '../../app/dependency-container';

interface IForward extends IDisposable {
  execute(): boolean;
  canGoForward(): boolean;
  onEvent(handler: ForwardEventHandler): () => void;
}

type ForwardEventKind = 'navigated' | 'unavailable';
interface ForwardEvent {
  readonly kind: ForwardEventKind;
}

type ForwardEventHandler = (event: ForwardEvent) => void;

interface NavigationControllerLike {
  forward(): { success: boolean };
  canGoForward(): boolean;
}

class Forward implements IForward {
  private controller: NavigationControllerLike;
  private handlers = new Set<ForwardEventHandler>();

  constructor(controller: NavigationControllerLike) {
    this.controller = controller;
  }

  execute(): boolean {
    if (!this.controller.canGoForward()) {
      this.emit({ kind: 'unavailable' });
      return false;
    }
    const result = this.controller.forward();
    if (result.success) {
      this.emit({ kind: 'navigated' });
      return true;
    }
    this.emit({ kind: 'unavailable' });
    return false;
  }

  canGoForward(): boolean {
    return this.controller.canGoForward();
  }

  onEvent(handler: ForwardEventHandler): () => void {
    this.handlers.add(handler);
    return () => { this.handlers.delete(handler); };
  }

  private emit(event: ForwardEvent): void {
    for (const h of this.handlers) {
      try { h(event); } catch { /* swallow */ }
    }
  }

  dispose(): void {
    this.handlers.clear();
  }
}

export { Forward };
export type { IForward, ForwardEvent, ForwardEventKind, ForwardEventHandler };
