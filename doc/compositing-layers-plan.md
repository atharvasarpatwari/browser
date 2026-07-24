# Compositing Layers — Implementation Plan

**Date:** 2026-07-24
**Status:** Planned
**Scope:** Full compositor: layer promotion, per-layer GPU textures, tile-based rendering, damage-tracked layer repaint, GPU alpha blending

---

## Architecture Overview

The current pipeline flattens all paint commands into a single pixel buffer per frame:

```
Stacking Context Tree → PaintCommand[] → Rasterizer → ImageData
```

The new compositing system adds per-layer textures with independent damage tracking:

```
Stacking Context Tree
    ↓
LayerPromoter (will-change, transform, opacity<1, filter)
    ↓
LayerTree (CompositingLayer nodes, each with own buffer + damage)
    ↓
TileGrid (256×256 tiles per large layer, per-tile damage)
    ↓
LayerCompositor
    ├─ Per-layer: Rasterize dirty tiles → layer GPU texture
    └─ Final: Composite layer textures via GPU alpha blending (source-over)
    ↓
ImageData
```

### Key Design Decisions

1. **Conservative promotion:** Only promote elements with `will-change`, `transform`, `opacity<1`, `filter`, or `isolation:isolate`. No automatic overlap-based promotion.
2. **256×256 tiles:** Large layers (>512px in any dimension) are split into a tile grid. Only dirty tiles are re-rasterized.
3. **Retained mode:** Each layer caches its rendered texture. On incremental updates, only damaged layers (or damaged tiles within layers) are re-rasterized.
4. **GPU compositing:** The existing `ComputeOps.composite()` shader (source-over alpha blend) is wired into the final compositing step. Software fallback when GPU is unavailable.
5. **Backward compatible:** `compositeFrame()` still returns a flat `PaintCommand[]` for code that doesn't use the compositor. New `compositeFrameWithLayers()` returns composited `ImageData` directly.

---

## Files to Create

### 1. `src/browser/rendering/compositing/compositing-layer.ts` (~300 lines)

Core compositing layer abstraction.

```typescript
interface CompositingLayer {
  readonly id: string;
  readonly sourceElement: DomElement;     // The element that owns this layer
  readonly stackingContext: StackingContext;
  readonly zIndex: number;                // Resolved z-index in parent
  readonly opacity: number;               // Layer opacity (for group compositing)
  
  // Geometry
  bounds: { x: number; y: number; width: number; height: number };
  scrollOffset: { x: number; y: number };
  
  // Content
  commands: PaintCommand[];               // Cached display list for this layer
  isDirty: boolean;                       // Whether layer needs re-rasterization
  
  // GPU texture (per-layer)
  gpuBuffer: GPUBuffer | null;
  gpuTextureWidth: number;
  gpuTextureHeight: number;
  
  // Software fallback
  softwareBuffer: Uint8ClampedArray | null;
  
  // Tile management (for large layers)
  tiles: TileGrid | null;
  
  // Damage tracking (per-layer)
  damage: DamageTracker;
  
  // Compositing properties
  isGrouped: boolean;                     // opacity < 1 → group compositing
  groupOpacity: number;
  hasTransform: boolean;
  hasFilter: boolean;
  blendMode: string;                      // CSS blend-mode (future)
  
  // Methods
  updateBounds(): void;                   // Recalculate from layoutBox
  addDamage(x: number, y: number, w: number, h: number): void;
  isVisuallyContained(viewport: ViewportRect): boolean;  // Culling
  dispose(): void;
}
```

### 2. `src/browser/rendering/compositing/layer-tree.ts` (~250 lines)

Manages the tree of compositing layers, mirroring the stacking context tree structure.

```typescript
class LayerTree {
  readonly root: CompositingLayer;
  private layerMap: Map<string, CompositingLayer>;  // id → layer
  private elementMap: Map<DomElement, CompositingLayer>;  // element → layer
  
  static fromStackingContext(
    stackingTree: StackingContext,
    promoter: LayerPromoter,
  ): LayerTree;
  
  findLayerById(id: string): CompositingLayer | null;
  findLayerByElement(el: DomElement): CompositingLayer | null;
  
  // Flatten layers in compositing order (z-index sort, then DOM order)
  getCompositingOrder(): CompositingLayer[];
  
  // Update: find all dirty layers, return them for rasterization
  getDirtyLayers(): CompositingLayer[];
  
  // After compositing, clear all damage
  clearAllDamage(): void;
  
  // Recalculate bounds from DOM layout boxes
  updateBounds(): void;
  
  getLayerCount(): number;
  dispose(): void;
}
```

