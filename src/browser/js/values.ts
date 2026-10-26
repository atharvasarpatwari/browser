import type { BytecodeFunction } from './bytecode';

// ─────────────────────────────────────────────────────────────────────────────
// ENVIRONMENT (Scope Chain)
// ─────────────────────────────────────────────────────────────────────────────

export type JSValue =
  | undefined
  | null
  | boolean
  | number
  | string
  | bigint
  | JSObject
  | JSFunction;

export interface JSObject {
  type: 'object' | 'array' | 'function' | 'class';
  properties: Map<string, PropertyDescriptor>;
  prototype: JSObject | null;
  /** For function objects */
  callable?: boolean;
  nativeFn?: NativeFunction;
  /** For class constructors */
  constructorFn?: boolean;
  /** Back-reference for function/class objects */
  thisValue?: JSObject;
}

/**
 * Extended JSObject with internal metadata properties used by the engine.
 * These `__`-prefixed fields are set on JSObject instances to track
 * native backing data, type overrides, and API-specific state.
 */
export interface JSObjectWithMeta extends JSObject {
  /** Override the typeof result for this object */
  __type_override?: string;
  /** Backing native ArrayBuffer for typed arrays and DataView */
  __nativeBuffer?: ArrayBuffer;
  /** Native typed array view (Int32Array, Float64Array, etc.) */
  __nativeView?: unknown;
  /** Byte offset within the parent buffer for typed array slices */
  __taOffset?: number;
  /** TypedArray metadata (constructor name, element size, etc.) */
  __taMeta?: { TypedArrayName: string; [key: string]: unknown };
  /** DataView byte offset */
  __dvOffset?: number;
  /** DataView byte length */
  __dvByteLength?: number;
  /** Symbol description for symbol-valued objects */
  symbolDescription?: string;
  /** WeakRef target */
  __weakTarget?: unknown;
  /** FinalizationRegistry callback */
  __frCallback?: unknown;
  /** FinalizationRegistry internal WeakMap */
  __frRegistry?: WeakMap<object, unknown>;
  /** BroadcastChannel name */
  __channelName?: string;
  /** Event listeners array (for BroadcastChannel, MessagePort, etc.) */
  __listeners?: Array<{ type: string; fn: JSFunction }>;
  /** Whether the channel/port is closed */
  __closed?: boolean;
  /** ReadableStream chunks queue */
  __chunks?: unknown[];
  /** ReadableStream underlying source */
  __underlyingSource?: unknown;
  /** MessagePort started flag */
  __started?: boolean;
  /** MessagePort remote end flag */
  /** The remote port (for MessagePort pairs) */
  __remote?: JSObject;
  /** Signal listeners for AbortSignal */
  __signalListeners?: Set<(ev: unknown) => void>;
  /** Associated animation object */
  __animation?: unknown;
  /** Range internal state */
  __rangeState?: { startContainer: JSObject; startOffset: number; endContainer: JSObject; endOffset: number };
  /** Synced properties function for Range methods */
  __syncProps?: () => void;
  /** Native Date object for Date wrappers */
  nativeDate?: Date;
  /** Native RegExp object for RegExp wrappers */
  nativeRegExp?: RegExp;
  /** Symbol numeric ID */
  symbolId?: number;
  /** Map internal object-key store */
  __mapObj?: Map<JSObject, JSValue>;
  /** Map internal primitive-key store */
  __mapPrim?: Map<string, JSValue>;
  /** Set internal object store */
  __setObj?: Set<JSObject>;
  /** Set internal primitive store */
  __setPrim?: Set<string>;
  /** Prototype object for Object.create */
  __proto_obj?: JSObject;
  /** WeakMap internal entries store */
  __weakMapEntries?: Map<JSObject, JSValue>;
  /** WeakSet internal entries store */
  __weakSetEntries?: Set<JSObject>;
}

export function isJSObjectWithMeta(obj: unknown): obj is JSObjectWithMeta {
  return typeof obj === 'object' && obj !== null && 'type' in obj && 'properties' in obj;
}

export interface PropertyDescriptor {
  value: JSValue;
  writable: boolean;
  enumerable: boolean;
  configurable: boolean;
  getter?: JSFunction;
  setter?: JSFunction;
}

export interface JSFunction {
  type: 'closure';
  name: string;
  params: string[];
  body: unknown; // AST.BlockStatement | AST.Expression | BytecodeFunction
  closure: Environment;
  async: boolean;
  generator: boolean;
  isArrow: boolean;
  isNative: boolean;
  nativeFn?: NativeFunction;
  thisValue?: JSObject;
  /** If true, body is a BytecodeFunction and should be executed by the VM */
  isBytecode?: boolean;
  /** Captured upvalue references from parent scopes */
  upvalues?: UpvalueRef[];
  /** If true, the function runs in strict mode */
  isStrict?: boolean;
  /** Parameter AST patterns when any is not a plain name (defaults, destructuring, rest). */
  paramPatterns?: unknown[];
}

/** Shared mutable reference for closure-captured variables */
export class UpvalueRef {
  constructor(public value: JSValue) {}
}

export type NativeFunction = (thisArg: JSValue, args: JSValue[]) => JSValue | void;

// ─────────────────────────────────────────────────────────────────────────────
// SENTINEL VALUES
// ─────────────────────────────────────────────────────────────────────────────

export const JS_UNDEFINED: undefined = undefined;
export const JS_NULL: null = null;
export const JS_TRUE: boolean = true;
export const JS_FALSE: boolean = false;

