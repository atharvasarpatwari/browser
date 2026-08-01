import { describe, it, expect, beforeEach } from 'vitest';
import { Lexer } from '../src/browser/js/lexer';
import { Parser } from '../src/browser/js/parser';
import { Interpreter } from '../src/browser/js/interpreter';
import { createObject, createArray, createNativeFunction, Environment } from '../src/browser/js/values';
import type { JSValue, JSObject } from '../src/browser/js/values';
import { createGlobalEnv } from '../src/browser/js/index';
import { EventLoop } from '../src/browser/js/event-loop';

function makeMinimalDoc() {
  return {
    domId: 'doc-1', nodeType: 'document' as const, parent: null,
    children: [], htmlElement: null, headElement: null, bodyElement: null,
    _dirtyStyle: false, _dirtyLayout: false, _dirtyPaint: false,
  };
}

function makeMinimalDomTree(doc: any) {
  return {
    buildFromHtml: () => doc, getNodeById: () => null, getElementById: () => null,
    getElementsByTagName: () => [], getElementsByClassName: () => [], querySelector: () => null, querySelectorAll: () => [],
    insertBefore: () => {}, appendChild: () => {}, removeChild: () => {},
    setAttribute: () => {}, removeAttribute: () => {}, setTextContent: () => {},
    setComputedStyle: () => {}, setLayoutBox: () => {}, getMutations: () => [],
    clearMutations: () => {}, getDocument: () => doc, dispose: () => {},
  };
}

function evalExpr(source: string): JSValue {
  const doc = makeMinimalDoc();
  const domTree = makeMinimalDomTree(doc) as any;
  const eventLoop = new EventLoop();
  const env = createGlobalEnv(doc, domTree, eventLoop);
  const lexer = new Lexer(source);
  const parser = new Parser([], lexer);
  const ast = parser.parse();
  const interp = new Interpreter(env, eventLoop);
  return interp.run(ast);
}

// â”€â”€ ArrayBuffer â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

describe('ArrayBuffer', () => {
  it('should create empty ArrayBuffer', () => {
    const val = evalExpr('typeof ArrayBuffer');
    expect(val).toBe('function');
  });

  it('should create ArrayBuffer instance', () => {
    const val = evalExpr('new ArrayBuffer(0)') as JSObject;
    expect(val).toBeDefined();
    expect((val as any).__type_override).toBe('arraybuffer');
  });

  it('should create ArrayBuffer with byteLength', () => {
    const val = evalExpr('new ArrayBuffer(8)') as JSObject;
    expect((val as any).__type_override).toBe('arraybuffer');
  });

  it('should have byteLength property', () => {
    const val = evalExpr(`
      const ab = new ArrayBuffer(16);
      ab.byteLength;
    `);
    expect(val).toBe(16);
  });

  it('should return correct length from slice', () => {
    const val = evalExpr(`
      const ab = new ArrayBuffer(16);
      const sliced = ab.slice(4, 12);
      sliced.byteLength;
    `);
    expect(val).toBe(8);
  });

  it('should transfer ArrayBuffer', () => {
    const val = evalExpr(`
      const ab = new ArrayBuffer(32);
      const transferred = ab.transfer(64);
      transferred.byteLength;
    `);
    expect(val).toBe(64);
  });

  it('should detect ArrayBuffer.isView for DataView', () => {
    const val = evalExpr(`
      const ab = new ArrayBuffer(8);
      const dv = new DataView(ab);
      ArrayBuffer.isView(dv);
    `);
    expect(val).toBe(true);
  });

  it('should detect ArrayBuffer.isView for TypedArray', () => {
    const val = evalExpr(`
      const arr = new Uint8Array(4);
      ArrayBuffer.isView(arr);
    `);
    expect(val).toBe(true);
  });

  it('should return false for ArrayBuffer.isView on non-view', () => {
    const val = evalExpr(`
      ArrayBuffer.isView({});
    `);
    expect(val).toBe(false);
  });

  it('should return false for ArrayBuffer.isView on plain ArrayBuffer', () => {
    const val = evalExpr(`
      ArrayBuffer.isView(new ArrayBuffer(4));
    `);
    expect(val).toBe(false);
  });

  it('should toString as [object ArrayBuffer]', () => {
    const val = evalExpr(`
      const ab = new ArrayBuffer(4);
      '' + ab;
    `);
    expect(val).toBe('[object ArrayBuffer]');
  });
});

// â”€â”€ Uint8Array â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

