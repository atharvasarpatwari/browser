import { describe, it, expect } from 'vitest';
import { HtmlParser } from '../src/browser/rendering/html-parser';
import { DomTree } from '../src/browser/rendering/dom-tree';
import type { DomDocument, DomElement } from '../src/browser/rendering/dom-tree';
import { LayoutEngine } from '../src/browser/rendering/layout-engine';
import { PaintEngine } from '../src/browser/rendering/paint-engine';
import type { PaintCommand } from '../src/browser/rendering/paint-engine';
import {
  buildStackingContextTree,
  renderStackingContext,
  createsStackingContext,
  type StackingContext,
} from '../src/browser/rendering/formatting/stacking';

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

function layoutDoc(html: string, styles: Record<string, Record<string, string>> = {}): {
  doc: DomDocument; tree: DomTree; engine: LayoutEngine;
} {
  const { doc, tree } = buildDoc(html);
  for (const [selector, s] of Object.entries(styles)) {
    // Simple selector: supports id and tag
    if (selector.startsWith('#')) {
      const el = tree.getElementById(selector.slice(1));
      if (el) applyStyles(tree, el, s);
    } else if (selector === 'body') {
      if (doc.bodyElement) applyStyles(tree, doc.bodyElement, s);
    } else if (selector === 'html') {
      if (doc.htmlElement) applyStyles(tree, doc.htmlElement, s);
    }
  }
  const engine = new LayoutEngine({ viewportWidth: 800, viewportHeight: 600, defaultFontSize: 16 });
  engine.layout(doc, tree);
  return { doc, tree, engine };
}

function paintDoc(html: string, styles: Record<string, Record<string, string>> = {}): {
  commands: PaintCommand[]; paintEngine: PaintEngine;
} {
  const { doc, tree } = buildDoc(html);
  for (const [selector, s] of Object.entries(styles)) {
    if (selector.startsWith('#')) {
      const el = tree.getElementById(selector.slice(1));
      if (el) applyStyles(tree, el, s);
    } else if (selector === 'body') {
      if (doc.bodyElement) applyStyles(tree, doc.bodyElement, s);
    } else if (selector === 'html') {
      if (doc.htmlElement) applyStyles(tree, doc.htmlElement, s);
    }
  }
  const layoutEngine = new LayoutEngine({ viewportWidth: 800, viewportHeight: 600, defaultFontSize: 16 });
  layoutEngine.layout(doc, tree);

  const paintEngine = new PaintEngine({ width: 800, height: 600 });
  paintEngine.paint(doc);
  const commands = paintEngine.compositeFrame();
  return { commands, paintEngine };
}

/**
 * Extract paint-ordered (fillStyle, fillRect) pairs.
 * Each entry is { color, x, y, w, h }.
 */
function extractColoredRects(commands: PaintCommand[]): Array<{ color: string; x: number; y: number; w: number; h: number }> {
  const results: Array<{ color: string; x: number; y: number; w: number; h: number }> = [];
  let currentColor = '';
  for (const cmd of commands) {
    if (cmd.type === 'setFillStyle') {
      currentColor = cmd.params[0] as string;
    } else if (cmd.type === 'fillRect') {
      const [x, y, w, h] = cmd.params as [number, number, number, number];
      // Skip the page background fillRect (covers entire viewport)
      if (x === 0 && y === 0 && w >= 800 && h >= 600) continue;
      results.push({ color: currentColor, x, y, w, h });
    }
  }
  return results;
}

/**
 * Extract fillText commands: [text, x, y].
 */
function extractFillTexts(commands: PaintCommand[]): Array<[string, number, number]> {
  return commands
    .filter(c => c.type === 'fillText')
    .map(c => c.params as [string, number, number]);
}

/**
 * Extract save/restore pairs for group opacity.
 */
function extractGroupOpacity(commands: PaintCommand[]): Array<{ save: boolean; alpha: number; restore: boolean }> {
  const groups: Array<{ save: boolean; alpha: number; restore: boolean }> = [];
  let i = 0;
  while (i < commands.length) {
    if (commands[i].type === 'save') {
      const alpha = (i + 1 < commands.length && commands[i + 1].type === 'setGlobalAlpha')
        ? (commands[i + 1].params[0] as number)
        : 1;
      // Scan forward to find matching restore
      let hasRestore = false;
      for (let j = i + 1; j < commands.length; j++) {
        if (commands[j].type === 'restore') { hasRestore = true; break; }
      }
      groups.push({ save: true, alpha, restore: hasRestore });
      i++;
    } else {
      i++;
    }
  }
  return groups;
}

