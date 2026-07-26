// ─────────────────────────────────────────────────────────────────────────────
// ArrayBuffer, TypedArray, DataView — Web API built-in constructors
// WHATWG Typed Arrays spec + Node.js native ArrayBuffer backing
// ─────────────────────────────────────────────────────────────────────────────

import {
  createObject, createNativeFunction, createArray,
  toNumber, toBoolean, toString, getType, callJSFunction,
} from './values';
import type { JSValue, JSObject, JSFunction } from './values';
import { JSError } from './values';

function toInteger(val: JSValue): number {
  const n = toNumber(val);
  if (Number.isNaN(n) || n === 0) return 0;
  return n < 0 ? Math.ceil(n) : Math.floor(n);
}

// ── Helpers ──────────────────────────────────────────────────────────────────

const TYPED_ARRAY_NAMES = [
  'Int8Array', 'Uint8Array', 'Uint8ClampedArray',
  'Int16Array', 'Uint16Array',
  'Int32Array', 'Uint32Array',
  'Float32Array', 'Float64Array',
  'BigInt64Array', 'BigUint64Array',
] as const;

type TypedArrayName = typeof TYPED_ARRAY_NAMES[number];

interface TypedArrayMeta {
  BYTES_PER_ELEMENT: number;
  TypedArrayName: TypedArrayName;
  get(buf: ArrayBuffer, offset: number, littleEndian?: boolean): number | bigint;
  set(buf: ArrayBuffer, offset: number, value: number | bigint, littleEndian?: boolean): void;
  clamp?: boolean;
}

const TYPED_ARRAY_META: Record<TypedArrayName, TypedArrayMeta> = {
  Int8Array: {
    BYTES_PER_ELEMENT: 1,
    TypedArrayName: 'Int8Array',
    get: (buf, off) => new DataView(buf).getInt8(off),
    set: (buf, off, v) => new DataView(buf).setInt8(off, Number(v)),
  },
  Uint8Array: {
    BYTES_PER_ELEMENT: 1,
    TypedArrayName: 'Uint8Array',
    get: (buf, off) => new DataView(buf).getUint8(off),
    set: (buf, off, v) => new DataView(buf).setUint8(off, Number(v)),
  },
  Uint8ClampedArray: {
    BYTES_PER_ELEMENT: 1,
    TypedArrayName: 'Uint8ClampedArray',
    get: (buf, off) => new DataView(buf).getUint8(off),
    set: (buf, off, v) => new DataView(buf).setUint8(off, Math.min(255, Math.max(0, Math.round(Number(v))))),
    clamp: true,
  },
  Int16Array: {
    BYTES_PER_ELEMENT: 2,
    TypedArrayName: 'Int16Array',
    get: (buf, off, le) => new DataView(buf).getInt16(off, le),
    set: (buf, off, v, le) => new DataView(buf).setInt16(off, Number(v), le),
  },
  Uint16Array: {
    BYTES_PER_ELEMENT: 2,
    TypedArrayName: 'Uint16Array',
    get: (buf, off, le) => new DataView(buf).getUint16(off, le),
    set: (buf, off, v, le) => new DataView(buf).setUint16(off, Number(v), le),
  },
  Int32Array: {
    BYTES_PER_ELEMENT: 4,
    TypedArrayName: 'Int32Array',
    get: (buf, off, le) => new DataView(buf).getInt32(off, le),
    set: (buf, off, v, le) => new DataView(buf).setInt32(off, Number(v), le),
  },
  Uint32Array: {
    BYTES_PER_ELEMENT: 4,
    TypedArrayName: 'Uint32Array',
    get: (buf, off, le) => new DataView(buf).getUint32(off, le),
    set: (buf, off, v, le) => new DataView(buf).setUint32(off, Number(v), le),
  },
  Float32Array: {
    BYTES_PER_ELEMENT: 4,
    TypedArrayName: 'Float32Array',
    get: (buf, off, le) => new DataView(buf).getFloat32(off, le),
    set: (buf, off, v, le) => new DataView(buf).setFloat32(off, Number(v), le),
  },
  Float64Array: {
    BYTES_PER_ELEMENT: 8,
    TypedArrayName: 'Float64Array',
    get: (buf, off, le) => new DataView(buf).getFloat64(off, le),
    set: (buf, off, v, le) => new DataView(buf).setFloat64(off, Number(v), le),
  },
  BigInt64Array: {
    BYTES_PER_ELEMENT: 8,
    TypedArrayName: 'BigInt64Array',
    get: (buf, off, le) => new DataView(buf).getBigInt64(off, le),
    set: (buf, off, v, le) => new DataView(buf).setBigInt64(off, BigInt(v as any), le),
  },
  BigUint64Array: {
    BYTES_PER_ELEMENT: 8,
    TypedArrayName: 'BigUint64Array',
    get: (buf, off, le) => new DataView(buf).getBigUint64(off, le),
    set: (buf, off, v, le) => new DataView(buf).setBigUint64(off, BigInt(v as any), le),
  },
};

// ── ArrayBuffer ──────────────────────────────────────────────────────────────

function wrapArrayBuffer(native: ArrayBuffer): JSObject {
  const ab = createObject(arrayBufferProto);
  (ab as any).__type_override = 'arraybuffer';
  (ab as any).__nativeBuffer = native;
  return ab;
}

function getArrayBuffer(obj: JSValue, method: string): ArrayBuffer {
  if (typeof obj !== 'object' || obj === null) throw new JSError('TypeError: Cannot call ' + method + ' on non-object');
  const native = (obj as any).__nativeBuffer as ArrayBuffer | undefined;
  if (!native) throw new JSError('TypeError: ' + method + ' called on non-ArrayBuffer object');
  return native;
}

const arrayBufferProto = createObject(null);
arrayBufferProto.properties.set('byteLength', {
  value: undefined, getter: createNativeFunction('byteLength', (_this, _args) => {
    const native = getArrayBuffer(_this, 'get ArrayBuffer.prototype.byteLength');
    return native.byteLength;
  }),
  writable: false, enumerable: false, configurable: true,
});

