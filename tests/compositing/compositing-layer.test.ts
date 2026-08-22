import { describe, it, expect } from 'vitest';
import { CompositingLayer } from '@/browser/rendering/compositing/compositing-layer';
import { TileGrid } from '@/browser/rendering/compositing/tile-grid';
import type { DomElement } from '@/browser/rendering/dom-tree';
import type { StackingContext } from '@/browser/rendering/formatting/stacking';

function makeElement(
  id: string,
  overrides?: Partial<{
    width: number;
    height: number;
    x: number;
    y: number;
    transform: string;
    filter: string;
    opacity: string;
  }>,
): DomElement {
  const w = overrides?.width ?? 100;
  const h = overrides?.height ?? 100;
  const box = overrides?.width != null || overrides?.height != null || overrides?.x != null || overrides?.y != null
    ? {
        x: overrides?.x ?? 0,
        y: overrides?.y ?? 0,
        width: w,
        height: h,
        marginTop: 0, marginRight: 0, marginBottom: 0, marginLeft: 0,
        paddingTop: 0, paddingRight: 0, paddingBottom: 0, paddingLeft: 0,
        borderTop: 0, borderRight: 0, borderBottom: 0, borderLeft: 0,
      }
    : null;

  const style = new Map<string, string>();
  if (overrides?.transform) style.set('transform', overrides.transform);
  if (overrides?.filter) style.set('filter', overrides.filter);
  if (overrides?.opacity) style.set('opacity', overrides.opacity);

  return {
    domId: id,
    nodeType: 'element',
    tagName: 'div',
    attributes: new Map(),
    parent: null,
    children: [],
    computedStyle: style.size > 0 ? style : null,
    layoutBox: box as any,
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

function makeStackingContext(
  el: DomElement,
  zIndex: number = 0,
  isGrouped: boolean = false,
  groupOpacity: number = 1,
): StackingContext {
  return {
    element: el,
    zIndex,
    children: [],
    bgCommands: [],
    blockEntries: [],
    floatEntries: [],
    inlineEntries: [],
    positionedAutoEntries: [],
    isGrouped,
    groupOpacity,
    willChange: null,
    translate: null,
  };
}

describe('CompositingLayer', () => {
  describe('construction', () => {
    it('creates a layer with unique id', () => {
      const el = makeElement('a', { width: 200, height: 100 });
      const ctx = makeStackingContext(el);
      const layer = new CompositingLayer(el, ctx);
      expect(layer.id).toBeTruthy();
      expect(layer.sourceElement).toBe(el);
      expect(layer.stackingContext).toBe(ctx);
    });

    it('reads bounds from layoutBox', () => {
      const el = makeElement('a', { x: 50, y: 60, width: 200, height: 100 });
      const ctx = makeStackingContext(el);
      const layer = new CompositingLayer(el, ctx);
      expect(layer.bounds).toEqual({ x: 50, y: 60, width: 200, height: 100 });
    });

    it('reads transform flag from computed style', () => {
      const el = makeElement('a', { transform: 'translateX(10px)' });
      const ctx = makeStackingContext(el);
      const layer = new CompositingLayer(el, ctx);
      expect(layer.hasTransform).toBe(true);
    });

    it('reads filter flag from computed style', () => {
      const el = makeElement('a', { filter: 'blur(1px)' });
      const ctx = makeStackingContext(el);
      const layer = new CompositingLayer(el, ctx);
      expect(layer.hasFilter).toBe(true);
    });

    it('reads group opacity from stacking context', () => {
      const el = makeElement('a');
      const ctx = makeStackingContext(el, 0, true, 0.5);
      const layer = new CompositingLayer(el, ctx);
      expect(layer.isGrouped).toBe(true);
      expect(layer.groupOpacity).toBe(0.5);
    });
  });

  describe('addDamage', () => {
    it('marks layer as dirty', () => {
      const el = makeElement('a', { width: 100, height: 100 });
      const ctx = makeStackingContext(el);
      const layer = new CompositingLayer(el, ctx);
      layer.clearDamage();
      expect(layer.isDirty).toBe(false);

      layer.addDamage(10, 10, 50, 50);
      expect(layer.isDirty).toBe(true);
      expect(layer.damage.isEmpty()).toBe(false);
    });

    it('adds damage to tile grid when tiling is enabled', () => {
      const el = makeElement('a', { width: 600, height: 600 });
      const ctx = makeStackingContext(el);
      const layer = new CompositingLayer(el, ctx, { enableTiling: true, tileThreshold: 512 });
      expect(layer.tiles).not.toBeNull();

      layer.addDamage(10, 10, 50, 50);
      expect(layer.tiles!.dirtyCount).toBeGreaterThan(0);
    });
  });

  describe('isVisuallyContained', () => {
    it('returns true for visible layer', () => {
      const el = makeElement('a', { x: 100, y: 100, width: 200, height: 200 });
      const ctx = makeStackingContext(el);
      const layer = new CompositingLayer(el, ctx);
      expect(layer.isVisuallyContained({ x: 0, y: 0, width: 800, height: 600 })).toBe(true);
    });

    it('returns false for off-screen layer', () => {
      const el = makeElement('a', { x: 2000, y: 2000, width: 100, height: 100 });
      const ctx = makeStackingContext(el);
      const layer = new CompositingLayer(el, ctx);
      expect(layer.isVisuallyContained({ x: 0, y: 0, width: 800, height: 600 })).toBe(false);
    });
  });

  describe('isEmpty', () => {
    it('returns true for zero-size layer', () => {
      const el = makeElement('a');
      const ctx = makeStackingContext(el);
      const layer = new CompositingLayer(el, ctx);
      expect(layer.isEmpty()).toBe(true);
    });

    it('returns false for sized layer', () => {
      const el = makeElement('a', { width: 100, height: 100 });
      const ctx = makeStackingContext(el);
      const layer = new CompositingLayer(el, ctx);
      expect(layer.isEmpty()).toBe(false);
    });
  });

  describe('dispose', () => {
    it('cleans up resources', () => {
      const el = makeElement('a', { width: 100, height: 100 });
      const ctx = makeStackingContext(el);
      const layer = new CompositingLayer(el, ctx);
      layer.dispose();
      expect(layer.softwareBuffer).toBeNull();
      expect(layer.tiles).toBeNull();
      expect(layer.gpuBuffer).toBeNull();
    });
  });
});
