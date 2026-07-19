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

  // ── Processing ────────────────────────────────────────────────────

  /**
   * Process a single frame: re-layout dirty subtrees, then re-paint
   * damaged regions.  Clears all dirty flags when done.
   */
  processFrame(): void {
    if (!this.document || this.processing) return;
    this.processing = true;

    try {
      // 1. Incremental layout — returns the layout damage tracker
      const layoutDamage = this.layoutEngine.layoutIncremental(
        this.document,
        this.domTree,
        { width: this.viewportWidth, height: this.viewportHeight },
      );

      // 2. Incremental paint — uses layout damage to know what to repaint
      this.paintEngine.paintIncremental(this.document, layoutDamage);

      // 3. Clear paint damage after successful paint
      this.paintDamage.clear();
    } finally {
      this.processing = false;
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

  /** Release all resources. After dispose(), the controller must not be reused. */
  dispose(): void {
    this.cancelFrame();
    this.layoutDamage.clear();
    this.paintDamage.clear();
    this.document = null;
    this.processing = false;
  }
}