// ─────────────────────────────────────────────────────────────────────────────
// TESTS
// ─────────────────────────────────────────────────────────────────────────────

describe('StackingContext', () => {
  describe('createsStackingContext', () => {
    it('root element always creates a stacking context', () => {
      const { doc, tree } = buildDoc('<html><body></body></html>');
      const root = doc.htmlElement!;
      applyStyles(tree, root, { display: 'block' });
      expect(createsStackingContext(root, true)).toBe(true);
    });

    it('non-root static element does not create a stacking context', () => {
      const { doc, tree } = buildDoc('<html><body><div id="a"></div></body></html>');
      const el = tree.getElementById('a')!;
      applyStyles(tree, el, { display: 'block' });
      expect(createsStackingContext(el, false)).toBe(false);
    });

    it('positioned element with explicit z-index creates a stacking context', () => {
      const { doc, tree } = buildDoc('<html><body><div id="a"></div></body></html>');
      const el = tree.getElementById('a')!;
      applyStyles(tree, el, { display: 'block', position: 'relative', 'z-index': '0' });
      expect(createsStackingContext(el, false)).toBe(true);
    });

    it('positioned element with z-index auto does NOT create a stacking context', () => {
      const { doc, tree } = buildDoc('<html><body><div id="a"></div></body></html>');
      const el = tree.getElementById('a')!;
      applyStyles(tree, el, { display: 'block', position: 'relative' });
      expect(createsStackingContext(el, false)).toBe(false);
    });

    it('positioned element with negative z-index creates a stacking context', () => {
      const { doc, tree } = buildDoc('<html><body><div id="a"></div></body></html>');
      const el = tree.getElementById('a')!;
      applyStyles(tree, el, { display: 'block', position: 'absolute', 'z-index': '-1' });
      expect(createsStackingContext(el, false)).toBe(true);
    });

    it('opacity < 1 creates a stacking context', () => {
      const { doc, tree } = buildDoc('<html><body><div id="a"></div></body></html>');
      const el = tree.getElementById('a')!;
      applyStyles(tree, el, { display: 'block', opacity: '0.5' });
      expect(createsStackingContext(el, false)).toBe(true);
    });

    it('opacity 1 does NOT create a stacking context', () => {
      const { doc, tree } = buildDoc('<html><body><div id="a"></div></body></html>');
      const el = tree.getElementById('a')!;
      applyStyles(tree, el, { display: 'block', opacity: '1' });
      expect(createsStackingContext(el, false)).toBe(false);
    });

    it('transform creates a stacking context', () => {
      const { doc, tree } = buildDoc('<html><body><div id="a"></div></body></html>');
      const el = tree.getElementById('a')!;
      applyStyles(tree, el, { display: 'block', transform: 'translateX(10px)' });
      expect(createsStackingContext(el, false)).toBe(true);
    });

    it('filter creates a stacking context', () => {
      const { doc, tree } = buildDoc('<html><body><div id="a"></div></body></html>');
      const el = tree.getElementById('a')!;
      applyStyles(tree, el, { display: 'block', filter: 'blur(1px)' });
      expect(createsStackingContext(el, false)).toBe(true);
    });

    it('isolation: isolate creates a stacking context', () => {
      const { doc, tree } = buildDoc('<html><body><div id="a"></div></body></html>');
      const el = tree.getElementById('a')!;
      applyStyles(tree, el, { display: 'block', isolation: 'isolate' });
      expect(createsStackingContext(el, false)).toBe(true);
    });
  });

  describe('buildStackingContextTree', () => {
    it('builds a tree for a simple document', () => {
      const { doc, tree } = buildDoc('<html><body><div id="a"></div></body></html>');
      const root = doc.htmlElement!;
      applyStyles(tree, root, { display: 'block' });
      if (doc.bodyElement) applyStyles(tree, doc.bodyElement, { display: 'block' });
      const el = tree.getElementById('a')!;
      applyStyles(tree, el, { display: 'block' });

      const ctx = buildStackingContextTree(root);
      expect(ctx.element).toBe(root);
      expect(ctx.zIndex).toBe(0);
      // The body and div don't create stacking contexts
      expect(ctx.children.length).toBe(0);
    });

    it('nested stacking contexts', () => {
      const { doc, tree } = buildDoc(`
        <html><body>
          <div id="outer" style="position:relative; z-index:1">
            <div id="inner" style="position:relative; z-index:2"></div>
          </div>
        </body></html>
      `);
      const root = doc.htmlElement!;
      const outer = tree.getElementById('outer')!;
      const inner = tree.getElementById('inner')!;

      applyStyles(tree, root, { display: 'block' });
      applyStyles(tree, outer, { display: 'block', position: 'relative', 'z-index': '1' });
      applyStyles(tree, inner, { display: 'block', position: 'relative', 'z-index': '2' });
      if (doc.bodyElement) applyStyles(tree, doc.bodyElement, { display: 'block' });

      const ctx = buildStackingContextTree(root);
      // outer creates a stacking context (positioned + z-index)
      expect(ctx.children.length).toBe(1);
      expect(ctx.children[0].element).toBe(outer);
      expect(ctx.children[0].zIndex).toBe(1);
      // inner is a child of outer's context
      expect(ctx.children[0].children.length).toBe(1);
      expect(ctx.children[0].children[0].element).toBe(inner);
      expect(ctx.children[0].children[0].zIndex).toBe(2);
    });

    it('child contexts sorted by z-index', () => {
      const { doc, tree } = buildDoc(`
        <html><body>
          <div id="a" style="position:relative; z-index:3"></div>
          <div id="b" style="position:relative; z-index:1"></div>
          <div id="c" style="position:relative; z-index:2"></div>
        </body></html>
      `);
      const root = doc.htmlElement!;
      if (doc.bodyElement) applyStyles(tree, doc.bodyElement, { display: 'block' });
      applyStyles(tree, root, { display: 'block' });
      applyStyles(tree, tree.getElementById('a')!, { display: 'block', position: 'relative', 'z-index': '3' });
      applyStyles(tree, tree.getElementById('b')!, { display: 'block', position: 'relative', 'z-index': '1' });
      applyStyles(tree, tree.getElementById('c')!, { display: 'block', position: 'relative', 'z-index': '2' });

      const ctx = buildStackingContextTree(root);
      expect(ctx.children.length).toBe(3);
      expect(ctx.children[0].zIndex).toBe(1); // b
      expect(ctx.children[1].zIndex).toBe(2); // c
      expect(ctx.children[2].zIndex).toBe(3); // a
    });

    it('non-positioned elements classified into parent sub-layers', () => {
      const { doc, tree } = buildDoc(`
        <html><body>
          <div id="wrapper" style="position:relative; z-index:0">
            <div id="block1" style="display:block"></div>
            <div id="block2" style="display:block"></div>
          </div>
        </body></html>
      `);
      const root = doc.htmlElement!;
      if (doc.bodyElement) applyStyles(tree, doc.bodyElement, { display: 'block' });
      applyStyles(tree, root, { display: 'block' });
      const wrapper = tree.getElementById('wrapper')!;
      applyStyles(tree, wrapper, { display: 'block', position: 'relative', 'z-index': '0' });
      applyStyles(tree, tree.getElementById('block1')!, { display: 'block' });
      applyStyles(tree, tree.getElementById('block2')!, { display: 'block' });

      const ctx = buildStackingContextTree(root);
      // wrapper creates a stacking context
      expect(ctx.children.length).toBe(1);
      const wrapperCtx = ctx.children[0];
      // block1 and block2 are classified as block entries
      expect(wrapperCtx.blockEntries.length).toBe(2);
    });

    it('display none elements are skipped', () => {
      const { doc, tree } = buildDoc(`
        <html><body>
          <div id="a" style="position:relative; z-index:1"></div>
          <div id="b" style="display:none; position:relative; z-index:2"></div>
        </body></html>
      `);
      const root = doc.htmlElement!;
      if (doc.bodyElement) applyStyles(tree, doc.bodyElement, { display: 'block' });
      applyStyles(tree, root, { display: 'block' });
      applyStyles(tree, tree.getElementById('a')!, { display: 'block', position: 'relative', 'z-index': '1' });
      applyStyles(tree, tree.getElementById('b')!, { display: 'none', position: 'relative', 'z-index': '2' });

      const ctx = buildStackingContextTree(root);
      expect(ctx.children.length).toBe(1);
      expect(ctx.children[0].element).toBe(tree.getElementById('a'));
    });
  });

  describe('renderStackingContext', () => {
    it('renders children in z-index order', () => {
      const { doc, tree } = buildDoc(`
        <html><body>
          <div id="a" style="position:relative; z-index:3">
            <div id="a-content" style="display:block; width:50px; height:50px; background-color:red"></div>
          </div>
          <div id="b" style="position:relative; z-index:1">
            <div id="b-content" style="display:block; width:50px; height:50px; background-color:blue"></div>
          </div>
        </body></html>
      `);
      const root = doc.htmlElement!;
      if (doc.bodyElement) applyStyles(tree, doc.bodyElement, { display: 'block', margin: '0' });
      applyStyles(tree, root, { display: 'block' });
      applyStyles(tree, tree.getElementById('a')!, { display: 'block', position: 'relative', 'z-index': '3' });
      applyStyles(tree, tree.getElementById('a-content')!, { display: 'block', width: '50px', height: '50px', 'background-color': 'red', margin: '0' });
      applyStyles(tree, tree.getElementById('b')!, { display: 'block', position: 'relative', 'z-index': '1' });
      applyStyles(tree, tree.getElementById('b-content')!, { display: 'block', width: '50px', height: '50px', 'background-color': 'blue', margin: '0' });

      // Build tree and layout
      const engine = new LayoutEngine({ viewportWidth: 800, viewportHeight: 600, defaultFontSize: 16 });
      engine.layout(doc, tree);

      const ctx = buildStackingContextTree(root);

      // Simple render: collect element commands
      const paintEl = (el: DomElement): PaintCmd[] => {
        const box = el.layoutBox;
        if (!box || box.width === 0 || box.height === 0) return [];
        const style = el.computedStyle ?? new Map();
        const bg = style.get('background-color') ?? 'transparent';
        if (bg === 'transparent') return [];
        return [{ type: 'fillRect', params: [box.x, box.y, box.width, box.height] }];
      };

      const commands = renderStackingContext(ctx, paintEl);

      // b (z-index: 1) should paint before a (z-index: 3)
      const rects = commands.filter(c => c.type === 'fillRect');
      // b-content rect should come before a-content rect in the command list
      const bIdx = rects.findIndex(c => (c.params[1] as string) === 'blue' || (c.params[0] === 0 && c.params[1] === 0));
      // Since we're looking at PaintCmd[] (not PaintCommand[]), check by params
      // b is at index 1 in the DOM but z-index 1, a is at index 0 but z-index 3
      // After root bg, b should paint first (z=1), then a (z=3)
    });
  });

  describe('PaintEngine integration', () => {
    it('negative z-index paints behind normal flow', () => {
      const { commands } = paintDoc(`
        <html><body>
          <div id="bg" style="position:absolute; z-index:-1; width:200px; height:200px; background-color:yellow"></div>
          <div id="fg" style="position:relative; z-index:0; width:100px; height:100px; background-color:red"></div>
        </body></html>
      `, {
        'html': { display: 'block', margin: '0' },
        'body': { display: 'block', margin: '0' },
        '#bg': { position: 'absolute', 'z-index': '-1', width: '200px', height: '200px', 'background-color': 'yellow' },
        '#fg': { position: 'relative', 'z-index': '0', width: '100px', height: '100px', 'background-color': 'red' },
      });

      const rects = extractColoredRects(commands);
      const yellowIdx = rects.findIndex(r => r.color === 'yellow');
      const redIdx = rects.findIndex(r => r.color === 'red');
      expect(yellowIdx).toBeGreaterThanOrEqual(0);
      expect(redIdx).toBeGreaterThanOrEqual(0);
      expect(yellowIdx).toBeLessThan(redIdx);
    });

    it('positive z-index paints on top', () => {
      const { commands } = paintDoc(`
        <html><body>
          <div id="bottom" style="position:relative; z-index:1; width:100px; height:100px; background-color:blue"></div>
          <div id="top" style="position:relative; z-index:10; width:50px; height:50px; background-color:red"></div>
        </body></html>
      `, {
        'html': { display: 'block', margin: '0' },
        'body': { display: 'block', margin: '0' },
        '#bottom': { position: 'relative', 'z-index': '1', width: '100px', height: '100px', 'background-color': 'blue' },
        '#top': { position: 'relative', 'z-index': '10', width: '50px', height: '50px', 'background-color': 'red' },
      });

      const rects = extractColoredRects(commands);
      const blueIdx = rects.findIndex(r => r.color === 'blue');
      const redIdx = rects.findIndex(r => r.color === 'red');
      expect(blueIdx).toBeGreaterThanOrEqual(0);
      expect(redIdx).toBeGreaterThanOrEqual(0);
      expect(blueIdx).toBeLessThan(redIdx);
    });

    it('z-index 0 positioned paints on top of non-positioned blocks', () => {
      const { commands } = paintDoc(`
        <html><body>
          <div id="block" style="display:block; width:100px; height:100px; background-color:gray"></div>
          <div id="pos" style="position:relative; z-index:0; width:50px; height:50px; background-color:red"></div>
        </body></html>
      `, {
        'html': { display: 'block', margin: '0' },
        'body': { display: 'block', margin: '0' },
        '#block': { display: 'block', width: '100px', height: '100px', 'background-color': 'gray' },
        '#pos': { position: 'relative', 'z-index': '0', width: '50px', height: '50px', 'background-color': 'red' },
      });

      const rects = extractColoredRects(commands);
      const grayIdx = rects.findIndex(r => r.color === 'gray');
      const redIdx = rects.findIndex(r => r.color === 'red');
      expect(grayIdx).toBeGreaterThanOrEqual(0);
      expect(redIdx).toBeGreaterThanOrEqual(0);
      // positioned z-0 should paint after non-positioned block
      expect(grayIdx).toBeLessThan(redIdx);
    });

    it('opacity < 1 creates group compositing (save/alpha/restore)', () => {
      const { commands } = paintDoc(`
        <html><body>
          <div id="opaque" style="display:block; width:100px; height:100px; background-color:red"></div>
          <div id="semi" style="position:relative; z-index:1; opacity:0.5; width:50px; height:50px; background-color:blue"></div>
        </body></html>
      `, {
        'html': { display: 'block', margin: '0' },
        'body': { display: 'block', margin: '0' },
        '#opaque': { display: 'block', width: '100px', height: '100px', 'background-color': 'red' },
        '#semi': { position: 'relative', 'z-index': '1', opacity: '0.5', width: '50px', height: '50px', 'background-color': 'blue' },
      });

      // The stacking context for #semi should have group compositing
      const groups = extractGroupOpacity(commands);
      const semiGroup = groups.find(g => g.alpha === 0.5);
      expect(semiGroup).toBeDefined();
      expect(semiGroup!.save).toBe(true);
      expect(semiGroup!.restore).toBe(true);
    });

    it('non-positioned blocks paint in DOM order', () => {
      const { commands } = paintDoc(`
        <html><body>
          <div id="first" style="display:block; width:100px; height:50px; background-color:red"></div>
          <div id="second" style="display:block; width:100px; height:50px; background-color:blue"></div>
        </body></html>
      `, {
        'html': { display: 'block', margin: '0' },
        'body': { display: 'block', margin: '0' },
        '#first': { display: 'block', width: '100px', height: '50px', 'background-color': 'red' },
        '#second': { display: 'block', width: '100px', height: '50px', 'background-color': 'blue' },
      });

      const rects = extractColoredRects(commands);
      const redIdx = rects.findIndex(r => r.color === 'red');
      const blueIdx = rects.findIndex(r => r.color === 'blue');
      expect(redIdx).toBeGreaterThanOrEqual(0);
      expect(blueIdx).toBeGreaterThanOrEqual(0);
      expect(redIdx).toBeLessThan(blueIdx);
    });

    it('floats paint between blocks and inlines', () => {
      const { commands } = paintDoc(`
        <html><body>
          <div id="block" style="display:block; width:100px; height:100px; background-color:gray"></div>
          <div id="float" style="float:left; width:50px; height:50px; background-color:yellow"></div>
          <div id="inline" style="display:inline; width:100px; height:50px; background-color:green"></div>
        </body></html>
      `, {
        'html': { display: 'block', margin: '0' },
        'body': { display: 'block', margin: '0' },
        '#block': { display: 'block', width: '100px', height: '100px', 'background-color': 'gray' },
        '#float': { float: 'left', width: '50px', height: '50px', 'background-color': 'yellow' },
        '#inline': { display: 'inline', width: '100px', height: '50px', 'background-color': 'green' },
      });

      // With proper stacking, blocks (gray) paint, then floats (yellow), then inlines (green)
      const rects = extractColoredRects(commands);
      const grayIdx = rects.findIndex(r => r.color === 'gray');
      const yellowIdx = rects.findIndex(r => r.color === 'yellow');
      expect(grayIdx).toBeGreaterThanOrEqual(0);
      expect(yellowIdx).toBeGreaterThanOrEqual(0);
      expect(grayIdx).toBeLessThan(yellowIdx);
    });

    it('sibling contexts with same z-index use DOM order', () => {
      const { commands } = paintDoc(`
        <html><body>
          <div id="a" style="position:relative; z-index:1; width:100px; height:50px; background-color:red"></div>
          <div id="b" style="position:relative; z-index:1; width:100px; height:50px; background-color:blue"></div>
        </body></html>
      `, {
        'html': { display: 'block', margin: '0' },
        'body': { display: 'block', margin: '0' },
        '#a': { position: 'relative', 'z-index': '1', width: '100px', height: '50px', 'background-color': 'red' },
        '#b': { position: 'relative', 'z-index': '1', width: '100px', height: '50px', 'background-color': 'blue' },
      });

      const rects = extractColoredRects(commands);
      // Both have z-index 1, so DOM order: red before blue
      const redIdx = rects.findIndex(r => r.color === 'red');
      const blueIdx = rects.findIndex(r => r.color === 'blue');
      expect(redIdx).toBeGreaterThanOrEqual(0);
      expect(blueIdx).toBeGreaterThanOrEqual(0);
      expect(redIdx).toBeLessThan(blueIdx);
    });

    it('nested stacking context isolates z-index', () => {
      const { commands } = paintDoc(`
        <html><body>
          <div id="outer" style="position:relative; z-index:1; width:200px; height:200px; background-color:lightgray">
            <div id="inner-high" style="position:relative; z-index:100; width:50px; height:50px; background-color:red"></div>
          </div>
          <div id="sibling" style="position:relative; z-index:2; width:100px; height:100px; background-color:blue"></div>
        </body></html>
      `, {
        'html': { display: 'block', margin: '0' },
        'body': { display: 'block', margin: '0' },
        '#outer': { position: 'relative', 'z-index': '1', width: '200px', height: '200px', 'background-color': 'lightgray' },
        '#inner-high': { position: 'relative', 'z-index': '100', width: '50px', height: '50px', 'background-color': 'red' },
        '#sibling': { position: 'relative', 'z-index': '2', width: '100px', height: '100px', 'background-color': 'blue' },
      });

      // outer (z=1) should paint before sibling (z=2)
      // inner-high (z=100) is inside outer's context, so it paints within outer
      const rects = extractColoredRects(commands);
      const lgIdx = rects.findIndex(r => r.color === 'lightgray');
      const redIdx = rects.findIndex(r => r.color === 'red');
      const blueIdx = rects.findIndex(r => r.color === 'blue');

      expect(lgIdx).toBeGreaterThanOrEqual(0);
      expect(redIdx).toBeGreaterThanOrEqual(0);
      expect(blueIdx).toBeGreaterThanOrEqual(0);

      // outer's bg (z=1 context) paints before sibling (z=2 context)
      expect(lgIdx).toBeLessThan(blueIdx);
      // inner-high (z=100 within outer) paints within outer, before sibling
      expect(redIdx).toBeLessThan(blueIdx);
    });

    it('backward compat: getLayers still works', () => {
      const { doc, tree } = buildDoc('<html><body><div id="a" style="display:block; width:50px; height:50px; background-color:red"></div></body></html>');
      applyStyles(tree, doc.bodyElement!, { display: 'block', margin: '0' });
      applyStyles(tree, doc.htmlElement!, { display: 'block' });
      applyStyles(tree, tree.getElementById('a')!, { display: 'block', width: '50px', height: '50px', 'background-color': 'red' });

      const engine = new LayoutEngine({ viewportWidth: 800, viewportHeight: 600, defaultFontSize: 16 });
      engine.layout(doc, tree);

      const paintEngine = new PaintEngine({ width: 800, height: 600 });
      paintEngine.paint(doc);

      const layers = paintEngine.getLayers();
      expect(layers.length).toBeGreaterThan(0);
    });

    it('backward compat: compositeFrame produces commands', () => {
      const { commands } = paintDoc(`
        <html><body>
          <div id="a" style="display:block; width:100px; height:100px; background-color:red"></div>
        </body></html>
      `, {
        'html': { display: 'block', margin: '0' },
        'body': { display: 'block', margin: '0' },
        '#a': { display: 'block', width: '100px', height: '100px', 'background-color': 'red' },
      });

      expect(commands.length).toBeGreaterThan(0);
      // Should have clearRect, fillRect (bg), then element commands
      expect(commands[0].type).toBe('clearRect');
      expect(commands[1].type).toBe('setFillStyle');
      expect(commands[2].type).toBe('fillRect');
    });
  });
});
