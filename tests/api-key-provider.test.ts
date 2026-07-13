import { describe, it, expect, beforeEach } from 'vitest';
import { ApiKeyProvider, BasicAuthProvider } from '../src/browser/auth/api-key-provider';
import { AuthProtocol, CredentialType } from '../src/browser/auth/auth-provider';

describe('ApiKeyProvider', () => {
  let provider: ApiKeyProvider;

  beforeEach(() => {
    provider = new ApiKeyProvider('test-apikey', {
      apiKey: 'my-secret-api-key-12345',
      headerName: 'X-API-Key',
      prefix: 'ApiKey',
    });
  });

  describe('basic properties', () => {
    it('should use ApiKey protocol', () => {
      expect(provider.protocol).toBe(AuthProtocol.ApiKey);
      expect(provider.name).toBe('test-apikey');
    });

    it('should report isConfigured when key is present', () => {
      expect(provider.isConfigured).toBe(true);
    });

    it('should report not configured when key is empty', () => {
      const bad = new ApiKeyProvider('bad', { apiKey: '' });
      expect(bad.isConfigured).toBe(false);
      bad.dispose();
    });
  });

  describe('authenticate', () => {
    it('should return success with the API key token', async () => {
      const result = await provider.authenticate();
      expect(result.success).toBe(true);
      expect(result.tokens).toHaveLength(1);
      expect(result.tokens[0]!.value).toBe('my-secret-api-key-12345');
      expect(result.tokens[0]!.type).toBe(CredentialType.ApiKey);
      expect(result.tokens[0]!.expiresAt).toBeNull();
      expect(result.identity).toBeDefined();
      expect(result.identity!.id).toBe('api-key-user');
    });

    it('should throw when not configured', async () => {
      const bad = new ApiKeyProvider('bad', { apiKey: '' });
      await expect(bad.authenticate()).rejects.toThrow();
      bad.dispose();
    });
  });

  describe('handleCallback', () => {
    it('should return an error (API key does not use callbacks)', async () => {
      const result = await provider.handleCallback('https://example.com');
      expect(result.success).toBe(false);
      expect(result.error).toContain('does not use callbacks');
    });
  });

  describe('refresh', () => {
    it('should return a new token with the same API key', async () => {
      const token = await provider.refresh('old-refresh');
      expect(token.value).toBe('my-secret-api-key-12345');
      expect(token.type).toBe(CredentialType.ApiKey);
    });
  });

  describe('validateToken', () => {
    it('should always validate (API keys do not expire)', () => {
      const result = provider.validateToken({
        value: 'key',
        type: CredentialType.ApiKey,
        expiresAt: null,
        issuedAt: Date.now(),
        scopes: [],
      });
      expect(result.valid).toBe(true);
      expect(result.expired).toBe(false);
    });
  });

  describe('revokeToken', () => {
    it('should return false (cannot revoke API key server-side)', async () => {
      const result = await provider.revokeToken('key');
      expect(result).toBe(false);
    });
  });

  describe('buildAuthHeader', () => {
    it('should build the correct header with custom name and prefix', () => {
      const header = provider.buildAuthHeader();
      expect(header).toEqual({ 'X-API-Key': 'ApiKey my-secret-api-key-12345' });
    });

    it('should use default header name and prefix when not specified', () => {
      const defaultProvider = new ApiKeyProvider('default', { apiKey: 'key123' });
      const header = defaultProvider.buildAuthHeader();
      expect(header).toEqual({ Authorization: 'ApiKey key123' });
      defaultProvider.dispose();
    });
  });

  describe('getIdentity / getTokens', () => {
    it('should be null/empty before auth', () => {
      expect(provider.getIdentity()).toBeNull();
      expect(provider.getTokens()).toHaveLength(0);
    });

    it('should be populated after auth', async () => {
      await provider.authenticate();
      expect(provider.getIdentity()).not.toBeNull();
      expect(provider.getTokens()).toHaveLength(1);
    });
  });

  describe('dispose', () => {
    it('should clear state', async () => {
      await provider.authenticate();
      provider.dispose();
      expect(provider.getIdentity()).toBeNull();
      expect(provider.getTokens()).toHaveLength(0);
    });
  });
});

