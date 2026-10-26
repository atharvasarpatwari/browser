/**
 * JS semantics, Round C of doc/2026-10-25-nova-js-object-model-plan.md plus the iteration and
 * binding gaps found while doing it (doc/2026-10-26-nova-android-1.30-*.md).
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

describe('ToPrimitive', () => {
  it('String(), + and template literals call toString / valueOf', () => {
    expect(run('String(new Error("m")) + "|" + ("" + new TypeError("t"))')).toBe('Error: m|TypeError: t');
    expect(run('var o = { toString: function(){ return "T"; } }; String(o) + "|" + ("" + o) + "|" + `${o}`')).toBe('T|T|T');
    expect(run('function F(){} F.prototype.toString = function(){ return "F!"; }; String(new F())')).toBe('F!');
    expect(run('var o = { valueOf: function(){ return 4; } }; [o + 1, o * 2, o > 3, o < 3].join("|")')).toBe('5|8|true|false');
    expect(run('`${[1, 2]}|${null}|${{}}`')).toBe('1,2|null|[object Object]');
  });

  it('relational operators compare strings as strings, everything else as numbers', () => {
    expect(run('["b" > "a", "10" < "9", 10 < 9, null >= 0, undefined < 1].join("|")')).toBe('true|true|false|true|false');
  });

  it('Number#toString takes a radix', () => {
    expect(run('(5).toString(2) + "|" + (255).toString(16) + "|" + (7).toString()')).toBe('101|ff|7');
  });
});

describe('calling a non-function', () => {
  it('throws a catchable TypeError naming the callee', () => {
    expect(run('var u, r; try { u(); r = "after"; } catch (e) { r = (e instanceof TypeError) + ":" + e.message; } r')).toBe('true:u is not a function');
    expect(run('var o = {}, r; try { o.nope(1); r = "after"; } catch (e) { r = e.message; } r')).toBe('o.nope is not a function');
  });

  it('optional calls still short-circuit', () => {
    expect(run('var f = null; var o = { m: function(){ return 1; } }; [String(f?.()), o.m?.(), String(o.x?.())].join("|")')).toBe('undefined|1|undefined');
  });
});

describe('labels and delete', () => {
  it('continue outer continues the labeled loop', () => {
    expect(run('var r = ""; outer: for (var i = 0; i < 3; i++) { for (var j = 0; j < 3; j++) { if (j == 1) continue outer; r += i + "" + j; } } r')).toBe('001020');
    expect(run('var r = ""; outer: for (var i = 0; i < 3; i++) { for (var j = 0; j < 3; j++) { if (j == 1) break outer; r += i + "" + j; } } r')).toBe('00');
    expect(run('var n = 0; a: while (n < 5) { n++; for (;;) { continue a; } } n')).toBe(5);
  });

  it('delete removes properties', () => {
    expect(run('var o = { a: 1, b: 2 }; var d = delete o.a; [d, "a" in o, Object.keys(o).join(",")].join("|")')).toBe('true|false|b');
    expect(run('var o = { a: 1 }; delete o["a"]; JSON.stringify(o)')).toBe('{}');
    expect(run('var a = [1, 2, 3]; delete a[1]; [a.length, a[1] === undefined, 1 in a].join("|")')).toBe('3|true|false');
  });
});

describe('destructuring and loop bindings', () => {
  it('let/const destructuring binds its names', () => {
    expect(run('const [a, b] = [1, 2]; a + b')).toBe(3);
    expect(run('let { x, y } = { x: 1, y: 2 }; x + y')).toBe(3);
    expect(run('function f(){ const [p, q] = [3, 4]; return p * q; } f()')).toBe(12);
    expect(run('const [h, ...t] = "abc"; h + "|" + t.join("")')).toBe('a|bc');
  });

  it('for (let …) gives each iteration its own binding', () => {
    expect(run('var fns = []; for (let i = 0; i < 3; i++) fns.push(function(){ return i; }); fns.map(function(f){ return f(); }).join(",")')).toBe('0,1,2');
    expect(run('var fns = []; for (const v of [1, 2]) fns.push(function(){ return v; }); fns.map(function(f){ return f(); }).join(",")')).toBe('1,2');
  });

  it('for-in lists enumerable keys only', () => {
    expect(run('var r = []; for (var k in [5, 6]) r.push(k); r.join(",")')).toBe('0,1');
    expect(run('function P(){ this.own = 1; } P.prototype.inh = 2; var r = []; for (var k in new P()) r.push(k); r.join(",")')).toBe('own,inh');
  });

  it('object spread copies own enumerable properties', () => {
    expect(run('JSON.stringify({ ...{ a: 1 }, b: 2 }) + JSON.stringify({ ...[7] })')).toBe('{"a":1,"b":2}{"0":7}');
  });
});

describe('iteration protocol', () => {
  it('for-of over strings, Maps, Sets and custom iterables', () => {
    expect(run('var r = []; for (const c of "ab") r.push(c); r.join(",")')).toBe('a,b');
    expect(run('var r = []; for (const [k, v] of new Map([["a", 1], ["b", 2]])) r.push(k + v); r.join(",")')).toBe('a1,b2');
    expect(run('var r = []; for (const v of new Set([1, 2])) r.push(v); r.join(",")')).toBe('1,2');
    expect(run('var o = { [Symbol.iterator]: function(){ var i = 0; return { next: function(){ return { done: i >= 3, value: i++ }; } }; } }; var r = []; for (const v of o) r.push(v); r.join(",")')).toBe('0,1,2');
  });

  it('break leaves an endless iterator', () => {
    expect(run('var o = { [Symbol.iterator]: function(){ var i = 0; return { next: function(){ return { done: false, value: i++ }; } }; } }; var last; for (const v of o) { last = v; if (v === 4) break; } last')).toBe(4);
  });

  it('spread and Array.from take any iterable; Map/Set iterators have next()', () => {
    expect(run('[...new Set([1, 2])].length + "|" + Array.from(new Set([1, 2])).length + "|" + [..."ab"].join(",") + "|" + Array.from("xy").join("")')).toBe('2|2|a,b|xy');
    expect(run('Math.max(...new Set([3, 9, 4]))')).toBe(9);
    expect(run('var it = new Map([["a", 1]]).entries(); var n = it.next(); n.value[0] + n.value[1] + "|" + it.next().done')).toBe('a1|true');
    expect(run('typeof [][Symbol.iterator] + "|" + typeof new Map()[Symbol.iterator]')).toBe('function|function');
  });

  it('function* declarations parse', () => {
    expect(run('function* g(){ yield 1; } typeof g')).toBe('function');
  });
});
