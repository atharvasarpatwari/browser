/**
 * @file src/browser/netwroking/firewall.ts
 *
 * -----------------------------------------------------------------------
 * Rule-based traffic firewall for NovaBrowser's Networking layer.
 * Sits directly on top of ip-protocol.ts and hooks into
 * establishConnection() so every outbound connection attempt — not just
 * DNS lookups — passes through policy evaluation first.
 *
 * Responsibilities:
 *   - Evaluate outbound connection attempts against an ordered rule set
 *     (hostname pattern, CIDR, port, port range, protocol, direction)
 *   - Default-deny or default-allow posture, configurable per instance
 *   - Built-in baseline rules: block loopback/link-local/private targets
 *     unless explicitly allowed (reuses classifyIP / isPrivateOrLocal
 *     from ip-protocol.ts rather than re-implementing address logic)
 *   - Per-host connection-attempt rate limiting (basic DoS / runaway-tab
 *     protection)
 *   - Structured decision logging for a devtools "Network > Firewall"
 *     panel, with reasons attached to every allow/deny
 *   - A thin adapter (`firewallGuardedOpenSocket`) so the firewall can
 *     wrap the `openSocket` callback passed to establishConnection
 *     without that function needing to know the firewall exists
 *
 * Zero external dependencies beyond ip-protocol.ts. Compiles clean under
 * strict TypeScript (strict: true, noUncheckedIndexedAccess: true).
 * -----------------------------------------------------------------------
 */

import {
  type ParsedIP,
  type ConnectionTarget,
  type DNSRecord,
  type SocketConnection,
  type CIDRRange,
  classifyIP,
  isPrivateOrLocal,
  parseCIDR,
  isInCIDR,
  serializeIP,
  IPProtocolError,
} from "./ip-protocol";

// =========================================================================
// 1. Types
// =========================================================================

export type FirewallAction = "allow" | "deny";
export type FirewallDirection = "outbound"; // NovaBrowser is a client; inbound is out of scope here

export interface FirewallMatchCriteria {
  /** Exact hostname, or a "*.example.com" style wildcard suffix pattern. */
  hostnamePattern?: string;
  /** CIDR string, e.g. "10.0.0.0/8" or "fc00::/7". Matches the resolved address, not the hostname. */
  cidr?: string;
  /** Exact destination port. */
  port?: number;
  /** Inclusive port range [min, max]. */
  portRange?: [number, number];
  /** One or more schemes this rule applies to. Omit to match any. */
  protocols?: Array<ConnectionTarget["protocol"]>;
}

export interface FirewallRule {
  id: string;
  action: FirewallAction;
  /** Higher priority evaluated first. Ties broken by insertion order. */
  priority: number;
  match: FirewallMatchCriteria;
  description?: string;
  /** If false, rule is skipped during evaluation without being removed. */
  enabled?: boolean;
}

export interface FirewallDecision {
  action: FirewallAction;
  ruleId: string | null; // null when a default policy applied, not a specific rule
  reason: string;
  target: ConnectionTarget;
  address?: ParsedIP;
  timestamp: number;
}

export interface RateLimitConfig {
  /** Max connection attempts to a single hostname within the window. */
  maxAttempts: number;
  windowMs: number;
}

export interface FirewallOptions {
  /** Action taken when no rule matches. Defaults to "deny" (secure-by-default). */
  defaultAction?: FirewallAction;
  /**
   * Automatically deny connections to private/local/loopback address
   * classes unless an explicit "allow" rule matches first. Mirrors the
   * intent of enforcePrivateNetworkAccess in ip-protocol.ts but applies
   * even when no SecurityContext is supplied. Defaults to true.
   */
  blockPrivateNetworksByDefault?: boolean;
  rateLimit?: RateLimitConfig;
  /** Called for every decision (allow or deny) — wire this to a devtools panel. */
  onDecision?: (decision: FirewallDecision) => void;
}

export class FirewallBlockedError extends IPProtocolError {
  constructor(public readonly decision: FirewallDecision) {
    super(
      `Firewall blocked connection to ${decision.target.hostname}:${decision.target.port} ` +
        `(${decision.reason})`
    );
    this.name = "FirewallBlockedError";
  }
}

export class RateLimitExceededError extends IPProtocolError {
  constructor(public readonly hostname: string, public readonly limit: RateLimitConfig) {
    super(
      `Rate limit exceeded for "${hostname}": more than ${limit.maxAttempts} attempts ` +
        `within ${limit.windowMs}ms`
    );
    this.name = "RateLimitExceededError";
  }
}

// =========================================================================
// 2. Hostname pattern matching
// =========================================================================

/**
 * Matches a hostname against a pattern. Supports exact match and a single
 * leading wildcard label ("*.example.com" matches "a.example.com" and
 * "a.b.example.com", but not "example.com" itself).
 */
