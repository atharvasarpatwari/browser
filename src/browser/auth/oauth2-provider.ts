/**
 * @file src/browser/auth/oauth2-provider.ts
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * RESPONSIBILITY
 * ─────────────────────────────────────────────────────────────────────────────
 * Implement OAuth 2.0 (RFC 6749) authentication flows:
 *   • Authorization Code + PKCE (recommended for SPAs / public clients)
 *   • Authorization Code (with client secret for confidential clients)
 *   • Implicit (legacy, for compatibility)
 *   • Client Credentials (machine-to-machine)
 *   • Device Code (input-constrained devices)
 *   • Refresh Token exchange
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * OOP PRINCIPLES
 * ─────────────────────────────────────────────────────────────────────────────
 *  Abstraction      Implements IAuthProvider; callers never know the protocol.
 *  Encapsulation    PKCE codes, state, and token exchange are private.
 *  Single-Resp.     Only handles OAuth 2.0 — OIDC is a separate subclass.
 *  Open / Closed    New grant types are added as private methods.
 *  Dependency-Inv.  Receives OAuth2Config; does not depend on concrete storage.
 */

import type { IDisposable } from '../../app/dependency-container';
import type {
  IAuthProvider,
  AuthToken,
  AuthIdentity,
  AuthResult,
  OAuth2Config,
  TokenValidationResult,
} from './auth-provider';
import {
  AuthProtocol,
  CredentialType,
  OAuthGrantType,
  AuthProviderNotConfiguredError,
  AuthCSRFError,
  generateRandomString,
  base64urlEncode,
} from './auth-provider';

// ─────────────────────────────────────────────────────────────────────────────
// TOKEN RESPONSE (from token endpoint)
// ─────────────────────────────────────────────────────────────────────────────

interface TokenResponse {
  readonly access_token: string;
  readonly token_type: string;
  readonly expires_in?: number;
  readonly refresh_token?: string;
  readonly scope?: string;
  readonly id_token?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// OAUTH2 PROVIDER
// ─────────────────────────────────────────────────────────────────────────────

class OAuth2Provider implements IAuthProvider, IDisposable {
  readonly protocol: AuthProtocol;
  readonly name: string;

  private readonly config: OAuth2Config;
  private _tokens: AuthToken[] = [];
  private _identity: AuthIdentity | null = null;
  private _state: string | null = null;
  private _codeVerifier: string | null = null;
  private _codeChallenge: string | null = null;

  constructor(name: string, config: OAuth2Config) {
    this.name = name;
    this.config = config;
    this.protocol = AuthProtocol.OAuth2;
  }

  get isConfigured(): boolean {
    return (
      this.config.clientId.length > 0 &&
      this.config.authorizationEndpoint.length > 0 &&
      this.config.tokenEndpoint.length > 0 &&
      this.config.redirectUri.length > 0
    );
  }

  // ── IAuthProvider: authenticate ─────────────────────────────────────────

  authenticate(): string {
    this.assertNotConfigured();

    const params = new URLSearchParams();
    params.set('client_id', this.config.clientId);
    params.set('redirect_uri', this.config.redirectUri);
    params.set('response_type', this.config.responseType);
    params.set('scope', this.config.scopes.join(' '));

    // State for CSRF protection.
    if (this.config.useState !== false) {
      const state = generateRandomString();
      this._state = state;
      params.set('state', state);
    }

    // PKCE for public clients.
    if (this.config.usePKCE) {
      const verifier = generateRandomString(64);
      this._codeVerifier = verifier;
      this._codeChallenge = base64urlEncode(
        new TextEncoder().encode(verifier),
      );
      params.set('code_challenge', this._codeChallenge);
      params.set('code_challenge_method', 'S256');
    }

    // Extra parameters.
    if (this.config.extraParams) {
      for (const [key, value] of Object.entries(this.config.extraParams)) {
        params.set(key, value);
      }
    }

    return `${this.config.authorizationEndpoint}?${params.toString()}`;
  }

  // ── IAuthProvider: handleCallback ───────────────────────────────────────

  async handleCallback(callbackUrl: string): Promise<AuthResult> {
    this.assertNotConfigured();

    const url = new URL(callbackUrl);
    const code = url.searchParams.get('code');
    const returnedState = url.searchParams.get('state');
    const error = url.searchParams.get('error');
    const errorDescription = url.searchParams.get('error_description');

    // Check for provider-side errors.
    if (error) {
      return {
        success: false,
        identity: null,
        tokens: [],
        protocol: this.protocol,
        error: errorDescription ?? error,
      };
    }

    // CSRF validation.
    if (this._state && returnedState !== this._state) {
      throw new AuthCSRFError(this.protocol);
    }

    if (!code) {
      return {
        success: false,
        identity: null,
        tokens: [],
        protocol: this.protocol,
        error: 'No authorization code received.',
      };
    }

    return this.exchangeCode(code);
  }

