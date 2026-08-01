/**
 * @file src/browser/engine/task-manager.ts
 *
 * Browser Task Manager — displays per-tab process resource usage
 * (CPU, memory, network, thread count). Similar to Chrome's chrome://task-manager.
 */

import type { IDisposable } from '../../app/dependency-container';
import type { ISharedService } from '../../app/app-shell';

// ─────────────────────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────────────────────

export interface TaskManagerConfig {
  /** How often to sample resource usage (ms) */
  sampleIntervalMs: number;
  /** Maximum number of snapshots to retain */
  maxSnapshots: number;
  /** Whether to include GPU process stats */
  includeGpu: boolean;
  /** Whether to include network process stats */
  includeNetwork: boolean;
}

export interface ProcessResourceUsage {
  /** Process identifier */
  processId: string;
  /** Tab ID associated with this process (if any) */
  tabId?: string;
  /** Tab URL */
  url?: string;
  /** Tab title */
  title?: string;
  /** Process type */
  processType: ProcessType;
  /** CPU usage percentage (0-100) */
  cpuUsage: number;
  /** Memory usage in bytes */
  memoryBytes: number;
  /** Memory usage formatted string */
  memoryFormatted: string;
  /** Network bytes received */
  networkReceivedBytes: number;
  /** Network bytes sent */
  networkSentBytes: number;
  /** Network received formatted */
  networkReceivedFormatted: string;
  /** Network sent formatted */
  networkSentFormatted: string;
  /** Thread count */
  threadCount: number;
  /** Process state */
  state: ProcessState;
  /** Process start time (epoch ms) */
  startTime: number;
  /** Last updated timestamp */
  lastUpdated: number;
  /** Whether this process is a foreground (visible) process */
  isForeground: boolean;
}

export type ProcessType =
  | 'browser'
  | 'renderer'
  | 'gpu'
  | 'network'
  | 'utility'
  | 'extension'
  | 'worker'
  | 'plugin';

export type ProcessState = 'running' | 'suspended' | 'crashed' | 'killed';

export interface ResourceSnapshot {
  /** Snapshot timestamp */
  timestamp: number;
  /** Per-process resource usage */
  processes: ProcessResourceUsage[];
  /** Total memory usage across all processes */
  totalMemoryBytes: number;
  /** Total memory formatted */
  totalMemoryFormatted: string;
  /** Total CPU across all processes */
  totalCpuUsage: number;
  /** Total network received */
  totalNetworkReceivedBytes: number;
  /** Total network sent */
  totalNetworkSentBytes: number;
  /** System memory total (if available) */
  systemMemoryTotal?: number;
  /** System memory used (if available) */
  systemMemoryUsed?: number;
}

export interface TaskManagerEvent {
  type: 'process-added' | 'process-removed' | 'process-updated' | 'snapshot-taken' | 'process-killed';
  processId?: string;
  snapshot?: ResourceSnapshot;
}

export type TaskManagerEventHandler = (event: TaskManagerEvent) => void;

// ─────────────────────────────────────────────────────────────────────────────
// INTERFACE
// ─────────────────────────────────────────────────────────────────────────────

export interface ITaskManager extends ISharedService {
  /** Register a process for monitoring */
  registerProcess(info: ProcessRegistrationInfo): void;
  /** Unregister a process */
  unregisterProcess(processId: string): void;
  /** Get current resource usage for a specific process */
  getProcessUsage(processId: string): ProcessResourceUsage | undefined;
  /** Get all current process resource usages */
  getAllProcessUsages(): ProcessResourceUsage[];
  /** Take a snapshot of all resource usage */
  takeSnapshot(): ResourceSnapshot;
  /** Get all retained snapshots */
  getSnapshots(): ResourceSnapshot[];
  /** Clear all snapshots */
  clearSnapshots(): void;
  /** Kill a specific process */
  killProcess(processId: string): boolean;
  /** Get aggregated stats */
  getAggregateStats(): AggregateStats;
  /** Subscribe to events */
  onEvent(handler: TaskManagerEventHandler): () => void;
  /** Update resource metrics for a process (called by process monitors) */
  updateProcessMetrics(processId: string, metrics: Partial<ProcessResourceUsage>): void;
}