export function matchesHostnamePattern(hostname: string, pattern: string): boolean {
  const h = hostname.toLowerCase();
  const p = pattern.toLowerCase();

  if (!p.startsWith("*.")) return h === p;

  const suffix = p.slice(1); // ".example.com"
  return h.endsWith(suffix) && h.length > suffix.length;
}

// =========================================================================
// 3. Rate limiter
// =========================================================================

class SlidingWindowRateLimiter {
  private attempts = new Map<string, number[]>();

  constructor(private readonly config: RateLimitConfig) {}

  /** Records an attempt and returns true if it is within the allowed rate. */
  tryRecord(key: string): boolean {
    const now = Date.now();
    const windowStart = now - this.config.windowMs;
    const existing = (this.attempts.get(key) ?? []).filter((t) => t > windowStart);

    if (existing.length >= this.config.maxAttempts) {
      this.attempts.set(key, existing);
      return false;
    }

    existing.push(now);
    this.attempts.set(key, existing);
    return true;
  }

  reset(key: string): void {
    this.attempts.delete(key);
  }

  clear(): void {
    this.attempts.clear();
  }
}

// =========================================================================
// 4. Firewall engine
// =========================================================================

export class Firewall {
  private rules: FirewallRule[] = [];
  private readonly defaultAction: FirewallAction;
  private readonly blockPrivateNetworksByDefault: boolean;
  private readonly rateLimiter: SlidingWindowRateLimiter | null;
  private readonly onDecision: ((decision: FirewallDecision) => void) | undefined;
  private decisionLog: FirewallDecision[] = [];
  private readonly maxLogSize = 500;

  constructor(options: FirewallOptions = {}) {
    this.defaultAction = options.defaultAction ?? "deny";
    this.blockPrivateNetworksByDefault = options.blockPrivateNetworksByDefault ?? true;
    this.rateLimiter = options.rateLimit ? new SlidingWindowRateLimiter(options.rateLimit) : null;
    this.onDecision = options.onDecision;
  }

  // -----------------------------------------------------------------
  // Rule management
  // -----------------------------------------------------------------

  addRule(rule: FirewallRule): void {
    if (this.rules.some((r) => r.id === rule.id)) {
      throw new IPProtocolError(`Firewall rule with id "${rule.id}" already exists`);
    }
    this.rules.push({ enabled: true, ...rule });
    this.rules.sort((a, b) => b.priority - a.priority);
  }

  removeRule(id: string): boolean {
    const before = this.rules.length;
    this.rules = this.rules.filter((r) => r.id !== id);
    return this.rules.length !== before;
  }

  setRuleEnabled(id: string, enabled: boolean): void {
    const rule = this.rules.find((r) => r.id === id);
    if (rule) rule.enabled = enabled;
  }

  getRules(): readonly FirewallRule[] {
    return [...this.rules];
  }

  /** Convenience: block an entire CIDR range at high priority. */
  blockCIDR(cidr: string, description?: string): void {
    this.addRule({
      id: `block-cidr-${cidr}`,
      action: "deny",
      priority: 900,
      match: { cidr },
      description: description ?? `Block range ${cidr}`,
    });
  }

  /** Convenience: allow a specific hostname (exact or wildcard) at high priority. */
  allowHostname(pattern: string, description?: string): void {
    this.addRule({
      id: `allow-host-${pattern}`,
      action: "allow",
      priority: 950,
      match: { hostnamePattern: pattern },
      description: description ?? `Allow ${pattern}`,
    });
  }

  /** Convenience: block a specific hostname (exact or wildcard) at high priority. */
  blockHostname(pattern: string, description?: string): void {
    this.addRule({
      id: `block-host-${pattern}`,
      action: "deny",
      priority: 900,
      match: { hostnamePattern: pattern },
      description: description ?? `Block ${pattern}`,
    });
  }

  // -----------------------------------------------------------------
  // Evaluation
  // -----------------------------------------------------------------

  /**
   * Evaluates a connection attempt. `address` is optional and used for
   * CIDR / private-network rules once DNS has resolved — call once
   * pre-DNS (hostname/port/protocol rules only) and again post-DNS
   * (full rule set) for defense in depth, mirroring how establishConnection
   * re-checks PNA per resolved address.
   */
  evaluate(target: ConnectionTarget, address?: ParsedIP): FirewallDecision {
    if (this.rateLimiter && !this.rateLimiter.tryRecord(target.hostname)) {
      const decision: FirewallDecision = {
        action: "deny",
        ruleId: null,
        reason: `Rate limit exceeded for "${target.hostname}"`,
        target,
        ...(address ? { address } : {}),
        timestamp: Date.now(),
      };
      this.record(decision);
      return decision;
    }

    for (const rule of this.rules) {
      if (rule.enabled === false) continue;
      if (this.ruleMatches(rule, target, address)) {
        const decision: FirewallDecision = {
          action: rule.action,
          ruleId: rule.id,
          reason: rule.description ?? `Matched rule "${rule.id}"`,
          target,
          ...(address ? { address } : {}),
          timestamp: Date.now(),
        };
        this.record(decision);
        return decision;
      }
    }

    if (address && this.blockPrivateNetworksByDefault && isPrivateOrLocal(address)) {
      const decision: FirewallDecision = {
        action: "deny",
        ruleId: null,
        reason: `Target address ${serializeIP(address)} is ${classifyIP(address)} ` +
          `and no explicit allow rule matched`,
        target,
        address,
        timestamp: Date.now(),
      };
      this.record(decision);
      return decision;
    }

    const decision: FirewallDecision = {
      action: this.defaultAction,
      ruleId: null,
      reason: `No rule matched — applying default policy "${this.defaultAction}"`,
      target,
      ...(address ? { address } : {}),
      timestamp: Date.now(),
    };
    this.record(decision);
    return decision;
  }

