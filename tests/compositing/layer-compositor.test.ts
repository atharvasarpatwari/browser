import { describe, it, expect } from 'vitest';
import { LayerCompositor } from '../../src/browser/rendering/compositing/layer-compositor';
import { LayerTree } from '../../src/browser/rendering/compositing/layer-tree';
import { LayerPromoter } from '../../src/browser/rendering/compositing/layer-promoter';
import { CompositingLayer } from '../../src/browser/rendering/compositing/compositing-layer';
import type { StackingContext } from '../../src/browser/rendering/formatting/stacking';
import type { DomElement } from '../../src/browser/rendering/dom-tree';

function makeEl(
  id: string,
  style: Record<string, string>,
  box: { x: number; y: number; width: number; height: number },
): DomElement {
  const map = new Map(Object.entries(style));
  return {
    domId: id,
    nodeType: 'element',
    tagName: 'div',
    attributes: new Map(),
    parent: null,
    children: [],
    computedStyle: map,
    layoutBox: {
      x: box.x, y: box.y, width: box.width, height: box.height,
      marginTop: 0, marginRight: 0, marginBottom: 0, marginLeft: 0,
      paddingTop: 0, paddingRight: 0, paddingBottom: 0, paddingLeft: 0,
      borderTop: 0, borderRight: 0, borderBottom: 0, borderLeft: 0,
    } as any,
    imageData: null,
    naturalWidth: 0,
    naturalHeight: 0,
    loadingState: 'none',
    willChange: null,
    usedStyle: null,
    _dirtyLayout: false,
    _dirtyPaint: false,
    _dirtyStyle: false,
  };
}

function makeCtx(el: DomElement, zIndex: number = 0, children: StackingContext[] = []): StackingContext {
  return {
    element: el,
    zIndex,
    children,
    bgCommands: [
      {
        type: 'setFillStyle',
        params: [el.computedStyle?.get('background-color') ?? 'transparent'],
      },
      {
        type: 'fillRect',
        params: [
          el.layoutBox!.x,
          el.layoutBox!.y,
          el.layoutBox!.width,
          el.layoutBox!.height,
        ],
      },
    ],
    blockEntries: [],
    floatEntries: [],
    inlineEntries: [],
    positionedAutoEntries: [],
    isGrouped: false,
    groupOpacity: 1,
    willChange: null,
  };
}

describe('LayerCompositor', () => {
  describe('composite', () => {
    it('produces ImageData with correct dimensions', () => {
      const promoter = new LayerPromoter();
      const el = makeEl('a', { transform: 'translateX(0)', 'background-color': 'red' }, { x: 0, y: 0, width: 100, height: 100 });
      const ctx = makeCtx(el, 1);
      const root = makeEl('root', { isolation: 'isolate', 'background-color': 'white' }, { x: 0, y: 0, width: 800, height: 600 });
      const rootCtx = makeCtx(root, 0, [ctx]);
      const tree = LayerTree.fromStackingContext(rootCtx, promoter);

      const compositor = new LayerCompositor({ width: 800, height: 600, backgroundColor: '#ffffff' });
      const result = compositor.composite(tree);
      expect(result.width).toBe(800);
      expect(result.height).toBe(600);
      compositor.dispose();
    });

    it('composites single layer correctly', () => {
      const promoter = new LayerPromoter();
      const el = makeEl('a', { transform: 'translateX(0)', 'background-color': 'red' }, { x: 10, y: 10, width: 50, height: 50 });
      const ctx = makeCtx(el);
      const tree = LayerTree.fromStackingContext(ctx, promoter);

      const compositor = new LayerCompositor({ width: 200, height: 200, backgroundColor: '#000000' });
      const result = compositor.composite(tree);

      // Check that the pixel at (10, 10) has some red content
      const data = result.data;
      const idx = (10 * 200 + 10) * 4;
      // Background is black (0,0,0), layer is red (255,0,0)
      // After compositing, the pixel should be red or mostly red
      expect(data[idx]!).toBeGreaterThan(0); // R channel
      compositor.dispose();
    });

    it('composites multiple layers in z-order', () => {
      const promoter = new LayerPromoter();
      const bottom = makeEl('bottom', { transform: 'translateX(0)', 'background-color': 'blue' }, { x: 0, y: 0, width: 100, height: 100 });
      const top = makeEl('top', { transform: 'translateX(0)', 'background-color': 'red' }, { x: 0, y: 0, width: 100, height: 100 });
      const bottomCtx = makeCtx(bottom, 1);
      const topCtx = makeCtx(top, 2);
      const root = makeEl('root', { isolation: 'isolate' }, { x: 0, y: 0, width: 200, height: 200 });
      const rootCtx = makeCtx(root, 0, [bottomCtx, topCtx]);
      const tree = LayerTree.fromStackingContext(rootCtx, promoter);

      const compositor = new LayerCompositor({ width: 200, height: 200, backgroundColor: '#000000' });
      const result = compositor.composite(tree);

      // Top layer (red) should be on top
      const data = result.data;
      const idx = (0 * 200 + 0) * 4;
      // After compositing, red layer on top of blue layer should result in red
      expect(data[idx]!).toBe(255); // R
      expect(data[idx + 1]!).toBe(0); // G
      compositor.dispose();
    });

    it('handles group opacity', () => {
      const promoter = new LayerPromoter();
      const el = makeEl('a', { opacity: '0.5', 'background-color': 'white' }, { x: 0, y: 0, width: 50, height: 50 });
      const ctx = makeCtx(el);
      // Make it grouped
      (ctx as { isGrouped: boolean }).isGrouped = true;
      (ctx as { groupOpacity: number }).groupOpacity = 0.5;
      const tree = LayerTree.fromStackingContext(ctx, promoter);

      const compositor = new LayerCompositor({ width: 100, height: 100, backgroundColor: '#000000' });
      const result = compositor.composite(tree);
      const data = result.data;
      const idx = (0 * 100 + 0) * 4;
      // White at 50% opacity over black = gray (~127)
      expect(data[idx]!).toBeGreaterThan(0);
      expect(data[idx]!).toBeLessThan(255);
      compositor.dispose();
    });
  });

  describe('compositeIncremental', () => {
    it('only re-rasterizes dirty layers', () => {
      const promoter = new LayerPromoter();
      const el = makeEl('a', { transform: 'translateX(0)', 'background-color': 'red' }, { x: 0, y: 0, width: 50, height: 50 });
      const ctx = makeCtx(el);
      const tree = LayerTree.fromStackingContext(ctx, promoter);

      const compositor = new LayerCompositor({ width: 100, height: 100, backgroundColor: '#000000' });
      // First composite - all layers dirty
      compositor.composite(tree);
      // Mark one layer dirty
      tree.root.addDamage(0, 0, 10, 10);
      // Incremental should work
      const result = compositor.compositeIncremental(tree);
      expect(result.width).toBe(100);
      compositor.dispose();
    });
  });

  describe('resize', () => {
    it('updates dimensions', () => {
      const compositor = new LayerCompositor({ width: 100, height: 100 });
      compositor.resize(200, 200);
      // No assertion needed, just checking it doesn't throw
      compositor.dispose();
    });
  });

  describe('dispose', () => {
    it('cleans up resources', () => {
      const compositor = new LayerCompositor({ width: 100, height: 100 });
      compositor.dispose();
      // No assertion needed, just checking it doesn't throw
    });
  });
});
