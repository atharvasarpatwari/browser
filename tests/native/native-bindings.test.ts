import { describe, it, expect } from 'vitest';
import { isNativeAvailable, resolveDns } from '../../src/native/index';
import { NovaDnsResolver } from '../../src/native/dns-resolver';
import { NovaHttpClient } from '../../src/native/http-client';
import type { DnsResult, HttpResponse } from '../../src/native/types';

describe('Native module loader', () => {
  it('should export isNativeAvailable', () => {
    expect(typeof isNativeAvailable).toBe('function');
  });

  it('isNativeAvailable returns boolean', () => {
    const result = isNativeAvailable();
    expect(typeof result).toBe('boolean');
  });

  it('should export resolveDns function', () => {
    expect(typeof resolveDns).toBe('function');
  });
});

describe('NovaDnsResolver', () => {
  it('should create resolver with defaults', () => {
    const resolver = new NovaDnsResolver();
    expect(resolver.cacheSize).toBe(0);
  });

  it('should create resolver with custom cache TTL', () => {
    const resolver = new NovaDnsResolver({ cacheTtlMs: 60_000 });
    expect(resolver.cacheSize).toBe(0);
  });

  it('isNative should return boolean', () => {
    const resolver = new NovaDnsResolver();
    expect(typeof resolver.isNative()).toBe('boolean');
  });

  it('should clear cache', () => {
    const resolver = new NovaDnsResolver();
    resolver.clearCache();
    expect(resolver.cacheSize).toBe(0);
  });

  it('should resolve localhost', async () => {
    const resolver = new NovaDnsResolver();
    const result = await resolver.resolve('localhost');
    expect(result.domain).toBe('localhost');
    expect(result.records.length).toBeGreaterThan(0);
    expect(result.resolutionTimeMs).toBeGreaterThanOrEqual(0);
  });

  it('should resolve localhost IPs', async () => {
    const resolver = new NovaDnsResolver();
    const ips = await resolver.resolveIps('localhost');
    expect(ips.length).toBeGreaterThan(0);
    expect(ips).toContain('127.0.0.1');
  });

  it('should cache results', async () => {
    const resolver = new NovaDnsResolver();
    await resolver.resolve('localhost');
    expect(resolver.cacheSize).toBe(1);
    await resolver.resolve('localhost');
    expect(resolver.cacheSize).toBe(1);
  });
});

describe('NovaHttpClient', () => {
  it('should create client with defaults', () => {
    const client = new NovaHttpClient();
    expect(typeof client.isNative()).toBe('boolean');
  });

  it('should create client with custom options', () => {
    const client = new NovaHttpClient({
      defaultHeaders: { 'X-Custom': 'test' },
      timeoutSecs: 10,
    });
    expect(client).toBeDefined();
  });

  it('should reject invalid URLs', async () => {
    const client = new NovaHttpClient();
    await expect(
      client.get('not-a-valid-url'),
    ).rejects.toThrow();
  });

  it('should reject invalid methods', async () => {
    const client = new NovaHttpClient();
    await expect(
      client.fetch({ url: 'https://example.com', method: 'NOT A METHOD' }),
    ).rejects.toThrow();
  });
});

describe('TypeScript type exports', () => {
  it('should export all types', async () => {
    const types = await import('../../src/native/types');
    expect(types).toBeDefined();
  });
});
