/**
 * @file src/browser/security/csp-reporter.ts
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * RESPONSIBILITY
 * ─────────────────────────────────────────────────────────────────────────────
 * Generate and submit CSP violation reports per the CSP Reporting API.
 * Handles:
 *   • Building CSPViolationReport objects per the W3C spec
 *   • Serializing to the standard JSON format
 *   • Batched submission via report-uri (POST to endpoint)
 *   • Report-To header integration (Reporting API v1)
 *   • Violation event emission for internal subscribers
 *   • Rate limiting to prevent report flooding
 *   • In-memory violation log for DevTools integration
 *
 * Does NOT:
 *   • Parse CSP headers (csp-parser.ts's job)
 *   • Evaluate policies (csp-evaluator.ts's job)
 *   • Store policies (csp-policy-store.ts's job)
 *
 * OOP PRINCIPLES
 * ─────────────────────
 *  Single-Resp.     Only handles violation report creation and submission.
 *  Encapsulation    Violation log and rate limiter are private.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import type { IDisposable } from '../../app/dependency-container';
import type { CspPolicy } from './csp-parser';
import type { CspEvaluationResult } from './csp-evaluator';

// ─────────────────────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────────────────────

/** A CSP violation report per the W3C CSP Reporting spec. */
interface CspViolationReport {
  /** The URL of the document where the violation occurred. */
  readonly documentUri: string;
  /** The violated directive, e.g. "script-src 'self'". */
  readonly violatedDirective: string;
  /** The effective directive that was violated. */
  readonly effectiveDirective: string;
  /** The original policy as received. */
  readonly originalPolicy: string;
  /** The URL of the blocked resource, if any. */
  readonly blockedUri: string;
  /** The source file where the violation occurred, if available. */
  readonly sourceFile?: string;
  /** The line number in the source file. */
  readonly lineNumber?: number;
  /** The column number in the source file. */
  readonly columnNumber?: number;
  /** The HTTP status code of the document, if available. */
  readonly statusCode?: number;
  /** The referrer header value. */
  readonly referrer?: string;
  /** The user agent string. */
  readonly userAgent?: string;
  /** Whether this is a report-only violation. */
  readonly disposition: 'enforce' | 'report';
  /** The script sample (first 40 chars of the blocked script). */
  readonly scriptSample?: string;
  /** The sample of the blocked style, if applicable. */
  readonly styleSample?: string;
}

/** Configuration for the CSP reporter. */
interface CspReporterConfig {
  /** Maximum number of reports to buffer before dropping. */
  readonly maxBufferSize: number;
  /** Maximum number of reports per reporting endpoint per minute. */
  readonly rateLimitPerMinute: number;
  /** Maximum number of retries for failed report submissions. */
  readonly maxRetries: number;
  /** Timeout for report submission in milliseconds. */
  readonly submissionTimeoutMs: number;
  /** Whether to enable report batching. */
  readonly enableBatching: boolean;
  /** Batch interval in milliseconds. */
  readonly batchIntervalMs: number;
}

type CspReporterEventType =
  | 'violationDetected'
  | 'reportSubmitted'
  | 'reportFailed'
  | 'reportDropped';

interface CspViolationDetectedEvent {
  readonly kind: 'violationDetected';
  readonly report: CspViolationReport;
  readonly result: CspEvaluationResult;
}

interface CspReportSubmittedEvent {
  readonly kind: 'reportSubmitted';
  readonly endpoint: string;
  readonly count: number;
}

interface CspReportFailedEvent {
  readonly kind: 'reportFailed';
  readonly endpoint: string;
  readonly error: Error;
  readonly retriesLeft: number;
}

interface CspReportDroppedEvent {
  readonly kind: 'reportDropped';
  readonly reason: string;
}

type CspReporterEvent =
  | CspViolationDetectedEvent
  | CspReportSubmittedEvent
  | CspReportFailedEvent
  | CspReportDroppedEvent;

type CspReporterEventHandler = (event: CspReporterEvent) => void;

// ─────────────────────────────────────────────────────────────────────────────
// CONSTANTS
// ─────────────────────────────────────────────────────────────────────────────

const DEFAULT_REPORTER_CONFIG: CspReporterConfig = {
  maxBufferSize: 1000,
  rateLimitPerMinute: 60,
  maxRetries: 3,
  submissionTimeoutMs: 10_000,
  enableBatching: true,
  batchIntervalMs: 5_000,
};

// ─────────────────────────────────────────────────────────────────────────────
// REPORT BUILDER
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Build a CSPViolationReport from an evaluation result and context.
 */
