import { describe, it, expect } from 'vitest';
import { HtmlParser } from '../src/browser/rendering/html-parser';
import { DomTree } from '../src/browser/rendering/dom-tree';
import type { DomDocument, DomElement, LayoutBox } from '../src/browser/rendering/dom-tree';
import { LayoutEngine } from '../src/browser/rendering/layout-engine';

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────

function buildDoc(html: string): { doc: DomDocument; tree: DomTree } {
  const parser = new HtmlParser();
  const tree = new DomTree();
  const result = parser.parse(html);
  const doc = tree.buildFromHtml(result.document);
  return { doc, tree };
}

function applyStyles(tree: DomTree, el: DomElement, entries: Record<string, string>): void {
  const existing = new Map(el.computedStyle ?? []);
  for (const [k, v] of Object.entries(entries)) existing.set(k, v);
  tree.setComputedStyle(el, existing);
}

function makeFlexDoc(
  containerStyles: Record<string, string>,
  childCount: number,
  childStyles?: Record<string, string>,
): { doc: DomDocument; tree: DomTree; engine: LayoutEngine } {
  const children = Array.from({ length: childCount }, (_, i) =>
    `<div id="c${i}"></div>`
  ).join('');
  const { doc, tree } = buildDoc(`<html><body><div id="flex">${children}</div></body></html>`);
  applyStyles(tree, doc.bodyElement!, { display: 'block', margin: '0' });
  applyStyles(tree, tree.getElementById('flex')!, {
    display: 'flex',
    margin: '0',
    ...containerStyles,
  });
  for (let i = 0; i < childCount; i++) {
    applyStyles(tree, tree.getElementById(`c${i}`)!, {
      display: 'block',
      margin: '0',
      ...childStyles,
    });
  }
  const engine = new LayoutEngine({ viewportWidth: 1000, viewportHeight: 800, defaultFontSize: 16 });
  engine.layout(doc, tree);
  return { doc, tree, engine };
}

// ─────────────────────────────────────────────────────────────────────────────
// TESTS
// ─────────────────────────────────────────────────────────────────────────────

