import type { IDisposable } from '../../app/dependency-container';

interface CacheEntry {
  readonly key: string;
  readonly url: string;
  readonly body: string;
  readonly headers: ReadonlyMap<string, string>;
  readonly contentType: string;
  readonly statusCode: number;
  readonly createdAt: number;
  readonly expiresAt: number | null;
  readonly lastAccessedAt: number;
  readonly etag: string | null;
  readonly lastModified: string | null;
  readonly immutable: boolean;
  readonly sizeBytes: number;
}

interface CachePolicy {
  readonly maxSizeBytes: number;
  readonly maxEntries: number;
  readonly defaultTtlMs: number;
  readonly enableEtagRevalidation: boolean;
}

const DEFAULT_CACHE_POLICY: CachePolicy = {
  maxSizeBytes: 50 * 1024 * 1024,
  maxEntries: 500,
  defaultTtlMs: 5 * 60 * 1000,
  enableEtagRevalidation: true,
};

interface CacheQuery {
  readonly url?: string;
  readonly contentType?: string;
  readonly minSize?: number;
  readonly maxSize?: number;
}

interface CacheStats {
  readonly totalEntries: number;
  readonly totalSizeBytes: number;
  readonly hitCount: number;
  readonly missCount: number;
  readonly evictionCount: number;
  readonly hitRate: number;
}

interface ICacheManager extends IDisposable {
  get(url: string): Promise<CacheEntry | null>;
  set(url: string, entry: Omit<CacheEntry, 'key' | 'createdAt' | 'lastAccessedAt' | 'sizeBytes'>): Promise<void>;
  delete(url: string): Promise<boolean>;
  clear(): Promise<void>;
  has(url: string): Promise<boolean>;
  getStats(): CacheStats;
  query(filter: CacheQuery): Promise<readonly CacheEntry[]>;
  getPolicy(): CachePolicy;
  updatePolicy(policy: Partial<CachePolicy>): void;
  prune(): Promise<number>;
}

class CacheManager implements ICacheManager {
  private readonly store = new Map<string, CacheEntry>();
  private policy: CachePolicy;
  private hitCount = 0;
  private missCount = 0;
  private evictionCount = 0;
  private totalSizeBytes = 0;

  constructor(policy?: Partial<CachePolicy>) {
    this.policy = { ...DEFAULT_CACHE_POLICY, ...policy };
  }

  async get(url: string): Promise<CacheEntry | null> {
    const entry = this.store.get(url);
    if (!entry) {
      this.missCount++;
      return null;
    }

    if (entry.expiresAt !== null && entry.expiresAt < Date.now()) {
      this.store.delete(url);
      this.totalSizeBytes -= entry.sizeBytes;
      this.missCount++;
      return null;
    }

    const updated: CacheEntry = {
      ...entry,
      lastAccessedAt: Date.now(),
    };
    this.store.set(url, updated);
    this.hitCount++;
    return updated;
  }

  async set(url: string, data: Omit<CacheEntry, 'key' | 'createdAt' | 'lastAccessedAt' | 'sizeBytes'>): Promise<void> {
    const sizeBytes = data.body.length;
    const createdAt = Date.now();

    const expiresAt = data.expiresAt ?? (createdAt + this.policy.defaultTtlMs);

    const entry: CacheEntry = {
      key: url,
      url,
      body: data.body,
      headers: data.headers,
      contentType: data.contentType,
      statusCode: data.statusCode,
      createdAt,
      expiresAt,
      lastAccessedAt: createdAt,
      etag: data.etag,
      lastModified: data.lastModified,
      immutable: data.immutable,
      sizeBytes,
    };

    if (this.totalSizeBytes + sizeBytes > this.policy.maxSizeBytes) {
      await this.evictSpace(sizeBytes);
    }

    if (this.store.size >= this.policy.maxEntries) {
      await this.evictEntries(1);
    }

    const existing = this.store.get(url);
    if (existing) {
      this.totalSizeBytes -= existing.sizeBytes;
    }

    this.store.set(url, entry);
    this.totalSizeBytes += sizeBytes;
  }

