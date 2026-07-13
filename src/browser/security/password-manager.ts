import type { IDisposable } from '../../app/dependency-container';
import type { IPasswordStore, PasswordEntry, EncryptedPayload } from '../storage/password-store';
import { InMemoryPasswordStore, extractHostname } from '../storage/password-store';

type PasswordManagerEventType =
  | 'passwordStored'
  | 'passwordUpdated'
  | 'passwordDeleted'
  | 'passwordMatched'
  | 'masterKeyRotated'
  | 'passwordsImported';

interface PasswordStoredEvent {
  readonly kind: 'passwordStored';
  readonly entry: PasswordEntry;
}

interface PasswordUpdatedEvent {
  readonly kind: 'passwordUpdated';
  readonly entry: PasswordEntry;
}

interface PasswordDeletedEvent {
  readonly kind: 'passwordDeleted';
  readonly id: string;
  readonly hostname: string;
}

interface PasswordMatchedEvent {
  readonly kind: 'passwordMatched';
  readonly hostname: string;
  readonly matches: number;
}

interface MasterKeyRotatedEvent {
  readonly kind: 'masterKeyRotated';
  readonly rotatedCount: number;
}

interface PasswordsImportedEvent {
  readonly kind: 'passwordsImported';
  readonly count: number;
}

type PasswordManagerEvent =
  | PasswordStoredEvent
  | PasswordUpdatedEvent
  | PasswordDeletedEvent
  | PasswordMatchedEvent
  | MasterKeyRotatedEvent
  | PasswordsImportedEvent;

type PasswordManagerEventHandler = (event: PasswordManagerEvent) => void;

interface PasswordStrengthResult {
  readonly score: number;
  readonly label: 'very-weak' | 'weak' | 'fair' | 'strong' | 'very-strong';
  readonly feedback: readonly string[];
}

interface PasswordManagerConfig {
  readonly maxEntryAge: number;
  readonly minPasswordLength: number;
  readonly requireUsername: boolean;
}

const DEFAULT_CONFIG: PasswordManagerConfig = {
  maxEntryAge: 365 * 24 * 60 * 60 * 1000,
  minPasswordLength: 8,
  requireUsername: true,
};

class PasswordManagerEventBus {
  private readonly channels = new Map<PasswordManagerEventType, Set<PasswordManagerEventHandler>>();
  private emitCount = 0;
  private readonly maxEmitRate = 100;

  on(type: PasswordManagerEventType, handler: PasswordManagerEventHandler): void {
    if (!this.channels.has(type)) this.channels.set(type, new Set());
    this.channels.get(type)!.add(handler);
  }

  off(type: PasswordManagerEventType, handler: PasswordManagerEventHandler): void {
    this.channels.get(type)?.delete(handler);
  }

  emit(event: PasswordManagerEvent): void {
    this.emitCount++;
    if (this.emitCount > this.maxEmitRate) return;
    const handlers = this.channels.get(event.kind);
    if (!handlers) return;
    for (const h of handlers) {
      try { h(event); } catch (err) {
        console.error(`[PasswordManager] Handler threw on "${event.kind}":`, err);
      }
    }
  }

  resetRateLimit(): void { this.emitCount = 0; }

  dispose(): void { this.channels.clear(); this.emitCount = 0; }
}

function checkPasswordStrength(password: string): PasswordStrengthResult {
  const feedback: string[] = [];
  let score = 0;

  if (password.length >= 8) score++;
  if (password.length >= 12) score++;
  if (password.length >= 16) score++;

  if (/[a-z]/.test(password)) score++;
  else feedback.push('Add lowercase letters');

  if (/[A-Z]/.test(password)) score++;
  else feedback.push('Add uppercase letters');

  if (/[0-9]/.test(password)) score++;
  else feedback.push('Add numbers');

  if (/[^a-zA-Z0-9]/.test(password)) score++;
  else feedback.push('Add special characters');

  if (/(.)\1{2,}/.test(password)) { score--; feedback.push('Avoid repeated characters'); }
  if (/^[a-zA-Z]+$/.test(password)) { score--; feedback.push('Mix letters and numbers'); }
  if (/^[0-9]+$/.test(password)) { score -= 2; feedback.push('Avoid numeric-only passwords'); }

  const commonPatterns = ['password', '123456', 'qwerty', 'abc123', 'letmein', 'admin', 'welcome', 'monkey', 'dragon', 'master'];
  if (commonPatterns.some(p => password.toLowerCase().includes(p))) {
    score -= 3;
    feedback.push('Avoid common passwords');
  }

  score = Math.max(0, Math.min(7, score));

  let label: PasswordStrengthResult['label'];
  if (score <= 1) label = 'very-weak';
  else if (score <= 2) label = 'weak';
  else if (score <= 4) label = 'fair';
  else if (score <= 5) label = 'strong';
  else label = 'very-strong';

  return { score, label, feedback };
}

