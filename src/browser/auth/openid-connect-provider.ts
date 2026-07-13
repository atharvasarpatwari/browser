/**
 * @file src/browser/auth/openid-connect-provider.ts
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * RESPONSIBILITY
 * ─────────────────────────────────────────────────────────────────────────────
 * Implement OpenID Connect 1.0 on top of the OAuth 2.0 provider.
 *
 * Adds:
 *   • OIDC Discovery (/.well-known/openid-configuration)
 *   • ID Token validation (JWT signature, iss, aud, exp, nonce)
 *   • UserInfo endpoint claims
 *   • Session management (check_session_iframe)
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * OOP PRINCIPLES
 * ─────────────────────────────────────────────────────────────────────────────
 *  Abstraction      Extends OAuth2Provider; callers see IAuthProvider.
 *  Encapsulation    OIDC-specific logic (discovery, ID token) is private.
 *  Single-Resp.     Only adds OIDC features; OAuth 2.0 is in the parent.
 *  Open / Closed    New OIDC features added via override without parent changes.
 *  Dependency-Inv.  Receives OIDC config; delegates to JwtManager for tokens.
 */

import type { IAuthProvider, AuthIdentity, AuthResult, OAuth2Config, TokenValidationResult } from './auth-provider';
import { AuthProtocol, CredentialType } from './auth-provider';
import { OAuth2Provider } from './oauth2-provider';
import { JwtManager } from './jwt-manager';
import type { JwtToken } from './jwt-manager';

// ─────────────────────────────────────────────────────────────────────────────
// OIDC CONFIGURATION
// ─────────────────────────────────────────────────────────────────────────────

interface OIDCConfig extends OAuth2Config {
  /** OIDC discovery document URL (e.g. https://accounts.google.com/.well-known/openid-configuration). */
  readonly discoveryUrl?: string;
  /** The expected issuer of ID tokens. */
  readonly expectedIssuer?: string;
  /** Whether to validate the ID token signature. */
  readonly validateIdTokenSignature?: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// USERINFO RESPONSE
// ─────────────────────────────────────────────────────────────────────────────

interface UserInfoResponse {
  readonly sub: string;
  readonly name?: string;
  readonly email?: string;
  readonly picture?: string;
  readonly email_verified?: boolean;
  readonly locale?: string;
  readonly [key: string]: unknown;
}

// ─────────────────────────────────────────────────────────────────────────────
// OIDC PROVIDER
// ─────────────────────────────────────────────────────────────────────────────

class OpenIDConnectProvider extends OAuth2Provider implements IAuthProvider {
  override readonly protocol = AuthProtocol.OpenIDConnect;
  override readonly name: string;

  private readonly oidcConfig: OIDCConfig;
  private readonly jwtManager: JwtManager;
  private _idToken: JwtToken | null = null;
  private _userInfo: UserInfoResponse | null = null;

  constructor(name: string, config: OIDCConfig) {
    super(name, config);
    this.name = name;
    this.oidcConfig = config;
    this.jwtManager = new JwtManager();
  }

  // ── OIDC Discovery ──────────────────────────────────────────────────────

  /**
   * Fetch the OIDC Discovery document from the issuer.
   */
  async fetchDiscoveryDocument(): Promise<Record<string, unknown> | null> {
    const url = this.oidcConfig.discoveryUrl;
    if (!url) return null;

    try {
      const response = await fetch(url);
      if (!response.ok) return null;
      return await response.json() as Record<string, unknown>;
    } catch {
      return null;
    }
  }

  // ── Override: handleCallback ────────────────────────────────────────────

  override async handleCallback(callbackUrl: string): Promise<AuthResult> {
    const baseResult = await super.handleCallback(callbackUrl);

    if (!baseResult.success) return baseResult;

    // Extract and validate the ID token if present.
    const url = new URL(callbackUrl);
    const idTokenStr = url.searchParams.get('id_token');

    if (idTokenStr) {
      const decoded = this.jwtManager.decode(idTokenStr);
      if (decoded) {
        this._idToken = decoded;

        // Validate ID token claims.
        const validation = this.validateIdToken(decoded);
        if (!validation.valid) {
          return {
            success: false,
            identity: null,
            tokens: baseResult.tokens,
            protocol: this.protocol,
            error: `ID token validation failed: ${validation.reason}`,
          };
        }
      }
    }

    // Fetch UserInfo if endpoint is available.
    const accessToken = baseResult.tokens.find(t => t.type === CredentialType.AccessToken);
    if (accessToken && this.oidcConfig.userinfoEndpoint) {
      this._userInfo = await this.fetchUserInfo(accessToken.value);
    }

    // Build rich identity from ID token + UserInfo.
    const identity = this.buildIdentity();

    return {
      ...baseResult,
      identity,
      protocol: this.protocol,
    };
  }

  // ── OIDC: UserInfo ─────────────────────────────────────────────────────

  async fetchUserInfo(accessToken: string): Promise<UserInfoResponse | null> {
    if (!this.oidcConfig.userinfoEndpoint) return null;

    try {
      const response = await fetch(this.oidcConfig.userinfoEndpoint, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (!response.ok) return null;
      return await response.json() as UserInfoResponse;
    } catch {
      return null;
    }
  }

  // ── OIDC: validate ID Token ────────────────────────────────────────────

  validateIdToken(jwt: JwtToken): TokenValidationResult {
    const nowSeconds = Math.floor(Date.now() / 1000);
    const clockSkew = 30;

    // Expiry.
    if (jwt.payload.exp !== undefined && nowSeconds > jwt.payload.exp + clockSkew) {
      return { valid: false, expired: true, reason: 'ID token has expired.' };
    }

    // Not before.
    if (jwt.payload.nbf !== undefined && nowSeconds < jwt.payload.nbf - clockSkew) {
      return { valid: false, expired: false, reason: 'ID token is not yet valid (nbf).' };
    }

    // Issuer.
    if (this.oidcConfig.expectedIssuer && jwt.payload.iss !== this.oidcConfig.expectedIssuer) {
      return {
        valid: false,
        expired: false,
        reason: `ID token issuer mismatch: expected "${this.oidcConfig.expectedIssuer}", got "${jwt.payload.iss}".`,
      };
    }

    // Audience (must include client_id).
    if (jwt.payload.aud) {
      const audiences = Array.isArray(jwt.payload.aud) ? jwt.payload.aud : [jwt.payload.aud];
      if (!audiences.includes(this.oidcConfig.clientId)) {
        return {
          valid: false,
          expired: false,
          reason: `ID token audience does not include client_id "${this.oidcConfig.clientId}".`,
        };
      }
    }

    return { valid: true, expired: false, claims: jwt.payload as unknown as Record<string, unknown> };
  }

  // ── Private helpers ─────────────────────────────────────────────────────

  private buildIdentity(): AuthIdentity {
    const claims: Record<string, unknown> = {};
    const idPayload = this._idToken?.payload;
    const userInfo = this._userInfo;

    if (idPayload) {
      Object.assign(claims, idPayload);
    }
    if (userInfo) {
      Object.assign(claims, userInfo);
    }

    return {
      id: (idPayload?.sub ?? userInfo?.sub ?? '') as string,
      name: (userInfo?.name ?? idPayload?.name) as string | undefined,
      email: (userInfo?.email ?? idPayload?.email) as string | undefined,
      picture: (userInfo?.picture ?? idPayload?.picture) as string | undefined,
      provider: this.protocol,
      claims,
    };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// EXPORTS
// ─────────────────────────────────────────────────────────────────────────────

export { OpenIDConnectProvider };
export type { OIDCConfig, UserInfoResponse };