/** Break signal */
export interface BreakSignal { type: 'break'; label?: string }
/** Continue signal */
export interface ContinueSignal { type: 'continue'; label?: string }
/** Return signal */
export interface ReturnSignal { type: 'return'; value: JSValue }
/** Throw signal */
export interface ThrowSignal { type: 'throw'; value: JSValue }
/** Await signal — used to suspend async function execution */
export interface AwaitSignal { type: 'await'; promise: JSValue; continuation: (value: JSValue) => JSValue }

export function isBreakSignal(v: unknown): v is BreakSignal { return typeof v === 'object' && v !== null && (v as BreakSignal).type === 'break'; }
export function isContinueSignal(v: unknown): v is ContinueSignal { return typeof v === 'object' && v !== null && (v as ContinueSignal).type === 'continue'; }
export function isReturnSignal(v: unknown): v is ReturnSignal { return typeof v === 'object' && v !== null && (v as ReturnSignal).type === 'return'; }
export function isThrowSignal(v: unknown): v is ThrowSignal { return typeof v === 'object' && v !== null && (v as ThrowSignal).type === 'throw'; }
export function isAwaitSignal(v: unknown): v is AwaitSignal { return typeof v === 'object' && v !== null && (v as AwaitSignal).type === 'await'; }

// ─────────────────────────────────────────────────────────────────────────────
// ENVIRONMENT
// ─────────────────────────────────────────────────────────────────────────────

export class Environment {
  private bindings = new Map<string, { value: JSValue; kind: 'var' | 'let' | 'const'; __tdz?: boolean }>();
  readonly parent: Environment | null;
  /** The root scope's global object (window), whose properties are also global variables. */
  private globalObject: JSObject | null = null;

  constructor(parent: Environment | null = null) {
    this.parent = parent;
  }

  /** Declare a variable (var/let/const) */
  declare(name: string, value: JSValue, kind: 'var' | 'let' | 'const' = 'var'): void {
    if (kind === 'var') {
      // var declarations hoist to the nearest function scope
      let scope: Environment | null = this; // eslint-disable-line @typescript-eslint/no-this-alias
      while (scope && !scope.isFunctionScope()) {
        scope = scope.parent;
      }
      if (scope) {
        scope.bindings.set(name, { value, kind });
      } else {
        this.bindings.set(name, { value, kind });
      }
    } else {
      // let/const: per ECMAScript § 9.1.1, bindings are created in TDZ state.
      // They remain uninitialized until the declaration statement is evaluated.
      this.bindings.set(name, { value, kind, __tdz: true });
    }
  }

  /**
   * Initialize a let/const binding (clears TDZ).
   * Called when the declaration statement is actually executed.
   */
  initialize(name: string, value: JSValue, kind: 'let' | 'const' = 'let'): void {
    const binding = this.bindings.get(name);
    if (binding && binding.__tdz) {
      binding.value = value;
      binding.__tdz = false;
    } else if (!binding) {
      // Names inside a destructuring pattern (`const [a, b] = …`) are not pre-declared; their
      // values used to be dropped.
      this.bindings.set(name, { value, kind });
    }
  }

  /** Set an existing variable (assignment) */
  set(name: string, value: JSValue): boolean {
    const binding = this.bindings.get(name);
    if (binding) {
      if (binding.kind === 'const') {
        throw new TypeError(`Assignment to constant variable '${name}'`);
      }
      binding.value = value;
      return true;
    }
    if (this.parent) {
      return this.parent.set(name, value);
    }
    const prop = this.globalObject ? (this.globalObject.properties as GlobalPropertyMap).ownGet(name) : undefined;
    if (prop) {
      if (prop.setter) callJSFunction(prop.setter, this.globalObject, [value]);
      else prop.value = value;
      return true;
    }
    // Sloppy-mode implicit global (`x = 1` with no declaration); it used to be dropped.
    this.bindings.set(name, { value, kind: 'var' });
    return true;
  }

  /** Set a variable directly (for let/const in current scope) */
  setLocal(name: string, value: JSValue, kind: 'let' | 'const' = 'let'): void {
    this.bindings.set(name, { value, kind, __tdz: false });
  }

  /**
   * Declare a variable in TDZ (Temporal Dead Zone).
   * Per ECMAScript § 9.1.1, let/const bindings are uninitialized until
   * the declaration is evaluated. Accessing them before initialization
   * throws a ReferenceError.
   */
  declareTDZ(name: string, kind: 'let' | 'const'): void {
    this.bindings.set(name, { value: undefined, kind, __tdz: true });
  }

  /** Get a variable value */
  get(name: string): JSValue {
    const binding = this.bindings.get(name);
    if (binding) {
      if (binding.__tdz) {
        throw new ReferenceError(`Cannot access '${name}' before initialization`);
      }
      return binding.value;
    }
    if (this.parent) {
      return this.parent.get(name);
    }
    const prop = this.globalObject ? (this.globalObject.properties as GlobalPropertyMap).ownGet(name) : undefined;
    if (prop) return prop.getter ? callJSFunction(prop.getter, this.globalObject, []) : prop.value;
    return undefined;
  }

  /** Check if a variable exists in this scope or any parent */
  has(name: string): boolean {
    if (this.bindings.has(name)) return true;
    if (this.parent) return this.parent.has(name);
    return !!this.globalObject && (this.globalObject.properties as GlobalPropertyMap).ownHas(name);
  }

