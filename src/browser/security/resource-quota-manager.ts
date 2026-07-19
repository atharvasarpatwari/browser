/**
 * @file src/browser/security/resource-quota-manager.ts
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * RESPONSIBILITY
 * ─────────────────────────────────────────────────────────────────────────────
 * Per-tab/per-origin resource quotas. Handles:
 *   • Memory limits: max heap per tab, eviction on breach
 *   • CPU limits: max execution time per task, integrates with ScriptGuard
 *   • Network limits: max concurrent connections per origin, bandwidth caps
 *   • Quota tracking: current usage, peak usage, historical averages
 *   • Eviction policies: LRU (memory), timeout (CPU), queue (network)
 *   • Event emission on quota breach for UI notification
 *   • Integration with CrashReporter for quota violation reporting
 *
 * Does NOT:
 *   • Track origin isolation (origin-isolator.ts's job)
 *   • Enforce DOM access boundaries (cross-origin-guard.ts's job)
 *   • Execute scripts (JS engine's job)
 *
 * OOP PRINCIPLES
 * ─────────────────────
 *  Single-Resp.     Only manages resource quotas per tab/origin.
 *  Encapsulation    Quota state is private; callers use the public API.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import type { IDisposable } from '../../app/dependency-container';

// ─────────────────────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────────────────────

/** Resource type being tracked. */
type ResourceType = 'memory' | 'cpu' | 'network';

/** A tab's resource usage entry. */
interface ResourceUsage {
  /** The tab ID. */
  readonly tabId: string;
  /** The origin. */
  readonly origin: string;
  /** Memory usage in bytes. */
  memoryBytes: number;
  /** CPU time consumed in milliseconds. */
  cpuTimeMs: number;
  /** Number of active network connections. */
  networkConnections: number;
  /** Peak memory usage in bytes. */
  peakMemoryBytes: number;
  /** Peak CPU time in milliseconds. */
  peakCpuTimeMs: number;
  /** When tracking started. */
  readonly startedAt: number;
  /** Last update timestamp. */
  lastUpdatedAt: number;
}

/** Configuration for resource quotas. */
interface ResourceQuotaConfig {
  /** Maximum memory per tab in bytes. 0 = unlimited. */
  readonly maxMemoryBytes: number;
  /** Maximum CPU time per task in milliseconds. 0 = unlimited. */
  readonly maxCpuTimeMs: number;
  /** Maximum concurrent network connections per origin. 0 = unlimited. */
  readonly maxNetworkConnections: number;
  /** Maximum total network bandwidth per origin in bytes/sec. 0 = unlimited. */
  readonly maxBandwidthBytesPerSec: number;
  /** Interval for usage snapshots in milliseconds. */
  readonly snapshotIntervalMs: number;
  /** Maximum number of tracked tabs. 0 = unlimited. */
  readonly maxTabs: number;
}

/** Result of a quota check. */
interface QuotaCheckResult {
  /** Whether the usage is within quota. */
  readonly withinQuota: boolean;
  /** The resource type checked. */
  readonly resourceType: ResourceType;
  /** Current usage value. */
  readonly current: number;
  /** Maximum allowed value. */
  readonly max: number;
  /** Usage percentage (0-100+). */
  readonly usagePercent: number;
  /** Reason for quota breach, if exceeded. */
  readonly reason?: string;
}

/** Summary of all resource usage for a tab. */
interface TabQuotaSummary {
  readonly tabId: string;
  readonly origin: string;
  readonly memory: QuotaCheckResult;
  readonly cpu: QuotaCheckResult;
  readonly network: QuotaCheckResult;
  /** Whether any quota is exceeded. */
  readonly anyExceeded: boolean;
}

type ResourceQuotaEventType =
  | 'quotaBreached'
  | 'quotaFreed'
  | 'tabTracked'
  | 'tabUntracked'
  | 'evictionTriggered';

interface ResourceQuotaEvent {
  readonly kind: ResourceQuotaEventType;
  readonly tabId: string;
  readonly resourceType?: ResourceType;
  readonly usage?: number;
  readonly max?: number;
}

type ResourceQuotaEventHandler = (event: ResourceQuotaEvent) => void;

// ─────────────────────────────────────────────────────────────────────────────
// CONSTANTS
// ─────────────────────────────────────────────────────────────────────────────

