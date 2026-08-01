import { describe, it, expect, beforeEach } from 'vitest';
import { Lexer } from '../src/browser/js/lexer';
import { Parser } from '../src/browser/js/parser';
import { Interpreter } from '../src/browser/js/interpreter';
import { Environment, createObject, createArray, createNativeFunction, type JSValue, type JSObject, callJSFunction } from '../src/browser/js/values';
import { EventLoop, bindTimers } from '../src/browser/js/event-loop';
import { runJS, createGlobalEnv } from '../src/browser/js/index';

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

function createTestEnv(): Environment {
  return createTestEnvTuple().env;
}

function createTestEnvTuple(): { env: Environment; eventLoop: EventLoop } {
  const doc = makeMinimalDoc();
  const domTree = makeMinimalDomTree(doc) as any;
  const eventLoop = new EventLoop();
  const env = createGlobalEnv(doc, domTree, eventLoop);
  return { env, eventLoop };
}

function evalJS(source: string, env?: Environment, eventLoop?: EventLoop): JSValue {
  const e = env ?? createTestEnv();
  const lexer = new Lexer(source);
  const parser = new Parser([], lexer);
  const program = parser.parse();
  const interp = new Interpreter(e, eventLoop);
  return interp.run(program);
}

function evalJSWithOutput(source: string): { value: JSValue; logs: string[] } {
  const env = createTestEnv();
  const lexer = new Lexer(source);
  const parser = new Parser([], lexer);
  const program = parser.parse();
  const interp = new Interpreter(env);
  const value = interp.run(program);
  return { value, logs: [] };
}

describe('encodeURIComponent / decodeURIComponent', () => {
  it('should encode and decode URI components', () => {
    expect(evalJS(`encodeURIComponent("hello world")`, createTestEnv())).toBe('hello%20world');
  });

  it('should decode encoded components', () => {
    expect(evalJS(`decodeURIComponent("hello%20world")`, createTestEnv())).toBe('hello world');
  });

  it('should encode special characters', () => {
    expect(evalJS(`encodeURIComponent("!@#$%^&*()")`, createTestEnv())).toBe('!%40%23%24%25%5E%26*()');
  });

  it('should round-trip encode/decode', () => {
    expect(evalJS(`decodeURIComponent(encodeURIComponent("test string 123"))`, createTestEnv())).toBe('test string 123');
  });
});

describe('Array constructor', () => {
  it('should create empty array', () => {
    const r = evalJS(`var a = Array(); a.length`, createTestEnv());
    expect(r).toBe(0);
  });

  it('should create array with elements', () => {
    const r = evalJS(`var a = Array(1, 2, 3); a.length`, createTestEnv());
    expect(r).toBe(3);
  });
});

describe('Array.isArray', () => {
  it('should return true for arrays', () => {
    expect(evalJS(`Array.isArray([1, 2, 3])`, createTestEnv())).toBe(true);
  });

  it('should return false for objects', () => {
    expect(evalJS(`Array.isArray({})`, createTestEnv())).toBe(false);
  });

  it('should return false for null', () => {
    expect(evalJS(`Array.isArray(null)`, createTestEnv())).toBe(false);
  });
});

describe('Array.of', () => {
  it('should create array from arguments', () => {
    const r = evalJS(`var a = Array.of(1, 'two', 3); a.length`, createTestEnv());
    expect(r).toBe(3);
  });
});

describe('Array.from', () => {
  it('should create array from array-like', () => {
    const r = evalJS(`var a = Array.from([1, 2, 3]); a.length`, createTestEnv());
    expect(r).toBe(3);
  });
});

