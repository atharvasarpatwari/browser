import type { IDisposable } from '../../app/dependency-container';

interface IHardReload extends IDisposable {
  execute(): boolean;
  canReload(): boolean;
  onEvent(handler: HardReloadEventHandler): () => void;
}

type HardReloadEventKind = 'reloaded' | 'unavailable';
interface HardReloadEvent {
  readonly kind: HardReloadEventKind;
}

type HardReloadEventHandler = (event: HardReloadEvent) => void;

interface NavigationControllerLike {
  navigateTo(url: string, opts?: { cacheBust?: boolean }): { success: boolean };
  getCurrentEntry(): { url: string } | null;
}

class HardReload implements IHardReload {
  private controller: NavigationControllerLike;
  private handlers = new Set<HardReloadEventHandler>();

  constructor(controller: NavigationControllerLike) {
    this.controller = controller;
  }

  execute(): boolean {
    if (!this.canReload()) {
      this.emit({ kind: 'unavailable' });
      return false;
    }
    const entry = this.controller.getCurrentEntry()!;
    const cacheBustUrl = this.addCacheBust(entry.url);
    const result = this.controller.navigateTo(cacheBustUrl, { cacheBust: true });
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

  private addCacheBust(url: string): string {
    const separator = url.includes('?') ? '&' : '?';
    const cacheBust = `_cb=${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
    return `${url}${separator}${cacheBust}`;
  }

  onEvent(handler: HardReloadEventHandler): () => void {
    this.handlers.add(handler);
    return () => { this.handlers.delete(handler); };
  }

  private emit(event: HardReloadEvent): void {
    for (const h of this.handlers) {
      try { h(event); } catch { /* swallow */ }
    }
  }

  dispose(): void {
    this.handlers.clear();
  }
}

export { HardReload };
export type { IHardReload, HardReloadEvent, HardReloadEventKind, HardReloadEventHandler };
