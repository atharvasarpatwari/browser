/**
 * @file src/browser/auth/auth-session.ts
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * RESPONSIBILITY
 * ─────────────────────────────────────────────────────────────────────────────
 * Manage the lifecycle of an authentication session.
 *
 * An AuthSession tracks:
 *   • Current state (unauthenticated, in-progress, authenticated, expired, failed)
 *   • The authenticated identity and tokens
 *   • Session creation and expiry times
 *   • Activity tracking (last access)
 *   • Automatic session expiry based on idle timeout
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * OOP PRINCIPLES
 * ─────────────────────────────────────────────────────────────────────────────
 *  Abstraction      IAuthSession hides the session implementation.
 *  Encapsulation    State transitions are validated; no invalid states possible.
 *  Single-Resp.     Only manages one session's lifecycle.
 *  Open / Closed    New states are added to the enum; class logic extended.
 *  Dependency-Inv.  Receives tokens and identity; never fetches them.
 */

import type { IDisposable } from '../../app/dependency-container';
import type { AuthToken, AuthIdentity } from './auth-provider';
import { AuthProtocol, AuthSessionState, CredentialType } from './auth-provider';

// ─────────────────────────────────────────────────────────────────────────────
// VALUE OBJECTS
// ─────────────────────────────────────────────────────────────────────────────

/** Configuration for session behavior. */
interface AuthSessionConfig {
  /** Maximum session duration in ms (null = no limit). */
  readonly maxDurationMs: number | null;
  /** Idle timeout in ms (reset on activity; null = no limit). */
  readonly idleTimeoutMs: number | null;
  /** Whether to auto-refresh tokens before they expire. */
  readonly autoRefresh: boolean;
  /** How many seconds before expiry to trigger refresh. */
  readonly refreshAdvanceSeconds: number;
}

/** Immutable snapshot of the session state. */
interface AuthSessionSnapshot {
  /** Unique session ID. */
  readonly id: string;
  /** Current state. */
  readonly state: AuthSessionState;
  /** The authenticated identity. */
  readonly identity: AuthIdentity | null;
  /** All tokens in this session. */
  readonly tokens: readonly AuthToken[];
  /** When the session was created. */
  readonly createdAt: number;
  /** When the session was last accessed. */
  readonly lastAccessedAt: number;
  /** When the session expires (epoch ms), or null. */
  readonly expiresAt: number | null;
  /** The protocol used. */
  readonly protocol: AuthProtocol;
  /** Idle timeout in ms. */
  readonly idleTimeoutMs: number | null;
  /** Max duration in ms. */
  readonly maxDurationMs: number | null;
}

// ─────────────────────────────────────────────────────────────────────────────
// EVENTS
// ─────────────────────────────────────────────────────────────────────────────

type AuthSessionEventType =
  | 'stateChanged'
  | 'tokenRefreshed'
  | 'tokenExpired'
  | 'activity'
  | 'expired'
  | 'destroyed';

interface AuthSessionStateChangedEvent {
  readonly kind: 'stateChanged';
  readonly previousState: AuthSessionState;
  readonly newState: AuthSessionState;
}

interface AuthSessionTokenRefreshedEvent {
  readonly kind: 'tokenRefreshed';
  readonly oldToken: AuthToken;
  readonly newToken: AuthToken;
}

interface AuthSessionTokenExpiredEvent {
  readonly kind: 'tokenExpired';
  readonly token: AuthToken;
}

interface AuthSessionActivityEvent {
  readonly kind: 'activity';
  readonly timestamp: number;
}

interface AuthSessionExpiredEvent {
  readonly kind: 'expired';
  readonly reason: 'idle-timeout' | 'max-duration';
}

interface AuthSessionDestroyedEvent {
  readonly kind: 'destroyed';
}

type AuthSessionEvent =
  | AuthSessionStateChangedEvent
  | AuthSessionTokenRefreshedEvent
  | AuthSessionTokenExpiredEvent
  | AuthSessionActivityEvent
  | AuthSessionExpiredEvent
  | AuthSessionDestroyedEvent;

// ─────────────────────────────────────────────────────────────────────────────
// PUBLIC CONTRACT
// ─────────────────────────────────────────────────────────────────────────────

