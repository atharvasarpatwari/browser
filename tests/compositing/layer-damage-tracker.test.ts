import { describe, it, expect } from 'vitest';
import { LayerDamageTracker } from '@/browser/rendering/compositing/layer-damage-tracker';
import type { LayoutBox } from '@/browser/rendering/dom-tree';

function makeBox(x: number, y: number, w: number, h: number): LayoutBox {
  return {
    x, y, width: w, height: h,
    marginTop: 0, marginRight: 0, marginBottom: 0, marginLeft: 0,
    paddingTop: 0, paddingRight: 0, paddingBottom: 0, paddingLeft: 0,
    borderTop: 0, borderRight: 0, borderBottom: 0, borderLeft: 0,
  };
}

describe('LayerDamageTracker', () => {
  describe('addLayerDamage', () => {
    it('records damage for a specific layer', () => {
      const tracker = new LayerDamageTracker();
      tracker.addLayerDamage('layer-1', 10, 20, 100, 50);
      expect(tracker.isLayerDirty('layer-1')).toBe(true);
      expect(tracker.isLayerDirty('layer-2')).toBe(false);
    });

    it('accumulates damage for the same layer', () => {
      const tracker = new LayerDamageTracker();
      tracker.addLayerDamage('layer-1', 0, 0, 50, 50);
      tracker.addLayerDamage('layer-1', 100, 100, 50, 50);
      const regions = tracker.getLayerRegions('layer-1');
      expect(regions.length).toBe(2);
    });
  });

  describe('addLayerDamageFromBox', () => {
    it('converts global coords to layer-local', () => {
      const tracker = new LayerDamageTracker();
      const box = makeBox(200, 300, 100, 50);
      tracker.addLayerDamageFromBox('layer-1', box, 150, 250);
      const regions = tracker.getLayerRegions('layer-1');
      expect(regions[0]).toEqual({ x: 50, y: 50, w: 100, h: 50 });
    });
  });

  describe('isLayerDirty / getLayerDamage', () => {
    it('returns correct dirty state', () => {
      const tracker = new LayerDamageTracker();
      expect(tracker.isLayerDirty('a')).toBe(false);
      tracker.addLayerDamage('a', 0, 0, 10, 10);
      expect(tracker.isLayerDirty('a')).toBe(true);
      expect(tracker.getLayerDamage('a')).not.toBeNull();
    });

    it('returns null for unknown layer', () => {
      const tracker = new LayerDamageTracker();
      expect(tracker.getLayerDamage('unknown')).toBeNull();
    });
  });

  describe('setParent + propagateUp', () => {
    it('propagates damage from child to parent', () => {
      const tracker = new LayerDamageTracker();
      tracker.setParent('child', 'parent');
      tracker.addLayerDamage('child', 10, 10, 50, 50);
      tracker.propagateUp();
      expect(tracker.isLayerDirty('parent')).toBe(true);
    });

    it('propagates through multiple levels', () => {
      const tracker = new LayerDamageTracker();
      tracker.setParent('child', 'mid');
      tracker.setParent('mid', 'root');
      tracker.addLayerDamage('child', 0, 0, 100, 100);
      tracker.propagateUp();
      expect(tracker.isLayerDirty('mid')).toBe(true);
      expect(tracker.isLayerDirty('root')).toBe(true);
    });

    it('does not propagate if child is clean', () => {
      const tracker = new LayerDamageTracker();
      tracker.setParent('child', 'parent');
      tracker.propagateUp();
      expect(tracker.isLayerDirty('parent')).toBe(false);
    });
  });

  describe('getDirtyLayerIds', () => {
    it('returns all dirty layer IDs', () => {
      const tracker = new LayerDamageTracker();
      tracker.addLayerDamage('a', 0, 0, 10, 10);
      tracker.addLayerDamage('c', 0, 0, 10, 10);
      const ids = tracker.getDirtyLayerIds();
      expect(ids.sort()).toEqual(['a', 'c']);
    });
  });

  describe('isEmpty', () => {
    it('returns true when no damage', () => {
      const tracker = new LayerDamageTracker();
      expect(tracker.isEmpty()).toBe(true);
    });

    it('returns false when any layer has damage', () => {
      const tracker = new LayerDamageTracker();
      tracker.addLayerDamage('a', 0, 0, 10, 10);
      expect(tracker.isEmpty()).toBe(false);
    });
  });

  describe('clearLayer', () => {
    it('clears damage for one layer', () => {
      const tracker = new LayerDamageTracker();
      tracker.addLayerDamage('a', 0, 0, 10, 10);
      tracker.addLayerDamage('b', 0, 0, 10, 10);
      tracker.clearLayer('a');
      expect(tracker.isLayerDirty('a')).toBe(false);
      expect(tracker.isLayerDirty('b')).toBe(true);
    });
  });

  describe('clear', () => {
    it('clears all damage', () => {
      const tracker = new LayerDamageTracker();
      tracker.addLayerDamage('a', 0, 0, 10, 10);
      tracker.addLayerDamage('b', 0, 0, 10, 10);
      tracker.clear();
      expect(tracker.isEmpty()).toBe(true);
    });
  });

  describe('dispose', () => {
    it('cleans up all resources', () => {
      const tracker = new LayerDamageTracker();
      tracker.addLayerDamage('a', 0, 0, 10, 10);
      tracker.dispose();
      expect(tracker.isEmpty()).toBe(true);
    });
  });
});
