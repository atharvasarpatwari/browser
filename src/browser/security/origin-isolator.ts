/**
 * @file src/browser/security/origin-isolator.ts
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * RESPONSIBILITY
 * ─────────────────────────────────────────────────────────────────────────────
 * Enforce origin-based isolation between tabs. Handles:
 *   • Mapping each (scheme, host, port) triple to an isolated context ID
 *   • Ensuring tabs from different origins cannot share DOM/storage/network
 *   • Tracking active origins and their context counts
 *   • Cross-origin navigation decisions
 *   • Integration with TabContextManager for context lifecycle
 *   • Origin-level disposal when last tab for an origin closes
 *
 * Does NOT:
 *   • Enforce Same-Origin Policy on DOM access (cross-origin-guard.ts's job)
 *   • Manage user permissions (permission-manager.ts's job)
 *   • Track resource usage (resource-quota-manager.ts's job)
 *
 * OOP PRINCIPLES
 * ─────────────────────
 *  Single-Resp.     Only maps origins to isolated contexts.
 *  Encapsulation    Context registry is private; callers use the public API.
 *  Abstraction      Works with any context provider via OriginContextProvider.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import type { IDisposable } from '../../app/dependency-container';

// ─────────────────────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────────────────────

/** An opaque context ID assigned to an origin. */
type ContextId = string & { readonly __brand: 'ContextId' };

/** An opaque tab ID. */
type TabId = string & { readonly __brand: 'TabId' };

/** An origin string in the form "scheme://host:port". */
type Origin = string & { readonly __brand: 'Origin' };

/** Configuration for the origin isolator. */
interface OriginIsolatorConfig {
  /** Whether to share contexts across same-origin tabs (optimization). */
  readonly shareSameOrigin: boolean;
  /** Maximum number of isolated origins to track. 0 = unlimited. */
  readonly maxOrigins: number;
  /** Whether to emit events on isolation changes. */
  readonly enableEvents: boolean;
}

/** A tracked origin entry. */
interface OriginEntry {
  /** The origin string. */
  readonly origin: Origin;
  /** The isolated context ID for this origin. */
  readonly contextId: ContextId;
  /** Set of tab IDs using this origin. */
  readonly tabs: Set<TabId>;
  /** When this origin was first isolated. */
  readonly createdAt: number;
  /** Last time a tab navigated to this origin. */
  lastAccessedAt: number;
}

/** Result of an isolation check. */
interface IsolationCheckResult {
  /** Whether the two origins are isolated from each other. */
  readonly isolated: boolean;
  /** The context ID of the first origin. */
  readonly contextA: ContextId;
  /** The context ID of the second origin (null if same origin). */
  readonly contextB: ContextId | null;
  /** Whether the two origins are the same. */
  readonly sameOrigin: boolean;
}

/** Result of a cross-origin navigation decision. */
interface NavigationIsolationResult {
  /** Whether the navigation is allowed. */
  readonly allowed: boolean;
  /** Whether this requires a new context (cross-origin). */
  readonly requiresNewContext: boolean;
  /** The context ID to use (existing or new). */
  readonly contextId: ContextId;
  /** Reason for denial, if blocked. */
  readonly reason?: string;
}

type OriginIsolatorEventType =
  | 'originIsolated'
  | 'originRemoved'
  | 'tabAdded'
  | 'tabRemoved'
  | 'crossOriginNavigation';

interface OriginIsolatorEvent {
  readonly kind: OriginIsolatorEventType;
  readonly origin: Origin;
  readonly contextId: ContextId;
  readonly tabId?: TabId;
  readonly targetOrigin?: Origin;
}

type OriginIsolatorEventHandler = (event: OriginIsolatorEvent) => void;

// ─────────────────────────────────────────────────────────────────────────────
// CONSTANTS
// ─────────────────────────────────────────────────────────────────────────────

const DEFAULT_ISOLATOR_CONFIG: OriginIsolatorConfig = {
  shareSameOrigin: true,
  maxOrigins: 10_000,
  enableEvents: true,
};

// ─────────────────────────────────────────────────────────────────────────────
// CONCRETE IMPLEMENTATION
// ─────────────────────────────────────────────────────────────────────────────

