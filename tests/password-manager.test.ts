import { describe, it, expect, vi, beforeEach } from 'vitest';
import { InMemoryPasswordStore, extractHostname, matchesHostname } from '../src/browser/storage/password-store';
import { PasswordManager, PasswordManagerEventBus, checkPasswordStrength, generatePassword } from '../src/browser/security/password-manager';

describe('InMemoryPasswordStore', () => {
  let store: InMemoryPasswordStore;

  beforeEach(() => {
    store = new InMemoryPasswordStore();
  });

  it('should not be initialized before init()', () => {
    expect(store.isInitialized()).toBe(false);
  });

  it('should initialize with master password', async () => {
    await store.init('master123');
    expect(store.isInitialized()).toBe(true);
  });

  it('should throw on empty master password', async () => {
    await expect(store.init('')).rejects.toThrow('Master password is required');
  });

  it('should have zero count initially', () => {
    expect(store.count()).toBe(0);
  });

  it('should add a password entry', async () => {
    await store.init('master');
    const entry = await store.add({
      id: 'pw-1',
      url: 'https://example.com/login',
      username: 'user@example.com',
      password: 'secret123',
      hostname: 'example.com',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      lastUsedAt: 0,
      useCount: 0,
      note: '',
      tags: [],
    });
    expect(entry.id).toBe('pw-1');
    expect(entry.hostname).toBe('example.com');
    expect(entry.username).toBe('user@example.com');
    expect(entry.encryptedPayload.data).not.toBe('secret123');
    expect(store.count()).toBe(1);
  });

  it('should encrypt password (not stored as plaintext)', async () => {
    await store.init('master');
    const entry = await store.add({
      id: 'pw-1',
      url: 'https://example.com',
      username: 'user',
      password: 'mysecret',
      hostname: 'example.com',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      lastUsedAt: 0,
      useCount: 0,
      note: '',
      tags: [],
    });
    expect(entry.encryptedPayload.data).not.toBe('mysecret');
    expect(entry.encryptedPayload.data.length).toBeGreaterThan(0);
    expect(entry.encryptedPayload.iv.length).toBeGreaterThan(0);
    expect(entry.encryptedPayload.salt.length).toBeGreaterThan(0);
  });

  it('should retrieve entry by id', async () => {
    await store.init('master');
    await store.add({
      id: 'pw-1', url: 'https://example.com', username: 'user', password: 'pass',
      hostname: 'example.com', createdAt: 0, updatedAt: 0, lastUsedAt: 0, useCount: 0,
      note: '', tags: [],
    });
    const found = await store.get('pw-1');
    expect(found).not.toBeNull();
    expect(found!.id).toBe('pw-1');
  });

  it('should return null for nonexistent id', async () => {
    const found = await store.get('nonexistent');
    expect(found).toBeNull();
  });

  it('should retrieve entries by hostname', async () => {
    await store.init('master');
    await store.add({
      id: 'pw-1', url: 'https://example.com', username: 'u1', password: 'p1',
      hostname: 'example.com', createdAt: 0, updatedAt: 0, lastUsedAt: 0, useCount: 0,
      note: '', tags: [],
    });
    await store.add({
      id: 'pw-2', url: 'https://sub.example.com', username: 'u2', password: 'p2',
      hostname: 'sub.example.com', createdAt: 0, updatedAt: 0, lastUsedAt: 0, useCount: 0,
      note: '', tags: [],
    });
    await store.add({
      id: 'pw-3', url: 'https://other.com', username: 'u3', password: 'p3',
      hostname: 'other.com', createdAt: 0, updatedAt: 0, lastUsedAt: 0, useCount: 0,
      note: '', tags: [],
    });

    const results = await store.getByHostname('example.com');
    expect(results.length).toBe(2);
  });

  it('should get all entries', async () => {
    await store.init('master');
    await store.add({
      id: 'pw-1', url: 'https://a.com', username: 'u', password: 'p',
      hostname: 'a.com', createdAt: 0, updatedAt: 0, lastUsedAt: 0, useCount: 0,
      note: '', tags: [],
    });
    await store.add({
      id: 'pw-2', url: 'https://b.com', username: 'u', password: 'p',
      hostname: 'b.com', createdAt: 0, updatedAt: 0, lastUsedAt: 0, useCount: 0,
      note: '', tags: [],
    });
    const all = await store.getAll();
    expect(all.length).toBe(2);
  });

  it('should update entry', async () => {
    await store.init('master');
    await store.add({
      id: 'pw-1', url: 'https://example.com', username: 'old', password: 'oldpass',
      hostname: 'example.com', createdAt: 0, updatedAt: 0, lastUsedAt: 0, useCount: 0,
      note: '', tags: [],
    });
    const updated = await store.update('pw-1', { username: 'new', password: 'newpass' });
    expect(updated).not.toBeNull();
    expect(updated!.username).toBe('new');
  });

  it('should return null when updating nonexistent entry', async () => {
    const result = await store.update('nonexistent', { username: 'x' });
    expect(result).toBeNull();
  });

  it('should remove entry', async () => {
    await store.init('master');
    await store.add({
      id: 'pw-1', url: 'https://example.com', username: 'u', password: 'p',
      hostname: 'example.com', createdAt: 0, updatedAt: 0, lastUsedAt: 0, useCount: 0,
      note: '', tags: [],
    });
    expect(await store.remove('pw-1')).toBe(true);
    expect(store.count()).toBe(0);
    expect(await store.get('pw-1')).toBeNull();
  });

  it('should return false when removing nonexistent entry', async () => {
    expect(await store.remove('nonexistent')).toBe(false);
  });

  it('should remove all entries for a hostname', async () => {
    await store.init('master');
    await store.add({
      id: 'pw-1', url: 'https://example.com', username: 'u1', password: 'p1',
      hostname: 'example.com', createdAt: 0, updatedAt: 0, lastUsedAt: 0, useCount: 0,
      note: '', tags: [],
    });
    await store.add({
      id: 'pw-2', url: 'https://example.com', username: 'u2', password: 'p2',
      hostname: 'example.com', createdAt: 0, updatedAt: 0, lastUsedAt: 0, useCount: 0,
      note: '', tags: [],
    });
    await store.add({
      id: 'pw-3', url: 'https://other.com', username: 'u3', password: 'p3',
      hostname: 'other.com', createdAt: 0, updatedAt: 0, lastUsedAt: 0, useCount: 0,
      note: '', tags: [],
    });
    const removed = await store.removeByHostname('example.com');
    expect(removed).toBe(2);
    expect(store.count()).toBe(1);
  });

  it('should dispose cleanly', async () => {
    await store.init('master');
    await store.add({
      id: 'pw-1', url: 'https://example.com', username: 'u', password: 'p',
      hostname: 'example.com', createdAt: 0, updatedAt: 0, lastUsedAt: 0, useCount: 0,
      note: '', tags: [],
    });
    store.dispose();
    expect(store.isInitialized()).toBe(false);
    expect(store.count()).toBe(0);
  });

  it('should export and import raw entries', async () => {
    await store.init('master');
    await store.add({
      id: 'pw-1', url: 'https://example.com', username: 'u', password: 'p',
      hostname: 'example.com', createdAt: 100, updatedAt: 100, lastUsedAt: 0, useCount: 0,
      note: 'test', tags: ['tag1'],
    });
    const exported = await store.exportRaw();
    expect(exported.length).toBe(1);

    const store2 = new InMemoryPasswordStore();
    await store2.init('master');
    const imported = await store2.importRaw(exported);
    expect(imported).toBe(1);
    expect(store2.count()).toBe(1);
  });

  it('should throw when adding before init', async () => {
    await expect(store.add({
      id: 'pw-1', url: 'https://example.com', username: 'u', password: 'p',
      hostname: 'example.com', createdAt: 0, updatedAt: 0, lastUsedAt: 0, useCount: 0,
      note: '', tags: [],
    })).rejects.toThrow('Store not initialized');
  });
});