### 3. `src/browser/rendering/compositing/layer-promoter.ts` (~150 lines)

Analyzes stacking context tree and decides which contexts become compositing layers.

```typescript
interface PromotionHint {
  willChange?: string;    // transform, opacity, will-change CSS property
  hasTransform: boolean;
  hasOpacityLessThan1: boolean;
  hasFilter: boolean;
  hasIsolation: boolean;
}

class LayerPromoter {
  /**
   * Analyze a stacking context and determine if it should be promoted.
   * Conservative heuristics:
   * 1. will-change: transform, opacity, paint → always promote
   * 2. transform != none → always promote
   * 3. opacity < 1 → always promote (group compositing)
   * 4. filter != none → always promote
   * 5. isolation: isolate → always promote
   * 6. Large element (>viewport * 2 in any dimension) → promote for tiling
   */
  shouldPromote(ctx: StackingContext, viewport: ViewportRect): boolean;
  
  getHint(ctx: StackingContext): PromotionHint;
}
```

### 4. `src/browser/rendering/compositing/layer-compositor.ts` (~400 lines)

The main compositing engine. Takes a `LayerTree` and produces the final image.

```typescript
interface CompositorConfig {
  width: number;
  height: number;
  devicePixelRatio: number;
  backgroundColor: string;
  enableGpu: boolean;
  enableTileCulling: boolean;
  tileThreshold: number;    // Min layer size to enable tiling (default: 512)
}

class LayerCompositor {
  private layerTree: LayerTree;
  private config: CompositorConfig;
  private gpuRasterizer: GpuRasterizer | null;
  private softwareRasterizer: Rasterizer;
  private bufferPool: BufferPool | null;
  private computeOps: ComputeOps | null;
  
  constructor(config: CompositorConfig);
  
  /**
   * Full composite: re-rasterize all dirty layers, composite to final buffer.
   */
  composite(tree: LayerTree): ImageData;
  
  /**
   * Incremental composite: only re-rasterize dirty layers, re-use clean layer textures.
   */
  compositeIncremental(tree: LayerTree): ImageData;
  
  // Per-layer operations
  private rasterizeLayer(layer: CompositingLayer): void;
  private rasterizeLayerTiles(layer: CompositingLayer): void;
  
  // Final compositing
  private compositeLayerStack(
    layers: CompositingLayer[],
    framebuffer: Uint8ClampedArray,
  ): void;
  
  private compositeLayerGpu(
    layers: CompositingLayer[],
    framebuffer: GPUBuffer,
    encoder: GPUCommandEncoder,
  ): void;
  
  private compositeLayerSoftware(
    layers: CompositingLayer[],
    framebuffer: Uint8ClampedArray,
  ): void;
  
  // Per-layer alpha compositing (source-over)
  private alphaCompositeDstOverSrc(
    dst: Uint8ClampedArray, dstW: number,
    src: Uint8ClampedArray, srcW: number, srcH: number,
    dstX: number, dstY: number,
    opacity: number,
  ): void;
  
  resize(width: number, height: number): void;
  dispose(): void;
}
```

### 5. `src/browser/rendering/compositing/tile-grid.ts` (~250 lines)

Tile-based rendering for large compositing layers.

```typescript
const TILE_SIZE = 256;

interface Tile {
  readonly col: number;
  readonly row: number;
  x: number;           // Pixel position in layer
  y: number;
  width: number;
  height: number;
  isDirty: boolean;
  buffer: Uint8ClampedArray | null;  // Tile pixel data
  gpuBuffer: GPUBuffer | null;
}

class TileGrid {
  readonly layerId: string;
  readonly tileWidth: number;   // TILE_SIZE
  readonly tileHeight: number;  // TILE_SIZE
  readonly cols: number;
  readonly rows: number;
  private tiles: Tile[];
  
  constructor(layerWidth: number, layerHeight: number, layerId: string);
  
  // Mark specific tiles as dirty
  addDamage(x: number, y: number, w: number, h: number): void;
  
  // Get all dirty tiles
  getDirtyTiles(): Tile[];
  
  // Get tiles that intersect a viewport rect (for culling)
  getVisibleTiles(viewport: ViewportRect): Tile[];
  
  // After rasterization, clear dirty flags
  clearDirtyFlags(): void;
  
  // Composite all tiles into a layer buffer
  flattenToBuffer(): Uint8ClampedArray;
  
  // Dispose tile buffers
  dispose(): void;
}
```

### 6. `src/browser/rendering/compositing/layer-damage-tracker.ts` (~120 lines)