  /**
   * Make `obj` this root scope's global object (window): `window.x = 1` then `x` works, and
   * `var x` / built-ins read as `window.x`. They used to be two unrelated namespaces.
   */
  linkGlobalObject(obj: JSObject): void {
    this.globalObject = obj;
    obj.properties = new GlobalPropertyMap(this.bindings, obj.properties);
  }

  private isFunctionScope(): boolean {
    return (this as Record<string, unknown>)['__functionScope'] === true;
  }

  markFunctionScope(): void {
    (this as Record<string, unknown>)['__functionScope'] = true;
  }

  /** Get the parent environment (for GC root scanning) */
  getParent(): Environment | null {
    return this.parent;
  }

  /** Get all bindings (for GC root scanning) */
  getBindings(): Map<string, { value: JSValue; kind: 'var' | 'let' | 'const' }> {
    return this.bindings;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// HELPER: ToBoolean / ToNumber / ToString
// ─────────────────────────────────────────────────────────────────────────────

export function toBoolean(val: JSValue): boolean {
  if (val === undefined || val === null) return false;
  if (val === false || val === 0 || val === -0) return false; // eslint-disable-line no-compare-neg-zero -- JS engine semantics
  if (typeof val === 'number' && isNaN(val)) return false;
  if (val === true || val === '') return val === true;
  if (typeof val === 'bigint') return val !== 0n;
  return true;
}

export function toNumber(val: JSValue): number {
  if (val === undefined) return NaN;
  if (val === null) return 0;
  if (typeof val === 'boolean') return val ? 1 : 0;
  if (typeof val === 'number') return val;
  if (typeof val === 'string') {
    const s = val.trim();
    if (s === '') return 0;
    if (s === 'Infinity' || s === '+Infinity') return Infinity;
    if (s === '-Infinity') return -Infinity;
    if (s === 'NaN') return NaN;
    const n = Number(s);
    return n;
  }
  if (typeof val === 'bigint') return Number(val);
  if (typeof val === 'object' && val !== null) {
    const prim = toPrimitive(val, 'number');
    if (prim === null || typeof prim !== 'object') return toNumber(prim);
  }
  return NaN;
}

/**
 * ToPrimitive (§7.1.1): the object's own/inherited valueOf and toString, in hint order. Objects used
 * to become "[object Object]" / NaN even with a toString or valueOf (errors, dates, user classes).
 * Returns the object itself when neither gives a primitive.
 */
export function toPrimitive(val: JSValue, hint: 'string' | 'number' | 'default'): JSValue {
  if (!val || typeof val !== 'object') return val;
  const obj = val as JSObject;
  const find = (key: string): JSValue => {
    for (let p: JSObject | null = obj, d = 0; p && d < 64; p = p.prototype, d++) {
      const desc = p.properties?.get(key);
      if (desc) return desc.getter ? callJSFunction(desc.getter, obj, []) : desc.value;
    }
    return undefined;
  };
  for (const key of hint === 'string' ? ['toString', 'valueOf'] : ['valueOf', 'toString']) {
    const fn = find(key);
    if (!fn || typeof fn !== 'object' || !('closure' in fn)) continue;
    const r = callJSFunction(fn as JSFunction, obj, []);
    if (r === null || typeof r !== 'object') return r;
  }
  return val;
}

export function toString(val: JSValue): string {
  if (val === undefined) return 'undefined';
  if (val === null) return 'null';
  if (typeof val === 'boolean') return val ? 'true' : 'false';
  if (typeof val === 'number') {
    if (Object.is(val, -0)) return '0';
    if (isNaN(val)) return 'NaN';
    if (!isFinite(val)) return val > 0 ? 'Infinity' : '-Infinity';
    return String(val);
  }
  if (typeof val === 'string') return val;
  if (typeof val === 'bigint') return val.toString() + 'n';
  if (typeof val === 'object' && val !== null) {
    const obj = val as JSObjectWithMeta;
    if (obj.__type_override === 'symbol') {
      const desc = obj.symbolDescription ?? '';
      return `Symbol(${desc})`;
    }
    if (obj.type === 'array') {
      return getArrayElements(obj).map(e => toString(e)).join(',');
    }
    const override = obj.__type_override;
    if (override === 'arraybuffer') return '[object ArrayBuffer]';
    if (override === 'dataview') return '[object DataView]';
    if (override === 'sharedarraybuffer') return '[object SharedArrayBuffer]';
    if (override === 'weakref') return '[object WeakRef]';
    if (override === 'finalizationregistry') return '[object FinalizationRegistry]';
    if (typeof override === 'string' && override.endsWith('Array')) return `[object ${override}]`;
    if ('closure' in obj) return `function ${(obj as unknown as JSFunction).name ?? ''}() { [native code] }`;
    const prim = toPrimitive(val, 'string');
    if (prim === null || typeof prim !== 'object') return toString(prim);
  }
  return '[object Object]';
}

// ─────────────────────────────────────────────────────────────────────────────
// HELPER: Type operations
// ─────────────────────────────────────────────────────────────────────────────

export function getType(val: JSValue): string {
  if (val === undefined || val === null) return typeof val;
  if (typeof val === 'object' && val !== null) {
    if ('type' in val) {
      const obj = val as JSObjectWithMeta;
      if (obj.__type_override === 'symbol') return 'symbol';
      if (obj.type === 'array') return 'object';
      if (obj.type === 'function') return 'function';
      if (obj.type === 'class') return 'function';
    }
    if ('closure' in val) return 'function';
    return 'object';
  }
  if (typeof val === 'function') return 'function';
  return typeof val;
}

export function instanceofCheck(left: JSValue, right: JSValue): boolean {
  if (typeof left !== 'object' || left === null) return false;
  if (!right || typeof right !== 'object') return false;
  const rightObj = right as JSObject;
  const isClass = rightObj.type === 'class';
  const isClosure = 'closure' in right;
  const isNativeFn = isClosure || (rightObj.type === 'function' && rightObj.callable);
  // Classes used to be rejected here, and closures were looked up in a `prototype` property they
  // never have: `x instanceof SomeClass` / `new F() instanceof F` were always false.
  if (!isNativeFn && !isClass) return false;
  const ctorName = isClosure ? (right as JSFunction).name : (rightObj.properties?.get('name')?.value as string ?? '');
  const leftObj = left as JSObject;
  if (ctorName === 'Array' && leftObj.type === 'array') return true;
  const ctorProto = constructorPrototype(right);
  if (!ctorProto || typeof ctorProto !== 'object' || ctorProto === null) return false;
  if (ctorProto === OBJECT_PROTOTYPE) return true; // x instanceof Object: every object here
  let proto = leftObj.prototype;
  for (let depth = 0; proto && depth < 64; depth++) {
    if (proto === ctorProto) return true;
    proto = proto.prototype;
  }
  return false;
}

/** The `.prototype` object of any constructor: a class, a closure (JS or native) or a callable native object. */
export function constructorPrototype(ctor: JSValue): JSObject | null {
  if (!ctor || typeof ctor !== 'object') return null;
  const o = ctor as JSObject;
  if (o.type === 'class') return o.prototype ?? null;
  if ('closure' in o) return functionPrototypeObject(o as unknown as JSFunction);
  const p = o.properties?.get('prototype')?.value;
  return p && typeof p === 'object' ? p as JSObject : null;
}

/**
 * A function's `.prototype` object: an assigned `F.prototype = {…}` wins, otherwise one is made
 * on first use (with `constructor` pointing back) and cached, as the member lookups do.
 */
export function functionPrototypeObject(fn: JSFunction): JSObject {
  const own = (fn as unknown as JSObject).properties?.get('prototype')?.value;
  if (own && typeof own === 'object') return own as JSObject;
  const cached = (fn as unknown as { __proto_obj?: JSObject }).__proto_obj;
  if (cached) return cached;
  const protoObj = createObject(null);
  protoObj.properties.set('constructor', { value: fn as unknown as JSValue, writable: true, enumerable: false, configurable: true });
  (fn as unknown as { __proto_obj?: JSObject }).__proto_obj = protoObj;
  return protoObj;
}


export function createObject(prototype: JSObject | null = null): JSObject {
  return {
    type: 'object',
    properties: new Map(),
    prototype,
  };
}

/**
 * A global object's property map: its own properties, then the root scope's variables as data
 * properties. Writing a data property that is also a variable updates the variable, so the two
 * never disagree.
 */
class GlobalPropertyMap extends Map<string, PropertyDescriptor> {
  constructor(
    private readonly vars: Map<string, { value: JSValue; kind: 'var' | 'let' | 'const'; __tdz?: boolean }>,
    initial: Map<string, PropertyDescriptor>,
  ) {
    super(); // not super(initial): Map's constructor would call the override before `vars` is set
    for (const [k, d] of initial) super.set(k, d);
  }
  ownGet(key: string): PropertyDescriptor | undefined { return super.get(key); }
  ownHas(key: string): boolean { return super.has(key); }
  override get(key: string): PropertyDescriptor | undefined {
    const own = super.get(key);
    if (own) return own;
    const v = this.vars.get(key);
    if (!v || v.__tdz || key === 'this') return undefined;
    return { value: v.value, writable: v.kind !== 'const', enumerable: true, configurable: false };
  }
  override has(key: string): boolean {
    return super.has(key) || (this.vars.has(key) && key !== 'this');
  }
  override set(key: string, desc: PropertyDescriptor): this {
    const v = this.vars.get(key);
    if (v && v.kind !== 'const' && !desc.getter && !desc.setter && !super.has(key)) {
      v.value = desc.value;
      return this;
    }
    return super.set(key, desc);
  }
}

// ── Array prototype ─────────────────────────────────────────────────────────

function getArrayElements(arr: JSObject): JSValue[] {
  const len = Number(arr.properties.get('length')?.value ?? 0);
  const elems: JSValue[] = [];
  for (let i = 0; i < len; i++) elems.push(arr.properties.get(String(i))?.value);
  return elems;
}

function setArrayElement(arr: JSObject, index: number, value: JSValue): void {
  arr.properties.set(String(index), { value, writable: true, enumerable: true, configurable: true });
}

function updateArrayLength(arr: JSObject, newLen: number): void {
  arr.properties.set('length', { value: newLen, writable: true, enumerable: false, configurable: false });
}

function arrayPush(_this: JSValue, args: JSValue[]): JSValue {
  if (typeof _this !== 'object' || _this === null) return 0;
  const arr = _this as JSObject;
  const len = Number(arr.properties.get('length')?.value ?? 0);
  for (let i = 0; i < args.length; i++) {
    setArrayElement(arr, len + i, args[i]);
  }
  updateArrayLength(arr, len + args.length);
  return len + args.length;
}

function arrayPop(_this: JSValue, _args: JSValue[]): JSValue {
  if (typeof _this !== 'object' || _this === null) return undefined;
  const arr = _this as JSObject;
  const len = Number(arr.properties.get('length')?.value ?? 0);
  if (len === 0) { updateArrayLength(arr, 0); return undefined; }
  const val = arr.properties.get(String(len - 1))?.value;
  arr.properties.delete(String(len - 1));
  updateArrayLength(arr, len - 1);
  return val;
}

function arrayJoin(_this: JSValue, args: JSValue[]): JSValue {
  if (typeof _this !== 'object' || _this === null) return '';
  const elems = getArrayElements(_this as JSObject);
  const sep = args[0] !== undefined ? toString(args[0]) : ',';
  return elems.map(e => e === undefined || e === null ? '' : toString(e)).join(sep);
}

function arrayIndexOf(_this: JSValue, args: JSValue[]): JSValue {
  if (typeof _this !== 'object' || _this === null) return -1;
  const elems = getArrayElements(_this as JSObject);
  const search = args[0];
  for (let i = 0; i < elems.length; i++) {
    if (elems[i] === search) return i;
  }
  return -1;
}

function arrayIncludes(_this: JSValue, args: JSValue[]): JSValue {
  return arrayIndexOf(_this, args) !== -1;
}

function arraySlice(_this: JSValue, args: JSValue[]): JSValue {
  if (typeof _this !== 'object' || _this === null) return createArray([]);
  const elems = getArrayElements(_this as JSObject);
  const start = args[0] !== undefined ? Math.max(0, toNumber(args[0])) : 0;
  const end = args[1] !== undefined ? Math.min(elems.length, toNumber(args[1])) : elems.length;
  return createArray(elems.slice(start, end));
}

function arrayConcat(_this: JSValue, args: JSValue[]): JSValue {
  if (typeof _this !== 'object' || _this === null) return createArray([]);
  const result = [...getArrayElements(_this as JSObject)];
  for (const arg of args) {
    if (typeof arg === 'object' && arg !== null && (arg as JSObject).type === 'array') {
      result.push(...getArrayElements(arg as JSObject));
    } else {
      result.push(arg);
    }
  }
  return createArray(result);
}

function arrayReverse(_this: JSValue, _args: JSValue[]): JSValue {
  if (typeof _this !== 'object' || _this === null) return _this;
  const arr = _this as JSObject;
  const elems = getArrayElements(arr).reverse();
  for (let i = 0; i < elems.length; i++) setArrayElement(arr, i, elems[i]);
  return arr;
}

function arraySort(_this: JSValue, args: JSValue[]): JSValue {
  if (typeof _this !== 'object' || _this === null) return _this;
  const arr = _this as JSObject;
  const elems = getArrayElements(arr);
  const cmpFn = args[0];
  if (typeof cmpFn === 'object' && cmpFn !== null && (cmpFn as JSFunction).type === 'closure') {
    elems.sort((a, b) => toNumber(callJSFunction(cmpFn as JSFunction, undefined, [a, b])));
  } else {
    elems.sort((a, b) => {
      const sa = toString(a);
      const sb = toString(b);
      return sa < sb ? -1 : sa > sb ? 1 : 0;
    });
  }
  for (let i = 0; i < elems.length; i++) setArrayElement(arr, i, elems[i]);
  return arr;
}

function arrayMap(_this: JSValue, args: JSValue[]): JSValue {
  if (typeof _this !== 'object' || _this === null) return createArray([]);
  const elems = getArrayElements(_this as JSObject);
  const fn = args[0];
  if (typeof fn !== 'object' || fn === null || (fn as JSFunction).type !== 'closure') return createArray([]);
  const result = elems.map((e, i) => callJSFunction(fn as JSFunction, undefined, [e, Number(i), _this]));
  return createArray(result);
}

function arrayFilter(_this: JSValue, args: JSValue[]): JSValue {
  if (typeof _this !== 'object' || _this === null) return createArray([]);
  const elems = getArrayElements(_this as JSObject);
  const fn = args[0];
  if (typeof fn !== 'object' || fn === null || (fn as JSFunction).type !== 'closure') return createArray([]);
  const result = elems.filter((e, i) => toBoolean(callJSFunction(fn as JSFunction, undefined, [e, Number(i), _this])));
  return createArray(result);
}

function arrayReduce(_this: JSValue, args: JSValue[]): JSValue {
  if (typeof _this !== 'object' || _this === null) return undefined;
  const elems = getArrayElements(_this as JSObject);
  const fn = args[0];
  if (typeof fn !== 'object' || fn === null || (fn as JSFunction).type !== 'closure') return undefined;
  let acc = args.length > 1 ? args[1] : undefined;
  let startIdx = args.length > 1 ? 0 : 1;
  if (args.length <= 1 && elems.length > 0) acc = elems[0];
  if (args.length <= 1) startIdx = 1;
  for (let i = startIdx; i < elems.length; i++) {
    acc = callJSFunction(fn as JSFunction, undefined, [acc, elems[i], Number(i), _this]);
  }
  return acc;
}

function arrayFind(_this: JSValue, args: JSValue[]): JSValue {
  if (typeof _this !== 'object' || _this === null) return undefined;
  const elems = getArrayElements(_this as JSObject);
  const fn = args[0];
  if (typeof fn !== 'object' || fn === null || (fn as JSFunction).type !== 'closure') return undefined;
  for (let i = 0; i < elems.length; i++) {
    if (toBoolean(callJSFunction(fn as JSFunction, undefined, [elems[i], Number(i), _this]))) return elems[i];
  }
  return undefined;
}

function arrayForEach(_this: JSValue, args: JSValue[]): JSValue {
  if (typeof _this !== 'object' || _this === null) return undefined;
  const elems = getArrayElements(_this as JSObject);
  const fn = args[0];
  if (typeof fn !== 'object' || fn === null || (fn as JSFunction).type !== 'closure') return undefined;
  for (let i = 0; i < elems.length; i++) {
    callJSFunction(fn as JSFunction, undefined, [elems[i], Number(i), _this]);
  }
  return undefined;
}

function arrayFindIndex(_this: JSValue, args: JSValue[]): JSValue {
  if (typeof _this !== 'object' || _this === null) return -1;
  const elems = getArrayElements(_this as JSObject);
  const fn = args[0];
  if (typeof fn !== 'object' || fn === null || (fn as JSFunction).type !== 'closure') return -1;
  for (let i = 0; i < elems.length; i++) {
    if (toBoolean(callJSFunction(fn as JSFunction, undefined, [elems[i], Number(i), _this]))) return i;
  }
  return -1;
}

function arraySplice(_this: JSValue, args: JSValue[]): JSValue {
  if (typeof _this !== 'object' || _this === null) return createArray([]);
  const arr = _this as JSObject;
  const elems = getArrayElements(arr);
  const start = Math.max(0, toNumber(args[0]));
  const deleteCount = args.length > 1 ? Math.min(elems.length - start, Math.max(0, toNumber(args[1]))) : elems.length - start;
  const newItems = args.slice(2);
  const removed = elems.slice(start, start + deleteCount);
  const result = [...elems.slice(0, start), ...newItems, ...elems.slice(start + deleteCount)];
  for (let i = 0; i < result.length; i++) setArrayElement(arr, i, result[i]);
  updateArrayLength(arr, result.length);
  return createArray(removed);
}

function arrayUnshift(_this: JSValue, args: JSValue[]): JSValue {
  if (typeof _this !== 'object' || _this === null) return 0;
  const arr = _this as JSObject;
  const elems = getArrayElements(arr);
  const result = [...args, ...elems];
  for (let i = 0; i < result.length; i++) setArrayElement(arr, i, result[i]);
  updateArrayLength(arr, result.length);
  return result.length;
}

function arrayFlat(_this: JSValue, args: JSValue[]): JSValue {
  if (typeof _this !== 'object' || _this === null) return createArray([]);
  const depth = args[0] !== undefined ? toNumber(args[0]) : 1;
  const flatMapDepth = (arr: JSObject, d: number): JSValue[] => {
    const result: JSValue[] = [];
    for (const elem of getArrayElements(arr)) {
      if (d > 0 && typeof elem === 'object' && elem !== null && (elem as JSObject).type === 'array') {
        result.push(...flatMapDepth(elem as JSObject, d - 1));
      } else {
        result.push(elem);
      }
    }
    return result;
  };
  return createArray(flatMapDepth(_this as JSObject, depth));
}

function arrayFrom(_this: JSValue, args: JSValue[]): JSValue {
  const iterable = args[0];
  if (iterable === undefined || iterable === null) return createArray([]);
  if (typeof iterable === 'object' && (iterable as JSObject).type === 'array') return iterable as JSObject;
  if (typeof iterable === 'string') {
    const chars = (iterable as string).split('');
    return createArray(chars);
  }
  return createArray([]);
}

const arrayNativeMethods: Record<string, NativeFunction> = {
  push: arrayPush,
  pop: arrayPop,
  join: arrayJoin,
  indexOf: arrayIndexOf,
  includes: arrayIncludes,
  slice: arraySlice,
  concat: arrayConcat,
  reverse: arrayReverse,
  sort: arraySort,
  map: arrayMap,
  filter: arrayFilter,
  reduce: arrayReduce,
  find: arrayFind,
  forEach: arrayForEach,
  findIndex: arrayFindIndex,
  splice: arraySplice,
  unshift: arrayUnshift,
  flat: arrayFlat,
  keys: (_this) => {
    if (typeof _this !== 'object' || _this === null) return createArray([]);
    const len = Number((_this as JSObject).properties.get('length')?.value ?? 0);
    return createArray(Array.from({ length: len }, (_, i) => i));
  },
  values: (_this) => {
    if (typeof _this !== 'object' || _this === null) return createArray([]);
    return createArray(getArrayElements(_this as JSObject));
  },
  entries: (_this) => {
    if (typeof _this !== 'object' || _this === null) return createArray([]);
    const elems = getArrayElements(_this as JSObject);
    return createArray(elems.map((v, i) => createArray([i, v])));
  },
  fill: (_this, args) => {
    if (typeof _this !== 'object' || _this === null) return _this;
    const arr = _this as JSObject;
    const val = args[0];
    const len = Number(arr.properties.get('length')?.value ?? 0);
    for (let i = 0; i < len; i++) setArrayElement(arr, i, val);
    return arr;
  },
  every: (_this, args) => {
    if (typeof _this !== 'object' || _this === null) return true;
    const elems = getArrayElements(_this as JSObject);
    const fn = args[0];
    if (typeof fn !== 'object' || fn === null || (fn as JSFunction).type !== 'closure') return true;
    for (let i = 0; i < elems.length; i++) {
      if (!toBoolean(callJSFunction(fn as JSFunction, undefined, [elems[i], Number(i), _this]))) return false;
    }
    return true;
  },
  some: (_this, args) => {
    if (typeof _this !== 'object' || _this === null) return false;
    const elems = getArrayElements(_this as JSObject);
    const fn = args[0];
    if (typeof fn !== 'object' || fn === null || (fn as JSFunction).type !== 'closure') return false;
    for (let i = 0; i < elems.length; i++) {
      if (toBoolean(callJSFunction(fn as JSFunction, undefined, [elems[i], Number(i), _this]))) return true;
    }
    return false;
  },
};

/** Property key of Symbol.iterator: computed keys go through toString, giving "Symbol(iterator)". */
export const ITERATOR_KEY = 'Symbol(iterator)';

function getProp(o: JSObject, key: string): JSValue {
  for (let p: JSObject | null = o, d = 0; p && d < 64; p = p.prototype, d++) {
    const desc = p.properties?.get(key);
    if (desc) return desc.getter ? callJSFunction(desc.getter, o, []) : desc.value;
  }
  return undefined;
}

/**
 * The iteration protocol (§7.4) for for-of, spread, destructuring and Array.from: strings by code
 * point, arrays by index, anything else via [Symbol.iterator]() and next(). Lazy, so `break` out of
 * an endless iterator works. Only array-likes used to iterate (Map, Set, custom iterables gave nothing).
 */
export function* iterateJS(value: JSValue): Generator<JSValue, void, undefined> {
  if (typeof value === 'string') { yield* value; return; }
  if (!value || typeof value !== 'object') throw new TypeError(`${toString(value)} is not iterable`);
  const obj = value as JSObject;
  const indexed = function* (a: JSObject) {
    for (let i = 0; i < Number(a.properties.get('length')?.value ?? 0); i++) yield a.properties.get(String(i))?.value;
  };
  if (obj.type === 'array') { yield* indexed(obj); return; }
  const method = getProp(obj, ITERATOR_KEY);
  if (!method || typeof method !== 'object' || !('closure' in method)) {
    if (obj.properties?.has('length')) { yield* indexed(obj); return; } // array-likes (NodeList, arguments)
    throw new TypeError('object is not iterable');
  }
  const it = callJSFunction(method as JSFunction, obj, []);
  if (it && typeof it === 'object' && (it as JSObject).type === 'array') { yield* indexed(it as JSObject); return; }
  if (!it || typeof it !== 'object') throw new TypeError('Result of the Symbol.iterator method is not an object');
  const next = getProp(it as JSObject, 'next');
  if (!next || typeof next !== 'object' || !('closure' in next)) throw new TypeError('iterator.next is not a function');
  for (;;) {
    const r = callJSFunction(next as JSFunction, it, []);
    if (!r || typeof r !== 'object') throw new TypeError(`Iterator result ${toString(r)} is not an object`);
    if (toBoolean(getProp(r as JSObject, 'done'))) return;
    yield getProp(r as JSObject, 'value');
  }
}

/** An array that is also its own iterator (`.next()`, `[Symbol.iterator]()`), for Map/Set entries() etc. */
export function createIteratorArray(values: JSValue[]): JSObject {
  const arr = createArray(values);
  let i = 0;
  const hidden = (value: JSValue) => ({ value, writable: true, enumerable: false, configurable: true });
  arr.properties.set('next', hidden(createNativeFunction('next', () => {
    const r = createObject(null);
    const done = i >= values.length;
    r.properties.set('value', { value: done ? undefined : values[i++], writable: true, enumerable: true, configurable: true });
    r.properties.set('done', { value: done, writable: true, enumerable: true, configurable: true });
    return r;
  })));
  arr.properties.set(ITERATOR_KEY, hidden(createNativeFunction('[Symbol.iterator]', () => arr)));
  return arr;
}

/** Array.prototype: every array links to it, so `Array.prototype.slice.call(x)`, `[] instanceof Array`
 *  and polyfills (`Array.prototype.foo = …`) work. Arrays also keep their own method copies. */
export const ARRAY_PROTOTYPE: JSObject = createObject(null);
for (const [name, fn] of Object.entries(arrayNativeMethods)) {
  ARRAY_PROTOTYPE.properties.set(name, { value: createNativeFunction(name, fn), writable: true, enumerable: false, configurable: true });
}

function attachArrayMethods(arr: JSObject): void {
  for (const [name, fn] of Object.entries(arrayNativeMethods)) {
    arr.properties.set(name, {
      value: createNativeFunction(name, fn),
      writable: true, enumerable: false, configurable: true,
    });
  }
}

export function createArray(elements: JSValue[] = []): JSObject {
  const arr = createObject(ARRAY_PROTOTYPE);
  arr.type = 'array';
  for (let i = 0; i < elements.length; i++) {
    arr.properties.set(String(i), { value: elements[i], writable: true, enumerable: true, configurable: true });
  }
  arr.properties.set('length', { value: elements.length, writable: true, enumerable: false, configurable: false });
  attachArrayMethods(arr);
  return arr;
}

export function createFunction(
  name: string,
  params: string[],
  body: unknown,
  closure: Environment,
  async = false,
  isArrow = false,
  generator = false,
  isBytecode = false,
  upvalues?: UpvalueRef[],
  isStrict = false,
): JSFunction {
  if (isStrict) {
    const seen = new Set<string>();
    for (const p of params) {
      if (seen.has(p)) {
        throw new JSError(`SyntaxError: Duplicate parameter name '${p}' in strict mode`);
      }
      seen.add(p);
    }
  }
  return {
    type: 'closure',
    name,
    params,
    body,
    closure,
    async,
    generator,
    isArrow,
    isNative: false,
    isBytecode,
    upvalues,
    isStrict,
  };
}

export function createNativeFunction(name: string, fn: NativeFunction): JSFunction {
  return {
    type: 'closure',
    name,
    params: [],
    body: null,
    closure: new Environment(),
    async: false,
    generator: false,
    isArrow: false,
    isNative: true,
    nativeFn: fn,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// JS FUNCTION CALLING — Bridge for calling JS functions from outside the
// interpreter (e.g., event loop, DOM bindings). The interpreter registers
// itself via setGlobalCaller() at the start of run().
// ─────────────────────────────────────────────────────────────────────────────

export interface JSFunctionCaller {
  callFunction(fn: JSFunction, thisArg: JSValue, args: JSValue[]): JSValue;
}

let _globalCaller: JSFunctionCaller | null = null;

export function getGlobalCaller(): JSFunctionCaller | null {
  return _globalCaller;
}

export function setGlobalCaller(caller: JSFunctionCaller | null): void {
  _globalCaller = caller;
}

export function callJSFunction(fn: JSFunction, thisArg: JSValue, args: JSValue[]): JSValue {
  // Fast path: native functions can be called directly
  if (fn.isNative && fn.nativeFn) {
    try {
      return fn.nativeFn(thisArg, args) as JSValue;
    } catch (err) {
      // Host Errors pass through unchanged: a page catch turns them into a TypeError/RangeError of its
      // own (Interpreter.hostErrorToJS). Wrapping them made `e` the bare message string.
      if (err instanceof JSError || err instanceof Error) throw err;
      throw new JSError(String(err));
    }
  }
  // Non-native: delegate to the interpreter
  if (_globalCaller) {
    return _globalCaller.callFunction(fn, thisArg, args);
  }
  throw new Error('No JS interpreter registered — cannot call non-native function');
}

// ── JSError ──────────────────────────────────────────────────────────────────

export class JSError extends Error {
  value: JSValue;
  constructor(value: JSValue) {
    super(describeThrown(value));
    this.value = value;
  }
}

/**
 * Readable text for a thrown page value: an Error-like object gives "Name: message" (from own or
 * inherited data properties). toString() gave "[object Object]", so every failing site's script
 * error in logcat said only "[object Object]".
 */
function describeThrown(value: JSValue): string {
  if (value && typeof value === 'object' && 'properties' in value) {
    const read = (key: string): JSValue => {
      for (let o: JSObject | null = value as JSObject, depth = 0; o && depth < 16; o = o.prototype, depth++) {
        const d = o.properties?.get(key);
        if (d && !d.getter) return d.value;
      }
      return undefined;
    };
    const message = read('message');
    if (message !== undefined) {
      const name = read('name');
      const text = toString(message);
      return name !== undefined && toString(name) ? `${toString(name)}: ${text}` : text;
    }
  }
  return toString(value);
}

/**
 * Object.prototype. Objects here are created without it, so its methods are a lookup fallback
 * (see objectPrototypeMember) rather than a real link; for-in, Object.keys and JSON keep seeing
 * own properties only. Before this, `obj.hasOwnProperty(k)` was undefined on every object.
 */
export const OBJECT_PROTOTYPE: JSObject = createObject(null);
{
  const data = (value: JSValue) => ({ value, writable: true, enumerable: false, configurable: true });
  const own = (o: JSValue, key: JSValue): PropertyDescriptor | undefined =>
    o && typeof o === 'object' ? (o as JSObject).properties?.get(toString(key)) : undefined;
  OBJECT_PROTOTYPE.properties.set('hasOwnProperty', data(createNativeFunction('hasOwnProperty', (t, a) => own(t, a[0]) !== undefined)));
  OBJECT_PROTOTYPE.properties.set('propertyIsEnumerable', data(createNativeFunction('propertyIsEnumerable', (t, a) => own(t, a[0])?.enumerable === true)));
  OBJECT_PROTOTYPE.properties.set('isPrototypeOf', data(createNativeFunction('isPrototypeOf', (t, a) => {
    let p = a[0] && typeof a[0] === 'object' ? (a[0] as JSObject).prototype : null;
    for (let depth = 0; p && depth < 64; depth++) { if (p === t) return true; p = p.prototype; }
    return false;
  })));
  OBJECT_PROTOTYPE.properties.set('toString', data(createNativeFunction('toString', (t) => {
    if (t === undefined) return '[object Undefined]';
    if (t === null) return '[object Null]';
    if (typeof t !== 'object') return `[object ${typeof t === 'number' ? 'Number' : typeof t === 'string' ? 'String' : typeof t === 'boolean' ? 'Boolean' : 'Object'}]`;
    const o = t as JSObject;
    if (o.type === 'array') return '[object Array]';
    if ('closure' in o || o.type === 'class' || o.type === 'function') return '[object Function]';
    return '[object Object]';
  })));
  OBJECT_PROTOTYPE.properties.set('toLocaleString', data(createNativeFunction('toLocaleString', (t) => toString(t))));
  OBJECT_PROTOTYPE.properties.set('valueOf', data(createNativeFunction('valueOf', (t) => t)));
}

/** Object.prototype member for a lookup that found nothing on the object or its chain. */
export function objectPrototypeMember(key: string): JSValue {
  return OBJECT_PROTOTYPE.properties.get(key)?.value;
}
