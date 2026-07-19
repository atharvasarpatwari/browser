// ─────────────────────────────────────────────────────────────────────────────
// BENCHMARK SUITE — End-to-End Pipeline
// ─────────────────────────────────────────────────────────────────────────────

import { bench, suite } from '../runner';
import { HtmlParser } from '../../browser/rendering/html-parser';
import { DomTree } from '../../browser/rendering/dom-tree';
import { CssParser } from '../../browser/rendering/css5/parser';
import { LayoutEngine } from '../../browser/rendering/layout-engine';
import { PaintEngine } from '../../browser/rendering/paint-engine';
import { Rasterizer } from '../../browser/rendering/rasterizer';

// ─── Fixtures ───────────────────────────────────────────────────────────────

const PIPELINE_SIMPLE = {
  html: '<!DOCTYPE html><html><head><title>T</title></head><body><h1>Hello</h1><p>World</p></body></html>',
  css: 'h1{color:red;font-size:2em}p{margin:8px;line-height:1.5}',
};

const PIPELINE_MEDIUM = (() => {
  const rows: string[] = [];
  for (let i = 0; i < 50; i++) {
    rows.push(`<div class="card" style="padding:8px;margin:4px;border:1px solid #ccc"><h3>Title ${i}</h3><p>Content paragraph ${i} with some text.</p></div>`);
  }
  return {
    html: `<!DOCTYPE html><html><head><title>Medium</title></head><body><div class="container">${rows.join('')}</div></body></html>`,
    css: 'body{margin:0;font-family:sans-serif}.container{padding:16px}.card{border-radius:4px;margin-bottom:8px}h3{margin:0 0 4px}p{margin:0;color:#666}',
  };
})();

const PIPELINE_LARGE = (() => {
  const items: string[] = [];
  for (let i = 0; i < 200; i++) {
    items.push(`<div class="item"><div class="header"><span class="title">Item ${i}</span><span class="badge">New</span></div><div class="body"><p>Description for item ${i} with extra text to make the content realistic and provide good benchmark data for the rendering pipeline.</p></div><div class="footer"><a href="/item/${i}">View</a><span class="meta">Updated today</span></div></div>`);
  }
  return {
    html: `<!DOCTYPE html><html><head><title>Large</title></head><body><div class="list">${items.join('')}</div></body></html>`,
    css: 'body{margin:0;padding:16px;font-family:sans-serif;background:#f5f5f5}.list{max-width:800px;margin:0 auto}.item{background:white;border:1px solid #ddd;border-radius:8px;padding:16px;margin-bottom:12px}.header{display:flex;justify-content:space-between;margin-bottom:8px}.title{font-weight:bold;font-size:18px}.badge{background:#4caf50;color:white;padding:2px 8px;border-radius:12px;font-size:12px}.body{margin-bottom:8px;color:#333}.footer{display:flex;justify-content:space-between;color:#666;font-size:14px}',
  };
})();

// ─── Pipeline benchmark helper ──────────────────────────────────────────────

function runPipeline(html: string, css: string, rasterizer: Rasterizer): void {
  const htmlParser = new HtmlParser();
  const cssParser = new CssParser();
  const domTree = new DomTree();
  const layoutEngine = new LayoutEngine();
  const paintEngine = new PaintEngine();

  // 1. Parse HTML
  const htmlResult = htmlParser.parse(html);
  const doc = domTree.buildFromHtml(htmlResult.document);

  // 2. Parse CSS
  cssParser.parseStylesheet(css);

  // 3. Layout
  layoutEngine.layout(doc);

  // 4. Paint
  paintEngine.paint(doc);

  // 5. Rasterize (use a small buffer for benchmarking)
  rasterizer.rasterize([{ type: 'clearRect', params: [0, 0, rasterizer.width, rasterizer.height] }]);
}

// ─── Benchmarks ─────────────────────────────────────────────────────────────

export function pipelineSuite() {
  const rasterSmall = new Rasterizer({ width: 200, height: 200, backgroundColor: 'white' });
  const rasterMed = new Rasterizer({ width: 800, height: 600, backgroundColor: 'white' });
  const rasterLarge = new Rasterizer({ width: 1920, height: 1080, backgroundColor: 'white' });

  return suite('End-to-End Pipeline', [
    () => bench('Pipeline (simple: parse→layout→paint→rasterize)', () => runPipeline(PIPELINE_SIMPLE.html, PIPELINE_SIMPLE.css, rasterSmall), { iterations: 2000, warmup: 200 }),
    () => bench('Pipeline (medium: 50 cards)', () => runPipeline(PIPELINE_MEDIUM.html, PIPELINE_MEDIUM.css, rasterMed), { iterations: 500, warmup: 50 }),
    () => bench('Pipeline (large: 200 items)', () => runPipeline(PIPELINE_LARGE.html, PIPELINE_LARGE.css, rasterLarge), { iterations: 100, warmup: 10 }),
  ]);
}

/** Pipeline step-by-step breakdown for the simple fixture. */
export function pipelineBreakdownSuite() {
  const htmlParser = new HtmlParser();
  const cssParser = new CssParser();
  const domTree = new DomTree();
  const layoutEngine = new LayoutEngine();
  const paintEngine = new PaintEngine();
  const rasterizer = new Rasterizer({ width: 480, height: 360, backgroundColor: 'white' });

  const htmlResult = htmlParser.parse(PIPELINE_MEDIUM.html);
  const doc = domTree.buildFromHtml(htmlResult.document);
  const stylesheet = cssParser.parseStylesheet(PIPELINE_MEDIUM.css);

  return suite('Pipeline Breakdown (medium)', [
    () => bench('Step 1: HTML parse', () => htmlParser.parse(PIPELINE_MEDIUM.html), { iterations: 1000, warmup: 100 }),
    () => bench('Step 2: CSS parse', () => cssParser.parseStylesheet(PIPELINE_MEDIUM.css), { iterations: 3000, warmup: 300 }),
    () => bench('Step 3: Layout', () => layoutEngine.layout(doc), { iterations: 1000, warmup: 100 }),
    () => bench('Step 4: Paint', () => paintEngine.paint(doc), { iterations: 500, warmup: 50 }),
    () => bench('Step 5: Rasterize (480x360)', () => rasterizer.rasterize([{ type: 'clearRect', params: [0, 0, 480, 360] }]), { iterations: 2000, warmup: 200 }),
  ]);
}

export function pipelineSuites() {
  return [
    pipelineSuite(),
    pipelineBreakdownSuite(),
  ];
}
