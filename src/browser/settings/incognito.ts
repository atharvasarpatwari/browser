/**
 * @file src/browser/settings/incognito.ts
 *
 * Incognito (private browsing) mode — no history, cookies, cache, or
 * local storage persistence. Separate session with ephemeral data.
 */

import type { IDisposable } from '../../app/dependency-container';
import { randomUUID } from 'crypto';

// ─────────────────────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────────────────────

export interface IncognitoConfig {
  enabled: boolean;
  /** Block third-party cookies in incognito */
  blockThirdPartyCookies: boolean;
  /** Block trackers in incognito */
  blockTrackers: boolean;
  /** Send Do Not Track in incognito */
  doNotTrack: boolean;
  /** Disable extensions in incognito */
  disableExtensions: boolean;
}

export interface IncognitoSession {
  readonly sessionId: string;
  readonly startedAt: number;
  readonly tabsOpened: number;
  readonly pagesVisited: number;
  readonly cookiesBlocked: number;
  readonly trackersBlocked: number;
}

export type IncognitoEventType = 'modeActivated' | 'modeDeactivated' | 'tabOpened' | 'pageVisited' | 'cookieBlocked' | 'trackerBlocked';

export interface IncognitoEvent {
  readonly kind: IncognitoEventType;
  readonly sessionId: string;
  readonly url?: string;
}

export type IncognitoEventHandler = (event: IncognitoEvent) => void;

// ─────────────────────────────────────────────────────────────────────────────
// INTERFACE
// ─────────────────────────────────────────────────────────────────────────────

export interface IIncognitoManager extends IDisposable {
  /** Activate incognito mode, returns the session */
  activate(): IncognitoSession;
  /** Deactivate incognito mode */
  deactivate(): void;
  /** Check if incognito is active */
  isActive(): boolean;
  /** Get the current session */
  getSession(): IncognitoSession | undefined;
  /** Get config */
  getConfig(): IncognitoConfig;
  /** Update config */
  setConfig(config: Partial<IncognitoConfig>): void;
  /** Record a page visit (for stats, not persisted) */
  recordVisit(url: string): void;
  /** Record a blocked cookie */
  recordCookieBlocked(): void;
  /** Record a blocked tracker */
  recordTrackerBlocked(): void;
  /** Get session stats */
  getStats(): IncognitoStats;
  /** Subscribe to events */
  onEvent(handler: IncognitoEventHandler): () => void;
  /** Clear all ephemeral data */
  clearEphemeralData(): void;
}

export interface IncognitoStats {
  isActive: boolean;
  sessionDuration: number;
  tabsOpened: number;
  pagesVisited: number;
  cookiesBlocked: number;
  trackersBlocked: number;
  totalDataBlocked: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// IMPLEMENTATION
// ─────────────────────────────────────────────────────────────────────────────

export class IncognitoManager implements IIncognitoManager {
  private config: IncognitoConfig;
  private session: IncognitoSession | null = null;
  private handlers: IncognitoEventHandler[] = [];
  private disposed = false;

  constructor(config?: Partial<IncognitoConfig>) {
    this.config = {
      enabled: true,
      blockThirdPartyCookies: true,
      blockTrackers: true,
      doNotTrack: true,
      disableExtensions: true,
      ...config,
    };
  }

  activate(): IncognitoSession {
    if (this.session) return this.session;

    this.session = {
      sessionId: `incognito-${randomUUID().slice(0, 8)}`,
      startedAt: Date.now(),
      tabsOpened: 1,
      pagesVisited: 0,
      cookiesBlocked: 0,
      trackersBlocked: 0,
    };

    this.emit({ kind: 'modeActivated', sessionId: this.session.sessionId });
    return this.session;
  }

  deactivate(): void {
    if (!this.session) return;
    const sessionId = this.session.sessionId;
    this.session = null;
    this.emit({ kind: 'modeDeactivated', sessionId });
  }

  isActive(): boolean {
    return this.session !== null;
  }

  getSession(): IncognitoSession | undefined {
    return this.session ? { ...this.session } : undefined;
  }

  getConfig(): IncognitoConfig {
    return { ...this.config };
  }

  setConfig(config: Partial<IncognitoConfig>): void {
    Object.assign(this.config, config);
  }

  recordVisit(url: string): void {
    if (!this.session) return;
    (this.session as { pagesVisited: number }).pagesVisited++;
    this.emit({ kind: 'pageVisited', sessionId: this.session.sessionId, url });
  }

  recordCookieBlocked(): void {
    if (!this.session) return;
    (this.session as { cookiesBlocked: number }).cookiesBlocked++;
    this.emit({ kind: 'cookieBlocked', sessionId: this.session.sessionId });
  }

  recordTrackerBlocked(): void {
    if (!this.session) return;
    (this.session as { trackersBlocked: number }).trackersBlocked++;
    this.emit({ kind: 'trackerBlocked', sessionId: this.session.sessionId });
  }

  getStats(): IncognitoStats {
    return {
      isActive: this.isActive(),
      sessionDuration: this.session ? Date.now() - this.session.startedAt : 0,
      tabsOpened: this.session?.tabsOpened ?? 0,
      pagesVisited: this.session?.pagesVisited ?? 0,
      cookiesBlocked: this.session?.cookiesBlocked ?? 0,
      trackersBlocked: this.session?.trackersBlocked ?? 0,
      totalDataBlocked: (this.session?.cookiesBlocked ?? 0) + (this.session?.trackersBlocked ?? 0),
    };
  }

  onEvent(handler: IncognitoEventHandler): () => void {
    this.handlers.push(handler);
    return () => {
      const idx = this.handlers.indexOf(handler);
      if (idx >= 0) this.handlers.splice(idx, 1);
    };
  }

  clearEphemeralData(): void {
    // In production, this would clear in-memory caches, ephemeral cookies, etc.
    if (this.session) {
      (this.session as { pagesVisited: number }).pagesVisited = 0;
      (this.session as { cookiesBlocked: number }).cookiesBlocked = 0;
      (this.session as { trackersBlocked: number }).trackersBlocked = 0;
    }
  }

  dispose(): void {
    this.deactivate();
    this.disposed = true;
    this.handlers.length = 0;
  }

  private emit(event: IncognitoEvent): void {
    for (const handler of this.handlers) {
      try { handler(event); } catch {}
    }
  }
}

export function createIncognitoManager(config?: Partial<IncognitoConfig>): IncognitoManager {
  return new IncognitoManager(config);
}