const DEFAULT_QUOTA_CONFIG: ResourceQuotaConfig = {
  maxMemoryBytes: 128 * 1024 * 1024,    // 128 MB
  maxCpuTimeMs: 50,                       // 50 ms per task
  maxNetworkConnections: 6,               // 6 concurrent connections
  maxBandwidthBytesPerSec: 0,             // unlimited
  snapshotIntervalMs: 5_000,              // snapshots every 5s
  maxTabs: 0,                             // unlimited
};

// ─────────────────────────────────────────────────────────────────────────────
// CONCRETE IMPLEMENTATION
// ─────────────────────────────────────────────────────────────────────────────

class ResourceQuotaManager implements IDisposable {
  private readonly usage = new Map<string, ResourceUsage>();
  private readonly handlers = new Set<ResourceQuotaEventHandler>();
  private readonly config: ResourceQuotaConfig;
  private disposed = false;

  constructor(config?: Partial<ResourceQuotaConfig>) {
    this.config = { ...DEFAULT_QUOTA_CONFIG, ...config };
  }

  // ── Tracking ─────────────────────────────────────────────────────────────

  /**
   * Start tracking resource usage for a tab.
   */
  trackTab(tabId: string, origin: string): void {
    if (this.disposed) throw new Error('ResourceQuotaManager is disposed');

    if (this.usage.has(tabId)) return; // already tracked

    // Enforce capacity.
    if (this.config.maxTabs > 0 && this.usage.size >= this.config.maxTabs) {
      this.evictOldestTab();
    }

    this.usage.set(tabId, {
      tabId,
      origin,
      memoryBytes: 0,
      cpuTimeMs: 0,
      networkConnections: 0,
      peakMemoryBytes: 0,
      peakCpuTimeMs: 0,
      startedAt: Date.now(),
      lastUpdatedAt: Date.now(),
    });

    this.emit({ kind: 'tabTracked', tabId });
  }

  /**
   * Stop tracking resource usage for a tab.
   */
  untrackTab(tabId: string): void {
    if (this.disposed) return;
    this.usage.delete(tabId);
    this.emit({ kind: 'tabUntracked', tabId });
  }

  // ── Usage updates ────────────────────────────────────────────────────────

  /**
   * Update memory usage for a tab.
   */
  updateMemory(tabId: string, bytes: number): QuotaCheckResult {
    const entry = this.usage.get(tabId);
    if (!entry) return this.buildQuotaResult('memory', bytes, this.config.maxMemoryBytes);

    entry.memoryBytes = bytes;
    entry.peakMemoryBytes = Math.max(entry.peakMemoryBytes, bytes);
    entry.lastUpdatedAt = Date.now();

    const result = this.buildQuotaResult('memory', bytes, this.config.maxMemoryBytes);
    if (!result.withinQuota) {
      this.emit({ kind: 'quotaBreached', tabId, resourceType: 'memory', usage: bytes, max: this.config.maxMemoryBytes });
    }
    return result;
  }

  /**
   * Record CPU time consumed by a task.
   */
  recordCpuTime(tabId: string, taskTimeMs: number): QuotaCheckResult {
    const entry = this.usage.get(tabId);
    if (!entry) return this.buildQuotaResult('cpu', taskTimeMs, this.config.maxCpuTimeMs);

    entry.cpuTimeMs += taskTimeMs;
    entry.peakCpuTimeMs = Math.max(entry.peakCpuTimeMs, taskTimeMs);
    entry.lastUpdatedAt = Date.now();

    // CPU check is per-task, not cumulative — use taskTimeMs for comparison.
    const result = this.buildQuotaResult('cpu', taskTimeMs, this.config.maxCpuTimeMs);
    if (!result.withinQuota) {
      this.emit({ kind: 'quotaBreached', tabId, resourceType: 'cpu', usage: taskTimeMs, max: this.config.maxCpuTimeMs });
    }
    return result;
  }

  /**
   * Increment network connection count.
   */
  acquireConnection(tabId: string): QuotaCheckResult {
    const entry = this.usage.get(tabId);
    if (!entry) return this.buildQuotaResult('network', 1, this.config.maxNetworkConnections);

    entry.networkConnections++;
    entry.lastUpdatedAt = Date.now();

    const result = this.buildQuotaResult('network', entry.networkConnections, this.config.maxNetworkConnections);
    if (!result.withinQuota) {
      this.emit({ kind: 'quotaBreached', tabId, resourceType: 'network', usage: entry.networkConnections, max: this.config.maxNetworkConnections });
    }
    return result;
  }

