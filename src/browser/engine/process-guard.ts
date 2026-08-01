/**
 * @file src/browser/engine/process-guard.ts
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * RESPONSIBILITY
 * ─────────────────────────────────────────────────────────────────────────────
 * Global process-level error handling: catches uncaught exceptions and
 * unhandled promise rejections, logs them structurally, and provides
 * hooks for graceful degradation.
 *
 * In a browser environment, this would be window.onerror / window.onunhandledrejection.
 * In Node.js, this is process.on('uncaughtException') / process.on('unhandledRejection').
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * OOP PRINCIPLES
 *  Abstraction      IProcessGuard hides platform-specific error hooks.
 *  Encapsulation    Error history and handler state are private.
 *  Single-Resp.     ProcessGuard catches global errors — nothing else.
 */

import type { IDisposable } from '../../app/dependency-container';

// ─────────────────────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────────────────────

/** Severity level for process-level errors. */
type ErrorSeverity = 'warning' | 'error' | 'fatal';

/** A recorded process-level error. */
interface ProcessErrorRecord {
  /** The error that occurred. */
  readonly error: Error;
  /** When the error occurred. */
  readonly timestamp: number;
  /** Severity of the error. */
  readonly severity: ErrorSeverity;
  /** Source of the error ('uncaught', 'unhandled-rejection', 'manual'). */
  readonly source: string;
  /** Additional context about the error. */
  readonly context?: string;
}

/** Configuration for the process guard. */
interface ProcessGuardConfig {
  /** Whether to install global error handlers. */
  readonly installHandlers: boolean;
  /** Whether to log errors to console. */
  readonly logErrors: boolean;
  /** Maximum number of errors to keep in history. */
  readonly maxHistorySize: number;
  /** Whether to attempt automatic recovery on fatal errors. */
  readonly autoRecover: boolean;
  /** Callback invoked when a fatal error occurs. */
  readonly onFatal?: (error: Error) => void;
}

const DEFAULT_PROCESS_GUARD_CONFIG: ProcessGuardConfig = {
  installHandlers: true,
  logErrors: true,
  maxHistorySize: 500,
  autoRecover: false,
};

// ─────────────────────────────────────────────────────────────────────────────
// PUBLIC CONTRACT
// ─────────────────────────────────────────────────────────────────────────────

interface IProcessGuard extends IDisposable {
  /** Human-readable service identifier used by the shell lifecycle. */
  readonly name: string;
  /** Install error handlers when the service lifecycle initializes. */
  initialize(): Promise<void>;
  /** Remove error handlers when the service lifecycle shuts down. */
  shutdown(): Promise<void>;
  /** Manually record an error. */
  recordError(error: Error, severity?: ErrorSeverity, context?: string): void;
  /** Get the error history. */
  getErrorHistory(): readonly ProcessErrorRecord[];
  /** Get the total error count. */
  getErrorCount(): number;
  /** Get the count of fatal errors. */
  getFatalCount(): number;
  /** Clear error history. */
  clearHistory(): void;
  /** Check if there have been recent errors (within the last N ms). */
  hasRecentErrors(windowMs?: number): boolean;
  /** Get the process guard configuration. */
  getConfig(): ProcessGuardConfig;
}

// ─────────────────────────────────────────────────────────────────────────────
// IMPLEMENTATION
// ─────────────────────────────────────────────────────────────────────────────

class ProcessGuard implements IProcessGuard {
  readonly name = 'process-guard';
  private config: ProcessGuardConfig;
  private readonly errorHistory: ProcessErrorRecord[] = [];
  private errorCount = 0;
  private fatalCount = 0;
  private installed = false;

  // Store original handlers so we can chain
  private originalExceptionHandler: ((err: Error) => void) | null = null;
  private originalRejectionHandler: ((reason: unknown) => void) | null = null;

  constructor(config?: Partial<ProcessGuardConfig>) {
    this.config = { ...DEFAULT_PROCESS_GUARD_CONFIG, ...config };
    if (this.config.installHandlers) {
      this.install();
    }
  }

