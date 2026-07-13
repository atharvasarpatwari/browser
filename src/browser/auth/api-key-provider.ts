/**
 * @file src/browser/auth/api-key-provider.ts
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * RESPONSIBILITY
 * ─────────────────────────────────────────────────────────────────────────────
 * Implement API Key and HTTP Basic authentication for services that do not
 * use OAuth 2.0 or other redirect-based flows.
 *
 * Supports:
 *   • API Key (header-based: "X-API-Key", "Authorization: ApiKey ...")
 *   • Bearer Token (OAuth-style: "Authorization: Bearer ...")
 *   • HTTP Basic Authentication (RFC 7617: "Authorization: Basic ...")
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * OOP PRINCIPLES
 * ─────────────────────────────────────────────────────────────────────────────
 *  Abstraction      Implements IAuthProvider; callers see a uniform interface.
 *  Encapsulation    Key encoding and header construction are private.
 *  Single-Resp.     Only handles API Key / Bearer / Basic auth.
 *  Open / Closed    New header schemes added without changing the class.
 *  Dependency-Inv.  Receives ApiKeyConfig / BasicAuthConfig.
 */

import type { IDisposable } from '../../app/dependency-container';
import type {
  IAuthProvider,
  AuthToken,
  AuthIdentity,
  AuthResult,
  ApiKeyConfig,
  BasicAuthConfig,
  TokenValidationResult,
} from './auth-provider';
import {
  AuthProtocol,
  CredentialType,
} from './auth-provider';

// ─────────────────────────────────────────────────────────────────────────────
// API KEY PROVIDER
// ─────────────────────────────────────────────────────────────────────────────

class ApiKeyProvider implements IAuthProvider, IDisposable {
  readonly protocol = AuthProtocol.ApiKey;
  readonly name: string;

  private readonly config: ApiKeyConfig;
  private _tokens: AuthToken[] = [];
  private _identity: AuthIdentity | null = null;

  constructor(name: string, config: ApiKeyConfig) {
    this.name = name;
    this.config = config;
  }

  get isConfigured(): boolean {
    return this.config.apiKey.length > 0;
  }

  // ── IAuthProvider: authenticate ─────────────────────────────────────────

  async authenticate(): Promise<AuthResult> {
    this.assertNotConfigured();

    const token: AuthToken = {
      value: this.config.apiKey,
      type: CredentialType.ApiKey,
      expiresAt: null,
      issuedAt: Date.now(),
      scopes: [],
    };

    this._tokens = [token];

    this._identity = {
      id: 'api-key-user',
      provider: this.protocol,
      claims: {
        headerName: this.config.headerName ?? 'Authorization',
        prefix: this.config.prefix ?? 'ApiKey',
      },
    };

    return {
      success: true,
      identity: this._identity,
      tokens: this._tokens,
      protocol: this.protocol,
    };
  }

  // ── IAuthProvider: handleCallback ───────────────────────────────────────

  async handleCallback(_callbackUrl: string): Promise<AuthResult> {
    return {
      success: false,
      identity: null,
      tokens: [],
      protocol: this.protocol,
      error: 'API Key authentication does not use callbacks.',
    };
  }

  // ── IAuthProvider: refresh ──────────────────────────────────────────────

  async refresh(_refreshToken: string): Promise<AuthToken> {
    // API keys don't expire; return a new token with the same key.
    const token: AuthToken = {
      value: this.config.apiKey,
      type: CredentialType.ApiKey,
      expiresAt: null,
      issuedAt: Date.now(),
      scopes: [],
    };
    return token;
  }

  // ── IAuthProvider: validateToken ────────────────────────────────────────

  validateToken(_token: AuthToken): TokenValidationResult {
    // API keys are opaque and don't have expiry.
    return { valid: true, expired: false };
  }

  // ── IAuthProvider: revokeToken ──────────────────────────────────────────

  async revokeToken(_token: string): Promise<boolean> {
    // Can't revoke an API key server-side; that requires the provider dashboard.
    return false;
  }

  // ── IAuthProvider: getIdentity / getTokens ──────────────────────────────

  getIdentity(): AuthIdentity | null {
    return this._identity;
  }

