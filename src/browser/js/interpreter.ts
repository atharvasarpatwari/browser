import type * as AST from './ast';
import {
  Environment,
  type JSValue, type JSObject, type JSFunction, type NativeFunction,
  toBoolean, toNumber, toString, toPrimitive, iterateJS, ITERATOR_KEY, getType, instanceofCheck,
  createObject, createArray, createFunction, createNativeFunction,
  isBreakSignal, isContinueSignal, isReturnSignal, isThrowSignal, isAwaitSignal,
  type BreakSignal, type ContinueSignal, type ReturnSignal, type ThrowSignal, type AwaitSignal,
  setGlobalCaller, callJSFunction, JSError, functionPrototypeObject, objectPrototypeMember, constructorPrototype,
} from './values';
import { GarbageCollector, getGC } from './gc';
import { createPromiseConstructor, wrapAsyncResult, isPromiseObject, isPromiseFulfilled, isPromiseRejected, isPromisePending, getPromiseResult, createPromiseObj, fulfillPromise, rejectPromise, resolvePromise } from './promise';
import type { EventLoop } from './event-loop';
import { bindQueueMicrotask, bindTimers } from './event-loop';
import { Lexer } from './lexer';
import { Parser } from './parser';
import type { BytecodeFunction } from './bytecode';
import { BytecodeVM } from './vm';
import { BytecodeCompiler } from './bytecode-compiler';
import type { CspScriptEnforcer } from '../security/csp-script-enforcer';

// ─────────────────────────────────────────────────────────────────────────────
// INTERPRETER — Tree-walking evaluator
// ─────────────────────────────────────────────────────────────────────────────

/**
 * A string method's pattern argument: the native RegExp behind a regex object, else the
 * argument as a string. split/replace/match/search used to stringify regex objects, so
 * "a-b".split(/-/) or s.replace(/x/g, …) searched for the literal text "/-/".
 */
function patternArg(v: JSValue): RegExp | string {
  const re = (v as { nativeRegExp?: unknown } | null | undefined)?.nativeRegExp;
  return re instanceof RegExp ? re : toString(v);
}

function regexArg(v: JSValue): RegExp {
  const p = patternArg(v);
  return p instanceof RegExp ? p : new RegExp(p);
}

/** A JS value as a plain host value (objects one level deep: Intl/locale options, locale lists). */
export function jsToPlain(v: JSValue): unknown {
  if (v === undefined || v === null || typeof v !== 'object') return v === null ? undefined : v;
  const o = v as JSObject;
  if (o.type === 'array') {
    const len = Number(o.properties.get('length')?.value ?? 0);
    return Array.from({ length: len }, (_x, i) => jsToPlain(o.properties.get(String(i))?.value as JSValue));
  }
  const out: Record<string, unknown> = {};
  for (const [k, d] of o.properties) {
    const val = d.value;
    if (val === undefined || (typeof val === 'object' && val !== null && (val as { type?: string }).type !== 'array')) continue;
    out[k] = typeof val === 'object' && val !== null ? jsToPlain(val) : val;
  }
  return out;
}

/** A plain host object of strings/numbers as a JS object. */
export function plainToJS(o: Record<string, unknown>): JSObject {
  const r = createObject(null);
  for (const [k, v] of Object.entries(o)) r.properties.set(k, { value: (v === undefined ? undefined : v) as JSValue, writable: true, enumerable: true, configurable: true });
  return r;
}

/** String.prototype.replace, including a regex pattern and a replacer function. */
function stringReplace(str: string, pattern: JSValue, replacement: JSValue): string {
  const pat = patternArg(pattern);
  const fn = replacement as { type?: string } | null;
  if (fn && typeof fn === 'object' && (fn.type === 'closure' || fn.type === 'function')) {
    return str.replace(pat as string, (...args: unknown[]) => {
      // (match, ...groups, offset, input): pass them through like a browser does
      return toString(callJSFunction(replacement as JSFunction, undefined, args.map((x) => x as JSValue)));
    });
  }
  return str.replace(pat as string, toString(replacement ?? ''));
}

/** String.prototype methods bound to one string value (shared by member reads and String.prototype). */
export function stringMethods(obj: string): Record<string, NativeFunction> {
  return {
    toUpperCase: (_t, _a) => (obj as string).toUpperCase(),
    toLowerCase: (_t, _a) => (obj as string).toLowerCase(),
    charAt: (_t, a) => (obj as string).charAt(toNumber(a[0])),
    charCodeAt: (_t, a) => (obj as string).charCodeAt(toNumber(a[0])),
    indexOf: (_t, a) => (obj as string).indexOf(toString(a[0])),
    lastIndexOf: (_t, a) => (obj as string).lastIndexOf(toString(a[0])),
    slice: (_t, a) => (obj as string).slice(toNumber(a[0]), a[1] !== undefined ? toNumber(a[1]) : undefined),
    substring: (_t, a) => (obj as string).substring(toNumber(a[0]), a[1] !== undefined ? toNumber(a[1]) : undefined),
    substr: (_t, a) => (obj as string).substr(toNumber(a[0]), a[1] !== undefined ? toNumber(a[1]) : undefined),
    split: (_t, a) => {
      const sep = a[0] !== undefined ? patternArg(a[0]) : undefined;
      const limit = a[1] !== undefined ? toNumber(a[1]) >>> 0 : undefined;
      const parts = sep !== undefined ? (obj as string).split(sep as string, limit) : [obj as string].slice(0, limit);
      return createArray(parts.map(p => p as unknown as JSValue));
    },
    replace: (_t, a) => stringReplace(obj as string, a[0], a[1]),
    trim: (_t, _a) => (obj as string).trim(),
    trimStart: (_t, _a) => (obj as string).trimStart(),
    trimEnd: (_t, _a) => (obj as string).trimEnd(),
    includes: (_t, a) => (obj as string).includes(toString(a[0])),
    startsWith: (_t, a) => (obj as string).startsWith(toString(a[0])),
    endsWith: (_t, a) => (obj as string).endsWith(toString(a[0])),
    repeat: (_t, a) => (obj as string).repeat(toNumber(a[0])),
    concat: (_t, a) => (obj as string).concat(a.map(toString).join('')),
    padStart: (_t, a) => (obj as string).padStart(toNumber(a[0]), toString(a[1] ?? ' ')),
    padEnd: (_t, a) => (obj as string).padEnd(toNumber(a[0]), toString(a[1] ?? ' ')),
    match: (_t, a) => {
      const re = regexArg(a[0]);
      const m = (obj as string).match(re);
      if (!m) return null;
      const result = createArray(m.map(v => (v === undefined ? null : v) as unknown as JSValue));
      if (!re.global) {
        // Like exec(): index, input, groups. `str.match(/(?<y>\d+)/).groups.y` read undefined.
        result.properties.set('index', { value: m.index ?? 0, writable: true, enumerable: true, configurable: true });
        result.properties.set('input', { value: obj, writable: true, enumerable: true, configurable: true });
        result.properties.set('groups', { value: m.groups ? plainToJS(m.groups) : undefined, writable: true, enumerable: true, configurable: true });
      }
      return result;
    },
    matchAll: (_t, a) => {
      const re = regexArg(a[0]);
      const all = [...(obj as string).matchAll(re.global ? re : new RegExp(re.source, re.flags + 'g'))];
      return createArray(all.map((m) => {
        const r = createArray(m.map(v => (v === undefined ? null : v) as unknown as JSValue));
        r.properties.set('index', { value: m.index ?? 0, writable: true, enumerable: true, configurable: true });
        r.properties.set('groups', { value: m.groups ? plainToJS(m.groups) : undefined, writable: true, enumerable: true, configurable: true });
        return r as unknown as JSValue;
      }));
    },
    // ES2021–2022 string methods sites use (they were "not a function")
    replaceAll: (_t, a) => {
      const p = patternArg(a[0]);
      if (p instanceof RegExp) return stringReplace(obj as string, a[0], a[1]);
      return (obj as string).split(p).join(typeof a[1] === 'object' && a[1] !== null ? '' : toString(a[1]));
    },
    at: (_t, a) => { const s = obj as string; const i = Math.trunc(toNumber(a[0] ?? 0)); return s.charAt(i < 0 ? s.length + i : i) || undefined; },
    codePointAt: (_t, a) => (obj as string).codePointAt(toNumber(a[0] ?? 0)),
    normalize: (_t, a) => (obj as string).normalize(a[0] === undefined ? undefined : toString(a[0]) as 'NFC'),
    localeCompare: (_t, a) => (obj as string).localeCompare(toString(a[0]), a[1] === undefined ? undefined : toString(a[1]) as string, jsToPlain(a[2]) as Intl.CollatorOptions),
    search: (_t, a) => (obj as string).search(regexArg(a[0])),
    valueOf: (_t: JSValue, _a: JSValue[]) => obj,
    toString: (_t: JSValue, _a: JSValue[]) => obj,
  };
}

/**
 * Relational comparison (§7.2.13): ToPrimitive(number) both sides, then compare as strings when both
 * are strings, else as numbers. Raw host `<` on engine objects was always false (`{valueOf} > 3`).
 */
function compare(left: JSValue, right: JSValue, op: (a: number | string, b: number | string) => boolean): boolean {
  const l = toPrimitive(left, 'number');
  const r = toPrimitive(right, 'number');
  if (typeof l === 'string' && typeof r === 'string') return op(l, r);
  return op(toNumber(l), toNumber(r));
}

type ClassField = { key: string; init: AST.Expression | null };
type ClassWithFields = JSObject & { __fields?: ClassField[]; __fieldEnv?: Environment };

/** createFunction with the parameter patterns kept when they are more than plain names. */
function makeFunction(name: string, params: AST.FunctionExpression['params'], body: unknown, env: Environment, async: boolean, isArrow: boolean, generator: boolean, strict?: boolean): JSFunction {
  const simple = params.every((p) => p.type === 'Identifier');
  // Placeholder names keep params.length and strict-mode duplicate checks meaningful.
  const names = params.map((p, i) => (p.type === 'Identifier' ? p.name : `\u0000param${i}`));
  const fn = createFunction(name, names, body, env, async, isArrow, generator, false, undefined, strict);
  if (!simple) fn.paramPatterns = params;
  return fn;
}

function forInKeys(obj: JSValue): string[] {
  const keys: string[] = [];
  if (typeof obj === 'string') for (let i = 0; i < obj.length; i++) keys.push(String(i));
  const seen = new Set<string>();
  for (let p: JSObject | null = typeof obj === 'object' ? obj as JSObject : null, d = 0; p && d < 64; p = p.prototype, d++) {
    for (const [k, desc] of p.properties ?? []) {
      if (seen.has(k)) continue;
      seen.add(k);
      if (desc.enumerable !== false && typeof k === 'string' && !k.startsWith('Symbol(')) keys.push(k);
    }
  }
  return keys;
}

// ── Resumable execution (async functions and generators) ───────────────────

/** What a suspended body hands its driver: a value to await, or a value to yield. */
type Suspend = { kind: 'await' | 'yield'; value: JSValue };
type Completion = JSValue | BreakSignal | ContinueSignal | ReturnSignal | ThrowSignal;
type Resumable<T> = Generator<Suspend, T, JSValue>;

const OPAQUE_NODES = new Set(['FunctionExpression', 'FunctionDeclaration', 'ArrowFunctionExpression', 'ClassDeclaration', 'ClassExpression', '__NovaValue']);
const suspendCache = new WeakMap<object, boolean>();

/** Does this node contain an await/yield of the current function (nested functions don't count)? */
function hasSuspend(node: unknown): boolean {
  if (!node || typeof node !== 'object') return false;
  const cached = suspendCache.get(node as object);
  if (cached !== undefined) return cached;
  const n = node as Record<string, unknown>;
  let found = n.type === 'AwaitExpression' || n.type === 'YieldExpression';
  if (!found && !OPAQUE_NODES.has(n.type as string)) {
    for (const k in n) {
      if (k === 'loc' || k === '__labels') continue;
      const v = n[k];
      found = Array.isArray(v) ? v.some(hasSuspend) : (!!v && typeof v === 'object' && hasSuspend(v));
      if (found) break;
    }
  }
  suspendCache.set(node as object, found);
  return found;
}

type Slot = { node: AST.Node; set: (v: AST.Node) => void };
/**
 * A shallow copy of `expr` (copying containers along the way) with its operand slots, in
 * evaluation order, so operands can be evaluated one by one and substituted with their values.
 */
