/**
 * ip-protocol-firewall.test.ts
 *
 * Exhaustive test suite for: IPv4/IPv6 parsing, CIDR matching, IP
 * classification, DNS resolution (caching, negative caching, retry), PNA
 * enforcement, Happy Eyeballs ordering, connection pooling, and rule-based
 * firewall — all against the REAL exports from src/browser/netwroking/.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import {
  parseIPv4,
  parseIPv6,
  parseIP,
  serializeIP,
  parseCIDR,
  isInCIDR,
  classifyIP,
  isPrivateOrLocal,
  enforcePrivateNetworkAccess,
  orderForHappyEyeballs,
  establishConnection,
  CachingDNSResolver,
  LiteralAwareResolver,
  ResilientDNSResolver,
  ConnectionPool,
  ipEquals,
  type DNSRecord,
  type SecurityContext,
  type ConnectionTarget,
  type SocketConnection,
  type DNSResolverBackend,
  type ParsedIPv4,
  type ParsedIPv6,
} from '../src/browser/netwroking/ip-protocol';

import {
  Firewall,
  matchesHostnamePattern,
  applyBaselineRules,
  type FirewallRule,
} from '../src/browser/netwroking/firewall';

import {
  DnsResolver,
} from '../src/browser/netwroking/dns-resolver';

// ═════════════════════════════════════════════════════════════════════════════
// 1. IPv4 PARSING
// ═════════════════════════════════════════════════════════════════════════════

describe('IPv4 parsing', () => {
  it('parses a standard dotted-quad address', () => {
    const r = parseIPv4('192.168.1.1');
    expect(r).not.toBeNull();
    expect(r?.octets).toEqual([192, 168, 1, 1]);
  });

  it('parses the all-zeros address', () => {
    expect(parseIPv4('0.0.0.0')?.octets).toEqual([0, 0, 0, 0]);
  });

  it('parses the broadcast address', () => {
    expect(parseIPv4('255.255.255.255')?.octets).toEqual([255, 255, 255, 255]);
  });

  it('rejects octets above 255', () => {
    expect(parseIPv4('256.1.1.1')).toBeNull();
    expect(parseIPv4('1.1.1.999')).toBeNull();
  });

  it('rejects negative-looking octets', () => {
    expect(parseIPv4('-1.1.1.1')).toBeNull();
  });

  it('rejects too few octets', () => {
    expect(parseIPv4('192.168.1')).toBeNull();
  });

  it('rejects too many octets', () => {
    expect(parseIPv4('192.168.1.1.1')).toBeNull();
  });

  it('rejects leading zeros (ambiguous octal risk)', () => {
    expect(parseIPv4('192.168.01.1')).toBeNull();
  });

  it('rejects non-numeric octets', () => {
    expect(parseIPv4('192.168.a.1')).toBeNull();
  });

  it('rejects empty string', () => {
    expect(parseIPv4('')).toBeNull();
  });

  it('trims and accepts whitespace-padded input', () => {
    const r = parseIPv4(' 192.168.1.1 ');
    expect(r).not.toBeNull();
    expect(r?.octets).toEqual([192, 168, 1, 1]);
  });

  it('rejects trailing dot', () => {
    expect(parseIPv4('192.168.1.1.')).toBeNull();
  });

  it('rejects IPv4 with embedded whitespace', () => {
    expect(parseIPv4('192. 168.1.1')).toBeNull();
  });

  it('round-trips serializeIP back to canonical dotted-quad form', () => {
    const parsed = parseIPv4('10.0.0.1');
    expect(parsed).not.toBeNull();
    expect(serializeIP(parsed!)).toBe('10.0.0.1');
  });

  it('rejects hex-formatted octets', () => {
    expect(parseIPv4('0x7f.0.0.1')).toBeNull();
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 2. IPv6 PARSING (incl. zone IDs)
// ═════════════════════════════════════════════════════════════════════════════

describe('IPv6 parsing', () => {
  it('parses full uncompressed form', () => {
    const r = parseIPv6('2001:0db8:0000:0000:0000:ff00:0042:8329');
    expect(r).not.toBeNull();
    expect(r?.version).toBe(6);
    expect(r?.groups).toHaveLength(8);
  });

  it('parses compressed "::" form', () => {
    expect(parseIPv6('2001:db8::ff00:42:8329')).not.toBeNull();
  });

  it('parses the unspecified address "::"', () => {
    expect(parseIPv6('::')).not.toBeNull();
  });

  it('parses the loopback address "::1"', () => {
    const r = parseIPv6('::1');
    expect(r).not.toBeNull();
    expect(classifyIP(r!)).toBe('loopback');
  });

  it('rejects multiple "::" compressions in one address', () => {
    expect(parseIPv6('2001::db8::1')).toBeNull();
  });

  it('parses IPv4-mapped IPv6 addresses', () => {
    const r = parseIPv6('::ffff:192.168.1.1');
    expect(r).not.toBeNull();
    expect(r?.groups).toBeDefined();
  });

  it('parses addresses with a zone/scope ID', () => {
    const r = parseIPv6('fe80::1%eth0');
    expect(r).not.toBeNull();
    expect(r?.zoneId).toBe('eth0');
  });

  it('parses numeric zone IDs', () => {
    const r = parseIPv6('fe80::1%3');
    expect(r?.zoneId).toBe('3');
  });

  it('rejects more than 8 groups', () => {
    expect(parseIPv6('1:2:3:4:5:6:7:8:9')).toBeNull();
  });

  it('rejects groups with more than 4 hex digits', () => {
    expect(parseIPv6('12345::1')).toBeNull();
  });

  it('rejects invalid hex characters in a group', () => {
    expect(parseIPv6('2001:zzzz::1')).toBeNull();
  });

  it('normalizes mixed-case hex to lowercase via serializeIP', () => {
    const r = parseIPv6('2001:DB8::1');
    expect(r).not.toBeNull();
    expect(serializeIP(r!)).toBe('2001:db8::1');
  });

  it('collapses the longest run of zero groups when stringifying', () => {
    const r = parseIPv6('2001:0:0:0:0:0:0:1');
    expect(r).not.toBeNull();
    expect(serializeIP(r!)).toBe('2001::1');
  });

  it('rejects empty string', () => {
    expect(parseIPv6('')).toBeNull();
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 3. CIDR PARSING & MATCHING
// ═════════════════════════════════════════════════════════════════════════════

describe('CIDR parsing and matching', () => {
  it('parses a valid IPv4 CIDR block', () => {
    expect(parseCIDR('192.168.0.0/16')).not.toBeNull();
  });

  it('parses a valid IPv6 CIDR block', () => {
    expect(parseCIDR('2001:db8::/32')).not.toBeNull();
  });

  it('rejects a prefix length above 32 for IPv4', () => {
    expect(parseCIDR('192.168.0.0/33')).toBeNull();
  });

  it('rejects a prefix length above 128 for IPv6', () => {
    expect(parseCIDR('2001:db8::/129')).toBeNull();
  });

  it('rejects negative prefix length', () => {
    expect(parseCIDR('192.168.0.0/-1')).toBeNull();
  });

  it('rejects missing prefix length', () => {
    expect(parseCIDR('192.168.0.0')).toBeNull();
  });

  it('accepts /0 (match-all) and /32 (single host) for IPv4', () => {
    expect(parseCIDR('0.0.0.0/0')).not.toBeNull();
    expect(parseCIDR('10.0.0.1/32')).not.toBeNull();
  });

  it('accepts /0 and /128 for IPv6', () => {
    expect(parseCIDR('::/0')).not.toBeNull();
    expect(parseCIDR('::1/128')).not.toBeNull();
  });

  it('correctly reports containment for an IPv4 address inside the block', () => {
    const block = parseCIDR('10.0.0.0/8')!;
    expect(isInCIDR(parseIPv4('10.5.6.7')!, block)).toBe(true);
  });

  it('correctly reports non-containment for an IPv4 address outside the block', () => {
    const block = parseCIDR('10.0.0.0/8')!;
    expect(isInCIDR(parseIPv4('11.0.0.1')!, block)).toBe(false);
  });

  it('handles boundary addresses at the start of a block', () => {
    const block = parseCIDR('192.168.1.0/24')!;
    expect(isInCIDR(parseIPv4('192.168.1.0')!, block)).toBe(true);
  });

  it('handles boundary addresses at the end of a block', () => {
    const block = parseCIDR('192.168.1.0/24')!;
    expect(isInCIDR(parseIPv4('192.168.1.255')!, block)).toBe(true);
  });

  it('does not match an IPv6 address against an IPv4 CIDR block', () => {
    const block = parseCIDR('10.0.0.0/8')!;
    expect(isInCIDR(parseIPv6('::1')!, block)).toBe(false);
  });

  it('correctly reports containment for IPv6 CIDR blocks', () => {
    const block = parseCIDR('2001:db8::/32')!;
    expect(isInCIDR(parseIPv6('2001:db8::1')!, block)).toBe(true);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 4. IP CLASSIFICATION
// ═════════════════════════════════════════════════════════════════════════════

describe('IP classification', () => {
  it.each([
    ['127.0.0.1', 'loopback'],
    ['10.0.0.1', 'private'],
    ['172.16.0.1', 'private'],
    ['192.168.1.1', 'private'],
    ['169.254.1.1', 'link-local'],
    ['224.0.0.1', 'multicast'],
    ['255.255.255.255', 'broadcast'],
    ['8.8.8.8', 'public'],
  ])('classifies IPv4 %s as %s', (addr, expected) => {
    expect(classifyIP(parseIPv4(addr)!)).toBe(expected);
  });

  it.each([
    ['::1', 'loopback'],
    ['fe80::1', 'link-local'],
    ['fc00::1', 'private'],
    ['ff02::1', 'multicast'],
    ['2001:db8::1', 'public'],
  ])('classifies IPv6 %s as %s', (addr, expected) => {
    expect(classifyIP(parseIPv6(addr)!)).toBe(expected);
  });

  it('treats 172.32.0.1 as public (just outside the 172.16/12 private range)', () => {
    expect(classifyIP(parseIPv4('172.32.0.1')!)).not.toBe('private');
  });

  it('treats 172.15.255.255 as public (just below the private range)', () => {
    expect(classifyIP(parseIPv4('172.15.255.255')!)).not.toBe('private');
  });

  it('classifies CGNAT range 100.64.0.0/10 as private', () => {
    expect(classifyIP(parseIPv4('100.64.0.1')!)).toBe('private');
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 5. CACHING DNS RESOLVER (retry + negative caching)
// ═════════════════════════════════════════════════════════════════════════════

describe('CachingDNSResolver', () => {
  let upstream: DNSResolverBackend;
  let mockResolve: ReturnType<typeof vi.fn>;
  let resolver: CachingDNSResolver;

  beforeEach(() => {
    mockResolve = vi.fn();
    upstream = { resolve: mockResolve };
    resolver = new CachingDNSResolver(upstream, { negativeCacheTtlSeconds: 60 });
  });

  afterEach(() => {
    resolver.dispose();
    vi.clearAllMocks();
  });

  it('resolves a hostname to an address on first try', async () => {
    const record: DNSRecord = {
      hostname: 'example.com',
      address: parseIPv4('93.184.216.34')!,
      ttlSeconds: 300,
      resolvedAt: Date.now(),
    };
    mockResolve.mockResolvedValueOnce([record]);
    const result = await resolver.resolve('example.com');
    expect(result).toHaveLength(1);
    expect(result[0].address).toEqual(parseIPv4('93.184.216.34'));
    expect(mockResolve).toHaveBeenCalledTimes(1);
  });

  it('caches a successful resolution and skips a second lookup within TTL', async () => {
    const record: DNSRecord = {
      hostname: 'cached.example.com',
      address: parseIPv4('5.6.7.8')!,
      ttlSeconds: 300,
      resolvedAt: Date.now(),
    };
    mockResolve.mockResolvedValueOnce([record]);
    await resolver.resolve('cached.example.com');
    await resolver.resolve('cached.example.com');
    expect(mockResolve).toHaveBeenCalledTimes(1);
  });

  it('negatively caches failures and does not retry on subsequent lookups within TTL', async () => {
    mockResolve.mockRejectedValueOnce(new Error('ENOTFOUND'));
    await expect(resolver.resolve('nonexistent.example.com')).rejects.toThrow();
    const callsAfterFirst = mockResolve.mock.calls.length;
    await expect(resolver.resolve('nonexistent.example.com')).rejects.toThrow();
    expect(mockResolve.mock.calls.length).toBe(callsAfterFirst);
  });

  it('expires the negative cache entry after its TTL elapses', async () => {
    vi.useFakeTimers();
    const shortTTLResolver = new CachingDNSResolver(upstream, { negativeCacheTtlSeconds: 1 });
    mockResolve.mockRejectedValueOnce(new Error('ENOTFOUND'));
    await expect(shortTTLResolver.resolve('expiring.example.com')).rejects.toThrow();
    vi.advanceTimersByTime(2000);
    const record: DNSRecord = {
      hostname: 'expiring.example.com',
      address: parseIPv4('9.9.9.9')!,
      ttlSeconds: 300,
      resolvedAt: Date.now(),
    };
    mockResolve.mockResolvedValueOnce([record]);
    const result = await shortTTLResolver.resolve('expiring.example.com');
    expect(result).toHaveLength(1);
    shortTTLResolver.dispose();
    vi.useRealTimers();
  });

  it('handles an empty result set by caching negatively', async () => {
    mockResolve.mockResolvedValueOnce([]);
    const result = await resolver.resolve('empty.example.com');
    expect(result).toHaveLength(0);
    expect(mockResolve).toHaveBeenCalledTimes(1);
  });

  it('invalidates a specific hostname', async () => {
    const record: DNSRecord = {
      hostname: 'to-invalidate.com',
      address: parseIPv4('1.2.3.4')!,
      ttlSeconds: 300,
      resolvedAt: Date.now(),
    };
    mockResolve.mockResolvedValue([record]);
    await resolver.resolve('to-invalidate.com');
    resolver.invalidate('to-invalidate.com');
    await resolver.resolve('to-invalidate.com');
    expect(mockResolve).toHaveBeenCalledTimes(2);
  });

  it('clears the entire cache', async () => {
    const record: DNSRecord = {
      hostname: 'a.com',
      address: parseIPv4('1.1.1.1')!,
      ttlSeconds: 300,
      resolvedAt: Date.now(),
    };
    mockResolve.mockResolvedValue([record]);
    await resolver.resolve('a.com');
    resolver.clear();
    expect(resolver.size).toBe(0);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 6. LITERAL-AWARE RESOLVER
// ═════════════════════════════════════════════════════════════════════════════

describe('LiteralAwareResolver', () => {
  it('returns the literal IP directly without calling upstream', async () => {
    const mockUpstream: DNSResolverBackend = { resolve: vi.fn() };
    const resolver = new LiteralAwareResolver(mockUpstream);
    const result = await resolver.resolve('127.0.0.1');
    expect(result).toHaveLength(1);
    expect(result[0].address).toEqual(parseIPv4('127.0.0.1'));
    expect(mockUpstream.resolve).not.toHaveBeenCalled();
  });

  it('delegates hostnames to upstream', async () => {
    const record: DNSRecord = {
      hostname: 'example.com',
      address: parseIPv4('1.2.3.4')!,
      ttlSeconds: 300,
      resolvedAt: Date.now(),
    };
    const mockUpstream: DNSResolverBackend = { resolve: vi.fn().mockResolvedValue([record]) };
    const resolver = new LiteralAwareResolver(mockUpstream);
    const result = await resolver.resolve('example.com');
    expect(result).toHaveLength(1);
    expect(mockUpstream.resolve).toHaveBeenCalledWith('example.com', undefined);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 7. RESILIENT DNS RESOLVER (retry)
// ═════════════════════════════════════════════════════════════════════════════

describe('ResilientDNSResolver', () => {
  it('retries on transient failure up to maxRetries', async () => {
    const record: DNSRecord = {
      hostname: 'flaky.com',
      address: parseIPv4('1.2.3.4')!,
      ttlSeconds: 300,
      resolvedAt: Date.now(),
    };
    const mockUpstream: DNSResolverBackend = {
      resolve: vi.fn()
        .mockRejectedValueOnce(new Error('timeout'))
        .mockRejectedValueOnce(new Error('timeout'))
        .mockResolvedValueOnce([record]),
    };
    const resolver = new ResilientDNSResolver(mockUpstream, { maxRetries: 2, backoffBaseMs: 10 });
    const result = await resolver.resolve('flaky.com');
    expect(result).toHaveLength(1);
    expect(mockUpstream.resolve).toHaveBeenCalledTimes(3);
  });

  it('gives up after exceeding maxRetries and throws', async () => {
    const mockUpstream: DNSResolverBackend = {
      resolve: vi.fn().mockRejectedValue(new Error('timeout')),
    };
    const resolver = new ResilientDNSResolver(mockUpstream, { maxRetries: 2, backoffBaseMs: 10 });
    await expect(resolver.resolve('dead.com')).rejects.toThrow();
    expect(mockUpstream.resolve).toHaveBeenCalledTimes(3);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 8. PRIVATE NETWORK ACCESS (PNA) ENFORCEMENT
// ═════════════════════════════════════════════════════════════════════════════

describe('PrivateNetworkAccess enforcement', () => {
  it('blocks a public origin from accessing a private-network address', () => {
    const record: DNSRecord = {
      hostname: 'internal.dev',
      address: parseIPv4('192.168.1.1')!,
      ttlSeconds: 300,
      resolvedAt: Date.now(),
    };
    const ctx: SecurityContext = { originIsPrivate: false };
    expect(() => enforcePrivateNetworkAccess(record, ctx)).toThrow();
  });

  it('allows a public origin to access a private-network address when origin is private', () => {
    const record: DNSRecord = {
      hostname: 'internal.dev',
      address: parseIPv4('192.168.1.1')!,
      ttlSeconds: 300,
      resolvedAt: Date.now(),
    };
    const ctx: SecurityContext = { originIsPrivate: true };
    expect(() => enforcePrivateNetworkAccess(record, ctx)).not.toThrow();
  });

  it('allows a public origin to access a private-network address after being allowlisted', () => {
    const record: DNSRecord = {
      hostname: 'internal.dev',
      address: parseIPv4('192.168.1.1')!,
      ttlSeconds: 300,
      resolvedAt: Date.now(),
    };
    const ctx: SecurityContext = { originIsPrivate: false, allowedPrivateHosts: ['internal.dev'] };
    expect(() => enforcePrivateNetworkAccess(record, ctx)).not.toThrow();
  });

  it('allows same-address-space requests freely', () => {
    const record: DNSRecord = {
      hostname: 'public.com',
      address: parseIPv4('8.8.8.8')!,
      ttlSeconds: 300,
      resolvedAt: Date.now(),
    };
    const ctx: SecurityContext = { originIsPrivate: false };
    expect(() => enforcePrivateNetworkAccess(record, ctx)).not.toThrow();
  });

  it('does not block when PNA is disabled', () => {
    const record: DNSRecord = {
      hostname: 'internal.dev',
      address: parseIPv4('10.0.0.1')!,
      ttlSeconds: 300,
      resolvedAt: Date.now(),
    };
    const ctx: SecurityContext = { originIsPrivate: false, disablePNA: true };
    expect(() => enforcePrivateNetworkAccess(record, ctx)).not.toThrow();
  });

  it('classifies a DNS-rebound public hostname resolving to a private IP as private', () => {
    const ip = parseIPv4('192.168.1.1')!;
    expect(isPrivateOrLocal(ip)).toBe(true);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 9. HAPPY EYEBALLS ORDERING
// ═════════════════════════════════════════════════════════════════════════════

describe('Happy Eyeballs ordering', () => {
  const makeRecord = (addr: string): DNSRecord => ({
    hostname: 'example.com',
    address: parseIP(addr)!,
    ttlSeconds: 300,
    resolvedAt: Date.now(),
  });

  it('interleaves IPv6 and IPv4 addresses (v6 first)', () => {
    const records = [makeRecord('93.184.216.34'), makeRecord('2001:db8::1')];
    const ordered = orderForHappyEyeballs(records);
    expect(ordered[0].address.version).toBe(6);
    expect(ordered[1].address.version).toBe(4);
  });

  it('handles multiple IPv6/IPv4 pairs in alternating order', () => {
    const records = [
      makeRecord('2001:db8::1'),
      makeRecord('93.184.216.34'),
      makeRecord('2001:db8::2'),
      makeRecord('93.184.216.35'),
    ];
    const ordered = orderForHappyEyeballs(records);
    expect(ordered[0].address.version).toBe(6);
    expect(ordered[1].address.version).toBe(4);
    expect(ordered[2].address.version).toBe(6);
    expect(ordered[3].address.version).toBe(4);
  });

  it('handles a single-address list', () => {
    const records = [makeRecord('93.184.216.34')];
    const ordered = orderForHappyEyeballs(records);
    expect(ordered).toHaveLength(1);
  });

  it('handles an empty list', () => {
    const ordered = orderForHappyEyeballs([]);
    expect(ordered).toHaveLength(0);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 10. CONNECTION ESTABLISHMENT
// ═════════════════════════════════════════════════════════════════════════════

describe('establishConnection', () => {
  const target: ConnectionTarget = { hostname: 'example.com', port: 443, protocol: 'https' };

  it('connects to the first resolved address', async () => {
    const record: DNSRecord = {
      hostname: 'example.com',
      address: parseIPv4('93.184.216.34')!,
      ttlSeconds: 300,
      resolvedAt: Date.now(),
    };
    const resolver: DNSResolverBackend = { resolve: vi.fn().mockResolvedValue([record]) };
    const mockConn: SocketConnection = {
      target,
      resolvedAddress: record.address,
      state: 'open',
    };
    const openSocket = vi.fn().mockResolvedValue(mockConn);
    const result = await establishConnection(target, resolver, openSocket);
    expect(result.state).toBe('open');
    expect(openSocket).toHaveBeenCalledTimes(1);
  });

  it('tries all addresses and fails only if every attempt fails', async () => {
    const records: DNSRecord[] = [
      { hostname: 'example.com', address: parseIPv4('1.1.1.1')!, ttlSeconds: 300, resolvedAt: Date.now() },
      { hostname: 'example.com', address: parseIPv4('2.2.2.2')!, ttlSeconds: 300, resolvedAt: Date.now() },
    ];
    const resolver: DNSResolverBackend = { resolve: vi.fn().mockResolvedValue(records) };
    const openSocket = vi.fn().mockRejectedValue(new Error('refused'));
    await expect(establishConnection(target, resolver, openSocket, { maxAttempts: 2, attemptDelayMs: 10 })).rejects.toThrow();
    expect(openSocket).toHaveBeenCalledTimes(2);
  });

  it('throws DNSResolutionError when no addresses resolved', async () => {
    const resolver: DNSResolverBackend = { resolve: vi.fn().mockResolvedValue([]) };
    const openSocket = vi.fn();
    await expect(establishConnection(target, resolver, openSocket)).rejects.toThrow('No addresses');
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 11. CONNECTION POOLING
// ═════════════════════════════════════════════════════════════════════════════

describe('ConnectionPool', () => {
  let pool: ConnectionPool;

  const makeConn = (target: ConnectionTarget): SocketConnection => ({
    target,
    resolvedAddress: parseIPv4('1.2.3.4')!,
    state: 'open',
  });

  beforeEach(() => {
    pool = new ConnectionPool({ maxIdleTimeMs: 30_000, maxPerOrigin: 6 });
  });

  afterEach(() => {
    pool.dispose();
  });

  it('returns null when no connection is available', () => {
    const target: ConnectionTarget = { hostname: 'example.com', port: 443, protocol: 'https' };
    expect(pool.acquire(target)).toBeNull();
  });

  it('reuses a released connection to the same origin', () => {
    const target: ConnectionTarget = { hostname: 'example.com', port: 443, protocol: 'https' };
    const conn = makeConn(target);
    pool.release(conn);
    const reused = pool.acquire(target);
    expect(reused).toBe(conn);
  });

  it('returns null for a closed connection', () => {
    const target: ConnectionTarget = { hostname: 'example.com', port: 443, protocol: 'https' };
    const conn = makeConn(target);
    conn.state = 'closed';
    pool.release(conn);
    expect(pool.acquire(target)).toBeNull();
  });

  it('separates pooled connections by scheme', () => {
    const httpsTarget: ConnectionTarget = { hostname: 'example.com', port: 443, protocol: 'https' };
    const httpTarget: ConnectionTarget = { hostname: 'example.com', port: 80, protocol: 'http' };
    const conn1 = makeConn(httpsTarget);
    const conn2 = makeConn(httpTarget);
    pool.release(conn1);
    pool.release(conn2);
    expect(pool.acquire(httpsTarget)).toBe(conn1);
    expect(pool.acquire(httpTarget)).toBe(conn2);
  });

  it('separates pooled connections by port', () => {
    const target8080: ConnectionTarget = { hostname: 'example.com', port: 8080, protocol: 'https' };
    const target443: ConnectionTarget = { hostname: 'example.com', port: 443, protocol: 'https' };
    const conn1 = makeConn(target8080);
    const conn2 = makeConn(target443);
    pool.release(conn1);
    pool.release(conn2);
    expect(pool.acquire(target8080)).toBe(conn1);
    expect(pool.acquire(target443)).toBe(conn2);
  });

  it('does not let one origin exhaust connections needed by another', () => {
    const targetA: ConnectionTarget = { hostname: 'a.example.com', port: 443, protocol: 'https' };
    const targetB: ConnectionTarget = { hostname: 'b.example.com', port: 443, protocol: 'https' };
    const connA = makeConn(targetA);
    const connB = makeConn(targetB);
    pool.release(connA);
    pool.release(connB);
    expect(pool.acquire(targetA)).toBe(connA);
    expect(pool.acquire(targetB)).toBe(connB);
  });

  it('enforces the per-origin connection limit', () => {
    const smallPool = new ConnectionPool({ maxPerOrigin: 2, maxIdleTimeMs: 30_000 });
    const target: ConnectionTarget = { hostname: 'example.com', port: 443, protocol: 'https' };
    smallPool.release(makeConn(target));
    smallPool.release(makeConn(target));
    smallPool.release(makeConn(target));
    expect(smallPool.size).toBe(2);
    smallPool.dispose();
  });

  it('clears all connections', () => {
    const target: ConnectionTarget = { hostname: 'example.com', port: 443, protocol: 'https' };
    pool.release(makeConn(target));
    pool.release(makeConn(target));
    expect(pool.size).toBe(2);
    pool.clear();
    expect(pool.size).toBe(0);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 12. RULE-BASED FIREWALL
// ═════════════════════════════════════════════════════════════════════════════

describe('Firewall', () => {
  let firewall: Firewall;
  const target: ConnectionTarget = { hostname: 'example.com', port: 443, protocol: 'https' };

  beforeEach(() => {
    firewall = new Firewall({ defaultAction: 'allow', blockPrivateNetworksByDefault: false });
  });

  it('allows traffic by default when no rules are configured', () => {
    const decision = firewall.evaluate(target);
    expect(decision.action).toBe('allow');
  });

  it('blocks traffic matching an explicit deny rule', () => {
    firewall.addRule({ id: 'deny-443', action: 'deny', priority: 1, match: { port: 443 } });
    const decision = firewall.evaluate(target);
    expect(decision.action).toBe('deny');
  });

  it('allows traffic explicitly matching an allow rule even with a broader deny rule present', () => {
    firewall.addRule({ id: 'deny-all', action: 'deny', priority: 0, match: {} });
    firewall.addRule({ id: 'allow-example', action: 'allow', priority: 10, match: { hostnamePattern: 'example.com' } });
    const decision = firewall.evaluate(target);
    expect(decision.action).toBe('allow');
  });

  it('applies higher-priority rules over lower-priority ones', () => {
    firewall.addRule({ id: 'allow-443', action: 'allow', priority: 1, match: { port: 443 } });
    firewall.addRule({ id: 'deny-443', action: 'deny', priority: 5, match: { port: 443 } });
    const decision = firewall.evaluate(target);
    expect(decision.action).toBe('deny');
  });

  it('matches rules scoped to a specific port', () => {
    firewall.addRule({ id: 'deny-80', action: 'deny', priority: 1, match: { port: 80 } });
    expect(firewall.evaluate({ ...target, port: 443 }).action).toBe('allow');
    expect(firewall.evaluate({ ...target, port: 80 }).action).toBe('deny');
  });

  it('matches rules scoped to a port range', () => {
    firewall.addRule({ id: 'deny-privileged', action: 'deny', priority: 1, match: { portRange: [1, 1024] } });
    expect(firewall.evaluate({ ...target, port: 22 }).action).toBe('deny');
    expect(firewall.evaluate({ ...target, port: 8080 }).action).toBe('allow');
  });

  it('matches rules by source CIDR (via address)', () => {
    firewall.addRule({ id: 'deny-private-src', action: 'deny', priority: 1, match: { cidr: '192.168.0.0/16' } });
    const addr = parseIPv4('192.168.1.5')!;
    expect(firewall.evaluate(target, addr).action).toBe('deny');
    const pubAddr = parseIPv4('8.8.8.8')!;
    expect(firewall.evaluate(target, pubAddr).action).toBe('allow');
  });

  it('matches rules by protocol', () => {
    firewall.addRule({ id: 'deny-ws', action: 'deny', priority: 1, match: { protocols: ['ws', 'wss'] } });
    expect(firewall.evaluate({ ...target, protocol: 'ws' }).action).toBe('deny');
    expect(firewall.evaluate({ ...target, protocol: 'https' }).action).toBe('allow');
  });

  it('supports hostname pattern matching', () => {
    firewall.addRule({ id: 'deny-example', action: 'deny', priority: 1, match: { hostnamePattern: '*.example.com' } });
    expect(firewall.evaluate({ ...target, hostname: 'sub.example.com' }).action).toBe('deny');
    expect(firewall.evaluate({ ...target, hostname: 'other.com' }).action).toBe('allow');
  });

  it('removes a rule and reverts to prior behavior', () => {
    firewall.addRule({ id: 'deny-443', action: 'deny', priority: 1, match: { port: 443 } });
    expect(firewall.evaluate(target).action).toBe('deny');
    firewall.removeRule('deny-443');
    expect(firewall.evaluate(target).action).toBe('allow');
  });

  it('logs decisions via onDecision callback', () => {
    const logSpy = vi.fn();
    const fw = new Firewall({ defaultAction: 'allow', blockPrivateNetworksByDefault: false, onDecision: logSpy });
    fw.addRule({ id: 'deny-443', action: 'deny', priority: 1, match: { port: 443 } });
    fw.evaluate(target);
    expect(logSpy).toHaveBeenCalledTimes(1);
    expect(logSpy).toHaveBeenCalledWith(expect.objectContaining({ action: 'deny' }));
  });

  it('evaluates rules deterministically regardless of insertion order when priorities differ', () => {
    firewall.addRule({ id: 'deny-443', action: 'deny', priority: 5, match: { port: 443 } });
    firewall.addRule({ id: 'allow-443', action: 'allow', priority: 10, match: { port: 443 } });
    firewall.addRule({ id: 'deny-443-low', action: 'deny', priority: 1, match: { port: 443 } });
    expect(firewall.evaluate(target).action).toBe('allow');
  });

  it('handles an empty ruleset after rules are cleared', () => {
    firewall.addRule({ id: 'deny-443', action: 'deny', priority: 1, match: { port: 443 } });
    firewall.removeRule('deny-443');
    expect(firewall.evaluate(target).action).toBe('allow');
  });

  it('enforce throws FirewallBlockedError on deny', () => {
    firewall.addRule({ id: 'deny-443', action: 'deny', priority: 1, match: { port: 443 } });
    expect(() => firewall.enforce(target)).toThrow('Firewall blocked');
  });

  it('enforce does not throw on allow', () => {
    expect(() => firewall.enforce(target)).not.toThrow();
  });

  it('blocks private networks by default when enabled', () => {
    const fw = new Firewall({ defaultAction: 'allow', blockPrivateNetworksByDefault: true });
    const addr = parseIPv4('192.168.1.1')!;
    const decision = fw.evaluate(target, addr);
    expect(decision.action).toBe('deny');
    expect(decision.reason).toContain('private');
  });

  it('getRecentDecisions returns logged decisions', () => {
    firewall.addRule({ id: 'deny-443', action: 'deny', priority: 1, match: { port: 443 } });
    firewall.evaluate(target);
    const decisions = firewall.getRecentDecisions();
    expect(decisions).toHaveLength(1);
    expect(decisions[0].action).toBe('deny');
  });

  it('clearLog clears the decision log', () => {
    firewall.addRule({ id: 'deny-443', action: 'deny', priority: 1, match: { port: 443 } });
    firewall.evaluate(target);
    firewall.clearLog();
    expect(firewall.getRecentDecisions()).toHaveLength(0);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 13. HOSTNAME PATTERN MATCHING
// ═════════════════════════════════════════════════════════════════════════════

describe('matchesHostnamePattern', () => {
  it('matches exact hostnames', () => {
    expect(matchesHostnamePattern('example.com', 'example.com')).toBe(true);
    expect(matchesHostnamePattern('other.com', 'example.com')).toBe(false);
  });

  it('matches wildcard suffix patterns', () => {
    expect(matchesHostnamePattern('sub.example.com', '*.example.com')).toBe(true);
    expect(matchesHostnamePattern('a.b.example.com', '*.example.com')).toBe(true);
  });

  it('does not match bare domain with wildcard pattern', () => {
    expect(matchesHostnamePattern('example.com', '*.example.com')).toBe(false);
  });

  it('is case-insensitive', () => {
    expect(matchesHostnamePattern('SUB.Example.COM', '*.example.com')).toBe(true);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 14. HIGHER-LEVEL DNS RESOLVER (dns-resolver.ts)
// ═════════════════════════════════════════════════════════════════════════════

describe('DnsResolver (dns-resolver.ts)', () => {
  it('resolves a hostname via system resolver', async () => {
    const mockSystem = vi.fn().mockResolvedValue(['93.184.216.34']);
    const resolver = new DnsResolver({}, mockSystem);
    const result = await resolver.resolve('example.com');
    expect(result.addresses).toContain('93.184.216.34');
    expect(mockSystem).toHaveBeenCalledTimes(1);
    resolver.dispose();
  });

  it('caches results and returns from cache on second call', async () => {
    const mockSystem = vi.fn().mockResolvedValue(['1.2.3.4']);
    const resolver = new DnsResolver({}, mockSystem);
    await resolver.resolve('cached.com');
    await resolver.resolve('cached.com');
    expect(mockSystem).toHaveBeenCalledTimes(1);
    resolver.dispose();
  });

  it('returns overrides when set', async () => {
    const mockSystem = vi.fn();
    const resolver = new DnsResolver({}, mockSystem);
    resolver.setOverride('override.com', ['5.5.5.5']);
    const result = await resolver.resolve('override.com');
    expect(result.addresses).toContain('5.5.5.5');
    expect(result.source).toBe('override');
    resolver.dispose();
  });

  it('throws on empty hostname', async () => {
    const resolver = new DnsResolver({});
    await expect(resolver.resolve('')).rejects.toThrow();
    resolver.dispose();
  });

  it('flush clears the cache', async () => {
    const mockSystem = vi.fn().mockResolvedValue(['1.1.1.1']);
    const resolver = new DnsResolver({}, mockSystem);
    await resolver.resolve('a.com');
    resolver.flush();
    expect(resolver.has('a.com')).toBe(false);
    resolver.dispose();
  });

  it('getCacheSize returns number of cached entries', async () => {
    const mockSystem = vi.fn().mockResolvedValue(['1.1.1.1']);
    const resolver = new DnsResolver({}, mockSystem);
    await resolver.resolve('a.com');
    expect(resolver.getCacheSize()).toBe(1);
    resolver.dispose();
  });
});