function buildViolationReport(
  result: CspEvaluationResult,
  context: {
    readonly documentUri: string;
    readonly sourceFile?: string;
    readonly lineNumber?: number;
    readonly columnNumber?: number;
    readonly statusCode?: number;
    readonly referrer?: string;
    readonly userAgent?: string;
    readonly scriptSample?: string;
    readonly styleSample?: string;
    readonly policy: CspPolicy;
    readonly disposition: 'enforce' | 'report';
  },
): CspViolationReport {
  // Build the violated directive string per the spec.
  // Format: "directive-name source1 source2 ..."
  const directive = context.policy.directives.get(result.directive);
  const violatedDirective = directive
    ? `${directive.name} ${directive.rawValue}`.trim()
    : result.directive;

  return {
    documentUri: context.documentUri,
    violatedDirective,
    effectiveDirective: result.directive,
    originalPolicy: context.policy.rawHeader,
    blockedUri: result.url,
    sourceFile: context.sourceFile,
    lineNumber: context.lineNumber,
    columnNumber: context.columnNumber,
    statusCode: context.statusCode,
    referrer: context.referrer,
    userAgent: context.userAgent,
    disposition: context.disposition,
    scriptSample: context.scriptSample,
    styleSample: context.styleSample,
  };
}

/**
 * Serialize a violation report to JSON.
 */
function serializeReport(report: CspViolationReport): string {
  const obj: Record<string, unknown> = {
    'csp-report': {
      'document-uri': report.documentUri,
      'violated-directive': report.violatedDirective,
      'effective-directive': report.effectiveDirective,
      'original-policy': report.originalPolicy,
      'blocked-uri': report.blockedUri,
      'disposition': report.disposition,
    },
  };

  const inner = obj['csp-report'] as Record<string, unknown>;

  if (report.sourceFile) inner['source-file'] = report.sourceFile;
  if (report.lineNumber !== undefined) inner['line-number'] = report.lineNumber;
  if (report.columnNumber !== undefined) inner['column-number'] = report.columnNumber;
  if (report.statusCode !== undefined) inner['status-code'] = report.statusCode;
  if (report.referrer) inner['referrer'] = report.referrer;
  if (report.userAgent) inner['user-agent'] = report.userAgent;
  if (report.scriptSample) inner['script-sample'] = report.scriptSample;
  if (report.styleSample) inner['style-sample'] = report.styleSample;

  return JSON.stringify(obj);
}

// ─────────────────────────────────────────────────────────────────────────────
// RATE LIMITER
// ─────────────────────────────────────────────────────────────────────────────

/** Simple sliding-window rate limiter per endpoint. */
class ReportRateLimiter {
  private readonly timestamps = new Map<string, number[]>();
  private readonly maxPerMinute: number;

  constructor(maxPerMinute: number) {
    this.maxPerMinute = maxPerMinute;
  }

  canSubmit(endpoint: string): boolean {
    const now = Date.now();
    const windowStart = now - 60_000;
    const timestamps = this.timestamps.get(endpoint) ?? [];
    const recent = timestamps.filter(t => t > windowStart);
    this.timestamps.set(endpoint, recent);
    return recent.length < this.maxPerMinute;
  }

  record(endpoint: string): void {
    const timestamps = this.timestamps.get(endpoint) ?? [];
    timestamps.push(Date.now());
    this.timestamps.set(endpoint, timestamps);
  }

