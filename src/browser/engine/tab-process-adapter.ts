/**
 * @file src/browser/engine/tab-process-adapter.ts
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * RESPONSIBILITY
 * ─────────────────────────────────────────────────────────────────────────────
 * Bridge TabContextManager and ProcessManager so that:
 *
 *   1. Creating a TabContext automatically spawns a renderer process.
 *   2. Destroying a TabContext automatically destroys its process.
 *   3. Process crash events propagate to the corresponding TabContext.
 *   4. TabContext crash events propagate to the ProcessManager for restart logic.
 *   5. Provides a unified API for tab+process lifecycle.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * OOP PRINCIPLES
 *  Abstraction      ITabProcessManager is the unified contract.
 *  Encapsulation    Internal maps and wiring are private.
 *  Single-Resp.     This adapter only bridges tab and process lifecycles.
 *  Open / Closed    TabContextManager and ProcessManager are unmodified.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import type { IDisposable } from '../../../app/dependency-container';
import type { ITabContextManager, TabContext, TabContextConfig, TabCrashInfo } from './tab-context';
import { TabContextManager, TabContextState } from './tab-context';
import type { IProcessManager, ProcessInfo, ProcessBusEvent } from '../../common/ipc/process-manager';
import { ProcessState } from '../../common/ipc/process-manager';

// ─────────────────────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────────────────────

/** Configuration for the tab-process adapter. */
interface TabProcessAdapterConfig {
  /** Whether to automatically spawn processes when creating tab contexts. */
  readonly autoSpawnProcess: boolean;
  /** Whether to automatically destroy processes when destroying tab contexts. */
  readonly autoDestroyProcess: boolean;
  /** Whether to forward process crash events to tab contexts. */
  readonly forwardProcessCrashes: boolean;
  /** Whether to forward tab crash events to the process manager. */
  readonly forwardTabCrashes: boolean;
}

const DEFAULT_ADAPTER_CONFIG: TabProcessAdapterConfig = {
  autoSpawnProcess: true,
  autoDestroyProcess: true,
  forwardProcessCrashes: true,
  forwardTabCrashes: true,
};

/** Mapping between a tab context and its associated process. */
interface TabProcessBinding {
  readonly tabId: string;
  readonly processId: string;
}

/** Unified event for tab-process lifecycle changes. */
type TabProcessEventType =
  | 'tabProcessCreated'
  | 'tabProcessDestroyed'
  | 'tabProcessCrashed'
  | 'tabProcessRecovered';

interface TabProcessEvent {
  readonly kind: TabProcessEventType;
  readonly tabId: string;
  readonly processId: string;
}

interface TabProcessCrashedEvent extends TabProcessEvent {
  readonly kind: 'tabProcessCrashed';
  readonly error: Error;
  readonly phase: TabCrashInfo['phase'];
}

interface TabProcessRecoveredEvent extends TabProcessEvent {
  readonly kind: 'tabProcessRecovered';
  readonly attempt: number;
}

type TabProcessBusEvent = TabProcessEvent | TabProcessCrashedEvent | TabProcessRecoveredEvent;
type TabProcessEventHandler = (event: TabProcessBusEvent) => void;

// ─────────────────────────────────────────────────────────────────────────────
// EVENT BUS
// ─────────────────────────────────────────────────────────────────────────────

class TabProcessEventBus {
  private readonly channels = new Map<TabProcessEventType, Set<TabProcessEventHandler>>();

  on(type: TabProcessEventType, handler: TabProcessEventHandler): void {
    if (!this.channels.has(type)) this.channels.set(type, new Set());
    this.channels.get(type)!.add(handler);
  }

  off(type: TabProcessEventType, handler: TabProcessEventHandler): void {
    this.channels.get(type)?.delete(handler);
  }

  emit(event: TabProcessBusEvent): void {
    const handlers = this.channels.get(event.kind);
    if (!handlers) return;
    for (const h of handlers) {
      try { h(event); } catch (err) {
        console.error(`[TabProcessEventBus] Handler threw on "${event.kind}":`, err);
      }
    }
  }

  dispose(): void { this.channels.clear(); }
}

// ─────────────────────────────────────────────────────────────────────────────
// PUBLIC CONTRACT
// ─────────────────────────────────────────────────────────────────────────────

interface ITabProcessManager extends IDisposable {
  /** Create a tab context and spawn its associated process. */
  createTab(config?: Partial<TabContextConfig>): { tab: TabContext; processId: string };
  /** Get the process ID for a tab context. */
  getProcessForTab(tabId: string): string | null;
  /** Get the tab context for a process ID. */
  getTabForProcess(processId: string): TabContext | null;
  /** Destroy a tab and its associated process. */
  destroyTab(tabId: string): boolean;
  /** Get all tab-process bindings. */
  getBindings(): readonly TabProcessBinding[];
  /** Subscribe to lifecycle events. */
  on(type: TabProcessEventType, handler: TabProcessEventHandler): void;
  off(type: TabProcessEventType, handler: TabProcessEventHandler): void;
}

// ─────────────────────────────────────────────────────────────────────────────
// IMPLEMENTATION
// ─────────────────────────────────────────────────────────────────────────────

class TabProcessManager implements ITabProcessManager {
  private readonly tabManager: ITabContextManager;
  private readonly processManager: IProcessManager;
  private readonly config: TabProcessAdapterConfig;
  private readonly bus = new TabProcessEventBus();

  /** tabId → processId */
  private readonly tabToProcess = new Map<string, string>();
  /** processId → tabId */
  private readonly processToTab = new Map<string, string>();

  /** Bound event handlers (stored for cleanup). */
  private readonly processCrashHandler: (event: ProcessBusEvent) => void;
  private readonly processExitHandler: (event: ProcessBusEvent) => void;

