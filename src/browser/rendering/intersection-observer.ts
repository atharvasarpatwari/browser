import type { DomElement } from './dom-tree';
import type { LayoutBox } from './dom-tree';
import { FrameScheduler } from './frame-scheduler';

// ─────────────────────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────────────────────

export interface ViewportRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface IntersectionObserverEntry {
  readonly target: DomElement;
  readonly boundingClientRect: ViewportRect;
  readonly intersectionRect: ViewportRect;
  readonly rootBounds: ViewportRect | null;
  readonly intersectionRatio: number;
  readonly isIntersecting: boolean;
  readonly time: number;
}

export type IntersectionObserverCallback = (
  entries: readonly IntersectionObserverEntry[],
  observer: IntersectionObserver,
) => void;

export interface IntersectionObserverOptions {
  /** The element used as the viewport for checking visibility. Null = viewport. */
  root?: DomElement | null;
  /** Margin around the root (e.g., "100px", "100px 200px", "10%"). */
  rootMargin?: string;
  /** Array of thresholds (0..1) at which the callback fires. */
  threshold?: number | readonly number[];
}

// ─────────────────────────────────────────────────────────────────────────────
// ROOT MARGIN PARSING
// ─────────────────────────────────────────────────────────────────────────────

interface ParsedMargin {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

function parseMargin(value: string): ParsedMargin {
  const parts = value.trim().split(/\s+/).map(s => {
    const num = parseFloat(s);
    return isNaN(num) ? 0 : num;
  });

  switch (parts.length) {
    case 1: return { top: parts[0]!, right: parts[0]!, bottom: parts[0]!, left: parts[0]! };
    case 2: return { top: parts[0]!, right: parts[1]!, bottom: parts[0]!, left: parts[1]! };
    case 3: return { top: parts[0]!, right: parts[1]!, bottom: parts[2]!, left: parts[1]! };
    case 4: return { top: parts[0]!, right: parts[1]!, bottom: parts[2]!, left: parts[3]! };
    default: return { top: 0, right: 0, bottom: 0, left: 0 };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// RECTANGLE UTILITIES
// ─────────────────────────────────────────────────────────────────────────────

function intersectRects(a: ViewportRect, b: ViewportRect): ViewportRect {
  const x = Math.max(a.x, b.x);
  const y = Math.max(a.y, b.y);
  const w = Math.min(a.x + a.width, b.x + b.width) - x;
  const h = Math.min(a.y + a.height, b.y + b.height) - y;
  return { x, y, width: Math.max(0, w), height: Math.max(0, h) };
}

function rectArea(r: ViewportRect): number {
  return Math.max(0, r.width) * Math.max(0, r.height);
}

function offsetRect(r: ViewportRect, dx: number, dy: number): ViewportRect {
  return { x: r.x + dx, y: r.y + dy, width: r.width, height: r.height };
}

// ─────────────────────────────────────────────────────────────────────────────
// INTERSECTION OBSERVER
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Software IntersectionObserver — detects when DOM elements enter or leave
 * the visible viewport (or a custom root element).
 *
 * Uses the LayoutEngine's layout boxes to determine element positions and
 * sizes. Checks intersections on each animation frame via FrameScheduler.
 *
 * Implements the core subset of the W3C Intersection Observer spec:
 * - root (null = viewport, or a container element)
 * - rootMargin (expands/shrinks the observation area)
 * - threshold (array of ratios at which to fire)
 */
export class IntersectionObserver {
  private callback: IntersectionObserverCallback;
  private root: DomElement | null;
  private readonly rootMargin: ParsedMargin;
  private readonly thresholds: readonly number[];
  private readonly observed = new Map<DomElement, ViewportRect>();
  private readonly previousRatios = new Map<DomElement, number>();
  private scheduler: FrameScheduler | null = null;
  private disposed = false;

  /** Viewport dimensions — updated externally. */
  private viewportWidth = 1920;
  private viewportHeight = 1080;

  /** Scroll position of the root (viewport or element). */
  private scrollX = 0;
  private scrollY = 0;

  constructor(callback: IntersectionObserverCallback, options?: IntersectionObserverOptions) {
    this.callback = callback;
    this.root = options?.root ?? null;
    this.rootMargin = parseMargin(options?.rootMargin ?? '0px');

    const t = options?.threshold;
    if (t === undefined) {
      this.thresholds = [0];
    } else if (typeof t === 'number') {
      this.thresholds = [t];
    } else {
      this.thresholds = [...t].sort((a, b) => a - b);
    }
  }

  // ── Public API ──────────────────────────────────────────────────────

  /** Begin observing a target element. Fires the callback immediately with the initial state. */
  observe(target: DomElement): void {
    if (this.disposed) return;
    if (this.observed.has(target)) return;

    this.observed.set(target, this.getElementRect(target));
    // Don't set previousRatios yet — let computeEntries detect "first observation"

    // Fire initial entry synchronously
    const entries = this.computeEntries();
    if (entries.length > 0) {
      this.callback(entries, this);
    }

    this.ensureRunning();
  }

  /** Stop observing a target element. */
  unobserve(target: DomElement): void {
    this.observed.delete(target);
    this.previousRatios.delete(target);
    if (this.observed.size === 0) this.stop();
  }

  /** Stop observing all elements and release resources. */
  disconnect(): void {
    this.observed.clear();
    this.previousRatios.clear();
    this.stop();
  }

  /** Take a shallow records snapshot (returns current entries). */
  takeRecords(): readonly IntersectionObserverEntry[] {
    return this.computeEntries();
  }

  /** Update the viewport dimensions. */
  setViewport(width: number, height: number): void {
    this.viewportWidth = width;
    this.viewportHeight = height;
  }

  /** Update scroll position. */
  setScroll(x: number, y: number): void {
    this.scrollX = x;
    this.scrollY = y;
  }

  /** Whether this observer is currently tracking elements. */
  get active(): boolean {
    return this.observed.size > 0;
  }

  dispose(): void {
    this.disposed = true;
    this.disconnect();
    this.root = null;
    this.callback = null as any;
  }

  // ── Frame scheduling ────────────────────────────────────────────────

  private ensureRunning(): void {
    if (this.scheduler) return;
    this.scheduler = new FrameScheduler();
    this.scheduler.schedule(() => this.tick());
  }

  private stop(): void {
    if (this.scheduler) {
      this.scheduler.cancel();
      this.scheduler = null;
    }
  }

  private tick(): void {
    if (this.disposed || this.observed.size === 0) {
      this.stop();
      return;
    }

    const entries = this.computeEntries();
    if (entries.length > 0) {
      this.callback(entries, this);
    }

    this.ensureRunning();
  }

  // ── Intersection computation ────────────────────────────────────────

  private computeEntries(): IntersectionObserverEntry[] {
    const entries: IntersectionObserverEntry[] = [];
    const rootBounds = this.getRootBounds();
    const now = typeof performance !== 'undefined' ? performance.now() : Date.now();

    for (const [target] of this.observed) {
      const targetRect = this.getElementRect(target);
      this.observed.set(target, targetRect);

      const expandedRoot = expandRect(rootBounds, this.rootMargin);
      const intersection = intersectRects(targetRect, expandedRoot);

      const targetArea = rectArea(targetRect);
      const intersectionRatio = targetArea > 0
        ? rectArea(intersection) / targetArea
        : targetArea === 0 && rectArea(intersection) === 0 ? 0 : 1;

      const prevRatio = this.previousRatios.get(target) ?? 0;

      // Fire when crossing a threshold boundary
      let shouldFire = false;
      for (const threshold of this.thresholds) {
        if ((prevRatio < threshold && intersectionRatio >= threshold) ||
            (prevRatio >= threshold && intersectionRatio < threshold)) {
          shouldFire = true;
          break;
        }
      }

      // Also fire when first observed (ratio 0 → whatever)
      if (!this.previousRatios.has(target)) {
        shouldFire = true;
      }

      this.previousRatios.set(target, intersectionRatio);

      if (shouldFire) {
        const isIntersecting = intersectionRatio > 0;
        entries.push({
          target,
          boundingClientRect: targetRect,
          intersectionRect: intersection,
          rootBounds: this.root ? null : rootBounds,
          intersectionRatio,
          isIntersecting,
          time: now,
        });
      }
    }

    return entries;
  }

  private getRootBounds(): ViewportRect {
    if (this.root) {
      const box = this.root.layoutBox;
      if (box) {
        return {
          x: this.scrollX,
          y: this.scrollY,
          width: box.width,
          height: box.height,
        };
      }
    }
    return {
      x: this.scrollX,
      y: this.scrollY,
      width: this.viewportWidth,
      height: this.viewportHeight,
    };
  }

  private getElementRect(el: DomElement): ViewportRect {
    const box = el.layoutBox;
    if (box) {
      return {
        x: box.x,
        y: box.y,
        width: box.width,
        height: box.height,
      };
    }
    return { x: 0, y: 0, width: 0, height: 0 };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────

function expandRect(rect: ViewportRect, margin: ParsedMargin): ViewportRect {
  return {
    x: rect.x - margin.left,
    y: rect.y - margin.top,
    width: rect.width + margin.left + margin.right,
    height: rect.height + margin.top + margin.bottom,
  };
}

export { expandRect, parseMargin, intersectRects, rectArea, offsetRect };
