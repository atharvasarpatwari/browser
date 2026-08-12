/**
 * @file ReflowRepaintController — Coordinates incremental layout and repaint.
 *
 * Ties together DamageTracker, FrameScheduler, ILayoutEngine, and IPaintEngine
 * into a single invalidation → schedule → process loop.  DOM mutations call
 * `invalidateLayout()` or `invalidatePaint()` to mark subtrees dirty, then
 * `requestFrame()` to coalesce and schedule the next update.
 */

import type { DomDocument, DomNode, IDomTree, DomElement } from './dom-tree';
import { DamageTracker } from './damage-tracker';
import { FrameScheduler } from './frame-scheduler';
import type { ILayoutEngine } from './layout-engine';
import type { IPaintEngine } from './paint-engine';
import type { LayerCompositor } from './compositing/layer-compositor';
import type { LayerTree } from './compositing/layer-tree';
import { AnimationTimeline } from './compositing/animation-engine';
import { CssAnimationAnimator } from './css-animations';

// ─── TYPES ──────────────────────────────────────────────────────────────────

export interface ReflowRepaintConfig {
  /** Viewport width in CSS pixels. */
  viewportWidth?: number;
  /** Viewport height in CSS pixels. */
  viewportHeight?: number;
}

// ─── CONTROLLER ─────────────────────────────────────────────────────────────

/**
 * Orchestrates incremental layout (reflow) and repaint cycles.
 *
 * Usage:
 *   const ctrl = new ReflowRepaintController(layoutEngine, paintEngine, domTree);
 *   ctrl.init(document);
 *
 *   // When DOM changes:
 *   ctrl.invalidateLayout(changedNode);
 *   ctrl.requestFrame();
 *
 *   // The controller will:
 *   //   1. Coalesce multiple invalidations via FrameScheduler
 *   //   2. Run incremental layout on dirty subtrees
 *   //   3. Run incremental paint on damaged regions
 *   //   4. Clear dirty flags
 */
export class ReflowRepaintController {
  private layoutDamage = new DamageTracker();
  private paintDamage = new DamageTracker();
  private scheduler = new FrameScheduler();
  private document: DomDocument | null = null;
  private viewportWidth: number;
  private viewportHeight: number;
  private processing = false;
  private layerCompositor: LayerCompositor | null = null;
  private lastCompositedImageData: ImageData | null = null;
  /** Optional callback for incremental style recalc before layout. */
  private _styleRecalcCallback: (() => void) | null = null;
  /** Optional callback invoked after each processed frame. */
  private _frameCallback: (() => void) | null = null;
  /** Animation timeline for ticking active animations each frame. */
  private _animationTimeline: AnimationTimeline = new AnimationTimeline();
  /** Optional animator bridging CSS/WAAPI animations into the paint loop. */
  private _animator: CssAnimationAnimator | null = null;

  constructor(
    private layoutEngine: ILayoutEngine,
    private paintEngine: IPaintEngine,
    private domTree: IDomTree,
    config?: ReflowRepaintConfig,
  ) {
    this.viewportWidth = config?.viewportWidth ?? 1920;
    this.viewportHeight = config?.viewportHeight ?? 1080;
  }

  /** Initialize the controller with a document. Must be called before invalidation. */
  init(document: DomDocument): void {
    this.document = document;
    this.layoutDamage.clear();
    this.paintDamage.clear();
  }

  /** Update viewport dimensions (e.g. on window resize). */
  setViewport(width: number, height: number): void {
    this.viewportWidth = width;
    this.viewportHeight = height;
  }

  // ── Style Recalc ──────────────────────────────────────────────────

  /**
   * Set a callback that performs incremental style recalculation.
   * Called once per processFrame() before incremental layout, so dirty
   * styles are resolved before layout consumes them.
   */
  setStyleRecalcCallback(cb: (() => void) | null): void {
    this._styleRecalcCallback = cb;
  }

  /**
   * Set a callback invoked after every processed frame.
   * Useful for pushing the composited result to the UI (page repaint).
   */
  setFrameCallback(cb: (() => void) | null): void {
    this._frameCallback = cb;
  }

  /**
   * Set the animation animator that bridges CSS @keyframes / Web Animations
   * API into the paint loop. When animations are active, the controller keeps
   * scheduling frames so animated values reach the rasterizer.
   */
  setAnimationAnimator(animator: CssAnimationAnimator | null): void {
    this._animator = animator;
  }

