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
import { randomUUID } from 'crypto';
import { writeFileSync, mkdirSync, readdirSync, readFileSync, unlinkSync, existsSync } from 'fs';
import { join } from 'path';

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
// ENHANCED CRASH REPORTER TYPES
// ─────────────────────────────────────────────────────────────────────────────

/** Minidump file written to disk for crash analysis. */
interface MinidumpFile {
  readonly id: string;
  readonly timestamp: number;
  readonly filePath: string;
  readonly sizeBytes: number;
  readonly crashId: string;
}

/** Configuration for crash upload service. */
interface CrashUploadConfig {
  /** Whether upload is enabled */
  enabled: boolean;
  /** Endpoint URL to upload crash reports */
  endpointUrl: string;
  /** How often to flush pending uploads (ms) */
  flushIntervalMs: number;
  /** Maximum retry attempts per upload */
  maxRetries: number;
  /** API key for authentication (optional) */
  apiKey?: string;
}

/** Session info collected alongside crash reports. */
interface CrashSessionInfo {
  /** Browser version */
  browserVersion: string;
  /** Operating system */
  platform: string;
  /** Architecture */
  arch: string;
  /** Total system memory (bytes) */
  totalMemoryBytes: number;
  /** Active tab count at crash time */
  activeTabCount: number;
  /** Memory used by browser process (bytes) */
  processMemoryBytes: number;
  /** Session duration (ms) */
  sessionDurationMs: number;
}

/** Enhanced crash reporter configuration. */
interface EnhancedCrashReporterConfig extends CrashReporterConfig {
  /** Directory to write minidump files */
  minidumpDir: string;
  /** Maximum minidump files to retain */
  maxMinidumps: number;
  /** Crash upload configuration */
  upload: CrashUploadConfig;
  /** Session info provider (called at crash time) */
  sessionInfoProvider?: () => CrashSessionInfo;
  /** Crash frequency threshold: if crashes exceed this per window, emit alert */
  crashFrequencyAlertThreshold: number;
}

type CrashReporterEvent =
  | { type: 'crash-reported'; report: CrashReport }
  | { type: 'minidump-written'; minidump: MinidumpFile }
  | { type: 'upload-started'; crashId: string }
  | { type: 'upload-completed'; crashId: string }
  | { type: 'upload-failed'; crashId: string; error: string }
  | { type: 'frequency-alert'; crashesInWindow: number; threshold: number };

type CrashReporterEventHandler = (event: CrashReporterEvent) => void;

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
  /** Write a minidump file for a crash report */
  writeMinidump(report: CrashReport, data: Buffer): MinidumpFile | undefined;
  /** Get all minidump files */
  getMinidumps(): readonly MinidumpFile[];
  /** Delete a specific minidump */
  deleteMinidump(id: string): boolean;
  /** Flush pending crash uploads */
  flushUploads(): Promise<number>;
  /** Subscribe to crash reporter events */
  onEvent(handler: CrashReporterEventHandler): () => void;
  /** Get session info at time of crash */
  getSessionInfo(): CrashSessionInfo | undefined;
}

// ─────────────────────────────────────────────────────────────────────────────
// IMPLEMENTATION
// ─────────────────────────────────────────────────────────────────────────────

class CrashReporter implements ICrashReporter {
  private config: CrashReporterConfig;
  private enhancedConfig: EnhancedCrashReporterConfig;
  private readonly reports: CrashReport[] = [];
  private reportCount = 0;
  private minidumps: MinidumpFile[] = [];
  private handlers: CrashReporterEventHandler[] = [];
  private pendingUploads: CrashReport[] = [];
  private flushTimer: ReturnType<typeof setInterval> | null = null;

