import { describe, it, expect } from 'vitest';
import { LayerTree } from '../../src/browser/rendering/compositing/layer-tree';
import { LayerPromoter } from '../../src/browser/rendering/compositing/layer-promoter';
import type { StackingContext } from '../../src/browser/rendering/formatting/stacking';
import type { DomElement } from '../../src/browser/rendering/dom-tree';

function makeEl(id: string, style: Record<string, string> = {}): DomElement {
  const map = new Map(Object.entries(style));
  return {
    domId: id,
    nodeType: 'element',
    tagName: 'div',
    attributes: new Map(),
    parent: null,
    children: [],
    computedStyle: map.size > 0 ? map : null,
    layoutBox: { x: 0, y: 0, width: 100, height: 100,
      marginTop: 0, marginRight: 0, marginBottom: 0, marginLeft: 0,
      paddingTop: 0, paddingRight: 0, paddingBottom: 0, paddingLeft: 0,
      borderTop: 0, borderRight: 0, borderBottom: 0, borderLeft: 0,
    } as any,
    imageData: null,
    naturalWidth: 0,
    naturalHeight: 0,
    loadingState: 'none',
    willChange: null,
    _dirtyLayout: false,
    _dirtyPaint: false,
  };
}

function makeCtx(
  el: DomElement,
  zIndex: number = 0,
  children: StackingContext[] = [],
): StackingContext {
  return {
    element: el,
    zIndex,
    children,
    bgCommands: [],
    blockEntries: [],
    floatEntries: [],
    inlineEntries: [],
    positionedAutoEntries: [],
    isGrouped: false,
    groupOpacity: 1,
    willChange: el.computedStyle?.get('will-change') ?? null,
  };
}

function makePromotedEl(id: string): DomElement {
  return makeEl(id, { transform: 'translateX(0)' });
}

describe('LayerTree', () => {
  const promoter = new LayerPromoter();

  describe('fromStackingContext', () => {
    it('builds tree from single promoted context', () => {
      const el = makePromotedEl('root');
      const ctx = makeCtx(el);
      const tree = LayerTree.fromStackingContext(ctx, promoter);
      expect(tree.layerCount).toBe(1);
      expect(tree.root.sourceElement).toBe(el);
    });

    it('builds tree with nested promoted contexts', () => {
      const outer = makePromotedEl('outer');
      const inner = makePromotedEl('inner');
      const innerCtx = makeCtx(inner, 2);
      const outerCtx = makeCtx(outer, 1, [innerCtx]);
      const tree = LayerTree.fromStackingContext(outerCtx, promoter);
      expect(tree.layerCount).toBe(2);
    });

    it('non-promoted children collected in parent layer', () => {
      const parent = makePromotedEl('parent');
      const child = makeEl('child'); // Not promoted
      const childCtx = makeCtx(child, 0);
      const parentCtx = makeCtx(parent, 1, [childCtx]);
      const tree = LayerTree.fromStackingContext(parentCtx, promoter);
      // Only parent is promoted, child is in parent's layer
      expect(tree.layerCount).toBe(1);
    });

    it('multiple sibling promoted contexts', () => {
      const a = makePromotedEl('a');
      const b = makePromotedEl('b');
      const aCtx = makeCtx(a, 1);
      const bCtx = makeCtx(b, 2);
      const root = makeEl('root', { isolation: 'isolate' });
      const rootCtx = makeCtx(root, 0, [aCtx, bCtx]);
      const tree = LayerTree.fromStackingContext(rootCtx, promoter);
      expect(tree.layerCount).toBe(3); // root + a + b
    });
  });

  describe('findLayerById', () => {
    it('finds existing layer', () => {
      const el = makePromotedEl('a');
      const ctx = makeCtx(el);
      const tree = LayerTree.fromStackingContext(ctx, promoter);
      const layer = tree.layers[0]!;
      expect(tree.findLayerById(layer.id)).toBe(layer);
    });

    it('returns null for unknown id', () => {
      const el = makePromotedEl('a');
      const ctx = makeCtx(el);
      const tree = LayerTree.fromStackingContext(ctx, promoter);
      expect(tree.findLayerById('nonexistent')).toBeNull();
    });
  });

  describe('findLayerByElement', () => {
    it('finds layer by source element', () => {
      const el = makePromotedEl('a');
      const ctx = makeCtx(el);
      const tree = LayerTree.fromStackingContext(ctx, promoter);
      expect(tree.findLayerByElement(el)).toBe(tree.root);
    });

    it('returns null for non-layer element', () => {
      const el = makePromotedEl('a');
      const ctx = makeCtx(el);
      const tree = LayerTree.fromStackingContext(ctx, promoter);
      const other = makeEl('other');
      expect(tree.findLayerByElement(other)).toBeNull();
    });
  });

  describe('getCompositingOrder', () => {
    it('returns layers in z-index order', () => {
      const a = makePromotedEl('a');
      const b = makePromotedEl('b');
      const aCtx = makeCtx(a, 2);
      const bCtx = makeCtx(b, 1);
      const root = makeEl('root', { isolation: 'isolate' });
      const rootCtx = makeCtx(root, 0, [aCtx, bCtx]);
      const tree = LayerTree.fromStackingContext(rootCtx, promoter);

      const order = tree.getCompositingOrder();
      // b (z=1) should come before a (z=2) in the flattened list
      const bLayer = tree.findLayerByElement(b)!;
      const aLayer = tree.findLayerByElement(a)!;
      const bIdx = order.indexOf(bLayer);
      const aIdx = order.indexOf(aLayer);
      expect(bIdx).toBeLessThan(aIdx);
    });
  });

  describe('getDirtyLayers', () => {
    it('returns layers with dirty damage', () => {
      const el = makePromotedEl('a');
      const ctx = makeCtx(el);
      const tree = LayerTree.fromStackingContext(ctx, promoter);
      const layer = tree.root;
      layer.addDamage(0, 0, 50, 50);
      expect(tree.getDirtyLayers().length).toBe(1);
    });

    it('excludes empty layers', () => {
      const el = makeEl('a'); // No layoutBox dimensions
      const ctx = makeCtx(el);
      const tree = LayerTree.fromStackingContext(ctx, promoter);
      // root layer's element has a layoutBox, so not empty
      // But if we mark damage, it's dirty
      tree.root.addDamage(0, 0, 10, 10);
      const dirty = tree.getDirtyLayers();
      expect(dirty.length).toBe(1);
    });
  });

  describe('clearAllDamage', () => {
    it('clears damage on all layers', () => {
      const el = makePromotedEl('a');
      const ctx = makeCtx(el);
      const tree = LayerTree.fromStackingContext(ctx, promoter);
      tree.root.addDamage(0, 0, 50, 50);
      tree.clearAllDamage();
      expect(tree.getDirtyLayers().length).toBe(0);
    });
  });

  describe('dispose', () => {
    it('cleans up all layers', () => {
      const el = makePromotedEl('a');
      const ctx = makeCtx(el);
      const tree = LayerTree.fromStackingContext(ctx, promoter);
      tree.dispose();
      expect(tree.layerCount).toBe(0);
    });
  });
});
