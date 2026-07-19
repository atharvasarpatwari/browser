import type { JSFunction, JSValue, JSFunctionCaller } from './values';
import { createNativeFunction, Environment, createObject, toNumber, toString, callJSFunction, setGlobalCaller } from './values';

// ─────────────────────────────────────────────────────────────────────────────
// EVENT LOOP — setTimeout, setInterval, requestAnimationFrame stub
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
  private nextRafId = 1;
  private running = false;
  private _interpreter: JSFunctionCaller | null = null;

  /** Store interpreter reference so microtasks can call JS functions after run() returns. */
  setInterpreter(interpreter: JSFunctionCaller | null): void {
    this._interpreter = interpreter;
  }

  schedule(fn: () => void, delay: number, recurring: boolean = false): number {
    const id = this.nextTaskId++;
    const task: Task = {
      id,
      fn,
      delay: Math.max(0, delay),
      scheduledAt: Date.now(),
      recurring,
      interval: recurring ? delay : undefined,
    };
    this.tasks.push(task);
    this.timers.set(id, task);
    return id;
  }

  clearTimer(id: number): void {
    this.timers.delete(id);
    this.tasks = this.tasks.filter(t => t.id !== id);
  }

  enqueueMicrotask(fn: () => void): void {
    this.microtaskQueue.push(fn);
  }

  /** Drain the microtask queue. Returns the number of microtasks executed. */
  drainMicrotasks(): number {
    let count = 0;
    // Ensure interpreter context is available for microtask callbacks that call JS functions
    const hadCaller = this._interpreter;
    if (hadCaller) setGlobalCaller(hadCaller);
    try {
      while (this.microtaskQueue.length > 0) {
        const fn = this.microtaskQueue.shift()!;
        try {
          fn();
        } catch (e) {
          // swallow — microtask errors don't crash the engine
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
    const due = this.tasks.filter(t => now - t.scheduledAt >= t.delay);
    this.tasks = this.tasks.filter(t => now - t.scheduledAt < t.delay);

    for (const task of due) {
      this.timers.delete(task.id);
      try {
        task.fn();
      } catch {
        // swallow timer callback errors
      }
      this.drainMicrotasks();
      if (task.recurring && task.interval !== undefined) {
        task.scheduledAt = now;
        this.tasks.push(task);
        this.timers.set(task.id, task);
      }
    }

    // Run RAF callbacks
    if (this.rafCallbacks.length > 0) {
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
  get running_(): boolean { return this.running; }

  /** Release all pending tasks, timers, and animation frame callbacks. */
  clear(): void {
    this.tasks.length = 0;
    this.timers.clear();
    this.rafCallbacks.length = 0;
    this.microtaskQueue.length = 0;
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

export function bindTimers(
  globalEnv: Environment,
  eventLoop: EventLoop,
): void {
  // setTimeout
  globalEnv.setLocal('setTimeout', createNativeFunction('setTimeout', (_this, args) => {
    const fn = args[0] as JSFunction;
    const delay = toNumber(args[1]) || 0;
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
    const fn = args[0] as JSFunction;
    const interval = Math.max(1, toNumber(args[1]) || 1000);
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
