/**
 * @file src/browser/settings/guest.ts
 *
 * Guest mode — temporary browsing session with no data persistence.
 * All bookmarks, history, cookies, cache, and settings are wiped on exit.
 * Useful for lending your browser to someone else.
 */

import type { IDisposable } from '../../app/dependency-container';
import { randomUUID } from '../security/crypto-utils';

// ─────────────────────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────────────────────

export interface GuestConfig {
  /** Whether guest mode is available */
  enabled: boolean;
  /** Auto-close all tabs when guest session ends */
  autoCloseTabs: boolean;
  /** Whether to allow downloading files in guest mode */
  allowDownloads: boolean;
  /** Whether to allow bookmarks in guest mode */
  allowBookmarks: boolean;
  /** Max tabs allowed in guest mode */
  maxTabs: number;
}

export interface GuestSession {
  readonly sessionId: string;
  readonly startedAt: number;
  readonly tabsOpened: number;
  readonly pagesVisited: number;
  readonly downloadsAttempted: number;
}

export type GuestEventType = 'modeActivated' | 'modeDeactivated' | 'tabOpened' | 'pageVisited' | 'downloadAttempted' | 'sessionEnded';

export interface GuestEvent {
  readonly kind: GuestEventType;
  readonly sessionId: string;
  readonly url?: string;
  readonly summary?: GuestSessionSummary;
}

export interface GuestSessionSummary {
  readonly sessionId: string;
  readonly duration: number;
  readonly tabsOpened: number;
  readonly pagesVisited: number;
  readonly downloadsAttempted: number;
}

export type GuestEventHandler = (event: GuestEvent) => void;

// ─────────────────────────────────────────────────────────────────────────────
// INTERFACE
// ─────────────────────────────────────────────────────────────────────────────

export interface IGuestManager extends IDisposable {
  /** Activate guest mode */
  activate(): GuestSession;
  /** Deactivate guest mode and wipe all data */
  deactivate(): GuestSessionSummary;
  /** Check if guest mode is active */
  isActive(): boolean;
  /** Get the current session */
  getSession(): GuestSession | undefined;
  /** Get config */
  getConfig(): GuestConfig;
  /** Update config */
  setConfig(config: Partial<GuestConfig>): void;
  /** Record a tab opened */
  recordTabOpened(): void;
  /** Record a page visit */
  recordVisit(url: string): void;
  /** Record a download attempt */
  recordDownload(): boolean;
  /** Get session stats */
  getStats(): GuestSessionSummary | undefined;
  /** Subscribe to events */
  onEvent(handler: GuestEventHandler): () => void;
}

// ─────────────────────────────────────────────────────────────────────────────
// IMPLEMENTATION
// ─────────────────────────────────────────────────────────────────────────────

export class GuestManager implements IGuestManager {
  private config: GuestConfig;
  private session: GuestSession | null = null;
  private handlers: GuestEventHandler[] = [];
  private disposed = false;

  constructor(config?: Partial<GuestConfig>) {
    this.config = {
      enabled: true,
      autoCloseTabs: true,
      allowDownloads: true,
      allowBookmarks: false,
      maxTabs: 10,
      ...config,
    };
  }

  activate(): GuestSession {
    if (this.session) return this.session;

    this.session = {
      sessionId: `guest-${randomUUID().slice(0, 8)}`,
      startedAt: Date.now(),
      tabsOpened: 1,
      pagesVisited: 0,
      downloadsAttempted: 0,
    };

    this.emit({ kind: 'modeActivated', sessionId: this.session.sessionId });
    return this.session;
  }

  deactivate(): GuestSessionSummary {
    const summary = this.buildSummary();

    if (this.session) {
      this.emit({ kind: 'sessionEnded', sessionId: this.session.sessionId, summary });
    }

    this.session = null;
    this.emit({ kind: 'modeDeactivated', sessionId: summary.sessionId });

    return summary;
  }

  isActive(): boolean {
    return this.session !== null;
  }

  getSession(): GuestSession | undefined {
    return this.session ? { ...this.session } : undefined;
  }

  getConfig(): GuestConfig {
    return { ...this.config };
  }

  setConfig(config: Partial<GuestConfig>): void {
    Object.assign(this.config, config);
  }

  recordTabOpened(): void {
    if (!this.session) return;
    if (this.session.tabsOpened >= this.config.maxTabs) return;
    (this.session as { tabsOpened: number }).tabsOpened++;
    this.emit({ kind: 'tabOpened', sessionId: this.session.sessionId });
  }

  recordVisit(url: string): void {
    if (!this.session) return;
    (this.session as { pagesVisited: number }).pagesVisited++;
    this.emit({ kind: 'pageVisited', sessionId: this.session.sessionId, url });
  }

  recordDownload(): boolean {
    if (!this.session) return false;
    if (!this.config.allowDownloads) return false;
    (this.session as { downloadsAttempted: number }).downloadsAttempted++;
    this.emit({ kind: 'downloadAttempted', sessionId: this.session.sessionId });
    return true;
  }

  getStats(): GuestSessionSummary | undefined {
    return this.session ? this.buildSummary() : undefined;
  }

  onEvent(handler: GuestEventHandler): () => void {
    this.handlers.push(handler);
    return () => {
      const idx = this.handlers.indexOf(handler);
      if (idx >= 0) this.handlers.splice(idx, 1);
    };
  }

  dispose(): void {
    if (this.session) this.deactivate();
    this.disposed = true;
    this.handlers.length = 0;
  }

  private buildSummary(): GuestSessionSummary {
    return {
      sessionId: this.session?.sessionId ?? '',
      duration: this.session ? Date.now() - this.session.startedAt : 0,
      tabsOpened: this.session?.tabsOpened ?? 0,
      pagesVisited: this.session?.pagesVisited ?? 0,
      downloadsAttempted: this.session?.downloadsAttempted ?? 0,
    };
  }

  private emit(event: GuestEvent): void {
    for (const handler of this.handlers) {
      try { handler(event); } catch {}
    }
  }
}

export function createGuestManager(config?: Partial<GuestConfig>): GuestManager {
  return new GuestManager(config);
}
