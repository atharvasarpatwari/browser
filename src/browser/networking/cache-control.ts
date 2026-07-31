/**
 * @file src/browser/networking/cache-control.ts
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * RESPONSIBILITY
 * ─────────────────────────────────────────────────────────────────────────────
 * HTTP cache control layer that coordinates between an in-memory cache and
 * a simulated disk cache, applying RFC 7234 cache semantics: freshness
 * assessment, revalidation with ETag/Last-Modified, cache directives
 * (no-store, no-cache, must-revalidate, immutable), and Vary header support.
 *
 * This layer sits above the existing CacheManager (pure memory store) and
 * adds the policy intelligence that decides WHEN to cache and HOW to serve.
 *
 * Pipeline position
 * ─────────────────
 *   ResponseParser.parse(response)
 *        │
 *        ▼
 *   CacheControl.handleResponse(url, parsedResponse)
 *        │
 *        ├──▶ cacheable? → store in memory + disk
 *        └──▶ not cacheable → skip
 *
 *   RequestManager.send(request)
 *        │
 *        ▼
 *   CacheControl.handleRequest(url)
 *        │
 *        ├──▶ fresh?        → return cached response
 *        ├──▶ stale+etag?   → revalidate (If-None-Match)
 *        ├──▶ stale+lm?     → revalidate (If-Modified-Since)
 *        └──▶ no cache?     → forward request
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * OOP PRINCIPLES
 * ─────────────────────────────────────────────────────────────────────────────
 *  Abstraction      ICacheControl hides storage behind get/set.
 *  Encapsulation    Freshness and revalidation logic is private.
 *  Single-Resp.     This file handles cache policy — storage is separate.
 *  Open / Closed    New storage backends implement ICacheStorage.
 *  Dependency-Inv.  Callers depend on ICacheControl, not the concrete.
 */

import type { IDisposable } from '../../app/dependency-container';
import type { CacheDirectives } from './response-parser';

// ─────────────────────────────────────────────────────────────────────────────
// VALUE OBJECTS
// ─────────────────────────────────────────────────────────────────────────────

/** A complete cached response entry. */
interface CachedResponse {
  readonly url: string;
  readonly statusCode: number;
  readonly headers: ReadonlyMap<string, string>;
  readonly body: string;
  readonly contentType: string;
  readonly cachedAt: number;
  readonly expiresAt: number | null;
  readonly etag: string | null;
  readonly lastModified: string | null;
  readonly immutable: boolean;
  readonly vary: ReadonlyMap<string, string>;
  readonly cacheControl: CacheDirectives;
  /** Whether this entry is stored in the disk cache (vs memory-only). */
  readonly onDisk: boolean;
}

/** Result of a cache lookup for a request. */
interface CacheLookupResult {
  /** Whether a cached entry was found. */
  readonly found: boolean;
  /** The cached response (null if not found). */
  readonly response: CachedResponse | null;
  /** Whether the cache entry is still fresh (can be served without revalidation). */
  readonly fresh: boolean;
  /** Whether revalidation headers should be added to the request. */
  readonly needsRevalidation: boolean;
  /** Headers to add to the outgoing request for revalidation. */
  readonly revalidationHeaders: ReadonlyMap<string, string>;
  /** Whether the response came from the disk cache. */
  readonly fromDisk: boolean;
}

/** Strategy for where to store cached entries. */
enum CacheStorageStrategy {
  /** Only use in-memory cache. */
  MemoryOnly  = 'memory-only',
  /** Only use disk cache. */
  DiskOnly    = 'disk-only',
  /** Memory for hot entries, disk for cold entries. */
  Tiered      = 'tiered',
}

