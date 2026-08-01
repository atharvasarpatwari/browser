import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';

import {
  TabContext,
  TabContextManager,
  TabContextState,
} from '../src/browser/engine/tab-context';
import type { TabContextBusEvent } from '../src/browser/engine/tab-context';
import {
  TabProcessManager,
} from '../src/browser/engine/tab-process-adapter';
import {
  LifecycleManager,
  LifecycleState,
  LifecycleStateError,
  CrashError,
  DuplicatePhaseError,
  DEFAULT_RECOVERY_CONFIG,
} from '../src/browser/engine/lifecycle-manager';
import type { LifecycleEvent } from '../src/browser/engine/lifecycle-manager';
import {
  ErrorBoundary,
  ChainedErrorBoundary,
} from '../src/browser/engine/error-boundary';
import {
  ScriptGuard,
  ScriptGuardError,
} from '../src/browser/engine/script-guard';
import {
  CrashReporter,
  CrashReportBuilder,
} from '../src/browser/engine/crash-reporter';
import {
  ProcessGuard,
} from '../src/browser/engine/process-guard';
import { DEFAULT_PROCESS_MODEL } from '../src/app/config/process-model';
import type {
  IProcessManager,
  ProcessBusEvent,
} from '../src/common/ipc/process-manager';
import { ProcessState } from '../src/common/ipc/process-manager';

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// HELPERS
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

function createMockProcessManager(): IProcessManager & {
  emitCrash: (processId: string, error: Error) => void;
  emitExit: (processId: string) => void;
} {
  const handlers = new Map<string, (e: ProcessBusEvent) => void>();
  const processes = new Map<string, { id: string; tabId?: string; state: ProcessState }>();
  let seq = 0;

  return {
    async spawnProcess(tabId?: string): Promise<string> {
      const id = `mock-proc-${++seq}`;
      processes.set(id, { id, tabId, state: ProcessState.Ready });
      return id;
    },
    async destroyProcess(processId: string): Promise<boolean> {
      if (!processes.has(processId)) return false;
      processes.delete(processId);
      return true;
    },
    getProcess(processId: string) {
      const p = processes.get(processId);
      if (!p) return null;
      return {
        ...p,
        spawnedAt: Date.now(),
        readyAt: Date.now(),
        crashCount: 0,
        transport: {} as any,
        channelManager: {} as any,
      };
    },
    getAllProcesses() {
      return [...processes.values()].map(p => ({
        ...p,
        spawnedAt: Date.now(),
        readyAt: Date.now(),
        crashCount: 0,
        transport: {} as any,
        channelManager: {} as any,
      }));
    },
    getProcessForTab(tabId: string) {
      for (const p of processes.values()) {
        if (p.tabId === tabId) {
          return {
            ...p,
            spawnedAt: Date.now(),
            readyAt: Date.now(),
            crashCount: 0,
            transport: {} as any,
            channelManager: {} as any,
          };
        }
      }
      return null;
    },
    createProxy() { return {} as any; },
    on(type: string, handler: any) { handlers.set(type, handler); },
    off(type: string) { handlers.delete(type); },
    dispose() { handlers.clear(); processes.clear(); },

    emitCrash(processId: string, error: Error) {
      const p = processes.get(processId);
      const handler = handlers.get('processCrashed');
      if (handler) {
        handler({
          kind: 'processCrashed',
          processId,
          tabId: p?.tabId,
          error,
          crashCount: 1,
        });
      }
    },
    emitExit(processId: string) {
      const p = processes.get(processId);
      const handler = handlers.get('processExited');
      if (handler) {
        handler({
          kind: 'processExited',
          processId,
          tabId: p?.tabId,
          exitCode: 1,
        });
      }
    },
  };
}

function createMockBrowserEngine() {
  return {
    name: 'MockBrowserEngine',
    navigationController: { currentEntry: null } as any,
    initialize: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn(),
    navigate: vi.fn().mockResolvedValue(undefined),
  } as any;
}

function createMockAppConfig() {
  return {
    version: '1.0.0',
    debug: false,
    maxTabs: 20,
    homePage: 'about:blank',
    userAgent: 'TestBrowser/1.0',
    browserName: 'Test Browser',
    processModel: DEFAULT_PROCESS_MODEL,
  };
}

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// 1. TAB PROCESS MANAGER ADAPTER
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

describe('TabProcessManager (adapter integration)', () => {
  let mockPM: ReturnType<typeof createMockProcessManager>;
  let adapter: TabProcessManager;

  beforeEach(() => {
    mockPM = createMockProcessManager();
    adapter = new TabProcessManager(mockPM);
  });

  afterEach(() => {
    adapter.dispose();
  });

  it('creates a tab context and spawns a process', async () => {
    const { tab, processId } = await adapter.createTab();
    expect(tab).toBeInstanceOf(TabContext);
    expect(processId).toBeTruthy();
    expect(processId).not.toBe('none');
  });

  it('tracks bidirectional tab-process mapping', async () => {
    const { tab, processId } = await adapter.createTab();
    expect(adapter.getProcessForTab(tab.id)).toBe(processId);
    expect(adapter.getTabForProcess(processId)?.id).toBe(tab.id);
  });

  it('returns all bindings', async () => {
    await adapter.createTab();
    await adapter.createTab();
    const bindings = adapter.getBindings();
    expect(bindings).toHaveLength(2);
    expect(bindings[0]!.tabId).toBeTruthy();
    expect(bindings[0]!.processId).toBeTruthy();
  });

  it('destroyTab removes the binding and destroys the context', async () => {
    const { tab } = await adapter.createTab();
    const destroyed = adapter.destroyTab(tab.id);
    expect(destroyed).toBe(true);
    expect(adapter.getProcessForTab(tab.id)).toBeNull();
  });

  it('emits tabProcessCreated event', async () => {
    const events: string[] = [];
    adapter.on('tabProcessCreated', (e) => events.push(e.kind));
    await adapter.createTab();
    expect(events).toContain('tabProcessCreated');
  });

  it('emits tabProcessDestroyed event', async () => {
    const { tab } = await adapter.createTab();
    const events: string[] = [];
    adapter.on('tabProcessDestroyed', (e) => events.push(e.kind));
    adapter.destroyTab(tab.id);
    expect(events).toContain('tabProcessDestroyed');
  });

  it('forwards process crash to tab context', async () => {
    const { tab, processId } = await adapter.createTab();
    const error = new Error('process crashed');
    mockPM.emitCrash(processId, error);
    expect(tab.state).toBe(TabContextState.Crashed);
    expect(tab.lastCrash).not.toBeNull();
    expect(tab.lastCrash!.error.message).toBe('process crashed');
  });

  it('emits tabProcessCrashed when process crashes', async () => {
    const { tab, processId } = await adapter.createTab();
    let crashedTabId = '';
    adapter.on('tabProcessCrashed', (e) => {
      crashedTabId = e.tabId;
    });
    mockPM.emitCrash(processId, new Error('boom'));
    expect(crashedTabId).toBe(tab.id);
  });

  it('returns false when destroying unknown tab', () => {
    expect(adapter.destroyTab('nonexistent')).toBe(false);
  });

  it('getTabForProcess returns null for unknown process', () => {
    expect(adapter.getTabForProcess('nonexistent')).toBeNull();
  });

  it('returns no bindings when empty', () => {
    expect(adapter.getBindings()).toHaveLength(0);
  });
});

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// 2. LIFECYCLE MANAGER â€” STATE MACHINE
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

