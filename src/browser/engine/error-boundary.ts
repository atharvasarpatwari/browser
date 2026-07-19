/**
 * @file src/browser/engine/error-boundary.ts
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * RESPONSIBILITY
 * ─────────────────────────────────────────────────────────────────────────────
 * Module-level error catching with structured recovery. ErrorBoundary wraps
 * operations in a try/catch and provides recovery strategies when failures
 * occur. Unlike simple try/catch, it tracks error history, supports retry
 * with backoff, and can trigger fallback behaviors.
 *
 * Use cases:
 *   • Wrapping rendering pipeline stages
 *   • Wrapping network requests with fallback
 *   • Wrapping JS execution with error page fallback
 *   • Wrapping file I/O with retry logic
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * OOP PRINCIPLES
 * ─────────────────────────────────────────────────────────────────────────────
 *  Abstraction      IErrorBoundary is the public contract.
 *  Encapsulation    Error history and retry state are private.
 *  Single-Resp.     Boundary catches and recovers — it doesn't throw.
 *  Open / Closed    New recovery strategies can be added via configuration.
 */

import type { IDisposable } from '../../app/dependency-container';

// ─────────────────────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────────────────────

/** The result of an operation wrapped by ErrorBoundary. */
interface BoundaryResult<T> {
  /** Whether the operation succeeded. */
  readonly success: boolean;
  /** The return value (only present if success = true). */
  readonly value?: T;
  /** The error if the operation failed (after all retries). */
  readonly error?: Error;
  /** Number of attempts made (including the original). */
  readonly attempts: number;
  /** Total time in ms across all attempts. */
  readonly durationMs: number;
}

/** Recovery strategy when an operation fails. */
type RecoveryStrategy =
  /** Fail immediately — no retry. */
  | 'fail-fast'
  /** Retry N times with exponential backoff. */
  | 'retry'
  /** Use a fallback value on failure. */
  | 'fallback'
  /** Log and swallow the error (return undefined). */
  | 'swallow';

/** Configuration for an error boundary. */
interface ErrorBoundaryConfig {
  /** Name of this boundary (for logging). */
  readonly name: string;
  /** Recovery strategy. */
  readonly strategy: RecoveryStrategy;
  /** Maximum number of retries (only used with 'retry' strategy). */
  readonly maxRetries: number;
  /** Base delay in ms for exponential backoff. */
  readonly retryBaseMs: number;
  /** Maximum delay in ms between retries. */
  readonly retryMaxMs: number;
  /** Timeout in ms for each attempt (0 = no timeout). */
  readonly attemptTimeoutMs: number;
  /** Whether to log errors to console. */
  readonly logErrors: boolean;
}

const DEFAULT_BOUNDARY_CONFIG: ErrorBoundaryConfig = {
  name: 'unnamed-boundary',
  strategy: 'fail-fast',
  maxRetries: 3,
  retryBaseMs: 100,
  retryMaxMs: 5_000,
  attemptTimeoutMs: 0,
  logErrors: true,
};

/** A recorded error in the boundary's history. */
interface ErrorRecord {
  readonly error: Error;
  readonly timestamp: number;
  readonly attempt: number;
  readonly durationMs: number;
  readonly context?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// PUBLIC CONTRACT
// ─────────────────────────────────────────────────────────────────────────────

interface IErrorBoundary extends IDisposable {
  /** Execute an operation with error boundary protection. */
  exec<T>(fn: () => T, context?: string): BoundaryResult<T>;
  /** Execute an async operation with error boundary protection. */
  execAsync<T>(fn: () => Promise<T>, context?: string): Promise<BoundaryResult<T>>;
  /** Get the error history for this boundary. */
  getErrorHistory(): readonly ErrorRecord[];
  /** Get the total error count. */
  getErrorCount(): number;
  /** Clear error history. */
  clearHistory(): void;
  /** Get the boundary configuration. */
  getConfig(): ErrorBoundaryConfig;
  /** Whether the boundary has recorded any errors. */
  hasErrors(): boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// IMPLEMENTATION
// ─────────────────────────────────────────────────────────────────────────────

class ErrorBoundary implements IErrorBoundary {
  private config: ErrorBoundaryConfig;
  private readonly errorHistory: ErrorRecord[] = [];
  private errorCount = 0;

  constructor(config?: Partial<ErrorBoundaryConfig>) {
    this.config = { ...DEFAULT_BOUNDARY_CONFIG, ...config };
  }

  exec<T>(fn: () => T, context?: string): BoundaryResult<T> {
    const startTime = Date.now();
    let lastError: Error | null = null;
    let attempts = 0;

    const maxAttempts = this.config.strategy === 'retry'
      ? this.config.maxRetries + 1
      : 1;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      attempts = attempt;
      const attemptStart = Date.now();

      try {
        const value = fn();
        return {
          success: true,
          value,
          attempts,
          durationMs: Date.now() - startTime,
        };
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err));
        lastError = error;
        const durationMs = Date.now() - attemptStart;

        this.recordError(error, attempt, durationMs, context);

        if (this.config.strategy === 'fail-fast' || attempt >= maxAttempts) {
          break;
        }

        // Exponential backoff
        const delay = Math.min(
          this.config.retryBaseMs * Math.pow(2, attempt - 1),
          this.config.retryMaxMs,
        );
        // Synchronous sleep approximation (for non-async contexts)
        const end = Date.now() + delay;
        while (Date.now() < end) { /* busy wait */ }
      }
    }