describe('BasicAuthProvider', () => {
  let provider: BasicAuthProvider;

  beforeEach(() => {
    provider = new BasicAuthProvider('test-basic', {
      username: 'admin',
      password: 'p@ssw0rd!',
    });
  });

  describe('basic properties', () => {
    it('should use BasicAuth protocol', () => {
      expect(provider.protocol).toBe(AuthProtocol.BasicAuth);
      expect(provider.name).toBe('test-basic');
    });

    it('should report isConfigured when username is present', () => {
      expect(provider.isConfigured).toBe(true);
    });

    it('should report not configured when username is empty', () => {
      const bad = new BasicAuthProvider('bad', { username: '', password: 'pass' });
      expect(bad.isConfigured).toBe(false);
      bad.dispose();
    });
  });

  describe('authenticate', () => {
    it('should return success with base64-encoded credentials', async () => {
      const result = await provider.authenticate();
      expect(result.success).toBe(true);
      expect(result.tokens).toHaveLength(1);
      expect(result.tokens[0]!.type).toBe(CredentialType.BasicCreds);

      // Verify base64 encoding.
      const decoded = atob(result.tokens[0]!.value);
      expect(decoded).toBe('admin:p@ssw0rd!');

      expect(result.identity).toBeDefined();
      expect(result.identity!.id).toBe('admin');
    });

    it('should throw when not configured', async () => {
      const bad = new BasicAuthProvider('bad', { username: '', password: '' });
      await expect(bad.authenticate()).rejects.toThrow();
      bad.dispose();
    });
  });

  describe('handleCallback', () => {
    it('should return an error', async () => {
      const result = await provider.handleCallback('https://example.com');
      expect(result.success).toBe(false);
      expect(result.error).toContain('does not use callbacks');
    });
  });

  describe('refresh', () => {
    it('should return new base64-encoded credentials', async () => {
      const token = await provider.refresh('anything');
      expect(token.type).toBe(CredentialType.BasicCreds);
      const decoded = atob(token.value);
      expect(decoded).toBe('admin:p@ssw0rd!');
    });
  });

  describe('validateToken', () => {
    it('should always validate (Basic auth does not expire)', () => {
      const result = provider.validateToken({
        value: btoa('admin:pass'),
        type: CredentialType.BasicCreds,
        expiresAt: null,
        issuedAt: Date.now(),
        scopes: [],
      });
      expect(result.valid).toBe(true);
    });
  });

  describe('revokeToken', () => {
    it('should return false', async () => {
      expect(await provider.revokeToken('any')).toBe(false);
    });
  });

  describe('buildAuthHeader', () => {
    it('should build the correct Basic auth header', () => {
      const header = provider.buildAuthHeader();
      expect(header).toEqual({
        Authorization: `Basic ${btoa('admin:p@ssw0rd!')}`,
      });
    });
  });

  describe('getIdentity / getTokens', () => {
    it('should be null/empty before auth', () => {
      expect(provider.getIdentity()).toBeNull();
      expect(provider.getTokens()).toHaveLength(0);
    });

    it('should be populated after auth', async () => {
      await provider.authenticate();
      expect(provider.getIdentity()).not.toBeNull();
      expect(provider.getIdentity()!.id).toBe('admin');
      expect(provider.getTokens()).toHaveLength(1);
    });
  });

  describe('dispose', () => {
    it('should clear state', async () => {
      await provider.authenticate();
      provider.dispose();
      expect(provider.getIdentity()).toBeNull();
      expect(provider.getTokens()).toHaveLength(0);
    });
  });
});
