// ─────────────────────────────────────────────────────────────────────────────
// BENCHMARK SUITE — HTML & CSS Parsing
// ─────────────────────────────────────────────────────────────────────────────

import { bench, suite } from '../runner';
import { HtmlParser } from '../../browser/rendering/html-parser';
import { CssParser } from '../../browser/rendering/css5/parser';
import { tokenizeCss } from '../../browser/rendering/css5/tokenizer';

// ─── HTML fixtures ──────────────────────────────────────────────────────────

const HTML_TINY = '<!DOCTYPE html><html><head><title>T</title></head><body><p>Hello</p></body></html>';

const HTML_SMALL = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Small Page</title>
  <style>body{margin:0;font-family:sans-serif}h1{color:red}.card{border:1px solid #ccc;padding:16px}</style>
</head>
<body>
  <header><nav><a href="/">Home</a><a href="/about">About</a></nav></header>
  <main>
    <h1>Welcome</h1>
    <div class="card"><h2>Title</h2><p>Paragraph one.</p><p>Paragraph two.</p></div>
    <div class="card"><h2>Another</h2><ul><li>A</li><li>B</li><li>C</li></ul></div>
  </main>
  <footer><p>&copy; 2026</p></footer>
</body>
</html>`;

const HTML_MEDIUM = (() => {
  const rows: string[] = [];
  for (let i = 0; i < 100; i++) {
    rows.push(`<div class="row" id="row-${i}"><span class="col-a">Cell ${i}A</span><span class="col-b">Cell ${i}B</span><span class="col-c">Cell ${i}C</span><span class="col-d">Cell ${i}D</span></div>`);
  }
  return `<!DOCTYPE html><html><head><title>Medium</title></head><body><div class="table">${rows.join('\n')}</div></body></html>`;
})();

const HTML_LARGE = (() => {
  const items: string[] = [];
  for (let i = 0; i < 1000; i++) {
    items.push(`<li class="item" data-index="${i}"><a href="/item/${i}">Item ${i}</a><span class="desc">Description for item ${i} with some extra text to make it realistic</span><span class="price">$${(i * 1.99).toFixed(2)}</span></li>`);
  }
  return `<!DOCTYPE html><html><head><title>Large</title></head><body><ul class="items">${items.join('\n')}</ul></body></html>`;
})();

// ─── CSS fixtures ───────────────────────────────────────────────────────────

const CSS_SMALL = `body{margin:0;padding:0;font-family:sans-serif}h1{color:red;font-size:2em}.card{border:1px solid #ccc;padding:16px;margin:8px}.card:hover{background:#f5f5f5}`;

const CSS_MEDIUM = (() => {
  const rules: string[] = [];
  for (let i = 0; i < 100; i++) {
    rules.push(`.class-${i}{color:hsl(${i * 3.6},70%,50%);font-size:${12 + (i % 20)}px;padding:${4 + (i % 12)}px;margin:${2 + (i % 8)}px;border:1px solid rgba(0,0,0,${(i % 10) / 10});display:${i % 3 === 0 ? 'flex' : 'block'}}`);
  }
  return rules.join('\n');
})();

const CSS_LARGE = (() => {
  const rules: string[] = [];
  for (let i = 0; i < 500; i++) {
    rules.push(`.selector-${i}{color:rgb(${i % 256},${(i * 2) % 256},${(i * 3) % 256});font-size:${10 + (i % 30)}px;padding:${(i % 20)}px ${((i * 3) % 20)}px;margin:${(i % 10)}px;border:${1 + (i % 3)}px solid hsl(${i % 360},80%,60%);display:${i % 4 === 0 ? 'grid' : i % 3 === 0 ? 'flex' : 'block'};grid-template-columns:repeat(${2 + (i % 4)},1fr);gap:${(i % 12)}px}`);
  }
  return rules.join('\n');
})();

// ─── Benchmarks ─────────────────────────────────────────────────────────────

export function htmlParsingSuite() {
  const parser = new HtmlParser();

  return suite('HTML Parsing', [
    () => bench('HTML parse (tiny, 1 element)', () => parser.parse(HTML_TINY), { iterations: 5000, warmup: 500 }),
    () => bench('HTML parse (small, ~15 elements)', () => parser.parse(HTML_SMALL), { iterations: 3000, warmup: 300 }),
    () => bench('HTML parse (medium, ~400 elements)', () => parser.parse(HTML_MEDIUM), { iterations: 1000, warmup: 100 }),
    () => bench('HTML parse (large, ~3000 elements)', () => parser.parse(HTML_LARGE), { iterations: 200, warmup: 50 }),
  ]);
}

export function cssParsingSuite() {
  const parser = new CssParser();

  return suite('CSS Parsing', [
    () => bench('CSS parse (small, 4 rules)', () => parser.parseStylesheet(CSS_SMALL), { iterations: 5000, warmup: 500 }),
    () => bench('CSS parse (medium, 100 rules)', () => parser.parseStylesheet(CSS_MEDIUM), { iterations: 2000, warmup: 200 }),
    () => bench('CSS parse (large, 500 rules)', () => parser.parseStylesheet(CSS_LARGE), { iterations: 500, warmup: 100 }),
  ]);
}

export function cssTokenizeSuite() {
  return suite('CSS Tokenizer', [
    () => bench('CSS tokenize (small)', () => tokenizeCss(CSS_SMALL), { iterations: 10000, warmup: 1000 }),
    () => bench('CSS tokenize (medium)', () => tokenizeCss(CSS_MEDIUM), { iterations: 3000, warmup: 300 }),
    () => bench('CSS tokenize (large)', () => tokenizeCss(CSS_LARGE), { iterations: 1000, warmup: 100 }),
  ]);
}

export function htmlCssParsingSuites() {
  return [
    htmlParsingSuite(),
    cssParsingSuite(),
    cssTokenizeSuite(),
  ];
}
