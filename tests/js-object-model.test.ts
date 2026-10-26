/**
 * JS object model, Rounds A+B of doc/2026-10-25-nova-js-object-model-plan.md: prototype links,
 * instanceof, Object.prototype, Error.prototype, and subclassing built-ins.
 */
import { describe, expect, it } from 'vitest';
import { runJS } from '../src/browser/js/index';
import { DomTree } from '../src/browser/rendering/dom-tree';
import { HtmlParser } from '../src/browser/rendering/html-parser';

const run = (src: string) => {
  const domTree = new DomTree();
  const doc = domTree.buildFromHtml((new HtmlParser().parse('<html><body></body></html>') as unknown as { document: never }).document);
  const r = runJS(src, { document: doc, domTree } as never);
  if (r.error) throw new Error('script error: ' + r.error.message);
  return r.value;
};

describe('constructor functions (pre-ES6 code)', () => {
  it('new F() inherits F.prototype methods and links its prototype', () => {
    expect(run('function F(){ this.a = 1; } F.prototype.hi = function(){ return "hi" + this.a; }; new F().hi()')).toBe('hi1');
    expect(run('function F(){} var f = new F(); [Object.getPrototypeOf(f) === F.prototype, f.constructor === F, f instanceof F].join("|")')).toBe('true|true|true');
    expect(run('function F(){} F.prototype = { kind: "assigned" }; new F().kind')).toBe('assigned');
  });

  it('ES5 inheritance chains work with instanceof', () => {
    expect(run(`function A(){} function B(){} B.prototype = Object.create(A.prototype);
      var b = new B(); [b instanceof B, b instanceof A].join("|")`)).toBe('true|true');
  });
});

describe('classes', () => {
  it('instanceof and constructor', () => {
    expect(run('class A {} class B extends A {} var b = new B(); [new A() instanceof A, b instanceof B, b instanceof A, b instanceof Object].join("|")')).toBe('true|true|true|true');
    expect(run('class A { m(){ return 2; } } var a = new A(); [a.m(), a.constructor === A, Object.getPrototypeOf(a) === A.prototype].join("|")')).toBe('2|true|true');
    expect(run('class A {} [({}) instanceof A, 5 instanceof A].join("|")')).toBe('false|false');
  });
});

describe('Object.prototype', () => {
  it('plain objects have hasOwnProperty/toString/isPrototypeOf; the idioms work', () => {
    expect(run('var o = { x: 1 }; [o.hasOwnProperty("x"), o.hasOwnProperty("y"), typeof o.toString, o.toString()].join("|")')).toBe('true|false|function|[object Object]');
    expect(run('var o = { k: 1 }; Object.prototype.hasOwnProperty.call(o, "k")')).toBe(true);
    expect(run('Object.prototype.toString.call([]) + " " + Object.prototype.toString.call(null)')).toBe('[object Array] [object Null]');
    expect(run('var p = {}; var c = Object.create(p); p.isPrototypeOf(c)')).toBe(true);
  });

  it('does not leak into for-in, Object.keys or JSON', () => {
    expect(run('var o = { a: 1 }; var ks = []; for (var k in o) ks.push(k); ks.join(",") + "|" + Object.keys(o).join(",") + "|" + JSON.stringify(o)')).toBe('a|a|{"a":1}');
  });

  it('own properties still win over the fallback', () => {
    expect(run('var o = { toString: function(){ return "mine"; } }; o.toString()')).toBe('mine');
  });
});

describe('errors', () => {
  it('Error objects inherit from Error.prototype and print "Name: message"', () => {
    expect(run('var e = new Error("m"); [e.message, e.name, e instanceof Error, e.toString()].join("|")')).toBe('m|Error|true|Error: m');
    expect(run('var e = new TypeError("t"); [e instanceof TypeError, e instanceof Error, e.toString()].join("|")')).toBe('true|true|TypeError: t');
    expect(run('var r; try { null.x } catch (e) { r = [e instanceof TypeError, e instanceof Error].join("|"); } r')).toBe('true|true');
  });

  it('class X extends Error gets message, name and instanceof', () => {
    expect(run(`class E extends Error { constructor(m){ super(m); this.name = "E"; } }
      var e = new E("sub"); [e.message, e.name, e instanceof E, e instanceof Error, e.toString()].join("|")`)).toBe('sub|E|true|true|E: sub');
    expect(run('class F extends Error {} var f = new F("plain"); [f.message, f instanceof F, f instanceof Error].join("|")')).toBe('plain|true|true');
  });
});

describe('subclassing other built-ins', () => {
  it('class M extends Map keeps working Map storage', () => {
    expect(run('class M extends Map { twice(k){ return this.get(k) * 2; } } var m = new M(); m.set("a", 21); [m.get("a"), m.twice("a"), m.size, m instanceof M, m instanceof Map].join("|")')).toBe('21|42|1|true|true');
  });

  it('a class can extend an ES5 constructor function', () => {
    expect(run('function Base(x){ this.x = x; } Base.prototype.dbl = function(){ return this.x * 2; }; class D extends Base { constructor(){ super(5); } } var d = new D(); [d.x, d.dbl(), d instanceof Base].join("|")')).toBe('5|10|true');
  });
});

