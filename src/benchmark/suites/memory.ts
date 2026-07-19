// ─────────────────────────────────────────────────────────────────────────────
// BENCHMARK SUITE — Memory Profiling
// ─────────────────────────────────────────────────────────────────────────────

import { bench, suite } from '../runner';
import { detectLeak, measureAllocation } from '../profiler';
import { HtmlParser } from '../../browser/rendering/html-parser';
import { CssParser } from '../../browser/rendering/css5/parser';
import { DomTree } from '../../browser/rendering/dom-tree';
import { LayoutEngine } from '../../browser/rendering/layout-engine';
import { PaintEngine } from '../../browser/rendering/paint-engine';
import { Lexer } from '../../browser/js/lexer';
import { Parser } from '../../browser/js/parser';
import { Interpreter } from '../../browser/js/interpreter';

function buildDoc(html: string) {
  const tree = new DomTree();
  const parser = new HtmlParser();
  const result = parser.parse(html);
  return tree.buildFromHtml(result.document);
}

const MEDIUM_HTML = (() => {
  const rows: string[] = [];
  for (let i = 0; i < 100; i++) {
    rows.push(`<div class="card" style="padding:8px;margin:4px"><h3>Title ${i}</h3><p>Content ${i}</p></div>`);
  }
  return `<div>${rows.join('')}</div>`;
})();

export function memorySuite() {
  const htmlParser = new HtmlParser();
  const layoutEngine = new LayoutEngine();
  const paintEngine = new PaintEngine();

  return suite('Memory Profiling', [
    () => bench('HTML parse alloc/call', () => htmlParser.parse(MEDIUM_HTML), { iterations: 5000, warmup: 500 }),
    () => bench('Layout alloc/call', () => {
      const doc = buildDoc(MEDIUM_HTML);
      layoutEngine.layout(doc);
    }, { iterations: 1000, warmup: 100 }),
    () => bench('Paint alloc/call', () => {
      const doc = buildDoc(MEDIUM_HTML);
      paintEngine.paint(doc);
    }, { iterations: 1000, warmup: 100 }),
    () => bench('JS eval alloc/call', () => {
      const src = 'function fib(n){if(n<=1)return n;return fib(n-1)+fib(n-2)} fib(10);';
      const tokens = new Lexer(src).tokenize();
      const ast = new Parser(tokens).parse();
      new Interpreter().run(ast);
    }, { iterations: 2000, warmup: 200 }),
  ]);
}

/**
 * Run standalone leak detection (called from main entry point, not part of suite).
 */
export function leakDetectionSuite() {
  const results: Array<{ name: string; leaked: boolean; heapDelta: number; threshold: number }> = [];
  const tests: Array<{ name: string; fn: () => void; threshold: number }> = [
    {
      name: 'HTML parse (10k iterations)',
      fn: () => new HtmlParser().parse('<div><p>Hello</p><span>World</span></div>'),
      threshold: 200 * 1024,
    },
    {
      name: 'CSS parse (10k iterations)',
      fn: () => new CssParser().parseStylesheet('.a{color:red}.b{margin:1px}'),
      threshold: 200 * 1024,
    },
    {
      name: 'Layout (10k iterations)',
      fn: () => {
        const tree = new DomTree();
        const doc = tree.buildFromHtml(new HtmlParser().parse('<div><p>Test</p></div>').document);
        new LayoutEngine().layout(doc);
      },
      threshold: 500 * 1024,
    },
    {
      name: 'JS eval (10k iterations)',
      fn: () => {
        const t = new Lexer('var x=1;var y=x+2;').tokenize();
        const a = new Parser(t).parse();
        new Interpreter().run(a);
      },
      threshold: 200 * 1024,
    },
    {
      name: 'Paint (10k iterations)',
      fn: () => {
        const tree = new DomTree();
        const doc = tree.buildFromHtml(new HtmlParser().parse('<div><p>Test</p></div>').document);
        new PaintEngine().paint(doc);
      },
      threshold: 500 * 1024,
    },
  ];

  for (const test of tests) {
    const result = detectLeak(test.name, test.fn, { iterations: 10000, threshold: test.threshold });
    results.push(result);
    const status = result.leaked ? 'LEAK' : 'OK';
    const deltaKB = (result.heapDelta / 1024).toFixed(1);
    console.log(`  ${status}  ${test.name}  heap delta: ${deltaKB} KB`);
  }

  return results;
}
