import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  DnsResolver,
  DnsResolveSource,
  DnsError,
  DnsTimeoutError,
  DnsNotFoundError,
} from '../src/browser/netwroking/dns-resolver';

describe('DnsResolver', () => {
  let resolver: DnsResolver;

  beforeEach(() => {
    resolver = new DnsResolver(
      { defaultTtlSeconds: 60 },
      async (hostname) => [`${hostname}-ip1`, `${hostname}-ip2`],
    );
  });

  describe('resolve', () => {
    it('should resolve a hostname via system resolver', async () => {
      const result = await resolver.resolve('example.com');
      expect(result.hostname).toBe('example.com');
      expect(result.addresses).toEqual(['example.com-ip1', 'example.com-ip2']);
      expect(result.source).toBe(DnsResolveSource.System);
      expect(result.ttlSeconds).toBe(60);
    });

    it('should return cached result on second call', async () => {
      await resolver.resolve('cached.com');
      const result = await resolver.resolve('cached.com');
      expect(result.source).toBe(DnsResolveSource.Cache);
    });

    it('should throw DnsError for empty hostname', async () => {
      await expect(resolver.resolve('')).rejects.toThrow(DnsError);
    });

    it('should throw DnsNotFoundError when no addresses returned', async () => {
      const emptyResolver = new DnsResolver(
        {},
        async () => [],
      );
      await expect(emptyResolver.resolve('nonexistent.com')).rejects.toThrow(DnsNotFoundError);
    });

    it('should throw DnsTimeoutError when resolver times out', async () => {
      const slowResolver = new DnsResolver(
        { resolveTimeoutMs: 50 },
        async () => {
          await new Promise(r => setTimeout(r, 200));
          return ['1.2.3.4'];
        },
      );
      await expect(slowResolver.resolve('slow.com')).rejects.toThrow(DnsTimeoutError);
    });

    it('should return override before cache or system', async () => {
      resolver.setOverride('override.com', ['10.0.0.1']);
      const result = await resolver.resolve('override.com');
      expect(result.source).toBe(DnsResolveSource.Override);
      expect(result.addresses).toEqual(['10.0.0.1']);
    });

    it('should throw DnsError when system resolver fails', async () => {
      const failResolver = new DnsResolver(
        {},
        async () => { throw new Error('DNS server unreachable'); },
      );
      await expect(failResolver.resolve('fail.com')).rejects.toThrow(DnsError);
    });
  });

  describe('flush', () => {
    it('should clear the cache', async () => {
      await resolver.resolve('example.com');
      expect(resolver.has('example.com')).toBe(true);
      resolver.flush();
      expect(resolver.has('example.com')).toBe(false);
      expect(resolver.getCacheSize()).toBe(0);
    });
  });

  describe('flushHost', () => {
    it('should remove a single host from cache', async () => {
      await resolver.resolve('a.com');
      await resolver.resolve('b.com');
      expect(resolver.has('a.com')).toBe(true);
      resolver.flushHost('a.com');
      expect(resolver.has('a.com')).toBe(false);
      expect(resolver.has('b.com')).toBe(true);
    });
  });

  describe('overrides', () => {
    it('should add and remove overrides', async () => {
      resolver.setOverride('my.host', ['1.1.1.1'], 60);
      const result = await resolver.resolve('my.host');
      expect(result.addresses).toEqual(['1.1.1.1']);

      resolver.removeOverride('my.host');
      const result2 = await resolver.resolve('my.host');
      expect(result2.source).toBe(DnsResolveSource.System);
    });
  });

  describe('policy', () => {
    it('should return and update policy', () => {
      const policy = resolver.getPolicy();
      expect(policy.defaultTtlSeconds).toBe(60);

      resolver.updatePolicy({ defaultTtlSeconds: 120 });
      expect(resolver.getPolicy().defaultTtlSeconds).toBe(120);
    });
  });

  describe('dispose', () => {
    it('should clear all state', async () => {
      await resolver.resolve('example.com');
      resolver.setOverride('x.com', ['1.2.3.4']);
      resolver.dispose();
      expect(resolver.getCacheSize()).toBe(0);
    });
  });
});
