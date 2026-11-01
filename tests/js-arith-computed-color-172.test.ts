/**
 * 1.72, found on the tablet: binary operators grouped right (`10 - 3 - 2` was 9), and
 * getComputedStyle returned colours as authored instead of `rgb(r, g, b)`. Then a JS probe: blocks
 * shared their enclosing scope (`{ let a }` overwrote an outer `a`), and `||=` / `&&=` didn't lex.
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

describe('JS operators and scopes', () => {
  it.each([
    ['10 - 3 - 2', '5'],
    ['1 + 10 - 3 - 2', '6'],
    ['10 / 4 / 2', '1.25'],
    ['20 % 7 % 4', '2'],
    ['2 ** 3 ** 2', '512'],
    ['1 < 2 == true', 'true'],
    ['({x:13,w:1044}).x + 1044 - 519 - 32', '506'],
    // Block scopes and ES2021 logical assignment (an 89-case probe against V8).
    ['(() => { let a = 1; { let a = 2; } return a; })()', '1'],
    ['(() => { { function f() { return 3; } } return f(); })()', '3'],
    ['(() => { let x = 0; x ||= 5; x &&= x + 1; let y = null; y ??= 7; return x + y; })()', '13'],
    ['(() => { const o = { a: 1, b: 0 }; o.a &&= 9; o.b ||= 4; return o.a + o.b; })()', '13'],
  ])('%s = %s', async (expr, want) => {
    expect(await run(script(expr))).toBe(want);
  });
});

describe('getComputedStyle colours', () => {
  it.each([
    ['color:rgb(0,128,0)', 'color', 'rgb(0, 128, 0)'],
    ['color:green', 'color', 'rgb(0, 128, 0)'],
    ['background-color:#00f', 'backgroundColor', 'rgb(0, 0, 255)'],
    ['background-color:rgba(255,0,0,.5)', 'backgroundColor', 'rgba(255, 0, 0, 0.5)'],
  ])('%s → %s', async (style, prop, want) => {
    expect(await run(`<div id="e" style="${style}"></div>` + script(`getComputedStyle(document.getElementById('e')).${prop}`))).toBe(want);
  });
});
