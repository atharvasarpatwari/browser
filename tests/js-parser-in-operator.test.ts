/**
 * `in` had an operator precedence but no parseInfix case, so `x in obj` made the Pratt loop
 * spin forever without consuming a token. On iana.org (jQuery: `t-1 in e`) this froze Nova's
 * WebView thread for good (1.21 on the tablet: the back button stopped responding).
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { Lexer, Parser } from '../src/browser/js/index';
import { HtmlParser } from '../src/browser/rendering/html-parser';
import { DomTree } from '../src/browser/rendering/dom-tree';
import { runJS, createGlobalEnv } from '../src/browser/js/index';
import { EventLoop } from '../src/browser/js/event-loop';

const parse = (src: string) => new Parser([], new Lexer(src)).parse();

function run(src: string): unknown {
  const hp = new HtmlParser(); const domTree = new DomTree();
  domTree.buildFromHtml(hp.parse('<html><body></body></html>').document);
  const doc = domTree.getDocument() as never; const el = new EventLoop();
  const env = createGlobalEnv(doc, domTree as never, el, undefined, undefined, undefined, undefined, 'https://e.com', hp as never);
  const r = runJS(src, { document: doc, domTree: domTree as never, eventLoop: el, globalEnv: env, htmlParser: hp as never }) as { error?: { message: string }; value?: unknown };
  if (r.error) throw new Error(r.error.message);
  return r.value;
}

describe('the in operator', () => {
  it('parses and evaluates `key in object`', () => {
    expect(run('var o = { a: 1 }; ["a" in o, "b" in o, 0 in [5], 1 in [5]].join()')).toBe('true,false,true,false');
  });

  it('parses jQuery\'s isArrayLike shape: "number"==typeof t&&t>0&&t-1 in e', () => {
    expect(run('var e = [1, 2], t = e.length; "number" == typeof t && t > 0 && t - 1 in e')).toBe(true);
  });

  it('still parses for-in loops', () => {
    expect(run('var k = []; for (var p in { x: 1, y: 2 }) k.push(p); var q; for (q in { z: 3 }) k.push(q); k.join()')).toBe('x,y,z');
  });

  it('treats get/set as plain property names unless an accessor name follows', () => {
    expect(run('var o = { get: function (e) { return e * 2; }, set: 3, get size() { return 9; } }; [o.get(2), o.set, o.size].join()')).toBe('4,3,9');
    expect(run('var get = 1, set = 2; var o = { get, set }; o.get + o.set')).toBe(3);
    expect(run('var o = { get() { return "m"; } }; o.get()')).toBe('m');
  });

  it('parses several declarators in a for head', () => {
    expect(run('var s = 0; for (var n = 3, r = 0, i = 10; r < n; r++) s += i; s')).toBe(30);
    expect(run('var out = []; for (let a = 0, b = 2; a < b; a++) out.push(a); out.join()')).toBe('0,1');
  });

  it('tells a regex from division when the parser streams tokens (not just in tokenize())', () => {
    expect(run('var a = 6, b = 2, c = a / b; var re = /^<([a-z]+)>/i; [c, re.test("<div>")].join()')).toBe('3,true');
    expect(run('/* comment */ var x = 10 / 5; // trailing' + String.fromCharCode(10) + ' x')).toBe(2);
  });

  it('regex literals are RegExp objects, and string methods take them', () => {
    expect(run('typeof /a/ + "," + /a/i.test("A") + "," + /^<([a-z]+)>/i.exec("<div>")[1]')).toBe('object,true,div');
    expect(run('"a-b_c".split(/[-_]/).join("|")')).toBe('a|b|c');
    expect(run('"aXbXc".replace(/x/gi, "-")')).toBe('a-b-c');
    expect(run('"font-size".replace(/-([a-z])/g, function (m, c) { return c.toUpperCase(); })')).toBe('fontSize');
    expect(run('"<div>".match(/^<([a-z]+)>/i)[1] + "," + "abc".search(/c/)')).toBe('div,2');
    expect(run(String.raw`var re = /a\/b/; re.test("a/b")`)).toBe(true);
  });

  it('parses the whole of jQuery 3 (iana.org) in bounded time', () => {
    const src = readFileSync('tests/fixtures/iana-2026/jquery.a8e7cabd4d49.js', 'utf8');
    const t0 = Date.now();
    const ast = parse(src) as { body: unknown[] };
    expect(ast.body.length).toBeGreaterThan(0);
    expect(Date.now() - t0).toBeLessThan(10_000);
  }, 20_000);
});