  getTokens(): readonly AuthToken[] {
    return [...this._tokens];
  }

  // ── Helper: build auth header ───────────────────────────────────────────

  /**
   * Build the HTTP authorization header for this API key.
   * Returns a Record suitable for use in fetch() headers.
   */
  buildAuthHeader(): Record<string, string> {
    const headerName = this.config.headerName ?? 'Authorization';
    const prefix = this.config.prefix ?? 'ApiKey';
    return { [headerName]: `${prefix} ${this.config.apiKey}` };
  }

  // ── IDisposable ─────────────────────────────────────────────────────────

  dispose(): void {
    this._tokens = [];
    this._identity = null;
  }

  private assertNotConfigured(): void {
    if (!this.isConfigured) {
      throw new Error(`API Key provider "${this.name}" is not configured.`);
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// BASIC AUTH PROVIDER
// ─────────────────────────────────────────────────────────────────────────────

class BasicAuthProvider implements IAuthProvider, IDisposable {
  readonly protocol = AuthProtocol.BasicAuth;
  readonly name: string;

  private readonly config: BasicAuthConfig;
  private _tokens: AuthToken[] = [];
  private _identity: AuthIdentity | null = null;

  constructor(name: string, config: BasicAuthConfig) {
    this.name = name;
    this.config = config;
  }

  get isConfigured(): boolean {
    return this.config.username.length > 0;
  }

  // ── IAuthProvider: authenticate ─────────────────────────────────────────

  async authenticate(): Promise<AuthResult> {
    this.assertNotConfigured();

    const encoded = btoa(`${this.config.username}:${this.config.password}`);

    const token: AuthToken = {
      value: encoded,
      type: CredentialType.BasicCreds,
      expiresAt: null,
      issuedAt: Date.now(),
      scopes: [],
    };

    this._tokens = [token];

    this._identity = {
      id: this.config.username,
      provider: this.protocol,
      claims: { username: this.config.username },
    };

    return {
      success: true,
      identity: this._identity,
      tokens: this._tokens,
      protocol: this.protocol,
    };
  }

  // ── IAuthProvider: handleCallback ───────────────────────────────────────

  async handleCallback(_callbackUrl: string): Promise<AuthResult> {
    return {
      success: false,
      identity: null,
      tokens: [],
      protocol: this.protocol,
      error: 'Basic authentication does not use callbacks.',
    };
  }

  // ── IAuthProvider: refresh ──────────────────────────────────────────────

  async refresh(_refreshToken: string): Promise<AuthToken> {
    const encoded = btoa(`${this.config.username}:${this.config.password}`);
    return {
      value: encoded,
      type: CredentialType.BasicCreds,
      expiresAt: null,
      issuedAt: Date.now(),
      scopes: [],
    };
  }

  // ── IAuthProvider: validateToken ────────────────────────────────────────

  validateToken(_token: AuthToken): TokenValidationResult {
    // Basic auth credentials don't expire client-side.
    return { valid: true, expired: false };
  }

  // ── IAuthProvider: revokeToken ──────────────────────────────────────────

  async revokeToken(_token: string): Promise<boolean> {
    return false;
  }

  // ── IAuthProvider: getIdentity / getTokens ──────────────────────────────

  getIdentity(): AuthIdentity | null {
    return this._identity;
  }

  getTokens(): readonly AuthToken[] {
    return [...this._tokens];
  }

  // ── Helper: build auth header ───────────────────────────────────────────

  /**
   * Build the HTTP Authorization header for Basic auth.
   */
  buildAuthHeader(): Record<string, string> {
    const encoded = btoa(`${this.config.username}:${this.config.password}`);
    return { Authorization: `Basic ${encoded}` };
  }

  // ── IDisposable ─────────────────────────────────────────────────────────

  dispose(): void {
    this._tokens = [];
    this._identity = null;
  }

  private assertNotConfigured(): void {
    if (!this.isConfigured) {
      throw new Error(`Basic Auth provider "${this.name}" is not configured.`);
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// EXPORTS
// ─────────────────────────────────────────────────────────────────────────────

export { ApiKeyProvider, BasicAuthProvider };