arrayBufferProto.properties.set('slice', {
  value: createNativeFunction('slice', (_this, args) => {
    const native = getArrayBuffer(_this, 'ArrayBuffer.prototype.slice');
    const start = args[0] !== undefined ? toInteger(args[0]) : 0;
    const end = args[1] !== undefined ? toInteger(args[1]) : native.byteLength;
    const s = Math.max(0, Math.min(start, native.byteLength));
    const e = Math.max(0, Math.min(end, native.byteLength));
    const newLen = Math.max(0, e - s);
    const newBuf = new ArrayBuffer(newLen);
    new Uint8Array(newBuf).set(new Uint8Array(native, s, newLen));
    return wrapArrayBuffer(newBuf);
  }),
  writable: true, enumerable: true, configurable: true,
});

arrayBufferProto.properties.set('transfer', {
  value: createNativeFunction('transfer', (_this, args) => {
    const native = getArrayBuffer(_this, 'ArrayBuffer.prototype.transfer');
    const newLen = args[0] !== undefined ? toInteger(args[0]) : native.byteLength;
    const newBuf = new ArrayBuffer(newLen);
    const copyLen = Math.min(native.byteLength, newLen);
    new Uint8Array(newBuf).set(new Uint8Array(native, 0, copyLen));
    return wrapArrayBuffer(newBuf);
  }),
  writable: true, enumerable: true, configurable: true,
});

function createArrayBufferConstructor(): JSFunction {
  const ctor = createNativeFunction('ArrayBuffer', (_this, args) => {
    const byteLength = args[0] !== undefined ? toInteger(args[0]) : 0;
    if (byteLength < 0) throw new JSError('RangeError: Invalid ArrayBuffer length');
    return wrapArrayBuffer(new ArrayBuffer(byteLength));
  });
  return ctor;
}

// Static: ArrayBuffer.isView
function createArrayBufferCtorObj(arrayBufferProtoRef: JSObject): JSObject {
  const ctorObj = createObject(null);
  ctorObj.type = 'function';
  ctorObj.callable = true;
  ctorObj.nativeFn = createArrayBufferConstructor().nativeFn;
  ctorObj.properties.set('prototype', { value: arrayBufferProtoRef, writable: false, enumerable: false, configurable: false });
  ctorObj.properties.set('isView', {
    value: createNativeFunction('isView', (_this, args) => {
      const val = args[0];
      if (typeof val !== 'object' || val === null) return false;
      const obj = val as JSObject;
      if ((obj as any).__type_override === 'dataview') return true;
      if ((obj as any).__type_override && TYPED_ARRAY_NAMES.includes((obj as any).__type_override)) return true;
      return false;
    }),
    writable: true, enumerable: true, configurable: true,
  });
  return ctorObj;
}

// ── DataView ─────────────────────────────────────────────────────────────────

function wrapDataView(buf: ArrayBuffer, offset: number, byteLength: number): JSObject {
  const dv = createObject(dataViewProto);
  (dv as any).__type_override = 'dataview';
  (dv as any).__nativeBuffer = buf;
  (dv as any).__dvOffset = offset;
  (dv as any).__dvByteLength = byteLength;
  return dv;
}

function getDVView(obj: JSValue): { view: DataView; littleEndian: boolean } {
  if (typeof obj !== 'object' || obj === null) throw new JSError('TypeError: Cannot call DataView method on non-object');
  const buf = (obj as any).__nativeBuffer as ArrayBuffer;
  const offset = (obj as any).__dvOffset as number;
  const byteLength = (obj as any).__dvByteLength as number;
  if (!buf) throw new JSError('TypeError: DataView called on non-DataView object');
  return { view: new DataView(buf, offset, byteLength), littleEndian: false };
}

function dvGetter(
  methodName: string,
  getMethod: 'getInt8' | 'getUint8' | 'getInt16' | 'getUint16' | 'getInt32' | 'getUint32' | 'getFloat32' | 'getFloat64' | 'getBigInt64' | 'getBigUint64',
  bytesPerElement: number,
) {
  return createNativeFunction(methodName, (_this, args) => {
    const { view } = getDVView(_this);
    const offset = args[0] !== undefined ? toInteger(args[0]) : 0;
    const littleEndian = args[1] !== undefined ? toBoolean(args[1]) : false;
    if (offset < 0 || offset + bytesPerElement > view.byteLength) {
      throw new JSError('RangeError: Offset is outside the bounds of the DataView');
    }
    return (view as any)[getMethod](offset, littleEndian);
  });
}

function dvSetter(
  methodName: string,
  setMethod: 'setInt8' | 'setUint8' | 'setInt16' | 'setUint16' | 'setInt32' | 'setUint32' | 'setFloat32' | 'setFloat64' | 'setBigInt64' | 'setBigUint64',
  bytesPerElement: number,
) {
  return createNativeFunction(methodName, (_this, args) => {
    const { view } = getDVView(_this);
    const offset = args[0] !== undefined ? toInteger(args[0]) : 0;
    const value = args[1];
    const littleEndian = args[2] !== undefined ? toBoolean(args[2]) : false;
    if (offset < 0 || offset + bytesPerElement > view.byteLength) {
      throw new JSError('RangeError: Offset is outside the bounds of the DataView');
    }
    if (setMethod === 'setBigInt64' || setMethod === 'setBigUint64') {
      (view as any)[setMethod](offset, BigInt(value as any), littleEndian);
    } else {
      (view as any)[setMethod](offset, Number(value), littleEndian);
    }
    return undefined;
  });
}

