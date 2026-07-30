import { LayerCompositor } from './layer-compositor';
import { LayerTree } from './layer-tree';
import type { CompositingLayer } from './compositing-layer';
import { ScrollCompositor, type ScrollableContainer } from './scroll-compositor';
import { AnimationTimeline, Animation, type KeyframeEffect, type Keyframe } from './animation-engine';
import { type DOMMatrix4x4, identity4x4, multiply4x4, parseTransform } from './transform-parser';

export interface CompositorFrameSnapshot {
  readonly layerTree: LayerTree;
  readonly scrollContainers: readonly ScrollableContainer[];
  readonly viewportX: number;
  readonly viewportY: number;
  readonly viewportWidth: number;
  readonly viewportHeight: number;
  readonly timestamp: number;
  readonly dirtyLayers: readonly string[];
}

export enum FrameStatus {
  Pending = 'pending',
  Processing = 'processing',
  Completed = 'completed',
  Skipped = 'skipped',
}

export interface FrameResult {
  readonly id: number;
  readonly status: FrameStatus;
  readonly imageData: ImageData | null;
  readonly duration: number;
  readonly timestamp: number;
}

export type FrameCallback = (result: FrameResult) => void;

export class CompositorThread {
  private _nextFrameId = 1;
  private _compositor: LayerCompositor;
  private _scrollCompositor: ScrollCompositor;
  private _animationTimeline: AnimationTimeline;
  private _pendingFrame: CompositorFrameSnapshot | null = null;
  private _processing = false;
  private _scheduled = false;
  private _frameCallbacks = new Map<number, FrameCallback>();
  private _lastResult: FrameResult | null = null;
  private _frameCount = 0;
  private _totalCompositeTime = 0;
  private _vsyncEnabled = false;
  private _vsyncId: ReturnType<typeof setTimeout> | null = null;
  private _vsyncInterval: number;

  constructor(
    compositor: LayerCompositor,
    scrollCompositor?: ScrollCompositor,
    animationTimeline?: AnimationTimeline,
    vsyncInterval: number = 16,
  ) {
    this._compositor = compositor;
    this._scrollCompositor = scrollCompositor ?? new ScrollCompositor();
    this._animationTimeline = animationTimeline ?? new AnimationTimeline();
    this._vsyncInterval = vsyncInterval;
  }

  get compositor(): LayerCompositor { return this._compositor; }
  get scrollCompositor(): ScrollCompositor { return this._scrollCompositor; }
  get animationTimeline(): AnimationTimeline { return this._animationTimeline; }
  get lastResult(): FrameResult | null { return this._lastResult; }
  get frameCount(): number { return this._frameCount; }
  get isProcessing(): boolean { return this._processing; }
  get hasPendingFrame(): boolean { return this._pendingFrame !== null; }

  get averageCompositeTime(): number {
    return this._frameCount > 0 ? this._totalCompositeTime / this._frameCount : 0;
  }

  scheduleFrame(
    layerTree: LayerTree,
    scrollContainers?: readonly ScrollableContainer[],
    viewportX: number = 0,
    viewportY: number = 0,
    viewportWidth?: number,
    viewportHeight?: number,
  ): void {
    this._pendingFrame = {
      layerTree,
      scrollContainers: scrollContainers ?? [],
      viewportX,
      viewportY,
      viewportWidth: viewportWidth ?? this._compositor['config'].width,
      viewportHeight: viewportHeight ?? this._compositor['config'].height,
      timestamp: performance.now(),
      dirtyLayers: layerTree.getDirtyLayers().map(l => l.id),
    };

    if (!this._scheduled) {
      this._scheduled = true;
      this.scheduleProcess();
    }
  }

  onFrameResult(callback: FrameCallback): number {
    const id = this._nextFrameId++;
    this._frameCallbacks.set(id, callback);
    return id;
  }

  removeFrameCallback(id: number): void {
    this._frameCallbacks.delete(id);
  }

  enableVSync(): void {
    if (this._vsyncEnabled) return;
    this._vsyncEnabled = true;
    this.startVSyncLoop();
  }

