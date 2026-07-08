/**
 * @file src/browser/engine/lifecycle-manager.ts
 * @session 6
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * RESPONSIBILITY
 * ─────────────────────────────────────────────────────────────────────────────
 * LifecycleManager is the single authority over the browser's operational
 * state.  It sequences every subsystem through a defined start/stop order,
 * enforces per-phase timeouts, and coordinates graceful shutdown.
 *
 *   Idle ──start()──▶ Starting ──all phases pass──▶ Running
 *                                                       │
 *                        Crashed ◀──critical failure────┤
 *                                                       │
 *                      Suspending ◀──suspend()──────────┤
 *                          │                            │
 *                       Suspended ──resume()──▶ Starting (again)
 *                                                       │
 *                       Stopping ◀──stop()─────────────┘
 *                          │
 *                       Stopped
 *
 * Startup phases are registered externally via registerPhase() so that
 * each browser subsystem owns its own initialization without this file
 * needing to import every concrete module (Open/Closed principle).
 *
 * Default phases wired at construction time:
 *   order  10 — validate-config
 *   order  50 — initialize-engine      (calls IBrowserEngine.initialize)
 *   order 100 — health-check           (verifies engine is navigable)
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * OOP PRINCIPLES
 * ─────────────────────────────────────────────────────────────────────────────
 *  Abstraction      ILifecycleManager is the only type callers depend on.
 *  Encapsulation    Phase registry, observer list, timer handles, and the
 *                   start-time counter are all private.
 *  Single-Resp.     LifecycleManager sequences; it never fetches, renders,
 *                   or stores anything itself.
 *  Open / Closed    New startup steps are added via registerPhase() with a
 *                   numeric order — the class is never edited.
 *  Dependency-Inv.  Constructor receives IBrowserEngine and AppConfig;
 *                   never imports concrete networking or rendering classes.
 *  Interface-Seg.   ILifecycleObserver methods are all optional so observers
 *                   implement only the hooks they need.
 */

import type { ISharedService, AppConfig } from '../../app/app-shell';
import type { IBrowserEngine }             from './browser-engine';

// ─────────────────────────────────────────────────────────────────────────────
// LIFECYCLE STATE
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The complete set of states the browser process can occupy.
 *
 * Valid transitions
 * ─────────────────
 *   Idle        → Starting
 *   Starting    → Running | Crashed
 *   Running     → Suspending | Stopping
 *   Suspending  → Suspended | Crashed
 *   Suspended   → Starting  | Stopping
 *   Stopping    → Stopped
 *   Stopped     → Starting              (restart)
 *   Crashed     → Starting              (recovery restart)
 */
enum LifecycleState {
  Idle       = 'idle',
  Starting   = 'starting',
  Running    = 'running',
  Suspending = 'suspending',
  Suspended  = 'suspended',
  Stopping   = 'stopping',
  Stopped    = 'stopped',
  Crashed    = 'crashed',
}

// ─────────────────────────────────────────────────────────────────────────────
// PHASE DESCRIPTOR
// ─────────────────────────────────────────────────────────────────────────────

/**
 * A single named step in the startup (or shutdown) sequence.
 *
 * Phases are sorted by `order` (ascending) before execution.
 * Two phases with equal order run in registration order (stable sort).
 */
interface LifecyclePhase {
  /** Short, kebab-case name — shown in logs and events. */
  readonly name: string;
  /** Lower numbers run first during startup (and last during shutdown). */
  readonly order: number;
  /**
   * Maximum milliseconds allowed before the phase is considered hung.
   * Default is 5 000 ms when not specified.
   */
  readonly timeoutMs: number;
  /**
   * When true, failure of this phase transitions the manager to Crashed.
   * Non-critical failures are logged and skipped.
   */
  readonly critical: boolean;
  /** The async work to perform during startup. */
  readonly startup: () => Promise<void>;
  /**
   * The async work to perform during shutdown.
   * When absent, shutdown for this phase is a no-op.
   */
  readonly shutdown?: () => Promise<void>;
}

// ─────────────────────────────────────────────────────────────────────────────
// OBSERVER
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Observer that receives callbacks at key lifecycle moments.
 * All methods are optional — implement only the hooks you need.
 *
 * Example uses
 * ─────────────
 *   • Telemetry service: record startup/shutdown duration.
 *   • DevTools: disable the debugger when the engine suspends.
 *   • Platform layer: show a splash screen during startup.
 */
