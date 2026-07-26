import type { JSFunction, JSValue, JSFunctionCaller } from './values';
import { createNativeFunction, Environment, createObject, createArray, toNumber, toString, callJSFunction, setGlobalCaller } from './values';
import type { CspScriptEnforcer } from '../security/csp-script-enforcer';

// ─────────────────────────────────────────────────────────────────────────────
// EVENT LOOP — setTimeout, setInterval, requestAnimationFrame,
// queueMicrotask, process.nextTick (priority microtask)
// ─────────────────────────────────────────────────────────────────────────────

export interface Task {
  id: number;
  fn: () => void;
  delay: number;
  scheduledAt: number;
  recurring: boolean;
  interval?: number;
}

export class EventLoop {
  private nextTaskId = 1;
  private tasks: Task[] = [];
  private timers: Map<number, Task> = new Map();
  private rafCallbacks: Array<{ id: number; cb: () => void }> = [];
  private microtaskQueue: Array<() => void> = [];
  /** Priority microtask queue (process.nextTick) — runs before regular microtasks */
  private nextTickQueue: Array<() => void> = [];
  private nextRafId = 1;
  private running = false;
  private _interpreter: JSFunctionCaller | null = null;

  /**
   * Timer nesting depth for clamping (WHATWG HTML § 8.6).
   * After 5 nested setTimeout calls, the minimum delay is clamped to 4ms.
   */
  private _timerNestingLevel = 0;

  /** Store interpreter reference so microtasks can call JS functions after run() returns. */
  setInterpreter(interpreter: JSFunctionCaller | null): void {
    this._interpreter = interpreter;
  }

  schedule(fn: () => void, delay: number, recurring: boolean = false): number {
    const id = this.nextTaskId++;

    // WHATWG HTML § 8.6 — Timer clamping: after 5 nested timer firings,
    // the minimum delay is clamped to 4ms.
    let effectiveDelay = Math.max(0, delay);
    if (this._timerNestingLevel >= 5 && effectiveDelay > 0) {
      effectiveDelay = Math.max(4, effectiveDelay);
    }

    const task: Task = {
      id,
      fn,
      delay: effectiveDelay,
      scheduledAt: Date.now(),
      recurring,
      interval: recurring ? delay : undefined,
    };
    this.tasks.push(task);
    this.timers.set(id, task);
    return id;
  }

  /** Increment timer nesting level (called when a timer callback fires). */
  _enterTimerNesting(): void {
    this._timerNestingLevel++;
  }

  /** Decrement timer nesting level (called after a timer callback returns). */
  _exitTimerNesting(): void {
    if (this._timerNestingLevel > 0) this._timerNestingLevel--;
  }

  /** Get current timer nesting level (for testing). */
  get timerNestingLevel(): number {
    return this._timerNestingLevel;
  }

  clearTimer(id: number): void {
    this.timers.delete(id);
    this.tasks = this.tasks.filter(t => t.id !== id);
  }

  enqueueMicrotask(fn: () => void): void {
    this.microtaskQueue.push(fn);
  }

  /** Enqueue a priority microtask (process.nextTick) — runs before regular microtasks */
  enqueueNextTick(fn: () => void): void {
    this.nextTickQueue.push(fn);
  }

  /** Drain all microtask queues. Returns total number of microtasks executed. */
  drainMicrotasks(): number {
    let count = 0;
    const hadCaller = this._interpreter;
    if (hadCaller) setGlobalCaller(hadCaller);
    try {
      // Priority microtasks (nextTick) first
      while (this.nextTickQueue.length > 0) {
        const fn = this.nextTickQueue.shift()!;
        try {
          fn();
        } catch {
          // swallow
        }
        count++;
      }
      // Then regular microtasks (queueMicrotask, Promise reactions)
      while (this.microtaskQueue.length > 0) {
        const fn = this.microtaskQueue.shift()!;
        try {
          fn();
        } catch {
          // swallow
        }
        count++;
      }
    } finally {
      if (hadCaller) setGlobalCaller(null);
    }
    return count;
  }

