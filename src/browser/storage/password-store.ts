import type { IDisposable } from '../../app/dependency-container';

const PBKDF2_ITERATIONS = 100_000;
const SALT_LENGTH = 16;
const IV_LENGTH = 12;

function generateBytes(length: number): Uint8Array {
  const arr = new Uint8Array(length);
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    crypto.getRandomValues(arr);
  } else {
    for (let i = 0; i < length; i++) arr[i] = Math.floor(Math.random() * 256);
  }
  return arr;
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
}

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.substring(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

function toBuffer(arr: Uint8Array): ArrayBuffer {
  return arr.buffer.slice(arr.byteOffset, arr.byteOffset + arr.byteLength) as ArrayBuffer;
}

interface EncryptedPayload {
  readonly data: string;
  readonly iv: string;
  readonly salt: string;
}

interface PasswordEntry {
  readonly id: string;
  readonly hostname: string;
  readonly url: string;
  readonly username: string;
  readonly encryptedPayload: EncryptedPayload;
  readonly createdAt: number;
  updatedAt: number;
  lastUsedAt: number;
  useCount: number;
  readonly note: string;
  readonly tags: readonly string[];
}

interface PasswordEntryData {
  readonly id: string;
  readonly hostname: string;
  readonly url: string;
  readonly username: string;
  readonly password: string;
  readonly createdAt: number;
  readonly updatedAt: number;
  readonly lastUsedAt: number;
  readonly useCount: number;
  readonly note: string;
  readonly tags: readonly string[];
}

interface IPasswordStore extends IDisposable {
  init(masterPassword: string): Promise<void>;
  isInitialized(): boolean;
  add(data: PasswordEntryData): Promise<PasswordEntry>;
  get(id: string): Promise<PasswordEntry | null>;
  getByHostname(hostname: string): Promise<readonly PasswordEntry[]>;
  getAll(): Promise<readonly PasswordEntry[]>;
  update(id: string, changes: Partial<Pick<PasswordEntryData, 'username' | 'password' | 'note' | 'tags' | 'url'>>): Promise<PasswordEntry | null>;
  remove(id: string): Promise<boolean>;
  removeByHostname(hostname: string): Promise<number>;
  count(): number;
  decrypt(encrypted: EncryptedPayload): Promise<string>;
  rotateMasterKey(oldPassword: string, newPassword: string): Promise<number>;
  exportRaw(): Promise<readonly PasswordEntry[]>;
  importRaw(entries: readonly PasswordEntry[]): Promise<number>;
  dispose(): void;
}

function extractHostname(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return url.toLowerCase().replace(/^[a-z]+:\/\//, '').split('/')[0].split('?')[0];
  }
}

function matchesHostname(stored: string, requested: string): boolean {
  const s = stored.toLowerCase();
  const r = requested.toLowerCase();
  if (s === r) return true;
  if (r.endsWith('.' + s)) return true;
  if (s.endsWith('.' + r)) return true;
  return false;
}

class InMemoryPasswordStore implements IPasswordStore {
  private readonly entries = new Map<string, PasswordEntry>();
  private _initialized = false;
  private _masterPassword = '';

  private async deriveKey(password: string, salt: Uint8Array): Promise<CryptoKey | null> {
    if (typeof crypto === 'undefined' || !crypto.subtle) return null;
    try {
      const encoder = new TextEncoder();
      const keyMaterial = await crypto.subtle.importKey(
        'raw', toBuffer(encoder.encode(password)), 'PBKDF2', false, ['deriveKey'],
      );
      return crypto.subtle.deriveKey(
        { name: 'PBKDF2', salt: toBuffer(salt), iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
        keyMaterial,
        { name: 'AES-GCM', length: 256 },
        false,
        ['encrypt', 'decrypt'],
      );
    } catch {
      return null;
    }
  }

  private async encryptPassword(plaintext: string): Promise<EncryptedPayload> {
    const salt = generateBytes(SALT_LENGTH);
    const iv = generateBytes(IV_LENGTH);

    const key = await this.deriveKey(this._masterPassword, salt);
    if (key && typeof crypto !== 'undefined' && crypto.subtle) {
      const encoder = new TextEncoder();
      const encrypted = await crypto.subtle.encrypt(
        { name: 'AES-GCM', iv: toBuffer(iv) }, key, toBuffer(encoder.encode(plaintext)),
      );
      return {
        data: bytesToHex(new Uint8Array(encrypted)),
        iv: bytesToHex(iv),
        salt: bytesToHex(salt),
      };
    }

    return this.fallbackEncrypt(plaintext, salt, iv);
  }

  private fallbackEncrypt(plaintext: string, salt: Uint8Array, iv: Uint8Array): EncryptedPayload {
    const passBytes = new TextEncoder().encode(this._masterPassword);
    const plainBytes = new TextEncoder().encode(plaintext);
    const keyStream = new Uint8Array(plainBytes.length);

    for (let i = 0; i < plainBytes.length; i++) {
      keyStream[i] = passBytes[i % passBytes.length] ^ salt[i % salt.length] ^ iv[i % iv.length];
      keyStream[i] ^= (i * 31 + 0x9e3779b9) & 0xff;
    }

    const encrypted = new Uint8Array(plainBytes.length);
    for (let i = 0; i < plainBytes.length; i++) {
      encrypted[i] = plainBytes[i] ^ keyStream[i];
    }

    return {
      data: bytesToHex(encrypted),
      iv: bytesToHex(iv),
      salt: bytesToHex(salt),
    };
  }

  async decrypt(encrypted: EncryptedPayload): Promise<string> {
    if (!this._initialized) throw new Error('Store not initialized');

    const salt = hexToBytes(encrypted.salt);
    const iv = hexToBytes(encrypted.iv);
    const data = hexToBytes(encrypted.data);

    const key = await this.deriveKey(this._masterPassword, salt);
    if (key && typeof crypto !== 'undefined' && crypto.subtle) {
      try {
        const decrypted = await crypto.subtle.decrypt(
          { name: 'AES-GCM', iv: toBuffer(iv) }, key, toBuffer(data),
        );
        return new TextDecoder().decode(decrypted);
      } catch {
        throw new Error('Decryption failed: corrupted data');
      }
    }

    return this.fallbackDecrypt(encrypted);
  }

  private fallbackDecrypt(encrypted: EncryptedPayload): string {
    const salt = hexToBytes(encrypted.salt);
    const iv = hexToBytes(encrypted.iv);
    const data = hexToBytes(encrypted.data);
    const passBytes = new TextEncoder().encode(this._masterPassword);

    const keyStream = new Uint8Array(data.length);
    for (let i = 0; i < data.length; i++) {
      keyStream[i] = passBytes[i % passBytes.length] ^ salt[i % salt.length] ^ iv[i % iv.length];
      keyStream[i] ^= (i * 31 + 0x9e3779b9) & 0xff;
    }

    const decrypted = new Uint8Array(data.length);
    for (let i = 0; i < data.length; i++) {
      decrypted[i] = data[i] ^ keyStream[i];
    }

    return new TextDecoder().decode(decrypted);
  }

  async init(masterPassword: string): Promise<void> {
    if (!masterPassword || masterPassword.length < 1) {
      throw new Error('Master password is required');
    }
    this._masterPassword = masterPassword;
    this._initialized = true;
  }

  isInitialized(): boolean {
    return this._initialized;
  }

  async add(data: PasswordEntryData): Promise<PasswordEntry> {
    if (!this._initialized) throw new Error('Store not initialized: call init() first');

    const id = data.id || `pw-${bytesToHex(generateBytes(12))}`;
    const hostname = extractHostname(data.url);

    const entry: PasswordEntry = {
      id,
      hostname,
      url: data.url,
      username: data.username,
      encryptedPayload: await this.encryptPassword(data.password),
      createdAt: data.createdAt || Date.now(),
      updatedAt: Date.now(),
      lastUsedAt: 0,
      useCount: 0,
      note: data.note || '',
      tags: [...(data.tags || [])],
    };

    this.entries.set(id, entry);
    return entry;
  }

  async get(id: string): Promise<PasswordEntry | null> {
    return this.entries.get(id) ?? null;
  }

  async getByHostname(hostname: string): Promise<readonly PasswordEntry[]> {
    const results: PasswordEntry[] = [];
    for (const entry of this.entries.values()) {
      if (matchesHostname(entry.hostname, hostname)) {
        results.push(entry);
      }
    }
    return results;
  }

  async getAll(): Promise<readonly PasswordEntry[]> {
    return [...this.entries.values()];
  }

  async update(id: string, changes: Partial<Pick<PasswordEntryData, 'username' | 'password' | 'note' | 'tags' | 'url'>>): Promise<PasswordEntry | null> {
    const entry = this.entries.get(id);
    if (!entry) return null;

    let newEncrypted = entry.encryptedPayload;
    if (changes.password) {
      newEncrypted = await this.encryptPassword(changes.password);
    }

    const updated: PasswordEntry = {
      ...entry,
      username: changes.username ?? entry.username,
      url: changes.url ?? entry.url,
      hostname: changes.url ? extractHostname(changes.url) : entry.hostname,
      encryptedPayload: newEncrypted,
      note: changes.note ?? entry.note,
      tags: changes.tags ?? entry.tags,
      updatedAt: Date.now(),
    };

    this.entries.set(id, updated);
    return updated;
  }

  async remove(id: string): Promise<boolean> {
    return this.entries.delete(id);
  }

  async removeByHostname(hostname: string): Promise<number> {
    let removed = 0;
    for (const [id, entry] of this.entries) {
      if (matchesHostname(entry.hostname, hostname)) {
        this.entries.delete(id);
        removed++;
      }
    }
    return removed;
  }

  count(): number {
    return this.entries.size;
  }

  async rotateMasterKey(oldPassword: string, newPassword: string): Promise<number> {
    if (!this._initialized) throw new Error('Store not initialized');

    const entries = [...this.entries.values()];
    let rotated = 0;

    for (const entry of entries) {
      try {
        const plainPassword = await this.decryptWithPassword(entry.encryptedPayload, oldPassword);
        const oldMaster = this._masterPassword;
        this._masterPassword = newPassword;
        const newEncrypted = await this.encryptPassword(plainPassword);
        this._masterPassword = oldMaster;
        this.entries.set(entry.id, { ...entry, encryptedPayload: newEncrypted, updatedAt: Date.now() });
        rotated++;
      } catch {
        continue;
      }
    }

    this._masterPassword = newPassword;
    return rotated;
  }

  private async decryptWithPassword(encrypted: EncryptedPayload, password: string): Promise<string> {
    const salt = hexToBytes(encrypted.salt);
    const iv = hexToBytes(encrypted.iv);
    const data = hexToBytes(encrypted.data);

    const key = await this.deriveKey(password, salt);
    if (key && typeof crypto !== 'undefined' && crypto.subtle) {
      try {
        const decrypted = await crypto.subtle.decrypt(
          { name: 'AES-GCM', iv: toBuffer(iv) }, key, toBuffer(data),
        );
        return new TextDecoder().decode(decrypted);
      } catch {
        throw new Error('Decryption failed: wrong password');
      }
    }

    const passBytes = new TextEncoder().encode(password);
    const keyStream = new Uint8Array(data.length);
    for (let i = 0; i < data.length; i++) {
      keyStream[i] = passBytes[i % passBytes.length] ^ salt[i % salt.length] ^ iv[i % iv.length];
      keyStream[i] ^= (i * 31 + 0x9e3779b9) & 0xff;
    }
    const decrypted = new Uint8Array(data.length);
    for (let i = 0; i < data.length; i++) {
      decrypted[i] = data[i] ^ keyStream[i];
    }
    return new TextDecoder().decode(decrypted);
  }

  async exportRaw(): Promise<readonly PasswordEntry[]> {
    return [...this.entries.values()];
  }

  async importRaw(entries: readonly PasswordEntry[]): Promise<number> {
    let imported = 0;
    for (const entry of entries) {
      if (!this.entries.has(entry.id)) {
        this.entries.set(entry.id, { ...entry });
        imported++;
      }
    }
    return imported;
  }

  dispose(): void {
    this.entries.clear();
    this._initialized = false;
    this._masterPassword = '';
  }
}

export { InMemoryPasswordStore, extractHostname, matchesHostname, PBKDF2_ITERATIONS };
export type { IPasswordStore, PasswordEntry, PasswordEntryData, EncryptedPayload };