describe('LifecycleManager state machine', () => {
  let engine: ReturnType<typeof createMockBrowserEngine>;
  let config: ReturnType<typeof createMockAppConfig>;
  let lm: LifecycleManager;

  beforeEach(() => {
    engine = createMockBrowserEngine();
    config = createMockAppConfig();
    lm = new LifecycleManager(engine, config);
  });

  afterEach(() => {
    lm.dispose();
  });

  it('starts in Idle state', () => {
    expect(lm.state).toBe(LifecycleState.Idle);
  });

  it('transitions Idle â†’ Starting â†’ Running on start()', async () => {
    await lm.start();
    expect(lm.state).toBe(LifecycleState.Running);
  });

  it('start() is idempotent when already Running', async () => {
    await lm.start();
    await lm.start();
    expect(lm.state).toBe(LifecycleState.Running);
  });

  it('transitions Running â†’ Stopping â†’ Stopped on stop()', async () => {
    await lm.start();
    await lm.stop();
    expect(lm.state).toBe(LifecycleState.Stopped);
  });

  it('stop() is idempotent when already Stopped', async () => {
    await lm.start();
    await lm.stop();
    await lm.stop();
    expect(lm.state).toBe(LifecycleState.Stopped);
  });

  it('throws LifecycleStateError when starting from Running (non-idempotent path)', async () => {
    await lm.start();
    // Running â†’ start is idempotent, but Running â†’ suspend then start from Suspended is not
    await lm.suspend();
    // Now suspended, calling start directly should throw (must use resume)
    await expect(lm.start()).rejects.toThrow(LifecycleStateError);
  });

  it('throws LifecycleStateError when suspending from Idle', async () => {
    await expect(lm.suspend()).rejects.toThrow(LifecycleStateError);
  });

  it('transitions Running â†’ Suspending â†’ Suspended', async () => {
    await lm.start();
    await lm.suspend();
    expect(lm.state).toBe(LifecycleState.Suspended);
  });

  it('transitions Suspended â†’ Starting â†’ Running via resume()', async () => {
    await lm.start();
    await lm.suspend();
    await lm.resume();
    expect(lm.state).toBe(LifecycleState.Running);
  });

  it('restart() goes Running â†’ Stopped â†’ Running', async () => {
    await lm.start();
    await lm.restart();
    expect(lm.state).toBe(LifecycleState.Running);
  });

  it('tracks uptime after start', async () => {
    await lm.start();
    expect(lm.uptime).toBeGreaterThanOrEqual(0);
  });

  it('uptime is 0 when not Running', () => {
    expect(lm.uptime).toBe(0);
  });

  it('crashCount starts at 0', () => {
    expect(lm.crashCount).toBe(0);
  });
});

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// 3. LIFECYCLE MANAGER â€” PHASE REGISTRY
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

describe('LifecycleManager phase registry', () => {
  let engine: ReturnType<typeof createMockBrowserEngine>;
  let config: ReturnType<typeof createMockAppConfig>;
  let lm: LifecycleManager;

  beforeEach(() => {
    engine = createMockBrowserEngine();
    config = createMockAppConfig();
    lm = new LifecycleManager(engine, config);
  });

  afterEach(() => {
    lm.dispose();
  });

  it('registers a custom phase', () => {
    lm.registerPhase({
      name: 'custom-phase',
      order: 200,
      timeoutMs: 1_000,
      critical: false,
      startup: async () => {},
    });
  });

  it('throws DuplicatePhaseError for duplicate name', () => {
    const phase = {
      name: 'dup-phase',
      order: 200,
      timeoutMs: 1_000,
      critical: false,
      startup: async () => {},
    };
    lm.registerPhase(phase);
    expect(() => lm.registerPhase(phase)).toThrow(DuplicatePhaseError);
  });

  it('unregisters a phase', () => {
    lm.registerPhase({
      name: 'removable',
      order: 200,
      timeoutMs: 1_000,
      critical: false,
      startup: async () => {},
    });
    expect(lm.unregisterPhase('removable')).toBe(true);
  });

  it('returns false for unregistering unknown phase', () => {
    expect(lm.unregisterPhase('nonexistent')).toBe(false);
  });

  it('runs custom phases during startup in order', async () => {
    const order: string[] = [];
    lm.registerPhase({
      name: 'second',
      order: 200,
      timeoutMs: 1_000,
      critical: false,
      startup: async () => { order.push('second'); },
    });
    lm.registerPhase({
      name: 'first',
      order: 100,
      timeoutMs: 1_000,
      critical: false,
      startup: async () => { order.push('first'); },
    });
    await lm.start();
    expect(order).toEqual(['first', 'second']);
  });

  it('critical phase failure transitions to Crashed', async () => {
    lm.registerPhase({
      name: 'explode',
      order: 5,
      timeoutMs: 1_000,
      critical: true,
      startup: async () => { throw new Error('critical failure'); },
    });
    try { await lm.start(); } catch { /* CrashError thrown */ }
    expect(lm.state).toBe(LifecycleState.Crashed);
  });

  it('non-critical phase failure does not crash', async () => {
    lm.registerPhase({
      name: 'warn-only',
      order: 5,
      timeoutMs: 1_000,
      critical: false,
      startup: async () => { throw new Error('non-critical'); },
    });
    await lm.start();
    expect(lm.state).toBe(LifecycleState.Running);
  });

  it('runs shutdown phases in reverse order', async () => {
    const order: string[] = [];
    lm.registerPhase({
      name: 'early',
      order: 10,
      timeoutMs: 1_000,
      critical: false,
      startup: async () => {},
      shutdown: async () => { order.push('early-shutdown'); },
    });
    lm.registerPhase({
      name: 'late',
      order: 200,
      timeoutMs: 1_000,
      critical: false,
      startup: async () => {},
      shutdown: async () => { order.push('late-shutdown'); },
    });
    await lm.start();
    await lm.stop();
    expect(order).toEqual(['late-shutdown', 'early-shutdown']);
  });
});

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// 4. LIFECYCLE MANAGER â€” CRASH RECOVERY
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