/** Configuration for cache control behavior. */
interface CacheControlConfig {
  /** Maximum age in seconds for memory cache entries. */
  readonly memoryMaxAgeSeconds: number;
  /** Maximum age in seconds for disk cache entries. */
  readonly diskMaxAgeSeconds: number;
  /** Maximum number of entries in memory cache. */
  readonly memoryMaxEntries: number;
  /** Maximum number of entries in disk cache. */
  readonly diskMaxEntries: number;
  /** Maximum size in bytes for disk cache. */
  readonly diskMaxSizeBytes: number;
  /** Storage strategy. */
  readonly storageStrategy: CacheStorageStrategy;
  /** Whether to respect Cache-Control: no-store. */
  readonly respectNoStore: boolean;
  /** Whether to respect Cache-Control: no-cache. */
  readonly respectNoCache: boolean;
  /** Default TTL in seconds when not specified by the server. */
  readonly defaultTtlSeconds: number;
}

/** Stats about cache performance. */
interface CacheControlStats {
  readonly memoryEntries: number;
  readonly diskEntries: number;
  readonly totalEntries: number;
  readonly memoryHits: number;
  readonly diskHits: number;
  readonly misses: number;
  readonly revalidations: number;
  readonly evictions: number;
  readonly totalSizeBytes: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// PUBLIC CONTRACT
// ─────────────────────────────────────────────────────────────────────────────

/** Interface for a cache storage backend. */
interface ICacheStorage {
  get(key: string): Promise<CachedResponse | null>;
  set(key: string, entry: CachedResponse): Promise<void>;
  delete(key: string): Promise<boolean>;
  clear(): Promise<void>;
  size(): number;
}

interface ICacheControl extends IDisposable {
  /** Check if a URL has a cached response. */
  lookup(url: string): Promise<CacheLookupResult>;
  /** Store a response in the cache (subject to cache directives). */
  store(url: string, headers: ReadonlyMap<string, string>, body: string, statusCode: number): Promise<void>;
  /** Invalidate (delete) a cached entry. */
  invalidate(url: string): Promise<boolean>;
  /** Prune expired entries from all storage tiers. */
  prune(): Promise<number>;
  /** Get the revalidation headers needed for a stale entry. */
  getRevalidationHeaders(url: string): Promise<ReadonlyMap<string, string>>;
  /** Get cache stats. */
  getStats(): CacheControlStats;
  /** Get current config. */
  getConfig(): CacheControlConfig;
  /** Update config. */
  updateConfig(config: Partial<CacheControlConfig>): void;
}

// ─────────────────────────────────────────────────────────────────────────────
// CONSTANTS
// ─────────────────────────────────────────────────────────────────────────────

const DEFAULT_CACHE_CONTROL_CONFIG: CacheControlConfig = {
  memoryMaxAgeSeconds: 300,         // 5 minutes in memory
  diskMaxAgeSeconds:   86400,       // 24 hours on disk
  memoryMaxEntries:    500,
  diskMaxEntries:      5000,
  diskMaxSizeBytes:    100 * 1024 * 1024, // 100 MB
  storageStrategy:     CacheStorageStrategy.Tiered,
  respectNoStore:      true,
  respectNoCache:      true,
  defaultTtlSeconds:   60,
};

// ─────────────────────────────────────────────────────────────────────────────
// IN-MEMORY CACHE STORAGE
// ─────────────────────────────────────────────────────────────────────────────

class MemoryCacheStorage implements ICacheStorage {
  private readonly store = new Map<string, CachedResponse>();

  async get(key: string): Promise<CachedResponse | null> {
    return this.store.get(key) ?? null;
  }

  async set(key: string, entry: CachedResponse): Promise<void> {
    this.store.set(key, entry);
  }

  async delete(key: string): Promise<boolean> {
    return this.store.delete(key);
  }

  async clear(): Promise<void> {
    this.store.clear();
  }

  size(): number {
    return this.store.size;
  }

  entries(): IterableIterator<[string, CachedResponse]> {
    return this.store.entries();
  }

