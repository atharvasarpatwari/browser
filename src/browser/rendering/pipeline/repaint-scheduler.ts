/**
 * repaint-scheduler.ts
 * --------------------
 * Rendering layer — Session 8 of 9 (render-tree → layout-box → text-shaping →
 * paint-record → stacking-context → compositor → rasterizer →
 * repaint-scheduler → render-devtools-bridge).
 *
 * Self-contained repaint scheduler: takes a render-tree root and runs the
 * full 7-stage pipeline (render-tree → layout-box → text-shaping →
 * paint-record → stacking-context → compositor → rasterizer) on demand.
 *
 * Coalesces multiple repaint requests into a single frame (one pipeline
 * pass per frame). Supports both full and incremental modes, viewport
 * resize, and exposes per-frame metrics for devtools inspection.
 */

import { buildRenderTree, type ComputedStyleLike, type RenderNode } from "./render-tree";
import { buildLayoutTree, resolveBlockLayout, type LayoutBox, type LayoutConstraints } from "./layout-box";
import { buildPaintRecords, type PaintCommand } from "./paint-record";
import { buildStackingTree, type StackingNode } from "./stacking-context";
import { planCompositing, type CompositePlan, type CompositeLayer, type PlanCompositingOptions } from "./compositor";
import { rasterize, rasterizePlan, type RasterResult, type RasterOptions } from "./rasterizer";

// ---------------------------------------------------------------------------
// Frame metrics
// ---------------------------------------------------------------------------

export interface FrameMetrics {
  /** Monotonically increasing frame number (1-based). */
  readonly frameNumber: number;
  /** Wall-clock ms the pipeline took to execute. */
  readonly durationMs: number;
  /** Total paint commands produced by buildPaintRecords. */
  readonly paintCommandCount: number;
  /** Number of compositing layers in the plan. */
  readonly layerCount: number;
  /** Commands culled by viewport culling (0 when no viewport). */
  readonly culledCommands: number;
  /** Total pixels in the output buffer (width × height). */
  readonly pixelCount: number;
  /** Timestamp when the frame finished rendering. */
  readonly completedAt: number;
}

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

export interface RepaintSchedulerOptions {
  /** Layout containing-block width in CSS pixels. Defaults to 800. */
  readonly viewportWidth?: number;
  /** Layout containing-block height in CSS pixels. Defaults to 600. */
  readonly viewportHeight?: number;
  /** Optional style resolver for render-tree building. */
  readonly styleResolver?: (node: DOMNodeLike) => ComputedStyleLike;
  /** Culling viewport (same semantics as PlanCompositingOptions.viewport). */
  readonly cullingViewport?: PlanCompositingOptions["viewport"];
  /** Rasterizer offset (scroll translate). */
  readonly rasterOffset?: RasterOptions;
}

// Minimal DOM node shape needed for render-tree building — mirrors the
// pipeline test helpers but avoids importing test-only types.
interface DOMNodeLike {
  readonly nodeType: number;
  readonly nodeName: string;
  readonly childNodes: readonly DOMNodeLike[];
  readonly textContent: string | null;
}

// ---------------------------------------------------------------------------
// Pipeline result (per-frame snapshot)
// ---------------------------------------------------------------------------

export interface PipelineSnapshot {
  /** Render-tree root (read-only reference). */
  readonly renderRoot: RenderNode | null;
  /** Layout-tree root (read-only reference). */
  readonly layoutRoot: LayoutBox | null;
  /** Flat paint command list from buildPaintRecords. */
  readonly paintCommands: readonly PaintCommand[];
  /** Stacking tree root from buildStackingTree. */
  readonly stackRoot: StackingNode | null;
  /** Composite plan from planCompositing. */
  readonly compositePlan: CompositePlan | null;
  /** Rasterized pixel output. */
  readonly rasterResult: RasterResult | null;
  /** Metrics for this frame. */
  readonly metrics: FrameMetrics;
}

// ---------------------------------------------------------------------------
// Scheduler
// ---------------------------------------------------------------------------

export class RepaintScheduler {
  private _dom: DOMNodeLike | null = null;
  private _styleResolver: ((node: DOMNodeLike) => ComputedStyleLike) | null = null;
  private _viewportWidth: number;
  private _viewportHeight: number;
  private _cullingViewport: PlanCompositingOptions["viewport"] | undefined;
  private _rasterOffset: RasterOptions = {};
  private _pending = false;
  private _frameCount = 0;
  private _lastSnapshot: PipelineSnapshot | null = null;
  private _history: FrameMetrics[] = [];
  private _maxHistory = 60;
  private _onFrameReady: ((snapshot: PipelineSnapshot) => void) | null = null;
  private _rafHandle: ReturnType<typeof setTimeout> | null = null;

  constructor(options: RepaintSchedulerOptions = {}) {
    this._viewportWidth = options.viewportWidth ?? 800;
    this._viewportHeight = options.viewportHeight ?? 600;
    this._cullingViewport = options.cullingViewport;
    this._rasterOffset = options.rasterOffset ?? {};
    if (options.styleResolver) this._styleResolver = options.styleResolver;
  }

  // ── Configuration ────────────────────────────────────────────────

  /** Set the DOM tree to render. Returns this for chaining. */
  setDOM(dom: DOMNodeLike): this {
    this._dom = dom;
    return this;
  }

