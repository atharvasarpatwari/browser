/**
 * @file src/browser/security/csp-policy-store.ts
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * RESPONSIBILITY
 * ─────────────────────────────────────────────────────────────────────────────
 * Per-origin CSP policy storage and lookup. Handles:
 *   • Storing policies keyed by origin (scheme + host + port)
 *   • Retrieving the effective policy for a given origin
 *   • Handling multiple CSP headers per origin (stored as combined policy)
 *   • Report-only vs enforce mode per directive
 *   • Policy inheritance from parent frames
 *   • Maximum policy age and LRU eviction
 *   • Event emission on policy changes
 *
 * Does NOT:
 *   • Parse CSP headers (csp-parser.ts's job)
 *   • Evaluate policies (csp-evaluator.ts's job)
 *   • Submit reports (csp-reporter.ts's job)
 *
 * OOP PRINCIPLES
 * ─────────────────────
 *  Single-Resp.     Only stores and retrieves CSP policies per origin.
 *  Encapsulation    Internal storage is private; callers use the public API.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import type { IDisposable } from '../../app/dependency-container';
import type { CspPolicy } from './csp-parser';
import { parseCspHeader, combineCspPolicies } from './csp-parser';

// ─────────────────────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────────────────────

/** A stored CSP policy entry with metadata. */
interface CspPolicyEntry {
  /** The origin this policy applies to. */
  readonly origin: string;
  /** The combined enforce policy. */
  readonly enforcePolicy: CspPolicy;
  /** The combined report-only policy. */
  readonly reportOnlyPolicy: CspPolicy | null;
  /** Timestamp when this policy was stored. */
  readonly timestamp: number;
  /** TTL in milliseconds. 0 means no expiry. */
  readonly ttlMs: number;
  /** The URL that provided this policy (for inheritance). */
  readonly sourceUrl: string;
  /** Whether this policy was inherited from a parent frame. */
  readonly inherited: boolean;
}

/** Configuration for the policy store. */
interface CspPolicyStoreConfig {
  /** Maximum number of origin entries to store. */
  readonly maxEntries: number;
  /** Default TTL for entries in milliseconds. 0 = no expiry. */
  readonly defaultTtlMs: number;
  /** Whether to allow policy inheritance from parent frames. */
  readonly allowInheritance: boolean;
}

type CspPolicyStoreEventType = 'policyStored' | 'policyRemoved' | 'policyExpired';

interface CspPolicyStoredEvent {
  readonly kind: 'policyStored';
  readonly origin: string;
  readonly entry: CspPolicyEntry;
}

interface CspPolicyRemovedEvent {
  readonly kind: 'policyRemoved';
  readonly origin: string;
}

interface CspPolicyExpiredEvent {
  readonly kind: 'policyExpired';
  readonly origin: string;
}

type CspPolicyStoreEvent =
  | CspPolicyStoredEvent
  | CspPolicyRemovedEvent
  | CspPolicyExpiredEvent;

type CspPolicyStoreEventHandler = (event: CspPolicyStoreEvent) => void;

// ─────────────────────────────────────────────────────────────────────────────
// CONSTANTS
// ─────────────────────────────────────────────────────────────────────────────

const DEFAULT_STORE_CONFIG: CspPolicyStoreConfig = {
  maxEntries: 10_000,
  defaultTtlMs: 0,
  allowInheritance: true,
};

// ─────────────────────────────────────────────────────────────────────────────
// CONCRETE IMPLEMENTATION
// ─────────────────────────────────────────────────────────────────────────────

class CspPolicyStore implements IDisposable {
  private readonly policies = new Map<string, CspPolicyEntry>();
  private readonly accessOrder: string[] = [];
  private readonly config: CspPolicyStoreConfig;
  private readonly handlers = new Set<CspPolicyStoreEventHandler>();
  private disposed = false;

  constructor(config?: Partial<CspPolicyStoreConfig>) {
    this.config = { ...DEFAULT_STORE_CONFIG, ...config };
  }

  // ── Store ────────────────────────────────────────────────────────────────

  /**
   * Store a CSP policy for an origin from raw header values.
   *
   * @param origin The origin (scheme + host + port).
   * @param enforceHeaders The Content-Security-Policy header values.
   * @param reportOnlyHeaders The Content-Security-Policy-Report-Only header values.
   * @param sourceUrl The URL that provided this policy.
   * @param inherited Whether this policy was inherited from a parent frame.
   */
  storeFromHeaders(
    origin: string,
    enforceHeaders: string[],
    reportOnlyHeaders: string[] = [],
    sourceUrl = '',
    inherited = false,
  ): CspPolicyEntry {
    const enforcePolicy = enforceHeaders.length > 0
      ? combineCspPolicies(enforceHeaders)
      : parseCspHeader('');

    const reportOnlyPolicy = reportOnlyHeaders.length > 0
      ? combineCspPolicies(reportOnlyHeaders)
      : null;

    return this.store(origin, enforcePolicy, reportOnlyPolicy, sourceUrl, inherited);
  }