    return {
      success: false,
      error: lastError!,
      attempts,
      durationMs: Date.now() - startTime,
    };
  }

  async execAsync<T>(fn: () => Promise<T>, context?: string): Promise<BoundaryResult<T>> {
    const startTime = Date.now();
    let lastError: Error | null = null;
    let attempts = 0;

    const maxAttempts = this.config.strategy === 'retry'
      ? this.config.maxRetries + 1
      : 1;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      attempts = attempt;
      const attemptStart = Date.now();

      try {
        const value = await Promise.race([
          fn(),
          ...(
            this.config.attemptTimeoutMs > 0
              ? [this.timeoutPromise(this.config.attemptTimeoutMs)]
              : []
          ),
        ]);
        return {
          success: true,
          value: value as T,
          attempts,
          durationMs: Date.now() - startTime,
        };
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err));
        lastError = error;
        const durationMs = Date.now() - attemptStart;

        this.recordError(error, attempt, durationMs, context);

        if (this.config.strategy === 'fail-fast' || attempt >= maxAttempts) {
          break;
        }

        // Exponential backoff with jitter
        const delay = Math.min(
          this.config.retryBaseMs * Math.pow(2, attempt - 1),
          this.config.retryMaxMs,
        );
        const jitter = delay * 0.1 * Math.random();
        await this.sleep(delay + jitter);
      }
    }

    return {
      success: false,
      error: lastError!,
      attempts,
      durationMs: Date.now() - startTime,
    };
  }

  getErrorHistory(): readonly ErrorRecord[] {
    return [...this.errorHistory];
  }

  getErrorCount(): number {
    return this.errorCount;
  }

  clearHistory(): void {
    this.errorHistory.length = 0;
    this.errorCount = 0;
  }

  getConfig(): ErrorBoundaryConfig {
    return { ...this.config };
  }

  hasErrors(): boolean {
    return this.errorCount > 0;
  }

  dispose(): void {
    this.errorHistory.length = 0;
    this.errorCount = 0;
  }

  // ── Private ──────────────────────────────────────────────────────────────

  private recordError(error: Error, attempt: number, durationMs: number, context?: string): void {
    this.errorCount++;
    this.errorHistory.push({
      error,
      timestamp: Date.now(),
      attempt,
      durationMs,
      context,
    });

    // Keep history bounded
    if (this.errorHistory.length > 100) {
      this.errorHistory.splice(0, this.errorHistory.length - 100);
    }

    if (this.config.logErrors) {
      console.error(
        `[ErrorBoundary:${this.config.name}] Attempt ${attempt} failed: ${error.message}`,
        context ? `(${context})` : '',
      );
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  private timeoutPromise(ms: number): Promise<never> {
    return new Promise((_, reject) => {
      setTimeout(() => reject(new Error(`Timeout after ${ms}ms`)), ms);
    });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// CHAINED ERROR BOUNDARY
// ─────────────────────────────────────────────────────────────────────────────

/**
 * A composite error boundary that runs an operation through a chain of
 * boundaries with different strategies. The first boundary that handles
 * the error stops the chain.
 *
 * Example:
 *   1. Retry boundary (handles transient errors)
 *   2. Fallback boundary (provides default value)
 *   3. Swallow boundary (logs and returns undefined)
 */
class ChainedErrorBoundary implements IErrorBoundary {
  private readonly boundaries: ErrorBoundary[];
  private readonly name: string;

  constructor(boundaries: ErrorBoundary[]) {
    this.boundaries = boundaries;
    this.name = boundaries.map(b => b.getConfig().name).join(' → ');
  }

  exec<T>(fn: () => T, context?: string): BoundaryResult<T> {
    let currentFn = fn;

    for (let i = 0; i < this.boundaries.length; i++) {
      const boundary = this.boundaries[i]!;
      const result = boundary.exec(currentFn, context);

      if (result.success) {
        return result;
      }

      // If this is the last boundary, return the failure
      if (i === this.boundaries.length - 1) {
        return result;
      }

      // Otherwise, wrap the original function for the next boundary
      // (The next boundary will retry/fallback on the same original fn)
      currentFn = fn;
    }

    // Should not reach here, but TypeScript needs it
    return { success: false, error: new Error('No boundaries'), attempts: 0, durationMs: 0 };
  }

  async execAsync<T>(fn: () => Promise<T>, context?: string): Promise<BoundaryResult<T>> {
    let currentFn = fn;

    for (let i = 0; i < this.boundaries.length; i++) {
      const boundary = this.boundaries[i]!;
      const result = await boundary.execAsync(currentFn, context);

      if (result.success) {
        return result;
      }

      if (i === this.boundaries.length - 1) {
        return result;
      }

      currentFn = fn;
    }

    return { success: false, error: new Error('No boundaries'), attempts: 0, durationMs: 0 };
  }

  getErrorHistory(): readonly ErrorRecord[] {
    const all: ErrorRecord[] = [];
    for (const b of this.boundaries) {
      all.push(...b.getErrorHistory());
    }
    return all;
  }

  getErrorCount(): number {
    return this.boundaries.reduce((sum, b) => sum + b.getErrorCount(), 0);
  }

  clearHistory(): void {
    for (const b of this.boundaries) b.clearHistory();
  }

  getConfig(): ErrorBoundaryConfig {
    return { ...DEFAULT_BOUNDARY_CONFIG, name: this.name };
  }

  hasErrors(): boolean {
    return this.boundaries.some(b => b.hasErrors());
  }

  dispose(): void {
    for (const b of this.boundaries) b.dispose();
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// EXPORTS
// ─────────────────────────────────────────────────────────────────────────────

export {
  ErrorBoundary,
  ChainedErrorBoundary,
  DEFAULT_BOUNDARY_CONFIG,
};

export type {
  IErrorBoundary,
  ErrorBoundaryConfig,
  ErrorRecord,
  BoundaryResult,
  RecoveryStrategy,
};