describe('LifecycleManager crash recovery', () => {
  let engine: ReturnType<typeof createMockBrowserEngine>;
  let config: ReturnType<typeof createMockAppConfig>;
  let lm: LifecycleManager;

  beforeEach(() => {
    engine = createMockBrowserEngine();
    config = createMockAppConfig();
    lm = new LifecycleManager(engine, config);
  });

  afterEach(() => {
    lm.dispose();
  });

  it('records last crash error', async () => {
    lm.registerPhase({
      name: 'fail',
      order: 5,
      timeoutMs: 1_000,
      critical: true,
      startup: async () => { throw new Error('fatal error'); },
    });
    try { await lm.start(); } catch { /* CrashError */ }
    expect(lm.getLastCrash()).not.toBeNull();
    expect(lm.getLastCrash()!.message).toContain('fatal error');
  });

  it('increments crash count on critical failure', async () => {
    lm.registerPhase({
      name: 'fail',
      order: 5,
      timeoutMs: 1_000,
      critical: true,
      startup: async () => { throw new Error('crash'); },
    });
    try { await lm.start(); } catch { /* CrashError */ }
    expect(lm.crashCount).toBe(1);
  });

  it('recover() returns false when not in Crashed state', async () => {
    expect(await lm.recover()).toBe(false);
  });

  it('recover() returns true when recovery succeeds', async () => {
    lm.registerPhase({
      name: 'fail',
      order: 5,
      timeoutMs: 1_000,
      critical: true,
      startup: async () => { throw new Error('crash'); },
    });
    try { await lm.start(); } catch { /* CrashError */ }
    expect(lm.state).toBe(LifecycleState.Crashed);

    // Remove the failing phase so recovery succeeds
    lm.unregisterPhase('fail');
    const recovered = await lm.recover();
    expect(recovered).toBe(true);
    expect(lm.state).toBe(LifecycleState.Running);
  });

  it('recover() returns false when max attempts exceeded', async () => {
    lm.updateRecoveryConfig({ maxRecoveryAttempts: 1 });
    lm.registerPhase({
      name: 'always-fail',
      order: 5,
      timeoutMs: 1_000,
      critical: true,
      startup: async () => { throw new Error('always fails'); },
    });
    try { await lm.start(); } catch { /* CrashError */ }
    // crashCount is now 1, maxRecoveryAttempts is 1
    const recovered = await lm.recover();
    expect(recovered).toBe(false);
  });

  it('resetCrashCount resets crash state', async () => {
    lm.registerPhase({
      name: 'fail',
      order: 5,
      timeoutMs: 1_000,
      critical: true,
      startup: async () => { throw new Error('crash'); },
    });
    try { await lm.start(); } catch { /* CrashError */ }
    expect(lm.crashCount).toBe(1);
    lm.resetCrashCount();
    expect(lm.crashCount).toBe(0);
    expect(lm.getLastCrash()).toBeNull();
  });

  it('can start from Crashed state (restart recovery)', async () => {
    lm.registerPhase({
      name: 'fail',
      order: 5,
      timeoutMs: 1_000,
      critical: true,
      startup: async () => { throw new Error('crash'); },
    });
    try { await lm.start(); } catch { /* CrashError */ }
    expect(lm.state).toBe(LifecycleState.Crashed);
    lm.unregisterPhase('fail');
    await lm.start();
    expect(lm.state).toBe(LifecycleState.Running);
  });

  it('getRecoveryConfig returns config', () => {
    const rc = lm.getRecoveryConfig();
    expect(rc.autoRecover).toBe(DEFAULT_RECOVERY_CONFIG.autoRecover);
    expect(rc.maxRecoveryAttempts).toBe(DEFAULT_RECOVERY_CONFIG.maxRecoveryAttempts);
  });

  it('updateRecoveryConfig merges partial', () => {
    lm.updateRecoveryConfig({ autoRecover: true, maxRecoveryAttempts: 5 });
    const rc = lm.getRecoveryConfig();
    expect(rc.autoRecover).toBe(true);
    expect(rc.maxRecoveryAttempts).toBe(5);
    expect(rc.backoffBaseMs).toBe(DEFAULT_RECOVERY_CONFIG.backoffBaseMs);
  });
});

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// 5. LIFECYCLE MANAGER â€” OBSERVERS & EVENTS
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

