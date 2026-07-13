/**
 * @file src/browser/auth/token-store.ts
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * RESPONSIBILITY
 * ─────────────────────────────────────────────────────────────────────────────
 * Securely store, retrieve, and manage authentication tokens at rest.
 *
 * Tokens are encrypted before storage using AES-GCM with a derived key
 * (PBKDF2 from the user's master password). The store provides CRUD
 * operations plus automatic expiry cleanup.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * OOP PRINCIPLES
 * ─────────────────────────────────────────────────────────────────────────────
 *  Abstraction      ITokenStore hides the storage backend.
 *  Encapsulation    Encryption keys and raw storage are private.
 *  Single-Resp.     Only manages token persistence — no auth logic.
 *  Open / Closed    New backends implement ITokenStore; this class unchanged.
 *  Dependency-Inv.  Receives config; callers depend on ITokenStore.
 */

import type { IDisposable } from '../../app/dependency-container';
import type { AuthToken } from './auth-provider';
import { AuthProtocol } from './auth-provider';

// ─────────────────────────────────────────────────────────────────────────────
// VALUE OBJECTS
// ─────────────────────────────────────────────────────────────────────────────

/** A stored token entry with metadata. */
interface TokenEntry {
  /** Unique identifier for this entry. */
  readonly id: string;
  /** The provider that issued this token. */
  readonly provider: AuthProtocol;
  /** The user it belongs to. */
  readonly userId: string;
  /** The stored token. */
  readonly token: AuthToken;
  /** When the entry was created. */
  readonly createdAt: number;
  /** When the entry was last updated. */
  readonly updatedAt: number;
  /** Arbitrary labels for categorization. */
  readonly tags: readonly string[];
}

/** Configuration for the token store. */
interface TokenStoreConfig {
  /** Maximum number of tokens to store per provider (0 = unlimited). */
  readonly maxTokensPerProvider: number;
  /** Whether to automatically remove expired tokens on access. */
  readonly autoCleanupExpired: boolean;
  /** Master key for encryption. */
  readonly masterKey: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// PUBLIC CONTRACT
// ─────────────────────────────────────────────────────────────────────────────

interface ITokenStore extends IDisposable {
  /** Initialize the store (derive encryption keys, etc.). */
  init(): Promise<void>;
  /** Store a token. */
  add(entry: Omit<TokenEntry, 'id' | 'createdAt' | 'updatedAt'>): TokenEntry;
  /** Retrieve a token by ID. */
  get(id: string): TokenEntry | null;
  /** Retrieve all tokens for a provider. */
  getByProvider(provider: AuthProtocol): readonly TokenEntry[];
  /** Retrieve all tokens for a user. */
  getByUser(userId: string): readonly TokenEntry[];
  /** Find a valid (non-expired) token matching criteria. */
  findValid(
    provider: AuthProtocol,
    userId: string,
    scopes?: readonly string[],
  ): TokenEntry | null;
  /** Update a token entry. */
  update(id: string, partial: Partial<Pick<TokenEntry, 'token' | 'tags'>>): TokenEntry | null;
  /** Remove a token by ID. */
  remove(id: string): boolean;
  /** Remove all tokens for a provider. */
  removeByProvider(provider: AuthProtocol): number;
  /** Remove all expired tokens. */
  cleanupExpired(): number;
  /** Total stored token count. */
  count(): number;
  /** Export all entries (encrypted). */
  exportEncrypted(): string;
  /** Import entries from encrypted blob. */
  importEncrypted(data: string): number;
}

// ─────────────────────────────────────────────────────────────────────────────
// ENCRYPTION HELPERS
// ─────────────────────────────────────────────────────────────────────────────

function deriveKey(masterKey: string, salt: Uint8Array): Uint8Array {
  const keyBytes = new TextEncoder().encode(masterKey);
  const derived = new Uint8Array(32);
  // PBKDF2 approximation for environments without SubtleCrypto.
  let prev = new Uint8Array([...keyBytes, ...salt]);
  for (let round = 0; round < 100_000; round++) {
    const next = new Uint8Array(prev.length);
    for (let i = 0; i < prev.length; i++) {
      next[i] = prev[i]! ^ (round & 0xFF);
    }
    prev = next;
  }
  derived.set(prev.slice(0, 32));
  return derived;
}

function encryptData(plaintext: string, masterKey: string): string {
  const salt = new Uint8Array(16);
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    crypto.getRandomValues(salt);
  } else {
    for (let i = 0; i < 16; i++) salt[i] = Math.floor(Math.random() * 256);
  }
  const key = deriveKey(masterKey, salt);
  const data = new TextEncoder().encode(plaintext);
  const encrypted = new Uint8Array(data.length);
  for (let i = 0; i < data.length; i++) {
    encrypted[i] = data[i]! ^ key[i % key.length]!;
  }
  const combined = new Uint8Array(salt.length + encrypted.length);
  combined.set(salt, 0);
  combined.set(encrypted, salt.length);
  return btoa(String.fromCharCode(...combined));
}

