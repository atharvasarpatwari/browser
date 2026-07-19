// ─────────────────────────────────────────────────────────────────────────────
// BENCHMARK RUNNER — Main entry point
// ─────────────────────────────────────────────────────────────────────────────

// Polyfill ImageData for Node.js (used by Rasterizer)
if (typeof globalThis.ImageData === 'undefined') {
  (globalThis as any).ImageData = class ImageData {
    data: Uint8ClampedArray;
    width: number;
    height: number;
    constructor(dataOrWidth: Uint8ClampedArray | number, widthOrHeight: number, height?: number) {
      if (dataOrWidth instanceof Uint8ClampedArray) {
        this.data = dataOrWidth;
        this.width = widthOrHeight;
        this.height = height!;
      } else {
        this.width = dataOrWidth;
        this.height = widthOrHeight;
        this.data = new Uint8ClampedArray(this.width * this.height * 4);
      }
    }
  };
}

import { printSummary, toMarkdown } from './reporter';
import { htmlCssParsingSuites } from './suites/html-css';
import { layoutSuite } from './suites/layout';
import { jsEngineSuites } from './suites/js-engine';
import { paintRasterSuites } from './suites/paint-raster';
import { pipelineSuites } from './suites/pipeline';
import { memorySuite } from './suites/memory';
import { detectLeak } from './profiler';
import { HtmlParser } from '../browser/rendering/html-parser';
import { CssParser } from '../browser/rendering/css5/parser';
import { DomTree } from '../browser/rendering/dom-tree';
import { LayoutEngine } from '../browser/rendering/layout-engine';
import { Lexer } from '../browser/js/lexer';
import { Parser } from '../browser/js/parser';
import { Interpreter } from '../browser/js/interpreter';
import type { SuiteResult } from './runner';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ─── Run all suites ─────────────────────────────────────────────────────────

async function main() {
  const allSuites: SuiteResult[] = [
    ...htmlCssParsingSuites(),
    layoutSuite(),
    ...jsEngineSuites(),
    ...paintRasterSuites(),
    ...pipelineSuites(),
    memorySuite(),
  ];

  for (const s of allSuites) {
    await s;
  }

  printSummary(allSuites);

  // ── Dedicated leak detection summary ──────────────────────────────────────
  console.log('\n── Memory Leak Detection ──');
  const leakTests: Array<{ name: string; fn: () => void; threshold: number }> = [
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
      name: 'Layout (5k iterations)',
      fn: () => {
        const tree = new DomTree();
        const doc = tree.buildFromHtml(new HtmlParser().parse('<div><p>Test</p></div>').document);
        new LayoutEngine().layout(doc);
      },
      threshold: 500 * 1024,
    },
    {
      name: 'JS eval (5k iterations)',
      fn: () => {
        const t = new Lexer('var x=1;var y=x+2;').tokenize();
        const a = new Parser(t).parse();
        new Interpreter().run(a);
      },
      threshold: 200 * 1024,
    },
  ];

  for (const test of leakTests) {
    const result = detectLeak(test.name, test.fn, { iterations: 10000, threshold: test.threshold });
    const status = result.leaked ? 'LEAK' : 'OK';
    const deltaMB = (result.heapDelta / 1024 / 1024).toFixed(2);
    console.log(`  ${status}  ${test.name}  heap delta: ${deltaMB} MB`);
  }

  // ── Write Markdown report ──────────────────────────────────────────────────
  const reportDir = path.resolve(__dirname, '../../doc');
  if (!fs.existsSync(reportDir)) fs.mkdirSync(reportDir, { recursive: true });
  const reportPath = path.join(reportDir, `benchmark-${new Date().toISOString().slice(0, 10)}.md`);
  const md = `# Benchmark Report — ${new Date().toISOString().slice(0, 10)}\n\n${toMarkdown(allSuites)}`;
  fs.writeFileSync(reportPath, md, 'utf8');
  console.log(`\nReport written to: ${reportPath}`);
}

main().catch(err => { console.error(err); process.exit(1); });
