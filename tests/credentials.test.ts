import { describe, it, expect, beforeEach, vi } from 'vitest';
import { CredentialStore } from '../src/browser/credentials/credential-store';
import type { CredentialEntry } from '../src/browser/credentials/credential-store';
import { EncryptionService } from '../src/browser/credentials/encryption';
import type { EncryptedData } from '../src/browser/credentials/encryption';
import { AutofillService } from '../src/browser/credentials/autofill';
import type { FormField } from '../src/browser/credentials/autofill';
import { PasskeyManager } from '../src/browser/credentials/passkeys';

/* ============================================================
   1. Credential Store Tests
   ============================================================ */
describe('CredentialStore', () => {
  let store: CredentialStore;

  beforeEach(() => {
    store = new CredentialStore();
  });

  it('starts empty', () => {
    expect(store.size).toBe(0);
    expect(store.getAll()).toEqual([]);
  });

  it('saves a credential entry', () => {
    const entry = store.save({
      url: 'https://example.com',
      username: 'alice',
      password: 'secret123',
      name: 'Example',
    });
    expect(entry.id).toMatch(/^cred-/);
    expect(entry.url).toBe('https://example.com');
    expect(entry.username).toBe('alice');
    expect(entry.password).toBe('secret123');
    expect(entry.createdAt).toBeGreaterThan(0);
    expect(entry.updatedAt).toBeGreaterThan(0);
    expect(entry.lastUsedAt).toBe(0);
    expect(entry.useCount).toBe(0);
    expect(store.size).toBe(1);
  });

  it('get returns entry by id', () => {
    const entry = store.save({ url: 'https://x.com', username: 'u', password: 'p', name: 'x' });
    const found = store.get(entry.id);
    expect(found).not.toBeNull();
    expect(found!.username).toBe('u');
    expect(store.get('nonexistent')).toBeNull();
  });

  it('getByUrl returns matching entries', () => {
    store.save({ url: 'https://example.com', username: 'a', password: 'p1', name: 's1' });
    store.save({ url: 'https://example.com', username: 'b', password: 'p2', name: 's2' });
    store.save({ url: 'https://other.com', username: 'c', password: 'p3', name: 's3' });
    const results = store.getByUrl('https://example.com');
    expect(results).toHaveLength(2);
    expect(results.map(r => r.username)).toEqual(['a', 'b']);
  });

  it('getByUrl matches by hostname', () => {
    store.save({ url: 'https://example.com/login', username: 'a', password: 'p', name: 's' });
    const results = store.getByUrl('https://example.com/other');
    expect(results).toHaveLength(1);
  });

  it('update modifies entry', () => {
    const entry = store.save({ url: 'https://x.com', username: 'old', password: 'oldpw', name: 'x' });
    const updated = store.update(entry.id, { username: 'new', password: 'newpw' });
    expect(updated).not.toBeNull();
    expect(updated!.username).toBe('new');
    expect(updated!.password).toBe('newpw');
    expect(updated!.url).toBe('https://x.com');
    expect(updated!.updatedAt).toBeGreaterThanOrEqual(entry.updatedAt);
  });

  it('update returns null for unknown id', () => {
    expect(store.update('nonexistent', { username: 'x' })).toBeNull();
  });

  it('delete removes entry', () => {
    const entry = store.save({ url: 'https://x.com', username: 'u', password: 'p', name: 'x' });
    expect(store.delete(entry.id)).toBe(true);
    expect(store.get(entry.id)).toBeNull();
    expect(store.size).toBe(0);
  });

  it('delete returns false for unknown id', () => {
    expect(store.delete('nonexistent')).toBe(false);
  });

  it('recordUse updates timestamps and use count', () => {
    const entry = store.save({ url: 'https://x.com', username: 'u', password: 'p', name: 'x' });
    store.recordUse(entry.id);
    const used = store.get(entry.id)!;
    expect(used.lastUsedAt).toBeGreaterThan(0);
    expect(used.useCount).toBe(1);
    store.recordUse(entry.id);
    expect(store.get(entry.id)!.useCount).toBe(2);
  });

  it('clear removes all entries', () => {
    store.save({ url: 'https://a.com', username: 'a', password: 'p', name: 'a' });
    store.save({ url: 'https://b.com', username: 'b', password: 'p', name: 'b' });
    store.clear();
    expect(store.size).toBe(0);
  });

  it('onEvent fires on save', () => {
    const handler = vi.fn();
    store.onEvent(handler);
    const entry = store.save({ url: 'https://x.com', username: 'u', password: 'p', name: 'x' });
    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith({ kind: 'created', entry });
  });

  it('onEvent fires on update', () => {
    const handler = vi.fn();
    store.onEvent(handler);
    const entry = store.save({ url: 'https://x.com', username: 'u', password: 'p', name: 'x' });
    handler.mockClear();
    store.update(entry.id, { username: 'new' });
    expect(handler).toHaveBeenCalledWith(expect.objectContaining({ kind: 'updated' }));
  });

  it('onEvent fires on delete', () => {
    const handler = vi.fn();
    store.onEvent(handler);
    const entry = store.save({ url: 'https://x.com', username: 'u', password: 'p', name: 'x' });
    handler.mockClear();
    store.delete(entry.id);
    expect(handler).toHaveBeenCalledWith(expect.objectContaining({ kind: 'deleted' }));
  });

  it('onEvent unsubscribe removes handler', () => {
    const handler = vi.fn();
    const unsub = store.onEvent(handler);
    unsub();
    store.save({ url: 'https://x.com', username: 'u', password: 'p', name: 'x' });
    expect(handler).not.toHaveBeenCalled();
  });

  it('dispose clears everything', () => {
    store.save({ url: 'https://x.com', username: 'u', password: 'p', name: 'x' });
    store.dispose();
    expect(store.size).toBe(0);
  });
});