function generatePassword(length: number = 16, options?: { uppercase?: boolean; lowercase?: boolean; numbers?: boolean; symbols?: boolean }): string {
  const opts = { uppercase: true, lowercase: true, numbers: true, symbols: true, ...options };
  let charset = '';
  if (opts.lowercase) charset += 'abcdefghijklmnopqrstuvwxyz';
  if (opts.uppercase) charset += 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  if (opts.numbers) charset += '0123456789';
  if (opts.symbols) charset += '!@#$%^&*()_+-=[]{}|;:,.<>?';
  if (!charset) charset = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';

  const arr = new Uint8Array(length);
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    crypto.getRandomValues(arr);
  } else {
    for (let i = 0; i < length; i++) arr[i] = Math.floor(Math.random() * 256);
  }

  let result = '';
  for (let i = 0; i < length; i++) {
    result += charset[arr[i] % charset.length];
  }
  return result;
}

interface IPasswordManager extends IDisposable {
  init(masterPassword: string): Promise<void>;
  isInitialized(): boolean;
  addCredential(url: string, username: string, password: string, options?: { note?: string; tags?: readonly string[] }): Promise<PasswordEntry>;
  getCredential(id: string): Promise<PasswordEntry | null>;
  getCredentialsForSite(url: string): Promise<readonly PasswordEntry[]>;
  getAllCredentials(): Promise<readonly PasswordEntry[]>;
  matchCredentials(url: string): Promise<readonly PasswordEntry[]>;
  updateCredential(id: string, changes: { username?: string; password?: string; note?: string; tags?: readonly string[]; url?: string }): Promise<PasswordEntry | null>;
  deleteCredential(id: string): Promise<boolean>;
  deleteAllForSite(url: string): Promise<number>;
  getCredentialCount(): number;
  decryptPassword(encrypted: EncryptedPayload): Promise<string>;
  checkStrength(password: string): PasswordStrengthResult;
  generatePassword(length?: number, options?: { uppercase?: boolean; lowercase?: boolean; numbers?: boolean; symbols?: boolean }): string;
  rotateMasterKey(oldPassword: string, newPassword: string): Promise<number>;
  on(type: PasswordManagerEventType, handler: PasswordManagerEventHandler): void;
  off(type: PasswordManagerEventType, handler: PasswordManagerEventHandler): void;
  dispose(): void;
}

class PasswordManager implements IPasswordManager {
  private readonly store: IPasswordStore;
  private readonly bus = new PasswordManagerEventBus();
  private readonly config: PasswordManagerConfig;