interface IAuthSession extends IDisposable {
  /** Unique session ID. */
  readonly id: string;
  /** Current state. */
  readonly state: AuthSessionState;
  /** The authenticated identity. */
  readonly identity: AuthIdentity | null;
  /** Current access token, or null. */
  readonly accessToken: AuthToken | null;
  /** When the session was created. */
  readonly createdAt: number;
  /** When the session was last accessed. */
  readonly lastAccessedAt: number;

  /** Take a snapshot of the current session state. */
  snapshot(): AuthSessionSnapshot;

  /** Transition to Authenticated with the given identity and tokens. */
  authenticate(identity: AuthIdentity, tokens: readonly AuthToken[]): void;

  /** Transition to Expired. */
  expire(): void;

  /** Transition to Failed. */
  fail(error?: string): void;

  /** Sign out and transition to SignedOut. */
  signOut(): void;

  /** Record activity (resets idle timer). */
  touch(): void;

  /** Check if the session has expired. Returns true if now past expiry. */
  isExpired(): boolean;

  /** Replace the access token (e.g. after refresh). */
  replaceToken(oldToken: AuthToken, newToken: AuthToken): void;

  /** Subscribe to session events. */
  on(type: AuthSessionEventType, handler: (event: AuthSessionEvent) => void): void;
  /** Unsubscribe from session events. */
  off(type: AuthSessionEventType, handler: (event: AuthSessionEvent) => void): void;
}

// ─────────────────────────────────────────────────────────────────────────────
// CONCRETE IMPLEMENTATION
// ─────────────────────────────────────────────────────────────────────────────

class AuthSession implements IAuthSession {
  readonly id: string;
  readonly createdAt: number;

  private _state: AuthSessionState = AuthSessionState.Unauthenticated;
  private _identity: AuthIdentity | null = null;
  private _tokens: AuthToken[] = [];
  private _lastAccessedAt: number;
  private readonly config: AuthSessionConfig;
  private readonly eventHandlers = new Map<AuthSessionEventType, Set<(event: AuthSessionEvent) => void>>();
  private idleTimer: ReturnType<typeof setTimeout> | null = null;
  private maxDurationTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(id: string, config: Partial<AuthSessionConfig> = {}) {
    this.id = id;
    this.createdAt = Date.now();
    this._lastAccessedAt = Date.now();
    this.config = {
      maxDurationMs: config.maxDurationMs ?? null,
      idleTimeoutMs: config.idleTimeoutMs ?? 30 * 60 * 1000, // 30 minutes
      autoRefresh: config.autoRefresh ?? true,
      refreshAdvanceSeconds: config.refreshAdvanceSeconds ?? 300,
    };

    if (this.config.idleTimeoutMs !== null) {
      this.resetIdleTimer();
    }
    if (this.config.maxDurationMs !== null) {
      this.resetMaxDurationTimer();
    }
  }

  get state(): AuthSessionState { return this._state; }
  get identity(): AuthIdentity | null { return this._identity; }
  get accessToken(): AuthToken | null {
    this.touch();
    return this._tokens.find(t => t.type === CredentialType.AccessToken) ?? null;
  }
  get lastAccessedAt(): number { return this._lastAccessedAt; }

  snapshot(): AuthSessionSnapshot {
    return {
      id: this.id,
      state: this._state,
      identity: this._identity,
      tokens: [...this._tokens],
      createdAt: this.createdAt,
      lastAccessedAt: this._lastAccessedAt,
      expiresAt: this.config.maxDurationMs !== null
        ? this.createdAt + this.config.maxDurationMs
        : null,
      protocol: this._identity?.provider ?? AuthProtocol.Custom,
      idleTimeoutMs: this.config.idleTimeoutMs,
      maxDurationMs: this.config.maxDurationMs,
    };
  }

  authenticate(identity: AuthIdentity, tokens: readonly AuthToken[]): void {
    const prev = this._state;
    this._state = AuthSessionState.Authenticated;
    this._identity = identity;
    this._tokens = [...tokens];
    this.touch();
    this.emit({ kind: 'stateChanged', previousState: prev, newState: this._state });
  }