describe('LifecycleManager observers and events', () => {
  let engine: ReturnType<typeof createMockBrowserEngine>;
  let config: ReturnType<typeof createMockAppConfig>;
  let lm: LifecycleManager;

  beforeEach(() => {
    engine = createMockBrowserEngine();
    config = createMockAppConfig();
    lm = new LifecycleManager(engine, config);
  });

  afterEach(() => {
    lm.dispose();
  });

  it('notifies onBeforeStart and onAfterStart observers', async () => {
    const calls: string[] = [];
    lm.addObserver({
      name: 'test-observer',
      onBeforeStart: async () => { calls.push('beforeStart'); },
      onAfterStart: async () => { calls.push('afterStart'); },
    });
    await lm.start();
    expect(calls).toEqual(['beforeStart', 'afterStart']);
  });

  it('notifies onBeforeStop and onAfterStop observers', async () => {
    const calls: string[] = [];
    lm.addObserver({
      name: 'test-observer',
      onBeforeStop: async () => { calls.push('beforeStop'); },
      onAfterStop: async () => { calls.push('afterStop'); },
    });
    await lm.start();
    await lm.stop();
    expect(calls).toEqual(['beforeStop', 'afterStop']);
  });

  it('notifies onCrash observer', async () => {
    let crashError: Error | null = null;
    lm.addObserver({
      name: 'crash-watcher',
      onCrash: async (error) => { crashError = error; },
    });
    lm.registerPhase({
      name: 'fail',
      order: 5,
      timeoutMs: 1_000,
      critical: true,
      startup: async () => { throw new Error('observer test'); },
    });
    try { await lm.start(); } catch { /* CrashError */ }
    expect(crashError).not.toBeNull();
    expect(crashError!.message).toContain('observer test');
  });

  it('notifies onSuspend and onResume observers', async () => {
    const calls: string[] = [];
    lm.addObserver({
      name: 'suspend-observer',
      onSuspend: async () => { calls.push('suspend'); },
      onResume: async () => { calls.push('resume'); },
    });
    await lm.start();
    await lm.suspend();
    await lm.resume();
    expect(calls).toEqual(['suspend', 'resume']);
  });

  it('removes observer', async () => {
    const calls: string[] = [];
    const obs = {
      name: 'removable',
      onBeforeStart: async () => { calls.push('start'); },
    };
    lm.addObserver(obs);
    lm.removeObserver(obs);
    await lm.start();
    expect(calls).toHaveLength(0);
  });

  it('emits stateChanged events', async () => {
    const transitions: string[] = [];
    lm.on('stateChanged', (e) => {
      const ev = e as Extract<LifecycleEvent, { kind: 'stateChanged' }>;
      transitions.push(`${ev.from}â†’${ev.to}`);
    });
    await lm.start();
    expect(transitions).toContain('idleâ†’starting');
    expect(transitions).toContain('startingâ†’running');
  });

  it('emits crashed event', async () => {
    let crashed = false;
    lm.on('crashed', () => { crashed = true; });
    lm.registerPhase({
      name: 'fail',
      order: 5,
      timeoutMs: 1_000,
      critical: true,
      startup: async () => { throw new Error('boom'); },
    });
    try { await lm.start(); } catch { /* CrashError */ }
    expect(crashed).toBe(true);
  });
});

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// 6. LIFECYCLE MANAGER â€” PHASE TIMEOUT
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

describe('LifecycleManager phase timeout', () => {
  let engine: ReturnType<typeof createMockBrowserEngine>;
  let config: ReturnType<typeof createMockAppConfig>;
  let lm: LifecycleManager;

  beforeEach(() => {
    engine = createMockBrowserEngine();
    config = createMockAppConfig();
    lm = new LifecycleManager(engine, config);
  });

  afterEach(() => {
    lm.dispose();
  });

  it('critical phase timeout transitions to Crashed', async () => {
    lm.registerPhase({
      name: 'hung',
      order: 5,
      timeoutMs: 50,
      critical: true,
      startup: async () => {
        await new Promise(resolve => setTimeout(resolve, 5000));
      },
    });
    try { await lm.start(); } catch { /* CrashError */ }
    expect(lm.state).toBe(LifecycleState.Crashed);
  });

  it('non-critical phase timeout does not crash', async () => {
    lm.registerPhase({
      name: 'hung',
      order: 5,
      timeoutMs: 50,
      critical: false,
      startup: async () => {
        await new Promise(resolve => setTimeout(resolve, 5000));
      },
    });
    await lm.start();
    expect(lm.state).toBe(LifecycleState.Running);
  });
});

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// 7. INTEGRATION: MULTI-TAB CRASH ISOLATION
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

describe('Multi-tab crash isolation', () => {
  let manager: TabContextManager;

  beforeEach(() => {
    manager = new TabContextManager();
  });

  afterEach(() => {
    manager.dispose();
  });

  it('crash in one tab does not affect other tabs', () => {
    const tab1 = manager.createContext();
    const tab2 = manager.createContext();
    const tab3 = manager.createContext();

    tab1.setLoading('https://a.com');
    tab1.setActive('A');
    tab2.setLoading('https://b.com');
    tab2.setActive('B');
    tab3.setLoading('https://c.com');
    tab3.setActive('C');

    tab2.crash(new Error('tab2 crashed'), 'script', 'https://b.com');

    expect(tab1.state).toBe(TabContextState.Active);
    expect(tab2.state).toBe(TabContextState.Crashed);
    expect(tab3.state).toBe(TabContextState.Active);
  });

  it('getCrashedContexts returns only crashed tabs', () => {
    const tab1 = manager.createContext();
    const tab2 = manager.createContext();
    const tab3 = manager.createContext();

    tab1.crash(new Error('crash'), 'script', 'url');
    tab3.crash(new Error('crash'), 'parse', 'url');

    const crashed = manager.getCrashedContexts();
    expect(crashed).toHaveLength(2);
    expect(crashed.map(c => c.id)).toContain(tab1.id);
    expect(crashed.map(c => c.id)).toContain(tab3.id);
  });

  it('destroying a crashed tab removes it from crashed list', () => {
    const tab1 = manager.createContext();
    const tab2 = manager.createContext();

    tab1.crash(new Error('crash'), 'script', 'url');
    tab2.crash(new Error('crash'), 'script', 'url');

    manager.destroyContext(tab1.id);
    expect(manager.getCrashedContexts()).toHaveLength(1);
  });

  it('each tab has isolated rendering pipeline', () => {
    const tab1 = manager.createContext();
    const tab2 = manager.createContext();

    expect(tab1.domTree).not.toBe(tab2.domTree);
    expect(tab1.layoutEngine).not.toBe(tab2.layoutEngine);
    expect(tab1.paintEngine).not.toBe(tab2.paintEngine);
    expect(tab1.eventLoop).not.toBe(tab2.eventLoop);
  });

  it('each tab has unique id', () => {
    const tab1 = manager.createContext();
    const tab2 = manager.createContext();
    expect(tab1.id).not.toBe(tab2.id);
  });
});

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// 8. INTEGRATION: ERROR BOUNDARY + TAB OPERATIONS
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