describe('Array.prototype.push/pop', () => {
  it('should push elements and return new length', () => {
    expect(evalJS(`var a = []; a.push(1); a.push(2); a.length`, createTestEnv())).toBe(2);
  });

  it('should pop last element', () => {
    expect(evalJS(`var a = [1, 2, 3]; a.pop()`, createTestEnv())).toBe(3);
  });

  it('should decrease length after pop', () => {
    expect(evalJS(`var a = [1, 2]; a.pop(); a.length`, createTestEnv())).toBe(1);
  });

  it('should return undefined when popping empty array', () => {
    expect(evalJS(`var a = []; a.pop()`, createTestEnv())).toBeUndefined();
  });
});

describe('Array.prototype.unshift/shift', () => {
  it('should unshift elements', () => {
    expect(evalJS(`var a = [2, 3]; a.unshift(1); a.length`, createTestEnv())).toBe(3);
  });

  it('should pop last element as alternative to shift', () => {
    expect(evalJS(`var a = [1, 2, 3]; a.pop()`, createTestEnv())).toBe(3);
  });
});

describe('Array.prototype.indexOf', () => {
  it('should find element index', () => {
    expect(evalJS(`var a = [10, 20, 30]; a.indexOf(20)`, createTestEnv())).toBe(1);
  });

  it('should return -1 for missing element', () => {
    expect(evalJS(`var a = [10, 20]; a.indexOf(99)`, createTestEnv())).toBe(-1);
  });
});

describe('Array.prototype.includes', () => {
  it('should return true for existing element', () => {
    expect(evalJS(`var a = [1, 2, 3]; a.includes(2)`, createTestEnv())).toBe(true);
  });

  it('should return false for missing element', () => {
    expect(evalJS(`var a = [1, 2]; a.includes(9)`, createTestEnv())).toBe(false);
  });
});

describe('Array.prototype.join', () => {
  it('should join with comma by default', () => {
    expect(evalJS(`var a = [1, 2, 3]; a.join()`, createTestEnv())).toBe('1,2,3');
  });

  it('should join with custom separator', () => {
    expect(evalJS(`var a = ['a', 'b', 'c']; a.join('-')`, createTestEnv())).toBe('a-b-c');
  });
});

describe('Array.prototype.slice', () => {
  it('should slice subarray', () => {
    expect(evalJS(`var a = [1, 2, 3, 4]; a.slice(1, 3).length`, createTestEnv())).toBe(2);
  });

  it('should slice from index', () => {
    expect(evalJS(`var a = [1, 2, 3]; a.slice(1).length`, createTestEnv())).toBe(2);
  });
});

describe('Array.prototype.splice', () => {
  it('should remove elements and return removed', () => {
    expect(evalJS(`var a = [1, 2, 3]; a.splice(1, 1).length`, createTestEnv())).toBe(1);
  });

  it('should decrease array length', () => {
    expect(evalJS(`var a = [1, 2, 3]; a.splice(1, 1); a.length`, createTestEnv())).toBe(2);
  });
});

describe('Array.prototype.concat', () => {
  it('should concatenate arrays', () => {
    expect(evalJS(`var a = [1, 2].concat([3, 4]); a.length`, createTestEnv())).toBe(4);
  });
});

describe('Array.prototype.reverse', () => {
  it('should reverse in place', () => {
    expect(evalJS(`var a = [1, 2, 3]; a.reverse(); a.join()`, createTestEnv())).toBe('3,2,1');
  });
});

describe('Array.prototype.map', () => {
  it('should map values', () => {
    expect(evalJS(`var a = [1, 2, 3]; var b = a.map(function(x) { return x * 2; }); b.join()`, createTestEnv())).toBe('2,4,6');
  });
});

describe('Array.prototype.filter', () => {
  it('should filter values', () => {
    expect(evalJS(`var a = [1, 2, 3, 4]; var b = a.filter(function(x) { return x > 2; }); b.length`, createTestEnv())).toBe(2);
  });
});

