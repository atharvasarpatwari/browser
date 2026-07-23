/**
 * @file src/browser/js/worker.ts
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WEB WORKER — Isolated background JS execution context
 * ─────────────────────────────────────────────────────────────────────────────
 * Each Worker owns:
 *   • Its own Interpreter instance (separate global env, no DOM access)
 *   • Its own EventLoop (independent timers and microtasks)
 *   • A message port for postMessage/onmessage communication with the main thread
 *
 * The worker environment provides:
 *   • console, Math, JSON, parseInt, parseFloat, isNaN, isFinite
 *   • setTimeout, setInterval, clearTimeout, clearInterval
 *   • fetch, Headers, Response, Request, AbortController
 *   • postMessage(data), self.close()
 *
 * NOT available in workers:
 *   • document, window, DOM APIs, history, location, IntersectionObserver
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { Interpreter } from './interpreter';
import { EventLoop, bindTimers } from './event-loop';
import { Environment, createObject, createArray, createNativeFunction, toNumber, toString, callJSFunction } from './values';
import type { JSValue, JSObject, JSFunction } from './values';
import { Lexer } from './lexer';
import { Parser } from './parser';
import {
  createHeadersClass, createResponseClass, createRequestClass,
  createAbortControllerClass, createFetchFn,
} from './fetch-api';

// ─────────────────────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────────────────────

export enum WorkerState {
  Idle       = 'idle',
  Running    = 'running',
  Terminated = 'terminated',
  Errored    = 'errored',
}

export interface WorkerOptions {
  name?: string;
}

export interface MessageEvent {
  type: 'message';
  data: JSValue;
  origin: string;
  source: Worker;
}

export interface WorkerErrorEvent {
  type: 'error';
  message: string;
  filename?: string;
  lineno?: number;
  colno?: number;
  error?: unknown;
}

export type WorkerEventListener = (event: MessageEvent | WorkerErrorEvent) => void;

// ─────────────────────────────────────────────────────────────────────────────
// STRUCTURED CLONE — Simplified clone for message passing
// ─────────────────────────────────────────────────────────────────────────────

export function structuredCloneJSValue(val: JSValue): JSValue {
  if (val === null || val === undefined) return val;
  if (typeof val === 'boolean' || typeof val === 'number' || typeof val === 'string') return val;
  if (typeof val === 'bigint') return val;
  if (typeof val === 'object') {
    const obj = val as JSObject;
    if (obj.type === 'array') {
      const len = Number(obj.properties.get('length')?.value ?? 0);
      const elems: JSValue[] = [];
      for (let i = 0; i < len; i++) {
        const desc = obj.properties.get(String(i));
        elems.push(desc ? structuredCloneJSValue(desc.value) : undefined);
      }
      return createArray(elems);
    }
    const cloned = createObject(null);
    for (const [key, desc] of obj.properties) {
      cloned.properties.set(key, {
        value: structuredCloneJSValue(desc.value),
        writable: desc.writable,
        enumerable: desc.enumerable,
        configurable: desc.configurable,
      });
    }
    return cloned;
  }
  return val;
}

// ─────────────────────────────────────────────────────────────────────────────
// WORKER — Main thread handle AND isolated execution context
//
// The Worker class IS the main-thread handle. It exposes:
//   • postMessage(data) — sends data into the worker
//   • onmessage — receives data from the worker
//   • addEventListener('message', fn) / removeEventListener
//   • terminate()
//
// Internally it owns a separate Interpreter + EventLoop for worker-side execution.
// The worker-side postMessage() calls back to the Worker's emitMessage().
// ─────────────────────────────────────────────────────────────────────────────

export class Worker {
  readonly name: string;
  state: WorkerState = WorkerState.Idle;
  private eventLoop: EventLoop;
  private interpreter: Interpreter;
  private env: Environment;
  private scriptSource: string;
  private scriptUrl: string;
  /** Main-thread listeners for worker→main messages. */
  private listeners: Map<string, WorkerEventListener[]> = new Map();
  /** The worker's onmessage JSFunction (set by worker code via self.onmessage = fn). */
  private _workerOnMessage: JSFunction | null = null;
  /** The worker's self JSObject (holds onmessage property). */
  private selfObj: JSObject | null = null;
  private platformFetch?: (url: string | Request, init?: Record<string, unknown>) => Promise<globalThis.Response>;

  constructor(
    scriptSource: string,
    scriptUrl: string,
    options?: WorkerOptions,
    platformFetch?: (url: string | Request, init?: Record<string, unknown>) => Promise<globalThis.Response>,
  ) {
    this.name = options?.name ?? 'Worker';
    this.scriptSource = scriptSource;
    this.scriptUrl = scriptUrl;
    this.platformFetch = platformFetch;
    this.eventLoop = new EventLoop();
    this.env = this.createWorkerEnv();
    this.interpreter = new Interpreter(this.env, this.eventLoop);
    this.interpreter.setMaxExecutionMs(30000);
    this.state = WorkerState.Running;
  }

  private createWorkerEnv(): Environment {
    const env = new Environment(null);
    env.markFunctionScope();
    env.setLocal('undefined', undefined);

    const selfObj = createObject(null);
    this.selfObj = selfObj;
    env.setLocal('self', selfObj);

    // self.onmessage — worker sets this to receive messages from main thread
    selfObj.properties.set('onmessage', {
      value: undefined, writable: true, enumerable: true, configurable: true,
    });

    // console
    const consoleObj = createObject(null);
    consoleObj.properties.set('log', {
      value: createNativeFunction('log', (_this, args) => {
        console.log(`[Worker:${this.name}]`, args.map(a => toString(a)).join(' '));
        return undefined;
      }),
      writable: true, enumerable: true, configurable: true,
    });
    consoleObj.properties.set('error', {
      value: createNativeFunction('error', (_this, args) => {
        console.error(`[Worker:${this.name}]`, args.map(a => toString(a)).join(' '));
        return undefined;
      }),
      writable: true, enumerable: true, configurable: true,
    });
    consoleObj.properties.set('warn', {
      value: createNativeFunction('warn', (_this, args) => {
        console.warn(`[Worker:${this.name}]`, args.map(a => toString(a)).join(' '));
        return undefined;
      }),
      writable: true, enumerable: true, configurable: true,
    });
    env.setLocal('console', consoleObj);

    // Math
    const mathObj = createObject(null);
    for (const [k, v] of Object.entries({
      PI: Math.PI, E: Math.E, LN2: Math.LN2, LN10: Math.LN10,
      LOG2E: Math.LOG2E, LOG10E: Math.LOG10E, SQRT1_2: Math.SQRT1_2,
      SQRT2: Math.SQRT2, MAX_SAFE_INTEGER: Number.MAX_SAFE_INTEGER,
      MIN_SAFE_INTEGER: Number.MIN_SAFE_INTEGER, NaN: NaN, Infinity: Infinity,
    })) {
      mathObj.properties.set(k, { value: v, writable: false, enumerable: true, configurable: false });
    }
    for (const [name, fn] of Object.entries({
      abs: Math.abs, ceil: Math.ceil, floor: Math.floor, round: Math.round,
      trunc: Math.trunc, sign: Math.sign, sqrt: Math.sqrt, cbrt: Math.cbrt,
      pow: Math.pow, exp: Math.exp, log: Math.log, log2: Math.log2,
      log10: Math.log10, min: Math.min, max: Math.max, random: Math.random,
      sin: Math.sin, cos: Math.cos, tan: Math.tan,
      asin: Math.asin, acos: Math.acos, atan: Math.atan, atan2: Math.atan2,
      sinh: Math.sinh, cosh: Math.cosh, tanh: Math.tanh,
      hypot: Math.hypot, fround: Math.fround,
    } as Record<string, (...args: number[]) => number>)) {
      mathObj.properties.set(name, {
        value: createNativeFunction(name, (_this, args) => fn(...args.map(toNumber))),
        writable: true, enumerable: true, configurable: true,
      });
    }
    env.setLocal('Math', mathObj);

    // Global functions
    env.setLocal('parseInt', createNativeFunction('parseInt', (_this, args) => {
      const radix = args.length > 1 ? Math.max(2, Math.min(36, toNumber(args[1]))) : 10;
      return parseInt(toString(args[0]), radix);
    }));
    env.setLocal('parseFloat', createNativeFunction('parseFloat', (_this, args) => parseFloat(toString(args[0]))));
    env.setLocal('isNaN', createNativeFunction('isNaN', (_this, args) => isNaN(toNumber(args[0]))));
    env.setLocal('isFinite', createNativeFunction('isFinite', (_this, args) => isFinite(toNumber(args[0]))));
    env.setLocal('encodeURI', createNativeFunction('encodeURI', (_this, args) => encodeURI(toString(args[0]))));
    env.setLocal('decodeURI', createNativeFunction('decodeURI', (_this, args) => decodeURI(toString(args[0]))));
    env.setLocal('encodeURIComponent', createNativeFunction('encodeURIComponent', (_this, args) => encodeURIComponent(toString(args[0]))));
    env.setLocal('decodeURIComponent', createNativeFunction('decodeURIComponent', (_this, args) => decodeURIComponent(toString(args[0]))));

    // Constructors
    env.setLocal('String', createNativeFunction('String', (_this, args) => args.length > 0 ? toString(args[0]) : ''));
    env.setLocal('Number', createNativeFunction('Number', (_this, args) => args.length > 0 ? toNumber(args[0]) : 0));
    env.setLocal('Boolean', createNativeFunction('Boolean', (_this, args) => args.length > 0 ? toNumber(args[0]) !== 0 : false));
    env.setLocal('Array', createNativeFunction('Array', (_this, args) => createArray(args)));
    env.setLocal('Object', createNativeFunction('Object', (_this, args) => {
      if (typeof args[0] === 'object' && args[0] !== null) return args[0];
      return createObject(null);
    }));

    for (const name of ['Error', 'TypeError', 'ReferenceError', 'RangeError', 'SyntaxError']) {
      env.setLocal(name, createNativeFunction(name, (_this, args) => {
        const msg = args.length > 0 ? toString(args[0]) : '';
        const err = createObject(null);
        err.properties.set('message', { value: msg, writable: true, enumerable: true, configurable: true });
        err.properties.set('name', { value: name, writable: true, enumerable: true, configurable: true });
        err.properties.set('stack', { value: '', writable: true, enumerable: true, configurable: true });
        return err;
      }));
    }

    // JSON
    const toJSValue = (val: unknown): JSValue => {
      if (val === null || val === undefined) return val as JSValue;
      if (typeof val === 'boolean' || typeof val === 'number' || typeof val === 'string') return val as JSValue;
      if (Array.isArray(val)) return createArray(val.map(toJSValue));
      if (typeof val === 'object') {
        const obj = createObject(null);
        for (const [k, v] of Object.entries(val as Record<string, unknown>)) {
          obj.properties.set(k, { value: toJSValue(v), writable: true, enumerable: true, configurable: true });
        }
        return obj;
      }
      return undefined;
    };
    const jsonStrify = (val: JSValue): string | undefined => {
      if (val === undefined || typeof val === 'function') return undefined;
      if (val === null) return 'null';
      if (typeof val === 'boolean') return val ? 'true' : 'false';
      if (typeof val === 'number') {
        if (Object.is(val, -0)) return '0';
        if (isNaN(val) || !isFinite(val)) return 'null';
        return String(val);
      }
      if (typeof val === 'string') return `"${val.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n').replace(/\r/g, '\\r').replace(/\t/g, '\\t')}"`;
      if (typeof val === 'object') {
        const obj = val as JSObject;
        if (obj.type === 'array') {
          const len = Number(obj.properties.get('length')?.value ?? 0);
          const elems: string[] = [];
          for (let i = 0; i < len; i++) {
            const v = obj.properties.get(String(i))?.value;
            elems.push(jsonStrify(v) ?? 'null');
          }
          return `[${elems.join(',')}]`;
        }
        const pairs: string[] = [];
        for (const [k, desc] of obj.properties) {
          const v = desc.value;
          if (v === undefined || typeof v === 'function') continue;
          pairs.push(`"${k}":${jsonStrify(v) ?? 'null'}`);
        }
        return `{${pairs.join(',')}}`;
      }
      return toString(val);
    };
    const jsonObj = createObject(null);
    jsonObj.properties.set('parse', {
      value: createNativeFunction('parse', (_this, args) => {
        try { return toJSValue(JSON.parse(toString(args[0]))); } catch { return undefined; }
      }),
      writable: true, enumerable: true, configurable: true,
    });
    jsonObj.properties.set('stringify', {
      value: createNativeFunction('stringify', (_this, args) => {
        const result = jsonStrify(args[0]);
        return result === undefined ? undefined : result;
      }),
      writable: true, enumerable: true, configurable: true,
    });
    env.setLocal('JSON', jsonObj);

    // Timers
    bindTimers(env, this.eventLoop);

    // Fetch API
    env.setLocal('Headers', createHeadersClass(this.eventLoop));
    env.setLocal('Response', createResponseClass(this.eventLoop));
    env.setLocal('Request', createRequestClass(this.eventLoop));
    env.setLocal('AbortController', createAbortControllerClass(this.eventLoop));
    env.setLocal('fetch', createFetchFn(this.eventLoop, this.platformFetch));

    // ── Worker-specific APIs ──

    // postMessage(data) — sends from worker to main thread
    env.setLocal('postMessage', createNativeFunction('postMessage', (_this, args) => {
      const data = args.length > 0 ? structuredCloneJSValue(args[0]) : undefined;
      this.emitMessage(data);
      return undefined;
    }));

    // close() — terminates the worker from inside
    env.setLocal('close', createNativeFunction('close', () => {
      this.state = WorkerState.Terminated;
      this.eventLoop.clear();
      return undefined;
    }));

    return env;
  }

  // ── Public API (main thread) ──

  getEventLoop(): EventLoop { return this.eventLoop; }
  getInterpreter(): Interpreter { return this.interpreter; }

  start(): void {
    this.state = WorkerState.Running;
    try {
      const lexer = new Lexer(this.scriptSource);
      const parser = new Parser([], lexer);
      const program = parser.parse();
      this.interpreter.run(program);
      this.eventLoop.drainMicrotasks();
    } catch (err) {
      this.state = WorkerState.Errored;
      const msg = err instanceof Error ? err.message : String(err);
      this.emitError(msg);
    }
  }

  executeScript(source: string): void {
    try {
      const lexer = new Lexer(source);
      const parser = new Parser([], lexer);
      const program = parser.parse();
      this.interpreter.run(program);
      this.eventLoop.drainMicrotasks();
    } catch (err) {
      this.state = WorkerState.Errored;
      const msg = err instanceof Error ? err.message : String(err);
      this.emitError(msg);
    }
  }

  terminate(): void {
    this.state = WorkerState.Terminated;
    this.eventLoop.clear();
  }

  // ── Main-thread message API ──

  /** Send data from main thread into the worker. */
  postMessage(data?: JSValue): void {
    if (this.state !== WorkerState.Running) return;
    const cloned = data !== undefined ? structuredCloneJSValue(data) : undefined;
    // Deliver to worker via microtask (non-blocking)
    this.eventLoop.enqueueMicrotask(() => {
      if (this.state !== WorkerState.Running) return;
      const onmsg = this.selfObj?.properties.get('onmessage')?.value;
      if (onmsg && typeof onmsg === 'object' && 'type' in onmsg) {
        const eventObj = createObject(null);
        eventObj.properties.set('data', { value: cloned, writable: false, enumerable: true, configurable: false });
        eventObj.properties.set('type', { value: 'message', writable: false, enumerable: true, configurable: false });
        try {
          callJSFunction(onmsg as JSFunction, eventObj, [eventObj]);
        } catch (err) {
          this.state = WorkerState.Errored;
          this.emitError(err instanceof Error ? err.message : String(err));
        }
      }
    });
  }

  addEventListener(type: string, listener: WorkerEventListener): void {
    if (!this.listeners.has(type)) this.listeners.set(type, []);
    this.listeners.get(type)!.push(listener);
  }

  removeEventListener(type: string, listener: WorkerEventListener): void {
    const list = this.listeners.get(type);
    if (!list) return;
    const idx = list.indexOf(listener);
    if (idx >= 0) list.splice(idx, 1);
  }

  /** Emit a message from the worker to the main thread. */
  private emitMessage(data: JSValue): void {
    const event: MessageEvent = { type: 'message', data, origin: '', source: this };
    const list = this.listeners.get('message');
    if (list) {
      for (const fn of [...list]) {
        try { fn(event); } catch { /* swallow */ }
      }
    }
  }

  /** Emit an error event to the main thread. */
  private emitError(message: string): void {
    const event: WorkerErrorEvent = { type: 'error', message };
    const list = this.listeners.get('error');
    if (list) {
      for (const fn of [...list]) {
        try { fn(event); } catch { /* swallow */ }
      }
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// WORKER PARENT PORT — JSObject wrapper for the JS environment
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Wraps a Worker as a JSObject with postMessage/terminate/addEventListener methods.
 * This is what gets returned to JS code as `new Worker(url)`.
 */
export class WorkerParentPort {
  private worker: Worker;
  private jsObj: JSObject;

  constructor(worker: Worker) {
    this.worker = worker;
    this.jsObj = createObject(null);
    this.setup();
  }

  private setup(): void {
    // postMessage(data) — main thread → worker
    this.jsObj.properties.set('postMessage', {
      value: createNativeFunction('postMessage', (_this, args) => {
        const data = args.length > 0 ? args[0] : undefined;
        this.worker.postMessage(data);
        return undefined;
      }),
      writable: true, enumerable: true, configurable: true,
    });

    // terminate()
    this.jsObj.properties.set('terminate', {
      value: createNativeFunction('terminate', () => {
        this.worker.terminate();
        return undefined;
      }),
      writable: true, enumerable: true, configurable: true,
    });

    // addEventListener(type, fn)
    this.jsObj.properties.set('addEventListener', {
      value: createNativeFunction('addEventListener', (_this, args) => {
        const type = toString(args[0]);
        const handler = args[1];
        if (handler && typeof handler === 'object' && 'type' in handler) {
          this.worker.addEventListener(type, (event) => {
            if (event.type === 'message') {
              const eventObj = createObject(null);
              eventObj.properties.set('data', { value: event.data, writable: false, enumerable: true, configurable: false });
              eventObj.properties.set('type', { value: event.type, writable: false, enumerable: true, configurable: false });
              callJSFunction(handler as JSFunction, eventObj, [eventObj]);
            }
          });
        }
        return undefined;
      }),
      writable: true, enumerable: true, configurable: true,
    });

    // removeEventListener(type, fn)
    this.jsObj.properties.set('removeEventListener', {
      value: createNativeFunction('removeEventListener', (_this, args) => {
        this.worker.removeEventListener(toString(args[0]), () => {});
        return undefined;
      }),
      writable: true, enumerable: true, configurable: true,
    });

    // onmessage property
    this.jsObj.properties.set('onmessage', {
      value: undefined, writable: true, enumerable: true, configurable: true,
    });
  }

  getJSObject(): JSObject { return this.jsObj; }
  getWorker(): Worker { return this.worker; }
}

// ─────────────────────────────────────────────────────────────────────────────
// FACTORY — Creates the Worker constructor for the JS environment
// ─────────────────────────────────────────────────────────────────────────────

export function createWorkerConstructor(
  eventLoop: EventLoop,
  platformFetch?: (url: string | Request, init?: Record<string, unknown>) => Promise<globalThis.Response>,
  scriptLoader?: (url: string) => string,
) {
  return createNativeFunction('Worker', (_this, args) => {
    const scriptUrl = args.length > 0 ? toString(args[0]) : '';
    if (!scriptUrl) throw new Error('Worker constructor requires a script URL');

    const scriptSource = scriptLoader ? scriptLoader(scriptUrl) : scriptUrl;
    const worker = new Worker(scriptSource, scriptUrl, undefined, platformFetch);
    const port = new WorkerParentPort(worker);
    worker.start();
    return port.getJSObject();
  });
}