describe('ErrorBoundary wrapping tab operations', () => {
  it('catches error in tab operation with fail-fast', () => {
    const boundary = new ErrorBoundary({ name: 'tab-ops', strategy: 'fail-fast' });
    const result = boundary.exec(() => {
      throw new Error('render failed');
    });
    expect(result.success).toBe(false);
    expect(result.error!.message).toBe('render failed');
    expect(result.attempts).toBe(1);
  });

  it('retries transient failures', () => {
    let attempts = 0;
    const boundary = new ErrorBoundary({
      name: 'retry-ops',
      strategy: 'retry',
      maxRetries: 3,
      retryBaseMs: 1,
      retryMaxMs: 5,
    });
    const result = boundary.exec(() => {
      attempts++;
      if (attempts < 3) throw new Error('transient');
      return 'success';
    });
    expect(result.success).toBe(true);
    expect(result.value).toBe('success');
    expect(result.attempts).toBe(3);
  });

  it('fallback returns default value', () => {
    const boundary = new ErrorBoundary({ name: 'fallback-ops', strategy: 'fail-fast' });
    let called = false;
    const result = boundary.exec(() => {
      called = true;
      throw new Error('broken');
    });
    expect(result.success).toBe(false);
    expect(boundary.getErrorCount()).toBe(1);
  });

  it('tracks error history', () => {
    const boundary = new ErrorBoundary({ name: 'history-ops', strategy: 'fail-fast' });
    boundary.exec(() => { throw new Error('err1'); });
    boundary.exec(() => { throw new Error('err2'); });
    expect(boundary.getErrorCount()).toBe(2);
    expect(boundary.hasErrors()).toBe(true);
    const history = boundary.getErrorHistory();
    expect(history).toHaveLength(2);
    expect(history[0]!.error.message).toBe('err1');
    expect(history[1]!.error.message).toBe('err2');
  });

  it('clearHistory resets error state', () => {
    const boundary = new ErrorBoundary({ name: 'clear-ops', strategy: 'fail-fast' });
    boundary.exec(() => { throw new Error('err'); });
    boundary.clearHistory();
    expect(boundary.getErrorCount()).toBe(0);
    expect(boundary.hasErrors()).toBe(false);
  });

  it('async exec catches errors', async () => {
    const boundary = new ErrorBoundary({ name: 'async-ops', strategy: 'fail-fast' });
    const result = await boundary.execAsync(async () => {
      throw new Error('async fail');
    });
    expect(result.success).toBe(false);
    expect(result.error!.message).toBe('async fail');
  });

  it('async exec retries', async () => {
    let attempts = 0;
    const boundary = new ErrorBoundary({
      name: 'async-retry',
      strategy: 'retry',
      maxRetries: 2,
      retryBaseMs: 1,
      retryMaxMs: 5,
    });
    const result = await boundary.execAsync(async () => {
      attempts++;
      if (attempts < 2) throw new Error('transient');
      return 'done';
    });
    expect(result.success).toBe(true);
    expect(result.value).toBe('done');
  });
});

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// 9. INTEGRATION: SCRIPT GUARD + TAB OPERATIONS
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

describe('ScriptGuard protecting tab execution', () => {
  it('allows fast scripts to complete', async () => {
    const guard = new ScriptGuard({ maxExecutionMs: 1000, maxInstructions: 1000 });
    const result = await guard.exec(() => 42);
    expect(result.completed).toBe(true);
    expect(result.value).toBe(42);
  });

  it('terminates infinite loop via instruction limit', async () => {
    const guard = new ScriptGuard({ maxExecutionMs: 5000, maxInstructions: 100 });
    let count = 0;
    const result = await guard.exec(() => {
      while (true) {
        guard.tick();
        count++;
        if (count > 200) break;
      }
      return count;
    });
    expect(result.completed).toBe(false);
    expect(result.error).toBeInstanceOf(ScriptGuardError);
    expect(result.error!.reason).toBe('instruction-limit');
  });

  it('terminates slow scripts via timeout', async () => {
    const guard = new ScriptGuard({ maxExecutionMs: 50, maxInstructions: 10_000_000 });
    const result = await guard.execAsync(async () => {
      await new Promise(resolve => setTimeout(resolve, 5000));
      return 'should not reach';
    });
    expect(result.completed).toBe(false);
    expect(result.error!.reason).toBe('timeout');
  });

  it('protects against stack overflow via frame depth', () => {
    const guard = new ScriptGuard({ maxStackDepth: 3, maxInstructions: 10_000 });
    expect(() => {
      for (let i = 0; i < 10; i++) {
        guard.pushFrame(`frame-${i}`);
      }
    }).toThrow(ScriptGuardError);
  });

  it('tracks stack depth correctly', () => {
    const guard = new ScriptGuard({ maxStackDepth: 100 });
    guard.pushFrame('a');
    guard.pushFrame('b');
    expect(guard.getStackDepth()).toBe(2);
    guard.popFrame();
    expect(guard.getStackDepth()).toBe(1);
    guard.popFrame();
    expect(guard.getStackDepth()).toBe(0);
  });

  it('reset clears all state', () => {
    const guard = new ScriptGuard({ maxStackDepth: 100, maxInstructions: 10_000 });
    guard.tick();
    guard.tick();
    guard.pushFrame('a');
    guard.reset();
    expect(guard.getInstructionCount()).toBe(0);
    expect(guard.getStackDepth()).toBe(0);
    expect(guard.isTriggered()).toBe(false);
  });

  it('disabled guard allows anything', async () => {
    const guard = new ScriptGuard({ enabled: false, maxExecutionMs: 1 });
    const result = await guard.exec(() => 99);
    expect(result.completed).toBe(true);
    expect(result.value).toBe(99);
  });

  it('ScriptGuardError has correct properties', () => {
    const err = new ScriptGuardError('timeout', 5000, 5001);
    expect(err.reason).toBe('timeout');
    expect(err.limit).toBe(5000);
    expect(err.actual).toBe(5001);
    expect(err.name).toBe('ScriptGuardError');
  });
});

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// 10. INTEGRATION: PROCESS GUARD + CRASH REPORTER
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

