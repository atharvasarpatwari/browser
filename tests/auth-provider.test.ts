import { describe, it, expect } from 'vitest';
import {
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
} from '../src/browser/auth/auth-provider';

describe('AuthProtocol enum', () => {
  it('should have all protocol values', () => {
    expect(AuthProtocol.OAuth2).toBe('oauth2');
    expect(AuthProtocol.OpenIDConnect).toBe('openid-connect');
    expect(AuthProtocol.SAML2).toBe('saml2');
    expect(AuthProtocol.WebAuthn).toBe('webauthn');
    expect(AuthProtocol.ApiKey).toBe('api-key');
    expect(AuthProtocol.BasicAuth).toBe('basic-auth');
    expect(AuthProtocol.Custom).toBe('custom');
  });

  it('should have 7 protocols', () => {
    const keys = Object.keys(AuthProtocol).filter(k => isNaN(Number(k)));
    expect(keys.length).toBe(7);
  });
});

describe('AuthSessionState enum', () => {
  it('should have all state values', () => {
    expect(AuthSessionState.Unauthenticated).toBe('unauthenticated');
    expect(AuthSessionState.InProgress).toBe('in-progress');
    expect(AuthSessionState.Authenticated).toBe('authenticated');
    expect(AuthSessionState.Expired).toBe('expired');
    expect(AuthSessionState.Failed).toBe('failed');
    expect(AuthSessionState.SignedOut).toBe('signed-out');
  });
});

describe('CredentialType enum', () => {
  it('should have all credential types', () => {
    expect(CredentialType.AccessToken).toBe('access-token');
    expect(CredentialType.RefreshToken).toBe('refresh-token');
    expect(CredentialType.IdToken).toBe('id-token');
    expect(CredentialType.SamlAssertion).toBe('saml-assertion');
    expect(CredentialType.WebAuthnCred).toBe('webauthn-credential');
    expect(CredentialType.ApiKey).toBe('api-key');
    expect(CredentialType.BasicCreds).toBe('basic-credentials');
    expect(CredentialType.SessionToken).toBe('session-token');
  });
});

describe('OAuthGrantType enum', () => {
  it('should have all grant types', () => {
    expect(OAuthGrantType.AuthorizationCode).toBe('authorization_code');
    expect(OAuthGrantType.Implicit).toBe('implicit');
    expect(OAuthGrantType.ClientCredentials).toBe('client_credentials');
    expect(OAuthGrantType.RefreshToken).toBe('refresh_token');
    expect(OAuthGrantType.DeviceCode).toBe('urn:ietf:params:oauth:grant-type:device-code');
  });
});

describe('OAuthResponseType enum', () => {
  it('should have all response types', () => {
    expect(OAuthResponseType.Code).toBe('code');
    expect(OAuthResponseType.Token).toBe('token');
    expect(OAuthResponseType.IdToken).toBe('id_token');
  });
});