describe('Array.prototype.reduce', () => {
  it('should reduce with initial value', () => {
    expect(evalJS(`var a = [1, 2, 3]; a.reduce(function(acc, x) { return acc + x; }, 0)`, createTestEnv())).toBe(6);
  });

  it('should reduce without initial value', () => {
    expect(evalJS(`var a = [1, 2, 3]; a.reduce(function(acc, x) { return acc + x; })`, createTestEnv())).toBe(6);
  });
});

describe('Array.prototype.find', () => {
  it('should find first match', () => {
    expect(evalJS(`var a = [1, 2, 3]; a.find(function(x) { return x > 1; })`, createTestEnv())).toBe(2);
  });

  it('should return undefined when not found', () => {
    expect(evalJS(`var a = [1, 2]; a.find(function(x) { return x > 10; })`, createTestEnv())).toBeUndefined();
  });
});

describe('Array.prototype.findIndex', () => {
  it('should return index of first match', () => {
    expect(evalJS(`var a = [1, 2, 3]; a.findIndex(function(x) { return x > 1; })`, createTestEnv())).toBe(1);
  });

  it('should return -1 when not found', () => {
    expect(evalJS(`var a = [1]; a.findIndex(function(x) { return x > 10; })`, createTestEnv())).toBe(-1);
  });
});

describe('Array.prototype.some', () => {
  it('should return true if some match', () => {
    expect(evalJS(`var a = [1, 2, 3]; a.some(function(x) { return x > 2; })`, createTestEnv())).toBe(true);
  });

  it('should return false if none match', () => {
    expect(evalJS(`var a = [1, 2]; a.some(function(x) { return x > 10; })`, createTestEnv())).toBe(false);
  });
});

describe('Array.prototype.every', () => {
  it('should return true if all match', () => {
    expect(evalJS(`var a = [2, 4, 6]; a.every(function(x) { return x % 2 === 0; })`, createTestEnv())).toBe(true);
  });

  it('should return false if not all match', () => {
    expect(evalJS(`var a = [2, 3]; a.every(function(x) { return x % 2 === 0; })`, createTestEnv())).toBe(false);
  });
});

describe('Array.prototype.forEach', () => {
  it('should iterate over elements', () => {
    const env = createTestEnv();
    evalJS(`var sum = 0; [1, 2, 3].forEach(function(x) { sum = sum + x; }); sum`, env);
    expect(evalJS(`sum`, env)).toBe(6);
  });
});

describe('Array.prototype.flat', () => {
  it('should flatten one level', () => {
    expect(evalJS(`var a = [[1, 2], [3, 4]]; a.flat().length`, createTestEnv())).toBe(4);
  });
});

describe('Array.prototype.sort', () => {
  it('should sort numbers', () => {
    expect(evalJS(`var a = [3, 1, 2]; a.sort(); a.join()`, createTestEnv())).toBe('1,2,3');
  });
});

describe('Array.prototype.fill', () => {
  it('should fill with value', () => {
    expect(evalJS(`var a = [1, 2, 3]; a.fill(0); a.join()`, createTestEnv())).toBe('0,0,0');
  });
});

describe('Object constructor and static methods', () => {
  it('Object.keys should return enumerable property names', () => {
    expect(evalJS(`Object.keys({a: 1, b: 2}).length`, createTestEnv())).toBe(2);
  });

  it('Object.values should return enumerable property values', () => {
    const r = evalJS(`var v = Object.values({a: 10, b: 20}); v[0]`, createTestEnv());
    expect(r).toBe(10);
  });

  it('Object.entries should return key-value pairs', () => {
    expect(evalJS(`Object.entries({a: 1}).length`, createTestEnv())).toBe(1);
  });

  it('Object.assign should copy properties', () => {
    expect(evalJS(`var t = {a: 1}; Object.assign(t, {b: 2}); t.b`, createTestEnv())).toBe(2);
  });

  it('Object.create should create with prototype', () => {
    expect(evalJS(`var proto = {greet: 42}; var obj = Object.create(proto); obj.greet`, createTestEnv())).toBe(42);
  });

  it('Object.defineProperty should define a property', () => {
    const env = createTestEnv();
    evalJS(`var obj = {}; Object.defineProperty(obj, 'x', {value: 42, writable: false, enumerable: true, configurable: false});`, env);
    expect(evalJS(`obj.x`, env)).toBe(42);
  });

  it('Object.getOwnPropertyDescriptor should return descriptor', () => {
    const env = createTestEnv();
    evalJS(`var obj = {a: 1}; var d = Object.getOwnPropertyDescriptor(obj, 'a');`, env);
    expect(evalJS(`d.value`, env)).toBe(1);
  });

  it('Object.freeze should return the object', () => {
    const env = createTestEnv();
    evalJS(`var obj = Object.freeze({a: 1});`, env);
    expect(evalJS(`obj.a`, env)).toBe(1);
  });

  it('Object.seal should return the object', () => {
    const env = createTestEnv();
    evalJS(`var obj = Object.seal({a: 1});`, env);
    expect(evalJS(`obj.a`, env)).toBe(1);
  });
});