class OriginIsolator implements IDisposable {
  private readonly origins = new Map<Origin, OriginEntry>();
  private readonly tabToOrigin = new Map<TabId, Origin>();
  private readonly contextToOrigin = new Map<ContextId, Origin>();
  private readonly handlers = new Set<OriginIsolatorEventHandler>();
  private readonly config: OriginIsolatorConfig;
  private nextContextId = 1;
  private disposed = false;

  constructor(config?: Partial<OriginIsolatorConfig>) {
    this.config = { ...DEFAULT_ISOLATOR_CONFIG, ...config };
  }

  // ── Public API ───────────────────────────────────────────────────────────

  /**
   * Register a tab navigating to an origin.
   * Returns the context ID to use for this tab.
   */
  registerTab(tabId: string, origin: string): NavigationIsolationResult {
    if (this.disposed) throw new Error('OriginIsolator is disposed');

    const typedOrigin = origin as Origin;
    const typedTabId = tabId as TabId;
    const existingEntry = this.origins.get(typedOrigin);

    if (existingEntry) {
      // Origin already isolated — add tab to existing context.
      existingEntry.tabs.add(typedTabId);
      existingEntry.lastAccessedAt = Date.now();
      this.tabToOrigin.set(typedTabId, typedOrigin);

      this.emit({
        kind: 'tabAdded',
        origin: typedOrigin,
        contextId: existingEntry.contextId,
        tabId: typedTabId,
      });

      return {
        allowed: true,
        requiresNewContext: false,
        contextId: existingEntry.contextId,
      };
    }

    // New origin — check capacity.
    if (this.config.maxOrigins > 0 && this.origins.size >= this.config.maxOrigins) {
      this.evictLeastRecent();
    }

    // Create new isolated context.
    const contextId = this.createContextId();
    const entry: OriginEntry = {
      origin: typedOrigin,
      contextId,
      tabs: new Set([typedTabId]),
      createdAt: Date.now(),
      lastAccessedAt: Date.now(),
    };

    this.origins.set(typedOrigin, entry);
    this.tabToOrigin.set(typedTabId, typedOrigin);
    this.contextToOrigin.set(contextId, typedOrigin);

    this.emit({
      kind: 'originIsolated',
      origin: typedOrigin,
      contextId,
    });

    this.emit({
      kind: 'tabAdded',
      origin: typedOrigin,
      contextId,
      tabId: typedTabId,
    });

    return {
      allowed: true,
      requiresNewContext: true,
      contextId,
    };
  }

  /**
   * Unregister a tab (e.g., when it closes or navigates away).
   */
  unregisterTab(tabId: string): void {
    if (this.disposed) return;

    const typedTabId = tabId as TabId;
    const origin = this.tabToOrigin.get(typedTabId);
    if (!origin) return;

    const entry = this.origins.get(origin);
    if (entry) {
      entry.tabs.delete(typedTabId);
      this.emit({
        kind: 'tabRemoved',
        origin,
        contextId: entry.contextId,
        tabId: typedTabId,
      });

      // If last tab for this origin, remove the origin.
      if (entry.tabs.size === 0) {
        this.origins.delete(origin);
        this.contextToOrigin.delete(entry.contextId);
        this.emit({
          kind: 'originRemoved',
          origin,
          contextId: entry.contextId,
        });
      }
    }

    this.tabToOrigin.delete(typedTabId);
  }

  /**
   * Handle a cross-origin navigation.
   * Determines if the navigation requires a new context.
   */
  checkNavigation(
    tabId: string,
    targetOrigin: string,
  ): NavigationIsolationResult {
    if (this.disposed) throw new Error('OriginIsolator is disposed');

    const typedTabId = tabId as TabId;
    const currentOrigin = this.tabToOrigin.get(typedTabId);
    const typedTargetOrigin = targetOrigin as Origin;

    // Tab has no current origin — first navigation.
    if (!currentOrigin) {
      const result = this.registerTab(tabId, targetOrigin);
      return {
        ...result,
        requiresNewContext: true,
      };
    }

    // Same origin — reuse context.
    if (currentOrigin === typedTargetOrigin) {
      const entry = this.origins.get(currentOrigin)!;
      return {
        allowed: true,
        requiresNewContext: false,
        contextId: entry.contextId,
      };
    }

    // Cross-origin navigation — emit event and require new context.
    this.emit({
      kind: 'crossOriginNavigation',
      origin: currentOrigin,
      contextId: this.origins.get(currentOrigin)!.contextId,
      tabId: typedTabId,
      targetOrigin: typedTargetOrigin,
    });

    // Unregister from old origin.
    this.unregisterTab(tabId);

    // Register at new origin.
    const result = this.registerTab(tabId, targetOrigin);
    return {
      ...result,
      requiresNewContext: true,
    };
  }

