import { describe, it, expect, beforeEach } from 'vitest';
import { Lexer } from '../src/browser/js/lexer';
import { Parser } from '../src/browser/js/parser';
import { Interpreter } from '../src/browser/js/interpreter';
import { Environment, createObject, createNativeFunction, createArray, type JSValue, type JSObject, type JSFunction, callJSFunction, setGlobalCaller } from '../src/browser/js/values';
import { EventLoop, bindTimers } from '../src/browser/js/event-loop';
import { BytecodeCompiler } from '../src/browser/js/bytecode-compiler';
import { BytecodeVM } from '../src/browser/js/vm';

/** Create a global env with builtins (Math, JSON, parseInt, etc.) */
function createTestGlobalEnv(): Environment {
  const env = new Environment(null);
  const toNum = (v: JSValue): number => {
    if (v === undefined) return NaN;
    if (v === null) return 0;
    if (typeof v === 'boolean') return v ? 1 : 0;
    if (typeof v === 'number') return v;
    if (typeof v === 'string') { const s = v.trim(); if (s === '') return 0; return Number(s); }
    if (typeof v === 'bigint') return Number(v);
    return NaN;
  };
  const toStr = (v: JSValue): string => {
    if (v === undefined) return 'undefined';
    if (v === null) return 'null';
    if (typeof v === 'boolean') return v ? 'true' : 'false';
    if (typeof v === 'number') return String(v);
    if (typeof v === 'string') return v;
    return '[object Object]';
  };

  // Console
  const consoleObj = createObject(null);
  for (const m of ['log', 'error', 'warn', 'info']) {
    consoleObj.properties.set(m, { value: createNativeFunction(m, () => undefined), writable: true, enumerable: true, configurable: true });
  }
  env.setLocal('console', consoleObj);

  // Math
  const mathObj = createObject(null);
  const mathProps: Record<string, number> = { PI: Math.PI, E: Math.E, LN2: Math.LN2, LN10: Math.LN10, LOG2E: Math.LOG2E, LOG10E: Math.LOG10E, SQRT1_2: Math.SQRT1_2, SQRT2: Math.SQRT2, MAX_SAFE_INTEGER: Number.MAX_SAFE_INTEGER, MIN_SAFE_INTEGER: Number.MIN_SAFE_INTEGER, NaN: NaN, Infinity: Infinity };
  for (const [k, v] of Object.entries(mathProps)) {
    mathObj.properties.set(k, { value: v, writable: false, enumerable: true, configurable: false });
  }
  const mathFns: Record<string, (...args: number[]) => number> = { abs: Math.abs, ceil: Math.ceil, floor: Math.floor, round: Math.round, trunc: Math.trunc, sign: Math.sign, sqrt: Math.sqrt, cbrt: Math.cbrt, pow: Math.pow, exp: Math.exp, log: Math.log, log2: Math.log2, log10: Math.log10, min: Math.min, max: Math.max, random: Math.random, sin: Math.sin, cos: Math.cos, tan: Math.tan, asin: Math.asin, acos: Math.acos, atan: Math.atan, atan2: Math.atan2 };
  for (const [name, fn] of Object.entries(mathFns)) {
    mathObj.properties.set(name, { value: createNativeFunction(name, (_t, a) => fn(...a.map(toNum))), writable: true, enumerable: true, configurable: true });
  }
  env.setLocal('Math', mathObj);

  // Global functions
  env.setLocal('parseInt', createNativeFunction('parseInt', (_t, a) => {
    const radix = a.length > 1 ? Math.max(2, Math.min(36, toNum(a[1]))) : 10;
    return parseInt(toStr(a[0]), radix);
  }));
  env.setLocal('parseFloat', createNativeFunction('parseFloat', (_t, a) => parseFloat(toStr(a[0]))));
  env.setLocal('isNaN', createNativeFunction('isNaN', (_t, a) => isNaN(toNum(a[0]))));
  env.setLocal('isFinite', createNativeFunction('isFinite', (_t, a) => isFinite(toNum(a[0]))));

  // Constructors
  env.setLocal('String', createNativeFunction('String', (_t, a) => a.length > 0 ? toStr(a[0]) : ''));
  env.setLocal('Number', createNativeFunction('Number', (_t, a) => a.length > 0 ? toNum(a[0]) : 0));
  env.setLocal('Boolean', createNativeFunction('Boolean', (_t, a) => a.length > 0 ? Boolean(a[0]) : false));
  for (const name of ['Error', 'TypeError', 'ReferenceError', 'RangeError']) {
    env.setLocal(name, createNativeFunction(name, (_t, a) => {
      const obj = createObject(null);
      obj.properties.set('message', { value: a.length > 0 ? toStr(a[0]) : '', writable: true, enumerable: true, configurable: true });
      obj.properties.set('name', { value: name, writable: true, enumerable: true, configurable: true });
      return obj;
    }));
  }

  // JSON
  const jsonObj = createObject(null);
  jsonObj.properties.set('parse', {
    value: createNativeFunction('parse', (_t, a) => {
      try {
        const raw = JSON.parse(toStr(a[0]));
        const toJS = (v: unknown): JSValue => {
          if (v === null || v === undefined) return v as JSValue;
          if (typeof v === 'boolean' || typeof v === 'number' || typeof v === 'string') return v as JSValue;
          if (Array.isArray(v)) return createArray(v.map(toJS));
          if (typeof v === 'object') {
            const obj = createObject(null);
            for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
              obj.properties.set(k, { value: toJS(val), writable: true, enumerable: true, configurable: true });
            }
            return obj;
          }
          return undefined;
        };
        return toJS(raw);
      } catch { return undefined; }
    }),
    writable: true, enumerable: true, configurable: true,
  });
  jsonObj.properties.set('stringify', {
    value: createNativeFunction('stringify', (_t, a) => {
      const stringifyVal = (v: JSValue): string => {
        if (v === undefined || typeof v === 'function') return undefined as any;
        if (v === null) return 'null';
        if (typeof v === 'string') return `"${v}"`;
        if (typeof v === 'number') {
          if (Object.is(v, -0)) return '0';
          if (isNaN(v) || !isFinite(v)) return 'null';
          return String(v);
        }
        if (typeof v === 'boolean') return String(v);
        if (typeof v === 'object') {
          const obj = v as JSObject;
          if (obj.type === 'array') {
            const len = Number(obj.properties.get('length')?.value ?? 0);
            const elems: string[] = [];
            for (let i = 0; i < len; i++) {
              const ev = obj.properties.get(String(i))?.value;
              elems.push(ev === undefined || typeof ev === 'function' ? 'null' : stringifyVal(ev));
            }
            return `[${elems.join(',')}]`;
          }
          const pairs: string[] = [];
          for (const [k, desc] of obj.properties) {
            const pv = desc.value;
            if (pv === undefined || typeof pv === 'function') continue;
            pairs.push(`"${k}":${stringifyVal(pv)}`);
          }
          return `{${pairs.join(',')}}`;
        }
        return String(v);
      };
      const result = stringifyVal(a[0]);
      return result === undefined ? undefined : result;
    }),
    writable: true, enumerable: true, configurable: true,
  });
  env.setLocal('JSON', jsonObj);

  // Array constructor
  env.setLocal('Array', createNativeFunction('Array', (_t, a) => {
    if (a.length === 0) return createArray([]);
    if (a.length === 1 && typeof a[0] === 'number') {
      const len = a[0];
      const arr = createArray([]);
      arr.properties.set('length', { value: len, writable: true, enumerable: false, configurable: true });
      return arr;
    }
    return createArray(a);
  }));

  // Object.keys
  const objectObj = createObject(null);
  objectObj.properties.set('keys', {
    value: createNativeFunction('keys', (_t, a) => {
      const obj = a[0];
      if (typeof obj !== 'object' || obj === null) return createArray([]);
      const o = obj as JSObject;
      const keys: JSValue[] = [];
      for (const [k, desc] of o.properties) {
        if (desc.enumerable) keys.push(k);
      }
      return createArray(keys);
    }),
    writable: true, enumerable: true, configurable: true,
  });
  objectObj.properties.set('setPrototypeOf', {
    value: createNativeFunction('setPrototypeOf', (_t, a) => {
      const obj = a[0] as JSObject;
      const proto = a[1] as JSObject;
      if (typeof obj === 'object' && obj !== null) obj.prototype = proto;
      return obj;
    }),
    writable: true, enumerable: true, configurable: true,
  });
  objectObj.properties.set('assign', {
    value: createNativeFunction('assign', (_t, a) => {
      const target = a[0] as JSObject;
      for (let i = 1; i < a.length; i++) {
        const src = a[i] as JSObject;
        if (typeof src === 'object' && src !== null) {
          for (const [k, desc] of src.properties) {
            target.properties.set(k, desc);
          }
        }
      }
      return target;
    }),
    writable: true, enumerable: true, configurable: true,
  });
  env.setLocal('Object', objectObj);

  return env;
}