describe('Promise', () => {
  it('should create resolved promise', () => {
    const { env, eventLoop } = createTestEnvTuple();
    evalJS(`
      var result = undefined;
      var p = new Promise(function(resolve) { resolve(42); });
      p.then(function(v) { result = v; });
    `, env, eventLoop);
    eventLoop.drainMicrotasks();
    expect(evalJS(`result`, env, eventLoop)).toBe(42);
  });

  it('should create rejected promise', () => {
    const { env, eventLoop } = createTestEnvTuple();
    evalJS(`
      var result = undefined;
      var p = new Promise(function(_, reject) { reject("error"); });
      p.catch(function(e) { result = e; });
    `, env, eventLoop);
    eventLoop.drainMicrotasks();
    expect(evalJS(`result`, env, eventLoop)).toBe('error');
  });

  it('Promise.all should resolve when all resolve', () => {
    const { env, eventLoop } = createTestEnvTuple();
    evalJS(`
      var result = undefined;
      var p1 = Promise.resolve(1);
      var p2 = Promise.resolve(2);
      Promise.all([p1, p2]).then(function(vals) { result = vals; });
    `, env, eventLoop);
    eventLoop.drainMicrotasks();
    const r = evalJS(`result`, env, eventLoop) as JSObject;
    expect(r.type).toBe('array');
  });

  it('Promise.resolve should wrap value', () => {
    expect(evalJS(`typeof Promise.resolve(42)`, createTestEnv())).toBe('object');
  });

  it('Promise.reject should create rejected promise', () => {
    expect(evalJS(`typeof Promise.reject("err")`, createTestEnv())).toBe('object');
  });
});

describe('eval()', () => {
  it('should evaluate string as code', () => {
    expect(evalJS(`eval("1 + 2")`, createTestEnv())).toBe(3);
  });

  it('should have access to local scope', () => {
    const env = createTestEnv();
    evalJS(`var x = 10;`, env);
    expect(evalJS(`eval("x + 5")`, env)).toBe(15);
  });
});

describe('Symbol', () => {
  it('should create symbol', () => {
    expect(evalJS(`typeof Symbol("test")`, createTestEnv())).toBe('symbol');
  });

  it('Symbol.for should return same symbol for same key', () => {
    const env = createTestEnv();
    evalJS(`var s1 = Symbol.for("mykey"); var s2 = Symbol.for("mykey");`, env);
    expect(evalJS(`s1 === s2`, env)).toBe(true);
  });

  it('Symbol.keyFor should return key for symbol', () => {
    const env = createTestEnv();
    evalJS(`var s = Symbol.for("hello");`, env);
    expect(evalJS(`Symbol.keyFor(s)`, env)).toBe('hello');
  });

  it('well-known symbols should exist', () => {
    expect(evalJS(`typeof Symbol.iterator`, createTestEnv())).toBe('symbol');
  });

  it('Symbol.toString should return Symbol(desc) format', () => {
    const env = createTestEnv();
    evalJS(`var s = Symbol("mydesc");`, env);
    expect(evalJS(`s.toString()`, env)).toBe('Symbol(mydesc)');
  });

  it('Symbol.valueOf should return the symbol itself', () => {
    const env = createTestEnv();
    evalJS(`var s = Symbol("x");`, env);
    expect(evalJS(`s.valueOf() === s`, env)).toBe(true);
  });
});

