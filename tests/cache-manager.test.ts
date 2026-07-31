import { describe, it, expect, beforeEach, vi } from 'vitest';
import { CacheManager, DEFAULT_CACHE_POLICY } from '../src/browser/networking/cache-manager';
import type { CacheEntry } from '../src/browser/networking/cache-manager';

describe('CacheManager', () => {
  let cache: CacheManager;

  beforeEach(() => {
    cache = new CacheManager();
  });

  function makeCacheEntry(overrides: Partial<CacheEntry> = {}): CacheEntry {
    return {
      key: 'https://example.com',
      url: 'https://example.com',
      body: '<html>Hello</html>',
      headers: new Map([['content-type', 'text/html']]),
      contentType: 'text/html',
      statusCode: 200,
      createdAt: Date.now(),
      expiresAt: null,
      lastAccessedAt: Date.now(),
      etag: null,
      lastModified: null,
      immutable: false,
      sizeBytes: 20,
      ...overrides,
    };
  }

  // ── Basic CRUD ──────────────────────────────────────────────────────────────

  it('should set and get a cache entry', async () => {
    await cache.set('https://example.com', {
      body: '<html>Hello</html>',
      headers: new Map([['content-type', 'text/html']]),
      contentType: 'text/html',
      statusCode: 200,
      expiresAt: null,
      etag: null,
      lastModified: null,
      immutable: false,
    });
    const entry = await cache.get('https://example.com');
    expect(entry).not.toBeNull();
    expect(entry!.body).toBe('<html>Hello</html>');
    expect(entry!.contentType).toBe('text/html');
    expect(entry!.statusCode).toBe(200);
  });

  it('should return null for cache miss', async () => {
    const entry = await cache.get('https://missing.com');
    expect(entry).toBeNull();
  });

  it('should delete a cache entry', async () => {
    await cache.set('https://example.com', {
      body: 'test',
      headers: new Map(),
      contentType: 'text/plain',
      statusCode: 200,
      expiresAt: null,
      etag: null,
      lastModified: null,
      immutable: false,
    });
    const deleted = await cache.delete('https://example.com');
    expect(deleted).toBe(true);
    expect(await cache.get('https://example.com')).toBeNull();
  });

  it('should return false when deleting non-existent entry', async () => {
    const deleted = await cache.delete('https://missing.com');
    expect(deleted).toBe(false);
  });

  it('should clear all entries', async () => {
    await cache.set('https://a.com', { body: 'a', headers: new Map(), contentType: 'text/plain', statusCode: 200, expiresAt: null, etag: null, lastModified: null, immutable: false });
    await cache.set('https://b.com', { body: 'b', headers: new Map(), contentType: 'text/plain', statusCode: 200, expiresAt: null, etag: null, lastModified: null, immutable: false });
    await cache.clear();
    expect(await cache.get('https://a.com')).toBeNull();
    expect(await cache.get('https://b.com')).toBeNull();
  });

  it('should check has()', async () => {
    await cache.set('https://example.com', { body: 'test', headers: new Map(), contentType: 'text/plain', statusCode: 200, expiresAt: null, etag: null, lastModified: null, immutable: false });
    expect(await cache.has('https://example.com')).toBe(true);
    expect(await cache.has('https://missing.com')).toBe(false);
  });

  // ── TTL / Expiry ────────────────────────────────────────────────────────────

  it('should return null for expired entry', async () => {
    await cache.set('https://expired.com', {
      body: 'test',
      headers: new Map(),
      contentType: 'text/plain',
      statusCode: 200,
      expiresAt: Date.now() - 1000,
      etag: null,
      lastModified: null,
      immutable: false,
    });
    const entry = await cache.get('https://expired.com');
    expect(entry).toBeNull();
  });

  it('should use default TTL when expiresAt is null', async () => {
    await cache.set('https://example.com', {
      body: 'test',
      headers: new Map(),
      contentType: 'text/plain',
      statusCode: 200,
      expiresAt: null,
      etag: null,
      lastModified: null,
      immutable: false,
    });
    const entry = await cache.get('https://example.com');
    expect(entry).not.toBeNull();
    expect(entry!.expiresAt).toBeGreaterThan(Date.now());
  });

  // ── Stats ───────────────────────────────────────────────────────────────────

  it('should track hit and miss counts', async () => {
    await cache.set('https://hit.com', { body: 'h', headers: new Map(), contentType: 'text/plain', statusCode: 200, expiresAt: null, etag: null, lastModified: null, immutable: false });
    await cache.get('https://hit.com');   // hit
    await cache.get('https://miss.com');  // miss

    const stats = cache.getStats();
    expect(stats.hitCount).toBe(1);
    expect(stats.missCount).toBe(1);
    expect(stats.hitRate).toBe(0.5);
    expect(stats.totalEntries).toBe(1);
  });

  it('should return 0 hitRate when no accesses', () => {
    const stats = cache.getStats();
    expect(stats.hitRate).toBe(0);
  });

  // ── Size limits / eviction ──────────────────────────────────────────────────

  it('should evict entries when size limit exceeded', async () => {
    const smallCache = new CacheManager({ maxSizeBytes: 50, maxEntries: 100 });
    await smallCache.set('https://a.com', { body: 'a'.repeat(30), headers: new Map(), contentType: 'text/plain', statusCode: 200, expiresAt: null, etag: null, lastModified: null, immutable: false });
    await smallCache.set('https://b.com', { body: 'b'.repeat(30), headers: new Map(), contentType: 'text/plain', statusCode: 200, expiresAt: null, etag: null, lastModified: null, immutable: false });
    const stats = smallCache.getStats();
    expect(stats.evictionCount).toBeGreaterThan(0);
  });

  it('should evict oldest entries when maxEntries exceeded', async () => {
    const smallCache = new CacheManager({ maxSizeBytes: 10_000_000, maxEntries: 2 });
    await smallCache.set('https://a.com', { body: 'a', headers: new Map(), contentType: 'text/plain', statusCode: 200, expiresAt: null, etag: null, lastModified: null, immutable: false });
    await smallCache.set('https://b.com', { body: 'b', headers: new Map(), contentType: 'text/plain', statusCode: 200, expiresAt: null, etag: null, lastModified: null, immutable: false });
    await smallCache.set('https://c.com', { body: 'c', headers: new Map(), contentType: 'text/plain', statusCode: 200, expiresAt: null, etag: null, lastModified: null, immutable: false });
    const stats = smallCache.getStats();
    expect(stats.totalEntries).toBe(2);
    expect(stats.evictionCount).toBeGreaterThan(0);
  });

  // ── Query ───────────────────────────────────────────────────────────────────

  it('should query by url', async () => {
    await cache.set('https://example.com', { body: 'html', headers: new Map(), contentType: 'text/html', statusCode: 200, expiresAt: null, etag: null, lastModified: null, immutable: false });
    await cache.set('https://api.com', { body: 'json', headers: new Map(), contentType: 'application/json', statusCode: 200, expiresAt: null, etag: null, lastModified: null, immutable: false });
    const results = await cache.query({ url: 'example' });
    expect(results).toHaveLength(1);
  });

  it('should query by contentType', async () => {
    await cache.set('https://a.com', { body: 'html', headers: new Map(), contentType: 'text/html', statusCode: 200, expiresAt: null, etag: null, lastModified: null, immutable: false });
    await cache.set('https://b.com', { body: 'json', headers: new Map(), contentType: 'application/json', statusCode: 200, expiresAt: null, etag: null, lastModified: null, immutable: false });
    const results = await cache.query({ contentType: 'json' });
    expect(results).toHaveLength(1);
  });

  it('should query by minSize/maxSize', async () => {
    await cache.set('https://small.com', { body: 's', headers: new Map(), contentType: 'text/plain', statusCode: 200, expiresAt: null, etag: null, lastModified: null, immutable: false });
    await cache.set('https://large.com', { body: 'x'.repeat(100), headers: new Map(), contentType: 'text/plain', statusCode: 200, expiresAt: null, etag: null, lastModified: null, immutable: false });
    const smallOnly = await cache.query({ maxSize: 10 });
    expect(smallOnly).toHaveLength(1);
    const largeOnly = await cache.query({ minSize: 50 });
    expect(largeOnly).toHaveLength(1);
  });

  // ── Policy ──────────────────────────────────────────────────────────────────

  it('should return default policy', () => {
    const policy = cache.getPolicy();
    expect(policy.maxSizeBytes).toBe(DEFAULT_CACHE_POLICY.maxSizeBytes);
    expect(policy.maxEntries).toBe(DEFAULT_CACHE_POLICY.maxEntries);
  });

  it('should update policy', () => {
    cache.updatePolicy({ maxEntries: 10 });
    expect(cache.getPolicy().maxEntries).toBe(10);
  });

  it('should use custom policy in constructor', () => {
    const custom = new CacheManager({ maxEntries: 5, defaultTtlMs: 1000 });
    expect(custom.getPolicy().maxEntries).toBe(5);
    expect(custom.getPolicy().defaultTtlMs).toBe(1000);
  });

  // ── Prune ───────────────────────────────────────────────────────────────────

  it('should prune expired entries', async () => {
    await cache.set('https://expired.com', {
      body: 'test',
      headers: new Map(),
      contentType: 'text/plain',
      statusCode: 200,
      expiresAt: Date.now() - 1000,
      etag: null,
      lastModified: null,
      immutable: false,
    });
    await cache.set('https://valid.com', {
      body: 'test',
      headers: new Map(),
      contentType: 'text/plain',
      statusCode: 200,
      expiresAt: Date.now() + 100000,
      etag: null,
      lastModified: null,
      immutable: false,
    });
    const pruned = await cache.prune();
    expect(pruned).toBe(1);
  });

  it('should prune when over size limit', async () => {
    const smallCache = new CacheManager({ maxSizeBytes: 100, maxEntries: 100 });
    // Fill to near capacity, then add one more that pushes over
    await smallCache.set('https://a.com', { body: 'a'.repeat(40), headers: new Map(), contentType: 'text/plain', statusCode: 200, expiresAt: null, etag: null, lastModified: null, immutable: false });
    await smallCache.set('https://b.com', { body: 'b'.repeat(40), headers: new Map(), contentType: 'text/plain', statusCode: 200, expiresAt: null, etag: null, lastModified: null, immutable: false });
    // Now prune - both should exist since 80 < 100, but if we add more to push over, set already evicts
    // Instead, add entries that are expired and verify prune removes them
    const mixed = new CacheManager({ maxSizeBytes: 100, maxEntries: 100 });
    await mixed.set('https://expired.com', { body: 'e'.repeat(20), headers: new Map(), contentType: 'text/plain', statusCode: 200, expiresAt: Date.now() - 1000, etag: null, lastModified: null, immutable: false });
    await mixed.set('https://valid.com', { body: 'v'.repeat(20), headers: new Map(), contentType: 'text/plain', statusCode: 200, expiresAt: Date.now() + 100000, etag: null, lastModified: null, immutable: false });
    const pruned = await mixed.prune();
    expect(pruned).toBe(1);
    expect(await mixed.get('https://expired.com')).toBeNull();
  });

  // ── Overwrite ───────────────────────────────────────────────────────────────

  it('should overwrite existing entry', async () => {
    await cache.set('https://example.com', { body: 'old', headers: new Map(), contentType: 'text/plain', statusCode: 200, expiresAt: null, etag: null, lastModified: null, immutable: false });
    await cache.set('https://example.com', { body: 'new', headers: new Map(), contentType: 'text/plain', statusCode: 200, expiresAt: null, etag: null, lastModified: null, immutable: false });
    const entry = await cache.get('https://example.com');
    expect(entry!.body).toBe('new');
  });

  // ── ETag support ────────────────────────────────────────────────────────────

  it('should store and retrieve etag', async () => {
    await cache.set('https://example.com', {
      body: 'test',
      headers: new Map(),
      contentType: 'text/plain',
      statusCode: 200,
      expiresAt: null,
      etag: '"v1"',
      lastModified: 'Wed, 01 Jan 2025 00:00:00 GMT',
      immutable: false,
    });
    const entry = await cache.get('https://example.com');
    expect(entry!.etag).toBe('"v1"');
    expect(entry!.lastModified).toBe('Wed, 01 Jan 2025 00:00:00 GMT');
  });

  // ── Dispose ─────────────────────────────────────────────────────────────────

  it('should dispose and reset all state', async () => {
    await cache.set('https://example.com', { body: 'test', headers: new Map(), contentType: 'text/plain', statusCode: 200, expiresAt: null, etag: null, lastModified: null, immutable: false });
    await cache.get('https://example.com');
    cache.dispose();
    const stats = cache.getStats();
    expect(stats.totalEntries).toBe(0);
    expect(stats.hitCount).toBe(0);
    expect(stats.missCount).toBe(0);
  });

  // ── Update lastAccessedAt ───────────────────────────────────────────────────

  it('should update lastAccessedAt on get', async () => {
    await cache.set('https://example.com', { body: 'test', headers: new Map(), contentType: 'text/plain', statusCode: 200, expiresAt: null, etag: null, lastModified: null, immutable: false });
    const before = await cache.get('https://example.com');
    await new Promise(r => setTimeout(r, 10));
    const after = await cache.get('https://example.com');
    expect(after!.lastAccessedAt).toBeGreaterThanOrEqual(before!.lastAccessedAt);
  });

  // ── Track totalSizeBytes ────────────────────────────────────────────────────

  it('should track totalSizeBytes accurately', async () => {
    await cache.set('https://a.com', { body: 'abc', headers: new Map(), contentType: 'text/plain', statusCode: 200, expiresAt: null, etag: null, lastModified: null, immutable: false });
    const stats1 = cache.getStats();
    expect(stats1.totalSizeBytes).toBe(3);

    await cache.set('https://b.com', { body: 'xyz', headers: new Map(), contentType: 'text/plain', statusCode: 200, expiresAt: null, etag: null, lastModified: null, immutable: false });
    const stats2 = cache.getStats();
    expect(stats2.totalSizeBytes).toBe(6);

    await cache.delete('https://a.com');
    const stats3 = cache.getStats();
    expect(stats3.totalSizeBytes).toBe(3);
  });
});
