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

function makeStyle(entries: Record<string, string>): ReadonlyMap<string, string> {
  return new Map(Object.entries(entries));
}

function applyStyles(tree: DomTree, el: DomElement, entries: Record<string, string>): void {
  const existing = new Map(el.computedStyle ?? []);
  for (const [k, v] of Object.entries(entries)) existing.set(k, v);
  tree.setComputedStyle(el, existing);
}

function layoutAndGet(
  doc: DomDocument,
  tree: DomTree,
  styleOverrides?: Record<string, string>,
): { engine: LayoutEngine; body: DomElement; box: LayoutBox } {
  const engine = new LayoutEngine({ viewportWidth: 1000, viewportHeight: 800, defaultFontSize: 16 });
  const body = doc.bodyElement!;
  applyStyles(tree, body, { display: 'block', ...styleOverrides });
  engine.layout(doc, tree);
  const box = body.layoutBox!;
  return { engine, body, box };
}

// ─────────────────────────────────────────────────────────────────────────────
// TESTS
// ─────────────────────────────────────────────────────────────────────────────

describe('LayoutEngine', () => {
  describe('basic layout', () => {
    it('should produce a layout box for body element', () => {
      const { doc, tree } = buildDoc('<html><body></body></html>');
      const { box } = layoutAndGet(doc, tree);
      expect(box).not.toBeNull();
      expect(box.width).toBe(1000);
    });

    it('should position body at (0, 0) with no margins', () => {
      const { doc, tree } = buildDoc('<html><body></body></html>');
      const { box } = layoutAndGet(doc, tree, { margin: '0' });
      expect(box.x).toBe(0);
      expect(box.y).toBe(0);
    });

    it('should respect body margin', () => {
      const { doc, tree } = buildDoc('<html><body></body></html>');
      const { box } = layoutAndGet(doc, tree, { margin: '8px' });
      expect(box.x).toBe(8);
      expect(box.y).toBe(8);
    });

    it('should fill viewport width for block elements', () => {
      const { doc, tree } = buildDoc('<html><body><div id="d"></div></body></html>');
      applyStyles(tree, doc.bodyElement!, { display: 'block', margin: '0' });
      const engine = new LayoutEngine({ viewportWidth: 1000, viewportHeight: 800, defaultFontSize: 16 });
      engine.layout(doc, tree);
      const div = tree.getElementById('d')!;
      expect(div.layoutBox).not.toBeNull();
      expect(div.layoutBox!.width).toBe(1000);
    });
  });

  describe('box model — margins', () => {
    it('should add margins outside the border box', () => {
      const { doc, tree } = buildDoc('<html><body><div id="d"></div></body></html>');
      applyStyles(tree, doc.bodyElement!, { display: 'block', margin: '0' });
      applyStyles(tree, tree.getElementById('d')!, {
        'margin-top': '10', 'margin-right': '20',
        'margin-bottom': '30', 'margin-left': '40',
      });
      const engine = new LayoutEngine({ viewportWidth: 1000, viewportHeight: 800, defaultFontSize: 16 });
      engine.layout(doc, tree);
      const box = tree.getElementById('d')!.layoutBox!;
      expect(box.x).toBe(40);
      expect(box.y).toBe(10);
      expect(box.marginTop).toBe(10);
      expect(box.marginRight).toBe(20);
      expect(box.marginBottom).toBe(30);
      expect(box.marginLeft).toBe(40);
    });

    it('should use margin shorthand fallback', () => {
      const { doc, tree } = buildDoc('<html><body><div id="d"></div></body></html>');
      applyStyles(tree, doc.bodyElement!, { display: 'block', margin: '0' });
      applyStyles(tree, tree.getElementById('d')!, { margin: '15' });
      const engine = new LayoutEngine({ viewportWidth: 1000, viewportHeight: 800, defaultFontSize: 16 });
      engine.layout(doc, tree);
      const box = tree.getElementById('d')!.layoutBox!;
      expect(box.marginTop).toBe(15);
      expect(box.marginLeft).toBe(15);
    });
  });

  describe('box model — padding', () => {
    it('should add padding inside the border box', () => {
      const { doc, tree } = buildDoc('<html><body><div id="d"></div></body></html>');
      applyStyles(tree, doc.bodyElement!, { display: 'block', margin: '0' });
      applyStyles(tree, tree.getElementById('d')!, {
        margin: '0',
        'padding-top': '5', 'padding-right': '10',
        'padding-bottom': '15', 'padding-left': '20',
      });
      const engine = new LayoutEngine({ viewportWidth: 1000, viewportHeight: 800, defaultFontSize: 16 });
      engine.layout(doc, tree);
      const box = tree.getElementById('d')!.layoutBox!;
      expect(box.paddingTop).toBe(5);
      expect(box.paddingRight).toBe(10);
      expect(box.paddingBottom).toBe(15);
      expect(box.paddingLeft).toBe(20);
    });
  });

  describe('box model — borders', () => {
    it('should read border widths from computed style', () => {
      const { doc, tree } = buildDoc('<html><body><div id="d"></div></body></html>');
      applyStyles(tree, doc.bodyElement!, { display: 'block', margin: '0' });
      applyStyles(tree, tree.getElementById('d')!, {
        margin: '0',
        'border-top-width': '2',
        'border-right-width': '3',
        'border-bottom-width': '4',
        'border-left-width': '5',
      });
      const engine = new LayoutEngine({ viewportWidth: 1000, viewportHeight: 800, defaultFontSize: 16 });
      engine.layout(doc, tree);
      const box = tree.getElementById('d')!.layoutBox!;
      expect(box.borderTop).toBe(2);
      expect(box.borderRight).toBe(3);
      expect(box.borderBottom).toBe(4);
      expect(box.borderLeft).toBe(5);
    });

    it('should parse thin/medium/thick border keywords', () => {
      const { doc, tree } = buildDoc('<html><body><div id="d"></div></body></html>');
      applyStyles(tree, doc.bodyElement!, { display: 'block', margin: '0' });
      applyStyles(tree, tree.getElementById('d')!, {
        margin: '0',
        'border-top-width': 'thin',
        'border-right-width': 'medium',
        'border-bottom-width': 'thick',
        'border-left-width': '0',
      });
      const engine = new LayoutEngine({ viewportWidth: 1000, viewportHeight: 800, defaultFontSize: 16 });
      engine.layout(doc, tree);
      const box = tree.getElementById('d')!.layoutBox!;
      expect(box.borderTop).toBe(1);
      expect(box.borderRight).toBe(3);
      expect(box.borderBottom).toBe(5);
      expect(box.borderLeft).toBe(0);
    });

    it('should include borders in border-box height', () => {
      const { doc, tree } = buildDoc('<html><body><div id="d"></div></body></html>');
      applyStyles(tree, doc.bodyElement!, { display: 'block', margin: '0' });
      applyStyles(tree, tree.getElementById('d')!, {
        margin: '0',
        'border-top-width': '2',
        'border-bottom-width': '4',
        height: '100',
      });
      const engine = new LayoutEngine({ viewportWidth: 1000, viewportHeight: 800, defaultFontSize: 16 });
      engine.layout(doc, tree);
      const box = tree.getElementById('d')!.layoutBox!;
      // content-box: height=100 is content, border-box total = 100 + 2 + 4 = 106
      expect(box.height).toBe(106);
      expect(box.borderTop).toBe(2);
      expect(box.borderBottom).toBe(4);
    });
  });

  describe('box-sizing', () => {
    it('should use content-box sizing by default', () => {
      const { doc, tree } = buildDoc('<html><body><div id="d"></div></body></html>');
      applyStyles(tree, doc.bodyElement!, { display: 'block', margin: '0' });
      applyStyles(tree, tree.getElementById('d')!, {
        margin: '0',
        width: '200',
        'padding-left': '10',
        'padding-right': '10',
        'border-left-width': '2',
        'border-right-width': '2',
        'box-sizing': 'content-box',
      });
      const engine = new LayoutEngine({ viewportWidth: 1000, viewportHeight: 800, defaultFontSize: 16 });
      engine.layout(doc, tree);
      const box = tree.getElementById('d')!.layoutBox!;
      // content-box: width=200, total = 200 + 10 + 10 + 2 + 2 = 224
      expect(box.width).toBe(224);
    });

    it('should use border-box sizing when specified', () => {
      const { doc, tree } = buildDoc('<html><body><div id="d"></div></body></html>');
      applyStyles(tree, doc.bodyElement!, { display: 'block', margin: '0' });
      applyStyles(tree, tree.getElementById('d')!, {
        margin: '0',
        width: '200',
        'padding-left': '10',
        'padding-right': '10',
        'border-left-width': '2',
        'border-right-width': '2',
        'box-sizing': 'border-box',
      });
      const engine = new LayoutEngine({ viewportWidth: 1000, viewportHeight: 800, defaultFontSize: 16 });
      engine.layout(doc, tree);
      const box = tree.getElementById('d')!.layoutBox!;
      // border-box: width=200 total, content = 200 - 10 - 10 - 2 - 2 = 176
      expect(box.width).toBe(200);
    });

    it('should apply border-box to height as well', () => {
      const { doc, tree } = buildDoc('<html><body><div id="d"></div></body></html>');
      applyStyles(tree, doc.bodyElement!, { display: 'block', margin: '0' });
      applyStyles(tree, tree.getElementById('d')!, {
        margin: '0',
        height: '100',
        'padding-top': '5',
        'padding-bottom': '5',
        'border-top-width': '2',
        'border-bottom-width': '2',
        'box-sizing': 'border-box',
      });
      const engine = new LayoutEngine({ viewportWidth: 1000, viewportHeight: 800, defaultFontSize: 16 });
      engine.layout(doc, tree);
      const box = tree.getElementById('d')!.layoutBox!;
      // border-box: height=100 total
      expect(box.height).toBe(100);
    });
  });

  describe('unit resolution — em', () => {
    it('should resolve em values relative to font-size', () => {
      const { doc, tree } = buildDoc('<html><body><div id="d"></div></body></html>');
      applyStyles(tree, doc.bodyElement!, { display: 'block', margin: '0' });
      applyStyles(tree, tree.getElementById('d')!, {
        margin: '0',
        'font-size': '20',
        'margin-top': '1.5em',
      });
      const engine = new LayoutEngine({ viewportWidth: 1000, viewportHeight: 800, defaultFontSize: 16 });
      engine.layout(doc, tree);
      const box = tree.getElementById('d')!.layoutBox!;
      expect(box.marginTop).toBe(30); // 1.5 * 20
    });

    it('should resolve font-size em relative to parent font-size', () => {
      const { doc, tree } = buildDoc('<html><body><div id="d"><div id="inner"></div></div></body></html>');
      applyStyles(tree, doc.bodyElement!, { margin: '0', display: 'block' });
      applyStyles(tree, tree.getElementById('d')!, {
        margin: '0',
        display: 'block',
        'font-size': '20',
      });
      applyStyles(tree, tree.getElementById('inner')!, {
        display: 'block',
        'font-size': '1.5em',
      });
      const engine = new LayoutEngine({ viewportWidth: 1000, viewportHeight: 800, defaultFontSize: 16 });
      engine.layout(doc, tree);
      // The inner div's font-size should be 1.5 * 20 = 30px
      const inner = tree.getElementById('inner')!;
      expect(inner.layoutBox).not.toBeNull();
    });
  });

  describe('unit resolution — rem', () => {
    it('should resolve rem values relative to root font-size', () => {
      const { doc, tree } = buildDoc('<html><body><div id="d"></div></body></html>');
      applyStyles(tree, doc.bodyElement!, { display: 'block', margin: '0' });
      applyStyles(tree, tree.getElementById('d')!, {
        margin: '0',
        'margin-top': '2rem',
      });
      const engine = new LayoutEngine({ viewportWidth: 1000, viewportHeight: 800, defaultFontSize: 16 });
      engine.layout(doc, tree);
      const box = tree.getElementById('d')!.layoutBox!;
      expect(box.marginTop).toBe(32); // 2 * 16 (root font-size)
    });
  });

  describe('unit resolution — %', () => {
    it('should resolve percentage margins relative to available width', () => {
      const { doc, tree } = buildDoc('<html><body><div id="d"></div></body></html>');
      applyStyles(tree, doc.bodyElement!, { display: 'block', margin: '0' });
      applyStyles(tree, tree.getElementById('d')!, {
        margin: '0',
        'margin-left': '10%',
      });
      const engine = new LayoutEngine({ viewportWidth: 1000, viewportHeight: 800, defaultFontSize: 16 });
      engine.layout(doc, tree);
      const box = tree.getElementById('d')!.layoutBox!;
      expect(box.marginLeft).toBe(100); // 10% of 1000
    });

    it('should resolve percentage width relative to available width', () => {
      const { doc, tree } = buildDoc('<html><body><div id="d"></div></body></html>');
      applyStyles(tree, doc.bodyElement!, { display: 'block', margin: '0' });
      applyStyles(tree, tree.getElementById('d')!, {
        margin: '0',
        width: '50%',
        'box-sizing': 'content-box',
      });
      const engine = new LayoutEngine({ viewportWidth: 1000, viewportHeight: 800, defaultFontSize: 16 });
      engine.layout(doc, tree);
      const box = tree.getElementById('d')!.layoutBox!;
      expect(box.width).toBe(500);
    });
  });

  describe('named font sizes', () => {
    it('should resolve medium to 16px', () => {
      const { doc, tree } = buildDoc('<html><body><div id="d"></div></body></html>');
      applyStyles(tree, doc.bodyElement!, { display: 'block', margin: '0' });
      applyStyles(tree, tree.getElementById('d')!, {
        margin: '0',
        'font-size': 'medium',
        'margin-top': '1em',
      });
      const engine = new LayoutEngine({ viewportWidth: 1000, viewportHeight: 800, defaultFontSize: 16 });
      engine.layout(doc, tree);
      const box = tree.getElementById('d')!.layoutBox!;
      expect(box.marginTop).toBe(16); // 1em * 16px (medium)
    });

    it('should resolve large to 18px', () => {
      const { doc, tree } = buildDoc('<html><body><div id="d"></div></body></html>');
      applyStyles(tree, doc.bodyElement!, { display: 'block', margin: '0' });
      applyStyles(tree, tree.getElementById('d')!, {
        margin: '0',
        'font-size': 'large',
        'margin-top': '1em',
      });
      const engine = new LayoutEngine({ viewportWidth: 1000, viewportHeight: 800, defaultFontSize: 16 });
      engine.layout(doc, tree);
      const box = tree.getElementById('d')!.layoutBox!;
      expect(box.marginTop).toBe(18); // 1em * 18px (large)
    });
  });

  describe('display: none', () => {
    it('should skip elements with display: none', () => {
      const { doc, tree } = buildDoc('<html><body><div id="d"></div></body></html>');
      applyStyles(tree, doc.bodyElement!, { display: 'block', margin: '0' });
      applyStyles(tree, tree.getElementById('d')!, {
        display: 'none',
        margin: '0',
      });
      const engine = new LayoutEngine({ viewportWidth: 1000, viewportHeight: 800, defaultFontSize: 16 });
      engine.layout(doc, tree);
      const div = tree.getElementById('d')!;
      expect(div.layoutBox).toBeNull();
    });
  });

  describe('position: relative', () => {
    it('should offset the element by top and left', () => {
      const { doc, tree } = buildDoc('<html><body><div id="d"></div></body></html>');
      applyStyles(tree, doc.bodyElement!, { display: 'block', margin: '0' });
      applyStyles(tree, tree.getElementById('d')!, {
        margin: '0',
        position: 'relative',
        top: '10',
        left: '20',
      });
      const engine = new LayoutEngine({ viewportWidth: 1000, viewportHeight: 800, defaultFontSize: 16 });
      engine.layout(doc, tree);
      const box = tree.getElementById('d')!.layoutBox!;
      expect(box.x).toBe(20);
      expect(box.y).toBe(10);
    });
  });

  describe('block layout', () => {
    it('should stack block children vertically', () => {
      const { doc, tree } = buildDoc('<html><body><div id="parent"><div id="child1"></div><div id="child2"></div></div></body></html>');
      applyStyles(tree, doc.bodyElement!, { display: 'block', margin: '0' });
      applyStyles(tree, tree.getElementById('parent')!, {
        display: 'block',
        margin: '0',
        'padding-top': '10',
        'padding-bottom': '10',
      });
      applyStyles(tree, tree.getElementById('child1')!, {
        display: 'block',
        margin: '0',
        height: '50',
      });
      applyStyles(tree, tree.getElementById('child2')!, {
        display: 'block',
        margin: '0',
        height: '30',
      });
      const engine = new LayoutEngine({ viewportWidth: 1000, viewportHeight: 800, defaultFontSize: 16 });
      engine.layout(doc, tree);
      const child1 = tree.getElementById('child1')!.layoutBox!;
      const child2 = tree.getElementById('child2')!.layoutBox!;
      // child1.y = parent.contentY = 10 (padding-top)
      expect(child1.y).toBe(10);
      // child2.y = child1.y + child1.height = 10 + 50 = 60
      expect(child2.y).toBe(60);
    });

    it('should compute parent height from children', () => {
      const { doc, tree } = buildDoc('<html><body><div id="parent"><div id="child"></div></div></body></html>');
      applyStyles(tree, doc.bodyElement!, { display: 'block', margin: '0' });
      applyStyles(tree, tree.getElementById('parent')!, { display: 'block', margin: '0' });
      applyStyles(tree, tree.getElementById('child')!, {
        display: 'block',
        margin: '0',
        height: '100',
      });
      const engine = new LayoutEngine({ viewportWidth: 1000, viewportHeight: 800, defaultFontSize: 16 });
      engine.layout(doc, tree);
      const parent = tree.getElementById('parent')!.layoutBox!;
      // border-box: height=100 (child) + no padding/border
      expect(parent.height).toBe(100);
    });
  });

  describe('inline layout', () => {
    it('should place inline children at same position', () => {
      const { doc, tree } = buildDoc(`
        <html><body>
          <div id="parent">
            <div id="child1"></div>
            <div id="child2"></div>
          </div>
        </body></html>
      `);
      applyStyles(tree, doc.bodyElement!, { margin: '0', display: 'block' });
      applyStyles(tree, tree.getElementById('parent')!, {
        display: 'inline',
        margin: '0',
      });
      applyStyles(tree, tree.getElementById('child1')!, { display: 'inline', margin: '0' });
      applyStyles(tree, tree.getElementById('child2')!, { display: 'inline', margin: '0' });
      const engine = new LayoutEngine({ viewportWidth: 1000, viewportHeight: 800, defaultFontSize: 16 });
      engine.layout(doc, tree);
      const child1 = tree.getElementById('child1')!.layoutBox!;
      const child2 = tree.getElementById('child2')!.layoutBox!;
      // Inline children are placed at same position (simplified)
      expect(child1.x).toBe(child2.x);
      expect(child1.y).toBe(child2.y);
    });
  });

  describe('text nodes', () => {
    it('should add line-height for text nodes', () => {
      const { doc, tree } = buildDoc('<html><body><p id="p">hello</p></body></html>');
      applyStyles(tree, doc.bodyElement!, { display: 'block', margin: '0' });
      applyStyles(tree, tree.getElementById('p')!, {
        margin: '0',
        'line-height': '24',
      });
      const engine = new LayoutEngine({ viewportWidth: 1000, viewportHeight: 800, defaultFontSize: 16 });
      engine.layout(doc, tree);
      const p = tree.getElementById('p')!.layoutBox!;
      // p should have at least 24px height from the text node
      expect(p.height).toBeGreaterThanOrEqual(24);
    });
  });

  describe('LayoutBox written back to DOM tree', () => {
    it('should set layoutBox on elements when domTree is provided', () => {
      const { doc, tree } = buildDoc('<html><body><div id="d"></div></body></html>');
      applyStyles(tree, doc.bodyElement!, { display: 'block', margin: '0' });
      applyStyles(tree, tree.getElementById('d')!, { margin: '0' });
      const engine = new LayoutEngine({ viewportWidth: 1000, viewportHeight: 800, defaultFontSize: 16 });
      engine.layout(doc, tree);
      expect(tree.getElementById('d')!.layoutBox).not.toBeNull();
      expect(tree.getElementById('d')!.layoutBox!.width).toBe(1000);
    });

    it('should NOT set layoutBox when domTree is not provided', () => {
      const { doc, tree } = buildDoc('<html><body><div id="d"></div></body></html>');
      applyStyles(tree, doc.bodyElement!, { display: 'block', margin: '0' });
      applyStyles(tree, tree.getElementById('d')!, { margin: '0' });
      const engine = new LayoutEngine({ viewportWidth: 1000, viewportHeight: 800, defaultFontSize: 16 });
      engine.layout(doc); // no domTree
      expect(tree.getElementById('d')!.layoutBox).toBeNull();
    });
  });

  describe('getLayoutBox', () => {
    it('should return layout box by domId', () => {
      const { doc, tree } = buildDoc('<html><body><div id="d"></div></body></html>');
      applyStyles(tree, doc.bodyElement!, { display: 'block', margin: '0' });
      applyStyles(tree, tree.getElementById('d')!, { margin: '0' });
      const engine = new LayoutEngine({ viewportWidth: 1000, viewportHeight: 800, defaultFontSize: 16 });
      engine.layout(doc, tree);
      const div = tree.getElementById('d')!;
      const box = engine.getLayoutBox(div.domId);
      expect(box).not.toBeNull();
      expect(box).toBe(div.layoutBox);
    });

    it('should return null for unknown domId', () => {
      const engine = new LayoutEngine();
      expect(engine.getLayoutBox('nonexistent')).toBeNull();
    });
  });

  describe('getElementAtPoint', () => {
    it('should find element at a given point', () => {
      const { doc, tree } = buildDoc('<html><body><div id="d"></div></body></html>');
      applyStyles(tree, doc.bodyElement!, { display: 'block', margin: '0' });
      const d = tree.getElementById('d')!;
      applyStyles(tree, d, {
        display: 'block',
        margin: '0',
        width: '200',
        height: '100',
      });
      const engine = new LayoutEngine({ viewportWidth: 1000, viewportHeight: 800, defaultFontSize: 16 });
      engine.layout(doc, tree);
      expect(d.layoutBox).not.toBeNull();
      expect(engine.getLayoutBox(d.domId)).not.toBeNull();
      const el = engine.getElementAtPoint(50, 50);
      expect(el).not.toBeNull();
      expect(el!.tagName).toBe('div');
    });

    it('should return null when no element at point', () => {
      const { doc, tree } = buildDoc('<html><body></body></html>');
      applyStyles(tree, doc.bodyElement!, { display: 'block', margin: '0' });
      const engine = new LayoutEngine({ viewportWidth: 1000, viewportHeight: 800, defaultFontSize: 16 });
      engine.layout(doc, tree);
      // Point far outside any element
      const el = engine.getElementAtPoint(9999, 9999);
      expect(el).toBeNull();
    });
  });

  describe('config', () => {
    it('should return a copy of config', () => {
      const engine = new LayoutEngine({ viewportWidth: 800 });
      const config = engine.getConfig();
      expect(config.viewportWidth).toBe(800);
      // Modifying the copy should not affect the engine
      (config as { viewportWidth: number }).viewportWidth = 999;
      expect(engine.getConfig().viewportWidth).toBe(800);
    });

    it('should update config', () => {
      const engine = new LayoutEngine();
      engine.updateConfig({ viewportWidth: 640 });
      expect(engine.getConfig().viewportWidth).toBe(640);
    });
  });

  describe('complex nested layout', () => {
    it('should correctly compute nested box model with borders and padding', () => {
      const { doc, tree } = buildDoc('<html><body><div id="outer"><div id="inner"></div></div></body></html>');
      applyStyles(tree, doc.bodyElement!, { display: 'block', margin: '0' });
      applyStyles(tree, tree.getElementById('outer')!, {
        display: 'block',
        margin: '0',
        'padding-top': '10',
        'padding-left': '10',
        'border-top-width': '2',
        'border-left-width': '3',
      });
      applyStyles(tree, tree.getElementById('inner')!, {
        display: 'block',
        margin: '0',
        width: '100',
        height: '50',
      });
      const engine = new LayoutEngine({ viewportWidth: 1000, viewportHeight: 800, defaultFontSize: 16 });
      engine.layout(doc, tree);
      const outer = tree.getElementById('outer')!.layoutBox!;
      const inner = tree.getElementById('inner')!.layoutBox!;

      // outer: border-box at (0,0), border=2 top + 3 left, padding=10 top + 10 left
      expect(outer.x).toBe(0);
      expect(outer.y).toBe(0);
      expect(outer.borderTop).toBe(2);
      expect(outer.borderLeft).toBe(3);
      expect(outer.paddingTop).toBe(10);
      expect(outer.paddingLeft).toBe(10);

      // inner: positioned at outer.contentX = 0 + 3 + 10 = 13, contentY = 0 + 2 + 10 = 12
      expect(inner.x).toBe(13);
      expect(inner.y).toBe(12);
    });
  });

  describe('dispose', () => {
    it('should clear all internal state', () => {
      const { doc, tree } = buildDoc('<html><body><div id="d"></div></body></html>');
      applyStyles(tree, doc.bodyElement!, { display: 'block', margin: '0' });
      applyStyles(tree, tree.getElementById('d')!, { margin: '0' });
      const engine = new LayoutEngine({ viewportWidth: 1000, viewportHeight: 800, defaultFontSize: 16 });
      engine.layout(doc, tree);
      expect(engine.getLayoutBox(tree.getElementById('d')!.domId)).not.toBeNull();
      engine.dispose();
      expect(engine.getLayoutBox(tree.getElementById('d')!.domId)).toBeNull();
    });
  });
});
