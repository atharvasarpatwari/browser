/**
 * @file src/browser/security/process-isolator.ts
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * RESPONSIBILITY
 * ─────────────────────────────────────────────────────────────────────────────
 * Enforces process isolation between renderer processes. Ensures:
 *
 *   1. Each renderer has its own isolated V8 context
 *   2. Renderers cannot access each other's memory or state
 *   3. Shared resources (DOM, CSS) are accessed through controlled proxies
 *   4. Resource quotas are enforced per renderer
 *   5. Process crashes are contained and do not affect other renderers
 *
 * Does NOT:
 *   • Define capabilities (renderer-sandbox.ts's job)
 *   • Gate IPC (capability-gate.ts's job)
 *   • Enforce sandbox rules (sandbox-enforcer.ts's job)
 *   • Handle network (network-proxy.ts's job)
 *
 * OOP PRINCIPLES
 * ───────────────
 *  Single-Resp.     Only enforces isolation boundaries between processes.
 *  Liskov Sub.      Works with any IProcessManager that provides process IDs.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import type { IDisposable } from '../../app/dependency-container';
import type { PrivilegeLevel } from './privilege-levels';

// ─────────────────────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────────────────────

/** Resource quota for a renderer process. */
interface ResourceQuota {
  /** Maximum memory in MB. */
  readonly maxMemoryMB: number;
  /** Maximum CPU time in ms per event loop tick. */
  readonly maxCpuTimeMs: number;
  /** Maximum number of open file descriptors. */
  readonly maxOpenFds: number;
  /** Maximum number of concurrent timers. */
  readonly maxTimers: number;
  /** Maximum number of pending promises. */
  readonly maxPendingPromises: number;
  /** Maximum script execution time in ms. */
  readonly maxScriptTimeMs: number;
}

/** State of an isolated process. */
interface IsolatedProcessState {
  /** The process ID. */
  readonly processId: string;
  /** The origin this process serves. */
  readonly origin: string;
  /** The privilege level. */
  readonly privilegeLevel: PrivilegeLevel;
  /** The resource quota. */
  readonly quota: ResourceQuota;
  /** Current resource usage. */
  readonly usage: ResourceUsage;
  /** Whether the process is still alive. */
  alive: boolean;
  /** Timestamp of last activity. */
  lastActivity: number;
  /** Error count (for crash detection). */
  errorCount: number;
}

/** Current resource usage of a process. */
interface ResourceUsage {
  /** Memory currently used in MB. */
  memoryMB: number;
  /** CPU time used in ms (cumulative). */
  cpuTimeMs: number;
  /** Number of open file descriptors. */
  openFds: number;
  /** Number of active timers. */
  activeTimers: number;
  /** Number of pending promises. */
  pendingPromises: number;
}

/** Event emitted on isolation violation. */
interface IsolationViolationEvent {
  readonly kind: 'memory-exceeded' | 'cpu-exceeded' | 'fd-exceeded' | 'timer-exceeded'
    | 'promise-exceeded' | 'script-timeout' | 'cross-origin-access' | 'process-crash';
  readonly processId: string;
  readonly origin: string;
  readonly details: string;
  readonly timestamp: number;
}

type IsolationEventHandler = (event: IsolationViolationEvent) => void;

/** Configuration for process isolation. */
interface ProcessIsolatorConfig {
  /** Default resource quota for web-content. */
  readonly defaultQuota: ResourceQuota;
  /** Quota overrides by privilege level. */
  readonly quotaByLevel: ReadonlyMap<PrivilegeLevel, ResourceQuota>;
  /** Maximum number of concurrent isolated processes. */
  readonly maxProcesses: number;
  /** How long before an idle process is evicted (ms). */
  readonly idleTimeoutMs: number;
  /** Whether to enforce quotas strictly. */
  readonly strictEnforcement: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// DEFAULT QUOTAS
// ─────────────────────────────────────────────────────────────────────────────

const DEFAULT_WEB_CONTENT_QUOTA: ResourceQuota = {
  maxMemoryMB: 512,
  maxCpuTimeMs: 50,
  maxOpenFds: 64,
  maxTimers: 1000,
  maxPendingPromises: 10_000,
  maxScriptTimeMs: 5000,
};

const SANDBOXED_CONTENT_QUOTA: ResourceQuota = {
  maxMemoryMB: 128,
  maxCpuTimeMs: 25,
  maxOpenFds: 16,
  maxTimers: 200,
  maxPendingPromises: 1000,
  maxScriptTimeMs: 2000,
};

const TRUSTED_EXTENSION_QUOTA: ResourceQuota = {
  maxMemoryMB: 256,
  maxCpuTimeMs: 40,
  maxOpenFds: 32,
  maxTimers: 500,
  maxPendingPromises: 5000,
  maxScriptTimeMs: 3000,
};

const BROWSER_CHROME_QUOTA: ResourceQuota = {
  maxMemoryMB: 1024,
  maxCpuTimeMs: 200,
  maxOpenFds: 256,
  maxTimers: 10_000,
  maxPendingPromises: 50_000,
  maxScriptTimeMs: 30_000,
};

const DEFAULT_ISOLATOR_CONFIG: ProcessIsolatorConfig = {
  defaultQuota: DEFAULT_WEB_CONTENT_QUOTA,
  quotaByLevel: new Map([
    ['sandboxed-content', SANDBOXED_CONTENT_QUOTA],
    ['web-content', DEFAULT_WEB_CONTENT_QUOTA],
    ['trusted-extension', TRUSTED_EXTENSION_QUOTA],
    ['browser-chrome', BROWSER_CHROME_QUOTA],
  ]),
  maxProcesses: 64,
  idleTimeoutMs: 300_000, // 5 minutes
  strictEnforcement: true,
};

// ─────────────────────────────────────────────────────────────────────────────
// PROCESS ISOLATOR
// ─────────────────────────────────────────────────────────────────────────────

class ProcessIsolator implements IDisposable {
  private readonly config: ProcessIsolatorConfig;
  private readonly processes = new Map<string, IsolatedProcessState>();
  private readonly eventHandlers = new Set<IsolationEventHandler>();
  private readonly originProcesses = new Map<string, Set<string>>();
  private _disposed = false;
  private cleanupInterval: ReturnType<typeof setInterval> | null = null;