describe('ProcessGuard feeding CrashReporter', () => {
  let guard: ProcessGuard;
  let reporter: CrashReporter;

  beforeEach(() => {
    guard = new ProcessGuard({ installHandlers: false, logErrors: false });
    reporter = new CrashReporter({ logReports: false });
  });

  afterEach(() => {
    guard.dispose();
    reporter.dispose();
  });

  it('records error in guard and forwards to reporter', () => {
    const error = new Error('process error');
    guard.recordError(error, 'error', 'test-context');

    const report = new CrashReportBuilder()
      .source('process-guard')
      .error(error)
      .severity('error')
      .phase('execution')
      .context('source', 'process-guard')
      .tabId('test-tab')
      .build();

    reporter.report(report);

    expect(guard.getErrorCount()).toBe(1);
    expect(reporter.getReports()).toHaveLength(1);
    expect(reporter.getReports()[0]!.error.message).toBe('process error');
  });

  it('fatal error in guard triggers onFatal callback', () => {
    let fatalError: Error | null = null;
    const fatalGuard = new ProcessGuard({
      installHandlers: false,
      logErrors: false,
      onFatal: (err) => { fatalError = err; },
    });

    fatalGuard.recordError(new Error('fatal'), 'fatal');
    expect(fatalError).not.toBeNull();
    expect(fatalError!.message).toBe('fatal');
    fatalGuard.dispose();
  });

  it('reporter tracks summary stats from multiple sources', () => {
    const tabReport = new CrashReportBuilder()
      .source('tab-context')
      .error(new Error('tab crash'))
      .severity('error')
      .phase('script')
      .tabId('tab-1')
      .build();

    const pgReport = new CrashReportBuilder()
      .source('process-guard')
      .error(new Error('process crash'))
      .severity('fatal')
      .phase('execution')
      .tabId('tab-1')
      .build();

    const lmReport = new CrashReportBuilder()
      .source('lifecycle-manager')
      .error(new Error('lifecycle crash'))
      .severity('warning')
      .phase('startup')
      .build();

    reporter.report(tabReport);
    reporter.report(pgReport);
    reporter.report(lmReport);

    const summary = reporter.getSummary();
    expect(summary.total).toBe(3);
    expect(summary.bySeverity.error).toBe(1);
    expect(summary.bySeverity.fatal).toBe(1);
    expect(summary.bySeverity.warning).toBe(1);
    expect(summary.bySource['tab-context']).toBe(1);
    expect(summary.bySource['process-guard']).toBe(1);
    expect(summary.bySource['lifecycle-manager']).toBe(1);
  });

  it('reporter filters by tab', () => {
    reporter.report(new CrashReportBuilder()
      .source('tab-context').error(new Error('1')).severity('error').phase('p').tabId('tab-a').build());
    reporter.report(new CrashReportBuilder()
      .source('tab-context').error(new Error('2')).severity('error').phase('p').tabId('tab-b').build());
    reporter.report(new CrashReportBuilder()
      .source('tab-context').error(new Error('3')).severity('error').phase('p').tabId('tab-a').build());

    expect(reporter.getReportsByTab('tab-a')).toHaveLength(2);
    expect(reporter.getReportsByTab('tab-b')).toHaveLength(1);
  });

  it('reporter filters by severity', () => {
    reporter.report(new CrashReportBuilder()
      .source('tab-context').error(new Error('w')).severity('warning').phase('p').build());
    reporter.report(new CrashReportBuilder()
      .source('tab-context').error(new Error('e')).severity('error').phase('p').build());
    reporter.report(new CrashReportBuilder()
      .source('tab-context').error(new Error('f')).severity('fatal').phase('p').build());

    expect(reporter.getReportsBySeverity('warning')).toHaveLength(1);
    expect(reporter.getReportsBySeverity('error')).toHaveLength(1);
    expect(reporter.getReportsBySeverity('fatal')).toHaveLength(1);
  });

  it('reporter trims to maxReports', () => {
    const smallReporter = new CrashReporter({ maxReports: 3, logReports: false });
    for (let i = 0; i < 10; i++) {
      smallReporter.report(new CrashReportBuilder()
        .source('tab-context')
        .error(new Error(`err-${i}`))
        .severity('error')
        .phase('p')
        .build());
    }
    expect(smallReporter.getReports()).toHaveLength(3);
    expect(smallReporter.getReports()[0]!.error.message).toBe('err-7');
    smallReporter.dispose();
  });

  it('reporter getRecentReports returns last N', () => {
    for (let i = 0; i < 5; i++) {
      reporter.report(new CrashReportBuilder()
        .source('tab-context')
        .error(new Error(`err-${i}`))
        .severity('error')
        .phase('p')
        .build());
    }
    const recent = reporter.getRecentReports(2);
    expect(recent).toHaveLength(2);
    expect(recent[0]!.error.message).toBe('err-3');
    expect(recent[1]!.error.message).toBe('err-4');
  });

  it('clearReports empties the store', () => {
    reporter.report(new CrashReportBuilder()
      .source('tab-context').error(new Error('x')).severity('error').phase('p').build());
    reporter.clearReports();
    expect(reporter.getReports()).toHaveLength(0);
  });
});

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// 11. INTEGRATION: CHAINED ERROR BOUNDARY FOR TAB PIPELINE
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

