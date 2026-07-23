/**
 * @file src/browser/netwroking/dns-resolver.ts
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * RESPONSIBILITY
 * ─────────────────────────────────────────────────────────────────────────────
 * Resolve hostnames to IP addresses with caching, TTL management, and
 * multiple resolution strategies (system, cached, overridable).
 *
 * Pipeline position
 * ─────────────────
 *   ConnectionPool.open()
 *        │
 *        ▼
 *   DnsResolver.resolve(hostname)
 *        │
 *        ├──▶ cached entry?   → return immediately
 *        └──▶ system lookup   → cache + return
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * OOP PRINCIPLES
 * ─────────────────────────────────────────────────────────────────────────────
 *  Abstraction      IDnsResolver hides resolution strategy behind resolve().
 *  Encapsulation    Cache internals and TTL logic are private; callers see
 *                   only resolve() and flush().
 *  Single-Resp.     This file resolves hostnames — nothing else.
 *  Open / Closed    New resolution strategies implement IDnsResolver.
 *  Dependency-Inv.  Constructor accepts a custom resolver function for tests.
 */

import type { IDisposable } from '../../app/dependency-container';

// ─────────────────────────────────────────────────────────────────────────────
// VALUE OBJECTS
// ─────────────────────────────────────────────────────────────────────────────

/** Result of a single DNS lookup. */
interface DnsResolveResult {
  /** The hostname that was resolved. */
  readonly hostname: string;
  /** Resolved IP addresses (may be multiple for round-robin). */
  readonly addresses: readonly string[];
  /** TTL in seconds from the resolver; null when unknown. */
  readonly ttlSeconds: number | null;
  /** When this result was produced. */
  readonly resolvedAt: number;
  /** The resolution strategy that produced this result. */
  readonly source: DnsResolveSource;
}

/** How a DNS entry was obtained. */
enum DnsResolveSource {
  Cache    = 'cache',
  System   = 'system',
  Override = 'override',
}