/* ============================================================
   2. Encryption Service Tests
   ============================================================ */
describe('EncryptionService', () => {
  let enc: EncryptionService;

  beforeEach(() => {
    enc = new EncryptionService();
  });

  it('isReady returns boolean', () => {
    expect(typeof enc.isReady()).toBe('boolean');
  });

  it('encrypt and decrypt round-trips', async () => {
    const key = await enc.generateKey();
    const cipher = await enc.encrypt('hello world', key);
    expect(cipher.data).toBeTruthy();
    expect(cipher.iv).toBeTruthy();
    expect(cipher.salt).toBeTruthy();
    expect(cipher.algorithm).toBeTruthy();
    const plain = await enc.decrypt(cipher, key);
    expect(plain).toBe('hello world');
  });

  it('encrypt and decrypt with derived key', async () => {
    const key = await enc.deriveKey('mypassword');
    const cipher = await enc.encrypt('secret data', key);
    const plain = await enc.decrypt(cipher, key);
    expect(plain).toBe('secret data');
  });

  it('encrypt without key uses default', async () => {
    const cipher = await enc.encrypt('test');
    const plain = await enc.decrypt(cipher);
    expect(plain).toBe('test');
  });

  it('decrypt with wrong key throws', async () => {
    const key1 = await enc.generateKey();
    const key2 = await enc.generateKey();
    const cipher = await enc.encrypt('secret', key1);
    await expect(enc.decrypt(cipher, key2)).rejects.toThrow();
  });

  it('generateKey returns an EncryptionKey', async () => {
    const key = await enc.generateKey();
    expect(key.type).toBe('aes-gcm');
    expect(key.raw.length).toBeGreaterThan(0);
  });

  it('deriveKey returns pbkdf2 key', async () => {
    const key = await enc.deriveKey('password');
    expect(key.type).toBe('pbkdf2');
    expect(key.raw.length).toBeGreaterThan(0);
  });

  it('deriveKey with salt produces stable key', async () => {
    const salt = 'a1b2c3d4e5f6a7b8';
    const key1 = await enc.deriveKey('password', salt);
    const key2 = await enc.deriveKey('password', salt);
    expect(key1.raw).toBe(key2.raw);
  });

  it('exportKey and importKey round-trip', () => {
    const key: { type: 'aes-gcm'; raw: string } = { type: 'aes-gcm', raw: 'abcdef' };
    const exported = enc.exportKey(key);
    expect(exported).toBe('aes-gcm:abcdef');
    const imported = enc.importKey(exported);
    expect(imported.type).toBe('aes-gcm');
    expect(imported.raw).toBe('abcdef');
  });

  it('importKey with explicit type', () => {
    const key = enc.importKey('deadbeef', 'pbkdf2');
    expect(key.type).toBe('pbkdf2');
    expect(key.raw).toBe('deadbeef');
  });

  it('encrypt with empty string', async () => {
    const key = await enc.generateKey();
    const cipher = await enc.encrypt('', key);
    const plain = await enc.decrypt(cipher, key);
    expect(plain).toBe('');
  });

  it('dispose sets ready to false', () => {
    enc.dispose();
    expect(enc.isReady()).toBe(false);
  });
});

