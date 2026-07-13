/**
 * @file src/browser/auth/auth-manager.ts
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * RESPONSIBILITY
 * ─────────────────────────────────────────────────────────────────────────────
 * Central orchestrator for the entire authentication subsystem.
 *
 * The AuthManager:
 *   1. Registers multiple IAuthProvider instances (OAuth2, OIDC, SAML, etc.)
 *   2. Routes authentication requests to the appropriate provider
 *   3. Manages the current IAuthSession lifecycle
 *   4. Coordinates token storage via ITokenStore
 *   5. Provides a unified API for the rest of the browser
 *
 *   BrowserWindow / UI
 *        │  authManager.signIn("google")
 *        ▼
 *   AuthManager
 *        │  finds provider → calls provider.authenticate()
 *        │  → stores tokens → creates AuthSession
 *        ▼
 *   AuthSession (tracks state, auto-refresh, expiry)
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * OOP PRINCIPLES
 * ─────────────────────────────────────────────────────────────────────────────
 *  Abstraction      IAuthManager hides all wiring from consumers.
 *  Encapsulation    Provider registry and session are private.
 *  Single-Resp.     Only orchestrates auth — no fetching, no rendering.
 *  Open / Closed    New providers are registered via registerProvider().
 *  Dependency-Inv.  Receives IAuthProvider[] and ITokenStore via constructor.
 *  Interface-Seg.   IAuthManager exposes lean methods; internals stay private.
 */

import type { IDisposable } from '../../app/dependency-container';
import type {
  IAuthProvider,
  AuthToken,
  AuthIdentity,
  AuthResult,
  TokenValidationResult,
} from './auth-provider';
import { AuthProtocol, AuthSessionState, CredentialType } from './auth-provider';
import type { ITokenStore } from './token-store';
import type { IAuthSession, AuthSessionSnapshot } from './auth-session';
import { AuthSession } from './auth-session';

// ─────────────────────────────────────────────────────────────────────────────
// EVENTS
// ─────────────────────────────────────────────────────────────────────────────

type AuthManagerEventType =
  | 'signIn'
  | 'signOut'
  | 'tokenRefreshed'
  | 'sessionStateChanged'
  | 'providerRegistered'
  | 'providerRemoved';

interface AuthManagerSignInEvent {
  readonly kind: 'signIn';
  readonly identity: AuthIdentity;
  readonly protocol: AuthProtocol;
}

interface AuthManagerSignOutEvent {
  readonly kind: 'signOut';
  readonly providerName: string;
}

interface AuthManagerTokenRefreshedEvent {
  readonly kind: 'tokenRefreshed';
  readonly providerName: string;
  readonly oldToken: string;
  readonly newToken: string;
}

interface AuthManagerSessionStateChangedEvent {
  readonly kind: 'sessionStateChanged';
  readonly state: AuthSessionState;
}

interface AuthManagerProviderRegisteredEvent {
  readonly kind: 'providerRegistered';
  readonly name: string;
  readonly protocol: AuthProtocol;
}

interface AuthManagerProviderRemovedEvent {
  readonly kind: 'providerRemoved';
  readonly name: string;
}

type AuthManagerEvent =
  | AuthManagerSignInEvent
  | AuthManagerSignOutEvent
  | AuthManagerTokenRefreshedEvent
  | AuthManagerSessionStateChangedEvent
  | AuthManagerProviderRegisteredEvent
  | AuthManagerProviderRemovedEvent;

// ─────────────────────────────────────────────────────────────────────────────
// PUBLIC CONTRACT
// ─────────────────────────────────────────────────────────────────────────────

interface IAuthManager extends IDisposable {
  /** The current session, or null if not authenticated. */
  readonly currentSession: IAuthSession | null;
  /** The currently authenticated identity, or null. */
  readonly currentIdentity: AuthIdentity | null;
  /** Whether the user is currently authenticated. */
  readonly isAuthenticated: boolean;

  /** Register a new auth provider. */
  registerProvider(name: string, provider: IAuthProvider): void;
  /** Remove a provider by name. */
  removeProvider(name: string): boolean;
  /** Get a registered provider by name. */
  getProvider(name: string): IAuthProvider | null;
  /** Get all registered provider names. */
  getProviderNames(): readonly string[];