  /** Throws FirewallBlockedError / RateLimitExceededError if the connection should not proceed. */
  enforce(target: ConnectionTarget, address?: ParsedIP): void {
    const decision = this.evaluate(target, address);
    if (decision.action === "deny") {
      if (decision.reason.startsWith("Rate limit exceeded") && this.rateLimiterConfig()) {
        throw new RateLimitExceededError(target.hostname, this.rateLimiterConfig()!);
      }
      throw new FirewallBlockedError(decision);
    }
  }

  private rateLimiterConfig(): RateLimitConfig | null {
    return (this.rateLimiter as unknown as { config?: RateLimitConfig })?.config ?? null;
  }

  private ruleMatches(rule: FirewallRule, target: ConnectionTarget, address?: ParsedIP): boolean {
    const m = rule.match;

    if (m.protocols && !m.protocols.includes(target.protocol)) return false;

    if (m.port !== undefined && m.port !== target.port) return false;

    if (m.portRange !== undefined) {
      const [min, max] = m.portRange;
      if (target.port < min || target.port > max) return false;
    }

    if (m.hostnamePattern !== undefined && !matchesHostnamePattern(target.hostname, m.hostnamePattern)) {
      return false;
    }

    if (m.cidr !== undefined) {
      if (!address) return false; // CIDR rules only apply once an address is known
      const range: CIDRRange | null = parseCIDR(m.cidr);
      if (!range || !isInCIDR(address, range)) return false;
    }

    return true;
  }

  private record(decision: FirewallDecision): void {
    this.decisionLog.push(decision);
    if (this.decisionLog.length > this.maxLogSize) {
      this.decisionLog.shift();
    }
    this.onDecision?.(decision);
  }

  getRecentDecisions(limit = 100): FirewallDecision[] {
    return this.decisionLog.slice(-limit);
  }

  clearLog(): void {
    this.decisionLog = [];
  }
}

// =========================================================================
// 5. Default baseline rule set
// =========================================================================

export function applyBaselineRules(firewall: Firewall): void {
  firewall.addRule({
    id: "block-mdns",
    action: "deny",
    priority: 1000,
    match: { port: 5353 },
    description: "Block mDNS (multicast DNS) — not a browser use case",
  });
  firewall.addRule({
    id: "block-netbios",
    action: "deny",
    priority: 1000,
    match: { portRange: [137, 139] },
    description: "Block NetBIOS ports",
  });
  firewall.addRule({
    id: "block-ssdp",
    action: "deny",
    priority: 1000,
    match: { port: 1900 },
    description: "Block SSDP/UPnP discovery port",
  });
  firewall.addRule({
    id: "allow-standard-web-ports",
    action: "allow",
    priority: 100,
    match: { portRange: [80, 80] },
    description: "Allow plain HTTP",
  });
  firewall.addRule({
    id: "allow-https-port",
    action: "allow",
    priority: 100,
    match: { port: 443 },
    description: "Allow HTTPS",
  });
}

// =========================================================================
// 6. Integration adapter for establishConnection()
// =========================================================================

export function firewallGuardedOpenSocket(
  firewall: Firewall,
  openSocket: (address: ParsedIP, port: number) => Promise<SocketConnection>
): (address: ParsedIP, port: number, target?: ConnectionTarget) => Promise<SocketConnection> {
  return async (address: ParsedIP, port: number, target?: ConnectionTarget) => {
    const effectiveTarget: ConnectionTarget = target ?? {
      hostname: serializeIP(address),
      port,
      protocol: "https",
    };
    firewall.enforce(effectiveTarget, address);
    return openSocket(address, port);
  };
}

export function filterRecordsByFirewall(
  firewall: Firewall,
  target: ConnectionTarget,
  records: DNSRecord[]
): DNSRecord[] {
  return records.filter((r) => firewall.evaluate(target, r.address).action === "allow");
}

// =========================================================================
// 7. Convenience export
// =========================================================================

export const FirewallModule = {
  Firewall,
  applyBaselineRules,
  matchesHostnamePattern,
  firewallGuardedOpenSocket,
  filterRecordsByFirewall,
};

export default FirewallModule;