const dataViewProto = createObject(null);
dataViewProto.properties.set('buffer', {
  value: undefined, getter: createNativeFunction('buffer', (_this, _args) => {
    const buf = (_this as any).__nativeBuffer as ArrayBuffer;
    return buf ? wrapArrayBuffer(buf) : undefined;
  }),
  writable: false, enumerable: false, configurable: true,
});
dataViewProto.properties.set('byteOffset', {
  value: undefined, getter: createNativeFunction('byteOffset', (_this, _args) => {
    return (_this as any).__dvOffset ?? 0;
  }),
  writable: false, enumerable: false, configurable: true,
});
dataViewProto.properties.set('byteLength', {
  value: undefined, getter: createNativeFunction('byteLength', (_this, _args) => {
    return (_this as any).__dvByteLength ?? 0;
  }),
  writable: false, enumerable: false, configurable: true,
});
dataViewProto.properties.set('getInt8', { value: dvGetter('getInt8', 'getInt8', 1), writable: true, enumerable: true, configurable: true });
dataViewProto.properties.set('getUint8', { value: dvGetter('getUint8', 'getUint8', 1), writable: true, enumerable: true, configurable: true });
dataViewProto.properties.set('getInt16', { value: dvGetter('getInt16', 'getInt16', 2), writable: true, enumerable: true, configurable: true });
dataViewProto.properties.set('getUint16', { value: dvGetter('getUint16', 'getUint16', 2), writable: true, enumerable: true, configurable: true });
dataViewProto.properties.set('getInt32', { value: dvGetter('getInt32', 'getInt32', 4), writable: true, enumerable: true, configurable: true });
dataViewProto.properties.set('getUint32', { value: dvGetter('getUint32', 'getUint32', 4), writable: true, enumerable: true, configurable: true });
dataViewProto.properties.set('getFloat32', { value: dvGetter('getFloat32', 'getFloat32', 4), writable: true, enumerable: true, configurable: true });
dataViewProto.properties.set('getFloat64', { value: dvGetter('getFloat64', 'getFloat64', 8), writable: true, enumerable: true, configurable: true });
dataViewProto.properties.set('getBigInt64', { value: dvGetter('getBigInt64', 'getBigInt64', 8), writable: true, enumerable: true, configurable: true });
dataViewProto.properties.set('getBigUint64', { value: dvGetter('getBigUint64', 'getBigUint64', 8), writable: true, enumerable: true, configurable: true });
dataViewProto.properties.set('setInt8', { value: dvSetter('setInt8', 'setInt8', 1), writable: true, enumerable: true, configurable: true });
dataViewProto.properties.set('setUint8', { value: dvSetter('setUint8', 'setUint8', 1), writable: true, enumerable: true, configurable: true });
dataViewProto.properties.set('setInt16', { value: dvSetter('setInt16', 'setInt16', 2), writable: true, enumerable: true, configurable: true });
dataViewProto.properties.set('setUint16', { value: dvSetter('setUint16', 'setUint16', 2), writable: true, enumerable: true, configurable: true });
dataViewProto.properties.set('setInt32', { value: dvSetter('setInt32', 'setInt32', 4), writable: true, enumerable: true, configurable: true });
dataViewProto.properties.set('setUint32', { value: dvSetter('setUint32', 'setUint32', 4), writable: true, enumerable: true, configurable: true });
dataViewProto.properties.set('setFloat32', { value: dvSetter('setFloat32', 'setFloat32', 4), writable: true, enumerable: true, configurable: true });
dataViewProto.properties.set('setFloat64', { value: dvSetter('setFloat64', 'setFloat64', 8), writable: true, enumerable: true, configurable: true });
dataViewProto.properties.set('setBigInt64', { value: dvSetter('setBigInt64', 'setBigInt64', 8), writable: true, enumerable: true, configurable: true });
dataViewProto.properties.set('setBigUint64', { value: dvSetter('setBigUint64', 'setBigUint64', 8), writable: true, enumerable: true, configurable: true });

function createDataViewConstructor(): JSFunction {
  return createNativeFunction('DataView', (_this, args) => {
    const bufArg = args[0];
    const native = getArrayBuffer(bufArg, 'DataView');
    const byteOffset = args[1] !== undefined ? toInteger(args[1]) : 0;
    const byteLength = args[2] !== undefined ? toInteger(args[2]) : native.byteLength - byteOffset;
    if (byteOffset < 0 || byteOffset > native.byteLength) {
      throw new JSError('RangeError: byteOffset is outside the bounds of the DataView');
    }
    if (byteLength < 0 || byteOffset + byteLength > native.byteLength) {
      throw new JSError('RangeError: byteLength is outside the bounds of the DataView');
    }
    return wrapDataView(native, byteOffset, byteLength);
  });
}

// ── TypedArray ───────────────────────────────────────────────────────────────

function createTypedArrayProto(meta: TypedArrayMeta): JSObject {
  const proto = createObject(typedArrayBaseProto);

  proto.properties.set('BYTES_PER_ELEMENT', {
    value: meta.BYTES_PER_ELEMENT, writable: false, enumerable: false, configurable: true,
  });

  return proto;
}

// Base TypedArray prototype shared by all
const typedArrayBaseProto = createObject(null);
typedArrayBaseProto.properties.set('buffer', {
  value: undefined, getter: createNativeFunction('buffer', (_this, _args) => {
    const buf = (_this as any).__nativeBuffer as ArrayBuffer;
    return buf ? wrapArrayBuffer(buf) : undefined;
  }),
  writable: false, enumerable: false, configurable: true,
});
typedArrayBaseProto.properties.set('byteOffset', {
  value: undefined, getter: createNativeFunction('byteOffset', (_this, _args) => {
    return (_this as any).__taOffset ?? 0;
  }),
  writable: false, enumerable: false, configurable: true,
});
typedArrayBaseProto.properties.set('byteLength', {
  value: undefined, getter: createNativeFunction('byteLength', (_this, _args) => {
    const native = (_this as any).__nativeView as { byteLength: number };
    return native?.byteLength ?? 0;
  }),
  writable: false, enumerable: false, configurable: true,
});
typedArrayBaseProto.properties.set('length', {
  value: undefined, getter: createNativeFunction('length', (_this, _args) => {
    const native = (_this as any).__nativeView as { length: number };
    return native?.length ?? 0;
  }),
  writable: false, enumerable: false, configurable: true,
});

// fill
typedArrayBaseProto.properties.set('fill', {
  value: createNativeFunction('fill', (_this, args) => {
    const view = getTypedArrayNativeView(_this, 'TypedArray.prototype.fill');
    const value = args[0];
    const start = args[1] !== undefined ? toInteger(args[1]) : 0;
    const end = args[2] !== undefined ? toInteger(args[2]) : view.length;
    const s = Math.max(0, Math.min(start, view.length));
    const e = Math.max(0, Math.min(end, view.length));
    for (let i = s; i < e; i++) {
      view[i] = typeof value === 'bigint' ? value as any : Number(value) as any;
    }
    return _this;
  }),
  writable: true, enumerable: true, configurable: true,
});