  /** Initiate sign-in via a named provider. Returns redirect URL or result. */
  signIn(providerName: string): Promise<AuthResult> | string;
  /** Complete a redirect-based sign-in (OAuth callback). */
  handleCallback(providerName: string, callbackUrl: string): Promise<AuthResult>;
  /** Sign out of the current session. */
  signOut(): void;

  /** Get the current access token, refreshing if needed. */
  getAccessToken(providerName: string): Promise<AuthToken | null>;
  /** Refresh a specific provider's tokens. */
  refreshTokens(providerName: string): Promise<AuthToken | null>;
  /** Validate a token. */
  validateToken(providerName: string, token: AuthToken): TokenValidationResult;

  /** Get a session snapshot. */
  getSessionSnapshot(): AuthSessionSnapshot | null;

  /** Subscribe to auth events. */
  on(type: AuthManagerEventType, handler: (event: AuthManagerEvent) => void): void;
  /** Unsubscribe from auth events. */
  off(type: AuthManagerEventType, handler: (event: AuthManagerEvent) => void): void;
}

// ─────────────────────────────────────────────────────────────────────────────
// CONCRETE IMPLEMENTATION
// ─────────────────────────────────────────────────────────────────────────────

class AuthManager implements IAuthManager {
  private readonly providers = new Map<string, IAuthProvider>();
  private readonly tokenStore: ITokenStore;
  private _session: AuthSession | null = null;
  private sessionSeq = 0;
  private readonly eventHandlers = new Map<AuthManagerEventType, Set<(event: AuthManagerEvent) => void>>();

  constructor(tokenStore: ITokenStore) {
    this.tokenStore = tokenStore;
  }

  // ── Getters ─────────────────────────────────────────────────────────────

  get currentSession(): IAuthSession | null {
    return this._session;
  }

  get currentIdentity(): AuthIdentity | null {
    return this._session?.identity ?? null;
  }

  get isAuthenticated(): boolean {
    return this._session?.state === AuthSessionState.Authenticated;
  }

  // ── Provider management ─────────────────────────────────────────────────

  registerProvider(name: string, provider: IAuthProvider): void {
    this.providers.set(name, provider);
    this.emit({ kind: 'providerRegistered', name, protocol: provider.protocol });
  }

  removeProvider(name: string): boolean {
    const existed = this.providers.delete(name);
    if (existed) {
      this.emit({ kind: 'providerRemoved', name });
    }
    return existed;
  }

  getProvider(name: string): IAuthProvider | null {
    return this.providers.get(name) ?? null;
  }

  getProviderNames(): readonly string[] {
    return [...this.providers.keys()];
  }

  // ── Sign-in ─────────────────────────────────────────────────────────────

  async signIn(providerName: string): Promise<AuthResult> {
    const provider = this.providers.get(providerName);
    if (!provider) {
      throw new Error(`Auth provider "${providerName}" is not registered.`);
    }

    const result = provider.authenticate();

    // If authenticate() returns a string, it's a redirect URL.
    if (typeof result === 'string') {
      // Return a special result indicating redirect is needed.
      return {
        success: false,
        identity: null,
        tokens: [],
        protocol: provider.protocol,
        error: `REDIRECT:${result}`,
      };
    }

    // Otherwise, it's a Promise<AuthResult>.
    const authResult = await result;

    if (authResult.success && authResult.identity) {
      await this.handleSuccessfulAuth(providerName, provider, authResult);
    }

    return authResult;
  }

  async handleCallback(providerName: string, callbackUrl: string): Promise<AuthResult> {
    const provider = this.providers.get(providerName);
    if (!provider) {
      throw new Error(`Auth provider "${providerName}" is not registered.`);
    }

    const result = await provider.handleCallback(callbackUrl);

    if (result.success && result.identity) {
      await this.handleSuccessfulAuth(providerName, provider, result);
    }

    return result;
  }

  signOut(): void {
    if (this._session) {
      const providerName = this._session.identity?.provider ?? 'unknown';
      this._session.signOut();
      this._session.dispose();
      this._session = null;
      this.emit({ kind: 'signOut', providerName: String(providerName) });
    }
  }

  // ── Token management ────────────────────────────────────────────────────

