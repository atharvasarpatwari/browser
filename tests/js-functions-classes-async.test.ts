/**
 * Function parameters, class members, real async/await + generators, and page timers.
 * See doc/2026-10-26-nova-android-1.31-*.md.
 */
import { describe, expect, it, vi } from 'vitest';
import { runJS, createGlobalEnv } from '../src/browser/js/index';
import { EventLoop } from '../src/browser/js/event-loop';
import { DomTree } from '../src/browser/rendering/dom-tree';
import { HtmlParser } from '../src/browser/rendering/html-parser';
import { toString } from '../src/browser/js/values';
import { PageRenderer } from '../src/browser/engine/page-renderer';
import { CssParser } from '../src/browser/rendering/css-parser';
import { LayoutEngine } from '../src/browser/rendering/layout-engine';
import { PaintEngine } from '../src/browser/rendering/paint-engine';

const blankDoc = () => {
  const domTree = new DomTree();
  const doc = domTree.buildFromHtml((new HtmlParser().parse('<html><body></body></html>') as unknown as { document: never }).document);
  return { domTree, doc };
};

const run = (src: string) => {
  const { domTree, doc } = blankDoc();
  const r = runJS(src, { document: doc, domTree } as never);
  if (r.error) throw new Error('script error: ' + r.error.message);
  return r.value;
};

/** Run, then pump timers and microtasks until idle; returns String(out). */
const runAsync = (src: string) => {
  const { domTree, doc } = blankDoc();
  const eventLoop = new EventLoop();
  const env = createGlobalEnv(doc as never, domTree as never, eventLoop);
  const r = runJS('var out = []; ' + src, { document: doc, domTree, eventLoop, globalEnv: env } as never);
  if (r.error) throw new Error('script error: ' + r.error.message);
  for (let i = 0; i < 20; i++) eventLoop.runWithInterpreter(() => eventLoop.runAll());
  return toString(env.get('out'));
};

describe('function parameters', () => {
  it('defaults, destructuring and rest', () => {
    expect(run('function f(a = 5){ return a; } f()')).toBe(5);
    expect(run('function f(a, b = a * 2){ return a + b; } f(3)')).toBe(9);
    expect(run('function f(a = 1, b){ return b; } f(undefined, 9)')).toBe(9);
    expect(run('function f(a = 1){ return a; } String(f(null))')).toBe('null');
    expect(run('(function({ x, y = 2 }){ return x + y; })({ x: 1 })')).toBe(3);
    expect(run('function g(a, ...rest){ return rest.length + ":" + rest.join(); } g(1, 2, 3)')).toBe('2:2,3');
  });

  it('arrow functions with pattern / default / rest params', () => {
    expect(run('(([a, b]) => a + b)([1, 2])')).toBe(3);
    expect(run('((...xs) => xs.length)(1, 2)')).toBe(2);
    expect(run('((a, [b, c] = [2, 3], { d } = { d: 4 }) => a + b + c + d)(1)')).toBe(10);
    expect(run('var s = (a, b) => ({ a, b }); JSON.stringify(s(1, 2))')).toBe('{"a":1,"b":2}');
    expect(run('[3, 1, 2].sort((a, b) => a - b).join()')).toBe('1,2,3');
  });

  it('arrows keep lexical this when called back by built-ins', () => {
    expect(run('var o = { v: 7, m: function(){ var r; [1].forEach(() => { r = this.v; }); return r; } }; o.m()')).toBe(7);
  });
});

describe('class members', () => {
  it('getters/setters (including inherited setters), statics, computed keys', () => {
    expect(run('class A { get v(){ return this._v * 2; } set v(x){ this._v = x; } } var a = new A(); a.v = 4; a.v')).toBe(8);
    expect(run('class A { static make(){ return new A(); } static get kind(){ return "k"; } } A.kind + (A.make() instanceof A)')).toBe('ktrue');
    expect(run('class A { [Symbol.iterator](){ return [1, 2][Symbol.iterator](); } ["x" + 1](){ return 9; } } [...new A()].join() + new A().x1()')).toBe('1,29');
    expect(run('class A { get(){ return "g"; } static(){ return "s"; } async(){ return "a"; } } var a = new A(); a.get() + a.static() + a.async()')).toBe('gsa');
  });

  it('instance, derived and static fields', () => {
    expect(run('class A { count = 1; inc = () => ++this.count; } var a = new A(); a.inc(); a.inc() + "|" + a.count')).toBe('3|3');
    expect(run('class B { x = 1; constructor(){ this.y = this.x + 1; } } class C extends B { z = this.y + 1; } var c = new C(); [c.x, c.y, c.z].join()')).toBe('1,2,3');
    expect(run('class A { static n = 5; static m = A.n * 2; } A.m')).toBe(10);
    expect(run('class A { #p = 1; getP(){ return this.#p; } } new A().getP()')).toBe(1);
  });

  it('each class has its own super', () => {
    expect(run('class A { m(){ return "A"; } } class B extends A { m(){ return "B" + super.m(); } } class C { m(){ return "C"; } } class D extends C { m(){ return "D" + super.m(); } } new B().m() + new D().m()')).toBe('BADC');
  });

  it('object literal async / generator / getter members', () => {
    expect(run('var o = { get x(){ return 3; }, async f(){ return 1; }, *g(){ yield 2; } }; [o.x, typeof o.f().then, [...o.g()][0]].join()')).toBe('3,function,2');
  });

  it('arr.length = n truncates', () => {
    expect(run('var a = [1, 2, 3]; a.length = 1; a.join() + "|" + (1 in a)')).toBe('1|false');
  });
});

