import type { DomDocument } from '../rendering/dom-tree';
import type { IDomTree, DomElement } from '../rendering/dom-tree';
import type { INavigationController } from '../navigation/navigation-controller';
import { Lexer } from './lexer';
import { Parser } from './parser';
import { Interpreter } from './interpreter';
import { createDocumentBinding, wrapElement } from './dom-bindings';
import type { IHtmlParser, HtmlDocument } from '../rendering/html-parser';
import { createHistoryBinding, createLocationBinding, wireHistoryEvents, bindWindowEvents } from './history-bindings';
import { EventLoop, bindTimers, bindQueueMicrotask } from './event-loop';
import { createPromiseConstructor } from './promise';
import { createObject, createArray, createNativeFunction, Environment, toNumber, toString, toBoolean, callJSFunction, type JSFunction } from './values';
import type { JSValue, JSObject } from './values';
import { IntersectionObserver } from '../rendering/intersection-observer';
import {
  createHeadersClass, createResponseClass, createRequestClass,
  createAbortControllerClass, createFetchFn,
} from './fetch-api';
import { createXMLHttpRequestClass } from './xhr';
import { createWebSocketClass } from './websocket-api';
import { createWorkerConstructor } from './worker';
import { createTypedArrayConstructors } from './typed-arrays';
import { bindStorageAPIs } from './web-storage-bindings';
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
export { createWebSocketClass, setPlatformWebSocketFactory } from './websocket-api';

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
  env.setLocal('Object', objectCtorObj);

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
    const sym = createObject(symbolProto);
    (sym as any).__type_override = 'symbol';
    (sym as any).symbolId = id;
    (sym as any).symbolDescription = desc;
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
      const sym = createObject(symbolProto);
      (sym as any).__type_override = 'symbol';
      (sym as any).symbolId = id;
      (sym as any).symbolDescription = key;
      symbolObjectCache.set(key, sym);
      return sym;
    }),
    writable: true, enumerable: false, configurable: true,
  });
  symbolCtorObj.properties.set('keyFor', {
    value: createNativeFunction('keyFor', (_this, args) => {
      const sym = args[0];
      if (typeof sym === 'object' && sym !== null && (sym as any).__type_override === 'symbol') {
        const id = (sym as any).symbolId;
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
    const sym = createObject(symbolProto);
    (sym as any).__type_override = 'symbol';
    (sym as any).symbolId = id;
    (sym as any).symbolDescription = name;
    symbolCtorObj.properties.set(name, { value: sym, writable: false, enumerable: false, configurable: false });
  }

  // Date constructor
  const dateProto = createObject(null);
  const dateCtor = createNativeFunction('Date', (_this, args) => {
    const dateObj = createObject(dateProto);
    (dateObj as any).__type_override = 'date';
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
    (dateObj as any).nativeDate = nativeDate;
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
        if (typeof _this !== 'object' || _this === null || !(_this as any).nativeDate) return NaN;
        const d = (_this as any).nativeDate as Date;
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
    const reObj = createObject(regExpProto);
    (reObj as any).__type_override = 'regexp';
    (reObj as any).nativeRegExp = re;
    return reObj;
  });
  const regExpCtorObj = createObject(null);
  regExpCtorObj.type = 'function';
  regExpCtorObj.callable = true;
  regExpCtorObj.nativeFn = regExpCtor.nativeFn;
  for (const method of ['exec', 'test', 'toString']) {
    regExpProto.properties.set(method, {
      value: createNativeFunction(method, (_this, args) => {
        if (typeof _this !== 'object' || _this === null || !(_this as any).nativeRegExp) return null;
        const re = (_this as any).nativeRegExp as RegExp;
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

  // Map constructor
  const mapProto = createObject(null);

  // Helper: resolve key for Map — objects use identity, primitives use string
  function mapResolveKey(args: JSValue[]): { isObj: boolean; objKey?: JSObject; primKey?: string } {
    const k = args[0];
    if (typeof k === 'object' && k !== null) return { isObj: true, objKey: k as JSObject };
    return { isObj: false, primKey: toString(k) };
  }
  function mapGetStore(m: JSObject) {
    if (!(m as any).__mapObj) (m as any).__mapObj = new Map<JSObject, JSValue>();
    if (!(m as any).__mapPrim) (m as any).__mapPrim = new Map<string, JSValue>();
    return { obj: (m as any).__mapObj as Map<JSObject, JSValue>, prim: (m as any).__mapPrim as Map<string, JSValue> };
  }

  mapProto.properties.set('get', {
    value: createNativeFunction('get', (_this, args) => {
      if (typeof _this !== 'object' || _this === null || !((_this as any).__mapObj || (_this as any).__mapPrim)) return undefined;
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
      if (typeof _this !== 'object' || _this === null || !((_this as any).__mapObj || (_this as any).__mapPrim)) return false;
      const s = mapGetStore(_this as JSObject);
      const k = mapResolveKey(args);
      return k.isObj ? s.obj.has(k.objKey!) : s.prim.has(k.primKey!);
    }),
    writable: true, enumerable: false, configurable: true,
  });
  mapProto.properties.set('delete', {
    value: createNativeFunction('delete', (_this, args) => {
      if (typeof _this !== 'object' || _this === null || !((_this as any).__mapObj || (_this as any).__mapPrim)) return false;
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
    value: undefined as any,
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
      if (typeof fn !== 'object' || fn === null || (fn as any).type !== 'closure') return undefined;
      const s = mapGetStore(_this as JSObject);
      for (const [k, v] of s.obj) callJSFunction(fn as any, _this, [v, k, _this]);
      for (const [k, v] of s.prim) callJSFunction(fn as any, _this, [v, k, _this]);
      return undefined;
    }),
    writable: true, enumerable: false, configurable: true,
  });
  mapProto.properties.set('toString', {
    value: createNativeFunction('toString', (_this) => '[object Map]'),
    writable: true, enumerable: false, configurable: true,
  });
  const mapCtor = createNativeFunction('Map', (_this, args) => {
    const mapObj = createObject(mapProto);
    (mapObj as any).__type_override = 'map';
    (mapObj as any).__mapObj = new Map<JSObject, JSValue>();
    (mapObj as any).__mapPrim = new Map<string, JSValue>();
    const iterable = args[0];
    if (typeof iterable === 'object' && iterable !== null && (iterable as any).type === 'array') {
      const len = Number((iterable as any).properties.get('length')?.value ?? 0);
      for (let i = 0; i < len; i++) {
        const entry = (iterable as any).properties.get(String(i))?.value;
        if (typeof entry === 'object' && entry !== null && (entry as any).type === 'array') {
          const key = (entry as any).properties.get('0')?.value;
          const val = (entry as any).properties.get('1')?.value;
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
    if (!(s as any).__setObj) (s as any).__setObj = new Set<JSObject>();
    if (!(s as any).__setPrim) (s as any).__setPrim = new Set<string>();
    return { obj: (s as any).__setObj as Set<JSObject>, prim: (s as any).__setPrim as Set<string> };
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
    value: undefined as any,
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
        return (setValuesFn as any).nativeFn(_this, []);
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
      if (typeof fn !== 'object' || fn === null || (fn as any).type !== 'closure') return undefined;
      const s = setGetStore(_this as JSObject);
      for (const v of s.obj) callJSFunction(fn as any, _this, [v, v, _this]);
      for (const v of s.prim) {
        let parsed: JSValue = v;
        if (v === 'undefined') parsed = undefined;
        else if (v === 'null') parsed = null;
        else if (v === 'NaN') parsed = NaN;
        else if (v === 'true') parsed = true;
        else if (v === 'false') parsed = false;
        else if (/^-?\d+(\.\d+)?$/.test(v)) parsed = Number(v);
        callJSFunction(fn as any, _this, [parsed, parsed, _this]);
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
    if (typeof iterable === 'object' && iterable !== null && (iterable as any).type === 'array') {
      const len = Number((iterable as any).properties.get('length')?.value ?? 0);
      for (let i = 0; i < len; i++) {
        const val = (iterable as any).properties.get(String(i))?.value;
        const k = setResolveKey([val]);
        if (k.isObj) s.obj.add(k.objKey!); else s.prim.add(k.primKey!);
      }
    }
  }
  function setCreateFromValues(proto: JSObject, vals: JSValue[]): JSObject {
    const obj = createObject(proto);
    (obj as any).__type_override = 'set';
    (obj as any).__setObj = new Set<JSObject>();
    (obj as any).__setPrim = new Set<string>();
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
        if (typeof otherRaw === 'object' && otherRaw !== null && (otherRaw as any).type === 'array') {
          const len = Number((otherRaw as any).properties.get('length')?.value ?? 0);
          for (let i = 0; i < len; i++) otherArr.push((otherRaw as any).properties.get(String(i))?.value);
        } else if (typeof otherRaw === 'object' && otherRaw !== null && (otherRaw as any).__setObj) {
          otherArr.push(...setToArray(otherRaw as JSObject));
        }
        const thisArr = setToArray(_this as JSObject);
        let result: JSValue[];
        if (method === 'intersection') {
          result = thisArr.filter(v => {
            const k = setResolveKey([v]);
            const s = typeof otherRaw === 'object' && otherRaw !== null && (otherRaw as any).__setObj ? setGetStore(otherRaw as JSObject) : null;
            if (s) return k.isObj ? s.obj.has(k.objKey!) : s.prim.has(k.primKey!);
            return otherArr.some(o => toString(o) === toString(v));
          });
        } else if (method === 'difference') {
          result = thisArr.filter(v => {
            const k = setResolveKey([v]);
            const s = typeof otherRaw === 'object' && otherRaw !== null && (otherRaw as any).__setObj ? setGetStore(otherRaw as JSObject) : null;
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
            if (typeof otherRaw === 'object' && otherRaw !== null && (otherRaw as any).__setObj) {
              const k = setResolveKey([v]);
              const s = setGetStore(otherRaw as JSObject);
              return k.isObj ? s.obj.has(k.objKey!) : s.prim.has(k.primKey!);
            }
            return false;
          });
        } else if (method === 'isSupersetOf') {
          if (typeof otherRaw === 'object' && otherRaw !== null && (otherRaw as any).__setObj) {
            const otherArr = setToArray(otherRaw as JSObject);
            return otherArr.every(v => {
              const k = setResolveKey([v]);
              const s = setGetStore(_this as JSObject);
              return k.isObj ? s.obj.has(k.objKey!) : s.prim.has(k.primKey!);
            });
          }
          return false;
        } else {
          if (typeof otherRaw === 'object' && otherRaw !== null && (otherRaw as any).__setObj) {
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
    const setObj = createObject(setProto);
    (setObj as any).__type_override = 'set';
    (setObj as any).__setObj = new Set<JSObject>();
    (setObj as any).__setPrim = new Set<string>();
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
      if (typeof _this !== 'object' || _this === null || !(_this as any).__weakMapEntries) return undefined;
      const entries = (_this as any).__weakMapEntries as Map<JSObject, JSValue>;
      const k = args[0];
      if (typeof k === 'object' && k !== null) return entries.get(k as JSObject);
      return undefined;
    }),
    writable: true, enumerable: false, configurable: true,
  });
  weakMapProto.properties.set('set', {
    value: createNativeFunction('set', (_this, args) => {
      if (typeof _this !== 'object' || _this === null) return _this;
      if (!(_this as any).__weakMapEntries) (_this as any).__weakMapEntries = new Map<JSObject, JSValue>();
      const k = args[0];
      if (typeof k === 'object' && k !== null) (_this as any).__weakMapEntries.set(k as JSObject, args[1]);
      return _this;
    }),
    writable: true, enumerable: false, configurable: true,
  });
  weakMapProto.properties.set('has', {
    value: createNativeFunction('has', (_this, args) => {
      if (typeof _this !== 'object' || _this === null || !(_this as any).__weakMapEntries) return false;
      const k = args[0];
      if (typeof k === 'object' && k !== null) return (_this as any).__weakMapEntries.has(k as JSObject);
      return false;
    }),
    writable: true, enumerable: false, configurable: true,
  });
  weakMapProto.properties.set('delete', {
    value: createNativeFunction('delete', (_this, args) => {
      if (typeof _this !== 'object' || _this === null || !(_this as any).__weakMapEntries) return false;
      const k = args[0];
      if (typeof k === 'object' && k !== null) return (_this as any).__weakMapEntries.delete(k as JSObject);
      return false;
    }),
    writable: true, enumerable: false, configurable: true,
  });
  const weakMapCtor = createNativeFunction('WeakMap', (_this, args) => {
    const wmObj = createObject(weakMapProto);
    (wmObj as any).__type_override = 'weakmap';
    (wmObj as any).__weakMapEntries = new Map<JSObject, JSValue>();
    const iterable = args[0];
    if (typeof iterable === 'object' && iterable !== null && (iterable as any).type === 'array') {
      const len = Number((iterable as any).properties.get('length')?.value ?? 0);
      for (let i = 0; i < len; i++) {
        const entry = (iterable as any).properties.get(String(i))?.value;
        if (typeof entry === 'object' && entry !== null && (entry as any).type === 'array') {
          const key = (entry as any).properties.get('0')?.value;
          const val = (entry as any).properties.get('1')?.value;
          if (typeof key === 'object' && key !== null) (wmObj as any).__weakMapEntries.set(key as JSObject, val);
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
      if (!(_this as any).__weakSetEntries) (_this as any).__weakSetEntries = new Set<JSObject>();
      const k = args[0];
      if (typeof k === 'object' && k !== null) (_this as any).__weakSetEntries.add(k as JSObject);
      return _this;
    }),
    writable: true, enumerable: false, configurable: true,
  });
  weakSetProto.properties.set('has', {
    value: createNativeFunction('has', (_this, args) => {
      if (typeof _this !== 'object' || _this === null || !(_this as any).__weakSetEntries) return false;
      const k = args[0];
      if (typeof k === 'object' && k !== null) return (_this as any).__weakSetEntries.has(k as JSObject);
      return false;
    }),
    writable: true, enumerable: false, configurable: true,
  });
  weakSetProto.properties.set('delete', {
    value: createNativeFunction('delete', (_this, args) => {
      if (typeof _this !== 'object' || _this === null || !(_this as any).__weakSetEntries) return false;
      const k = args[0];
      if (typeof k === 'object' && k !== null) return (_this as any).__weakSetEntries.delete(k as JSObject);
      return false;
    }),
    writable: true, enumerable: false, configurable: true,
  });
  const weakSetCtor = createNativeFunction('WeakSet', (_this) => {
    const wsObj = createObject(weakSetProto);
    (wsObj as any).__type_override = 'weakset';
    (wsObj as any).__weakSetEntries = new Set<JSObject>();
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
        const mapFn = args[1] as any;
        if (typeof source !== 'object' || source === null) return createArray([]);
        const srcObj = source as JSObject;
        if (srcObj.type === 'array') {
          const len = Number(srcObj.properties.get('length')?.value ?? 0);
          const result: JSValue[] = [];
          for (let i = 0; i < len; i++) {
            let val = srcObj.properties.get(String(i))?.value;
            if (typeof mapFn === 'object' && mapFn !== null && mapFn.type === 'closure') {
              val = callJSFunction(mapFn, undefined, [val, i]);
            }
            result.push(val);
          }
          return createArray(result);
        }
        return createArray([]);
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
      if (typeof callback !== 'object' || callback === null || (callback as any).type !== 'closure') return createArray([]);
      const obj = _this as JSObject;
      const len = Number(obj.properties.get('length')?.value ?? 0);
      const result: JSValue[] = [];
      for (let i = 0; i < len; i++) {
        const val = obj.properties.get(String(i))?.value;
        result.push(callJSFunction(callback as any, undefined, [val, i, _this]));
      }
      return createArray(result);
    },
    filter: (_this, callback) => {
      if (typeof _this !== 'object' || _this === null) return createArray([]);
      if (typeof callback !== 'object' || callback === null || (callback as any).type !== 'closure') return createArray([]);
      const obj = _this as JSObject;
      const len = Number(obj.properties.get('length')?.value ?? 0);
      const result: JSValue[] = [];
      for (let i = 0; i < len; i++) {
        const val = obj.properties.get(String(i))?.value;
        if (callJSFunction(callback as any, undefined, [val, i, _this])) result.push(val);
      }
      return createArray(result);
    },
    reduce: (_this, callback, initialValue) => {
      if (typeof _this !== 'object' || _this === null) return undefined;
      if (typeof callback !== 'object' || callback === null || (callback as any).type !== 'closure') return undefined;
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
        acc = callJSFunction(callback as any, undefined, [acc, val, i, _this]);
      }
      return acc;
    },
    find: (_this, callback) => {
      if (typeof _this !== 'object' || _this === null) return undefined;
      if (typeof callback !== 'object' || callback === null || (callback as any).type !== 'closure') return undefined;
      const obj = _this as JSObject;
      const len = Number(obj.properties.get('length')?.value ?? 0);
      for (let i = 0; i < len; i++) {
        const val = obj.properties.get(String(i))?.value;
        if (callJSFunction(callback as any, undefined, [val, i, _this])) return val;
      }
      return undefined;
    },
    findIndex: (_this, callback) => {
      if (typeof _this !== 'object' || _this === null) return -1;
      if (typeof callback !== 'object' || callback === null || (callback as any).type !== 'closure') return -1;
      const obj = _this as JSObject;
      const len = Number(obj.properties.get('length')?.value ?? 0);
      for (let i = 0; i < len; i++) {
        const val = obj.properties.get(String(i))?.value;
        if (callJSFunction(callback as any, undefined, [val, i, _this])) return i;
      }
      return -1;
    },
    some: (_this, callback) => {
      if (typeof _this !== 'object' || _this === null) return false;
      if (typeof callback !== 'object' || callback === null || (callback as any).type !== 'closure') return false;
      const obj = _this as JSObject;
      const len = Number(obj.properties.get('length')?.value ?? 0);
      for (let i = 0; i < len; i++) {
        const val = obj.properties.get(String(i))?.value;
        if (callJSFunction(callback as any, undefined, [val, i, _this])) return true;
      }
      return false;
    },
    every: (_this, callback) => {
      if (typeof _this !== 'object' || _this === null) return true;
      if (typeof callback !== 'object' || callback === null || (callback as any).type !== 'closure') return true;
      const obj = _this as JSObject;
      const len = Number(obj.properties.get('length')?.value ?? 0);
      for (let i = 0; i < len; i++) {
        const val = obj.properties.get(String(i))?.value;
        if (!callJSFunction(callback as any, undefined, [val, i, _this])) return false;
      }
      return true;
    },
    forEach: (_this, callback) => {
      if (typeof _this !== 'object' || _this === null) return undefined;
      if (typeof callback !== 'object' || callback === null || (callback as any).type !== 'closure') return undefined;
      const obj = _this as JSObject;
      const len = Number(obj.properties.get('length')?.value ?? 0);
      for (let i = 0; i < len; i++) {
        const val = obj.properties.get(String(i))?.value;
        callJSFunction(callback as any, undefined, [val, i, _this]);
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
        if (compareFn !== undefined && typeof compareFn === 'object' && compareFn !== null && (compareFn as any).type === 'closure') {
          const result = toNumber(callJSFunction(compareFn as any, undefined, [a[1], b[1]]));
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
      value: createNativeFunction(name, fn as any),
      writable: true, enumerable: false, configurable: true,
    });
  }
  arrayProto.properties.set('length', { value: 0, writable: true, enumerable: false, configurable: true });
  arrayProto.properties.set(Symbol.for('iterator') as any, {
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

  // XMLHttpRequest
  env.setLocal('XMLHttpRequest', createXMLHttpRequestClass(eventLoop));

  // WebSocket
  env.setLocal('WebSocket', createWebSocketClass(eventLoop, resourceEnforcer, pageOrigin));

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

  // ArrayBuffer, TypedArray, DataView, SharedArrayBuffer, Atomics, WeakRef, FinalizationRegistry
  const typedArrayCtors = createTypedArrayConstructors();
  for (const [name, ctorObj] of Object.entries(typedArrayCtors)) {
    env.setLocal(name, ctorObj);
  }

  // Storage APIs (localStorage, sessionStorage, indexedDB)
  bindStorageAPIs(env, { origin: pageOrigin ?? 'https://localhost', diskPath: storageDir });

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

  return env;
}
