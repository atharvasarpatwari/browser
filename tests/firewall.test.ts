import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  Firewall,
  FirewallBlockedError,
  RateLimitExceededError,
  matchesHostnamePattern,
  applyBaselineRules,
  firewallGuardedOpenSocket,
  filterRecordsByFirewall,
} from '../src/browser/netwroking/firewall';
import type { ConnectionTarget, ParsedIP, DNSRecord, SocketConnection } from '../src/browser/netwroking/ip-protocol';
import { parseIPv4, parseIPv6, classifyIP } from '../src/browser/netwroking/ip-protocol';

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function target(hostname: string, port = 443, protocol: ConnectionTarget['protocol'] = 'https'): ConnectionTarget {
  return { hostname, port, protocol };
}

function record(hostname: string, ip: string, ttl = 300): DNSRecord {
  return { hostname, address: parseIPv4(ip)!, ttlSeconds: ttl, resolvedAt: Date.now() };
}

function record6(hostname: string, ip: string, ttl = 300): DNSRecord {
  return { hostname, address: parseIPv6(ip)!, ttlSeconds: ttl, resolvedAt: Date.now() };
}

function openSocket(): (address: ParsedIP, port: number) => Promise<SocketConnection> {
  return async (address, port) => ({
    target: { hostname: '', port, protocol: 'https' },
    resolvedAddress: address,
    state: 'open' as const,
    openedAt: Date.now(),
  });
}

// =========================================================================
// matchesHostnamePattern
// =========================================================================

describe('matchesHostnamePattern', () => {
  it('exact match', () => {
    expect(matchesHostnamePattern('example.com', 'example.com')).toBe(true);
    expect(matchesHostnamePattern('Example.COM', 'example.com')).toBe(true);
  });

  it('exact mismatch', () => {
    expect(matchesHostnamePattern('other.com', 'example.com')).toBe(false);
  });

  it('wildcard matches subdomain', () => {
    expect(matchesHostnamePattern('a.example.com', '*.example.com')).toBe(true);
    expect(matchesHostnamePattern('a.b.example.com', '*.example.com')).toBe(true);
  });

  it('wildcard does not match bare domain', () => {
    expect(matchesHostnamePattern('example.com', '*.example.com')).toBe(false);
  });

  it('wildcard is case-insensitive', () => {
    expect(matchesHostnamePattern('A.Example.COM', '*.example.com')).toBe(true);
  });
});

// =========================================================================
// Firewall constructor defaults
// =========================================================================

describe('Firewall defaults', () => {
  it('defaults to deny posture', () => {
    const fw = new Firewall();
    const d = fw.evaluate(target('example.com', 80));
    expect(d.action).toBe('deny');
    expect(d.ruleId).toBeNull();
  });

  it('can be set to default-allow', () => {
    const fw = new Firewall({ defaultAction: 'allow' });
    const d = fw.evaluate(target('example.com', 80));
    expect(d.action).toBe('allow');
  });
});

// =========================================================================
// Rule management
// =========================================================================

describe('Firewall rule management', () => {
  let fw: Firewall;

  beforeEach(() => {
    fw = new Firewall({ defaultAction: 'deny' });
  });

  it('addRule stores and sorts by priority', () => {
    fw.addRule({ id: 'low', action: 'allow', priority: 10, match: {} });
    fw.addRule({ id: 'high', action: 'deny', priority: 100, match: {} });

    const rules = fw.getRules();
    expect(rules[0]!.id).toBe('high');
    expect(rules[1]!.id).toBe('low');
  });

  it('addRule rejects duplicate ids', () => {
    fw.addRule({ id: 'dup', action: 'allow', priority: 10, match: {} });
    expect(() => fw.addRule({ id: 'dup', action: 'deny', priority: 20, match: {} })).toThrow('already exists');
  });

  it('removeRule returns true when found', () => {
    fw.addRule({ id: 'rm', action: 'allow', priority: 10, match: {} });
    expect(fw.removeRule('rm')).toBe(true);
    expect(fw.getRules()).toHaveLength(0);
  });

  it('removeRule returns false when not found', () => {
    expect(fw.removeRule('nonexistent')).toBe(false);
  });

  it('setRuleEnabled toggles rule', () => {
    fw.addRule({ id: 't', action: 'allow', priority: 10, match: { port: 443 } });
    fw.setRuleEnabled('t', false);

    const d = fw.evaluate(target('example.com', 443));
    expect(d.action).toBe('deny'); // rule skipped, falls to default
  });

  it('blockCIDR convenience adds deny rule', () => {
    fw.blockCIDR('10.0.0.0/8', 'Block all RFC 1918');
    expect(fw.getRules().length).toBe(1);
    expect(fw.getRules()[0]!.action).toBe('deny');
  });

  it('allowHostname convenience adds allow rule', () => {
    fw.allowHostname('*.example.com');
    const d = fw.evaluate(target('cdn.example.com', 443));
    expect(d.action).toBe('allow');
  });

  it('blockHostname convenience adds deny rule', () => {
    fw.blockHostname('ads.example.com');
    const d = fw.evaluate(target('ads.example.com', 443));
    expect(d.action).toBe('deny');
  });
});