/* ============================================================
   3. Autofill Service Tests
   ============================================================ */
describe('AutofillService', () => {
  let store: CredentialStore;
  let autofill: AutofillService;

  beforeEach(() => {
    store = new CredentialStore();
    autofill = new AutofillService(store);
  });

  it('starts enabled', () => {
    expect(autofill.enabled).toBe(true);
  });

  it('getCredentialsForUrl delegates to store', () => {
    store.save({ url: 'https://example.com', username: 'a', password: 'p', name: 'x' });
    const results = autofill.getCredentialsForUrl('https://example.com');
    expect(results).toHaveLength(1);
  });

  it('getSuggestions returns empty when disabled', () => {
    autofill.enabled = false;
    const suggestions = autofill.getSuggestions('https://x.com', []);
    expect(suggestions).toEqual([]);
  });

  it('getSuggestions returns sorted by confidence', () => {
    store.save({ url: 'https://example.com', username: 'alice', password: 'pw1', name: 'x' });
    store.save({ url: 'https://other.com', username: 'bob', password: 'pw2', name: 'y' });
    const fields: FormField[] = [
      { name: 'username', type: 'text', value: '', id: 'u', className: '', placeholder: '', autocomplete: 'username', disabled: false, readOnly: false },
      { name: 'password', type: 'password', value: '', id: 'p', className: '', placeholder: '', autocomplete: 'current-password', disabled: false, readOnly: false },
    ];
    const suggestions = autofill.getSuggestions('https://example.com', fields);
    expect(suggestions.length).toBeGreaterThanOrEqual(1);
    expect(suggestions[0].credential.username).toBe('alice');
    expect(suggestions[0].confidence).toBeGreaterThan(0);
  });

  it('fillFields maps username and password', () => {
    const cred = store.save({ url: 'https://x.com', username: 'alice', password: 's3cret', name: 'x' });
    const fields: FormField[] = [
      { name: 'username', type: 'text', value: '', id: 'u', className: '', placeholder: '', autocomplete: '', disabled: false, readOnly: false },
      { name: 'password', type: 'password', value: '', id: 'p', className: '', placeholder: '', autocomplete: '', disabled: false, readOnly: false },
    ];
    const filled = autofill.fillFields(fields, cred);
    expect(filled[0].value).toBe('alice');
    expect(filled[1].value).toBe('s3cret');
  });

  it('fillFields records use', () => {
    const cred = store.save({ url: 'https://x.com', username: 'a', password: 'p', name: 'x' });
    const fields: FormField[] = [
      { name: 'username', type: 'text', value: '', id: 'u', className: '', placeholder: '', autocomplete: '', disabled: false, readOnly: false },
      { name: 'password', type: 'password', value: '', id: 'p', className: '', placeholder: '', autocomplete: '', disabled: false, readOnly: false },
    ];
    autofill.fillFields(fields, cred);
    expect(store.get(cred.id)!.useCount).toBe(1);
  });

  it('autoFill returns null when no match', () => {
    const result = autofill.autoFill('https://unknown.com', []);
    expect(result).toBeNull();
  });

  it('autoFill fills best match', () => {
    store.save({ url: 'https://x.com', username: 'alice', password: 's3cret', name: 'x' });
    const fields: FormField[] = [
      { name: 'username', type: 'text', value: '', id: 'u', className: '', placeholder: '', autocomplete: '', disabled: false, readOnly: false },
      { name: 'password', type: 'password', value: '', id: 'p', className: '', placeholder: '', autocomplete: '', disabled: false, readOnly: false },
    ];
    const result = autofill.autoFill('https://x.com', fields);
    expect(result).not.toBeNull();
    expect(result!.credential.username).toBe('alice');
    expect(result!.filled[0].value).toBe('alice');
    expect(result!.filled[1].value).toBe('s3cret');
  });

  it('saveFromForm creates new credential', () => {
    const fields: FormField[] = [
      { name: 'username', type: 'text', value: 'newuser', id: 'u', className: '', placeholder: '', autocomplete: '', disabled: false, readOnly: false },
      { name: 'password', type: 'password', value: 'newpass', id: 'p', className: '', placeholder: '', autocomplete: '', disabled: false, readOnly: false },
    ];
    const saved = autofill.saveFromForm('https://example.com', fields);
    expect(saved).not.toBeNull();
    expect(saved!.username).toBe('newuser');
    expect(saved!.password).toBe('newpass');
  });

  it('saveFromForm updates existing credential', () => {
    store.save({ url: 'https://example.com', username: 'existing', password: 'oldpass', name: 'x' });
    const fields: FormField[] = [
      { name: 'username', type: 'text', value: 'existing', id: 'u', className: '', placeholder: '', autocomplete: '', disabled: false, readOnly: false },
      { name: 'password', type: 'password', value: 'newpass', id: 'p', className: '', placeholder: '', autocomplete: '', disabled: false, readOnly: false },
    ];
    const saved = autofill.saveFromForm('https://example.com', fields);
    expect(saved).not.toBeNull();
    expect(saved!.password).toBe('newpass');
  });

  it('saveFromForm returns null without username/password fields', () => {
    const result = autofill.saveFromForm('https://x.com', []);
    expect(result).toBeNull();
  });

  it('saveFromForm returns null when disabled', () => {
    autofill.enabled = false;
    const fields: FormField[] = [
      { name: 'username', type: 'text', value: 'u', id: 'u', className: '', placeholder: '', autocomplete: '', disabled: false, readOnly: false },
      { name: 'password', type: 'password', value: 'p', id: 'p', className: '', placeholder: '', autocomplete: '', disabled: false, readOnly: false },
    ];
    expect(autofill.saveFromForm('https://x.com', fields)).toBeNull();
  });

  it('onEvent fires on fill', () => {
    const handler = vi.fn();
    autofill.onEvent(handler);
    const cred = store.save({ url: 'https://x.com', username: 'a', password: 'p', name: 'x' });
    const fields: FormField[] = [
      { name: 'username', type: 'text', value: '', id: 'u', className: '', placeholder: '', autocomplete: '', disabled: false, readOnly: false },
      { name: 'password', type: 'password', value: '', id: 'p', className: '', placeholder: '', autocomplete: '', disabled: false, readOnly: false },
    ];
    autofill.fillFields(fields, cred);
    expect(handler).toHaveBeenCalledWith(expect.objectContaining({ kind: 'filled' }));
  });

  it('onEvent fires on save', () => {
    const handler = vi.fn();
    autofill.onEvent(handler);
    const fields: FormField[] = [
      { name: 'username', type: 'text', value: 'u', id: 'u', className: '', placeholder: '', autocomplete: '', disabled: false, readOnly: false },
      { name: 'password', type: 'password', value: 'p', id: 'p', className: '', placeholder: '', autocomplete: '', disabled: false, readOnly: false },
    ];
    autofill.saveFromForm('https://x.com', fields);
    expect(handler).toHaveBeenCalledWith(expect.objectContaining({ kind: 'saved' }));
  });

  it('dispose disables service', () => {
    autofill.dispose();
    expect(autofill.enabled).toBe(false);
  });
});