  requestAnimationFrame(cb: (timestamp: number) => void): number {
    const id = this.nextRafId++;
    this.rafCallbacks.push({ id, cb: () => cb(Date.now()) });
    return id;
  }

  cancelAnimationFrame(id: number): void {
    this.rafCallbacks = this.rafCallbacks.filter(r => r.id !== id);
  }

  /** Run all due tasks. Returns whether any tasks remain. */
  runOnce(now: number = Date.now()): boolean {
    // Step 1: Drain all microtasks (nextTick + regular) BEFORE any macrotask
    this.drainMicrotasks();

    // Step 2: Execute one due macrotask
    const idx = this.tasks.findIndex(t => now - t.scheduledAt >= t.delay);
    if (idx >= 0) {
      const task = this.tasks.splice(idx, 1)[0]!;
      this.timers.delete(task.id);
      try {
        this._enterTimerNesting();
        task.fn();
      } catch {
        // swallow timer callback errors
      } finally {
        this._exitTimerNesting();
      }
      // Step 3: Drain all microtasks after each macrotask
      this.drainMicrotasks();
      if (task.recurring && task.interval !== undefined) {
        task.scheduledAt = now;
        this.tasks.push(task);
        this.timers.set(task.id, task);
      }
    } else if (this.rafCallbacks.length > 0) {
      // Run RAF callbacks (if no macrotasks were due)
      const cbs = [...this.rafCallbacks];
      this.rafCallbacks = [];
      for (const { cb } of cbs) {
        try {
          cb();
        } catch {
          // swallow
        }
      }
      this.drainMicrotasks();
    }

    return this.tasks.length > 0 || this.rafCallbacks.length > 0;
  }

  /** Run all tasks synchronously until queue is empty. For testing. */
  runAll(): void {
    this.running = true;
    while (this.tasks.length > 0 || this.rafCallbacks.length > 0) {
      this.runOnce(Date.now());
    }
    this.running = false;
  }

  /** Get the time until the next task is due, or Infinity if no tasks. */
  timeUntilNext(): number {
    if (this.tasks.length === 0) return Infinity;
    const now = Date.now();
    let minWait = Infinity;
    for (const t of this.tasks) {
      const remaining = t.delay - (now - t.scheduledAt);
      if (remaining < minWait) minWait = remaining;
    }
    return Math.max(0, minWait);
  }

  get pendingCount(): number { return this.tasks.length; }
  get microtaskCount(): number { return this.microtaskQueue.length; }
  get nextTickCount(): number { return this.nextTickQueue.length; }
  get running_(): boolean { return this.running; }

  /** Release all pending tasks, timers, and animation frame callbacks. */
  clear(): void {
    this.tasks.length = 0;
    this.timers.clear();
    this.rafCallbacks.length = 0;
    this.microtaskQueue.length = 0;
    this.nextTickQueue.length = 0;
    this.running = false;
  }

