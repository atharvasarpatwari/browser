import type { IDisposable } from '../../app/dependency-container';

const PBKDF2_ITERATIONS = 100_000;
const SALT_LENGTH = 16;
const IV_LENGTH = 12;
const KEY_LENGTH = 256;

interface EncryptedData {
  readonly data: string;
  readonly iv: string;
  readonly salt: string;
  readonly algorithm: string;
}

interface EncryptionKey {
  readonly type: 'aes-gcm' | 'pbkdf2';
  readonly raw: string;
}

interface IEncryptionService extends IDisposable {
  encrypt(plaintext: string, key?: EncryptionKey): Promise<EncryptedData>;
  decrypt(encrypted: EncryptedData, key?: EncryptionKey): Promise<string>;
  generateKey(): Promise<EncryptionKey>;
  deriveKey(password: string, salt?: string): Promise<EncryptionKey>;
  exportKey(key: EncryptionKey): string;
  importKey(raw: string, type?: 'aes-gcm' | 'pbkdf2'): EncryptionKey;
  isReady(): boolean;
}

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
  return (arr.buffer as ArrayBuffer).slice(arr.byteOffset, arr.byteOffset + arr.byteLength);
}

function canUseSubtle(): boolean {
  return typeof crypto !== 'undefined' && typeof crypto.subtle !== 'undefined' && crypto.subtle !== null;
}

class EncryptionService implements IEncryptionService {
  private ready = false;

  constructor() {
    this.ready = canUseSubtle();
  }

  isReady(): boolean {
    return this.ready;
  }

  async encrypt(plaintext: string, key?: EncryptionKey): Promise<EncryptedData> {
    const salt = generateBytes(SALT_LENGTH);
    const iv = generateBytes(IV_LENGTH);

    if (this.ready && key && key.type === 'aes-gcm') {
      const cryptoKey = await this.importCryptoKey(key.raw);
      const encoder = new TextEncoder();
      const encrypted = await crypto.subtle.encrypt(
        { name: 'AES-GCM', iv: toBuffer(iv) },
        cryptoKey,
        toBuffer(encoder.encode(plaintext)),
      );
      return {
        data: bytesToHex(new Uint8Array(encrypted)),
        iv: bytesToHex(iv),
        salt: bytesToHex(salt),
        algorithm: 'AES-GCM',
      };
    }

    return this.xorEncrypt(plaintext, key ? key.raw : 'default-key', salt, iv);
  }

  async decrypt(encrypted: EncryptedData, key?: EncryptionKey): Promise<string> {
    const iv = hexToBytes(encrypted.iv);
    const data = hexToBytes(encrypted.data);

    if (this.ready && key && key.type === 'aes-gcm') {
      const cryptoKey = await this.importCryptoKey(key.raw);
      try {
        const decrypted = await crypto.subtle.decrypt(
          { name: 'AES-GCM', iv: toBuffer(iv) },
          cryptoKey,
          toBuffer(data),
        );
        return new TextDecoder().decode(decrypted);
      } catch {
        throw new Error('Decryption failed: data corrupted or wrong key');
      }
    }

    return this.xorDecrypt(encrypted, key ? key.raw : 'default-key');
  }

  async generateKey(): Promise<EncryptionKey> {
    if (this.ready) {
      try {
        const key = await crypto.subtle.generateKey(
          { name: 'AES-GCM', length: KEY_LENGTH },
          true,
          ['encrypt', 'decrypt'],
        );
        const raw = await crypto.subtle.exportKey('raw', key);
        return { type: 'aes-gcm', raw: bytesToHex(new Uint8Array(raw)) };
      } catch {
        /* fall through */
      }
    }
    const rawKey = generateBytes(32);
    return { type: 'aes-gcm', raw: bytesToHex(rawKey) };
  }