Layer-aware damage tracking. Tracks which layers are damaged and what regions within each layer.

```typescript
class LayerDamageTracker {
  private layerDamages: Map<string, DamageTracker>;  // layerId → damage
  
  addLayerDamage(layerId: string, x: number, y: number, w: number, h: number): void;
  addElementDamage(layerId: string, box: LayoutBox): void;
  
  isLayerDirty(layerId: string): boolean;
  getLayerDamage(layerId: string): DamageTracker | null;
  
  // Propagate: if a child layer is dirty, mark parent as dirty too
  propagateUp(layerTree: LayerTree): void;
  
  getDirtyLayerIds(): string[];
  isEmpty(): boolean;
  clear(): void;
  dispose(): void;
}
```

### 7. `src/browser/rendering/compositing/index.ts` (~15 lines)

Barrel exports for the compositing module.

---

## Files to Modify

### 8. `src/browser/rendering/formatting/stacking.ts` (~10 lines added)

Add `will-change` detection to `createsStackingContext()`:

```typescript
// In createsStackingContext():
// Add after the isolation check:
const willChange = style.get('will-change');
if (willChange) {
  const props = willChange.split(',').map(s => s.trim().toLowerCase());
  if (props.includes('transform') || props.includes('opacity') || props.includes('paint')) {
    return true;
  }
}
```

Also add `willChange` getter helper and expose it on the `StackingContext` interface for the promoter to read.

### 9. `src/browser/rendering/paint-engine.ts` (~100 lines added)

Add compositor integration alongside existing flat-paint path:

```typescript
// New methods:
compositeFrameWithLayers(): ImageData;      // Compositor-based rendering
setLayerCompositor(compositor: LayerCompositor): void;
getLayerTree(): LayerTree | null;

// Modified paint() method:
// After building stacking tree, also build LayerTree via LayerPromoter + LayerTree.fromStackingContext()

// Modified paintIncremental():
// Update per-layer damage instead of global element commands only
```

The existing `compositeFrame()` method remains unchanged for backward compatibility.

### 10. `src/browser/rendering/gpu/gpu-rasterizer.ts` (~80 lines added)

Add per-layer rasterization support:

```typescript
// New methods:
rasterizeLayer(layer: CompositingLayer): ImageData;
rasterizeLayerToBuffer(layer: CompositingLayer): Uint8ClampedArray;
compositeLayersToFrameBuffer(
  layers: CompositingLayer[],
  framebuffer: GPUBuffer,
  encoder: GPUCommandEncoder,
): void;
```

### 11. `src/browser/rendering/gpu/compute-ops.ts` (~30 lines added)

Add offset-aware composite operation for layer positioning:

```typescript
compositeWithOffset(
  dstBuffer: GPUBuffer, dstWidth: number,
  srcBuffer: GPUBuffer, srcWidth: number, srcHeight: number,
  offsetX: number, offsetY: number,
  opacity: number,
  encoder: GPUCommandEncoder,
): void;
```

### 12. `src/browser/rendering/gpu/shader-modules.ts` (~40 lines added)

Add a composite-with-offset WGSL shader:

```wgsl
// COMPOSITE_OFFSET_SHADER
// Like COMPOSITE_SHADER but supports src/dst offset and per-layer opacity
@group(0) @binding(0) var<storage, read_write> dstPixels: array<u32>;
@group(0) @binding(1) var<storage, read> srcPixels: array<u32>;
@group(0) @binding(2) var<uniform> params: Params;

struct Params {
  dstW: u32, dstH: u32,
  srcW: u32, srcH: u32,
  offsetX: i32, offsetY: i32,
  opacity: f32,
};
```

### 13. `src/browser/rendering/damage-tracker.ts` (~30 lines added)

Add layer-aware damage propagation:

```typescript
// New method:
addRegionIntersection(other: DamageTracker): void;
// Union with another tracker's regions
```

### 14. `src/browser/rendering/reflow-repaint-controller.ts` (~20 lines added)

Wire compositing into the incremental update loop:

```typescript
// Modified processFrame():
// After layoutIncremental → paintIncremental, also update LayerTree damage
// Call LayerCompositor.compositeIncremental() if available
```

### 15. `src/browser/rendering/dom-tree.ts` (~15 lines added)

Add `willChange` field to `DomElement` for easy access:

```typescript
interface DomElement extends DomNode {
  // ... existing fields ...
  /** Cached will-change computed value (populated by CSS cascade). */
  willChange: string | null;
}
```

### 16. `src/browser/rendering/formatting/types.ts` (~5 lines)

Add `willChange` to the list of parsed style properties if needed.

