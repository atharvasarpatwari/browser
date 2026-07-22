import type { DomDocument } from '../rendering/dom-tree';
import type { IDomTree, DomElement } from '../rendering/dom-tree';
import type { INavigationController } from '../navigation/navigation-controller';
import { Lexer } from './lexer';
import { Parser } from './parser';
import { Interpreter } from './interpreter';
import { createDocumentBinding } from './dom-bindings';
import { createHistoryBinding, createLocationBinding, wireHistoryEvents, bindWindowEvents } from './history-bindings';
import { EventLoop, bindTimers } from './event-loop';
import { createObject, createArray, createNativeFunction, Environment, toNumber, toString, toBoolean, callJSFunction } from './values';
import type { JSValue, JSObject } from './values';
import { IntersectionObserver } from '../rendering/intersection-observer';
import {
  createHeadersClass, createResponseClass, createRequestClass,
  createAbortControllerClass, createFetchFn,
} from './fetch-api';
import type { CspResourceEnforcer } from '../security/csp-resource-enforcer';

export { Lexer } from './lexer';
export { Parser } from './parser';
export { Interpreter } from './interpreter';
export { EventLoop, bindTimers } from './event-loop';
export { createDocumentBinding, createEventObject } from './dom-bindings';
export { createHistoryBinding, createLocationBinding, wireHistoryEvents, bindWindowEvents } from './history-bindings';
export {
  type JSValue, type JSObject, type JSFunction,
  createObject, createArray, createNativeFunction,
  Environment,
} from './values';
export { BytecodeCompiler } from './bytecode-compiler';
export { BytecodeVM } from './vm';
export { type BytecodeFunction, type BytecodeProgram, OP } from './bytecode';
export { WasmCompiler, createHostImports } from './wasm-codegen';
export { JITManager, TieredExecutor } from './jit';
export { GarbageCollector, getGC, setGC } from './gc';
export { Heap, getHeap, setHeap } from './heap';
export { RootScanner, WeakRefStore } from './roots';

// ─────────────────────────────────────────────────────────────────────────────
// PUBLIC API
// ─────────────────────────────────────────────────────────────────────────────

export interface RunJSOptions {
  /** The DOM document to bind to. */
  document: DomDocument;
  /** The IDomTree instance for DOM queries. */
  domTree: IDomTree;
  /** Optional event loop instance (created if not provided). */
  eventLoop?: EventLoop;
  /** Optional pre-created global environment (created if not provided). */
  globalEnv?: Environment;
  /** Optional NavigationController for history/location bindings. */
  controller?: INavigationController;
  /** Optional platform fetch override. */
  platformFetch?: (url: string | Request, init?: Record<string, unknown>) => Promise<globalThis.Response>;
  /** Optional CSP resource enforcer for fetch() connect-src checks. */
  resourceEnforcer?: CspResourceEnforcer;
  /** Optional page origin for CSP enforcement. */
  pageOrigin?: string;
}

export interface RunJSResult {
  /** The value returned by the last expression/statement. */
  value: unknown;
  /** Any error thrown during execution, or undefined. */
  error?: { message: string; line?: number; column?: number };
  /** The event loop instance (for further scheduling). */
  eventLoop: EventLoop;
}

/**
 * Run JavaScript source code against a DOM tree.
 *
 * This is the main entry point for the JS engine.
 * It lexes, parses, and executes the source with full DOM bindings.
 */
export function runJS(source: string, options: RunJSOptions): RunJSResult {
  const { document: doc, domTree, eventLoop = new EventLoop(), globalEnv, controller, platformFetch, resourceEnforcer, pageOrigin } = options;

  try {
    // 1. Lex (lazy — parser pulls tokens on demand for template interpolation support)
    const lexer = new Lexer(source);

    // 2. Parse
    const parser = new Parser([], lexer);
    const program = parser.parse();

    // 3. Execute
    const env = globalEnv ?? createGlobalEnv(doc, domTree, eventLoop, controller, platformFetch, resourceEnforcer, pageOrigin);
    const interpreter = new Interpreter(env, eventLoop);
    const value = interpreter.run(program);

    return { value, eventLoop };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { value: undefined, error: { message }, eventLoop };
  }
}

/**
 * Create a global environment pre-configured with DOM bindings and timers.
 */