// set(source, offset)
typedArrayBaseProto.properties.set('set', {
  value: createNativeFunction('set', (_this, args) => {
    const view = getTypedArrayNativeView(_this, 'TypedArray.prototype.set');
    const srcObj = args[0];
    const offset = args[1] !== undefined ? toInteger(args[1]) : 0;

    if (typeof srcObj !== 'object' || srcObj === null) {
      throw new JSError('TypeError: TypedArray.prototype.set requires an object argument');
    }
    const src = srcObj as JSObject;
    const srcView = (src as any).__nativeView;
    const srcLen = srcView?.length ?? Number(src.properties.get('length')?.value ?? 0);

    if (srcView && typeof srcView.set === 'function') {
      (view as any).set(srcView, offset);
    } else {
      // Fallback: read from JSObject array-like
      for (let i = 0; i < srcLen; i++) {
        const val = srcView ? srcView[i] : src.properties.get(String(i))?.value;
        (view as any).set(offset + i, typeof val === 'bigint' ? val : Number(val ?? 0));
      }
    }
    return undefined;
  }),
  writable: true, enumerable: true, configurable: true,
});

// subarray(begin, end)
typedArrayBaseProto.properties.set('subarray', {
  value: createNativeFunction('subarray', (_this, args) => {
    const parent = _this as JSObject;
    const parentView = (parent as any).__nativeView as any;
    const parentBuf = (parent as any).__nativeBuffer as ArrayBuffer;
    const parentOffset = (parent as any).__taOffset as number;
    const meta = (parent as any).__taMeta as TypedArrayMeta;
    if (!parentView || !meta) throw new JSError('TypeError: subarray called on non-TypedArray');

    const begin = args[0] !== undefined ? toInteger(args[0]) : 0;
    const end = args[1] !== undefined ? toInteger(args[1]) : parentView.length;
    const b = Math.max(0, Math.min(begin, parentView.length));
    const e = Math.max(b, Math.min(end, parentView.length));
    const newLen = e - b;

    return wrapTypedArray(parentBuf, parentOffset + b * meta.BYTES_PER_ELEMENT, newLen, meta);
  }),
  writable: true, enumerable: true, configurable: true,
});

// slice(begin, end)
typedArrayBaseProto.properties.set('slice', {
  value: createNativeFunction('slice', (_this, args) => {
    const parentView = getTypedArrayNativeView(_this, 'TypedArray.prototype.slice');
    const meta = (_this as any).__taMeta as TypedArrayMeta;
    const begin = args[0] !== undefined ? toInteger(args[0]) : 0;
    const end = args[1] !== undefined ? toInteger(args[1]) : parentView.length;
    const b = Math.max(0, Math.min(begin, parentView.length));
    const e = Math.max(b, Math.min(end, parentView.length));
    const newLen = e - b;
    const newBuf = new ArrayBuffer(newLen * meta.BYTES_PER_ELEMENT);
    const newView = new (getTypedArrayConstructor(meta.TypedArrayName))(newBuf);
    for (let i = 0; i < newLen; i++) {
      newView[i] = (parentView as any)[b + i] as any;
    }
    return wrapTypedArray(newBuf, 0, newLen, meta);
  }),
  writable: true, enumerable: true, configurable: true,
});

// indexOf, includes, find, findIndex — read elements as numbers
typedArrayBaseProto.properties.set('indexOf', {
  value: createNativeFunction('indexOf', (_this, args) => {
    const view = getTypedArrayNativeView(_this, 'TypedArray.prototype.indexOf');
    const search = typeof args[0] === 'bigint' ? args[0] : Number(args[0] ?? 0);
    const fromIdx = args[1] !== undefined ? toInteger(args[1]) : 0;
    const start = Math.max(0, fromIdx < 0 ? Math.max(0, view.length + fromIdx) : fromIdx);
    for (let i = start; i < view.length; i++) {
      if ((view as any)[i] === search) return i;
    }
    return -1;
  }),
  writable: true, enumerable: true, configurable: true,
});
typedArrayBaseProto.properties.set('includes', {
  value: createNativeFunction('includes', (_this, args) => {
    const view = getTypedArrayNativeView(_this, 'TypedArray.prototype.includes');
    const search = typeof args[0] === 'bigint' ? args[0] : Number(args[0] ?? 0);
    const fromIdx = args[1] !== undefined ? toInteger(args[1]) : 0;
    const start = Math.max(0, fromIdx < 0 ? Math.max(0, view.length + fromIdx) : fromIdx);
    for (let i = start; i < view.length; i++) {
      if ((view as any)[i] === search) return true;
    }
    return false;
  }),
  writable: true, enumerable: true, configurable: true,
});
typedArrayBaseProto.properties.set('find', {
  value: createNativeFunction('find', (_this, args) => {
    const view = getTypedArrayNativeView(_this, 'TypedArray.prototype.find');
    const callback = args[0] as JSFunction;
    if (!callback || typeof callback !== 'object' || !('closure' in callback)) {
      throw new JSError('TypeError: find requires a function argument');
    }
    for (let i = 0; i < view.length; i++) {
      const val = (view as any)[i];
      const result = callJSFunction(callback, _this, [val, i, _this]);
      if (result === true || (typeof result === 'number' && result !== 0)) return val;
    }
    return undefined;
  }),
  writable: true, enumerable: true, configurable: true,
});
typedArrayBaseProto.properties.set('findIndex', {
  value: createNativeFunction('findIndex', (_this, args) => {
    const view = getTypedArrayNativeView(_this, 'TypedArray.prototype.findIndex');
    const callback = args[0] as JSFunction;
    if (!callback || typeof callback !== 'object' || !('closure' in callback)) {
      throw new JSError('TypeError: findIndex requires a function argument');
    }
    for (let i = 0; i < view.length; i++) {
      const val = (view as any)[i];
      const result = callJSFunction(callback, _this, [val, i, _this]);
      if (result === true || (typeof result === 'number' && result !== 0)) return i;
    }
    return -1;
  }),
  writable: true, enumerable: true, configurable: true,
});

// sort(compareFn)
typedArrayBaseProto.properties.set('sort', {
  value: createNativeFunction('sort', (_this, args) => {
    const view = getTypedArrayNativeView(_this, 'TypedArray.prototype.sort');
    const compareFn = args[0] as JSFunction | undefined;
    const len = view.length;

    // Collect elements
    const arr: (number | bigint)[] = [];
    for (let i = 0; i < len; i++) arr.push((view as any)[i]);

    // Sort
    arr.sort((a, b) => {
      if (compareFn && typeof compareFn === 'object' && 'closure' in compareFn) {
        const result = callJSFunction(compareFn, _this, [a, b]);
        return Number(result);
      }
      return Number(a) - Number(b);
    });

    // Write back
    for (let i = 0; i < len; i++) {
      (view as any)[i] = arr[i] as any;
    }
    return _this;
  }),
  writable: true, enumerable: true, configurable: true,
});