  expire(): void {
    const prev = this._state;
    this._state = AuthSessionState.Expired;
    this.emit({ kind: 'stateChanged', previousState: prev, newState: this._state });
    this.clearTimers();
  }

  fail(_error?: string): void {
    const prev = this._state;
    this._state = AuthSessionState.Failed;
    this.emit({ kind: 'stateChanged', previousState: prev, newState: this._state });
    this.clearTimers();
  }

  signOut(): void {
    const prev = this._state;
    this._state = AuthSessionState.SignedOut;
    this._identity = null;
    this._tokens = [];
    this.emit({ kind: 'stateChanged', previousState: prev, newState: this._state });
    this.emit({ kind: 'destroyed' });
    this.clearTimers();
  }

  touch(): void {
    this._lastAccessedAt = Date.now();
    this.emit({ kind: 'activity', timestamp: this._lastAccessedAt });
    if (this.config.idleTimeoutMs !== null) {
      this.resetIdleTimer();
    }
  }

  isExpired(): boolean {
    if (this._state === AuthSessionState.Expired) return true;
    if (this._state === AuthSessionState.SignedOut) return true;

    // Check max duration.
    if (this.config.maxDurationMs !== null) {
      if (Date.now() > this.createdAt + this.config.maxDurationMs) {
        this.expire();
        this.emit({ kind: 'expired', reason: 'max-duration' });
        return true;
      }
    }

    // Check idle timeout.
    if (this.config.idleTimeoutMs !== null) {
      if (Date.now() > this._lastAccessedAt + this.config.idleTimeoutMs) {
        this.expire();
        this.emit({ kind: 'expired', reason: 'idle-timeout' });
        return true;
      }
    }

    return false;
  }

  replaceToken(oldToken: AuthToken, newToken: AuthToken): void {
    const idx = this._tokens.findIndex(t => t.value === oldToken.value);
    if (idx >= 0) {
      this._tokens[idx] = newToken;
      this.emit({ kind: 'tokenRefreshed', oldToken, newToken });
    }
  }

  on(type: AuthSessionEventType, handler: (event: AuthSessionEvent) => void): void {
    if (!this.eventHandlers.has(type)) this.eventHandlers.set(type, new Set());
    this.eventHandlers.get(type)!.add(handler);
  }

  off(type: AuthSessionEventType, handler: (event: AuthSessionEvent) => void): void {
    this.eventHandlers.get(type)?.delete(handler);
  }

  dispose(): void {
    this.clearTimers();
    this.eventHandlers.clear();
    this._tokens = [];
    this._identity = null;
  }

  // ── Private: timer management ───────────────────────────────────────────

  private resetIdleTimer(): void {
    if (this.idleTimer !== null) clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(() => {
      if (this._state === AuthSessionState.Authenticated) {
        this.expire();
        this.emit({ kind: 'expired', reason: 'idle-timeout' });
      }
    }, this.config.idleTimeoutMs!);
  }

  private resetMaxDurationTimer(): void {
    if (this.maxDurationTimer !== null) clearTimeout(this.maxDurationTimer);
    const remaining = Math.max(0, this.createdAt + this.config.maxDurationMs! - Date.now());
    this.maxDurationTimer = setTimeout(() => {
      if (this._state === AuthSessionState.Authenticated) {
        this.expire();
        this.emit({ kind: 'expired', reason: 'max-duration' });
      }
    }, remaining);
  }

  private clearTimers(): void {
    if (this.idleTimer !== null) {
      clearTimeout(this.idleTimer);
      this.idleTimer = null;
    }
    if (this.maxDurationTimer !== null) {
      clearTimeout(this.maxDurationTimer);
      this.maxDurationTimer = null;
    }
  }

  private emit(event: AuthSessionEvent): void {
    const handlers = this.eventHandlers.get(event.kind);
    if (!handlers) return;
    for (const h of handlers) {
      try { h(event); } catch (err) {
        console.error(`[AuthSession] Handler threw on "${event.kind}":`, err);
      }
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// EXPORTS
// ─────────────────────────────────────────────────────────────────────────────

export { AuthSession };
export type {
  IAuthSession,
  AuthSessionConfig,
  AuthSessionSnapshot,
  AuthSessionEvent,
  AuthSessionEventType,
};
