/**
 * @file src/browser/engine/crash-reporter.ts
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * RESPONSIBILITY
 * ─────────────────────────────────────────────────────────────────────────────
 * Structured crash logging and diagnostics. CrashReporter collects crash
 * events from TabContexts, ProcessGuard, and LifecycleManager, formats them
 * into structured reports, and provides diagnostic queries.
 *
 * It does NOT decide what to do about crashes (that's TabContext/LifecycleManager).
 * It only records, formats, and exposes them for diagnostics UI / logging.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * OOP PRINCIPLES
 *  Abstraction      ICrashReporter hides the storage mechanism.
 *  Encapsulation    Report store is private; queries return copies.
 *  Single-Resp.     Reporter only records and queries — never recovers.
 *  Open / Closed    New report formatters can be added via composition.
 */

import type { IDisposable } from '../../app/dependency-container';

// ─────────────────────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────────────────────

/** The source subsystem that generated the crash report. */
type CrashSource = 'tab-context' | 'process-guard' | 'lifecycle-manager' | 'error-boundary' | 'manual';

/** Severity of a crash report. */
type CrashSeverity = 'warning' | 'error' | 'fatal';

/** A single structured crash report. */
interface CrashReport {
  /** Unique ID for this report. */
  readonly id: string;
  /** When the crash was reported. */
  readonly timestamp: number;
  /** Source subsystem. */
  readonly source: CrashSource;
  /** Error that caused the crash. */
  readonly error: Error;
  /** Severity level. */
  readonly severity: CrashSeverity;
  /** Phase during which the crash occurred. */
  readonly phase: string;
  /** The URL being processed at the time of crash (if applicable). */
  readonly url?: string;
  /** Tab ID associated with the crash (if applicable). */
  readonly tabId?: string;
  /** Additional diagnostic context. */
  readonly context: Record<string, unknown>;
  /** Stack trace captured at report time. */
  readonly stackTrace: string;
}

/** Summary statistics for crash reports. */
interface CrashSummary {
  /** Total number of reports. */
  readonly total: number;
  /** Reports by severity. */
  readonly bySeverity: Record<CrashSeverity, number>;
  /** Reports by source. */
  readonly bySource: Record<CrashSource, number>;
  /** Most recent crash timestamp, or 0 if none. */
  readonly lastCrashTimestamp: number;
  /** Average crash frequency (crashes per minute) over the reporting window. */
  readonly crashesPerMinute: number;
}

/** Configuration for CrashReporter. */
interface CrashReporterConfig {
  /** Maximum number of reports to retain. */
  readonly maxReports: number;
  /** Time window in ms for frequency calculation. */
  readonly frequencyWindowMs: number;
  /** Whether to log reports to console. */
  readonly logReports: boolean;
  /** Whether to log summaries periodically. */
  readonly logSummaries: boolean;
}

const DEFAULT_CRASH_REPORTER_CONFIG: CrashReporterConfig = {
  maxReports: 200,
  frequencyWindowMs: 60_000,
  logReports: true,
  logSummaries: false,
};

// ─────────────────────────────────────────────────────────────────────────────
// REPORT BUILDER
// ─────────────────────────────────────────────────────────────────────────────

let _reportSeq = 0;

class CrashReportBuilder {
  private partial: Partial<CrashReport> = {
    context: {},
  };

  source(source: CrashSource): this {
    this.partial.source = source;
    return this;
  }

  error(error: Error): this {
    this.partial.error = error;
    return this;
  }

  severity(severity: CrashSeverity): this {
    this.partial.severity = severity;
    return this;
  }

  phase(phase: string): this {
    this.partial.phase = phase;
    return this;
  }

  url(url: string): this {
    this.partial.url = url;
    return this;
  }

  tabId(tabId: string): this {
    this.partial.tabId = tabId;
    return this;
  }

  context(key: string, value: unknown): this {
    (this.partial.context as Record<string, unknown>)[key] = value;
    return this;
  }

