/**
 * @file src/common/ipc/process-manager.ts
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * RESPONSIBILITY
 * ─────────────────────────────────────────────────────────────────────────────
 * Manages the lifecycle of renderer processes. Each tab gets its own process.
 * ProcessManager handles:
 *
 *   • Spawning new renderer processes
 *   • Tracking process state (starting, ready, crashed, exited)
 *   • Routing IPC messages to the correct process
 *   • Automatic restart on crash (with backoff)
 *   • Graceful shutdown with timeout
 *
 * In Node.js, renderer processes are child_process.fork() workers.
 * In a browser, they would be Web Workers or iframes.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * OOP PRINCIPLES
 *  Abstraction      IProcessManager hides platform-specific process spawning.
 *  Encapsulation    Process handles, timers, and state maps are private.
 *  Single-Resp.     Manager only spawns/tracks/destroys — nothing else.
 *  Open / Closed    New process types are added via ProcessFactory, not editing.
 */

import type { IDisposable } from '../../app/dependency-container';
import { type ITransport } from './transport';
import { ChannelManager, type IChannelManager } from './channel';
import { ServiceProxy, type IServiceProxy, type ServiceProxyConfig, createTypedProxy } from './service-proxy';
import type { IChannel } from './channel';

// ─────────────────────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────────────────────

/** The operational state of a managed process. */
enum ProcessState {
  /** Process is being spawned. */
  Starting  = 'starting',
  /** Process is running and ready. */
  Ready     = 'ready',
  /** Process crashed and is restarting. */
  Restarting = 'restarting',
  /** Process exited voluntarily. */
  Exited    = 'exited',
  /** Process was forcibly killed. */
  Killed    = 'killed',
}

/** Information about a managed process. */
interface ProcessInfo {
  /** Unique process ID. */
  readonly id: string;
  /** The tab ID this process serves (if any). */
  readonly tabId?: string;
  /** Current state. */
  readonly state: ProcessState;
  /** When the process was spawned. */
  readonly spawnedAt: number;
  /** When the process last became ready. */
  readonly readyAt: number;
  /** Number of times this process has crashed. */
  readonly crashCount: number;
  /** The transport connecting to this process. */
  readonly transport: ITransport;
  /** The channel manager for this process. */
  readonly channelManager: IChannelManager;
}

/** Mutable internal process info (for state transitions). */
interface MutableProcessInfo extends ProcessInfo {
  state: ProcessState;
  readyAt: number;
  crashCount: number;
  transport: ITransport;
  channelManager: IChannelManager;
}

/** Configuration for the process manager. */
interface ProcessManagerConfig {
  /** Maximum number of concurrent processes. */
  readonly maxProcesses: number;
  /** Timeout in ms for a process to become ready. */
  readonly spawnTimeoutMs: number;
  /** Timeout in ms for graceful shutdown. */
  readonly shutdownTimeoutMs: number;
  /** Maximum automatic restarts before giving up. */
  readonly maxRestarts: number;
  /** Base delay in ms for restart backoff. */
  readonly restartBackoffMs: number;
  /** Maximum delay in ms for restart backoff. */
  readonly restartMaxBackoffMs: number;
}

const DEFAULT_PROCESS_MANAGER_CONFIG: ProcessManagerConfig = {
  maxProcesses: 16,
  spawnTimeoutMs: 30_000,
  shutdownTimeoutMs: 10_000,
  maxRestarts: 3,
  restartBackoffMs: 1_000,
  restartMaxBackoffMs: 30_000,
};

/** A factory function that spawns a process and returns its IPC transport. */
type ProcessFactory = (processId: string, tabId?: string) => Promise<ITransport>;

// ─────────────────────────────────────────────────────────────────────────────
// EVENTS
// ─────────────────────────────────────────────────────────────────────────────

type ProcessEventType = 'processSpawned' | 'processReady' | 'processCrashed' | 'processExited' | 'processRestarted';

interface ProcessEvent {
  readonly kind: ProcessEventType;
  readonly processId: string;
  readonly tabId?: string;
}

interface ProcessSpawnedEvent extends ProcessEvent {
  readonly kind: 'processSpawned';
}