describe('hostname matching', () => {
  it('extractHostname should extract from full URL', () => {
    expect(extractHostname('https://example.com/path')).toBe('example.com');
  });

  it('extractHostname should handle bare hostnames', () => {
    expect(extractHostname('example.com')).toBe('example.com');
  });

  it('extractHostname should lowercase', () => {
    expect(extractHostname('https://Example.COM')).toBe('example.com');
  });

  it('matchesHostname should match exact', () => {
    expect(matchesHostname('example.com', 'example.com')).toBe(true);
  });

  it('matchesHostname should match subdomain', () => {
    expect(matchesHostname('example.com', 'sub.example.com')).toBe(true);
  });

  it('matchesHostname should not match different domain', () => {
    expect(matchesHostname('example.com', 'other.com')).toBe(false);
  });

  it('matchesHostname should be case insensitive', () => {
    expect(matchesHostname('Example.COM', 'sub.example.com')).toBe(true);
  });
});

describe('PasswordManager', () => {
  let manager: PasswordManager;

  beforeEach(() => {
    manager = new PasswordManager();
  });

  it('should not be initialized initially', () => {
    expect(manager.isInitialized()).toBe(false);
  });

  it('should initialize with master password', async () => {
    await manager.init('master123');
    expect(manager.isInitialized()).toBe(true);
  });

  it('should add a credential', async () => {
    await manager.init('master');
    const entry = await manager.addCredential('https://example.com', 'user@example.com', 'password123');
    expect(entry.username).toBe('user@example.com');
    expect(entry.hostname).toBe('example.com');
    expect(manager.getCredentialCount()).toBe(1);
  });

  it('should throw on empty URL', async () => {
    await manager.init('master');
    await expect(manager.addCredential('', 'user', 'password123')).rejects.toThrow('URL is required');
  });

  it('should throw on empty username', async () => {
    await manager.init('master');
    await expect(manager.addCredential('https://example.com', '', 'password123')).rejects.toThrow('Username is required');
  });

  it('should throw on empty password', async () => {
    await manager.init('master');
    await expect(manager.addCredential('https://example.com', 'user', '')).rejects.toThrow('Password is required');
  });

  it('should throw on short password', async () => {
    await manager.init('master');
    await expect(manager.addCredential('https://example.com', 'user', 'short')).rejects.toThrow('at least 8 characters');
  });

  it('should emit passwordStored event', async () => {
    await manager.init('master');
    const handler = vi.fn();
    manager.on('passwordStored', handler);
    await manager.addCredential('https://example.com', 'user', 'password123');
    expect(handler).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'passwordStored', entry: expect.objectContaining({ username: 'user' }) })
    );
  });

  it('should match credentials for a site', async () => {
    await manager.init('master');
    await manager.addCredential('https://example.com', 'user1', 'password123');
    await manager.addCredential('https://example.com', 'user2', 'password456');
    await manager.addCredential('https://other.com', 'user3', 'password789');

    const matches = await manager.matchCredentials('https://example.com');
    expect(matches.length).toBe(2);
  });

  it('should emit passwordMatched event when matches found', async () => {
    await manager.init('master');
    await manager.addCredential('https://example.com', 'user', 'password123');
    const handler = vi.fn();
    manager.on('passwordMatched', handler);
    await manager.matchCredentials('https://example.com');
    expect(handler).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'passwordMatched', hostname: 'example.com', matches: 1 })
    );
  });

  it('should not emit passwordMatched when no matches', async () => {
    await manager.init('master');
    const handler = vi.fn();
    manager.on('passwordMatched', handler);
    await manager.matchCredentials('https://nomatch.com');
    expect(handler).not.toHaveBeenCalled();
  });

  it('should get credentials for site', async () => {
    await manager.init('master');
    await manager.addCredential('https://example.com', 'user1', 'password123');
    await manager.addCredential('https://example.com', 'user2', 'password456');
    await manager.addCredential('https://other.com', 'user3', 'password789');

    const results = await manager.getCredentialsForSite('https://example.com');
    expect(results.length).toBe(2);
  });

  it('should update credential', async () => {
    await manager.init('master');
    const entry = await manager.addCredential('https://example.com', 'old', 'password123');
    const updated = await manager.updateCredential(entry.id, { username: 'new', password: 'newpass123' });
    expect(updated).not.toBeNull();
    expect(updated!.username).toBe('new');
  });

  it('should emit passwordUpdated event', async () => {
    await manager.init('master');
    const entry = await manager.addCredential('https://example.com', 'user', 'password123');
    const handler = vi.fn();
    manager.on('passwordUpdated', handler);
    await manager.updateCredential(entry.id, { username: 'new' });
    expect(handler).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'passwordUpdated' })
    );
  });

  it('should delete credential', async () => {
    await manager.init('master');
    const entry = await manager.addCredential('https://example.com', 'user', 'password123');
    expect(await manager.deleteCredential(entry.id)).toBe(true);
    expect(manager.getCredentialCount()).toBe(0);
  });

  it('should emit passwordDeleted event', async () => {
    await manager.init('master');
    const entry = await manager.addCredential('https://example.com', 'user', 'password123');
    const handler = vi.fn();
    manager.on('passwordDeleted', handler);
    await manager.deleteCredential(entry.id);
    expect(handler).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'passwordDeleted', hostname: 'example.com' })
    );
  });

  it('should delete all credentials for a site', async () => {
    await manager.init('master');
    await manager.addCredential('https://example.com', 'u1', 'password123');
    await manager.addCredential('https://example.com', 'u2', 'password456');
    await manager.addCredential('https://other.com', 'u3', 'password789');

    const removed = await manager.deleteAllForSite('https://example.com');
    expect(removed).toBe(2);
    expect(manager.getCredentialCount()).toBe(1);
  });

  it('should handle subdomain matching', async () => {
    await manager.init('master');
    await manager.addCredential('https://example.com', 'user', 'password123');
    const matches = await manager.matchCredentials('https://sub.example.com');
    expect(matches.length).toBe(1);
  });

  it('should handle www/non-www matching', async () => {
    await manager.init('master');
    await manager.addCredential('https://www.example.com', 'user', 'password123');
    const matches = await manager.matchCredentials('https://example.com');
    expect(matches.length).toBe(1);
  });

  it('should deduplicate by URL and username on add', async () => {
    await manager.init('master');
    await manager.addCredential('https://example.com', 'user', 'password123');
    const second = await manager.addCredential('https://example.com', 'user', 'newpassword456');
    expect(manager.getCredentialCount()).toBe(1);
    expect(second.username).toBe('user');
  });

  it('should decrypt password after storing', async () => {
    await manager.init('master');
    const entry = await manager.addCredential('https://example.com', 'user', 'mypassword123');
    const decrypted = await manager.decryptPassword(entry.encryptedPayload);
    expect(decrypted).toBe('mypassword123');
  });

  it('should check password strength', () => {
    expect(checkPasswordStrength('password').label).toBe('very-weak');
    expect(checkPasswordStrength('Password123!').label).toBe('fair');
    expect(checkPasswordStrength('a').label).toBe('very-weak');
    expect(checkPasswordStrength('abcdefghij').label).toBe('very-weak');
  });

  it('should generate passwords', () => {
    const pwd = generatePassword(20);
    expect(pwd.length).toBe(20);
    expect(pwd).not.toBe(generatePassword(20));
  });

  it('should generate password with custom options', () => {
    const pwd = generatePassword(16, { symbols: false, uppercase: false });
    expect(pwd).not.toMatch(/[A-Z]/);
    expect(pwd).not.toMatch(/[!@#$%^&*()_+\-=[\]{}|;:,.<>?]/);
  });

  it('should get all credentials', async () => {
    await manager.init('master');
    await manager.addCredential('https://a.com', 'u1', 'password123');
    await manager.addCredential('https://b.com', 'u2', 'password456');
    const all = await manager.getAllCredentials();
    expect(all.length).toBe(2);
  });

  it('should return null for nonexistent credential', async () => {
    await manager.init('master');
    const result = await manager.getCredential('nonexistent');
    expect(result).toBeNull();
  });

  it('should off handler', async () => {
    await manager.init('master');
    const handler = vi.fn();
    manager.on('passwordStored', handler);
    manager.off('passwordStored', handler);
    await manager.addCredential('https://example.com', 'user', 'password123');
    expect(handler).not.toHaveBeenCalled();
  });

  it('should dispose cleanly', async () => {
    await manager.init('master');
    await manager.addCredential('https://example.com', 'user', 'password123');
    manager.dispose();
    expect(manager.isInitialized()).toBe(false);
    expect(manager.getCredentialCount()).toBe(0);
  });

  it('should throw when adding before init', async () => {
    await expect(manager.addCredential('https://example.com', 'user', 'password123')).rejects.toThrow('Manager not initialized');
  });
});

