/**
 * @file src/browser/netwroking/redirect-handler.ts
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * RESPONSIBILITY
 * ─────────────────────────────────────────────────────────────────────────────
 * Centralized redirect management for the networking layer: validate
 * redirect targets, enforce security policies, manage redirect chains,
 * track redirect statistics, and implement redirect-specific caching.
 *
 * While RequestManager already follows redirects, this module provides
 * the policy layer: which redirect status codes are allowed, maximum
 * chain depth, protocol restrictions, cross-origin redirect rules,
 * and HSTS upgrade enforcement.
 *
 * Pipeline position
 * ─────────────────
 *   RequestManager.send()
 *        │
 *        ├──▶ 3xx response
 *        ▼
 *   RedirectHandler.validateAndFollow(from, to, chain)
 *        │
 *        ├──▶ allowed?     → update chain, continue
 *        ├──▶ blocked?     → throw RedirectError
 *        └──▶ HSTS?        → upgrade to HTTPS, continue
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * OOP PRINCIPLES
 * ─────────────────────────────────────────────────────────────────────────────
 *  Abstraction      IRedirectHandler hides validation behind validate().
 *  Encapsulation    Chain state and statistics are private.
 *  Single-Resp.     This file handles redirect policy — nothing else.
 *  Open / Closed    New redirect policies implement IRedirectHandler.
 *  Dependency-Inv.  Callers depend on the interface, not the concrete.
 */

import type { IDisposable } from '../../app/dependency-container';
import { BLOCKED_PROTOCOLS } from '../navigation/url-parser';

// ─────────────────────────────────────────────────────────────────────────────
// ENUMS
// ─────────────────────────────────────────────────────────────────────────────

/** HTTP redirect status codes. */
enum RedirectStatusCode {
  MovedPermanently  = 301,
  Found             = 302,
  SeeOther          = 303,
  TemporaryRedirect = 307,
  PermanentRedirect = 308,
}

/** The result of validating a redirect. */
enum RedirectValidationResult {
  Allowed         = 'allowed',
  Blocked         = 'blocked',
  TooManyHops     = 'too-many-hops',
  ProtocolBlocked = 'protocol-blocked',
  CrossOrigin     = 'cross-origin',
  HstsUpgrade     = 'hsts-upgrade',
  InfiniteLoop    = 'infinite-loop',
}

// ─────────────────────────────────────────────────────────────────────────────
// VALUE OBJECTS
// ─────────────────────────────────────────────────────────────────────────────

/** A single hop in a redirect chain. */
interface RedirectHop {
  /** URL this hop originated from. */
  readonly fromUrl: string;
  /** URL this hop points to. */
  readonly toUrl: string;
  /** HTTP status code that triggered the redirect. */
  readonly statusCode: RedirectStatusCode;
  /** Timestamp of when this hop was followed. */
  readonly timestamp: number;
  /** Whether the redirect changed the protocol (e.g., http→https). */
  readonly protocolChange: boolean;
  /** Whether the redirect changed the hostname. */
  readonly hostnameChange: boolean;
}

/** A complete redirect chain from start to finish. */
interface RedirectChain {
  /** The original URL. */
  readonly startUrl: string;
  /** The final URL after all redirects. */
  readonly finalUrl: string;
  /** All hops in order. */
  readonly hops: readonly RedirectHop[];
  /** Total number of redirects followed. */
  readonly hopCount: number;
  /** Whether any hop changed the protocol. */
  readonly hadProtocolChange: boolean;
  /** Whether any hop changed the hostname. */
  readonly hadHostnameChange: boolean;
  /** Total time spent following redirects in ms. */
  readonly totalTimeMs: number;
}

/** Policy configuration for redirect handling. */
interface RedirectPolicy {
  /** Maximum number of redirect hops allowed. */
  readonly maxHops: number;
  /** Whether to allow cross-origin redirects. */
  readonly allowCrossOrigin: boolean;
  /** Whether to automatically upgrade HTTP→HTTPS on redirect. */
  readonly autoUpgradeHttps: boolean;
  /** Whether to follow redirects for non-safe methods (POST→GET). */
  readonly allowMethodChange: boolean;
  /** Status codes that are considered valid redirects. */
  readonly allowedStatusCodes: ReadonlySet<number>;
  /** Whether to strip credentials on cross-origin redirects. */
  readonly stripCredentialsOnCrossOrigin: boolean;
}

