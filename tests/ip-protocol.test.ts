import { describe, it, expect, beforeEach } from 'vitest';
import {
  parseIPv4, isValidIPv4, parseIPv6, isValidIPv6, parseIP, isValidIP,
  serializeIP, serializeIPForURL, ipToBigInt, ipEquals, sortIPs,
  parseCIDR, isInCIDR, isInAnyCIDR, classifyIP, isPrivateOrLocal,
  enforcePrivateNetworkAccess, CachingDNSResolver, LiteralAwareResolver,
  ResilientDNSResolver, orderForHappyEyeballs, establishConnection,
  ConnectionPool, IPProtocolError, DNSResolutionError, DNSTimeoutError,
  PrivateNetworkAccessError, ConnectionEstablishmentError,
  type DNSRecord, type SecurityContext, type ConnectionTarget,
  type SocketConnection, type DNSResolverBackend,
} from '../src/browser/networking/ip-protocol';

// ═════════════════════════════════════════════════════════════════════════════
// IPv4 Parsing
// ═════════════════════════════════════════════════════════════════════════════

describe('IPv4 Parsing', () => {
  it('parses valid addresses', () => {
    const r = parseIPv4('192.168.1.1');
    expect(r).not.toBeNull();
    expect(r!.octets).toEqual([192, 168, 1, 1]);
    expect(r!.version).toBe(4);
    expect(r!.raw).toBe('192.168.1.1');
  });

  it('parses boundary values', () => {
    expect(parseIPv4('0.0.0.0')!.octets).toEqual([0, 0, 0, 0]);
    expect(parseIPv4('255.255.255.255')!.octets).toEqual([255, 255, 255, 255]);
    expect(parseIPv4('127.0.0.1')!.octets).toEqual([127, 0, 0, 1]);
  });

  it('rejects leading zeros', () => {
    expect(parseIPv4('01.2.3.4')).toBeNull();
    expect(parseIPv4('192.168.01.1')).toBeNull();
    expect(parseIPv4('00.0.0.0')).toBeNull();
  });

  it('rejects out-of-range octets', () => {
    expect(parseIPv4('256.0.0.0')).toBeNull();
    expect(parseIPv4('1.2.3.999')).toBeNull();
    expect(parseIPv4('1.2.3.256')).toBeNull();
  });

  it('rejects non-numeric', () => {
    expect(parseIPv4('abc.def.ghi.jkl')).toBeNull();
    expect(parseIPv4('1.2.3')).toBeNull();
    expect(parseIPv4('1.2.3.4.5')).toBeNull();
  });

  it('trims whitespace', () => {
    expect(parseIPv4('  10.0.0.1  ')!.octets).toEqual([10, 0, 0, 1]);
  });

  it('isValidIPv4 works', () => {
    expect(isValidIPv4('10.0.0.1')).toBe(true);
    expect(isValidIPv4('999.0.0.0')).toBe(false);
    expect(isValidIPv4('not-an-ip')).toBe(false);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// IPv6 Parsing
// ═════════════════════════════════════════════════════════════════════════════

describe('IPv6 Parsing', () => {
  it('parses full address', () => {
    const r = parseIPv6('2001:0db8:85a3:0000:0000:8a2e:0370:7334');
    expect(r).not.toBeNull();
    expect(r!.groups).toEqual([0x2001, 0x0db8, 0x85a3, 0, 0, 0x8a2e, 0x0370, 0x7334]);
    expect(r!.version).toBe(6);
  });

  it('parses loopback', () => {
    const r = parseIPv6('::1');
    expect(r).not.toBeNull();
    expect(r!.groups).toEqual([0, 0, 0, 0, 0, 0, 0, 1]);
  });

  it('parses unspecified', () => {
    const r = parseIPv6('::');
    expect(r).not.toBeNull();
    expect(r!.groups).toEqual([0, 0, 0, 0, 0, 0, 0, 0]);
  });

  it('parses compressed addresses', () => {
    expect(parseIPv6('fe80::1')!.groups[0]).toBe(0xfe80);
    expect(parseIPv6('fe80::1')!.groups[7]).toBe(1);
    const r = parseIPv6('2001:db8::1');
    expect(r).not.toBeNull();
    expect(r!.groups[0]).toBe(0x2001);
    expect(r!.groups[1]).toBe(0x0db8);
    expect(r!.groups[7]).toBe(1);
  });

  it('parses zone IDs', () => {
    const r = parseIPv6('fe80::1%eth0');
    expect(r).not.toBeNull();
    expect(r!.zoneId).toBe('eth0');
    expect(r!.groups[7]).toBe(1);
  });

  it('parses bracket notation', () => {
    const r = parseIPv6('[::1]');
    expect(r).not.toBeNull();
    expect(r!.groups[7]).toBe(1);
  });

  it('parses embedded IPv4 tail', () => {
    const r = parseIPv6('::ffff:192.168.1.1');
    expect(r).not.toBeNull();
    expect(r!.groups[5]).toBe(0xffff);
    expect(r!.groups[6]).toBe((192 << 8) | 168);
    expect(r!.groups[7]).toBe((1 << 8) | 1);
  });

  it('rejects multiple :: compressions', () => {
    expect(parseIPv6('::1::2')).toBeNull();
  });

  it('rejects invalid group values', () => {
    expect(parseIPv6('2001:xyz::1')).toBeNull();
    expect(parseIPv6('2001:00000::1')).toBeNull();
  });

  it('rejects wrong group count without ::', () => {
    expect(parseIPv6('2001:db8:85a3')).toBeNull();
  });

  it('rejects empty zone ID', () => {
    expect(parseIPv6('fe80::1%')).toBeNull();
  });

  it('isValidIPv6 works', () => {
    expect(isValidIPv6('::1')).toBe(true);
    expect(isValidIPv6('fe80::1%eth0')).toBe(true);
    expect(isValidIPv6('not-ipv6')).toBe(false);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Unified Parse + Serialize
// ═════════════════════════════════════════════════════════════════════════════

describe('Unified Parse + Serialize', () => {
  it('parseIP tries IPv4 first, then IPv6', () => {
    expect(parseIP('10.0.0.1')?.version).toBe(4);
    expect(parseIP('::1')?.version).toBe(6);
  });

  it('parseIP returns null for invalid', () => {
    expect(parseIP('not-an-ip')).toBeNull();
    expect(parseIP('')).toBeNull();
  });

  it('isValidIP works', () => {
    expect(isValidIP('10.0.0.1')).toBe(true);
    expect(isValidIP('::1')).toBe(true);
    expect(isValidIP('invalid')).toBe(false);
  });

  it('serializeIP round-trips IPv4', () => {
    expect(serializeIP(parseIPv4('192.168.1.1')!)).toBe('192.168.1.1');
  });

  it('serializeIP compresses IPv6', () => {
    expect(serializeIP(parseIPv6('::1')!)).toBe('::1');
  });

  it('serializeIP includes zone ID', () => {
    expect(serializeIP(parseIPv6('fe80::1%eth0')!)).toBe('fe80::1%eth0');
  });

  it('serializeIPForURL wraps IPv6 in brackets', () => {
    expect(serializeIPForURL(parseIPv6('::1')!)).toBe('[::1]');
    expect(serializeIPForURL(parseIPv4('10.0.0.1')!)).toBe('10.0.0.1');
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Comparison & Sorting
// ═════════════════════════════════════════════════════════════════════════════

describe('Comparison & Sorting', () => {
  it('ipToBigInt works for IPv4', () => {
    const val = ipToBigInt(parseIPv4('192.168.1.1')!);
    expect(val).toBe(192n * 256n ** 3n + 168n * 256n ** 2n + 256n + 1n);
  });

  it('ipToBigInt works for IPv6', () => {
    expect(ipToBigInt(parseIPv6('::1')!)).toBe(1n);
  });

  it('ipEquals matches same addresses', () => {
    expect(ipEquals(parseIPv4('10.0.0.1')!, parseIPv4('10.0.0.1')!)).toBe(true);
  });

  it('ipEquals rejects different addresses', () => {
    expect(ipEquals(parseIPv4('10.0.0.1')!, parseIPv4('10.0.0.2')!)).toBe(false);
  });

  it('ipEquals rejects different versions', () => {
    expect(ipEquals(parseIPv4('10.0.0.1')!, parseIPv6('::1')!)).toBe(false);
  });

  it('sortIPs orders numerically', () => {
    const sorted = sortIPs([parseIPv4('10.0.0.3')!, parseIPv4('10.0.0.1')!, parseIPv4('10.0.0.2')!]);
    expect(sorted.map((ip) => serializeIP(ip))).toEqual(['10.0.0.1', '10.0.0.2', '10.0.0.3']);
  });

  it('sortIPs puts IPv4 before IPv6', () => {
    expect(sortIPs([parseIPv6('::1')!, parseIPv4('0.0.0.1')!])[0]!.version).toBe(4);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// CIDR
// ═════════════════════════════════════════════════════════════════════════════

describe('CIDR', () => {
  it('parses valid CIDR notation', () => {
    const r = parseCIDR('192.168.0.0/16');
    expect(r).not.toBeNull();
    expect(r!.prefixLength).toBe(16);
    expect(r!.base.version).toBe(4);
  });

  it('parses IPv6 CIDR', () => {
    const r = parseCIDR('fc00::/7');
    expect(r).not.toBeNull();
    expect(r!.prefixLength).toBe(7);
    expect(r!.base.version).toBe(6);
  });

  it('rejects missing slash', () => {
    expect(parseCIDR('192.168.0.0')).toBeNull();
  });

  it('rejects invalid prefix length', () => {
    expect(parseCIDR('192.168.0.0/33')).toBeNull();
    expect(parseCIDR('192.168.0.0/-1')).toBeNull();
    expect(parseCIDR('fc00::/129')).toBeNull();
  });

  it('rejects non-numeric prefix', () => {
    expect(parseCIDR('192.168.0.0/abc')).toBeNull();
  });

  it('isInCIDR matches addresses in range', () => {
    const range = parseCIDR('192.168.0.0/16')!;
    expect(isInCIDR(parseIPv4('192.168.0.1')!, range)).toBe(true);
    expect(isInCIDR(parseIPv4('192.168.255.255')!, range)).toBe(true);
    expect(isInCIDR(parseIPv4('192.169.0.1')!, range)).toBe(false);
    expect(isInCIDR(parseIPv4('10.0.0.1')!, range)).toBe(false);
  });

  it('isInCIDR handles /0 (matches all)', () => {
    expect(isInCIDR(parseIPv4('1.2.3.4')!, parseCIDR('0.0.0.0/0')!)).toBe(true);
  });

  it('isInCIDR rejects different IP versions', () => {
    expect(isInCIDR(parseIPv6('::1')!, parseCIDR('192.168.0.0/16')!)).toBe(false);
  });

  it('isInAnyCIDR checks multiple ranges', () => {
    const ip = parseIPv4('10.0.0.1')!;
    expect(isInAnyCIDR(ip, ['192.168.0.0/16', '10.0.0.0/8'])).toBe(true);
    expect(isInAnyCIDR(ip, ['192.168.0.0/16', '172.16.0.0/12'])).toBe(false);
  });

  it('isInAnyCIDR handles invalid CIDR strings gracefully', () => {
    expect(isInAnyCIDR(parseIPv4('10.0.0.1')!, ['invalid', '10.0.0.0/8'])).toBe(true);
  });

  it('isInCIDR works for /32', () => {
    const range = parseCIDR('192.168.1.1/32')!;
    expect(isInCIDR(parseIPv4('192.168.1.1')!, range)).toBe(true);
    expect(isInCIDR(parseIPv4('192.168.1.2')!, range)).toBe(false);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Address Classification
// ═════════════════════════════════════════════════════════════════════════════

describe('Address Classification', () => {
  it('classifies IPv4 loopback', () => {
    expect(classifyIP(parseIPv4('127.0.0.1')!)).toBe('loopback');
    expect(classifyIP(parseIPv4('127.255.255.255')!)).toBe('loopback');
  });

  it('classifies IPv4 private ranges', () => {
    expect(classifyIP(parseIPv4('10.0.0.1')!)).toBe('private');
    expect(classifyIP(parseIPv4('172.16.0.1')!)).toBe('private');
    expect(classifyIP(parseIPv4('172.31.255.255')!)).toBe('private');
    expect(classifyIP(parseIPv4('192.168.1.1')!)).toBe('private');
    expect(classifyIP(parseIPv4('100.64.0.1')!)).toBe('private');
  });

  it('classifies IPv4 link-local', () => {
    expect(classifyIP(parseIPv4('169.254.0.1')!)).toBe('link-local');
  });

  it('classifies IPv4 multicast', () => {
    expect(classifyIP(parseIPv4('224.0.0.1')!)).toBe('multicast');
    expect(classifyIP(parseIPv4('239.255.255.255')!)).toBe('multicast');
  });

  it('classifies IPv4 unspecified and broadcast', () => {
    expect(classifyIP(parseIPv4('0.0.0.0')!)).toBe('unspecified');
    expect(classifyIP(parseIPv4('255.255.255.255')!)).toBe('broadcast');
  });

  it('classifies IPv4 public', () => {
    expect(classifyIP(parseIPv4('8.8.8.8')!)).toBe('public');
    expect(classifyIP(parseIPv4('1.1.1.1')!)).toBe('public');
  });

  it('classifies IPv6 loopback', () => {
    expect(classifyIP(parseIPv6('::1')!)).toBe('loopback');
  });

  it('classifies IPv6 unspecified', () => {
    expect(classifyIP(parseIPv6('::')!)).toBe('unspecified');
  });

  it('classifies IPv6 link-local', () => {
    expect(classifyIP(parseIPv6('fe80::1')!)).toBe('link-local');
  });

  it('classifies IPv6 unique local (private)', () => {
    expect(classifyIP(parseIPv6('fc00::1')!)).toBe('private');
    expect(classifyIP(parseIPv6('fd00::1')!)).toBe('private');
  });

  it('classifies IPv6 multicast', () => {
    expect(classifyIP(parseIPv6('ff02::1')!)).toBe('multicast');
  });

  it('classifies IPv6 public', () => {
    expect(classifyIP(parseIPv6('2001:db8::1')!)).toBe('public');
  });

  it('classifies IPv4-mapped IPv6 by embedded IPv4', () => {
    expect(classifyIP(parseIPv6('::ffff:192.168.1.1')!)).toBe('private');
    expect(classifyIP(parseIPv6('::ffff:8.8.8.8')!)).toBe('public');
  });

  it('isPrivateOrLocal combines private, loopback, link-local, unspecified', () => {
    expect(isPrivateOrLocal(parseIPv4('10.0.0.1')!)).toBe(true);
    expect(isPrivateOrLocal(parseIPv4('127.0.0.1')!)).toBe(true);
    expect(isPrivateOrLocal(parseIPv4('169.254.1.1')!)).toBe(true);
    expect(isPrivateOrLocal(parseIPv4('0.0.0.0')!)).toBe(true);
    expect(isPrivateOrLocal(parseIPv4('8.8.8.8')!)).toBe(false);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Private Network Access
// ═════════════════════════════════════════════════════════════════════════════

describe('Private Network Access', () => {
  const pub: SecurityContext = { originIsPrivate: false };
  const priv: SecurityContext = { originIsPrivate: true };
  const disabled: SecurityContext = { originIsPrivate: false, disablePNA: true };
  const allowlisted: SecurityContext = { originIsPrivate: false, allowedPrivateHosts: ['dev.local'] };

  const rec = (h: string, ip: string): DNSRecord => ({
    hostname: h, address: parseIP(ip)!, ttlSeconds: 300, resolvedAt: Date.now(),
  });

  it('allows public -> public', () => {
    expect(() => enforcePrivateNetworkAccess(rec('example.com', '8.8.8.8'), pub)).not.toThrow();
  });

  it('blocks public -> private', () => {
    expect(() => enforcePrivateNetworkAccess(rec('internal.dev', '10.0.0.1'), pub)).toThrow(PrivateNetworkAccessError);
  });

  it('allows private -> private', () => {
    expect(() => enforcePrivateNetworkAccess(rec('internal.dev', '10.0.0.1'), priv)).not.toThrow();
  });

  it('allows when PNA disabled', () => {
    expect(() => enforcePrivateNetworkAccess(rec('internal.dev', '10.0.0.1'), disabled)).not.toThrow();
  });

  it('allows when hostname is allowlisted', () => {
    expect(() => enforcePrivateNetworkAccess(rec('dev.local', '192.168.1.1'), allowlisted)).not.toThrow();
  });

  it('blocks non-allowlisted private host', () => {
    expect(() => enforcePrivateNetworkAccess(rec('other.dev', '192.168.1.1'), allowlisted)).toThrow(PrivateNetworkAccessError);
  });

  it('blocks loopback from public origin', () => {
    expect(() => enforcePrivateNetworkAccess(rec('localhost', '127.0.0.1'), pub)).toThrow(PrivateNetworkAccessError);
  });

  it('allows loopback from private origin', () => {
    expect(() => enforcePrivateNetworkAccess(rec('localhost', '127.0.0.1'), priv)).not.toThrow();
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Error Classes
// ═════════════════════════════════════════════════════════════════════════════

describe('Error Classes', () => {
  it('IPProtocolError hierarchy', () => {
    expect(new IPProtocolError('t').name).toBe('IPProtocolError');
    expect(new DNSResolutionError('h', 'm').name).toBe('DNSResolutionError');
    expect(new DNSTimeoutError('h', 5000).message).toContain('5000ms');
    expect(new DNSTimeoutError('h', 5000) instanceof DNSResolutionError).toBe(true);
    expect(new PrivateNetworkAccessError('h', 'a') instanceof IPProtocolError).toBe(true);
  });

  it('ConnectionEstablishmentError carries context', () => {
    const t: ConnectionTarget = { hostname: 'h', port: 443, protocol: 'https' };
    const e = new ConnectionEstablishmentError(t, 3, new Error('refused'));
    expect(e.attempts).toBe(3);
    expect(e.target).toBe(t);
    expect(e.message).toContain('3 attempt(s)');
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// CachingDNSResolver
// ═════════════════════════════════════════════════════════════════════════════

describe('CachingDNSResolver', () => {
  let callCount: number;
  let upstream: DNSResolverBackend;
  let resolver: CachingDNSResolver;

  beforeEach(() => {
    callCount = 0;
    upstream = {
      async resolve(hostname: string) {
        callCount++;
        return [{ hostname, address: parseIPv4('1.2.3.4')!, ttlSeconds: 60, resolvedAt: Date.now() }];
      },
    };
    resolver = new CachingDNSResolver(upstream, { negativeCacheTtlSeconds: 5, maxTtlSeconds: 120 });
  });

  it('delegates to upstream on cache miss', async () => {
    const records = await resolver.resolve('example.com');
    expect(records).toHaveLength(1);
    expect(callCount).toBe(1);
  });

  it('returns cached result on second call', async () => {
    await resolver.resolve('example.com');
    await resolver.resolve('example.com');
    expect(callCount).toBe(1);
  });

  it('caches negative results', async () => {
    const neg = new CachingDNSResolver({ async resolve() { return []; } }, { negativeCacheTtlSeconds: 5 });
    expect(await neg.resolve('no-such')).toHaveLength(0);
    await expect(neg.resolve('no-such')).rejects.toThrow('negative DNS cache');
  });

  it('caches upstream errors', async () => {
    const fail = new CachingDNSResolver({ async resolve() { throw new Error('net err'); } }, { negativeCacheTtlSeconds: 5 });
    await expect(fail.resolve('bad')).rejects.toThrow('net err');
    await expect(fail.resolve('bad')).rejects.toThrow('negative DNS cache');
  });

  it('invalidate clears cache', async () => {
    await resolver.resolve('a.com');
    resolver.invalidate('a.com');
    await resolver.resolve('a.com');
    expect(callCount).toBe(2);
  });

  it('clear removes all caches', async () => {
    await resolver.resolve('a.com');
    await resolver.resolve('b.com');
    resolver.clear();
    await resolver.resolve('a.com');
    expect(callCount).toBe(3);
  });

  it('dispose clears cache', () => {
    resolver.dispose();
    expect(resolver.size).toBe(0);
  });

  it('caps TTL to maxTtlSeconds', async () => {
    const longUp: DNSResolverBackend = {
      async resolve(h) {
        return [{ hostname: h, address: parseIPv4('5.6.7.8')!, ttlSeconds: 86400, resolvedAt: Date.now() }];
      },
    };
    const cap = new CachingDNSResolver(longUp, { maxTtlSeconds: 300 });
    expect((await cap.resolve('long.com'))[0]!.ttlSeconds).toBe(300);
  });

  it('filters by preferred version', async () => {
    const dual: DNSResolverBackend = {
      async resolve(h) {
        return [
          { hostname: h, address: parseIPv4('1.2.3.4')!, ttlSeconds: 60, resolvedAt: Date.now() },
          { hostname: h, address: parseIPv6('::1')!, ttlSeconds: 60, resolvedAt: Date.now() },
        ];
      },
    };
    const r = new CachingDNSResolver(dual);
    expect((await r.resolve('dual.host', 4)).every((x) => x.address.version === 4)).toBe(true);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// LiteralAwareResolver
// ═════════════════════════════════════════════════════════════════════════════

describe('LiteralAwareResolver', () => {
  it('short-circuits for IPv4 literal', async () => {
    let called = false;
    const upstream: DNSResolverBackend = { async resolve() { called = true; return []; } };
    const r = new LiteralAwareResolver(upstream);
    const records = await r.resolve('10.0.0.1');
    expect(called).toBe(false);
    expect(records).toHaveLength(1);
    expect(records[0]!.address.version).toBe(4);
  });

  it('short-circuits for IPv6 literal', async () => {
    let called = false;
    const upstream: DNSResolverBackend = { async resolve() { called = true; return []; } };
    const r = new LiteralAwareResolver(upstream);
    const records = await r.resolve('::1');
    expect(called).toBe(false);
    expect(records[0]!.address.version).toBe(6);
  });

  it('delegates hostnames to upstream', async () => {
    let called = false;
    const upstream: DNSResolverBackend = { async resolve() { called = true; return []; } };
    const r = new LiteralAwareResolver(upstream);
    await r.resolve('example.com');
    expect(called).toBe(true);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// ResilientDNSResolver
// ═════════════════════════════════════════════════════════════════════════════

describe('ResilientDNSResolver', () => {
  it('returns records on first success', async () => {
    const up: DNSResolverBackend = {
      async resolve(h) { return [{ hostname: h, address: parseIPv4('1.1.1.1')!, ttlSeconds: 60, resolvedAt: Date.now() }]; },
    };
    const r = new ResilientDNSResolver(up);
    expect(await r.resolve('ok.com')).toHaveLength(1);
  });

  it('retries and succeeds', async () => {
    let attempts = 0;
    const up: DNSResolverBackend = {
      async resolve(h) {
        attempts++;
        if (attempts < 3) throw new Error('fail');
        return [{ hostname: h, address: parseIPv4('2.2.2.2')!, ttlSeconds: 60, resolvedAt: Date.now() }];
      },
    };
    const r = new ResilientDNSResolver(up, { backoffBaseMs: 10 });
    expect(await r.resolve('retry.com')).toHaveLength(1);
    expect(attempts).toBe(3);
  });

  it('throws after max retries', async () => {
    const up: DNSResolverBackend = { async resolve() { throw new Error('always fail'); } };
    const r = new ResilientDNSResolver(up, { maxRetries: 1, backoffBaseMs: 10 });
    await expect(r.resolve('fail.com')).rejects.toThrow();
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Happy Eyeballs
// ═════════════════════════════════════════════════════════════════════════════

describe('Happy Eyeballs', () => {
  const rec = (ip: string): DNSRecord => ({
    hostname: 'test', address: parseIP(ip)!, ttlSeconds: 60, resolvedAt: Date.now(),
  });

  it('interleaves v6 and v4', () => {
    const records = [rec('::1'), rec('::2'), rec('1.1.1.1'), rec('2.2.2.2')];
    const ordered = orderForHappyEyeballs(records);
    expect(ordered[0]!.address.version).toBe(6);
    expect(ordered[1]!.address.version).toBe(4);
    expect(ordered[2]!.address.version).toBe(6);
    expect(ordered[3]!.address.version).toBe(4);
  });

  it('handles only v4', () => {
    const ordered = orderForHappyEyeballs([rec('1.1.1.1'), rec('2.2.2.2')]);
    expect(ordered).toHaveLength(2);
    expect(ordered.every((r) => r.address.version === 4)).toBe(true);
  });

  it('handles only v6', () => {
    const ordered = orderForHappyEyeballs([rec('::1'), rec('::2')]);
    expect(ordered).toHaveLength(2);
    expect(ordered.every((r) => r.address.version === 6)).toBe(true);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// establishConnection
// ═════════════════════════════════════════════════════════════════════════════

describe('establishConnection', () => {
  const target: ConnectionTarget = { hostname: 'example.com', port: 443, protocol: 'https' };
  const makeSocket = (addr: string): SocketConnection => ({
    target, resolvedAddress: parseIP(addr)!, state: 'open', localPort: 12345,
  });

  it('connects to first resolved address', async () => {
    const resolver: DNSResolverBackend = {
      async resolve(h) { return [{ hostname: h, address: parseIPv4('1.1.1.1')!, ttlSeconds: 60, resolvedAt: Date.now() }]; },
    };
    const conn = await establishConnection(target, resolver, async (addr) => makeSocket(serializeIP(addr)));
    expect(conn.state).toBe('open');
    expect(conn.openedAt).toBeGreaterThan(0);
  });

  it('throws DNSResolutionError on empty records', async () => {
    const resolver: DNSResolverBackend = { async resolve() { return []; } };
    await expect(establishConnection(target, resolver, async () => makeSocket('1.1.1.1'))).rejects.toThrow(DNSResolutionError);
  });

  it('retries on first failure, connects on second', async () => {
    let attempt = 0;
    const resolver: DNSResolverBackend = {
      async resolve(h) {
        return [
          { hostname: h, address: parseIPv4('1.1.1.1')!, ttlSeconds: 60, resolvedAt: Date.now() },
          { hostname: h, address: parseIPv4('2.2.2.2')!, ttlSeconds: 60, resolvedAt: Date.now() },
        ];
      },
    };
    const conn = await establishConnection(target, resolver, async (addr) => {
      attempt++;
      if (attempt === 1) throw new Error('refused');
      return makeSocket(serializeIP(addr));
    }, { attemptDelayMs: 10 });
    expect(conn.state).toBe('open');
    expect(attempt).toBe(2);
  });

  it('blocks public -> private via PNA', async () => {
    const resolver: DNSResolverBackend = {
      async resolve(h) { return [{ hostname: h, address: parseIPv4('10.0.0.1')!, ttlSeconds: 60, resolvedAt: Date.now() }]; },
    };
    await expect(
      establishConnection(target, resolver, async () => makeSocket('10.0.0.1'), { securityContext: { originIsPrivate: false } }),
    ).rejects.toThrow(PrivateNetworkAccessError);
  });

  it('calls onAttempt callback', async () => {
    const attempts: number[] = [];
    const resolver: DNSResolverBackend = {
      async resolve(h) { return [{ hostname: h, address: parseIPv4('1.1.1.1')!, ttlSeconds: 60, resolvedAt: Date.now() }]; },
    };
    await establishConnection(target, resolver, async (addr) => makeSocket(serializeIP(addr)), {
      onAttempt: (_r, n) => attempts.push(n),
    });
    expect(attempts).toEqual([1]);
  });

  it('throws ConnectionEstablishmentError when all attempts fail', async () => {
    const resolver: DNSResolverBackend = {
      async resolve(h) { return [{ hostname: h, address: parseIPv4('1.1.1.1')!, ttlSeconds: 60, resolvedAt: Date.now() }]; },
    };
    await expect(
      establishConnection(target, resolver, async () => { throw new Error('nope'); }, { maxAttempts: 1 }),
    ).rejects.toThrow(ConnectionEstablishmentError);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// ConnectionPool
// ═════════════════════════════════════════════════════════════════════════════

describe('ConnectionPool', () => {
  const target: ConnectionTarget = { hostname: 'h', port: 443, protocol: 'https' };
  const conn: SocketConnection = {
    target, resolvedAddress: parseIPv4('1.1.1.1')!, state: 'open', localPort: 1234,
  };

  it('acquire returns null when empty', () => {
    expect(new ConnectionPool().acquire(target)).toBeNull();
  });

  it('release + acquire round-trips', () => {
    const pool = new ConnectionPool();
    pool.release(conn);
    expect(pool.acquire(target)).toBe(conn);
  });

  it('does not release closed connections', () => {
    const pool = new ConnectionPool();
    pool.release({ ...conn, state: 'closed' });
    expect(pool.acquire(target)).toBeNull();
  });

  it('acquire returns null for closed pooled connection', () => {
    const pool = new ConnectionPool();
    pool.release(conn);
    conn.state = 'closed';
    expect(pool.acquire(target)).toBeNull();
    conn.state = 'open';
  });

  it('respects maxPerOrigin', () => {
    const pool = new ConnectionPool({ maxPerOrigin: 2 });
    pool.release(conn);
    pool.release({ ...conn, localPort: 1235 });
    pool.release({ ...conn, localPort: 1236 });
    expect(pool.size).toBe(2);
  });

  it('size reports pooled count', () => {
    const pool = new ConnectionPool();
    expect(pool.size).toBe(0);
    pool.release(conn);
    expect(pool.size).toBe(1);
  });

  it('clear empties the pool', () => {
    const pool = new ConnectionPool();
    pool.release(conn);
    pool.clear();
    expect(pool.size).toBe(0);
  });

  it('dispose empties the pool', () => {
    const pool = new ConnectionPool();
    pool.release(conn);
    pool.dispose();
    expect(pool.size).toBe(0);
  });
});
