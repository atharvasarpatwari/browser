/**
 * @file src/browser/settings/session-restore.ts
 *
 * Session Restore — saves open tabs, windows, and scroll positions so they
 * can be restored on browser restart. Supports automatic saving and
 * manual restore.
 */

import type { IDisposable } from '../../app/dependency-container';
import { randomUUID } from '../security/crypto-utils';

// ─────────────────────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────────────────────

export type RestorePolicy = 'always' | 'ask' | 'never';

export interface SessionRestoreConfig {
  /** When to restore session */
  restorePolicy: RestorePolicy;
  /** Max number of tabs to restore */
  maxTabsToRestore: number;
  /** Max age of session to restore (ms). Older sessions are discarded */
  maxSessionAge: number;
  /** Whether to save scroll positions */
  saveScrollPositions: boolean;
  /** Whether to save form data */
  saveFormData: boolean;
  /** Auto-save interval (ms) */
  autoSaveIntervalMs: number;
}

export interface SavedTab {
  readonly id: string;
  url: string;
  title: string;
  favicon: string;
  scrollX: number;
  scrollY: number;
  zoomLevel: number;
  lastActiveAt: number;
  formData: Record<string, unknown>;
}

export interface SavedWindow {
  readonly id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  isMaximized: boolean;
  tabs: SavedTab[];
  activeTabIndex: number;
}

export interface SavedSession {
  readonly sessionId: string;
  readonly savedAt: number;
  readonly windowCount: number;
  readonly tabCount: number;
  windows: SavedWindow[];
}

export type SessionRestoreEventType = 'sessionSaved' | 'sessionRestored' | 'sessionDiscarded' | 'tabSaved';

export interface SessionRestoreEvent {
  readonly kind: SessionRestoreEventType;
  readonly sessionId?: string;
  readonly tabCount?: number;
  readonly windowCount?: number;
}

export type SessionRestoreEventHandler = (event: SessionRestoreEvent) => void;

// ─────────────────────────────────────────────────────────────────────────────
// INTERFACE
// ─────────────────────────────────────────────────────────────────────────────

export interface ISessionRestore extends IDisposable {
  /** Save the current session */
  saveSession(windows: SavedWindow[]): SavedSession;
  /** Restore the last saved session */
  restoreSession(): SavedSession | undefined;
  /** Check if a session is available to restore */
  hasSavedSession(): boolean;
  /** Get the last saved session */
  getSavedSession(): SavedSession | undefined;
  /** Discard the saved session */
  discardSession(): boolean;
  /** Get config */
  getConfig(): SessionRestoreConfig;
  /** Update config */
  setConfig(config: Partial<SessionRestoreConfig>): void;
  /** Check if session should be restored on startup */
  shouldRestoreOnStartup(): boolean;
  /** Subscribe to events */
  onEvent(handler: SessionRestoreEventHandler): () => void;
}

// ─────────────────────────────────────────────────────────────────────────────
// IMPLEMENTATION
// ─────────────────────────────────────────────────────────────────────────────

export class SessionRestore implements ISessionRestore {
  private config: SessionRestoreConfig;
  private savedSession: SavedSession | null = null;
  private handlers: SessionRestoreEventHandler[] = [];
  private disposed = false;

  constructor(config?: Partial<SessionRestoreConfig>) {
    this.config = {
      restorePolicy: 'always',
      maxTabsToRestore: 100,
      maxSessionAge: 24 * 60 * 60 * 1000, // 24 hours
      saveScrollPositions: true,
      saveFormData: false,
      autoSaveIntervalMs: 30_000,
      ...config,
    };
  }

  saveSession(windows: SavedWindow[]): SavedSession {
    const totalTabs = windows.reduce((sum, w) => sum + w.tabs.length, 0);

    // Truncate if too many tabs
    const truncatedWindows = windows.map(w => ({
      ...w,
      tabs: w.tabs.slice(0, this.config.maxTabsToRestore),
    }));

    this.savedSession = {
      sessionId: randomUUID(),
      savedAt: Date.now(),
      windowCount: truncatedWindows.length,
      tabCount: Math.min(totalTabs, this.config.maxTabsToRestore),
      windows: truncatedWindows,
    };

    this.emit({
      kind: 'sessionSaved',
      sessionId: this.savedSession.sessionId,
      tabCount: this.savedSession.tabCount,
      windowCount: this.savedSession.windowCount,
    });

    return this.savedSession;
  }

  restoreSession(): SavedSession | undefined {
    if (!this.savedSession) return undefined;

    // Check age
    const age = Date.now() - this.savedSession.savedAt;
    if (age > this.config.maxSessionAge) {
      this.emit({ kind: 'sessionDiscarded', sessionId: this.savedSession.sessionId });
      this.savedSession = null;
      return undefined;
    }

    const session = this.savedSession;
    this.emit({
      kind: 'sessionRestored',
      sessionId: session.sessionId,
      tabCount: session.tabCount,
      windowCount: session.windowCount,
    });

    return session;
  }

  hasSavedSession(): boolean {
    if (!this.savedSession) return false;
    const age = Date.now() - this.savedSession.savedAt;
    return age <= this.config.maxSessionAge;
  }

  getSavedSession(): SavedSession | undefined {
    return this.savedSession ? { ...this.savedSession } : undefined;
  }

  discardSession(): boolean {
    if (!this.savedSession) return false;
    const id = this.savedSession.sessionId;
    this.savedSession = null;
    this.emit({ kind: 'sessionDiscarded', sessionId: id });
    return true;
  }

  getConfig(): SessionRestoreConfig {
    return { ...this.config };
  }

  setConfig(config: Partial<SessionRestoreConfig>): void {
    Object.assign(this.config, config);
  }

  shouldRestoreOnStartup(): boolean {
    if (this.config.restorePolicy === 'never') return false;
    if (this.config.restorePolicy === 'always') return this.hasSavedSession();
    // 'ask' — has saved session but needs user confirmation
    return this.hasSavedSession();
  }

  onEvent(handler: SessionRestoreEventHandler): () => void {
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

  private emit(event: SessionRestoreEvent): void {
    for (const handler of this.handlers) {
      try { handler(event); } catch {}
    }
  }
}

export function createSessionRestore(config?: Partial<SessionRestoreConfig>): SessionRestore {
  return new SessionRestore(config);
}