describe('ChainedErrorBoundary for rendering pipeline', () => {
  it('first boundary handles transient error via retry', () => {
    let attempts = 0;
    const retryBoundary = new ErrorBoundary({
      name: 'retry',
      strategy: 'retry',
      maxRetries: 2,
      retryBaseMs: 1,
      retryMaxMs: 5,
    });
    const fallbackBoundary = new ErrorBoundary({
      name: 'fallback',
      strategy: 'fail-fast',
    });

    const chain = new ChainedErrorBoundary([retryBoundary, fallbackBoundary]);

    const result = chain.exec(() => {
      attempts++;
      if (attempts < 2) throw new Error('transient');
      return 'recovered';
    });

    expect(result.success).toBe(true);
    expect(result.value).toBe('recovered');
  });

  it('second boundary catches error when first fails', () => {
    const retryBoundary = new ErrorBoundary({
      name: 'retry',
      strategy: 'retry',
      maxRetries: 1,
      retryBaseMs: 1,
      retryMaxMs: 5,
    });
    const swallowBoundary = new ErrorBoundary({
      name: 'swallow',
      strategy: 'swallow',
    });

    const chain = new ChainedErrorBoundary([retryBoundary, swallowBoundary]);

    const result = chain.exec(() => {
      throw new Error('permanent');
    });

    expect(result.success).toBe(false);
  });

  it('aggregates error history across boundaries', () => {
    const b1 = new ErrorBoundary({ name: 'b1', strategy: 'fail-fast' });
    const b2 = new ErrorBoundary({ name: 'b2', strategy: 'fail-fast' });
    const chain = new ChainedErrorBoundary([b1, b2]);

    chain.exec(() => { throw new Error('err1'); });
    chain.exec(() => { throw new Error('err2'); });

    // Each call passes through both boundaries (b1 tries then b2 tries), so 2 calls x 2 boundaries = 4 errors
    expect(chain.getErrorCount()).toBe(4);
    expect(chain.getErrorHistory()).toHaveLength(4);
  });
});

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// 12. INTEGRATION: TAB CONTEXT SNAPSHOT + RECOVERY
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

describe('TabContext snapshot-based recovery', () => {
  it('saveSnapshot stores URL and title', () => {
    const ctx = new TabContext();
    ctx.saveSnapshot('https://example.com', 'Example');
    expect(ctx.snapshot).not.toBeNull();
    expect(ctx.snapshot!.url).toBe('https://example.com');
    expect(ctx.snapshot!.title).toBe('Example');
  });

  it('snapshot persists after crash', () => {
    const ctx = new TabContext();
    ctx.saveSnapshot('https://example.com', 'Example');
    ctx.crash(new Error('boom'), 'script', 'https://example.com');
    expect(ctx.snapshot).not.toBeNull();
    expect(ctx.snapshot!.url).toBe('https://example.com');
  });

  it('snapshot is null by default', () => {
    const ctx = new TabContext();
    expect(ctx.snapshot).toBeNull();
  });

  it('snapshotSaved event fires', () => {
    const ctx = new TabContext();
    let savedUrl = '';
    ctx.on('snapshotSaved', (e) => { savedUrl = (e as Extract<TabContextBusEvent, { kind: 'snapshotSaved' }>).url; });
    ctx.saveSnapshot('https://saved.com', 'Saved');
    expect(savedUrl).toBe('https://saved.com');
  });

  it('overwrites previous snapshot', () => {
    const ctx = new TabContext();
    ctx.saveSnapshot('https://first.com', 'First');
    ctx.saveSnapshot('https://second.com', 'Second');
    expect(ctx.snapshot!.url).toBe('https://second.com');
    expect(ctx.snapshot!.title).toBe('Second');
  });
});

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// 13. INTEGRATION: CRASH REPORT BUILDER FLUENT API
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

describe('CrashReportBuilder fluent API', () => {
  it('builds a complete report', () => {
    const report = new CrashReportBuilder()
      .source('tab-context')
      .error(new Error('test'))
      .severity('error')
      .phase('script')
      .url('https://example.com')
      .tabId('tab-1')
      .context('key1', 'value1')
      .context('key2', 42)
      .build();

    expect(report.source).toBe('tab-context');
    expect(report.error.message).toBe('test');
    expect(report.severity).toBe('error');
    expect(report.phase).toBe('script');
    expect(report.url).toBe('https://example.com');
    expect(report.tabId).toBe('tab-1');
    expect(report.context.key1).toBe('value1');
    expect(report.context.key2).toBe(42);
    expect(report.id).toBeTruthy();
    expect(report.timestamp).toBeGreaterThan(0);
  });

  it('defaults severity to error when not set', () => {
    const report = new CrashReportBuilder()
      .source('manual')
      .error(new Error('test'))
      .build();
    expect(report.severity).toBe('error');
  });

  it('defaults phase to unknown when not set', () => {
    const report = new CrashReportBuilder()
      .source('manual')
      .error(new Error('test'))
      .build();
    expect(report.phase).toBe('unknown');
  });

  it('throws when error is missing', () => {
    expect(() => {
      new CrashReportBuilder()
        .source('manual')
        .build();
    }).toThrow('error is required');
  });

  it('throws when source is missing', () => {
    expect(() => {
      new CrashReportBuilder()
        .error(new Error('test'))
        .build();
    }).toThrow('source is required');
  });

  it('each report has unique id', () => {
    const r1 = new CrashReportBuilder()
      .source('manual').error(new Error('a')).build();
    const r2 = new CrashReportBuilder()
      .source('manual').error(new Error('b')).build();
    expect(r1.id).not.toBe(r2.id);
  });
});

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// 14. INTEGRATION: TAB PROCESS MANAGER CRASH RECOVERY FLOW
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