  constructor(config?: Partial<EnhancedCrashReporterConfig>) {
    this.config = { ...DEFAULT_CRASH_REPORTER_CONFIG, ...config };
    this.enhancedConfig = {
      ...DEFAULT_CRASH_REPORTER_CONFIG,
      minidumpDir: '/tmp/nova-crashes',
      maxMinidumps: 50,
      upload: { enabled: false, endpointUrl: '', flushIntervalMs: 30_000, maxRetries: 3 },
      crashFrequencyAlertThreshold: 10,
      ...config,
    } as EnhancedCrashReporterConfig;
    if (this.enhancedConfig.upload.enabled && this.enhancedConfig.upload.endpointUrl) {
      this.flushTimer = setInterval(() => {
        this.flushUploads().catch(() => {});
      }, this.enhancedConfig.upload.flushIntervalMs);
    }
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

    // Emit event
    this.emitEvent({ type: 'crash-reported', report });

    // Queue for upload if enabled
    if (this.enhancedConfig.upload.enabled) {
      this.pendingUploads.push(report);
    }

    // Check frequency alert
    const summary = this.getSummary();
    if (summary.crashesPerMinute * this.config.frequencyWindowMs / 60_000 > this.enhancedConfig.crashFrequencyAlertThreshold) {
      this.emitEvent({
        type: 'frequency-alert',
        crashesInWindow: Math.round(summary.crashesPerMinute * this.config.frequencyWindowMs / 60_000),
        threshold: this.enhancedConfig.crashFrequencyAlertThreshold,
      });
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

  writeMinidump(report: CrashReport, data: Buffer): MinidumpFile | undefined {
    try {
      const dir = this.enhancedConfig.minidumpDir;
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
      }

      const id = randomUUID();
      const filename = `minidump-${report.id}-${id}.dmp`;
      const filePath = join(dir, filename);
      writeFileSync(filePath, data);

      const minidump: MinidumpFile = {
        id,
        timestamp: Date.now(),
        filePath,
        sizeBytes: data.length,
        crashId: report.id,
      };

      this.minidumps.push(minidump);

      // Trim old minidumps
      if (this.minidumps.length > this.enhancedConfig.maxMinidumps) {
        const old = this.minidumps.splice(0, this.minidumps.length - this.enhancedConfig.maxMinidumps);
        for (const m of old) {
          try { unlinkSync(m.filePath); } catch {}
        }
      }

      this.emitEvent({ type: 'minidump-written', minidump });
      return minidump;
    } catch {
      return undefined;
    }
  }

  getMinidumps(): readonly MinidumpFile[] {
    return [...this.minidumps];
  }

  deleteMinidump(id: string): boolean {
    const idx = this.minidumps.findIndex(m => m.id === id);
    if (idx < 0) return false;
    const [removed] = this.minidumps.splice(idx, 1);
    try { unlinkSync(removed.filePath); } catch {}
    return true;
  }

  async flushUploads(): Promise<number> {
    if (!this.enhancedConfig.upload.enabled) return 0;
    if (this.pendingUploads.length === 0) return 0;

    const toUpload = [...this.pendingUploads];
    this.pendingUploads = [];
    let uploaded = 0;

    for (const report of toUpload) {
      this.emitEvent({ type: 'upload-started', crashId: report.id });
      try {
        const resp = await fetch(this.enhancedConfig.upload.endpointUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(this.enhancedConfig.upload.apiKey ? { 'Authorization': `Bearer ${this.enhancedConfig.upload.apiKey}` } : {}),
          },
          body: JSON.stringify({
            id: report.id,
            timestamp: report.timestamp,
            source: report.source,
            severity: report.severity,
            phase: report.phase,
            url: report.url,
            tabId: report.tabId,
            errorMessage: report.error.message,
            stackTrace: report.stackTrace,
            context: report.context,
            sessionInfo: this.getSessionInfo(),
          }),
        });
        if (resp.ok) {
          uploaded++;
          this.emitEvent({ type: 'upload-completed', crashId: report.id });
        } else {
          this.emitEvent({ type: 'upload-failed', crashId: report.id, error: `HTTP ${resp.status}` });
          this.pendingUploads.push(report); // re-queue
        }
      } catch (err: any) {
        this.emitEvent({ type: 'upload-failed', crashId: report.id, error: err.message });
        this.pendingUploads.push(report); // re-queue
      }
    }

    return uploaded;
  }

  onEvent(handler: CrashReporterEventHandler): () => void {
    this.handlers.push(handler);
    return () => {
      const idx = this.handlers.indexOf(handler);
      if (idx >= 0) this.handlers.splice(idx, 1);
    };
  }

  getSessionInfo(): CrashSessionInfo | undefined {
    return this.enhancedConfig.sessionInfoProvider?.();
  }

  dispose(): void {
    this.reports.length = 0;
    this.reportCount = 0;
    this.minidumps.length = 0;
    this.pendingUploads.length = 0;
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }
  }

  private emitEvent(event: CrashReporterEvent): void {
    for (const handler of this.handlers) {
      try { handler(event); } catch {}
    }
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
  MinidumpFile,
  CrashUploadConfig,
  CrashSessionInfo,
  EnhancedCrashReporterConfig,
  CrashReporterEvent,
  CrashReporterEventHandler,
};
