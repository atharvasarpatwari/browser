import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { OpenIDConnectProvider } from '../src/browser/auth/openid-connect-provider';
import { AuthProtocol, OAuthResponseType, OAuthGrantType } from '../src/browser/auth/auth-provider';
import type { OIDCConfig } from '../src/browser/auth/openid-connect-provider';
import { JwtManager } from '../src/browser/auth/jwt-manager';

const VALID_OIDC_CONFIG: OIDCConfig = {
  clientId: 'oidc-client-id',
  clientSecret: 'oidc-secret',
  authorizationEndpoint: 'https://idp.example.com/authorize',
  tokenEndpoint: 'https://idp.example.com/token',
  redirectUri: 'https://myapp.example.com/callback',
  scopes: ['openid', 'profile', 'email'],
  responseType: OAuthResponseType.Code,
  grantType: OAuthGrantType.AuthorizationCode,
  discoveryUrl: 'https://idp.example.com/.well-known/openid-configuration',
  expectedIssuer: 'https://idp.example.com',
  userinfoEndpoint: 'https://idp.example.com/userinfo',
};

describe('OpenIDConnectProvider', () => {
  let provider: OpenIDConnectProvider;
  let fetchSpy: ReturnType<typeof vi.fn>;
  let jwtManager: JwtManager;

  beforeEach(() => {
    provider = new OpenIDConnectProvider('test-oidc', VALID_OIDC_CONFIG);
    fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    jwtManager = new JwtManager();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    provider.dispose();
  });

  describe('basic properties', () => {
    it('should use OpenIDConnect protocol', () => {
      expect(provider.protocol).toBe(AuthProtocol.OpenIDConnect);
      expect(provider.name).toBe('test-oidc');
    });

    it('should inherit OAuth2Provider behavior', () => {
      expect(provider.isConfigured).toBe(true);
    });
  });

  describe('authenticate (inherited)', () => {
    it('should return an authorization URL', () => {
      const url = provider.authenticate() as string;
      expect(url).toContain('https://idp.example.com/authorize?');
      expect(url).toContain('client_id=oidc-client-id');
    });
  });

  describe('fetchDiscoveryDocument', () => {
    it('should fetch and return the discovery document', async () => {
      const doc = {
        issuer: 'https://idp.example.com',
        authorization_endpoint: 'https://idp.example.com/authorize',
        token_endpoint: 'https://idp.example.com/token',
        jwks_uri: 'https://idp.example.com/jwks',
      };

      fetchSpy.mockResolvedValueOnce({
        ok: true,
        json: async () => doc,
      });

      const result = await provider.fetchDiscoveryDocument();
      expect(result).toEqual(doc);
      expect(fetchSpy).toHaveBeenCalledWith('https://idp.example.com/.well-known/openid-configuration');
    });

    it('should return null on fetch failure', async () => {
      fetchSpy.mockResolvedValueOnce({ ok: false, status: 404 });
      const result = await provider.fetchDiscoveryDocument();
      expect(result).toBeNull();
    });

    it('should return null on network error', async () => {
      fetchSpy.mockRejectedValueOnce(new Error('Network error'));
      const result = await provider.fetchDiscoveryDocument();
      expect(result).toBeNull();
    });

    it('should return null when no discoveryUrl is configured', async () => {
      const noDiscovery = new OpenIDConnectProvider('nd', {
        ...VALID_OIDC_CONFIG,
        discoveryUrl: undefined,
      });
      const result = await noDiscovery.fetchDiscoveryDocument();
      expect(result).toBeNull();
      noDiscovery.dispose();
    });
  });

  describe('handleCallback with ID token', () => {
    it('should parse and validate ID token from callback URL', async () => {
      const secret = 'jwt-signing-secret';
      const idToken = jwtManager.sign(
        {
          sub: 'user-123',
          iss: 'https://idp.example.com',
          aud: 'oidc-client-id',
          name: 'Test User',
          email: 'test@example.com',
        },
        secret,
        'HS256',
        3600,
      );

      // Mock token endpoint.
      fetchSpy.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          access_token: 'access_tok',
          token_type: 'Bearer',
          expires_in: 3600,
          id_token: idToken,
        }),
      });

      // Mock userinfo endpoint.
      fetchSpy.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          sub: 'user-123',
          name: 'Test User',
          email: 'test@example.com',
          picture: 'https://example.com/photo.jpg',
        }),
      });

      const authUrl = provider.authenticate() as string;
      const stateParam = new URL(authUrl).searchParams.get('state')!;
      const result = await provider.handleCallback(
        `https://myapp.example.com/callback?code=auth_code&state=${stateParam}&id_token=${idToken}`,
      );

      expect(result.success).toBe(true);
      expect(result.identity).toBeDefined();
      expect(result.identity!.id).toBe('user-123');
      expect(result.identity!.name).toBe('Test User');
      expect(result.identity!.email).toBe('test@example.com');
    });

    it('should succeed without ID token (pure OAuth2 fallback)', async () => {
      fetchSpy.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          access_token: 'access_only',
          token_type: 'Bearer',
          expires_in: 3600,
        }),
      });

      const authUrl = provider.authenticate() as string;
      const stateParam = new URL(authUrl).searchParams.get('state')!;
      const result = await provider.handleCallback(
        `https://myapp.example.com/callback?code=auth_code&state=${stateParam}`,
      );

      expect(result.success).toBe(true);
    });
  });

  describe('validateIdToken', () => {
    it('should accept a valid ID token', () => {
      const token = jwtManager.sign(
        {
          sub: 'user1',
          iss: 'https://idp.example.com',
          aud: 'oidc-client-id',
        },
        'secret',
      );
      const decoded = jwtManager.decode(token)!;
      const result = provider.validateIdToken(decoded);
      expect(result.valid).toBe(true);
    });

    it('should reject an expired ID token', () => {
      const token = jwtManager.sign(
        {
          sub: 'user1',
          iss: 'https://idp.example.com',
          aud: 'oidc-client-id',
          exp: Math.floor(Date.now() / 1000) - 3600,
        },
        'secret',
      );
      const decoded = jwtManager.decode(token)!;
      const result = provider.validateIdToken(decoded);
      expect(result.valid).toBe(false);
      expect(result.expired).toBe(true);
    });

    it('should reject when issuer does not match', () => {
      const token = jwtManager.sign(
        {
          sub: 'user1',
          iss: 'https://wrong-issuer.com',
          aud: 'oidc-client-id',
        },
        'secret',
      );
      const decoded = jwtManager.decode(token)!;
      const result = provider.validateIdToken(decoded);
      expect(result.valid).toBe(false);
      expect(result.reason).toContain('issuer mismatch');
    });

    it('should reject when audience does not include client_id', () => {
      const token = jwtManager.sign(
        {
          sub: 'user1',
          iss: 'https://idp.example.com',
          aud: 'wrong-client',
        },
        'secret',
      );
      const decoded = jwtManager.decode(token)!;
      const result = provider.validateIdToken(decoded);
      expect(result.valid).toBe(false);
      expect(result.reason).toContain('audience');
    });

    it('should accept audience as array that includes client_id', () => {
      const token = jwtManager.sign(
        {
          sub: 'user1',
          iss: 'https://idp.example.com',
          aud: ['oidc-client-id', 'other-client'],
        },
        'secret',
      );
      const decoded = jwtManager.decode(token)!;
      const result = provider.validateIdToken(decoded);
      expect(result.valid).toBe(true);
    });

    it('should reject nbf in the future', () => {
      const token = jwtManager.sign(
        {
          sub: 'user1',
          nbf: Math.floor(Date.now() / 1000) + 7200,
        },
        'secret',
      );
      const decoded = jwtManager.decode(token)!;
      const result = provider.validateIdToken(decoded);
      expect(result.valid).toBe(false);
      expect(result.reason).toContain('not yet valid');
    });
  });

  describe('fetchUserInfo', () => {
    it('should fetch user info with Bearer token', async () => {
      fetchSpy.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          sub: 'user1',
          name: 'Test User',
          email: 'test@example.com',
        }),
      });

      const info = await provider.fetchUserInfo('access_token_123');
      expect(info).toBeDefined();
      expect(info!.sub).toBe('user1');
      expect(info!.name).toBe('Test User');

      expect(fetchSpy).toHaveBeenCalledWith('https://idp.example.com/userinfo', {
        headers: { Authorization: 'Bearer access_token_123' },
      });
    });

    it('should return null on failure', async () => {
      fetchSpy.mockResolvedValueOnce({ ok: false });
      const info = await provider.fetchUserInfo('bad_token');
      expect(info).toBeNull();
    });

    it('should return null when no userinfoEndpoint is configured', async () => {
      const noUi = new OpenIDConnectProvider('nui', {
        ...VALID_OIDC_CONFIG,
        userinfoEndpoint: undefined,
      });
      const info = await noUi.fetchUserInfo('tok');
      expect(info).toBeNull();
      noUi.dispose();
    });
  });
});
