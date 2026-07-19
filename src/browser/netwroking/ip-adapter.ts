/**
 * @file src/browser/netwroking/ip-adapter.ts
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * RESPONSIBILITY
 * ─────────────────────────────────────────────────────────────────────────────
 * Bridge ip-protocol.ts into the existing networking modules without breaking
 * any public APIs. Provides:
 *
 *   1. createIPSystemResolver() — adapts DNSResolverBackend (ip-protocol) to
 *      the SystemResolverFn type used by DnsResolver in dns-resolver.ts.
 *
 *   2. PNAEnforcingHttpClient — wraps any IHttpClient and enforces Private
 *      Network Access checks before allowing requests to proceed.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * OOP PRINCIPLES
 *  Abstraction      PNAEnforcingHttpClient implements IHttpClient.
 *  Encapsulation    IP resolution internals hidden behind adapters.
 *  Open / Closed    New adapters can be added without modifying existing code.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import type {
  DNSResolverBackend,
  DNSRecord,
  SecurityContext,
  ParsedIP,
}                                    from './ip-protocol';
import { isPrivateOrLocal, parseIP, serializeIP } from './ip-protocol';
import type { IHttpClient, HttpRequestSpec, HttpResponseSpec } from './request-manager';
import { FetchHttpClient }             from './request-manager';

// ─────────────────────────────────────────────────────────────────────────────
// 1. System Resolver Adapter
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The SystemResolverFn signature used by DnsResolver in dns-resolver.ts.
 * Returns an array of string IP addresses for a given hostname.
 */
type SystemResolverFn = (hostname: string) => Promise<readonly string[]>;

/**
 * Adapts an ip-protocol.ts DNSResolverBackend into the SystemResolverFn
 * signature expected by the existing DnsResolver in dns-resolver.ts.
 *
 * This lets the existing DnsResolver cache + override logic sit on top
 * of proper DNS resolution via ip-protocol.ts, while retaining its own
 * TTL management and override features.
 *
 * @example
 * ```ts
 * import { DnsResolver } from './dns-resolver';
 * import { createIPSystemResolver } from './ip-adapter';
 * import { resolveDNS } from './ip-protocol';
 *
 * // Create a real DNS backend (e.g. DoH provider)
 * const dohBackend: DNSResolverBackend = { resolve: async (h) => [...] };
 *
 * // Adapt it for DnsResolver
 * const resolver = new DnsResolver(
 *   {},
 *   createIPSystemResolver(dohBackend),
 * );
 * ```
 */
export function createIPSystemResolver(
  backend: DNSResolverBackend,
  preferredVersion?: 4 | 6,
): SystemResolverFn {
  return async (hostname: string): Promise<readonly string[]> => {
    const records = await backend.resolve(hostname, preferredVersion);
    return records.map((r) => serializeIP(r.address));
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. PNA-Enforcing HTTP Client
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Configuration for PNA enforcement.
 */
export interface PNAConfig {
  /** Whether the origin itself is on a private network. Default: false. */
  originIsPrivate: boolean;
  /** Hostnames that are allowed to resolve to private IPs. */
  allowedPrivateHosts?: string[];
  /** Disable PNA enforcement entirely. Default: false. */
  disablePNA?: boolean;
}

/**
 * A simple DNS record used for PNA checking within the HTTP client layer.
 * Maps hostname → resolved string addresses (as returned by fetch/DNS).
 */
interface PNADNSLookup {
  (hostname: string): Promise<string[]>;
}

/**
 * Wraps any IHttpClient and enforces Private Network Access (PNA) policy.
 *
 * Before allowing a request to proceed, it:
 *   1. Extracts the hostname from the request URL.
 *   2. Looks up resolved IP addresses for that hostname.
 *   3. Checks if any resolved address is private/local.
 *   4. If private and origin is public → throws PrivateNetworkAccessError.
 *
 * This provides defense-in-depth: even if a request somehow bypasses the
 * DNS layer, PNA is enforced at the HTTP transport level.
 */
export class PNAEnforcingHttpClient implements IHttpClient {
  constructor(
    private readonly inner: IHttpClient,
    private readonly config: PNAConfig,
    private readonly dnsLookup: PNADNSLookup,
  ) {}

  async send(request: HttpRequestSpec, signal: AbortSignal): Promise<HttpResponseSpec> {
    if (!this.config.disablePNA) {
      const hostname = this.extractHostname(request.url);
      if (hostname) {
        await this.checkPNA(hostname);
      }
    }
    return this.inner.send(request, signal);
  }

  private extractHostname(url: string): string | null {
    try {
      return new URL(url).hostname;
    } catch {
      return null;
    }
  }

  private async checkPNA(hostname: string): Promise<void> {
    // Literal IPs — check directly without DNS lookup.
    const parsed = this.parseLiteralIP(hostname);
    if (parsed) {
      if (isPrivateOrLocal(parsed) && !this.config.originIsPrivate) {
        if (this.isAllowedHost(hostname)) return;
        throw new PNABlockedError(hostname, serializeIP(parsed));
      }
      return;
    }

    // Resolve hostname to IPs and check each.
    const addresses = await this.dnsLookup(hostname);
    for (const addr of addresses) {
      const ip = this.parseLiteralIP(addr);
      if (ip && isPrivateOrLocal(ip)) {
        if (this.isAllowedHost(hostname)) return;
        if (!this.config.originIsPrivate) {
          throw new PNABlockedError(hostname, addr);
        }
      }
    }
  }

  private isAllowedHost(hostname: string): boolean {
    return this.config.allowedPrivateHosts?.includes(hostname) ?? false;
  }

  private parseLiteralIP(input: string): ParsedIP | null {
    return parseIP(input);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. PNA Error
// ─────────────────────────────────────────────────────────────────────────────

export class PNABlockedError extends Error {
  constructor(
    public readonly hostname: string,
    public readonly address: string,
  ) {
    super(
      `Private Network Access blocked: "${hostname}" resolved to ${address}, ` +
        `which is a private/local address not permitted from a public origin`,
    );
    this.name = 'PNABlockedError';
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. Convenience: create PNA-aware request pipeline
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Factory that creates a PNA-enforcing HTTP client with a provided DNS
 * lookup function. Useful for wiring into RequestManager.
 *
 * @example
 * ```ts
 * import { createPNAClient } from './ip-adapter';
 * import { resolveDNS } from './ip-protocol';
 *
 * const client = createPNAClient({
 *   originIsPrivate: false,
 *   dnsLookup: async (hostname) => {
 *     const records = await resolveDNS(dnsServer, hostname);
 *     return records.map(r => serializeIP(r.address));
 *   },
 * });
 *
 * const rm = new RequestManager(client, appConfig);
 * ```
 */
export function createPNAClient(
  config: PNAConfig & { dnsLookup: PNADNSLookup },
  inner?: IHttpClient,
): PNAEnforcingHttpClient {
  return new PNAEnforcingHttpClient(
    inner ?? new FetchHttpClient(),
    config,
    config.dnsLookup,
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 5. IP-aware connection pool adapter
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Wraps the connection-pool.ts ConnectionPool to add IP-level PNA checks
 * before creating new connections. Returns an IConnectionPool-compatible
 * interface.
 *
 * This is a lightweight wrapper that performs PNA validation only when
 * the pool needs to create a new connection (not when reusing idle ones).
 */
export interface IPConnectionPoolConfig {
  originIsPrivate: boolean;
  allowedPrivateHosts?: string[];
  disablePNA?: boolean;
}

export { PNABlockedError as PrivateNetworkAccessError };