function cloneWithSlots(expr: AST.Expression): { clone: AST.Expression; slots: Slot[] } {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const c: any = { ...expr };
  const slots: Slot[] = [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const slot = (holder: any, key: string | number) => { if (holder[key]) slots.push({ node: holder[key], set: (v) => { holder[key] = v; } }); };
  const listSlots = (key: string) => {
    c[key] = [...c[key]];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    c[key].forEach((el: any, i: number) => {
      if (!el) return;
      if (el.type === 'SpreadElement') { c[key][i] = { ...el }; slot(c[key][i], 'argument'); } else slot(c[key], i);
    });
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const memberSlots = (holder: any, key: string) => {
    holder[key] = { ...holder[key] };
    if (holder[key].object.type !== 'SuperExpression') slot(holder[key], 'object');
    if (holder[key].computed) slot(holder[key], 'property');
  };
  switch (c.type) {
    case 'BinaryExpression': slot(c, 'left'); slot(c, 'right'); break;
    case 'AssignmentExpression': if (c.left.type === 'MemberExpression') memberSlots(c, 'left'); slot(c, 'right'); break;
    case 'UnaryExpression': if (c.operator !== 'delete') slot(c, 'argument'); break;
    case 'UpdateExpression': if (c.argument.type === 'MemberExpression') memberSlots(c, 'argument'); break;
    case 'MemberExpression': slot(c, 'object'); if (c.computed) slot(c, 'property'); break;
    case 'CallExpression':
    case 'NewExpression':
      if (c.type === 'CallExpression' && c.callee.type === 'MemberExpression') memberSlots(c, 'callee');
      else if (c.callee.type !== 'Identifier' && c.callee.type !== 'SuperExpression') slot(c, 'callee');
      listSlots('arguments');
      break;
    case 'ArrayExpression': listSlots('elements'); break;
    case 'TemplateLiteral': listSlots('expressions'); break;
    case 'TaggedTemplateExpression': c.quasi = { ...c.quasi }; c.quasi.expressions = [...c.quasi.expressions]; c.quasi.expressions.forEach((_e: unknown, i: number) => slot(c.quasi.expressions, i)); break;
    case 'SpreadElement': slot(c, 'argument'); break;
    case 'ObjectExpression':
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      c.properties = c.properties.map((p: any) => ({ ...p }));
      for (const p of c.properties) {
        if (p.type === 'SpreadElement') { slot(p, 'argument'); continue; }
        if (p.computed) slot(p, 'key');
        if ((!p.kind || p.kind === 'init') && !p.method) slot(p, 'value');
      }
      break;
  }
  return { clone: c, slots };
}

const valueNode = (value: JSValue): AST.Node => ({ type: '__NovaValue', value } as unknown as AST.Node);

/** `continue label` is for this loop when unlabeled or naming one of the loop's labels. */
function continuesHere(stmt: AST.Statement, sig: ContinueSignal): boolean {
  return !sig.label || ((stmt as { __labels?: string[] }).__labels?.includes(sig.label) ?? false);
}

/** Source-ish text for a callee in "x is not a function" (a, a.b, a[...]). */
function calleeText(e: AST.Expression | AST.Node): string {
  const n = e as AST.Expression;
  if (n.type === 'Identifier') return n.name;
  if (n.type === 'MemberExpression') {
    const obj = calleeText(n.object);
    if (!n.computed) return `${obj}.${(n.property as AST.Identifier).name}`;
    return `${obj}[...]`;
  }
  if (n.type === 'ThisExpression') return 'this';
  return 'expression';
}

/** Function.prototype.call/apply/bind for a value read off a function (they were undefined). */
export function functionMethod(fn: JSFunction, key: string): JSFunction | null {
  const own = (fn as unknown as JSObject).properties?.get(key);
  if (own) return null; // an own property wins
  if (key === 'call') return createNativeFunction('call', (_t, a) => callJSFunction(fn, a[0], a.slice(1)));
  if (key === 'apply') return createNativeFunction('apply', (_t, a) => {
    const list = a[1] && typeof a[1] === 'object' ? a[1] as JSObject : null;
    const len = Number(list?.properties?.get('length')?.value ?? 0);
    const args: JSValue[] = [];
    for (let i = 0; i < len; i++) args.push(list!.properties.get(String(i))?.value);
    return callJSFunction(fn, a[0], args);
  });
  if (key === 'bind') return createNativeFunction('bind', (_t, a) => {
    const boundThis = a[0];
    const bound = a.slice(1);
    return createNativeFunction(`bound ${fn.name}`, (_t2, rest) => callJSFunction(fn, boundThis, [...bound, ...rest]));
  });
  return null;
}

/**
 * A `{ ... }` block with let/const/class declarations gets its own scope: they were declared in the
 * enclosing one, so `{ let a = 2; }` overwrote an outer `a`. Blocks without them keep the enclosing
 * scope, so sloppy-mode function declarations in blocks stay visible outside (Annex B).
 */
function blockScope(body: AST.Statement[], env: Environment): Environment {
  const lexical = body.some((s) => (s.type === 'VariableDeclaration' && s.kind !== 'var') || s.type === 'ClassDeclaration');
  return lexical ? new Environment(env) : env;
}

/**
 * `==` (IsLooselyEqual, §7.2.14). The host's `==` compared Nova's object records, so an array or
 * object against a primitive was never equal (`[] == false`, `[1] == 1`, `{} == "[object Object]"`).
 */
function looseEquals(a: JSValue, b: JSValue): boolean {
  const isObj = (v: JSValue) => v !== null && typeof v === 'object';
  if (isObj(a) && isObj(b)) return a === b;
  if (a == null || b == null) return a == null && b == null; // eslint-disable-line eqeqeq
  if (typeof a === 'boolean') return looseEquals(Number(a), b);
  if (typeof b === 'boolean') return looseEquals(a, Number(b));
  // toPrimitive hands back the object when its valueOf/toString are host built-ins; then the
  // built-in string form ("[object Object]", "1,2") is the primitive.
  const prim = (v: JSValue) => { const p = toPrimitive(v, 'default'); return isObj(p) ? toString(p) : p; };
  if (isObj(a)) return looseEquals(prim(a), b);
  if (isObj(b)) return looseEquals(a, prim(b));
  return a == b; // eslint-disable-line eqeqeq -- both primitives now
}

export class Interpreter {
  private globalEnv: Environment;
  private eventLoop?: EventLoop;
  private output: string[] = [];
  private static readonly MAX_OUTPUT = 1000;
  private static readonly DEFAULT_MAX_EXECUTION_MS = 5000;
  private static readonly OPS_BETWEEN_CHECKS = 1000;
  private nextTimerId = 1;
  /** Pending timer callbacks keyed by ID for O(1) removal */
  private timers = new Map<number, { fn: () => void; delay: number; recurring: boolean }>();
  private executionStartTime = 0;
  private maxExecutionMs = Interpreter.DEFAULT_MAX_EXECUTION_MS;
  private opCount = 0;
  /** If true, compile and execute programs through the bytecode VM */
  private useVM = false;
  /** The bytecode compiler instance (shared across calls) */
  private compiler: BytecodeCompiler | null = null;
  /** Garbage collector instance */
  private gc: GarbageCollector;
  /** Optional CSP script enforcer for eval()/timer checks */
  private scriptEnforcer?: CspScriptEnforcer;
  /** Page origin for CSP enforcement */
  private pageOrigin?: string;

  constructor(globalEnv?: Environment, eventLoop?: EventLoop, scriptEnforcer?: CspScriptEnforcer, pageOrigin?: string) {
    this.gc = getGC();
    this.eventLoop = eventLoop;
    this.scriptEnforcer = scriptEnforcer;
    this.pageOrigin = pageOrigin;
    if (this.eventLoop) {
      this.eventLoop.setInterpreter(this);
    }
    this.globalEnv = globalEnv ?? this.createGlobalEnv();
    this.gc.setGlobalEnv(this.globalEnv);
  }

  /** Get the GC instance for external use */
  getGC(): GarbageCollector {
    return this.gc;
  }

  /** Enable or disable bytecode VM mode */
  setUseVM(enabled: boolean): void {
    this.useVM = enabled;
    if (enabled) {
      this.compiler = new BytecodeCompiler();
    }
  }

  /** Check if VM mode is enabled */
  isVMEnabled(): boolean {
    return this.useVM;
  }

  setMaxExecutionMs(ms: number): void {
    this.maxExecutionMs = ms;
  }

  private checkTimeout(): void {
    this.opCount++;
    if (this.opCount % Interpreter.OPS_BETWEEN_CHECKS !== 0) return;
    const elapsed = Date.now() - this.executionStartTime;
    if (elapsed > this.maxExecutionMs) {
      throw new JSError(`TimeoutError: Script execution timed out after ${this.maxExecutionMs}ms`);
    }
  }

  run(program: AST.Program): JSValue {
    this.executionStartTime = Date.now();
    this.opCount = 0;
    setGlobalCaller(this);
    try {
      // If VM mode is enabled, try compiling and running through bytecode VM
      if (this.useVM && this.compiler) {
        try {
          const bytecodeFn = this.compiler.compile(program);
          const vm = new BytecodeVM(this.globalEnv);
          vm.setMaxExecutionMs(this.maxExecutionMs);
          vm.setGCCallback(() => this.gc.collect());
          // Bridge: VM calls interpreter for AST-body functions
          vm.setCallInterpreter((fn, thisArg, args) => this.callFunction(fn, thisArg, args));
          const result = vm.run(bytecodeFn);
          if (!result.ok) {
            throw new JSError(result.error);
          }
          this.eventLoop?.drainMicrotasks();
          return result.value;
        } catch {
          // If VM fails, fall back to tree-walking interpreter
        }
      }
      const result = this.execBlock(program.body, this.globalEnv);
      if (isThrowSignal(result)) throw new JSError(result.value);
      // Drain microtasks after program execution
      this.eventLoop?.drainMicrotasks();
      return result as JSValue;
    } finally {
      setGlobalCaller(null);
    }
  }

  /** Called by callJSFunction in values.ts when non-native JS functions need invocation. */
  callFunction(fn: JSFunction, thisArg: JSValue, args: JSValue[]): JSValue {
    if (fn.isNative && fn.nativeFn) {
      try {
        const result = fn.nativeFn(thisArg, args) as JSValue;
        if (fn.async && this.eventLoop) return wrapAsyncResult(result, this.eventLoop);
        return result;
      } catch (err) {
        if (err instanceof JSError) throw err;
        throw new JSError(err instanceof Error ? err.message : String(err));
      }
    }
    // Bytecode function — use VM if enabled
    if (fn.isBytecode && fn.body && typeof fn.body === 'object' && 'bytecode' in fn.body) {
      const bytecodeFn = fn.body as BytecodeFunction;
      const vm = new BytecodeVM(fn.closure);
      vm.setMaxExecutionMs(this.maxExecutionMs);
      vm.setGCCallback(() => this.gc.collect());
      vm.setCallInterpreter((innerFn, innerThisArg, innerArgs) => this.callFunction(innerFn, innerThisArg, innerArgs));
      if (fn.async && this.eventLoop) {
        vm.setEventLoop(this.eventLoop);
      }
      const result = vm.run(bytecodeFn, thisArg, args, fn.upvalues);
      if (!result.ok) {
        throw new JSError(result.error);
      }
      if (fn.async && this.eventLoop) return wrapAsyncResult(result.value, this.eventLoop);
      return result.value;
    }
    return this.invokeClosure(fn, thisArg, args);
  }

  /**
   * Call a JS (non-native) function: one place for both call paths. Sets `this` (lexical for
   * arrows) before the parameters, so defaults can use it; async and generator functions go to
   * their resumable drivers.
   */
  private invokeClosure(fn: JSFunction, thisArg: JSValue, args: JSValue[]): JSValue {
    const callEnv = new Environment(fn.closure);
    callEnv.markFunctionScope();
    callEnv.setLocal('arguments', createArray(args));
    if (fn.isArrow) {
      callEnv.setLocal('this', fn.closure.get('this') ?? createObject(null));
    } else if (thisArg === undefined && !fn.isStrict) {
      callEnv.setLocal('this', this.globalEnv.get('this') ?? createObject(null));
    } else {
      callEnv.setLocal('this', thisArg);
    }
    this.bindParams(fn, callEnv, args);
    if (fn.generator) return this.makeGenerator(fn, callEnv);
    if (fn.async && this.eventLoop) return this.runAsyncFunction(fn, callEnv);
    const bodyNode = fn.body as AST.BlockStatement | AST.Expression;
    const result = bodyNode.type === 'BlockStatement'
      ? this.execBlock(bodyNode.body as AST.Statement[], callEnv)
      : this.evalExpr(bodyNode as AST.Expression, callEnv);
    if (isReturnSignal(result)) return result.value;
    if (isThrowSignal(result)) throw new JSError(result.value);
    if (fn.async && this.eventLoop) return wrapAsyncResult(result as JSValue, this.eventLoop);
    return bodyNode.type === 'BlockStatement' ? undefined : result as JSValue;
  }

  getOutput(): string[] {
    return [...this.output];
  }

  clearOutput(): void {
    this.output.length = 0;
  }

  getTaskQueue(): Array<{ fn: () => void; delay: number; recurring: boolean }> {
    return [...this.timers.values()];
  }

  // ── Statement execution ──────────────────────────────────────────────────

  private exec(stmt: AST.Statement, env: Environment): JSValue | BreakSignal | ContinueSignal | ReturnSignal | ThrowSignal {
    this.checkTimeout();
    switch (stmt.type) {
      case 'BlockStatement': return this.execBlock(stmt.body, blockScope(stmt.body, env));
      case 'ExpressionStatement': return this.evalExpr(stmt.expression, env);
      case 'VariableDeclaration': this.execVarDecl(stmt, env); return undefined;
      case 'FunctionDeclaration': this.execFuncDecl(stmt, env); return undefined;
      case 'ClassDeclaration': this.execClassDecl(stmt, env); return undefined;
      case 'ReturnStatement': return this.execReturn(stmt, env);
      case 'IfStatement': return this.execIf(stmt, env);
      case 'WhileStatement': return this.execWhile(stmt, env);
      case 'DoWhileStatement': return this.execDoWhile(stmt, env);
      case 'ForStatement': return this.execFor(stmt, env);
      case 'ForInStatement': return this.execForIn(stmt, env);
      case 'ForOfStatement': return this.execForOf(stmt, env);
      case 'SwitchStatement': return this.execSwitch(stmt, env);
      case 'TryStatement': return this.execTry(stmt, env);
      case 'ThrowStatement': return this.execThrow(stmt, env);
      case 'BreakStatement': return { type: 'break', label: stmt.label?.name } as BreakSignal;
      case 'ContinueStatement': return { type: 'continue', label: stmt.label?.name } as ContinueSignal;
      case 'EmptyStatement': return undefined;
      case 'DebuggerStatement': return undefined;
      case 'LabeledStatement': {
        // The loop it labels needs its labels to tell `continue outer` from an inner continue.
        const body = stmt.body as AST.Statement & { __labels?: string[] };
        body.__labels = [...((stmt as { __labels?: string[] }).__labels ?? []), stmt.label.name];
        const result = this.exec(stmt.body, env);
        if (isBreakSignal(result) && result.label === stmt.label.name) return undefined;
        return result;
      }
      default: return undefined;
    }
  }

  private execBlock(body: AST.Statement[], env: Environment): JSValue | BreakSignal | ContinueSignal | ReturnSignal | ThrowSignal {
    for (const stmt of body) {
      if (stmt.type === 'FunctionDeclaration') this.execFuncDecl(stmt, env);
    }
    // TDZ hoisting: pre-declare all let/const bindings in TDZ state
    // Per ECMAScript § 13.2.1, let/const bindings are hoisted to the top of their block
    // but remain uninitialized until the declaration is evaluated.
    this.hoistLetConst(body, env);
    let lastResult: JSValue | BreakSignal | ContinueSignal | ReturnSignal | ThrowSignal = undefined;
    for (const stmt of body) {
      if (stmt.type === 'FunctionDeclaration') continue;
      lastResult = this.exec(stmt, env);
      if (lastResult !== undefined && (isBreakSignal(lastResult) || isContinueSignal(lastResult) || isReturnSignal(lastResult) || isThrowSignal(lastResult))) {
        return lastResult;
      }
    }
    return lastResult;
  }

  private hoistLetConst(body: AST.Statement[], env: Environment): void {
    for (const stmt of body) {
      if (stmt.type === 'VariableDeclaration' && (stmt.kind === 'let' || stmt.kind === 'const')) {
        for (const decl of stmt.declarations) {
          if (decl.id.type === 'Identifier') {
            env.declareTDZ(decl.id.name, stmt.kind);
          }
        }
      } else if (stmt.type === 'ForStatement' || stmt.type === 'ForInStatement' || stmt.type === 'ForOfStatement') {
        const left = (stmt as any).left;
        if (left?.type === 'VariableDeclaration' && (left.kind === 'let' || left.kind === 'const')) {
          for (const decl of left.declarations) {
            if (decl.id.type === 'Identifier') {
              env.declareTDZ(decl.id.name, left.kind);
            }
          }
        }
      } else if (stmt.type === 'IfStatement') {
        this.hoistLetConst([stmt.consequent], env);
        if (stmt.alternate) this.hoistLetConst([stmt.alternate], env);
      } else if (stmt.type === 'BlockStatement') {
        // Don't recurse into nested blocks — they have their own scope
      }
    }
  }

  private execVarDecl(stmt: AST.VariableDeclaration, env: Environment): void {
    for (let i = 0; i < stmt.declarations.length; i++) {
      const decl = stmt.declarations[i];
      if (stmt.kind === 'let' || stmt.kind === 'const') {
        // TDZ: declare first in TDZ state, then initialize with value
        if (decl.id.type === 'Identifier') {
          env.declareTDZ(decl.id.name, stmt.kind);
        }
        const value = decl.init ? this.evalExpr(decl.init, env) : undefined;
        this.destructPattern(decl.id, value, env, stmt.kind);
      } else {
        const value = decl.init ? this.evalExpr(decl.init, env) : undefined;
        this.destructPattern(decl.id, value, env, stmt.kind);
      }
    }
  }

  /**
   * Bind call arguments to parameters: plain names, defaults (evaluated in the call scope, so they
   * can use earlier params), destructuring and rest. Only plain names used to work.
   */
  private bindParams(fn: JSFunction, callEnv: Environment, args: JSValue[]): void {
    const patterns = fn.paramPatterns as AST.FunctionExpression['params'] | undefined;
    if (!patterns) {
      fn.params.forEach((p, i) => callEnv.setLocal(p, args[i]));
      return;
    }
    patterns.forEach((p, i) => {
      if (p.type === 'Identifier') callEnv.setLocal(p.name, args[i]);
      else if (p.type === 'RestElement') this.destructPattern(p.argument as AST.Identifier, createArray(args.slice(i)), callEnv, 'let');
      else this.destructPattern(p, args[i], callEnv, 'let');
    });
  }

  private destructPattern(pattern: AST.Identifier | AST.RestElement | AST.AssignmentPattern | AST.ArrayPattern | AST.ObjectPattern, value: JSValue, env: Environment, kind: 'var' | 'let' | 'const'): void {
    if (pattern.type === 'Identifier') {
      const name = pattern.name;
      if (kind === 'const' || kind === 'let') {
        // TDZ: initialize the binding (clears TDZ state)
        env.initialize(name, value, kind);
      } else {
        env.declare(name, value, 'var');
      }
    } else if (pattern.type === 'AssignmentPattern') {
      const val = value === undefined ? this.evalExpr(pattern.right, env) : value; // only undefined takes the default, not null
      this.destructPattern(pattern.left, val, env, kind);
    } else if (pattern.type === 'ArrayPattern') {
      // Any iterable destructures (`const [a, b] = "xy"`, `[k, v]` of a Map entry iterator).
      const arr = (value && typeof value === 'object' && (value as JSObject).type === 'array') ? value as JSObject : createArray(this.spreadValues(value));
      let idx = 0;
      for (const elem of pattern.elements) {
        if (elem === null) {
          idx++;
          continue;
        }
        if (elem.type === 'RestElement') {
          const restArr: JSValue[] = [];
          const len = Number(arr?.properties?.get('length')?.value ?? 0);
          for (let i = idx; i < len; i++) {
            restArr.push(arr?.properties?.get(String(i))?.value);
          }
          this.destructPattern(elem.argument, createArray(restArr), env, kind);
        } else {
          const elemVal = arr?.properties?.get(String(idx))?.value;
          this.destructPattern(elem, elemVal, env, kind);
          idx++;
        }
      }
    } else if (pattern.type === 'ObjectPattern') {
      const obj = typeof value === 'object' && value !== null ? value as JSObject : createObject(null);
      for (const prop of pattern.properties) {
        if (prop.type === 'RestElement') {
          const restObj = createObject(null);
          const seenKeys = new Set<string>();
          for (const p of pattern.properties) {
            if (p.type === 'Property' && p.key.type === 'Identifier') seenKeys.add(p.key.name);
          }
          if (obj.properties) {
            for (const [k, desc] of obj.properties) {
              if (!seenKeys.has(k)) restObj.properties.set(k, desc);
            }
          }
          this.destructPattern(prop.argument, restObj, env, kind);
        } else {
          const key = prop.key.type === 'Identifier' ? prop.key.name : toString(this.evalExpr(prop.key, env));
          const propVal = obj?.properties?.get(key)?.value;
          this.destructPattern(prop.value as any, propVal, env, kind);
        }
      }
    }
  }

  private execFuncDecl(stmt: AST.FunctionDeclaration, env: Environment): void {
    const fn = makeFunction(stmt.id.name, stmt.params, stmt.body, env, stmt.async, false, stmt.generator, stmt.strictMode);
    env.declare(stmt.id.name, fn, 'var');
  }

  private execClassDecl(stmt: AST.ClassDeclaration, env: Environment): void {
    const className = stmt.id?.name ?? '';
    const classProto = createObject(null);

    const classObj: JSObject = {
      type: 'class',
      properties: new Map(),
      prototype: classProto,
      callable: true,
    };

    // Set up prototype with constructor
    classProto.properties.set('constructor', {
      value: { type: 'closure', name: className, params: [], body: { type: 'BlockStatement', body: [] }, closure: env, async: false, generator: false, isArrow: false, isNative: false } as JSFunction,
      writable: true, enumerable: false, configurable: true,
    });

    // Handle inheritance
    if (stmt.superClass) {
      const superClass = this.evalExpr(stmt.superClass, env);
      if (typeof superClass === 'object' && superClass !== null) {
        // The parent's prototype object, whatever kind of constructor it is. This used the parent's
        // internal [[Prototype]], right for a class but nothing for Error/Map or an ES5 function.
        const superProto = constructorPrototype(superClass);
        if (superProto) classProto.prototype = superProto;
        classObj.properties.set('super', { value: superClass, writable: false, enumerable: false, configurable: false });
      }
    }

    // The class's own scope: `super` for its methods. It was set on the enclosing scope, so two
    // classes declared side by side overwrote each other's parent.
    const classEnv = new Environment(env);
    const superVal = classObj.properties.get('super')?.value;
    if (superVal && typeof superVal === 'object') {
      classEnv.setLocal('super', constructorPrototype(superVal) ?? superVal);
      classEnv.setLocal('__superCtor', superVal);
    }

    // Members: methods, getters/setters (they became plain methods named after the key, plus a
    // member called "get"), static members, computed keys, and instance/static fields (ignored).
    let hasConstructor = false;
    const fields: ClassField[] = [];
    const staticFields: ClassField[] = [];
    if (stmt.body.type === 'ClassBody') {
      for (const member of stmt.body.body) {
        const key = member.computed || member.key.type !== 'Identifier'
          ? toString(this.evalExpr(member.key, classEnv))
          : member.key.name;
        if (member.type === 'MethodDefinition') {
          const fn = makeFunction(key, member.value.params, member.value.body, classEnv, !!member.value.async, false, !!member.value.generator, true);
          if (member.kind === 'constructor') {
            hasConstructor = true;
            classObj.properties.set('constructor', { value: fn, writable: true, enumerable: true, configurable: true });
            classProto.properties.set('constructor', { value: fn, writable: true, enumerable: false, configurable: true });
            continue;
          }
          const target = member.static ? classObj : classProto;
          if (member.kind === 'get' || member.kind === 'set') {
            const existing = target.properties.get(key);
            target.properties.set(key, {
              value: undefined, writable: true, enumerable: false, configurable: true,
              getter: member.kind === 'get' ? fn : existing?.getter,
              setter: member.kind === 'set' ? fn : existing?.setter,
            });
          } else {
            target.properties.set(key, { value: fn, writable: true, enumerable: false, configurable: true });
          }
        } else if (member.type === 'PropertyDefinition') {
          ((member as { static?: boolean }).static ? staticFields : fields).push({ key, init: member.value as AST.Expression | null });
        }
      }
    }
    (classObj as ClassWithFields).__fields = fields;
    (classObj as ClassWithFields).__fieldEnv = classEnv;

    // Generate default constructor for derived classes without one
    if (!hasConstructor && stmt.superClass) {
      const defaultCtor = createFunction(className, [], {
        type: 'BlockStatement',
        body: [{
          type: 'ExpressionStatement',
          expression: {
            type: 'CallExpression',
            callee: { type: 'SuperExpression' } as AST.SuperExpression,
            arguments: [{ type: 'SpreadElement', argument: { type: 'Identifier', name: 'arguments' } as AST.Identifier } as AST.SpreadElement] as AST.Expression[],
            optional: false,
          },
        }],
      } as unknown as AST.BlockStatement, classEnv, false, false, false, false, undefined, true);
      classObj.properties.set('constructor', { value: defaultCtor, writable: true, enumerable: true, configurable: true });
      classProto.properties.set('constructor', { value: defaultCtor, writable: true, enumerable: false, configurable: true });
    }

    // An instance's `.constructor` is the class itself (it was the inner constructor function).
    classProto.properties.set('constructor', { value: classObj, writable: true, enumerable: false, configurable: true });
    // `A.prototype` (read by Object.getPrototypeOf comparisons, mixins, `A.prototype.method = …`).
    classObj.properties.set('prototype', { value: classProto, writable: false, enumerable: false, configurable: false });

    env.declare(className, classObj, 'var');
    // Static fields run once, with `this` = the class, after the class exists (`static x = A.y`).
    this.initFields({ __fields: staticFields, __fieldEnv: classEnv } as unknown as JSValue, classObj);
  }

  /** Initialize a class's instance fields on `instance` (`this` inside initializers is the instance). */
  private initFields(cls: JSValue, instance: JSValue): void {
    const c = cls as ClassWithFields | undefined;
    if (!c?.__fields?.length || !instance || typeof instance !== 'object') return;
    const fieldEnv = new Environment(c.__fieldEnv);
    fieldEnv.markFunctionScope();
    fieldEnv.setLocal('this', instance);
    for (const f of c.__fields) {
      (instance as JSObject).properties.set(f.key, { value: f.init ? this.evalExpr(f.init, fieldEnv) : undefined, writable: true, enumerable: true, configurable: true });
    }
  }

  private execReturn(stmt: AST.ReturnStatement, env: Environment): ReturnSignal {
    const value = stmt.argument ? this.evalExpr(stmt.argument, env) : undefined;
    return { type: 'return', value };
  }

  private execIf(stmt: AST.IfStatement, env: Environment): JSValue | BreakSignal | ContinueSignal | ReturnSignal | ThrowSignal {
    if (toBoolean(this.evalExpr(stmt.test, env))) {
      return this.exec(stmt.consequent, env);
    } else if (stmt.alternate) {
      return this.exec(stmt.alternate, env);
    }
    return undefined;
  }

  private execWhile(stmt: AST.WhileStatement, env: Environment): JSValue | BreakSignal | ContinueSignal | ReturnSignal | ThrowSignal {
    while (toBoolean(this.evalExpr(stmt.test, env))) {
      const result = this.exec(stmt.body, env);
      if (isBreakSignal(result) && !result.label) return undefined;
      if (isBreakSignal(result) && result.label) return result;
      if (isContinueSignal(result)) { if (!continuesHere(stmt, result)) return result; continue; }
      if (isReturnSignal(result) || isThrowSignal(result)) return result;
    }
    return undefined;
  }

  private execDoWhile(stmt: AST.DoWhileStatement, env: Environment): JSValue | BreakSignal | ContinueSignal | ReturnSignal | ThrowSignal {
    do {
      const result = this.exec(stmt.body, env);
      if (isBreakSignal(result) && !result.label) return undefined;
      if (isBreakSignal(result) && result.label) return result;
      if (isContinueSignal(result)) { if (!continuesHere(stmt, result)) return result; continue; }
      if (isReturnSignal(result) || isThrowSignal(result)) return result;
    } while (toBoolean(this.evalExpr(stmt.test, env)));
    return undefined;
  }

  private execFor(stmt: AST.ForStatement, env: Environment): JSValue | BreakSignal | ContinueSignal | ReturnSignal | ThrowSignal {
    const loopEnv = new Environment(env);
    if (stmt.init) {
      if (stmt.init.type === 'VariableDeclaration') {
        this.execVarDecl(stmt.init, loopEnv);
      } else {
        this.evalExpr(stmt.init, loopEnv);
      }
    }
    // `for (let i …)` gets a fresh binding per iteration (§14.7.4.4), so closures made in the body
    // keep their own i; they all saw the final value.
    const perIteration = stmt.init?.type === 'VariableDeclaration' && stmt.init.kind !== 'var'
      ? stmt.init.declarations.flatMap((d) => (d.id.type === 'Identifier' ? [d.id.name] : []))
      : [];
    let iterEnv = loopEnv;
    const nextIterEnv = () => {
      const e = new Environment(env);
      for (const n of perIteration) e.setLocal(n, iterEnv.get(n), (stmt.init as AST.VariableDeclaration).kind as 'let' | 'const');
      return e;
    };
    if (perIteration.length) iterEnv = nextIterEnv();
    while (true) {
      if (stmt.test && !toBoolean(this.evalExpr(stmt.test, iterEnv))) break;
      const result = this.exec(stmt.body, iterEnv);
      if (isBreakSignal(result) && !result.label) return undefined;
      if (isBreakSignal(result) && result.label) return result;
      if (isContinueSignal(result)) { if (!continuesHere(stmt, result)) return result; /* else fall through to update */ }
      else if (isReturnSignal(result) || isThrowSignal(result)) return result;
      if (perIteration.length) iterEnv = nextIterEnv();
      if (stmt.update) this.evalExpr(stmt.update, iterEnv);
    }
    return undefined;
  }

  /** Bind a for-in/for-of target (`x`, `var x`, `const [k, v]`, `obj.p`) in a fresh per-iteration scope. */
  private bindLoopTarget(left: AST.ForInStatement['left'], value: JSValue, env: Environment): Environment {
    const iterEnv = new Environment(env);
    if (left.type === 'VariableDeclaration') {
      const kind = left.kind as 'var' | 'let' | 'const';
      const id = left.declarations[0]!.id;
      if (kind === 'var' && id.type === 'Identifier') { if (!env.set(id.name, value)) env.declare(id.name, value, 'var'); }
      else this.destructPattern(id, value, iterEnv, kind);
    } else if ((left as AST.Node).type === 'Identifier') {
      env.set((left as AST.Identifier).name, value);
    }
    // ponytail: a member target (`for (o.k of xs)`) is not bound; add it if a site needs it.
    return iterEnv;
  }

  private execForIn(stmt: AST.ForInStatement, env: Environment): JSValue | BreakSignal | ContinueSignal | ReturnSignal | ThrowSignal {
    const obj = this.evalExpr(stmt.right, env);
    if (obj === null || obj === undefined) return undefined;
    // Enumerable string keys, own then inherited. It listed every key, so `for (k in arr)` gave
    // "length", "push", "pop"…
    for (const key of forInKeys(obj)) {
      const iterEnv = this.bindLoopTarget(stmt.left, key, env);
      const result = this.exec(stmt.body, iterEnv);
      if (isBreakSignal(result) && !result.label) return undefined;
      if (isBreakSignal(result) && result.label) return result;
      if (isContinueSignal(result)) { if (!continuesHere(stmt, result)) return result; continue; }
      if (isReturnSignal(result) || isThrowSignal(result)) return result;
    }
    return undefined;
  }

  private execForOf(stmt: AST.ForOfStatement, env: Environment): JSValue | BreakSignal | ContinueSignal | ReturnSignal | ThrowSignal {
    const iterable = this.evalExpr(stmt.right, env);
    for (const val of iterateJS(iterable)) {
      const iterEnv = this.bindLoopTarget(stmt.left, val, env);
      const result = this.exec(stmt.body, iterEnv);
      if (isBreakSignal(result) && !result.label) return undefined;
      if (isBreakSignal(result) && result.label) return result;
      if (isContinueSignal(result)) { if (!continuesHere(stmt, result)) return result; continue; }
      if (isReturnSignal(result) || isThrowSignal(result)) return result;
    }
    return undefined;
  }

  private execSwitch(stmt: AST.SwitchStatement, env: Environment): JSValue | BreakSignal | ContinueSignal | ReturnSignal | ThrowSignal {
    const disc = this.evalExpr(stmt.discriminant, env);
    let matched = false;
    for (const c of stmt.cases) {
      if (!matched && c.test) {
        const caseVal = this.evalExpr(c.test, env);
        if (disc === caseVal || (typeof disc === 'number' && typeof caseVal === 'number' && Object.is(disc, caseVal))) {
          matched = true;
        }
      }
      if (matched || !c.test) {
        if (c.test) matched = true;
        for (const s of c.consequent) {
          const result = this.exec(s, env);
          if (isBreakSignal(result) && !result.label) return undefined;
          if (isBreakSignal(result) && result.label) return result;
          if (isContinueSignal(result) || isReturnSignal(result) || isThrowSignal(result)) return result;
        }
      }
    }
    return undefined;
  }

  // ── Resumable executor ────────────────────────────────────────────────────
  // Async and generator bodies run as host generators so `await` / `yield` can suspend. Any node
  // without an await/yield goes straight to the normal exec/evalExpr; only the path to a suspension
  // point is walked here. (`await` used to unwind the stack and drop the rest of the function.)

  private *evalR(expr: AST.Expression, env: Environment): Resumable<JSValue> {
    if (!hasSuspend(expr)) return this.evalExpr(expr, env);
    switch (expr.type) {
      case 'AwaitExpression': {
        const v = yield* this.evalR(expr.argument, env);
        return yield { kind: 'await', value: v };
      }
      case 'YieldExpression': {
        const v = expr.argument ? yield* this.evalR(expr.argument, env) : undefined;
        if (expr.delegate) {
          // ponytail: yield* forwards values only (not next(v)/throw/return); fine for spreading/iterating.
          for (const item of iterateJS(v)) yield { kind: 'yield', value: item };
          return undefined;
        }
        return yield { kind: 'yield', value: v };
      }
      case 'LogicalExpression': {
        const l = yield* this.evalR(expr.left, env);
        if (expr.operator === '&&' ? !toBoolean(l) : expr.operator === '||' ? toBoolean(l) : (l !== null && l !== undefined)) return l;
        return yield* this.evalR(expr.right, env);
      }
      case 'ConditionalExpression':
        return toBoolean(yield* this.evalR(expr.test, env)) ? yield* this.evalR(expr.consequent, env) : yield* this.evalR(expr.alternate, env);
      case 'SequenceExpression': {
        let last: JSValue;
        for (const e of expr.expressions) last = yield* this.evalR(e, env);
        return last;
      }
      default: {
        // Evaluate operands in order up to the last one that suspends, then let the normal evaluator
        // finish the expression with those operands replaced by their values.
        const { clone, slots } = cloneWithSlots(expr);
        let lastSuspending = -1;
        slots.forEach((s, i) => { if (hasSuspend(s.node)) lastSuspending = i; });
        for (let i = 0; i <= lastSuspending; i++) {
          const s = slots[i]!;
          const v = hasSuspend(s.node) ? yield* this.evalR(s.node as AST.Expression, env) : this.evalExpr(s.node as AST.Expression, env);
          s.set(valueNode(v));
        }
        return this.evalExpr(clone, env);
      }
    }
  }

  private *execBlockR(body: AST.Statement[], env: Environment): Resumable<Completion> {
    for (const stmt of body) if (stmt.type === 'FunctionDeclaration') this.execFuncDecl(stmt, env);
    this.hoistLetConst(body, env);
    let last: Completion = undefined;
    for (const stmt of body) {
      if (stmt.type === 'FunctionDeclaration') continue;
      last = yield* this.execR(stmt, env);
      if (last !== undefined && (isBreakSignal(last) || isContinueSignal(last) || isReturnSignal(last) || isThrowSignal(last))) return last;
    }
    return last;
  }

  private *execVarDeclR(stmt: AST.VariableDeclaration, env: Environment): Resumable<void> {
    for (const decl of stmt.declarations) {
      if ((stmt.kind === 'let' || stmt.kind === 'const') && decl.id.type === 'Identifier') env.declareTDZ(decl.id.name, stmt.kind);
      const value = decl.init ? yield* this.evalR(decl.init, env) : undefined;
      this.destructPattern(decl.id, value, env, stmt.kind);
    }
  }

  /** One loop iteration's signal handling, shared by the resumable loops: 'break' | 'next' | a signal to return. */
  private loopSignal(stmt: AST.Statement, result: Completion): 'exit' | 'next' | Completion {
    if (isBreakSignal(result)) return result.label ? result : 'exit';
    if (isContinueSignal(result)) return continuesHere(stmt, result) ? 'next' : result;
    if (isReturnSignal(result) || isThrowSignal(result)) return result;
    return 'next';
  }

  private *execR(stmt: AST.Statement, env: Environment): Resumable<Completion> {
    if (!hasSuspend(stmt)) return this.exec(stmt, env);
    this.checkTimeout();
    switch (stmt.type) {
      case 'BlockStatement': return yield* this.execBlockR(stmt.body, blockScope(stmt.body, env));
      case 'ExpressionStatement': return yield* this.evalR(stmt.expression, env);
      case 'VariableDeclaration': yield* this.execVarDeclR(stmt, env); return undefined;
      case 'ReturnStatement': return { type: 'return', value: stmt.argument ? yield* this.evalR(stmt.argument, env) : undefined } as ReturnSignal;
      case 'ThrowStatement': return { type: 'throw', value: yield* this.evalR(stmt.argument, env) } as ThrowSignal;
      case 'IfStatement':
        if (toBoolean(yield* this.evalR(stmt.test, env))) return yield* this.execR(stmt.consequent, env);
        return stmt.alternate ? yield* this.execR(stmt.alternate, env) : undefined;
      case 'LabeledStatement': {
        const body = stmt.body as AST.Statement & { __labels?: string[] };
        body.__labels = [...((stmt as { __labels?: string[] }).__labels ?? []), stmt.label.name];
        const result = yield* this.execR(stmt.body, env);
        return isBreakSignal(result) && result.label === stmt.label.name ? undefined : result;
      }
      case 'WhileStatement':
        while (toBoolean(yield* this.evalR(stmt.test, env))) {
          const sig = this.loopSignal(stmt, yield* this.execR(stmt.body, env));
          if (sig === 'exit') return undefined;
          if (sig !== 'next') return sig;
        }
        return undefined;
      case 'DoWhileStatement':
        do {
          const sig = this.loopSignal(stmt, yield* this.execR(stmt.body, env));
          if (sig === 'exit') return undefined;
          if (sig !== 'next') return sig;
        } while (toBoolean(yield* this.evalR(stmt.test, env)));
        return undefined;
      case 'ForStatement': {
        const loopEnv = new Environment(env);
        if (stmt.init) {
          if (stmt.init.type === 'VariableDeclaration') yield* this.execVarDeclR(stmt.init, loopEnv);
          else yield* this.evalR(stmt.init, loopEnv);
        }
        const perIteration = stmt.init?.type === 'VariableDeclaration' && stmt.init.kind !== 'var'
          ? stmt.init.declarations.flatMap((d) => (d.id.type === 'Identifier' ? [d.id.name] : []))
          : [];
        let iterEnv = loopEnv;
        const nextIterEnv = () => {
          const e = new Environment(env);
          for (const n of perIteration) e.setLocal(n, iterEnv.get(n), (stmt.init as AST.VariableDeclaration).kind as 'let' | 'const');
          return e;
        };
        if (perIteration.length) iterEnv = nextIterEnv();
        while (true) {
          if (stmt.test && !toBoolean(yield* this.evalR(stmt.test, iterEnv))) break;
          const sig = this.loopSignal(stmt, yield* this.execR(stmt.body, iterEnv));
          if (sig === 'exit') return undefined;
          if (sig !== 'next') return sig;
          if (perIteration.length) iterEnv = nextIterEnv();
          if (stmt.update) yield* this.evalR(stmt.update, iterEnv);
        }
        return undefined;
      }
      case 'ForOfStatement':
      case 'ForInStatement': {
        const right = yield* this.evalR(stmt.right, env);
        const values = stmt.type === 'ForOfStatement' ? iterateJS(right) : forInKeys(right);
        for (const v of values) {
          const iterEnv = this.bindLoopTarget(stmt.left, v, env);
          const sig = this.loopSignal(stmt, yield* this.execR(stmt.body, iterEnv));
          if (sig === 'exit') return undefined;
          if (sig !== 'next') return sig;
        }
        return undefined;
      }
      case 'SwitchStatement': {
        const disc = yield* this.evalR(stmt.discriminant, env);
        let matched = false;
        for (const c of stmt.cases) {
          if (!matched && c.test) {
            const caseVal = yield* this.evalR(c.test, env);
            if (disc === caseVal || (typeof disc === 'number' && typeof caseVal === 'number' && Object.is(disc, caseVal))) matched = true;
          }
          if (matched || !c.test) {
            if (c.test) matched = true;
            for (const s of c.consequent) {
              const result = yield* this.execR(s, env);
              if (isBreakSignal(result) && !result.label) return undefined;
              if (isBreakSignal(result) || isContinueSignal(result) || isReturnSignal(result) || isThrowSignal(result)) return result;
            }
          }
        }
        return undefined;
      }
      case 'TryStatement': return yield* this.execTryR(stmt, env);
      default: return this.exec(stmt, env);
    }
  }

  /** execTry, resumable: an await inside try/catch/finally; a rejected await lands in the catch. */
  private *execTryR(stmt: AST.TryStatement, env: Environment): Resumable<Completion> {
    let pending: Completion = undefined;
    let rethrow: { error: unknown } | undefined;
    const runCatch = function* (this: Interpreter, value: JSValue): Resumable<void> {
      const catchEnv = new Environment(env);
      if (stmt.handler!.param) catchEnv.setLocal(stmt.handler!.param.name, value);
      try {
        pending = yield* this.execBlockR(stmt.handler!.body.body, catchEnv);
      } catch (fromCatch) {
        rethrow = { error: fromCatch };
      }
    }.bind(this);
    try {
      const result = yield* this.execBlockR(stmt.block.body, env);
      if (isThrowSignal(result) && stmt.handler) yield* runCatch(result.value);
      else pending = result;
    } catch (caught) {
      const e = caught instanceof Error && !(caught instanceof JSError) && stmt.handler ? new JSError(this.hostErrorToJS(caught, env)) : caught;
      if (e instanceof JSError && stmt.handler) yield* runCatch(e.value);
      else rethrow = { error: e };
    }
    if (stmt.finalizer) {
      const fin = yield* this.execBlockR(stmt.finalizer.body, env);
      if (isReturnSignal(fin) || isBreakSignal(fin) || isContinueSignal(fin) || isThrowSignal(fin)) { rethrow = undefined; pending = fin; }
    }
    if (rethrow) throw rethrow.error;
    return isReturnSignal(pending) || isThrowSignal(pending) || isBreakSignal(pending) || isContinueSignal(pending) ? pending : undefined;
  }

  /** The whole body of an async/generator function as a resumable run; returns its result value. */
  private *runBodyR(fn: JSFunction, callEnv: Environment): Resumable<JSValue> {
    const body = fn.body as AST.BlockStatement | AST.Expression;
    if (body.type !== 'BlockStatement') return yield* this.evalR(body as AST.Expression, callEnv);
    const result = yield* this.execBlockR(body.body as AST.Statement[], callEnv);
    if (isReturnSignal(result)) return result.value;
    if (isThrowSignal(result)) throw new JSError(result.value);
    return undefined;
  }

  /** Call an async function: run until an await, resume when it settles; resolves with the return value. */
  private runAsyncFunction(fn: JSFunction, callEnv: Environment): JSValue {
    const loop = this.eventLoop!;
    const promise = createPromiseObj(loop);
    const gen = this.runBodyR(fn, callEnv);
    const step = (input: JSValue, isThrow: boolean, resumed: boolean): void => {
      // A resumption runs later, from the event loop: give it a fresh time budget.
      if (resumed) { this.executionStartTime = Date.now(); this.opCount = 0; }
      let r: IteratorResult<Suspend, JSValue>;
      try {
        r = isThrow ? gen.throw(new JSError(input)) : gen.next(input);
      } catch (err) {
        rejectPromise(promise, err instanceof JSError ? err.value : err instanceof Error ? this.hostErrorToJS(err, callEnv) : err as JSValue);
        return;
      }
      if (r.done) { resolvePromise(promise, r.value, loop); return; }
      this.awaitValue(r.value.value, (v) => step(v, false, true), (e) => step(e, true, true));
    };
    step(undefined, false, false);
    return promise;
  }

  /** Wait for a value as `await` does: promises and thenables settle, anything else on the next microtask. */
  private awaitValue(value: JSValue, onFulfilled: (v: JSValue) => void, onRejected: (e: JSValue) => void): void {
    const loop = this.eventLoop!;
    if (isPromiseObject(value) && !isPromisePending(value)) {
      const result = getPromiseResult(value);
      const rejected = isPromiseRejected(value);
      loop.enqueueMicrotask(() => (rejected ? onRejected(result) : onFulfilled(result)));
      return;
    }
    const then = value && typeof value === 'object' ? (value as JSObject).properties?.get('then')?.value : undefined;
    if (then && typeof then === 'object' && 'closure' in then) {
      try {
        callJSFunction(then as JSFunction, value, [
          createNativeFunction('resume', (_t, a) => { onFulfilled(a[0]); return undefined; }),
          createNativeFunction('fail', (_t, a) => { onRejected(a[0]); return undefined; }),
        ]);
      } catch (err) {
        loop.enqueueMicrotask(() => onRejected(err instanceof JSError ? err.value : String(err)));
      }
      return;
    }
    loop.enqueueMicrotask(() => onFulfilled(value));
  }

  /** Call a generator function: a generator object whose next() runs the body to the next yield. */
  private makeGenerator(fn: JSFunction, callEnv: Environment): JSValue {
    const gen = this.runBodyR(fn, callEnv);
    let finished = false;
    const result = (value: JSValue, done: boolean): JSObject => {
      const r = createObject(null);
      r.properties.set('value', { value, writable: true, enumerable: true, configurable: true });
      r.properties.set('done', { value: done, writable: true, enumerable: true, configurable: true });
      return r;
    };
    const resume = (action: () => IteratorResult<Suspend, JSValue>): JSObject => {
      if (finished) return result(undefined, true);
      let r: IteratorResult<Suspend, JSValue>;
      try { r = action(); } catch (err) { finished = true; throw err; }
      if (r.done) { finished = true; return result(r.value, true); }
      // ponytail: an `await` inside a generator (async generators) is treated as a yield.
      return result(r.value.value, false);
    };
    const genObj = createObject(null);
    const hidden = (name: string, nfn: NativeFunction) =>
      genObj.properties.set(name, { value: createNativeFunction(name, nfn), writable: true, enumerable: false, configurable: true });
    hidden('next', (_t, a) => resume(() => gen.next(a[0])));
    // ponytail: return() ends the generator without running its pending finally blocks.
    hidden('return', (_t, a) => { finished = true; gen.return(a[0]); return result(a[0], true); });
    hidden('throw', (_t, a) => resume(() => gen.throw(new JSError(a[0]))));
    hidden(ITERATOR_KEY, () => genObj);
    hidden('toString', () => '[object Generator]');
    return genObj;
  }

  /** A host Error as the page sees it: built with the page's own constructor of that name when there is one. */
  private hostErrorToJS(err: Error, env: Environment): JSValue {
    let ctor: JSValue;
    try { ctor = env.get(err.name || 'Error'); } catch { ctor = undefined; }
    const native = ctor as { nativeFn?: (t: JSValue, a: JSValue[]) => JSValue } | undefined;
    if (native && typeof native === 'object' && typeof native.nativeFn === 'function') {
      try {
        const made = native.nativeFn(createObject(null), [err.message]);
        if (made && typeof made === 'object') return made;
      } catch { /* fall through to a plain object */ }
    }
    const obj = createObject(null);
    const data = (value: JSValue) => ({ value, writable: true, enumerable: false, configurable: true });
    obj.properties.set('name', data(err.name || 'Error'));
    obj.properties.set('message', data(err.message));
    return obj;
  }

  private execTry(stmt: AST.TryStatement, env: Environment): JSValue | BreakSignal | ContinueSignal | ReturnSignal | ThrowSignal {
    let pendingReturn: ReturnSignal | undefined;
    let pendingBreak: BreakSignal | undefined;
    let pendingContinue: ContinueSignal | undefined;
    let pendingThrow: ThrowSignal | undefined;
    // A host exception still to rethrow once `finally` has run (it used to skip `finally`).
    let rethrow: { error: unknown } | undefined;

    try {
      const result = this.execBlock(stmt.block.body, env);
      if (isThrowSignal(result)) {
        if (stmt.handler) {
          const catchEnv = new Environment(env);
          if (stmt.handler.param) {
            catchEnv.setLocal(stmt.handler.param.name, result.value);
          }
          const catchResult = this.execBlock(stmt.handler.body.body, catchEnv);
          if (isThrowSignal(catchResult)) pendingThrow = catchResult;
          else if (isReturnSignal(catchResult)) pendingReturn = catchResult;
          else if (isBreakSignal(catchResult)) pendingBreak = catchResult;
          else if (isContinueSignal(catchResult)) pendingContinue = catchResult;
        } else {
          pendingThrow = result;
        }
      } else if (isReturnSignal(result)) {
        pendingReturn = result;
      } else if (isBreakSignal(result)) {
        pendingBreak = result;
      } else if (isContinueSignal(result)) {
        pendingContinue = result;
      }
    } catch (caught) {
      // Errors the engine raises itself (`null.x`, calling a non-function, CSP blocks) arrive here
      // as host TypeError/Error objects. They used to be rethrown past every catch, so a page's
      // guarded feature test (`try { … } catch {}`) killed the whole script. Hand the page a
      // real error object of the same type instead.
      const e = caught instanceof Error && !(caught instanceof JSError) && stmt.handler
        ? new JSError(this.hostErrorToJS(caught, env))
        : caught;
      if (e instanceof JSError && stmt.handler) {
        const catchEnv = new Environment(env);
        if (stmt.handler.param) {
          catchEnv.setLocal(stmt.handler.param.name, e.value);
        }
        try {
          const catchResult = this.execBlock(stmt.handler.body.body, catchEnv);
          if (isThrowSignal(catchResult)) pendingThrow = catchResult;
          else if (isReturnSignal(catchResult)) pendingReturn = catchResult;
          else if (isBreakSignal(catchResult)) pendingBreak = catchResult;
          else if (isContinueSignal(catchResult)) pendingContinue = catchResult;
        } catch (fromCatch) {
          rethrow = { error: fromCatch };
        }
      } else {
        rethrow = { error: e };
      }
    }

    if (stmt.finalizer) {
      const finResult = this.execBlock(stmt.finalizer.body, env);
      // An abrupt `finally` (return/throw/break/continue) replaces whatever was pending.
      const abrupt = isReturnSignal(finResult) || isBreakSignal(finResult) || isContinueSignal(finResult) || isThrowSignal(finResult);
      if (abrupt) rethrow = undefined;
      if (isReturnSignal(finResult)) pendingReturn = finResult;
      else if (isBreakSignal(finResult)) pendingBreak = finResult;
      else if (isContinueSignal(finResult)) pendingContinue = finResult;
      else if (isThrowSignal(finResult)) pendingThrow = finResult;
    }
    if (rethrow) throw rethrow.error;

    if (pendingReturn) return pendingReturn;
    if (pendingThrow) return pendingThrow;
    if (pendingBreak) return pendingBreak;
    if (pendingContinue) return pendingContinue;
    return undefined;
  }

  private execThrow(stmt: AST.ThrowStatement, env: Environment): ThrowSignal {
    const value = this.evalExpr(stmt.argument, env);
    return { type: 'throw', value };
  }

  // ── Expression evaluation ────────────────────────────────────────────────

  private evalExpr(expr: AST.Expression, env: Environment): JSValue {
    switch (expr.type) {
      case 'Literal': return this.evalLiteral(expr, env);
      case 'Identifier': return this.evalIdentifier(expr, env);
      case 'ThisExpression': return env.get('this') ?? undefined;
      case 'SuperExpression': {
        // When super is used as super.x or super[expr], return the parent prototype.
        // When super is used as super(), the CallExpression handler detects
        // the SuperExpression callee and calls the parent constructor.
        const superProto = env.get('super');
        if (superProto !== undefined && superProto !== null) return superProto;
        return createObject(null);
      }
      case 'UnaryExpression': return this.evalUnary(expr, env);
      case 'UpdateExpression': return this.evalUpdate(expr, env);
      case 'BinaryExpression': return this.evalBinary(expr, env);
      case 'LogicalExpression': return this.evalLogical(expr, env);
      case 'AssignmentExpression': return this.evalAssignment(expr, env);
      case 'ConditionalExpression': return this.evalConditional(expr, env);
      case 'CallExpression': return this.evalCall(expr, env);
      case 'NewExpression': return this.evalNew(expr, env);
      case 'MemberExpression': return this.evalMember(expr, env);
      case 'ArrayExpression': return this.evalArray(expr, env);
      case 'ObjectExpression': return this.evalObject(expr, env);
      case '__NovaValue' as AST.Expression['type']: return (expr as unknown as { value: JSValue }).value;
      case 'FunctionExpression': return this.evalFunctionExpr(expr, env);
      case 'ArrowFunctionExpression': return this.evalArrowFunction(expr, env);
      case 'SequenceExpression': return this.evalSequence(expr, env);
      case 'TemplateLiteral': return this.evalTemplateLiteral(expr, env);
      case 'TaggedTemplateExpression': {
        // tag(strings, ...values) with strings.raw; called through evalCall so `obj.tag` keeps its this.
        // ponytail: raw strings equal the cooked ones (the lexer keeps only cooked text).
        const cooked = expr.quasi.quasis.map((q) => q.value as JSValue);
        const strings = createArray(cooked);
        strings.properties.set('raw', { value: createArray(cooked), writable: false, enumerable: false, configurable: false });
        const tagEnv = new Environment(env);
        tagEnv.setLocal('__nova_tpl_strings', strings);
        return this.evalCall({ type: 'CallExpression', callee: expr.tag, arguments: [{ type: 'Identifier', name: '__nova_tpl_strings' } as AST.Identifier, ...expr.quasi.expressions], optional: false } as AST.CallExpression, tagEnv);
      }
      case 'AwaitExpression': return this.evalAwait(expr, env);
      case 'YieldExpression': return this.evalYield(expr, env);
      default: return undefined;
    }
  }

  private evalLiteral(expr: AST.Literal, env: Environment): JSValue {
    if (expr.value && typeof expr.value === 'object' && 'type' in expr.value) {
      // A regex literal: build a real RegExp through the page's RegExp constructor. It used to
      // evaluate to its source string, so /re/.test() was undefined and "s".match(/re/) failed.
      const re = expr.value as { type: string; pattern?: string; flags?: string };
      const ctor = env.get('RegExp') as { nativeFn?: (t: JSValue, a: JSValue[]) => JSValue } | undefined;
      if (re.type === 'RegExp' && ctor?.nativeFn) return ctor.nativeFn(undefined, [re.pattern ?? '', re.flags ?? '']);
      return expr.raw;
    }
    return expr.value as JSValue;
  }

  private evalTemplateLiteral(expr: AST.TemplateLiteral, env: Environment): JSValue {
    let result = '';
    for (let i = 0; i < expr.quasis.length; i++) {
      result += expr.quasis[i]!.value;
      if (i < expr.expressions.length) {
        const val = this.evalExpr(expr.expressions[i]!, env);
        // The engine's ToString, not the host String(): objects and arrays came out "[object Object]".
        result += toString(val);
      }
    }
    return result;
  }

  private evalIdentifier(expr: AST.Identifier, env: Environment): JSValue {
    return env.get(expr.name);
  }

  private evalUnary(expr: AST.UnaryExpression, env: Environment): JSValue {
    if (expr.operator === 'typeof') {
      const val = this.evalExpr(expr.argument, env);
      return getType(val);
    }
    if (expr.operator === 'void') {
      this.evalExpr(expr.argument, env);
      return undefined;
    }
    if (expr.operator === 'delete') {
      // `delete o.k` / `delete o[k]` removes the property (it used to be a no-op returning true).
      const target = expr.argument;
      if (target.type !== 'MemberExpression') return target.type !== 'Identifier';
      const obj = this.evalExpr(target.object, env);
      const key = target.computed ? toString(this.evalExpr(target.property, env)) : (target.property as AST.Identifier).name;
      if (obj === null || obj === undefined) throw new TypeError(`Cannot convert undefined or null to object`);
      const props = typeof obj === 'object' ? (obj as JSObject).properties : undefined;
      const desc = props?.get(key);
      if (!desc) return true;
      if (desc.configurable === false || (obj as { __frozen?: boolean }).__frozen) return false;
      props!.delete(key);
      return true;
    }
    const val = this.evalExpr(expr.argument, env);
    switch (expr.operator) {
      case '-': return -toNumber(val);
      case '+': return toNumber(val);
      case '!': return !toBoolean(val);
      case '~': return ~toNumber(val);
      default: return val;
    }
  }

  private evalUpdate(expr: AST.UpdateExpression, env: Environment): JSValue {
    if (expr.argument.type === 'MemberExpression') {
      const obj = this.evalExpr(expr.argument.object, env) as JSObject;
      if (typeof obj !== 'object' || obj === null) return 0;
      const key = expr.argument.computed
        ? toString(this.evalExpr(expr.argument.property, env))
        : (expr.argument.property as AST.Identifier).name;
      const old = toNumber(obj.properties.get(key)?.value);
      const newVal = expr.operator === '++' ? old + 1 : old - 1;
      obj.properties.set(key, { value: newVal, writable: true, enumerable: true, configurable: true });
      return expr.prefix ? newVal : old;
    }
    const name = (expr.argument as AST.Identifier)?.name;
    if (!name) return 0;
    const old = toNumber(env.get(name));
    const newVal = expr.operator === '++' ? old + 1 : old - 1;
    env.set(name, newVal);
    return expr.prefix ? newVal : old;
  }

  private evalBinary(expr: AST.BinaryExpression, env: Environment): JSValue {
    const left = this.evalExpr(expr.left, env);
    const right = this.evalExpr(expr.right, env);

    switch (expr.operator) {
      case '+': {
        // ToPrimitive first: `obj + ""` uses the object's valueOf/toString, and a Date or an array
        // concatenates as a string.
        const l = toPrimitive(left, 'default');
        const r = toPrimitive(right, 'default');
        if (typeof l === 'string' || typeof r === 'string' || (l && typeof l === 'object') || (r && typeof r === 'object')) return toString(l) + toString(r);
        return toNumber(l) + toNumber(r);
      }
      case '-': return toNumber(left) - toNumber(right);
      case '*': return toNumber(left) * toNumber(right);
      case '/': return toNumber(left) / toNumber(right);
      case '%': return toNumber(left) % toNumber(right);
      case '**': return toNumber(left) ** toNumber(right);
      case '<': return compare(left, right, (a, b) => a < b);
      case '>': return compare(left, right, (a, b) => a > b);
      case '<=': return compare(left, right, (a, b) => a <= b);
      case '>=': return compare(left, right, (a, b) => a >= b);
      case '==': return looseEquals(left, right);
      case '!=': return !looseEquals(left, right);
      case '===': return left === right;
      case '!==': return left !== right;
      case '&': return toNumber(left) & toNumber(right);
      case '|': return toNumber(left) | toNumber(right);
      case '^': return toNumber(left) ^ toNumber(right);
      case '<<': return toNumber(left) << toNumber(right);
      case '>>': return toNumber(left) >> toNumber(right);
      case '>>>': return toNumber(left) >>> toNumber(right);
      case 'instanceof': return instanceofCheck(left, right);
      case 'in': return typeof right === 'object' && right !== null
        ? (right as JSObject).properties.has(toString(left))
        : false;
      default: return undefined;
    }
  }

  private evalLogical(expr: AST.LogicalExpression, env: Environment): JSValue {
    const left = this.evalExpr(expr.left, env);
    if (expr.operator === '&&') {
      return toBoolean(left) ? this.evalExpr(expr.right, env) : left;
    }
    if (expr.operator === '||') {
      return toBoolean(left) ? left : this.evalExpr(expr.right, env);
    }
    if (expr.operator === '??') {
      return left !== null && left !== undefined ? left : this.evalExpr(expr.right, env);
    }
    return left;
  }

  private evalAssignment(expr: AST.AssignmentExpression, env: Environment): JSValue {
    const right = this.evalExpr(expr.right, env);

    if (expr.left.type === 'Identifier') {
      const name = expr.left.name;
      if (expr.operator === '=') {
        env.set(name, right);
        return right;
      }
      const current = env.get(name);
      let newVal: JSValue;
      switch (expr.operator) {
        case '+=': newVal = (typeof current === 'string' || typeof right === 'string') ? toString(current) + toString(right) : toNumber(current) + toNumber(right); break;
        case '-=': newVal = toNumber(current) - toNumber(right); break;
        case '*=': newVal = toNumber(current) * toNumber(right); break;
        case '/=': newVal = toNumber(current) / toNumber(right); break;
        case '%=': newVal = toNumber(current) % toNumber(right); break;
        case '&=': newVal = toNumber(current) & toNumber(right); break;
        case '|=': newVal = toNumber(current) | toNumber(right); break;
        case '^=': newVal = toNumber(current) ^ toNumber(right); break;
        case '<<=': newVal = toNumber(current) << toNumber(right); break;
        case '>>=': newVal = toNumber(current) >> toNumber(right); break;
        case '>>>=': newVal = toNumber(current) >>> toNumber(right); break;
        case '??=': newVal = (current !== null && current !== undefined) ? current : right; break;
        case '||=': newVal = toBoolean(current) ? current : right; break;
        case '&&=': newVal = toBoolean(current) ? right : current; break;
        default: newVal = right;
      }
      env.set(name, newVal);
      return newVal;
    }

    if (expr.left.type === 'MemberExpression') {
      const obj = this.evalExpr(expr.left.object, env) as JSObject;
      if (typeof obj !== 'object' || obj === null) return right;
      // Functions carry no property map until they need one. Assigning to one (`f.x = 1`,
      // jQuery's `$.fn`, `NS.util = …`) used to crash with "Cannot read properties of undefined
      // (reading 'get')", killing the script; Google's search page died exactly there.
      if (!obj.properties) (obj as { properties: Map<string, unknown> }).properties = new Map();
      const key = expr.left.computed
        ? toString(this.evalExpr(expr.left.property, env))
        : (expr.left.property as AST.Identifier).name;
      if (expr.operator === '=') {
        const existingDesc = obj.properties.get(key);
        // A setter may be inherited (class `set x(v)`, defineProperty on a prototype); it used to
        // be skipped and shadowed by a new own property.
        let inheritedSetter: JSFunction | undefined;
        if (!existingDesc) {
          for (let p = obj.prototype, d = 0; p && d < 64; p = p.prototype, d++) {
            const pd = p.properties?.get(key);
            if (pd) { if (pd.setter) inheritedSetter = pd.setter; break; }
          }
        }
        if (existingDesc?.setter || inheritedSetter) {
          callJSFunction((existingDesc?.setter ?? inheritedSetter)!, obj, [right]);
        } else if (existingDesc?.getter) {
          // getter without a setter: the assignment is ignored (sloppy mode)
        } else if (existingDesc && existingDesc.writable === false) {
          // read-only property: ignored (sloppy mode)
        } else if (obj.type === 'array' && key === 'length') {
          // arr.length = n truncates (it only changed the number; `arr.length = 0` left the items)
          const n = toNumber(right);
          const old = Number(existingDesc?.value ?? 0);
          for (let i = n; i < old; i++) obj.properties.delete(String(i));
          obj.properties.set('length', { ...existingDesc!, value: n });
        } else {
          // TypedArray: delegate indexed write to __nativeView
          const typeOverride = (obj as any).__type_override;
          if (typeOverride && typeof typeOverride === 'string' && typeOverride.endsWith('Array')) {
            const view = (obj as any).__nativeView;
            if (view) {
              const idx = parseInt(key, 10);
              if (!isNaN(idx) && idx >= 0 && idx < view.length) {
                let val = typeof right === 'bigint' ? right : Number(right);
                if (typeOverride === 'Uint8ClampedArray') val = Math.min(255, Math.max(0, Math.round(val as number)));
                view[idx] = val;
                return right;
              }
            }
          }
          // Keep an existing property's attributes (non-enumerable stays non-enumerable).
          obj.properties.set(key, existingDesc ? { ...existingDesc, value: right } : { value: right, writable: true, enumerable: true, configurable: true });
        }
        return right;
      }
      let current: JSValue;
      if (obj.properties.has(key)) {
        const d = obj.properties.get(key)!;
        current = d.getter ? callJSFunction(d.getter, obj, []) : d.value;
      } else if (obj.prototype) {
        let proto: JSObject | null = obj.prototype;
        let found = false;
        while (proto) {
          if (proto.properties.has(key)) { current = proto.properties.get(key)!.value; found = true; break; }
          proto = proto.prototype;
        }
        if (!found) current = undefined;
      } else {
        current = undefined;
      }
      let newVal: JSValue;
      switch (expr.operator) {
        case '+=': newVal = (typeof current === 'string' || typeof right === 'string') ? toString(current) + toString(right) : toNumber(current) + toNumber(right); break;
        case '-=': newVal = toNumber(current) - toNumber(right); break;
        case '*=': newVal = toNumber(current) * toNumber(right); break;
        case '/=': newVal = toNumber(current) / toNumber(right); break;
        case '%=': newVal = toNumber(current) % toNumber(right); break;
        case '&=': newVal = toNumber(current) & toNumber(right); break;
        case '|=': newVal = toNumber(current) | toNumber(right); break;
        case '^=': newVal = toNumber(current) ^ toNumber(right); break;
        case '<<=': newVal = toNumber(current) << toNumber(right); break;
        case '>>=': newVal = toNumber(current) >> toNumber(right); break;
        case '>>>=': newVal = toNumber(current) >>> toNumber(right); break;
        case '??=': newVal = (current !== null && current !== undefined) ? current : right; break;
        case '||=': newVal = toBoolean(current) ? current : right; break;
        case '&&=': newVal = toBoolean(current) ? right : current; break;
        default: newVal = right;
      }
      obj.properties.has(key) && obj.properties.get(key)!.setter
        ? callJSFunction(obj.properties.get(key)!.setter!, obj, [newVal])
        : obj.properties.set(key, { value: newVal, writable: true, enumerable: true, configurable: true });
      return newVal;
    }

    return right;
  }

  private evalConditional(expr: AST.ConditionalExpression, env: Environment): JSValue {
    return toBoolean(this.evalExpr(expr.test, env))
      ? this.evalExpr(expr.consequent, env)
      : this.evalExpr(expr.alternate, env);
  }

  private evalCall(expr: AST.CallExpression, env: Environment): JSValue {
    // Handle super() call — per ECMAScript § 12.3.5.2
    if (expr.callee.type === 'SuperExpression') {
      const superCtor = env.get('__superCtor');
      if (superCtor && typeof superCtor === 'object' && superCtor !== null) {
        const parentCtor = superCtor as JSObject;
        const parentInit = parentCtor.properties?.get('constructor');
        const thisObj = env.get('this');
        const args: JSValue[] = [];
        for (const a of expr.arguments) {
            if (a.type === 'SpreadElement') {
              const spreadVal = this.evalExpr(a.argument, env);
              if (typeof spreadVal === 'object' && spreadVal !== null && 'type' in spreadVal && (spreadVal as any).type === 'array') {
                const arr = spreadVal as JSObject;
                const len = Number(arr.properties.get('length')?.value ?? 0);
                for (let i = 0; i < len; i++) {
                  args.push(arr.properties.get(String(i))?.value);
                }
              } else if (Array.isArray(spreadVal)) {
                args.push(...spreadVal);
              } else {
                args.push(spreadVal);
              }
            } else {
              args.push(this.evalExpr(a, env));
            }
        }
        if (parentCtor.type === 'class' && parentInit?.value && typeof parentInit.value === 'object' && 'type' in parentInit.value && (parentInit.value as JSFunction).type === 'closure') {
          const pfn = parentInit.value as JSFunction;
          const pEnv = new Environment(pfn.closure);
          pEnv.markFunctionScope();
          pEnv.setLocal('this', thisObj ?? createObject(null));
          pEnv.setLocal('arguments', createArray(args));
          pEnv.setLocal('__thisClass', parentCtor);
          this.bindParams(pfn, pEnv, args);
          if (!parentCtor.properties.get('super')) this.initFields(parentCtor, thisObj);
          const pResult = this.execBlock((pfn.body as AST.BlockStatement).body as AST.Statement[], pEnv);
          if (isReturnSignal(pResult) && typeof pResult.value === 'object' && pResult.value !== null) {
            return pResult.value;
          }
        } else if (parentCtor.type === 'class') {
          // A base class without a constructor still has fields.
          if (!parentCtor.properties.get('super')) this.initFields(parentCtor, thisObj);
        } else if (thisObj && typeof thisObj === 'object') {
          // A built-in or ES5-function parent (class X extends Error / Map / EventTarget / F).
          // super() used to do nothing for these: `message`, a Map's storage etc. never reached
          // `this`. Run the parent, then let `this` adopt what it built (own properties and the
          // internal __slots), keeping the subclass's prototype chain.
          const parentFn = parentCtor as unknown as JSFunction & { nativeFn?: NativeFunction };
          const made = 'closure' in parentFn && !parentFn.isNative
            ? callJSFunction(parentFn, thisObj, args)
            : parentFn.nativeFn
              ? parentFn.nativeFn(thisObj, args)
              : undefined;
          if (made && typeof made === 'object' && made !== thisObj) {
            const target = thisObj as JSObject;
            for (const [k, d] of (made as JSObject).properties ?? []) {
              if (!target.properties.has(k)) target.properties.set(k, d);
            }
            for (const k of Object.keys(made as object)) {
              if (k.startsWith('__')) (target as unknown as Record<string, unknown>)[k] = (made as unknown as Record<string, unknown>)[k];
            }
          }
        }
        // This class's own fields are initialized when super() returns.
        this.initFields(env.get('__thisClass'), thisObj);
        return thisObj ?? createObject(null);
      }
      throw new TypeError('super() called outside of a derived class constructor');
    }

    // Evaluate callee and cache the member object to avoid double-evaluation
    // When callee is a.b(), we need both the function (a.b) and `this` (a),
    // but evaluating the member expression gives us the function, while we need
    // to separately get `this`. We avoid re-evaluating by caching.
    let thisObj: JSValue = undefined;
    let callee: JSValue;
    if (expr.callee.type === 'MemberExpression') {
      // super.method(): look up method on parent prototype, but use current 'this'
      if (expr.callee.object.type === 'SuperExpression') {
        const superProto = this.evalExpr(expr.callee.object, env);
        const key = expr.callee.computed ? toString(this.evalExpr(expr.callee.property, env)) : (expr.callee.property as AST.Identifier).name;
        callee = this.getPropertyValue(superProto, key);
        thisObj = env.get('this');
      } else {
        thisObj = this.evalExpr(expr.callee.object, env);
        if (thisObj === undefined || thisObj === null) {
          if (expr.callee.optional) return undefined;
          const missing = expr.callee.computed ? toString(this.evalExpr(expr.callee.property, env)) : (expr.callee.property as AST.Identifier).name;
          throw new TypeError(`Cannot read properties of ${thisObj} (reading '${missing}')`);
        }
        const key = expr.callee.computed ? toString(this.evalExpr(expr.callee.property, env)) : (expr.callee.property as AST.Identifier).name;
        callee = this.getPropertyValue(thisObj, key);
      }
    } else {
      callee = this.evalExpr(expr.callee, env);
    }

    const args: JSValue[] = [];
    for (const a of expr.arguments) {
      if (a.type === 'SpreadElement') {
        args.push(...this.spreadValues(this.evalExpr(a.argument, env)));
      } else {
        args.push(this.evalExpr(a, env));
      }
    }

    if (typeof callee === 'object' && callee !== null) {
      const fn = callee as JSFunction;
      if (fn.type === 'closure' && fn.isNative && fn.nativeFn) {
        try {
          const result = fn.nativeFn(thisObj, args) as JSValue;
          if (fn.async && this.eventLoop) return wrapAsyncResult(result, this.eventLoop);
          return result;
        } catch (err) {
          if (err instanceof JSError || err instanceof Error) throw err; // see callJSFunction
          throw new JSError(String(err));
        }
      }
      if (fn.type === 'closure' && !fn.isNative) return this.invokeClosure(fn, thisObj, args);
      // Object-as-function
      const callFn = (fn as unknown as JSObject).properties.get('call')?.value;
      if (typeof callFn === 'object' && callFn !== null && (callFn as JSFunction).type === 'closure') {
        return this.evalCall({ type: 'CallExpression', callee: callFn as unknown as AST.Expression, arguments: [expr.callee, ...expr.arguments], optional: false }, env);
      }
    }

    // Callable JSObject with nativeFn (e.g., Promise constructor)
    if (typeof callee === 'object' && callee !== null && 'callable' in callee && (callee as JSObject).callable && (callee as JSObject).nativeFn) {
      return (callee as JSObject).nativeFn!(thisObj, args) as JSValue;
    }

    if (typeof callee === 'function') {
      return (callee as Function)(...args) as JSValue;
    }

    if (expr.optional && (callee === undefined || callee === null)) return undefined;
    // Calling a non-function used to return undefined and carry on; browsers throw.
    throw new TypeError(`${calleeText(expr.callee)} is not a function`);
  }

  private evalNew(expr: AST.NewExpression, env: Environment): JSValue {
    const ctor = this.evalExpr(expr.callee, env);
    // Spread arguments (`new F(...args)`) were evaluated as undefined.
    const args = expr.arguments.flatMap(a => (a.type === 'SpreadElement' ? this.spreadValues(this.evalExpr(a.argument, env)) : [this.evalExpr(a, env)]));
    if (ctor === undefined || ctor === null || (typeof ctor !== 'object' && typeof ctor !== 'function')) {
      throw new TypeError(`${calleeText(expr.callee)} is not a constructor`);
    }

    // Class constructor (type: 'class' on a JSObject)
    if (typeof ctor === 'object' && ctor !== null && 'type' in ctor && (ctor as JSObject).type === 'class') {
      const classObj = ctor as JSObject;
      const classProto = classObj.prototype ?? createObject(null);
      const instance = createObject(classProto);

      const superClass = classObj.properties?.get('super')?.value;
      const initFn = classObj.properties?.get('constructor');
      if (!superClass) this.initFields(classObj, instance);

      if (initFn?.value && typeof initFn.value === 'object' && 'type' in initFn.value && (initFn.value as JSFunction).type === 'closure') {
        const fn = initFn.value as JSFunction;
        const callEnv = new Environment(fn.closure);
        callEnv.markFunctionScope();
        callEnv.setLocal('this', instance);
        callEnv.setLocal('arguments', createArray(args));
        callEnv.setLocal('__thisClass', classObj);

        if (superClass && typeof superClass === 'object' && superClass !== null) {
          // Set super to the parent prototype for super.x / super[expr] member access
          const superProto = constructorPrototype(superClass) ?? superClass;
          callEnv.setLocal('super', superProto);

          // Also store the parent constructor for super() calls
          callEnv.setLocal('__superCtor', superClass);
        }

        this.bindParams(fn, callEnv, args);
        const result = this.execBlock((fn.body as AST.BlockStatement).body as AST.Statement[], callEnv);
        if (isReturnSignal(result) && typeof result.value === 'object' && result.value !== null) {
          return result.value;
        }
      }

      return instance;
    }

    // Native function constructor (e.g. new IntersectionObserver(...))
    // Must be checked before closure since createNativeFunction uses type: 'closure'
    if (typeof ctor === 'object' && ctor !== null && 'isNative' in ctor && (ctor as JSFunction).isNative) {
      const fn = ctor as JSFunction;
      const instance = createObject(null);
      const result = callJSFunction(fn, instance, args);
      return (typeof result === 'object' && result !== null) ? result : instance;
    }

    // Callable JSObject with nativeFn (e.g., new Promise(...))
    if (typeof ctor === 'object' && ctor !== null && 'callable' in ctor && (ctor as JSObject).callable && (ctor as JSObject).nativeFn) {
      const obj = ctor as JSObject;
      const result = obj.nativeFn!(createObject(null), args);
      return (typeof result === 'object' && result !== null) ? result : createObject(null);
    }

    // Function constructor (JSFunction closure)
    if (typeof ctor === 'object' && ctor !== null && 'type' in ctor && (ctor as JSFunction).type === 'closure') {
      const fn = ctor as JSFunction;
      // Linked to F.prototype: it used to start empty, so methods put on F.prototype (all pre-class
      // code: jQuery plugins, closure library) were missing from `new F()`.
      const instance = createObject(functionPrototypeObject(fn));
      const callEnv = new Environment(fn.closure);
      callEnv.markFunctionScope();
      callEnv.setLocal('this', instance);
      callEnv.setLocal('arguments', createArray(args));
      this.bindParams(fn, callEnv, args);
      const bodyNode = fn.body as AST.BlockStatement | AST.Expression;
      if (bodyNode.type === 'BlockStatement') {
        const result = this.execBlock(bodyNode.body as AST.Statement[], callEnv);
        if (isReturnSignal(result) && typeof result.value === 'object' && result.value !== null) {
          return result.value;
        }
      }
      return instance;
    }

    return createObject(null);
  }

  private evalMember(expr: AST.MemberExpression, env: Environment): JSValue {
    const obj = this.evalExpr(expr.object, env);
    if (obj === undefined || obj === null) {
      if (expr.optional) return undefined;
      const missing = expr.computed ? toString(this.evalExpr(expr.property, env)) : (expr.property as AST.Identifier).name;
      throw new TypeError(`Cannot read properties of ${obj} (reading '${missing}')`);
    }
    if (typeof obj === 'string') {
      const key = expr.computed ? toString(this.evalExpr(expr.property, env)) : (expr.property as AST.Identifier).name;
      if (key === 'length') return (obj as string).length;
      const idx = parseInt(key, 10);
      if (!isNaN(idx)) return (obj as string)[idx] ?? undefined;
      const strMethods = stringMethods(obj as string);
      if (Object.prototype.hasOwnProperty.call(strMethods, key)) {
        return createNativeFunction(key, strMethods[key]);
      }
      return undefined;
    }
    const nativeObj = obj as JSObject;
    const key = expr.computed
      ? toString(this.evalExpr(expr.property, env))
      : (expr.property as AST.Identifier).name;

    // Closure (function) objects: provide .length, .name, .prototype, .constructor
    if ('type' in (nativeObj as any) && (nativeObj as any).type === 'closure') {
      const fn = nativeObj as unknown as JSFunction;
      if (key === 'length') return fn.params.length;
      if (key === 'name') return fn.name ?? '';
      if (key === 'arguments') return undefined;
      if (key === 'caller') return undefined;
      if (key === 'prototype' && !fn.isArrow) return functionPrototypeObject(fn);
      // call/apply/bind as values (`typeof fn.bind`, `var call = fn.call`); invoking them through
      // a member call is handled in evalCall, this covers everything else.
      const fnMethod = functionMethod(fn, key);
      if (fnMethod) return fnMethod;
      // For other properties, fall through to the general path
    }

    if (!nativeObj.properties) return undefined;
    const desc = nativeObj.properties.get(key);
    if (desc) {
      if (desc.getter) return callJSFunction(desc.getter, obj, []);
      return desc.value;
    }
    // TypedArray: delegate indexed access to __nativeView
    const typeOverride = (nativeObj as any).__type_override;
    if (typeOverride && typeof typeOverride === 'string' && typeOverride.endsWith('Array')) {
      const view = (nativeObj as any).__nativeView;
      if (view) {
        const idx = parseInt(key, 10);
        if (!isNaN(idx) && idx >= 0 && idx < view.length) return view[idx];
      }
    }
    if (nativeObj.prototype) {
      let proto: JSObject | null = nativeObj.prototype;
      while (proto) {
        const protoDesc = proto.properties.get(key);
        if (protoDesc) {
          if (protoDesc.getter) return callJSFunction(protoDesc.getter, obj, []);
          return protoDesc.value;
        }
        proto = proto.prototype;
      }
    }
    return objectPrototypeMember(key);
  }

  private getPropertyValue(obj: JSValue, key: string): JSValue {
    if (typeof obj === 'string') {
      const strMethods = stringMethods(obj as string);
      if (key === 'length') return (obj as string).length;
      const idx = parseInt(key, 10);
      if (!isNaN(idx)) return (obj as string)[idx] ?? undefined;
      if (Object.prototype.hasOwnProperty.call(strMethods, key)) return createNativeFunction(key, strMethods[key]);
      return undefined;
    }
    if (typeof obj === 'number') {
      const numMethods: Record<string, NativeFunction> = {
        toString: (_t: JSValue, a: JSValue[]) => a[0] === undefined ? toString(obj) : (obj as number).toString(toNumber(a[0])),
        valueOf: (_t: JSValue, _a: JSValue[]) => obj,
        toFixed: (_t, a) => (obj as number).toFixed(toNumber(a[0])),
        toPrecision: (_t, a) => (obj as number).toPrecision(toNumber(a[0])),
        toExponential: (_t, a) => (obj as number).toExponential(toNumber(a[0])),
        // It fell through to Object's "[object Object]". Locale and options go to the platform.
        toLocaleString: (_t: JSValue, a: JSValue[]) => (obj as number).toLocaleString(a[0] === undefined ? undefined : jsToPlain(a[0]) as string, jsToPlain(a[1]) as Intl.NumberFormatOptions),
      };
      if (key in numMethods) return createNativeFunction(key, numMethods[key]);
      return undefined;
    }
    if (typeof obj === 'boolean') {
      const boolMethods: Record<string, NativeFunction> = {
        toString: (_t: JSValue, _a: JSValue[]) => obj.toString(),
        valueOf: (_t: JSValue, _a: JSValue[]) => obj,
      };
      if (key in boolMethods) return createNativeFunction(key, boolMethods[key]);
      return undefined;
    }
    if (typeof obj === 'object' && obj !== null) {
      const o = obj as JSObject;
      // Function objects (closures): provide .length, .name, .prototype, .constructor
      if ('type' in o && (o as any).type === 'closure') {
        const fn = o as unknown as JSFunction;
        if (key === 'length') return fn.params.length;
        if (key === 'name') return fn.name ?? '';
        if (key === 'arguments') return undefined;
        if (key === 'caller') return undefined;
        const fnMethod = functionMethod(fn, key);
        if (fnMethod) return fnMethod;
        if (key === 'prototype' && !fn.isArrow) {
          const existing = o.properties?.get('prototype');
          if (existing) return existing.value;
          let protoObj = (o as any).__proto_obj;
          if (!protoObj) {
            protoObj = createObject(null);
            protoObj.properties.set('constructor', { value: o, writable: true, enumerable: false, configurable: true });
            (o as any).__proto_obj = protoObj;
          }
          return protoObj;
        }
        // Fall through to normal property lookup for other keys
      }
      if ((o as any).__type_override === 'symbol') {
        const symMethods: Record<string, NativeFunction> = {
          toString: (_t: JSValue, _a: JSValue[]) => {
            const desc = (o as any).symbolDescription ?? '';
            return `Symbol(${desc})`;
          },
          valueOf: (_t: JSValue, _a: JSValue[]) => o,
        };
        if (key in symMethods) return createNativeFunction(key, symMethods[key]);
        return undefined;
      }
      const desc = o.properties?.get(key);
      if (desc) {
        if (desc.getter) return callJSFunction(desc.getter, obj, []);
        return desc.value;
      }
      // TypedArray/ArrayBuffer/DataView: delegate indexed access to __nativeView
      const typeOverride = (o as any).__type_override;
      if (typeOverride && typeof typeOverride === 'string' && typeOverride.endsWith('Array')) {
        const view = (o as any).__nativeView;
        if (view) {
          const idx = parseInt(key, 10);
          if (!isNaN(idx) && idx >= 0 && idx < view.length) return view[idx];
          if (key === 'length') return view.length;
        }
      }
      if (o.prototype) {
        let proto: JSObject | null = o.prototype;
        while (proto) {
          const protoDesc = proto.properties.get(key);
          if (protoDesc) {
            if (protoDesc.getter) return callJSFunction(protoDesc.getter, obj, []);
            return protoDesc.value;
          }
          proto = proto.prototype;
        }
      }
      return objectPrototypeMember(key);
    }
    return undefined;
  }

  private evalArray(expr: AST.ArrayExpression, env: Environment): JSValue {
    const elements: JSValue[] = [];
    for (const e of expr.elements) {
      if (!e) { elements.push(undefined); continue; }
      // [...x] used to put x itself in as one element: [...nodeList] was [nodeList].
      if (e.type === 'SpreadElement') elements.push(...this.spreadValues(this.evalExpr(e.argument, env)));
      else elements.push(this.evalExpr(e, env));
    }
    return createArray(elements);
  }

  /** Values of a spread operand: arrays and array-likes by index, strings by character. */
  private spreadValues(v: JSValue): JSValue[] {
    if (Array.isArray(v)) return v;
    return [...iterateJS(v)];
  }

  private evalObject(expr: AST.ObjectExpression, env: Environment): JSValue {
    const obj = createObject(null);
    for (const prop of expr.properties) {
      if (prop.type === 'SpreadElement') {
        const spread = this.evalExpr(prop.argument, env);
        if (typeof spread === 'object' && spread !== null) {
          for (const [k, v] of (spread as JSObject).properties ?? []) {
            if (v.enumerable === false) continue; // array methods / length are not copied
            obj.properties.set(k, { value: v.getter ? callJSFunction(v.getter, spread, []) : v.value, writable: true, enumerable: true, configurable: true });
          }
        }
        continue;
      }
      const key = prop.computed
        ? toString(this.evalExpr(prop.key, env))
        : prop.key.type === 'Identifier' ? prop.key.name : String(prop.key);
      const value = prop.value ? this.evalExpr(prop.value, env) : undefined;
      if (prop.kind === 'get' || prop.kind === 'set') {
        // `get x() {}` / `set x(v) {}`: accessor descriptors (they used to be stored as plain
        // values, so reading o.x returned the function itself).
        const existing = obj.properties.get(key);
        obj.properties.set(key, {
          value: undefined, writable: true, enumerable: true, configurable: true,
          getter: prop.kind === 'get' ? value as JSFunction : existing?.getter,
          setter: prop.kind === 'set' ? value as JSFunction : existing?.setter,
        });
        continue;
      }
      obj.properties.set(key, { value, writable: true, enumerable: true, configurable: true });
    }
    return obj;
  }

  private evalFunctionExpr(expr: AST.FunctionExpression, env: Environment): JSValue {
    return makeFunction(expr.id?.name ?? 'anonymous', expr.params, expr.body, env, expr.async, false, expr.generator, expr.strictMode);
  }

  private evalArrowFunction(expr: AST.ArrowFunctionExpression, env: Environment): JSValue {
    const strict = expr.body.type === 'BlockStatement' ? this.hasStrictDirective(expr.body) : false;
    return makeFunction('anonymous', expr.params, expr.body, env, expr.async, true, false, strict);
  }

  private evalSequence(expr: AST.SequenceExpression, env: Environment): JSValue {
    let result: JSValue;
    for (const e of expr.expressions) {
      result = this.evalExpr(e, env);
    }
    return result!;
  }

  private evalAwait(expr: AST.AwaitExpression, env: Environment): JSValue {
    const val = this.evalExpr(expr.argument, env);
    // If value is a pending Promise, throw AwaitSignal to suspend execution
    if (typeof val === 'object' && val !== null && isPromiseObject(val)) {
      if (isPromiseFulfilled(val)) {
        // Already fulfilled — extract value
        return getPromiseResult(val);
      }
      if (isPromiseRejected(val)) {
        // Already rejected — throw the reason
        throw new JSError(getPromiseResult(val));
      }
      // Pending — suspend and resume via microtask
      if (this.eventLoop) {
        throw { type: 'await', promise: val, continuation: (resolved: JSValue) => resolved } as AwaitSignal;
      }
    }
    return val;
  }

  private evalYield(expr: AST.YieldExpression, env: Environment): JSValue {
    const val = expr.argument ? this.evalExpr(expr.argument, env) : undefined;
    return val;
  }

  /** Check if a block statement body starts with a 'use strict' directive. */
  private hasStrictDirective(body: AST.BlockStatement): boolean {
    if (!body.body.length) return false;
    const first = body.body[0];
    if (first.type !== 'ExpressionStatement') return false;
    const expr = first.expression;
    if (expr.type !== 'Literal') return false;
    return expr.value === 'use strict';
  }

  // ── Global environment setup ─────────────────────────────────────────────

  createGlobalEnv(): Environment {
    const env = new Environment();
    env.markFunctionScope();
    env.setLocal('this', createObject(null));

    // console
    const consoleObj = createObject(null);
    consoleObj.properties.set('log', {
      value: createNativeFunction('log', (_this, args) => {
        this.output.push(args.map(a => toString(a)).join(' '));
        if (this.output.length > Interpreter.MAX_OUTPUT) this.output.splice(0, this.output.length - Interpreter.MAX_OUTPUT);
        return undefined;
      }),
      writable: true, enumerable: true, configurable: true,
    });
    consoleObj.properties.set('error', {
      value: createNativeFunction('error', (_this, args) => {
        this.output.push('ERROR: ' + args.map(a => toString(a)).join(' '));
        if (this.output.length > Interpreter.MAX_OUTPUT) this.output.splice(0, this.output.length - Interpreter.MAX_OUTPUT);
        return undefined;
      }),
      writable: true, enumerable: true, configurable: true,
    });
    consoleObj.properties.set('warn', {
      value: createNativeFunction('warn', (_this, args) => {
        this.output.push('WARN: ' + args.map(a => toString(a)).join(' '));
        if (this.output.length > Interpreter.MAX_OUTPUT) this.output.splice(0, this.output.length - Interpreter.MAX_OUTPUT);
        return undefined;
      }),
      writable: true, enumerable: true, configurable: true,
    });
    env.setLocal('console', consoleObj);

    // Math
    const mathObj = createObject(null);
    mathObj.properties.set('PI', { value: Math.PI, writable: false, enumerable: false, configurable: false });
    mathObj.properties.set('E', { value: Math.E, writable: false, enumerable: false, configurable: false });
    mathObj.properties.set('floor', { value: createNativeFunction('floor', (_this, args) => Math.floor(toNumber(args[0]))), writable: true, enumerable: true, configurable: true });
    mathObj.properties.set('ceil', { value: createNativeFunction('ceil', (_this, args) => Math.ceil(toNumber(args[0]))), writable: true, enumerable: true, configurable: true });
    mathObj.properties.set('round', { value: createNativeFunction('round', (_this, args) => Math.round(toNumber(args[0]))), writable: true, enumerable: true, configurable: true });
    mathObj.properties.set('abs', { value: createNativeFunction('abs', (_this, args) => Math.abs(toNumber(args[0]))), writable: true, enumerable: true, configurable: true });
    mathObj.properties.set('sqrt', { value: createNativeFunction('sqrt', (_this, args) => Math.sqrt(toNumber(args[0]))), writable: true, enumerable: true, configurable: true });
    mathObj.properties.set('pow', { value: createNativeFunction('pow', (_this, args) => Math.pow(toNumber(args[0]), toNumber(args[1]))), writable: true, enumerable: true, configurable: true });
    mathObj.properties.set('log', { value: createNativeFunction('log', (_this, args) => Math.log(toNumber(args[0]))), writable: true, enumerable: true, configurable: true });
    mathObj.properties.set('sin', { value: createNativeFunction('sin', (_this, args) => Math.sin(toNumber(args[0]))), writable: true, enumerable: true, configurable: true });
    mathObj.properties.set('cos', { value: createNativeFunction('cos', (_this, args) => Math.cos(toNumber(args[0]))), writable: true, enumerable: true, configurable: true });
    mathObj.properties.set('tan', { value: createNativeFunction('tan', (_this, args) => Math.tan(toNumber(args[0]))), writable: true, enumerable: true, configurable: true });
    mathObj.properties.set('max', { value: createNativeFunction('max', (_this, args) => Math.max(...args.map(toNumber))), writable: true, enumerable: true, configurable: true });
    mathObj.properties.set('min', { value: createNativeFunction('min', (_this, args) => Math.min(...args.map(toNumber))), writable: true, enumerable: true, configurable: true });
    mathObj.properties.set('random', { value: createNativeFunction('random', () => Math.random()), writable: true, enumerable: true, configurable: true });
    env.setLocal('Math', mathObj);

    env.setLocal('parseInt', createNativeFunction('parseInt', (_this, args) => parseInt(toString(args[0]), toNumber(args[1]) || 10)));
    env.setLocal('parseFloat', createNativeFunction('parseFloat', (_this, args) => parseFloat(toString(args[0]))));
    env.setLocal('isNaN', createNativeFunction('isNaN', (_this, args) => isNaN(toNumber(args[0]))));
    env.setLocal('isFinite', createNativeFunction('isFinite', (_this, args) => isFinite(toNumber(args[0]))));
    env.setLocal('encodeURI', createNativeFunction('encodeURI', (_this, args) => encodeURI(toString(args[0]))));
    env.setLocal('decodeURI', createNativeFunction('decodeURI', (_this, args) => decodeURI(toString(args[0]))));
    env.setLocal('encodeURIComponent', createNativeFunction('encodeURIComponent', (_this, args) => encodeURIComponent(toString(args[0]))));
    env.setLocal('decodeURIComponent', createNativeFunction('decodeURIComponent', (_this, args) => decodeURIComponent(toString(args[0]))));
    env.setLocal('String', createNativeFunction('String', (_this, args) => toString(args[0])));
    env.setLocal('Number', createNativeFunction('Number', (_this, args) => toNumber(args[0])));
    env.setLocal('Boolean', createNativeFunction('Boolean', (_this, args) => toBoolean(args[0])));
    env.setLocal('Array', createNativeFunction('Array', (_this, args) => createArray(args)));
    env.setLocal('Object', createNativeFunction('Object', (_this, args) => {
      if (typeof args[0] === 'object' && args[0] !== null) return args[0];
      return createObject(null);
    }));

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
    env.setLocal('JSON', (() => {
      const json = createObject(null);
      json.properties.set('parse', { value: createNativeFunction('parse', (_this, args) => { try { return toJSValue(JSON.parse(toString(args[0]))); } catch { return undefined; } }), writable: true, enumerable: true, configurable: true });
      json.properties.set('stringify', { value: createNativeFunction('stringify', (_this, args) => { const r = jsonStrify(args[0]); return r === undefined ? undefined : r; }), writable: true, enumerable: true, configurable: true });
      return json;
    })());
    env.setLocal('TypeError', createNativeFunction('TypeError', (_this, args) => toString(args[0])));
    env.setLocal('ReferenceError', createNativeFunction('ReferenceError', (_this, args) => toString(args[0])));
    env.setLocal('Error', createNativeFunction('Error', (_this, args) => toString(args[0])));
    env.setLocal('RangeError', createNativeFunction('RangeError', (_this, args) => toString(args[0])));
    env.setLocal('SyntaxError', createNativeFunction('SyntaxError', (_this, args) => toString(args[0])));

    // Promise (with microtask integration via EventLoop)
    const promiseEnv = env;
    env.setLocal('Promise', createPromiseConstructor(this.eventLoop ?? {
      enqueueMicrotask: (fn: () => void) => { try { fn(); } catch { /* swallow */ } },
      drainMicrotasks: () => 0,
    } as any));

    // queueMicrotask / process.nextTick
    if (this.eventLoop) {
      bindQueueMicrotask(env, this.eventLoop);
    } else {
      // Fallback: synchronous microtask queue
      env.setLocal('queueMicrotask', createNativeFunction('queueMicrotask', (_this, args) => {
        const fn = args[0];
        if (typeof fn === 'object' && fn !== null && (fn as JSFunction).type === 'closure') {
          try { callJSFunction(fn as JSFunction, undefined, []); } catch { /* swallow */ }
        }
        return undefined;
      }));
    }

    env.setLocal('setTimeout', createNativeFunction('setTimeout', (_this, args) => {
      const fn = args[0];
      const delay = toNumber(args[1]) || 0;

      // CSP enforcement: block setTimeout("code", ms) string form
      if (typeof fn === 'string' || typeof fn === 'number') {
        if (this.scriptEnforcer && this.pageOrigin) {
          const codeSample = String(fn).slice(0, 40);
          const check = this.scriptEnforcer.checkTimerString(this.pageOrigin, this.pageOrigin, codeSample);
          if (!check.allowed) {
            throw new Error(`TimeoutError: ${check.reason}`);
          }
        }
        return 0 as unknown as JSValue;
      }

      if (typeof fn === 'object' && fn !== null && (fn as JSFunction).type === 'closure') {
        const jsFn = fn as JSFunction;
        const id = this.nextTimerId++;
        this.timers.set(id, {
          fn: () => {
            const callEnv = new Environment(jsFn.closure);
            callEnv.markFunctionScope();
            const bodyNode = jsFn.body as AST.BlockStatement | AST.Expression;
            if (bodyNode.type === 'BlockStatement') {
              this.execBlock(bodyNode.body as AST.Statement[], callEnv);
            } else {
              this.evalExpr(bodyNode as AST.Expression, callEnv);
            }
          },
          delay,
          recurring: false,
        });
        return id as unknown as JSValue;
      }
      return 0 as unknown as JSValue;
    }));
    env.setLocal('setInterval', createNativeFunction('setInterval', (_this, args) => {
      const fn = args[0];
      const delay = toNumber(args[1]) || 0;

      // CSP enforcement: block setInterval("code", ms) string form
      if (typeof fn === 'string' || typeof fn === 'number') {
        if (this.scriptEnforcer && this.pageOrigin) {
          const codeSample = String(fn).slice(0, 40);
          const check = this.scriptEnforcer.checkTimerString(this.pageOrigin, this.pageOrigin, codeSample);
          if (!check.allowed) {
            throw new Error(`TimeoutError: ${check.reason}`);
          }
        }
        return 0 as unknown as JSValue;
      }

      if (typeof fn === 'object' && fn !== null && (fn as JSFunction).type === 'closure') {
        const jsFn = fn as JSFunction;
        const id = this.nextTimerId++;
        this.timers.set(id, {
          fn: () => {
            const callEnv = new Environment(jsFn.closure);
            callEnv.markFunctionScope();
            const bodyNode = jsFn.body as AST.BlockStatement | AST.Expression;
            if (bodyNode.type === 'BlockStatement') {
              this.execBlock(bodyNode.body as AST.Statement[], callEnv);
            } else {
              this.evalExpr(bodyNode as AST.Expression, callEnv);
            }
          },
          delay,
          recurring: true,
        });
        return id as unknown as JSValue;
      }
      return 0 as unknown as JSValue;
    }));
    env.setLocal('clearTimeout', createNativeFunction('clearTimeout', (_this, args) => {
      const id = toNumber(args[0]);
      this.timers.delete(id);
      return undefined;
    }));
    env.setLocal('clearInterval', createNativeFunction('clearInterval', (_this, args) => {
      const id = toNumber(args[0]);
      this.timers.delete(id);
      return undefined;
    }));

    // eval()
    const self = this; // eslint-disable-line @typescript-eslint/no-this-alias
    env.setLocal('eval', createNativeFunction('eval', (_this, args) => {
      const code = toString(args[0]);

      // CSP enforcement: check eval() against script-src policy
      if (self.scriptEnforcer && self.pageOrigin) {
        const check = self.scriptEnforcer.checkEval(self.pageOrigin, self.pageOrigin, code);
        if (!check.allowed) {
          throw new Error(`EvalError: ${check.reason}`);
        }
      }

      const lexer = new Lexer(code);
      const parser = new Parser([], lexer);
      const program = parser.parse();
      const interp = new Interpreter(env, self.eventLoop, self.scriptEnforcer, self.pageOrigin);
      interp.setMaxExecutionMs(self.maxExecutionMs);
      return interp.run(program);
    }));

    return env;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
export { JSError };