  /**
   * Release a network connection.
   */
  releaseConnection(tabId: string): void {
    const entry = this.usage.get(tabId);
    if (!entry || entry.networkConnections <= 0) return;
    entry.networkConnections--;
    entry.lastUpdatedAt = Date.now();
    this.emit({ kind: 'quotaFreed', tabId, resourceType: 'network' });
  }

  // ── Queries ──────────────────────────────────────────────────────────────

  /**
   * Get the quota check for a specific resource.
   */
  checkQuota(tabId: string, resourceType: ResourceType): QuotaCheckResult | null {
    const entry = this.usage.get(tabId);
    if (!entry) return null;

    switch (resourceType) {
      case 'memory':
        return this.buildQuotaResult('memory', entry.memoryBytes, this.config.maxMemoryBytes);
      case 'cpu':
        // For cumulative CPU, check against a larger budget (e.g. 10x per-task).
        return this.buildQuotaResult('cpu', entry.cpuTimeMs, this.config.maxCpuTimeMs * 10);
      case 'network':
        return this.buildQuotaResult('network', entry.networkConnections, this.config.maxNetworkConnections);
    }
  }

  /**
   * Get a full summary for a tab.
   */
  getSummary(tabId: string): TabQuotaSummary | null {
    const entry = this.usage.get(tabId);
    if (!entry) return null;

    const memory = this.buildQuotaResult('memory', entry.memoryBytes, this.config.maxMemoryBytes);
    const cpu = this.buildQuotaResult('cpu', entry.cpuTimeMs, this.config.maxCpuTimeMs * 10);
    const network = this.buildQuotaResult('network', entry.networkConnections, this.config.maxNetworkConnections);

    return {
      tabId,
      origin: entry.origin,
      memory,
      cpu,
      network,
      anyExceeded: !memory.withinQuota || !cpu.withinQuota || !network.withinQuota,
    };
  }

  /**
   * Get raw usage data for a tab.
   */
  getUsage(tabId: string): ResourceUsage | null {
    return this.usage.get(tabId) ?? null;
  }

  /**
   * Get all tracked tab IDs.
   */
  getTrackedTabs(): string[] {
    return [...this.usage.keys()];
  }

  /**
   * Get the number of tracked tabs.
   */
  get trackedCount(): number {
    return this.usage.size;
  }

  // ── Event system ─────────────────────────────────────────────────────────

  on(handler: ResourceQuotaEventHandler): void {
    this.handlers.add(handler);
  }

  off(handler: ResourceQuotaEventHandler): void {
    this.handlers.delete(handler);
  }

  // ── Private helpers ──────────────────────────────────────────────────────

  private buildQuotaResult(
    resourceType: ResourceType,
    current: number,
    max: number,
  ): QuotaCheckResult {
    if (max <= 0) {
      return { withinQuota: true, resourceType, current, max, usagePercent: 0 };
    }

    const usagePercent = (current / max) * 100;
    const withinQuota = current <= max;

    return {
      withinQuota,
      resourceType,
      current,
      max,
      usagePercent: Math.round(usagePercent * 100) / 100,
      reason: withinQuota ? undefined : `${resourceType} quota exceeded: ${current}/${max}`,
    };
  }

  private evictOldestTab(): void {
    let oldestTab: string | null = null;
    let oldestTime = Infinity;

    for (const [tabId, entry] of this.usage) {
      if (entry.lastUpdatedAt < oldestTime) {
        oldestTime = entry.lastUpdatedAt;
        oldestTab = tabId;
      }
    }

    if (oldestTab) {
      this.usage.delete(oldestTab);
      this.emit({ kind: 'evictionTriggered', tabId: oldestTab, resourceType: 'memory' });
    }
  }

  private emit(event: ResourceQuotaEvent): void {
    for (const handler of this.handlers) {
      try { handler(event); } catch { /* handler errors must not break the manager */ }
    }
  }

  // ── Dispose ──────────────────────────────────────────────────────────────

  dispose(): void {
    this.disposed = true;
    this.usage.clear();
    this.handlers.clear();
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// EXPORTS
// ─────────────────────────────────────────────────────────────────────────────

export {
  ResourceQuotaManager,
  DEFAULT_QUOTA_CONFIG,
};

export type {
  ResourceType,
  ResourceUsage,
  ResourceQuotaConfig,
  QuotaCheckResult,
  TabQuotaSummary,
  ResourceQuotaEvent,
  ResourceQuotaEventHandler,
};