describe('async / await', () => {
  it('resumes after a pending await and resolves with the return value', () => {
    expect(runAsync('async function f(){ out.push("a"); var v = await new Promise(function(r){ setTimeout(function(){ r(5); }, 0); }); out.push("b" + v); return v * 2; } f().then(function(x){ out.push("r" + x); }); out.push("sync");')).toBe('a,sync,b5,r10');
    expect(runAsync('async function f(){ var a = await 1; var b = await Promise.resolve(2); return a + b; } f().then(function(x){ out.push(x); });')).toBe('3');
    expect(runAsync('async function f(){ await 1; out.push("2nd"); } f(); out.push("1st");')).toBe('1st,2nd');
  });

  it('rejections land in try/catch; throws reject the promise', () => {
    expect(runAsync('async function f(){ try { await Promise.reject(new Error("boom")); } catch (e) { out.push("caught " + e.message); } finally { out.push("fin"); } } f();')).toBe('caught boom,fin');
    expect(runAsync('async function f(){ throw new TypeError("bad"); } f().catch(function(e){ out.push(e.name + ":" + e.message); });')).toBe('TypeError:bad');
  });

  it('await inside loops, literals, conditionals, methods and arrows', () => {
    expect(runAsync('const g = async (xs) => { let s = 0; for (const x of xs) s += await x; return s; }; g([1, Promise.resolve(2), 3]).then(v => out.push(v));')).toBe('6');
    expect(runAsync('async function f(){ const r = [await 1, await 2]; const o = { a: await 3 }; return r.join() + o.a + (await 4 > 3 ? "y" : "n"); } f().then(v => out.push(v));')).toBe('1,23y');
    expect(runAsync('class A { async m(){ return this.v + await 1; } } var a = new A(); a.v = 10; a.m().then(v => out.push(v));')).toBe('11');
    expect(runAsync('async function f(){ let i = 0; while (i < 3) { await null; i++; } return i; } f().then(v => out.push(v));')).toBe('3');
    expect(runAsync('async function f(){ const res = await fetchLike(); return res.json(); } function fetchLike(){ return Promise.resolve({ json: function(){ return Promise.resolve({ ok: 1 }); } }); } f().then(d => out.push(d.ok));')).toBe('1');
  });
});

describe('generators', () => {
  it('next / next(v) / done', () => {
    expect(runAsync('function* g(){ yield 1; yield 2; return 3; } var it = g(); out.push(JSON.stringify([it.next(), it.next(), it.next(), it.next()]));')).toBe('[{"value":1,"done":false},{"value":2,"done":false},{"value":3,"done":true},{"done":true}]');
    expect(runAsync('function* g(){ var x = yield 1; out.push("got " + x); yield x * 2; } var it = g(); it.next(); out.push(it.next(5).value);')).toBe('got 5,10');
  });

  it('for-of with break over an endless generator; spread; yield*', () => {
    expect(runAsync('function* nat(){ let n = 0; while (true) yield n++; } var r = []; for (const v of nat()) { if (v > 3) break; r.push(v); } out.push(r.join());')).toBe('0,1,2,3');
    expect(runAsync('function* g(){ yield* [1, 2]; yield 3; } out.push([...g()].join());')).toBe('1,2,3');
  });
});

describe('page timers', () => {
  it('setTimeout callbacks and async code run after the page has loaded', async () => {
    const domTree = new DomTree();
    const renderer = new PageRenderer({ htmlParser: new HtmlParser(), domTree, cssParser: new CssParser(), layoutEngine: new LayoutEngine(), paintEngine: new PaintEngine(),
      resourceLoader: { loadResource: vi.fn(), loadBatch: vi.fn(), loadStylesheet: vi.fn().mockResolvedValue(''), loadScript: vi.fn().mockResolvedValue(''), loadImage: vi.fn(), getPriority: vi.fn(), setMaxConcurrent: vi.fn(), on: vi.fn(), off: vi.fn(), dispose: vi.fn() },
      prioritizer: { submit: vi.fn(), submitBatch: vi.fn(), submitPreload: vi.fn(), submitPrefetch: vi.fn(), submitPreconnect: vi.fn(), clear: vi.fn(), dispose: vi.fn() } } as never);
    renderer.setViewport(424, 800, 1);
    const html = `<html><body><p id="t">waiting</p><p id="a">waiting</p><script>
      setTimeout(function(){ document.getElementById("t").textContent = "timer ran"; }, 10);
      (async function(){ await new Promise(function(r){ setTimeout(r, 20); }); document.getElementById("a").textContent = "async ran"; })();
    </script></body></html>`;
    await renderer.render({ url: 'https://example.com/', statusCode: 200, contentType: 'text/html', body: html, headers: new Map(), loadedAt: 0 } as never, new AbortController().signal);
    const text = (id: string) => (domTree.getElementById(id)?.children[0] as { text?: string } | undefined)?.text;
    expect(text('t')).toBe('waiting');
    await new Promise((r) => setTimeout(r, 120));
    expect(text('t')).toBe('timer ran');
    expect(text('a')).toBe('async ran');
    renderer.dispose();
  });
});
