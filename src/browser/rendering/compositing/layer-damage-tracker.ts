/**
 * @file LayerDamageTracker — Per-layer damage tracking for compositing.
 *
 * Tracks which compositing layers have damage and what regions within each
 * layer are dirty. Supports upward propagation: if a child layer is dirty,
 * its parent is also marked dirty.
 */

import { DamageTracker, type DamageRect } from '../damage-tracker';
import type { LayoutBox } from '../dom-tree';

// ─────────────────────────────────────────────────────────────────────────────
// LAYER DAMAGE TRACKER
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Tracks damage on a per-layer basis.
 *
 * Each compositing layer has its own DamageTracker for its local coordinate
 * space. This class wraps multiple per-layer trackers and provides
 * layer-level queries.
 */
export class LayerDamageTracker {
  private readonly layerDamages: Map<string, DamageTracker> = new Map();
  /** Parent mapping for upward propagation (childLayerId → parentLayerId). */
  private readonly parentMap: Map<string, string> = new Map();

  /**
   * Register a parent-child relationship for damage propagation.
   */
  setParent(childLayerId: string, parentLayerId: string): void {
    this.parentMap.set(childLayerId, parentLayerId);
  }

  /**
   * Add damage to a specific layer (in layer-local coordinates).
   */
  addLayerDamage(layerId: string, x: number, y: number, w: number, h: number): void {
    let tracker = this.layerDamages.get(layerId);
    if (!tracker) {
      tracker = new DamageTracker();
      this.layerDamages.set(layerId, tracker);
    }
    tracker.addRect(x, y, w, h);
  }

  /**
   * Add damage from a layout box to a specific layer.
   * Converts global coordinates to layer-local by subtracting the layer's origin.
   */
  addLayerDamageFromBox(
    layerId: string,
    box: LayoutBox,
    layerOriginX: number,
    layerOriginY: number,
  ): void {
    this.addLayerDamage(
      layerId,
      box.x - layerOriginX,
      box.y - layerOriginY,
      box.width,
      box.height,
    );
  }

  /**
   * Check if a specific layer has any damage.
   */
  isLayerDirty(layerId: string): boolean {
    const tracker = this.layerDamages.get(layerId);
    return tracker ? !tracker.isEmpty() : false;
  }

  /**
   * Get the damage tracker for a specific layer.
   */
  getLayerDamage(layerId: string): DamageTracker | null {
    return this.layerDamages.get(layerId) ?? null;
  }

  /**
   * Get all damage rectangles for a specific layer.
   */
  getLayerRegions(layerId: string): readonly DamageRect[] {
    const tracker = this.layerDamages.get(layerId);
    return tracker ? tracker.getRegions() : [];
  }

  /**
   * Propagate damage upward through the layer tree.
   *
   * If a child layer is dirty, its parent is also marked dirty
   * (since the child composites on top of the parent).
   */
  propagateUp(): void {
    // Iterate all dirty layers and mark parents dirty
    const dirtyIds: string[] = [];
    for (const [id, tracker] of this.layerDamages) {
      if (!tracker.isEmpty()) dirtyIds.push(id);
    }

    for (const id of dirtyIds) {
      let current = id;
      while (this.parentMap.has(current)) {
        const parentId = this.parentMap.get(current)!;
        let parentTracker = this.layerDamages.get(parentId);
        if (!parentTracker) {
          parentTracker = new DamageTracker();
          this.layerDamages.set(parentId, parentTracker);
        }
        // Add full bounds as damage to parent (conservative)
        // The parent needs to be re-composited since a child changed
        const childTracker = this.layerDamages.get(current)!;
        const bounds = childTracker.getBounds();
        if (bounds) {
          parentTracker.addRect(bounds.x, bounds.y, bounds.w, bounds.h);
        }
        current = parentId;
      }
    }
  }

  /**
   * Get all layer IDs that have damage.
   */
  getDirtyLayerIds(): string[] {
    const ids: string[] = [];
    for (const [id, tracker] of this.layerDamages) {
      if (!tracker.isEmpty()) ids.push(id);
    }
    return ids;
  }

  /**
   * Whether any layer has damage.
   */
  isEmpty(): boolean {
    for (const tracker of this.layerDamages.values()) {
      if (!tracker.isEmpty()) return false;
    }
    return true;
  }

  /**
   * Clear damage for a specific layer.
   */
  clearLayer(layerId: string): void {
    const tracker = this.layerDamages.get(layerId);
    if (tracker) tracker.clear();
  }

  /**
   * Clear all damage across all layers.
   */
  clear(): void {
    for (const tracker of this.layerDamages.values()) {
      tracker.clear();
    }
  }

  /**
   * Dispose all trackers.
   */
  dispose(): void {
    for (const tracker of this.layerDamages.values()) {
      tracker.dispose();
    }
    this.layerDamages.clear();
    this.parentMap.clear();
  }
}