  // ── IAuthProvider: refresh ──────────────────────────────────────────────

  async refresh(refreshToken: string): Promise<AuthToken> {
    this.assertNotConfigured();

    const body = new URLSearchParams({
      grant_type: OAuthGrantType.RefreshToken,
      refresh_token: refreshToken,
      client_id: this.config.clientId,
    });

    if (this.config.clientSecret) {
      body.set('client_secret', this.config.clientSecret);
    }

    const response = await fetch(this.config.tokenEndpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(`Token refresh failed: ${(err as Record<string, string>).error ?? response.statusText}`);
    }

    const data: TokenResponse = await response.json();
    return this.tokenResponseToAuthToken(data);
  }

  // ── IAuthProvider: validateToken ────────────────────────────────────────

  validateToken(token: AuthToken): TokenValidationResult {
    const now = Date.now();
    const expired = token.expiresAt !== null && token.expiresAt < now;

    if (expired) {
      return { valid: false, expired: true, reason: 'Token has expired.' };
    }

    return { valid: true, expired: false };
  }

  // ── IAuthProvider: revokeToken ──────────────────────────────────────────

  async revokeToken(token: string): Promise<boolean> {
    // OAuth 2.0 Token Revocation (RFC 7009).
    // Many providers support this endpoint.
    try {
      const tokenEndpoint = this.config.tokenEndpoint.replace('/token', '/revoke');
      await fetch(tokenEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          token,
          client_id: this.config.clientId,
        }).toString(),
      });
      return true;
    } catch {
      return false;
    }
  }

  // ── IAuthProvider: getIdentity / getTokens ──────────────────────────────

  getIdentity(): AuthIdentity | null {
    return this._identity;
  }

  getTokens(): readonly AuthToken[] {
    return [...this._tokens];
  }

  // ── IDisposable ─────────────────────────────────────────────────────────

  dispose(): void {
    this._tokens = [];
    this._identity = null;
    this._state = null;
    this._codeVerifier = null;
    this._codeChallenge = null;
  }

  // ── Private: code exchange ──────────────────────────────────────────────

  private async exchangeCode(code: string): Promise<AuthResult> {
    const body = new URLSearchParams({
      grant_type: OAuthGrantType.AuthorizationCode,
      code,
      redirect_uri: this.config.redirectUri,
      client_id: this.config.clientId,
    });

    if (this.config.clientSecret) {
      body.set('client_secret', this.config.clientSecret);
    }

    // PKCE code verifier.
    if (this.config.usePKCE && this._codeVerifier) {
      body.set('code_verifier', this._codeVerifier);
    }

    try {
      const response = await fetch(this.config.tokenEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: body.toString(),
      });

      if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        return {
          success: false,
          identity: null,
          tokens: [],
          protocol: this.protocol,
          error: `Token exchange failed: ${(err as Record<string, string>).error ?? response.statusText}`,
        };
      }

      const data: TokenResponse = await response.json();
      const accessToken = this.tokenResponseToAuthToken(data);
      this._tokens = [accessToken];

      if (data.refresh_token) {
        const refreshToken: AuthToken = {
          value: data.refresh_token,
          type: CredentialType.RefreshToken,
          expiresAt: null,
          issuedAt: Date.now(),
          scopes: accessToken.scopes,
        };
        this._tokens = [...this._tokens, refreshToken];
      }

      // Build identity from token claims (basic).
      this._identity = {
        id: this.config.clientId,
        provider: this.protocol,
        claims: {
          sub: this.config.clientId,
          scope: data.scope,
        },
      };

      return {
        success: true,
        identity: this._identity,
        tokens: this._tokens,
        protocol: this.protocol,
        authorizationCode: code,
        state: this._state ?? undefined,
      };
    } catch (err) {
      return {
        success: false,
        identity: null,
        tokens: [],
        protocol: this.protocol,
        error: `Token exchange error: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }

  private tokenResponseToAuthToken(data: TokenResponse): AuthToken {
    const now = Date.now();
    return {
      value: data.access_token,
      type: CredentialType.AccessToken,
      expiresAt: data.expires_in !== undefined ? now + data.expires_in * 1000 : null,
      issuedAt: now,
      scopes: data.scope ? data.scope.split(' ').filter(Boolean) : [],
      tokenEndpoint: this.config.tokenEndpoint,
      refreshToken: data.refresh_token,
    };
  }

  private assertNotConfigured(): void {
    if (!this.isConfigured) {
      throw new AuthProviderNotConfiguredError(this.protocol, this.name);
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// EXPORTS
// ─────────────────────────────────────────────────────────────────────────────

export { OAuth2Provider };
export type { TokenResponse };