export function createGlobalEnv(
  doc: DomDocument,
  domTree: IDomTree,
  eventLoop: EventLoop,
  controller?: INavigationController,
  platformFetch?: (url: string | Request, init?: Record<string, unknown>) => Promise<globalThis.Response>,
  resourceEnforcer?: CspResourceEnforcer,
  pageOrigin?: string,
): Environment {
  const env = new Environment(null);

  // Console
  const consoleObj = createObject(null);
  const logs: unknown[] = [];
  consoleObj.properties.set('log', {
    value: createNativeFunction('log', (_this, args) => {
      logs.push(...args);
      return undefined;
    }),
    writable: true, enumerable: true, configurable: true,
  });
  consoleObj.properties.set('error', {
    value: createNativeFunction('error', (_this, args) => {
      logs.push(...args);
      return undefined;
    }),
    writable: true, enumerable: true, configurable: true,
  });
  consoleObj.properties.set('warn', {
    value: createNativeFunction('warn', (_this, args) => {
      logs.push(...args);
      return undefined;
    }),
    writable: true, enumerable: true, configurable: true,
  });
  consoleObj.properties.set('info', {
    value: createNativeFunction('info', (_this, args) => {
      logs.push(...args);
      return undefined;
    }),
    writable: true, enumerable: true, configurable: true,
  });
  consoleObj.properties.set('clear', {
    value: createNativeFunction('clear', () => { logs.length = 0; return undefined; }),
    writable: true, enumerable: true, configurable: true,
  });
  consoleObj.properties.set('assert', {
    value: createNativeFunction('assert', (_this, args) => {
      const condition = args[0];
      if (!condition) {
        const msg = args.length > 1 ? toString(args[1]) : 'Assertion failed';
        logs.push(msg);
      }
      return undefined;
    }),
    writable: true, enumerable: true, configurable: true,
  });
  env.setLocal('console', consoleObj);

  // Math
  const mathObj = createObject(null);
  const mathProps: Record<string, number> = {
    PI: Math.PI, E: Math.E, LN2: Math.LN2, LN10: Math.LN10,
    LOG2E: Math.LOG2E, LOG10E: Math.LOG10E, SQRT1_2: Math.SQRT1_2,
    SQRT2: Math.SQRT2, MAX_SAFE_INTEGER: Number.MAX_SAFE_INTEGER,
    MIN_SAFE_INTEGER: Number.MIN_SAFE_INTEGER, NaN: NaN, Infinity: Infinity,
  };
  for (const [k, v] of Object.entries(mathProps)) {
    mathObj.properties.set(k, { value: v, writable: false, enumerable: true, configurable: false });
  }
  const mathFns: Record<string, (...args: number[]) => number> = {
    abs: Math.abs, ceil: Math.ceil, floor: Math.floor, round: Math.round,
    trunc: Math.trunc, sign: Math.sign, sqrt: Math.sqrt, cbrt: Math.cbrt,
    pow: Math.pow, exp: Math.exp, log: Math.log, log2: Math.log2,
    log10: Math.log10, min: Math.min, max: Math.max, random: Math.random,
    sin: Math.sin, cos: Math.cos, tan: Math.tan,
    asin: Math.asin, acos: Math.acos, atan: Math.atan, atan2: Math.atan2,
    sinh: Math.sinh, cosh: Math.cosh, tanh: Math.tanh,
    hypot: Math.hypot, fround: Math.fround,
  };
  for (const [name, fn] of Object.entries(mathFns)) {
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

  // JSON
  const toJSValue = (val: unknown): JSValue => {
    if (val === null || val === undefined) return val as JSValue;
    if (typeof val === 'boolean' || typeof val === 'number' || typeof val === 'string') return val as JSValue;
    if (Array.isArray(val)) {
      const arr = createArray(val.map(toJSValue));
      return arr;
    }
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
      const str = toString(args[0]);
      try {
        return toJSValue(JSON.parse(str));
      } catch {
        return undefined;
      }
    }),
    writable: true, enumerable: true, configurable: true,
  });
  jsonObj.properties.set('stringify', {
    value: createNativeFunction('stringify', (_this, args) => {
      const val = args[0];
      const result = jsonStrify(val);
      return result === undefined ? undefined : result;
    }),
    writable: true, enumerable: true, configurable: true,
  });
  env.setLocal('JSON', jsonObj);

  // Constructors
  env.setLocal('String', createNativeFunction('String', (_this, args) => args.length > 0 ? toString(args[0]) : ''));
  env.setLocal('Number', createNativeFunction('Number', (_this, args) => args.length > 0 ? toNumber(args[0]) : 0));
  env.setLocal('Boolean', createNativeFunction('Boolean', (_this, args) => args.length > 0 ? toBoolean(args[0]) : false));

  // Error constructors
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

  // DOM binding
  const docBinding = createDocumentBinding(doc, domTree);
  env.setLocal('document', docBinding);

  // window — the global scope object (like browser window)
  const windowObj = createObject(null);
  env.setLocal('window', windowObj);

  // Wire window-level event listeners (addEventListener/removeEventListener/dispatchEvent)
  bindWindowEvents(windowObj);

  // Wire History API and Location if a controller is provided.
  if (controller) {
    const historyObj = createHistoryBinding(controller, windowObj);
    windowObj.properties.set('history', {
      value: historyObj, writable: false, enumerable: true, configurable: false,
    });

    const locationObj = createLocationBinding(controller, windowObj);
    windowObj.properties.set('location', {
      value: locationObj, writable: true, enumerable: true, configurable: false,
    });

    // Also expose as globals (matches browser behavior).
    env.setLocal('history', historyObj);
    env.setLocal('location', locationObj);

    // Wire popstate / hashchange events from NavigationController → window.
    wireHistoryEvents(controller, windowObj);
  }

  // Bind timers
  bindTimers(env, eventLoop);

  // Fetch API
  env.setLocal('Headers', createHeadersClass(eventLoop));
  env.setLocal('Response', createResponseClass(eventLoop));
  env.setLocal('Request', createRequestClass(eventLoop));
  env.setLocal('AbortController', createAbortControllerClass(eventLoop));
  env.setLocal('fetch', createFetchFn(eventLoop, platformFetch, resourceEnforcer, pageOrigin));

  // IntersectionObserver constructor
  env.setLocal('IntersectionObserver', createNativeFunction('IntersectionObserver', (_this, args) => {
    const callback = args[0];
    const options = args[1] as JSObject | undefined;

    let rootMargin = '0px';
    let threshold: number | number[] = [0];
    if (options && typeof options === 'object') {
      const rm = options.properties.get('rootMargin');
      if (rm) rootMargin = toString(rm.value);
      const th = options.properties.get('threshold');
      if (th && typeof th.value === 'number') threshold = th.value;
    }

    const ioObj = createObject(null);
    const observed = new Set<string>();

    const nativeIO = new IntersectionObserver(
      (entries) => {
        if (callback && typeof callback === 'object' && callback !== null && 'type' in callback) {
          const entryArr = createArray(entries.map(entry => {
            const eObj = createObject(null);
            eObj.properties.set('isIntersecting', { value: entry.isIntersecting, writable: false, enumerable: true, configurable: false });
            eObj.properties.set('intersectionRatio', { value: entry.intersectionRatio, writable: false, enumerable: true, configurable: false });
            eObj.properties.set('time', { value: entry.time, writable: false, enumerable: true, configurable: false });
            return eObj;
          }));
          callJSFunction(callback, ioObj, [entryArr, ioObj]);
        }
      },
      { rootMargin, threshold },
    );

    ioObj.properties.set('observe', {
      value: createNativeFunction('observe', (_t, a) => {
        const wrapped = a[0] as JSObject;
        if (wrapped && typeof wrapped === 'object' && '__domNode' in wrapped) {
          const el = (wrapped as any).__domNode as DomElement;
          nativeIO.observe(el);
          observed.add(el.domId);
        }
      }),
      writable: true, enumerable: true, configurable: true,
    });
    ioObj.properties.set('unobserve', {
      value: createNativeFunction('unobserve', (_t, a) => {
        const wrapped = a[0] as JSObject;
        if (wrapped && typeof wrapped === 'object' && '__domNode' in wrapped) {
          const el = (wrapped as any).__domNode as DomElement;
          nativeIO.unobserve(el);
          observed.delete(el.domId);
        }
      }),
      writable: true, enumerable: true, configurable: true,
    });
    ioObj.properties.set('disconnect', {
      value: createNativeFunction('disconnect', () => { nativeIO.disconnect(); observed.clear(); }),
      writable: true, enumerable: true, configurable: true,
    });
    ioObj.properties.set('takeRecords', {
      value: createNativeFunction('takeRecords', () => createArray([])),
      writable: true, enumerable: true, configurable: true,
    });

    return ioObj;
  }));

  return env;
}
