import type { IDisposable } from '../../app/dependency-container';

interface CredentialEntry {
  readonly id: string;
  url: string;
  username: string;
  password: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  lastUsedAt: number;
  useCount: number;
}

type CredentialChangeKind = 'created' | 'updated' | 'deleted' | 'used';
interface CredentialChangeEvent {
  readonly kind: CredentialChangeKind;
  readonly entry: CredentialEntry;
}

type CredentialEventHandler = (event: CredentialChangeEvent) => void;

interface ICredentialStore extends IDisposable {
  save(entry: Omit<CredentialEntry, 'id' | 'createdAt' | 'updatedAt' | 'lastUsedAt' | 'useCount'>): CredentialEntry;
  get(id: string): CredentialEntry | null;
  getByUrl(url: string): CredentialEntry[];
  getAll(): CredentialEntry[];
  update(id: string, changes: Partial<Pick<CredentialEntry, 'url' | 'username' | 'password' | 'name'>>): CredentialEntry | null;
  delete(id: string): boolean;
  recordUse(id: string): void;
  clear(): void;
  get size(): number;
  onEvent(handler: CredentialEventHandler): () => void;
}

function generateId(): string {
  const bytes = new Uint8Array(12);
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < 12; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  return `cred-${Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('')}`;
}

class CredentialStore implements ICredentialStore {
  private readonly entries = new Map<string, CredentialEntry>();
  private readonly handlers = new Set<CredentialEventHandler>();

  get size(): number { return this.entries.size; }

  save(entry: Omit<CredentialEntry, 'id' | 'createdAt' | 'updatedAt' | 'lastUsedAt' | 'useCount'>): CredentialEntry {
    const now = Date.now();
    const id = generateId();
    const newEntry: CredentialEntry = {
      id,
      url: entry.url,
      username: entry.username,
      password: entry.password,
      name: entry.name,
      createdAt: now,
      updatedAt: now,
      lastUsedAt: 0,
      useCount: 0,
    };
    this.entries.set(id, newEntry);
    this.emit({ kind: 'created', entry: newEntry });
    return newEntry;
  }

  get(id: string): CredentialEntry | null {
    return this.entries.get(id) ?? null;
  }

  getByUrl(url: string): CredentialEntry[] {
    const normalized = url.toLowerCase();
    const results: CredentialEntry[] = [];
    for (const entry of this.entries.values()) {
      if (entry.url.toLowerCase() === normalized || this.urlMatches(normalized, entry.url.toLowerCase())) {
        results.push(entry);
      }
    }
    return results;
  }

  private urlMatches(requested: string, stored: string): boolean {
    try {
      const r = new URL(requested);
      const s = new URL(stored);
      return r.hostname === s.hostname || r.hostname.endsWith('.' + s.hostname) || s.hostname.endsWith('.' + r.hostname);
    } catch {
      return stored.includes(requested) || requested.includes(stored);
    }
  }

  getAll(): CredentialEntry[] {
    return [...this.entries.values()];
  }

  update(id: string, changes: Partial<Pick<CredentialEntry, 'url' | 'username' | 'password' | 'name'>>): CredentialEntry | null {
    const entry = this.entries.get(id);
    if (!entry) return null;
    const updated: CredentialEntry = {
      ...entry,
      url: changes.url ?? entry.url,
      username: changes.username ?? entry.username,
      password: changes.password ?? entry.password,
      name: changes.name ?? entry.name,
      updatedAt: Date.now(),
    };
    this.entries.set(id, updated);
    this.emit({ kind: 'updated', entry: updated });
    return updated;
  }

  delete(id: string): boolean {
    const entry = this.entries.get(id);
    if (!entry) return false;
    this.entries.delete(id);
    this.emit({ kind: 'deleted', entry });
    return true;
  }

  recordUse(id: string): void {
    const entry = this.entries.get(id);
    if (!entry) return;
    const updated: CredentialEntry = {
      ...entry,
      lastUsedAt: Date.now(),
      useCount: entry.useCount + 1,
    };
    this.entries.set(id, updated);
    this.emit({ kind: 'used', entry: updated });
  }

  clear(): void {
    const all = [...this.entries.values()];
    this.entries.clear();
    for (const entry of all) {
      this.emit({ kind: 'deleted', entry });
    }
  }

  onEvent(handler: CredentialEventHandler): () => void {
    this.handlers.add(handler);
    return () => { this.handlers.delete(handler); };
  }

  private emit(event: CredentialChangeEvent): void {
    for (const h of this.handlers) {
      try { h(event); } catch { /* swallow */ }
    }
  }

  dispose(): void {
    this.entries.clear();
    this.handlers.clear();
  }
}

export { CredentialStore, generateId };
export type { ICredentialStore, CredentialEntry, CredentialChangeEvent, CredentialChangeKind, CredentialEventHandler };
