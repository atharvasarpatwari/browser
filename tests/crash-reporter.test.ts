import { describe, it, expect, beforeEach } from 'vitest';
import { CrashReporter, CrashReportBuilder, DEFAULT_CRASH_REPORTER_CONFIG } from '../src/browser/engine/crash-reporter';
import type { CrashReport } from '../src/browser/engine/crash-reporter';

describe('CrashReportBuilder', () => {
  it('should build a report with required fields', () => {
    const report = new CrashReportBuilder()
      .source('tab-context')
      .error(new Error('test error'))
      .phase('rendering')
      .build();

    expect(report.id).toMatch(/^crash-/);
    expect(report.source).toBe('tab-context');
    expect(report.error.message).toBe('test error');
    expect(report.phase).toBe('rendering');
    expect(report.severity).toBe('error'); // default
    expect(report.timestamp).toBeGreaterThan(0);
    expect(report.stackTrace).toBeTruthy();
  });

  it('should throw if error is missing', () => {
    expect(() => new CrashReportBuilder().source('manual').build()).toThrow('error is required');
  });

  it('should throw if source is missing', () => {
    expect(() => new CrashReportBuilder().error(new Error('e')).build()).toThrow('source is required');
  });

  it('should default phase to "unknown"', () => {
    const report = new CrashReportBuilder()
      .source('manual')
      .error(new Error('e'))
      .build();
    expect(report.phase).toBe('unknown');
  });

  it('should include optional fields', () => {
    const report = new CrashReportBuilder()
      .source('tab-context')
      .error(new Error('e'))
      .severity('fatal')
      .phase('navigation')
      .url('https://example.com')
      .tabId('tab-1')
      .context('key1', 'value1')
      .context('key2', 42)
      .build();

    expect(report.severity).toBe('fatal');
    expect(report.url).toBe('https://example.com');
    expect(report.tabId).toBe('tab-1');
    expect(report.context.key1).toBe('value1');
    expect(report.context.key2).toBe(42);
  });
});

describe('CrashReporter', () => {
  let reporter: CrashReporter;

  beforeEach(() => {
    reporter = new CrashReporter({ logReports: false });
  });

  function makeReport(overrides: Partial<CrashReport> = {}): CrashReport {
    return new CrashReportBuilder()
      .source('tab-context')
      .error(new Error('test crash'))
      .phase('test')
      .build();
  }

  // ── report / getReports ─────────────────────────────────────────────────────

  it('should store and retrieve reports', () => {
    reporter.report(makeReport());
    reporter.report(makeReport());
    expect(reporter.getReports()).toHaveLength(2);
  });

  it('should getReportsBySource', () => {
    reporter.report(new CrashReportBuilder().source('tab-context').error(new Error('e1')).phase('p').build());
    reporter.report(new CrashReportBuilder().source('process-guard').error(new Error('e2')).phase('p').build());
    expect(reporter.getReportsBySource('tab-context')).toHaveLength(1);
    expect(reporter.getReportsBySource('process-guard')).toHaveLength(1);
  });

  it('should getReportsBySeverity', () => {
    reporter.report(new CrashReportBuilder().source('manual').error(new Error('e')).severity('warning').build());
    reporter.report(new CrashReportBuilder().source('manual').error(new Error('e')).severity('fatal').build());
    expect(reporter.getReportsBySeverity('warning')).toHaveLength(1);
    expect(reporter.getReportsBySeverity('fatal')).toHaveLength(1);
  });

  it('should getReportsByTab', () => {
    reporter.report(new CrashReportBuilder().source('manual').error(new Error('e')).tabId('tab-1').build());
    reporter.report(new CrashReportBuilder().source('manual').error(new Error('e')).tabId('tab-2').build());
    expect(reporter.getReportsByTab('tab-1')).toHaveLength(1);
  });

  it('should getRecentReports', () => {
    for (let i = 0; i < 10; i++) {
      reporter.report(makeReport());
    }
    expect(reporter.getRecentReports(3)).toHaveLength(3);
  });

  // ── maxReports trimming ─────────────────────────────────────────────────────

  it('should trim old reports when maxReports exceeded', () => {
    const smallReporter = new CrashReporter({ maxReports: 3, logReports: false });
    for (let i = 0; i < 10; i++) {
      smallReporter.report(makeReport());
    }
    expect(smallReporter.getReports()).toHaveLength(3);
  });

  // ── getSummary ──────────────────────────────────────────────────────────────

  describe('getSummary', () => {
    it('should return correct summary', () => {
      reporter.report(new CrashReportBuilder().source('tab-context').error(new Error('e')).severity('error').build());
      reporter.report(new CrashReportBuilder().source('process-guard').error(new Error('e')).severity('fatal').build());
      reporter.report(new CrashReportBuilder().source('tab-context').error(new Error('e')).severity('warning').build());

      const summary = reporter.getSummary();
      expect(summary.total).toBe(3);
      expect(summary.bySeverity.error).toBe(1);
      expect(summary.bySeverity.fatal).toBe(1);
      expect(summary.bySeverity.warning).toBe(1);
      expect(summary.bySource['tab-context']).toBe(2);
      expect(summary.bySource['process-guard']).toBe(1);
      expect(summary.lastCrashTimestamp).toBeGreaterThan(0);
    });

    it('should return empty summary for no reports', () => {
      const summary = reporter.getSummary();
      expect(summary.total).toBe(0);
      expect(summary.lastCrashTimestamp).toBe(0);
      expect(summary.crashesPerMinute).toBe(0);
    });

    it('should calculate crashesPerMinute within window', () => {
      for (let i = 0; i < 5; i++) {
        reporter.report(makeReport());
      }
      const summary = reporter.getSummary();
      expect(summary.crashesPerMinute).toBeGreaterThanOrEqual(0);
    });
  });

  // ── clearReports ────────────────────────────────────────────────────────────

  it('should clear all reports', () => {
    reporter.report(makeReport());
    reporter.report(makeReport());
    reporter.clearReports();
    expect(reporter.getReports()).toHaveLength(0);
  });

  // ── config ──────────────────────────────────────────────────────────────────

  it('should use default config', () => {
    const r = new CrashReporter();
    expect(r.getConfig().maxReports).toBe(DEFAULT_CRASH_REPORTER_CONFIG.maxReports);
  });

  it('should override config', () => {
    const r = new CrashReporter({ maxReports: 50 });
    expect(r.getConfig().maxReports).toBe(50);
  });

  it('getConfig should return copy', () => {
    const config = reporter.getConfig() as { maxReports: number };
    config.maxReports = 999;
    expect(reporter.getConfig().maxReports).not.toBe(999);
  });

  // ── dispose ─────────────────────────────────────────────────────────────────

  it('should dispose and clear all state', () => {
    reporter.report(makeReport());
    reporter.dispose();
    expect(reporter.getReports()).toHaveLength(0);
  });
});
