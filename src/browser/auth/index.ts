/**
 * @file src/browser/auth/index.ts
 *
 * Barrel export for the authentication subsystem.
 * Import from this module for convenient access to all auth types.
 */

// ── Enums ────────────────────────────────────────────────────────────────────
export {
  AuthProtocol,
  AuthSessionState,
  CredentialType,
  OAuthGrantType,
  OAuthResponseType,
} from './auth-provider';

// ── Errors ───────────────────────────────────────────────────────────────────
export {
  AuthError,
  AuthTokenExpiredError,
  AuthTokenRevokedError,
  AuthProviderNotConfiguredError,
  AuthFlowCancelledError,
  AuthCSRFError,
  AuthPKCEError,
} from './auth-provider';

// ── Helpers ──────────────────────────────────────────────────────────────────
export {
  generateRandomString,
  base64urlEncode,
  base64urlDecode,
} from './auth-provider';

// ── Types ────────────────────────────────────────────────────────────────────
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
} from './auth-provider';

// ── JWT Manager ──────────────────────────────────────────────────────────────
export { JwtManager } from './jwt-manager';
export type {
  IJwtManager,
  JwtHeader,
  JwtPayload,
  JwtToken,
  JwtValidationOptions,
  JwtValidationResult,
} from './jwt-manager';

// ── Token Store ──────────────────────────────────────────────────────────────
export { InMemoryTokenStore, encryptData, decryptData } from './token-store';
export type {
  ITokenStore,
  TokenEntry,
  TokenStoreConfig,
} from './token-store';

// ── OAuth 2.0 Provider ──────────────────────────────────────────────────────
export { OAuth2Provider } from './oauth2-provider';
export type { TokenResponse } from './oauth2-provider';

// ── OpenID Connect Provider ──────────────────────────────────────────────────
export { OpenIDConnectProvider } from './openid-connect-provider';
export type {
  OIDCConfig,
  UserInfoResponse,
} from './openid-connect-provider';

// ── SAML 2.0 Provider ───────────────────────────────────────────────────────
export { SAML2Provider } from './saml-provider';
export type {
  SAMLAttributes,
  SAMLResponse,
} from './saml-provider';

// ── WebAuthn Provider ────────────────────────────────────────────────────────
export { WebAuthnProvider } from './webauthn-provider';
export type {
  WebAuthnCredentialEntry,
  WebAuthnRegistrationResult,
  WebAuthnAuthenticationResult,
} from './webauthn-provider';

// ── API Key / Basic Auth Providers ───────────────────────────────────────────
export { ApiKeyProvider, BasicAuthProvider } from './api-key-provider';

// ── Auth Session ─────────────────────────────────────────────────────────────
export { AuthSession } from './auth-session';
export type {
  IAuthSession,
  AuthSessionConfig,
  AuthSessionSnapshot,
  AuthSessionEvent,
  AuthSessionEventType,
} from './auth-session';

// ── Auth Manager ─────────────────────────────────────────────────────────────
export { AuthManager } from './auth-manager';
export type {
  IAuthManager,
  AuthManagerEvent,
  AuthManagerEventType,
} from './auth-manager';
