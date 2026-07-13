import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { AuthManager } from '../src/browser/auth/auth-manager';
import { InMemoryTokenStore } from '../src/browser/auth/token-store';
import type { TokenStoreConfig } from '../src/browser/auth/token-store';
import { ApiKeyProvider } from '../src/browser/auth/api-key-provider';
import {
  AuthProtocol,
  AuthSessionState,
  CredentialType,
} from '../src/browser/auth/auth-provider';
import type { AuthToken } from '../src/browser/auth/auth-provider';

const STORE_CONFIG: TokenStoreConfig = {
  maxTokensPerProvider: 0,
  autoCleanupExpired: false,
  masterKey: 'test-master-key',
};

function makeAccessToken(overrides: Partial<AuthToken> = {}): AuthToken {
  return {
    value: 'access_tok_123',
    type: CredentialType.AccessToken,
    expiresAt: Date.now() + 3600_000,
    issuedAt: Date.now(),
    scopes: ['openid'],
    ...overrides,
  };
}


describe('AuthManager', () => {
  let store: InMemoryTokenStore;
  let manager: AuthManager;
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    store = new InMemoryTokenStore(STORE_CONFIG);
    await store.init();
    manager = new AuthManager(store);
    fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    manager.dispose();
  });

  describe('provider management', () => {
    it('should register and retrieve a provider', () => {
      const provider = new ApiKeyProvider('api', { apiKey: 'key123' });
      manager.registerProvider('api', provider);

      expect(manager.getProvider('api')).toBe(provider);
      expect(manager.getProviderNames()).toContain('api');
      provider.dispose();
    });

    it('should return null for unknown provider', () => {
      expect(manager.getProvider('unknown')).toBeNull();
    });

    it('should remove a provider', () => {
      const provider = new ApiKeyProvider('api', { apiKey: 'key123' });
      manager.registerProvider('api', provider);
      expect(manager.removeProvider('api')).toBe(true);
      expect(manager.getProvider('api')).toBeNull();
      provider.dispose();
    });

    it('should return false when removing non-existent provider', () => {
      expect(manager.removeProvider('nonexistent')).toBe(false);
    });

    it('should emit providerRegistered event', () => {
      const handler = vi.fn();
      manager.on('providerRegistered', handler);

      const provider = new ApiKeyProvider('api', { apiKey: 'key' });
      manager.registerProvider('api', provider);

      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          kind: 'providerRegistered',
          name: 'api',
          protocol: AuthProtocol.ApiKey,
        }),
      );
      provider.dispose();
    });

    it('should emit providerRemoved event', () => {
      const provider = new ApiKeyProvider('api', { apiKey: 'key' });
      manager.registerProvider('api', provider);

      const handler = vi.fn();
      manager.on('providerRemoved', handler);
      manager.removeProvider('api');

      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          kind: 'providerRemoved',
          name: 'api',
        }),
      );
    });
  });

  describe('signIn', () => {
    it('should throw when provider is not registered', async () => {
      await expect(manager.signIn('nonexistent')).rejects.toThrow('not registered');
    });

    it('should sign in with a direct-auth provider (ApiKey)', async () => {
      const provider = new ApiKeyProvider('api', { apiKey: 'key123' });
      manager.registerProvider('api', provider);

      const result = await manager.signIn('api');
      expect(result.success).toBe(true);
      expect(result.identity).toBeDefined();
      expect(result.identity!.id).toBe('api-key-user');
    });

    it('should create a session on successful sign-in', async () => {
      const provider = new ApiKeyProvider('api', { apiKey: 'key123' });
      manager.registerProvider('api', provider);

      await manager.signIn('api');
      expect(manager.isAuthenticated).toBe(true);
      expect(manager.currentSession).not.toBeNull();
    });

    it('should store tokens in the token store', async () => {
      const provider = new ApiKeyProvider('api', { apiKey: 'key123' });
      manager.registerProvider('api', provider);

      await manager.signIn('api');
      const stored = store.getByProvider(AuthProtocol.ApiKey);
      expect(stored.length).toBeGreaterThan(0);
    });

    it('should emit signIn event', async () => {
      const provider = new ApiKeyProvider('api', { apiKey: 'key123' });
      manager.registerProvider('api', provider);

      const handler = vi.fn();
      manager.on('signIn', handler);
      await manager.signIn('api');

      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          kind: 'signIn',
          protocol: AuthProtocol.ApiKey,
        }),
      );
    });
  });

  describe('signIn with redirect-based provider', () => {
    it('should return a REDIRECT result for providers that return a URL', async () => {
      // Create a mock provider that returns a redirect URL.
      const mockProvider = {
        protocol: AuthProtocol.OAuth2,
        name: 'mock-oauth',
        isConfigured: true,
        authenticate: () => 'https://auth.example.com/authorize?client_id=abc',
        handleCallback: async () => ({
          success: false,
          identity: null,
          tokens: [],
          protocol: AuthProtocol.OAuth2,
        }),
        refresh: async () => { throw new Error('no refresh'); },
        validateToken: () => ({ valid: true, expired: false }),
        revokeToken: async () => true,
        getIdentity: () => null,
        getTokens: () => [],
        dispose: () => {},
      };

      manager.registerProvider('oauth', mockProvider);
      const result = await manager.signIn('oauth');

      expect(result.success).toBe(false);
      expect(result.error).toContain('REDIRECT:');
      expect(result.error).toContain('https://auth.example.com/authorize');
    });
  });

  describe('handleCallback', () => {
    it('should throw when provider is not registered', async () => {
      await expect(
        manager.handleCallback('nonexistent', 'https://example.com/callback'),
      ).rejects.toThrow('not registered');
    });
  });

  describe('signOut', () => {
    it('should sign out and clear session', async () => {
      const provider = new ApiKeyProvider('api', { apiKey: 'key123' });
      manager.registerProvider('api', provider);
      await manager.signIn('api');

      expect(manager.isAuthenticated).toBe(true);
      manager.signOut();
      expect(manager.isAuthenticated).toBe(false);
      expect(manager.currentSession).toBeNull();
      expect(manager.currentIdentity).toBeNull();
    });

    it('should emit signOut event', async () => {
      const provider = new ApiKeyProvider('api', { apiKey: 'key123' });
      manager.registerProvider('api', provider);
      await manager.signIn('api');

      const handler = vi.fn();
      manager.on('signOut', handler);
      manager.signOut();

      expect(handler).toHaveBeenCalled();
    });

    it('should do nothing when no session exists', () => {
      expect(() => manager.signOut()).not.toThrow();
    });
  });

  describe('getAccessToken', () => {
    it('should return null for unknown provider', async () => {
      const token = await manager.getAccessToken('nonexistent');
      expect(token).toBeNull();
    });

    it('should return a valid token from the session', async () => {
      const provider = new ApiKeyProvider('api', { apiKey: 'key123' });
      manager.registerProvider('api', provider);
      await manager.signIn('api');

      const token = await manager.getAccessToken('api');
      expect(token).not.toBeNull();
      expect(token!.value).toBe('key123');
    });
  });

  describe('validateToken', () => {
    it('should return invalid for unknown provider', () => {
      const result = manager.validateToken('unknown', makeAccessToken());
      expect(result.valid).toBe(false);
      expect(result.reason).toContain('not found');
    });

    it('should delegate to the provider for known provider', () => {
      const provider = new ApiKeyProvider('api', { apiKey: 'key' });
      manager.registerProvider('api', provider);

      const result = manager.validateToken('api', makeAccessToken());
      expect(result.valid).toBe(true);
      provider.dispose();
    });
  });

  describe('getSessionSnapshot', () => {
    it('should return null when no session', () => {
      expect(manager.getSessionSnapshot()).toBeNull();
    });

    it('should return snapshot of active session', async () => {
      const provider = new ApiKeyProvider('api', { apiKey: 'key' });
      manager.registerProvider('api', provider);
      await manager.signIn('api');

      const snap = manager.getSessionSnapshot();
      expect(snap).not.toBeNull();
      expect(snap!.state).toBe(AuthSessionState.Authenticated);
    });
  });

  describe('currentIdentity', () => {
    it('should be null when not authenticated', () => {
      expect(manager.currentIdentity).toBeNull();
    });

    it('should be set after sign-in', async () => {
      const provider = new ApiKeyProvider('api', { apiKey: 'key' });
      manager.registerProvider('api', provider);
      await manager.signIn('api');
      expect(manager.currentIdentity).not.toBeNull();
    });
  });

  describe('isAuthenticated', () => {
    it('should be false initially', () => {
      expect(manager.isAuthenticated).toBe(false);
    });

    it('should be true after sign-in', async () => {
      const provider = new ApiKeyProvider('api', { apiKey: 'key' });
      manager.registerProvider('api', provider);
      await manager.signIn('api');
      expect(manager.isAuthenticated).toBe(true);
    });

    it('should be false after sign-out', async () => {
      const provider = new ApiKeyProvider('api', { apiKey: 'key' });
      manager.registerProvider('api', provider);
      await manager.signIn('api');
      manager.signOut();
      expect(manager.isAuthenticated).toBe(false);
    });
  });

  describe('dispose', () => {
    it('should clear all state', async () => {
      const provider = new ApiKeyProvider('api', { apiKey: 'key' });
      manager.registerProvider('api', provider);
      await manager.signIn('api');

      manager.dispose();
      expect(manager.currentSession).toBeNull();
      expect(manager.getProviderNames()).toHaveLength(0);
    });
  });

  describe('sessionStateChanged events', () => {
    it('should emit sessionStateChanged when session expires', async () => {
      const provider = new ApiKeyProvider('api', { apiKey: 'key' });
      manager.registerProvider('api', provider);
      await manager.signIn('api');

      const handler = vi.fn();
      manager.on('sessionStateChanged', handler);

      manager.currentSession!.expire();
      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          kind: 'sessionStateChanged',
          state: AuthSessionState.Expired,
        }),
      );
    });
  });
});