interface ILifecycleObserver {
  /** Identifier for diagnostic messages. */
  readonly name: string;
  /** Called before the first startup phase runs. */
  onBeforeStart?(): Promise<void>;
  /** Called after all startup phases succeed and state = Running. */
  onAfterStart?(): Promise<void>;
  /** Called before the first shutdown phase runs. */
  onBeforeStop?(): Promise<void>;
  /** Called after all shutdown phases finish and state = Stopped. */
  onAfterStop?(): Promise<void>;
  /** Called before the suspend sequence begins. */
  onSuspend?(): Promise<void>;
  /** Called before the resume sequence begins. */
  onResume?(): Promise<void>;
  /** Called when a critical phase fails and state transitions to Crashed. */
  onCrash?(error: Error): Promise<void>;
}

// ─────────────────────────────────────────────────────────────────────────────
// PHASE RESULT
// ─────────────────────────────────────────────────────────────────────────────

/** The outcome of running a single lifecycle phase. */
interface PhaseResult {
  readonly phase: string;
  readonly success: boolean;
  readonly durationMs: number;
  readonly error?: Error;
  readonly timedOut: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// EVENTS
// ─────────────────────────────────────────────────────────────────────────────

type LifecycleEventType =
  | 'stateChanged'
  | 'phaseStarted'
  | 'phaseCompleted'
  | 'phaseFailed'
  | 'crashed'
  | 'recovered';

interface StateChangedEvent  { kind: 'stateChanged';    from: LifecycleState; to: LifecycleState }
interface PhaseStartedEvent  { kind: 'phaseStarted';    phase: string; order: number }
interface PhaseCompletedEvent{ kind: 'phaseCompleted';  result: PhaseResult }
interface PhaseFailedEvent   { kind: 'phaseFailed';     result: PhaseResult; critical: boolean }
interface CrashedEvent       { kind: 'crashed';         error: Error; phase?: string }
interface RecoveredEvent     { kind: 'recovered' }

type LifecycleEvent =
  | StateChangedEvent
  | PhaseStartedEvent
  | PhaseCompletedEvent
  | PhaseFailedEvent
  | CrashedEvent
  | RecoveredEvent;

// ─────────────────────────────────────────────────────────────────────────────
// PUBLIC CONTRACT
// ─────────────────────────────────────────────────────────────────────────────

interface ILifecycleManager {
  /** Current operational state. */
  readonly state: LifecycleState;
  /** Milliseconds since the manager last reached the Running state, or 0. */
  readonly uptime: number;

  // ── Transitions ────────────────────────────────────────────────────────────
  /** Run all startup phases in order. Idempotent when already Running. */
  start(): Promise<void>;
  /** Run all shutdown phases in reverse order. */
  stop(graceful?: boolean): Promise<void>;
  /** Pause non-essential work (e.g. on OS sleep). */
  suspend(): Promise<void>;
  /** Resume from a suspended state. */
  resume(): Promise<void>;
  /** Full stop followed by start — useful after crash recovery. */
  restart(): Promise<void>;

  // ── Phase registry ─────────────────────────────────────────────────────────
  /**
   * Register a new lifecycle phase.
   * @throws {DuplicatePhaseError} when a phase with the same name already exists.
   */
  registerPhase(phase: LifecyclePhase): void;
  /** Remove a previously registered phase by name. */
  unregisterPhase(name: string): boolean;

  // ── Observers ──────────────────────────────────────────────────────────────
  addObserver(observer: ILifecycleObserver): void;
  removeObserver(observer: ILifecycleObserver): void;

  // ── Events ─────────────────────────────────────────────────────────────────
  on(type: LifecycleEventType,  handler: (e: LifecycleEvent) => void): void;
  off(type: LifecycleEventType, handler: (e: LifecycleEvent) => void): void;
}

// ─────────────────────────────────────────────────────────────────────────────
// ERRORS
// ─────────────────────────────────────────────────────────────────────────────

class LifecycleStateError extends Error {
  readonly currentState: LifecycleState;
  readonly attemptedAction: string;

