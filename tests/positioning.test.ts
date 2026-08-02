import { describe, it, expect } from 'vitest';
import { HtmlParser } from '../src/browser/rendering/html-parser';
import { DomTree } from '../src/browser/rendering/dom-tree';
import type { DomDocument, DomElement, LayoutBox } from '../src/browser/rendering/dom-tree';
import { LayoutEngine } from '../src/browser/rendering/layout-engine';
import {
  getPositionScheme,
  isPositioned,
  parseLength,
  findContainingBlock,
  applyInFlowOffset,
  resolveOutOfFlow,
  StickyController,
  getStackingLevel,
} from '../src/browser/rendering/positioning';

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

function layoutDoc(doc: DomDocument, tree: DomTree, vpW = 1000, vpH = 800): LayoutEngine {
  const engine = new LayoutEngine({ viewportWidth: vpW, viewportHeight: vpH, defaultFontSize: 16 });
  engine.layout(doc, tree);
  return engine;
}

// ─────────────────────────────────────────────────────────────────────────────
// PURE FUNCTION TESTS (positioning.ts)
// ─────────────────────────────────────────────────────────────────────────────

describe('positioning.ts — pure functions', () => {
  describe('getPositionScheme', () => {
    it('returns static for empty/missing style', () => {
      expect(getPositionScheme(new Map())).toBe('static');
    });
    it('returns correct schemes', () => {
      expect(getPositionScheme(new Map([['position', 'relative']]))).toBe('relative');
      expect(getPositionScheme(new Map([['position', 'absolute']]))).toBe('absolute');
      expect(getPositionScheme(new Map([['position', 'fixed']]))).toBe('fixed');
      expect(getPositionScheme(new Map([['position', 'sticky']]))).toBe('sticky');
      expect(getPositionScheme(new Map([['position', 'static']]))).toBe('static');
      expect(getPositionScheme(new Map([['position', 'banana']]))).toBe('static');
    });
  });

  describe('isPositioned', () => {
    it('returns true for non-static positions', () => {
      expect(isPositioned(new Map([['position', 'relative']]))).toBe(true);
      expect(isPositioned(new Map([['position', 'absolute']]))).toBe(true);
      expect(isPositioned(new Map([['position', 'fixed']]))).toBe(true);
      expect(isPositioned(new Map([['position', 'sticky']]))).toBe(true);
    });
    it('returns false for static', () => {
      expect(isPositioned(new Map())).toBe(false);
      expect(isPositioned(new Map([['position', 'static']]))).toBe(false);
    });
  });

  describe('parseLength', () => {
    it('returns auto for undefined/empty', () => {
      expect(parseLength(undefined, 16, 100)).toEqual({ kind: 'auto', value: 0 });
      expect(parseLength('', 16, 100)).toEqual({ kind: 'auto', value: 0 });
      expect(parseLength('auto', 16, 100)).toEqual({ kind: 'auto', value: 0 });
    });
    it('parses px values', () => {
      expect(parseLength('10px', 16, 100)).toEqual({ kind: 'px', value: 10 });
      expect(parseLength('0px', 16, 100)).toEqual({ kind: 'px', value: 0 });
      expect(parseLength('-5px', 16, 100)).toEqual({ kind: 'px', value: -5 });
    });
    it('parses percent values', () => {
      const r = parseLength('50%', 16, 200);
      expect(r.kind).toBe('percent');
      expect(r.value).toBe(50);
    });
    it('parses em values relative to font size', () => {
      const r = parseLength('2em', 20, 100);
      expect(r.kind).toBe('px');
      expect(r.value).toBe(40);
    });
    it('parses plain numbers as px', () => {
      expect(parseLength('42', 16, 100)).toEqual({ kind: 'px', value: 42 });
    });
    it('returns auto for non-numeric strings', () => {
      expect(parseLength('banana', 16, 100)).toEqual({ kind: 'auto', value: 0 });
    });
  });

  describe('getStackingLevel', () => {
    it('returns 0 for static', () => {
      expect(getStackingLevel(new Map(), 'static')).toBe(0);
    });
    it('returns 1000 + zIndex for positioned', () => {
      expect(getStackingLevel(new Map([['z-index', '5']]), 'absolute')).toBe(1005);
      expect(getStackingLevel(new Map([['z-index', '-3']]), 'relative')).toBe(997);
      expect(getStackingLevel(new Map([['z-index', '0']]), 'fixed')).toBe(1000);
    });
    it('auto z-index treated as 0 for positioned', () => {
      expect(getStackingLevel(new Map(), 'absolute')).toBe(1000);
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// LAYOUT ENGINE INTEGRATION TESTS
// ─────────────────────────────────────────────────────────────────────────────

describe('LayoutEngine — positioning', () => {

  describe('position: static (default)', () => {
    it('static elements follow normal flow', () => {
      const { doc, tree } = buildDoc('<html><body><div id="a"></div><div id="b"></div></body></html>');
      applyStyles(tree, doc.bodyElement!, { display: 'block', margin: '0' });
      const a = tree.getElementById('a')!;
      const b = tree.getElementById('b')!;
      applyStyles(tree, a, { display: 'block', height: '50px', margin: '0' });
      applyStyles(tree, b, { display: 'block', height: '30px', margin: '0' });
      const engine = layoutDoc(doc, tree);
      expect(a.layoutBox!.y).toBe(0);
      expect(b.layoutBox!.y).toBe(50);
    });
  });

  describe('position: relative', () => {
    it('offsets element from flow position without affecting siblings', () => {
      const { doc, tree } = buildDoc('<html><body><div id="a"></div><div id="b"></div></body></html>');
      applyStyles(tree, doc.bodyElement!, { display: 'block', margin: '0' });
      const a = tree.getElementById('a')!;
      const b = tree.getElementById('b')!;
      applyStyles(tree, a, { display: 'block', height: '50px', margin: '0', position: 'relative', top: '10px', left: '20px' });
      applyStyles(tree, b, { display: 'block', height: '30px', margin: '0' });
      layoutDoc(doc, tree);
      // a is offset by top:10, left:20 from its flow position
      expect(a.layoutBox!.x).toBe(20);
      expect(a.layoutBox!.y).toBe(10);
      // b stays at its normal flow position (sibling not displaced)
      expect(b.layoutBox!.y).toBe(50);
    });

    it('supports bottom and right offsets', () => {
      const { doc, tree } = buildDoc('<html><body><div id="a"></div></body></html>');
      applyStyles(tree, doc.bodyElement!, { display: 'block', margin: '0' });
      const a = tree.getElementById('a')!;
      applyStyles(tree, a, { display: 'block', height: '50px', margin: '0', position: 'relative', bottom: '5px', right: '10px' });
      layoutDoc(doc, tree);
      // bottom:5 → dy = -5, right:10 → dx = -10
      expect(a.layoutBox!.x).toBe(-10);
      expect(a.layoutBox!.y).toBe(-5);
    });

    it('top wins over bottom when both set', () => {
      const { doc, tree } = buildDoc('<html><body><div id="a"></div></body></html>');
      applyStyles(tree, doc.bodyElement!, { display: 'block', margin: '0' });
      const a = tree.getElementById('a')!;
      applyStyles(tree, a, { display: 'block', height: '50px', margin: '0', position: 'relative', top: '10px', bottom: '5px' });
      layoutDoc(doc, tree);
      expect(a.layoutBox!.y).toBe(10);
    });
  });

  describe('position: absolute', () => {
    it('removed from normal flow — siblings fill its space', () => {
      const { doc, tree } = buildDoc('<html><body><div id="a"></div><div id="b"></div></body></html>');
      applyStyles(tree, doc.bodyElement!, { display: 'block', margin: '0' });
      const a = tree.getElementById('a')!;
      const b = tree.getElementById('b')!;
      applyStyles(tree, a, { display: 'block', height: '50px', margin: '0', position: 'absolute' });
      applyStyles(tree, b, { display: 'block', height: '30px', margin: '0' });
      layoutDoc(doc, tree);
      // b should be at y=0 since a is removed from flow
      expect(b.layoutBox!.y).toBe(0);
      expect(b.layoutBox!.height).toBe(30);
    });

    it('top + left positions relative to containing block padding box', () => {
      const { doc, tree } = buildDoc('<html><body><div id="p"><div id="a"></div></div></body></html>');
      applyStyles(tree, doc.bodyElement!, { display: 'block', margin: '0' });
      const p = tree.getElementById('p')!;
      const a = tree.getElementById('a')!;
      applyStyles(tree, p, { display: 'block', margin: '0', padding: '20px', 'border-top-width': '5px', 'border-right-width': '5px', 'border-bottom-width': '5px', 'border-left-width': '5px', position: 'relative' });
      applyStyles(tree, a, { display: 'block', width: '100px', height: '50px', position: 'absolute', top: '10px', left: '15px' });
      layoutDoc(doc, tree);
      // containing block padding box starts at x=5+20=25, y=5+20=25
      expect(a.layoutBox!.x).toBe(25 + 15); // cb padding left + left
      expect(a.layoutBox!.y).toBe(25 + 10); // cb padding top + top
    });

    it('right positions from right edge of containing block', () => {
      const { doc, tree } = buildDoc('<html><body><div id="p"><div id="a"></div></div></body></html>');
      applyStyles(tree, doc.bodyElement!, { display: 'block', margin: '0' });
      const p = tree.getElementById('p')!;
      const a = tree.getElementById('a')!;
      applyStyles(tree, p, { display: 'block', margin: '0', position: 'relative' });
      applyStyles(tree, a, { display: 'block', width: '100px', height: '50px', position: 'absolute', right: '0px' });
      layoutDoc(doc, tree);
      // auto left + right set → x = cbWidth - right - width = 1000 - 0 - 100 = 900
      expect(a.layoutBox!.x).toBe(900);
    });

    it('falls back to viewport when no positioned ancestor', () => {
      const { doc, tree } = buildDoc('<html><body><div id="a"></div></body></html>');
      applyStyles(tree, doc.bodyElement!, { display: 'block', margin: '0' });
      const a = tree.getElementById('a')!;
      applyStyles(tree, a, { display: 'block', width: '100px', height: '50px', position: 'absolute', top: '5px', left: '10px' });
      layoutDoc(doc, tree);
      expect(a.layoutBox!.x).toBe(10);
      expect(a.layoutBox!.y).toBe(5);
    });

    it('auto width stretches when both left and right set', () => {
      const { doc, tree } = buildDoc('<html><body><div id="p"><div id="a"></div></div></body></html>');
      applyStyles(tree, doc.bodyElement!, { display: 'block', margin: '0' });
      const p = tree.getElementById('p')!;
      const a = tree.getElementById('a')!;
      applyStyles(tree, p, { display: 'block', margin: '0', padding: '10px', position: 'relative' });
      applyStyles(tree, a, { display: 'block', height: '50px', position: 'absolute', top: '0px', left: '0px', right: '0px' });
      layoutDoc(doc, tree);
      // cbWidth = 1000 - 0 - 0 - 10 - 10 = 980; width = 980 - 0 - 0 = 980
      expect(a.layoutBox!.width).toBe(980);
    });

    it('auto height stretches when both top and bottom set', () => {
      const { doc, tree } = buildDoc('<html><body><div id="p"><div id="a"></div></div></body></html>');
      applyStyles(tree, doc.bodyElement!, { display: 'block', margin: '0' });
      const p = tree.getElementById('p')!;
      const a = tree.getElementById('a')!;
      applyStyles(tree, p, { display: 'block', height: '500px', margin: '0', padding: '10px', position: 'relative', 'box-sizing': 'border-box' });
      applyStyles(tree, a, { display: 'block', width: '100px', position: 'absolute', top: '0px', bottom: '0px', left: '0px' });
      layoutDoc(doc, tree);
      // border-box: p border-box = 500; padding box = 500 - 0 - 0 - 10 - 10 = 480; a height = 480 - 0 - 0 = 480
      expect(a.layoutBox!.height).toBe(480);
    });

    it('nested absolute finds nearest positioned ancestor', () => {
      const { doc, tree } = buildDoc('<html><body><div id="outer"><div id="mid"><div id="inner"></div></div></div></body></html>');
      applyStyles(tree, doc.bodyElement!, { display: 'block', margin: '0' });
      const outer = tree.getElementById('outer')!;
      const mid = tree.getElementById('mid')!;
      const inner = tree.getElementById('inner')!;
      applyStyles(tree, outer, { display: 'block', margin: '0', padding: '20px', position: 'relative' });
      applyStyles(tree, mid, { display: 'block', margin: '0', padding: '10px' });
      applyStyles(tree, inner, { display: 'block', width: '50px', height: '50px', position: 'absolute', top: '0px', left: '0px' });
      layoutDoc(doc, tree);
      // inner's containing block is outer (not mid, which is static)
      // outer's padding box: x=0+20=20, y=0+20=20
      expect(inner.layoutBox!.x).toBe(20);
      expect(inner.layoutBox!.y).toBe(20);
    });
  });

  describe('position: fixed', () => {
    it('positions relative to viewport', () => {
      const { doc, tree } = buildDoc('<html><body><div id="p"><div id="a"></div></div></body></html>');
      applyStyles(tree, doc.bodyElement!, { display: 'block', margin: '0' });
      const p = tree.getElementById('p')!;
      const a = tree.getElementById('a')!;
      applyStyles(tree, p, { display: 'block', margin: '100px', position: 'relative' });
      applyStyles(tree, a, { display: 'block', width: '80px', height: '40px', position: 'fixed', top: '10px', left: '20px' });
      layoutDoc(doc, tree);
      // fixed elements ignore containing block, position relative to viewport
      expect(a.layoutBox!.x).toBe(20);
      expect(a.layoutBox!.y).toBe(10);
    });

    it('fixed element is removed from flow', () => {
      const { doc, tree } = buildDoc('<html><body><div id="a"></div><div id="b"></div></body></html>');
      applyStyles(tree, doc.bodyElement!, { display: 'block', margin: '0' });
      const a = tree.getElementById('a')!;
      const b = tree.getElementById('b')!;
      applyStyles(tree, a, { display: 'block', height: '100px', position: 'fixed' });
      applyStyles(tree, b, { display: 'block', height: '50px' });
      layoutDoc(doc, tree);
      // b at y=0 since a is removed
      expect(b.layoutBox!.y).toBe(0);
    });
  });

  describe('auto margins — centering', () => {
    it('centers horizontally when left and right auto with auto width', () => {
      const { doc, tree } = buildDoc('<html><body><div id="a"></div></body></html>');
      applyStyles(tree, doc.bodyElement!, { display: 'block', margin: '0' });
      const a = tree.getElementById('a')!;
      applyStyles(tree, a, { display: 'block', height: '50px', position: 'absolute' });
      layoutDoc(doc, tree, 1000, 800);
      // auto width defaults to availableWidth (1000), centered
      // remaining = 1000 - 1000 = 0, halfMargin = 0
      expect(a.layoutBox!.x).toBe(0);
    });

    it('pushes to right when only left is auto', () => {
      const { doc, tree } = buildDoc('<html><body><div id="a"></div></body></html>');
      applyStyles(tree, doc.bodyElement!, { display: 'block', margin: '0' });
      const a = tree.getElementById('a')!;
      applyStyles(tree, a, { display: 'block', width: '200px', height: '50px', position: 'absolute', right: '0px' });
      layoutDoc(doc, tree);
      // left auto + right=0 → x = cbW - width - marginRight = 1000 - 200 = 800
      expect(a.layoutBox!.x).toBe(800);
    });
  });

  describe('containing block resolution', () => {
    it('absolute inside static falls through to nearest positioned ancestor', () => {
      const { doc, tree } = buildDoc(
        '<html><body><div id="a"><div id="b"><div id="c"></div></div></div></body></html>'
      );
      applyStyles(tree, doc.bodyElement!, { display: 'block', margin: '0' });
      const a = tree.getElementById('a')!;
      const b = tree.getElementById('b')!;
      const c = tree.getElementById('c')!;
      applyStyles(tree, a, { display: 'block', margin: '0', padding: '30px', position: 'relative' });
      applyStyles(tree, b, { display: 'block', margin: '0', padding: '10px' }); // static
      applyStyles(tree, c, { display: 'block', width: '50px', height: '50px', position: 'absolute', top: '0', left: '0' });
      layoutDoc(doc, tree);
      // c's containing block is a (b is static)
      // a's padding box starts at (30, 30)
      expect(c.layoutBox!.x).toBe(30);
      expect(c.layoutBox!.y).toBe(30);
    });
  });

  describe('width resolution for positioned elements', () => {
    it('explicit width with content-box', () => {
      const { doc, tree } = buildDoc('<html><body><div id="a"></div></body></html>');
      applyStyles(tree, doc.bodyElement!, { display: 'block', margin: '0' });
      const a = tree.getElementById('a')!;
      applyStyles(tree, a, {
        display: 'block', position: 'absolute', width: '200px', height: '50px',
        padding: '10px', 'border-top-width': '2px', 'border-right-width': '2px',
        'border-bottom-width': '2px', 'border-left-width': '2px', margin: '0',
      });
      layoutDoc(doc, tree);
      // content-box: borderWidthBox = 200 + 10 + 10 + 2 + 2 = 224
      expect(a.layoutBox!.width).toBe(224);
    });

    it('explicit width with border-box', () => {
      const { doc, tree } = buildDoc('<html><body><div id="a"></div></body></html>');
      applyStyles(tree, doc.bodyElement!, { display: 'block', margin: '0' });
      const a = tree.getElementById('a')!;
      applyStyles(tree, a, {
        display: 'block', position: 'absolute', width: '200px', height: '50px',
        'box-sizing': 'border-box', padding: '10px', 'border-top-width': '2px',
        'border-right-width': '2px', 'border-bottom-width': '2px', 'border-left-width': '2px', margin: '0',
      });
      layoutDoc(doc, tree);
      // border-box: borderWidthBox = 200
      expect(a.layoutBox!.width).toBe(200);
    });
  });

  describe('z-index / stacking', () => {
    it('stacking level is 1000 + zIndex for positioned elements', () => {
      const { doc, tree } = buildDoc('<html><body><div id="a"></div></body></html>');
      applyStyles(tree, doc.bodyElement!, { display: 'block', margin: '0' });
      const a = tree.getElementById('a')!;
      applyStyles(tree, a, { display: 'block', width: '50px', height: '50px', position: 'absolute', 'z-index': '5' });
      layoutDoc(doc, tree);
      expect(getStackingLevel(a.computedStyle!, 'absolute')).toBe(1005);
    });

    it('stacking level is 0 for static', () => {
      expect(getStackingLevel(new Map(), 'static')).toBe(0);
    });
  });

  describe('mixed flow — absolute between static siblings', () => {
    it('absolute child does not push siblings down', () => {
      const { doc, tree } = buildDoc(
        '<html><body><div id="a"></div><div id="abs"></div><div id="b"></div></body></html>'
      );
      applyStyles(tree, doc.bodyElement!, { display: 'block', margin: '0' });
      const a = tree.getElementById('a')!;
      const abs = tree.getElementById('abs')!;
      const b = tree.getElementById('b')!;
      applyStyles(tree, a, { display: 'block', height: '100px', margin: '0' });
      applyStyles(tree, abs, { display: 'block', height: '60px', margin: '0', position: 'absolute', top: '10px' });
      applyStyles(tree, b, { display: 'block', height: '40px', margin: '0' });
      layoutDoc(doc, tree);
      expect(a.layoutBox!.y).toBe(0);
      expect(b.layoutBox!.y).toBe(100); // right after a, abs didn't push b
    });
  });

  describe('absolute with margins', () => {
    it('adds margin to positioned offset', () => {
      const { doc, tree } = buildDoc('<html><body><div id="a"></div></body></html>');
      applyStyles(tree, doc.bodyElement!, { display: 'block', margin: '0' });
      const a = tree.getElementById('a')!;
      applyStyles(tree, a, {
        display: 'block', width: '100px', height: '50px',
        position: 'absolute', top: '10px', left: '20px',
        margin: '5px',
      });
      layoutDoc(doc, tree);
      // x = cbX(0) + left(20) + marginLeft(5) = 25
      // y = cbY(0) + top(10) + marginTop(5) = 15
      expect(a.layoutBox!.x).toBe(25);
      expect(a.layoutBox!.y).toBe(15);
    });
  });

  describe('position: absolute inside relative with padding and border', () => {
    it('padding and border of containing block are excluded from offset', () => {
      const { doc, tree } = buildDoc('<html><body><div id="p"><div id="c"></div></div></body></html>');
      applyStyles(tree, doc.bodyElement!, { display: 'block', margin: '0' });
      const p = tree.getElementById('p')!;
      const c = tree.getElementById('c')!;
      applyStyles(tree, p, {
        display: 'block', margin: '0', padding: '15px',
        'border-top-width': '5px', 'border-right-width': '5px',
        'border-bottom-width': '5px', 'border-left-width': '5px',
        position: 'relative', height: '200px',
      });
      applyStyles(tree, c, { display: 'block', width: '50px', height: '50px', position: 'absolute', top: '0', left: '0' });
      layoutDoc(doc, tree);
      // padding box of p starts at x=5+15=20, y=5+15=20
      expect(c.layoutBox!.x).toBe(20);
      expect(c.layoutBox!.y).toBe(20);
    });
  });

  describe('absolute without explicit width', () => {
    it('auto width defaults to available width minus insets', () => {
      const { doc, tree } = buildDoc('<html><body><div id="a"></div></body></html>');
      applyStyles(tree, doc.bodyElement!, { display: 'block', margin: '0' });
      const a = tree.getElementById('a')!;
      applyStyles(tree, a, {
        display: 'block', height: '50px',
        position: 'absolute', left: '50px', right: '50px',
      });
      layoutDoc(doc, tree);
      // auto width, left+right set → cbWidth(1000) - left(50) - right(50) - margins(0) = 900
      expect(a.layoutBox!.width).toBe(900);
      expect(a.layoutBox!.x).toBe(50);
    });
  });

  describe('sticky positioning', () => {
    function makeStickyFixture() {
      const { tree } = buildDoc('<html><body><div id="sc"><div id="a"></div></body></html>');
      const sc = tree.getElementById('sc')!;
      const a = tree.getElementById('a')!;
      sc.layoutBox = { x: 0, y: 0, width: 1000, height: 800, borderTop: 0, borderBottom: 0, paddingTop: 0, paddingBottom: 0 } as LayoutBox;
      a.layoutBox = { x: 0, y: 0, width: 100, height: 50, borderTop: 0, borderBottom: 0, paddingTop: 0, paddingBottom: 0 } as LayoutBox;
      return { tree, sc, a };
    }

    it('resolves top offset from the element font-size (em)', () => {
      const { tree, sc, a } = makeStickyFixture();
      applyStyles(tree, a, { position: 'sticky', top: '2em', 'font-size': '10px' });

      const controller = new StickyController();
      controller.register({
        node: a,
        box: a.layoutBox!,
        scrollContainer: sc,
        flowRectInScrollContainer: { x: 0, y: 100, width: 100, height: 50 },
      });

      controller.recompute(sc, 300, 0);
      // font-size 10px → 2em = 20px; stuckY = 300 + 20 = 320
      expect(a.layoutBox!.y).toBe(320);
    });

    it('stays at flow position when scroll has not reached the threshold', () => {
      const { tree, sc, a } = makeStickyFixture();
      applyStyles(tree, a, { position: 'sticky', top: '10px', 'font-size': '16px' });

      const controller = new StickyController();
      controller.register({
        node: a,
        box: a.layoutBox!,
        scrollContainer: sc,
        flowRectInScrollContainer: { x: 0, y: 100, width: 100, height: 50 },
      });

      controller.recompute(sc, 0, 0);
      // stuckY = 0 + 10 = 10 < flow y (100) → stays at 100
      expect(a.layoutBox!.y).toBe(100);
    });
  });
});
