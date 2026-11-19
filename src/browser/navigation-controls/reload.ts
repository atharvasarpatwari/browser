import type { IDisposable } from '../../app/dependency-container';

interface IReload extends IDisposable {
  execute(): boolean;
  canReload(): boolean;
  onEvent(handler: ReloadEventHandler): () => void;
}

type ReloadEventKind = 'reloaded' | 'unavailable';
interface ReloadEvent {
  readonly kind: ReloadEventKind;
}

type ReloadEventHandler = (event: ReloadEvent) => void;

interface NavigationControllerLike {
  reload(): { success: boolean };
  getCurrentEntry(): { url: string } | null;
}

class Reload implements IReload {
  private controller: NavigationControllerLike;
  private handlers = new Set<ReloadEventHandler>();

  constructor(controller: NavigationControllerLike) {
    this.controller = controller;
  }

  execute(): boolean {
    if (!this.canReload()) {
      this.emit({ kind: 'unavailable' });
      return false;
    }
    const result = this.controller.reload();
    if (result.success) {
      this.emit({ kind: 'reloaded' });
      return true;
    }
    this.emit({ kind: 'unavailable' });
    return false;
  }

  canReload(): boolean {
    return this.controller.getCurrentEntry() !== null;
  }

  onEvent(handler: ReloadEventHandler): () => void {
    this.handlers.add(handler);
    return () => { this.handlers.delete(handler); };
  }

  private emit(event: ReloadEvent): void {
    for (const h of this.handlers) {
      try { h(event); } catch { /* swallow */ }
    }
  }

  dispose(): void {
    this.handlers.clear();
  }
}

export { Reload };
export type { IReload, ReloadEvent, ReloadEventKind, ReloadEventHandler };