describe('PasswordManagerEventBus', () => {
  it('should emit events to registered handlers', () => {
    const bus = new PasswordManagerEventBus();
    const handler = vi.fn();
    bus.on('passwordStored', handler);
    bus.emit({ kind: 'passwordStored', entry: {} as any });
    expect(handler).toHaveBeenCalledTimes(1);
    bus.dispose();
  });

  it('off should remove a handler', () => {
    const bus = new PasswordManagerEventBus();
    const handler = vi.fn();
    bus.on('passwordDeleted', handler);
    bus.off('passwordDeleted', handler);
    bus.emit({ kind: 'passwordDeleted', id: '1', hostname: 'example.com' });
    expect(handler).not.toHaveBeenCalled();
    bus.dispose();
  });

  it('dispose should clear all channels', () => {
    const bus = new PasswordManagerEventBus();
    const handler = vi.fn();
    bus.on('passwordMatched', handler);
    bus.dispose();
    bus.emit({ kind: 'passwordMatched', hostname: 'x', matches: 1 });
    expect(handler).not.toHaveBeenCalled();
  });

  it('should respect rate limit', () => {
    const bus = new PasswordManagerEventBus();
    const handler = vi.fn();
    bus.on('passwordStored', handler);
    for (let i = 0; i < 110; i++) {
      bus.emit({ kind: 'passwordStored', entry: {} as any });
    }
    expect(handler).toHaveBeenCalledTimes(100);
    bus.dispose();
  });

  it('should catch handler exceptions', () => {
    const bus = new PasswordManagerEventBus();
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    bus.on('passwordStored', () => { throw new Error('crash'); });
    const handler = vi.fn();
    bus.on('passwordStored', handler);
    bus.emit({ kind: 'passwordStored', entry: {} as any });
    expect(handler).toHaveBeenCalledTimes(1);
    expect(consoleSpy).toHaveBeenCalled();
    consoleSpy.mockRestore();
    bus.dispose();
  });
});

