import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  TabProcessManager,
  TabProcessEventBus,
  DEFAULT_ADAPTER_CONFIG,
} from '../src/browser/engine/tab-process-adapter';
import type { ITabContextManager, TabContext } from '../src/browser/engine/tab-context';
import { TabContextManager, TabContextState } from '../src/browser/engine/tab-context';
import type { IProcessManager, ProcessBusEvent } from '../src/common/ipc/process-manager';
import { ProcessState, ProcessEventBus } from '../src/common/ipc/process-manager';

// ─────────────────────────────────────────────────────────────────────────────
// Mock Process Manager
// ─────────────────────────────────────────────────────────────────────────────

class MockProcessManager implements IProcessManager {
  private processes = new Map<string, any>();
  private tabToProcess = new Map<string, string>();
  private bus = new ProcessEventBus();
  private seq = 0;

  async spawnProcess(tabId?: string): Promise<string> {
    const processId = `mock-proc-${(++this.seq).toString(36)}`;
    this.processes.set(processId, {
      id: processId,
      tabId,
      state: ProcessState.Ready,
      spawnedAt: Date.now(),
      readyAt: Date.now(),
      crashCount: 0,
      transport: {},
      channelManager: { dispose: () => {}, getChannel: () => ({}) },
    });
    if (tabId) this.tabToProcess.set(tabId, processId);

    this.bus.emit({ kind: 'processSpawned', processId, tabId });
    this.bus.emit({ kind: 'processReady', processId, tabId });
    return processId;
  }

  async destroyProcess(processId: string): Promise<boolean> {
    const info = this.processes.get(processId);
    if (!info) return false;
    this.processes.delete(processId);
    if (info.tabId) this.tabToProcess.delete(info.tabId);
    this.bus.emit({ kind: 'processExited', processId, tabId: info.tabId, exitCode: 0 });
    return true;
  }

  getProcess(processId: string) { return this.processes.get(processId) ?? null; }
  getAllProcesses() { return [...this.processes.values()]; }
  getProcessForTab(tabId: string) {
    const pid = this.tabToProcess.get(tabId);
    return pid ? this.processes.get(pid) ?? null : null;
  }
  createProxy() { return {} as any; }
  on(type: any, handler: any) { this.bus.on(type, handler); }
  off(type: any, handler: any) { this.bus.off(type, handler); }
  dispose() { this.bus.dispose(); this.processes.clear(); this.tabToProcess.clear(); }

  /** Expose bus for simulating events in tests */
  emitCrash(processId: string, error: Error) {
    this.bus.emit({
      kind: 'processCrashed',
      processId,
      error,
      crashCount: 1,
    });
  }

  emitExit(processId: string) {
    const info = this.processes.get(processId);
    const tabId = info?.tabId;
    this.processes.delete(processId);
    if (tabId) this.tabToProcess.delete(tabId);
    this.bus.emit({ kind: 'processExited', processId, tabId, exitCode: 1 });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Tests: TabProcessManager
// ─────────────────────────────────────────────────────────────────────────────

describe('TabProcessManager', () => {
  let processManager: MockProcessManager;
  let tabManager: TabContextManager;
  let adapter: TabProcessManager;

  beforeEach(() => {
    processManager = new MockProcessManager();
    tabManager = new TabContextManager();
    adapter = new TabProcessManager(processManager, tabManager, {
      autoSpawnProcess: true,
      autoDestroyProcess: true,
      forwardProcessCrashes: true,
      forwardTabCrashes: true,
    });
  });

  describe('createTab', () => {
    it('creates a tab context and spawns a process', async () => {
      const { tab, processId } = await adapter.createTab();

      expect(tab).toBeDefined();
      expect(tab.id).toBeTruthy();
      expect(processId).toBeTruthy();
      expect(processId).not.toBe('none');
    });

    it('creates binding between tab and process', async () => {
      const { tab, processId } = await adapter.createTab();

      expect(adapter.getProcessForTab(tab.id)).toBe(processId);
      expect(adapter.getTabForProcess(processId)).toBe(tab);
    });

    it('emits tabProcessCreated event', async () => {
      const handler = vi.fn();
      adapter.on('tabProcessCreated', handler);

      const { tab, processId } = await adapter.createTab();

      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          kind: 'tabProcessCreated',
          tabId: tab.id,
          processId,
        }),
      );
    });

    it('creates tab without process when autoSpawnProcess is false', async () => {
      const noProcessAdapter = new TabProcessManager(processManager, tabManager, {
        autoSpawnProcess: false,
      });

      const { tab, processId } = await noProcessAdapter.createTab();

      expect(processId).toBe('none');
      expect(noProcessAdapter.getProcessForTab(tab.id)).toBeNull();
    });
  });

