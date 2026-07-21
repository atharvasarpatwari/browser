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
}

export type NativeFunction = (thisArg: JSValue, args: JSValue[]) => JSValue;

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

export function isBreakSignal(v: unknown): v is BreakSignal { return typeof v === 'object' && v !== null && (v as BreakSignal).type === 'break'; }
export function isContinueSignal(v: unknown): v is ContinueSignal { return typeof v === 'object' && v !== null && (v as ContinueSignal).type === 'continue'; }
export function isReturnSignal(v: unknown): v is ReturnSignal { return typeof v === 'object' && v !== null && (v as ReturnSignal).type === 'return'; }
export function isThrowSignal(v: unknown): v is ThrowSignal { return typeof v === 'object' && v !== null && (v as ThrowSignal).type === 'throw'; }

// ─────────────────────────────────────────────────────────────────────────────
// ENVIRONMENT
// ─────────────────────────────────────────────────────────────────────────────

export class Environment {
  private bindings = new Map<string, { value: JSValue; kind: 'var' | 'let' | 'const' }>();
  readonly parent: Environment | null;

  constructor(parent: Environment | null = null) {
    this.parent = parent;
  }

  /** Declare a variable (var/let/const) */
  declare(name: string, value: JSValue, kind: 'var' | 'let' | 'const' = 'var'): void {
    if (kind === 'var') {
      // var declarations hoist to the nearest function scope
      let scope: Environment | null = this;
      while (scope && !scope.isFunctionScope()) {
        scope = scope.parent;
      }
      if (scope) {
        scope.bindings.set(name, { value, kind });
      } else {
        this.bindings.set(name, { value, kind });
      }
    } else {
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
    return false;
  }

  /** Set a variable directly (for let/const in current scope) */
  setLocal(name: string, value: JSValue, kind: 'let' | 'const' = 'let'): void {
    this.bindings.set(name, { value, kind });
  }

  /** Get a variable value */
  get(name: string): JSValue {
    const binding = this.bindings.get(name);
    if (binding) {
      return binding.value;
    }
    if (this.parent) {
      return this.parent.get(name);
    }
    return undefined;
  }

  /** Check if a variable exists in this scope or any parent */
  has(name: string): boolean {
    if (this.bindings.has(name)) return true;
    if (this.parent) return this.parent.has(name);
    return false;
  }

  private isFunctionScope(): boolean {
    return (this as Record<string, unknown>)['__functionScope'] === true;
  }

  markFunctionScope(): void {
    (this as Record<string, unknown>)['__functionScope'] = true;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// HELPER: ToBoolean / ToNumber / ToString
// ─────────────────────────────────────────────────────────────────────────────

export function toBoolean(val: JSValue): boolean {
  if (val === undefined || val === null) return false;
  if (val === false || val === 0 || val === -0) return false;
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
  return NaN;
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
    const obj = val as JSObject;
    if (obj.type === 'array') {
      return getArrayElements(obj).map(e => toString(e)).join(',');
    }
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
      const obj = val as JSObject;
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
  const ctor = right as JSFunction;
  if (!('closure' in ctor)) return false;
  const ctorName = (ctor as JSFunction).name;
  const leftObj = left as JSObject;
  if (ctorName === 'Array' && leftObj.type === 'array') return true;
  const ctorProto = ctor.properties?.get('prototype')?.value;
  if (!ctorProto || typeof ctorProto !== 'object' || ctorProto === null) return false;
  let proto = leftObj.prototype;
  while (proto) {
    if (proto === ctorProto) return true;
    proto = proto.prototype;
  }
  return false;
}

export function createObject(prototype: JSObject | null = null): JSObject {
  return {
    type: 'object',
    properties: new Map(),
    prototype,
  };
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

function attachArrayMethods(arr: JSObject): void {
  for (const [name, fn] of Object.entries(arrayNativeMethods)) {
    arr.properties.set(name, {
      value: createNativeFunction(name, fn),
      writable: true, enumerable: false, configurable: true,
    });
  }
}

export function createArray(elements: JSValue[] = []): JSObject {
  const arr = createObject(null);
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
): JSFunction {
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

export function setGlobalCaller(caller: JSFunctionCaller | null): void {
  _globalCaller = caller;
}

export function callJSFunction(fn: JSFunction, thisArg: JSValue, args: JSValue[]): JSValue {
  // Fast path: native functions can be called directly
  if (fn.isNative && fn.nativeFn) {
    try {
      return fn.nativeFn(thisArg, args);
    } catch (err) {
      if (err instanceof JSError) throw err;
      throw new JSError(err instanceof Error ? err.message : String(err));
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
    super(toString(value));
    this.value = value;
  }
}