describe('Error classes', () => {
  it('AuthError should have protocol and message', () => {
    const err = new AuthError(AuthProtocol.OAuth2, 'Something went wrong');
    expect(err.name).toBe('AuthError');
    expect(err.protocol).toBe(AuthProtocol.OAuth2);
    expect(err.message).toBe('Something went wrong');
    expect(err instanceof Error).toBe(true);
  });

  it('AuthTokenExpiredError should include tokenType', () => {
    const err = new AuthTokenExpiredError(AuthProtocol.OAuth2, CredentialType.AccessToken);
    expect(err.name).toBe('AuthTokenExpiredError');
    expect(err.protocol).toBe(AuthProtocol.OAuth2);
    expect(err.tokenType).toBe(CredentialType.AccessToken);
    expect(err.message).toContain('Token of type "access-token" has expired');
    expect(err instanceof AuthError).toBe(true);
  });

  it('AuthTokenRevokedError should include truncated token', () => {
    const err = new AuthTokenRevokedError(AuthProtocol.SAML2, 'abcdefghijklmnopqrstuvwxyz');
    expect(err.name).toBe('AuthTokenRevokedError');
    expect(err.protocol).toBe(AuthProtocol.SAML2);
    expect(err.message).toContain('abcdefghijklmnop...');
    expect(err instanceof AuthError).toBe(true);
  });

  it('AuthProviderNotConfiguredError should include providerName', () => {
    const err = new AuthProviderNotConfiguredError(AuthProtocol.OAuth2, 'my-google');
    expect(err.name).toBe('AuthProviderNotConfiguredError');
    expect(err.protocol).toBe(AuthProtocol.OAuth2);
    expect(err.providerName).toBe('my-google');
    expect(err.message).toContain('Auth provider "my-google" is not configured');
    expect(err instanceof AuthError).toBe(true);
  });

  it('AuthFlowCancelledError should have correct message', () => {
    const err = new AuthFlowCancelledError(AuthProtocol.OpenIDConnect);
    expect(err.name).toBe('AuthFlowCancelledError');
    expect(err.protocol).toBe(AuthProtocol.OpenIDConnect);
    expect(err.message).toContain('cancelled by the user');
    expect(err instanceof AuthError).toBe(true);
  });

  it('AuthCSRFError should have correct message', () => {
    const err = new AuthCSRFError(AuthProtocol.OAuth2);
    expect(err.name).toBe('AuthCSRFError');
    expect(err.message).toContain('CSRF validation failed');
    expect(err instanceof AuthError).toBe(true);
  });

  it('AuthPKCEError should have correct message', () => {
    const err = new AuthPKCEError(AuthProtocol.OAuth2);
    expect(err.name).toBe('AuthPKCEError');
    expect(err.message).toContain('PKCE code verifier/challenge mismatch');
    expect(err instanceof AuthError).toBe(true);
  });

  it('all error classes should use proper prototype chain for instanceof', () => {
    const errors = [
      new AuthError(AuthProtocol.OAuth2, 'test'),
      new AuthTokenExpiredError(AuthProtocol.OAuth2, CredentialType.AccessToken),
      new AuthTokenRevokedError(AuthProtocol.OAuth2, 'tok'),
      new AuthProviderNotConfiguredError(AuthProtocol.OAuth2, 'prov'),
      new AuthFlowCancelledError(AuthProtocol.OAuth2),
      new AuthCSRFError(AuthProtocol.OAuth2),
      new AuthPKCEError(AuthProtocol.OAuth2),
    ];

    for (const err of errors) {
      expect(err instanceof Error).toBe(true);
      expect(err instanceof AuthError).toBe(true);
    }
  });
});

describe('generateRandomString', () => {
  it('should return a string of the specified length', () => {
    const str = generateRandomString(32);
    expect(str).toHaveLength(32);
  });

  it('should default to 32 characters', () => {
    const str = generateRandomString();
    expect(str).toHaveLength(32);
  });

  it('should return different strings on subsequent calls', () => {
    const str1 = generateRandomString(32);
    const str2 = generateRandomString(32);
    expect(str1).not.toBe(str2);
  });

  it('should only contain URL-safe characters', () => {
    const str = generateRandomString(100);
    expect(str).toMatch(/^[A-Za-z0-9\-._~]+$/);
  });

  it('should handle small lengths', () => {
    expect(generateRandomString(1)).toHaveLength(1);
    expect(generateRandomString(0)).toHaveLength(0);
  });
});

describe('base64urlEncode / base64urlDecode', () => {
  it('should round-trip encode/decode correctly', () => {
    const data = new TextEncoder().encode('Hello, World!');
    const encoded = base64urlEncode(data);
    const decoded = base64urlDecode(encoded);
    expect(decoded).toEqual(data);
  });

  it('should produce URL-safe base64 (no +, /, or =)', () => {
    const data = new Uint8Array([0xff, 0xfe, 0xfd, 0xfc, 0xfb, 0xfa]);
    const encoded = base64urlEncode(data);
    expect(encoded).not.toContain('+');
    expect(encoded).not.toContain('/');
    expect(encoded).not.toContain('=');
  });

  it('should handle empty data', () => {
    const encoded = base64urlEncode(new Uint8Array(0));
    expect(encoded).toBe('');
    const decoded = base64urlDecode('');
    expect(decoded.length).toBe(0);
  });

  it('should handle binary data with all byte values', () => {
    const data = new Uint8Array(256);
    for (let i = 0; i < 256; i++) data[i] = i;
    const encoded = base64urlEncode(data);
    const decoded = base64urlDecode(encoded);
    expect(decoded).toEqual(data);
  });

  it('should handle unicode strings', () => {
    const text = 'Hello \u00e9\u00e8\u00ea \ud83d\ude00';
    const data = new TextEncoder().encode(text);
    const encoded = base64urlEncode(data);
    const decoded = base64urlDecode(encoded);
    expect(new TextDecoder().decode(decoded)).toBe(text);
  });
});