  constructor(store?: IPasswordStore, config?: Partial<PasswordManagerConfig>) {
    this.store = store ?? new InMemoryPasswordStore();
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  async init(masterPassword: string): Promise<void> {
    await this.store.init(masterPassword);
  }

  isInitialized(): boolean {
    return this.store.isInitialized();
  }

  async addCredential(url: string, username: string, password: string, options?: { note?: string; tags?: readonly string[] }): Promise<PasswordEntry> {
    if (!this.isInitialized()) throw new Error('Manager not initialized');
    if (!url || !url.trim()) throw new Error('URL is required');
    if (!username || !username.trim()) throw new Error('Username is required');
    if (!password) throw new Error('Password is required');
    if (password.length < this.config.minPasswordLength) {
      throw new Error(`Password must be at least ${this.config.minPasswordLength} characters`);
    }

    const existing = await this.store.getByHostname(extractHostname(url));
    const duplicate = existing.find(e => e.username.toLowerCase() === username.toLowerCase());
    if (duplicate) {
      return this.updateCredential(duplicate.id, { password, note: options?.note, tags: options?.tags }) as Promise<PasswordEntry>;
    }

    const entry = await this.store.add({
      id: '',
      url: url.trim(),
      username: username.trim(),
      password,
      hostname: extractHostname(url),
      createdAt: Date.now(),
      updatedAt: Date.now(),
      lastUsedAt: 0,
      useCount: 0,
      note: options?.note || '',
      tags: options?.tags || [],
    });

    this.bus.emit({ kind: 'passwordStored', entry });
    return entry;
  }

  async getCredential(id: string): Promise<PasswordEntry | null> {
    return this.store.get(id);
  }

  async getCredentialsForSite(url: string): Promise<readonly PasswordEntry[]> {
    const hostname = extractHostname(url);
    return this.store.getByHostname(hostname);
  }

  async getAllCredentials(): Promise<readonly PasswordEntry[]> {
    return this.store.getAll();
  }

  async matchCredentials(url: string): Promise<readonly PasswordEntry[]> {
    const hostname = extractHostname(url);
    const matches = await this.store.getByHostname(hostname);

    for (const entry of matches) {
      await this.store.update(entry.id, {});
      const updated = await this.store.get(entry.id);
      if (updated) {
        updated.lastUsedAt = Date.now();
        updated.useCount++;
      }
    }

    if (matches.length > 0) {
      this.bus.emit({ kind: 'passwordMatched', hostname, matches: matches.length });
    }

    return matches;
  }

  async updateCredential(id: string, changes: { username?: string; password?: string; note?: string; tags?: readonly string[]; url?: string }): Promise<PasswordEntry | null> {
    const updated = await this.store.update(id, changes);
    if (updated) {
      this.bus.emit({ kind: 'passwordUpdated', entry: updated });
    }
    return updated;
  }

  async deleteCredential(id: string): Promise<boolean> {
    const entry = await this.store.get(id);
    const removed = await this.store.remove(id);
    if (removed && entry) {
      this.bus.emit({ kind: 'passwordDeleted', id, hostname: entry.hostname });
    }
    return removed;
  }

  async deleteAllForSite(url: string): Promise<number> {
    const hostname = extractHostname(url);
    const removed = await this.store.removeByHostname(hostname);
    if (removed > 0) {
      this.bus.emit({ kind: 'passwordDeleted', id: '*', hostname });
    }
    return removed;
  }

  getCredentialCount(): number {
    return this.store.count();
  }

  async decryptPassword(encrypted: EncryptedPayload): Promise<string> {
    return this.store.decrypt(encrypted);
  }

  checkStrength(password: string): PasswordStrengthResult {
    return checkPasswordStrength(password);
  }

  generatePassword(length?: number, options?: { uppercase?: boolean; lowercase?: boolean; numbers?: boolean; symbols?: boolean }): string {
    return generatePassword(length, options);
  }

  async rotateMasterKey(oldPassword: string, newPassword: string): Promise<number> {
    const count = await this.store.rotateMasterKey(oldPassword, newPassword);
    this.bus.emit({ kind: 'masterKeyRotated', rotatedCount: count });
    return count;
  }

  on(type: PasswordManagerEventType, handler: PasswordManagerEventHandler): void {
    this.bus.on(type, handler);
  }

  off(type: PasswordManagerEventType, handler: PasswordManagerEventHandler): void {
    this.bus.off(type, handler);
  }

  dispose(): void {
    this.bus.dispose();
    this.store.dispose();
  }
}

export {
  PasswordManager,
  PasswordManagerEventBus,
  checkPasswordStrength,
  generatePassword,
};
export type {
  IPasswordManager,
  PasswordManagerEvent,
  PasswordManagerEventHandler,
  PasswordManagerEventType,
  PasswordManagerConfig,
  PasswordStrengthResult,
  PasswordStoredEvent,
  PasswordUpdatedEvent,
  PasswordDeletedEvent,
  PasswordMatchedEvent,
  MasterKeyRotatedEvent,
  PasswordsImportedEvent,
};
