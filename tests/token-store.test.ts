import { describe, it, expect, beforeEach } from 'vitest';
import { InMemoryTokenStore, encryptData, decryptData } from '../src/browser/auth/token-store';
import { AuthProtocol, CredentialType } from '../src/browser/auth/auth-provider';
import type { AuthToken } from '../src/browser/auth/auth-provider';
import type { TokenStoreConfig } from '../src/browser/auth/token-store';

const DEFAULT_CONFIG: TokenStoreConfig = {
  maxTokensPerProvider: 0,
  autoCleanupExpired: false,
  masterKey: 'test-master-key-123',
};

function makeToken(overrides: Partial<AuthToken> = {}): AuthToken {
  return {
    value: 'tok_abc123',
    type: CredentialType.AccessToken,
    expiresAt: Date.now() + 3600_000,
    issuedAt: Date.now(),
    scopes: ['openid', 'profile'],
    ...overrides,
  };
}

describe('InMemoryTokenStore', () => {
  let store: InMemoryTokenStore;

  beforeEach(async () => {
    store = new InMemoryTokenStore(DEFAULT_CONFIG);
    await store.init();
  });

  describe('add / get', () => {
    it('should add and retrieve a token entry', () => {
      const entry = store.add({
        provider: AuthProtocol.OAuth2,
        userId: 'user1',
        token: makeToken(),
        tags: ['initial'],
      });

      expect(entry.id).toMatch(/^tok-/);
      expect(entry.provider).toBe(AuthProtocol.OAuth2);
      expect(entry.userId).toBe('user1');
      expect(entry.tags).toEqual(['initial']);
      expect(entry.createdAt).toBeGreaterThan(0);
      expect(entry.updatedAt).toBe(entry.createdAt);

      const retrieved = store.get(entry.id);
      expect(retrieved).not.toBeNull();
      expect(retrieved!.id).toBe(entry.id);
    });

    it('should return null for non-existent ID', () => {
      expect(store.get('non-existent')).toBeNull();
    });

    it('should auto-increment IDs', () => {
      const e1 = store.add({ provider: AuthProtocol.OAuth2, userId: 'u', token: makeToken(), tags: [] });
      const e2 = store.add({ provider: AuthProtocol.OAuth2, userId: 'u', token: makeToken(), tags: [] });
      expect(e1.id).not.toBe(e2.id);
    });
  });

  describe('getByProvider', () => {
    it('should return all tokens for a provider', () => {
      store.add({ provider: AuthProtocol.OAuth2, userId: 'u1', token: makeToken(), tags: [] });
      store.add({ provider: AuthProtocol.OAuth2, userId: 'u2', token: makeToken(), tags: [] });
      store.add({ provider: AuthProtocol.SAML2, userId: 'u1', token: makeToken(), tags: [] });

      const oauthTokens = store.getByProvider(AuthProtocol.OAuth2);
      expect(oauthTokens).toHaveLength(2);

      const samlTokens = store.getByProvider(AuthProtocol.SAML2);
      expect(samlTokens).toHaveLength(1);
    });

    it('should return empty array for provider with no tokens', () => {
      expect(store.getByProvider(AuthProtocol.WebAuthn)).toHaveLength(0);
    });
  });

  describe('getByUser', () => {
    it('should return all tokens for a user', () => {
      store.add({ provider: AuthProtocol.OAuth2, userId: 'alice', token: makeToken(), tags: [] });
      store.add({ provider: AuthProtocol.SAML2, userId: 'alice', token: makeToken(), tags: [] });
      store.add({ provider: AuthProtocol.OAuth2, userId: 'bob', token: makeToken(), tags: [] });

      const aliceTokens = store.getByUser('alice');
      expect(aliceTokens).toHaveLength(2);

      const bobTokens = store.getByUser('bob');
      expect(bobTokens).toHaveLength(1);
    });
  });

  describe('findValid', () => {
    it('should find a valid non-expired token', () => {
      store.add({
        provider: AuthProtocol.OAuth2,
        userId: 'alice',
        token: makeToken({ expiresAt: Date.now() + 3600_000 }),
        tags: [],
      });

      const found = store.findValid(AuthProtocol.OAuth2, 'alice');
      expect(found).not.toBeNull();
    });

    it('should not return expired tokens', () => {
      store.add({
        provider: AuthProtocol.OAuth2,
        userId: 'alice',
        token: makeToken({ expiresAt: Date.now() - 1000 }),
        tags: [],
      });

      const found = store.findValid(AuthProtocol.OAuth2, 'alice');
      expect(found).toBeNull();
    });

    it('should match by scopes when provided', () => {
      store.add({
        provider: AuthProtocol.OAuth2,
        userId: 'alice',
        token: makeToken({ scopes: ['openid', 'profile', 'email'] }),
        tags: [],
      });

      expect(store.findValid(AuthProtocol.OAuth2, 'alice', ['openid'])).not.toBeNull();
      expect(store.findValid(AuthProtocol.OAuth2, 'alice', ['openid', 'email'])).not.toBeNull();
      expect(store.findValid(AuthProtocol.OAuth2, 'alice', ['openid', 'admin'])).toBeNull();
    });

    it('should return null when no scopes match', () => {
      store.add({
        provider: AuthProtocol.OAuth2,
        userId: 'alice',
        token: makeToken({ scopes: ['openid'] }),
        tags: [],
      });

      expect(store.findValid(AuthProtocol.OAuth2, 'alice', ['admin'])).toBeNull();
    });
  });

  describe('update', () => {
    it('should update token data', () => {
      const entry = store.add({
        provider: AuthProtocol.OAuth2,
        userId: 'u',
        token: makeToken({ value: 'old-token' }),
        tags: [],
      });

      const newToken = makeToken({ value: 'new-token' });
      const updated = store.update(entry.id, { token: newToken, tags: ['refreshed'] });

      expect(updated).not.toBeNull();
      expect(updated!.token.value).toBe('new-token');
      expect(updated!.tags).toEqual(['refreshed']);
      expect(updated!.updatedAt).toBeGreaterThanOrEqual(entry.updatedAt);
    });

    it('should return null for non-existent ID', () => {
      expect(store.update('nonexistent', { tags: ['x'] })).toBeNull();
    });
  });

  describe('remove', () => {
    it('should remove a token by ID', () => {
      const entry = store.add({
        provider: AuthProtocol.OAuth2,
        userId: 'u',
        token: makeToken(),
        tags: [],
      });

      expect(store.remove(entry.id)).toBe(true);
      expect(store.get(entry.id)).toBeNull();
    });

    it('should return false for non-existent ID', () => {
      expect(store.remove('nonexistent')).toBe(false);
    });
  });

  describe('removeByProvider', () => {
    it('should remove all tokens for a provider', () => {
      store.add({ provider: AuthProtocol.OAuth2, userId: 'u', token: makeToken(), tags: [] });
      store.add({ provider: AuthProtocol.OAuth2, userId: 'u', token: makeToken(), tags: [] });
      store.add({ provider: AuthProtocol.SAML2, userId: 'u', token: makeToken(), tags: [] });

      const removed = store.removeByProvider(AuthProtocol.OAuth2);
      expect(removed).toBe(2);
      expect(store.getByProvider(AuthProtocol.OAuth2)).toHaveLength(0);
      expect(store.getByProvider(AuthProtocol.SAML2)).toHaveLength(1);
    });
  });

  describe('cleanupExpired', () => {
    it('should remove only expired tokens', () => {
      store.add({
        provider: AuthProtocol.OAuth2,
        userId: 'u',
        token: makeToken({ expiresAt: Date.now() - 1000 }),
        tags: [],
      });
      store.add({
        provider: AuthProtocol.OAuth2,
        userId: 'u',
        token: makeToken({ expiresAt: Date.now() + 3600_000 }),
        tags: [],
      });
      store.add({
        provider: AuthProtocol.OAuth2,
        userId: 'u',
        token: makeToken({ expiresAt: null }),
        tags: [],
      });

      const removed = store.cleanupExpired();
      expect(removed).toBe(1);
      expect(store.count()).toBe(2);
    });
  });

  describe('autoCleanupExpired', () => {
    it('should auto-remove expired tokens on get()', async () => {
      const autoStore = new InMemoryTokenStore({
        ...DEFAULT_CONFIG,
        autoCleanupExpired: true,
      });
      await autoStore.init();

      const entry = autoStore.add({
        provider: AuthProtocol.OAuth2,
        userId: 'u',
        token: makeToken({ expiresAt: Date.now() - 5000 }),
        tags: [],
      });

      const retrieved = autoStore.get(entry.id);
      expect(retrieved).toBeNull();
    });
  });

  describe('maxTokensPerProvider', () => {
    it('should enforce max tokens per provider', async () => {
      const limitedStore = new InMemoryTokenStore({
        ...DEFAULT_CONFIG,
        maxTokensPerProvider: 2,
      });
      await limitedStore.init();

      limitedStore.add({ provider: AuthProtocol.OAuth2, userId: 'u', token: makeToken(), tags: [] });
      limitedStore.add({ provider: AuthProtocol.OAuth2, userId: 'u', token: makeToken(), tags: [] });
      limitedStore.add({ provider: AuthProtocol.OAuth2, userId: 'u', token: makeToken(), tags: [] });

      expect(limitedStore.getByProvider(AuthProtocol.OAuth2)).toHaveLength(2);
    });
  });

  describe('count', () => {
    it('should track total count', () => {
      expect(store.count()).toBe(0);
      store.add({ provider: AuthProtocol.OAuth2, userId: 'u', token: makeToken(), tags: [] });
      expect(store.count()).toBe(1);
      store.add({ provider: AuthProtocol.SAML2, userId: 'u', token: makeToken(), tags: [] });
      expect(store.count()).toBe(2);
    });
  });

  describe('exportEncrypted / importEncrypted', () => {
    it('should round-trip export/import', () => {
      store.add({ provider: AuthProtocol.OAuth2, userId: 'u', token: makeToken(), tags: ['test'] });
      store.add({ provider: AuthProtocol.SAML2, userId: 'v', token: makeToken(), tags: [] });

      const exported = store.exportEncrypted();
      expect(typeof exported).toBe('string');
      expect(exported.length).toBeGreaterThan(0);

      const newStore = new InMemoryTokenStore(DEFAULT_CONFIG);
      const imported = newStore.importEncrypted(exported);
      expect(imported).toBe(2);
      expect(newStore.count()).toBe(2);
    });

    it('should not be readable with wrong master key', () => {
      store.add({ provider: AuthProtocol.OAuth2, userId: 'u', token: makeToken(), tags: [] });
      const exported = store.exportEncrypted();

      const wrongStore = new InMemoryTokenStore({
        ...DEFAULT_CONFIG,
        masterKey: 'wrong-key',
      });

      // Import with wrong key should produce garbled data or throw
      expect(() => wrongStore.importEncrypted(exported)).toThrow();
    });
  });

  describe('dispose', () => {
    it('should clear all entries', () => {
      store.add({ provider: AuthProtocol.OAuth2, userId: 'u', token: makeToken(), tags: [] });
      store.add({ provider: AuthProtocol.SAML2, userId: 'u', token: makeToken(), tags: [] });
      expect(store.count()).toBe(2);

      store.dispose();
      expect(store.count()).toBe(0);
    });
  });
});

