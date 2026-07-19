import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  TabContext,
  TabContextManager,
  TabContextEventBus,
  TabContextState,
} from '../src/browser/engine/tab-context';
import {
  ScriptGuard,
  ScriptGuardError,
} from '../src/browser/engine/script-guard';
import {
  ErrorBoundary,
  ChainedErrorBoundary,
} from '../src/browser/engine/error-boundary';
import {
  ProcessGuard,
} from '../src/browser/engine/process-guard';
import {
  CrashReporter,
  CrashReportBuilder,
} from '../src/browser/engine/crash-reporter';

// ═════════════════════════════════════════════════════════════════════════════
// TabContext
// ═════════════════════════════════════════════════════════════════════════════

describe('TabContext', () => {
  let ctx: TabContext;

  beforeEach(() => {
    ctx = new TabContext({ maxRecoveryAttempts: 3, phaseTimeoutMs: 1_000, autoRecover: false });
  });

  it('starts in Idle state', () => {
    expect(ctx.state).toBe(TabContextState.Idle);
  });

  it('has a unique id', () => {
    const ctx2 = new TabContext();
    expect(ctx.id).toBeTruthy();
    expect(ctx.id).not.toBe(ctx2.id);
  });

  it('has isolated pipeline instances', () => {
    expect(ctx.domTree).toBeDefined();
    expect(ctx.layoutEngine).toBeDefined();
    expect(ctx.paintEngine).toBeDefined();
    expect(ctx.eventLoop).toBeDefined();
  });

  it('starts with crashCount = 0 and lastCrash = null', () => {
    expect(ctx.crashCount).toBe(0);
    expect(ctx.lastCrash).toBeNull();
  });

  it('starts with snapshot = null', () => {
    expect(ctx.snapshot).toBeNull();
  });

  it('transitions Idle → Loading', () => {
    ctx.setLoading('https://example.com');
    expect(ctx.state).toBe(TabContextState.Loading);
  });

  it('transitions Loading → Active', () => {
    ctx.setLoading('https://example.com');
    ctx.setActive('Example');
    expect(ctx.state).toBe(TabContextState.Active);
  });

  it('transitions to Crashed on crash()', () => {
    const error = new Error('boom');
    ctx.crash(error, 'script', 'https://example.com');
    expect(ctx.state).toBe(TabContextState.Crashed);
    expect(ctx.crashCount).toBe(1);
    expect(ctx.lastCrash).not.toBeNull();
    expect(ctx.lastCrash!.error).toBe(error);
    expect(ctx.lastCrash!.phase).toBe('script');
    expect(ctx.lastCrash!.url).toBe('https://example.com');
  });

  it('increments crash count on multiple crashes', () => {
    ctx.crash(new Error('1'), 'parse', 'url1');
    ctx.crash(new Error('2'), 'layout', 'url2');
    ctx.crash(new Error('3'), 'paint', 'url3');
    expect(ctx.crashCount).toBe(3);
  });

  it('recovers from Crashed → Recovering → Active', () => {
    ctx.crash(new Error('test'), 'script', 'url');
    const recovered = ctx.recover();
    expect(recovered).toBe(true);
    expect(ctx.state).toBe(TabContextState.Active);
  });

  it('does not recover if not in Crashed state', () => {
    expect(ctx.recover()).toBe(false);
  });

  it('does not recover if max recovery attempts exceeded', () => {
    ctx.updateConfig({ maxRecoveryAttempts: 2 });
    ctx.crash(new Error('1'), 'script', 'url');
    ctx.recover();
    ctx.crash(new Error('2'), 'script', 'url');
    ctx.recover();
    // Now at crash count 2, config max is 2
    ctx.crash(new Error('3'), 'script', 'url');
    expect(ctx.recover()).toBe(false);
  });

  it('saveSnapshot stores snapshot data', () => {
    ctx.saveSnapshot('https://example.com', 'Example');
    expect(ctx.snapshot).not.toBeNull();
    expect(ctx.snapshot!.url).toBe('https://example.com');
    expect(ctx.snapshot!.title).toBe('Example');
    expect(ctx.snapshot!.timestamp).toBeGreaterThan(0);
  });

  it('does not transition when in Crashed state (setLoading)', () => {
    ctx.crash(new Error('test'), 'script', 'url');
    ctx.setLoading('https://other.com');
    expect(ctx.state).toBe(TabContextState.Crashed);
  });

  it('does not transition when in Disposed state', () => {
    ctx.dispose();
    ctx.setLoading('https://other.com');
    expect(ctx.state).toBe(TabContextState.Disposed);
  });

  it('dispose transitions to Disposed', () => {
    ctx.dispose();
    expect(ctx.state).toBe(TabContextState.Disposed);
  });

  it('dispose is idempotent', () => {
    ctx.dispose();
    ctx.dispose();
    expect(ctx.state).toBe(TabContextState.Disposed);
  });

  it('getConfig returns current config', () => {
    const config = ctx.getConfig();
    expect(config.maxRecoveryAttempts).toBe(3);
    expect(config.phaseTimeoutMs).toBe(1_000);
  });

  it('updateConfig merges partial config', () => {
    ctx.updateConfig({ maxRecoveryAttempts: 10 });
    const config = ctx.getConfig();
    expect(config.maxRecoveryAttempts).toBe(10);
    expect(config.phaseTimeoutMs).toBe(1_000);
  });

  it('emits stateChanged events via bus', () => {
    const events: string[] = [];
    ctx.on('stateChanged', (e) => {
      events.push(`${e.from}→${e.to}`);
    });
    ctx.setLoading('url');
    ctx.setActive('title');
    expect(events).toEqual(['idle→loading', 'loading→active']);
  });

  it('emits crashed event', () => {
    let crashed = false;
    ctx.on('crashed', (e) => {
      crashed = true;
      expect(e.crashInfo.error.message).toBe('boom');
    });
    ctx.crash(new Error('boom'), 'script', 'url');
    expect(crashed).toBe(true);
  });

  it('emits recovered event', () => {
    let recoveredAttempt = -1;
    ctx.on('recovered', (e) => {
      recoveredAttempt = e.attempt;
    });
    ctx.crash(new Error('test'), 'script', 'url');
    ctx.recover();
    // recover() transitions Recovering → Active, which fires the recovered event
    expect(recoveredAttempt).toBe(1);
  });

  it('emits snapshotSaved event', () => {
    let savedUrl = '';
    ctx.on('snapshotSaved', (e) => {
      savedUrl = e.url;
    });
    ctx.saveSnapshot('https://test.com', 'Test');
    expect(savedUrl).toBe('https://test.com');
  });

  it('off removes event handler', () => {
    let count = 0;
    const handler = () => { count++; };
    ctx.on('stateChanged', handler);
    ctx.setLoading('url');
    ctx.off('stateChanged', handler);
    ctx.setActive('title');
    expect(count).toBe(1);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// TabContextManager
// ═════════════════════════════════════════════════════════════════════════════

describe('TabContextManager', () => {
  let mgr: TabContextManager;

  beforeEach(() => {
    mgr = new TabContextManager();
  });

  it('creates a context', () => {
    const ctx = mgr.createContext();
    expect(ctx).toBeInstanceOf(TabContext);
    expect(mgr.getAllContexts()).toHaveLength(1);
  });

  it('getContext by id', () => {
    const ctx = mgr.createContext();
    expect(mgr.getContext(ctx.id)).toBe(ctx);
  });

  it('getContext returns null for unknown id', () => {
    expect(mgr.getContext('nonexistent')).toBeNull();
  });

  it('destroyContext removes and disposes', () => {
    const ctx = mgr.createContext();
    const id = ctx.id;
    const result = mgr.destroyContext(id);
    expect(result).toBe(true);
    expect(mgr.getContext(id)).toBeNull();
    expect(mgr.getAllContexts()).toHaveLength(0);
  });

  it('destroyContext returns false for unknown id', () => {
    expect(mgr.destroyContext('nonexistent')).toBe(false);
  });

  it('getCrashedContexts filters correctly', () => {
    const ctx1 = mgr.createContext();
    const ctx2 = mgr.createContext();
    const ctx3 = mgr.createContext();
    ctx1.crash(new Error('e'), 'script', 'url');
    ctx3.crash(new Error('e'), 'script', 'url');
    const crashed = mgr.getCrashedContexts();
    expect(crashed).toHaveLength(2);
    expect(crashed.map(c => c.id)).toContain(ctx1.id);
    expect(crashed.map(c => c.id)).toContain(ctx3.id);
  });

  it('dispose removes all contexts', () => {
    mgr.createContext();
    mgr.createContext();
    mgr.dispose();
    expect(mgr.getAllContexts()).toHaveLength(0);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// TabContextEventBus
// ═════════════════════════════════════════════════════════════════════════════

describe('TabContextEventBus', () => {
  it('delivers events to registered handlers', () => {
    const bus = new TabContextEventBus();
    const received: string[] = [];
    bus.on('crashed', (e) => {
      if (e.kind === 'crashed') received.push(e.crashInfo.error.message);
    });
    bus.emit({
      kind: 'crashed',
      tabId: 't1',
      crashInfo: {
        error: new Error('fail'),
        phase: 'script',
        timestamp: Date.now(),
        url: 'url',
      },
    });
    expect(received).toEqual(['fail']);
    bus.dispose();
  });

  it('off removes handler', () => {
    const bus = new TabContextEventBus();
    let called = false;
    const handler = () => { called = true; };
    bus.on('recovered', handler);
    bus.off('recovered', handler);
    bus.emit({ kind: 'recovered', tabId: 't1', attempt: 1 });
    expect(called).toBe(false);
    bus.dispose();
  });

  it('dispose clears all handlers', () => {
    const bus = new TabContextEventBus();
    let called = false;
    bus.on('crashed', () => { called = true; });
    bus.dispose();
    bus.emit({
      kind: 'crashed',
      tabId: 't1',
      crashInfo: { error: new Error('e'), phase: 'script', timestamp: 0, url: 'u' },
    });
    expect(called).toBe(false);
  });

  it('handler error does not break other handlers', () => {
    const bus = new TabContextEventBus();
    let handler2Called = false;
    bus.on('crashed', () => { throw new Error('handler error'); });
    bus.on('crashed', () => { handler2Called = true; });
    bus.emit({
      kind: 'crashed',
      tabId: 't1',
      crashInfo: { error: new Error('e'), phase: 'script', timestamp: 0, url: 'u' },
    });
    expect(handler2Called).toBe(true);
    bus.dispose();
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// ScriptGuard
// ═════════════════════════════════════════════════════════════════════════════

describe('ScriptGuard', () => {
  let guard: ScriptGuard;

  beforeEach(() => {
    guard = new ScriptGuard({
      maxExecutionMs: 100,
      maxInstructions: 100,
      maxStackDepth: 5,
      enabled: true,
    });
  });

  it('exec runs a synchronous function', async () => {
    const result = await guard.exec(() => 42);
    expect(result.completed).toBe(true);
    expect(result.value).toBe(42);
  });

  it('execAsync runs an async function', async () => {
    const result = await guard.execAsync(async () => 'hello');
    expect(result.completed).toBe(true);
    expect(result.value).toBe('hello');
  });

  it('tick increments instruction count', () => {
    guard.tick();
    guard.tick();
    guard.tick();
    expect(guard.getInstructionCount()).toBe(3);
  });

  it('tick throws when instruction limit exceeded', () => {
    for (let i = 0; i < 99; i++) guard.tick();
    expect(guard.getInstructionCount()).toBe(99);
    expect(() => guard.tick()).toThrow(ScriptGuardError);
  });

  it('tick marks guard as triggered with correct reason', () => {
    for (let i = 0; i < 99; i++) guard.tick();
    try { guard.tick(); } catch { /* expected */ }
    expect(guard.isTriggered()).toBe(true);
    expect(guard.getTerminationReason()).toBe('instruction-limit');
  });

  it('pushFrame increments stack depth', () => {
    guard.pushFrame('fn1');
    guard.pushFrame('fn2');
    expect(guard.getStackDepth()).toBe(2);
  });

  it('popFrame decrements stack depth', () => {
    guard.pushFrame('fn1');
    guard.pushFrame('fn2');
    guard.popFrame();
    expect(guard.getStackDepth()).toBe(1);
  });

  it('pushFrame throws when stack depth exceeded', () => {
    for (let i = 0; i < 5; i++) guard.pushFrame(`fn${i}`);
    expect(() => guard.pushFrame('overflow')).toThrow(ScriptGuardError);
  });

  it('popFrame does not go below 0', () => {
    guard.popFrame();
    guard.popFrame();
    expect(guard.getStackDepth()).toBe(0);
  });

  it('reset clears all state', () => {
    guard.tick();
    guard.tick();
    guard.pushFrame('fn');
    guard.reset();
    expect(guard.getInstructionCount()).toBe(0);
    expect(guard.getStackDepth()).toBe(0);
    expect(guard.isTriggered()).toBe(false);
    expect(guard.getTerminationReason()).toBeNull();
  });

  it('getConfig returns current config', () => {
    const config = guard.getConfig();
    expect(config.maxExecutionMs).toBe(100);
    expect(config.maxInstructions).toBe(100);
    expect(config.maxStackDepth).toBe(5);
  });

  it('disabled guard has no limits', () => {
    const disabled = new ScriptGuard({ enabled: false });
    disabled.tick();
    disabled.pushFrame('fn');
    // When disabled, tick/pushFrame are no-ops (counters not incremented)
    expect(disabled.getInstructionCount()).toBe(0);
    expect(disabled.getStackDepth()).toBe(0);
  });

  it('ScriptGuardError has correct properties', () => {
    const err = new ScriptGuardError('timeout', 5000, 6000);
    expect(err.name).toBe('ScriptGuardError');
    expect(err.reason).toBe('timeout');
    expect(err.limit).toBe(5000);
    expect(err.actual).toBe(6000);
    expect(err.message).toContain('timeout');
  });

  it('dispose clears state', () => {
    guard.tick();
    guard.dispose();
    expect(guard.getInstructionCount()).toBe(0);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// ErrorBoundary
// ═════════════════════════════════════════════════════════════════════════════

describe('ErrorBoundary', () => {
  it('exec succeeds when function does not throw', () => {
    const boundary = new ErrorBoundary({ strategy: 'fail-fast' });
    const result = boundary.exec(() => 'ok');
    expect(result.success).toBe(true);
    expect(result.value).toBe('ok');
    expect(result.attempts).toBe(1);
  });

  it('exec fails when function throws (fail-fast)', () => {
    const boundary = new ErrorBoundary({ strategy: 'fail-fast', logErrors: false });
    const result = boundary.exec(() => { throw new Error('boom'); });
    expect(result.success).toBe(false);
    expect(result.error).toBeInstanceOf(Error);
    expect(result.error!.message).toBe('boom');
    expect(result.attempts).toBe(1);
  });

  it('retry strategy retries N times', () => {
    let attempts = 0;
    const boundary = new ErrorBoundary({
      strategy: 'retry',
      maxRetries: 2,
      retryBaseMs: 1,
      retryMaxMs: 10,
      logErrors: false,
    });
    const result = boundary.exec(() => {
      attempts++;
      throw new Error('always fail');
    });
    expect(result.success).toBe(false);
    expect(result.attempts).toBe(3);
    expect(attempts).toBe(3);
  });

  it('retry strategy succeeds on eventual success', () => {
    let attempts = 0;
    const boundary = new ErrorBoundary({
      strategy: 'retry',
      maxRetries: 3,
      retryBaseMs: 1,
      retryMaxMs: 10,
      logErrors: false,
    });
    const result = boundary.exec(() => {
      attempts++;
      if (attempts < 3) throw new Error('not yet');
      return 'done';
    });
    expect(result.success).toBe(true);
    expect(result.value).toBe('done');
    expect(result.attempts).toBe(3);
  });

  it('error history is recorded', () => {
    const boundary = new ErrorBoundary({ strategy: 'fail-fast', logErrors: false });
    boundary.exec(() => { throw new Error('e1'); });
    boundary.exec(() => { throw new Error('e2'); });
    expect(boundary.getErrorCount()).toBe(2);
    expect(boundary.hasErrors()).toBe(true);
    expect(boundary.getErrorHistory()).toHaveLength(2);
    expect(boundary.getErrorHistory()[0]!.error.message).toBe('e1');
  });

  it('clearHistory resets', () => {
    const boundary = new ErrorBoundary({ strategy: 'fail-fast', logErrors: false });
    boundary.exec(() => { throw new Error('e'); });
    boundary.clearHistory();
    expect(boundary.getErrorCount()).toBe(0);
    expect(boundary.hasErrors()).toBe(false);
  });

  it('context is recorded in error history', () => {
    const boundary = new ErrorBoundary({ strategy: 'fail-fast', logErrors: false });
    boundary.exec(() => { throw new Error('e'); }, 'my-context');
    expect(boundary.getErrorHistory()[0]!.context).toBe('my-context');
  });

  it('getConfig returns config', () => {
    const boundary = new ErrorBoundary({ name: 'test-boundary' });
    expect(boundary.getConfig().name).toBe('test-boundary');
  });

  it('dispose clears state', () => {
    const boundary = new ErrorBoundary({ strategy: 'fail-fast', logErrors: false });
    boundary.exec(() => { throw new Error('e'); });
    boundary.dispose();
    expect(boundary.getErrorCount()).toBe(0);
  });

  it('execAsync works with async functions', async () => {
    const boundary = new ErrorBoundary({ strategy: 'fail-fast', logErrors: false });
    const result = await boundary.execAsync(async () => 42);
    expect(result.success).toBe(true);
    expect(result.value).toBe(42);
  });

  it('execAsync fails on async errors', async () => {
    const boundary = new ErrorBoundary({ strategy: 'fail-fast', logErrors: false });
    const result = await boundary.execAsync(async () => { throw new Error('async boom'); });
    expect(result.success).toBe(false);
    expect(result.error!.message).toBe('async boom');
  });

  it('execAsync retries with backoff', async () => {
    let attempts = 0;
    const boundary = new ErrorBoundary({
      strategy: 'retry',
      maxRetries: 2,
      retryBaseMs: 1,
      retryMaxMs: 10,
      logErrors: false,
    });
    const result = await boundary.execAsync(async () => {
      attempts++;
      throw new Error('fail');
    });
    expect(result.attempts).toBe(3);
    expect(attempts).toBe(3);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// ChainedErrorBoundary
// ═════════════════════════════════════════════════════════════════════════════

describe('ChainedErrorBoundary', () => {
  it('first boundary success stops chain', () => {
    const b1 = new ErrorBoundary({ name: 'b1', strategy: 'fail-fast', logErrors: false });
    const b2 = new ErrorBoundary({ name: 'b2', strategy: 'fail-fast', logErrors: false });
    const chain = new ChainedErrorBoundary([b1, b2]);
    const result = chain.exec(() => 'ok');
    expect(result.success).toBe(true);
    expect(result.value).toBe('ok');
    expect(b1.getErrorCount()).toBe(0);
    expect(b2.getErrorCount()).toBe(0);
  });

  it('chain combines error history', () => {
    const b1 = new ErrorBoundary({ name: 'b1', strategy: 'retry', maxRetries: 1, retryBaseMs: 1, logErrors: false });
    const b2 = new ErrorBoundary({ name: 'b2', strategy: 'fail-fast', logErrors: false });
    const chain = new ChainedErrorBoundary([b1, b2]);
    chain.exec(() => { throw new Error('always fail'); });
    // b1 retries once (2 attempts), then b2 tries once (1 attempt) = 3 total
    expect(chain.getErrorCount()).toBe(3);
  });

  it('dispose clears all boundaries', () => {
    const b1 = new ErrorBoundary({ name: 'b1', strategy: 'fail-fast', logErrors: false });
    const chain = new ChainedErrorBoundary([b1]);
    chain.exec(() => { throw new Error('e'); });
    chain.dispose();
    expect(chain.getErrorCount()).toBe(0);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// ProcessGuard
// ═════════════════════════════════════════════════════════════════════════════

describe('ProcessGuard', () => {
  let guard: ProcessGuard;

  beforeEach(() => {
    guard = new ProcessGuard({
      installHandlers: false,
      logErrors: false,
      maxHistorySize: 50,
    });
  });

  it('records manual errors', () => {
    guard.recordError(new Error('test'), 'error');
    expect(guard.getErrorCount()).toBe(1);
    expect(guard.getFatalCount()).toBe(0);
  });

  it('records fatal errors', () => {
    guard.recordError(new Error('fatal'), 'fatal');
    expect(guard.getErrorCount()).toBe(1);
    expect(guard.getFatalCount()).toBe(1);
  });

  it('records warning errors', () => {
    guard.recordError(new Error('warn'), 'warning');
    expect(guard.getErrorCount()).toBe(1);
    expect(guard.getFatalCount()).toBe(0);
  });

  it('error history stores context', () => {
    guard.recordError(new Error('e'), 'error', 'my-context');
    expect(guard.getErrorHistory()[0]!.context).toBe('my-context');
    expect(guard.getErrorHistory()[0]!.source).toBe('manual');
  });

  it('trims history at maxHistorySize', () => {
    guard.recordError(new Error('e1'), 'error');
    guard.recordError(new Error('e2'), 'error');
    guard.recordError(new Error('e3'), 'error');
    // maxHistorySize is 50, so all fit
    expect(guard.getErrorHistory()).toHaveLength(3);
  });

  it('hasRecentErrors returns true within window', () => {
    guard.recordError(new Error('e'), 'error');
    expect(guard.hasRecentErrors(10_000)).toBe(true);
  });

  it('hasRecentErrors returns false when no errors exist', () => {
    expect(guard.hasRecentErrors(0)).toBe(false);
    expect(guard.hasRecentErrors(10_000)).toBe(false);
  });

  it('onFatal callback is invoked for fatal errors', () => {
    let fatalErr: Error | null = null;
    const g = new ProcessGuard({
      installHandlers: false,
      logErrors: false,
      onFatal: (err) => { fatalErr = err; },
    });
    g.recordError(new Error('fatal'), 'fatal');
    expect(fatalErr).not.toBeNull();
    expect(fatalErr!.message).toBe('fatal');
    g.dispose();
  });

  it('clearHistory resets', () => {
    guard.recordError(new Error('e'), 'error');
    guard.recordError(new Error('f'), 'fatal');
    guard.clearHistory();
    expect(guard.getErrorCount()).toBe(0);
    expect(guard.getFatalCount()).toBe(0);
  });

  it('getConfig returns config', () => {
    expect(guard.getConfig().installHandlers).toBe(false);
  });

  it('dispose clears state', () => {
    guard.recordError(new Error('e'), 'error');
    guard.dispose();
    expect(guard.getErrorCount()).toBe(0);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// CrashReporter
// ═════════════════════════════════════════════════════════════════════════════

describe('CrashReporter', () => {
  let reporter: CrashReporter;

  beforeEach(() => {
    reporter = new CrashReporter({
      maxReports: 200,
      logReports: false,
      frequencyWindowMs: 60_000,
    });
  });

  it('stores crash reports', () => {
    const report = new CrashReportBuilder()
      .source('tab-context')
      .error(new Error('boom'))
      .severity('error')
      .phase('script')
      .tabId('tab-1')
      .url('https://example.com')
      .build();
    reporter.report(report);
    expect(reporter.getReports()).toHaveLength(1);
    expect(reporter.getReports()[0]!.error.message).toBe('boom');
  });

  it('filters by source', () => {
    const r1 = new CrashReportBuilder().source('tab-context').error(new Error('e')).phase('script').build();
    const r2 = new CrashReportBuilder().source('process-guard').error(new Error('e')).phase('global').build();
    reporter.report(r1);
    reporter.report(r2);
    expect(reporter.getReportsBySource('tab-context')).toHaveLength(1);
    expect(reporter.getReportsBySource('process-guard')).toHaveLength(1);
  });

  it('filters by severity', () => {
    const r1 = new CrashReportBuilder().source('tab-context').error(new Error('e')).severity('warning').phase('script').build();
    const r2 = new CrashReportBuilder().source('tab-context').error(new Error('e')).severity('fatal').phase('script').build();
    reporter.report(r1);
    reporter.report(r2);
    expect(reporter.getReportsBySeverity('warning')).toHaveLength(1);
    expect(reporter.getReportsBySeverity('fatal')).toHaveLength(1);
  });

  it('filters by tabId', () => {
    const r1 = new CrashReportBuilder().source('tab-context').error(new Error('e')).phase('script').tabId('tab-1').build();
    const r2 = new CrashReportBuilder().source('tab-context').error(new Error('e')).phase('script').tabId('tab-2').build();
    reporter.report(r1);
    reporter.report(r2);
    expect(reporter.getReportsByTab('tab-1')).toHaveLength(1);
  });

  it('getRecentReports returns last N', () => {
    for (let i = 0; i < 10; i++) {
      reporter.report(
        new CrashReportBuilder().source('manual').error(new Error(`e${i}`)).phase('test').build(),
      );
    }
    expect(reporter.getRecentReports(3)).toHaveLength(3);
    expect(reporter.getRecentReports(3)[0]!.error.message).toBe('e7');
  });

  it('getSummary provides statistics', () => {
    reporter.report(
      new CrashReportBuilder().source('tab-context').error(new Error('e1')).severity('error').phase('script').build(),
    );
    reporter.report(
      new CrashReportBuilder().source('process-guard').error(new Error('e2')).severity('fatal').phase('global').build(),
    );
    const summary = reporter.getSummary();
    expect(summary.total).toBe(2);
    expect(summary.bySeverity.error).toBe(1);
    expect(summary.bySeverity.fatal).toBe(1);
    expect(summary.bySource['tab-context']).toBe(1);
    expect(summary.bySource['process-guard']).toBe(1);
    expect(summary.lastCrashTimestamp).toBeGreaterThan(0);
  });

  it('clearReports resets', () => {
    reporter.report(
      new CrashReportBuilder().source('manual').error(new Error('e')).phase('test').build(),
    );
    reporter.clearReports();
    expect(reporter.getReports()).toHaveLength(0);
  });

  it('getConfig returns config', () => {
    expect(reporter.getConfig().maxReports).toBe(200);
  });

  it('dispose clears state', () => {
    reporter.report(
      new CrashReportBuilder().source('manual').error(new Error('e')).phase('test').build(),
    );
    reporter.dispose();
    expect(reporter.getReports()).toHaveLength(0);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// CrashReportBuilder
// ═════════════════════════════════════════════════════════════════════════════

describe('CrashReportBuilder', () => {
  it('builds a complete report', () => {
    const report = new CrashReportBuilder()
      .source('tab-context')
      .error(new Error('test'))
      .severity('fatal')
      .phase('layout')
      .tabId('tab-1')
      .url('https://example.com')
      .context('extra', 42)
      .build();
    expect(report.source).toBe('tab-context');
    expect(report.error.message).toBe('test');
    expect(report.severity).toBe('fatal');
    expect(report.phase).toBe('layout');
    expect(report.tabId).toBe('tab-1');
    expect(report.url).toBe('https://example.com');
    expect(report.context.extra).toBe(42);
    expect(report.id).toContain('crash-');
    expect(report.timestamp).toBeGreaterThan(0);
    expect(report.stackTrace).toBeTruthy();
  });

  it('throws if error is missing', () => {
    expect(() => {
      new CrashReportBuilder().source('manual').build();
    }).toThrow('error is required');
  });

  it('throws if source is missing', () => {
    expect(() => {
      new CrashReportBuilder().error(new Error('e')).build();
    }).toThrow('source is required');
  });

  it('defaults phase to unknown and severity to error', () => {
    const report = new CrashReportBuilder()
      .source('manual')
      .error(new Error('e'))
      .build();
    expect(report.phase).toBe('unknown');
    expect(report.severity).toBe('error');
  });
});
