import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { OAuth2Provider } from '../src/browser/auth/oauth2-provider';
import {
  AuthProtocol,
  AuthProviderNotConfiguredError,
  AuthCSRFError,
  OAuthResponseType,
  OAuthGrantType,
  CredentialType,
} from '../src/browser/auth/auth-provider';
import type { OAuth2Config } from '../src/browser/auth/auth-provider';

const VALID_CONFIG: OAuth2Config = {
  clientId: 'test-client-id',
  clientSecret: 'test-secret',
  authorizationEndpoint: 'https://auth.example.com/authorize',
  tokenEndpoint: 'https://auth.example.com/token',
  redirectUri: 'https://myapp.example.com/callback',
  scopes: ['openid', 'profile', 'email'],
  responseType: OAuthResponseType.Code,
  grantType: OAuthGrantType.AuthorizationCode,
};

const PKCE_CONFIG: OAuth2Config = {
  ...VALID_CONFIG,
  usePKCE: true,
  clientSecret: undefined,
};

describe('OAuth2Provider', () => {
  let provider: OAuth2Provider;
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    provider = new OAuth2Provider('test-oauth', VALID_CONFIG);
    fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    provider.dispose();
  });

  describe('basic properties', () => {
    it('should have correct protocol and name', () => {
      expect(provider.protocol).toBe(AuthProtocol.OAuth2);
      expect(provider.name).toBe('test-oauth');
    });

    it('should report isConfigured when config is complete', () => {
      expect(provider.isConfigured).toBe(true);
    });

    it('should report not configured when clientId is empty', () => {
      const p = new OAuth2Provider('bad', { ...VALID_CONFIG, clientId: '' });
      expect(p.isConfigured).toBe(false);
      p.dispose();
    });

    it('should report not configured when authorization endpoint is empty', () => {
      const p = new OAuth2Provider('bad', { ...VALID_CONFIG, authorizationEndpoint: '' });
      expect(p.isConfigured).toBe(false);
      p.dispose();
    });
  });

  describe('authenticate', () => {
    it('should return an authorization URL with correct parameters', () => {
      const url = provider.authenticate() as string;
      expect(url).toContain('https://auth.example.com/authorize?');
      expect(url).toContain('client_id=test-client-id');
      expect(url).toContain('redirect_uri=');
      expect(url).toContain('response_type=code');
      expect(url).toContain('scope=openid+profile+email');
    });

    it('should include state parameter by default', () => {
      const url = provider.authenticate() as string;
      expect(url).toContain('state=');
    });

    it('should not include state when useState is false', () => {
      const noState = new OAuth2Provider('ns', { ...VALID_CONFIG, useState: false });
      const url = noState.authenticate() as string;
      expect(url).not.toContain('state=');
      noState.dispose();
    });

    it('should include PKCE parameters when usePKCE is true', () => {
      const pkce = new OAuth2Provider('pkce', PKCE_CONFIG);
      const url = pkce.authenticate() as string;
      expect(url).toContain('code_challenge=');
      expect(url).toContain('code_challenge_method=S256');
      pkce.dispose();
    });

    it('should include extraParams', () => {
      const custom = new OAuth2Provider('custom', {
        ...VALID_CONFIG,
        extraParams: { prompt: 'consent', access_type: 'offline' },
      });
      const url = custom.authenticate() as string;
      expect(url).toContain('prompt=consent');
      expect(url).toContain('access_type=offline');
      custom.dispose();
    });

    it('should throw when not configured', () => {
      const bad = new OAuth2Provider('bad', { ...VALID_CONFIG, clientId: '' });
      expect(() => bad.authenticate()).toThrow(AuthProviderNotConfiguredError);
      bad.dispose();
    });
  });

  describe('handleCallback', () => {
    it('should exchange authorization code for tokens on success', async () => {
      const tokenResponse = {
        access_token: 'at_123',
        token_type: 'Bearer',
        expires_in: 3600,
        refresh_token: 'rt_456',
        scope: 'openid profile',
      };

      fetchSpy.mockResolvedValueOnce({
        ok: true,
        json: async () => tokenResponse,
      });

      // Call authenticate first to set state, then extract it.
      const authUrl = provider.authenticate() as string;
      const stateParam = new URL(authUrl).searchParams.get('state')!;

      const result = await provider.handleCallback(
        `https://myapp.example.com/callback?code=auth_code_abc&state=${stateParam}`,
      );

      expect(result.success).toBe(true);
      expect(result.authorizationCode).toBe('auth_code_abc');
      expect(result.tokens).toHaveLength(2); // access + refresh
      expect(result.identity).toBeDefined();

      // Verify fetch was called with correct params.
      expect(fetchSpy).toHaveBeenCalledWith(
        'https://auth.example.com/token',
        expect.objectContaining({ method: 'POST' }),
      );
    });

    it('should return error when provider returns error', async () => {
      const url = 'https://myapp.example.com/callback?error=access_denied&error_description=User+denied';
      const result = await provider.handleCallback(url);
      expect(result.success).toBe(false);
      expect(result.error).toBe('User denied');
    });

    it('should throw AuthCSRFError on state mismatch', async () => {
      provider.authenticate(); // sets internal state
      await expect(
        provider.handleCallback('https://myapp.example.com/callback?code=abc&state=wrong-state'),
      ).rejects.toThrow(AuthCSRFError);
    });

    it('should return error when no code is present', async () => {
      const result = await provider.handleCallback('https://myapp.example.com/callback');
      expect(result.success).toBe(false);
      expect(result.error).toContain('No authorization code');
    });

    it('should handle token exchange failure', async () => {
      fetchSpy.mockResolvedValueOnce({
        ok: false,
        statusText: 'Bad Request',
        json: async () => ({ error: 'invalid_grant' }),
      });

      const authUrl = provider.authenticate() as string;
      const stateParam = new URL(authUrl).searchParams.get('state')!;
      const result = await provider.handleCallback(
        `https://myapp.example.com/callback?code=bad_code&state=${stateParam}`,
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain('Token exchange failed');
    });
  });

  describe('refresh', () => {
    it('should exchange refresh token for new access token', async () => {
      fetchSpy.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          access_token: 'new_at',
          token_type: 'Bearer',
          expires_in: 3600,
          scope: 'openid',
        }),
      });

      const token = await provider.refresh('rt_old');
      expect(token.value).toBe('new_at');
      expect(fetchSpy).toHaveBeenCalled();
    });

    it('should throw on refresh failure', async () => {
      fetchSpy.mockResolvedValueOnce({
        ok: false,
        statusText: 'Unauthorized',
        json: async () => ({ error: 'invalid_token' }),
      });

      await expect(provider.refresh('rt_bad')).rejects.toThrow('Token refresh failed');
    });
  });

  describe('validateToken', () => {
    it('should validate non-expired token', () => {
      const result = provider.validateToken({
        value: 'tok',
        type: CredentialType.AccessToken,
        expiresAt: Date.now() + 3600_000,
        issuedAt: Date.now(),
        scopes: [],
      });
      expect(result.valid).toBe(true);
      expect(result.expired).toBe(false);
    });

    it('should detect expired token', () => {
      const result = provider.validateToken({
        value: 'tok',
        type: CredentialType.AccessToken,
        expiresAt: Date.now() - 1000,
        issuedAt: Date.now() - 3700_000,
        scopes: [],
      });
      expect(result.valid).toBe(false);
      expect(result.expired).toBe(true);
    });
  });

  describe('revokeToken', () => {
    it('should send revocation request', async () => {
      fetchSpy.mockResolvedValueOnce({ ok: true });
      const result = await provider.revokeToken('tok_to_revoke');
      expect(result).toBe(true);
      expect(fetchSpy).toHaveBeenCalledWith(
        'https://auth.example.com/revoke',
        expect.anything(),
      );
    });

    it('should return false on revocation failure', async () => {
      fetchSpy.mockRejectedValueOnce(new Error('Network error'));
      const result = await provider.revokeToken('tok');
      expect(result).toBe(false);
    });
  });

  describe('getIdentity / getTokens', () => {
    it('should return null identity before auth', () => {
      expect(provider.getIdentity()).toBeNull();
    });

    it('should return empty tokens before auth', () => {
      expect(provider.getTokens()).toHaveLength(0);
    });
  });

  describe('dispose', () => {
    it('should clear all internal state', async () => {
      fetchSpy.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          access_token: 'at',
          token_type: 'Bearer',
          expires_in: 3600,
        }),
      });

      const authUrl = provider.authenticate() as string;
      const stateParam = new URL(authUrl).searchParams.get('state')!;
      await provider.handleCallback(
        `https://myapp.example.com/callback?code=abc&state=${stateParam}`,
      );

      expect(provider.getTokens().length).toBeGreaterThan(0);
      provider.dispose();
      expect(provider.getTokens()).toHaveLength(0);
      expect(provider.getIdentity()).toBeNull();
    });
  });
});