/** Policy controlling cache behaviour and resolution. */
interface DnsPolicy {
  /** Maximum number of cached entries. */
  readonly maxCacheEntries: number;
  /** Default TTL in seconds when the resolver doesn't specify one. */
  readonly defaultTtlSeconds: number;
  /** Whether to use the system resolver (DNS API). */
  readonly useSystemResolver: boolean;
  /** Maximum time in ms to wait for a system DNS lookup. */
  readonly resolveTimeoutMs: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// PUBLIC CONTRACT
// ─────────────────────────────────────────────────────────────────────────────

type SystemResolverFn = (hostname: string) => Promise<readonly string[]>;

interface IDnsResolver extends IDisposable {
  /** Resolve a hostname to IP addresses. Checks cache first. */
  resolve(hostname: string): Promise<DnsResolveResult>;
  /** Flush the entire DNS cache. */
  flush(): void;
  /** Remove a single hostname from cache. */
  flushHost(hostname: string): boolean;
  /** Manually override a hostname with fixed addresses. */
  setOverride(hostname: string, addresses: readonly string[], ttlSeconds?: number): void;
  /** Remove a manual override. */
  removeOverride(hostname: string): boolean;
  /** Check if a hostname is cached. */
  has(hostname: string): boolean;
  /** Get the number of cached entries. */
  getCacheSize(): number;
  /** Get current policy. */
  getPolicy(): DnsPolicy;
  /** Update policy. */
  updatePolicy(policy: Partial<DnsPolicy>): void;
}

// ─────────────────────────────────────────────────────────────────────────────
// CONSTANTS
// ─────────────────────────────────────────────────────────────────────────────

const DEFAULT_DNS_POLICY: DnsPolicy = {
  maxCacheEntries:    10_000,
  defaultTtlSeconds:  300,       // 5 minutes
  useSystemResolver:  true,
  resolveTimeoutMs:   5_000,
};

// ─────────────────────────────────────────────────────────────────────────────
// ERRORS
// ─────────────────────────────────────────────────────────────────────────────

class DnsError extends Error {
  readonly hostname: string;
  constructor(hostname: string, message: string) {
    super(message);
    this.name = 'DnsError';
    this.hostname = hostname;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

class DnsTimeoutError extends DnsError {
  constructor(hostname: string, timeoutMs: number) {
    super(hostname, `DNS resolution for "${hostname}" timed out after ${timeoutMs}ms.`);
    this.name = 'DnsTimeoutError';
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

class DnsNotFoundError extends DnsError {
  constructor(hostname: string) {
    super(hostname, `No addresses found for "${hostname}".`);
    this.name = 'DnsNotFoundError';
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// SYSTEM RESOLVER (real DNS)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Real DNS resolution strategy.
 *
 * - Node.js: Uses `dns.promises.resolve4()` / `resolve6()` for system-level
 *   DNS resolution, falling back to DNS-over-HTTPS (Cloudflare) if unavailable.
 * - Browser: Uses DNS-over-HTTPS (Cloudflare 1.1.1.1) since browser JS has no
 *   native DNS API.
 * - Test: Inject a deterministic stub via the constructor.
 */
async function defaultSystemResolver(hostname: string): Promise<readonly string[]> {
  const addresses: string[] = [];

  // ── Node.js path: use dns.promises ────────────────────────────────────
  if (typeof process !== 'undefined' && typeof require === 'function') {
    try {
      const dns = await import('node:dns').then(m => m.promises);
      const [v4, v6] = await Promise.allSettled([
        dns.resolve4(hostname).catch(() => []),
        dns.resolve6(hostname).catch(() => []),
      ]);
      if (v4.status === 'fulfilled') addresses.push(...v4.value);
      if (v6.status === 'fulfilled') addresses.push(...v6.value);
      if (addresses.length > 0) return addresses;
    } catch {
      // dns module unavailable — fall through to DoH
    }
  }

  // ── Browser / fallback path: DNS-over-HTTPS (Cloudflare 1.1.1.1) ──────
  try {
    const url = `https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(hostname)}&type=A`;
    const res = await fetch(url, {
      headers: { accept: 'application/dns-json' },
      signal: AbortSignal.timeout(5_000),
    });
    if (res.ok) {
      const json = await res.json() as {
        Answer?: Array<{ data: string; type: number }>;
      };
      if (json.Answer) {
        for (const a of json.Answer) {
          if (a.type === 1) addresses.push(a.data); // A record
        }
      }
    }
  } catch {
    // DoH unavailable — return hostname for implicit resolution
  }

  // If we got real IPs, return them; otherwise fall back to hostname
  return addresses.length > 0 ? addresses : [hostname];
}

// ─────────────────────────────────────────────────────────────────────────────
// CACHE ENTRY
// ─────────────────────────────────────────────────────────────────────────────

interface CacheEntry {
  readonly hostname: string;
  readonly addresses: readonly string[];
  readonly ttlSeconds: number;
  readonly expiresAt: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// DNS RESOLVER
// ─────────────────────────────────────────────────────────────────────────────

class DnsResolver implements IDnsResolver {
  private readonly cache = new Map<string, CacheEntry>();
  private readonly overrides = new Map<string, CacheEntry>();
  private readonly systemResolver: SystemResolverFn;
  private policy: DnsPolicy;
  private hitCount = 0;
  private missCount = 0;

  constructor(
    policy?: Partial<DnsPolicy>,
    systemResolver?: SystemResolverFn,
  ) {
    this.policy = { ...DEFAULT_DNS_POLICY, ...policy };
    this.systemResolver = systemResolver ?? defaultSystemResolver;
  }

  // ── IDnsResolver: resolve ───────────────────────────────────────────────

  async resolve(hostname: string): Promise<DnsResolveResult> {
    if (!hostname || hostname.length === 0) {
      throw new DnsError(hostname, 'Hostname must not be empty.');
    }

    // 1. Check manual overrides first (highest priority).
    const override = this.overrides.get(hostname);
    if (override) {
      if (override.expiresAt > Date.now()) {
        return {
          hostname,
          addresses: override.addresses,
          ttlSeconds: override.ttlSeconds,
          resolvedAt: Date.now(),
          source: DnsResolveSource.Override,
        };
      }
      this.overrides.delete(hostname);
    }

    // 2. Check cache.
    const cached = this.cache.get(hostname);
    if (cached) {
      if (cached.expiresAt > Date.now()) {
        this.hitCount++;
        return {
          hostname,
          addresses: cached.addresses,
          ttlSeconds: cached.ttlSeconds,
          resolvedAt: cached.expiresAt - cached.ttlSeconds * 1000,
          source: DnsResolveSource.Cache,
        };
      }
      // Expired — evict and fall through to system lookup.
      this.cache.delete(hostname);
    }

    // 3. System resolution.
    this.missCount++;
    const addresses = await this.resolveViaSystem(hostname);

    if (addresses.length === 0) {
      throw new DnsNotFoundError(hostname);
    }

    // 4. Cache the result.
    const ttlSeconds = this.policy.defaultTtlSeconds;
    this.cacheEntry(hostname, addresses, ttlSeconds);

    return {
      hostname,
      addresses,
      ttlSeconds,
      resolvedAt: Date.now(),
      source: DnsResolveSource.System,
    };
  }

  // ── IDnsResolver: flush ────────────────────────────────────────────────

  flush(): void {
    this.cache.clear();
    this.hitCount = 0;
    this.missCount = 0;
  }

  flushHost(hostname: string): boolean {
    return this.cache.delete(hostname);
  }

  // ── IDnsResolver: overrides ────────────────────────────────────────────

  setOverride(hostname: string, addresses: readonly string[], ttlSeconds = 3600): void {
    this.overrides.set(hostname, {
      hostname,
      addresses: [...addresses],
      ttlSeconds,
      expiresAt: Date.now() + ttlSeconds * 1000,
    });
  }

  removeOverride(hostname: string): boolean {
    return this.overrides.delete(hostname);
  }

  // ── IDnsResolver: inspection ───────────────────────────────────────────

  has(hostname: string): boolean {
    const entry = this.cache.get(hostname);
    if (!entry) return false;
    if (entry.expiresAt < Date.now()) {
      this.cache.delete(hostname);
      return false;
    }
    return true;
  }

  getCacheSize(): number {
    return this.cache.size;
  }

  getPolicy(): DnsPolicy {
    return { ...this.policy };
  }

  updatePolicy(policy: Partial<DnsPolicy>): void {
    this.policy = { ...this.policy, ...policy };
  }

  // ── IDisposable ────────────────────────────────────────────────────────

  dispose(): void {
    this.cache.clear();
    this.overrides.clear();
    this.hitCount = 0;
    this.missCount = 0;
  }

  // ── Private helpers ────────────────────────────────────────────────────

  private async resolveViaSystem(hostname: string): Promise<readonly string[]> {
    if (!this.policy.useSystemResolver) {
      return [hostname];
    }

    const timeoutMs = this.policy.resolveTimeoutMs;

    try {
      const result = await Promise.race([
        this.systemResolver(hostname),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new DnsTimeoutError(hostname, timeoutMs)), timeoutMs),
        ),
      ]);
      return result;
    } catch (err) {
      if (err instanceof DnsTimeoutError) throw err;
      throw new DnsError(
        hostname,
        `DNS resolution failed for "${hostname}": ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  private cacheEntry(hostname: string, addresses: readonly string[], ttlSeconds: number): void {
    // Evict oldest if at capacity.
    if (this.cache.size >= this.policy.maxCacheEntries) {
      const oldest = this.cache.keys().next().value;
      if (oldest !== undefined) {
        this.cache.delete(oldest);
      }
    }

    this.cache.set(hostname, {
      hostname,
      addresses: [...addresses],
      ttlSeconds,
      expiresAt: Date.now() + ttlSeconds * 1000,
    });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// EXPORTS
// ─────────────────────────────────────────────────────────────────────────────

export {
  DnsResolver,
  DnsResolveSource,
  DnsError,
  DnsTimeoutError,
  DnsNotFoundError,
  DEFAULT_DNS_POLICY,
  defaultSystemResolver,
};

export type {
  IDnsResolver,
  DnsResolveResult,
  DnsPolicy,
  SystemResolverFn,
};