---

## Tests to Create

### 17. `tests/compositing/compositing-layer.test.ts` (~150 lines)

- CompositingLayer creation from StackingContext
- Bounds calculation from layoutBox
- Damage tracking per layer
- Visibility culling
- GPU buffer lifecycle
- Tile grid generation for large layers

### 18. `tests/compositing/layer-tree.test.ts` (~120 lines)

- LayerTree construction from stacking context tree
- findLayerById / findLayerByElement
- getCompositingOrder (z-index sort)
- getDirtyLayers
- Layer count

### 19. `tests/compositing/layer-promoter.test.ts` (~100 lines)

- Conservative promotion: will-change: transform → promote
- Conservative promotion: opacity < 1 → promote
- Conservative promotion: transform: translateX(10px) → promote
- Conservative promotion: filter: blur(1px) → promote
- Conservative promotion: isolation: isolate → promote
- No promotion: static element → no promote
- No promotion: positioned with z-index but no transform/opacity → no promote
- Large element promotion for tiling

### 20. `tests/compositing/tile-grid.test.ts` (~120 lines)

- TileGrid creation for 1024×768 layer → 4×3 tiles
- addDamage marks correct tiles dirty
- getDirtyTiles returns only dirty ones
- getVisibleTiles viewport culling
- flattenToBuffer combines tile data
- Small layer (< TILE_SIZE) → single tile

### 21. `tests/compositing/layer-compositor.test.ts` (~180 lines)

- composite() produces ImageData with correct dimensions
- Single layer compositing
- Multi-layer compositing in z-order
- Layer opacity (group compositing)
- Incremental composite: only dirty layers re-rasterized
- Software fallback when GPU unavailable
- Tile-based compositing for large layers
- Layer culling: off-screen layers skipped
- Alpha blending: transparent layer over opaque layer

### 22. `tests/compositing/layer-damage-tracker.test.ts` (~80 lines)

- Per-layer damage recording
- Layer dirty detection
- Damage propagation (child dirty → parent dirty)
- Clear per-layer
- Clear all

---

## Implementation Sequence

### Step 1: Core compositing layer + tree (files 1-3)
Create `compositing-layer.ts`, `layer-tree.ts`, `layer-promoter.ts` with full types and basic logic. These are pure data structures with no GPU dependencies.

### Step 2: Tile grid (file 5)
Create `tile-grid.ts` — independent of GPU, pure tile management logic.

### Step 3: Layer damage tracker (file 6)
Create `layer-damage-tracker.ts` — extends DamageTracker concepts to per-layer tracking.

### Step 4: Layer compositor (file 4)
Create `layer-compositor.ts` — the main engine. Initially software-only. Wire in the existing `Rasterizer` for per-layer rasterization and implement `alphaCompositeDstOverSrc()` for CPU compositing.

### Step 5: Modify stacking.ts (file 8)
Add `will-change` support to `createsStackingContext()`.

### Step 6: Modify paint-engine.ts (file 9)
Wire the new compositor into `PaintEngine`. Add `compositeFrameWithLayers()` and `setLayerCompositor()`. Build `LayerTree` during `paint()`.

### Step 7: GPU layer compositing (files 10-12)
Extend GPU pipeline: per-layer rasterization, composite-with-offset shader, `GpuLayerCompositor`.

### Step 8: Integration (files 13-16)
Wire into `ReflowRepaintController`, update `DamageTracker`, add `willChange` to `DomElement`.

### Step 9: Tests (files 17-22)
Write all test files. Run full suite to confirm no regressions.

### Step 10: Doc + analytics
Write `doc/2026-07-24-compositing-layers.md` session doc. Update `doc/README.md`.

---

## Risk Mitigation

1. **GPU unavailability:** All GPU operations have software fallback paths. `LayerCompositor` checks `enableGpu` and falls back to `Rasterizer` per-layer.
2. **Memory pressure:** TileGrid + BufferPool reuse. Max tile count capped. Layer textures released when layers are removed from tree.
3. **Backward compatibility:** Existing `compositeFrame()` path unchanged. New compositor is opt-in via `PaintEngine.setLayerCompositor()`.
4. **happy-dom limitations:** Tests construct DomElements manually with computedStyle Maps (same pattern as existing stacking.test.ts). No DOM rendering needed.
5. **Existing test regressions:** New files are additive. Only stacking.ts and paint-engine.ts are modified (small, targeted changes).

---

## Expected Test Count

- 6 new test files × ~125 avg tests = ~750 new compositing tests
- Existing tests: ~5255 passing → no regressions expected
- Total: ~6000+ tests
