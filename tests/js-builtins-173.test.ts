/**
 * 1.73: a 161-case JS probe against V8 (139 matched first, 157 after). Array slice/fill ignored negative
 * and start/end arguments; keys()/entries() weren't iterators; JSON.stringify crashed on functions and
 * ignored indentation, replacers and toJSON; `static {}` blocks were a syntax error; `[] == false` was
 * false; Sets ignored non-array iterables; Promise.any, RegExp flags and Symbol#description were missing.
 */
import { describe, expect, it, vi } from 'vitest';
import { DomTree } from '../src/browser/rendering/dom-tree';
import { HtmlParser } from '../src/browser/rendering/html-parser';
import { CssParser } from '../src/browser/rendering/css-parser';
import { LayoutEngine } from '../src/browser/rendering/layout-engine';
import { PaintEngine } from '../src/browser/rendering/paint-engine';
import { PageRenderer } from '../src/browser/engine/page-renderer';

async function run(body: string): Promise<string> {
  const domTree = new DomTree();
  const r = new PageRenderer({ htmlParser: new HtmlParser(), domTree, cssParser: new CssParser(), layoutEngine: new LayoutEngine(), paintEngine: new PaintEngine(), svgDecode: async () => null,
    resourceLoader: { loadResource: vi.fn(), loadBatch: vi.fn(), loadStylesheet: vi.fn().mockResolvedValue(''), loadScript: vi.fn().mockResolvedValue(''), loadImage: vi.fn(), getPriority: vi.fn(), setMaxConcurrent: vi.fn(), on: vi.fn(), off: vi.fn(), dispose: vi.fn() },
    prioritizer: { submit: vi.fn(), submitBatch: vi.fn(), submitPreload: vi.fn(), submitPrefetch: vi.fn(), submitPreconnect: vi.fn(), clear: vi.fn(), dispose: vi.fn() } } as never);
  r.setViewport(600, 400, 1);
  await r.render({ url: 'http://t.local/', statusCode: 200, contentType: 'text/html', headers: new Map(), loadedAt: 0, body: `<html><body><div id="out"></div>${body}</body></html>` } as never, new AbortController().signal);
  const out = domTree.getElementById('out')!;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const text = (out.children as any[]).map((p) => (p.children ?? []).map((t: any) => t.text ?? '').join('')).join('');
  r.dispose();
  return text;
}
const script = (expr: string) => `<script>var p = document.createElement('p'); p.textContent = String(${expr}); document.getElementById('out').appendChild(p);</script>`;

describe('JS builtins (1.73 probe)', () => {
  it.each([
  ['"a,b,,c".split(",", 3).join("|")', 'a|b|'],
  ['/a/y.sticky', 'true'],
  ['new RegExp("a+", "gi").flags', 'gi'],
  ['/x/m.source + /x/m.multiline', 'xtrue'],
  ['[1, 2, 3, 4, 5].slice(-2).join()', '4,5'],
  ['[1, 2, 3, 4, 5].slice(1, -1).join()', '2,3,4'],
  ['[1, 2, 3].fill(0, 1).join()', '1,0,0'],
  ['[1, 2, 3, 4].fill(9, -2, -1).join()', '1,2,9,4'],
  ['[1, 2, 3].keys().next().value', '0'],
  ['[...["a", "b"].entries()].join("|")', '0,a|1,b'],
  ['JSON.stringify({a: undefined, b: null, c: () => 1, d: [undefined]})', '{"b":null,"d":[null]}'],
  ['JSON.stringify({a: 1, b: [1, 2]}, null, 2).split("\n").length', '7'],
  ['JSON.stringify({d: new Date(0)})', '{"d":"1970-01-01T00:00:00.000Z"}'],
  ['JSON.stringify({a: 1, b: 2, c: 3}, ["a", "c"])', '{"a":1,"c":3}'],
  ['JSON.stringify({a: 1, b: "x"}, (k, v) => typeof v === "number" ? v * 10 : v)', '{"a":10,"b":"x"}'],
  ['JSON.stringify({toJSON() { return "custom"; }})', '"custom"'],
  ['(() => { class A { static x = 1; static { A.y = A.x + 1; } } return A.y; })()', '2'],
  ['[] == false', 'true'],
  ['[1] == 1', 'true'],
  ['null == 0', 'false'],
  ['({}) != "[object Object]"', 'false'],
  ['Array.from(new Set("hello")).join("")', 'helo'],
  ['new Set(new Set([1, 2, 2])).size', '2'],
  ['Symbol("d").description', 'd'],
  ['(() => { const s = Symbol("k"); const o = {[s]: 1}; return o[s]; })()', '1'],
  ])('%s = %s', async (expr, want) => {
    expect(await run(script(expr))).toBe(want);
  });

  it('Promise.any resolves with the first fulfilment', async () => {
    expect(await run(`<script>Promise.any([Promise.reject(1), Promise.resolve(3)]).then(function (v) { var p = document.createElement('p'); p.textContent = String(v); document.getElementById('out').appendChild(p); });</script>`)).toBe('3');
  });
});