describe('Uint8Array', () => {
  it('should create empty Uint8Array', () => {
    const val = evalExpr('new Uint8Array(0)') as JSObject;
    expect((val as any).__type_override).toBe('Uint8Array');
  });

  it('should create Uint8Array with length', () => {
    const val = evalExpr('new Uint8Array(4)') as JSObject;
    expect((val as any).__type_override).toBe('Uint8Array');
  });

  it('should have correct BYTES_PER_ELEMENT', () => {
    const val = evalExpr('Uint8Array.BYTES_PER_ELEMENT');
    expect(val).toBe(1);
  });

  it('should have correct length', () => {
    const val = evalExpr(`
      const arr = new Uint8Array(8);
      arr.length;
    `);
    expect(val).toBe(8);
  });

  it('should set and get values', () => {
    const val = evalExpr(`
      const arr = new Uint8Array(4);
      arr[0] = 42;
      arr[0];
    `);
    expect(val).toBe(42);
  });

  it('should create from ArrayBuffer', () => {
    const val = evalExpr(`
      const ab = new ArrayBuffer(4);
      const view = new Uint8Array(ab);
      view[0] = 255;
      view[0];
    `);
    expect(val).toBe(255);
  });

  it('should clamp values for Uint8ClampedArray', () => {
    const val = evalExpr(`
      const arr = new Uint8ClampedArray(4);
      arr[0] = 300;
      arr[0];
    `);
    expect(val).toBe(255);
  });

  it('should clamp negative values for Uint8ClampedArray', () => {
    const val = evalExpr(`
      const arr = new Uint8ClampedArray(4);
      arr[0] = -10;
      arr[0];
    `);
    expect(val).toBe(0);
  });

  it('should fill values', () => {
    const val = evalExpr(`
      const arr = new Uint8Array(8);
      arr.fill(0xAB);
      arr[3];
    `);
    expect(val).toBe(0xAB);
  });

  it('should set from another typed array', () => {
    const val = evalExpr(`
      const src = new Uint8Array([1, 2, 3]);
      const dst = new Uint8Array(6);
      dst.set(src, 2);
      dst[2] + dst[3] + dst[4];
    `);
    expect(val).toBe(6);
  });

  it('should subarray', () => {
    const val = evalExpr(`
      const arr = new Uint8Array([10, 20, 30, 40, 50]);
      const sub = arr.subarray(1, 4);
      sub.length;
    `);
    expect(val).toBe(3);
  });

  it('should slice', () => {
    const val = evalExpr(`
      const arr = new Uint8Array([10, 20, 30, 40, 50]);
      const sliced = arr.slice(2, 4);
      sliced.length;
    `);
    expect(val).toBe(2);
  });

  it('should indexOf', () => {
    const val = evalExpr(`
      const arr = new Uint8Array([10, 20, 30, 20, 50]);
      arr.indexOf(20);
    `);
    expect(val).toBe(1);
  });

  it('should includes', () => {
    const val = evalExpr(`
      const arr = new Uint8Array([10, 20, 30]);
      arr.includes(30);
    `);
    expect(val).toBe(true);
  });

  it('should find', () => {
    const val = evalExpr(`
      const arr = new Uint8Array([10, 20, 30]);
      arr.find(function(x) { return x > 15; });
    `);
    expect(val).toBe(20);
  });

  it('should findIndex', () => {
    const val = evalExpr(`
      const arr = new Uint8Array([10, 20, 30]);
      arr.findIndex(function(x) { return x > 15; });
    `);
    expect(val).toBe(1);
  });

  it('should sort', () => {
    const val = evalExpr(`
      const arr = new Uint8Array([30, 10, 20]);
      arr.sort();
      arr[0] + ',' + arr[1] + ',' + arr[2];
    `);
    expect(val).toBe('10,20,30');
  });

  it('should reverse', () => {
    const val = evalExpr(`
      const arr = new Uint8Array([1, 2, 3]);
      arr.reverse();
      arr[0] + ',' + arr[1] + ',' + arr[2];
    `);
    expect(val).toBe('3,2,1');
  });

  it('should copyWithin', () => {
    const val = evalExpr(`
      const arr = new Uint8Array([1, 2, 3, 4, 5]);
      arr.copyWithin(0, 3);
      arr[0] + ',' + arr[1] + ',' + arr[2];
    `);
    expect(val).toBe('4,5,3');
  });

  it('should join', () => {
    const val = evalExpr(`
      const arr = new Uint8Array([1, 2, 3]);
      arr.join('-');
    `);
    expect(val).toBe('1-2-3');
  });

  it('should forEach', () => {
    const val = evalExpr(`
      const arr = new Uint8Array([10, 20, 30]);
      let sum = 0;
      arr.forEach(function(x) { sum += x; });
      sum;
    `);
    expect(val).toBe(60);
  });

  it('should map', () => {
    const val = evalExpr(`
      const arr = new Uint8Array([1, 2, 3]);
      const mapped = arr.map(function(x) { return x * 2; });
      mapped[0] + ',' + mapped[1] + ',' + mapped[2];
    `);
    expect(val).toBe('2,4,6');
  });

  it('should filter', () => {
    const val = evalExpr(`
      const arr = new Uint8Array([1, 2, 3, 4, 5]);
      const filtered = arr.filter(function(x) { return x > 2; });
      filtered.length;
    `);
    expect(val).toBe(3);
  });

  it('should reduce', () => {
    const val = evalExpr(`
      const arr = new Uint8Array([1, 2, 3, 4]);
      arr.reduce(function(acc, x) { return acc + x; }, 0);
    `);
    expect(val).toBe(10);
  });

  it('should some', () => {
    const val = evalExpr(`
      const arr = new Uint8Array([1, 2, 3]);
      arr.some(function(x) { return x > 2; });
    `);
    expect(val).toBe(true);
  });

  it('should every', () => {
    const val = evalExpr(`
      const arr = new Uint8Array([2, 4, 6]);
      arr.every(function(x) { return x % 2 === 0; });
    `);
    expect(val).toBe(true);
  });

  it('should at()', () => {
    const val = evalExpr(`
      const arr = new Uint8Array([10, 20, 30]);
      arr.at(-1);
    `);
    expect(val).toBe(30);
  });

  it('should toString', () => {
    const val = evalExpr(`
      const arr = new Uint8Array([1, 2, 3]);
      arr.toString();
    `);
    expect(val).toBe('1,2,3');
  });

  it('should have byteOffset and buffer', () => {
    const val = evalExpr(`
      const ab = new ArrayBuffer(8);
      const view = new Uint8Array(ab, 2, 4);
      view.byteOffset;
    `);
    expect(val).toBe(2);
  });

  it('should create with offset and length', () => {
    const val = evalExpr(`
      const ab = new ArrayBuffer(8);
      const view = new Uint8Array(ab, 2, 3);
      view.length;
    `);
    expect(val).toBe(3);
  });

  it('should create from array', () => {
    const val = evalExpr(`
      const arr = new Uint8Array([10, 20, 30]);
      arr[0] + arr[1] + arr[2];
    `);
    expect(val).toBe(60);
  });

  it('should copy from another typed array', () => {
    const val = evalExpr(`
      const src = new Uint8Array([1, 2, 3]);
      const dst = new Uint8Array(src);
      dst[0] + dst[1] + dst[2];
    `);
    expect(val).toBe(6);
  });

  it('should static from()', () => {
    const val = evalExpr(`
      const arr = Uint8Array.from([5, 10, 15]);
      arr[0] + arr[1] + arr[2];
    `);
    expect(val).toBe(30);
  });

  it('should static of()', () => {
    const val = evalExpr(`
      const arr = Uint8Array.of(1, 2, 3);
      arr.length;
    `);
    expect(val).toBe(3);
  });
});

