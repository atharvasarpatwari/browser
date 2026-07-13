/**
 * @file src/browser/auth/auth-provider.ts
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * RESPONSIBILITY
 * ─────────────────────────────────────────────────────────────────────────────
 * Define the shared contracts, enums, value objects, and error hierarchy for
 * the entire authentication subsystem.
 *
 * Every concrete provider (OAuth2, OIDC, SAML, WebAuthn, API Key) implements
 * the IAuthProvider interface defined here.  The AuthManager orchestrator
 * depends only on these abstractions — never on concrete classes.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * OOP PRINCIPLES
 * ─────────────────────────────────────────────────────────────────────────────
 *  Abstraction      IAuthProvider is the single type all consumers depend on.
 *  Encapsulation    Value objects are immutable; mutation goes through methods.
 *  Single-Resp.     Only defines contracts — no logic, no I/O.
 *  Open / Closed    New providers implement IAuthProvider without modifying
 *                   this file.
 *  Dependency-Inv.  AuthManager and consumers type against IAuthProvider.
 *  Interface-Seg.   Each provider exposes only the methods relevant to its
 *                   protocol; callers pick what they need.
 */

import type { IDisposable } from '../../app/dependency-container';

// ─────────────────────────────────────────────────────────────────────────────
// ENUMS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The authentication protocol family.
 */
enum AuthProtocol {
  /** OAuth 2.0 (RFC 6749) */
  OAuth2          = 'oauth2',
  /** OpenID Connect 1.0 */
  OpenIDConnect   = 'openid-connect',
  /** SAML 2.0 */
  SAML2           = 'saml2',
  /** FIDO2 / WebAuthn (L3) */
  WebAuthn        = 'webauthn',
  /** API Key / Bearer token */
  ApiKey          = 'api-key',
  /** HTTP Basic Authentication (RFC 7617) */
  BasicAuth       = 'basic-auth',
  /** Custom / pluggable */
  Custom          = 'custom',
}

/**
 * Current state of an authentication session.
 */
enum AuthSessionState {
  /** No authentication has been attempted. */
  Unauthenticated = 'unauthenticated',
  /** Authentication flow is in progress (e.g. redirect pending). */
  InProgress      = 'in-progress',
  /** User is authenticated and the session is active. */
  Authenticated   = 'authenticated',
  /** Access token has expired; refresh may be possible. */
  Expired         = 'expired',
  /** Refresh failed or token was revoked; re-authentication required. */
  Failed          = 'failed',
  /** User explicitly signed out. */
  SignedOut       = 'signed-out',
}

/**
 * The type of a stored credential / token.
 */
enum CredentialType {
  /** OAuth2 access token. */
  AccessToken     = 'access-token',
  /** OAuth2 refresh token. */
  RefreshToken    = 'refresh-token',
  /** OpenID Connect ID token (JWT). */
  IdToken         = 'id-token',
  /** SAML assertion. */
  SamlAssertion   = 'saml-assertion',
  /** WebAuthn credential (public key). */
  WebAuthnCred    = 'webauthn-credential',
  /** API key. */
  ApiKey          = 'api-key',
  /** HTTP Basic credentials. */
  BasicCreds      = 'basic-credentials',
  /** Opaque session token. */
  SessionToken    = 'session-token',
}

/**
 * Grant types supported by OAuth 2.0.
 */
enum OAuthGrantType {
  AuthorizationCode  = 'authorization_code',
  Implicit           = 'implicit',
  ClientCredentials  = 'client_credentials',
  RefreshToken       = 'refresh_token',
  DeviceCode         = 'urn:ietf:params:oauth:grant-type:device-code',
}

/**
 * OAuth 2.0 response types.
 */
enum OAuthResponseType {
  Code   = 'code',
  Token  = 'token',
  IdToken = 'id_token',
}

// ─────────────────────────────────────────────────────────────────────────────
// VALUE OBJECTS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * A token (access, refresh, ID, or opaque) returned by an auth provider.
 */
interface AuthToken {
  /** The token string itself. */
  readonly value: string;
  /** The type of credential this token represents. */
  readonly type: CredentialType;
  /** When the token expires (epoch ms), or null if non-expiring. */
  readonly expiresAt: number | null;
  /** When the token was issued (epoch ms). */
  readonly issuedAt: number;
  /** Scopes granted to this token. */
  readonly scopes: readonly string[];
  /** The token endpoint that issued this token. */
  readonly tokenEndpoint?: string;
  /** The refresh token associated with this token, if any. */
  readonly refreshToken?: string;
}

/**
 * An authenticated user's identity as returned by the provider.
 */
interface AuthIdentity {
  /** Unique identifier (sub claim, user ID, email, etc.). */
  readonly id: string;
  /** Display name. */
  readonly name?: string;
  /** Email address. */
  readonly email?: string;
  /** Profile image URL. */
  readonly picture?: string;
  /** The provider that authenticated this user. */
  readonly provider: AuthProtocol;
  /** Raw claims / profile data from the provider. */
  readonly claims: Readonly<Record<string, unknown>>;
}

