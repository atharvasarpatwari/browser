import type * as AST from './ast';
import {
  Environment,
  type JSValue, type JSObject, type JSFunction, type NativeFunction,
  toBoolean, toNumber, toString, toPropertyKey, getType, instanceofCheck,
  createObject, createArray, createFunction, createNativeFunction,
  isBreakSignal, isContinueSignal, isReturnSignal, isThrowSignal, isAwaitSignal,
  type BreakSignal, type ContinueSignal, type ReturnSignal, type ThrowSignal, type AwaitSignal,
  setGlobalCaller, getGlobalCaller, callJSFunction, JSError, isJSObjectWithMeta, makeErrorObject,
  objectPrototypeToStringTag,
} from './values';
import { GarbageCollector, getGC } from './gc';
import { createPromiseConstructor, wrapAsyncResult, isPromiseObject, isPromiseFulfilled, isPromiseRejected, isPromisePending, getPromiseResult, createPromiseObj, fulfillPromise, rejectPromise } from './promise';
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

// Internal validation errors (bad member access, illegal `super()`, CSP
// rejections, etc.) must be raised as JSError-wrapped values, not native
// TS Error instances — a native throw here unwinds straight past every
// sandboxed try/catch (execTry only recognizes JSError) and silently kills
// the rest of the running script.
// Assignment (`obj.x = v`) only ever checked obj's OWN properties for an
// existing setter — a setter (or getter) declared on a class/object
// PROTOTYPE (every non-static class accessor: `set label(v) {...}`) was
// invisible here, so assigning through it silently fell back to just
// creating a same-named plain value property directly on the instance,
// shadowing the accessor instead of invoking it. Reads already walked the
// prototype chain correctly (getPropertyValue/evalMember); writes didn't.
function findPropertyDescriptor(obj: JSObject, key: string) {
  let cur: JSObject | null = obj;
  while (cur) {
    // cur.properties can be undefined here — a plain function/closure
    // (createFunction's result, e.g. `function Ctor(){}`) has no
    // .properties map at all, and assigning straight to one of those
    // (`Ctor.prototype = ...`) reaches this walk with such an object as
    // `obj` on the very first iteration.
    const desc = cur.properties?.get(key);
    if (desc) return desc;
    cur = cur.prototype;
  }
  return undefined;
}

function jsError(name: string, message: string): JSError {
  // makeErrorObject links the built error to whatever prototype index.ts
  // registered for `name` (TypeError, RangeError, ...), so `e instanceof
  // TypeError` works for engine-thrown errors exactly like it does for
  // ones a script builds itself via `new TypeError(...)` — a plain
  // createObject(null) here (this function's original body) has no such
  // link, so instanceof against any Error subtype was always false.
  return new JSError(makeErrorObject(name, message));
}

// Every "plain callable JSObject" constructor built this session (URL,
// URLSearchParams, FormData, TextEncoder, TextDecoder, the fuller Array/
// Number redefinitions, regex-literal construction) throws real native
// errors when given bad input (`new URL('not a url')` really does throw
// from the underlying native URL parser) — but three of the four places
// that invoke a JSObject's own `.nativeFn` called it completely
// unwrapped, so any such throw escaped every sandboxed try/catch exactly
// like the try/catch-escape bug fixed earlier the same day, just at call
// sites that bug-hunt hadn't reached yet. Centralized here so a future
// native-callable dispatch site can't reintroduce the same gap silently.
function callNativeSafe(fn: NativeFunction, thisArg: JSValue, args: JSValue[]): JSValue {
  try {
    return fn(thisArg, args) as JSValue;
  } catch (err) {
    if (err instanceof JSError) throw err;
    throw jsError(err instanceof Error ? err.name : 'Error', err instanceof Error ? err.message : String(err));
  }
}

// A match/search/replace pattern argument may be a real regex object
// (built from a regex literal or `new RegExp(...)`, carrying a native
// RegExp on .nativeRegExp) or a plain string pattern.
function toNativeRegex(pattern: JSValue, forceFlags = ''): RegExp {
  if (typeof pattern === 'object' && pattern !== null && isJSObjectWithMeta(pattern) && pattern.nativeRegExp) {
    const re = pattern.nativeRegExp;
    const flags = [...new Set((re.flags + forceFlags).split(''))].join('');
    return flags === re.flags ? re : new RegExp(re.source, flags);
  }
  return new RegExp(toString(pattern), forceFlags);
}