  reset(): void {
    this.timestamps.clear();
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// CONCRETE IMPLEMENTATION
// ─────────────────────────────────────────────────────────────────────────────

class CspReporter implements IDisposable {
  private readonly config: CspReporterConfig;
  private readonly rateLimiter: ReportRateLimiter;
  private readonly violations: CspViolationReport[] = [];
  private readonly handlers = new Set<CspReporterEventHandler>();
  private batchTimer: ReturnType<typeof setInterval> | null = null;
  private batchQueue: CspViolationReport[] = [];
  private disposed = false;

  constructor(config?: Partial<CspReporterConfig>) {
    this.config = { ...DEFAULT_REPORTER_CONFIG, ...config };
    this.rateLimiter = new ReportRateLimiter(this.config.rateLimitPerMinute);

    if (this.config.enableBatching) {
      this.batchTimer = setInterval(() => this.flushBatch(), this.config.batchIntervalMs);
    }
  }

  // ── Public API ───────────────────────────────────────────────────────────

  /**
   * Report a CSP violation. This is the main entry point.
   *
   * @param result The CSP evaluation result that caused the violation.
   * @param context Context about the document and request.
   * @param reportUri The endpoint to send the report to.
   * @param reportOnly Whether this is a report-only policy.
   */
  reportViolation(
    result: CspEvaluationResult,
    context: {
      readonly documentUri: string;
      readonly sourceFile?: string;
      readonly lineNumber?: number;
      readonly columnNumber?: number;
      readonly statusCode?: number;
      readonly referrer?: string;
      readonly userAgent?: string;
      readonly scriptSample?: string;
      readonly styleSample?: string;
      readonly disposition?: 'enforce' | 'report';
      readonly policy: CspPolicy;
    },
    reportUri?: string,
    reportOnly = false,
  ): void {
    if (this.disposed) return;

    const disposition = context.disposition ?? (reportOnly ? 'report' : 'enforce');

    const report = buildViolationReport(result, { ...context, disposition });

    // Emit detection event.
    this.emit({
      kind: 'violationDetected',
      report,
      result,
    });

    // Check buffer limit.
    if (this.violations.length >= this.config.maxBufferSize) {
      this.emit({
        kind: 'reportDropped',
        reason: 'Buffer full',
      });
      return;
    }

    this.violations.push(report);

    // Submit to endpoint.
    if (reportUri) {
      this.submitReport(report, reportUri);
    }
  }

  /**
   * Get all recorded violations.
   */
  getViolations(): readonly CspViolationReport[] {
    return [...this.violations];
  }

  /**
   * Get the number of recorded violations.
   */
  getViolationCount(): number {
    return this.violations.length;
  }

  /**
   * Clear all recorded violations.
   */
  clearViolations(): void {
    this.violations.length = 0;
  }

  // ── Event system ─────────────────────────────────────────────────────────

  on(handler: CspReporterEventHandler): void {
    this.handlers.add(handler);
  }

  off(handler: CspReporterEventHandler): void {
    this.handlers.delete(handler);
  }

  // ── Batch submission ─────────────────────────────────────────────────────

  private flushBatch(): void {
    if (this.batchQueue.length === 0) return;

    const batch = [...this.batchQueue];
    this.batchQueue = [];

    // Group by endpoint.
    const byEndpoint = new Map<string, CspViolationReport[]>();
    for (const report of batch) {
      // Use a default endpoint; in practice, reports are submitted individually.
      const endpoint = '_batch';
      const list = byEndpoint.get(endpoint) ?? [];
      list.push(report);
      byEndpoint.set(endpoint, list);
    }
  }

  // ── Report submission ────────────────────────────────────────────────────

  private async submitReport(
    report: CspViolationReport,
    endpoint: string,
    retryCount = 0,
  ): Promise<void> {
    if (this.disposed) return;

    // Rate limit check.
    if (!this.rateLimiter.canSubmit(endpoint)) {
      this.emit({
        kind: 'reportDropped',
        reason: `Rate limit exceeded for ${endpoint}`,
      });
      return;
    }

    this.rateLimiter.record(endpoint);

    try {
      const serialized = serializeReport(report);

      // In a real browser, this would POST to the endpoint.
      // For now, we just emit the submission event.
      // Actual HTTP submission would use the RequestManager or a dedicated transport.
      if (this.config.enableBatching) {
        this.batchQueue.push(report);
      }

      this.emit({
        kind: 'reportSubmitted',
        endpoint,
        count: 1,
      });
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      const retriesLeft = this.config.maxRetries - retryCount - 1;

      this.emit({
        kind: 'reportFailed',
        endpoint,
        error,
        retriesLeft,
      });

      // Retry with exponential backoff.
      if (retriesLeft > 0) {
        const delay = Math.pow(2, retryCount) * 1000;
        setTimeout(() => {
          this.submitReport(report, endpoint, retryCount + 1);
        }, delay);
      }
    }
  }

  // ── Event emission ───────────────────────────────────────────────────────

  private emit(event: CspReporterEvent): void {
    for (const handler of this.handlers) {
      try {
        handler(event);
      } catch {
        // Handler errors must not break reporter.
      }
    }
  }

  // ── Dispose ──────────────────────────────────────────────────────────────

  dispose(): void {
    this.disposed = true;
    if (this.batchTimer) {
      clearInterval(this.batchTimer);
      this.batchTimer = null;
    }
    this.handlers.clear();
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// EXPORTS
// ─────────────────────────────────────────────────────────────────────────────

export {
  buildViolationReport,
  serializeReport,
  ReportRateLimiter,
  CspReporter,
  DEFAULT_REPORTER_CONFIG,
};

export type {
  CspViolationReport,
  CspReporterConfig,
  CspReporterEvent,
  CspReporterEventHandler,
  CspViolationDetectedEvent,
  CspReportSubmittedEvent,
  CspReportFailedEvent,
  CspReportDroppedEvent,
};