// â”€â”€ Int32Array â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

describe('Int32Array', () => {
  it('should have BYTES_PER_ELEMENT of 4', () => {
    const val = evalExpr('Int32Array.BYTES_PER_ELEMENT');
    expect(val).toBe(4);
  });

  it('should handle negative values', () => {
    const val = evalExpr(`
      const arr = new Int32Array(2);
      arr[0] = -2147483648;
      arr[0];
    `);
    expect(val).toBe(-2147483648);
  });

  it('should create from array', () => {
    const val = evalExpr(`
      const arr = new Int32Array([100, 200, 300]);
      arr[0] + arr[1] + arr[2];
    `);
    expect(val).toBe(600);
  });
});

// â”€â”€ Float64Array â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

describe('Float64Array', () => {
  it('should have BYTES_PER_ELEMENT of 8', () => {
    const val = evalExpr('Float64Array.BYTES_PER_ELEMENT');
    expect(val).toBe(8);
  });

  it('should handle floating point values', () => {
    const val = evalExpr(`
      const arr = new Float64Array(2);
      arr[0] = 3.14159;
      arr[1] = 2.71828;
      arr[0] + arr[1];
    `);
    expect(val as number).toBeCloseTo(5.85987, 3);
  });
});

// â”€â”€ DataView â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