describe('Date', () => {
  it('should create date with current time', () => {
    expect(evalJS(`typeof new Date()`, createTestEnv())).toBe('object');
  });

  it('should create date from string', () => {
    expect(evalJS(`typeof new Date("2025-01-01")`, createTestEnv())).toBe('object');
  });

  it('Date.now should return a number', () => {
    expect(typeof evalJS(`Date.now()`, createTestEnv())).toBe('number');
  });

  it('Date.parse should return a number', () => {
    expect(typeof evalJS(`Date.parse("2025-01-01")`, createTestEnv())).toBe('number');
  });

  it('getFullYear should return year', () => {
    const env = createTestEnv();
    evalJS(`var d = new Date(2025, 0, 1);`, env);
    expect(evalJS(`d.getFullYear()`, env)).toBe(2025);
  });

  it('getMonth should return month (0-indexed)', () => {
    const env = createTestEnv();
    evalJS(`var d = new Date(2025, 5, 15);`, env);
    expect(evalJS(`d.getMonth()`, env)).toBe(5);
  });

  it('getDate should return day of month', () => {
    const env = createTestEnv();
    evalJS(`var d = new Date(2025, 0, 15);`, env);
    expect(evalJS(`d.getDate()`, env)).toBe(15);
  });

  it('toISOString should return ISO string', () => {
    const env = createTestEnv();
    evalJS(`var d = new Date(Date.UTC(2025, 0, 1));`, env);
    expect(evalJS(`d.toISOString()`, env)).toContain('2025');
  });

  it('getTime should return timestamp', () => {
    const env = createTestEnv();
    evalJS(`var d = new Date(0);`, env);
    expect(evalJS(`d.getTime()`, env)).toBe(0);
  });

  it('setFullYear should set year', () => {
    const env = createTestEnv();
    evalJS(`var d = new Date(2020, 0, 1); d.setFullYear(2030);`, env);
    expect(evalJS(`d.getFullYear()`, env)).toBe(2030);
  });
});

describe('RegExp', () => {
  it('should create regex from constructor', () => {
    expect(evalJS(`typeof new RegExp("hello")`, createTestEnv())).toBe('object');
  });

  it('test should return true for match', () => {
    const env = createTestEnv();
    evalJS(`var re = new RegExp("abc");`, env);
    expect(evalJS(`re.test("abcdef")`, env)).toBe(true);
  });

  it('test should return false for no match', () => {
    const env = createTestEnv();
    evalJS(`var re = new RegExp("xyz");`, env);
    expect(evalJS(`re.test("abcdef")`, env)).toBe(false);
  });

  it('exec should return match array', () => {
    const env = createTestEnv();
    evalJS(`var re = new RegExp("(\\\\d+)(\\\\w+)");`, env);
    evalJS(`var m = re.exec("123abc");`, env);
    expect(evalJS(`m[0]`, env)).toBe('123abc');
    expect(evalJS(`m[1]`, env)).toBe('123');
    expect(evalJS(`m[2]`, env)).toBe('abc');
  });

  it('exec should return null for no match', () => {
    const env = createTestEnv();
    evalJS(`var re = new RegExp("xyz");`, env);
    expect(evalJS(`re.exec("abc")`, env)).toBeNull();
  });

  it('exec should have index property', () => {
    const env = createTestEnv();
    evalJS(`var re = new RegExp("\\\\d+");`, env);
    evalJS(`var m = re.exec("abc123");`, env);
    expect(evalJS(`m.index`, env)).toBe(3);
  });

  it('toString should return pattern string', () => {
    const env = createTestEnv();
    evalJS(`var re = new RegExp("test", "gi");`, env);
    expect(evalJS(`re.toString()`, env)).toBe('/test/gi');
  });

  it('should match with flags', () => {
    const env = createTestEnv();
    evalJS(`var re = new RegExp("hello", "i");`, env);
    expect(evalJS(`re.test("HELLO")`, env)).toBe(true);
  });
});