  constructor(
    processManager: IProcessManager,
    tabManager?: ITabContextManager,
    config?: Partial<TabProcessAdapterConfig>,
  ) {
    this.tabManager = tabManager ?? new TabContextManager();
    this.processManager = processManager;
    this.config = { ...DEFAULT_ADAPTER_CONFIG, ...config };

    // Bind process → tab event forwarding
    this.processCrashHandler = (event) => this.handleProcessCrash(event);
    this.processExitHandler = (event) => this.handleProcessExit(event);

    this.processManager.on('processCrashed', this.processCrashHandler);
    this.processManager.on('processExited', this.processExitHandler);
  }

  // ── ITabProcessManager ────────────────────────────────────────────────

  async createTab(config?: Partial<TabContextConfig>): Promise<{ tab: TabContext; processId: string }> {
    const tab = this.tabManager.createContext(config);

    let processId: string | null = null;
    if (this.config.autoSpawnProcess) {
      processId = await this.processManager.spawnProcess(tab.id);
      this.tabToProcess.set(tab.id, processId);
      this.processToTab.set(processId, tab.id);
    }

    this.bus.emit({
      kind: 'tabProcessCreated',
      tabId: tab.id,
      processId: processId ?? 'none',
    });

    return { tab, processId: processId ?? 'none' };
  }

  getProcessForTab(tabId: string): string | null {
    return this.tabToProcess.get(tabId) ?? null;
  }

  getTabForProcess(processId: string): TabContext | null {
    const tabId = this.processToTab.get(processId);
    return tabId ? this.tabManager.getContext(tabId) : null;
  }

  destroyTab(tabId: string): boolean {
    const processId = this.tabToProcess.get(tabId);

    // Destroy the process first if configured
    if (processId && this.config.autoDestroyProcess) {
      this.processManager.destroyProcess(processId).catch(() => {});
      this.processToTab.delete(processId);
    }

    this.tabToProcess.delete(tabId);

    const result = this.tabManager.destroyContext(tabId);

    if (result) {
      this.bus.emit({
        kind: 'tabProcessDestroyed',
        tabId,
        processId: processId ?? 'none',
      });
    }

    return result;
  }

  getBindings(): readonly TabProcessBinding[] {
    return [...this.tabToProcess.entries()].map(([tabId, processId]) => ({ tabId, processId }));
  }

  on(type: TabProcessEventType, handler: TabProcessEventHandler): void {
    this.bus.on(type, handler);
  }

  off(type: TabProcessEventType, handler: TabProcessEventHandler): void {
    this.bus.off(type, handler);
  }

  dispose(): void {
    // Remove event listeners from process manager
    this.processManager.off('processCrashed', this.processCrashHandler);
    this.processManager.off('processExited', this.processExitHandler);

    // Destroy all tabs and processes
    for (const tabId of [...this.tabToProcess.keys()]) {
      this.destroyTab(tabId);
    }

    this.tabToProcess.clear();
    this.processToTab.clear();
    this.bus.dispose();
  }

  // ── Private: Process → Tab event forwarding ───────────────────────────

  private handleProcessCrash(event: ProcessBusEvent): void {
    if (!this.config.forwardProcessCrashes) return;
    if (event.kind !== 'processCrashed') return;

    const tabId = this.processToTab.get(event.processId);
    if (!tabId) return;

    const tab = this.tabManager.getContext(tabId);
    if (!tab) return;

    // Forward the crash to the tab context
    tab.crash(event.error, 'script', '');

    this.bus.emit({
      kind: 'tabProcessCrashed',
      tabId,
      processId: event.processId,
      error: event.error,
      phase: 'script',
    });
  }

  private handleProcessExit(event: ProcessBusEvent): void {
    if (event.kind !== 'processExited') return;

    const tabId = this.processToTab.get(event.processId);
    if (!tabId) return;

    this.processToTab.delete(event.processId);
    this.tabToProcess.delete(tabId);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// CONVENIENCE: Create a fully-wired TabProcessManager
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Create a TabProcessManager with default in-process transport.
 * This is the easiest way to get a fully-wired tab+process system.
 */
async function createTabProcessManager(
  config?: Partial<TabProcessAdapterConfig> & { processConfig?: any },
): Promise<TabProcessManager> {
  // Dynamic import to avoid circular dependency at module level
  const { createInProcessManager } = await import('../../common/ipc/process-manager');
  const { manager: processManager } = createInProcessManager(config?.processConfig);

  return new TabProcessManager(processManager, undefined, config);
}

/**
 * Create a TabProcessManager with child-process transport.
 * Each tab will get its own Node.js child process.
 * 
 * @param entryPath Path to the renderer entry script
 * @param config Optional configuration
 */
async function createChildProcessTabManager(
  entryPath: string,
  config?: Partial<TabProcessAdapterConfig> & { processConfig?: any },
): Promise<TabProcessManager> {
  const { createChildProcessManager } = await import('../../common/ipc/process-manager');
  const { manager: processManager } = createChildProcessManager(entryPath, config?.processConfig);

  return new TabProcessManager(processManager, undefined, config);
}

// ─────────────────────────────────────────────────────────────────────────────
// EXPORTS
// ─────────────────────────────────────────────────────────────────────────────

export {
  TabProcessManager,
  TabProcessEventBus,
  createTabProcessManager,
  createChildProcessTabManager,
  DEFAULT_ADAPTER_CONFIG,
};

export type {
  ITabProcessManager,
  TabProcessAdapterConfig,
  TabProcessBinding,
  TabProcessEvent,
  TabProcessCrashedEvent,
  TabProcessRecoveredEvent,
  TabProcessBusEvent,
  TabProcessEventHandler,
  TabProcessEventType,
};