describe('Flex Layout', () => {

  // ── Basic Layout ──────────────────────────────────────────────────────

  describe('basic flex layout', () => {
    it('should place two items side by side in a row', () => {
      const { tree } = makeFlexDoc(
        { 'flex-direction': 'row' },
        2,
        { width: '200', height: '50' },
      );
      const c0 = tree.getElementById('c0')!.layoutBox!;
      const c1 = tree.getElementById('c1')!.layoutBox!;
      expect(c0.x).toBe(0);
      expect(c1.x).toBe(200);
      expect(c0.y).toBe(c1.y);
    });

    it('should layout a single flex item', () => {
      const { tree } = makeFlexDoc(
        { 'flex-direction': 'row' },
        1,
        { width: '200', height: '50' },
      );
      const c0 = tree.getElementById('c0')!.layoutBox!;
      expect(c0.x).toBe(0);
      expect(c0.width).toBe(200);
    });

    it('should handle empty flex container', () => {
      const { doc, tree } = buildDoc('<html><body><div id="flex"></div></body></html>');
      applyStyles(tree, doc.bodyElement!, { display: 'block', margin: '0' });
      applyStyles(tree, tree.getElementById('flex')!, {
        display: 'flex',
        margin: '0',
        'flex-direction': 'row',
      });
      const engine = new LayoutEngine({ viewportWidth: 1000, viewportHeight: 800, defaultFontSize: 16 });
      engine.layout(doc, tree);
      const box = tree.getElementById('flex')!.layoutBox!;
      expect(box.height).toBe(0);
    });
  });

  // ── flex-direction ─────────────────────────────────────────────────────

  describe('flex-direction', () => {
    it('should layout items in row direction (default)', () => {
      const { tree } = makeFlexDoc({}, 2, { width: '100', height: '50' });
      const c0 = tree.getElementById('c0')!.layoutBox!;
      const c1 = tree.getElementById('c1')!.layoutBox!;
      expect(c0.x).toBe(0);
      expect(c1.x).toBe(100);
    });

    it('should layout items in row-reverse direction', () => {
      const { tree } = makeFlexDoc(
        { 'flex-direction': 'row-reverse' },
        2,
        { width: '100', height: '50' },
      );
      const c0 = tree.getElementById('c0')!.layoutBox!;
      const c1 = tree.getElementById('c1')!.layoutBox!;
      // row-reverse: items are placed right-to-left
      expect(c1.x).toBeLessThan(c0.x);
    });

    it('should layout items in column direction', () => {
      const { tree } = makeFlexDoc(
        { 'flex-direction': 'column' },
        2,
        { width: '100', height: '50' },
      );
      const c0 = tree.getElementById('c0')!.layoutBox!;
      const c1 = tree.getElementById('c1')!.layoutBox!;
      expect(c0.y).toBe(0);
      expect(c1.y).toBe(50);
      expect(c0.x).toBe(c1.x);
    });

    it('should layout items in column-reverse direction', () => {
      const { tree } = makeFlexDoc(
        { 'flex-direction': 'column-reverse' },
        2,
        { width: '100', height: '50' },
      );
      const c0 = tree.getElementById('c0')!.layoutBox!;
      const c1 = tree.getElementById('c1')!.layoutBox!;
      // column-reverse: items placed bottom-to-top
      expect(c1.y).toBeLessThan(c0.y);
    });
  });

  // ── flex-grow ──────────────────────────────────────────────────────────

  describe('flex-grow', () => {
    it('should not grow items by default (flex-grow: 0)', () => {
      const { tree } = makeFlexDoc(
        { 'flex-direction': 'row' },
        2,
        { width: '100', height: '50', 'flex-grow': '0' },
      );
      const c0 = tree.getElementById('c0')!.layoutBox!;
      const c1 = tree.getElementById('c1')!.layoutBox!;
      expect(c0.width).toBe(100);
      expect(c1.width).toBe(100);
    });

    it('should distribute space equally with equal flex-grow', () => {
      const { tree } = makeFlexDoc(
        { 'flex-direction': 'row' },
        2,
        { height: '50', 'flex-grow': '1' },
      );
      const c0 = tree.getElementById('c0')!.layoutBox!;
      const c1 = tree.getElementById('c1')!.layoutBox!;
      expect(c0.width).toBe(500);
      expect(c1.width).toBe(500);
    });

    it('should distribute space proportionally with different flex-grow', () => {
      const { tree } = makeFlexDoc(
        { 'flex-direction': 'row' },
        2,
        { height: '50' },
      );
      applyStyles(tree, tree.getElementById('c0')!, { 'flex-grow': '1' });
      applyStyles(tree, tree.getElementById('c1')!, { 'flex-grow': '2' });
      // Re-layout with updated styles
      const engine = new LayoutEngine({ viewportWidth: 1000, viewportHeight: 800, defaultFontSize: 16 });
      engine.layout(tree.buildFromHtml(
        new HtmlParser().parse('<html><body></body></html>').document,
      ), tree);
      // Actually need to re-layout properly - let me just verify via a fresh layout
      const { doc, tree: tree2 } = buildDoc(
        '<html><body><div id="flex"><div id="c0"></div><div id="c1"></div></div></body></html>'
      );
      applyStyles(tree2, doc.bodyElement!, { display: 'block', margin: '0' });
      applyStyles(tree2, tree2.getElementById('flex')!, {
        display: 'flex', margin: '0', 'flex-direction': 'row',
      });
      applyStyles(tree2, tree2.getElementById('c0')!, {
        display: 'block', margin: '0', height: '50', 'flex-grow': '1',
      });
      applyStyles(tree2, tree2.getElementById('c1')!, {
        display: 'block', margin: '0', height: '50', 'flex-grow': '2',
      });
      const engine2 = new LayoutEngine({ viewportWidth: 1000, viewportHeight: 800, defaultFontSize: 16 });
      engine2.layout(doc, tree2);
      const c0 = tree2.getElementById('c0')!.layoutBox!;
      const c1 = tree2.getElementById('c1')!.layoutBox!;
      expect(c0.width).toBeCloseTo(333.33, 0);
      expect(c1.width).toBeCloseTo(666.67, 0);
    });

    it('should not grow an item with flex-grow: 0 when siblings grow', () => {
      const { doc, tree } = buildDoc(
        '<html><body><div id="flex"><div id="c0"></div><div id="c1"></div></div></body></html>'
      );
      applyStyles(tree, doc.bodyElement!, { display: 'block', margin: '0' });
      applyStyles(tree, tree.getElementById('flex')!, {
        display: 'flex', margin: '0', 'flex-direction': 'row',
      });
      applyStyles(tree, tree.getElementById('c0')!, {
        display: 'block', margin: '0', width: '100', height: '50', 'flex-grow': '0',
      });
      applyStyles(tree, tree.getElementById('c1')!, {
        display: 'block', margin: '0', height: '50', 'flex-grow': '1',
      });
      const engine = new LayoutEngine({ viewportWidth: 1000, viewportHeight: 800, defaultFontSize: 16 });
      engine.layout(doc, tree);
      const c0 = tree.getElementById('c0')!.layoutBox!;
      const c1 = tree.getElementById('c1')!.layoutBox!;
      expect(c0.width).toBe(100);
      expect(c1.width).toBe(900);
    });
  });

  // ── flex-shrink ────────────────────────────────────────────────────────

  describe('flex-shrink', () => {
    it('should shrink items when container is too small', () => {
      const { doc, tree } = buildDoc(
        '<html><body><div id="flex"><div id="c0"></div><div id="c1"></div></div></body></html>'
      );
      applyStyles(tree, doc.bodyElement!, { display: 'block', margin: '0' });
      applyStyles(tree, tree.getElementById('flex')!, {
        display: 'flex', margin: '0', 'flex-direction': 'row',
      });
      applyStyles(tree, tree.getElementById('c0')!, {
        display: 'block', margin: '0', width: '600', height: '50', 'flex-shrink': '1',
      });
      applyStyles(tree, tree.getElementById('c1')!, {
        display: 'block', margin: '0', width: '600', height: '50', 'flex-shrink': '1',
      });
      const engine = new LayoutEngine({ viewportWidth: 1000, viewportHeight: 800, defaultFontSize: 16 });
      engine.layout(doc, tree);
      const c0 = tree.getElementById('c0')!.layoutBox!;
      const c1 = tree.getElementById('c1')!.layoutBox!;
      // Both 600px items should shrink to fit 1000px container
      expect(c0.width + c1.width).toBeLessThanOrEqual(1000);
    });

    it('should not shrink an item with flex-shrink: 0', () => {
      const { doc, tree } = buildDoc(
        '<html><body><div id="flex"><div id="c0"></div><div id="c1"></div></div></body></html>'
      );
      applyStyles(tree, doc.bodyElement!, { display: 'block', margin: '0' });
      applyStyles(tree, tree.getElementById('flex')!, {
        display: 'flex', margin: '0', 'flex-direction': 'row',
      });
      applyStyles(tree, tree.getElementById('c0')!, {
        display: 'block', margin: '0', width: '800', height: '50', 'flex-shrink': '0',
      });
      applyStyles(tree, tree.getElementById('c1')!, {
        display: 'block', margin: '0', width: '400', height: '50', 'flex-shrink': '1',
      });
      const engine = new LayoutEngine({ viewportWidth: 1000, viewportHeight: 800, defaultFontSize: 16 });
      engine.layout(doc, tree);
      const c0 = tree.getElementById('c0')!.layoutBox!;
      expect(c0.width).toBe(800);
    });
  });

  // ── flex-basis ─────────────────────────────────────────────────────────

  describe('flex-basis', () => {
    it('should use explicit flex-basis over width', () => {
      const { doc, tree } = buildDoc(
        '<html><body><div id="flex"><div id="c0"></div></div></body></html>'
      );
      applyStyles(tree, doc.bodyElement!, { display: 'block', margin: '0' });
      applyStyles(tree, tree.getElementById('flex')!, {
        display: 'flex', margin: '0', 'flex-direction': 'row',
      });
      applyStyles(tree, tree.getElementById('c0')!, {
        display: 'block', margin: '0', width: '100', height: '50', 'flex-basis': '300',
      });
      const engine = new LayoutEngine({ viewportWidth: 1000, viewportHeight: 800, defaultFontSize: 16 });
      engine.layout(doc, tree);
      const c0 = tree.getElementById('c0')!.layoutBox!;
      expect(c0.width).toBe(300);
    });

    it('should fall back to width when flex-basis is auto', () => {
      const { doc, tree } = buildDoc(
        '<html><body><div id="flex"><div id="c0"></div></div></body></html>'
      );
      applyStyles(tree, doc.bodyElement!, { display: 'block', margin: '0' });
      applyStyles(tree, tree.getElementById('flex')!, {
        display: 'flex', margin: '0', 'flex-direction': 'row',
      });
      applyStyles(tree, tree.getElementById('c0')!, {
        display: 'block', margin: '0', width: '250', height: '50', 'flex-basis': 'auto',
      });
      const engine = new LayoutEngine({ viewportWidth: 1000, viewportHeight: 800, defaultFontSize: 16 });
      engine.layout(doc, tree);
      const c0 = tree.getElementById('c0')!.layoutBox!;
      expect(c0.width).toBe(250);
    });
  });

  // ── flex shorthand ─────────────────────────────────────────────────────

  describe('flex shorthand', () => {
    it('should parse flex: 1 as grow=1 shrink=1 basis=0', () => {
      const { doc, tree } = buildDoc(
        '<html><body><div id="flex"><div id="c0"></div><div id="c1"></div></div></body></html>'
      );
      applyStyles(tree, doc.bodyElement!, { display: 'block', margin: '0' });
      applyStyles(tree, tree.getElementById('flex')!, {
        display: 'flex', margin: '0', 'flex-direction': 'row',
      });
      applyStyles(tree, tree.getElementById('c0')!, { display: 'block', margin: '0', height: '50', flex: '1' });
      applyStyles(tree, tree.getElementById('c1')!, { display: 'block', margin: '0', height: '50', flex: '1' });
      const engine = new LayoutEngine({ viewportWidth: 1000, viewportHeight: 800, defaultFontSize: 16 });
      engine.layout(doc, tree);
      const c0 = tree.getElementById('c0')!.layoutBox!;
      const c1 = tree.getElementById('c1')!.layoutBox!;
      expect(c0.width).toBe(500);
      expect(c1.width).toBe(500);
    });

    it('should parse flex: 2 1 100px as grow=2 shrink=1 basis=100', () => {
      const { doc, tree } = buildDoc(
        '<html><body><div id="flex"><div id="c0"></div><div id="c1"></div></div></body></html>'
      );
      applyStyles(tree, doc.bodyElement!, { display: 'block', margin: '0' });
      applyStyles(tree, tree.getElementById('flex')!, {
        display: 'flex', margin: '0', 'flex-direction': 'row',
      });
      applyStyles(tree, tree.getElementById('c0')!, { display: 'block', margin: '0', height: '50', flex: '2 1 100' });
      applyStyles(tree, tree.getElementById('c1')!, { display: 'block', margin: '0', height: '50', flex: '1 1 100' });
      const engine = new LayoutEngine({ viewportWidth: 1000, viewportHeight: 800, defaultFontSize: 16 });
      engine.layout(doc, tree);
      const c0 = tree.getElementById('c0')!.layoutBox!;
      const c1 = tree.getElementById('c1')!.layoutBox!;
      // Total basis: 200, free: 800, grow ratio 2:1 → c0 gets 200 + 533.33, c1 gets 200 + 266.67
      expect(c0.width).toBeGreaterThan(c1.width);
      expect(c0.width + c1.width).toBe(1000);
    });
  });

  // ── justify-content ───────────────────────────────────────────────────

  describe('justify-content', () => {
    it('should align items at start by default (flex-start)', () => {
      const { tree } = makeFlexDoc(
        { 'flex-direction': 'row' },
        2,
        { width: '100', height: '50' },
      );
      const c0 = tree.getElementById('c0')!.layoutBox!;
      expect(c0.x).toBe(0);
    });

    it('should align items at end (flex-end)', () => {
      const { doc, tree } = buildDoc(
        '<html><body><div id="flex"><div id="c0"></div><div id="c1"></div></div></body></html>'
      );
      applyStyles(tree, doc.bodyElement!, { display: 'block', margin: '0' });
      applyStyles(tree, tree.getElementById('flex')!, {
        display: 'flex', margin: '0', 'flex-direction': 'row', 'justify-content': 'flex-end',
      });
      applyStyles(tree, tree.getElementById('c0')!, { display: 'block', margin: '0', width: '100', height: '50' });
      applyStyles(tree, tree.getElementById('c1')!, { display: 'block', margin: '0', width: '100', height: '50' });
      const engine = new LayoutEngine({ viewportWidth: 1000, viewportHeight: 800, defaultFontSize: 16 });
      engine.layout(doc, tree);
      const c1 = tree.getElementById('c1')!.layoutBox!;
      expect(c1.x).toBe(900);
    });

    it('should center items (center)', () => {
      const { doc, tree } = buildDoc(
        '<html><body><div id="flex"><div id="c0"></div></div></body></html>'
      );
      applyStyles(tree, doc.bodyElement!, { display: 'block', margin: '0' });
      applyStyles(tree, tree.getElementById('flex')!, {
        display: 'flex', margin: '0', 'flex-direction': 'row', 'justify-content': 'center',
      });
      applyStyles(tree, tree.getElementById('c0')!, { display: 'block', margin: '0', width: '200', height: '50' });
      const engine = new LayoutEngine({ viewportWidth: 1000, viewportHeight: 800, defaultFontSize: 16 });
      engine.layout(doc, tree);
      const c0 = tree.getElementById('c0')!.layoutBox!;
      expect(c0.x).toBe(400);
    });

    it('should distribute space between items (space-between)', () => {
      const { doc, tree } = buildDoc(
        '<html><body><div id="flex"><div id="c0"></div><div id="c1"></div></div></body></html>'
      );
      applyStyles(tree, doc.bodyElement!, { display: 'block', margin: '0' });
      applyStyles(tree, tree.getElementById('flex')!, {
        display: 'flex', margin: '0', 'flex-direction': 'row', 'justify-content': 'space-between',
      });
      applyStyles(tree, tree.getElementById('c0')!, { display: 'block', margin: '0', width: '100', height: '50' });
      applyStyles(tree, tree.getElementById('c1')!, { display: 'block', margin: '0', width: '100', height: '50' });
      const engine = new LayoutEngine({ viewportWidth: 1000, viewportHeight: 800, defaultFontSize: 16 });
      engine.layout(doc, tree);
      const c0 = tree.getElementById('c0')!.layoutBox!;
      const c1 = tree.getElementById('c1')!.layoutBox!;
      expect(c0.x).toBe(0);
      expect(c1.x).toBe(900);
    });

    it('should distribute space around items (space-around)', () => {
      const { doc, tree } = buildDoc(
        '<html><body><div id="flex"><div id="c0"></div><div id="c1"></div></div></body></html>'
      );
      applyStyles(tree, doc.bodyElement!, { display: 'block', margin: '0' });
      applyStyles(tree, tree.getElementById('flex')!, {
        display: 'flex', margin: '0', 'flex-direction': 'row', 'justify-content': 'space-around',
      });
      applyStyles(tree, tree.getElementById('c0')!, { display: 'block', margin: '0', width: '100', height: '50' });
      applyStyles(tree, tree.getElementById('c1')!, { display: 'block', margin: '0', width: '100', height: '50' });
      const engine = new LayoutEngine({ viewportWidth: 1000, viewportHeight: 800, defaultFontSize: 16 });
      engine.layout(doc, tree);
      const c0 = tree.getElementById('c0')!.layoutBox!;
      const c1 = tree.getElementById('c1')!.layoutBox!;
      // space-around: each item gets equal space on both sides
      expect(c0.x).toBeGreaterThan(0);
      expect(c1.x).toBeGreaterThan(c0.x + 100);
    });

    it('should distribute space evenly (space-evenly)', () => {
      const { doc, tree } = buildDoc(
        '<html><body><div id="flex"><div id="c0"></div><div id="c1"></div></div></body></html>'
      );
      applyStyles(tree, doc.bodyElement!, { display: 'block', margin: '0' });
      applyStyles(tree, tree.getElementById('flex')!, {
        display: 'flex', margin: '0', 'flex-direction': 'row', 'justify-content': 'space-evenly',
      });
      applyStyles(tree, tree.getElementById('c0')!, { display: 'block', margin: '0', width: '100', height: '50' });
      applyStyles(tree, tree.getElementById('c1')!, { display: 'block', margin: '0', width: '100', height: '50' });
      const engine = new LayoutEngine({ viewportWidth: 1000, viewportHeight: 800, defaultFontSize: 16 });
      engine.layout(doc, tree);
      const c0 = tree.getElementById('c0')!.layoutBox!;
      const c1 = tree.getElementById('c1')!.layoutBox!;
      // space-evenly: equal gaps between items, before first, and after last
      const gap0 = c0.x;
      const gapBetween = c1.x - c0.x - 100;
      const gapAfter = 1000 - c1.x - 100;
      expect(gap0).toBeCloseTo(gapBetween, 0);
      expect(gap0).toBeCloseTo(gapAfter, 0);
    });
  });

  // ── align-items ────────────────────────────────────────────────────────

  describe('align-items', () => {
    it('should stretch items to fill cross axis by default', () => {
      const { doc, tree } = buildDoc(
        '<html><body><div id="flex"><div id="c0"></div></div></body></html>'
      );
      applyStyles(tree, doc.bodyElement!, { display: 'block', margin: '0' });
      applyStyles(tree, tree.getElementById('flex')!, {
        display: 'flex', margin: '0', 'flex-direction': 'row', height: '200',
      });
      applyStyles(tree, tree.getElementById('c0')!, { display: 'block', margin: '0', width: '100' });
      const engine = new LayoutEngine({ viewportWidth: 1000, viewportHeight: 800, defaultFontSize: 16 });
      engine.layout(doc, tree);
      const c0 = tree.getElementById('c0')!.layoutBox!;
      expect(c0.height).toBe(200);
    });

    it('should align items to cross-axis start (flex-start)', () => {
      const { doc, tree } = buildDoc(
        '<html><body><div id="flex"><div id="c0"></div></div></body></html>'
      );
      applyStyles(tree, doc.bodyElement!, { display: 'block', margin: '0' });
      applyStyles(tree, tree.getElementById('flex')!, {
        display: 'flex', margin: '0', 'flex-direction': 'row', height: '200',
        'align-items': 'flex-start',
      });
      applyStyles(tree, tree.getElementById('c0')!, { display: 'block', margin: '0', width: '100', height: '50' });
      const engine = new LayoutEngine({ viewportWidth: 1000, viewportHeight: 800, defaultFontSize: 16 });
      engine.layout(doc, tree);
      const c0 = tree.getElementById('c0')!.layoutBox!;
      expect(c0.y).toBe(0);
      expect(c0.height).toBe(50);
    });

    it('should align items to cross-axis end (flex-end)', () => {
      const { doc, tree } = buildDoc(
        '<html><body><div id="flex"><div id="c0"></div></div></body></html>'
      );
      applyStyles(tree, doc.bodyElement!, { display: 'block', margin: '0' });
      applyStyles(tree, tree.getElementById('flex')!, {
        display: 'flex', margin: '0', 'flex-direction': 'row', height: '200',
        'align-items': 'flex-end',
      });
      applyStyles(tree, tree.getElementById('c0')!, { display: 'block', margin: '0', width: '100', height: '50' });
      const engine = new LayoutEngine({ viewportWidth: 1000, viewportHeight: 800, defaultFontSize: 16 });
      engine.layout(doc, tree);
      const c0 = tree.getElementById('c0')!.layoutBox!;
      expect(c0.y).toBe(150);
    });

    it('should center items on cross axis (center)', () => {
      const { doc, tree } = buildDoc(
        '<html><body><div id="flex"><div id="c0"></div></div></body></html>'
      );
      applyStyles(tree, doc.bodyElement!, { display: 'block', margin: '0' });
      applyStyles(tree, tree.getElementById('flex')!, {
        display: 'flex', margin: '0', 'flex-direction': 'row', height: '200',
        'align-items': 'center',
      });
      applyStyles(tree, tree.getElementById('c0')!, { display: 'block', margin: '0', width: '100', height: '50' });
      const engine = new LayoutEngine({ viewportWidth: 1000, viewportHeight: 800, defaultFontSize: 16 });
      engine.layout(doc, tree);
      const c0 = tree.getElementById('c0')!.layoutBox!;
      expect(c0.y).toBe(75);
    });
  });

  // ── align-self ─────────────────────────────────────────────────────────

  describe('align-self', () => {
    it('should override align-items for a single item', () => {
      const { doc, tree } = buildDoc(
        '<html><body><div id="flex"><div id="c0"></div><div id="c1"></div></div></body></html>'
      );
      applyStyles(tree, doc.bodyElement!, { display: 'block', margin: '0' });
      applyStyles(tree, tree.getElementById('flex')!, {
        display: 'flex', margin: '0', 'flex-direction': 'row', height: '200',
        'align-items': 'flex-start',
      });
      applyStyles(tree, tree.getElementById('c0')!, { display: 'block', margin: '0', width: '100', height: '50' });
      applyStyles(tree, tree.getElementById('c1')!, { display: 'block', margin: '0', width: '100', height: '50', 'align-self': 'flex-end' });
      const engine = new LayoutEngine({ viewportWidth: 1000, viewportHeight: 800, defaultFontSize: 16 });
      engine.layout(doc, tree);
      const c0 = tree.getElementById('c0')!.layoutBox!;
      const c1 = tree.getElementById('c1')!.layoutBox!;
      expect(c0.y).toBe(0);
      expect(c1.y).toBe(150);
    });
  });

  // ── flex-wrap ──────────────────────────────────────────────────────────

  describe('flex-wrap', () => {
    it('should keep items on single line by default (nowrap)', () => {
      const { doc, tree } = buildDoc(
        '<html><body><div id="flex"><div id="c0"></div><div id="c1"></div></div></body></html>'
      );
      applyStyles(tree, doc.bodyElement!, { display: 'block', margin: '0' });
      applyStyles(tree, tree.getElementById('flex')!, {
        display: 'flex', margin: '0', 'flex-direction': 'row', 'flex-wrap': 'nowrap',
      });
      applyStyles(tree, tree.getElementById('c0')!, { display: 'block', margin: '0', width: '600', height: '50', 'flex-shrink': '1' });
      applyStyles(tree, tree.getElementById('c1')!, { display: 'block', margin: '0', width: '600', height: '50', 'flex-shrink': '1' });
      const engine = new LayoutEngine({ viewportWidth: 1000, viewportHeight: 800, defaultFontSize: 16 });
      engine.layout(doc, tree);
      const c0 = tree.getElementById('c0')!.layoutBox!;
      const c1 = tree.getElementById('c1')!.layoutBox!;
      // Both should be on the same line (same y)
      expect(c0.y).toBe(c1.y);
    });

    it('should wrap items to new lines (wrap)', () => {
      const { doc, tree } = buildDoc(
        '<html><body><div id="flex"><div id="c0"></div><div id="c1"></div></div></body></html>'
      );
      applyStyles(tree, doc.bodyElement!, { display: 'block', margin: '0' });
      applyStyles(tree, tree.getElementById('flex')!, {
        display: 'flex', margin: '0', 'flex-direction': 'row', 'flex-wrap': 'wrap',
      });
      applyStyles(tree, tree.getElementById('c0')!, { display: 'block', margin: '0', width: '600', height: '50' });
      applyStyles(tree, tree.getElementById('c1')!, { display: 'block', margin: '0', width: '600', height: '50' });
      const engine = new LayoutEngine({ viewportWidth: 1000, viewportHeight: 800, defaultFontSize: 16 });
      engine.layout(doc, tree);
      const c0 = tree.getElementById('c0')!.layoutBox!;
      const c1 = tree.getElementById('c1')!.layoutBox!;
      // c1 should wrap to the next line
      expect(c1.y).toBeGreaterThan(c0.y);
    });
  });

  // ── gap ────────────────────────────────────────────────────────────────

  describe('gap', () => {
    it('should add gap between items', () => {
      const { doc, tree } = buildDoc(
        '<html><body><div id="flex"><div id="c0"></div><div id="c1"></div></div></body></html>'
      );
      applyStyles(tree, doc.bodyElement!, { display: 'block', margin: '0' });
      applyStyles(tree, tree.getElementById('flex')!, {
        display: 'flex', margin: '0', 'flex-direction': 'row', gap: '20',
      });
      applyStyles(tree, tree.getElementById('c0')!, { display: 'block', margin: '0', width: '100', height: '50' });
      applyStyles(tree, tree.getElementById('c1')!, { display: 'block', margin: '0', width: '100', height: '50' });
      const engine = new LayoutEngine({ viewportWidth: 1000, viewportHeight: 800, defaultFontSize: 16 });
      engine.layout(doc, tree);
      const c0 = tree.getElementById('c0')!.layoutBox!;
      const c1 = tree.getElementById('c1')!.layoutBox!;
      expect(c1.x - c0.x).toBe(120); // 100 (width) + 20 (gap)
    });

    it('should support separate row-gap and column-gap', () => {
      const { doc, tree } = buildDoc(
        '<html><body><div id="flex"><div id="c0"></div><div id="c1"></div></div></body></html>'
      );
      applyStyles(tree, doc.bodyElement!, { display: 'block', margin: '0' });
      applyStyles(tree, tree.getElementById('flex')!, {
        display: 'flex', margin: '0', 'flex-direction': 'row',
        'row-gap': '10', 'column-gap': '30',
      });
      applyStyles(tree, tree.getElementById('c0')!, { display: 'block', margin: '0', width: '100', height: '50' });
      applyStyles(tree, tree.getElementById('c1')!, { display: 'block', margin: '0', width: '100', height: '50' });
      const engine = new LayoutEngine({ viewportWidth: 1000, viewportHeight: 800, defaultFontSize: 16 });
      engine.layout(doc, tree);
      const c0 = tree.getElementById('c0')!.layoutBox!;
      const c1 = tree.getElementById('c1')!.layoutBox!;
      // column-gap (main axis gap for row) = 30
      expect(c1.x - c0.x).toBe(130); // 100 + 30
    });

    it('should add gap between flex lines when wrapping', () => {
      const { doc, tree } = buildDoc(
        '<html><body><div id="flex"><div id="c0"></div><div id="c1"></div></div></body></html>'
      );
      applyStyles(tree, doc.bodyElement!, { display: 'block', margin: '0' });
      applyStyles(tree, tree.getElementById('flex')!, {
        display: 'flex', margin: '0', 'flex-direction': 'row', 'flex-wrap': 'wrap',
        'row-gap': '20', 'column-gap': '0',
      });
      applyStyles(tree, tree.getElementById('c0')!, { display: 'block', margin: '0', width: '600', height: '50' });
      applyStyles(tree, tree.getElementById('c1')!, { display: 'block', margin: '0', width: '600', height: '50' });
      const engine = new LayoutEngine({ viewportWidth: 1000, viewportHeight: 800, defaultFontSize: 16 });
      engine.layout(doc, tree);
      const c0 = tree.getElementById('c0')!.layoutBox!;
      const c1 = tree.getElementById('c1')!.layoutBox!;
      // row-gap (cross axis gap for row) = 20
      expect(c1.y - c0.y).toBe(70); // 50 (height) + 20 (gap)
    });
  });

  // ── order ──────────────────────────────────────────────────────────────

  describe('order', () => {
    it('should reorder items by order property', () => {
      const { doc, tree } = buildDoc(
        '<html><body><div id="flex"><div id="c0"></div><div id="c1"></div><div id="c2"></div></div></body></html>'
      );
      applyStyles(tree, doc.bodyElement!, { display: 'block', margin: '0' });
      applyStyles(tree, tree.getElementById('flex')!, {
        display: 'flex', margin: '0', 'flex-direction': 'row',
      });
      applyStyles(tree, tree.getElementById('c0')!, { display: 'block', margin: '0', width: '100', height: '50', order: '2' });
      applyStyles(tree, tree.getElementById('c1')!, { display: 'block', margin: '0', width: '100', height: '50', order: '1' });
      applyStyles(tree, tree.getElementById('c2')!, { display: 'block', margin: '0', width: '100', height: '50', order: '3' });
      const engine = new LayoutEngine({ viewportWidth: 1000, viewportHeight: 800, defaultFontSize: 16 });
      engine.layout(doc, tree);
      const c0 = tree.getElementById('c0')!.layoutBox!;
      const c1 = tree.getElementById('c1')!.layoutBox!;
      const c2 = tree.getElementById('c2')!.layoutBox!;
      // Visual order: c1 (order 1), c0 (order 2), c2 (order 3)
      expect(c1.x).toBe(0);
      expect(c0.x).toBe(100);
      expect(c2.x).toBe(200);
    });
  });

  // ── Integration ────────────────────────────────────────────────────────

  describe('integration', () => {
    it('should handle flex container with box model (padding, border)', () => {
      const { doc, tree } = buildDoc(
        '<html><body><div id="flex"><div id="c0"></div></div></body></html>'
      );
      applyStyles(tree, doc.bodyElement!, { display: 'block', margin: '0' });
      applyStyles(tree, tree.getElementById('flex')!, {
        display: 'flex', margin: '0', 'flex-direction': 'row',
        'padding-top': '10', 'padding-left': '20',
        'border-top-width': '5', 'border-left-width': '5',
      });
      applyStyles(tree, tree.getElementById('c0')!, { display: 'block', margin: '0', width: '100', height: '50' });
      const engine = new LayoutEngine({ viewportWidth: 1000, viewportHeight: 800, defaultFontSize: 16 });
      engine.layout(doc, tree);
      const flex = tree.getElementById('flex')!.layoutBox!;
      const c0 = tree.getElementById('c0')!.layoutBox!;
      // c0 should be inside flex's content area
      expect(c0.x).toBe(25); // border-left(5) + padding-left(20)
      expect(c0.y).toBe(15); // border-top(5) + padding-top(10)
    });

    it('should work with position: relative on flex items', () => {
      const { doc, tree } = buildDoc(
        '<html><body><div id="flex"><div id="c0"></div></div></body></html>'
      );
      applyStyles(tree, doc.bodyElement!, { display: 'block', margin: '0' });
      applyStyles(tree, tree.getElementById('flex')!, {
        display: 'flex', margin: '0', 'flex-direction': 'row',
      });
      applyStyles(tree, tree.getElementById('c0')!, {
        display: 'block', margin: '0', width: '100', height: '50',
        position: 'relative', top: '10', left: '20',
      });
      const engine = new LayoutEngine({ viewportWidth: 1000, viewportHeight: 800, defaultFontSize: 16 });
      engine.layout(doc, tree);
      const c0 = tree.getElementById('c0')!.layoutBox!;
      expect(c0.x).toBe(20);
      expect(c0.y).toBe(10);
    });
  });

  // ── column gap with flex items ────────────────────────────────────────

  describe('gap with justify-content', () => {
    it('should combine gap with space-between', () => {
      const { doc, tree } = buildDoc(
        '<html><body><div id="flex"><div id="c0"></div><div id="c1"></div></div></body></html>'
      );
      applyStyles(tree, doc.bodyElement!, { display: 'block', margin: '0' });
      applyStyles(tree, tree.getElementById('flex')!, {
        display: 'flex', margin: '0', 'flex-direction': 'row',
        'justify-content': 'space-between', gap: '20',
      });
      applyStyles(tree, tree.getElementById('c0')!, { display: 'block', margin: '0', width: '100', height: '50' });
      applyStyles(tree, tree.getElementById('c1')!, { display: 'block', margin: '0', width: '100', height: '50' });
      const engine = new LayoutEngine({ viewportWidth: 1000, viewportHeight: 800, defaultFontSize: 16 });
      engine.layout(doc, tree);
      const c0 = tree.getElementById('c0')!.layoutBox!;
      const c1 = tree.getElementById('c1')!.layoutBox!;
      // With space-between: first item at 0, last at 900
      expect(c0.x).toBe(0);
      expect(c1.x).toBe(900);
    });
  });
});