  constructor(current: LifecycleState, action: string) {
    super(
      `Cannot perform "${action}" while in state "${current}".`,
    );
    this.name             = 'LifecycleStateError';
    this.currentState     = current;
    this.attemptedAction  = action;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

class PhaseTimeoutError extends Error {
  readonly phase: string;
  readonly timeoutMs: number;

  constructor(phase: string, timeoutMs: number) {
    super(`Lifecycle phase "${phase}" timed out after ${timeoutMs}ms.`);
    this.name      = 'PhaseTimeoutError';
    this.phase     = phase;
    this.timeoutMs = timeoutMs;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

class DuplicatePhaseError extends Error {
  readonly phase: string;

  constructor(phase: string) {
    super(`A lifecycle phase named "${phase}" is already registered.`);
    this.name  = 'DuplicatePhaseError';
    this.phase = phase;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

class CrashError extends Error {
  readonly phase: string;
  readonly cause: Error;

  constructor(phase: string, cause: Error) {
    super(`Critical phase "${phase}" failed: ${cause.message}`);
    this.name  = 'CrashError';
    this.phase = phase;
    this.cause = cause;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// EVENT BUS
// ─────────────────────────────────────────────────────────────────────────────

class LifecycleEventBus {
  private readonly channels = new Map<
    LifecycleEventType,
    Set<(e: LifecycleEvent) => void>
  >();

  on(type: LifecycleEventType, handler: (e: LifecycleEvent) => void): void {
    if (!this.channels.has(type)) this.channels.set(type, new Set());
    this.channels.get(type)!.add(handler);
  }

  off(type: LifecycleEventType, handler: (e: LifecycleEvent) => void): void {
    this.channels.get(type)?.delete(handler);
  }

  emit(event: LifecycleEvent): void {
    const handlers = this.channels.get(event.kind as LifecycleEventType);
    if (!handlers) return;
    for (const h of handlers) {
      try { h(event); }
      catch (err) {
        console.error(`[LifecycleEventBus] Handler threw on "${event.kind}":`, err);
      }
    }
  }

  dispose(): void { this.channels.clear(); }
}

// ─────────────────────────────────────────────────────────────────────────────
// LIFECYCLE MANAGER
// ─────────────────────────────────────────────────────────────────────────────

class LifecycleManager implements ILifecycleManager, ISharedService {

  readonly name = 'LifecycleManager';

  private readonly engine:    IBrowserEngine;
  private readonly config:    AppConfig;
  private readonly bus:       LifecycleEventBus;
  private readonly phases     = new Map<string, LifecyclePhase>();
  private readonly observers: ILifecycleObserver[] = [];

  private _state:     LifecycleState = LifecycleState.Idle;
  private _startedAt  = 0;

  // Default timeouts (ms)
  private static readonly DEFAULT_PHASE_TIMEOUT = 8_000;
  private static readonly STOP_PHASE_TIMEOUT    = 5_000;

  constructor(engine: IBrowserEngine, config: AppConfig) {
    this.engine = engine;
    this.config = config;
    this.bus    = new LifecycleEventBus();
    this.registerDefaultPhases();
  }

  // ── ISharedService ─────────────────────────────────────────────────────────

  async initialize(): Promise<void> {
    // AppShell calls this — delegate to our own start() sequence.
    if (this._state === LifecycleState.Running) return;
    await this.start();
  }

  async shutdown(): Promise<void> {
    if (
      this._state === LifecycleState.Stopped ||
      this._state === LifecycleState.Idle
    ) return;
    await this.stop(true);
  }

  // ── Accessors ──────────────────────────────────────────────────────────────

  get state(): LifecycleState { return this._state; }

  get uptime(): number {
    return this._state === LifecycleState.Running && this._startedAt > 0
      ? Date.now() - this._startedAt
      : 0;
  }

  // ── Lifecycle transitions ──────────────────────────────────────────────────

  async start(): Promise<void> {
    const allowedStates: LifecycleState[] = [
      LifecycleState.Idle,
      LifecycleState.Stopped,
      LifecycleState.Crashed,
    ];
    if (!allowedStates.includes(this._state)) {
      if (this._state === LifecycleState.Running) return; // idempotent
      throw new LifecycleStateError(this._state, 'start');
    }

    this.transition(LifecycleState.Starting);
    await this.notifyObservers('onBeforeStart');

    try {
      await this.runPhases('startup');
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      await this.crash(error);
      throw error;
    }

    this._startedAt = Date.now();
    this.transition(LifecycleState.Running);
    await this.notifyObservers('onAfterStart');
    this.log(`Running (startup complete)`);
  }

  async stop(graceful = true): Promise<void> {
    const allowedStates: LifecycleState[] = [
      LifecycleState.Running,
      LifecycleState.Suspended,
      LifecycleState.Crashed,
    ];
    if (!allowedStates.includes(this._state)) {
      if (this._state === LifecycleState.Stopped) return;
      throw new LifecycleStateError(this._state, 'stop');
    }

    this.transition(LifecycleState.Stopping);
    await this.notifyObservers('onBeforeStop');

    if (graceful) {
      // Best-effort — swallow non-critical errors during shutdown.
      try {
        await this.runPhases('shutdown');
      } catch (err) {
        console.error('[LifecycleManager] Error during graceful shutdown:', err);
      }
    }

    this._startedAt = 0;
    this.transition(LifecycleState.Stopped);
    await this.notifyObservers('onAfterStop');
    this.log('Stopped');
  }

  /**
   * Permanently tear down this manager — call only when the process is exiting.
   * After dispose(), this instance must not be reused.
   */
  dispose(): void {
    this.bus.dispose();
  }

  async suspend(): Promise<void> {
    if (this._state !== LifecycleState.Running) {
      throw new LifecycleStateError(this._state, 'suspend');
    }
    this.transition(LifecycleState.Suspending);
    await this.notifyObservers('onSuspend');
    this.engine.stop();
    this.transition(LifecycleState.Suspended);
    this.log('Suspended');
  }

  async resume(): Promise<void> {
    if (this._state !== LifecycleState.Suspended) {
      throw new LifecycleStateError(this._state, 'resume');
    }
    await this.notifyObservers('onResume');
    // Re-run startup sequence from Suspended state.
    this._state = LifecycleState.Stopped;
    await this.start();
    this.log('Resumed');
  }

  async restart(): Promise<void> {
    this.log('Restarting…');
    await this.stop(true);
    await this.start();
  }

  // ── Phase registry ─────────────────────────────────────────────────────────

  registerPhase(phase: LifecyclePhase): void {
    if (this.phases.has(phase.name)) {
      throw new DuplicatePhaseError(phase.name);
    }
    this.phases.set(phase.name, phase);
    this.log(`Phase registered: "${phase.name}" (order=${phase.order})`);
  }

  unregisterPhase(name: string): boolean {
    return this.phases.delete(name);
  }

  // ── Observers ──────────────────────────────────────────────────────────────

  addObserver(observer: ILifecycleObserver): void {
    if (!this.observers.includes(observer)) {
      this.observers.push(observer);
    }
  }

  removeObserver(observer: ILifecycleObserver): void {
    const i = this.observers.indexOf(observer);
    if (i !== -1) this.observers.splice(i, 1);
  }

  // ── Events ─────────────────────────────────────────────────────────────────

  on(type: LifecycleEventType,  h: (e: LifecycleEvent) => void): void { this.bus.on(type, h); }
  off(type: LifecycleEventType, h: (e: LifecycleEvent) => void): void { this.bus.off(type, h); }

  // ── Private: phase execution ───────────────────────────────────────────────

  /**
   * Sort registered phases by order and run them sequentially.
   * `direction` = 'startup'  → sorted ascending  (low order first).
   * `direction` = 'shutdown' → sorted descending (high order first = reverse).
   */
  private async runPhases(direction: 'startup' | 'shutdown'): Promise<void> {
    const sorted = [...this.phases.values()].sort((a, b) =>
      direction === 'startup'
        ? a.order - b.order
        : b.order - a.order,
    );

    for (const phase of sorted) {
      const work = direction === 'startup'
        ? phase.startup
        : (phase.shutdown ?? (() => Promise.resolve()));

      this.bus.emit({ kind: 'phaseStarted', phase: phase.name, order: phase.order });

      const result = await this.runWithTimeout(phase.name, work, phase.timeoutMs);

      if (result.success) {
        this.bus.emit({ kind: 'phaseCompleted', result });
        this.log(`Phase "${phase.name}" ✓ (${result.durationMs}ms)`);
      } else {
        this.bus.emit({ kind: 'phaseFailed', result, critical: phase.critical });
        this.log(`Phase "${phase.name}" FAILED — ${result.error?.message}`);

        if (phase.critical && direction === 'startup') {
          throw new CrashError(phase.name, result.error!);
        }
        // Non-critical: log and continue.
      }
    }
  }

  /**
   * Wrap an async function with a per-phase deadline.
   * Returns a PhaseResult regardless of outcome — never throws.
   */
  private async runWithTimeout(
    name: string,
    work: () => Promise<void>,
    timeoutMs: number,
  ): Promise<PhaseResult> {
    const deadline = timeoutMs > 0
      ? timeoutMs
      : LifecycleManager.DEFAULT_PHASE_TIMEOUT;

    const start = Date.now();
    let timeoutHandle: NodeJS.Timeout | undefined;

    const timeoutP = new Promise<never>((_, reject) => {
      timeoutHandle = setTimeout(
        () => reject(new PhaseTimeoutError(name, deadline)),
        deadline,
      );
    });

    try {
      await Promise.race([work(), timeoutP]);
      return {
        phase: name, success: true,
        durationMs: Date.now() - start, timedOut: false,
      };
    } catch (err) {
      const error    = err instanceof Error ? err : new Error(String(err));
      const timedOut = err instanceof PhaseTimeoutError;
      return {
        phase: name, success: false,
        durationMs: Date.now() - start, error, timedOut,
      };
    } finally {
      // Always clear the timer — whichever side of the race won, the loser's
      // pending setTimeout must not be left dangling (resource leak + risk of
      // an unhandled rejection firing after this function has returned).
      clearTimeout(timeoutHandle);
    }
  }

  // ── Private: crash handling ────────────────────────────────────────────────

  private async crash(error: Error, phase?: string): Promise<void> {
    this.transition(LifecycleState.Crashed);
    this.bus.emit({ kind: 'crashed', error, phase });
    await this.notifyObservers('onCrash', error);
    console.error('[LifecycleManager] CRASHED:', error.message);
  }

  // ── Private: state machine ─────────────────────────────────────────────────

  private transition(to: LifecycleState): void {
    const from = this._state;
    this._state = to;
    this.bus.emit({ kind: 'stateChanged', from, to });
    this.log(`${from} → ${to}`);
  }

  // ── Private: observer fan-out ──────────────────────────────────────────────

  private async notifyObservers(
    hook: keyof Omit<ILifecycleObserver, 'name'>,
    arg?: Error,
  ): Promise<void> {
    for (const obs of this.observers) {
      const fn = obs[hook] as ((e?: Error) => Promise<void>) | undefined;
      if (typeof fn !== 'function') continue;
      try {
        await fn.call(obs, arg);
      } catch (err) {
        console.error(
          `[LifecycleManager] Observer "${obs.name}.${hook}" threw:`, err,
        );
      }
    }
  }

  // ── Private: default phases ────────────────────────────────────────────────

  /**
   * Built-in phases registered at construction time.
   * External modules register additional phases via registerPhase().
   *
   *   order  10 — validate-config   Verify AppConfig has required fields.
   *   order  50 — initialize-engine Call IBrowserEngine.initialize().
   *   order 100 — health-check      Confirm the engine can accept a navigate call.
   */
  private registerDefaultPhases(): void {
    // Phase: validate-config
    this.phases.set('validate-config', {
      name:      'validate-config',
      order:     10,
      timeoutMs: 1_000,
      critical:  true,
      startup: async () => {
        if (!this.config.version) {
          throw new Error('AppConfig.version is missing.');
        }
        if (typeof this.config.maxTabs !== 'number' || this.config.maxTabs < 1) {
          throw new Error('AppConfig.maxTabs must be a positive number.');
        }
      },
      shutdown: async () => { /* no teardown needed */ },
    });

    // Phase: initialize-engine
    this.phases.set('initialize-engine', {
      name:      'initialize-engine',
      order:     50,
      timeoutMs: LifecycleManager.DEFAULT_PHASE_TIMEOUT,
      critical:  true,
      startup:  async () => this.engine.initialize(),
      shutdown: async () => {
        // engine.shutdown() is called inside IBrowserEngine itself
        // via ISharedService; LifecycleManager just stops navigating.
        this.engine.stop();
      },
    });

    // Phase: health-check
    this.phases.set('health-check', {
      name:      'health-check',
      order:     100,
      timeoutMs: 3_000,
      critical:  false,  // A failed health-check is a warning, not a crash.
      startup: async () => {
        // Verify the engine's navigation controller exists and is reachable.
        const ctrl = this.engine.navigationController;
        if (!ctrl) throw new Error('BrowserEngine.navigationController is null.');
        // Navigating about:blank is the cheapest valid sanity check.
        await this.engine.navigate('about:blank');
      },
      shutdown: async () => { /* no teardown needed */ },
    });
  }

  // ── Private: logging ───────────────────────────────────────────────────────

  private log(msg: string): void {
    if (this.config.debug) {
      console.log(`[LifecycleManager] ${msg}`);
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// EXPORTS
// ─────────────────────────────────────────────────────────────────────────────

export {
  LifecycleManager,
  LifecycleEventBus,
  LifecycleState,
  LifecycleStateError,
  PhaseTimeoutError,
  DuplicatePhaseError,
  CrashError,
};

export type {
  ILifecycleManager,
  ILifecycleObserver,
  LifecyclePhase,
  PhaseResult,
  LifecycleEvent,
  LifecycleEventType,
  StateChangedEvent,
  PhaseStartedEvent,
  PhaseCompletedEvent,
  PhaseFailedEvent,
  CrashedEvent,
  RecoveredEvent,
};