function evalJS(source: string, env?: Environment): JSValue {
  const tokens = new Lexer(source).tokenize();
  const parser = new Parser(tokens);
  const program = parser.parse();
  const interp = new Interpreter(env);
  return interp.run(program);
}

function evalJSWithVM(source: string, env?: Environment): JSValue {
  const globalEnv = env ?? createTestGlobalEnv();
  const tokens = new Lexer(source).tokenize();
  const parser = new Parser(tokens);
  const program = parser.parse();
  const compiler = new BytecodeCompiler();
  const bytecodeFn = compiler.compile(program);
  const vm = new BytecodeVM(globalEnv);
  vm.setMaxExecutionMs(10000);
  const interp = new Interpreter(globalEnv);
  setGlobalCaller(interp);
  vm.setCallInterpreter((fn, thisArg, args) => interp.callFunction(fn, thisArg, args));
  const result = vm.run(bytecodeFn);
  if (!result.ok) throw new Error(String(result.error));
  return result.value;
}

function evalBoth(source: string): { treeResult: JSValue; vmResult: JSValue } {
  const env = createTestGlobalEnv();
  return {
    treeResult: evalJS(source, env),
    vmResult: evalJSWithVM(source, env),
  };
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe('Bytecode VM', () => {

  // ── Basic expressions ──────────────────────────────────────────────────

  describe('Literals', () => {
    it('numbers', () => {
      const r = evalBoth('42');
      expect(r.vmResult).toBe(42);
    });
    it('float', () => {
      const r = evalBoth('3.14');
      expect(r.vmResult).toBeCloseTo(3.14);
    });
    it('negative number', () => {
      const r = evalBoth('-5');
      expect(r.vmResult).toBe(-5);
    });
    it('string', () => {
      const r = evalBoth('"hello"');
      expect(r.vmResult).toBe('hello');
    });
    it('boolean true', () => {
      const r = evalBoth('true');
      expect(r.vmResult).toBe(true);
    });
    it('boolean false', () => {
      const r = evalBoth('false');
      expect(r.vmResult).toBe(false);
    });
    it('null', () => {
      const r = evalBoth('null');
      expect(r.vmResult).toBe(null);
    });
    it('undefined', () => {
      const r = evalBoth('undefined');
      expect(r.vmResult).toBe(undefined);
    });
    it('zero', () => {
      const r = evalBoth('0');
      expect(r.vmResult).toBe(0);
    });
    it('one', () => {
      const r = evalBoth('1');
      expect(r.vmResult).toBe(1);
    });
    it('minus one', () => {
      const r = evalBoth('-1');
      expect(r.vmResult).toBe(-1);
    });
  });

  describe('Arithmetic', () => {
    it('addition', () => { expect(evalJSWithVM('2 + 3')).toBe(5); });
    it('subtraction', () => { expect(evalJSWithVM('10 - 4')).toBe(6); });
    it('multiplication', () => { expect(evalJSWithVM('3 * 7')).toBe(21); });
    it('division', () => { expect(evalJSWithVM('20 / 4')).toBe(5); });
    it('modulo', () => { expect(evalJSWithVM('10 % 3')).toBe(1); });
    it('power', () => { expect(evalJSWithVM('2 ** 10')).toBe(1024); });
    it('unary minus', () => { expect(evalJSWithVM('var x = 5; -x')).toBe(-5); });
    it('unary plus', () => { expect(evalJSWithVM('+42')).toBe(42); });
    it('complex expression', () => { expect(evalJSWithVM('(2 + 3) * 4')).toBe(20); });
    it('string concatenation', () => { expect(evalJSWithVM('"hello" + " " + "world"')).toBe('hello world'); });
  });

  describe('Comparison', () => {
    it('equal', () => { expect(evalJSWithVM('5 == 5')).toBe(true); });
    it('not equal', () => { expect(evalJSWithVM('5 != 3')).toBe(true); });
    it('strict equal', () => { expect(evalJSWithVM('5 === 5')).toBe(true); });
    it('strict not equal', () => { expect(evalJSWithVM('5 !== "5"')).toBe(true); });
    it('less than', () => { expect(evalJSWithVM('3 < 5')).toBe(true); });
    it('greater than', () => { expect(evalJSWithVM('5 > 3')).toBe(true); });
    it('less or equal', () => { expect(evalJSWithVM('5 <= 5')).toBe(true); });
    it('greater or equal', () => { expect(evalJSWithVM('5 >= 6')).toBe(false); });
  });

  describe('Logical', () => {
    it('NOT', () => { expect(evalJSWithVM('!true')).toBe(false); });
    it('double NOT', () => { expect(evalJSWithVM('!!42')).toBe(true); });
    it('logical AND (truthy)', () => { expect(evalJSWithVM('1 && 2')).toBe(2); });
    it('logical AND (falsy)', () => { expect(evalJSWithVM('0 && 2')).toBe(0); });
    it('logical OR (first truthy)', () => { expect(evalJSWithVM('1 || 2')).toBe(1); });
    it('logical OR (first falsy)', () => { expect(evalJSWithVM('0 || 2')).toBe(2); });
    it('nullish coalescing', () => { expect(evalJSWithVM('null ?? 42')).toBe(42); });
    it('nullish coalescing defined', () => { expect(evalJSWithVM('5 ?? 42')).toBe(5); });
    it('undefined nullish', () => { expect(evalJSWithVM('undefined ?? "default"')).toBe('default'); });
  });

  describe('Bitwise', () => {
    it('bitwise AND', () => { expect(evalJSWithVM('5 & 3')).toBe(1); });
    it('bitwise OR', () => { expect(evalJSWithVM('5 | 3')).toBe(7); });
    it('bitwise XOR', () => { expect(evalJSWithVM('5 ^ 3')).toBe(6); });
    it('shift left', () => { expect(evalJSWithVM('1 << 3')).toBe(8); });
    it('shift right', () => { expect(evalJSWithVM('16 >> 2')).toBe(4); });
    it('unsigned shift right', () => { expect(evalJSWithVM('-1 >>> 1')).toBe(2147483647); });
    it('bitwise NOT', () => { expect(evalJSWithVM('~0')).toBe(-1); });
  });

  describe('Variables', () => {
    it('var declaration', () => {
      const r = evalBoth('var x = 10; x');
      expect(r.vmResult).toBe(10);
    });
    it('let declaration', () => {
      const r = evalBoth('let y = 20; y');
      expect(r.vmResult).toBe(20);
    });
    it('const declaration', () => {
      const r = evalBoth('const z = 30; z');
      expect(r.vmResult).toBe(30);
    });
    it('reassignment', () => {
      const r = evalBoth('var x = 1; x = 5; x');
      expect(r.vmResult).toBe(5);
    });
    it('multiple declarations', () => {
      const r = evalBoth('var a = 1; var b = 2; var c = 3; a + b + c');
      expect(r.vmResult).toBe(6);
    });
  });

  describe('Control Flow', () => {
    it('if true', () => {
      expect(evalJSWithVM('var x = 0; if (true) { x = 1; } x')).toBe(1);
    });
    it('if false', () => {
      expect(evalJSWithVM('var x = 0; if (false) { x = 1; } x')).toBe(0);
    });
    it('if-else', () => {
      expect(evalJSWithVM('var x = 0; if (false) { x = 1; } else { x = 2; } x')).toBe(2);
    });
    it('if-else-if', () => {
      expect(evalJSWithVM('var x = 0; var y = 2; if (y === 1) { x = 1; } else if (y === 2) { x = 2; } else { x = 3; } x')).toBe(2);
    });
    it('ternary', () => {
      expect(evalJSWithVM('true ? 1 : 2')).toBe(1);
      expect(evalJSWithVM('false ? 1 : 2')).toBe(2);
    });
  });

  describe('Loops', () => {
    it('while loop', () => {
      expect(evalJSWithVM('var i = 0; var sum = 0; while (i < 5) { sum = sum + i; i++; } sum')).toBe(10);
    });
    it('for loop', () => {
      expect(evalJSWithVM('var sum = 0; for (var i = 0; i < 5; i++) { sum += i; } sum')).toBe(10);
    });
    it('do-while loop', () => {
      expect(evalJSWithVM('var i = 0; do { i++; } while (i < 5); i')).toBe(5);
    });
    it('break', () => {
      expect(evalJSWithVM('var i = 0; while (true) { if (i === 3) break; i++; } i')).toBe(3);
    });
    it('continue', () => {
      expect(evalJSWithVM('var sum = 0; for (var i = 0; i < 10; i++) { if (i % 2 === 0) continue; sum += i; } sum')).toBe(25);
    });
    it('nested loops', () => {
      expect(evalJSWithVM('var sum = 0; for (var i = 0; i < 3; i++) { for (var j = 0; j < 3; j++) { sum++; } } sum')).toBe(9);
    });
  });

  describe('Functions', () => {
    it('function declaration and call', () => {
      expect(evalJSWithVM('function add(a, b) { return a + b; } add(2, 3)')).toBe(5);
    });
    it('function expression', () => {
      expect(evalJSWithVM('var f = function(x) { return x * 2; }; f(5)')).toBe(10);
    });
    it('arrow function', () => {
      expect(evalJSWithVM('var f = (x) => x + 1; f(5)')).toBe(6);
    });
    it('arrow function block body', () => {
      expect(evalJSWithVM('var f = (x) => { return x * 3; }; f(4)')).toBe(12);
    });
    it('nested function calls', () => {
      expect(evalJSWithVM('function double(x) { return x * 2; } function quad(x) { return double(double(x)); } quad(3)')).toBe(12);
    });
    it('closures', () => {
      expect(evalJSWithVM('function counter() { var n = 0; return function() { n++; return n; }; } var c = counter(); c(); c(); c()')).toBe(3);
    });
    it('recursive function', () => {
      expect(evalJSWithVM('function factorial(n) { if (n <= 1) return 1; return n * factorial(n - 1); } factorial(5)')).toBe(120);
    });
    it('no-arg function', () => {
      expect(evalJSWithVM('function greet() { return "hello"; } greet()')).toBe('hello');
    });
    it('default parameters', () => {
      expect(evalJSWithVM('function f(a, b) { return a + b; } f(5)')).toBe(NaN);
    });
  });

  describe('Arrays', () => {
    it('array literal', () => {
      const r = evalJSWithVM('[1, 2, 3]');
      expect(r).toBeTypeOf('object');
      expect((r as JSObject).properties.get('0')?.value).toBe(1);
      expect((r as JSObject).properties.get('1')?.value).toBe(2);
      expect((r as JSObject).properties.get('2')?.value).toBe(3);
      expect((r as JSObject).properties.get('length')?.value).toBe(3);
    });
    it('empty array', () => {
      const r = evalJSWithVM('[]');
      expect(r).toBeTypeOf('object');
      expect((r as JSObject).properties.get('length')?.value).toBe(0);
    });
    it('array access', () => {
      expect(evalJSWithVM('var arr = [10, 20, 30]; arr[1]')).toBe(20);
    });
    it('array length', () => {
      expect(evalJSWithVM('[1, 2, 3].length')).toBe(3);
    });
  });

  describe('Objects', () => {
    it('object literal', () => {
      const r = evalJSWithVM('var obj = { a: 1, b: 2 }; obj.a + obj.b');
      expect(r).toBe(3);
    });
    it('computed access', () => {
      expect(evalJSWithVM('var obj = { x: 42 }; obj["x"]')).toBe(42);
    });
    it('nested objects', () => {
      expect(evalJSWithVM('var obj = { inner: { val: 99 } }; obj.inner.val')).toBe(99);
    });
  });

  describe('Member expressions', () => {
    it('dot access', () => {
      expect(evalJSWithVM('var obj = { x: 5 }; obj.x')).toBe(5);
    });
    it('computed access', () => {
      expect(evalJSWithVM('var arr = [10, 20]; arr[0]')).toBe(10);
    });
    it('property set', () => {
      expect(evalJSWithVM('var obj = {}; obj.x = 42; obj.x')).toBe(42);
    });
  });

  describe('Operators', () => {
    it('typeof', () => { expect(evalJSWithVM('typeof 42')).toBe('number'); });
    it('typeof string', () => { expect(evalJSWithVM('typeof "hello"')).toBe('string'); });
    it('typeof undefined', () => { expect(evalJSWithVM('typeof undefined')).toBe('undefined'); });
    it('typeof null', () => { expect(evalJSWithVM('typeof null')).toBe('object'); });
    it('void', () => { expect(evalJSWithVM('void 0')).toBe(undefined); });
    it('instanceof', () => {
      expect(evalJSWithVM('[1] instanceof Array')).toBe(true);
    });
  });

  describe('Compound assignment', () => {
    it('+=', () => { expect(evalJSWithVM('var x = 5; x += 3; x')).toBe(8); });
    it('-=', () => { expect(evalJSWithVM('var x = 5; x -= 2; x')).toBe(3); });
    it('*=', () => { expect(evalJSWithVM('var x = 5; x *= 3; x')).toBe(15); });
    it('/=', () => { expect(evalJSWithVM('var x = 10; x /= 2; x')).toBe(5); });
    it('%=', () => { expect(evalJSWithVM('var x = 10; x %= 3; x')).toBe(1); });
    it('**=', () => { expect(evalJSWithVM('var x = 2; x **= 3; x')).toBe(8); });
  });

  describe('Update expressions', () => {
    it('postfix ++', () => { expect(evalJSWithVM('var x = 5; x++')).toBe(5); });
    it('prefix ++', () => { expect(evalJSWithVM('var x = 5; ++x')).toBe(6); });
    it('postfix --', () => { expect(evalJSWithVM('var x = 5; x--')).toBe(5); });
    it('prefix --', () => { expect(evalJSWithVM('var x = 5; --x')).toBe(4); });
  });

  describe('Template literals', () => {
    it('simple template', () => {
      expect(evalJSWithVM('`hello world`')).toBe('hello world');
    });
    it('template with expression', () => {
      expect(evalJSWithVM('var x = 5; `value is ${x}`')).toBe('value is 5');
    });
    it('template with multiple expressions', () => {
      expect(evalJSWithVM('var a = 1; var b = 2; `${a} + ${b} = ${a + b}`')).toBe('1 + 2 = 3');
    });
  });

  describe('Switch statements', () => {
    it('switch with matching case', () => {
      expect(evalJSWithVM('var x = 2; var r = 0; switch (x) { case 1: r = 10; break; case 2: r = 20; break; case 3: r = 30; break; } r')).toBe(20);
    });
    it('switch with default', () => {
      expect(evalJSWithVM('var x = 5; var r = 0; switch (x) { case 1: r = 10; break; default: r = 99; break; } r')).toBe(99);
    });
    it('switch fall-through', () => {
      expect(evalJSWithVM('var x = 1; var r = 0; switch (x) { case 1: r = 10; case 2: r = 20; case 3: r = 30; } r')).toBe(30);
    });
  });

  describe('Template literal edge cases', () => {
    it('empty template', () => { expect(evalJSWithVM('``')).toBe(''); });
    it('template with number coercion', () => { expect(evalJSWithVM('`${42}`')).toBe('42'); });
  });

  describe('Array methods via VM', () => {
    it('push', () => {
      expect(evalJSWithVM('var a = [1, 2]; a.push(3); a.length')).toBe(3);
    });
    it('pop', () => {
      expect(evalJSWithVM('var a = [1, 2, 3]; a.pop()')).toBe(3);
    });
    it('join', () => {
      expect(evalJSWithVM('[1, 2, 3].join("-")')).toBe('1-2-3');
    });
    it('indexOf', () => {
      expect(evalJSWithVM('[10, 20, 30].indexOf(20)')).toBe(1);
    });
    it('includes', () => {
      expect(evalJSWithVM('[1, 2, 3].includes(2)')).toBe(true);
    });
    it('slice', () => {
      const r = evalJSWithVM('[1, 2, 3, 4].slice(1, 3)');
      expect((r as JSObject).properties.get('length')?.value).toBe(2);
      expect((r as JSObject).properties.get('0')?.value).toBe(2);
    });
    it('concat', () => {
      const r = evalJSWithVM('[1, 2].concat([3, 4])');
      expect((r as JSObject).properties.get('length')?.value).toBe(4);
    });
    it('map', () => {
      const r = evalJSWithVM('[1, 2, 3].map(function(x) { return x * 2; })');
      expect((r as JSObject).properties.get('0')?.value).toBe(2);
      expect((r as JSObject).properties.get('1')?.value).toBe(4);
      expect((r as JSObject).properties.get('2')?.value).toBe(6);
    });
    it('filter', () => {
      const r = evalJSWithVM('[1, 2, 3, 4].filter(function(x) { return x > 2; })');
      expect((r as JSObject).properties.get('length')?.value).toBe(2);
      expect((r as JSObject).properties.get('0')?.value).toBe(3);
      expect((r as JSObject).properties.get('1')?.value).toBe(4);
    });
  });

  describe('JSON via VM', () => {
    it('JSON.parse', () => {
      expect(evalJSWithVM('JSON.parse("42")')).toBe(42);
    });
    it('JSON.stringify', () => {
      expect(evalJSWithVM('JSON.stringify({a: 1})')).toBe('{"a":1}');
    });
    it('JSON roundtrip', () => {
      expect(evalJSWithVM('var obj = {x: 1, y: [2, 3]}; JSON.parse(JSON.stringify(obj)).x')).toBe(1);
    });
  });

  describe('Math via VM', () => {
    it('Math.PI', () => {
      expect(evalJSWithVM('Math.PI')).toBeCloseTo(Math.PI);
    });
    it('Math.abs', () => {
      expect(evalJSWithVM('Math.abs(-5)')).toBe(5);
    });
    it('Math.floor', () => {
      expect(evalJSWithVM('Math.floor(3.7)')).toBe(3);
    });
    it('Math.max', () => {
      expect(evalJSWithVM('Math.max(1, 5, 3)')).toBe(5);
    });
    it('Math.min', () => {
      expect(evalJSWithVM('Math.min(1, 5, 3)')).toBe(1);
    });
    it('Math.sqrt', () => {
      expect(evalJSWithVM('Math.sqrt(16)')).toBe(4);
    });
  });

  describe('Error constructors via VM', () => {
    it('Error', () => {
      const r = evalJSWithVM('var e = new Error("test"); e.message');
      expect(r).toBe('test');
    });
    it('TypeError', () => {
      const r = evalJSWithVM('var e = new TypeError("bad type"); e.name');
      expect(r).toBe('TypeError');
    });
  });

  describe('Global functions via VM', () => {
    it('parseInt', () => {
      expect(evalJSWithVM('parseInt("42")')).toBe(42);
    });
    it('parseFloat', () => {
      expect(evalJSWithVM('parseFloat("3.14")')).toBeCloseTo(3.14);
    });
    it('isNaN', () => {
      expect(evalJSWithVM('isNaN(NaN)')).toBe(true);
    });
    it('isFinite', () => {
      expect(evalJSWithVM('isFinite(42)')).toBe(true);
    });
  });

  describe('String methods via VM', () => {
    it('string length', () => {
      expect(evalJSWithVM('"hello".length')).toBe(5);
    });
  });

  describe('Nested scopes via VM', () => {
    it('inner variable shadows outer', () => {
      expect(evalJSWithVM('var x = 1; { var x = 2; } x')).toBe(2);
    });
    it('function captures outer variable', () => {
      expect(evalJSWithVM('var x = 10; function f() { return x; } f()')).toBe(10);
    });
  });

  describe('Complex programs via VM', () => {
    it('fibonacci', () => {
      expect(evalJSWithVM(`
        function fib(n) {
          if (n <= 1) return n;
          return fib(n - 1) + fib(n - 2);
        }
        fib(10)
      `)).toBe(55);
    });
    it('object iteration', () => {
      expect(evalJSWithVM(`
        var obj = { a: 1, b: 2, c: 3 };
        var sum = 0;
        for (var key in obj) { sum += obj[key]; }
        sum
      `)).toBe(6);
    });
  });

  describe('Comparison with tree-walking interpreter', () => {
    it('same result: basic arithmetic', () => {
      const r = evalBoth('(2 + 3) * 4 - 1');
      expect(r.vmResult).toBe(r.treeResult);
      expect(r.vmResult).toBe(19);
    });
    it('same result: function call', () => {
      const src = 'function add(a, b) { return a + b; } add(10, 20)';
      const r = evalBoth(src);
      expect(r.vmResult).toBe(r.treeResult);
    });
    it('same result: closure', () => {
      const src = 'function make() { var x = 0; return function() { x++; return x; }; } var f = make(); f(); f(); f()';
      const r = evalBoth(src);
      expect(r.vmResult).toBe(r.treeResult);
    });
    it('same result: fibonacci(10)', () => {
      const src = 'function fib(n) { if (n <= 1) return n; return fib(n-1) + fib(n-2); } fib(10)';
      const r = evalBoth(src);
      expect(r.vmResult).toBe(r.treeResult);
    });
  });

  describe('VM-specific: bytecode compilation', () => {
    it('compiles and runs simple program', () => {
      const compiler = new BytecodeCompiler();
      const tokens = new Lexer('1 + 2').tokenize();
      const parser = new Parser(tokens);
      const program = parser.parse();
      const fn = compiler.compile(program);
      expect(fn.bytecode).toBeInstanceOf(Uint8Array);
      expect(fn.bytecode.length).toBeGreaterThan(0);
      expect(fn.constants.length).toBeGreaterThan(0);
    });
    it('constants pool deduplication', () => {
      const compiler = new BytecodeCompiler();
      const tokens = new Lexer('var x = 5; var y = 5; x + y').tokenize();
      const parser = new Parser(tokens);
      const program = parser.parse();
      const fn = compiler.compile(program);
      const fives = fn.constants.filter(c => c === 5);
      expect(fives.length).toBe(1);
    });
  });

  describe('VM-specific: performance', () => {
    it('runs tight loop quickly', () => {
      const start = Date.now();
      evalJSWithVM('var sum = 0; for (var i = 0; i < 10000; i++) { sum += i; } sum');
      const elapsed = Date.now() - start;
      expect(elapsed).toBeLessThan(1000);
    });
    it('recursive fibonacci(20) within timeout', () => {
      const start = Date.now();
      const result = evalJSWithVM('function fib(n) { if (n <= 1) return n; return fib(n-1) + fib(n-2); } fib(20)');
      const elapsed = Date.now() - start;
      expect(result).toBe(6765);
      expect(elapsed).toBeLessThan(2000);
    });
  });

});