export interface ProcessRegistrationInfo {
  processId: string;
  tabId?: string;
  url?: string;
  title?: string;
  processType: ProcessType;
  isForeground?: boolean;
  /** Callback to kill the actual process */
  killCallback?: () => void | Promise<void>;
}

export interface AggregateStats {
  totalProcesses: number;
  totalMemoryBytes: number;
  totalMemoryFormatted: string;
  totalCpuUsage: number;
  totalNetworkReceivedBytes: number;
  totalNetworkSentBytes: number;
  processesByType: Record<ProcessType, number>;
  averageCpuPerProcess: number;
  peakMemoryBytes: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// IMPLEMENTATION
// ─────────────────────────────────────────────────────────────────────────────

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(Math.max(bytes, 1)) / Math.log(k));
  const idx = Math.min(i, sizes.length - 1);
  const value = bytes / Math.pow(k, idx);
  const formatted = value.toFixed(idx === 0 ? 0 : 1);
  return `${parseFloat(formatted)} ${sizes[idx]}`;
}

export class TaskManager implements ITaskManager {
  readonly name = 'task-manager';
  private processes = new Map<string, ProcessRegistrationInfo & { usage: ProcessResourceUsage; killCallback?: () => void | Promise<void> }>();
  private snapshots: ResourceSnapshot[] = [];
  private handlers: TaskManagerEventHandler[] = [];
  private sampleTimer: ReturnType<typeof setInterval> | null = null;
  private disposed = false;
  private initialized = false;

  constructor(private config: TaskManagerConfig) {}

  async initialize(): Promise<void> {
    if (this.initialized) return;
    this.initialized = true;
    this.sampleTimer = setInterval(() => {
      this.takeSnapshot();
    }, this.config.sampleIntervalMs);
  }

  async shutdown(): Promise<void> {
    if (this.sampleTimer) {
      clearInterval(this.sampleTimer);
      this.sampleTimer = null;
    }
    this.disposed = true;
  }

  registerProcess(info: ProcessRegistrationInfo): void {
    if (this.processes.has(info.processId)) return;

    const now = Date.now();
    const usage: ProcessResourceUsage = {
      processId: info.processId,
      tabId: info.tabId,
      url: info.url,
      title: info.title,
      processType: info.processType,
      cpuUsage: 0,
      memoryBytes: 0,
      memoryFormatted: '0 B',
      networkReceivedBytes: 0,
      networkSentBytes: 0,
      networkReceivedFormatted: '0 B',
      networkSentFormatted: '0 B',
      threadCount: 1,
      state: 'running',
      startTime: now,
      lastUpdated: now,
      isForeground: info.isForeground ?? true,
    };

    this.processes.set(info.processId, {
      ...info,
      usage,
      killCallback: info.killCallback,
    });

    this.emit({ type: 'process-added', processId: info.processId });
  }

  unregisterProcess(processId: string): void {
    if (!this.processes.has(processId)) return;
    this.processes.delete(processId);
    this.emit({ type: 'process-removed', processId });
  }

  getProcessUsage(processId: string): ProcessResourceUsage | undefined {
    const entry = this.processes.get(processId);
    return entry ? { ...entry.usage } : undefined;
  }

  getAllProcessUsages(): ProcessResourceUsage[] {
    const usages: ProcessResourceUsage[] = [];
    for (const entry of this.processes.values()) {
      usages.push({ ...entry.usage });
    }
    return usages.sort((a, b) => b.memoryBytes - a.memoryBytes);
  }