/** Statistics about redirect handling. */
interface RedirectStats {
  readonly totalRedirects: number;
  readonly totalChains: number;
  readonly blockedRedirects: number;
  readonly hstsUpgrades: number;
  readonly crossOriginRedirects: number;
  readonly averageChainLength: number;
  readonly maxChainLength: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// PUBLIC CONTRACT
// ─────────────────────────────────────────────────────────────────────────────

interface IRedirectHandler extends IDisposable {
  /** Validate a redirect from one URL to another within a chain. */
  validate(
    fromUrl: string,
    toUrl: string,
    statusCode: RedirectStatusCode,
    chain: readonly RedirectHop[],
  ): RedirectValidationResult;
  /** Build a complete RedirectChain from a list of hops. */
  buildChain(startUrl: string, hops: readonly RedirectHop[]): RedirectChain;
  /** Get the final URL for a chain (follows the last hop). */
  resolveFinalUrl(startUrl: string, hops: readonly RedirectHop[]): string;
  /** Check if a redirect loop exists in the chain. */
  hasLoop(hops: readonly RedirectHop[]): boolean;
  /** Get the policy. */
  getPolicy(): RedirectPolicy;
  /** Update the policy. */
  updatePolicy(policy: Partial<RedirectPolicy>): void;
  /** Get stats. */
  getStats(): RedirectStats;
}

// ─────────────────────────────────────────────────────────────────────────────
// CONSTANTS
// ─────────────────────────────────────────────────────────────────────────────

const DEFAULT_REDIRECT_POLICY: RedirectPolicy = {
  maxHops:                        10,
  allowCrossOrigin:               true,
  autoUpgradeHttps:               true,
  allowMethodChange:              true,
  allowedStatusCodes: new Set([
    RedirectStatusCode.MovedPermanently,
    RedirectStatusCode.Found,
    RedirectStatusCode.SeeOther,
    RedirectStatusCode.TemporaryRedirect,
    RedirectStatusCode.PermanentRedirect,
  ]),
  stripCredentialsOnCrossOrigin:  true,
};

// ─────────────────────────────────────────────────────────────────────────────
// ERRORS
// ─────────────────────────────────────────────────────────────────────────────

class RedirectError extends Error {
  readonly fromUrl: string;
  readonly toUrl: string;
  constructor(fromUrl: string, toUrl: string, message: string) {
    super(message);
    this.name = 'RedirectError';
    this.fromUrl = fromUrl;
    this.toUrl = toUrl;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

class RedirectLoopError extends RedirectError {
  readonly chain: readonly RedirectHop[];
  constructor(chain: readonly RedirectHop[]) {
    const last = chain[chain.length - 1];
    super(
      last?.fromUrl ?? '',
      last?.toUrl ?? '',
      `Redirect loop detected: ${chain.length} hops.`,
    );
    this.name = 'RedirectLoopError';
    this.chain = chain;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

class RedirectBlockedError extends RedirectError {
  readonly reason: RedirectValidationResult;
  constructor(fromUrl: string, toUrl: string, reason: RedirectValidationResult) {
    super(fromUrl, toUrl, `Redirect from "${fromUrl}" to "${toUrl}" blocked: ${reason}.`);
    this.name = 'RedirectBlockedError';
    this.reason = reason;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// REDIRECT HANDLER
// ─────────────────────────────────────────────────────────────────────────────

class RedirectHandler implements IRedirectHandler {
  private policy: RedirectPolicy;
  private totalRedirects = 0;
  private totalChains = 0;
  private blockedRedirects = 0;
  private hstsUpgrades = 0;
  private crossOriginRedirects = 0;
  private maxChainLength = 0;

  constructor(policy?: Partial<RedirectPolicy>) {
    this.policy = { ...DEFAULT_REDIRECT_POLICY, ...policy };
  }

  // ── IRedirectHandler: validate ─────────────────────────────────────

  validate(
    fromUrl: string,
    toUrl: string,
    statusCode: RedirectStatusCode,
    chain: readonly RedirectHop[],
  ): RedirectValidationResult {
    this.totalRedirects++;

    // 1. Check status code is allowed.
    if (!this.policy.allowedStatusCodes.has(statusCode)) {
      this.blockedRedirects++;
      return RedirectValidationResult.Blocked;
    }

    // 2. Check chain depth.
    if (chain.length >= this.policy.maxHops) {
      this.blockedRedirects++;
      return RedirectValidationResult.TooManyHops;
    }

    // 3. Check for blocked protocols.
    try {
      const toProtocol = new URL(toUrl).protocol;
      if (BLOCKED_PROTOCOLS.has(toProtocol)) {
        this.blockedRedirects++;
        return RedirectValidationResult.ProtocolBlocked;
      }
    } catch {
      this.blockedRedirects++;
      return RedirectValidationResult.Blocked;
    }

    // 4. Check for infinite loop.
    if (this.wouldCreateLoop(fromUrl, toUrl, chain)) {
      this.blockedRedirects++;
      return RedirectValidationResult.InfiniteLoop;
    }

    // 5. Check cross-origin.
    const isCrossOrigin = RedirectHandler.isCrossOrigin(fromUrl, toUrl);
    if (isCrossOrigin) {
      this.crossOriginRedirects++;
      if (!this.policy.allowCrossOrigin) {
        this.blockedRedirects++;
        return RedirectValidationResult.CrossOrigin;
      }
    }

    // 6. HSTS upgrade check.
    if (this.policy.autoUpgradeHttps) {
      const fromParsed = RedirectHandler.safeParse(fromUrl);
      const toParsed = RedirectHandler.safeParse(toUrl);
      if (fromParsed?.protocol === 'https:' && toParsed?.protocol === 'http:') {
        // Downgrade from HTTPS — block.
        this.blockedRedirects++;
        return RedirectValidationResult.Blocked;
      }
      if (fromParsed?.protocol === 'http:' && toParsed?.protocol === 'https:') {
        this.hstsUpgrades++;
        return RedirectValidationResult.HstsUpgrade;
      }
    }

    this.totalChains = Math.max(this.totalChains, chain.length + 1);
    return RedirectValidationResult.Allowed;
  }

  // ── IRedirectHandler: buildChain ───────────────────────────────────

  buildChain(startUrl: string, hops: readonly RedirectHop[]): RedirectChain {
    const finalUrl = this.resolveFinalUrl(startUrl, hops);
    const hadProtocolChange = hops.some(h => h.protocolChange);
    const hadHostnameChange = hops.some(h => h.hostnameChange);

    if (hops.length > this.maxChainLength) {
      this.maxChainLength = hops.length;
    }

    return {
      startUrl,
      finalUrl,
      hops,
      hopCount: hops.length,
      hadProtocolChange,
      hadHostnameChange,
      totalTimeMs: hops.length > 0
        ? hops[hops.length - 1]!.timestamp - hops[0]!.timestamp
        : 0,
    };
  }

  // ── IRedirectHandler: resolveFinalUrl ──────────────────────────────

  resolveFinalUrl(startUrl: string, hops: readonly RedirectHop[]): string {
    if (hops.length === 0) return startUrl;
    return hops[hops.length - 1]!.toUrl;
  }

  // ── IRedirectHandler: hasLoop ──────────────────────────────────────

  hasLoop(hops: readonly RedirectHop[]): boolean {
    const visited = new Set<string>();
    for (const hop of hops) {
      if (visited.has(hop.toUrl)) return true;
      visited.add(hop.toUrl);
    }
    // Also check if the last hop's toUrl matches the first hop's fromUrl.
    if (hops.length > 0) {
      const firstFrom = hops[0]!.fromUrl;
      const lastTo = hops[hops.length - 1]!.toUrl;
      if (lastTo === firstFrom) return true;
    }
    return false;
  }

  // ── IRedirectHandler: policy / stats ───────────────────────────────

  getPolicy(): RedirectPolicy {
    return { ...this.policy };
  }

  updatePolicy(policy: Partial<RedirectPolicy>): void {
    this.policy = { ...this.policy, ...policy };
  }

  getStats(): RedirectStats {
    const avgChain = this.totalChains > 0
      ? this.totalRedirects / this.totalChains
      : 0;

    return {
      totalRedirects: this.totalRedirects,
      totalChains: this.totalChains,
      blockedRedirects: this.blockedRedirects,
      hstsUpgrades: this.hstsUpgrades,
      crossOriginRedirects: this.crossOriginRedirects,
      averageChainLength: Math.round(avgChain * 10) / 10,
      maxChainLength: this.maxChainLength,
    };
  }

  // ── IDisposable ─────────────────────────────────────────────────────

  dispose(): void {
    this.totalRedirects = 0;
    this.totalChains = 0;
    this.blockedRedirects = 0;
    this.hstsUpgrades = 0;
    this.crossOriginRedirects = 0;
    this.maxChainLength = 0;
  }

  // ── Private helpers ────────────────────────────────────────────────

  private wouldCreateLoop(
    fromUrl: string,
    toUrl: string,
    chain: readonly RedirectHop[],
  ): boolean {
    // Direct self-redirect.
    if (fromUrl === toUrl) return true;

    // Check if toUrl is already in the chain.
    for (const hop of chain) {
      if (hop.fromUrl === toUrl || hop.toUrl === toUrl) return true;
    }

    return false;
  }

  private static isCrossOrigin(fromUrl: string, toUrl: string): boolean {
    const a = RedirectHandler.safeParse(fromUrl);
    const b = RedirectHandler.safeParse(toUrl);
    if (!a || !b) return true;
    return a.origin !== b.origin;
  }

  private static safeParse(url: string): URL | null {
    try { return new URL(url); } catch { return null; }
  }

  /** Create a RedirectHop from two URLs and a status code. */
  static createHop(
    fromUrl: string,
    toUrl: string,
    statusCode: RedirectStatusCode,
  ): RedirectHop {
    const fromParsed = RedirectHandler.safeParse(fromUrl);
    const toParsed = RedirectHandler.safeParse(toUrl);

    return {
      fromUrl,
      toUrl,
      statusCode,
      timestamp: Date.now(),
      protocolChange: fromParsed?.protocol !== toParsed?.protocol,
      hostnameChange: fromParsed?.hostname !== toParsed?.hostname,
    };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// EXPORTS
// ─────────────────────────────────────────────────────────────────────────────

export {
  RedirectHandler,
  RedirectStatusCode,
  RedirectValidationResult,
  RedirectError,
  RedirectLoopError,
  RedirectBlockedError,
  DEFAULT_REDIRECT_POLICY,
};

export type {
  IRedirectHandler,
  RedirectHop,
  RedirectChain,
  RedirectPolicy,
  RedirectStats,
};