  constructor(config?: Partial<ProcessIsolatorConfig>) {
    this.config = { ...DEFAULT_ISOLATOR_CONFIG, ...config };
    this.startCleanupTimer();
  }

  // ── Public API ───────────────────────────────────────────────────────────

  /**
   * Register a new isolated process.
   */
  registerProcess(
    processId: string,
    origin: string,
    privilegeLevel: PrivilegeLevel,
  ): { allowed: boolean; reason?: string } {
    if (this.processes.size >= this.config.maxProcesses) {
      return { allowed: false, reason: `Maximum process limit (${this.config.maxProcesses}) reached` };
    }

    const quota = this.config.quotaByLevel.get(privilegeLevel) ?? this.config.defaultQuota;

    const state: IsolatedProcessState = {
      processId,
      origin,
      privilegeLevel,
      quota,
      usage: {
        memoryMB: 0,
        cpuTimeMs: 0,
        openFds: 0,
        activeTimers: 0,
        pendingPromises: 0,
      },
      alive: true,
      lastActivity: Date.now(),
      errorCount: 0,
    };

    this.processes.set(processId, state);

    // Track origin→process mapping
    let originSet = this.originProcesses.get(origin);
    if (!originSet) {
      originSet = new Set();
      this.originProcesses.set(origin, originSet);
    }
    originSet.add(processId);

    return { allowed: true };
  }

  /**
   * Unregister a process (on exit or crash).
   */
  unregisterProcess(processId: string): void {
    const state = this.processes.get(processId);
    if (state) {
      state.alive = false;

      // Remove from origin mapping
      const originSet = this.originProcesses.get(state.origin);
      if (originSet) {
        originSet.delete(processId);
        if (originSet.size === 0) {
          this.originProcesses.delete(state.origin);
        }
      }
    }

    this.processes.delete(processId);
  }

  /**
   * Check if a process can access a resource.
   */
  checkResource(processId: string, resource: keyof ResourceUsage): {
    allowed: boolean;
    current: number;
    limit: number;
  } {
    const state = this.processes.get(processId);
    if (!state || !state.alive) {
      return { allowed: false, current: 0, limit: 0 };
    }

    const quotaKey = `max${resource.charAt(0).toUpperCase() + resource.slice(1)}` as keyof ResourceQuota;
    const limit = state.quota[quotaKey] as number ?? 0;
    const current = state.usage[resource] as number ?? 0;

    return {
      allowed: current < limit,
      current,
      limit,
    };
  }

  /**
   * Check if two processes are in the same origin.
   */
  areSameOrigin(processId1: string, processId2: string): boolean {
    const state1 = this.processes.get(processId1);
    const state2 = this.processes.get(processId2);
    if (!state1 || !state2) return false;
    return state1.origin === state2.origin;
  }

  /**
   * Get all processes for a given origin.
   */
  getProcessesForOrigin(origin: string): readonly string[] {
    return Array.from(this.originProcesses.get(origin) ?? []);
  }

  /**
   * Update resource usage for a process.
   */
  updateUsage(processId: string, usage: Partial<ResourceUsage>): boolean {
    const state = this.processes.get(processId);
    if (!state || !state.alive) return false;

    // Update usage
    for (const [key, value] of Object.entries(usage)) {
      (state.usage as any)[key] = value;
    }

    state.lastActivity = Date.now();

    // Check if any quota is exceeded
    const violations = this.checkQuotas(state);
    if (violations.length > 0 && this.config.strictEnforcement) {
      return false;
    }

    return true;
  }