// reverse()
typedArrayBaseProto.properties.set('reverse', {
  value: createNativeFunction('reverse', (_this, args) => {
    const view = getTypedArrayNativeView(_this, 'TypedArray.prototype.reverse');
    const len = view.length;
    for (let i = 0; i < Math.floor(len / 2); i++) {
      const tmp = (view as any)[i];
      (view as any)[i] = (view as any)[len - 1 - i];
      (view as any)[len - 1 - i] = tmp;
    }
    return _this;
  }),
  writable: true, enumerable: true, configurable: true,
});

// copyWithin(target, start, end)
typedArrayBaseProto.properties.set('copyWithin', {
  value: createNativeFunction('copyWithin', (_this, args) => {
    const view = getTypedArrayNativeView(_this, 'TypedArray.prototype.copyWithin');
    const target = toInteger(args[0]);
    const start = args[1] !== undefined ? toInteger(args[1]) : 0;
    const end = args[2] !== undefined ? toInteger(args[2]) : view.length;
    const len = view.length;
    const t = Math.max(0, Math.min(target, len));
    const s = Math.max(0, Math.min(start, len));
    const e = Math.max(s, Math.min(end, len));
    const count = e - s;
    for (let i = 0; i < count; i++) {
      (view as any)[t + i] = (view as any)[s + i];
    }
    return _this;
  }),
  writable: true, enumerable: true, configurable: true,
});

// join(separator)
typedArrayBaseProto.properties.set('join', {
  value: createNativeFunction('join', (_this, args) => {
    const view = getTypedArrayNativeView(_this, 'TypedArray.prototype.join');
    const sep = args[0] !== undefined ? toString(args[0]) : ',';
    const parts: string[] = [];
    for (let i = 0; i < view.length; i++) {
      parts.push(String((view as any)[i]));
    }
    return parts.join(sep);
  }),
  writable: true, enumerable: true, configurable: true,
});

// forEach, map, filter, reduce, some, every — need callback-based iteration
typedArrayBaseProto.properties.set('forEach', {
  value: createNativeFunction('forEach', (_this, args) => {
    const view = getTypedArrayNativeView(_this, 'TypedArray.prototype.forEach');
    const callback = args[0] as JSFunction;
    if (!callback || typeof callback !== 'object' || !('closure' in callback)) {
      throw new JSError('TypeError: forEach requires a function argument');
    }
    for (let i = 0; i < view.length; i++) {
      callJSFunction(callback, _this, [(view as any)[i], i, _this]);
    }
    return undefined;
  }),
  writable: true, enumerable: true, configurable: true,
});
typedArrayBaseProto.properties.set('map', {
  value: createNativeFunction('map', (_this, args) => {
    const view = getTypedArrayNativeView(_this, 'TypedArray.prototype.map');
    const meta = (_this as any).__taMeta as TypedArrayMeta;
    const callback = args[0] as JSFunction;
    if (!callback || typeof callback !== 'object' || !('closure' in callback)) {
      throw new JSError('TypeError: map requires a function argument');
    }
    const newBuf = new ArrayBuffer(view.length * meta.BYTES_PER_ELEMENT);
    const newView = new (getTypedArrayConstructor(meta.TypedArrayName))(newBuf);
    for (let i = 0; i < view.length; i++) {
      const result = callJSFunction(callback, _this, [(view as any)[i], i, _this]);
      newView[i] = typeof result === 'bigint' ? result as any : Number(result) as any;
    }
    return wrapTypedArray(newBuf, 0, view.length, meta);
  }),
  writable: true, enumerable: true, configurable: true,
});
typedArrayBaseProto.properties.set('filter', {
  value: createNativeFunction('filter', (_this, args) => {
    const view = getTypedArrayNativeView(_this, 'TypedArray.prototype.filter');
    const meta = (_this as any).__taMeta as TypedArrayMeta;
    const callback = args[0] as JSFunction;
    if (!callback || typeof callback !== 'object' || !('closure' in callback)) {
      throw new JSError('TypeError: filter requires a function argument');
    }
    const result: (number | bigint)[] = [];
    for (let i = 0; i < view.length; i++) {
      const val = (view as any)[i];
      if (callJSFunction(callback, _this, [val, i, _this])) {
        result.push(val);
      }
    }
    const newBuf = new ArrayBuffer(result.length * meta.BYTES_PER_ELEMENT);
    const newView = new (getTypedArrayConstructor(meta.TypedArrayName))(newBuf);
    for (let i = 0; i < result.length; i++) newView[i] = result[i] as any;
    return wrapTypedArray(newBuf, 0, result.length, meta);
  }),
  writable: true, enumerable: true, configurable: true,
});
typedArrayBaseProto.properties.set('reduce', {
  value: createNativeFunction('reduce', (_this, args) => {
    const view = getTypedArrayNativeView(_this, 'TypedArray.prototype.reduce');
    const callback = args[0] as JSFunction;
    if (!callback || typeof callback !== 'object' || !('closure' in callback)) {
      throw new JSError('TypeError: reduce requires a function argument');
    }
    let acc: JSValue = args.length >= 2 ? args[1] : undefined;
    let startIndex = args.length >= 2 ? 0 : 1;
    if (args.length < 2 && view.length === 0) {
      throw new JSError('TypeError: Reduce of empty array with no initial value');
    }
    if (args.length < 2) acc = (view as any)[0];
    if (args.length < 2) startIndex = 1;
    for (let i = startIndex; i < view.length; i++) {
      acc = callJSFunction(callback, _this, [acc, (view as any)[i], i, _this]);
    }
    return acc;
  }),
  writable: true, enumerable: true, configurable: true,
});
typedArrayBaseProto.properties.set('some', {
  value: createNativeFunction('some', (_this, args) => {
    const view = getTypedArrayNativeView(_this, 'TypedArray.prototype.some');
    const callback = args[0] as JSFunction;
    if (!callback || typeof callback !== 'object' || !('closure' in callback)) {
      throw new JSError('TypeError: some requires a function argument');
    }
    for (let i = 0; i < view.length; i++) {
      if (callJSFunction(callback, _this, [(view as any)[i], i, _this])) return true;
    }
    return false;
  }),
  writable: true, enumerable: true, configurable: true,
});
typedArrayBaseProto.properties.set('every', {
  value: createNativeFunction('every', (_this, args) => {
    const view = getTypedArrayNativeView(_this, 'TypedArray.prototype.every');
    const callback = args[0] as JSFunction;
    if (!callback || typeof callback !== 'object' || !('closure' in callback)) {
      throw new JSError('TypeError: every requires a function argument');
    }
    for (let i = 0; i < view.length; i++) {
      if (!callJSFunction(callback, _this, [(view as any)[i], i, _this])) return false;
    }
    return true;
  }),
  writable: true, enumerable: true, configurable: true,
});