describe('checkPasswordStrength', () => {
  it('should rate "password" as very-weak', () => {
    expect(checkPasswordStrength('password').label).toBe('very-weak');
  });

  it('should rate "abc" as very-weak', () => {
    expect(checkPasswordStrength('abc').label).toBe('very-weak');
  });

  it('should rate "12345678" as very-weak', () => {
    expect(checkPasswordStrength('12345678').label).toBe('very-weak');
  });

  it('should rate "Abcdef1!" as fair or better', () => {
    const result = checkPasswordStrength('Abcdef1!');
    expect(['fair', 'strong', 'very-strong']).toContain(result.label);
  });

  it('should rate "C0mpl3x!P@ssw0rd" as strong or very-strong', () => {
    const result = checkPasswordStrength('C0mpl3x!P@ssw0rd');
    expect(['strong', 'very-strong']).toContain(result.label);
  });

  it('should give feedback for weaknesses', () => {
    const result = checkPasswordStrength('alllowercase');
    expect(result.feedback.length).toBeGreaterThan(0);
  });

  it('should penalize repeated characters', () => {
    const result = checkPasswordStrength('aaaa1111');
    expect(result.feedback).toContain('Avoid repeated characters');
  });

  it('should penalize numeric-only', () => {
    const result = checkPasswordStrength('12345678');
    expect(result.feedback).toContain('Avoid numeric-only passwords');
  });
});

describe('generatePassword', () => {
  it('should generate password of requested length', () => {
    expect(generatePassword(32).length).toBe(32);
  });

  it('should generate different passwords each time', () => {
    const p1 = generatePassword(20);
    const p2 = generatePassword(20);
    expect(p1).not.toBe(p2);
  });

  it('should respect lowercase-only option', () => {
    const pwd = generatePassword(50, { uppercase: false, numbers: false, symbols: false });
    expect(pwd).toMatch(/^[a-z]+$/);
  });

  it('should respect numbers-only option', () => {
    const pwd = generatePassword(50, { uppercase: false, lowercase: false, symbols: false });
    expect(pwd).toMatch(/^[0-9]+$/);
  });
});