  disableVSync(): void {
    this._vsyncEnabled = false;
    if (this._vsyncId !== null) {
      clearTimeout(this._vsyncId);
      this._vsyncId = null;
    }
  }

  requestAnimationFrame(callback: FrameCallback): number {
    return this.onFrameResult(callback);
  }

  resize(width: number, height: number): void {
    this._compositor.resize(width, height);
  }

  dispose(): void {
    this.disableVSync();
    this._pendingFrame = null;
    this._frameCallbacks.clear();
    this._scrollCompositor.dispose();
    this._animationTimeline.dispose();
    this._compositor.dispose();
  }

  private scheduleProcess(): void {
    queueMicrotask(() => {
      this.processFrame();
    });
  }

  private processFrame(): void {
    if (this._processing) {
      this._scheduled = true;
      return;
    }

    const snapshot = this._pendingFrame;
    if (!snapshot) {
      this._scheduled = false;
      return;
    }

    this._pendingFrame = null;
    this._scheduled = false;
    this._processing = true;

    const frameId = this._nextFrameId++;
    const startTime = performance.now();

    try {
      // Tick animations first so animated values are up to date for this frame
      this._animationTimeline.tick(performance.now());

      for (const container of snapshot.scrollContainers) {
        this._scrollCompositor.registerContainer(container);
      }

      const layers = snapshot.layerTree.getCompositingOrder();
      for (const layer of layers) {
        this.applyCompositedProperties(layer);
      }

      const imageData = this._compositor.compositeIncremental(snapshot.layerTree);

      const duration = performance.now() - startTime;
      this._frameCount++;
      this._totalCompositeTime += duration;

      const result: FrameResult = {
        id: frameId,
        status: FrameStatus.Completed,
        imageData,
        duration,
        timestamp: snapshot.timestamp,
      };

      this._lastResult = result;
      this.notifyCallbacks(result);
    } catch (error) {
      const duration = performance.now() - startTime;
      const result: FrameResult = {
        id: frameId,
        status: FrameStatus.Skipped,
        imageData: null,
        duration,
        timestamp: snapshot.timestamp,
      };
      this._lastResult = result;
      this.notifyCallbacks(result);
    } finally {
      this._processing = false;
    }
  }

  private applyCompositedProperties(layer: CompositingLayer): void {
    const style = layer.sourceElement.computedStyle ?? new Map();

    const transformStr = style.get('transform') ?? 'none';
    const parsed = parseTransform(transformStr);
    const layerTransform: DOMMatrix4x4 = parsed ? parsed.matrix : identity4x4();

    const scrollTransform = this._scrollCompositor.applyScrollOffset(layer, layerTransform);

    const isIdent = (m: DOMMatrix4x4): boolean => {
      return m.m11 === 1 && m.m12 === 0 && m.m13 === 0 && m.m14 === 0 &&
        m.m21 === 0 && m.m22 === 1 && m.m23 === 0 && m.m24 === 0 &&
        m.m31 === 0 && m.m32 === 0 && m.m33 === 1 && m.m34 === 0 &&
        m.m41 === 0 && m.m42 === 0 && m.m43 === 0 && m.m44 === 1;
    };

    if (!isIdent(scrollTransform)) {
      const offsetX = scrollTransform.m41;
      const offsetY = scrollTransform.m42;
      if (offsetX !== 0 || offsetY !== 0) {
        layer.bounds = {
          x: layer.bounds.x + offsetX,
          y: layer.bounds.y + offsetY,
          width: layer.bounds.width,
          height: layer.bounds.height,
        };
        layer.addDamage(0, 0, layer.bounds.width, layer.bounds.height);
      }
    }
  }

  private notifyCallbacks(result: FrameResult): void {
    for (const cb of this._frameCallbacks.values()) {
      try {
        cb(result);
      } catch {
        // handler errors are silently caught
      }
    }
  }

  private startVSyncLoop(): void {
    if (!this._vsyncEnabled) return;
    this._vsyncId = setTimeout(() => {
      if (!this._vsyncEnabled) return;

      if (this._pendingFrame && !this._processing) {
        this.processFrame();
      }

      this.startVSyncLoop();
    }, this._vsyncInterval);
  }
}