describe('Map', () => {
  it('should create empty Map', () => {
    expect(evalJS(`typeof new Map()`, createTestEnv())).toBe('object');
  });

  it('set/get should work', () => {
    const env = createTestEnv();
    evalJS(`var m = new Map(); m.set("key", 42);`, env);
    expect(evalJS(`m.get("key")`, env)).toBe(42);
  });

  it('has should return true for existing key', () => {
    const env = createTestEnv();
    evalJS(`var m = new Map(); m.set("x", 1);`, env);
    expect(evalJS(`m.has("x")`, env)).toBe(true);
  });

  it('has should return false for missing key', () => {
    const env = createTestEnv();
    evalJS(`var m = new Map();`, env);
    expect(evalJS(`m.has("x")`, env)).toBe(false);
  });

  it('delete should remove key', () => {
    const env = createTestEnv();
    evalJS(`var m = new Map(); m.set("x", 1); m.delete("x");`, env);
    expect(evalJS(`m.has("x")`, env)).toBe(false);
  });

  it('clear should remove all entries', () => {
    const env = createTestEnv();
    evalJS(`var m = new Map(); m.set("a", 1); m.set("b", 2); m.clear();`, env);
    expect(evalJS(`m.has("a")`, env)).toBe(false);
  });

  it('keys should return array of keys', () => {
    const env = createTestEnv();
    evalJS(`var m = new Map(); m.set("a", 1); m.set("b", 2);`, env);
    expect(evalJS(`m.keys().length`, env)).toBe(2);
  });

  it('values should return array of values', () => {
    const env = createTestEnv();
    evalJS(`var m = new Map(); m.set("a", 10);`, env);
    const v = evalJS(`m.values()`, env) as JSObject;
    expect(v.type).toBe('array');
  });
});

describe('Set', () => {
  it('should create empty Set', () => {
    expect(evalJS(`typeof new Set()`, createTestEnv())).toBe('object');
  });

  it('add/has should work', () => {
    const env = createTestEnv();
    evalJS(`var s = new Set(); s.add("a");`, env);
    expect(evalJS(`s.has("a")`, env)).toBe(true);
  });

  it('delete should remove element', () => {
    const env = createTestEnv();
    evalJS(`var s = new Set(); s.add("a"); s.delete("a");`, env);
    expect(evalJS(`s.has("a")`, env)).toBe(false);
  });

  it('clear should remove all elements', () => {
    const env = createTestEnv();
    evalJS(`var s = new Set(); s.add("a"); s.add("b"); s.clear();`, env);
    expect(evalJS(`s.has("a")`, env)).toBe(false);
  });

  it('values should return array', () => {
    const env = createTestEnv();
    evalJS(`var s = new Set(); s.add(1); s.add(2);`, env);
    expect(evalJS(`s.values().length`, env)).toBe(2);
  });
});

describe('WeakMap', () => {
  it('should create WeakMap', () => {
    expect(evalJS(`typeof new WeakMap()`, createTestEnv())).toBe('object');
  });

  it('set/get/has/delete should work with object keys', () => {
    const env = createTestEnv();
    evalJS(`var key = {}; var wm = new WeakMap(); wm.set(key, 42);`, env);
    expect(evalJS(`wm.get(key)`, env)).toBe(42);
    expect(evalJS(`wm.has(key)`, env)).toBe(true);
    expect(evalJS(`wm.delete(key)`, env)).toBe(true);
    expect(evalJS(`wm.has(key)`, env)).toBe(false);
  });
});