interface ProcessReadyEvent extends ProcessEvent {
  readonly kind: 'processReady';
}

interface ProcessCrashedEvent extends ProcessEvent {
  readonly kind: 'processCrashed';
  readonly error: Error;
  readonly crashCount: number;
}

interface ProcessExitedEvent extends ProcessEvent {
  readonly kind: 'processExited';
  readonly exitCode: number;
}

interface ProcessRestartedEvent extends ProcessEvent {
  readonly kind: 'processRestarted';
  readonly attempt: number;
}

type ProcessBusEvent = ProcessSpawnedEvent | ProcessReadyEvent | ProcessCrashedEvent | ProcessExitedEvent | ProcessRestartedEvent;

type ProcessEventHandler = (event: ProcessBusEvent) => void;

// ─────────────────────────────────────────────────────────────────────────────
// EVENT BUS
// ─────────────────────────────────────────────────────────────────────────────

class ProcessEventBus {
  private readonly channels = new Map<ProcessEventType, Set<ProcessEventHandler>>();

  on(type: ProcessEventType, handler: ProcessEventHandler): void {
    if (!this.channels.has(type)) this.channels.set(type, new Set());
    this.channels.get(type)!.add(handler);
  }

  off(type: ProcessEventType, handler: ProcessEventHandler): void {
    this.channels.get(type)?.delete(handler);
  }

  emit(event: ProcessBusEvent): void {
    const handlers = this.channels.get(event.kind);
    if (!handlers) return;
    for (const h of handlers) {
      try { h(event); } catch (err) {
        console.error(`[ProcessEventBus] Handler threw on "${event.kind}":`, err);
      }
    }
  }

  dispose(): void { this.channels.clear(); }
}

// ─────────────────────────────────────────────────────────────────────────────
// PUBLIC CONTRACT
// ─────────────────────────────────────────────────────────────────────────────

interface IProcessManager extends IDisposable {
  /** Spawn a new renderer process. Returns the process ID. */
  spawnProcess(tabId?: string): Promise<string>;
  /** Destroy a process by ID. */
  destroyProcess(processId: string): Promise<boolean>;
  /** Get info about a process. */
  getProcess(processId: string): ProcessInfo | null;
  /** Get all managed processes. */
  getAllProcesses(): readonly ProcessInfo[];
  /** Get processes for a specific tab. */
  getProcessForTab(tabId: string): ProcessInfo | null;
  /** Create a service proxy for a remote service on a process. */
  createProxy<T extends Record<string, (...args: any[]) => any>>(
    processId: string,
    serviceName: string,
    channelName: string,
    config?: Partial<ServiceProxyConfig>,
  ): T & IServiceProxy;
  /** Subscribe to process events. */
  on(type: ProcessEventType, handler: ProcessEventHandler): void;
  off(type: ProcessEventType, handler: ProcessEventHandler): void;
}

// ─────────────────────────────────────────────────────────────────────────────
// IMPLEMENTATION
// ─────────────────────────────────────────────────────────────────────────────

let _processSeq = 0;

class ProcessManager implements IProcessManager {
  private readonly _config: ProcessManagerConfig;
  private readonly _factory: ProcessFactory;
  private readonly _processes = new Map<string, MutableProcessInfo>();
  private readonly _tabToProcess = new Map<string, string>();
  private readonly _bus = new ProcessEventBus();
  private readonly _restartTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly _crashCounts = new Map<string, number>();
  private readonly _heartbeatTimers = new Map<string, ReturnType<typeof setInterval>>();
  private readonly _heartbeatMisses = new Map<string, number>();

  constructor(factory: ProcessFactory, config?: Partial<ProcessManagerConfig>) {
    this._config = { ...DEFAULT_PROCESS_MANAGER_CONFIG, ...config };
    this._factory = factory;
  }