/**
 * Result of a successful authentication attempt.
 */
interface AuthResult {
  /** Whether authentication succeeded. */
  readonly success: boolean;
  /** The authenticated identity, or null on failure. */
  readonly identity: AuthIdentity | null;
  /** Tokens received from the provider. */
  readonly tokens: readonly AuthToken[];
  /** The protocol used. */
  readonly protocol: AuthProtocol;
  /** Error message on failure. */
  readonly error?: string;
  /** Authorization code (for code exchange flows). */
  readonly authorizationCode?: string;
  /** State parameter for CSRF protection. */
  readonly state?: string;
}

/**
 * Configuration for an OAuth 2.0 / OIDC provider.
 */
interface OAuth2Config {
  /** Client ID registered with the provider. */
  readonly clientId: string;
  /** Client secret (optional for public clients / PKCE). */
  readonly clientSecret?: string;
  /** Authorization endpoint URL. */
  readonly authorizationEndpoint: string;
  /** Token endpoint URL. */
  readonly tokenEndpoint: string;
  /** Redirect URI registered with the provider. */
  readonly redirectUri: string;
  /** Requested scopes. */
  readonly scopes: readonly string[];
  /** Response type (code, token, id_token). */
  readonly responseType: OAuthResponseType;
  /** Grant type for token exchange. */
  readonly grantType: OAuthGrantType;
  /** Provider-specific issuer URL (for OIDC discovery). */
  readonly issuer?: string;
  /** Userinfo endpoint (OIDC). */
  readonly userinfoEndpoint?: string;
  /** JWKS URI for key discovery (OIDC). */
  readonly jwksUri?: string;
  /** Whether to use PKCE (recommended for public clients). */
  readonly usePKCE?: boolean;
  /** Whether to use state parameter for CSRF protection. */
  readonly useState?: boolean;
  /** Custom parameters to include in the authorization request. */
  readonly extraParams?: Readonly<Record<string, string>>;
}

/**
 * Configuration for a SAML 2.0 provider.
 */
interface SAMLConfig {
  /** Entity ID of the Identity Provider. */
  readonly idpEntityId: string;
  /** SSO URL where AuthnRequests are sent. */
  readonly idpSsoUrl: string;
  /** URL to fetch the IdP's signing certificate. */
  readonly idpCertificateUrl?: string;
  /** Entity ID of the Service Provider (this browser). */
  readonly spEntityId: string;
  /** ACS URL (Assertion Consumer Service) where responses are posted. */
  readonly acsUrl: string;
  /** Signed request required. */
  readonly wantAssertionsSigned: boolean;
  /** Signature algorithm. */
  readonly signatureAlgorithm: 'SHA-256' | 'SHA-384' | 'SHA-512';
  /** NameID format. */
  readonly nameIdFormat: string;
}

/**
 * Configuration for WebAuthn.
 */
interface WebAuthnConfig {
  /** Relying Party name (displayed to the user). */
  readonly rpName: string;
  /** Relying Party ID (typically the domain). */
  readonly rpId: string;
  /** Origin URL for verification. */
  readonly origin: string;
  /** Preferred authenticator transport. */
  readonly preferredTransport?: 'usb' | 'ble' | 'nfc' | 'internal';
  /** Whether to require a resident key. */
  readonly requireResidentKey?: boolean;
  /** User verification requirement. */
  readonly userVerification?: 'required' | 'preferred' | 'discouraged';
  /** Timeout in ms. */
  readonly timeoutMs?: number;
}

/**
 * Configuration for API Key authentication.
 */
interface ApiKeyConfig {
  /** The API key value. */
  readonly apiKey: string;
  /** Header name to send the key in (default: "Authorization"). */
  readonly headerName?: string;
  /** Prefix before the key value (default: "Bearer"). */
  readonly prefix?: string;
  /** The URL this key is valid for (optional, for validation). */
  readonly validForUrl?: string;
}

/**
 * Configuration for HTTP Basic authentication.
 */
interface BasicAuthConfig {
  /** Username. */
  readonly username: string;
  /** Password. */
  readonly password: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// PUBLIC CONTRACT
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Every authentication provider must implement this interface.
 *
 * The interface follows the Interface Segregation Principle: callers that
 * only need to authenticate depend on authenticate(); callers that need
 * token refresh depend on refresh(); etc.
 */
interface IAuthProvider extends IDisposable {
  /** The protocol this provider implements. */
  readonly protocol: AuthProtocol;
  /** Human-readable name. */
  readonly name: string;
  /** Whether the provider is currently configured and ready. */
  readonly isConfigured: boolean;

  /**
   * Initiate or complete an authentication flow.
   *
   * For redirect-based flows (OAuth2, OIDC, SAML), this returns the
   * authorization URL the browser should navigate to.  For direct flows
   * (WebAuthn, API Key), this completes immediately.
   *
   * @returns AuthResult on completion, or a redirect URL string for
   *          flows that require browser navigation.
   */
  authenticate(): Promise<AuthResult> | string;