describe('encryptData / decryptData', () => {
  it('should round-trip encrypt/decrypt', () => {
    const plaintext = 'Hello, World! This is a secret message.';
    const encrypted = encryptData(plaintext, 'master-key');
    expect(encrypted).not.toBe(plaintext);
    expect(encrypted.length).toBeGreaterThan(0);

    const decrypted = decryptData(encrypted, 'master-key');
    expect(decrypted).toBe(plaintext);
  });

  it('should produce different ciphertext for same plaintext (random salt)', () => {
    const plaintext = 'same message';
    const e1 = encryptData(plaintext, 'key');
    const e2 = encryptData(plaintext, 'key');
    // Extremely unlikely to be the same due to random salt
    expect(e1).not.toBe(e2);
  });

  it('should not decrypt to original content with wrong key', () => {
    const encrypted = encryptData('secret', 'correct-key');
    const decrypted = decryptData(encrypted, 'wrong-key');
    expect(decrypted).not.toBe('secret');
  });

  it('should handle empty string', () => {
    const encrypted = encryptData('', 'key');
    const decrypted = decryptData(encrypted, 'key');
    expect(decrypted).toBe('');
  });

  it('should handle unicode content', () => {
    const plaintext = 'Hello \u00e9\u00e8\u00ea \ud83d\ude00';
    const encrypted = encryptData(plaintext, 'key');
    const decrypted = decryptData(encrypted, 'key');
    expect(decrypted).toBe(plaintext);
  });
});