// String.prototype.replace/replaceAll: the search pattern may be a real
// regex object (nativeRegExp) or a plain string, and the replacement may be
// a callable JSFunction (bridged into a native replacer) or a plain string.
function stringReplaceImpl(str: string, pattern: JSValue, replacement: JSValue, all: boolean): string {
  let nativePattern: string | RegExp = toString(pattern);
  if (typeof pattern === 'object' && pattern !== null && isJSObjectWithMeta(pattern) && pattern.nativeRegExp) {
    nativePattern = pattern.nativeRegExp;
    if (all && !nativePattern.flags.includes('g')) {
      nativePattern = new RegExp(nativePattern.source, nativePattern.flags + 'g');
    }
  }
  const isFn = typeof replacement === 'object' && replacement !== null && (replacement as JSFunction).type === 'closure';
  const replacer = isFn
    ? (...args: unknown[]) => toString(callJSFunction(replacement as JSFunction, undefined, args as JSValue[]))
    : toString(replacement ?? '');
  if (all && typeof nativePattern === 'string') {
    return str.split(nativePattern).join(typeof replacer === 'string' ? replacer : '');
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (str as any).replace(nativePattern, replacer);
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
  /** Stack of in-flight generator-body yield sinks (see runGeneratorBody) */
  private yieldSinkStack: JSValue[][] = [];

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
    // Save whatever caller was registered before this run() (e.g. the outer
    // script's own interpreter, when this run() belongs to a nested eval())
    // so it can be restored below instead of always clearing to null —
    // otherwise eval() permanently breaks every getter/setter and other
    // callJSFunction-mediated call for the rest of the OUTER script, since
    // that call path has no direct reference to "this" interpreter and
    // relies entirely on the global registration staying correct.
    const previousCaller = getGlobalCaller();
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
      setGlobalCaller(previousCaller);
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
        throw jsError(err instanceof Error ? err.name : 'Error', err instanceof Error ? err.message : String(err));
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
    if (fn.generator) return this.runGeneratorBody(fn, thisArg, args);
    const callEnv = new Environment(fn.closure);
    callEnv.markFunctionScope();
    callEnv.setLocal('arguments', createArray(args));
    this.bindParams(fn, callEnv, args);
    if (thisArg === undefined && !fn.isStrict) {
      callEnv.setLocal('this', this.globalEnv.get('this') ?? createObject(null));
    } else {
      callEnv.setLocal('this', thisArg);
    }
    const bodyNode = fn.body as AST.BlockStatement | AST.Expression;
    let result: JSValue | BreakSignal | ContinueSignal | ReturnSignal | ThrowSignal;
    try {
      if (bodyNode.type === 'BlockStatement') {
        result = this.execBlock(bodyNode.body as AST.Statement[], callEnv);
      } else {
        result = this.evalExpr(bodyNode as AST.Expression, callEnv);
      }
    } catch (err) {
      if (fn.async && this.eventLoop && isAwaitSignal(err)) {
        return this.handleAsyncAwait(err as AwaitSignal, fn, thisArg, args);
      }
      throw err;
    }
    if (fn.async && this.eventLoop && isAwaitSignal(result)) {
      return this.handleAsyncAwait(result as AwaitSignal, fn, thisArg, args);
    }
    if (isReturnSignal(result)) {
      if (fn.async && this.eventLoop) return wrapAsyncResult(result.value, this.eventLoop);
      return result.value;
    }
    if (isThrowSignal(result)) throw new JSError(result.value);
    if (fn.async && this.eventLoop) return wrapAsyncResult(result as JSValue, this.eventLoop);
    return result as JSValue;
  }

  /** Handle async function awaiting a pending Promise — set up microtask resumption */
  private handleAsyncAwait(signal: AwaitSignal, fn: JSFunction, thisArg: JSValue, args: JSValue[]): JSValue {
    if (!this.eventLoop) return signal.promise;
    const continuationPromise = createPromiseObj(this.eventLoop);
    this.eventLoop.enqueueMicrotask(() => {
      const thenFn = (signal.promise as JSObject).properties.get('then')?.value as JSFunction;
      if (thenFn && typeof thenFn === 'object' && (thenFn as JSFunction).type === 'closure') {
        const onFulfilled = createNativeFunction('onFulfilled', (_th, fArgs) => {
          const resolvedValue = fArgs[0];
          try {
            // Resume execution from the continuation
            const callEnv = new Environment(fn.closure);
            callEnv.markFunctionScope();
            callEnv.setLocal('arguments', createArray(args));
            this.bindParams(fn, callEnv, args);
            callEnv.setLocal('this', thisArg);
            // We need to re-execute with the resolved value... but we can't easily do that.
            // Instead, resolve the continuation promise with the resolved value.
            fulfillPromise(continuationPromise, resolvedValue);
          } catch (err) {
            rejectPromise(continuationPromise, err instanceof Error ? err.message : String(err));
          }
          return undefined;
        });
        const onRejected = createNativeFunction('onRejected', (_th, rArgs) => {
          rejectPromise(continuationPromise, rArgs[0]);
          return undefined;
        });
        try {
          callJSFunction(thenFn, signal.promise, [onFulfilled, onRejected]);
        } catch (err) {
          rejectPromise(continuationPromise, err instanceof Error ? err.message : String(err));
        }
      } else {
        fulfillPromise(continuationPromise, signal.promise);
      }
    });
    return continuationPromise;
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
      case 'BlockStatement': return this.execBlock(stmt.body, env);
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

  private destructPattern(pattern: AST.Identifier | AST.RestElement | AST.AssignmentPattern | AST.ArrayPattern | AST.ObjectPattern, value: JSValue, env: Environment, kind: 'var' | 'let' | 'const'): void {
    if (pattern.type === 'Identifier') {
      const name = pattern.name;
      if (kind === 'const' || kind === 'let') {
        // TDZ: initialize the binding (clears TDZ state)
        env.initialize(name, value);
      } else {
        env.declare(name, value, 'var');
      }
    } else if (pattern.type === 'AssignmentPattern') {
      const val = value === undefined || value === null ? this.evalExpr(pattern.right, env) : value;
      this.destructPattern(pattern.left, val, env, kind);
    } else if (pattern.type === 'ArrayPattern') {
      const arr = value as JSObject;
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
          const key = prop.key.type === 'Identifier' ? prop.key.name : toPropertyKey(this.evalExpr(prop.key, env));
          const propVal = obj?.properties?.get(key)?.value;
          this.destructPattern(prop.value as any, propVal, env, kind);
        }
      }
    }
  }

  // Every function call bound parameters with a plain positional zip
  // (`fn.params.forEach((p,i) => env.setLocal(p, args[i]))`), which only
  // works for plain identifier params. `createFunction`'s own call sites
  // reduced every parameter — including `...rest`, `a = 5`, `[a,b]`,
  // `{a,b}` — down to `(p as AST.Identifier).name`, which for anything but
  // a plain identifier reads a field that doesn't exist and silently binds
  // a parameter literally named "undefined": a rest parameter's own name
  // was never in scope at all. Reuses destructPattern (already correct for
  // `var`/`let`/`const` destructuring) now that paramNodes preserves the
  // real parameter AST instead of discarding it at creation time.
  private bindParams(fn: JSFunction, callEnv: Environment, args: JSValue[]): void {
    const nodes = fn.paramNodes as (AST.Identifier | AST.RestElement | AST.AssignmentPattern | AST.ArrayPattern | AST.ObjectPattern)[] | undefined;
    if (!nodes) {
      fn.params.forEach((p, i) => callEnv.setLocal(p, args[i]));
      return;
    }
    let idx = 0;
    for (const node of nodes) {
      if (node.type === 'RestElement') {
        this.destructPattern(node.argument as AST.Identifier, createArray(args.slice(idx)), callEnv, 'var');
      } else {
        this.destructPattern(node, args[idx], callEnv, 'var');
        idx++;
      }
    }
  }

  private execFuncDecl(stmt: AST.FunctionDeclaration, env: Environment): void {
    const fn = createFunction(stmt.id.name, stmt.params.map(p => (p as AST.Identifier).name), stmt.body, env, stmt.async, false, stmt.generator, false, undefined, stmt.strictMode, stmt.params);
    env.declare(stmt.id.name, fn, 'var');
  }

  private execClassDecl(stmt: AST.ClassDeclaration, env: Environment): void {
    const classObj = this.buildClassObject(stmt, env);
    if (stmt.id) env.declare(stmt.id.name, classObj, 'var');
  }

  /** Shared by execClassDecl() (class as a statement) and evalExpr()'s ClassDeclaration case (class as an expression, e.g. `var x = class {}`). */
  private buildClassObject(stmt: AST.ClassDeclaration, env: Environment): JSObject {
    const className = stmt.id?.name ?? '';
    const classProto = createObject(null);

    const classObj: JSObject = {
      type: 'class',
      properties: new Map(),
      prototype: classProto,
      callable: true,
    };
    (classObj as JSObject & { __classClosure?: Environment }).__classClosure = env;

    // Set up prototype with constructor
    classProto.properties.set('constructor', {
      value: { type: 'closure', properties: new Map(), name: className, params: [], body: { type: 'BlockStatement', body: [] }, closure: env, async: false, generator: false, isArrow: false, isNative: false } as JSFunction,
      writable: true, enumerable: false, configurable: true,
    });

    // Handle inheritance
    if (stmt.superClass) {
      const superClass = this.evalExpr(stmt.superClass, env);
      if (typeof superClass === 'object' && superClass !== null) {
        const superProto = (superClass as JSObject).prototype;
        if (superProto) classProto.prototype = superProto;
        classObj.properties.set('super', { value: superClass, writable: false, enumerable: false, configurable: false });
      }
    }

    // Every method's closure previously WAS `env` itself — the same,
    // shared enclosing-scope environment for every class declared there —
    // and `super`/`__superCtor` were bound onto it with setLocal(), which
    // mutates in place. Two classes in the same scope (`class B extends A
    // {}`, `class C extends B {}` at top level, an extremely ordinary
    // pattern) meant building C overwrote the *same* environment's `super`
    // that B's own methods had already captured, so calling B's method
    // later saw C's superclass instead of A — `super.greet()` inside B
    // resolved to B's own prototype, recursing into itself forever. Each
    // class now gets its own child environment to bind `super` on, so
    // sibling/later classes in the same scope can never retroactively
    // change an earlier class's methods' idea of `super`.
    // Static methods need a *different* super binding than instance
    // methods: `super.staticMethod()` resolves against the parent CLASS
    // OBJECT itself, not the parent's instance prototype — reusing one
    // shared closure/binding for both would make static super calls
    // resolve against the wrong target (a static super lookup landing on
    // the instance prototype instead, where the parent's static method
    // was never stored, always returning undefined).
    const classClosureEnv = new Environment(env);
    const staticClosureEnv = new Environment(env);
    // A class binds its own name in an inner scope wrapping its body (like a
    // named function expression) — this class isn't necessarily bound to
    // that name in any OUTER scope yet (a static field/block runs during
    // buildClassObject, before the `class C {}` declaration finishes binding
    // C in the enclosing scope) or ever (a named class *expression*,
    // `class Named {}` assigned to some other variable, never binds `Named`
    // anywhere outside itself). Without this, the common self-referencing
    // static-initializer idiom (`class Singleton { static instance = new
    // Singleton(); }`) saw its own name as undefined.
    if (className) {
      classClosureEnv.setLocal(className, classObj);
      staticClosureEnv.setLocal(className, classObj);
    }
    const superClassVal = classObj.properties.get('super')?.value;
    if (superClassVal && typeof superClassVal === 'object' && superClassVal !== null) {
      const superProto = (superClassVal as JSObject).prototype ?? superClassVal;
      classClosureEnv.setLocal('super', superProto);
      classClosureEnv.setLocal('__superCtor', superClassVal);
      staticClosureEnv.setLocal('super', superClassVal);
      staticClosureEnv.setLocal('__superCtor', superClassVal);
    }

    // Store methods from body
    let hasConstructor = false;
    if (stmt.body.type === 'ClassBody') {
      for (const method of stmt.body.body) {
        if (method.type === 'MethodDefinition') {
          // A computed key (`[expr]() {}`) needs evaluating; previously this
          // did native String(method.key) — stringifying the AST node
          // object itself ("[object Object]") rather than evaluating the
          // expression it holds, so every computed method name collided.
          const key = !method.computed && method.key.type === 'Identifier' ? method.key.name : toPropertyKey(this.evalExpr(method.key, env));
          const fn = createFunction(key, method.value.params.map(p => (p as AST.Identifier).name), method.value.body, method.static ? staticClosureEnv : classClosureEnv, false, false, false, false, undefined, true, method.value.params);
          if (key === 'constructor') {
            hasConstructor = true;
            classObj.properties.set('constructor', { value: fn, writable: true, enumerable: true, configurable: true });
            classProto.properties.set('constructor', { value: fn, writable: true, enumerable: false, configurable: true });
          } else {
            // Real class methods and accessors are non-enumerable (unlike
            // object-literal methods) — this matters now that for-in
            // filters by the enumerable flag instead of listing every
            // property regardless of it.
            const target = method.static ? classObj : classProto;
            if (method.kind === 'get' || method.kind === 'set') {
              const existing = target.properties.get(key);
              target.properties.set(key, {
                value: undefined, writable: false,
                getter: method.kind === 'get' ? fn : existing?.getter,
                setter: method.kind === 'set' ? fn : existing?.setter,
                enumerable: false, configurable: true,
              });
            } else {
              target.properties.set(key, { value: fn, writable: true, enumerable: false, configurable: true });
            }
          }
        } else if (method.type === 'PropertyDefinition') {
          // Class fields (`x = 1`, `static y = 2`) were silently skipped
          // entirely — this loop only ever matched MethodDefinition, so a
          // field declaration parsed fine but never became a real
          // property on anything. Static fields evaluate immediately (with
          // `this` bound to the class itself, per spec); instance fields
          // are deferred to evalNew, run per-instance with `this` bound to
          // the new instance, since their initializer can reference it.
          const key = !method.computed && method.key.type === 'Identifier' ? method.key.name : toPropertyKey(this.evalExpr(method.key, env));
          if (method.static) {
            // Closes over staticClosureEnv (not the plain outer env) so a
            // static field initializer gets the same super/__superCtor and
            // self-name bindings a static method or static block gets —
            // it previously closed over `env` directly, so `static x =
            // super.baseValue` or `static y = Singleton.other` (self-
            // reference) silently saw `super`/the class's own name as
            // undefined instead of resolving them.
            const staticEnv = new Environment(staticClosureEnv);
            staticEnv.setLocal('this', classObj);
            const value = method.value ? this.evalExpr(method.value, staticEnv) : undefined;
            classObj.properties.set(key, { value, writable: true, enumerable: true, configurable: true });
          } else {
            const withFields = classObj as JSObject & { __instanceFields?: { key: string; value: unknown }[] };
            (withFields.__instanceFields ??= []).push({ key, value: method.value });
          }
        } else if (method.type === 'StaticBlock') {
          // `static { ... }` runs once, immediately, in declaration order
          // among the class's other static elements (fields execute this
          // same way, right above) — with `this` bound to the class and
          // `super` available exactly like a static method. This was
          // entirely unimplemented: the parser had no way to even produce
          // this node, so a static block either failed to parse outright
          // or (when it happened to parse as *something* by accident) was
          // silently discarded — its side effects never ran.
          const blockEnv = new Environment(staticClosureEnv);
          blockEnv.markFunctionScope();
          blockEnv.setLocal('this', classObj);
          const result = this.execBlock(method.body, blockEnv);
          if (isThrowSignal(result)) throw new JSError(result.value);
        }
      }
    }

    // Generate default constructor for derived classes without one
    if (!hasConstructor && stmt.superClass) {
      // Must close over classClosureEnv (which has __superCtor bound to
      // THIS class's own superclass), not the plain outer env — this
      // constructor's whole body is `super(...)`, and when a grandchild
      // class's own super() call runs *this* constructor's body, it does
      // so via a fresh Environment(pfn.closure) with no other way to learn
      // what "the parent of the parent" is except through this closure.
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
      } as unknown as AST.BlockStatement, classClosureEnv, false, false, false, false, undefined, true);
      classObj.properties.set('constructor', { value: defaultCtor, writable: true, enumerable: true, configurable: true });
      classProto.properties.set('constructor', { value: defaultCtor, writable: true, enumerable: false, configurable: true });
    }

    return classObj;
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
      if (isContinueSignal(result)) continue;
      if (isReturnSignal(result) || isThrowSignal(result)) return result;
    }
    return undefined;
  }

  private execDoWhile(stmt: AST.DoWhileStatement, env: Environment): JSValue | BreakSignal | ContinueSignal | ReturnSignal | ThrowSignal {
    do {
      const result = this.exec(stmt.body, env);
      if (isBreakSignal(result) && !result.label) return undefined;
      if (isBreakSignal(result) && result.label) return result;
      if (isContinueSignal(result)) continue;
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
    while (true) {
      if (stmt.test && !toBoolean(this.evalExpr(stmt.test, loopEnv))) break;
      const result = this.exec(stmt.body, loopEnv);
      if (isBreakSignal(result) && !result.label) return undefined;
      if (isBreakSignal(result) && result.label) return result;
      if (isContinueSignal(result)) { /* fall through to update */ }
      else if (isReturnSignal(result) || isThrowSignal(result)) return result;
      if (stmt.update) this.evalExpr(stmt.update, loopEnv);
    }
    return undefined;
  }

  private execForIn(stmt: AST.ForInStatement, env: Environment): JSValue | BreakSignal | ContinueSignal | ReturnSignal | ThrowSignal {
    const obj = this.evalExpr(stmt.right, env);
    if (typeof obj !== 'object' || obj === null) return undefined;
    // for-in listed every key in .properties unconditionally — regardless
    // of its enumerable flag, and regardless of whether it was even a
    // string key. Every non-enumerable built-in method (every one, on
    // every array/Map/Set/... instance, since those are attached directly
    // to each instance's own .properties) leaked into the loop right
    // alongside real data properties: `for (var k in [1,2,3])` produced
    // "0","1","2" followed by "length","push","pop","join",... Now visits
    // own enumerable string keys first, then walks the prototype chain for
    // inherited enumerable ones not already seen — real for-in's order and
    // shadowing semantics (an own property, even non-enumerable, hides a
    // same-named inherited one regardless of that one's own flag).
    const seenKeys = new Set<string>();
    const keys: string[] = [];
    let curObj: JSObject | null = obj as JSObject;
    while (curObj) {
      for (const [key, desc] of curObj.properties) {
        if (seenKeys.has(key) || key.startsWith('@@symbol:')) continue;
        seenKeys.add(key);
        if (desc.enumerable) keys.push(key);
      }
      curObj = curObj.prototype;
    }
    const loopEnv = new Environment(env);
    const varName = stmt.left.type === 'VariableDeclaration'
      ? (stmt.left.declarations[0]!.id as AST.Identifier).name
      : (stmt.left as AST.Identifier).name;
    if (stmt.left.type === 'VariableDeclaration') {
      loopEnv.declareTDZ(varName, stmt.left.kind as 'let' | 'const');
      loopEnv.initialize(varName, undefined);
    }
    for (const key of keys) {
      loopEnv.set(varName, key);
      const result = this.exec(stmt.body, loopEnv);
      if (isBreakSignal(result) && !result.label) return undefined;
      if (isBreakSignal(result) && result.label) return result;
      if (isContinueSignal(result)) continue;
      if (isReturnSignal(result) || isThrowSignal(result)) return result;
    }
    return undefined;
  }

  // for-of only ever handled array-shaped objects (.length + indexed
  // properties) — so `for (const x of someMap)`, `of someSet`, `of
  // 'a string'`, or `of` any generator/custom iterator (anything whose
  // protocol is a callable .next()) silently iterated zero times. Extracts
  // every value up front rather than pulling lazily, which is fine here
  // since this engine's generators (see runGeneratorBody) already run
  // eagerly to completion themselves.
  private forOfValues(iterable: JSValue): JSValue[] {
    if (typeof iterable === 'string') return [...iterable];
    if (typeof iterable !== 'object' || iterable === null) return [];
    const obj = iterable as JSObject;
    if (obj.type === 'array') {
      const length = Number(obj.properties.get('length')?.value ?? 0);
      const out: JSValue[] = [];
      for (let i = 0; i < length; i++) out.push(obj.properties.get(String(i))?.value);
      return out;
    }
    // General protocol: obj[Symbol.iterator]() → an iterator to drain below.
    const symbolGlobal = this.globalEnv.get('Symbol');
    const iterSym = typeof symbolGlobal === 'object' && symbolGlobal !== null ? (symbolGlobal as JSObject).properties.get('iterator')?.value : undefined;
    if (iterSym !== undefined) {
      const iterFn = this.getPropertyValue(obj, toPropertyKey(iterSym));
      if (typeof iterFn === 'object' && iterFn !== null && (iterFn as JSFunction).type === 'closure') {
        const iterator = callJSFunction(iterFn as JSFunction, obj, []);
        if (typeof iterator === 'object' && iterator !== null && iterator !== obj) return this.forOfValues(iterator);
      }
    }
    if (isJSObjectWithMeta(obj) && (obj.__mapObj || obj.__mapPrim)) {
      const entriesFn = this.getPropertyValue(obj, 'entries');
      if (typeof entriesFn === 'object' && entriesFn !== null && (entriesFn as JSFunction).type === 'closure') {
        return this.forOfValues(callJSFunction(entriesFn as JSFunction, obj, []));
      }
    }
    if (isJSObjectWithMeta(obj) && (obj.__setObj || obj.__setPrim)) {
      const valuesFn = this.getPropertyValue(obj, 'values');
      if (typeof valuesFn === 'object' && valuesFn !== null && (valuesFn as JSFunction).type === 'closure') {
        return this.forOfValues(callJSFunction(valuesFn as JSFunction, obj, []));
      }
    }
    // A .next()-based iterator (a generator's returned object, or any
    // hand-built { next() {...} } iterator) — drain it fully.
    const nextFn = this.getPropertyValue(obj, 'next');
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
    return [];
  }

  private execForOf(stmt: AST.ForOfStatement, env: Environment): JSValue | BreakSignal | ContinueSignal | ReturnSignal | ThrowSignal {
    const iterable = this.evalExpr(stmt.right, env);
    const values = this.forOfValues(iterable);
    const loopEnv = new Environment(env);
    const varName = stmt.left.type === 'VariableDeclaration'
      ? (stmt.left.declarations[0]!.id as AST.Identifier).name
      : (stmt.left as AST.Identifier).name;
    if (stmt.left.type === 'VariableDeclaration') {
      loopEnv.declareTDZ(varName, stmt.left.kind as 'let' | 'const');
      loopEnv.initialize(varName, undefined);
    }
    for (const val of values) {
      loopEnv.set(varName, val);
      const result = this.exec(stmt.body, loopEnv);
      if (isBreakSignal(result) && !result.label) return undefined;
      if (isBreakSignal(result) && result.label) return result;
      if (isContinueSignal(result)) continue;
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

  private execTry(stmt: AST.TryStatement, env: Environment): JSValue | BreakSignal | ContinueSignal | ReturnSignal | ThrowSignal {
    let pendingReturn: ReturnSignal | undefined;
    let pendingBreak: BreakSignal | undefined;
    let pendingContinue: ContinueSignal | undefined;
    let pendingThrow: ThrowSignal | undefined;

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
    } catch (e) {
      if (e instanceof JSError && stmt.handler) {
        const catchEnv = new Environment(env);
        if (stmt.handler.param) {
          catchEnv.setLocal(stmt.handler.param.name, e.value);
        }
        const catchResult = this.execBlock(stmt.handler.body.body, catchEnv);
        if (isThrowSignal(catchResult)) pendingThrow = catchResult;
        else if (isReturnSignal(catchResult)) pendingReturn = catchResult;
        else if (isBreakSignal(catchResult)) pendingBreak = catchResult;
        else if (isContinueSignal(catchResult)) pendingContinue = catchResult;
      } else if (!(e instanceof JSError)) {
        throw e;
      } else if (!stmt.handler) {
        throw e;
      }
    }

    if (stmt.finalizer) {
      const finResult = this.execBlock(stmt.finalizer.body, env);
      if (isReturnSignal(finResult)) pendingReturn = finResult;
      else if (isBreakSignal(finResult)) pendingBreak = finResult;
      else if (isContinueSignal(finResult)) pendingContinue = finResult;
      else if (isThrowSignal(finResult)) pendingThrow = finResult;
    }

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
      // Arrow functions never set their own __newTarget binding (matching
      // how they never set their own `this`), so this naturally walks up to
      // the nearest enclosing ordinary function's value; env.get() returns
      // undefined for a name nothing ever bound, so top-level/module-scope
      // use is safely undefined rather than a lookup error.
      case 'NewTargetExpression': return env.get('__newTarget');
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
      case 'FunctionExpression': return this.evalFunctionExpr(expr, env);
      case 'ArrowFunctionExpression': return this.evalArrowFunction(expr, env);
      case 'SequenceExpression': return this.evalSequence(expr, env);
      case 'TemplateLiteral': return this.evalTemplateLiteral(expr, env);
      case 'TaggedTemplateExpression': return this.evalTaggedTemplate(expr, env);
      case 'ClassDeclaration': return this.buildClassObject(expr, env);
      case 'AwaitExpression': return this.evalAwait(expr, env);
      case 'YieldExpression': return this.evalYield(expr, env);
      default: return undefined;
    }
  }

  private evalLiteral(expr: AST.Literal, env: Environment): JSValue {
    if (expr.value && typeof expr.value === 'object' && 'type' in expr.value && expr.value.type === 'RegExp') {
      // A regex literal (/pattern/flags) must produce a real RegExp object —
      // not its own source text — so .exec()/.test()/named groups etc. work.
      // Route through the global RegExp constructor's own nativeFn so the
      // literal gets the exact same object shape `new RegExp(...)` builds.
      const regExpCtor = env.get('RegExp');
      if (typeof regExpCtor === 'object' && regExpCtor !== null && 'nativeFn' in regExpCtor && (regExpCtor as JSObject).nativeFn) {
        return callNativeSafe((regExpCtor as JSObject).nativeFn!, undefined, [expr.value.pattern, expr.value.flags]);
      }
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
        result += val === undefined ? 'undefined' : val === null ? 'null' : this.jsToString(val);
      }
    }
    return result;
  }

  // Real string coercion (template-literal interpolation, `+`, String())
  // must call a class/object's own toString()/valueOf() when it has one —
  // this engine's generic values.ts toString() only knows the object's
  // internal *shape* (array/typed-array/etc.), so a custom `class Money {
  // toString() { return '$' + this.amt; } }` instance always printed the
  // generic "[object Object]" instead, since nothing ever looked up and
  // called the user's own method.
  private jsToPrimitive(val: JSValue, hint: 'string' | 'number' | 'default' = 'default'): JSValue {
    if (typeof val !== 'object' || val === null) return val;
    const obj = val as JSObject;
    const callIfPrimitiveResult = (fn: JSValue, args: JSValue[]): JSValue | undefined => {
      if (typeof fn !== 'object' || fn === null || (fn as JSFunction).type !== 'closure') return undefined;
      const result = callJSFunction(fn as JSFunction, obj, args);
      return (typeof result !== 'object' || result === null) ? result : undefined;
    };
    // Symbol.toPrimitive takes priority over valueOf/toString per spec —
    // an object defining it decides its own coercion for every hint.
    const symbolGlobal = this.globalEnv.get('Symbol');
    const toPrimitiveSym = typeof symbolGlobal === 'object' && symbolGlobal !== null ? (symbolGlobal as JSObject).properties.get('toPrimitive')?.value : undefined;
    if (toPrimitiveSym !== undefined) {
      const toPrimitiveFn = this.getPropertyValue(obj, toPropertyKey(toPrimitiveSym));
      const result = callIfPrimitiveResult(toPrimitiveFn, [hint]);
      if (result !== undefined) return result;
    }
    const order = hint === 'string' ? ['toString', 'valueOf'] : ['valueOf', 'toString'];
    for (const name of order) {
      const result = callIfPrimitiveResult(this.getPropertyValue(obj, name), []);
      if (result !== undefined) return result;
    }
    return val;
  }

  private jsToString(val: JSValue): string {
    return toString(this.jsToPrimitive(val, 'string'));
  }

  /**
   * tag`a${b}c` — call tag(stringsArray, ...substitutionValues), where
   * stringsArray is the cooked quasi strings plus a non-enumerable .raw
   * array of the same segments' untouched source text (the lexer now
   * tracks both per quasi — see TemplateElement.raw).
   */
  private evalTaggedTemplate(expr: AST.TaggedTemplateExpression, env: Environment): JSValue {
    let thisObj: JSValue = undefined;
    let callee: JSValue;
    if (expr.tag.type === 'MemberExpression') {
      thisObj = this.evalExpr(expr.tag.object, env);
      const key = expr.tag.computed ? toPropertyKey(this.evalExpr(expr.tag.property, env)) : (expr.tag.property as AST.Identifier).name;
      callee = this.getPropertyValue(thisObj, key);
    } else {
      callee = this.evalExpr(expr.tag, env);
    }
    if (typeof callee !== 'object' || callee === null) {
      throw jsError('TypeError', `${expr.tag.type === 'Identifier' ? expr.tag.name : 'tag'} is not a function`);
    }
    const cooked = expr.quasi.quasis.map((q) => q.value);
    const raw = expr.quasi.quasis.map((q) => q.raw);
    const strings = createArray(cooked);
    strings.properties.set('raw', { value: createArray(raw), writable: false, enumerable: false, configurable: false });
    const substitutions = expr.quasi.expressions.map((e) => this.evalExpr(e, env));
    return this.callFunction(callee as JSFunction, thisObj, [strings, ...substitutions]);
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
      // Simplified
      return true;
    }
    const val = this.evalExpr(expr.argument, env);
    switch (expr.operator) {
      case '-': return -toNumber(this.jsToPrimitive(val, 'number'));
      case '+': return toNumber(this.jsToPrimitive(val, 'number'));
      case '!': return !toBoolean(val);
      case '~': return ~toNumber(this.jsToPrimitive(val, 'number'));
      default: return val;
    }
  }

  private evalUpdate(expr: AST.UpdateExpression, env: Environment): JSValue {
    if (expr.argument.type === 'MemberExpression') {
      const obj = this.evalExpr(expr.argument.object, env) as JSObject;
      if (typeof obj !== 'object' || obj === null) return 0;
      const key = expr.argument.computed
        ? toPropertyKey(this.evalExpr(expr.argument.property, env))
        : (expr.argument.property as AST.Identifier).name;
      // Same class of bug as the `=`/compound-assignment paths: this read
      // only the instance's own plain value (no getter, no prototype walk)
      // and wrote back a plain value unconditionally (no setter at all) —
      // `obj.x++` on a getter/setter-backed accessor silently ignored both.
      const updateDesc = findPropertyDescriptor(obj, key);
      const old = toNumber(updateDesc?.getter ? callJSFunction(updateDesc.getter, obj, []) : updateDesc?.value);
      const newVal = expr.operator === '++' ? old + 1 : old - 1;
      if (updateDesc?.setter) callJSFunction(updateDesc.setter, obj, [newVal]);
      else obj.properties.set(key, { value: newVal, writable: true, enumerable: true, configurable: true });
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
        // ToPrimitive both sides first (default hint) — `left`/`right` may
        // be objects whose own valueOf()/toString() decide whether this
        // is really string concatenation or numeric addition; checking
        // `typeof left === 'string'` before coercing missed every object
        // operand entirely, e.g. `money + 5` never even tried Money's own
        // toString() and just silently coerced it as NaN instead.
        const leftPrim = this.jsToPrimitive(left);
        const rightPrim = this.jsToPrimitive(right);
        if (typeof leftPrim === 'string' || typeof rightPrim === 'string') return toString(leftPrim) + toString(rightPrim);
        return toNumber(leftPrim) + toNumber(rightPrim);
      }
      case '-': return toNumber(left) - toNumber(right);
      case '*': return toNumber(left) * toNumber(right);
      case '/': return toNumber(left) / toNumber(right);
      case '%': return toNumber(left) % toNumber(right);
      case '**': return toNumber(left) ** toNumber(right);
      case '<': return (left as unknown as number) < (right as unknown as number);
      case '>': return (left as unknown as number) > (right as unknown as number);
      case '<=': return (left as unknown as number) <= (right as unknown as number);
      case '>=': return (left as unknown as number) >= (right as unknown as number);
      case '==': return left == right as unknown as boolean; // eslint-disable-line eqeqeq -- JS loose-equality semantics
      case '!=': return left != right as unknown as boolean; // eslint-disable-line eqeqeq -- JS loose-equality semantics
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
        case '&&=': newVal = toBoolean(current) ? right : current; break;
        case '||=': newVal = toBoolean(current) ? current : right; break;
        default: newVal = right;
      }
      env.set(name, newVal);
      return newVal;
    }

    if (expr.left.type === 'MemberExpression') {
      const obj = this.evalExpr(expr.left.object, env) as JSObject;
      if (typeof obj !== 'object' || obj === null) return right;
      const key = expr.left.computed
        ? toPropertyKey(this.evalExpr(expr.left.property, env))
        : (expr.left.property as AST.Identifier).name;
      if (expr.operator === '=') {
        const existingDesc = findPropertyDescriptor(obj, key);
        if (existingDesc?.setter) {
          callJSFunction(existingDesc.setter, obj, [right]);
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
          obj.properties.set(key, { value: right, writable: true, enumerable: true, configurable: true });
        }
        return right;
      }
      // Same prototype-chain gap as the setter checks: an inherited
      // accessor's descriptor (found only via the prototype walk) was read
      // with plain `.value` instead of calling `.getter`, and a getter-only
      // descriptor always has `value: undefined` — so `obj.n += 5` on a
      // class accessor read `undefined` as the current value regardless of
      // what the getter actually returned.
      const currentDesc = findPropertyDescriptor(obj, key);
      const current: JSValue = currentDesc?.getter ? callJSFunction(currentDesc.getter, obj, []) : currentDesc?.value;
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
        case '&&=': newVal = toBoolean(current) ? right : current; break;
        case '||=': newVal = toBoolean(current) ? current : right; break;
        default: newVal = right;
      }
      const compoundSetter = findPropertyDescriptor(obj, key)?.setter;
      compoundSetter
        ? callJSFunction(compoundSetter, obj, [newVal])
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
        if (parentInit?.value && typeof parentInit.value === 'object' && 'type' in parentInit.value && (parentInit.value as JSFunction).type === 'closure') {
          const pfn = parentInit.value as JSFunction;
          const pEnv = new Environment(pfn.closure);
          pEnv.markFunctionScope();
          pEnv.setLocal('this', thisObj ?? createObject(null));
          // new.target stays the ORIGINALLY invoked (most-derived) class
          // throughout an entire super() chain, per spec — pEnv is rooted
          // fresh at the parent constructor's own closure, which has no
          // idea what `new.target` was outside it, so it must be carried
          // over explicitly rather than left to default to undefined.
          pEnv.setLocal('__newTarget', env.get('__newTarget'));
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
          pEnv.setLocal('arguments', createArray(args));
          this.bindParams(pfn, pEnv, args);
          const pResult = this.execBlock((pfn.body as AST.BlockStatement).body as AST.Statement[], pEnv);
          if (isReturnSignal(pResult) && typeof pResult.value === 'object' && pResult.value !== null) {
            return pResult.value;
          }
        }
        return thisObj ?? createObject(null);
      }
      throw jsError('TypeError', 'super() called outside of a derived class constructor');
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
        const key = expr.callee.computed ? toPropertyKey(this.evalExpr(expr.callee.property, env)) : (expr.callee.property as AST.Identifier).name;
        callee = this.getPropertyValue(superProto, key);
        thisObj = env.get('this');
      } else {
        thisObj = this.evalExpr(expr.callee.object, env);
        if (thisObj === undefined || thisObj === null) {
          if (expr.callee.optional) return undefined;
          const propName = !expr.callee.computed ? (expr.callee.property as AST.Identifier).name : undefined;
          throw jsError('TypeError', `Cannot read properties of ${thisObj}${propName ? ` (reading '${propName}')` : ''}`);
        }
        const key = expr.callee.computed ? toPropertyKey(this.evalExpr(expr.callee.property, env)) : (expr.callee.property as AST.Identifier).name;
        callee = this.getPropertyValue(thisObj, key);
      }
    } else {
      callee = this.evalExpr(expr.callee, env);
    }

    const args: JSValue[] = [];
    for (const a of expr.arguments) {
      if (a.type === 'SpreadElement') {
        const spreadVal = this.evalExpr(a.argument, env);
        if (Array.isArray(spreadVal)) {
          args.push(...spreadVal);
        } else if (typeof spreadVal === 'object' && spreadVal !== null && 'type' in spreadVal && (spreadVal as any).type === 'array') {
          const arr = spreadVal as JSObject;
          const len = Number(arr.properties.get('length')?.value ?? 0);
          for (let i = 0; i < len; i++) {
            args.push(arr.properties.get(String(i))?.value);
          }
        } else {
          args.push(spreadVal);
        }
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
          if (err instanceof JSError) throw err;
          throw jsError(err instanceof Error ? err.name : 'Error', err instanceof Error ? err.message : String(err));
        }
      }
      if (fn.type === 'closure' && !fn.isNative && fn.generator) {
        return this.runGeneratorBody(fn, thisObj, args);
      }
      if (fn.type === 'closure' && !fn.isNative) {
        const callEnv = new Environment(fn.closure);
        callEnv.markFunctionScope();
        callEnv.setLocal('arguments', createArray(args));
        this.bindParams(fn, callEnv, args);
        if (fn.isArrow) {
          callEnv.setLocal('this', fn.closure.get('this') ?? createObject(null));
          // Arrows never get their own new.target binding either — leave
          // __newTarget unset so `new.target` inside one resolves through
          // the closure chain to the enclosing ordinary function's value.
        } else if (thisObj === undefined && !fn.isStrict) {
          callEnv.setLocal('this', this.globalEnv.get('this') ?? createObject(null));
          callEnv.setLocal('__newTarget', undefined);
        } else {
          callEnv.setLocal('this', thisObj);
          // A plain (non-new) call always has new.target === undefined,
          // even from inside a constructor that's itself mid-construction —
          // shadow whatever the enclosing scope's __newTarget was rather
          // than leaving it unset (which would incorrectly inherit it).
          callEnv.setLocal('__newTarget', undefined);
        }
        const bodyNode = fn.body as AST.BlockStatement | AST.Expression;
        let result: JSValue | BreakSignal | ContinueSignal | ReturnSignal | ThrowSignal;
        try {
          if (bodyNode.type === 'BlockStatement') {
            result = this.execBlock(bodyNode.body as AST.Statement[], callEnv);
          } else {
            result = this.evalExpr(bodyNode as AST.Expression, callEnv);
          }
        } catch (err) {
          if (fn.async && this.eventLoop && isAwaitSignal(err)) {
            return this.handleAsyncAwait(err as AwaitSignal, fn, thisObj, args);
          }
          throw err;
        }
        if (fn.async && this.eventLoop && isAwaitSignal(result)) {
          return this.handleAsyncAwait(result as AwaitSignal, fn, thisObj, args);
        }
        if (isReturnSignal(result)) {
          if (fn.async && this.eventLoop) return wrapAsyncResult(result.value, this.eventLoop);
          return result.value;
        }
        if (isThrowSignal(result)) throw new JSError(result.value);
        if (fn.async && this.eventLoop) return wrapAsyncResult(result as JSValue, this.eventLoop);
        return result as JSValue;
      }
      // Object-as-function
      const callFn = (fn as unknown as JSObject).properties.get('call')?.value;
      if (typeof callFn === 'object' && callFn !== null && (callFn as JSFunction).type === 'closure') {
        return this.evalCall({ type: 'CallExpression', callee: callFn as unknown as AST.Expression, arguments: [expr.callee, ...expr.arguments], optional: false }, env);
      }
    }

    // Callable JSObject with nativeFn (e.g., Promise constructor)
    if (typeof callee === 'object' && callee !== null && 'callable' in callee && (callee as JSObject).callable && (callee as JSObject).nativeFn) {
      return callNativeSafe((callee as JSObject).nativeFn!, thisObj, args);
    }

    if (typeof callee === 'function') {
      return (callee as Function)(...args) as JSValue;
    }

    return undefined;
  }

  private evalNew(expr: AST.NewExpression, env: Environment): JSValue {
    let ctor = this.evalExpr(expr.callee, env);
    let args = expr.arguments.map(a => this.evalExpr(a, env));
    // Unwrap `fn.bind(...)` results back to the real target — see the
    // __boundTarget comment in makeFunctionCallHelper.
    while (typeof ctor === 'object' && ctor !== null && (ctor as unknown as { __boundTarget?: JSFunction }).__boundTarget) {
      const boundCtor = ctor as unknown as { __boundTarget: JSFunction; __boundArgs: JSValue[] };
      args = [...boundCtor.__boundArgs, ...args];
      ctor = boundCtor.__boundTarget;
    }

    // Class constructor (type: 'class' on a JSObject)
    if (typeof ctor === 'object' && ctor !== null && 'type' in ctor && (ctor as JSObject).type === 'class') {
      const classObj = ctor as JSObject;
      const classProto = classObj.prototype ?? createObject(null);
      const instance = createObject(classProto);

      // Instance field initializers (`x = 1` in a class body) — run base
      // class first, most-derived last (so a subclass field can shadow an
      // inherited one), each in its own class's closure scope with `this`
      // bound to the new instance, since an initializer can reference it
      // (`y = this.x * 2`). buildClassObject only ever collected these;
      // nothing previously consumed the list, so class fields were
      // declared but never actually became properties on any instance.
      const classChain: JSObject[] = [];
      let curClass: JSObject | undefined = classObj;
      while (curClass) {
        classChain.unshift(curClass);
        const superVal: JSValue = curClass.properties?.get('super')?.value;
        curClass = typeof superVal === 'object' && superVal !== null ? superVal as JSObject : undefined;
      }
      for (const c of classChain) {
        const fields = (c as JSObject & { __instanceFields?: { key: string; value: unknown }[] }).__instanceFields;
        const closureEnv = (c as JSObject & { __classClosure?: Environment }).__classClosure;
        if (!fields || !closureEnv) continue;
        const fieldEnv = new Environment(closureEnv);
        fieldEnv.setLocal('this', instance);
        for (const f of fields) {
          const value = f.value ? this.evalExpr(f.value as AST.Expression, fieldEnv) : undefined;
          instance.properties.set(f.key, { value, writable: true, enumerable: true, configurable: true });
        }
      }

      const superClass = classObj.properties?.get('super')?.value;
      const initFn = classObj.properties?.get('constructor');

      if (initFn?.value && typeof initFn.value === 'object' && 'type' in initFn.value && (initFn.value as JSFunction).type === 'closure') {
        const fn = initFn.value as JSFunction;
        const callEnv = new Environment(fn.closure);
        callEnv.markFunctionScope();
        callEnv.setLocal('this', instance);
        callEnv.setLocal('arguments', createArray(args));
        callEnv.setLocal('__newTarget', classObj);

        if (superClass && typeof superClass === 'object' && superClass !== null) {
          // Set super to the parent prototype for super.x / super[expr] member access
          const superProto = (superClass as JSObject).prototype ?? superClass;
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
      const result = callNativeSafe(obj.nativeFn!, createObject(null), args);
      return (typeof result === 'object' && result !== null) ? result : createObject(null);
    }

    // Function constructor (JSFunction closure)
    if (typeof ctor === 'object' && ctor !== null && 'type' in ctor && (ctor as JSFunction).type === 'closure') {
      const fn = ctor as JSFunction;
      // The new instance must link to fn's own .prototype object (real
      // JS's [[Prototype]] on construction) — this always built a bare,
      // unlinked createObject(null) instead, so the entire pre-class
      // "function Ctor() {}; Ctor.prototype.method = ...; new Ctor()"
      // inheritance pattern was completely broken: every inherited
      // property/method read back undefined, and `instance instanceof
      // Ctor` was always false.
      const protoVal = this.getPropertyValue(fn, 'prototype');
      const instance = createObject(typeof protoVal === 'object' && protoVal !== null ? protoVal as JSObject : null);
      const callEnv = new Environment(fn.closure);
      callEnv.markFunctionScope();
      callEnv.setLocal('this', instance);
      callEnv.setLocal('arguments', createArray(args));
      callEnv.setLocal('__newTarget', fn);
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
      const propName = !expr.computed ? (expr.property as AST.Identifier).name : undefined;
      throw jsError('TypeError', `Cannot read properties of ${obj}${propName ? ` (reading '${propName}')` : ''}`);
    }
    if (typeof obj === 'string') {
      const key = expr.computed ? toPropertyKey(this.evalExpr(expr.property, env)) : (expr.property as AST.Identifier).name;
      if (key === 'length') return (obj as string).length;
      const idx = parseInt(key, 10);
      if (!isNaN(idx)) return (obj as string)[idx] ?? undefined;
      const strMethods: Record<string, NativeFunction> = {
        toUpperCase: (_t, _a) => (obj as string).toUpperCase(),
        toLowerCase: (_t, _a) => (obj as string).toLowerCase(),
        charAt: (_t, a) => (obj as string).charAt(toNumber(a[0])),
        charCodeAt: (_t, a) => (obj as string).charCodeAt(toNumber(a[0])),
        at: (_t, a) => {
          const s = obj as string;
          let i = toNumber(a[0]);
          if (i < 0) i += s.length;
          return i >= 0 && i < s.length ? s[i] : undefined;
        },
        normalize: (_t, a) => (obj as string).normalize(a[0] !== undefined ? toString(a[0]) as any : undefined),
        localeCompare: (_t, a) => (obj as string).localeCompare(toString(a[0])),
        indexOf: (_t, a) => (obj as string).indexOf(toString(a[0])),
        lastIndexOf: (_t, a) => (obj as string).lastIndexOf(toString(a[0])),
        slice: (_t, a) => (obj as string).slice(toNumber(a[0]), a[1] !== undefined ? toNumber(a[1]) : undefined),
        substring: (_t, a) => (obj as string).substring(toNumber(a[0]), a[1] !== undefined ? toNumber(a[1]) : undefined),
        substr: (_t, a) => (obj as string).substr(toNumber(a[0]), a[1] !== undefined ? toNumber(a[1]) : undefined),
        split: (_t, a) => {
          if (a[0] === undefined) return createArray([obj as string]);
          const pattern = a[0];
          const parts = typeof pattern === 'object' && pattern !== null && isJSObjectWithMeta(pattern) && pattern.nativeRegExp
            ? (obj as string).split(pattern.nativeRegExp)
            : (obj as string).split(toString(pattern));
          return createArray(parts.map(p => p as unknown as JSValue));
        },
        replace: (_t, a) => stringReplaceImpl(obj as string, a[0], a[1], false),
        replaceAll: (_t, a) => stringReplaceImpl(obj as string, a[0], a[1], true),
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
          const m = (obj as string).match(toNativeRegex(a[0]));
          return m ? createArray(m.map(v => v as unknown as JSValue)) : null;
        },
        matchAll: (_t, a) => {
          const matches = [...(obj as string).matchAll(toNativeRegex(a[0], 'g'))];
          return createArray(matches.map(m => {
            const result = createArray(m.map(v => (v !== undefined ? v : null) as unknown as JSValue));
            result.properties.set('index', { value: m.index, writable: true, enumerable: true, configurable: true });
            result.properties.set('input', { value: m.input, writable: true, enumerable: true, configurable: true });
            return result as unknown as JSValue;
          }));
        },
        search: (_t, a) => (obj as string).search(toNativeRegex(a[0])),
        valueOf: (_t: JSValue, _a: JSValue[]) => obj,
        toString: (_t: JSValue, _a: JSValue[]) => obj,
      };
      if (key in strMethods) {
        return createNativeFunction(key, strMethods[key]);
      }
      return undefined;
    }
    const nativeObj = obj as JSObject;
    const key = expr.computed
      ? toPropertyKey(this.evalExpr(expr.property, env))
      : (expr.property as AST.Identifier).name;

    // Closure (function) objects: provide .length, .name, .prototype, .constructor
    if ('type' in (nativeObj as any) && (nativeObj as any).type === 'closure') {
      const fn = nativeObj as unknown as JSFunction;
      if (key === 'length') return fn.params.length;
      if (key === 'name') return fn.name ?? '';
      if (key === 'arguments') return undefined;
      if (key === 'caller') return undefined;
      if (key === 'prototype' && !fn.isArrow) {
        // A reassigned prototype (`Ctor.prototype = Object.create(...)`, the
        // classic subclassing idiom) is stored as a real property, in
        // fn.properties — check that before falling back to the lazily
        // cached __proto_obj, or a reassignment would silently keep
        // returning the original auto-created prototype object.
        const existing = fn.properties?.get('prototype');
        if (existing) return existing.value;
        let protoObj = (nativeObj as any).__proto_obj;
        if (!protoObj) {
          protoObj = createObject(null);
          protoObj.properties.set('constructor', { value: nativeObj, writable: true, enumerable: false, configurable: true });
          (nativeObj as any).__proto_obj = protoObj;
        }
        return protoObj;
      }
      if (key === 'call' || key === 'apply' || key === 'bind') {
        return this.makeFunctionCallHelper(fn, key);
      }
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
    return this.objectPrototypeFallback(nativeObj, key);
  }

  // Function.prototype.call/apply/bind — plain function objects had no
  // properties map at all until this session, so these three universally
  // used methods were simply absent from every function: `Parent.call(this,
  // ...)`, the backbone of the classic prototype-inheritance pattern, and
  // `fn.bind(x)`/`fn.apply(x, args)` all silently evaluated to `undefined`
  // instead of ever invoking the target function.
  private makeFunctionCallHelper(fn: JSFunction, key: 'call' | 'apply' | 'bind'): JSFunction {
    const toArgsArray = (val: JSValue): JSValue[] => {
      if (typeof val !== 'object' || val === null || !('type' in val) || (val as JSObject).type !== 'array') return [];
      const arr = val as JSObject;
      const len = Number(arr.properties.get('length')?.value ?? 0);
      const out: JSValue[] = [];
      for (let i = 0; i < len; i++) out.push(arr.properties.get(String(i))?.value);
      return out;
    };
    if (key === 'call') {
      return createNativeFunction('call', (_t, args) => this.callFunction(fn, args[0], args.slice(1)));
    }
    if (key === 'apply') {
      return createNativeFunction('apply', (_t, args) => this.callFunction(fn, args[0], toArgsArray(args[1])));
    }
    // bind: called once (as `fn.bind(this, ...presetArgs)`) to produce a new
    // function that always invokes `fn` with that fixed `this` and those
    // preset args prepended to whatever args it's later called with.
    return createNativeFunction('bind', (_t, bindArgs) => {
      const thisArg = bindArgs[0];
      const presetArgs = bindArgs.slice(1);
      const bound = createNativeFunction(`bound ${fn.name}`, (_t2, callArgs) => this.callFunction(fn, thisArg, [...presetArgs, ...callArgs]));
      // A bound function is still constructible (`new (fn.bind(x))()`) — real
      // JS ignores the bound `this` in that case and constructs the original
      // target instead, just with the preset args prepended. Tag it so
      // evalNew can unwrap back to the real target instead of treating this
      // like any other opaque native function (which would call it with a
      // throwaway instance as `this`, silently discarding the bound `this`
      // override in the process without ever linking to fn.prototype).
      (bound as unknown as { __boundTarget?: JSFunction; __boundArgs?: JSValue[] }).__boundTarget = fn;
      (bound as unknown as { __boundTarget?: JSFunction; __boundArgs?: JSValue[] }).__boundArgs = presetArgs;
      return bound;
    });
  }

  // Object.prototype fallback (hasOwnProperty, isPrototypeOf,
  // propertyIsEnumerable, toString, valueOf, toLocaleString). Every plain
  // object/array/class instance's prototype chain terminates in a
  // null-prototyped object from createObject(null), never a real
  // Object.prototype — so these near-universal methods were simply absent:
  // `obj.hasOwnProperty(k)` silently evaluated to `undefined` (not a
  // function, but not a crash either, since calling a non-function callee
  // is itself a no-op here) instead of ever running, quietly defeating the
  // extremely common for-in-with-hasOwnProperty-guard idiom. Skips
  // toString/valueOf for functions — those get more specific handling from
  // the closure special case above and shouldn't fall back to the generic
  // "[object Object]" that a plain object gets.
  private objectPrototypeFallback(target: JSObject, key: string): JSValue {
    const isFunction = (target as unknown as { type?: string }).type === 'closure';
    switch (key) {
      case 'hasOwnProperty':
        return createNativeFunction('hasOwnProperty', (t, a) =>
          typeof t === 'object' && t !== null ? !!(t as JSObject).properties?.has(toPropertyKey(a[0])) : false);
      case 'isPrototypeOf':
        return createNativeFunction('isPrototypeOf', (_t, a) => {
          let proto = typeof a[0] === 'object' && a[0] !== null ? (a[0] as JSObject).prototype : null;
          while (proto) {
            if (proto === target) return true;
            proto = proto.prototype;
          }
          return false;
        });
      case 'propertyIsEnumerable':
        return createNativeFunction('propertyIsEnumerable', (t, a) =>
          typeof t === 'object' && t !== null ? !!(t as JSObject).properties?.get(toPropertyKey(a[0]))?.enumerable : false);
      case 'toString':
        return isFunction ? undefined : createNativeFunction('toString', (t) => {
          const symbolGlobal = this.globalEnv.get('Symbol');
          const tagSym = typeof symbolGlobal === 'object' && symbolGlobal !== null ? (symbolGlobal as JSObject).properties.get('toStringTag')?.value : undefined;
          return objectPrototypeToStringTag(t, tagSym !== undefined ? toPropertyKey(tagSym) : null);
        });
      case 'valueOf':
        return isFunction ? undefined : createNativeFunction('valueOf', (t) => t as JSValue);
      case 'toLocaleString':
        return isFunction ? undefined : createNativeFunction('toLocaleString', (t) => toString(t));
      default:
        return undefined;
    }
  }

  private getPropertyValue(obj: JSValue, key: string): JSValue {
    if (typeof obj === 'string') {
      const strMethods: Record<string, NativeFunction> = {
        length: (_t, _a) => (obj as string).length,
        toUpperCase: (_t, _a) => (obj as string).toUpperCase(),
        toLowerCase: (_t, _a) => (obj as string).toLowerCase(),
        charAt: (_t, a) => (obj as string).charAt(toNumber(a[0])),
        charCodeAt: (_t, a) => (obj as string).charCodeAt(toNumber(a[0])),
        at: (_t, a) => {
          const s = obj as string;
          let i = toNumber(a[0]);
          if (i < 0) i += s.length;
          return i >= 0 && i < s.length ? s[i] : undefined;
        },
        normalize: (_t, a) => (obj as string).normalize(a[0] !== undefined ? toString(a[0]) as any : undefined),
        localeCompare: (_t, a) => (obj as string).localeCompare(toString(a[0])),
        indexOf: (_t, a) => (obj as string).indexOf(toString(a[0])),
        lastIndexOf: (_t, a) => (obj as string).lastIndexOf(toString(a[0])),
        slice: (_t, a) => (obj as string).slice(toNumber(a[0]), a[1] !== undefined ? toNumber(a[1]) : undefined),
        substring: (_t, a) => (obj as string).substring(toNumber(a[0]), a[1] !== undefined ? toNumber(a[1]) : undefined),
        substr: (_t, a) => (obj as string).substr(toNumber(a[0]), a[1] !== undefined ? toNumber(a[1]) : undefined),
        split: (_t, a) => {
          if (a[0] === undefined) return createArray([obj as string]);
          const pattern = a[0];
          const parts = typeof pattern === 'object' && pattern !== null && isJSObjectWithMeta(pattern) && pattern.nativeRegExp
            ? (obj as string).split(pattern.nativeRegExp)
            : (obj as string).split(toString(pattern));
          return createArray(parts.map(p => p as unknown as JSValue));
        },
        replace: (_t, a) => stringReplaceImpl(obj as string, a[0], a[1], false),
        replaceAll: (_t, a) => stringReplaceImpl(obj as string, a[0], a[1], true),
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
          const m = (obj as string).match(toNativeRegex(a[0]));
          return m ? createArray(m.map(v => v as unknown as JSValue)) : null;
        },
        matchAll: (_t, a) => {
          const matches = [...(obj as string).matchAll(toNativeRegex(a[0], 'g'))];
          return createArray(matches.map(m => {
            const result = createArray(m.map(v => (v !== undefined ? v : null) as unknown as JSValue));
            result.properties.set('index', { value: m.index, writable: true, enumerable: true, configurable: true });
            result.properties.set('input', { value: m.input, writable: true, enumerable: true, configurable: true });
            return result as unknown as JSValue;
          }));
        },
        search: (_t, a) => (obj as string).search(toNativeRegex(a[0])),
        valueOf: (_t: JSValue, _a: JSValue[]) => obj,
        toString: (_t: JSValue, _a: JSValue[]) => obj,
      };
      if (key === 'length') return (obj as string).length;
      const idx = parseInt(key, 10);
      if (!isNaN(idx)) return (obj as string)[idx] ?? undefined;
      if (key in strMethods) return createNativeFunction(key, strMethods[key]);
      return undefined;
    }
    if (typeof obj === 'number') {
      const numMethods: Record<string, NativeFunction> = {
        toString: (_t: JSValue, _a: JSValue[]) => obj.toString(),
        valueOf: (_t: JSValue, _a: JSValue[]) => obj,
        toFixed: (_t, a) => (obj as number).toFixed(toNumber(a[0])),
        toPrecision: (_t, a) => (obj as number).toPrecision(toNumber(a[0])),
        toExponential: (_t, a) => (obj as number).toExponential(toNumber(a[0])),
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
        if (key === 'call' || key === 'apply' || key === 'bind') {
          return this.makeFunctionCallHelper(fn, key);
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
      return this.objectPrototypeFallback(o, key);
    }
    return undefined;
  }

  private evalArray(expr: AST.ArrayExpression, env: Environment): JSValue {
    const elements = expr.elements.map(e => {
      if (!e) return undefined;
      if (e.type === 'SpreadElement') return this.evalExpr(e.argument, env);
      return this.evalExpr(e, env);
    });
    return createArray(elements);
  }

  private evalObject(expr: AST.ObjectExpression, env: Environment): JSValue {
    const obj = createObject(null);
    for (const prop of expr.properties) {
      if (prop.type === 'SpreadElement') {
        const spread = this.evalExpr(prop.argument, env);
        if (typeof spread === 'object' && spread !== null) {
          for (const [k, v] of (spread as JSObject).properties) {
            obj.properties.set(k, v);
          }
        }
        continue;
      }
      const key = prop.computed
        ? toPropertyKey(this.evalExpr(prop.key, env))
        : prop.key.type === 'Identifier' ? prop.key.name : String(prop.key);
      if (prop.kind === 'get' || prop.kind === 'set') {
        const fn = prop.value ? this.evalExpr(prop.value, env) as JSFunction : undefined;
        const existing = obj.properties.get(key);
        obj.properties.set(key, {
          value: undefined, writable: false,
          getter: prop.kind === 'get' ? fn : existing?.getter,
          setter: prop.kind === 'set' ? fn : existing?.setter,
          enumerable: true, configurable: true,
        });
        continue;
      }
      const value = prop.value ? this.evalExpr(prop.value, env) : undefined;
      obj.properties.set(key, { value, writable: true, enumerable: true, configurable: true });
    }
    return obj;
  }

  private evalFunctionExpr(expr: AST.FunctionExpression, env: Environment): JSValue {
    return createFunction(expr.id?.name ?? 'anonymous', expr.params.map(p => (p as AST.Identifier).name), expr.body, env, expr.async, false, expr.generator, false, undefined, expr.strictMode, expr.params);
  }

  private evalArrowFunction(expr: AST.ArrowFunctionExpression, env: Environment): JSValue {
    const strict = expr.body.type === 'BlockStatement' ? this.hasStrictDirective(expr.body) : false;
    return createFunction('anonymous', expr.params.map(p => (p as AST.Identifier).name), expr.body, env, expr.async, true, false, false, undefined, strict, expr.params);
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
    const sink = this.yieldSinkStack[this.yieldSinkStack.length - 1];
    if (sink) {
      if (expr.delegate) for (const v of this.forOfValues(val)) sink.push(v);
      else sink.push(val);
    }
    // A real `yield` suspends here and resumes with whatever .next(v) is
    // next called with — this tree-walking interpreter has no way to pause
    // mid-body (see runGeneratorBody), so .next(v) can never feed v back in.
    return undefined;
  }

  /**
   * Generator functions (`function* () { yield ... }`) can't actually
   * suspend in a tree-walking interpreter — there's no way to pause
   * mid-body and resume later from the exact same point. Instead this runs
   * the whole body once, eagerly, collecting every yielded value in order
   * via yieldSinkStack, then hands back a real .next()-based iterator that
   * replays those collected values one per call. This is faithful for the
   * common "yield a sequence of values" iterable pattern (including
   * `for...of` and `yield*` delegation, both of which only ever pull
   * values forward) but NOT for two-way communication (a value passed to
   * .next(v) can't be fed back into an already-finished run) or for
   * infinite/lazy generators, which still run to completion up front,
   * gated only by the interpreter's existing runaway-script timeout.
   */
  private runGeneratorBody(fn: JSFunction, thisObj: JSValue, args: JSValue[]): JSObject {
    const callEnv = new Environment(fn.closure);
    callEnv.markFunctionScope();
    callEnv.setLocal('arguments', createArray(args));
    this.bindParams(fn, callEnv, args);
    if (fn.isArrow) callEnv.setLocal('this', fn.closure.get('this') ?? createObject(null));
    else if (thisObj === undefined && !fn.isStrict) callEnv.setLocal('this', this.globalEnv.get('this') ?? createObject(null));
    else callEnv.setLocal('this', thisObj);

    const sink: JSValue[] = [];
    this.yieldSinkStack.push(sink);
    let returnValue: JSValue;
    try {
      const result = this.execBlock((fn.body as AST.BlockStatement).body as AST.Statement[], callEnv);
      if (isReturnSignal(result)) returnValue = result.value;
      else if (isThrowSignal(result)) throw new JSError(result.value);
    } finally {
      this.yieldSinkStack.pop();
    }

    const iterObj = createObject(null);
    let idx = 0;
    let done = false;
    const stepResult = (value: JSValue, isDone: boolean): JSObject => {
      const r = createObject(null);
      r.properties.set('value', { value, writable: true, enumerable: true, configurable: true });
      r.properties.set('done', { value: isDone, writable: true, enumerable: true, configurable: true });
      return r;
    };
    iterObj.properties.set('next', {
      value: createNativeFunction('next', () => {
        if (done) return stepResult(undefined, true);
        if (idx < sink.length) return stepResult(sink[idx++], false);
        done = true;
        return stepResult(returnValue, true);
      }),
      writable: true, enumerable: true, configurable: true,
    });
    iterObj.properties.set('return', {
      value: createNativeFunction('return', (_t, a) => { done = true; return stepResult(a[0], true); }),
      writable: true, enumerable: true, configurable: true,
    });
    iterObj.properties.set('throw', {
      value: createNativeFunction('throw', (_t, a) => { done = true; throw new JSError(a[0]); }),
      writable: true, enumerable: true, configurable: true,
    });
    return iterObj;
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