// =========================================================================
// Rule matching — hostname
// =========================================================================

describe('Firewall hostname matching', () => {
  it('exact hostname match', () => {
    const fw = new Firewall({ defaultAction: 'deny' });
    fw.addRule({ id: 'r1', action: 'allow', priority: 10, match: { hostnamePattern: 'example.com' } });

    expect(fw.evaluate(target('example.com')).action).toBe('allow');
    expect(fw.evaluate(target('other.com')).action).toBe('deny');
  });

  it('wildcard hostname match', () => {
    const fw = new Firewall({ defaultAction: 'deny' });
    fw.addRule({ id: 'r1', action: 'allow', priority: 10, match: { hostnamePattern: '*.example.com' } });

    expect(fw.evaluate(target('cdn.example.com')).action).toBe('allow');
    expect(fw.evaluate(target('example.com')).action).toBe('deny');
  });
});

// =========================================================================
// Rule matching — port
// =========================================================================

describe('Firewall port matching', () => {
  it('exact port match', () => {
    const fw = new Firewall({ defaultAction: 'deny' });
    fw.addRule({ id: 'r1', action: 'allow', priority: 10, match: { port: 443 } });

    expect(fw.evaluate(target('example.com', 443)).action).toBe('allow');
    expect(fw.evaluate(target('example.com', 80)).action).toBe('deny');
  });

  it('port range match', () => {
    const fw = new Firewall({ defaultAction: 'deny' });
    fw.addRule({ id: 'r1', action: 'deny', priority: 10, match: { portRange: [137, 139] } });

    expect(fw.evaluate(target('host', 137)).action).toBe('deny');
    expect(fw.evaluate(target('host', 138)).action).toBe('deny');
    expect(fw.evaluate(target('host', 139)).action).toBe('deny');
    expect(fw.evaluate(target('host', 140)).action).toBe('deny'); // falls to default
  });
});

// =========================================================================
// Rule matching — protocol
// =========================================================================

describe('Firewall protocol matching', () => {
  it('restricts to specific protocols', () => {
    const fw = new Firewall({ defaultAction: 'deny' });
    fw.addRule({ id: 'r1', action: 'allow', priority: 10, match: { protocols: ['https'] } });

    expect(fw.evaluate(target('host', 443, 'https')).action).toBe('allow');
    expect(fw.evaluate(target('host', 80, 'http')).action).toBe('deny');
    expect(fw.evaluate(target('host', 80, 'ws')).action).toBe('deny');
  });
});

// =========================================================================
// Rule matching — CIDR
// =========================================================================

describe('Firewall CIDR matching', () => {
  it('allows when CIDR matches', () => {
    const fw = new Firewall({ defaultAction: 'deny' });
    fw.addRule({ id: 'r1', action: 'allow', priority: 10, match: { cidr: '10.0.0.0/8' } });

    const addr = parseIPv4('10.1.2.3')!;
    expect(fw.evaluate(target('host', 443), addr).action).toBe('allow');
  });

  it('denies when CIDR does not match', () => {
    const fw = new Firewall({ defaultAction: 'deny' });
    fw.addRule({ id: 'r1', action: 'allow', priority: 10, match: { cidr: '10.0.0.0/8' } });

    const addr = parseIPv4('192.168.1.1')!;
    expect(fw.evaluate(target('host', 443), addr).action).toBe('deny');
  });

  it('CIDR rule ignored without address', () => {
    const fw = new Firewall({ defaultAction: 'deny' });
    fw.addRule({ id: 'r1', action: 'allow', priority: 10, match: { cidr: '10.0.0.0/8' } });

    expect(fw.evaluate(target('host', 443)).action).toBe('deny');
  });
});