  build(): CrashReport {
    if (!this.partial.error) throw new Error('CrashReportBuilder: error is required');
    if (!this.partial.source) throw new Error('CrashReportBuilder: source is required');
    if (!this.partial.phase) this.partial.phase = 'unknown';
    if (!this.partial.severity) this.partial.severity = 'error';

    const report: CrashReport = {
      id: `crash-${Date.now().toString(36)}-${(++_reportSeq).toString(36)}`,
      timestamp: Date.now(),
      source: this.partial.source!,
      error: this.partial.error!,
      severity: this.partial.severity!,
      phase: this.partial.phase!,
      url: this.partial.url,
      tabId: this.partial.tabId,
      context: { ...this.partial.context },
      stackTrace: this.partial.error!.stack ?? '(no stack trace)',
    };

    return report;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// PUBLIC CONTRACT
// ─────────────────────────────────────────────────────────────────────────────

interface ICrashReporter extends IDisposable {
  /** Report a crash. */
  report(report: CrashReport): void;
  /** Get all stored reports. */
  getReports(): readonly CrashReport[];
  /** Get reports filtered by source. */
  getReportsBySource(source: CrashSource): readonly CrashReport[];
  /** Get reports filtered by severity. */
  getReportsBySeverity(severity: CrashSeverity): readonly CrashReport[];
  /** Get reports for a specific tab. */
  getReportsByTab(tabId: string): readonly CrashReport[];
  /** Get the most recent N reports. */
  getRecentReports(count: number): readonly CrashReport[];
  /** Get summary statistics. */
  getSummary(): CrashSummary;
  /** Clear all reports. */
  clearReports(): void;
  /** Get the reporter configuration. */
  getConfig(): CrashReporterConfig;
}

// ─────────────────────────────────────────────────────────────────────────────
// IMPLEMENTATION
// ─────────────────────────────────────────────────────────────────────────────

class CrashReporter implements ICrashReporter {
  private config: CrashReporterConfig;
  private readonly reports: CrashReport[] = [];
  private reportCount = 0;

  constructor(config?: Partial<CrashReporterConfig>) {
    this.config = { ...DEFAULT_CRASH_REPORTER_CONFIG, ...config };
  }

  report(report: CrashReport): void {
    this.reports.push(report);
    this.reportCount++;

    // Trim old reports
    if (this.reports.length > this.config.maxReports) {
      this.reports.splice(0, this.reports.length - this.config.maxReports);
    }

    if (this.config.logReports) {
      const tabInfo = report.tabId ? ` [tab=${report.tabId}]` : '';
      const urlInfo = report.url ? ` url=${report.url}` : '';
      console.error(
        `[CrashReporter:${report.source}:${report.severity}] ` +
        `Phase "${report.phase}"${tabInfo}${urlInfo}: ${report.error.message}`,
      );
    }
  }

  getReports(): readonly CrashReport[] {
    return [...this.reports];
  }

  getReportsBySource(source: CrashSource): readonly CrashReport[] {
    return this.reports.filter(r => r.source === source);
  }

  getReportsBySeverity(severity: CrashSeverity): readonly CrashReport[] {
    return this.reports.filter(r => r.severity === severity);
  }

  getReportsByTab(tabId: string): readonly CrashReport[] {
    return this.reports.filter(r => r.tabId === tabId);
  }

  getRecentReports(count: number): readonly CrashReport[] {
    return this.reports.slice(-count);
  }

  getSummary(): CrashSummary {
    const now = Date.now();
    const windowStart = now - this.config.frequencyWindowMs;
    const windowReports = this.reports.filter(r => r.timestamp >= windowStart);

    const bySeverity: Record<CrashSeverity, number> = { warning: 0, error: 0, fatal: 0 };
    const bySource: Record<CrashSource, number> = {
      'tab-context': 0,
      'process-guard': 0,
      'lifecycle-manager': 0,
      'error-boundary': 0,
      'manual': 0,
    };

    for (const r of this.reports) {
      bySeverity[r.severity]++;
      bySource[r.source]++;
    }

    const windowMinutes = this.config.frequencyWindowMs / 60_000;
    const crashesPerMinute = windowMinutes > 0
      ? windowReports.length / windowMinutes
      : 0;

    return {
      total: this.reports.length,
      bySeverity,
      bySource,
      lastCrashTimestamp: this.reports.length > 0
        ? this.reports[this.reports.length - 1]!.timestamp
        : 0,
      crashesPerMinute,
    };
  }

  clearReports(): void {
    this.reports.length = 0;
    this.reportCount = 0;
  }

  getConfig(): CrashReporterConfig {
    return { ...this.config };
  }

  dispose(): void {
    this.reports.length = 0;
    this.reportCount = 0;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// EXPORTS
// ─────────────────────────────────────────────────────────────────────────────

export {
  CrashReporter,
  CrashReportBuilder,
  DEFAULT_CRASH_REPORTER_CONFIG,
};

export type {
  ICrashReporter,
  CrashReport,
  CrashReporterConfig,
  CrashSummary,
  CrashSource,
  CrashSeverity,
};