  describe('destroyTab', () => {
    it('destroys both tab and process', async () => {
      const { tab, processId } = await adapter.createTab();

      const result = adapter.destroyTab(tab.id);

      expect(result).toBe(true);
      expect(adapter.getProcessForTab(tab.id)).toBeNull();
      expect(processManager.getProcess(processId)).toBeNull();
    });

    it('emits tabProcessDestroyed event', async () => {
      const { tab } = await adapter.createTab();
      const handler = vi.fn();
      adapter.on('tabProcessDestroyed', handler);

      adapter.destroyTab(tab.id);

      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          kind: 'tabProcessDestroyed',
          tabId: tab.id,
        }),
      );
    });

    it('returns false for non-existent tab', () => {
      expect(adapter.destroyTab('nonexistent')).toBe(false);
    });
  });

  describe('getBindings', () => {
    it('returns all tab-process bindings', async () => {
      await adapter.createTab();
      await adapter.createTab();

      const bindings = adapter.getBindings();
      expect(bindings.length).toBe(2);
      expect(bindings[0].tabId).toBeTruthy();
      expect(bindings[0].processId).toBeTruthy();
    });

    it('returns empty array when no tabs exist', () => {
      expect(adapter.getBindings()).toEqual([]);
    });
  });

  describe('process crash → tab crash forwarding', () => {
    it('forwards process crash to tab context', async () => {
      const { tab, processId } = await adapter.createTab();
      const error = new Error('Process crashed');

      processManager.emitCrash(processId, error);

      expect(tab.state).toBe(TabContextState.Crashed);
      expect(tab.lastCrash).not.toBeNull();
      expect(tab.lastCrash!.error).toBe(error);
    });

    it('emits tabProcessCrashed event', async () => {
      const { tab, processId } = await adapter.createTab();
      const handler = vi.fn();
      adapter.on('tabProcessCrashed', handler);

      const error = new Error('Process failure');
      processManager.emitCrash(processId, error);

      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          kind: 'tabProcessCrashed',
          tabId: tab.id,
          processId,
          error,
        }),
      );
    });

    it('does not forward when forwardProcessCrashes is false', async () => {
      const noForward = new TabProcessManager(processManager, tabManager, {
        forwardProcessCrashes: false,
      });
      const { tab, processId } = await noForward.createTab();

      processManager.emitCrash(processId, new Error('crash'));

      expect(tab.state).toBe(TabContextState.Idle);
    });
  });

  describe('process exit → tab orphan cleanup', () => {
    it('destroys the tab when its process exits permanently', async () => {
      const { tab, processId } = await adapter.createTab();

      processManager.emitExit(processId);

      // Tab should be destroyed, not orphaned
      expect(adapter.getProcessForTab(tab.id)).toBeNull();
      expect(adapter.getTabForProcess(processId)).toBeNull();
      expect(tabManager.getContext(tab.id)).toBeNull();
    });

    it('emits tabProcessDestroyed on process exit', async () => {
      const { tab, processId } = await adapter.createTab();
      const handler = vi.fn();
      adapter.on('tabProcessDestroyed', handler);

      processManager.emitExit(processId);

      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          kind: 'tabProcessDestroyed',
          tabId: tab.id,
          processId,
        }),
      );
    });

    it('does not destroy tab when autoDestroyProcess is false', async () => {
      const noAutoDestroy = new TabProcessManager(processManager, tabManager, {
        autoSpawnProcess: true,
        autoDestroyProcess: false,
        forwardProcessCrashes: true,
        forwardTabCrashes: true,
      });
      const { tab, processId } = await noAutoDestroy.createTab();

      processManager.emitExit(processId);

      // Mapping cleaned up but tab still exists
      expect(noAutoDestroy.getProcessForTab(tab.id)).toBeNull();
      expect(tabManager.getContext(tab.id)).not.toBeNull();
    });
  });

  describe('dispose', () => {
    it('destroys all tabs and cleans up', async () => {
      await adapter.createTab();
      await adapter.createTab();

      adapter.dispose();

      expect(adapter.getBindings().length).toBe(0);
      expect(tabManager.getAllContexts().length).toBe(0);
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Tests: TabProcessEventBus
// ─────────────────────────────────────────────────────────────────────────────

describe('TabProcessEventBus', () => {
  it('delivers events to handlers', () => {
    const bus = new TabProcessEventBus();
    const handler = vi.fn();
    bus.on('tabProcessCreated', handler);

    bus.emit({ kind: 'tabProcessCreated', tabId: 't1', processId: 'p1' });

    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('catches handler errors without crashing', () => {
    const bus = new TabProcessEventBus();
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    bus.on('tabProcessCreated', () => { throw new Error('handler error'); });

    expect(() => {
      bus.emit({ kind: 'tabProcessCreated', tabId: 't1', processId: 'p1' });
    }).not.toThrow();

    expect(consoleSpy).toHaveBeenCalled();
    consoleSpy.mockRestore();
  });

  it('off removes handler', () => {
    const bus = new TabProcessEventBus();
    const handler = vi.fn();
    bus.on('tabProcessCreated', handler);
    bus.off('tabProcessCreated', handler);

    bus.emit({ kind: 'tabProcessCreated', tabId: 't1', processId: 'p1' });

    expect(handler).not.toHaveBeenCalled();
  });

  it('dispose clears all handlers', () => {
    const bus = new TabProcessEventBus();
    const handler = vi.fn();
    bus.on('tabProcessCreated', handler);
    bus.dispose();

    bus.emit({ kind: 'tabProcessCreated', tabId: 't1', processId: 'p1' });

    expect(handler).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Tests: DEFAULT_ADAPTER_CONFIG
// ─────────────────────────────────────────────────────────────────────────────

describe('DEFAULT_ADAPTER_CONFIG', () => {
  it('has sensible defaults', () => {
    expect(DEFAULT_ADAPTER_CONFIG.autoSpawnProcess).toBe(true);
    expect(DEFAULT_ADAPTER_CONFIG.autoDestroyProcess).toBe(true);
    expect(DEFAULT_ADAPTER_CONFIG.forwardProcessCrashes).toBe(true);
    expect(DEFAULT_ADAPTER_CONFIG.forwardTabCrashes).toBe(true);
  });
});
