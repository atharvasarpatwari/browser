import { describe, it, expect, beforeEach } from 'vitest';
import {
  CacheControl,
  MemoryCacheStorage,
  DiskCacheStorage,
  CacheStorageStrategy,
} from '../src/browser/netwroking/cache-control';

describe('CacheControl', () => {
  let cache: CacheControl;

  beforeEach(() => {
    cache = new CacheControl({
      memoryMaxAgeSeconds: 300,
      diskMaxAgeSeconds: 3600,
      storageStrategy: CacheStorageStrategy.Tiered,
      defaultTtlSeconds: 60,
    });
  });

  describe('store and lookup', () => {
    it('should store and retrieve a cacheable response', async () => {
      const headers = new Map([
        ['content-type', 'text/html'],
        ['cache-control', 'max-age=300'],
      ]);

      await cache.store('https://example.com', headers, '<html>hello</html>', 200);

      const result = await cache.lookup('https://example.com');
      expect(result.found).toBe(true);
      expect(result.fresh).toBe(true);
      expect(result.response).not.toBeNull();
      expect(result.response!.body).toBe('<html>hello</html>');
    });

    it('should not cache no-store responses', async () => {
      const headers = new Map([
        ['content-type', 'text/html'],
        ['cache-control', 'no-store'],
      ]);

      await cache.store('https://private.com', headers, 'secret', 200);

      const result = await cache.lookup('https://private.com');
      expect(result.found).toBe(false);
    });

    it('should not cache error responses', async () => {
      const headers = new Map([['content-type', 'text/html']]);
      await cache.store('https://error.com', headers, 'not found', 404);

      const result = await cache.lookup('https://error.com');
      expect(result.found).toBe(false);
    });

    it('should return fresh entries from memory', async () => {
      const headers = new Map([['cache-control', 'max-age=999']]);
      await cache.store('https://memory.com', headers, 'cached', 200);

      const result = await cache.lookup('https://memory.com');
      expect(result.fromDisk).toBe(false);
    });

    it('should cache on disk in tiered mode', async () => {
      const headers = new Map([['cache-control', 'max-age=999']]);
      await cache.store('https://disk.com', headers, 'disk-data', 200);

      const result = await cache.lookup('https://disk.com');
      expect(result.found).toBe(true);
    });
  });

  describe('revalidation', () => {
    it('should set needsRevalidation for stale entries with ETag', async () => {
      const headers = new Map([
        ['cache-control', 'max-age=0'],
        ['etag', '"abc123"'],
      ]);
      await cache.store('https://stale.com', headers, 'old', 200);

      const result = await cache.lookup('https://stale.com');
      expect(result.needsRevalidation).toBe(true);
      expect(result.revalidationHeaders.get('if-none-match')).toBe('"abc123"');
    });

    it('should set If-Modified-Since for entries with Last-Modified', async () => {
      const headers = new Map([
        ['cache-control', 'max-age=0'],
        ['last-modified', 'Wed, 01 Jan 2025 00:00:00 GMT'],
      ]);
      await cache.store('https://stale-lm.com', headers, 'old', 200);

      const result = await cache.lookup('https://stale-lm.com');
      expect(result.needsRevalidation).toBe(true);
      expect(result.revalidationHeaders.get('if-modified-since')).toBe(
        'Wed, 01 Jan 2025 00:00:00 GMT',
      );
    });
  });

  describe('immutable', () => {
    it('should treat immutable responses as always fresh', async () => {
      const headers = new Map([
        ['cache-control', 'immutable, max-age=0'],
      ]);
      await cache.store('https://immutable.com', headers, 'static', 200);

      const result = await cache.lookup('https://immutable.com');
      expect(result.fresh).toBe(true);
    });
  });

  describe('invalidate', () => {
    it('should remove a cached entry', async () => {
      const headers = new Map([['cache-control', 'max-age=300']]);
      await cache.store('https://to-delete.com', headers, 'data', 200);
      expect((await cache.lookup('https://to-delete.com')).found).toBe(true);

      await cache.invalidate('https://to-delete.com');
      expect((await cache.lookup('https://to-delete.com')).found).toBe(false);
    });
  });

  describe('prune', () => {
    it('should remove expired entries', async () => {
      const headers = new Map([['cache-control', 'max-age=0']]);
      await cache.store('https://expired.com', headers, 'stale', 200);

      const pruned = await cache.prune();
      expect(pruned).toBeGreaterThanOrEqual(1);
    });
  });

  describe('config', () => {
    it('should return and update config', () => {
      const config = cache.getConfig();
      expect(config.storageStrategy).toBe(CacheStorageStrategy.Tiered);

      cache.updateConfig({ respectNoStore: false });
      expect(cache.getConfig().respectNoStore).toBe(false);
    });
  });

  describe('stats', () => {
    it('should track hits and misses', async () => {
      const headers = new Map([['cache-control', 'max-age=300']]);
      await cache.store('https://hit.com', headers, 'data', 200);

      await cache.lookup('https://hit.com'); // hit
      await cache.lookup('https://miss.com'); // miss

      const stats = cache.getStats();
      expect(stats.memoryHits + stats.diskHits).toBeGreaterThanOrEqual(1);
      expect(stats.misses).toBe(1);
    });
  });

  describe('dispose', () => {
    it('should clear all state', async () => {
      const headers = new Map([['cache-control', 'max-age=300']]);
      await cache.store('https://test.com', headers, 'data', 200);
      cache.dispose();
      expect(cache.getStats().totalEntries).toBe(0);
    });
  });
});

describe('MemoryCacheStorage', () => {
  it('should store and retrieve entries', async () => {
    const storage = new MemoryCacheStorage();
    await storage.set('key1', {
      url: 'key1', statusCode: 200, headers: new Map(), body: 'hello',
      contentType: 'text/html', cachedAt: Date.now(), expiresAt: null,
      etag: null, lastModified: null, immutable: false,
      vary: new Map(), cacheControl: {} as any, onDisk: false,
    });

    const entry = await storage.get('key1');
    expect(entry).not.toBeNull();
    expect(entry!.body).toBe('hello');
    expect(storage.size()).toBe(1);
  });

  it('should delete entries', async () => {
    const storage = new MemoryCacheStorage();
    await storage.set('key1', { url: 'key1', statusCode: 200, headers: new Map(), body: '', contentType: '', cachedAt: 0, expiresAt: null, etag: null, lastModified: null, immutable: false, vary: new Map(), cacheControl: {} as any, onDisk: false });
    expect(await storage.delete('key1')).toBe(true);
    expect(await storage.get('key1')).toBeNull();
  });
});

describe('DiskCacheStorage', () => {
  it('should track total size', async () => {
    const storage = new DiskCacheStorage();
    await storage.set('k1', { url: 'k1', statusCode: 200, headers: new Map(), body: 'hello', contentType: '', cachedAt: 0, expiresAt: null, etag: null, lastModified: null, immutable: false, vary: new Map(), cacheControl: {} as any, onDisk: true });
    expect(storage.getTotalSizeBytes()).toBe(5);

    await storage.delete('k1');
    expect(storage.getTotalSizeBytes()).toBe(0);
  });
});