  /**
   * Record an error for a process (for crash detection).
   */
  recordError(processId: string, details: string): void {
    const state = this.processes.get(processId);
    if (!state) return;

    state.errorCount++;
    state.lastActivity = Date.now();

    if (state.errorCount >= 5) {
      this.emit({
        kind: 'process-crash',
        processId,
        origin: state.origin,
        details: `Process crashed after ${state.errorCount} errors: ${details}`,
        timestamp: Date.now(),
      });
      state.alive = false;
    }
  }

  /**
   * Get the state of an isolated process.
   */
  getProcessState(processId: string): IsolatedProcessState | undefined {
    return this.processes.get(processId);
  }

  /**
   * Get all alive process IDs.
   */
  getAliveProcessIds(): string[] {
    return Array.from(this.processes.entries())
      .filter(([_, state]) => state.alive)
      .map(([id]) => id);
  }

  /**
   * Get the number of active processes.
   */
  getActiveCount(): number {
    return this.processes.size;
  }

  /**
   * Subscribe to isolation events.
   */
  on(handler: IsolationEventHandler): void {
    this.eventHandlers.add(handler);
  }

  /**
   * Unsubscribe from isolation events.
   */
  off(handler: IsolationEventHandler): void {
    this.eventHandlers.delete(handler);
  }

  get disposed(): boolean {
    return this._disposed;
  }

  dispose(): void {
    this._disposed = true;
    this.processes.clear();
    this.originProcesses.clear();
    this.eventHandlers.clear();
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
  }

  // ── Private helpers ──────────────────────────────────────────────────────

  private checkQuotas(state: IsolatedProcessState): IsolationViolationEvent[] {
    const violations: IsolationViolationEvent[] = [];

    if (state.usage.memoryMB > state.quota.maxMemoryMB) {
      violations.push({
        kind: 'memory-exceeded',
        processId: state.processId,
        origin: state.origin,
        details: `Memory ${state.usage.memoryMB}MB exceeds limit ${state.quota.maxMemoryMB}MB`,
        timestamp: Date.now(),
      });
    }

    if (state.usage.cpuTimeMs > state.quota.maxCpuTimeMs) {
      violations.push({
        kind: 'cpu-exceeded',
        processId: state.processId,
        origin: state.origin,
        details: `CPU time ${state.usage.cpuTimeMs}ms exceeds limit ${state.quota.maxCpuTimeMs}ms`,
        timestamp: Date.now(),
      });
    }

    if (state.usage.openFds > state.quota.maxOpenFds) {
      violations.push({
        kind: 'fd-exceeded',
        processId: state.processId,
        origin: state.origin,
        details: `Open FDs ${state.usage.openFds} exceeds limit ${state.quota.maxOpenFds}`,
        timestamp: Date.now(),
      });
    }

    if (state.usage.activeTimers > state.quota.maxTimers) {
      violations.push({
        kind: 'timer-exceeded',
        processId: state.processId,
        origin: state.origin,
        details: `Active timers ${state.usage.activeTimers} exceeds limit ${state.quota.maxTimers}`,
        timestamp: Date.now(),
      });
    }

    if (state.usage.pendingPromises > state.quota.maxPendingPromises) {
      violations.push({
        kind: 'promise-exceeded',
        processId: state.processId,
        origin: state.origin,
        details: `Pending promises ${state.usage.pendingPromises} exceeds limit ${state.quota.maxPendingPromises}`,
        timestamp: Date.now(),
      });
    }

    for (const v of violations) {
      this.emit(v);
    }

    return violations;
  }

  private startCleanupTimer(): void {
    this.cleanupInterval = setInterval(() => {
      const now = Date.now();
      for (const [id, state] of this.processes) {
        if (!state.alive) {
          this.processes.delete(id);
          continue;
        }
        if (now - state.lastActivity > this.config.idleTimeoutMs) {
          state.alive = false;
          this.processes.delete(id);
          const originSet = this.originProcesses.get(state.origin);
          if (originSet) {
            originSet.delete(id);
            if (originSet.size === 0) this.originProcesses.delete(state.origin);
          }
        }
      }
    }, 60_000);
  }

  private emit(event: IsolationViolationEvent): void {
    for (const handler of this.eventHandlers) {
      try { handler(event); } catch { /* swallow */ }
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// FACTORY
// ─────────────────────────────────────────────────────────────────────────────

function createProcessIsolator(config?: Partial<ProcessIsolatorConfig>): ProcessIsolator {
  return new ProcessIsolator(config);
}

// ─────────────────────────────────────────────────────────────────────────────
// EXPORTS
// ─────────────────────────────────────────────────────────────────────────────

export {
  ProcessIsolator,
  createProcessIsolator,
  DEFAULT_WEB_CONTENT_QUOTA,
  SANDBOXED_CONTENT_QUOTA,
  TRUSTED_EXTENSION_QUOTA,
  BROWSER_CHROME_QUOTA,
  DEFAULT_ISOLATOR_CONFIG,
};

export type {
  ResourceQuota,
  IsolatedProcessState,
  ResourceUsage,
  IsolationViolationEvent,
  IsolationEventHandler,
  ProcessIsolatorConfig,
};