// at(index)
typedArrayBaseProto.properties.set('at', {
  value: createNativeFunction('at', (_this, args) => {
    const view = getTypedArrayNativeView(_this, 'TypedArray.prototype.at');
    const idx = toInteger(args[0]);
    const actual = idx < 0 ? view.length + idx : idx;
    if (actual < 0 || actual >= view.length) return undefined;
    return (view as any)[actual];
  }),
  writable: true, enumerable: true, configurable: true,
});

// toString
typedArrayBaseProto.properties.set('toString', {
  value: createNativeFunction('toString', (_this, _args) => {
    const view = getTypedArrayNativeView(_this, 'TypedArray.prototype.toString');
    const parts: string[] = [];
    for (let i = 0; i < view.length; i++) parts.push(String((view as any)[i]));
    return parts.join(',');
  }),
  writable: true, enumerable: true, configurable: true,
});

function getTypedArrayNativeView(obj: JSValue, method: string): any {
  if (typeof obj !== 'object' || obj === null) throw new JSError('TypeError: Cannot call ' + method + ' on non-object');
  const view = (obj as any).__nativeView;
  if (!view) throw new JSError('TypeError: ' + method + ' called on non-TypedArray');
  return view;
}

function getTypedArrayConstructor(name: string): any {
  return (globalThis as any)[name] ?? (() => { throw new Error('No native ' + name); })();
}

function wrapTypedArray(buf: ArrayBuffer, offset: number, length: number, meta: TypedArrayMeta): JSObject {
  const ta = createObject(typedArrayProtos[meta.TypedArrayName]);
  (ta as any).__type_override = meta.TypedArrayName;
  (ta as any).__nativeBuffer = buf;
  (ta as any).__nativeView = new (getTypedArrayConstructor(meta.TypedArrayName))(buf, offset, length);
  (ta as any).__taOffset = offset;
  (ta as any).__taMeta = meta;
  return ta;
}

// Create prototypes per typed array name
const typedArrayProtos: Record<string, JSObject> = {};
for (const name of TYPED_ARRAY_NAMES) {
  typedArrayProtos[name] = createTypedArrayProto(TYPED_ARRAY_META[name]);
}

