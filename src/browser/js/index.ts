import type { DomDocument } from '../rendering/dom-tree';
import type { IDomTree, DomElement } from '../rendering/dom-tree';
import type { INavigationController } from '../navigation/navigation-controller';
import { Lexer } from './lexer';
import { Parser } from './parser';
import { Interpreter } from './interpreter';
import { createDocumentBinding, wrapElement, createEventObject } from './dom-bindings';
import type { IHtmlParser, HtmlDocument } from '../rendering/html-parser';
import { createHistoryBinding, createLocationBinding, wireHistoryEvents, bindWindowEvents } from './history-bindings';
import { EventLoop, bindTimers, bindQueueMicrotask } from './event-loop';
import { createPromiseConstructor } from './promise';
import { createObject, createArray, createNativeFunction, Environment, toNumber, toString, toBoolean, toPropertyKey, callJSFunction, type JSFunction, type NativeFunction, isJSObjectWithMeta, registerErrorPrototype, makeErrorObject } from './values';
import type { JSValue, JSObject, JSObjectWithMeta } from './values';
import { IntersectionObserver } from '../rendering/intersection-observer';
import {
  createHeadersClass, createResponseClass, createRequestClass,
  createAbortControllerClass, createFetchFn,
} from './fetch-api';
import { createXMLHttpRequestClass } from './xhr';
import { createWebSocketClass } from './websocket-api';
import { createRTCPeerConnectionClass, createRTCSessionDescriptionClass, createRTCIceCandidateClass } from './rtc-api';
import { createWorkerConstructor } from './worker';
import { createTypedArrayConstructors } from './typed-arrays';
import { createCryptoObject } from './crypto-api';
import { createCustomElementRegistry, createHTMLElementClass } from './custom-elements';
import { createCacheStorage } from './cache-api';
import { createConsoleObject } from './console-api';
import { bindStorageAPIs } from './web-storage-bindings';
import { bindWebSQL } from './web-sql-bindings';
import {
  bindWebAPIs, createPerformanceObject, createFullscreenAPIMethods,
  createTreeWalkerObject, createNodeIteratorObject, createSelectionObject,
  createRangeObject,
} from './web-apis';
import type { CspResourceEnforcer } from '../security/csp-resource-enforcer';
import type { CspScriptEnforcer } from '../security/csp-script-enforcer';

export { Lexer } from './lexer';
export { Parser } from './parser';
export { Interpreter } from './interpreter';
export { EventLoop, bindTimers } from './event-loop';
export { createDocumentBinding, createEventObject, wrapElement } from './dom-bindings';
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
export { createWebSocketClass, setPlatformWebSocketFactory } from './websocket-api';
export { createCryptoObject, createSubtleCryptoObject } from './crypto-api';
export { createCustomElementRegistry, createHTMLElementClass } from './custom-elements';
export { createCacheStorage } from './cache-api';
export { createConsoleObject, getConsoleLog, onConsoleMessage, type ConsoleEntry, type ConsoleLevel } from './console-api';
export { createRTCPeerConnectionClass, createRTCSessionDescriptionClass, createRTCIceCandidateClass } from './rtc-api';

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
  /** Optional CSP script enforcer for eval()/timer-string checks. */
  scriptEnforcer?: CspScriptEnforcer;
  /** Optional page origin for CSP enforcement. */
  pageOrigin?: string;
  /** Optional HtmlParser for document.write()/document.open() support. */
  htmlParser?: IHtmlParser;
  /** Optional base directory for persistent web storage (localStorage/IndexedDB). */
  storageDir?: string;
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
  const { document: doc, domTree, eventLoop = new EventLoop(), globalEnv, controller, platformFetch, resourceEnforcer, scriptEnforcer, pageOrigin, htmlParser, storageDir } = options;

  try {
    // 1. Lex (lazy — parser pulls tokens on demand for template interpolation support)
    const lexer = new Lexer(source);

    // 2. Parse
    const parser = new Parser([], lexer);
    const program = parser.parse();

    // 3. Execute
    const env = globalEnv ?? createGlobalEnv(doc, domTree, eventLoop, controller, platformFetch, resourceEnforcer, scriptEnforcer, pageOrigin, htmlParser, storageDir);
    const interpreter = new Interpreter(env, eventLoop);
    const value = interpreter.run(program);

    return { value, eventLoop };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { value: undefined, error: { message }, eventLoop };
  }
}

// Array.from only ever handled real array-shaped sources (.type === 'array')
// — every other spec-mandated source (a plain string, an array-like object
// like `{length:3, 0:'a', ...}` or `arguments`, a Map/Set, or any custom
// Symbol.iterator/`.next()`-based iterable) silently produced an empty
// array instead of throwing OR converting, which is easy to miss since
// `Array.from('abc')` looking like `[]` doesn't look like an obvious crash.
// Mirrors the interpreter's own `forOfValues` iterable-draining logic
// (arrays, Symbol.iterator protocol, Map/Set, generic `.next()`
// iterators) since that's a private Interpreter method and this native
// function has no Interpreter instance to call it on — plus one extra
// fallback `forOfValues` doesn't need: a non-iterable array-like object,
// which Array.from explicitly supports converting but a real for-of loop
// would reject.
/** Own-or-inherited property lookup by plain value (no getter support needed
 *  for the fixed set of built-in method names this is used for) — Map/Set's
 *  `entries`/`values` live on a shared prototype object, not each
 *  instance's own `.properties`, so a bare `obj.properties.get(key)` alone
 *  would miss them. */
function lookupMethod(obj: JSObject, key: string): JSValue {
  let cur: JSObject | null = obj;
  while (cur) {
    const desc = cur.properties.get(key);
    if (desc) return desc.value;
    cur = cur.prototype;
  }
  return undefined;
}

