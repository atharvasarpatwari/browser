import type { IDisposable } from '../../../app/dependency-container';
import type { FindMatch, FindRect } from '../../../browser/navigation-controls/find-in-page';

interface ViewTransform {
  readonly scale: number;
  readonly offsetX: number;
  readonly offsetY: number;
  /** How far the page is scrolled: the bitmap shows the page from this row down. Page coordinates are document coordinates. */
  readonly scrollY?: number;
}

/** The page's vertical scroll, as the overlays need it. */
interface ScrollView {
  readonly y: number;
  /** The whole page's height (the bitmap shows one viewport of it). */
  readonly documentHeight: number;
  /** Rows of the page the bitmap shows. */
  readonly viewportHeight?: number;
}

/**
 * Where to scroll so `rect` (page coordinates) can be seen: null when it already is (with a margin of a tenth of the
 * viewport), otherwise the offset that centres it. Null as well for a page that does not scroll.
 */
function scrollToReveal(rect: FindRect, view: ScrollView): number | null {
  const viewport = view.viewportHeight ?? 0;
  if (viewport <= 0 || view.documentHeight <= viewport) return null;
  const margin = viewport * 0.1;
  if (rect.y >= view.y + margin && rect.y + rect.height <= view.y + viewport - margin) return null;
  return Math.max(0, rect.y + rect.height / 2 - viewport / 2);
}

/** Where a `frame`-sized image lands inside a `box` with CSS `object-fit: contain`, showing the page scrolled to `scrollY`. */
function computeViewTransform(
  box: { readonly width: number; readonly height: number },
  frame: { readonly width: number; readonly height: number },
  scrollY = 0,
): ViewTransform {
  if (frame.width <= 0 || frame.height <= 0 || box.width <= 0 || box.height <= 0) return { scale: 1, offsetX: 0, offsetY: 0, scrollY };
  const scale = Math.min(box.width / frame.width, box.height / frame.height);
  return { scale, offsetX: (box.width - frame.width * scale) / 2, offsetY: (box.height - frame.height * scale) / 2, scrollY };
}

/** A page rectangle (document coordinates) in the box the bitmap is shown in. */
function mapRect(r: FindRect, t: ViewTransform): FindRect {
  return { x: r.x * t.scale + t.offsetX, y: (r.y - (t.scrollY ?? 0)) * t.scale + t.offsetY, width: r.width * t.scale, height: r.height * t.scale };
}

/**
 * The inverse of the view transform: which point of the page (document coordinates) lies under `point` (relative to the
 * box the bitmap is shown in). Null for the margins `object-fit: contain` leaves around the image.
 */
function pointToFrame(
  point: { readonly x: number; readonly y: number },
  t: ViewTransform,
  frame: { readonly width: number; readonly height: number },
): { x: number; y: number } | null {
  const x = (point.x - t.offsetX) / t.scale;
  const y = (point.y - t.offsetY) / t.scale;
  return x < 0 || y < 0 || x >= frame.width || y >= frame.height ? null : { x, y: y + (t.scrollY ?? 0) };
}

const COLOR_MATCH = 'rgba(255, 214, 0, 0.45)';
const COLOR_ACTIVE = 'rgba(255, 128, 0, 0.7)';
const COLOR_ACTIVE_OUTLINE = 'rgba(255, 90, 0, 0.95)';
const COLOR_TICK = 'rgba(255, 190, 0, 0.9)';
const COLOR_TICK_ACTIVE = 'rgba(255, 90, 0, 1)';
const TICK_WIDTH = 6;
const TICK_HEIGHT = 2;

/**
 * Paints find matches over the page without touching it: a pointer-transparent canvas laid over the
 * content area (the page itself is a bitmap), plus scrollbar-style tick marks down the right edge.
 */
class FindHighlightOverlay implements IDisposable {
  private canvas: HTMLCanvasElement | null = null;
  private matches: readonly FindMatch[] = [];
  private active = -1;
  private observer: ResizeObserver | null = null;

  /** `frameSize` is the page bitmap's pixel size; match coordinates are page coordinates, shifted by `scroll` when drawn. */
  constructor(
    private readonly host: HTMLElement,
    private readonly frameSize: () => { readonly width: number; readonly height: number } | null,
    private readonly scroll: () => ScrollView = () => ({ y: 0, documentHeight: 0 }),
  ) {}

  show(matches: readonly FindMatch[], activeIndex: number): void {
    this.matches = matches;
    this.active = activeIndex;
    this.redraw();
  }

  clear(): void {
    this.matches = [];
    this.active = -1;
    this.redraw();
  }

  /** Call after a resize or a page repaint. */
  redraw(): void {
    if (this.matches.length === 0) {
      this.canvas?.remove();
      this.canvas = null;
      this.observer?.disconnect();
      this.observer = null;
      return;
    }
    const canvas = this.ensureCanvas();
    const w = this.host.clientWidth;
    const h = this.host.clientHeight;
    const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
    canvas.width = Math.max(1, Math.round(w * dpr));
    canvas.height = Math.max(1, Math.round(h * dpr));
    const ctx = canvas.getContext('2d');
    const frame = this.frameSize();
    if (!ctx || !frame) return;

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const view = this.scroll();
    const t = computeViewTransform({ width: w, height: h }, frame, view.y);
    const pageHeight = Math.max(frame.height, view.documentHeight);

    this.matches.forEach((m, i) => {
      const isActive = i === this.active;
      for (const rect of m.rects) {
        const r = mapRect(rect, t);
        ctx.fillStyle = isActive ? COLOR_ACTIVE : COLOR_MATCH;
        ctx.fillRect(r.x, r.y, r.width, r.height);
        if (isActive) {
          ctx.strokeStyle = COLOR_ACTIVE_OUTLINE;
          ctx.lineWidth = 1.5;
          ctx.strokeRect(r.x, r.y, r.width, r.height);
        }
      }
    });

    // Tick marks: the active match is drawn last so it stays on top.
    const order = this.matches.map((_, i) => i).filter((i) => i !== this.active);
    if (this.active >= 0) order.push(this.active);
    for (const i of order) {
      const first = this.matches[i]!.rects[0];
      if (!first) continue;
      const y = Math.min(h - TICK_HEIGHT, Math.max(0, (first.y / pageHeight) * h)); // down the whole page, not just the viewport
      ctx.fillStyle = i === this.active ? COLOR_TICK_ACTIVE : COLOR_TICK;
      ctx.fillRect(w - TICK_WIDTH, y, TICK_WIDTH, TICK_HEIGHT);
    }
  }

  dispose(): void {
    this.observer?.disconnect();
    this.observer = null;
    this.canvas?.remove();
    this.canvas = null;
    this.matches = [];
  }

  private ensureCanvas(): HTMLCanvasElement {
    if (this.canvas) return this.canvas;
    const canvas = document.createElement('canvas');
    canvas.className = 'nova-find-overlay';
    canvas.setAttribute('aria-hidden', 'true');
    canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;pointer-events:none;z-index:5;';
    const position = getComputedStyle(this.host).position;
    if (!position || position === 'static') this.host.style.position = 'relative';
    this.host.appendChild(canvas);
    this.canvas = canvas;
    if (typeof ResizeObserver !== 'undefined') {
      this.observer = new ResizeObserver(() => this.redraw());
      this.observer.observe(this.host);
    }
    return canvas;
  }
}

export { FindHighlightOverlay, computeViewTransform, mapRect, pointToFrame, scrollToReveal };
export type { ViewTransform, ScrollView };