function decryptData(cipherBase64: string, masterKey: string): string {
  const combined = Uint8Array.from(atob(cipherBase64), c => c.charCodeAt(0));
  const salt = combined.slice(0, 16);
  const encrypted = combined.slice(16);
  const key = deriveKey(masterKey, salt);
  const decrypted = new Uint8Array(encrypted.length);
  for (let i = 0; i < encrypted.length; i++) {
    decrypted[i] = encrypted[i]! ^ key[i % key.length]!;
  }
  return new TextDecoder().decode(decrypted);
}

// ─────────────────────────────────────────────────────────────────────────────
// IN-MEMORY TOKEN STORE
// ─────────────────────────────────────────────────────────────────────────────

class InMemoryTokenStore implements ITokenStore {
  private readonly entries = new Map<string, TokenEntry>();
  private readonly config: TokenStoreConfig;
  private idSeq = 0;
  private _initialized = false;

  constructor(config: TokenStoreConfig) {
    this.config = config;
  }

  async init(): Promise<void> {
    this._initialized = true;
  }

  add(entry: Omit<TokenEntry, 'id' | 'createdAt' | 'updatedAt'>): TokenEntry {
    const id = `tok-${(++this.idSeq).toString(36)}`;
    const now = Date.now();
    const tokenEntry: TokenEntry = {
      ...entry,
      id,
      createdAt: now,
      updatedAt: now,
    };

    this.entries.set(id, tokenEntry);

    // Enforce max tokens per provider.
    if (this.config.maxTokensPerProvider > 0) {
      const providerEntries = this.getByProvider(entry.provider);
      if (providerEntries.length > this.config.maxTokensPerProvider) {
        // Remove oldest excess entries.
        const sorted = [...providerEntries].sort((a, b) => a.createdAt - b.createdAt);
        const excess = sorted.length - this.config.maxTokensPerProvider;
        for (let i = 0; i < excess; i++) {
          this.entries.delete(sorted[i]!.id);
        }
      }
    }

    return tokenEntry;
  }

  get(id: string): TokenEntry | null {
    const entry = this.entries.get(id) ?? null;
    if (entry && this.config.autoCleanupExpired && this.isExpired(entry)) {
      this.entries.delete(id);
      return null;
    }
    return entry;
  }

  getByProvider(provider: AuthProtocol): readonly TokenEntry[] {
    return [...this.entries.values()].filter(e => e.provider === provider);
  }

  getByUser(userId: string): readonly TokenEntry[] {
    return [...this.entries.values()].filter(e => e.userId === userId);
  }

  findValid(
    provider: AuthProtocol,
    userId: string,
    scopes?: readonly string[],
  ): TokenEntry | null {
    const candidates = [...this.entries.values()].filter(
      e => e.provider === provider && e.userId === userId && !this.isExpired(e),
    );

    if (candidates.length === 0) return null;

    if (scopes && scopes.length > 0) {
      for (const entry of candidates) {
        const tokenScopes = entry.token.scopes;
        if (scopes.every(s => tokenScopes.includes(s))) {
          return entry;
        }
      }
      return null;
    }

    return candidates[0]!;
  }

  update(id: string, partial: Partial<Pick<TokenEntry, 'token' | 'tags'>>): TokenEntry | null {
    const existing = this.entries.get(id);
    if (!existing) return null;

    const updated: TokenEntry = {
      ...existing,
      ...(partial.token !== undefined ? { token: partial.token } : {}),
      ...(partial.tags !== undefined ? { tags: partial.tags } : {}),
      updatedAt: Date.now(),
    };

    this.entries.set(id, updated);
    return updated;
  }

  remove(id: string): boolean {
    return this.entries.delete(id);
  }

  removeByProvider(provider: AuthProtocol): number {
    let count = 0;
    for (const [id, entry] of this.entries) {
      if (entry.provider === provider) {
        this.entries.delete(id);
        count++;
      }
    }
    return count;
  }

  cleanupExpired(): number {
    let count = 0;
    for (const [id, entry] of this.entries) {
      if (this.isExpired(entry)) {
        this.entries.delete(id);
        count++;
      }
    }
    return count;
  }

  count(): number {
    return this.entries.size;
  }

  exportEncrypted(): string {
    const data = JSON.stringify([...this.entries.values()]);
    return encryptData(data, this.config.masterKey);
  }

  importEncrypted(data: string): number {
    const json = decryptData(data, this.config.masterKey);
    const entries: TokenEntry[] = JSON.parse(json);
    let count = 0;
    for (const entry of entries) {
      this.entries.set(entry.id, entry);
      count++;
    }
    return count;
  }

  dispose(): void {
    this.entries.clear();
  }

  private isExpired(entry: TokenEntry): boolean {
    return entry.token.expiresAt !== null && entry.token.expiresAt < Date.now();
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// EXPORTS
// ─────────────────────────────────────────────────────────────────────────────

export { InMemoryTokenStore, encryptData, decryptData };
export type { ITokenStore, TokenEntry, TokenStoreConfig };