describe('TabProcessManager crash â†’ recovery flow', () => {
  let mockPM: ReturnType<typeof createMockProcessManager>;
  let adapter: TabProcessManager;

  beforeEach(() => {
    mockPM = createMockProcessManager();
    adapter = new TabProcessManager(mockPM);
  });

  afterEach(() => {
    adapter.dispose();
  });

  it('crashed tab can attempt recovery after process crash', async () => {
    const { tab, processId } = await adapter.createTab();
    mockPM.emitCrash(processId, new Error('segfault'));
    expect(tab.state).toBe(TabContextState.Crashed);
    const recovered = tab.recover();
    expect(recovered).toBe(true);
    expect(tab.state).toBe(TabContextState.Active);
  });

  it('multiple tabs crash independently', async () => {
    const tab1 = (await adapter.createTab()).tab;
    const tab2 = (await adapter.createTab()).tab;
    const tab3 = (await adapter.createTab()).tab;

    const p1 = adapter.getProcessForTab(tab1.id)!;
    const p2 = adapter.getProcessForTab(tab2.id)!;

    mockPM.emitCrash(p1, new Error('tab1 crash'));
    expect(tab1.state).toBe(TabContextState.Crashed);
    expect(tab2.state).not.toBe(TabContextState.Crashed);
    expect(tab3.state).not.toBe(TabContextState.Crashed);

    mockPM.emitCrash(p2, new Error('tab2 crash'));
    expect(tab2.state).toBe(TabContextState.Crashed);
    expect(tab3.state).not.toBe(TabContextState.Crashed);
  });

  it('destroying all tabs cleans up adapter state', async () => {
    await adapter.createTab();
    await adapter.createTab();
    await adapter.createTab();

    const bindings = adapter.getBindings();
    for (const b of bindings) {
      adapter.destroyTab(b.tabId);
    }

    expect(adapter.getBindings()).toHaveLength(0);
  });
});

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// 15. INTEGRATION: LIFECYCLE MANAGER CRASH â†’ REPORTER PIPELINE
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

describe('LifecycleManager crash â†’ CrashReporter integration', () => {
  it('lifecycle crash events can feed into CrashReporter', async () => {
    const engine = createMockBrowserEngine();
    const config = createMockAppConfig();
    const lm = new LifecycleManager(engine, config);
    const reporter = new CrashReporter({ logReports: false });

    lm.on('crashed', (e) => {
      if (e.kind === 'crashed') {
        const report = new CrashReportBuilder()
          .source('lifecycle-manager')
          .error(e.error)
          .severity('fatal')
          .phase(e.phase ?? 'unknown')
          .context('crashCount', e.crashCount)
          .build();
        reporter.report(report);
      }
    });

    lm.registerPhase({
      name: 'fail',
      order: 5,
      timeoutMs: 1_000,
      critical: true,
      startup: async () => { throw new Error('lifecycle failure'); },
    });

    try { await lm.start(); } catch { /* CrashError */ }
    expect(lm.state).toBe(LifecycleState.Crashed);
    expect(reporter.getReports()).toHaveLength(1);
    expect(reporter.getReports()[0]!.error.message).toContain('lifecycle failure');
    expect(reporter.getReports()[0]!.source).toBe('lifecycle-manager');

    lm.dispose();
    reporter.dispose();
  });
});

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// 16. EDGE CASES
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

describe('Edge cases', () => {
  it('TabContext crash with all phase types', () => {
    const phases: Array<'parse' | 'style' | 'layout' | 'paint' | 'script' | 'navigation' | 'unknown'> = [
      'parse', 'style', 'layout', 'paint', 'script', 'navigation', 'unknown',
    ];
    for (const phase of phases) {
      const ctx = new TabContext();
      ctx.crash(new Error(`crash-${phase}`), phase, 'url');
      expect(ctx.lastCrash!.phase).toBe(phase);
    }
  });

  it('ProcessGuard tracks recent errors', () => {
    const guard = new ProcessGuard({ installHandlers: false, logErrors: false });
    guard.recordError(new Error('recent'));
    expect(guard.hasRecentErrors(5000)).toBe(true);
    expect(guard.getErrorCount()).toBe(1);
    guard.dispose();
  });

  it('ProcessGuard history trimming', () => {
    const guard = new ProcessGuard({ installHandlers: false, logErrors: false, maxHistorySize: 3 });
    for (let i = 0; i < 10; i++) {
      guard.recordError(new Error(`err-${i}`));
    }
    expect(guard.getErrorHistory()).toHaveLength(3);
    expect(guard.getErrorHistory()[0]!.error.message).toBe('err-7');
    guard.dispose();
  });

  it('CrashReporter frequency window calculation', async () => {
    const reporter = new CrashReporter({
      logReports: false,
      frequencyWindowMs: 100,
    });
    reporter.report(new CrashReportBuilder()
      .source('tab-context').error(new Error('1')).severity('error').phase('p').build());
    const summary = reporter.getSummary();
    expect(summary.crashesPerMinute).toBeGreaterThan(0);
    reporter.dispose();
  });

  it('LifecycleManager dispose clears timers', () => {
    const engine = createMockBrowserEngine();
    const config = createMockAppConfig();
    const lm = new LifecycleManager(engine, config);
    lm.dispose();
    expect(lm.state).toBe(LifecycleState.Idle);
  });

  it('TabContextManager createContext returns unique contexts', () => {
    const mgr = new TabContextManager();
    const ctx1 = mgr.createContext();
    const ctx2 = mgr.createContext();
    expect(ctx1.id).not.toBe(ctx2.id);
    expect(mgr.getAllContexts()).toHaveLength(2);
    mgr.dispose();
  });

  it('TabContextManager getContext returns null for unknown', () => {
    const mgr = new TabContextManager();
    expect(mgr.getContext('unknown')).toBeNull();
    mgr.dispose();
  });

  it('TabContextManager destroyContext returns false for unknown', () => {
    const mgr = new TabContextManager();
    expect(mgr.destroyContext('unknown')).toBe(false);
    mgr.dispose();
  });

  it('ScriptGuard exec returns error result for non-ScriptGuardError', async () => {
    const guard = new ScriptGuard({ enabled: false });
    const result = await guard.exec(() => { throw new TypeError('type error'); });
    expect(result.completed).toBe(false);
  });
});