describe('functions as objects', () => {
  it('properties can be assigned to functions (used to crash "reading \'get\'")', () => {
    expect(run('function f(){} f.custom = 3; f.custom')).toBe(3);
    expect(run('var NS = function(){}; NS.util = { twice: function(x){ return x * 2; } }; NS.util.twice(4)')).toBe(8);
    expect(run('var $ = function(){}; $.fn = $.prototype = { jq: true }; new $().jq')).toBe(true);
  });

  it('call/apply/bind are readable function values', () => {
    expect(run('function f(){} [typeof f.call, typeof f.apply, typeof f.bind].join("|")')).toBe('function|function|function');
    expect(run('function add(a, b){ return this.base + a + b; } var b = add.bind({ base: 10 }, 1); b(2)')).toBe(13);
    expect(run('var call = Object.prototype.hasOwnProperty.call; typeof call')).toBe('function');
  });
});

describe('built-in prototypes', () => {
  it('Array.prototype / String.prototype / Function.prototype methods work with .call', () => {
    expect(run('function f(){ return Array.prototype.slice.call(arguments, 1).join("-"); } f(1, 2, 3)')).toBe('2-3');
    expect(run('var out = []; Array.prototype.forEach.call([1, 2], function(x){ out.push(x * 2); }); out.join(",")')).toBe('2,4');
    expect(run('String.prototype.toUpperCase.call("ab") + String.prototype.trim.call("  x ")')).toBe('ABx');
    expect(run('var call = Function.prototype.call; var hop = call.bind(Object.prototype.hasOwnProperty); hop({ k: 1 }, "k")')).toBe(true);
    expect(run('[[] instanceof Array, Object.getPrototypeOf([]) === Array.prototype, Array.prototype.constructor === Array].join("|")')).toBe('true|true|true');
  });

  it('Array.prototype polyfills reach every array', () => {
    expect(run('Array.prototype.second = function(){ return this[1]; }; [7, 8].second()')).toBe(8);
  });

  it('Array(n) is an empty array of length n', () => {
    expect(run('[Array(3).length, new Array(4).length, Array(3).join("x"), new Array(1, 2).length, Array("3").length].join("|")')).toBe('3|4|xx|2|1');
  });
});

describe('window is the global object', () => {
  it('window properties are globals and globals are window properties', () => {
    expect(run('window.foo = 1; foo')).toBe(1);
    expect(run('var bar = 2; window.bar')).toBe(2);
    expect(run('var q = 1; window.q = 5; q')).toBe(5);
    expect(run('baz = 3; window.baz + baz')).toBe(6);
    expect(run('window.document === document && window.addEventListener === addEventListener')).toBe(true);
    expect(run('(function(){ var local = 1; return typeof window.local; })()')).toBe('undefined');
  });

  it('top-level this, globalThis and self are window', () => {
    expect(run('[this === window, globalThis === window, self === window, (function(){ return this; })() === window].join("|")')).toBe('true|true|true|true');
  });
});

describe('parser precedence', () => {
  it('assignment stops at a comma (minified a=1,b=2)', () => {
    expect(run('var a, b; var r = (a = 1, b = 2, a + b); r')).toBe(3);
    expect(run('var C7; (C7 = 5, C7)')).toBe(5);
    expect(run('var s = ""; for (var i = 0, j = 3; i < j; i++) s += i; s')).toBe('012');
    expect(run('var a, b; a = b = 4; a + b')).toBe(8);
  });

  it('the ternary alternate can be an assignment', () => {
    expect(run('var Z; false ? Z = 1 : Z = 2; Z')).toBe(2);
    expect(run('var Z; true ? (Z = 1) : Z = 2; Z')).toBe(1);
  });

  it('/= inside a regex literal is a regex, not a divide-assign', () => {
    expect(run('"a=b=c".replace(/=/g, "")')).toBe('abc');
  });
});

describe('Object statics', () => {
  it('getPrototypeOf / setPrototypeOf / getOwnPropertyNames / fromEntries / is / hasOwn / defineProperties', () => {
    expect(run('var p = { hello: function(){ return "hi"; } }; var o = {}; Object.setPrototypeOf(o, p); [Object.getPrototypeOf(o) === p, o.hello()].join("|")')).toBe('true|hi');
    expect(run('Object.getPrototypeOf({}) === Object.prototype')).toBe(true);
    expect(run('Object.getOwnPropertyNames({ a: 1, b: 2 }).join(",")')).toBe('a,b');
    expect(run('JSON.stringify(Object.fromEntries([["a", 1], ["b", 2]]))')).toBe('{"a":1,"b":2}');
    expect(run('[Object.is(NaN, NaN), Object.is(0, -0), Object.hasOwn({ k: 1 }, "k")].join("|")')).toBe('true|false|true');
    expect(run('var o = Object.defineProperties({}, { x: { value: 7, enumerable: true } }); o.x')).toBe(7);
  });
});