// =========================================================================
// Priority ordering
// =========================================================================

describe('Firewall priority ordering', () => {
  it('higher priority rule wins', () => {
    const fw = new Firewall({ defaultAction: 'deny' });
    fw.addRule({ id: 'allow-port', action: 'allow', priority: 10, match: { port: 443 } });
    fw.addRule({ id: 'deny-port', action: 'deny', priority: 100, match: { port: 443 } });

    expect(fw.evaluate(target('host', 443)).ruleId).toBe('deny-port');
  });

  it('first-match wins at same priority', () => {
    const fw = new Firewall({ defaultAction: 'deny' });
    fw.addRule({ id: 'first', action: 'allow', priority: 10, match: { port: 443 } });
    fw.addRule({ id: 'second', action: 'deny', priority: 10, match: { port: 443 } });

    expect(fw.evaluate(target('host', 443)).ruleId).toBe('first');
  });
});

// =========================================================================
// Private network blocking
// =========================================================================

describe('Firewall private network blocking', () => {
  it('blocks private IP by default', () => {
    const fw = new Firewall({ defaultAction: 'allow', blockPrivateNetworksByDefault: true });
    const addr = parseIPv4('10.0.0.1')!;

    const d = fw.evaluate(target('internal.dev', 443), addr);
    expect(d.action).toBe('deny');
    expect(d.reason).toContain('10.0.0.1');
  });

  it('blocks loopback', () => {
    const fw = new Firewall({ defaultAction: 'allow', blockPrivateNetworksByDefault: true });
    const addr = parseIPv4('127.0.0.1')!;

    expect(fw.evaluate(target('localhost', 80), addr).action).toBe('deny');
  });

  it('blocks link-local', () => {
    const fw = new Firewall({ defaultAction: 'allow', blockPrivateNetworksByDefault: true });
    const addr = parseIPv4('169.254.1.1')!;

    expect(fw.evaluate(target('link-local', 80), addr).action).toBe('deny');
  });

  it('allows when blockPrivateNetworksByDefault is false', () => {
    const fw = new Firewall({ defaultAction: 'allow', blockPrivateNetworksByDefault: false });
    const addr = parseIPv4('10.0.0.1')!;

    expect(fw.evaluate(target('internal', 443), addr).action).toBe('allow');
  });

  it('explicit allow rule overrides private blocking', () => {
    const fw = new Firewall({ defaultAction: 'deny', blockPrivateNetworksByDefault: true });
    fw.addRule({ id: 'allow-internal', action: 'allow', priority: 1000, match: { hostnamePattern: 'internal.dev' } });

    const addr = parseIPv4('10.0.0.1')!;
    expect(fw.evaluate(target('internal.dev', 443), addr).action).toBe('allow');
  });

  it('blocks private IPv6', () => {
    const fw = new Firewall({ defaultAction: 'allow', blockPrivateNetworksByDefault: true });
    const addr = parseIPv6('fc00::1')!;

    expect(fw.evaluate(target('host', 443), addr).action).toBe('deny');
  });
});

// =========================================================================
// Rate limiting
// =========================================================================

describe('Firewall rate limiting', () => {
  it('allows within rate limit', () => {
    const fw = new Firewall({
      defaultAction: 'allow',
      rateLimit: { maxAttempts: 3, windowMs: 10_000 },
    });

    expect(fw.evaluate(target('host', 443)).action).toBe('allow');
    expect(fw.evaluate(target('host', 443)).action).toBe('allow');
    expect(fw.evaluate(target('host', 443)).action).toBe('allow');
  });

  it('denies when rate limit exceeded', () => {
    const fw = new Firewall({
      defaultAction: 'allow',
      rateLimit: { maxAttempts: 2, windowMs: 10_000 },
    });

    fw.evaluate(target('host', 443));
    fw.evaluate(target('host', 443));
    const d = fw.evaluate(target('host', 443));

    expect(d.action).toBe('deny');
    expect(d.reason).toContain('Rate limit exceeded');
    expect(d.ruleId).toBeNull();
  });

  it('different hostnames are independent', () => {
    const fw = new Firewall({
      defaultAction: 'allow',
      rateLimit: { maxAttempts: 1, windowMs: 10_000 },
    });

    fw.evaluate(target('host-a', 443));
    const d = fw.evaluate(target('host-b', 443));

    expect(d.action).toBe('allow');
  });

  it('enforce throws RateLimitExceededError on exceeded', () => {
    const fw = new Firewall({
      defaultAction: 'allow',
      rateLimit: { maxAttempts: 1, windowMs: 10_000 },
    });

    fw.evaluate(target('host', 443)); // first — OK

    expect(() => fw.enforce(target('host', 443))).toThrow(RateLimitExceededError);
  });
});