  async deriveKey(password: string, salt?: string): Promise<EncryptionKey> {
    const saltBytes = salt ? hexToBytes(salt) : generateBytes(SALT_LENGTH);

    if (this.ready) {
      try {
        const encoder = new TextEncoder();
        const keyMaterial = await crypto.subtle.importKey(
          'raw',
          toBuffer(encoder.encode(password)),
          'PBKDF2',
          false,
          ['deriveKey'],
        );
        const key = await crypto.subtle.deriveKey(
          {
            name: 'PBKDF2',
            salt: toBuffer(saltBytes),
            iterations: PBKDF2_ITERATIONS,
            hash: 'SHA-256',
          },
          keyMaterial,
          { name: 'AES-GCM', length: KEY_LENGTH },
          true,
          ['encrypt', 'decrypt'],
        );
        const raw = await crypto.subtle.exportKey('raw', key);
        return { type: 'pbkdf2', raw: bytesToHex(new Uint8Array(raw)) };
      } catch {
        /* fall through */
      }
    }

    const combined = new TextEncoder().encode(password + salt);
    const hash = new Uint8Array(32);
    for (let i = 0; i < 32; i++) {
      hash[i] = combined[i % combined.length] ^ (i * 31 + 0x9e3779b9) & 0xff;
    }
    return { type: 'pbkdf2', raw: bytesToHex(hash) };
  }

  exportKey(key: EncryptionKey): string {
    return `${key.type}:${key.raw}`;
  }

  importKey(raw: string, type?: 'aes-gcm' | 'pbkdf2'): EncryptionKey {
    if (raw.includes(':')) {
      const parts = raw.split(':');
      return { type: parts[0] as 'aes-gcm' | 'pbkdf2', raw: parts.slice(1).join(':') };
    }
    return { type: type ?? 'aes-gcm', raw };
  }

  private async importCryptoKey(raw: string): Promise<CryptoKey> {
    const keyBytes = hexToBytes(raw);
    return crypto.subtle.importKey(
      'raw',
      toBuffer(keyBytes),
      { name: 'AES-GCM', length: KEY_LENGTH },
      false,
      ['encrypt', 'decrypt'],
    );
  }

  private async deriveCryptoKey(baseKey: CryptoKey, salt: Uint8Array): Promise<CryptoKey> {
    return crypto.subtle.deriveKey(
      { name: 'PBKDF2', salt: toBuffer(salt), iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
      baseKey,
      { name: 'AES-GCM', length: KEY_LENGTH },
      false,
      ['encrypt', 'decrypt'],
    );
  }

  private xorEncrypt(plaintext: string, key: string, salt: Uint8Array, iv: Uint8Array): EncryptedData {
    const plainBytes = new TextEncoder().encode(plaintext);
    const keyBytes = new TextEncoder().encode(key);
    const encrypted = new Uint8Array(plainBytes.length);
    for (let i = 0; i < plainBytes.length; i++) {
      const k = keyBytes[i % keyBytes.length];
      const s = salt[i % salt.length];
      const v = iv[i % iv.length];
      encrypted[i] = plainBytes[i] ^ k ^ s ^ v ^ ((i * 31 + 0x9e3779b9) & 0xff);
    }
    return {
      data: bytesToHex(encrypted),
      iv: bytesToHex(iv),
      salt: bytesToHex(salt),
      algorithm: 'XOR',
    };
  }

  private xorDecrypt(encrypted: EncryptedData, key: string): string {
    const data = hexToBytes(encrypted.data);
    const salt = hexToBytes(encrypted.salt);
    const iv = hexToBytes(encrypted.iv);
    const keyBytes = new TextEncoder().encode(key);
    const decrypted = new Uint8Array(data.length);
    for (let i = 0; i < data.length; i++) {
      const k = keyBytes[i % keyBytes.length];
      const s = salt[i % salt.length];
      const v = iv[i % iv.length];
      decrypted[i] = data[i] ^ k ^ s ^ v ^ ((i * 31 + 0x9e3779b9) & 0xff);
    }
    return new TextDecoder().decode(decrypted);
  }

  dispose(): void {
    this.ready = false;
  }
}

export { EncryptionService, PBKDF2_ITERATIONS, SALT_LENGTH, IV_LENGTH, generateBytes, bytesToHex, hexToBytes };
export type { IEncryptionService, EncryptedData, EncryptionKey };
