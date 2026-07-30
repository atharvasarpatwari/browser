import type { BackgroundDeclaration } from './extension-types';

export interface BackgroundPageInfo {
  extensionId: string;
  declaration: BackgroundDeclaration;
  active: boolean;
  startedAt: number;
  lastActivity: number;
}

export type BgEventType = 'started' | 'stopped' | 'heartbeat' | 'error';

export interface BgEvent {
  kind: BgEventType;
  extensionId: string;
  message?: string;
}

export type BgEventHandler = (event: BgEvent) => void;

export class BackgroundScriptsManager {
  private pages = new Map<string, BackgroundPageInfo>();
  private handlers = new Set<BgEventHandler>();

  start(extensionId: string, declaration: BackgroundDeclaration): BackgroundPageInfo {
    const existing = this.pages.get(extensionId);
    if (existing) {
      existing.active = true;
      existing.lastActivity = Date.now();
      this.emit({ kind: 'heartbeat', extensionId });
      return existing;
    }

    const info: BackgroundPageInfo = {
      extensionId,
      declaration,
      active: true,
      startedAt: Date.now(),
      lastActivity: Date.now(),
    };
    this.pages.set(extensionId, info);
    this.emit({ kind: 'started', extensionId });
    return info;
  }

  stop(extensionId: string): boolean {
    const page = this.pages.get(extensionId);
    if (!page) return false;
    page.active = false;
    this.emit({ kind: 'stopped', extensionId });
    return true;
  }

  heartbeat(extensionId: string): void {
    const page = this.pages.get(extensionId);
    if (!page) return;
    page.lastActivity = Date.now();
    this.emit({ kind: 'heartbeat', extensionId });
  }

  isActive(extensionId: string): boolean {
    return this.pages.get(extensionId)?.active ?? false;
  }

  getInfo(extensionId: string): BackgroundPageInfo | undefined {
    return this.pages.get(extensionId);
  }

  getAllActive(): BackgroundPageInfo[] {
    return [...this.pages.values()].filter(p => p.active);
  }

  getBackgroundScripts(extensionId: string): string[] {
    const page = this.pages.get(extensionId);
    if (!page) return [];
    if (page.declaration.service_worker) return [page.declaration.service_worker];
    if (page.declaration.scripts) return page.declaration.scripts;
    if (page.declaration.page) return [page.declaration.page];
    return [];
  }

  isPersistent(extensionId: string): boolean {
    return this.pages.get(extensionId)?.declaration.persistent ?? false;
  }

  reportError(extensionId: string, message: string): void {
    this.emit({ kind: 'error', extensionId, message });
  }

  stopAll(): void {
    for (const id of this.pages.keys()) {
      this.stop(id);
    }
  }

  onEvent(handler: BgEventHandler): () => void {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }

  clear(): void {
    this.pages.clear();
  }

  dispose(): void {
    this.clear();
    this.handlers.clear();
  }

  private emit(event: BgEvent): void {
    for (const h of this.handlers) {
      try { h(event); } catch { }
    }
  }
}