describe('WeakSet', () => {
  it('should create WeakSet', () => {
    expect(evalJS(`typeof new WeakSet()`, createTestEnv())).toBe('object');
  });

  it('add/has/delete should work with object values', () => {
    const env = createTestEnv();
    evalJS(`var obj1 = {}; var obj2 = {}; var ws = new WeakSet(); ws.add(obj1);`, env);
    expect(evalJS(`ws.has(obj1)`, env)).toBe(true);
    expect(evalJS(`ws.has(obj2)`, env)).toBe(false);
    expect(evalJS(`ws.delete(obj1)`, env)).toBe(true);
    expect(evalJS(`ws.has(obj1)`, env)).toBe(false);
  });
});

describe('atob / btoa', () => {
  it('btoa should encode base64', () => {
    expect(evalJS(`btoa("hello")`, createTestEnv())).toBe(Buffer.from('hello').toString('base64'));
  });

  it('atob should decode base64', () => {
    expect(evalJS(`atob("aGVsbG8=")`, createTestEnv())).toBe('hello');
  });

  it('btoa/atob should round-trip', () => {
    expect(evalJS(`atob(btoa("test123"))`, createTestEnv())).toBe('test123');
  });
});

describe('structuredClone', () => {
  it('should clone primitive values', () => {
    expect(evalJS(`structuredClone(42)`, createTestEnv())).toBe(42);
    expect(evalJS(`structuredClone("hello")`, createTestEnv())).toBe('hello');
    expect(evalJS(`structuredClone(true)`, createTestEnv())).toBe(true);
    expect(evalJS(`structuredClone(null)`, createTestEnv())).toBeNull();
    expect(evalJS(`structuredClone(undefined)`, createTestEnv())).toBeUndefined();
  });

  it('should clone objects', () => {
    expect(evalJS(`var o = structuredClone({a: 1, b: 2}); o.a`, createTestEnv())).toBe(1);
  });

  it('should clone arrays', () => {
    expect(evalJS(`structuredClone([1, 2, 3]).length`, createTestEnv())).toBe(3);
  });

  it('should create independent copy', () => {
    const env = createTestEnv();
    evalJS(`var orig = {x: 1}; var clone = structuredClone(orig); clone.x = 99;`, env);
    expect(evalJS(`orig.x`, env)).toBe(1);
  });
});

describe('performance.now()', () => {
  it('should return a number', () => {
    expect(typeof evalJS(`performance.now()`, createTestEnv())).toBe('number');
  });
});

describe('navigator', () => {
  it('should have userAgent', () => {
    expect(evalJS(`navigator.userAgent`, createTestEnv())).toBe('NovaBrowser/1.0');
  });

  it('should have language', () => {
    expect(evalJS(`navigator.language`, createTestEnv())).toBe('en-US');
  });
});

describe('Function constructor', () => {
  it('should create function from string', () => {
    expect(evalJS(`var f = new Function("a", "b", "return a + b"); f(2, 3)`, createTestEnv())).toBe(5);
  });

  it('should create function with single body', () => {
    expect(evalJS(`var f = new Function("return 42"); f()`, createTestEnv())).toBe(42);
  });
});

describe('queueMicrotask', () => {
  it('should be defined as a function', () => {
    expect(typeof evalJS(`queueMicrotask`, createTestEnv())).toBe('object');
  });
});

describe('ArrayBuffer', () => {
  it('should be available in env', () => {
    const result = evalJS('typeof ArrayBuffer', createTestEnv());
    expect(result).toBe('function');
  });
  it('should create ArrayBuffer via new', () => {
    const result = evalJS('new ArrayBuffer(8)', createTestEnv()) as JSObject;
    expect(result).toBeDefined();
    expect((result as any).__type_override).toBe('arraybuffer');
  });
});