  async getAccessToken(providerName: string): Promise<AuthToken | null> {
    const provider = this.providers.get(providerName);
    if (!provider) return null;

    // Check for valid token in session.
    const sessionTokens = this._session?.snapshot().tokens ?? [];
    const existingToken = sessionTokens.find(
      t => (t.type === CredentialType.AccessToken || t.type === CredentialType.ApiKey || t.type === CredentialType.BasicCreds)
        && (t.expiresAt === null || t.expiresAt > Date.now()),
    );
    if (existingToken) return existingToken;

    // Try to find a refresh token and refresh.
    const refreshToken = sessionTokens.find(t => t.type === CredentialType.RefreshToken);
    if (refreshToken) {
      return this.refreshTokens(providerName);
    }

    // Check the token store using the current identity's ID.
    const userId = this._session?.identity?.id ?? providerName;
    const stored = this.tokenStore.findValid(provider.protocol, userId);
    if (stored) return stored.token;

    return null;
  }

  async refreshTokens(providerName: string): Promise<AuthToken | null> {
    const provider = this.providers.get(providerName);
    if (!provider) return null;

    const sessionTokens = this._session?.snapshot().tokens ?? [];
    const refreshToken = sessionTokens.find(t => t.type === CredentialType.RefreshToken);
    if (!refreshToken) return null;

    try {
      const newToken = await provider.refresh(refreshToken.value);

      // Update session.
      if (this._session) {
        this._session.replaceToken(refreshToken, newToken);
      }

      // Update token store.
      this.tokenStore.add({
        provider: provider.protocol,
        userId: providerName,
        token: newToken,
        tags: ['refreshed'],
      });

      this.emit({
        kind: 'tokenRefreshed',
        providerName,
        oldToken: refreshToken.value.slice(0, 16),
        newToken: newToken.value.slice(0, 16),
      });

      return newToken;
    } catch {
      // Refresh failed; session may need re-authentication.
      this._session?.fail('Token refresh failed');
      this.emit({ kind: 'sessionStateChanged', state: AuthSessionState.Failed });
      return null;
    }
  }

  validateToken(providerName: string, token: AuthToken): TokenValidationResult {
    const provider = this.providers.get(providerName);
    if (!provider) {
      return { valid: false, expired: false, reason: `Provider "${providerName}" not found.` };
    }
    return provider.validateToken(token);
  }

  // ── Session ─────────────────────────────────────────────────────────────

  getSessionSnapshot(): AuthSessionSnapshot | null {
    return this._session?.snapshot() ?? null;
  }

  // ── Events ──────────────────────────────────────────────────────────────

  on(type: AuthManagerEventType, handler: (event: AuthManagerEvent) => void): void {
    if (!this.eventHandlers.has(type)) this.eventHandlers.set(type, new Set());
    this.eventHandlers.get(type)!.add(handler);
  }

  off(type: AuthManagerEventType, handler: (event: AuthManagerEvent) => void): void {
    this.eventHandlers.get(type)?.delete(handler);
  }

  // ── IDisposable ─────────────────────────────────────────────────────────

  dispose(): void {
    this._session?.dispose();
    this._session = null;
    for (const provider of this.providers.values()) {
      provider.dispose();
    }
    this.providers.clear();
    this.eventHandlers.clear();
  }

  // ── Private helpers ─────────────────────────────────────────────────────

  private async handleSuccessfulAuth(
    providerName: string,
    provider: IAuthProvider,
    result: AuthResult,
  ): Promise<void> {
    if (!result.identity) return;

    // Create a new session.
    const sessionId = `auth-${(++this.sessionSeq).toString(36)}`;
    this._session = new AuthSession(sessionId);
    this._session.authenticate(result.identity, result.tokens);

    // Store tokens.
    for (const token of result.tokens) {
      this.tokenStore.add({
        provider: provider.protocol,
        userId: result.identity.id,
        token,
        tags: ['initial'],
      });
    }

    // Listen for session events.
    this._session.on('stateChanged', (event) => {
      if (event.kind === 'stateChanged') {
        this.emit({ kind: 'sessionStateChanged', state: event.newState });
      }
    });

    this.emit({
      kind: 'signIn',
      identity: result.identity,
      protocol: provider.protocol,
    });
  }

  private emit(event: AuthManagerEvent): void {
    const handlers = this.eventHandlers.get(event.kind);
    if (!handlers) return;
    for (const h of handlers) {
      try { h(event); } catch (err) {
        console.error(`[AuthManager] Handler threw on "${event.kind}":`, err);
      }
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// EXPORTS
// ─────────────────────────────────────────────────────────────────────────────

export { AuthManager };
export type {
  IAuthManager,
  AuthManagerEvent,
  AuthManagerEventType,
};
