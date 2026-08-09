/**
 * @file src/browser/storage/persistent-stores.ts
 *
 * localStorage-backed implementations of the InMemory stores.
 * Each store serializes to/from a namespaced localStorage key.
 */

import type { IDisposable } from '../../app/dependency-container';
import type { ICookieStore, CookieData, CookieQuery } from './cookie-store';
import type { ISessionsStore, SessionData } from './sessions-store';
import type { IBookmarkStore, BookmarkEntry, BookmarkQuery } from './bookmark-store';
import type { IHistoryStore, HistoryEntry, HistoryQuery, HistoryQueryResult } from './history-store';
import type { ITokenStore, TokenEntry, TokenStoreConfig } from '../auth/token-store';
import type { AuthProtocol } from '../auth/auth-provider';
import { encryptData, decryptData } from '../auth/token-store';
import { generateSecureId } from '../bookmarks/bookmark-validator';
import type { IPasswordStore, PasswordEntry, PasswordEntryData } from './password-store';
import { InMemoryPasswordStore } from './password-store';

// ─────────────────────────────────────────────────────────────────────────────
// HELPER
// ─────────────────────────────────────────────────────────────────────────────

function loadJson<T>(storage: Storage | null, key: string): T | null {
  if (!storage) return null;
  try {
    const raw = storage.getItem(key);
    return raw ? JSON.parse(raw) as T : null;
  } catch {
    return null;
  }
}

