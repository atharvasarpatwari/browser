import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { CrashReporter, CrashReportBuilder } from '../src/browser/engine/crash-reporter';
import { randomUUID } from 'crypto';

function makeReport(overrides?: any): any {
  return {
    id: `crash-${randomUUID().slice(0, 8)}`,
    timestamp: Date.now(),
    source: 'tab-context',
    error: new Error('test error'),
    severity: 'error',
    phase: 'test',
    context: {},
    stackTrace: 'test stack',
    ...overrides,
  };
}

describe('CrashReporter - Enhanced', () => {
  let reporter: CrashReporter;

  beforeEach(() => {
    reporter = new CrashReporter({
      maxReports: 50,
      frequencyWindowMs: 60_000,
      logReports: false,
      minidumpDir: '/tmp/nova-crash-test',
      maxMinidumps: 10,
      upload: { enabled: false, endpointUrl: '', flushIntervalMs: 30_000, maxRetries: 3 },
      crashFrequencyAlertThreshold: 10,
    });
  });

  afterEach(() => {
    reporter.dispose();
  });

  // ── Basic report ──

  it('reports a crash', () => {
    const report = makeReport();
    reporter.report(report);
    expect(reporter.getReports()).toHaveLength(1);
  });

  it('trims old reports when max exceeded', () => {
    for (let i = 0; i < 60; i++) {
      reporter.report(makeReport({ id: `crash-${i}` }));
    }
    expect(reporter.getReports().length).toBeLessThanOrEqual(50);
  });

  it('clearReports empties store', () => {
    reporter.report(makeReport());
    reporter.clearReports();
    expect(reporter.getReports()).toHaveLength(0);
  });

  // ── Event subscription ──

  it('emits crash-reported event', () => {
    const handler = vi.fn();
    reporter.onEvent(handler);
    reporter.report(makeReport());
    expect(handler).toHaveBeenCalledOnce();
    expect(handler.mock.calls[0][0].type).toBe('crash-reported');
  });

  it('unsubscribe stops events', () => {
    const handler = vi.fn();
    const unsub = reporter.onEvent(handler);
    reporter.report(makeReport());
    expect(handler).toHaveBeenCalledOnce();
    unsub();
    reporter.report(makeReport());
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('handler errors do not crash', () => {
    reporter.onEvent(() => { throw new Error('bad handler'); });
    expect(() => reporter.report(makeReport())).not.toThrow();
  });

  // ── CrashReportBuilder ──

  it('builds report with all fields', () => {
    const report = new CrashReportBuilder()
      .source('tab-context')
      .error(new Error('test'))
      .severity('warning')
      .phase('load')
      .url('https://example.com')
      .tabId('tab-1')
      .context('key1', 'value1')
      .context('key2', 42)
      .build();

    expect(report.source).toBe('tab-context');
    expect(report.severity).toBe('warning');
    expect(report.phase).toBe('load');
    expect(report.url).toBe('https://example.com');
    expect(report.tabId).toBe('tab-1');
    expect(report.context.key1).toBe('value1');
    expect(report.context.key2).toBe(42);
    expect(report.id).toBeDefined();
    expect(report.timestamp).toBeGreaterThan(0);
  });

  it('builder defaults severity to error', () => {
    const report = new CrashReportBuilder()
      .source('manual')
      .error(new Error('test'))
      .build();
    expect(report.severity).toBe('error');
    expect(report.phase).toBe('unknown');
  });

  it('builder throws without error', () => {
    expect(() => new CrashReportBuilder().source('manual').build()).toThrow();
  });

  it('builder throws without source', () => {
    expect(() => new CrashReportBuilder().error(new Error('test')).build()).toThrow();
  });

  // ── Session info ──

  it('getSessionInfo returns provider result', () => {
    const provider = vi.fn().mockReturnValue({
      browserVersion: '1.0.0',
      platform: 'win32',
      arch: 'x64',
      totalMemoryBytes: 16 * 1024 * 1024 * 1024,
      activeTabCount: 5,
      processMemoryBytes: 500 * 1024 * 1024,
      sessionDurationMs: 60000,
    });
    const r = new CrashReporter({ sessionInfoProvider: provider });
    const info = r.getSessionInfo();
    expect(info).toBeDefined();
    expect(info!.browserVersion).toBe('1.0.0');
    expect(info!.activeTabCount).toBe(5);
  });

  it('getSessionInfo returns undefined without provider', () => {
    expect(reporter.getSessionInfo()).toBeUndefined();
  });

  // ── Frequency alert ──

  it('emits frequency-alert when threshold exceeded', () => {
    const lowThreshold = new CrashReporter({
      maxReports: 100,
      crashFrequencyAlertThreshold: 3,
      frequencyWindowMs: 60_000,
      logReports: false,
    });
    const handler = vi.fn();
    lowThreshold.onEvent(handler);
    for (let i = 0; i < 5; i++) {
      lowThreshold.report(makeReport({ id: `crash-${i}` }));
    }
    const alerts = handler.mock.calls.filter((c: any) => c[0].type === 'frequency-alert');
    expect(alerts.length).toBeGreaterThan(0);
    lowThreshold.dispose();
  });

  // ── Minidumps ──

  it('getMinidumps returns empty initially', () => {
    expect(reporter.getMinidumps()).toHaveLength(0);
  });

  // ── Dispose ──

  it('dispose clears everything', () => {
    reporter.report(makeReport());
    reporter.dispose();
    expect(reporter.getReports()).toHaveLength(0);
    expect(reporter.getMinidumps()).toHaveLength(0);
  });

  // ── getConfig ──

  it('getConfig returns copy', () => {
    const config = reporter.getConfig();
    expect(config.maxReports).toBe(50);
  });
});