  /** Alias for clear(). */
  dispose(): void {
    this.clear();
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// ENVIRONMENT BINDING HELPERS
// ─────────────────────────────────────────────────────────────────────────────

/** Bind queueMicrotask and process.nextTick to the global environment */
export function bindQueueMicrotask(
  globalEnv: Environment,
  eventLoop: EventLoop,
): void {
  // queueMicrotask(fn) — enqueue a regular microtask
  globalEnv.setLocal('queueMicrotask', createNativeFunction('queueMicrotask', (_this, args) => {
    const fn = args[0];
    if (typeof fn !== 'object' || fn === null || (fn as JSFunction).type !== 'closure') {
      throw new TypeError('queueMicrotask: argument is not a function');
    }
    eventLoop.enqueueMicrotask(() => {
      try {
        callJSFunction(fn as JSFunction, undefined, []);
      } catch {
        // swallow
      }
    });
    return undefined;
  }));

  // process object with nextTick
  const processObj = createObject(null);
  processObj.properties.set('nextTick', {
    value: createNativeFunction('nextTick', (_this, args) => {
      const fn = args[0];
      if (typeof fn !== 'object' || fn === null || (fn as JSFunction).type !== 'closure') {
        throw new TypeError('process.nextTick: argument is not a function');
      }
      eventLoop.enqueueNextTick(() => {
        try {
          callJSFunction(fn as JSFunction, undefined, []);
        } catch {
          // swallow
        }
      });
      return undefined;
    }),
    writable: true, enumerable: false, configurable: true,
  });
  processObj.properties.set('env', {
    value: createObject(null),
    writable: false, enumerable: false, configurable: false,
  });
  globalEnv.setLocal('process', processObj);
}

export function bindTimers(
  globalEnv: Environment,
  eventLoop: EventLoop,
  scriptEnforcer?: CspScriptEnforcer,
  pageOrigin?: string,
): void {
  // setTimeout
  globalEnv.setLocal('setTimeout', createNativeFunction('setTimeout', (_this, args) => {
    const fn = args[0];
    const delay = toNumber(args[1]) || 0;

    // CSP enforcement: block setTimeout("code", ms) string form
    if (typeof fn === 'string' || typeof fn === 'number') {
      if (scriptEnforcer && pageOrigin) {
        const codeSample = String(fn).slice(0, 40);
        const check = scriptEnforcer.checkTimerString(pageOrigin, pageOrigin, codeSample);
        if (!check.allowed) {
          throw new Error(`TimeoutError: ${check.reason}`);
        }
      }
      // String timers: not supported — return 0 to signal no-op
      return 0 as unknown as JSValue;
    }

    const timerFn = () => {
      if (typeof fn === 'object' && fn !== null && 'type' in fn && fn.type === 'closure') {
        try { callJSFunction(fn, _this, []); } catch { /* swallow */ }
      }
    };
    return eventLoop.schedule(timerFn, delay) as unknown as JSValue;
  }));

  // clearInterval / clearTimeout
  const clearFn = createNativeFunction('clearTimer', (_this, args) => {
    const id = toNumber(args[0]);
    eventLoop.clearTimer(id);
    return undefined;
  });
  globalEnv.setLocal('clearTimeout', clearFn);
  globalEnv.setLocal('clearInterval', clearFn);

  // setInterval
  globalEnv.setLocal('setInterval', createNativeFunction('setInterval', (_this, args) => {
    const fn = args[0];
    const interval = Math.max(1, toNumber(args[1]) || 1000);

    // CSP enforcement: block setInterval("code", ms) string form
    if (typeof fn === 'string' || typeof fn === 'number') {
      if (scriptEnforcer && pageOrigin) {
        const codeSample = String(fn).slice(0, 40);
        const check = scriptEnforcer.checkTimerString(pageOrigin, pageOrigin, codeSample);
        if (!check.allowed) {
          throw new Error(`TimeoutError: ${check.reason}`);
        }
      }
      return 0 as unknown as JSValue;
    }

    const timerFn = () => {
      if (typeof fn === 'object' && fn !== null && 'type' in fn && fn.type === 'closure') {
        try { callJSFunction(fn, _this, []); } catch { /* swallow */ }
      }
    };
    return eventLoop.schedule(timerFn, interval, true) as unknown as JSValue;
  }));

  // requestAnimationFrame
  globalEnv.setLocal('requestAnimationFrame', createNativeFunction('requestAnimationFrame', (_this, args) => {
    const cb = args[0] as JSFunction;
    return eventLoop.requestAnimationFrame((ts) => {
      if (typeof cb === 'object' && cb !== null && 'type' in cb && cb.type === 'closure') {
        try { callJSFunction(cb, _this, [ts as unknown as JSValue]); } catch { /* swallow */ }
      }
    }) as unknown as JSValue;
  }));

  // cancelAnimationFrame
  globalEnv.setLocal('cancelAnimationFrame', createNativeFunction('cancelAnimationFrame', (_this, args) => {
    const id = toNumber(args[0]);
    eventLoop.cancelAnimationFrame(id);
    return undefined;
  }));
}