  /**
   * Store a parsed CSP policy for an origin.
   */
  store(
    origin: string,
    enforcePolicy: CspPolicy,
    reportOnlyPolicy: CspPolicy | null = null,
    sourceUrl = '',
    inherited = false,
    ttlMs?: number,
  ): CspPolicyEntry {
    if (this.disposed) throw new Error('Store is disposed');

    const entry: CspPolicyEntry = {
      origin,
      enforcePolicy,
      reportOnlyPolicy,
      timestamp: Date.now(),
      ttlMs: ttlMs ?? this.config.defaultTtlMs,
      sourceUrl,
      inherited,
    };

    // Evict LRU if at capacity.
    if (this.policies.size >= this.config.maxEntries && !this.policies.has(origin)) {
      this.evictLru();
    }

    this.policies.set(origin, entry);
    this.touchAccessOrder(origin);

    this.emit({ kind: 'policyStored', origin, entry });

    return entry;
  }

  // ── Retrieve ─────────────────────────────────────────────────────────────

  /**
   * Get the stored CSP policy entry for an origin.
   * Returns null if no policy is stored or if it has expired.
   */
  get(origin: string): CspPolicyEntry | null {
    const entry = this.policies.get(origin);
    if (!entry) return null;

    // Check expiry.
    if (entry.ttlMs > 0 && Date.now() - entry.timestamp > entry.ttlMs) {
      this.policies.delete(origin);
      this.removeFromAccessOrder(origin);
      this.emit({ kind: 'policyExpired', origin });
      return null;
    }

    this.touchAccessOrder(origin);
    return entry;
  }

  /**
   * Get the enforce policy for an origin.
   * Falls back to parent-frame policy if allowInheritance is enabled.
   */
  getEnforcePolicy(origin: string): CspPolicy | null {
    const entry = this.get(origin);
    if (entry) return entry.enforcePolicy;

    // Try parent origin for inheritance.
    if (this.config.allowInheritance) {
      const parentOrigin = this.getParentOrigin(origin);
      if (parentOrigin) {
        const parentEntry = this.get(parentOrigin);
        if (parentEntry && !parentEntry.enforcePolicy.directives.size) {
          return null; // Parent has no CSP — don't inherit.
        }
        if (parentEntry) {
          return parentEntry.enforcePolicy;
        }
      }
    }

    return null;
  }

  /**
   * Get the report-only policy for an origin.
   */
  getReportOnlyPolicy(origin: string): CspPolicy | null {
    const entry = this.get(origin);
    return entry?.reportOnlyPolicy ?? null;
  }

  /**
   * Check if an origin has any CSP policy (enforce or report-only).
   */
  hasPolicy(origin: string): boolean {
    return this.policies.has(origin);
  }

  // ── Remove ───────────────────────────────────────────────────────────────

  /**
   * Remove the policy for an origin.
   */
  remove(origin: string): boolean {
    const existed = this.policies.delete(origin);
    if (existed) {
      this.removeFromAccessOrder(origin);
      this.emit({ kind: 'policyRemoved', origin });
    }
    return existed;
  }

  /**
   * Clear all stored policies.
   */
  clear(): void {
    this.policies.clear();
    this.accessOrder.length = 0;
  }

  // ── Query ────────────────────────────────────────────────────────────────

  /**
   * Get the number of stored policies.
   */
  get size(): number {
    return this.policies.size;
  }

  /**
   * Get all stored origins.
   */
  getOrigins(): string[] {
    return [...this.policies.keys()];
  }

  // ── Event system ─────────────────────────────────────────────────────────

  on(handler: CspPolicyStoreEventHandler): void {
    this.handlers.add(handler);
  }

  off(handler: CspPolicyStoreEventHandler): void {
    this.handlers.delete(handler);
  }

  // ── Private helpers ──────────────────────────────────────────────────────

  private evictLru(): void {
    const oldest = this.accessOrder.shift();
    if (oldest && this.policies.has(oldest)) {
      this.policies.delete(oldest);
      this.emit({ kind: 'policyRemoved', origin: oldest });
    }
  }

  private touchAccessOrder(origin: string): void {
    const idx = this.accessOrder.indexOf(origin);
    if (idx >= 0) this.accessOrder.splice(idx, 1);
    this.accessOrder.push(origin);
  }

  private removeFromAccessOrder(origin: string): void {
    const idx = this.accessOrder.indexOf(origin);
    if (idx >= 0) this.accessOrder.splice(idx, 1);
  }

  /**
   * Derive the parent origin for CSP inheritance.
   * e.g. https://sub.example.com → https://example.com
   */
  private getParentOrigin(origin: string): string | null {
    try {
      const url = new URL(origin);
      const parts = url.hostname.split('.');
      if (parts.length <= 2) return null;
      parts.shift();
      return `${url.protocol}//${parts.join('.')}`;
    } catch {
      return null;
    }
  }

  private emit(event: CspPolicyStoreEvent): void {
    for (const handler of this.handlers) {
      try {
        handler(event);
      } catch {
        // Handler errors must not break the store.
      }
    }
  }

  // ── Dispose ──────────────────────────────────────────────────────────────

  dispose(): void {
    this.disposed = true;
    this.policies.clear();
    this.accessOrder.length = 0;
    this.handlers.clear();
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// EXPORTS
// ─────────────────────────────────────────────────────────────────────────────

export {
  CspPolicyStore,
  DEFAULT_STORE_CONFIG,
};

export type {
  CspPolicyEntry,
  CspPolicyStoreConfig,
  CspPolicyStoreEvent,
  CspPolicyStoreEventHandler,
};
