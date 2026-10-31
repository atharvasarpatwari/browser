/**
 * JS built-ins sites use that were missing or wrong: Intl, Number#toLocaleString, accessor
 * descriptors in defineProperty, ES2019–2023 array/string methods, match() groups.
 * See doc/2026-10-31-nova-android-1.54-*.md.
 */
import { describe, expect, it } from 'vitest';
import { runJS } from '../src/browser/js/index';
import { DomTree } from '../src/browser/rendering/dom-tree';
import { HtmlParser } from '../src/browser/rendering/html-parser';

const run = (src: string): unknown => {
  const domTree = new DomTree();
  domTree.buildFromHtml((new HtmlParser().parse('<html><body></body></html>') as unknown as { document: never }).document);
  const r = runJS(src, { document: domTree.getDocument(), domTree } as never);
  if (r.error) throw new Error(r.error.message);
  return r.value;
};

describe('Intl and locale formatting', () => {
  it('NumberFormat (decimal, currency, compact) and toLocaleString', () => {
    expect(run('new Intl.NumberFormat("en-US").format(1234.5)')).toBe('1,234.5');
    expect(run('new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(9.5)')).toBe('$9.50');
    expect(run('(1234.5).toLocaleString("en-US")')).toBe('1,234.5');
    expect(run('(0.256).toLocaleString("en-US", { style: "percent" })')).toBe('26%');
  });
  it('DateTimeFormat formats a Date; PluralRules, Collator, RelativeTimeFormat, ListFormat', () => {
    expect(run('new Intl.DateTimeFormat("en-US", { year: "numeric", month: "long", timeZone: "UTC" }).format(new Date(Date.UTC(2026, 9, 31)))')).toBe('October 2026');
    expect(run('new Intl.PluralRules("en-US").select(1) + "," + new Intl.PluralRules("en-US").select(2)')).toBe('one,other');
    expect(run('["b", "a", "C"].sort(new Intl.Collator("en").compare).join("")')).toBe('abC');
    expect(run('new Intl.RelativeTimeFormat("en", { numeric: "auto" }).format(-1, "day")')).toBe('yesterday');
    expect(run('new Intl.ListFormat("en", { type: "conjunction" }).format(["a", "b", "c"])')).toBe('a, b, and c');
    expect(run('typeof new Intl.NumberFormat("en").resolvedOptions().locale')).toBe('string');
  });
});

describe('Object.defineProperty accessors', () => {
  it('get and set are honoured, and getOwnPropertyDescriptor reports them', () => {
    expect(run('var o = {}; Object.defineProperty(o, "v", { get() { return 9; } }); o.v')).toBe(9);
    expect(run('var o = { _x: 1 }; Object.defineProperty(o, "x", { get: function () { return this._x; }, set: function (v) { this._x = v * 2; } }); o.x = 5; o.x')).toBe(10);
    expect(run('var o = {}; Object.defineProperty(o, "v", { get() { return 1; } }); typeof Object.getOwnPropertyDescriptor(o, "v").get')).toBe('function');
  });
});

describe('array and string methods', () => {
  it('at, findLast(Index), lastIndexOf, flatMap, reduceRight, toSorted, toReversed, with', () => {
    expect(run('[1, 2, 3].at(-1)')).toBe(3);
    expect(run('[1, 2, 3, 4].findLast(x => x % 2 === 1) + "," + [1, 2, 3].findLastIndex(x => x < 3)')).toBe('3,1');
    expect(run('[1, 2, 1].lastIndexOf(1)')).toBe(2);
    expect(run('[1, 2].flatMap(x => [x, x * 10]).join(",")')).toBe('1,10,2,20');
    expect(run('["a", "b", "c"].reduceRight((acc, x) => acc + x)')).toBe('cba');
    expect(run('var a = [3, 1, 2]; a.toSorted().join("") + a.join("") + a.toReversed().join("") + a.with(0, 9).join("")')).toBe('123312213912');
  });
  it('at, replaceAll, localeCompare, matchAll, and match() index/groups', () => {
    expect(run('"abc".at(-1) + "a-b-c".replaceAll("-", "+") + "x.x".replaceAll(/x/g, "y")')).toBe('ca+b+cy.y');
    expect(run('"a".localeCompare("b")')).toBe(-1);
    expect(run('"2026-10".match(/(?<y>\\d+)-(?<m>\\d+)/).groups.m + "@" + "ab12".match(/\\d/).index')).toBe('10@2');
    expect(run('[..."a1b2".matchAll(/\\d/g)].map(m => m[0] + m.index).join(",")')).toBe('11,23');
  });
});

describe('new with a member-expression callee', () => {
  it('new o.C(x), new a.b.C(), new o["C"](), chained member access after the arguments', () => {
    expect(run('var o = { C: function (a) { this.a = a; } }; new o.C(3).a')).toBe(3);
    expect(run('var ns = { m: { C: function () { this.k = "deep"; } } }; new ns.m.C().k')).toBe('deep');
    expect(run('var o = { C: function () { this.v = 1; } }; new o["C"]().v')).toBe(1);
    expect(run('var w = { E: Event }; new w.E("x").type')).toBe('x');
    expect(run('function F() { this.n = 2; } new F().n + new F().n')).toBe(4); // plain identifiers still work
    expect(run('new (function () { this.p = 7; })().p')).toBe(7);
  });
});