  /**
   * Check if two origins are isolated from each other.
   */
  checkIsolation(originA: string, originB: string): IsolationCheckResult {
    const typedA = originA as Origin;
    const typedB = originB as Origin;

    const entryA = this.origins.get(typedA);
    const entryB = this.origins.get(typedB);

    if (!entryA || !entryB) {
      return {
        isolated: true,
        contextA: entryA?.contextId ?? ('' as ContextId),
        contextB: entryB?.contextId ?? null,
        sameOrigin: originA === originB,
      };
    }

    return {
      isolated: entryA.contextId !== entryB.contextId,
      contextA: entryA.contextId,
      contextB: entryB.contextId,
      sameOrigin: originA === originB,
    };
  }

  /**
   * Get the context ID for an origin.
   */
  getContextForOrigin(origin: string): ContextId | null {
    const entry = this.origins.get(origin as Origin);
    return entry?.contextId ?? null;
  }

  /**
   * Get the origin for a tab.
   */
  getOriginForTab(tabId: string): string | null {
    return this.tabToOrigin.get(tabId as TabId) ?? null;
  }

  /**
   * Get all active origins.
   */
  getActiveOrigins(): readonly Origin[] {
    return [...this.origins.keys()];
  }

  /**
   * Get the number of active origins.
   */
  get originCount(): number {
    return this.origins.size;
  }

  /**
   * Get the number of tabs for an origin.
   */
  getTabCount(origin: string): number {
    return this.origins.get(origin as Origin)?.tabs.size ?? 0;
  }

  // ── Event system ─────────────────────────────────────────────────────────

  on(handler: OriginIsolatorEventHandler): void {
    this.handlers.add(handler);
  }

  off(handler: OriginIsolatorEventHandler): void {
    this.handlers.delete(handler);
  }

  // ── Private helpers ──────────────────────────────────────────────────────

  private createContextId(): ContextId {
    return `ctx-${this.nextContextId++}` as ContextId;
  }

  private evictLeastRecent(): void {
    let oldest: Origin | null = null;
    let oldestTime = Infinity;

    for (const [origin, entry] of this.origins) {
      if (entry.lastAccessedAt < oldestTime) {
        oldestTime = entry.lastAccessedAt;
        oldest = origin;
      }
    }

    if (oldest) {
      // Remove all tabs from this origin.
      const entry = this.origins.get(oldest)!;
      for (const tabId of entry.tabs) {
        this.tabToOrigin.delete(tabId);
      }
      this.contextToOrigin.delete(entry.contextId);
      this.origins.delete(oldest);
      this.emit({ kind: 'originRemoved', origin: oldest, contextId: entry.contextId });
    }
  }

  private emit(event: OriginIsolatorEvent): void {
    if (!this.config.enableEvents) return;
    for (const handler of this.handlers) {
      try { handler(event); } catch { /* handler errors must not break the isolator */ }
    }
  }

  // ── Dispose ──────────────────────────────────────────────────────────────

  dispose(): void {
    this.disposed = true;
    this.origins.clear();
    this.tabToOrigin.clear();
    this.contextToOrigin.clear();
    this.handlers.clear();
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// EXPORTS
// ─────────────────────────────────────────────────────────────────────────────

export {
  OriginIsolator,
  DEFAULT_ISOLATOR_CONFIG,
};

export type {
  ContextId,
  TabId,
  Origin,
  OriginIsolatorConfig,
  OriginEntry,
  IsolationCheckResult,
  NavigationIsolationResult,
  OriginIsolatorEvent,
  OriginIsolatorEventHandler,
};