  dispose(): void {
    this.store.clear();
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// DISK CACHE STORAGE (simulated)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Simulated disk cache storage.
 * In a real browser, this would use IndexedDB or the File System Access API.
 * Here it provides the same interface backed by a Map for testing.
 */
class DiskCacheStorage implements ICacheStorage {
  private readonly store = new Map<string, CachedResponse>();
  private totalSizeBytes = 0;

  async get(key: string): Promise<CachedResponse | null> {
    return this.store.get(key) ?? null;
  }

  async set(key: string, entry: CachedResponse): Promise<void> {
    const existing = this.store.get(key);
    if (existing) {
      this.totalSizeBytes -= existing.body.length;
    }
    this.store.set(key, entry);
    this.totalSizeBytes += entry.body.length;
  }

  async delete(key: string): Promise<boolean> {
    const entry = this.store.get(key);
    if (entry) {
      this.totalSizeBytes -= entry.body.length;
    }
    return this.store.delete(key);
  }

  async clear(): Promise<void> {
    this.store.clear();
    this.totalSizeBytes = 0;
  }

  size(): number {
    return this.store.size;
  }

  getTotalSizeBytes(): number {
    return this.totalSizeBytes;
  }

  entries(): IterableIterator<[string, CachedResponse]> {
    return this.store.entries();
  }

  dispose(): void {
    this.store.clear();
    this.totalSizeBytes = 0;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// CACHE CONTROL
// ─────────────────────────────────────────────────────────────────────────────

class CacheControl implements ICacheControl {
  private readonly memoryStorage: MemoryCacheStorage;
  private readonly diskStorage: DiskCacheStorage;
  private config: CacheControlConfig;
  private memoryHits = 0;
  private diskHits = 0;
  private misses = 0;
  private revalidations = 0;
  private evictions = 0;

  constructor(config?: Partial<CacheControlConfig>) {
    this.config = { ...DEFAULT_CACHE_CONTROL_CONFIG, ...config };
    this.memoryStorage = new MemoryCacheStorage();
    this.diskStorage = new DiskCacheStorage();
  }

  // ── ICacheControl: lookup ──────────────────────────────────────────

  async lookup(url: string): Promise<CacheLookupResult> {
    // Memory first.
    const memEntry = await this.memoryStorage.get(url);
    if (memEntry) {
      const fresh = this.isFresh(memEntry);
      this.memoryHits++;

      if (fresh) {
        return {
          found: true, response: memEntry, fresh: true,
          needsRevalidation: false, revalidationHeaders: new Map(), fromDisk: false,
        };
      }

      // Stale — check if we can revalidate.
      if (memEntry.etag || memEntry.lastModified) {
        return {
          found: true, response: memEntry, fresh: false,
          needsRevalidation: true,
          revalidationHeaders: this.buildRevalidationHeaders(memEntry),
          fromDisk: false,
        };
      }

      // Stale, no revalidation possible — treat as miss.
      return {
        found: false, response: null, fresh: false,
        needsRevalidation: false, revalidationHeaders: new Map(), fromDisk: false,
      };
    }

    // Disk.
    if (this.config.storageStrategy !== CacheStorageStrategy.MemoryOnly) {
      const diskEntry = await this.diskStorage.get(url);
      if (diskEntry) {
        const fresh = this.isFresh(diskEntry);
        this.diskHits++;

        if (fresh) {
          return {
            found: true, response: diskEntry, fresh: true,
            needsRevalidation: false, revalidationHeaders: new Map(), fromDisk: true,
          };
        }

        if (diskEntry.etag || diskEntry.lastModified) {
          return {
            found: true, response: diskEntry, fresh: false,
            needsRevalidation: true,
            revalidationHeaders: this.buildRevalidationHeaders(diskEntry),
            fromDisk: true,
          };
        }

        return {
          found: false, response: null, fresh: false,
          needsRevalidation: false, revalidationHeaders: new Map(), fromDisk: true,
        };
      }
    }

    this.misses++;
    return {
      found: false, response: null, fresh: false,
      needsRevalidation: false, revalidationHeaders: new Map(), fromDisk: false,
    };
  }

  // ── ICacheControl: store ───────────────────────────────────────────

  async store(
    url: string,
    headers: ReadonlyMap<string, string>,
    body: string,
    statusCode: number,
  ): Promise<void> {
    const cc = this.parseCacheControl(headers);

    // Respect no-store.
    if (this.config.respectNoStore && cc.noStore) return;

    // Only cache successful responses.
    if (statusCode < 200 || statusCode >= 400) return;

    const expiresAt = this.computeExpiresAt(cc);
    const entry: CachedResponse = {
      url,
      statusCode,
      headers,
      body,
      contentType: headers.get('content-type') ?? 'text/html',
      cachedAt: Date.now(),
      expiresAt,
      etag: headers.get('etag') ?? null,
      lastModified: headers.get('last-modified') ?? null,
      immutable: cc.immutable,
      vary: this.parseVary(headers),
      cacheControl: cc,
      onDisk: false,
    };

    // Decide storage tier.
    const useMemory = this.config.storageStrategy === CacheStorageStrategy.MemoryOnly ||
                      this.config.storageStrategy === CacheStorageStrategy.Tiered;
    const useDisk = this.config.storageStrategy === CacheStorageStrategy.DiskOnly ||
                    this.config.storageStrategy === CacheStorageStrategy.Tiered;

    if (useMemory && this.memoryStorage.size() < this.config.memoryMaxEntries) {
      await this.memoryStorage.set(url, entry);
    }

    if (useDisk && this.diskStorage.size() < this.config.diskMaxEntries) {
      await this.diskStorage.set(url, { ...entry, onDisk: true });
    }
  }

  // ── ICacheControl: invalidate ──────────────────────────────────────

  async invalidate(url: string): Promise<boolean> {
    const memDeleted = await this.memoryStorage.delete(url);
    const diskDeleted = await this.diskStorage.delete(url);
    return memDeleted || diskDeleted;
  }

  // ── ICacheControl: prune ───────────────────────────────────────────

  async prune(): Promise<number> {
    let pruned = 0;
    const now = Date.now();

    // Prune memory.
    for (const [key, entry] of this.memoryStoreIterator()) {
      if (entry.expiresAt !== null && entry.expiresAt <= now) {
        await this.memoryStorage.delete(key);
        pruned++;
        this.evictions++;
      }
    }

    // Prune disk.
    for (const [key, entry] of this.diskStoreIterator()) {
      if (entry.expiresAt !== null && entry.expiresAt <= now) {
        await this.diskStorage.delete(key);
        pruned++;
        this.evictions++;
      }
    }

    return pruned;
  }

  // ── ICacheControl: revalidation headers ────────────────────────────

  async getRevalidationHeaders(url: string): Promise<ReadonlyMap<string, string>> {
    const result = await this.lookup(url);
    if (result.needsRevalidation && result.response) {
      return this.buildRevalidationHeaders(result.response);
    }
    return new Map();
  }

  // ── ICacheControl: stats / config ──────────────────────────────────

  getStats(): CacheControlStats {
    return {
      memoryEntries: this.memoryStorage.size(),
      diskEntries: this.diskStorage.size(),
      totalEntries: this.memoryStorage.size() + this.diskStorage.size(),
      memoryHits: this.memoryHits,
      diskHits: this.diskHits,
      misses: this.misses,
      revalidations: this.revalidations,
      evictions: this.evictions,
      totalSizeBytes: this.diskStorage.getTotalSizeBytes(),
    };
  }

  getConfig(): CacheControlConfig {
    return { ...this.config };
  }

  updateConfig(config: Partial<CacheControlConfig>): void {
    this.config = { ...this.config, ...config };
  }

  // ── IDisposable ─────────────────────────────────────────────────────

  dispose(): void {
    this.memoryStorage.dispose();
    this.diskStorage.dispose();
    this.memoryHits = 0;
    this.diskHits = 0;
    this.misses = 0;
    this.revalidations = 0;
    this.evictions = 0;
  }

  // ── Private: freshness ──────────────────────────────────────────────

  private isFresh(entry: CachedResponse): boolean {
    if (entry.immutable) return true;
    if (entry.expiresAt === null) return false;
    return entry.expiresAt > Date.now();
  }

  private computeExpiresAt(cc: CacheDirectives): number | null {
    // Immutable — never expires.
    if (cc.immutable) return Date.now() + 365 * 24 * 60 * 60 * 1000;

    // max-age.
    if (cc.maxAge !== null) {
      return Date.now() + cc.maxAge * 1000;
    }

    // s-maxage overrides max-age for shared caches.
    if (cc.sMaxAge !== null) {
      return Date.now() + cc.sMaxAge * 1000;
    }

    // Expires header.
    if (cc.expires) {
      return cc.expires.getTime();
    }

    // Default.
    return Date.now() + this.config.defaultTtlSeconds * 1000;
  }

  // ── Private: revalidation ──────────────────────────────────────────

  private buildRevalidationHeaders(entry: CachedResponse): Map<string, string> {
    const headers = new Map<string, string>();

    if (entry.etag) {
      headers.set('if-none-match', entry.etag);
    }
    if (entry.lastModified) {
      headers.set('if-modified-since', entry.lastModified);
    }

    this.revalidations++;
    return headers;
  }

  // ── Private: parsing ────────────────────────────────────────────────

  private parseCacheControl(headers: ReadonlyMap<string, string>): CacheDirectives {
    const cc = headers.get('cache-control') ?? '';
    const directives = new Set<string>();
    for (const part of cc.split(',')) {
      directives.add(part.trim().toLowerCase());
    }

    const maxAge = this.extractSeconds(directives, 'max-age');
    const sMaxAge = this.extractSeconds(directives, 's-maxage');
    const etag = headers.get('etag') ?? null;
    const lastModified = headers.get('last-modified') ?? null;
    const expires = this.parseDate(headers.get('expires') ?? '');

    const noStore = directives.has('no-store');
    const noCache = directives.has('no-cache');
    const mustRevalidate = directives.has('must-revalidate');
    const isPrivate = directives.has('private');
    const isPublic = directives.has('public');
    const immutable = directives.has('immutable');

    const effective = sMaxAge ?? maxAge;
    const isCacheable = !noStore && (
      effective !== null ? effective > 0
                         : etag !== null || lastModified !== null || expires !== null
    );

    return {
      noStore, noCache, mustRevalidate, isPrivate, isPublic,
      maxAge, sMaxAge, immutable, etag, lastModified, expires, isCacheable,
    };
  }

  private parseVary(headers: ReadonlyMap<string, string>): ReadonlyMap<string, string> {
    const vary = headers.get('vary');
    if (!vary) return new Map();
    const result = new Map<string, string>();
    for (const field of vary.split(',')) {
      const trimmed = field.trim().toLowerCase();
      if (trimmed) result.set(trimmed, headers.get(trimmed) ?? '');
    }
    return result;
  }

  private extractSeconds(directives: Set<string>, key: string): number | null {
    for (const d of directives) {
      if (d.startsWith(key + '=')) {
        const v = parseInt(d.slice(key.length + 1), 10);
        return Number.isFinite(v) ? v : null;
      }
    }
    return null;
  }

  private parseDate(raw: string): Date | null {
    if (!raw) return null;
    try {
      const d = new Date(raw);
      return isNaN(d.getTime()) ? null : d;
    } catch { return null; }
  }

  // ── Private: iterators ──────────────────────────────────────────────

  private *memoryStoreIterator(): IterableIterator<[string, CachedResponse]> {
    yield* this.memoryStorage.entries();
  }

  private *diskStoreIterator(): IterableIterator<[string, CachedResponse]> {
    yield* this.diskStorage.entries();
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// EXPORTS
// ─────────────────────────────────────────────────────────────────────────────

export {
  CacheControl,
  MemoryCacheStorage,
  DiskCacheStorage,
  CacheStorageStrategy,
  DEFAULT_CACHE_CONTROL_CONFIG,
};

export type {
  ICacheControl,
  ICacheStorage,
  CachedResponse,
  CacheLookupResult,
  CacheControlConfig,
  CacheControlStats,
};
