/**
 * @file native/dns-resolver.ts
 * DNS resolver — wraps native or fallback DNS resolution.
 */

import { resolveDns, resolveDnsIps, isNativeAvailable } from './index';
import type { DnsResult, DnsRecord } from './types';

export interface IDnsResolver {
  resolve(domain: string): Promise<DnsResult>;
  resolveIps(domain: string): Promise<string[]>;
  isNative(): boolean;
}

export class NovaDnsResolver implements IDnsResolver {
  private cache = new Map<string, { result: DnsResult; expiry: number }>();
  private cacheTtlMs: number;

  constructor(options?: { cacheTtlMs?: number }) {
    this.cacheTtlMs = options?.cacheTtlMs ?? 300_000; // 5 minutes
  }

  async resolve(domain: string): Promise<DnsResult> {
    const cached = this.cache.get(domain);
    if (cached && cached.expiry > Date.now()) {
      return cached.result;
    }

    const result = await resolveDns(domain);

    this.cache.set(domain, {
      result,
      expiry: Date.now() + this.cacheTtlMs,
    });

    return result;
  }

  async resolveIps(domain: string): Promise<string[]> {
    const result = await this.resolve(domain);
    return result.records
      .map((r) => r.ip)
      .filter((ip): ip is string => ip !== null);
  }

  isNative(): boolean {
    return isNativeAvailable();
  }

  clearCache(): void {
    this.cache.clear();
  }

  get cacheSize(): number {
    return this.cache.size;
  }
}