describe('DataView', () => {
  it('should create DataView from ArrayBuffer', () => {
    const val = evalExpr(`
      const ab = new ArrayBuffer(16);
      const dv = new DataView(ab);
      dv.byteLength;
    `);
    expect(val).toBe(16);
  });

  it('should read/write Int8', () => {
    const val = evalExpr(`
      const ab = new ArrayBuffer(4);
      const dv = new DataView(ab);
      dv.setInt8(0, -42);
      dv.getInt8(0);
    `);
    expect(val).toBe(-42);
  });

  it('should read/write Uint8', () => {
    const val = evalExpr(`
      const ab = new ArrayBuffer(4);
      const dv = new DataView(ab);
      dv.setUint8(0, 255);
      dv.getUint8(0);
    `);
    expect(val).toBe(255);
  });

  it('should read/write Int16', () => {
    const val = evalExpr(`
      const ab = new ArrayBuffer(4);
      const dv = new DataView(ab);
      dv.setInt16(0, -1000);
      dv.getInt16(0);
    `);
    expect(val).toBe(-1000);
  });

  it('should read/write Uint16', () => {
    const val = evalExpr(`
      const ab = new ArrayBuffer(4);
      const dv = new DataView(ab);
      dv.setUint16(0, 65535);
      dv.getUint16(0);
    `);
    expect(val).toBe(65535);
  });

  it('should read/write Int32', () => {
    const val = evalExpr(`
      const ab = new ArrayBuffer(8);
      const dv = new DataView(ab);
      dv.setInt32(0, -100000);
      dv.getInt32(0);
    `);
    expect(val).toBe(-100000);
  });

  it('should read/write Uint32', () => {
    const val = evalExpr(`
      const ab = new ArrayBuffer(8);
      const dv = new DataView(ab);
      dv.setUint32(0, 4294967295);
      dv.getUint32(0);
    `);
    expect(val).toBe(4294967295);
  });

  it('should read/write Float32', () => {
    const val = evalExpr(`
      const ab = new ArrayBuffer(8);
      const dv = new DataView(ab);
      dv.setFloat32(0, 3.14);
      dv.getFloat32(0);
    `);
    expect(val as number).toBeCloseTo(3.14, 1);
  });

  it('should read/write Float64', () => {
    const val = evalExpr(`
      const ab = new ArrayBuffer(16);
      const dv = new DataView(ab);
      dv.setFloat64(0, 3.141592653589793);
      dv.getFloat64(0);
    `);
    expect(val).toBe(3.141592653589793);
  });

  it('should support byteOffset', () => {
    const val = evalExpr(`
      const ab = new ArrayBuffer(16);
      const dv = new DataView(ab, 4, 8);
      dv.byteOffset;
    `);
    expect(val).toBe(4);
  });

  it('should support little-endian', () => {
    const val = evalExpr(`
      const ab = new ArrayBuffer(4);
      const dv = new DataView(ab);
      dv.setInt16(0, 256, true);
      dv.getInt16(0, true);
    `);
    expect(val).toBe(256);
  });

  it('should toString as [object DataView]', () => {
    const val = evalExpr(`
      const dv = new DataView(new ArrayBuffer(4));
      '' + dv;
    `);
    expect(val).toBe('[object DataView]');
  });
});

// â”€â”€ Atomics â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

describe('Atomics', () => {
  it('should add', () => {
    const val = evalExpr(`
      const arr = new Int32Array([10]);
      Atomics.add(arr, 0, 5);
    `);
    expect(val).toBe(10);
  });

  it('should and', () => {
    const val = evalExpr(`
      const arr = new Int32Array([0xFF]);
      Atomics.and(arr, 0, 0x0F);
    `);
    expect(val).toBe(0xFF);
  });

  it('should or', () => {
    const val = evalExpr(`
      const arr = new Int32Array([0xF0]);
      Atomics.or(arr, 0, 0x0F);
    `);
    expect(val).toBe(0xF0);
  });

  it('should sub', () => {
    const val = evalExpr(`
      const arr = new Int32Array([20]);
      Atomics.sub(arr, 0, 5);
    `);
    expect(val).toBe(20);
  });

  it('should xor', () => {
    const val = evalExpr(`
      const arr = new Int32Array([0xFF]);
      Atomics.xor(arr, 0, 0x0F);
    `);
    expect(val).toBe(0xFF);
  });

  it('should load', () => {
    const val = evalExpr(`
      const arr = new Int32Array([42]);
      Atomics.load(arr, 0);
    `);
    expect(val).toBe(42);
  });

  it('should store', () => {
    const val = evalExpr(`
      const arr = new Int32Array([0]);
      Atomics.store(arr, 0, 99);
      arr[0];
    `);
    expect(val).toBe(99);
  });

  it('should exchange', () => {
    const val = evalExpr(`
      const arr = new Int32Array([10]);
      Atomics.exchange(arr, 0, 20);
    `);
    expect(val).toBe(10);
  });

  it('should compareExchange (success)', () => {
    const val = evalExpr(`
      const arr = new Int32Array([10]);
      Atomics.compareExchange(arr, 0, 10, 20);
    `);
    expect(val).toBe(10);
  });

  it('should compareExchange (failure)', () => {
    const val = evalExpr(`
      const arr = new Int32Array([10]);
      Atomics.compareExchange(arr, 0, 99, 20);
    `);
    expect(val).toBe(10);
  });

  it('should wait returns ok', () => {
    const val = evalExpr(`
      const arr = new Int32Array([0]);
      Atomics.wait(arr, 0, 0);
    `);
    expect(val).toBe('ok');
  });

  it('should notify returns 0', () => {
    const val = evalExpr(`
      const arr = new Int32Array([0]);
      Atomics.notify(arr, 0);
    `);
    expect(val).toBe(0);
  });
});

