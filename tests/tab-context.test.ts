import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TabContext, TabContextManager, TabContextState, DEFAULT_TAB_CONFIG } from '../src/browser/engine/tab-context';

describe('TabContext', () => {
  let ctx: TabContext;

  beforeEach(() => {
    ctx = new TabContext();
  });

  // ── Construction ──────────────────────────────────────────────────────

  it('creates with Idle state', () => {
    expect(ctx.state).toBe(TabContextState.Idle);
  });

  it('generates a unique ID', () => {
    const ctx2 = new TabContext();
    expect(ctx.id).toBeTruthy();
    expect(ctx2.id).toBeTruthy();
    expect(ctx.id).not.toBe(ctx2.id);
  });

  it('has default config', () => {
    const config = ctx.getConfig();
    expect(config.maxRecoveryAttempts).toBe(3);
    expect(config.phaseTimeoutMs).toBe(10_000);
    expect(config.autoRecover).toBe(false);
  });

  // ── State transitions ─────────────────────────────────────────────────

  it('setLoading transitions Idle → Loading', () => {
    ctx.setLoading('https://example.com');
    expect(ctx.state).toBe(TabContextState.Loading);
  });

  it('setActive transitions Loading → Active', () => {
    ctx.setLoading('https://example.com');
    ctx.setActive('Example');
    expect(ctx.state).toBe(TabContextState.Active);
  });

  it('crash transitions to Crashed state', () => {
    ctx.crash(new Error('fail'), 'parse', 'https://example.com');
    expect(ctx.state).toBe(TabContextState.Crashed);
  });

  it('setLoading is blocked in Crashed state', () => {
    ctx.crash(new Error('fail'), 'parse', 'https://example.com');
    ctx.setLoading('https://example.com');
    expect(ctx.state).toBe(TabContextState.Crashed);
  });

  it('all transitions blocked in Disposed state', () => {
    ctx.dispose();
    ctx.setLoading('https://example.com');
    expect(ctx.state).toBe(TabContextState.Disposed);
    ctx.setActive('title');
    expect(ctx.state).toBe(TabContextState.Disposed);
  });

  // ── Crash & Recovery ──────────────────────────────────────────────────

  it('crash records crashInfo with error, phase, timestamp, url', () => {
    const error = new Error('boom');
    const before = Date.now();
    ctx.crash(error, 'style', 'https://example.com');
    const after = Date.now();

    const info = ctx.lastCrash!;
    expect(info).not.toBeNull();
    expect(info.error).toBe(error);
    expect(info.phase).toBe('style');
    expect(info.url).toBe('https://example.com');
    expect(info.timestamp).toBeGreaterThanOrEqual(before);
    expect(info.timestamp).toBeLessThanOrEqual(after);
  });

  it('crash increments crashCount', () => {
    expect(ctx.crashCount).toBe(0);
    ctx.crash(new Error('a'), 'parse', 'https://a.com');
    expect(ctx.crashCount).toBe(1);
    ctx.crash(new Error('b'), 'layout', 'https://b.com');
    expect(ctx.crashCount).toBe(2);
  });

  it('recover returns true when crashed and under max attempts', () => {
    ctx.crash(new Error('fail'), 'script', 'https://example.com');
    expect(ctx.crashCount).toBe(1);
    const result = ctx.recover();
    expect(result).toBe(true);
    expect(ctx.state).toBe(TabContextState.Active);
  });

  it('recover returns false when crashCount >= maxRecoveryAttempts', () => {
    ctx.crash(new Error('a'), 'parse', 'https://a.com');
    ctx.crash(new Error('b'), 'style', 'https://b.com');
    ctx.crash(new Error('c'), 'layout', 'https://c.com');
    expect(ctx.crashCount).toBe(3);
    expect(ctx.recover()).toBe(false);
    expect(ctx.state).toBe(TabContextState.Crashed);
  });

  // ── Snapshots ─────────────────────────────────────────────────────────

  it('saveSnapshot stores url, title, timestamp', () => {
    const before = Date.now();
    ctx.saveSnapshot('https://example.com', 'Example');
    const after = Date.now();

    const snap = ctx.snapshot!;
    expect(snap).not.toBeNull();
    expect(snap.url).toBe('https://example.com');
    expect(snap.title).toBe('Example');
    expect(snap.timestamp).toBeGreaterThanOrEqual(before);
    expect(snap.timestamp).toBeLessThanOrEqual(after);
  });

  it('saveSnapshot emits snapshotSaved event', () => {
    const handler = vi.fn();
    ctx.on('snapshotSaved', handler);
    ctx.saveSnapshot('https://example.com', 'Example');
    expect(handler).toHaveBeenCalledOnce();
    expect(handler).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'snapshotSaved', url: 'https://example.com' }),
    );
  });

  // ── Events ────────────────────────────────────────────────────────────

  it('stateChanged fires on transitions', () => {
    const handler = vi.fn();
    ctx.on('stateChanged', handler);
    ctx.setLoading('https://example.com');
    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'stateChanged', from: TabContextState.Idle, to: TabContextState.Loading }),
    );
  });

  it('crashed event fires with crashInfo', () => {
    const handler = vi.fn();
    ctx.on('crashed', handler);
    const error = new Error('crash!');
    ctx.crash(error, 'paint', 'https://example.com');
    expect(handler).toHaveBeenCalledOnce();
    const event = handler.mock.calls[0][0];
    expect(event.kind).toBe('crashed');
    expect(event.crashInfo.error).toBe(error);
    expect(event.crashInfo.phase).toBe('paint');
  });

  it('recovered event fires on successful recovery', () => {
    const handler = vi.fn();
    ctx.on('recovered', handler);
    ctx.crash(new Error('fail'), 'script', 'https://example.com');
    ctx.recover();
    expect(handler).toHaveBeenCalledOnce();
    const event = handler.mock.calls[0][0];
    expect(event.kind).toBe('recovered');
    expect(event.attempt).toBe(1);
  });

  // ── Config ────────────────────────────────────────────────────────────

  it('getConfig returns a copy of config', () => {
    const config1 = ctx.getConfig();
    const config2 = ctx.getConfig();
    expect(config1).toEqual(config2);
    expect(config1).not.toBe(config2);
  });

  it('updateConfig merges partial config', () => {
    ctx.updateConfig({ maxRecoveryAttempts: 5 });
    const config = ctx.getConfig();
    expect(config.maxRecoveryAttempts).toBe(5);
    expect(config.phaseTimeoutMs).toBe(DEFAULT_TAB_CONFIG.phaseTimeoutMs);
    expect(config.autoRecover).toBe(DEFAULT_TAB_CONFIG.autoRecover);
  });

  // ── Dispose ───────────────────────────────────────────────────────────

  it('dispose transitions to Disposed', () => {
    ctx.dispose();
    expect(ctx.state).toBe(TabContextState.Disposed);
  });

  it('dispose clears event loop', () => {
    const clearSpy = vi.spyOn(ctx.eventLoop, 'clear');
    ctx.dispose();
    expect(clearSpy).toHaveBeenCalledOnce();
  });
});

describe('TabContextManager', () => {
  let manager: TabContextManager;

  beforeEach(() => {
    manager = new TabContextManager();
  });

  it('createContext returns TabContext and stores it', () => {
    const ctx = manager.createContext();
    expect(ctx).toBeInstanceOf(TabContext);
    expect(manager.getContext(ctx.id)).toBe(ctx);
  });

  it('getContext returns context by ID', () => {
    const ctx = manager.createContext();
    expect(manager.getContext(ctx.id)).toBe(ctx);
  });

  it('getContext returns null for unknown ID', () => {
    expect(manager.getContext('nonexistent-id')).toBeNull();
  });

  it('destroyContext disposes and removes context', () => {
    const ctx = manager.createContext();
    const disposeSpy = vi.spyOn(ctx, 'dispose');
    const result = manager.destroyContext(ctx.id);
    expect(result).toBe(true);
    expect(disposeSpy).toHaveBeenCalledOnce();
    expect(manager.getContext(ctx.id)).toBeNull();
  });
});