function saveJson(storage: Storage | null, key: string, data: unknown): void {
  if (!storage) return;
  try {
    storage.setItem(key, JSON.stringify(data));
  } catch {
    // Storage full or unavailable — swallow.
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// PERSISTENT COOKIE STORE
// ─────────────────────────────────────────────────────────────────────────────

const COOKIE_STORAGE_KEY = 'nova-cookies';

function cookieKey(domain: string, name: string, path: string): string {
  return `${domain}|${name}|${path}`;
}

function matchesDomain(cookie: CookieData, domain: string): boolean {
  if (cookie.hostOnly) return cookie.domain === domain;
  return domain.endsWith(cookie.domain) || cookie.domain === domain;
}

class PersistentCookieStore implements ICookieStore {
  private readonly storage: Storage | null;
  private data: Map<string, CookieData>;

  constructor(storage?: Storage) {
    this.storage = storage ?? null;
    const stored = loadJson<Record<string, CookieData>>(this.storage, COOKIE_STORAGE_KEY);
    this.data = stored ? new Map(Object.entries(stored)) : new Map();
  }

  private persist(): void {
    saveJson(this.storage, COOKIE_STORAGE_KEY, Object.fromEntries(this.data));
  }

  private evictExpired(): void {
    const now = Date.now();
    let changed = false;
    for (const [key, cookie] of this.data) {
      if (cookie.expires !== null && cookie.expires < now) {
        this.data.delete(key);
        changed = true;
      }
    }
    if (changed) this.persist();
  }

  async set(raw: Omit<CookieData, 'creationTime' | 'lastAccessTime'>): Promise<void> {
    const key = cookieKey(raw.domain, raw.name, raw.path);
    const now = Date.now();
    const existing = this.data.get(key);

    const data: CookieData = {
      ...raw,
      creationTime: existing?.creationTime ?? now,
      lastAccessTime: now,
    };

    this.data.set(key, data);
    this.evictExpired();
    this.persist();
  }

  async get(domain: string, name: string, path = '/'): Promise<CookieData | null> {
    const key = cookieKey(domain, name, path);
    const cookie = this.data.get(key);
    if (!cookie) return null;
    if (cookie.expires !== null && cookie.expires < Date.now()) {
      this.data.delete(key);
      this.persist();
      return null;
    }
    const updated = { ...cookie, lastAccessTime: Date.now() };
    this.data.set(key, updated);
    this.persist();
    return updated;
  }

  async getAll(query?: CookieQuery): Promise<readonly CookieData[]> {
    this.evictExpired();
    let results = [...this.data.values()];

    if (query) {
      if (query.domain) results = results.filter(c => matchesDomain(c, query.domain!));
      if (query.name) results = results.filter(c => c.name === query.name);
      if (query.path) results = results.filter(c => c.path.startsWith(query.path!));
      if (query.secure !== undefined) results = results.filter(c => c.secure === query.secure);
      if (query.httpOnly !== undefined) results = results.filter(c => c.httpOnly === query.httpOnly);
      if (query.session !== undefined) results = results.filter(c => c.session === query.session);
    }

    return results;
  }

  async delete(domain: string, name: string, path = '/'): Promise<boolean> {
    const result = this.data.delete(cookieKey(domain, name, path));
    if (result) this.persist();
    return result;
  }

  async deleteAll(domain?: string): Promise<number> {
    if (!domain) {
      const count = this.data.size;
      this.data.clear();
      this.persist();
      return count;
    }
    let deleted = 0;
    for (const [key, cookie] of this.data) {
      if (matchesDomain(cookie, domain)) {
        this.data.delete(key);
        deleted++;
      }
    }
    if (deleted > 0) this.persist();
    return deleted;
  }

  async flush(): Promise<void> {
    this.persist();
  }

  get count(): number {
    this.evictExpired();
    return this.data.size;
  }

  dispose(): void {
    this.data.clear();
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// PERSISTENT SESSIONS STORE
// ─────────────────────────────────────────────────────────────────────────────

const SESSIONS_STORAGE_KEY = 'nova-sessions';
const SESSIONS_CURRENT_KEY = 'nova-current-session';
const DEFAULT_VERSION = '1.0.0';

class PersistentSessionsStore implements ISessionsStore {
  private readonly storage: Storage | null;
  private sessions: Map<string, SessionData>;
  private currentSessionId: string | null;

  constructor(storage?: Storage) {
    this.storage = storage ?? null;
    const stored = loadJson<Record<string, SessionData>>(this.storage, SESSIONS_STORAGE_KEY);
    this.sessions = stored ? new Map(Object.entries(stored)) : new Map();
    this.currentSessionId = this.storage?.getItem(SESSIONS_CURRENT_KEY) ?? null;
  }

  private persist(): void {
    saveJson(this.storage, SESSIONS_STORAGE_KEY, Object.fromEntries(this.sessions));
    if (this.storage) {
      if (this.currentSessionId) {
        this.storage.setItem(SESSIONS_CURRENT_KEY, this.currentSessionId);
      } else {
        this.storage.removeItem(SESSIONS_CURRENT_KEY);
      }
    }
  }

  async save(session: SessionData): Promise<void> {
    const data: SessionData = {
      ...session,
      lastUpdated: Date.now(),
      version: session.version || DEFAULT_VERSION,
    };
    this.sessions.set(session.id, data);
    this.persist();
  }

  async load(sessionId: string): Promise<SessionData | null> {
    return this.sessions.get(sessionId) ?? null;
  }

  async list(): Promise<SessionData[]> {
    return [...this.sessions.values()]
      .sort((a, b) => b.lastUpdated - a.lastUpdated);
  }

  async delete(sessionId: string): Promise<boolean> {
    const result = this.sessions.delete(sessionId);
    if (result) this.persist();
    return result;
  }

  getCurrentSessionId(): string | null {
    return this.currentSessionId;
  }

  setCurrentSessionId(id: string | null): void {
    this.currentSessionId = id;
    this.persist();
  }

  get count(): number {
    return this.sessions.size;
  }

  dispose(): void {
    this.sessions.clear();
    this.currentSessionId = null;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// PERSISTENT BOOKMARK STORE
// ─────────────────────────────────────────────────────────────────────────────

const BOOKMARK_STORAGE_KEY = 'nova-bookmarks';

class PersistentBookmarkStore implements IBookmarkStore {
  private readonly storage: Storage | null;
  private entries: Map<string, BookmarkEntry>;

  constructor(storage?: Storage) {
    this.storage = storage ?? null;
    const stored = loadJson<Record<string, BookmarkEntry>>(this.storage, BOOKMARK_STORAGE_KEY);
    this.entries = stored ? new Map(Object.entries(stored)) : new Map();
  }

  private persist(): void {
    saveJson(this.storage, BOOKMARK_STORAGE_KEY, Object.fromEntries(this.entries));
  }

  async create(options: {
    parentId?: string | null;
    title: string;
    url?: string;
    iconUrl?: string;
  }): Promise<BookmarkEntry> {
    const now = Date.now();
    const id = generateSecureId();
    const parentId = options.parentId ?? null;

    const entry: BookmarkEntry = {
      id,
      parentId,
      title: options.title,
      url: options.url ?? null,
      iconUrl: options.iconUrl ?? null,
      addedTime: now,
      lastModifiedTime: now,
      children: [],
      folder: false,
      synced: false,
    };

    this.entries.set(id, entry);
    if (parentId) {
      const parent = this.entries.get(parentId);
      if (parent) {
        (parent.children as BookmarkEntry[]).push(entry);
      }
    }

    this.persist();
    return entry;
  }

  async createFolder(title: string, parentId?: string | null): Promise<BookmarkEntry> {
    const now = Date.now();
    const id = generateSecureId();
    const pId = parentId ?? null;

    const folder: BookmarkEntry = {
      id,
      parentId: pId,
      title,
      url: null,
      iconUrl: null,
      addedTime: now,
      lastModifiedTime: now,
      children: [],
      folder: true,
      synced: false,
    };

    this.entries.set(id, folder);
    if (pId) {
      const parent = this.entries.get(pId);
      if (parent) {
        (parent.children as BookmarkEntry[]).push(folder);
      }
    }

    this.persist();
    return folder;
  }

  async get(id: string): Promise<BookmarkEntry | null> {
    return this.entries.get(id) ?? null;
  }

  async getChildren(parentId: string | null): Promise<readonly BookmarkEntry[]> {
    return [...this.entries.values()]
      .filter(e => e.parentId === parentId)
      .sort((a, b) => a.addedTime - b.addedTime);
  }

  async getTree(): Promise<readonly BookmarkEntry[]> {
    return this.getChildren(null);
  }

  async query(options: BookmarkQuery): Promise<readonly BookmarkEntry[]> {
    let results = [...this.entries.values()];

    if (options.folderOnly) results = results.filter(e => e.folder);

    if (options.query) {
      const q = options.query.toLowerCase();
      results = results.filter(
        e => e.title.toLowerCase().includes(q) ||
             (e.url && e.url.toLowerCase().includes(q)),
      );
    }

    if (options.folderId) {
      const folder = this.entries.get(options.folderId);
      if (folder?.folder) return folder.children;
      return [];
    }

    return results.sort((a, b) => a.addedTime - b.addedTime);
  }

  async update(
    id: string,
    changes: Partial<Pick<BookmarkEntry, 'title' | 'url' | 'iconUrl'>>,
  ): Promise<BookmarkEntry | null> {
    const entry = this.entries.get(id);
    if (!entry) return null;

    const updated: BookmarkEntry = {
      id: entry.id,
      parentId: entry.parentId,
      title: changes.title ?? entry.title,
      url: changes.url !== undefined ? changes.url : entry.url,
      iconUrl: changes.iconUrl !== undefined ? changes.iconUrl : entry.iconUrl,
      addedTime: entry.addedTime,
      lastModifiedTime: Date.now(),
      children: entry.children,
      folder: entry.folder,
      synced: entry.synced,
    };

    this.entries.set(id, updated);
    this.persist();
    return updated;
  }

  async move(id: string, newParentId: string | null): Promise<boolean> {
    const entry = this.entries.get(id);
    if (!entry) return false;

    const oldParent = entry.parentId ? this.entries.get(entry.parentId) : null;
    if (oldParent) {
      const idx = oldParent.children.findIndex(c => c.id === id);
      if (idx !== -1) (oldParent.children as BookmarkEntry[]).splice(idx, 1);
    }

    (entry as { parentId: string | null }).parentId = newParentId;

    if (newParentId) {
      const newParent = this.entries.get(newParentId);
      if (newParent) {
        (newParent.children as BookmarkEntry[]).push(entry);
      }
    }

    this.persist();
    return true;
  }

  async remove(id: string): Promise<boolean> {
    const entry = this.entries.get(id);
    if (!entry) return false;
    if (!entry.folder && entry.parentId) {
      const parent = this.entries.get(entry.parentId);
      if (parent) {
        const idx = parent.children.findIndex(c => c.id === id);
        if (idx !== -1) (parent.children as BookmarkEntry[]).splice(idx, 1);
      }
    }
    const result = this.entries.delete(id);
    if (result) this.persist();
    return result;
  }

  async removeFolderTree(id: string): Promise<number> {
    const folder = this.entries.get(id);
    if (!folder || !folder.folder) return 0;

    let count = 0;
    const toRemove = [id];
    while (toRemove.length > 0) {
      const currentId = toRemove.pop()!;
      const current = this.entries.get(currentId);
      if (!current) continue;

      for (const child of current.children) {
        toRemove.push(child.id);
      }

      if (current.parentId) {
        const parent = this.entries.get(current.parentId);
        if (parent) {
          const idx = parent.children.findIndex(c => c.id === current.id);
          if (idx !== -1) (parent.children as BookmarkEntry[]).splice(idx, 1);
        }
      }

      this.entries.delete(currentId);
      count++;
    }

    if (count > 0) this.persist();
    return count;
  }

  get totalBookmarks(): number {
    return [...this.entries.values()].filter(e => !e.folder).length;
  }

  get totalFolders(): number {
    return [...this.entries.values()].filter(e => e.folder).length;
  }

  dispose(): void {
    this.entries.clear();
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// PERSISTENT HISTORY STORE
// ─────────────────────────────────────────────────────────────────────────────

const HISTORY_STORAGE_KEY = 'nova-history';

interface SerializableHistoryEntry {
  readonly id: string;
  readonly url: string;
  readonly title: string;
  readonly visitTime: number;
  readonly visitCount: number;
  readonly typedCount: number;
  readonly lastVisitTime: number;
}

class PersistentHistoryStore implements IHistoryStore {
  private readonly storage: Storage | null;
  private entries: Map<string, HistoryEntry>;
  private urlIndex: Map<string, string>;
  private idSeq: number;
  private static readonly MAX_ENTRIES = 10000;

  constructor(storage?: Storage) {
    this.storage = storage ?? null;
    const stored = loadJson<SerializableHistoryEntry[]>(this.storage, HISTORY_STORAGE_KEY);
    this.entries = new Map();
    this.urlIndex = new Map();
    this.idSeq = 0;

    if (stored) {
      for (const entry of stored) {
        this.entries.set(entry.id, entry);
        this.urlIndex.set(entry.url, entry.id);
        // Extract seq from id format: hist-{timestamp}-{seq}
        const parts = entry.id.split('-');
        const seq = parseInt(parts[parts.length - 1] ?? '0', 36);
        if (seq > this.idSeq) this.idSeq = seq;
      }
    }
  }

  private persist(): void {
    const arr = [...this.entries.values()];
    saveJson(this.storage, HISTORY_STORAGE_KEY, arr);
  }

  async addVisit(url: string, title: string, typed: boolean): Promise<HistoryEntry> {
    const existingId = this.urlIndex.get(url);
    if (existingId) {
      const existing = this.entries.get(existingId)!;
      const updated: HistoryEntry = {
        ...existing,
        title,
        visitCount: existing.visitCount + 1,
        typedCount: existing.typedCount + (typed ? 1 : 0),
        lastVisitTime: Date.now(),
      };
      this.entries.set(existingId, updated);
      this.persist();
      return updated;
    }

    if (this.entries.size >= PersistentHistoryStore.MAX_ENTRIES) {
      const oldest = [...this.entries.values()].sort((a, b) => a.lastVisitTime - b.lastVisitTime)[0];
      if (oldest) {
        this.entries.delete(oldest.id);
        this.urlIndex.delete(oldest.url);
      }
    }

    const id = `hist-${Date.now()}-${(++this.idSeq).toString(36)}`;
    const entry: HistoryEntry = {
      id,
      url,
      title,
      visitTime: Date.now(),
      visitCount: 1,
      typedCount: typed ? 1 : 0,
      lastVisitTime: Date.now(),
    };
    this.entries.set(id, entry);
    this.urlIndex.set(url, id);
    this.persist();
    return entry;
  }

  async query(options: HistoryQuery): Promise<HistoryQueryResult> {
    let filtered = [...this.entries.values()];

    if (options.query) {
      const q = options.query.toLowerCase();
      filtered = filtered.filter(
        e => e.url.toLowerCase().includes(q) || e.title.toLowerCase().includes(q),
      );
    }

    if (options.fromTime !== undefined) {
      filtered = filtered.filter(e => e.lastVisitTime >= options.fromTime!);
    }
    if (options.toTime !== undefined) {
      filtered = filtered.filter(e => e.lastVisitTime <= options.toTime!);
    }

    filtered.sort((a, b) => b.lastVisitTime - a.lastVisitTime);

    const totalCount = filtered.length;
    const offset = options.offset ?? 0;
    const limit = options.maxResults ?? 50;
    const page = filtered.slice(offset, offset + limit);

    return {
      entries: page,
      totalCount,
      hasMore: offset + limit < totalCount,
    };
  }

  async getRecent(maxResults = 50): Promise<readonly HistoryEntry[]> {
    const sorted = [...this.entries.values()]
      .sort((a, b) => b.lastVisitTime - a.lastVisitTime || b.visitTime - a.visitTime || String(b.id).localeCompare(String(a.id)));
    return sorted.slice(0, maxResults);
  }

  async getFrecents(maxResults = 50): Promise<readonly HistoryEntry[]> {
    const scored = [...this.entries.values()]
      .map(e => ({ entry: e, score: e.visitCount * 0.3 + e.typedCount * 0.7 }))
      .sort((a, b) => b.score - a.score || b.entry.lastVisitTime - a.entry.lastVisitTime);
    return scored.slice(0, maxResults).map(s => s.entry);
  }

  async deleteEntry(id: string): Promise<boolean> {
    const entry = this.entries.get(id);
    if (!entry) return false;
    this.urlIndex.delete(entry.url);
    const result = this.entries.delete(id);
    if (result) this.persist();
    return result;
  }

  async deleteRange(fromTime: number, toTime: number): Promise<number> {
    let deleted = 0;
    for (const [id, entry] of this.entries) {
      if (entry.lastVisitTime >= fromTime && entry.lastVisitTime <= toTime) {
        this.urlIndex.delete(entry.url);
        this.entries.delete(id);
        deleted++;
      }
    }
    if (deleted > 0) this.persist();
    return deleted;
  }

  async deleteAll(): Promise<void> {
    this.entries.clear();
    this.urlIndex.clear();
    this.persist();
  }

  async getEntryByUrl(url: string): Promise<HistoryEntry | null> {
    const id = this.urlIndex.get(url);
    return id ? (this.entries.get(id) ?? null) : null;
  }

  get totalEntries(): number {
    return this.entries.size;
  }

  dispose(): void {
    this.entries.clear();
    this.urlIndex.clear();
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// PERSISTENT TOKEN STORE
// ─────────────────────────────────────────────────────────────────────────────

const TOKEN_STORAGE_KEY = 'nova-tokens';

class PersistentTokenStore implements ITokenStore {
  private readonly entries = new Map<string, TokenEntry>();
  private readonly config: TokenStoreConfig;
  private readonly storage: Storage | null;
  private idSeq = 0;
  private _initialized = false;

  constructor(config: TokenStoreConfig, storage?: Storage) {
    this.config = config;
    this.storage = storage ?? null;
    this.loadFromStorage();
  }

  private loadFromStorage(): void {
    const stored = loadJson<TokenEntry[]>(this.storage, TOKEN_STORAGE_KEY);
    if (stored) {
      for (const entry of stored) {
        this.entries.set(entry.id, entry);
        const match = entry.id.match(/tok-(\w+)/);
        if (match) {
          const seq = parseInt(match[1], 36);
          if (seq > this.idSeq) this.idSeq = seq;
        }
      }
    }
  }

  private persist(): void {
    saveJson(this.storage, TOKEN_STORAGE_KEY, [...this.entries.values()]);
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

    if (this.config.maxTokensPerProvider > 0) {
      const providerEntries = this.getByProvider(entry.provider);
      if (providerEntries.length > this.config.maxTokensPerProvider) {
        const sorted = [...providerEntries].sort((a, b) => a.createdAt - b.createdAt);
        const excess = sorted.length - this.config.maxTokensPerProvider;
        for (let i = 0; i < excess; i++) {
          this.entries.delete(sorted[i]!.id);
        }
      }
    }

    this.persist();
    return tokenEntry;
  }

  get(id: string): TokenEntry | null {
    const entry = this.entries.get(id) ?? null;
    if (entry && this.config.autoCleanupExpired && this.isExpired(entry)) {
      this.entries.delete(id);
      this.persist();
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
    this.persist();
    return updated;
  }

  remove(id: string): boolean {
    const result = this.entries.delete(id);
    if (result) this.persist();
    return result;
  }

  removeByProvider(provider: AuthProtocol): number {
    let count = 0;
    for (const [id, entry] of this.entries) {
      if (entry.provider === provider) {
        this.entries.delete(id);
        count++;
      }
    }
    if (count > 0) this.persist();
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
    if (count > 0) this.persist();
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
    if (count > 0) this.persist();
    return count;
  }

  dispose(): void {
    this.entries.clear();
  }

  private isExpired(entry: TokenEntry): boolean {
    return entry.token.expiresAt !== null && entry.token.expiresAt < Date.now();
  }
}

export {
  PersistentCookieStore,
  PersistentSessionsStore,
  PersistentBookmarkStore,
  PersistentHistoryStore,
  PersistentTokenStore,
};

// ─────────────────────────────────────────────────────────────────────────────
// PERSISTENT PASSWORD STORE
// ─────────────────────────────────────────────────────────────────────────────

const PASSWORD_STORAGE_KEY = 'nova-passwords';

/**
 * localStorage-backed password store. Encrypted payloads (AES-GCM hex) are
 * JSON-serializable, so the full entry set survives reloads. The master
 * password itself is never persisted — it must be re-entered each session,
 * matching how Chrome/Edge derive the vault key from the OS login.
 */
class PersistentPasswordStore extends InMemoryPasswordStore implements IPasswordStore {
  private readonly storage: Storage | null;

  constructor(storage?: Storage) {
    super();
    this.storage = storage ?? null;
    const stored = loadJson<PasswordEntry[]>(this.storage, PASSWORD_STORAGE_KEY);
    if (stored) {
      for (const entry of stored) {
        this.entries.set(entry.id, entry);
      }
    }
  }

  private persist(): void {
    saveJson(this.storage, PASSWORD_STORAGE_KEY, [...this.entries.values()]);
  }

  override async add(data: PasswordEntryData): Promise<PasswordEntry> {
    const entry = await super.add(data);
    this.persist();
    return entry;
  }

  override async update(
    id: string,
    changes: Partial<Pick<PasswordEntryData, 'username' | 'password' | 'note' | 'tags' | 'url'>>,
  ): Promise<PasswordEntry | null> {
    const updated = await super.update(id, changes);
    if (updated) this.persist();
    return updated;
  }

  override async remove(id: string): Promise<boolean> {
    const removed = await super.remove(id);
    if (removed) this.persist();
    return removed;
  }

  override async removeByHostname(hostname: string): Promise<number> {
    const removed = await super.removeByHostname(hostname);
    if (removed > 0) this.persist();
    return removed;
  }

  override async rotateMasterKey(oldPassword: string, newPassword: string): Promise<number> {
    const rotated = await super.rotateMasterKey(oldPassword, newPassword);
    if (rotated > 0) this.persist();
    return rotated;
  }

  override async importRaw(entries: readonly PasswordEntry[]): Promise<number> {
    const imported = await super.importRaw(entries);
    if (imported > 0) this.persist();
    return imported;
  }

  override dispose(): void {
    super.dispose();
  }
}

export { PersistentPasswordStore };