function createTypedArrayConstructor(name: string, meta: TypedArrayMeta): JSObject {
  const ctorObj = createObject(null);
  ctorObj.type = 'function';
  ctorObj.callable = true;
  ctorObj.nativeFn = (_this: JSValue, args: JSValue[]): JSValue => {
    const Ctor = getTypedArrayConstructor(name);

    if (args.length === 0) {
      return wrapTypedArray(new ArrayBuffer(0), 0, 0, meta);
    }

    const firstArg = args[0];

    // TypedArray(typedArray) — copy constructor
    if (typeof firstArg === 'object' && firstArg !== null && (firstArg as any).__nativeView) {
      const srcView = (firstArg as any).__nativeView;
      const srcLen = srcView.length;
      const newBuf = new ArrayBuffer(srcLen * meta.BYTES_PER_ELEMENT);
      const newView = new Ctor(newBuf);
      for (let i = 0; i < srcLen; i++) newView[i] = srcView[i] as any;
      return wrapTypedArray(newBuf, 0, srcLen, meta);
    }

    // TypedArray(arrayLike) — from array-like
    if (typeof firstArg === 'object' && firstArg !== null && (firstArg as any).type === 'array') {
      const arr = firstArg as JSObject;
      const len = Number(arr.properties.get('length')?.value ?? 0);
      const newBuf = new ArrayBuffer(len * meta.BYTES_PER_ELEMENT);
      const newView = new Ctor(newBuf);
      for (let i = 0; i < len; i++) {
        const val = arr.properties.get(String(i))?.value;
        newView[i] = typeof val === 'bigint' ? val as any : Number(val ?? 0) as any;
      }
      return wrapTypedArray(newBuf, 0, len, meta);
    }

    // TypedArray(objectLike with .length)
    if (typeof firstArg === 'object' && firstArg !== null && (firstArg as any).properties?.has('length')) {
      const obj = firstArg as JSObject;
      const len = Number(obj.properties.get('length')?.value ?? 0);
      const newBuf = new ArrayBuffer(len * meta.BYTES_PER_ELEMENT);
      const newView = new Ctor(newBuf);
      for (let i = 0; i < len; i++) {
        const val = obj.properties.get(String(i))?.value;
        newView[i] = typeof val === 'bigint' ? val as any : Number(val ?? 0) as any;
      }
      return wrapTypedArray(newBuf, 0, len, meta);
    }

    // TypedArray(buffer, byteOffset?, length?)
    if (typeof firstArg === 'object' && firstArg !== null && (firstArg as any).__nativeBuffer) {
      const buf = (firstArg as any).__nativeBuffer as ArrayBuffer;
      const byteOffset = args[1] !== undefined ? toInteger(args[1]) : 0;
      const lengthArg = args[2];
      const remainingBytes = buf.byteLength - byteOffset;
      const length = lengthArg !== undefined
        ? Math.max(0, Math.min(toInteger(lengthArg), Math.floor(remainingBytes / meta.BYTES_PER_ELEMENT)))
        : Math.floor(remainingBytes / meta.BYTES_PER_ELEMENT);
      if (byteOffset < 0 || byteOffset > buf.byteLength) {
        throw new JSError('RangeError: start offset is out of bounds');
      }
      if (byteOffset % meta.BYTES_PER_ELEMENT !== 0) {
        throw new JSError('RangeError: start offset should be a multiple of ' + meta.BYTES_PER_ELEMENT);
      }
      return wrapTypedArray(buf, byteOffset, length, meta);
    }

    // TypedArray(length) — numeric length
    if (typeof firstArg === 'number' || typeof firstArg === 'bigint') {
      const len = toInteger(firstArg);
      if (len < 0) throw new JSError('RangeError: Invalid typed array length');
      return wrapTypedArray(new ArrayBuffer(len * meta.BYTES_PER_ELEMENT), 0, len, meta);
    }

    throw new JSError('TypeError: Invalid argument to ' + name + ' constructor');
  };

  ctorObj.properties.set('prototype', {
    value: typedArrayProtos[name], writable: false, enumerable: false, configurable: false,
  });
  ctorObj.properties.set('BYTES_PER_ELEMENT', {
    value: meta.BYTES_PER_ELEMENT, writable: false, enumerable: false, configurable: true,
  });

  // Static: from, of
  ctorObj.properties.set('from', {
    value: createNativeFunction('from', (_this, args) => {
      const src = args[0];
      const mapFn = args[1] as JSFunction | undefined;
      const Ctor = getTypedArrayConstructor(name);

      if (typeof src === 'object' && src !== null && (src as any).__nativeView) {
        // Copy from typed array
        const srcView = (src as any).__nativeView;
        const newBuf = new ArrayBuffer(srcView.length * meta.BYTES_PER_ELEMENT);
        const newView = new Ctor(newBuf);
        for (let i = 0; i < srcView.length; i++) {
          if (mapFn && typeof mapFn === 'object' && 'closure' in mapFn) {
            const result = callJSFunction(mapFn, undefined, [srcView[i], i]);
            newView[i] = typeof result === 'bigint' ? result as any : Number(result) as any;
          } else {
            newView[i] = srcView[i] as any;
          }
        }
        return wrapTypedArray(newBuf, 0, srcView.length, meta);
      }

      // From iterable/array-like
      const items: (number | bigint)[] = [];
      if (typeof src === 'object' && src !== null && (src as any).properties?.has(Symbol.iterator as any)) {
        // Use Symbol.iterator if available — fallback to iterating indexed properties
      }
      if (typeof src === 'object' && src !== null) {
        const obj = src as JSObject;
        if (obj.type === 'array') {
          const len = Number(obj.properties.get('length')?.value ?? 0);
          for (let i = 0; i < len; i++) items.push(Number(obj.properties.get(String(i))?.value ?? 0));
        } else if (obj.properties?.has('length')) {
          const len = Number(obj.properties.get('length')?.value ?? 0);
          for (let i = 0; i < len; i++) items.push(Number(obj.properties.get(String(i))?.value ?? 0));
        }
      }

      const newBuf = new ArrayBuffer(items.length * meta.BYTES_PER_ELEMENT);
      const newView = new Ctor(newBuf);
      for (let i = 0; i < items.length; i++) {
        if (mapFn && typeof mapFn === 'object' && 'closure' in mapFn) {
          const result = callJSFunction(mapFn, undefined, [items[i], i]);
          newView[i] = typeof result === 'bigint' ? result as any : Number(result) as any;
        } else {
          newView[i] = items[i] as any;
        }
      }
      return wrapTypedArray(newBuf, 0, items.length, meta);
    }),
    writable: true, enumerable: true, configurable: true,
  });
  ctorObj.properties.set('of', {
    value: createNativeFunction('of', (_this, args) => {
      const Ctor = getTypedArrayConstructor(name);
      const newBuf = new ArrayBuffer(args.length * meta.BYTES_PER_ELEMENT);
      const newView = new Ctor(newBuf);
      for (let i = 0; i < args.length; i++) {
        newView[i] = typeof args[i] === 'bigint' ? args[i] as any : Number(args[i] ?? 0) as any;
      }
      return wrapTypedArray(newBuf, 0, args.length, meta);
    }),
    writable: true, enumerable: true, configurable: true,
  });

  return ctorObj;
}

// ── Atomics ──────────────────────────────────────────────────────────────────

function createAtomicsObject(): JSObject {
  const atomics = createObject(null);

  function getAtomicsView(obj: JSValue): { view: Int32Array; offset: number } {
    if (typeof obj !== 'object' || obj === null) throw new JSError('TypeError: Atomics method called on non-object');
    const view = (obj as any).__nativeView;
    if (!view) throw new JSError('TypeError: Atomics method called on non-TypedArray');
    return { view: view as Int32Array, offset: (obj as any).__taOffset ?? 0 };
  }

  atomics.properties.set('add', {
    value: createNativeFunction('add', (_this, args) => {
      const { view } = getAtomicsView(args[0]);
      const index = toInteger(args[1]);
      const value = args[2] !== undefined ? Number(args[2]) : 0;
      const old = view[index];
      view[index] = old + value;
      return old;
    }),
    writable: true, enumerable: true, configurable: true,
  });
  atomics.properties.set('and', {
    value: createNativeFunction('and', (_this, args) => {
      const { view } = getAtomicsView(args[0]);
      const index = toInteger(args[1]);
      const value = args[2] !== undefined ? Number(args[2]) : 0;
      const old = view[index];
      view[index] = old & value;
      return old;
    }),
    writable: true, enumerable: true, configurable: true,
  });
  atomics.properties.set('or', {
    value: createNativeFunction('or', (_this, args) => {
      const { view } = getAtomicsView(args[0]);
      const index = toInteger(args[1]);
      const value = args[2] !== undefined ? Number(args[2]) : 0;
      const old = view[index];
      view[index] = old | value;
      return old;
    }),
    writable: true, enumerable: true, configurable: true,
  });
  atomics.properties.set('sub', {
    value: createNativeFunction('sub', (_this, args) => {
      const { view } = getAtomicsView(args[0]);
      const index = toInteger(args[1]);
      const value = args[2] !== undefined ? Number(args[2]) : 0;
      const old = view[index];
      view[index] = old - value;
      return old;
    }),
    writable: true, enumerable: true, configurable: true,
  });
  atomics.properties.set('xor', {
    value: createNativeFunction('xor', (_this, args) => {
      const { view } = getAtomicsView(args[0]);
      const index = toInteger(args[1]);
      const value = args[2] !== undefined ? Number(args[2]) : 0;
      const old = view[index];
      view[index] = old ^ value;
      return old;
    }),
    writable: true, enumerable: true, configurable: true,
  });
  atomics.properties.set('load', {
    value: createNativeFunction('load', (_this, args) => {
      const { view } = getAtomicsView(args[0]);
      const index = toInteger(args[1]);
      return view[index];
    }),
    writable: true, enumerable: true, configurable: true,
  });
  atomics.properties.set('store', {
    value: createNativeFunction('store', (_this, args) => {
      const { view } = getAtomicsView(args[0]);
      const index = toInteger(args[1]);
      const value = args[2] !== undefined ? Number(args[2]) : 0;
      view[index] = value;
      return value;
    }),
    writable: true, enumerable: true, configurable: true,
  });
  atomics.properties.set('exchange', {
    value: createNativeFunction('exchange', (_this, args) => {
      const { view } = getAtomicsView(args[0]);
      const index = toInteger(args[1]);
      const value = args[2] !== undefined ? Number(args[2]) : 0;
      const old = view[index];
      view[index] = value;
      return old;
    }),
    writable: true, enumerable: true, configurable: true,
  });
  atomics.properties.set('compareExchange', {
    value: createNativeFunction('compareExchange', (_this, args) => {
      const { view } = getAtomicsView(args[0]);
      const index = toInteger(args[1]);
      const expected = args[2] !== undefined ? Number(args[2]) : 0;
      const replacement = args[3] !== undefined ? Number(args[3]) : 0;
      const old = view[index];
      if (old === expected) view[index] = replacement;
      return old;
    }),
    writable: true, enumerable: true, configurable: true,
  });
  atomics.properties.set('wait', {
    value: createNativeFunction('wait', (_this, _args) => {
      // Simplified: return 'ok' in single-threaded context
      return 'ok';
    }),
    writable: true, enumerable: true, configurable: true,
  });
  atomics.properties.set('notify', {
    value: createNativeFunction('notify', (_this, _args) => {
      return 0;
    }),
    writable: true, enumerable: true, configurable: true,
  });
  return atomics;
}