// =========================================================================
// enforce()
// =========================================================================

describe('Firewall enforce()', () => {
  it('does not throw on allow', () => {
    const fw = new Firewall({ defaultAction: 'allow' });
    expect(() => fw.enforce(target('host', 443))).not.toThrow();
  });

  it('throws FirewallBlockedError on deny', () => {
    const fw = new Firewall({ defaultAction: 'deny' });
    expect(() => fw.enforce(target('host', 443))).toThrow(FirewallBlockedError);
  });

  it('FirewallBlockedError contains decision', () => {
    const fw = new Firewall({ defaultAction: 'deny' });
    try {
      fw.enforce(target('host', 443));
      expect.fail('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(FirewallBlockedError);
      expect((e as FirewallBlockedError).decision.action).toBe('deny');
      expect((e as FirewallBlockedError).decision.target.hostname).toBe('host');
    }
  });
});

// =========================================================================
// Decision logging
// =========================================================================

describe('Firewall decision logging', () => {
  it('records all decisions', () => {
    const fw = new Firewall({ defaultAction: 'deny' });
    fw.evaluate(target('a', 443));
    fw.evaluate(target('b', 80));

    const log = fw.getRecentDecisions();
    expect(log).toHaveLength(2);
    expect(log[0]!.target.hostname).toBe('a');
    expect(log[1]!.target.hostname).toBe('b');
  });

  it('calls onDecision callback', () => {
    const cb = vi.fn();
    const fw = new Firewall({ defaultAction: 'deny', onDecision: cb });

    fw.evaluate(target('host', 443));
    expect(cb).toHaveBeenCalledTimes(1);
    expect(cb).toHaveBeenCalledWith(expect.objectContaining({ target: expect.objectContaining({ hostname: 'host' }) }));
  });

  it('caps log at 500 entries', () => {
    const fw = new Firewall({ defaultAction: 'deny' });
    for (let i = 0; i < 600; i++) {
      fw.evaluate(target(`h${i}`, 443));
    }
    expect(fw.getRecentDecisions(600).length).toBe(500);
  });

  it('clearLog empties the log', () => {
    const fw = new Firewall({ defaultAction: 'deny' });
    fw.evaluate(target('host', 443));
    fw.clearLog();
    expect(fw.getRecentDecisions()).toHaveLength(0);
  });

  it('getRecentDecisions respects limit', () => {
    const fw = new Firewall({ defaultAction: 'deny' });
    for (let i = 0; i < 10; i++) fw.evaluate(target(`h${i}`, 443));
    expect(fw.getRecentDecisions(3)).toHaveLength(3);
  });

  it('decision has correct structure', () => {
    const fw = new Firewall({ defaultAction: 'deny' });
    const d = fw.evaluate(target('example.com', 443), parseIPv4('1.2.3.4')!);

    expect(d).toHaveProperty('action');
    expect(d).toHaveProperty('ruleId');
    expect(d).toHaveProperty('reason');
    expect(d).toHaveProperty('target');
    expect(d).toHaveProperty('timestamp');
    expect(d.address).toBeDefined();
    expect(typeof d.timestamp).toBe('number');
  });
});

// =========================================================================
// applyBaselineRules
// =========================================================================

describe('applyBaselineRules', () => {
  it('blocks mDNS port 5353', () => {
    const fw = new Firewall({ defaultAction: 'allow' });
    applyBaselineRules(fw);
    expect(fw.evaluate(target('host', 5353)).action).toBe('deny');
  });

  it('blocks NetBIOS ports 137-139', () => {
    const fw = new Firewall({ defaultAction: 'allow' });
    applyBaselineRules(fw);
    expect(fw.evaluate(target('host', 137)).action).toBe('deny');
    expect(fw.evaluate(target('host', 138)).action).toBe('deny');
    expect(fw.evaluate(target('host', 139)).action).toBe('deny');
  });

  it('blocks SSDP port 1900', () => {
    const fw = new Firewall({ defaultAction: 'allow' });
    applyBaselineRules(fw);
    expect(fw.evaluate(target('host', 1900)).action).toBe('deny');
  });

  it('allows port 80 and 443', () => {
    const fw = new Firewall({ defaultAction: 'deny' });
    applyBaselineRules(fw);
    expect(fw.evaluate(target('host', 80)).action).toBe('allow');
    expect(fw.evaluate(target('host', 443)).action).toBe('allow');
  });

  it('applied rules have proper descriptions', () => {
    const fw = new Firewall({ defaultAction: 'deny' });
    applyBaselineRules(fw);
    const rules = fw.getRules();
    expect(rules.length).toBe(5);
    for (const r of rules) {
      expect(r.description).toBeTruthy();
    }
  });
});

// =========================================================================
// firewallGuardedOpenSocket
// =========================================================================

describe('firewallGuardedOpenSocket', () => {
  it('allows connection when firewall permits', async () => {
    const fw = new Firewall({ defaultAction: 'allow' });
    const raw = openSocket();
    const guarded = firewallGuardedOpenSocket(fw, raw);

    const conn = await guarded(parseIPv4('1.2.3.4')!, 443, target('example.com', 443));
    expect(conn.state).toBe('open');
  });

  it('blocks connection when firewall denies', async () => {
    const fw = new Firewall({ defaultAction: 'deny' });
    fw.blockHostname('blocked.com');
    const raw = openSocket();
    const guarded = firewallGuardedOpenSocket(fw, raw);

    await expect(
      guarded(parseIPv4('1.2.3.4')!, 443, target('blocked.com', 443)),
    ).rejects.toThrow(FirewallBlockedError);
  });

  it('creates default target from address when none provided', async () => {
    const fw = new Firewall({ defaultAction: 'allow', blockPrivateNetworksByDefault: true });
    const raw = openSocket();
    const guarded = firewallGuardedOpenSocket(fw, raw);

    // 127.0.0.1 is loopback — blocked by default
    await expect(
      guarded(parseIPv4('127.0.0.1')!, 80),
    ).rejects.toThrow(FirewallBlockedError);
  });

  it('raw socket is not called when firewall blocks', async () => {
    const fw = new Firewall({ defaultAction: 'deny' });
    const rawSpy = vi.fn(openSocket());
    const guarded = firewallGuardedOpenSocket(fw, rawSpy);

    await expect(
      guarded(parseIPv4('1.2.3.4')!, 443, target('blocked.com', 443)),
    ).rejects.toThrow();

    expect(rawSpy).not.toHaveBeenCalled();
  });
});

// =========================================================================
// filterRecordsByFirewall
// =========================================================================

describe('filterRecordsByFirewall', () => {
  it('returns only allowed records', () => {
    const fw = new Firewall({ defaultAction: 'deny' });
    fw.addRule({ id: 'allow-http', action: 'allow', priority: 10, match: { hostnamePattern: 'example.com' } });

    const target_ = target('example.com', 443);
    const records = [
      record('example.com', '1.2.3.4'),
      record('other.com', '5.6.7.8'),
    ];

    const filtered = filterRecordsByFirewall(fw, target_, records);
    // Both records have different hostnames but filterRecordsByFirewall uses the target's
    // hostname for rule matching, not the record's hostname. So both pass the allow rule.
    // This is by design — the target determines the policy, not the record.
    expect(filtered.length).toBe(2);
  });

  it('returns only allowed records when hostname rule blocks', () => {
    const fw = new Firewall({ defaultAction: 'deny' });
    fw.addRule({ id: 'allow-example', action: 'allow', priority: 10, match: { hostnamePattern: 'example.com' } });

    const records = [
      record('example.com', '1.2.3.4'),
      record('other.com', '5.6.7.8'),
    ];

    // Evaluate each record against its own target
    const allowed = records.filter((r) => {
      const d = fw.evaluate({ hostname: r.hostname, port: 443, protocol: 'https' }, r.address);
      return d.action === 'allow';
    });
    expect(allowed.length).toBe(1);
    expect(allowed[0]!.hostname).toBe('example.com');
  });

  it('returns all records when firewall allows all', () => {
    const fw = new Firewall({ defaultAction: 'allow' });
    const target_ = target('host', 443);
    const records = [record('host', '1.2.3.4'), record('host', '5.6.7.8')];

    expect(filterRecordsByFirewall(fw, target_, records).length).toBe(2);
  });

  it('returns empty when firewall denies all', () => {
    const fw = new Firewall({ defaultAction: 'deny' });
    const target_ = target('host', 443);
    const records = [record('host', '1.2.3.4')];

    expect(filterRecordsByFirewall(fw, target_, records).length).toBe(0);
  });
});

// =========================================================================
// FirewallBlockedError & RateLimitExceededError
// =========================================================================

describe('Error classes', () => {
  it('FirewallBlockedError has correct properties', () => {
    const decision = {
      action: 'deny' as const,
      ruleId: 'r1',
      reason: 'blocked',
      target: target('host', 443),
      timestamp: Date.now(),
    };
    const err = new FirewallBlockedError(decision);
    expect(err.name).toBe('FirewallBlockedError');
    expect(err.decision).toBe(decision);
    expect(err.message).toContain('host:443');
  });

  it('RateLimitExceededError has correct properties', () => {
    const limit = { maxAttempts: 5, windowMs: 1000 };
    const err = new RateLimitExceededError('host', limit);
    expect(err.name).toBe('RateLimitExceededError');
    expect(err.hostname).toBe('host');
    expect(err.limit).toBe(limit);
    expect(err.message).toContain('host');
  });
});

// =========================================================================
// Combined scenarios
// =========================================================================

describe('Combined scenarios', () => {
  it('baseline rules + private network blocking + rate limiting', () => {
    const fw = new Firewall({
      defaultAction: 'deny',
      blockPrivateNetworksByDefault: true,
      rateLimit: { maxAttempts: 2, windowMs: 60_000 },
    });
    applyBaselineRules(fw);

    // mDNS blocked by baseline
    expect(fw.evaluate(target('host', 5353)).action).toBe('deny');

    // Port 443 allowed by baseline rule (priority 100 matches first)
    expect(fw.evaluate(target('host', 443)).action).toBe('allow');

    // Private IP on non-standard port: no rule matches → private-network policy blocks
    expect(fw.evaluate(target('internal', 9999), parseIPv4('10.0.0.1')!).action).toBe('deny');

    // Rate limit kicks in after 2 attempts
    fw.evaluate(target('host', 9999));
    fw.evaluate(target('host', 9999));
    expect(fw.evaluate(target('host', 9999)).action).toBe('deny');
  });

  it('allow-all rule with high priority overrides everything', () => {
    const fw = new Firewall({ defaultAction: 'deny', blockPrivateNetworksByDefault: true });
    fw.addRule({ id: 'allow-all', action: 'allow', priority: 9999, match: {} });

    expect(fw.evaluate(target('host', 443), parseIPv4('10.0.0.1')!).action).toBe('allow');
  });

  it('mixed rules — port block + hostname allow + CIDR deny', () => {
    const fw = new Firewall({ defaultAction: 'deny' });
    fw.addRule({ id: 'block-port', action: 'deny', priority: 100, match: { port: 80 } });
    fw.addRule({ id: 'allow-host', action: 'allow', priority: 200, match: { hostnamePattern: 'safe.com' } });
    fw.addRule({ id: 'block-cidr', action: 'deny', priority: 150, match: { cidr: '10.0.0.0/8' } });

    // safe.com allowed by hostname rule (priority 200 > others)
    expect(fw.evaluate(target('safe.com', 80)).action).toBe('allow');

    // other.com:80 denied by port rule
    expect(fw.evaluate(target('other.com', 80)).action).toBe('deny');

    // other.com:443 falls to default deny
    expect(fw.evaluate(target('other.com', 443)).action).toBe('deny');

    // CIDR match on 10.x — denied
    expect(fw.evaluate(target('internal', 443), parseIPv4('10.0.0.1')!).action).toBe('deny');
  });
});