// â”€â”€ WeakRef â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

describe('WeakRef', () => {
  it('should create WeakRef', () => {
    const val = evalExpr(`
      const obj = { a: 1 };
      const ref = new WeakRef(obj);
      ref.deref();
    `);
    expect(typeof val).toBe('object');
  });

  it('should deref to the same object', () => {
    const val = evalExpr(`
      const obj = { x: 42 };
      const ref = new WeakRef(obj);
      const target = ref.deref();
      target.x;
    `);
    expect(val).toBe(42);
  });

  it('should throw on non-object argument', () => {
    expect(() => evalExpr('new WeakRef(42)')).toThrow();
  });
});

// â”€â”€ FinalizationRegistry â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

describe('FinalizationRegistry', () => {
  it('should create FinalizationRegistry', () => {
    const val = evalExpr(`
      const fr = new FinalizationRegistry(function(held) {});
      fr instanceof FinalizationRegistry;
    `);
    expect(val).toBe(true);
  });

  it('should register and unregister', () => {
    const val = evalExpr(`
      const fr = new FinalizationRegistry(function(held) {});
      const obj = { a: 1 };
      fr.register(obj, 'held');
      fr.unregister(obj);
    `);
    expect(val).toBe(true);
  });

  it('should throw on non-function argument', () => {
    expect(() => evalExpr('new FinalizationRegistry(42)')).toThrow();
  });
});

// â”€â”€ instanceof checks â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

describe('TypedArray instanceof', () => {
  it('Uint8Array instanceof should work', () => {
    const val = evalExpr(`
      const arr = new Uint8Array(4);
      arr instanceof Uint8Array;
    `);
    expect(val).toBe(true);
  });

  it('ArrayBuffer instanceof should work', () => {
    const val = evalExpr(`
      const ab = new ArrayBuffer(4);
      ab instanceof ArrayBuffer;
    `);
    expect(val).toBe(true);
  });

  it('DataView instanceof should work', () => {
    const val = evalExpr(`
      const dv = new DataView(new ArrayBuffer(4));
      dv instanceof DataView;
    `);
    expect(val).toBe(true);
  });

  it('cross-type instanceof should return false', () => {
    const val = evalExpr(`
      const arr = new Uint8Array(4);
      arr instanceof Int32Array;
    `);
    expect(val).toBe(false);
  });
});

// â”€â”€ SharedArrayBuffer â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

describe('SharedArrayBuffer', () => {
  it('should create SharedArrayBuffer', () => {
    const val = evalExpr('new SharedArrayBuffer(16)') as JSObject;
    expect((val as any).__type_override).toBe('arraybuffer');
  });

  it('should have correct byteLength', () => {
    const val = evalExpr(`
      const sab = new SharedArrayBuffer(32);
      sab.byteLength;
    `);
    expect(val).toBe(32);
  });
});

// â”€â”€ toString for typed arrays â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

describe('TypedArray toString', () => {
  it('should toString as [object Uint8Array]', () => {
    const val = evalExpr(`
      const arr = new Uint8Array(4);
      '' + arr;
    `);
    expect(val).toBe('[object Uint8Array]');
  });

  it('should toString as [object Float64Array]', () => {
    const val = evalExpr(`
      const arr = new Float64Array(4);
      '' + arr;
    `);
    expect(val).toBe('[object Float64Array]');
  });
});
