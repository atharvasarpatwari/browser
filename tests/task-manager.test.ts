import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  TaskManager, createTaskManager, DEFAULT_TASK_MANAGER_CONFIG,
  type ProcessRegistrationInfo, type ProcessType,
} from '../src/browser/engine/task-manager';

function reg(overrides?: Partial<ProcessRegistrationInfo>): ProcessRegistrationInfo {
  return {
    processId: 'proc-1',
    tabId: 'tab-1',
    url: 'https://example.com',
    title: 'Example',
    processType: 'renderer',
    ...overrides,
  };
}

describe('TaskManager', () => {
  let tm: TaskManager;

  beforeEach(() => {
    tm = createTaskManager({ sampleIntervalMs: 60_000 });
  });

  afterEach(async () => {
    await tm.shutdown();
  });

  // ── Lifecycle ──

  it('initializes and shuts down cleanly', async () => {
    await tm.initialize();
    await tm.shutdown();
  });

  it('double-initialize is safe', async () => {
    await tm.initialize();
    await tm.initialize();
    await tm.shutdown();
  });

  // ── Register / Unregister ──

  it('registers a process', () => {
    tm.registerProcess(reg());
    const usage = tm.getProcessUsage('proc-1');
    expect(usage).toBeDefined();
    expect(usage!.processId).toBe('proc-1');
    expect(usage!.tabId).toBe('tab-1');
    expect(usage!.url).toBe('https://example.com');
    expect(usage!.processType).toBe('renderer');
    expect(usage!.state).toBe('running');
  });

  it('does not double-register', () => {
    tm.registerProcess(reg());
    tm.registerProcess(reg({ processId: 'proc-1', title: 'Changed' }));
    const all = tm.getAllProcessUsages();
    expect(all).toHaveLength(1);
    expect(all[0].title).toBe('Example');
  });

  it('unregisters a process', () => {
    tm.registerProcess(reg());
    tm.unregisterProcess('proc-1');
    expect(tm.getProcessUsage('proc-1')).toBeUndefined();
  });

  it('unregister non-existent is safe', () => {
    tm.unregisterProcess('no-such-process');
  });

  it('registers multiple processes', () => {
    tm.registerProcess(reg({ processId: 'p1' }));
    tm.registerProcess(reg({ processId: 'p2', processType: 'gpu' }));
    tm.registerProcess(reg({ processId: 'p3', processType: 'network' }));
    expect(tm.getAllProcessUsages()).toHaveLength(3);
  });

  // ── Update Metrics ──

  it('updates process metrics', () => {
    tm.registerProcess(reg());
    tm.updateProcessMetrics('proc-1', {
      cpuUsage: 45.5,
      memoryBytes: 1024 * 1024 * 100,
    });
    const usage = tm.getProcessUsage('proc-1');
    expect(usage!.cpuUsage).toBe(45.5);
    expect(usage!.memoryBytes).toBe(1024 * 1024 * 100);
    expect(usage!.memoryFormatted).toBe('100 MB');
    expect(usage!.lastUpdated).toBeGreaterThan(0);
  });

  it('updates network metrics', () => {
    tm.registerProcess(reg());
    tm.updateProcessMetrics('proc-1', {
      networkReceivedBytes: 1024 * 512,
      networkSentBytes: 1024,
    });
    const usage = tm.getProcessUsage('proc-1');
    expect(usage!.networkReceivedFormatted).toBe('512 KB');
    expect(usage!.networkSentFormatted).toBe('1 KB');
  });

  it('update metrics for non-existent process is safe', () => {
    tm.updateProcessMetrics('no-such', { cpuUsage: 10 });
  });

  // ── Snapshots ──

  it('takes a snapshot', () => {
    tm.registerProcess(reg({ processId: 'p1' }));
    tm.updateProcessMetrics('p1', { cpuUsage: 20, memoryBytes: 1024 });
    const snap = tm.takeSnapshot();
    expect(snap.timestamp).toBeGreaterThan(0);
    expect(snap.processes).toHaveLength(1);
    expect(snap.totalCpuUsage).toBe(20);
    expect(snap.totalMemoryBytes).toBe(1024);
    expect(snap.totalMemoryFormatted).toBe('1 KB');
  });

  it('retains snapshots up to maxSnapshots', () => {
    const small = createTaskManager({ maxSnapshots: 3, sampleIntervalMs: 60000 });
    small.registerProcess(reg());
    for (let i = 0; i < 5; i++) small.takeSnapshot();
    expect(small.getSnapshots()).toHaveLength(3);
  });

  it('clearSnapshots empties the list', () => {
    tm.registerProcess(reg());
    tm.takeSnapshot();
    tm.takeSnapshot();
    tm.clearSnapshots();
    expect(tm.getSnapshots()).toHaveLength(0);
  });

  it('snapshots are sorted by memory (highest first) within processes', () => {
    tm.registerProcess(reg({ processId: 'p1' }));
    tm.registerProcess(reg({ processId: 'p2', processType: 'gpu' }));
    tm.updateProcessMetrics('p1', { memoryBytes: 500 });
    tm.updateProcessMetrics('p2', { memoryBytes: 1000 });
    const snap = tm.takeSnapshot();
    expect(snap.processes[0].processId).toBe('p2');
    expect(snap.processes[1].processId).toBe('p1');
  });

  // ── Kill Process ──

  it('killProcess returns false for unknown process', () => {
    expect(tm.killProcess('no-such')).toBe(false);
  });

  it('killProcess invokes callback', async () => {
    const killCb = vi.fn();
    tm.registerProcess(reg({ killCallback: killCb }));
    expect(tm.killProcess('proc-1')).toBe(true);
    expect(killCb).toHaveBeenCalledOnce();
    const usage = tm.getProcessUsage('proc-1');
    expect(usage!.state).toBe('killed');
  });

  it('killProcess handles callback error gracefully', () => {
    tm.registerProcess(reg({ killCallback: () => { throw new Error('boom'); } }));
    expect(tm.killProcess('proc-1')).toBe(true);
  });

  // ── Aggregate Stats ──

  it('aggregate stats combine all processes', () => {
    tm.registerProcess(reg({ processId: 'p1', processType: 'renderer' }));
    tm.registerProcess(reg({ processId: 'p2', processType: 'renderer' }));
    tm.registerProcess(reg({ processId: 'p3', processType: 'gpu' }));
    tm.updateProcessMetrics('p1', { cpuUsage: 30, memoryBytes: 100 });
    tm.updateProcessMetrics('p2', { cpuUsage: 20, memoryBytes: 200 });
    tm.updateProcessMetrics('p3', { cpuUsage: 10, memoryBytes: 50 });

    const stats = tm.getAggregateStats();
    expect(stats.totalProcesses).toBe(3);
    expect(stats.totalCpuUsage).toBe(60);
    expect(stats.totalMemoryBytes).toBe(350);
    expect(stats.processesByType.renderer).toBe(2);
    expect(stats.processesByType.gpu).toBe(1);
    expect(stats.averageCpuPerProcess).toBeCloseTo(20);
  });

  it('aggregate stats tracks peak memory across snapshots', () => {
    tm.registerProcess(reg({ processId: 'p1' }));
    tm.updateProcessMetrics('p1', { memoryBytes: 100 });
    tm.takeSnapshot();
    tm.updateProcessMetrics('p1', { memoryBytes: 500 });
    tm.takeSnapshot();
    const stats = tm.getAggregateStats();
    expect(stats.peakMemoryBytes).toBe(500);
  });

  // ── Events ──

  it('emits process-added on register', () => {
    const handler = vi.fn();
    tm.onEvent(handler);
    tm.registerProcess(reg());
    expect(handler).toHaveBeenCalledWith({ type: 'process-added', processId: 'proc-1' });
  });

  it('emits process-removed on unregister', () => {
    tm.registerProcess(reg());
    const handler = vi.fn();
    tm.onEvent(handler);
    tm.unregisterProcess('proc-1');
    expect(handler).toHaveBeenCalledWith({ type: 'process-removed', processId: 'proc-1' });
  });

  it('emits process-updated on metrics update', () => {
    tm.registerProcess(reg());
    const handler = vi.fn();
    tm.onEvent(handler);
    tm.updateProcessMetrics('proc-1', { cpuUsage: 50 });
    expect(handler).toHaveBeenCalledWith({ type: 'process-updated', processId: 'proc-1' });
  });

  it('emits snapshot-taken', () => {
    const handler = vi.fn();
    tm.onEvent(handler);
    tm.takeSnapshot();
    expect(handler).toHaveBeenCalledOnce();
    expect(handler.mock.calls[0][0].type).toBe('snapshot-taken');
    expect(handler.mock.calls[0][0].snapshot).toBeDefined();
  });

  it('emits process-killed', () => {
    tm.registerProcess(reg({ killCallback: vi.fn() }));
    const handler = vi.fn();
    tm.onEvent(handler);
    tm.killProcess('proc-1');
    expect(handler).toHaveBeenCalledWith({ type: 'process-killed', processId: 'proc-1' });
  });

  it('unsubscribe stops events', () => {
    const handler = vi.fn();
    const unsub = tm.onEvent(handler);
    unsub();
    tm.registerProcess(reg());
    expect(handler).not.toHaveBeenCalled();
  });

  it('event handler errors do not crash', () => {
    tm.onEvent(() => { throw new Error('bad handler'); });
    tm.registerProcess(reg());
    expect(tm.getProcessUsage('proc-1')).toBeDefined();
  });

  // ── Auto-sampling ──

  it('auto-samples on interval', async () => {
    const fast = createTaskManager({ sampleIntervalMs: 50 });
    await fast.initialize();
    fast.registerProcess(reg());
    await new Promise(r => setTimeout(r, 200));
    const snaps = fast.getSnapshots();
    expect(snaps.length).toBeGreaterThanOrEqual(2);
    await fast.shutdown();
  });

  // ── Default Config ──

  it('DEFAULT_TASK_MANAGER_CONFIG has sensible values', () => {
    expect(DEFAULT_TASK_MANAGER_CONFIG.sampleIntervalMs).toBe(5000);
    expect(DEFAULT_TASK_MANAGER_CONFIG.maxSnapshots).toBe(120);
    expect(DEFAULT_TASK_MANAGER_CONFIG.includeGpu).toBe(true);
    expect(DEFAULT_TASK_MANAGER_CONFIG.includeNetwork).toBe(true);
  });

  // ── formatBytes edge cases ──

  it('getAllProcessUsages returns sorted by memory desc', () => {
    tm.registerProcess(reg({ processId: 'p1' }));
    tm.registerProcess(reg({ processId: 'p2' }));
    tm.updateProcessMetrics('p1', { memoryBytes: 100 });
    tm.updateProcessMetrics('p2', { memoryBytes: 500 });
    const all = tm.getAllProcessUsages();
    expect(all[0].processId).toBe('p2');
    expect(all[1].processId).toBe('p1');
  });
});