  async spawnProcess(tabId?: string): Promise<string> {
    if (this._processes.size >= this._config.maxProcesses) {
      throw new Error(`Maximum process limit reached: ${this._config.maxProcesses}`);
    }

    const processId = `proc-${Date.now().toString(36)}-${(++_processSeq).toString(36)}`;

    // Spawn the transport
    const transport = await this._factory(processId, tabId);

    // Create channel manager
    const channelManager = new ChannelManager(transport, processId);
    channelManager.activateAll();

    const info: MutableProcessInfo = {
      id: processId,
      tabId,
      state: ProcessState.Starting,
      spawnedAt: Date.now(),
      readyAt: 0,
      crashCount: 0,
      transport,
      channelManager,
    };

    this._processes.set(processId, info);
    if (tabId) {
      this._tabToProcess.set(tabId, processId);
    }

    this._bus.emit({ kind: 'processSpawned', processId, tabId });

    // Listen for crash/exit on transport
    this._setupCrashDetection(info);

    // Wait for readiness with timeout
    try {
      await this._waitForReady(transport, processId);
      info.state = ProcessState.Ready;
      info.readyAt = Date.now();
      this._bus.emit({ kind: 'processReady', processId, tabId });
      this._startHeartbeat(info);
    } catch (err) {
      // Process didn't become ready — mark as crashed
      info.state = ProcessState.Exited;
      this._bus.emit({ kind: 'processCrashed', processId, tabId, error: err instanceof Error ? err : new Error(String(err)), crashCount: 1 });
    }

    return processId;
  }