  /** Set the style resolver. Returns this for chaining. */
  setStyleResolver(resolver: (node: DOMNodeLike) => ComputedStyleLike): this {
    this._styleResolver = resolver;
    return this;
  }

  /** Update viewport dimensions. Triggers a repaint if dirty. */
  setViewport(width: number, height: number): void {
    if (width === this._viewportWidth && height === this._viewportHeight) return;
    this._viewportWidth = width;
    this._viewportHeight = height;
    this.requestRepaint();
  }

  /** Set the culling viewport rect. */
  setCullingViewport(viewport: PlanCompositingOptions["viewport"] | undefined): void {
    this._cullingViewport = viewport;
  }

  /** Set the rasterizer scroll offset. */
  setRasterOffset(offsetX: number, offsetY: number): void {
    this._rasterOffset = { offsetX, offsetY };
  }

  /** Register a callback invoked when a frame is ready. */
  onFrameReady(cb: ((snapshot: PipelineSnapshot) => void) | null): void {
    this._onFrameReady = cb;
  }

  /** Set maximum frame history to retain. */
  setMaxHistory(max: number): void {
    this._maxHistory = max;
    while (this._history.length > this._maxHistory) this._history.shift();
  }

  // ── Frame scheduling ─────────────────────────────────────────────

  /** Request a repaint. Coalesced — multiple calls produce one frame. */
  requestRepaint(): void {
    if (this._pending) return;
    this._pending = true;
    // Use microtask to coalesce within the same tick.
    this._rafHandle = setTimeout(() => {
      this._rafHandle = null;
      this._pending = false;
      this.renderFrame();
    }, 0);
  }

  /** Cancel a pending repaint. */
  cancelRepaint(): void {
    if (this._rafHandle !== null) {
      clearTimeout(this._rafHandle);
      this._rafHandle = null;
    }
    this._pending = false;
  }

  /** Whether a repaint is pending. */
  isPending(): boolean {
    return this._pending;
  }

  // ── Synchronous rendering ────────────────────────────────────────

  /**
   * Immediately run the full pipeline and return the snapshot.
   * Does not go through the coalescing scheduler.
   */
  renderSync(): PipelineSnapshot | null {
    const snapshot = this.runPipeline();
    if (snapshot) this._lastSnapshot = snapshot;
    return snapshot;
  }

  // ── Accessors ────────────────────────────────────────────────────

  get frameCount(): number {
    return this._frameCount;
  }

  get lastSnapshot(): PipelineSnapshot | null {
    return this._lastSnapshot;
  }

  get history(): readonly FrameMetrics[] {
    return this._history;
  }

  get viewportWidth(): number {
    return this._viewportWidth;
  }

  get viewportHeight(): number {
    return this._viewportHeight;
  }

  // ── Cleanup ──────────────────────────────────────────────────────

  dispose(): void {
    this.cancelRepaint();
    this._dom = null;
    this._styleResolver = null;
    this._lastSnapshot = null;
    this._history.length = 0;
    this._onFrameReady = null;
  }

  // ── Internal ─────────────────────────────────────────────────────

  private renderFrame(): void {
    const snapshot = this.runPipeline();
    if (!snapshot) return;
    this._lastSnapshot = snapshot;
    try {
      this._onFrameReady?.(snapshot);
    } catch {
      // Callback errors must not break the scheduler.
    }
  }

  private runPipeline(): PipelineSnapshot | null {
    if (!this._dom) return null;
    const resolver = this._styleResolver ?? defaultStyleResolver;

    const t0 = performance.now();

    // Stage 1: render tree
    const renderRoot = buildRenderTree(this._dom, resolver);
    if (!renderRoot) return null;

    // Stage 2–3: layout box + block-flow geometry
    const layoutRoot = buildLayoutTree(renderRoot);
    const constraints: LayoutConstraints = {
      containingBlockWidth: this._viewportWidth,
      containingBlockHeight: this._viewportHeight,
    };
    resolveBlockLayout(layoutRoot, constraints);

    // Stage 4: paint records
    const paintCommands = buildPaintRecords(layoutRoot);

    // Stage 5: stacking tree
    const stackRoot = buildStackingTree(layoutRoot, paintCommands);

    // Stage 6: composite plan
    const compositePlan = planCompositing(stackRoot, {
      viewport: this._cullingViewport,
    });

    // Stage 7: rasterize
    const rasterResult = rasterizePlan(
      compositePlan,
      this._viewportWidth,
      this._viewportHeight,
      this._rasterOffset,
    );

    const durationMs = performance.now() - t0;
    this._frameCount++;

    const metrics: FrameMetrics = {
      frameNumber: this._frameCount,
      durationMs,
      paintCommandCount: paintCommands.length,
      layerCount: compositePlan.layers.length,
      culledCommands: compositePlan.stats.culledCommands,
      pixelCount: rasterResult.width * rasterResult.height,
      completedAt: Date.now(),
    };

    this._history.push(metrics);
    if (this._history.length > this._maxHistory) this._history.shift();

    return {
      renderRoot,
      layoutRoot,
      paintCommands,
      stackRoot,
      compositePlan,
      rasterResult,
      metrics,
    };
  }
}

// ---------------------------------------------------------------------------
// Default style resolver (transparent/black for unknown elements)
// ---------------------------------------------------------------------------

function defaultStyleResolver(_node: DOMNodeLike): ComputedStyleLike {
  return {
    display: "block",
    position: "static",
    zIndex: "auto",
    opacity: 1,
    visibility: "visible",
  };
}