  getAnimationAnimator(): CssAnimationAnimator | null {
    return this._animator;
  }

  // ── Invalidation ──────────────────────────────────────────────────

  /** Mark a subtree as needing re-layout. */
  invalidateLayout(node: DomNode): void {
    this.markDirty(node, 'layout');
  }

  /** Mark a subtree as needing repaint only (no layout change). */
  invalidatePaint(node: DomNode): void {
    this.markDirty(node, 'paint');
  }

  /**
   * Schedule a frame that will process all pending layout and paint damage.
   * Multiple calls are coalesced — only one frame fires per animation frame.
   */
  requestFrame(): void {
    if (!this.document) return;
    this.scheduler.schedule(() => this.processFrame());
  }

  /** Cancel a pending frame if one is scheduled. */
  cancelFrame(): void {
    this.scheduler.cancel();
  }

  /** Whether a frame is currently pending. */
  isScheduled(): boolean {
    return this.scheduler.isScheduled();
  }

  /** Number of frames processed since init. */
  getFrameCount(): number {
    return this.scheduler.getFrameCount();
  }

  // ── Compositor Integration ──────────────────────────────────────

  /**
   * Set a LayerCompositor for layer-based compositing.
   * When set, processFrame() will use the compositor for the final image.
   */
  setLayerCompositor(compositor: LayerCompositor): void {
    this.layerCompositor = compositor;
  }

  /**
   * Get the most recently composited ImageData.
   */
  getLastCompositedImageData(): ImageData | null {
    return this.lastCompositedImageData;
  }

  // ── Processing ────────────────────────────────────────────────────

  /**
   * Process a single frame: re-layout dirty subtrees, then re-paint
   * damaged regions.  Clears all dirty flags when done.
   */
  processFrame(): void {
    if (!this.document || this.processing) return;
    this.processing = true;

    try {
      // 0. Tick animations so animated values are current before style recalc
      this._animationTimeline.tick(performance.now());

      // 1. Incremental style recalc (resolves _dirtyStyle before layout)
      if (this._styleRecalcCallback) {
        this._styleRecalcCallback();
      }

      // 1.5. Sync CSS animations (create/destroy from computed styles) so
      //      animated values are resolved before layout/paint consume them.
      this._animator?.sync(this.document);

      // 2. Incremental layout — returns the layout damage tracker
      const layoutDamage = this.layoutEngine.layoutIncremental(
        this.document,
        this.domTree,
        { viewportWidth: this.viewportWidth, viewportHeight: this.viewportHeight },
      );

      // 3. Incremental paint — uses layout damage to know what to repaint
      this.paintEngine.paintIncremental(this.document, layoutDamage);

      // 4. If a layer compositor is available, use layer-based compositing
      if (this.layerCompositor) {
        const layerTree = (this.paintEngine as { getLayerTree?(): import('./compositing/layer-tree').LayerTree | null }).getLayerTree?.();
        if (layerTree) {
          this.lastCompositedImageData = this.layerCompositor.compositeIncremental(layerTree);
        }
      }

      // 5. Clear paint damage after successful paint
      this.paintDamage.clear();
    } finally {
      this.processing = false;
    }

    // 6. Notify listeners that a frame was processed (page repaint).
    try {
      this._frameCallback?.();
    } catch {
      // Listener errors must not break the reflow loop.
    }

    // 7. Keep the frame loop alive while animations are producing frames.
    if (this._animator?.hasActiveAnimations()) {
      this.requestFrame();
    }
  }

  // ── Private ───────────────────────────────────────────────────────

  /**
   * Walk up from the given node and set dirty flags on all ancestors.
   * 'layout' also implies 'paint' since layout changes affect rendering.
   */
  private markDirty(node: DomNode, type: 'layout' | 'paint'): void {
    let current: DomNode | null = node;
    while (current) {
      if (type === 'layout') {
        (current as DomElement)._dirtyLayout = true;
      }
      (current as DomElement)._dirtyPaint = true;
      current = current.parent;
    }
  }

  /** Get the animation timeline for this controller. */
  get animationTimeline(): AnimationTimeline {
    return this._animationTimeline;
  }

  /** Release all resources. After dispose(), the controller must not be reused. */
  dispose(): void {
    this.cancelFrame();
    this.layoutDamage.clear();
    this.paintDamage.clear();
    this.document = null;
    this.processing = false;
    this.lastCompositedImageData = null;
    this._animator?.dispose();
    this._animator = null;
    this._animationTimeline.dispose();
  }
}