// ── WeakRef + FinalizationRegistry ───────────────────────────────────────────

function createWeakRefConstructor(): JSFunction {
  return createNativeFunction('WeakRef', (_this, args) => {
    const target = args[0];
    if (typeof target !== 'object' || target === null) {
      throw new JSError('TypeError: WeakRef constructor argument must be an object');
    }
    const ref = createObject(weakRefProto);
    (ref as any).__type_override = 'weakref';
    (ref as any).__weakTarget = target;
    return ref;
  });
}

const weakRefProto = createObject(null);
weakRefProto.properties.set('deref', {
  value: createNativeFunction('deref', (_this, _args) => {
    return (_this as any).__weakTarget ?? undefined;
  }),
  writable: true, enumerable: true, configurable: true,
});

function createWeakRefCtorObj(): JSObject {
  const ctorObj = createObject(null);
  ctorObj.type = 'function';
  ctorObj.callable = true;
  ctorObj.nativeFn = createWeakRefConstructor().nativeFn;
  ctorObj.properties.set('prototype', { value: weakRefProto, writable: false, enumerable: false, configurable: false });
  return ctorObj;
}

function createFinalizationRegistryConstructor(): JSFunction {
  return createNativeFunction('FinalizationRegistry', (_this, args) => {
    const cleanupCallback = args[0];
    if (!cleanupCallback || typeof cleanupCallback !== 'object' || !('closure' in (cleanupCallback as any))) {
      throw new JSError('TypeError: FinalizationRegistry requires a cleanup callback function');
    }
    const registry = createObject(finalizationRegistryProto);
    (registry as any).__type_override = 'finalizationregistry';
    (registry as any).__frCallback = cleanupCallback;
    (registry as any).__frRegistry = new WeakMap<object, unknown>();
    return registry;
  });
}

const finalizationRegistryProto = createObject(null);
finalizationRegistryProto.properties.set('register', {
  value: createNativeFunction('register', (_this, args) => {
    const target = args[0];
    if (typeof target !== 'object' || target === null) {
      throw new JSError('TypeError: FinalizationRegistry.register target must be an object');
    }
    const registry = (_this as any).__frRegistry as WeakMap<object, unknown>;
    const heldValue = args.length >= 2 ? args[1] : undefined;
    registry.set(target as any, heldValue);
    return undefined;
  }),
  writable: true, enumerable: true, configurable: true,
});
finalizationRegistryProto.properties.set('unregister', {
  value: createNativeFunction('unregister', (_this, args) => {
    const target = args[0];
    if (typeof target !== 'object' || target === null) return false;
    const registry = (_this as any).__frRegistry as WeakMap<object, unknown>;
    return registry.delete(target as any);
  }),
  writable: true, enumerable: true, configurable: true,
});

function createFinalizationRegistryCtorObj(): JSObject {
  const ctorObj = createObject(null);
  ctorObj.type = 'function';
  ctorObj.callable = true;
  ctorObj.nativeFn = createFinalizationRegistryConstructor().nativeFn;
  ctorObj.properties.set('prototype', { value: finalizationRegistryProto, writable: false, enumerable: false, configurable: false });
  return ctorObj;
}

// ── Export all constructors ──────────────────────────────────────────────────

export function createTypedArrayConstructors(): Record<string, JSObject> {
  const result: Record<string, JSObject> = {};

  // ArrayBuffer
  result['ArrayBuffer'] = createArrayBufferCtorObj(arrayBufferProto);

  // SharedArrayBuffer (simplified — same as ArrayBuffer for single-threaded)
  const sabCtor = createArrayBufferCtorObj(arrayBufferProto);
  sabCtor.properties.set('prototype', {
    value: arrayBufferProto, writable: false, enumerable: false, configurable: false,
  });
  result['SharedArrayBuffer'] = sabCtor;

  // DataView
  result['DataView'] = (() => {
    const ctorObj = createObject(null);
    ctorObj.type = 'function';
    ctorObj.callable = true;
    ctorObj.nativeFn = createDataViewConstructor().nativeFn;
    ctorObj.properties.set('prototype', { value: dataViewProto, writable: false, enumerable: false, configurable: false });
    return ctorObj;
  })();

  // TypedArrays
  for (const name of TYPED_ARRAY_NAMES) {
    result[name] = createTypedArrayConstructor(name, TYPED_ARRAY_META[name]);
  }

  // Atomics
  result['Atomics'] = createAtomicsObject();

  // WeakRef
  result['WeakRef'] = createWeakRefCtorObj();

  // FinalizationRegistry
  result['FinalizationRegistry'] = createFinalizationRegistryCtorObj();

  return result;
}