  async delete(url: string): Promise<boolean> {
    const entry = this.store.get(url);
    if (!entry) return false;
    this.totalSizeBytes -= entry.sizeBytes;
    return this.store.delete(url);
  }

  async clear(): Promise<void> {
    this.store.clear();
    this.totalSizeBytes = 0;
  }

  async has(url: string): Promise<boolean> {
    const entry = await this.get(url);
    return entry !== null;
  }

  getStats(): CacheStats {
    const total = this.hitCount + this.missCount;
    return {
      totalEntries: this.store.size,
      totalSizeBytes: this.totalSizeBytes,
      hitCount: this.hitCount,
      missCount: this.missCount,
      evictionCount: this.evictionCount,
      hitRate: total > 0 ? this.hitCount / total : 0,
    };
  }

  async query(filter: CacheQuery): Promise<readonly CacheEntry[]> {
    let results = [...this.store.values()];

    if (filter.url) {
      const q = filter.url.toLowerCase();
      results = results.filter(e => e.url.toLowerCase().includes(q));
    }
    if (filter.contentType) {
      results = results.filter(e => e.contentType.includes(filter.contentType!));
    }
    if (filter.minSize !== undefined) {
      results = results.filter(e => e.sizeBytes >= filter.minSize!);
    }
    if (filter.maxSize !== undefined) {
      results = results.filter(e => e.sizeBytes <= filter.maxSize!);
    }

    return results.sort((a, b) => b.lastAccessedAt - a.lastAccessedAt);
  }

  getPolicy(): CachePolicy {
    return { ...this.policy };
  }

  updatePolicy(policy: Partial<CachePolicy>): void {
    this.policy = { ...this.policy, ...policy };
  }

  async prune(): Promise<number> {
    const now = Date.now();
    let pruned = 0;

    for (const [url, entry] of this.store) {
      if (entry.expiresAt !== null && entry.expiresAt < now) {
        this.store.delete(url);
        this.totalSizeBytes -= entry.sizeBytes;
        pruned++;
      }
    }

    if (this.totalSizeBytes > this.policy.maxSizeBytes) {
      const sorted = [...this.store.values()]
        .sort((a, b) => a.lastAccessedAt - b.lastAccessedAt);

      while (this.totalSizeBytes > this.policy.maxSizeBytes && sorted.length > 0) {
        const oldest = sorted.shift()!;
        this.store.delete(oldest.url);
        this.totalSizeBytes -= oldest.sizeBytes;
        this.evictionCount++;
        pruned++;
      }
    }

    return pruned;
  }

  private async evictSpace(neededBytes: number): Promise<void> {
    const sorted = [...this.store.values()]
      .sort((a, b) => a.lastAccessedAt - b.lastAccessedAt);

    while (this.totalSizeBytes + neededBytes > this.policy.maxSizeBytes && sorted.length > 0) {
      const oldest = sorted.shift()!;
      this.store.delete(oldest.url);
      this.totalSizeBytes -= oldest.sizeBytes;
      this.evictionCount++;
    }
  }

  private async evictEntries(count: number): Promise<void> {
    const sorted = [...this.store.values()]
      .sort((a, b) => a.lastAccessedAt - b.lastAccessedAt);

    for (let i = 0; i < count && sorted.length > 0; i++) {
      const oldest = sorted.shift()!;
      this.store.delete(oldest.url);
      this.totalSizeBytes -= oldest.sizeBytes;
      this.evictionCount++;
    }
  }

  dispose(): void {
    this.store.clear();
    this.totalSizeBytes = 0;
    this.hitCount = 0;
    this.missCount = 0;
    this.evictionCount = 0;
  }
}

export { CacheManager, DEFAULT_CACHE_POLICY };
export type { ICacheManager, CacheEntry, CachePolicy, CacheQuery, CacheStats };