function iterableToArray(source: JSValue, env: Environment): JSValue[] {
  if (typeof source === 'string') return [...source];
  if (typeof source !== 'object' || source === null) return [];
  const obj = source as JSObject;
  if (obj.type === 'array') {
    const length = Number(obj.properties.get('length')?.value ?? 0);
    const out: JSValue[] = [];
    for (let i = 0; i < length; i++) out.push(obj.properties.get(String(i))?.value);
    return out;
  }
  const symbolGlobal = env.get('Symbol');
  const iterSym = typeof symbolGlobal === 'object' && symbolGlobal !== null ? (symbolGlobal as JSObject).properties.get('iterator')?.value : undefined;
  if (iterSym !== undefined) {
    const iterFn = lookupMethod(obj, toPropertyKey(iterSym));
    if (typeof iterFn === 'object' && iterFn !== null && (iterFn as JSFunction).type === 'closure') {
      const iterator = callJSFunction(iterFn as JSFunction, obj, []);
      if (typeof iterator === 'object' && iterator !== null && iterator !== obj) return iterableToArray(iterator, env);
    }
  }
  if (isJSObjectWithMeta(obj) && (obj.__mapObj || obj.__mapPrim)) {
    const entriesFn = lookupMethod(obj, 'entries');
    if (typeof entriesFn === 'object' && entriesFn !== null && (entriesFn as JSFunction).type === 'closure') {
      return iterableToArray(callJSFunction(entriesFn as JSFunction, obj, []), env);
    }
  }
  if (isJSObjectWithMeta(obj) && (obj.__setObj || obj.__setPrim)) {
    const valuesFn = lookupMethod(obj, 'values');
    if (typeof valuesFn === 'object' && valuesFn !== null && (valuesFn as JSFunction).type === 'closure') {
      return iterableToArray(callJSFunction(valuesFn as JSFunction, obj, []), env);
    }
  }
  const nextFn = lookupMethod(obj, 'next');
  if (typeof nextFn === 'object' && nextFn !== null && (nextFn as JSFunction).type === 'closure') {
    const out: JSValue[] = [];
    for (let guard = 0; guard < 1_000_000; guard++) {
      const step = callJSFunction(nextFn as JSFunction, obj, []);
      if (typeof step !== 'object' || step === null) break;
      const stepObj = step as JSObject;
      if (toBoolean(stepObj.properties.get('done')?.value)) break;
      out.push(stepObj.properties.get('value')?.value);
    }
    return out;
  }
  // Array-like fallback (has a .length but no iterator protocol) —
  // Array.from explicitly supports this source shape (e.g. `arguments`
  // objects, or a plain `{length:3, 0:'a', ...}`).
  const lengthDesc = obj.properties.get('length');
  if (lengthDesc) {
    const length = Number(lengthDesc.value ?? 0);
    const out: JSValue[] = [];
    for (let i = 0; i < length; i++) out.push(obj.properties.get(String(i))?.value);
    return out;
  }
  return [];
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
  scriptEnforcer?: CspScriptEnforcer,
  pageOrigin?: string,
  htmlParser?: IHtmlParser,
  storageDir?: string,
): Environment {
  const env = new Environment(null);

  // Console — see console-api.ts for the structured, externally-readable log
  env.setLocal('console', createConsoleObject());

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
  env.setLocal('encodeURIComponent', createNativeFunction('encodeURIComponent', (_this, args) => encodeURIComponent(toString(args[0]))));
  env.setLocal('decodeURIComponent', createNativeFunction('decodeURIComponent', (_this, args) => decodeURIComponent(toString(args[0]))));

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
  const jsonStrify = (val: JSValue, replacerFn?: JSFunction, holder?: JSValue, key = ''): string | undefined => {
    if (replacerFn) val = callJSFunction(replacerFn, holder, [key, val]);
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
          elems.push(jsonStrify(v, replacerFn, obj, String(i)) ?? 'null');
        }
        return `[${elems.join(',')}]`;
      }
      const pairs: string[] = [];
      for (const [k, desc] of obj.properties) {
        const v = jsonStrify(desc.value, replacerFn, obj, k);
        if (v === undefined) continue;
        pairs.push(`"${k}":${v}`);
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
      const replacer = args[1];
      const replacerFn = typeof replacer === 'object' && replacer !== null && (replacer as JSFunction).type === 'closure' ? replacer as JSFunction : undefined;
      const wrapper = createObject(null);
      wrapper.properties.set('', { value: val, writable: true, enumerable: true, configurable: true });
      const result = jsonStrify(val, replacerFn, wrapper, '');
      return result === undefined ? undefined : result;
    }),
    writable: true, enumerable: true, configurable: true,
  });
  env.setLocal('JSON', jsonObj);

  // Constructors
  env.setLocal('String', (() => {
    const stringCtor = createNativeFunction('String', (_this, args) => args.length > 0 ? toString(args[0]) : '');
    // String.fromCharCode/fromCodePoint/raw were entirely absent — a plain
    // native function had no properties map to hang static methods off of
    // until this session, so nothing had ever added them. `String.raw` in
    // particular threw "tag is not a function" for every tagged-template
    // use (`` String.raw`a\nb` ``), a real, if uncommon, real-world pattern.
    stringCtor.properties.set('fromCharCode', {
      value: createNativeFunction('fromCharCode', (_t, args) => String.fromCharCode(...args.map(toNumber))),
      writable: true, enumerable: false, configurable: true,
    });
    stringCtor.properties.set('fromCodePoint', {
      value: createNativeFunction('fromCodePoint', (_t, args) => String.fromCodePoint(...args.map(toNumber))),
      writable: true, enumerable: false, configurable: true,
    });
    stringCtor.properties.set('raw', {
      value: createNativeFunction('raw', (_t, args) => {
        const strings = args[0];
        if (typeof strings !== 'object' || strings === null) return '';
        const rawProp = (strings as JSObject).properties.get('raw')?.value;
        const raw = typeof rawProp === 'object' && rawProp !== null ? rawProp as JSObject : strings as JSObject;
        const len = Number(raw.properties.get('length')?.value ?? 0);
        let result = '';
        for (let i = 0; i < len; i++) {
          result += toString(raw.properties.get(String(i))?.value);
          if (i < len - 1) result += toString(args[i + 1]);
        }
        return result;
      }),
      writable: true, enumerable: false, configurable: true,
    });
    return stringCtor;
  })());
  env.setLocal('Number', (() => {
    const numCtorObj = createObject(null);
    numCtorObj.type = 'function';
    numCtorObj.callable = true;
    numCtorObj.nativeFn = (_this: unknown, args: unknown[]) => (args as JSValue[]).length > 0 ? toNumber((args as JSValue[])[0]) : 0;
    const numStaticFns: Record<string, NativeFunction> = {
      isInteger: (_t, a) => typeof a[0] === 'number' && Number.isInteger(a[0]),
      isFinite: (_t, a) => typeof a[0] === 'number' && Number.isFinite(a[0]),
      isNaN: (_t, a) => typeof a[0] === 'number' && Number.isNaN(a[0]),
      isSafeInteger: (_t, a) => typeof a[0] === 'number' && Number.isSafeInteger(a[0]),
      parseFloat: (_t, a) => parseFloat(toString(a[0])),
      parseInt: (_t, a) => parseInt(toString(a[0]), a[1] !== undefined ? toNumber(a[1]) : 10),
    };
    for (const [name, fn] of Object.entries(numStaticFns)) {
      numCtorObj.properties.set(name, { value: createNativeFunction(name, fn), writable: true, enumerable: false, configurable: true });
    }
    const numStaticConsts: Record<string, number> = {
      EPSILON: Number.EPSILON, MAX_SAFE_INTEGER: Number.MAX_SAFE_INTEGER, MIN_SAFE_INTEGER: Number.MIN_SAFE_INTEGER,
      MAX_VALUE: Number.MAX_VALUE, MIN_VALUE: Number.MIN_VALUE,
      POSITIVE_INFINITY: Infinity, NEGATIVE_INFINITY: -Infinity, NaN: NaN,
    };
    for (const [name, val] of Object.entries(numStaticConsts)) {
      numCtorObj.properties.set(name, { value: val, writable: false, enumerable: false, configurable: false });
    }
    return numCtorObj;
  })());
  env.setLocal('Boolean', createNativeFunction('Boolean', (_this, args) => args.length > 0 ? toBoolean(args[0]) : false));
  env.setLocal('Array', createNativeFunction('Array', (_this, args) => createArray(args)));

  // Object constructor + static methods
  const objectCtor = createNativeFunction('Object', (_this, args) => {
    if (args.length === 0) return createObject(null);
    if (typeof args[0] === 'object' && args[0] !== null) return args[0] as JSObject;
    if (args[0] === null || args[0] === undefined) return createObject(null);
    return createObject(null);
  });
  const objectCtorObj = createObject(null);
  objectCtorObj.type = 'function';
  objectCtorObj.callable = true;
  objectCtorObj.nativeFn = objectCtor.nativeFn;
  objectCtorObj.properties.set('keys', {
    value: createNativeFunction('keys', (_this, args) => {
      const obj = args[0];
      if (typeof obj !== 'object' || obj === null) return createArray([]);
      const jsObj = obj as JSObject;
      const keys: JSValue[] = [];
      for (const [k, desc] of jsObj.properties) {
        if (desc.enumerable) keys.push(k);
      }
      return createArray(keys);
    }),
    writable: true, enumerable: false, configurable: true,
  });
  objectCtorObj.properties.set('values', {
    value: createNativeFunction('values', (_this, args) => {
      const obj = args[0];
      if (typeof obj !== 'object' || obj === null) return createArray([]);
      const jsObj = obj as JSObject;
      const vals: JSValue[] = [];
      for (const [k, desc] of jsObj.properties) {
        if (desc.enumerable) vals.push(desc.value);
      }
      return createArray(vals);
    }),
    writable: true, enumerable: false, configurable: true,
  });
  objectCtorObj.properties.set('entries', {
    value: createNativeFunction('entries', (_this, args) => {
      const obj = args[0];
      if (typeof obj !== 'object' || obj === null) return createArray([]);
      const jsObj = obj as JSObject;
      const entries: JSValue[] = [];
      for (const [k, desc] of jsObj.properties) {
        if (desc.enumerable) entries.push(createArray([k, desc.value]));
      }
      return createArray(entries);
    }),
    writable: true, enumerable: false, configurable: true,
  });
  objectCtorObj.properties.set('fromEntries', {
    value: createNativeFunction('fromEntries', (_this, args) => {
      const result = createObject(null);
      const source = args[0];
      if (typeof source !== 'object' || source === null) return result;
      const srcObj = source as JSObject;
      const len = srcObj.type === 'array' ? Number(srcObj.properties.get('length')?.value ?? 0) : srcObj.properties.size;
      const pairs: JSValue[] = srcObj.type === 'array'
        ? Array.from({ length: len }, (_, i) => srcObj.properties.get(String(i))?.value)
        : [...srcObj.properties.values()].map(d => d.value);
      for (const pair of pairs) {
        if (typeof pair !== 'object' || pair === null) continue;
        const pairObj = pair as JSObject;
        const key = toString(pairObj.properties.get('0')?.value);
        const value = pairObj.properties.get('1')?.value;
        result.properties.set(key, { value, writable: true, enumerable: true, configurable: true });
      }
      return result;
    }),
    writable: true, enumerable: false, configurable: true,
  });
  objectCtorObj.properties.set('groupBy', {
    value: createNativeFunction('groupBy', (_this, args) => {
      const result = createObject(null);
      const source = args[0];
      const fn = args[1];
      if (typeof source !== 'object' || source === null || source.type !== 'array') return result;
      if (typeof fn !== 'object' || fn === null || (fn as JSFunction).type !== 'closure') return result;
      const len = Number(source.properties.get('length')?.value ?? 0);
      for (let i = 0; i < len; i++) {
        const item = source.properties.get(String(i))?.value;
        const key = toString(callJSFunction(fn as JSFunction, undefined, [item, i]));
        const existing = result.properties.get(key)?.value as JSObject | undefined;
        if (existing) {
          const n = Number(existing.properties.get('length')?.value ?? 0);
          existing.properties.set(String(n), { value: item, writable: true, enumerable: true, configurable: true });
          existing.properties.set('length', { value: n + 1, writable: true, enumerable: false, configurable: true });
        } else {
          result.properties.set(key, { value: createArray([item]), writable: true, enumerable: true, configurable: true });
        }
      }
      return result;
    }),
    writable: true, enumerable: false, configurable: true,
  });
  objectCtorObj.properties.set('assign', {
    value: createNativeFunction('assign', (_this, args) => {
      const target = args[0];
      if (typeof target !== 'object' || target === null) return target;
      const t = target as JSObject;
      for (let i = 1; i < args.length; i++) {
        const source = args[i];
        if (typeof source === 'object' && source !== null) {
          const s = source as JSObject;
          for (const [k, desc] of s.properties) {
            if (desc.enumerable) t.properties.set(k, { value: desc.value, writable: true, enumerable: true, configurable: true });
          }
        }
      }
      return t;
    }),
    writable: true, enumerable: false, configurable: true,
  });
  objectCtorObj.properties.set('freeze', {
    value: createNativeFunction('freeze', (_this, args) => {
      const obj = args[0];
      if (typeof obj !== 'object' || obj === null) return obj;
      const jsObj = obj as JSObject;
      for (const [, desc] of jsObj.properties) {
        desc.writable = false;
        desc.configurable = false;
      }
      return jsObj;
    }),
    writable: true, enumerable: false, configurable: true,
  });
  objectCtorObj.properties.set('seal', {
    value: createNativeFunction('seal', (_this, args) => {
      const obj = args[0];
      if (typeof obj !== 'object' || obj === null) return obj;
      const jsObj = obj as JSObject;
      for (const [, desc] of jsObj.properties) {
        desc.configurable = false;
      }
      return jsObj;
    }),
    writable: true, enumerable: false, configurable: true,
  });
  objectCtorObj.properties.set('create', {
    value: createNativeFunction('create', (_this, args) => {
      const proto = args[0];
      const obj = createObject(typeof proto === 'object' ? (proto as JSObject) : null);
      const propsArg = args[1];
      if (typeof propsArg === 'object' && propsArg !== null) {
        const propsObj = propsArg as JSObject;
        for (const [k, desc] of propsObj.properties) {
          const propDesc = desc.value as JSObject;
          if (typeof propDesc === 'object' && propDesc !== null) {
            const val = propDesc.properties.get('value');
            obj.properties.set(k, {
              value: val ? val.value : undefined,
              writable: !!(propDesc.properties.get('writable')?.value),
              enumerable: !!(propDesc.properties.get('enumerable')?.value),
              configurable: !!(propDesc.properties.get('configurable')?.value),
            });
          }
        }
      }
      return obj;
    }),
    writable: true, enumerable: false, configurable: true,
  });
  objectCtorObj.properties.set('defineProperty', {
    value: createNativeFunction('defineProperty', (_this, args) => {
      const obj = args[0];
      const prop = toString(args[1]);
      const desc = args[2];
      if (typeof obj !== 'object' || obj === null) return obj;
      const jsObj = obj as JSObject;
      if (typeof desc === 'object' && desc !== null) {
        const d = desc as JSObject;
        const val = d.properties.get('value');
        jsObj.properties.set(prop, {
          value: val ? val.value : undefined,
          writable: !!(d.properties.get('writable')?.value),
          enumerable: !!(d.properties.get('enumerable')?.value),
          configurable: !!(d.properties.get('configurable')?.value),
        });
      }
      return jsObj;
    }),
    writable: true, enumerable: false, configurable: true,
  });
  objectCtorObj.properties.set('getOwnPropertyDescriptor', {
    value: createNativeFunction('getOwnPropertyDescriptor', (_this, args) => {
      const obj = args[0];
      const prop = toString(args[1]);
      if (typeof obj !== 'object' || obj === null) return undefined;
      const jsObj = obj as JSObject;
      const desc = jsObj.properties.get(prop);
      if (!desc) return undefined;
      const result = createObject(null);
      result.properties.set('value', { value: desc.value, writable: true, enumerable: true, configurable: true });
      result.properties.set('writable', { value: desc.writable, writable: true, enumerable: true, configurable: true });
      result.properties.set('enumerable', { value: desc.enumerable, writable: true, enumerable: true, configurable: true });
      result.properties.set('configurable', { value: desc.configurable, writable: true, enumerable: true, configurable: true });
      return result;
    }),
    writable: true, enumerable: false, configurable: true,
  });
  objectCtorObj.properties.set('getPrototypeOf', {
    value: createNativeFunction('getPrototypeOf', (_this, args) => {
      const obj = args[0];
      return typeof obj === 'object' && obj !== null ? (obj as JSObject).prototype : null;
    }),
    writable: true, enumerable: false, configurable: true,
  });
  objectCtorObj.properties.set('setPrototypeOf', {
    value: createNativeFunction('setPrototypeOf', (_this, args) => {
      const obj = args[0];
      const proto = args[1];
      if (typeof obj === 'object' && obj !== null) {
        (obj as JSObject).prototype = typeof proto === 'object' && proto !== null ? (proto as JSObject) : null;
      }
      return obj;
    }),
    writable: true, enumerable: false, configurable: true,
  });
  env.setLocal('Object', objectCtorObj);

  // Error constructors — each subtype's own prototype chains to
  // Error.prototype (TypeError.prototype.__proto__ === Error.prototype,
  // matching real JS), and every prototype is registered so any
  // internally-built error (jsError(), a wrapped native exception —
  // see makeErrorObject in values.ts) links to the exact same chain a
  // script's own `new TypeError(...)` would produce. Without this,
  // `e instanceof TypeError`/`instanceof Error` — a very ordinary
  // error-handling check — was always false: the previous createNativeFunction-
  // based constructors had no discoverable .prototype at all (same "no
  // .properties map" shape as the old Number/Array before this session's
  // earlier fixes), and every constructed error had prototype: null.
  const errorProto = createObject(null);
  errorProto.properties.set('name', { value: 'Error', writable: true, enumerable: false, configurable: true });
  errorProto.properties.set('message', { value: '', writable: true, enumerable: false, configurable: true });
  errorProto.properties.set('toString', {
    value: createNativeFunction('toString', (thisArg) => {
      const obj = thisArg as JSObject | undefined;
      const name = toString(obj?.properties?.get('name')?.value ?? 'Error');
      const msg = toString(obj?.properties?.get('message')?.value ?? '');
      return msg ? `${name}: ${msg}` : name;
    }),
    writable: true, enumerable: false, configurable: true,
  });
  function makeErrorCtor(name: string, proto: JSObject): JSObject {
    const ctorObj = createObject(null);
    ctorObj.type = 'function';
    ctorObj.callable = true;
    ctorObj.nativeFn = (_this: unknown, args: unknown[]) => {
      const msg = (args as JSValue[]).length > 0 ? toString((args as JSValue[])[0]) : '';
      return makeErrorObject(name, msg);
    };
    ctorObj.properties.set('prototype', { value: proto, writable: false, enumerable: false, configurable: false });
    proto.properties.set('constructor', { value: ctorObj, writable: true, enumerable: false, configurable: true });
    return ctorObj;
  }
  registerErrorPrototype('Error', errorProto);
  env.setLocal('Error', makeErrorCtor('Error', errorProto));
  for (const name of ['TypeError', 'ReferenceError', 'RangeError', 'SyntaxError', 'EvalError', 'URIError']) {
    const proto = createObject(errorProto);
    proto.properties.set('name', { value: name, writable: true, enumerable: false, configurable: true });
    registerErrorPrototype(name, proto);
    env.setLocal(name, makeErrorCtor(name, proto));
  }

  // Promise
  env.setLocal('Promise', createPromiseConstructor(eventLoop));

  // queueMicrotask
  bindQueueMicrotask(env, eventLoop);

  // eval()
  env.setLocal('eval', createNativeFunction('eval', (_this, args) => {
    const code = toString(args[0]);

    // CSP enforcement: check eval() against script-src policy
    if (scriptEnforcer && pageOrigin) {
      const check = scriptEnforcer.checkEval(pageOrigin, pageOrigin, code);
      if (!check.allowed) {
        throw new Error(`EvalError: ${check.reason}`);
      }
    }

    const evalLexer = new Lexer(code);
    const evalParser = new Parser([], evalLexer);
    const program = evalParser.parse();
    const interp = new Interpreter(env, eventLoop);
    return interp.run(program);
  }));

  // Symbol (basic — well-known symbols)
  const symbolId = { value: 0 };
  const symbolRegistry = new Map<number, { description: string }>();
  const symbolObjectCache = new Map<string, JSObject>();
  const symbolProto = createObject(null);
  symbolProto.properties.set('toString', {
    value: createNativeFunction('toString', (_this) => {
      return 'Symbol()';
    }),
    writable: true, enumerable: false, configurable: true,
  });
  symbolProto.properties.set('valueOf', {
    value: createNativeFunction('valueOf', (_this) => _this),
    writable: true, enumerable: false, configurable: true,
  });
  const symbolCtor = createNativeFunction('Symbol', (_this, args) => {
    const desc = args.length > 0 ? toString(args[0]) : '';
    const id = symbolId.value++;
    symbolRegistry.set(id, { description: desc });
    const sym = createObject(symbolProto) as JSObjectWithMeta;
    sym.__type_override = 'symbol';
    sym.symbolId = id;
    sym.symbolDescription = desc;
    return sym;
  });
  const symbolCtorObj = createObject(null);
  symbolCtorObj.type = 'function';
  symbolCtorObj.callable = true;
  symbolCtorObj.nativeFn = symbolCtor.nativeFn;
  symbolCtorObj.properties.set('for', {
    value: createNativeFunction('for', (_this, args) => {
      const key = toString(args[0]);
      const cached = symbolObjectCache.get(key);
      if (cached) return cached;
      const id = symbolId.value++;
      symbolRegistry.set(id, { description: key });
      const sym = createObject(symbolProto) as JSObjectWithMeta;
      sym.__type_override = 'symbol';
      sym.symbolId = id;
      sym.symbolDescription = key;
      symbolObjectCache.set(key, sym);
      return sym;
    }),
    writable: true, enumerable: false, configurable: true,
  });
  symbolCtorObj.properties.set('keyFor', {
    value: createNativeFunction('keyFor', (_this, args) => {
      const sym = args[0];
      if (typeof sym === 'object' && sym !== null && isJSObjectWithMeta(sym) && sym.__type_override === 'symbol' && sym.symbolId !== undefined) {
        const id = sym.symbolId;
        const entry = symbolRegistry.get(id);
        if (entry) return entry.description;
      }
      return undefined;
    }),
    writable: true, enumerable: false, configurable: true,
  });
  env.setLocal('Symbol', symbolCtorObj);

  // Symbol well-known symbols
  const wellKnownSymbols = ['iterator', 'toPrimitive', 'toStringTag', 'hasInstance', 'isConcatSpreadable', 'species', 'asyncIterator'];
  for (const name of wellKnownSymbols) {
    const id = symbolId.value++;
    symbolRegistry.set(id, { description: name });
    const sym = createObject(symbolProto) as JSObjectWithMeta;
    sym.__type_override = 'symbol';
    sym.symbolId = id;
    sym.symbolDescription = name;
    symbolCtorObj.properties.set(name, { value: sym, writable: false, enumerable: false, configurable: false });
  }

  // Date constructor
  const dateProto = createObject(null);
  const dateCtor = createNativeFunction('Date', (_this, args) => {
    const dateObj = createObject(dateProto) as JSObjectWithMeta;
    dateObj.__type_override = 'date';
    let nativeDate: Date;
    if (args.length === 0) {
      nativeDate = new Date();
    } else if (args.length === 1) {
      const arg = args[0];
      if (typeof arg === 'string') {
        nativeDate = new Date(arg);
      } else if (typeof arg === 'number') {
        nativeDate = new Date(arg);
      } else {
        nativeDate = new Date();
      }
    } else {
      nativeDate = new Date(
        toNumber(args[0]),
        toNumber(args[1]),
        args.length > 2 ? toNumber(args[2]) : 1,
        args.length > 3 ? toNumber(args[3]) : 0,
        args.length > 4 ? toNumber(args[4]) : 0,
        args.length > 5 ? toNumber(args[5]) : 0,
        args.length > 6 ? toNumber(args[6]) : 0,
      );
    }
    dateObj.nativeDate = nativeDate;
    return dateObj;
  });
  const dateCtorObj = createObject(null);
  dateCtorObj.type = 'function';
  dateCtorObj.callable = true;
  dateCtorObj.nativeFn = dateCtor.nativeFn;
  const dateMethods = ['toString', 'toISOString', 'toDateString', 'toTimeString', 'toLocaleString', 'toLocaleDateString', 'toLocaleTimeString', 'valueOf', 'getTime', 'getFullYear', 'getMonth', 'getDate', 'getDay', 'getHours', 'getMinutes', 'getSeconds', 'getMilliseconds', 'getUTCFullYear', 'getUTCMonth', 'getUTCDate', 'getUTCDay', 'getUTCHours', 'getUTCMinutes', 'getUTCSeconds', 'getUTCMilliseconds', 'getTimezoneOffset', 'setTime', 'setFullYear', 'setMonth', 'setDate', 'setHours', 'setMinutes', 'setSeconds', 'setMilliseconds', 'setUTCFullYear', 'setUTCMonth', 'setUTCDate', 'setUTCHours', 'setUTCMinutes', 'setUTCSeconds', 'setUTCMilliseconds', 'toJSON'];
  for (const method of dateMethods) {
    dateProto.properties.set(method, {
      value: createNativeFunction(method, (_this, args) => {
        if (typeof _this !== 'object' || _this === null || !isJSObjectWithMeta(_this) || !_this.nativeDate) return NaN;
        const d = _this.nativeDate;
        switch (method) {
          case 'toString': return d.toString();
          case 'toISOString': return d.toISOString();
          case 'toDateString': return d.toDateString();
          case 'toTimeString': return d.toTimeString();
          case 'toLocaleString': return d.toLocaleString();
          case 'toLocaleDateString': return d.toLocaleDateString();
          case 'toLocaleTimeString': return d.toLocaleTimeString();
          case 'valueOf': return d.getTime();
          case 'getTime': return d.getTime();
          case 'getFullYear': return d.getFullYear();
          case 'getMonth': return d.getMonth();
          case 'getDate': return d.getDate();
          case 'getDay': return d.getDay();
          case 'getHours': return d.getHours();
          case 'getMinutes': return d.getMinutes();
          case 'getSeconds': return d.getSeconds();
          case 'getMilliseconds': return d.getMilliseconds();
          case 'getUTCFullYear': return d.getUTCFullYear();
          case 'getUTCMonth': return d.getUTCMonth();
          case 'getUTCDate': return d.getUTCDate();
          case 'getUTCDay': return d.getUTCDay();
          case 'getUTCHours': return d.getUTCHours();
          case 'getUTCMinutes': return d.getUTCMinutes();
          case 'getUTCSeconds': return d.getUTCSeconds();
          case 'getUTCMilliseconds': return d.getUTCMilliseconds();
          case 'getTimezoneOffset': return d.getTimezoneOffset();
          case 'setTime': d.setTime(toNumber(args[0])); return d.getTime();
          case 'setFullYear': d.setFullYear(toNumber(args[0])); return d.getTime();
          case 'setMonth': d.setMonth(toNumber(args[0])); return d.getTime();
          case 'setDate': d.setDate(toNumber(args[0])); return d.getTime();
          case 'setHours': d.setHours(toNumber(args[0])); return d.getTime();
          case 'setMinutes': d.setMinutes(toNumber(args[0])); return d.getTime();
          case 'setSeconds': d.setSeconds(toNumber(args[0])); return d.getTime();
          case 'setMilliseconds': d.setMilliseconds(toNumber(args[0])); return d.getTime();
          case 'setUTCFullYear': d.setUTCFullYear(toNumber(args[0])); return d.getTime();
          case 'setUTCMonth': d.setUTCMonth(toNumber(args[0])); return d.getTime();
          case 'setUTCDate': d.setUTCDate(toNumber(args[0])); return d.getTime();
          case 'setUTCHours': d.setUTCHours(toNumber(args[0])); return d.getTime();
          case 'setUTCMinutes': d.setUTCMinutes(toNumber(args[0])); return d.getTime();
          case 'setUTCSeconds': d.setUTCSeconds(toNumber(args[0])); return d.getTime();
          case 'setUTCMilliseconds': d.setUTCMilliseconds(toNumber(args[0])); return d.getTime();
          case 'toJSON': return d.toISOString();
          default: return undefined;
        }
      }),
      writable: true, enumerable: false, configurable: true,
    });
  }
  dateCtorObj.properties.set('prototype', { value: dateProto, writable: false, enumerable: false, configurable: false });
  dateCtorObj.properties.set('now', {
    value: createNativeFunction('now', () => Date.now()),
    writable: true, enumerable: false, configurable: true,
  });
  dateCtorObj.properties.set('parse', {
    value: createNativeFunction('parse', (_this, args) => new Date(toString(args[0])).getTime()),
    writable: true, enumerable: false, configurable: true,
  });
  dateCtorObj.properties.set('UTC', {
    value: createNativeFunction('UTC', (_this, args) => Date.UTC(toNumber(args[0]), toNumber(args[1]), toNumber(args[2] ?? 1), toNumber(args[3] ?? 0), toNumber(args[4] ?? 0), toNumber(args[5] ?? 0), toNumber(args[6] ?? 0))),
    writable: true, enumerable: false, configurable: true,
  });
  env.setLocal('Date', dateCtorObj);

  // RegExp constructor
  const regExpProto = createObject(null);
  const regExpCtor = createNativeFunction('RegExp', (_this, args) => {
    const pattern = toString(args[0]);
    const flags = args.length > 1 ? toString(args[1]) : '';
    const re = new RegExp(pattern, flags);
    const reObj = createObject(regExpProto) as JSObjectWithMeta;
    reObj.__type_override = 'regexp';
    reObj.nativeRegExp = re;
    return reObj;
  });
  const regExpCtorObj = createObject(null);
  regExpCtorObj.type = 'function';
  regExpCtorObj.callable = true;
  regExpCtorObj.nativeFn = regExpCtor.nativeFn;
  for (const method of ['exec', 'test', 'toString']) {
    regExpProto.properties.set(method, {
      value: createNativeFunction(method, (_this, args) => {
        if (typeof _this !== 'object' || _this === null || !isJSObjectWithMeta(_this) || !_this.nativeRegExp) return null;
        const re = _this.nativeRegExp;
        const str = toString(args[0] ?? '');
        if (method === 'exec') {
          const m = re.exec(str);
          if (!m) return null;
          const result = createArray(m.map(v => v !== undefined ? v : null));
          result.properties.set('index', { value: m.index, writable: true, enumerable: true, configurable: true });
          result.properties.set('input', { value: str, writable: true, enumerable: true, configurable: true });
          result.properties.set('groups', { value: m.groups ? (() => { const g = createObject(null); for (const [k, v] of Object.entries(m.groups)) g.properties.set(k, { value: v, writable: true, enumerable: true, configurable: true }); return g; })() : undefined, writable: true, enumerable: true, configurable: true });
          return result;
        }
        if (method === 'test') return re.test(str);
        return re.toString();
      }),
      writable: true, enumerable: false, configurable: true,
    });
  }
  regExpProto.properties.set('source', { value: '', writable: false, enumerable: false, configurable: false });
  regExpProto.properties.set('flags', { value: '', writable: false, enumerable: false, configurable: false });
  regExpCtorObj.properties.set('prototype', { value: regExpProto, writable: false, enumerable: false, configurable: false });
  env.setLocal('RegExp', regExpCtorObj);

  // URLSearchParams — wraps a real native URLSearchParams (available as a
  // global in both Node and the renderer's V8 runtime), the same "wrap a
  // real native object" pattern already used for RegExp/Date.
  const uspProto = createObject(null);
  function wrapURLSearchParams(native: URLSearchParams): JSObject {
    const obj = createObject(uspProto) as JSObjectWithMeta;
    obj.__type_override = 'urlsearchparams';
    obj.nativeURLSearchParams = native;
    return obj;
  }
  function toURLSearchParamsInit(arg: JSValue): ConstructorParameters<typeof URLSearchParams>[0] {
    if (arg === undefined) return undefined;
    if (typeof arg === 'string') return arg;
    if (typeof arg === 'object' && arg !== null) {
      const o = arg as JSObject;
      if (isJSObjectWithMeta(o) && o.nativeURLSearchParams) return o.nativeURLSearchParams;
      if (o.type === 'array') {
        const len = Number(o.properties.get('length')?.value ?? 0);
        const pairs: [string, string][] = [];
        for (let i = 0; i < len; i++) {
          const p = o.properties.get(String(i))?.value as JSObject | undefined;
          if (p) pairs.push([toString(p.properties.get('0')?.value), toString(p.properties.get('1')?.value)]);
        }
        return pairs;
      }
      const result: Record<string, string> = {};
      for (const [k, desc] of o.properties) {
        if (desc.enumerable) result[k] = toString(desc.value);
      }
      return result;
    }
    return toString(arg);
  }
  const uspCtor = createNativeFunction('URLSearchParams', (_this, args) => wrapURLSearchParams(new URLSearchParams(toURLSearchParamsInit(args[0]))));
  const uspCtorObj = createObject(null);
  uspCtorObj.type = 'function';
  uspCtorObj.callable = true;
  uspCtorObj.nativeFn = uspCtor.nativeFn;
  const uspNativeOf = (v: JSValue): URLSearchParams | undefined =>
    typeof v === 'object' && v !== null && isJSObjectWithMeta(v) ? v.nativeURLSearchParams : undefined;
  for (const method of ['get', 'getAll', 'has', 'toString']) {
    uspProto.properties.set(method, {
      value: createNativeFunction(method, (thisArg, a) => {
        const native = uspNativeOf(thisArg);
        if (!native) return method === 'getAll' ? createArray([]) : method === 'has' ? false : method === 'toString' ? '' : null;
        if (method === 'get') return native.get(toString(a[0])) ?? null;
        if (method === 'getAll') return createArray(native.getAll(toString(a[0])));
        if (method === 'has') return native.has(toString(a[0]));
        return native.toString();
      }),
      writable: true, enumerable: false, configurable: true,
    });
  }
  for (const method of ['set', 'append', 'delete', 'sort']) {
    uspProto.properties.set(method, {
      value: createNativeFunction(method, (thisArg, a) => {
        const native = uspNativeOf(thisArg);
        if (!native) return undefined;
        if (method === 'set') native.set(toString(a[0]), toString(a[1]));
        else if (method === 'append') native.append(toString(a[0]), toString(a[1]));
        else if (method === 'delete') native.delete(toString(a[0]));
        else native.sort();
        return undefined;
      }),
      writable: true, enumerable: false, configurable: true,
    });
  }
  uspProto.properties.set('forEach', {
    value: createNativeFunction('forEach', (thisArg, a) => {
      const native = uspNativeOf(thisArg);
      const fn = a[0] as JSFunction;
      if (!native || typeof fn !== 'object' || fn === null || fn.type !== 'closure') return undefined;
      for (const [k, v] of native.entries()) callJSFunction(fn, undefined, [v, k, thisArg]);
      return undefined;
    }),
    writable: true, enumerable: false, configurable: true,
  });
  uspCtorObj.properties.set('prototype', { value: uspProto, writable: false, enumerable: false, configurable: false });
  env.setLocal('URLSearchParams', uspCtorObj);

  // URL — wraps a real native URL the same way.
  const urlProto = createObject(null);
  const urlNativeOf = (v: JSValue): URL | undefined =>
    typeof v === 'object' && v !== null && isJSObjectWithMeta(v) ? v.nativeURL : undefined;
  const urlCtor = createNativeFunction('URL', (_this, args) => {
    const native = new URL(toString(args[0]), args[1] !== undefined ? toString(args[1]) : undefined);
    const obj = createObject(urlProto) as JSObjectWithMeta;
    obj.__type_override = 'url';
    obj.nativeURL = native;
    return obj;
  });
  const urlCtorObj = createObject(null);
  urlCtorObj.type = 'function';
  urlCtorObj.callable = true;
  urlCtorObj.nativeFn = urlCtor.nativeFn;
  const urlStringProps = ['href', 'protocol', 'username', 'password', 'host', 'hostname', 'port', 'pathname', 'search', 'hash'] as const;
  for (const prop of urlStringProps) {
    urlProto.properties.set(prop, {
      value: undefined, writable: false, enumerable: true, configurable: true,
      getter: createNativeFunction(prop, (thisArg) => urlNativeOf(thisArg)?.[prop] ?? ''),
      setter: createNativeFunction(prop, (thisArg, a) => { const n = urlNativeOf(thisArg); if (n) n[prop] = toString(a[0]); }),
    });
  }
  urlProto.properties.set('origin', {
    value: undefined, writable: false, enumerable: true, configurable: true,
    getter: createNativeFunction('origin', (thisArg) => urlNativeOf(thisArg)?.origin ?? ''),
  });
  urlProto.properties.set('searchParams', {
    value: undefined, writable: false, enumerable: true, configurable: true,
    getter: createNativeFunction('searchParams', (thisArg) => {
      const n = urlNativeOf(thisArg);
      return n ? wrapURLSearchParams(n.searchParams) : wrapURLSearchParams(new URLSearchParams());
    }),
  });
  urlProto.properties.set('toString', {
    value: createNativeFunction('toString', (thisArg) => urlNativeOf(thisArg)?.href ?? ''),
    writable: true, enumerable: false, configurable: true,
  });
  urlCtorObj.properties.set('prototype', { value: urlProto, writable: false, enumerable: false, configurable: false });
  env.setLocal('URL', urlCtorObj);

  // FormData — string values only (no File support). Constructed from an
  // optional <form> element by walking its real DOM subtree for named
  // input/textarea/select controls, reading each control's *current*
  // value/checked off its JS wrapper (where .value/.checked assignments
  // actually live — they don't reflect back to DOM attributes, matching
  // real browsers where the value/checked *property* is independent of
  // the value/checked *attribute* once the user or script touches it).
  const formDataProto = createObject(null);
  function getElementProp(el: DomElement, prop: string): JSValue {
    const wrapped = wrapElement(el, domTree);
    const desc = wrapped.properties.get(prop);
    if (!desc) return undefined;
    if (desc.getter) return callJSFunction(desc.getter, wrapped, []);
    return desc.value;
  }
  function collectFormEntries(form: DomElement): [string, string][] {
    const entries: [string, string][] = [];
    const walk = (node: DomElement): void => {
      for (const child of node.children) {
        if (child.nodeType !== 'element') continue;
        const childEl = child as DomElement;
        const name = childEl.attributes.get('name');
        if (name && ['input', 'textarea', 'select'].includes(childEl.tagName) && !childEl.attributes.has('disabled')) {
          const type = (getElementProp(childEl, 'type') as string | undefined) ?? childEl.attributes.get('type') ?? 'text';
          if (childEl.tagName === 'input' && (type === 'checkbox' || type === 'radio')) {
            if (getElementProp(childEl, 'checked')) {
              entries.push([name, toString(getElementProp(childEl, 'value') ?? childEl.attributes.get('value') ?? 'on')]);
            }
          } else {
            entries.push([name, toString(getElementProp(childEl, 'value') ?? childEl.attributes.get('value') ?? '')]);
          }
        }
        walk(childEl);
      }
    };
    walk(form);
    return entries;
  }
  function wrapFormData(entries: [string, string][]): JSObject {
    const obj = createObject(formDataProto) as JSObjectWithMeta;
    obj.__type_override = 'formdata';
    obj.__formEntries = entries;
    return obj;
  }
  const fdEntriesOf = (v: JSValue): [string, string][] | undefined =>
    typeof v === 'object' && v !== null && isJSObjectWithMeta(v) ? v.__formEntries : undefined;
  const fdCtorObj = createObject(null);
  fdCtorObj.type = 'function';
  fdCtorObj.callable = true;
  fdCtorObj.nativeFn = (_this: unknown, args: unknown[]) => {
    const formArg = (args as JSValue[])[0];
    const formEl = typeof formArg === 'object' && formArg !== null && '__domNode' in formArg
      ? (formArg as JSObject & { __domNode: DomElement }).__domNode
      : undefined;
    return wrapFormData(formEl ? collectFormEntries(formEl) : []);
  };
  fdCtorObj.properties.set('prototype', { value: formDataProto, writable: false, enumerable: false, configurable: false });
  env.setLocal('FormData', fdCtorObj);
  formDataProto.properties.set('append', {
    value: createNativeFunction('append', (thisArg, a) => { fdEntriesOf(thisArg)?.push([toString(a[0]), toString(a[1])]); return undefined; }),
    writable: true, enumerable: false, configurable: true,
  });
  formDataProto.properties.set('set', {
    value: createNativeFunction('set', (thisArg, a) => {
      const entries = fdEntriesOf(thisArg);
      if (!entries) return undefined;
      const key = toString(a[0]);
      const filtered = entries.filter(([k]) => k !== key);
      filtered.push([key, toString(a[1])]);
      entries.length = 0;
      entries.push(...filtered);
      return undefined;
    }),
    writable: true, enumerable: false, configurable: true,
  });
  formDataProto.properties.set('get', {
    value: createNativeFunction('get', (thisArg, a) => fdEntriesOf(thisArg)?.find(([k]) => k === toString(a[0]))?.[1] ?? null),
    writable: true, enumerable: false, configurable: true,
  });
  formDataProto.properties.set('getAll', {
    value: createNativeFunction('getAll', (thisArg, a) => createArray((fdEntriesOf(thisArg) ?? []).filter(([k]) => k === toString(a[0])).map(([, v]) => v))),
    writable: true, enumerable: false, configurable: true,
  });
  formDataProto.properties.set('has', {
    value: createNativeFunction('has', (thisArg, a) => (fdEntriesOf(thisArg) ?? []).some(([k]) => k === toString(a[0]))),
    writable: true, enumerable: false, configurable: true,
  });
  formDataProto.properties.set('delete', {
    value: createNativeFunction('delete', (thisArg, a) => {
      const entries = fdEntriesOf(thisArg);
      if (!entries) return undefined;
      const key = toString(a[0]);
      const kept = entries.filter(([k]) => k !== key);
      entries.length = 0;
      entries.push(...kept);
      return undefined;
    }),
    writable: true, enumerable: false, configurable: true,
  });
  formDataProto.properties.set('forEach', {
    value: createNativeFunction('forEach', (thisArg, a) => {
      const fn = a[0] as JSFunction;
      if (typeof fn !== 'object' || fn === null || fn.type !== 'closure') return undefined;
      for (const [k, v] of fdEntriesOf(thisArg) ?? []) callJSFunction(fn, undefined, [v, k, thisArg]);
      return undefined;
    }),
    writable: true, enumerable: false, configurable: true,
  });

  // TextEncoder/TextDecoder — wrap real native ones (available in both Node
  // and the renderer's V8 runtime), bridging through the sandboxed
  // Uint8Array constructor so encode() returns a real, usable typed array
  // rather than a plain array of byte values.
  const teCtorObj = createObject(null);
  teCtorObj.type = 'function';
  teCtorObj.callable = true;
  teCtorObj.nativeFn = () => {
    const obj = createObject(null);
    obj.properties.set('encoding', { value: 'utf-8', writable: false, enumerable: true, configurable: false });
    obj.properties.set('encode', {
      value: createNativeFunction('encode', (_t, a) => {
        const bytes = Array.from(new TextEncoder().encode(a[0] !== undefined ? toString(a[0]) : ''));
        // Looked up lazily (not at setup time): Uint8Array is registered
        // later in createGlobalEnv, so env.get() here — at call time,
        // well after setup finishes — is what makes it resolvable at all.
        const uint8ArrayCtor = env.get('Uint8Array') as JSObject | undefined;
        return uint8ArrayCtor?.nativeFn ? uint8ArrayCtor.nativeFn(undefined, [createArray(bytes as unknown as JSValue[])]) : createArray(bytes as unknown as JSValue[]);
      }),
      writable: true, enumerable: true, configurable: true,
    });
    return obj;
  };
  env.setLocal('TextEncoder', teCtorObj);

  const tdCtorObj = createObject(null);
  tdCtorObj.type = 'function';
  tdCtorObj.callable = true;
  tdCtorObj.nativeFn = (_this: unknown, args: unknown[]) => {
    const encoding = (args as JSValue[])[0] !== undefined ? toString((args as JSValue[])[0]) : 'utf-8';
    const obj = createObject(null);
    obj.properties.set('encoding', { value: encoding, writable: false, enumerable: true, configurable: false });
    obj.properties.set('decode', {
      value: createNativeFunction('decode', (_t, a) => {
        const input = a[0];
        const view = typeof input === 'object' && input !== null && isJSObjectWithMeta(input) ? (input as { __nativeView?: unknown }).__nativeView : undefined;
        if (view instanceof Uint8Array) return new TextDecoder(encoding).decode(view);
        if (ArrayBuffer.isView(view as ArrayBufferView)) return new TextDecoder(encoding).decode(new Uint8Array((view as ArrayBufferView).buffer));
        return '';
      }),
      writable: true, enumerable: true, configurable: true,
    });
    return obj;
  };
  env.setLocal('TextDecoder', tdCtorObj);

  // Map constructor
  const mapProto = createObject(null);

  // Helper: resolve key for Map — objects use identity, primitives use string
  function mapResolveKey(args: JSValue[]): { isObj: boolean; objKey?: JSObject; primKey?: string } {
    const k = args[0];
    if (typeof k === 'object' && k !== null) return { isObj: true, objKey: k as JSObject };
    return { isObj: false, primKey: toString(k) };
  }
  function mapGetStore(m: JSObject) {
    const mm = m as JSObjectWithMeta;
    if (!mm.__mapObj) mm.__mapObj = new Map<JSObject, JSValue>();
    if (!mm.__mapPrim) mm.__mapPrim = new Map<string, JSValue>();
    return { obj: mm.__mapObj!, prim: mm.__mapPrim! };
  }

  mapProto.properties.set('get', {
    value: createNativeFunction('get', (_this, args) => {
      if (typeof _this !== 'object' || _this === null || !isJSObjectWithMeta(_this) || (!_this.__mapObj && !_this.__mapPrim)) return undefined;
      const s = mapGetStore(_this as JSObject);
      const k = mapResolveKey(args);
      return k.isObj ? s.obj.get(k.objKey!) : s.prim.get(k.primKey!);
    }),
    writable: true, enumerable: false, configurable: true,
  });
  mapProto.properties.set('set', {
    value: createNativeFunction('set', (_this, args) => {
      if (typeof _this !== 'object' || _this === null) return _this;
      const s = mapGetStore(_this as JSObject);
      const k = mapResolveKey(args);
      if (k.isObj) s.obj.set(k.objKey!, args[1]); else s.prim.set(k.primKey!, args[1]);
      return _this;
    }),
    writable: true, enumerable: false, configurable: true,
  });
  mapProto.properties.set('has', {
    value: createNativeFunction('has', (_this, args) => {
      if (typeof _this !== 'object' || _this === null || !isJSObjectWithMeta(_this) || (!_this.__mapObj && !_this.__mapPrim)) return false;
      const s = mapGetStore(_this as JSObject);
      const k = mapResolveKey(args);
      return k.isObj ? s.obj.has(k.objKey!) : s.prim.has(k.primKey!);
    }),
    writable: true, enumerable: false, configurable: true,
  });
  mapProto.properties.set('delete', {
    value: createNativeFunction('delete', (_this, args) => {
      if (typeof _this !== 'object' || _this === null || !isJSObjectWithMeta(_this) || (!_this.__mapObj && !_this.__mapPrim)) return false;
      const s = mapGetStore(_this as JSObject);
      const k = mapResolveKey(args);
      return k.isObj ? s.obj.delete(k.objKey!) : s.prim.delete(k.primKey!);
    }),
    writable: true, enumerable: false, configurable: true,
  });
  mapProto.properties.set('clear', {
    value: createNativeFunction('clear', (_this) => {
      if (typeof _this === 'object' && _this !== null) {
        const s = mapGetStore(_this as JSObject);
        s.obj.clear(); s.prim.clear();
      }
      return undefined;
    }),
    writable: true, enumerable: false, configurable: true,
  });
  mapProto.properties.set('size', {
    value: undefined as unknown as JSValue,
    getter: createNativeFunction('get size', (_this) => {
      if (typeof _this !== 'object' || _this === null) return 0;
      const s = mapGetStore(_this as JSObject);
      return s.obj.size + s.prim.size;
    }),
    writable: false, enumerable: false, configurable: true,
  });
  mapProto.properties.set('keys', {
    value: createNativeFunction('keys', (_this) => {
      if (typeof _this !== 'object' || _this === null) return createArray([]);
      const s = mapGetStore(_this as JSObject);
      const keys: JSValue[] = [];
      for (const k of s.obj.keys()) keys.push(k);
      for (const k of s.prim.keys()) keys.push(k);
      return createArray(keys);
    }),
    writable: true, enumerable: false, configurable: true,
  });
  mapProto.properties.set('values', {
    value: createNativeFunction('values', (_this) => {
      if (typeof _this !== 'object' || _this === null) return createArray([]);
      const s = mapGetStore(_this as JSObject);
      const vals: JSValue[] = [];
      for (const v of s.obj.values()) vals.push(v);
      for (const v of s.prim.values()) vals.push(v);
      return createArray(vals);
    }),
    writable: true, enumerable: false, configurable: true,
  });
  mapProto.properties.set('entries', {
    value: createNativeFunction('entries', (_this) => {
      if (typeof _this !== 'object' || _this === null) return createArray([]);
      const s = mapGetStore(_this as JSObject);
      const entries: JSValue[] = [];
      for (const [k, v] of s.obj) entries.push(createArray([k, v]));
      for (const [k, v] of s.prim) entries.push(createArray([k, v]));
      return createArray(entries);
    }),
    writable: true, enumerable: false, configurable: true,
  });
  mapProto.properties.set('forEach', {
    value: createNativeFunction('forEach', (_this, args) => {
      const fn = args[0];
      if (typeof _this !== 'object' || _this === null) return undefined;
      if (typeof fn !== 'object' || fn === null || (fn as JSFunction).type !== 'closure') return undefined;
      const s = mapGetStore(_this as JSObject);
      for (const [k, v] of s.obj) callJSFunction(fn as JSFunction, _this, [v, k, _this]);
      for (const [k, v] of s.prim) callJSFunction(fn as JSFunction, _this, [v, k, _this]);
      return undefined;
    }),
    writable: true, enumerable: false, configurable: true,
  });
  mapProto.properties.set('toString', {
    value: createNativeFunction('toString', (_this) => '[object Map]'),
    writable: true, enumerable: false, configurable: true,
  });
  const mapCtor = createNativeFunction('Map', (_this, args) => {
    const mapObj = createObject(mapProto) as JSObjectWithMeta;
    mapObj.__type_override = 'map';
    mapObj.__mapObj = new Map<JSObject, JSValue>();
    mapObj.__mapPrim = new Map<string, JSValue>();
    const iterable = args[0];
    if (typeof iterable === 'object' && iterable !== null && isJSObjectWithMeta(iterable) && iterable.type === 'array') {
      const len = Number(iterable.properties.get('length')?.value ?? 0);
      for (let i = 0; i < len; i++) {
        const entry = iterable.properties.get(String(i))?.value;
        if (typeof entry === 'object' && entry !== null && isJSObjectWithMeta(entry) && entry.type === 'array') {
          const key = entry.properties.get('0')?.value;
          const val = entry.properties.get('1')?.value;
          const k = mapResolveKey([key]);
          const s = mapGetStore(mapObj);
          if (k.isObj) s.obj.set(k.objKey!, val); else s.prim.set(k.primKey!, val);
        }
      }
    }
    return mapObj;
  });
  const mapCtorObj = createObject(null);
  mapCtorObj.type = 'function';
  mapCtorObj.callable = true;
  mapCtorObj.nativeFn = mapCtor.nativeFn;
  mapCtorObj.properties.set('prototype', { value: mapProto, writable: false, enumerable: false, configurable: false });
  env.setLocal('Map', mapCtorObj);

  // Set constructor
  const setProto = createObject(null);
  function setGetStore(s: JSObject) {
    const ss = s as JSObjectWithMeta;
    if (!ss.__setObj) ss.__setObj = new Set<JSObject>();
    if (!ss.__setPrim) ss.__setPrim = new Set<string>();
    return { obj: ss.__setObj!, prim: ss.__setPrim! };
  }
  function setResolveKey(args: JSValue[]): { isObj: boolean; objKey?: JSObject; primKey?: string } {
    const k = args[0];
    if (typeof k === 'object' && k !== null) return { isObj: true, objKey: k as JSObject };
    return { isObj: false, primKey: toString(k) };
  }

  setProto.properties.set('add', {
    value: createNativeFunction('add', (_this, args) => {
      if (typeof _this !== 'object' || _this === null) return _this;
      const s = setGetStore(_this as JSObject);
      const k = setResolveKey(args);
      if (k.isObj) s.obj.add(k.objKey!); else s.prim.add(k.primKey!);
      return _this;
    }),
    writable: true, enumerable: false, configurable: true,
  });
  setProto.properties.set('has', {
    value: createNativeFunction('has', (_this, args) => {
      if (typeof _this !== 'object' || _this === null) return false;
      const s = setGetStore(_this as JSObject);
      const k = setResolveKey(args);
      return k.isObj ? s.obj.has(k.objKey!) : s.prim.has(k.primKey!);
    }),
    writable: true, enumerable: false, configurable: true,
  });
  setProto.properties.set('delete', {
    value: createNativeFunction('delete', (_this, args) => {
      if (typeof _this !== 'object' || _this === null) return false;
      const s = setGetStore(_this as JSObject);
      const k = setResolveKey(args);
      return k.isObj ? s.obj.delete(k.objKey!) : s.prim.delete(k.primKey!);
    }),
    writable: true, enumerable: false, configurable: true,
  });
  setProto.properties.set('clear', {
    value: createNativeFunction('clear', (_this) => {
      if (typeof _this === 'object' && _this !== null) {
        const s = setGetStore(_this as JSObject);
        s.obj.clear(); s.prim.clear();
      }
      return undefined;
    }),
    writable: true, enumerable: false, configurable: true,
  });
  setProto.properties.set('size', {
    value: undefined as unknown as JSValue,
    getter: createNativeFunction('get size', (_this) => {
      if (typeof _this !== 'object' || _this === null) return 0;
      const s = setGetStore(_this as JSObject);
      return s.obj.size + s.prim.size;
    }),
    writable: false, enumerable: false, configurable: true,
  });
  setProto.properties.set('values', {
    value: createNativeFunction('values', (_this) => {
      if (typeof _this !== 'object' || _this === null) return createArray([]);
      const s = setGetStore(_this as JSObject);
      const vals: JSValue[] = [];
      for (const v of s.obj) vals.push(v);
      for (const v of s.prim) {
        if (v === 'undefined') vals.push(undefined);
        else if (v === 'null') vals.push(null);
        else if (v === 'NaN') vals.push(NaN);
        else if (v === 'true') vals.push(true);
        else if (v === 'false') vals.push(false);
        else if (/^-?\d+(\.\d+)?$/.test(v)) vals.push(Number(v));
        else vals.push(v);
      }
      return createArray(vals);
    }),
    writable: true, enumerable: false, configurable: true,
  });
  setProto.properties.set('keys', {
    value: createNativeFunction('keys', (_this) => {
      const setValuesFn = setProto.properties.get('values')?.value;
      if (setValuesFn && typeof setValuesFn === 'object' && 'nativeFn' in setValuesFn) {
        return (setValuesFn as JSFunction).nativeFn!(_this, []);
      }
      return createArray([]);
    }),
    writable: true, enumerable: false, configurable: true,
  });
  setProto.properties.set('entries', {
    value: createNativeFunction('entries', (_this) => {
      if (typeof _this !== 'object' || _this === null) return createArray([]);
      const s = setGetStore(_this as JSObject);
      const entries: JSValue[] = [];
      for (const v of s.obj) entries.push(createArray([v, v]));
      for (const v of s.prim) {
        let parsed: JSValue = v;
        if (v === 'undefined') parsed = undefined;
        else if (v === 'null') parsed = null;
        else if (v === 'NaN') parsed = NaN;
        else if (v === 'true') parsed = true;
        else if (v === 'false') parsed = false;
        else if (/^-?\d+(\.\d+)?$/.test(v)) parsed = Number(v);
        entries.push(createArray([parsed, parsed]));
      }
      return createArray(entries);
    }),
    writable: true, enumerable: false, configurable: true,
  });
  setProto.properties.set('forEach', {
    value: createNativeFunction('forEach', (_this, args) => {
      const fn = args[0];
      if (typeof _this !== 'object' || _this === null) return undefined;
      if (typeof fn !== 'object' || fn === null || (fn as JSFunction).type !== 'closure') return undefined;
      const s = setGetStore(_this as JSObject);
      for (const v of s.obj) callJSFunction(fn as JSFunction, _this, [v, v, _this]);
      for (const v of s.prim) {
        let parsed: JSValue = v;
        if (v === 'undefined') parsed = undefined;
        else if (v === 'null') parsed = null;
        else if (v === 'NaN') parsed = NaN;
        else if (v === 'true') parsed = true;
        else if (v === 'false') parsed = false;
        else if (/^-?\d+(\.\d+)?$/.test(v)) parsed = Number(v);
        callJSFunction(fn as JSFunction, _this, [parsed, parsed, _this]);
      }
      return undefined;
    }),
    writable: true, enumerable: false, configurable: true,
  });
  setProto.properties.set('toString', {
    value: createNativeFunction('toString', (_this) => '[object Set]'),
    writable: true, enumerable: false, configurable: true,
  });

  // Modern Set methods (ES2025)
  function setToArray(_this: JSObject): JSValue[] {
    const s = setGetStore(_this);
    const arr: JSValue[] = [];
    for (const v of s.obj) arr.push(v);
    for (const v of s.prim) {
      if (v === 'undefined') arr.push(undefined);
      else if (v === 'null') arr.push(null);
      else if (v === 'NaN') arr.push(NaN);
      else if (v === 'true') arr.push(true);
      else if (v === 'false') arr.push(false);
      else if (/^-?\d+(\.\d+)?$/.test(v)) arr.push(Number(v));
      else arr.push(v);
    }
    return arr;
  }
  function setFromArgs(_this: JSObject, args: JSValue[]): void {
    const iterable = args[0];
    const s = setGetStore(_this);
    if (typeof iterable === 'object' && iterable !== null && (iterable as JSObject).type === 'array') {
      const len = Number((iterable as JSObject).properties.get('length')?.value ?? 0);
      for (let i = 0; i < len; i++) {
        const val = (iterable as JSObject).properties.get(String(i))?.value;
        const k = setResolveKey([val]);
        if (k.isObj) s.obj.add(k.objKey!); else s.prim.add(k.primKey!);
      }
    }
  }
  function setCreateFromValues(proto: JSObject, vals: JSValue[]): JSObject {
    const obj = createObject(proto) as JSObjectWithMeta;
    obj.__type_override = 'set';
    obj.__setObj = new Set<JSObject>();
    obj.__setPrim = new Set<string>();
    for (const v of vals) {
      const k = setResolveKey([v]);
      const s = setGetStore(obj);
      if (k.isObj) s.obj.add(k.objKey!); else s.prim.add(k.primKey!);
    }
    return obj;
  }

  for (const method of ['intersection', 'union', 'difference', 'symmetricDifference']) {
    setProto.properties.set(method, {
      value: createNativeFunction(method, (_this, args) => {
        if (typeof _this !== 'object' || _this === null) return createObject(setProto);
        const otherRaw = args[0];
        const otherArr: JSValue[] = [];
        if (typeof otherRaw === 'object' && otherRaw !== null && (otherRaw as JSObject).type === 'array') {
          const len = Number((otherRaw as JSObject).properties.get('length')?.value ?? 0);
          for (let i = 0; i < len; i++) otherArr.push((otherRaw as JSObject).properties.get(String(i))?.value);
        } else if (typeof otherRaw === 'object' && otherRaw !== null && (otherRaw as JSObjectWithMeta).__setObj) {
          otherArr.push(...setToArray(otherRaw as JSObject));
        }
        const thisArr = setToArray(_this as JSObject);
        let result: JSValue[];
        if (method === 'intersection') {
          result = thisArr.filter(v => {
            const k = setResolveKey([v]);
            const s = typeof otherRaw === 'object' && otherRaw !== null && (otherRaw as JSObjectWithMeta).__setObj ? setGetStore(otherRaw as JSObject) : null;
            if (s) return k.isObj ? s.obj.has(k.objKey!) : s.prim.has(k.primKey!);
            return otherArr.some(o => toString(o) === toString(v));
          });
        } else if (method === 'difference') {
          result = thisArr.filter(v => {
            const k = setResolveKey([v]);
            const s = typeof otherRaw === 'object' && otherRaw !== null && (otherRaw as JSObjectWithMeta).__setObj ? setGetStore(otherRaw as JSObject) : null;
            if (s) return !(k.isObj ? s.obj.has(k.objKey!) : s.prim.has(k.primKey!));
            return !otherArr.some(o => toString(o) === toString(v));
          });
        } else if (method === 'union') {
          result = [...thisArr, ...otherArr];
        } else {
          const inBoth = thisArr.filter(v => otherArr.some(o => toString(o) === toString(v)));
          result = [...thisArr.filter(v => !inBoth.includes(v)), ...otherArr.filter(v => !inBoth.includes(v))];
        }
        return setCreateFromValues(setProto, result);
      }),
      writable: true, enumerable: false, configurable: true,
    });
  }
  for (const method of ['isSubsetOf', 'isSupersetOf', 'isDisjointFrom']) {
    setProto.properties.set(method, {
      value: createNativeFunction(method, (_this, args) => {
        if (typeof _this !== 'object' || _this === null) return false;
        const otherRaw = args[0];
        const thisArr = setToArray(_this as JSObject);
        if (method === 'isSubsetOf') {
          return thisArr.every(v => {
            if (typeof otherRaw === 'object' && otherRaw !== null && (otherRaw as JSObjectWithMeta).__setObj) {
              const k = setResolveKey([v]);
              const s = setGetStore(otherRaw as JSObject);
              return k.isObj ? s.obj.has(k.objKey!) : s.prim.has(k.primKey!);
            }
            return false;
          });
        } else if (method === 'isSupersetOf') {
          if (typeof otherRaw === 'object' && otherRaw !== null && (otherRaw as JSObjectWithMeta).__setObj) {
            const otherArr = setToArray(otherRaw as JSObject);
            return otherArr.every(v => {
              const k = setResolveKey([v]);
              const s = setGetStore(_this as JSObject);
              return k.isObj ? s.obj.has(k.objKey!) : s.prim.has(k.primKey!);
            });
          }
          return false;
        } else {
          if (typeof otherRaw === 'object' && otherRaw !== null && (otherRaw as JSObjectWithMeta).__setObj) {
            const otherArr = setToArray(otherRaw as JSObject);
            for (const v of otherArr) {
              const k = setResolveKey([v]);
              const s = setGetStore(_this as JSObject);
              if (k.isObj ? s.obj.has(k.objKey!) : s.prim.has(k.primKey!)) return false;
            }
            return true;
          }
          return true;
        }
      }),
      writable: true, enumerable: false, configurable: true,
    });
  }

  const setCtor = createNativeFunction('Set', (_this, args) => {
    const setObj = createObject(setProto) as JSObjectWithMeta;
    setObj.__type_override = 'set';
    setObj.__setObj = new Set<JSObject>();
    setObj.__setPrim = new Set<string>();
    setFromArgs(setObj, args);
    return setObj;
  });
  const setCtorObj = createObject(null);
  setCtorObj.type = 'function';
  setCtorObj.callable = true;
  setCtorObj.nativeFn = setCtor.nativeFn;
  setCtorObj.properties.set('prototype', { value: setProto, writable: false, enumerable: false, configurable: false });
  env.setLocal('Set', setCtorObj);

  // WeakMap constructor
  const weakMapProto = createObject(null);
  weakMapProto.properties.set('get', {
    value: createNativeFunction('get', (_this, args) => {
      if (typeof _this !== 'object' || _this === null || !(_this as JSObjectWithMeta).__weakMapEntries) return undefined;
      const entries = (_this as JSObjectWithMeta).__weakMapEntries as Map<JSObject, JSValue>;
      const k = args[0];
      if (typeof k === 'object' && k !== null) return entries.get(k as JSObject);
      return undefined;
    }),
    writable: true, enumerable: false, configurable: true,
  });
  weakMapProto.properties.set('set', {
    value: createNativeFunction('set', (_this, args) => {
      if (typeof _this !== 'object' || _this === null) return _this;
      if (!(_this as JSObjectWithMeta).__weakMapEntries) (_this as JSObjectWithMeta).__weakMapEntries = new Map<JSObject, JSValue>();
      const k = args[0];
      if (typeof k === 'object' && k !== null) (_this as JSObjectWithMeta).__weakMapEntries!.set(k as JSObject, args[1]);
      return _this;
    }),
    writable: true, enumerable: false, configurable: true,
  });
  weakMapProto.properties.set('has', {
    value: createNativeFunction('has', (_this, args) => {
      if (typeof _this !== 'object' || _this === null || !(_this as JSObjectWithMeta).__weakMapEntries) return false;
      const k = args[0];
      if (typeof k === 'object' && k !== null) return (_this as JSObjectWithMeta).__weakMapEntries!.has(k as JSObject);
      return false;
    }),
    writable: true, enumerable: false, configurable: true,
  });
  weakMapProto.properties.set('delete', {
    value: createNativeFunction('delete', (_this, args) => {
      if (typeof _this !== 'object' || _this === null || !(_this as JSObjectWithMeta).__weakMapEntries) return false;
      const k = args[0];
      if (typeof k === 'object' && k !== null) return (_this as JSObjectWithMeta).__weakMapEntries!.delete(k as JSObject);
      return false;
    }),
    writable: true, enumerable: false, configurable: true,
  });
  const weakMapCtor = createNativeFunction('WeakMap', (_this, args) => {
    const wmObj = createObject(weakMapProto) as JSObjectWithMeta;
    wmObj.__type_override = 'weakmap';
    wmObj.__weakMapEntries = new Map<JSObject, JSValue>();
    const iterable = args[0];
    if (typeof iterable === 'object' && iterable !== null && isJSObjectWithMeta(iterable) && iterable.type === 'array') {
      const len = Number(iterable.properties.get('length')?.value ?? 0);
      for (let i = 0; i < len; i++) {
        const entry = iterable.properties.get(String(i))?.value;
        if (typeof entry === 'object' && entry !== null && isJSObjectWithMeta(entry) && entry.type === 'array') {
          const key = entry.properties.get('0')?.value;
          const val = entry.properties.get('1')?.value;
          if (typeof key === 'object' && key !== null) wmObj.__weakMapEntries!.set(key as JSObject, val);
        }
      }
    }
    return wmObj;
  });
  const weakMapCtorObj = createObject(null);
  weakMapCtorObj.type = 'function';
  weakMapCtorObj.callable = true;
  weakMapCtorObj.nativeFn = weakMapCtor.nativeFn;
  weakMapCtorObj.properties.set('prototype', { value: weakMapProto, writable: false, enumerable: false, configurable: false });
  env.setLocal('WeakMap', weakMapCtorObj);

  // WeakSet constructor
  const weakSetProto = createObject(null);
  weakSetProto.properties.set('add', {
    value: createNativeFunction('add', (_this, args) => {
      if (typeof _this !== 'object' || _this === null) return _this;
      if (!(_this as JSObjectWithMeta).__weakSetEntries) (_this as JSObjectWithMeta).__weakSetEntries = new Set<JSObject>();
      const k = args[0];
      if (typeof k === 'object' && k !== null) (_this as JSObjectWithMeta).__weakSetEntries!.add(k as JSObject);
      return _this;
    }),
    writable: true, enumerable: false, configurable: true,
  });
  weakSetProto.properties.set('has', {
    value: createNativeFunction('has', (_this, args) => {
      if (typeof _this !== 'object' || _this === null || !(_this as JSObjectWithMeta).__weakSetEntries) return false;
      const k = args[0];
      if (typeof k === 'object' && k !== null) return (_this as JSObjectWithMeta).__weakSetEntries!.has(k as JSObject);
      return false;
    }),
    writable: true, enumerable: false, configurable: true,
  });
  weakSetProto.properties.set('delete', {
    value: createNativeFunction('delete', (_this, args) => {
      if (typeof _this !== 'object' || _this === null || !(_this as JSObjectWithMeta).__weakSetEntries) return false;
      const k = args[0];
      if (typeof k === 'object' && k !== null) return (_this as JSObjectWithMeta).__weakSetEntries!.delete(k as JSObject);
      return false;
    }),
    writable: true, enumerable: false, configurable: true,
  });
  const weakSetCtor = createNativeFunction('WeakSet', (_this) => {
    const wsObj = createObject(weakSetProto) as JSObjectWithMeta;
    wsObj.__type_override = 'weakset';
    wsObj.__weakSetEntries = new Set<JSObject>();
    return wsObj;
  });
  const weakSetCtorObj = createObject(null);
  weakSetCtorObj.type = 'function';
  weakSetCtorObj.callable = true;
  weakSetCtorObj.nativeFn = weakSetCtor.nativeFn;
  weakSetCtorObj.properties.set('prototype', { value: weakSetProto, writable: false, enumerable: false, configurable: false });
  env.setLocal('WeakSet', weakSetCtorObj);

  // Array static methods + prototype methods
  env.setLocal('Array', (() => {
    const arrCtorObj = createObject(null);
    arrCtorObj.type = 'function';
    arrCtorObj.callable = true;
    arrCtorObj.nativeFn = (_this: unknown, args: unknown[]) => createArray(args as JSValue[]);
    arrCtorObj.properties.set('isArray', {
      value: createNativeFunction('isArray', (_this, args) => {
        return typeof args[0] === 'object' && args[0] !== null && (args[0] as JSObject).type === 'array';
      }),
      writable: true, enumerable: false, configurable: true,
    });
    arrCtorObj.properties.set('of', {
      value: createNativeFunction('of', (_this, args) => createArray(args)),
      writable: true, enumerable: false, configurable: true,
    });
    arrCtorObj.properties.set('from', {
      value: createNativeFunction('from', (_this, args) => {
        const source = args[0];
        const mapFn = args[1] as JSFunction | undefined;
        const values = iterableToArray(source, env);
        const result = values.map((val, i) => {
          if (typeof mapFn === 'object' && mapFn !== null && mapFn.type === 'closure') {
            return callJSFunction(mapFn, undefined, [val, i]);
          }
          return val;
        });
        return createArray(result);
      }),
      writable: true, enumerable: false, configurable: true,
    });
    return arrCtorObj;
  })());

  // Array.prototype methods
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const arrProtoMethods: Record<string, (...args: any[]) => any> = {
    push: (_this, ...args) => {
      if (typeof _this !== 'object' || _this === null) return 0;
      const obj = _this as JSObject;
      const len = Number(obj.properties.get('length')?.value ?? 0);
      for (let i = 0; i < args.length; i++) {
        obj.properties.set(String(len + i), { value: args[i] as JSValue, writable: true, enumerable: true, configurable: true });
      }
      obj.properties.set('length', { value: len + args.length, writable: true, enumerable: false, configurable: true });
      return len + args.length;
    },
    pop: (_this) => {
      if (typeof _this !== 'object' || _this === null) return undefined;
      const obj = _this as JSObject;
      const len = Number(obj.properties.get('length')?.value ?? 0);
      if (len === 0) { obj.properties.set('length', { value: 0, writable: true, enumerable: false, configurable: true }); return undefined; }
      const idx = len - 1;
      const val = obj.properties.get(String(idx))?.value;
      obj.properties.delete(String(idx));
      obj.properties.set('length', { value: idx, writable: true, enumerable: false, configurable: true });
      return val;
    },
    shift: (_this) => {
      if (typeof _this !== 'object' || _this === null) return undefined;
      const obj = _this as JSObject;
      const len = Number(obj.properties.get('length')?.value ?? 0);
      if (len === 0) return undefined;
      const val = obj.properties.get('0')?.value;
      for (let i = 1; i < len; i++) {
        const next = obj.properties.get(String(i))?.value;
        obj.properties.set(String(i - 1), { value: next, writable: true, enumerable: true, configurable: true });
      }
      obj.properties.delete(String(len - 1));
      obj.properties.set('length', { value: len - 1, writable: true, enumerable: false, configurable: true });
      return val;
    },
    unshift: (_this, ...args) => {
      if (typeof _this !== 'object' || _this === null) return 0;
      const obj = _this as JSObject;
      const len = Number(obj.properties.get('length')?.value ?? 0);
      for (let i = len - 1; i >= 0; i--) {
        const val = obj.properties.get(String(i))?.value;
        obj.properties.set(String(i + args.length), { value: val, writable: true, enumerable: true, configurable: true });
      }
      for (let i = 0; i < args.length; i++) {
        obj.properties.set(String(i), { value: args[i] as JSValue, writable: true, enumerable: true, configurable: true });
      }
      obj.properties.set('length', { value: len + args.length, writable: true, enumerable: false, configurable: true });
      return len + args.length;
    },
    indexOf: (_this, searchElement, fromIndex) => {
      if (typeof _this !== 'object' || _this === null) return -1;
      const obj = _this as JSObject;
      const len = Number(obj.properties.get('length')?.value ?? 0);
      const start = Math.max(0, toNumber(fromIndex ?? 0));
      for (let i = start; i < len; i++) {
        if (obj.properties.get(String(i))?.value === searchElement) return i;
      }
      return -1;
    },
    includes: (_this, searchElement, fromIndex) => {
      if (typeof _this !== 'object' || _this === null) return false;
      const obj = _this as JSObject;
      const len = Number(obj.properties.get('length')?.value ?? 0);
      const start = Math.max(0, toNumber(fromIndex ?? 0));
      for (let i = start; i < len; i++) {
        if (obj.properties.get(String(i))?.value === searchElement) return true;
      }
      return false;
    },
    join: (_this, separator) => {
      if (typeof _this !== 'object' || _this === null) return '';
      const obj = _this as JSObject;
      const len = Number(obj.properties.get('length')?.value ?? 0);
      const sep = separator !== undefined ? toString(separator) : ',';
      const parts: string[] = [];
      for (let i = 0; i < len; i++) {
        const val = obj.properties.get(String(i))?.value;
        parts.push(val !== undefined && val !== null ? toString(val) : '');
      }
      return parts.join(sep);
    },
    slice: (_this, start, end) => {
      if (typeof _this !== 'object' || _this === null) return createArray([]);
      const obj = _this as JSObject;
      const len = Number(obj.properties.get('length')?.value ?? 0);
      let s = toNumber(start ?? 0);
      let e = end !== undefined ? toNumber(end) : len;
      if (s < 0) s = Math.max(0, len + s);
      if (e < 0) e = Math.max(0, len + e);
      e = Math.min(e, len);
      const result: JSValue[] = [];
      for (let i = s; i < e; i++) {
        result.push(obj.properties.get(String(i))?.value);
      }
      return createArray(result);
    },
    splice: (_this, start, deleteCount, ...items) => {
      if (typeof _this !== 'object' || _this === null) return createArray([]);
      const obj = _this as JSObject;
      const len = Number(obj.properties.get('length')?.value ?? 0);
      let s = toNumber(start ?? 0);
      if (s < 0) s = Math.max(0, len + s);
      s = Math.min(s, len);
      let dc = deleteCount !== undefined ? toNumber(deleteCount) : len - s;
      dc = Math.max(0, Math.min(dc, len - s));
      const removed: JSValue[] = [];
      for (let i = s; i < s + dc; i++) {
        removed.push(obj.properties.get(String(i))?.value);
      }
      const newLen = len - dc + items.length;
      for (let i = len - 1; i >= s + dc; i--) {
        obj.properties.set(String(i + items.length - dc), { value: obj.properties.get(String(i))?.value, writable: true, enumerable: true, configurable: true });
      }
      for (let i = 0; i < items.length; i++) {
        obj.properties.set(String(s + i), { value: items[i] as JSValue, writable: true, enumerable: true, configurable: true });
      }
      for (let i = s + items.length; i < newLen; i++) {
        if (!obj.properties.has(String(i))) obj.properties.set(String(i), { value: undefined, writable: true, enumerable: true, configurable: true });
      }
      obj.properties.set('length', { value: newLen, writable: true, enumerable: false, configurable: true });
      return createArray(removed);
    },
    concat: (_this, ...args) => {
      if (typeof _this !== 'object' || _this === null) return createArray([]);
      const result: JSValue[] = [];
      const obj = _this as JSObject;
      const len = Number(obj.properties.get('length')?.value ?? 0);
      for (let i = 0; i < len; i++) result.push(obj.properties.get(String(i))?.value);
      for (const arg of args) {
        if (typeof arg === 'object' && arg !== null && (arg as JSObject).type === 'array') {
          const argLen = Number((arg as JSObject).properties.get('length')?.value ?? 0);
          for (let i = 0; i < argLen; i++) result.push((arg as JSObject).properties.get(String(i))?.value);
        } else {
          result.push(arg as JSValue);
        }
      }
      return createArray(result);
    },
    reverse: (_this) => {
      if (typeof _this !== 'object' || _this === null) return _this;
      const obj = _this as JSObject;
      const len = Number(obj.properties.get('length')?.value ?? 0);
      for (let i = 0; i < Math.floor(len / 2); i++) {
        const a = obj.properties.get(String(i))?.value;
        const b = obj.properties.get(String(len - 1 - i))?.value;
        obj.properties.set(String(i), { value: b, writable: true, enumerable: true, configurable: true });
        obj.properties.set(String(len - 1 - i), { value: a, writable: true, enumerable: true, configurable: true });
      }
      return _this;
    },
    flat: (_this, depth) => {
      if (typeof _this !== 'object' || _this === null) return createArray([]);
      const d = toNumber(depth ?? 1);
      const result: JSValue[] = [];
      const obj = _this as JSObject;
      const len = Number(obj.properties.get('length')?.value ?? 0);
      const flatten = (arr: JSObject, currentDepth: number) => {
        const arrLen = Number(arr.properties.get('length')?.value ?? 0);
        for (let i = 0; i < arrLen; i++) {
          const val = arr.properties.get(String(i))?.value;
          if (typeof val === 'object' && val !== null && (val as JSObject).type === 'array' && currentDepth < d) {
            flatten(val as JSObject, currentDepth + 1);
          } else {
            result.push(val);
          }
        }
      };
      flatten(obj, 0);
      return createArray(result);
    },
    map: (_this, callback) => {
      if (typeof _this !== 'object' || _this === null) return createArray([]);
      if (typeof callback !== 'object' || callback === null || (callback as JSFunction).type !== 'closure') return createArray([]);
      const obj = _this as JSObject;
      const len = Number(obj.properties.get('length')?.value ?? 0);
      const result: JSValue[] = [];
      for (let i = 0; i < len; i++) {
        const val = obj.properties.get(String(i))?.value;
        result.push(callJSFunction(callback as JSFunction, undefined, [val, i, _this]));
      }
      return createArray(result);
    },
    filter: (_this, callback) => {
      if (typeof _this !== 'object' || _this === null) return createArray([]);
      if (typeof callback !== 'object' || callback === null || (callback as JSFunction).type !== 'closure') return createArray([]);
      const obj = _this as JSObject;
      const len = Number(obj.properties.get('length')?.value ?? 0);
      const result: JSValue[] = [];
      for (let i = 0; i < len; i++) {
        const val = obj.properties.get(String(i))?.value;
        if (callJSFunction(callback as JSFunction, undefined, [val, i, _this])) result.push(val);
      }
      return createArray(result);
    },
    reduce: (_this, callback, initialValue) => {
      if (typeof _this !== 'object' || _this === null) return undefined;
      if (typeof callback !== 'object' || callback === null || (callback as JSFunction).type !== 'closure') return undefined;
      const obj = _this as JSObject;
      const len = Number(obj.properties.get('length')?.value ?? 0);
      let acc: JSValue = initialValue;
      let startIdx = 0;
      if (initialValue === undefined) {
        if (len === 0) throw new TypeError('Reduce of empty array with no initial value');
        acc = obj.properties.get('0')?.value;
        startIdx = 1;
      }
      for (let i = startIdx; i < len; i++) {
        const val = obj.properties.get(String(i))?.value;
        acc = callJSFunction(callback as JSFunction, undefined, [acc, val, i, _this]);
      }
      return acc;
    },
    find: (_this, callback) => {
      if (typeof _this !== 'object' || _this === null) return undefined;
      if (typeof callback !== 'object' || callback === null || (callback as JSFunction).type !== 'closure') return undefined;
      const obj = _this as JSObject;
      const len = Number(obj.properties.get('length')?.value ?? 0);
      for (let i = 0; i < len; i++) {
        const val = obj.properties.get(String(i))?.value;
        if (callJSFunction(callback as JSFunction, undefined, [val, i, _this])) return val;
      }
      return undefined;
    },
    findIndex: (_this, callback) => {
      if (typeof _this !== 'object' || _this === null) return -1;
      if (typeof callback !== 'object' || callback === null || (callback as JSFunction).type !== 'closure') return -1;
      const obj = _this as JSObject;
      const len = Number(obj.properties.get('length')?.value ?? 0);
      for (let i = 0; i < len; i++) {
        const val = obj.properties.get(String(i))?.value;
        if (callJSFunction(callback as JSFunction, undefined, [val, i, _this])) return i;
      }
      return -1;
    },
    some: (_this, callback) => {
      if (typeof _this !== 'object' || _this === null) return false;
      if (typeof callback !== 'object' || callback === null || (callback as JSFunction).type !== 'closure') return false;
      const obj = _this as JSObject;
      const len = Number(obj.properties.get('length')?.value ?? 0);
      for (let i = 0; i < len; i++) {
        const val = obj.properties.get(String(i))?.value;
        if (callJSFunction(callback as JSFunction, undefined, [val, i, _this])) return true;
      }
      return false;
    },
    every: (_this, callback) => {
      if (typeof _this !== 'object' || _this === null) return true;
      if (typeof callback !== 'object' || callback === null || (callback as JSFunction).type !== 'closure') return true;
      const obj = _this as JSObject;
      const len = Number(obj.properties.get('length')?.value ?? 0);
      for (let i = 0; i < len; i++) {
        const val = obj.properties.get(String(i))?.value;
        if (!callJSFunction(callback as JSFunction, undefined, [val, i, _this])) return false;
      }
      return true;
    },
    forEach: (_this, callback) => {
      if (typeof _this !== 'object' || _this === null) return undefined;
      if (typeof callback !== 'object' || callback === null || (callback as JSFunction).type !== 'closure') return undefined;
      const obj = _this as JSObject;
      const len = Number(obj.properties.get('length')?.value ?? 0);
      for (let i = 0; i < len; i++) {
        const val = obj.properties.get(String(i))?.value;
        callJSFunction(callback as JSFunction, undefined, [val, i, _this]);
      }
      return undefined;
    },
    fill: (_this, value, start, end) => {
      if (typeof _this !== 'object' || _this === null) return _this;
      const obj = _this as JSObject;
      const len = Number(obj.properties.get('length')?.value ?? 0);
      let s = Math.max(0, toNumber(start ?? 0));
      let e = end !== undefined ? toNumber(end) : len;
      if (s < 0) s = Math.max(0, len + s);
      if (e < 0) e = Math.max(0, len + e);
      e = Math.min(e, len);
      for (let i = s; i < e; i++) {
        obj.properties.set(String(i), { value: value as JSValue, writable: true, enumerable: true, configurable: true });
      }
      return _this;
    },
    sort: (_this, compareFn) => {
      if (typeof _this !== 'object' || _this === null) return _this;
      const obj = _this as JSObject;
      const len = Number(obj.properties.get('length')?.value ?? 0);
      const items: [number, JSValue][] = [];
      for (let i = 0; i < len; i++) {
        items.push([i, obj.properties.get(String(i))?.value]);
      }
      items.sort((a, b) => {
        if (compareFn !== undefined && typeof compareFn === 'object' && compareFn !== null && (compareFn as JSFunction).type === 'closure') {
          const result = toNumber(callJSFunction(compareFn as JSFunction, undefined, [a[1], b[1]]));
          return result;
        }
        const sa = a[1] !== undefined && a[1] !== null ? toString(a[1]) : '';
        const sb = b[1] !== undefined && b[1] !== null ? toString(b[1]) : '';
        return sa < sb ? -1 : sa > sb ? 1 : 0;
      });
      for (let i = 0; i < items.length; i++) {
        obj.properties.set(String(i), { value: items[i][1], writable: true, enumerable: true, configurable: true });
      }
      return _this;
    },
    toString: (_this: any) => {
      if (typeof _this !== 'object' || _this === null) return '';
      const obj = _this as JSObject;
      if (obj.type === 'array') {
        const len = Number(obj.properties.get('length')?.value ?? 0);
        const parts: string[] = [];
        for (let i = 0; i < len; i++) {
          const val = obj.properties.get(String(i))?.value;
          parts.push(val !== undefined && val !== null ? toString(val) : '');
        }
        return parts.join(',');
      }
      return '';
    },
  };
  const arrayProto = createObject(null);
  for (const [name, fn] of Object.entries(arrProtoMethods)) {
    arrayProto.properties.set(name, {
      value: createNativeFunction(name, fn as NativeFunction),
      writable: true, enumerable: false, configurable: true,
    });
  }
  arrayProto.properties.set('length', { value: 0, writable: true, enumerable: false, configurable: true });
  arrayProto.properties.set(Symbol.for('iterator') as unknown as string, {
    value: createNativeFunction('[Symbol.iterator]', (_this) => {
      if (typeof _this !== 'object' || _this === null) return undefined;
      const obj = _this as JSObject;
      const len = Number(obj.properties.get('length')?.value ?? 0);
      let idx = 0;
      const iteratorProto = createObject(null);
      iteratorProto.properties.set('next', {
        value: createNativeFunction('next', () => {
          if (idx < len) {
            const result = createObject(null);
            result.properties.set('value', { value: obj.properties.get(String(idx))?.value, writable: true, enumerable: true, configurable: true });
            result.properties.set('done', { value: false, writable: true, enumerable: true, configurable: true });
            idx++;
            return result;
          }
          const result = createObject(null);
          result.properties.set('value', { value: undefined, writable: true, enumerable: true, configurable: true });
          result.properties.set('done', { value: true, writable: true, enumerable: true, configurable: true });
          return result;
        }),
        writable: true, enumerable: false, configurable: true,
      });
      return iteratorProto;
    }),
    writable: true, enumerable: false, configurable: true,
  });

  // Make sure all new array instances get the prototype
  // The Array constructor already returns createArray which sets type='array' and uses arrayProto
  // But we need to update createArray to use our new proto — skip for now, the methods are on instances

  // Function constructor (limited — wraps source code into executable)
  const funcCtor = createNativeFunction('Function', (_this, args) => {
    const body = args.length > 0 ? toString(args[args.length - 1]) : '';
    const paramNames: string[] = [];
    for (let i = 0; i < args.length - 1; i++) {
      paramNames.push(toString(args[i]));
    }
    const src = `var __fn = function(${paramNames.join(',')}) { ${body} }; __fn`;
    const funcLexer = new Lexer(src);
    const funcParser = new Parser([], funcLexer);
    const program = funcParser.parse();
    const interp = new Interpreter(env, eventLoop);
    return interp.run(program);
  });
  const funcCtorObj = createObject(null);
  funcCtorObj.type = 'function';
  funcCtorObj.callable = true;
  funcCtorObj.nativeFn = funcCtor.nativeFn;
  funcCtorObj.properties.set('length', { value: 0, writable: false, enumerable: false, configurable: true });
  funcCtorObj.properties.set('name', { value: 'Function', writable: false, enumerable: false, configurable: true });
  const funcProtoObj = createObject(null);
  funcProtoObj.properties.set('constructor', { value: funcCtorObj, writable: true, enumerable: false, configurable: true });
  funcCtorObj.properties.set('prototype', { value: funcProtoObj, writable: false, enumerable: false, configurable: false });
  env.setLocal('Function', funcCtorObj);

  // atob / btoa
  env.setLocal('atob', createNativeFunction('atob', (_this, args) => {
    const str = toString(args[0]);
    return Buffer.from(str, 'base64').toString('binary');
  }));
  env.setLocal('btoa', createNativeFunction('btoa', (_this, args) => {
    const str = toString(args[0]);
    return Buffer.from(str, 'binary').toString('base64');
  }));

  // structuredClone
  env.setLocal('structuredClone', createNativeFunction('structuredClone', (_this, args) => {
    const clone = (val: JSValue): JSValue => {
      if (val === null || val === undefined || typeof val === 'boolean' || typeof val === 'number' || typeof val === 'string') return val;
      if (typeof val === 'object') {
        const obj = val as JSObject;
        if (obj.type === 'array') {
          const len = Number(obj.properties.get('length')?.value ?? 0);
          const arr: JSValue[] = [];
          for (let i = 0; i < len; i++) arr.push(clone(obj.properties.get(String(i))?.value));
          return createArray(arr);
        }
        const result = createObject(null);
        for (const [k, desc] of obj.properties) {
          result.properties.set(k, { value: clone(desc.value), writable: desc.writable, enumerable: desc.enumerable, configurable: desc.configurable });
        }
        return result;
      }
      return val;
    };
    return clone(args[0]);
  }));

  // performance (full API — mark, measure, getEntries)
  env.setLocal('performance', createPerformanceObject());

  // navigator (minimal)
  const navObj = createObject(null);
  navObj.properties.set('userAgent', { value: 'NovaBrowser/1.0', writable: false, enumerable: true, configurable: false });
  navObj.properties.set('language', { value: 'en-US', writable: false, enumerable: true, configurable: false });
  navObj.properties.set('platform', { value: 'Nova', writable: false, enumerable: true, configurable: false });
  // navigator.vibrate()
  navObj.properties.set('vibrate', {
    value: createNativeFunction('vibrate', (_this, args) => {
      // Vibration requires hardware; accept the call but return false (not supported)
      return false;
    }),
    writable: true, enumerable: true, configurable: true,
  });
  env.setLocal('navigator', navObj);

  // DOM binding
  const docBinding = createDocumentBinding(doc, domTree);
  env.setLocal('document', docBinding);

  // Event / MouseEvent / CustomEvent constructors — dispatchEvent()/
  // addEventListener() were fully implemented but nothing could ever
  // construct an event to hand them: `new Event(...)` resolved to no
  // global at all, so every dispatch silently carried type: undefined
  // and matched no listener.
  const eventInit = (options: JSValue): { bubbles?: boolean; cancelable?: boolean; composed?: boolean } => {
    if (typeof options !== 'object' || options === null) return {};
    const o = options as JSObject;
    return {
      bubbles: toBoolean(o.properties.get('bubbles')?.value ?? false),
      cancelable: toBoolean(o.properties.get('cancelable')?.value ?? false),
      composed: toBoolean(o.properties.get('composed')?.value ?? false),
    };
  };
  env.setLocal('Event', createNativeFunction('Event', (_this, args) => createEventObject(toString(args[0]), undefined, eventInit(args[1]))));
  env.setLocal('MouseEvent', createNativeFunction('MouseEvent', (_this, args) => createEventObject(toString(args[0]), undefined, eventInit(args[1]))));
  env.setLocal('KeyboardEvent', createNativeFunction('KeyboardEvent', (_this, args) => createEventObject(toString(args[0]), undefined, eventInit(args[1]))));
  env.setLocal('CustomEvent', createNativeFunction('CustomEvent', (_this, args) => {
    const evt = createEventObject(toString(args[0]), undefined, eventInit(args[1]));
    const detail = typeof args[1] === 'object' && args[1] !== null ? (args[1] as JSObject).properties.get('detail')?.value : undefined;
    evt.properties.set('detail', { value: detail, writable: false, enumerable: true, configurable: false });
    return evt;
  }));

  // document.write() / document.open() — requires an HtmlParser
  if (htmlParser) {
    docBinding.properties.set('write', {
      value: createNativeFunction('write', (_this, args) => {
        const str = toString(args[0]);
        htmlParser.write(str);
        const updatedDoc = htmlParser.getCurrentDocument() as HtmlDocument;
        const newDoc = domTree.buildFromHtml(updatedDoc);
        docBinding.properties.set('body', {
          value: newDoc.bodyElement ? wrapElement(newDoc.bodyElement, domTree) : null,
          writable: true, enumerable: true, configurable: true,
        });
        docBinding.properties.set('documentElement', {
          value: newDoc.htmlElement ? wrapElement(newDoc.htmlElement, domTree) : null,
          writable: true, enumerable: true, configurable: true,
        });
        return undefined;
      }),
      writable: true, enumerable: true, configurable: true,
    });
    docBinding.properties.set('open', {
      value: createNativeFunction('open', () => {
        htmlParser.open();
        const newDoc = domTree.buildFromHtml(htmlParser.getCurrentDocument() as HtmlDocument);
        docBinding.properties.set('body', { value: null, writable: true, enumerable: true, configurable: true });
        docBinding.properties.set('documentElement', { value: null, writable: true, enumerable: true, configurable: true });
        return undefined;
      }),
      writable: true, enumerable: true, configurable: true,
    });
  }

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
  bindTimers(env, eventLoop, scriptEnforcer, pageOrigin);

  // Fetch API
  env.setLocal('Headers', createHeadersClass(eventLoop));
  env.setLocal('Response', createResponseClass(eventLoop));
  env.setLocal('Request', createRequestClass(eventLoop));
  env.setLocal('AbortController', createAbortControllerClass(eventLoop));
  env.setLocal('fetch', createFetchFn(eventLoop, platformFetch, resourceEnforcer, pageOrigin));

  // Web Crypto API — getRandomValues/randomUUID/subtle, delegating to Node's
  // real webcrypto implementation (see crypto-api.ts)
  env.setLocal('crypto', createCryptoObject(eventLoop));

  // Custom Elements — window.HTMLElement (extendable) + window.customElements
  env.setLocal('HTMLElement', createHTMLElementClass());
  env.setLocal('customElements', createCustomElementRegistry(eventLoop));

  // Cache API — window.caches, backed by the same fetch used for real requests
  env.setLocal('caches', createCacheStorage(eventLoop, platformFetch));

  // XMLHttpRequest
  env.setLocal('XMLHttpRequest', createXMLHttpRequestClass(eventLoop));

  // WebSocket
  env.setLocal('WebSocket', createWebSocketClass(eventLoop, resourceEnforcer, pageOrigin));

  // WebRTC (Phase 1 — real ICE/STUN + a Nova-specific reliable data channel;
  // NOT interoperable with real browsers yet, see doc/webrtc-implementation-plan.md)
  env.setLocal('RTCPeerConnection', createRTCPeerConnectionClass(eventLoop));
  env.setLocal('RTCSessionDescription', createRTCSessionDescriptionClass());
  env.setLocal('RTCIceCandidate', createRTCIceCandidateClass());

  // Worker constructor
  env.setLocal('Worker', createWorkerConstructor(
    eventLoop,
    platformFetch,
    (_url: string) => { throw new Error('importScripts not yet supported'); },
  ));

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
          callJSFunction(callback as JSFunction, ioObj, [entryArr, ioObj]);
        }
      },
      { rootMargin, threshold },
    );

    ioObj.properties.set('observe', {
      value: createNativeFunction('observe', (_t, a) => {
        const wrapped = a[0] as JSObject;
        if (wrapped && typeof wrapped === 'object' && '__domNode' in wrapped) {
          const el = (wrapped as unknown as { __domNode: DomElement }).__domNode as DomElement;
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
          const el = (wrapped as unknown as { __domNode: DomElement }).__domNode as DomElement;
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

  // ArrayBuffer, TypedArray, DataView, SharedArrayBuffer, Atomics, WeakRef, FinalizationRegistry
  const typedArrayCtors = createTypedArrayConstructors();
  for (const [name, ctorObj] of Object.entries(typedArrayCtors)) {
    env.setLocal(name, ctorObj);
  }

  // Storage APIs (localStorage, sessionStorage, indexedDB)
  bindStorageAPIs(env, { origin: pageOrigin ?? 'https://localhost', diskPath: storageDir });

  // Web SQL Database (deprecated, but still used by legacy pages)
  bindWebSQL(env, eventLoop, { origin: pageOrigin ?? 'https://localhost', diskPath: storageDir });

  // Fullscreen API (methods on Element via global)
  const fullscreen = createFullscreenAPIMethods();
  env.setLocal('fullscreenElement', fullscreen.fullscreenElement);

  // Selection API — window.getSelection()
  const selectionObj = createSelectionObject();
  windowObj.properties.set('getSelection', {
    value: createNativeFunction('getSelection', () => selectionObj),
    writable: true, enumerable: true, configurable: true,
  });
  env.setLocal('getSelection', createNativeFunction('getSelection', () => selectionObj));

  // document.createRange()
  docBinding.properties.set('createRange', {
    value: createNativeFunction('createRange', () => createRangeObject()),
    writable: true, enumerable: true, configurable: true,
  });

  // document.createTreeWalker()
  docBinding.properties.set('createTreeWalker', { value: createTreeWalkerObject(), writable: true, enumerable: true, configurable: true });

  // document.createNodeIterator()
  docBinding.properties.set('createNodeIterator', { value: createNodeIteratorObject(), writable: true, enumerable: true, configurable: true });

  // document.elementFromPoint / elementsFromPoint
  docBinding.properties.set('elementFromPoint', {
    value: createNativeFunction('elementFromPoint', (_this, args) => {
      // In a real browser, this hits the layout engine; return null for now
      return null;
    }),
    writable: true, enumerable: true, configurable: true,
  });
  docBinding.properties.set('elementsFromPoint', {
    value: createNativeFunction('elementsFromPoint', () => createArray([])),
    writable: true, enumerable: true, configurable: true,
  });

  // Bind all Web APIs (crypto, BroadcastChannel, streams, WASM, WebGPU, WebXR, etc.)
  bindWebAPIs(env, docBinding);

  // Mirror every global binding onto `window` by the same reference, and
  // alias `self`/`globalThis` to it — in a real browser `window`, `self`,
  // and `globalThis` are the SAME object, and every global (Math, Array,
  // JSON, fetch, ...) is really just a property of it. Without this,
  // `window.Math === Math` is false (window was a bare object nothing ever
  // copied built-ins onto), which breaks the extremely common real-world
  // "find the true global object" feature-detection pattern countless
  // libraries use — e.g. `[globalThis, window, self, global].find(c => c
  // && c.Math === Math) || throw Error('Cannot find global object')`. Runs
  // last, once every global this function sets up actually exists.
  for (const [name, binding] of env.getBindings()) {
    if (!windowObj.properties.has(name)) {
      windowObj.properties.set(name, { value: binding.value, writable: true, enumerable: true, configurable: true });
    }
  }
  env.setLocal('self', windowObj);
  env.setLocal('globalThis', windowObj);

  // Link the global scope to `window` itself — in a real browser the global
  // object IS the global environment record, so a top-level `var`/function
  // declaration becomes a `window` property, and `window.foo = ...` is
  // immediately visible to a bare `foo` reference. Without this, Nova's
  // global `Environment` and `windowObj` are two independently-updated
  // stores that only agreed at setup time, breaking extremely common
  // real-world code (e.g. YouTube's `var ytcfg = {...}; window.ytcfg.set(...)`
  // in the very next statement).
  env.linkWindow(windowObj);

  return env;
}