  /**
   * Complete an OAuth/OIDC flow by exchanging an authorization code
   * for tokens.  Only applicable to code-based flows.
   */
  handleCallback(callbackUrl: string): Promise<AuthResult>;

  /**
   * Refresh an expired access token using the stored refresh token.
   */
  refresh(refreshToken: string): Promise<AuthToken>;

  /**
   * Validate a token (check expiry, signature where applicable).
   */
  validateToken(token: AuthToken): TokenValidationResult;

  /**
   * Revoke a token at the provider.
   */
  revokeToken(token: string): Promise<boolean>;

  /**
   * Get the current authenticated identity, or null if not authenticated.
   */
  getIdentity(): AuthIdentity | null;

  /**
   * Get all stored tokens for this provider.
   */
  getTokens(): readonly AuthToken[];
}

/**
 * Result of validating a token.
 */
interface TokenValidationResult {
  /** Whether the token is valid. */
  readonly valid: boolean;
  /** Whether the token has expired. */
  readonly expired: boolean;
  /** Human-readable reason when invalid. */
  readonly reason?: string;
  /** Decoded claims (when validation includes parsing). */
  readonly claims?: Readonly<Record<string, unknown>>;
}

// ─────────────────────────────────────────────────────────────────────────────
// ERRORS
// ─────────────────────────────────────────────────────────────────────────────

class AuthError extends Error {
  readonly protocol: AuthProtocol;
  constructor(protocol: AuthProtocol, message: string) {
    super(message);
    this.name = 'AuthError';
    this.protocol = protocol;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

class AuthTokenExpiredError extends AuthError {
  readonly tokenType: CredentialType;
  constructor(protocol: AuthProtocol, tokenType: CredentialType) {
    super(protocol, `Token of type "${tokenType}" has expired.`);
    this.name = 'AuthTokenExpiredError';
    this.tokenType = tokenType;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

class AuthTokenRevokedError extends AuthError {
  constructor(protocol: AuthProtocol, token: string) {
    super(protocol, `Token "${token.slice(0, 16)}..." has been revoked.`);
    this.name = 'AuthTokenRevokedError';
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

class AuthProviderNotConfiguredError extends AuthError {
  readonly providerName: string;
  constructor(protocol: AuthProtocol, providerName: string) {
    super(protocol, `Auth provider "${providerName}" is not configured.`);
    this.name = 'AuthProviderNotConfiguredError';
    this.providerName = providerName;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

class AuthFlowCancelledError extends AuthError {
  constructor(protocol: AuthProtocol) {
    super(protocol, 'Authentication flow was cancelled by the user.');
    this.name = 'AuthFlowCancelledError';
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

class AuthCSRFError extends AuthError {
  constructor(protocol: AuthProtocol) {
    super(protocol, 'CSRF validation failed: state parameter mismatch.');
    this.name = 'AuthCSRFError';
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

class AuthPKCEError extends AuthError {
  constructor(protocol: AuthProtocol) {
    super(protocol, 'PKCE code verifier/challenge mismatch.');
    this.name = 'AuthPKCEError';
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────

/** Generate a cryptographically random string for state / nonce. */
function generateRandomString(length = 32): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~';
  const array = new Uint8Array(length);
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    crypto.getRandomValues(array);
  } else {
    for (let i = 0; i < length; i++) {
      array[i] = Math.floor(Math.random() * 256);
    }
  }
  return Array.from(array, b => chars[b % chars.length]).join('');
}

/** Base64url encode a Uint8Array (no padding). */
function base64urlEncode(data: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < data.length; i++) {
    binary += String.fromCharCode(data[i]!);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Base64url decode a string to Uint8Array. */
function base64urlDecode(str: string): Uint8Array {
  const padded = str.replace(/-/g, '+').replace(/_/g, '/');
  const pad = padded.length % 4 === 0 ? '' : '='.repeat(4 - (padded.length % 4));
  const binary = atob(padded + pad);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

// ─────────────────────────────────────────────────────────────────────────────
// EXPORTS
// ─────────────────────────────────────────────────────────────────────────────

export {
  AuthProtocol,
  AuthSessionState,
  CredentialType,
  OAuthGrantType,
  OAuthResponseType,
  AuthError,
  AuthTokenExpiredError,
  AuthTokenRevokedError,
  AuthProviderNotConfiguredError,
  AuthFlowCancelledError,
  AuthCSRFError,
  AuthPKCEError,
  generateRandomString,
  base64urlEncode,
  base64urlDecode,
};

export type {
  IAuthProvider,
  AuthToken,
  AuthIdentity,
  AuthResult,
  OAuth2Config,
  SAMLConfig,
  WebAuthnConfig,
  ApiKeyConfig,
  BasicAuthConfig,
  TokenValidationResult,
};