/* ============================================================
   4. Passkey Manager Tests
   ============================================================ */
describe('PasskeyManager', () => {
  let pk: PasskeyManager;

  beforeEach(() => {
    pk = new PasskeyManager();
  });

  it('starts empty', () => {
    expect(pk.size).toBe(0);
    expect(pk.getAllCredentials()).toEqual([]);
  });

  it('createCredential creates a passkey', async () => {
    const result = await pk.createCredential({
      rp: { id: 'example.com', name: 'Example' },
      user: { id: 'user-1', name: 'alice', displayName: 'Alice' },
    });
    expect(result.credential.id).toMatch(/^pk-/);
    expect(result.credential.rpId).toBe('example.com');
    expect(result.credential.userName).toBe('alice');
    expect(result.credential.publicKey.length).toBeGreaterThan(0);
    expect(result.credential.privateKey.length).toBeGreaterThan(0);
    expect(result.attestationObject).toBeTruthy();
    expect(result.clientDataJSON).toBeTruthy();
    expect(pk.size).toBe(1);
  });

  it('createCredential with custom challenge', async () => {
    const result = await pk.createCredential({
      rp: { id: 'x.com', name: 'X' },
      user: { id: 'u1', name: 'bob', displayName: 'Bob' },
      challenge: 'deadbeefdeadbeefdeadbeefdeadbeef',
    });
    const data = JSON.parse(result.clientDataJSON);
    expect(data.challenge).toBe('deadbeefdeadbeefdeadbeefdeadbeef');
  });

  it('getCredentials returns matching by rpId', async () => {
    await pk.createCredential({
      rp: { id: 'a.com', name: 'A' },
      user: { id: 'u1', name: 'a', displayName: 'A' },
    });
    await pk.createCredential({
      rp: { id: 'b.com', name: 'B' },
      user: { id: 'u2', name: 'b', displayName: 'B' },
    });
    const results = await pk.getCredentials({ rpId: 'a.com' });
    expect(results).toHaveLength(1);
    expect(results[0].rpId).toBe('a.com');
  });

  it('getCredentials filters by allowCredentials', async () => {
    await pk.createCredential({
      rp: { id: 'x.com', name: 'X' },
      user: { id: 'u1', name: 'a', displayName: 'A' },
    });
    const c2 = await pk.createCredential({
      rp: { id: 'x.com', name: 'X' },
      user: { id: 'u2', name: 'b', displayName: 'B' },
    });
    const results = await pk.getCredentials({
      rpId: 'x.com',
      allowCredentials: [c2.credential.credentialId],
    });
    expect(results).toHaveLength(1);
    expect(results[0].userName).toBe('b');
  });

  it('getCredentialsForRp returns credentials for rpId', async () => {
    await pk.createCredential({
      rp: { id: 'a.com', name: 'A' },
      user: { id: 'u1', name: 'a', displayName: 'A' },
    });
    await pk.createCredential({
      rp: { id: 'a.com', name: 'A' },
      user: { id: 'u2', name: 'b', displayName: 'B' },
    });
    expect(pk.getCredentialsForRp('a.com')).toHaveLength(2);
    expect(pk.getCredentialsForRp('other.com')).toHaveLength(0);
  });

  it('getCredentialById returns credential', async () => {
    const c = await pk.createCredential({
      rp: { id: 'x.com', name: 'X' },
      user: { id: 'u1', name: 'a', displayName: 'A' },
    });
    const found = pk.getCredentialById(c.credential.id);
    expect(found).not.toBeNull();
    expect(found!.id).toBe(c.credential.id);
    expect(pk.getCredentialById('nonexistent')).toBeNull();
  });

  it('deleteCredential removes entry', async () => {
    const c = await pk.createCredential({
      rp: { id: 'x.com', name: 'X' },
      user: { id: 'u1', name: 'a', displayName: 'A' },
    });
    expect(pk.deleteCredential(c.credential.id)).toBe(true);
    expect(pk.size).toBe(0);
    expect(pk.deleteCredential('nonexistent')).toBe(false);
  });

  it('onEvent fires on create', async () => {
    const handler = vi.fn();
    pk.onEvent(handler);
    const result = await pk.createCredential({
      rp: { id: 'x.com', name: 'X' },
      user: { id: 'u1', name: 'a', displayName: 'A' },
    });
    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith({ kind: 'created', credential: result.credential });
  });

  it('onEvent fires on delete', async () => {
    const handler = vi.fn();
    pk.onEvent(handler);
    const c = await pk.createCredential({
      rp: { id: 'x.com', name: 'X' },
      user: { id: 'u1', name: 'a', displayName: 'A' },
    });
    handler.mockClear();
    pk.deleteCredential(c.credential.id);
    expect(handler).toHaveBeenCalledWith(expect.objectContaining({ kind: 'deleted' }));
  });

  it('dispose clears everything', async () => {
    await pk.createCredential({
      rp: { id: 'x.com', name: 'X' },
      user: { id: 'u1', name: 'a', displayName: 'A' },
    });
    pk.dispose();
    expect(pk.size).toBe(0);
  });
});
