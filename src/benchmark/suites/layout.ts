// ─────────────────────────────────────────────────────────────────────────────
// BENCHMARK SUITE — Layout Engine
// ─────────────────────────────────────────────────────────────────────────────

import { bench, suite } from '../runner';
import { HtmlParser } from '../../browser/rendering/html-parser';
import { DomTree } from '../../browser/rendering/dom-tree';
import { LayoutEngine } from '../../browser/rendering/layout-engine';
import type { DomDocument } from '../../browser/rendering/dom-tree';

// ─── Helpers ────────────────────────────────────────────────────────────────

function buildDoc(html: string): DomDocument {
  const tree = new DomTree();
  const parser = new HtmlParser();
  const result = parser.parse(html);
  return tree.buildFromHtml(result.document);
}

// ─── HTML fixtures (layout-specific) ────────────────────────────────────────

const LAYOUT_SIMPLE = '<p>Hello World</p>';

const LAYOUT_PARAGRAPHS = (() => {
  const ps: string[] = [];
  for (let i = 0; i < 50; i++) {
    ps.push(`<p>Paragraph ${i} with some text content that wraps across lines to test inline layout. This is extra text to make it longer.</p>`);
  }
  return `<div>${ps.join('\n')}</div>`;
})();

const LAYOUT_NESTED = (() => {
  let html = '<div class="outer">';
  for (let i = 0; i < 10; i++) {
    html += `<div class="inner-${i}"><h2>Section ${i}</h2>`;
    for (let j = 0; j < 5; j++) {
      html += `<p>Text ${i}-${j}</p>`;
    }
    html += '</div>';
  }
  html += '</div>';
  return html;
})();

const LAYOUT_TABLE_LIKE = (() => {
  const rows: string[] = [];
  for (let i = 0; i < 50; i++) {
    rows.push(`<div class="row"><div class="cell">R${i}C1</div><div class="cell">R${i}C2</div><div class="cell">R${i}C3</div></div>`);
  }
  return `<div class="table">${rows.join('')}</div>`;
})();

const LAYOUT_FLOATS = (() => {
  const items: string[] = [];
  for (let i = 0; i < 20; i++) {
    items.push(`<div style="float:left;width:80px;height:40px;background:hsl(${i * 18},70%,60%)">Float ${i}</div>`);
  }
  return `<div>${items.join('')}<p style="clear:both">After floats</p></div>`;
})();

const LAYOUT_STYLED = (() => {
  const items: string[] = [];
  for (let i = 0; i < 100; i++) {
    items.push(`<div style="padding:${4 + i % 12}px;margin:${2 + i % 8}px;border:${1 + i % 3}px solid #ccc;font-size:${12 + i % 8}px">Styled item ${i}</div>`);
  }
  return `<div>${items.join('')}</div>`;
})();

// ─── Benchmarks ─────────────────────────────────────────────────────────────

export function layoutSuite() {
  const engine = new LayoutEngine();

  return suite('Layout Engine', [
    () => {
      const doc = buildDoc(LAYOUT_SIMPLE);
      return bench('Layout (simple, 1 paragraph)', () => engine.layout(doc), { iterations: 5000, warmup: 500 });
    },
    () => {
      const doc = buildDoc(LAYOUT_PARAGRAPHS);
      return bench('Layout (50 paragraphs)', () => engine.layout(doc), { iterations: 1000, warmup: 100 });
    },
    () => {
      const doc = buildDoc(LAYOUT_NESTED);
      return bench('Layout (nested divs, 60 elements)', () => engine.layout(doc), { iterations: 1000, warmup: 100 });
    },
    () => {
      const doc = buildDoc(LAYOUT_TABLE_LIKE);
      return bench('Layout (table-like, 150 cells)', () => engine.layout(doc), { iterations: 500, warmup: 50 });
    },
    () => {
      const doc = buildDoc(LAYOUT_FLOATS);
      return bench('Layout (floats, 20 floated)', () => engine.layout(doc), { iterations: 500, warmup: 50 });
    },
    () => {
      const doc = buildDoc(LAYOUT_STYLED);
      return bench('Layout (100 styled elements)', () => engine.layout(doc), { iterations: 500, warmup: 50 });
    },
  ]);
}