  takeSnapshot(): ResourceSnapshot {
    const processes = this.getAllProcessUsages();
    const totalMemory = processes.reduce((sum, p) => sum + p.memoryBytes, 0);
    const totalCpu = processes.reduce((sum, p) => sum + p.cpuUsage, 0);
    const totalNetRec = processes.reduce((sum, p) => sum + p.networkReceivedBytes, 0);
    const totalNetSent = processes.reduce((sum, p) => sum + p.networkSentBytes, 0);

    const snapshot: ResourceSnapshot = {
      timestamp: Date.now(),
      processes,
      totalMemoryBytes: totalMemory,
      totalMemoryFormatted: formatBytes(totalMemory),
      totalCpuUsage: totalCpu,
      totalNetworkReceivedBytes: totalNetRec,
      totalNetworkSentBytes: totalNetSent,
    };

    this.snapshots.push(snapshot);
    if (this.snapshots.length > this.config.maxSnapshots) {
      this.snapshots = this.snapshots.slice(-this.config.maxSnapshots);
    }

    this.emit({ type: 'snapshot-taken', snapshot });
    return snapshot;
  }

  getSnapshots(): ResourceSnapshot[] {
    return [...this.snapshots];
  }

  clearSnapshots(): void {
    this.snapshots = [];
  }

  killProcess(processId: string): boolean {
    const entry = this.processes.get(processId);
    if (!entry) return false;

    entry.usage.state = 'killed';
    if (entry.killCallback) {
      try { entry.killCallback(); } catch {}
    }
    this.emit({ type: 'process-killed', processId });
    return true;
  }

  updateProcessMetrics(processId: string, metrics: Partial<ProcessResourceUsage>): void {
    const entry = this.processes.get(processId);
    if (!entry) return;

    Object.assign(entry.usage, metrics, { lastUpdated: Date.now() });
    if (metrics.memoryBytes !== undefined) {
      entry.usage.memoryFormatted = formatBytes(metrics.memoryBytes);
    }
    if (metrics.networkReceivedBytes !== undefined) {
      entry.usage.networkReceivedFormatted = formatBytes(metrics.networkReceivedBytes);
    }
    if (metrics.networkSentBytes !== undefined) {
      entry.usage.networkSentFormatted = formatBytes(metrics.networkSentBytes);
    }
    this.emit({ type: 'process-updated', processId });
  }

  getAggregateStats(): AggregateStats {
    const processes = this.getAllProcessUsages();
    const byType = {} as Record<ProcessType, number>;
    for (const p of processes) {
      byType[p.processType] = (byType[p.processType] || 0) + 1;
    }

    const totalMemory = processes.reduce((sum, p) => sum + p.memoryBytes, 0);
    const totalCpu = processes.reduce((sum, p) => sum + p.cpuUsage, 0);
    const totalNetRec = processes.reduce((sum, p) => sum + p.networkReceivedBytes, 0);
    const totalNetSent = processes.reduce((sum, p) => sum + p.networkSentBytes, 0);

    const peakMemory = this.snapshots.length > 0
      ? Math.max(...this.snapshots.map(s => s.totalMemoryBytes))
      : totalMemory;

    return {
      totalProcesses: processes.length,
      totalMemoryBytes: totalMemory,
      totalMemoryFormatted: formatBytes(totalMemory),
      totalCpuUsage: totalCpu,
      totalNetworkReceivedBytes: totalNetRec,
      totalNetworkSentBytes: totalNetSent,
      processesByType: byType,
      averageCpuPerProcess: processes.length > 0 ? totalCpu / processes.length : 0,
      peakMemoryBytes: peakMemory,
    };
  }

  onEvent(handler: TaskManagerEventHandler): () => void {
    this.handlers.push(handler);
    return () => {
      const idx = this.handlers.indexOf(handler);
      if (idx >= 0) this.handlers.splice(idx, 1);
    };
  }

  private emit(event: TaskManagerEvent): void {
    for (const handler of this.handlers) {
      try { handler(event); } catch {}
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// DEFAULT CONFIG
// ─────────────────────────────────────────────────────────────────────────────

export const DEFAULT_TASK_MANAGER_CONFIG: TaskManagerConfig = {
  sampleIntervalMs: 5000,
  maxSnapshots: 120,
  includeGpu: true,
  includeNetwork: true,
};

export function createTaskManager(config?: Partial<TaskManagerConfig>): TaskManager {
  return new TaskManager({ ...DEFAULT_TASK_MANAGER_CONFIG, ...config });
}
