// ─────────────────────────────────────────────────────────────────────────────
// BENCHMARK SUITE — Paint Engine & Rasterizer
// ─────────────────────────────────────────────────────────────────────────────

import { bench, suite } from '../runner';
import { HtmlParser } from '../../browser/rendering/html-parser';
import { DomTree, type DomDocument } from '../../browser/rendering/dom-tree';
import { LayoutEngine } from '../../browser/rendering/layout-engine';
import { PaintEngine } from '../../browser/rendering/paint-engine';
import { Rasterizer } from '../../browser/rendering/rasterizer';
import type { PaintCommand } from '../../browser/rendering/paint-engine';
import { buildStackingContextTree } from '../../browser/rendering/formatting/stacking';

// ─── Helpers ────────────────────────────────────────────────────────────────

function buildDoc(html: string): DomDocument {
  const tree = new DomTree();
  const parser = new HtmlParser();
  const result = parser.parse(html);
  return tree.buildFromHtml(result.document);
}

function layoutDoc(html: string): DomDocument {
  const doc = buildDoc(html);
  const layoutEngine = new LayoutEngine();
  layoutEngine.layout(doc);
  return doc;
}

// ─── Fixtures ───────────────────────────────────────────────────────────────

const PAINT_SIMPLE = '<html><body><p>Hello World</p></body></html>';

const PAINT_MEDIUM = (() => {
  const items: string[] = [];
  for (let i = 0; i < 50; i++) {
    items.push(`<div style="padding:8px;margin:4px;border:1px solid #ccc;background:hsl(${i * 7},70%,90%)"><h3>Title ${i}</h3><p>Content for item ${i} with some descriptive text.</p></div>`);
  }
  return `<html><body><div>${items.join('')}</div></body></html>`;
})();

const PAINT_LARGE = (() => {
  const items: string[] = [];
  for (let i = 0; i < 200; i++) {
    items.push(`<div style="padding:6px;margin:2px;border:1px solid #ddd;background:hsl(${i * 1.8},60%,95%)"><span>Item ${i}</span><span>Details ${i}</span></div>`);
  }
  return `<html><body><div>${items.join('')}</div></body></html>`;
})();

// ─── Synthetic paint commands ───────────────────────────────────────────────

function generatePaintCommands(count: number): PaintCommand[] {
  const cmds: PaintCommand[] = [];
  for (let i = 0; i < count; i++) {
    cmds.push({ type: 'setFillStyle', params: [`hsl(${i % 360},70%,60%)`] });
    cmds.push({ type: 'fillRect', params: [i % 200, Math.floor(i / 200) * 20, 50, 15] });
    if (i % 5 === 0) {
      cmds.push({ type: 'setStrokeStyle', params: ['#333'] });
      cmds.push({ type: 'setLineWidth', params: [1] });
      cmds.push({ type: 'strokeRect', params: [i % 200, Math.floor(i / 200) * 20, 50, 15] });
    }
  }
  return cmds;
}

// ─── Benchmarks ─────────────────────────────────────────────────────────────

export function stackingContextSuite() {
  return suite('Stacking Context', [
    () => {
      const doc = layoutDoc(PAINT_SIMPLE);
      const root = doc.htmlElement!;
      return bench('buildStackingContextTree (simple)', () => buildStackingContextTree(root), { iterations: 5000, warmup: 500 });
    },
    () => {
      const doc = layoutDoc(PAINT_MEDIUM);
      const root = doc.htmlElement!;
      return bench('buildStackingContextTree (50 elements)', () => buildStackingContextTree(root), { iterations: 1000, warmup: 100 });
    },
  ]);
}

export function paintEngineSuite() {
  const paintEngine = new PaintEngine();

  return suite('Paint Engine', [
    () => {
      const doc = layoutDoc(PAINT_SIMPLE);
      return bench('PaintEngine.paint (simple)', () => paintEngine.paint(doc), { iterations: 3000, warmup: 300 });
    },
    () => {
      const doc = layoutDoc(PAINT_MEDIUM);
      return bench('PaintEngine.paint (50 elements)', () => paintEngine.paint(doc), { iterations: 500, warmup: 50 });
    },
    () => {
      const doc = layoutDoc(PAINT_LARGE);
      return bench('PaintEngine.paint (200 elements)', () => paintEngine.paint(doc), { iterations: 200, warmup: 20 });
    },
  ]);
}

export function rasterizerSuite() {
  const configs: Array<{ name: string; w: number; h: number }> = [
    { name: '100x100', w: 100, h: 100 },
    { name: '480x360', w: 480, h: 360 },
    { name: '1920x1080', w: 1920, h: 1080 },
  ];

  return suite('Rasterizer', configs.flatMap(({ name, w, h }) => {
    const cmds100 = generatePaintCommands(100);
    const cmds500 = generatePaintCommands(500);

    return [
      () => bench(`Rasterize ${name} (100 cmds)`, () => {
        const r = new Rasterizer({ width: w, height: h, backgroundColor: 'white' });
        r.rasterize(cmds100);
      }, { iterations: Math.max(50, Math.floor(5000 / (w * h / 10000))), warmup: 50 }),
      () => bench(`Rasterize ${name} (500 cmds)`, () => {
        const r = new Rasterizer({ width: w, height: h, backgroundColor: 'white' });
        r.rasterize(cmds500);
      }, { iterations: Math.max(20, Math.floor(2000 / (w * h / 10000))), warmup: 20 }),
    ];
  }));
}

export function paintRasterSuites() {
  return [
    stackingContextSuite(),
    paintEngineSuite(),
    rasterizerSuite(),
  ];
}