  recordError(error: Error, severity: ErrorSeverity = 'error', context?: string): void {
    const record: ProcessErrorRecord = {
      error,
      timestamp: Date.now(),
      severity,
      source: 'manual',
      context,
    };

    this.errorCount++;
    if (severity === 'fatal') this.fatalCount++;

    this.errorHistory.push(record);

    // Trim history if needed
    if (this.errorHistory.length > this.config.maxHistorySize) {
      this.errorHistory.splice(0, this.errorHistory.length - this.config.maxHistorySize);
    }

    if (this.config.logErrors) {
      const prefix = severity === 'fatal' ? 'FATAL' : severity === 'error' ? 'ERROR' : 'WARN';
      console.error(`[ProcessGuard:${prefix}] ${error.message}`, context ? `(${context})` : '');
    }

    if (severity === 'fatal' && this.config.onFatal) {
      this.config.onFatal(error);
    }
  }

  getErrorHistory(): readonly ProcessErrorRecord[] {
    return [...this.errorHistory];
  }

  getErrorCount(): number {
    return this.errorCount;
  }

  getFatalCount(): number {
    return this.fatalCount;
  }

  clearHistory(): void {
    this.errorHistory.length = 0;
    this.errorCount = 0;
    this.fatalCount = 0;
  }

  hasRecentErrors(windowMs = 5_000): boolean {
    const cutoff = Date.now() - windowMs;
    return this.errorHistory.some(r => r.timestamp >= cutoff);
  }

  getConfig(): ProcessGuardConfig {
    return { ...this.config };
  }

  async initialize(): Promise<void> {
    if (this.config.installHandlers) {
      this.install();
    }
  }

  async shutdown(): Promise<void> {
    this.uninstall();
  }

  install(): void {
    if (this.installed) return;

    if (typeof process !== 'undefined') {
      // Node.js environment
      this.originalExceptionHandler = process.listeners('uncaughtException')[0] as ((err: Error) => void) | null;
      this.originalRejectionHandler = process.listeners('unhandledRejection')[0] as ((reason: unknown) => void) | null;

      process.on('uncaughtException', (err: Error) => {
        this.recordError(err, 'fatal', 'uncaughtException');
      });

      process.on('unhandledRejection', (reason: unknown) => {
        const error = reason instanceof Error
          ? reason
          : new Error(String(reason));
        this.recordError(error, 'error', 'unhandledRejection');
      });
    } else if (typeof window !== 'undefined') {
      // Browser environment
      window.onerror = (_msg, _src, _line, _col, err) => {
        if (err) {
          this.recordError(err, 'error', 'window.onerror');
        }
        return false;
      };

      window.onunhandledrejection = (event) => {
        const error = event.reason instanceof Error
          ? event.reason
          : new Error(String(event.reason));
        this.recordError(error, 'error', 'unhandledRejection');
      };
    }

    this.installed = true;
  }

  uninstall(): void {
    if (!this.installed) return;

    if (typeof process !== 'undefined') {
      if (this.originalExceptionHandler) {
        process.removeAllListeners('uncaughtException');
        process.on('uncaughtException', this.originalExceptionHandler);
      }
      if (this.originalRejectionHandler) {
        process.removeAllListeners('unhandledRejection');
        process.on('unhandledRejection', this.originalRejectionHandler);
      }
    } else if (typeof window !== 'undefined') {
      window.onerror = null;
      window.onunhandledrejection = null;
    }

    this.installed = false;
  }

  dispose(): void {
    this.uninstall();
    this.errorHistory.length = 0;
    this.errorCount = 0;
    this.fatalCount = 0;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// EXPORTS
// ─────────────────────────────────────────────────────────────────────────────

export {
  ProcessGuard,
  DEFAULT_PROCESS_GUARD_CONFIG,
};

export type {
  IProcessGuard,
  ProcessGuardConfig,
  ProcessErrorRecord,
  ErrorSeverity,
};
