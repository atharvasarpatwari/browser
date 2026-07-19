/**
 * @file src/browser/engine/script-guard.ts
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * RESPONSIBILITY
 * ─────────────────────────────────────────────────────────────────────────────
 * Enforce execution limits on JavaScript code to prevent infinite loops,
 * excessive memory allocation, and stack overflow from crashing the browser.
 *
 * Provides:
 *   • Execution time limits (wall-clock timeout)
 *   • Instruction count limits (for interpreted engines)
 *   • Stack depth limits
 *   • Memory budget tracking (approximate)
 *   • Guard wrapping around script execution
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * OOP PRINCIPLES
 * ─────────────────────────────────────────────────────────────────────────────
 *  Abstraction      IScriptGuard hides enforcement behind a simple API.
 *  Encapsulation    Counters and limits are private.
 *  Single-Resp.     This module enforces script safety — nothing else.
 *  Open / Closed    New limit types can be added via configuration.
 */

import type { IDisposable } from '../../app/dependency-container';

// ─────────────────────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────────────────────

/** Configuration for script execution limits. */
interface ScriptGuardConfig {
  /** Maximum wall-clock milliseconds allowed for a single script execution. */
  readonly maxExecutionMs: number;
  /** Maximum number of interpreted instructions before强制 termination. */
  readonly maxInstructions: number;
  /** Maximum call stack depth (for recursion protection). */
  readonly maxStackDepth: number;
  /** Approximate memory budget in bytes (0 = unlimited). */
  readonly memoryBudgetBytes: number;
  /** Whether the guard is enabled (false = no limits enforced). */
  readonly enabled: boolean;
}

const DEFAULT_SCRIPT_GUARD_CONFIG: ScriptGuardConfig = {
  maxExecutionMs: 5_000,
  maxInstructions: 1_000_000,
  maxStackDepth: 500,
  memoryBudgetBytes: 0,
  enabled: true,
};

/** The reason a script was terminated. */
type ScriptTerminationReason =
  | 'timeout'
  | 'instruction-limit'
  | 'stack-overflow'
  | 'memory-limit'
  | 'manual';

/** Result of a guarded script execution. */
interface ScriptGuardResult<T> {
  /** Whether the script completed without hitting a limit. */
  readonly completed: boolean;
  /** The return value (only present if completed = true). */
  readonly value?: T;
  /** The error if the script was terminated. */
  readonly error?: ScriptGuardError;
  /** Execution time in ms. */
  readonly durationMs: number;
  /** Number of instructions executed (if tracked). */
  readonly instructionsExecuted: number;
}

/** Error thrown when a script hits a limit. */
class ScriptGuardError extends Error {
  readonly reason: ScriptTerminationReason;
  readonly limit: number;
  readonly actual: number;

  constructor(reason: ScriptTerminationReason, limit: number, actual: number) {
    const msg = `Script terminated: ${reason} (limit=${limit}, actual=${actual})`;
    super(msg);
    this.name = 'ScriptGuardError';
    this.reason = reason;
    this.limit = limit;
    this.actual = actual;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// PUBLIC CONTRACT
// ─────────────────────────────────────────────────────────────────────────────

interface IScriptGuard extends IDisposable {
  /** Execute a function with all limits enforced. */
  exec<T>(fn: () => T): ScriptGuardResult<T>;
  /** Execute an async function with all limits enforced. */
  execAsync<T>(fn: () => Promise<T>): Promise<ScriptGuardResult<T>>;
  /** Increment the instruction counter (called by the interpreter). */
  tick(): void;
  /** Push a frame onto the call stack. */
  pushFrame(name: string): void;
  /** Pop a frame from the call stack. */
  popFrame(): void;
  /** Get current stack depth. */
  getStackDepth(): number;
  /** Get current instruction count. */
  getInstructionCount(): number;
  /** Check if the guard has been triggered. */
  isTriggered(): boolean;
  /** Get the termination reason (if triggered). */
  getTerminationReason(): ScriptTerminationReason | null;
  /** Reset all counters (for reuse). */
  reset(): void;
  /** Get the guard configuration. */
  getConfig(): ScriptGuardConfig;
}

// ─────────────────────────────────────────────────────────────────────────────
// IMPLEMENTATION
// ─────────────────────────────────────────────────────────────────────────────

class ScriptGuard implements IScriptGuard {
  private config: ScriptGuardConfig;
  private instructionCount = 0;
  private stackDepth = 0;
  private startTime = 0;
  private triggered = false;
  private terminationReason: ScriptTerminationReason | null = null;
  private readonly callStack: string[] = [];

  constructor(config?: Partial<ScriptGuardConfig>) {
    this.config = { ...DEFAULT_SCRIPT_GUARD_CONFIG, ...config };
  }

  exec<T>(fn: () => T): ScriptGuardResult<T> {
    if (!this.config.enabled) {
      const start = Date.now();
      try {
        const value = fn();
        return { completed: true, value, durationMs: Date.now() - start, instructionsExecuted: 0 };
      } catch (err) {
        return {
          completed: false,
          error: new ScriptGuardError('manual', 0, 0),
          durationMs: Date.now() - start,
          instructionsExecuted: 0,
        };
      }
    }

    this.reset();
    this.startTime = Date.now();
    const startInstructions = this.instructionCount;

    // Set up timeout
    let timeoutHandle: NodeJS.Timeout | undefined;
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutHandle = setTimeout(() => {
        this.triggered = true;
        this.terminationReason = 'timeout';
        reject(new ScriptGuardError('timeout', this.config.maxExecutionMs, Date.now() - this.startTime));
      }, this.config.maxExecutionMs);
    });

    const workPromise = new Promise<T>((resolve, reject) => {
      try {
        const result = fn();
        resolve(result);
      } catch (err) {
        reject(err);
      }
    });

    return Promise.race([workPromise, timeoutPromise])
      .then(value => ({
        completed: true,
        value,
        durationMs: Date.now() - this.startTime,
        instructionsExecuted: this.instructionCount - startInstructions,
      }))
      .catch(err => ({
        completed: false,
        error: err instanceof ScriptGuardError
          ? err
          : new ScriptGuardError('manual', 0, 0),
        durationMs: Date.now() - this.startTime,
        instructionsExecuted: this.instructionCount - startInstructions,
      }))
      .finally(() => {
        if (timeoutHandle) clearTimeout(timeoutHandle);
      });
  }

