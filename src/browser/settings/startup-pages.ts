/**
 * @file src/browser/settings/startup-pages.ts
 *
 * Startup Pages — configurable pages to open on browser launch.
 * Supports opening specific URLs, new tab, previous session, or
 * a custom set of pages.
 */

import type { IDisposable } from '../../app/dependency-container';
import { randomUUID } from '../security/crypto-utils';

// ─────────────────────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────────────────────

export type StartupAction = 'new-tab' | 'last-session' | 'specific-pages' | 'continue-where-left';

export interface StartupPage {
  readonly id: string;
  url: string;
  title: string;
  pinned: boolean;
  position: number;
}

export interface StartupPagesConfig {
  /** What to do on startup */
  action: StartupAction;
  /** Pages to open when action is 'specific-pages' */
  pages: StartupPage[];
  /** Open pages in new window (false = reuse current) */
  newWindow: boolean;
}

export type StartupPagesEventType = 'pagesChanged' | 'actionChanged' | 'pageAdded' | 'pageRemoved' | 'pageReordered';

export interface StartupPagesEvent {
  readonly kind: StartupPagesEventType;
  readonly pageId?: string;
  readonly action?: StartupAction;
}

export type StartupPagesEventHandler = (event: StartupPagesEvent) => void;

// ─────────────────────────────────────────────────────────────────────────────
// INTERFACE
// ─────────────────────────────────────────────────────────────────────────────

export interface IStartupPages extends IDisposable {
  /** Get the startup action */
  getAction(): StartupAction;
  /** Set the startup action */
  setAction(action: StartupAction): void;
  /** Get all startup pages */
  getPages(): readonly StartupPage[];
  /** Add a startup page */
  addPage(url: string, title?: string, pinned?: boolean): StartupPage;
  /** Remove a startup page */
  removePage(pageId: string): boolean;
  /** Update a startup page */
  updatePage(pageId: string, updates: Partial<Pick<StartupPage, 'url' | 'title' | 'pinned'>>): boolean;
  /** Reorder a startup page */
  reorderPage(pageId: string, newPosition: number): boolean;
  /** Get pages to open on startup (resolved based on action) */
  getStartupPages(): StartupPage[];
  /** Get config */
  getConfig(): StartupPagesConfig;
  /** Update config */
  setConfig(config: Partial<StartupPagesConfig>): void;
  /** Subscribe to events */
  onEvent(handler: StartupPagesEventHandler): () => void;
}

// ─────────────────────────────────────────────────────────────────────────────
// IMPLEMENTATION
// ─────────────────────────────────────────────────────────────────────────────

export class StartupPages implements IStartupPages {
  private config: StartupPagesConfig;
  private handlers: StartupPagesEventHandler[] = [];
  private disposed = false;

  constructor(config?: Partial<StartupPagesConfig>) {
    this.config = {
      action: 'new-tab',
      pages: [],
      newWindow: true,
      ...config,
    };
  }

  getAction(): StartupAction {
    return this.config.action;
  }

  setAction(action: StartupAction): void {
    this.config.action = action;
    this.emit({ kind: 'actionChanged', action });
  }

  getPages(): readonly StartupPage[] {
    return [...this.config.pages].sort((a, b) => a.position - b.position);
  }

  addPage(url: string, title?: string, pinned?: boolean): StartupPage {
    const maxPos = this.config.pages.reduce((max, p) => Math.max(max, p.position), -1);
    const page: StartupPage = {
      id: `startup-${randomUUID().slice(0, 8)}`,
      url,
      title: title ?? this.extractTitle(url),
      pinned: pinned ?? false,
      position: maxPos + 1,
    };
    this.config.pages.push(page);
    this.emit({ kind: 'pageAdded', pageId: page.id });
    return page;
  }

  removePage(pageId: string): boolean {
    const idx = this.config.pages.findIndex(p => p.id === pageId);
    if (idx < 0) return false;
    this.config.pages.splice(idx, 1);
    this.emit({ kind: 'pageRemoved', pageId });
    return true;
  }

  updatePage(pageId: string, updates: Partial<Pick<StartupPage, 'url' | 'title' | 'pinned'>>): boolean {
    const page = this.config.pages.find(p => p.id === pageId);
    if (!page) return false;
    if (updates.url !== undefined) (page as { url: string }).url = updates.url;
    if (updates.title !== undefined) (page as { title: string }).title = updates.title;
    if (updates.pinned !== undefined) (page as { pinned: boolean }).pinned = updates.pinned;
    this.emit({ kind: 'pagesChanged' });
    return true;
  }

  reorderPage(pageId: string, newPosition: number): boolean {
    const idx = this.config.pages.findIndex(p => p.id === pageId);
    if (idx < 0) return false;
    const [page] = this.config.pages.splice(idx, 1);
    const clamped = Math.max(0, Math.min(newPosition, this.config.pages.length));
    this.config.pages.splice(clamped, 0, page);
    this.config.pages.forEach((p, i) => (p as { position: number }).position = i);
    this.emit({ kind: 'pageReordered', pageId });
    return true;
  }

  getStartupPages(): StartupPage[] {
    if (this.config.action === 'new-tab') {
      return [{ id: 'new-tab', url: 'about:newtab', title: 'New Tab', pinned: false, position: 0 }];
    }
    if (this.config.action === 'last-session' || this.config.action === 'continue-where-left') {
      // In production, this would load from session store
      return [];
    }
    return [...this.getPages()];
  }

  getConfig(): StartupPagesConfig {
    return { ...this.config, pages: [...this.config.pages] };
  }

  setConfig(config: Partial<StartupPagesConfig>): void {
    if (config.action !== undefined) this.config.action = config.action;
    if (config.pages !== undefined) this.config.pages = [...config.pages];
    if (config.newWindow !== undefined) this.config.newWindow = config.newWindow;
  }

  onEvent(handler: StartupPagesEventHandler): () => void {
    this.handlers.push(handler);
    return () => {
      const idx = this.handlers.indexOf(handler);
      if (idx >= 0) this.handlers.splice(idx, 1);
    };
  }

  dispose(): void {
    this.disposed = true;
    this.handlers.length = 0;
  }

  private extractTitle(url: string): string {
    try {
      const parsed = new URL(url);
      return parsed.hostname || url;
    } catch {
      return url;
    }
  }

  private emit(event: StartupPagesEvent): void {
    for (const handler of this.handlers) {
      try { handler(event); } catch {}
    }
  }
}

export function createStartupPages(config?: Partial<StartupPagesConfig>): StartupPages {
  return new StartupPages(config);
}
