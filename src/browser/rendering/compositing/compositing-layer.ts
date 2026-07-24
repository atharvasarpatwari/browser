/**
 * @file CompositingLayer — Core compositing layer abstraction.
 *
 * Each element promoted to a compositing layer gets its own independent
 * texture/buffer, damage tracking, and compositing properties.
 */

import type { DomElement } from '../dom-tree';
import type { PaintCommand } from '../paint-engine';
import type { StackingContext } from '../formatting/stacking';
import { DamageTracker } from '../damage-tracker';
import { TileGrid, TILE_SIZE, type ViewportRect } from './tile-grid';

// ─────────────────────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────────────────────

export interface LayerBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface CompositingLayerConfig {
  readonly enableTiling: boolean;
  readonly tileThreshold: number;
}

const DEFAULT_LAYER_CONFIG: CompositingLayerConfig = {
  enableTiling: true,
  tileThreshold: 512,
};

// ─────────────────────────────────────────────────────────────────────────────
// COMPOSITING LAYER
// ─────────────────────────────────────────────────────────────────────────────

let _layerIdSeq = 0;
function nextLayerId(): string {
  return `comp-layer-${(++_layerIdSeq).toString(36)}`;
}

/**
 * A compositing layer represents an independent paint surface.
 *
 * Elements promoted to compositing layers are painted into their own
 * texture, which can be cached and re-used across frames. The compositor
 * blends these textures together in z-order to produce the final image.
 */
export class CompositingLayer {
  readonly id: string;
  readonly sourceElement: DomElement;
  readonly stackingContext: StackingContext;
  readonly zIndex: number;
  readonly opacity: number;
  readonly isGrouped: boolean;
  readonly groupOpacity: number;
  readonly hasTransform: boolean;
  readonly hasFilter: boolean;

  bounds: LayerBounds;
  scrollOffset: { x: number; y: number };
  commands: PaintCommand[];
  isDirty: boolean;
  isTargetForChildren: boolean;

  gpuBuffer: GPUBuffer | null;
  gpuTextureWidth: number;
  gpuTextureHeight: number;

  softwareBuffer: Uint8ClampedArray | null;
  tiles: TileGrid | null;
  damage: DamageTracker;

  private readonly config: CompositingLayerConfig;

  constructor(
    sourceElement: DomElement,
    stackingContext: StackingContext,
    config?: Partial<CompositingLayerConfig>,
  ) {
    this.id = nextLayerId();
    this.sourceElement = sourceElement;
    this.stackingContext = stackingContext;
    this.zIndex = stackingContext.zIndex;
    this.opacity = stackingContext.groupOpacity;
    this.isGrouped = stackingContext.isGrouped;
    this.groupOpacity = stackingContext.groupOpacity;

    const style = sourceElement.computedStyle ?? new Map();
    this.hasTransform = !!(style.get('transform') && style.get('transform') !== 'none');
    this.hasFilter = !!(style.get('filter') && style.get('filter') !== 'none');

    this.config = { ...DEFAULT_LAYER_CONFIG, ...config };

    this.bounds = { x: 0, y: 0, width: 0, height: 0 };
    this.scrollOffset = { x: 0, y: 0 };
    this.commands = [];
    this.isDirty = true;
    this.isTargetForChildren = true;

    this.gpuBuffer = null;
    this.gpuTextureWidth = 0;
    this.gpuTextureHeight = 0;
    this.softwareBuffer = null;
    this.tiles = null;
    this.damage = new DamageTracker();

    this.updateBounds();
  }

  /**
   * Recalculate bounds from the source element's layout box.
   */
  updateBounds(): void {
    const box = this.sourceElement.layoutBox;
    if (box) {
      this.bounds = {
        x: box.x,
        y: box.y,
        width: box.width,
        height: box.height,
      };
    } else {
      this.bounds = { x: 0, y: 0, width: 0, height: 0 };
    }

    // Initialize or resize tiling if needed
    if (this.config.enableTiling && this.shouldUseTiles()) {
      this.ensureTiles();
    }
  }

  /**
   * Add damage to this layer (in layer-local coordinates).
   */
  addDamage(x: number, y: number, w: number, h: number): void {
    this.isDirty = true;
    this.damage.addRect(x, y, w, h);

    if (this.tiles) {
      this.tiles.addDamage(x, y, w, h);
    }
  }

  /**
   * Add damage from a layout box (auto-converts to layer-local coords).
   */
  addDamageFromBox(box: { x: number; y: number; width: number; height: number }): void {
    const localX = box.x - this.bounds.x;
    const localY = box.y - this.bounds.y;
    this.addDamage(localX, localY, box.width, box.height);
  }

  /**
   * Check if this layer is visually contained within a viewport.
   * Used for culling — skip compositing layers that are off-screen.
   */
  isVisuallyContained(viewport: ViewportRect): boolean {
    return !(
      this.bounds.x + this.bounds.width < viewport.x ||
      this.bounds.x > viewport.x + viewport.width ||
      this.bounds.y + this.bounds.height < viewport.y ||
      this.bounds.y > viewport.y + viewport.height
    );
  }

  /**
   * Whether this layer is empty (no content to render).
   */
  isEmpty(): boolean {
    return this.bounds.width === 0 || this.bounds.height === 0;
  }

  /**
   * Clear damage after successful compositing.
   */
  clearDamage(): void {
    this.isDirty = false;
    this.damage.clear();
    if (this.tiles) {
      this.tiles.clearDirtyFlags();
    }
  }

  /**
   * Dispose all resources.
   */
  dispose(): void {
    this.damage.dispose();
    this.tiles?.dispose();
    this.tiles = null;
    this.softwareBuffer = null;
    this.commands = [];
    if (this.gpuBuffer) {
      try { this.gpuBuffer.destroy(); } catch { /* already destroyed */ }
      this.gpuBuffer = null;
    }
  }

  // ── PRIVATE ─────────────────────────────────────────────────────────

  private shouldUseTiles(): boolean {
    return (
      this.bounds.width > this.config.tileThreshold ||
      this.bounds.height > this.config.tileThreshold
    );
  }

  private ensureTiles(): void {
    if (!this.tiles) {
      this.tiles = new TileGrid(
        this.bounds.width,
        this.bounds.height,
        this.id,
      );
    }
  }
}