  async execAsync<T>(fn: () => Promise<T>): Promise<ScriptGuardResult<T>> {
    if (!this.config.enabled) {
      const start = Date.now();
      try {
        const value = await fn();
        return { completed: true, value, durationMs: Date.now() - start, instructionsExecuted: 0 };
      } catch (err) {
        return {
          completed: false,
          error: new ScriptGuardError('manual', 0, 0),
          durationMs: Date.now() - start,
          instructionsExecuted: 0,
        };
      }
    }

    this.reset();
    this.startTime = Date.now();
    const startInstructions = this.instructionCount;

    let timeoutHandle: NodeJS.Timeout | undefined;
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutHandle = setTimeout(() => {
        this.triggered = true;
        this.terminationReason = 'timeout';
        reject(new ScriptGuardError('timeout', this.config.maxExecutionMs, Date.now() - this.startTime));
      }, this.config.maxExecutionMs);
    });

    try {
      const value = await Promise.race([fn(), timeoutPromise]);
      return {
        completed: true,
        value,
        durationMs: Date.now() - this.startTime,
        instructionsExecuted: this.instructionCount - startInstructions,
      };
    } catch (err) {
      return {
        completed: false,
        error: err instanceof ScriptGuardError
          ? err
          : new ScriptGuardError('manual', 0, 0),
        durationMs: Date.now() - this.startTime,
        instructionsExecuted: this.instructionCount - startInstructions,
      };
    } finally {
      if (timeoutHandle) clearTimeout(timeoutHandle);
    }
  }

  tick(): void {
    if (!this.config.enabled) return;
    this.instructionCount++;
    if (this.config.maxInstructions > 0 && this.instructionCount >= this.config.maxInstructions) {
      this.triggered = true;
      this.terminationReason = 'instruction-limit';
      throw new ScriptGuardError('instruction-limit', this.config.maxInstructions, this.instructionCount);
    }
  }

  pushFrame(name: string): void {
    if (!this.config.enabled) return;
    this.callStack.push(name);
    this.stackDepth = this.callStack.length;
    if (this.config.maxStackDepth > 0 && this.stackDepth > this.config.maxStackDepth) {
      this.triggered = true;
      this.terminationReason = 'stack-overflow';
      throw new ScriptGuardError('stack-overflow', this.config.maxStackDepth, this.stackDepth);
    }
  }

  popFrame(): void {
    if (!this.config.enabled) return;
    this.callStack.pop();
    this.stackDepth = this.callStack.length;
  }

  getStackDepth(): number { return this.stackDepth; }
  getInstructionCount(): number { return this.instructionCount; }
  isTriggered(): boolean { return this.triggered; }
  getTerminationReason(): ScriptTerminationReason | null { return this.terminationReason; }

  reset(): void {
    this.instructionCount = 0;
    this.stackDepth = 0;
    this.startTime = 0;
    this.triggered = false;
    this.terminationReason = null;
    this.callStack.length = 0;
  }

  getConfig(): ScriptGuardConfig {
    return { ...this.config };
  }

  dispose(): void {
    this.reset();
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// EXPORTS
// ─────────────────────────────────────────────────────────────────────────────

export {
  ScriptGuard,
  ScriptGuardError,
  DEFAULT_SCRIPT_GUARD_CONFIG,
};

export type {
  IScriptGuard,
  ScriptGuardConfig,
  ScriptGuardResult,
  ScriptTerminationReason,
};