  /**
   * Wait for a PROCESS_READY message from the child, with timeout.
   */
  private _waitForReady(transport: ITransport, processId: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        transport.offData(handler);
        reject(new Error(`Process ${processId} did not become ready within ${this._config.spawnTimeoutMs}ms`));
      }, this._config.spawnTimeoutMs);

      const handler = (data: string) => {
        try {
          const msg = JSON.parse(data);
          if (msg.type === 'process-ready' && msg.processId === processId) {
            clearTimeout(timeout);
            transport.offData(handler);
            resolve();
          }
        } catch {
          // Not a JSON message or not a ready signal — ignore
        }
      };
      transport.onData(handler);
    });
  }

  /**
   * Set up crash detection on a process's transport.
   */
  private _setupCrashDetection(info: ProcessInfo): void {
    const onClose = () => {
      if (info.state === ProcessState.Killed || info.state === ProcessState.Exited) return;
      this._handleCrash(info);
    };
    info.transport.onClose(onClose);
  }

  /**
   * Handle a process crash — increment crash count, emit event, optionally restart.
   */
  private _handleCrash(info: MutableProcessInfo): void {
    const crashCount = (this._crashCounts.get(info.id) ?? 0) + 1;
    this._crashCounts.set(info.id, crashCount);
    info.crashCount = crashCount;
    this._stopHeartbeat(info);

    const error = new Error(`Process ${info.id} crashed (attempt ${crashCount})`);

    info.state = ProcessState.Exited;
    this._bus.emit({
      kind: 'processCrashed',
      processId: info.id,
      tabId: info.tabId,
      error,
      crashCount,
    });

    // Auto-restart if under the limit
    if (crashCount <= this._config.maxRestarts) {
      const backoff = Math.min(
        this._config.restartBackoffMs * Math.pow(2, crashCount - 1),
        this._config.restartMaxBackoffMs,
      );
      this._scheduleRestart(info, backoff);
    } else {
      // Give up — emit exited
      if (info.tabId) {
        this._tabToProcess.delete(info.tabId);
      }
      this._bus.emit({ kind: 'processExited', processId: info.id, tabId: info.tabId, exitCode: 1 });
    }
  }

  /**
   * Schedule a process restart after a backoff delay.
   */
  private _scheduleRestart(info: MutableProcessInfo, delayMs: number): void {
    info.state = ProcessState.Restarting;

    const timer = setTimeout(async () => {
      this._restartTimers.delete(info.id);
      const attempt = this._crashCounts.get(info.id) ?? 1;

      this._bus.emit({
        kind: 'processRestarted',
        processId: info.id,
        tabId: info.tabId,
        attempt,
      });

      // Clean up old transport
      info.channelManager.dispose();
      info.transport.dispose();

      try {
        // Re-spawn
        const newTransport = await this._factory(info.id, info.tabId);
        const newChannelManager = new ChannelManager(newTransport, info.id);
        newChannelManager.activateAll();

        info.transport = newTransport;
        info.channelManager = newChannelManager;
        info.state = ProcessState.Starting;

        this._setupCrashDetection(info);

        await this._waitForReady(newTransport, info.id);
        info.state = ProcessState.Ready;
        info.readyAt = Date.now();
        this._bus.emit({ kind: 'processReady', processId: info.id, tabId: info.tabId });
        this._startHeartbeat(info);
      } catch (err) {
        this._handleCrash(info);
      }
    }, delayMs);

    this._restartTimers.set(info.id, timer);
  }

  async destroyProcess(processId: string): Promise<boolean> {
    const info = this._processes.get(processId);
    if (!info) return false;

    // Clear any pending restart timer
    const timer = this._restartTimers.get(processId);
    if (timer) {
      clearTimeout(timer);
      this._restartTimers.delete(processId);
    }

    // Reset crash count on intentional destroy
    this._crashCounts.delete(processId);

    // Graceful shutdown with timeout
    try {
      await Promise.race([
        info.transport.disconnect(),
        new Promise<void>((_, reject) =>
          setTimeout(() => reject(new Error('Shutdown timeout')), this._config.shutdownTimeoutMs),
        ),
      ]);
    } catch {
      // Force kill on timeout
    }

    info.channelManager.dispose();
    info.transport.dispose();
    info.state = ProcessState.Killed;
    this._stopHeartbeat(info);

    if (info.tabId) {
      this._tabToProcess.delete(info.tabId);
    }

    this._bus.emit({ kind: 'processExited', processId, tabId: info.tabId, exitCode: 1 });
    this._processes.delete(processId);
    return true;
  }

  getProcess(processId: string): ProcessInfo | null {
    return this._processes.get(processId) ?? null;
  }

  getAllProcesses(): readonly ProcessInfo[] {
    return [...this._processes.values()];
  }

  getProcessForTab(tabId: string): ProcessInfo | null {
    const processId = this._tabToProcess.get(tabId);
    return processId ? this._processes.get(processId) ?? null : null;
  }

  createProxy<T extends Record<string, (...args: any[]) => any>>(
    processId: string,
    serviceName: string,
    channelName: string,
    config?: Partial<ServiceProxyConfig>,
  ): T & IServiceProxy {
    const info = this._processes.get(processId);
    if (!info) throw new Error(`Process ${processId} not found`);

    const channel = info.channelManager.getChannel(channelName);
    return createTypedProxy<T>(channel, serviceName, config);
  }

  on(type: ProcessEventType, handler: ProcessEventHandler): void {
    this._bus.on(type, handler);
  }

  off(type: ProcessEventType, handler: ProcessEventHandler): void {
    this._bus.off(type, handler);
  }

  // ── Heartbeat ───────────────────────────────────────────────────────────

  private static readonly HEARTBEAT_INTERVAL_MS = 15_000;
  private static readonly HEARTBEAT_TIMEOUT_MS = 45_000;
  private static readonly MAX_MISSED_HEARTBEATS = 3;

  private _startHeartbeat(info: MutableProcessInfo): void {
    this._stopHeartbeat(info);

    const channel = info.channelManager.getChannel('__heartbeat__');
    if (!channel.active) channel.activate();

    // Respond to incoming heartbeats
    channel.onMessage<{ type: string }>((payload) => {
      if (payload && typeof payload === 'object' && 'type' in payload && (payload as any).type === 'ping') {
        this._heartbeatMisses.set(info.id, 0);
        channel.send({ type: 'pong', processId: info.id }).catch(() => {});
      }
    });

    // Send periodic pings
    const timer = setInterval(async () => {
      try {
        const misses = (this._heartbeatMisses.get(info.id) ?? 0) + 1;
        this._heartbeatMisses.set(info.id, misses);

        if (misses >= ProcessManager.MAX_MISSED_HEARTBEATS) {
          this._stopHeartbeat(info);
          this._handleCrash(info);
          return;
        }

        await channel.send({ type: 'ping', processId: info.id });
      } catch {
        // Transport error — heartbeat failure will be caught by miss count
      }
    }, ProcessManager.HEARTBEAT_INTERVAL_MS);

    this._heartbeatTimers.set(info.id, timer);
  }

  private _stopHeartbeat(info: MutableProcessInfo): void {
    const timer = this._heartbeatTimers.get(info.id);
    if (timer) {
      clearInterval(timer);
      this._heartbeatTimers.delete(info.id);
    }
    this._heartbeatMisses.delete(info.id);
  }

  // ── IDisposable ───────────────────────────────────────────────────────────

  dispose(): void {
    // Stop all heartbeats
    for (const timer of this._heartbeatTimers.values()) {
      clearInterval(timer);
    }
    this._heartbeatTimers.clear();
    this._heartbeatMisses.clear();

    // Clear all restart timers
    for (const timer of this._restartTimers.values()) {
      clearTimeout(timer);
    }
    this._restartTimers.clear();
    this._crashCounts.clear();

    // Destroy all processes
    for (const info of this._processes.values()) {
      info.channelManager.dispose();
      info.transport.dispose();
    }
    this._processes.clear();
    this._tabToProcess.clear();
    this._bus.dispose();
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// IN-PROCESS FACTORY
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Create a ProcessManager that uses InProcessTransport.
 * Useful for testing and monolith mode where all "processes" run in the
 * same JS context.
 *
 * Returns both the manager and a way to get the remote-side transport
 * for each process (for wiring the simulated child process side).
 */
function createInProcessManager(config?: Partial<ProcessManagerConfig>): {
  manager: ProcessManager;
  getProcessTransport: (processId: string) => ITransport | null;
  getChildTransport: (processId: string) => ITransport | null;
} {
  const mainTransports = new Map<string, ITransport>();
  const childTransports = new Map<string, ITransport>();

  const factory: ProcessFactory = async (processId) => {
    const { createInProcessPair } = await import('./transport');
    const [mainSide, childSide] = createInProcessPair(
      { localId: 'main', remoteId: processId },
      { localId: processId, remoteId: 'main' },
    );
    await mainSide.connect();
    await childSide.connect();
    mainTransports.set(processId, mainSide);
    childTransports.set(processId, childSide);

    // Simulate child sending PROCESS_READY signal.
    // Must be async so the manager's _waitForReady handler can register first.
    const readyMsg = JSON.stringify({ type: 'process-ready', processId });
    setTimeout(() => { childSide.send(readyMsg).catch(() => {}); }, 0);

    return mainSide;
  };

  const manager = new ProcessManager(factory, config);

  return {
    manager,
    getProcessTransport: (processId: string) => mainTransports.get(processId) ?? null,
    getChildTransport: (processId: string) => childTransports.get(processId) ?? null,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// CHILD-PROCESS FACTORY
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Create a ProcessManager that uses real child_process.fork().
 * Each "process" is an actual Node.js child process.
 *
 * @param entryPath Path to the renderer entry script
 * @param config Optional process manager configuration
 */
function createChildProcessManager(
  entryPath: string,
  config?: Partial<ProcessManagerConfig>
): {
  manager: ProcessManager;
  getProcessTransport: (processId: string) => ITransport | null;
} {
  const transports = new Map<string, ITransport>();

  const factory: ProcessFactory = async (processId) => {
    const { ChildProcessTransport } = await import('./child-process-transport');
    const transport = ChildProcessTransport.fork(entryPath, [], {
      env: { ...process.env, NOVA_PROCESS_ID: processId },
    });
    await transport.connect();
    transports.set(processId, transport);
    return transport;
  };

  const manager = new ProcessManager(factory, config);

  return {
    manager,
    getProcessTransport: (processId: string) => transports.get(processId) ?? null,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// EXPORTS
// ─────────────────────────────────────────────────────────────────────────────

export {
  ProcessManager,
  ProcessEventBus,
  ProcessState,
  createInProcessManager,
  createChildProcessManager,
  DEFAULT_PROCESS_MANAGER_CONFIG,
};

export type {
  IProcessManager,
  ProcessManagerConfig,
  ProcessInfo,
  ProcessFactory,
  ProcessEvent,
  ProcessBusEvent,
  ProcessEventHandler,
  ProcessEventType,
};
