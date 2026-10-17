import type { IDisposable } from '../../../app/dependency-container';
import type { FindTextSource } from '../../../browser/navigation-controls/find-in-page';
import { PageSelection } from '../../../browser/navigation-controls/page-selection';
import { computeViewTransform, mapRect } from '../find-bar/find-overlay';

const OVERLAY_CLASS = 'nova-selection-overlay';
const PAGE_CANVAS = 'canvas:not(.nova-find-overlay):not(.nova-selection-overlay)';
const COLOR = 'rgba(51, 144, 255, 0.35)';

interface PageSelectionDeps {
  /** The content area; the page bitmap is a `<canvas>` inside it. */
  readonly area: HTMLElement;
  /** The page's positioned text (the same source find-in-page searches). */
  readonly source: FindTextSource;
  /** How far the page is scrolled (the bitmap shows the page from this row down). Default: not scrolled. */
  readonly scrollY?: () => number;
  /** Scrolls the page by `dy` page pixels (positive: down). Without it a drag does not scroll the page. */
  readonly scrollBy?: (dy: number) => void;
}

/** A drag within this many screen pixels of the top or bottom edge of the content area scrolls the page. */
const EDGE_PX = 28;
const AUTOSCROLL_INTERVAL_MS = 30;
/** Screen pixels scrolled per tick: faster the further the pointer is into (or past) the edge, at most MAX. */
const AUTOSCROLL_MIN_PX = 6;
const AUTOSCROLL_MAX_PX = 60;

/**
 * Text selection on a rendered page: drag, double-click (word), triple-click (block), Shift-click, Select all. The page
 * is a bitmap with no text nodes, so the selection is a `PageSelection` over layout text runs, drawn as a
 * pointer-transparent canvas laid over the page (below find's highlights).
 */
class PageSelectionController implements IDisposable {
  private readonly model: PageSelection;
  private overlay: HTMLCanvasElement | null = null;
  private observer: ResizeObserver | null = null;
  private suppressClick = false;
  /** Where the pointer last was during a drag (client coordinates), and the timer that scrolls while it is at an edge. */
  private pointer: { readonly x: number; readonly y: number } | null = null;
  private autoScrollTimer: ReturnType<typeof setInterval> | null = null;

  constructor(private readonly deps: PageSelectionDeps) {
    this.model = new PageSelection(deps.source);
  }

  attach(): void {
    this.deps.area.addEventListener('mousedown', this.onMouseDown);
    this.deps.area.addEventListener('click', this.onClick, true);
  }

  get hasSelection(): boolean { return !this.model.isEmpty; }

  text(): string { return this.model.text(); }

  /** Whether the client point is on the selected text (for the right-click menu). */
  containsClientPoint(clientX: number, clientY: number): boolean {
    const point = this.toPage(clientX, clientY, false);
    return !!point && this.model.contains(point.x, point.y);
  }

  /** Selects the whole page text. False when no page is rendered (built-in pages are real DOM). */
  selectAll(): boolean {
    if (!this.pageCanvas()) return false;
    this.model.refresh();
    this.model.selectAll();
    this.draw();
    return !this.model.isEmpty;
  }

  clear(): void {
    this.model.clear();
    this.draw();
  }

  /** The page was repainted or resized: re-read the layout and redraw. */
  redraw(): void {
    if (this.model.isEmpty) return;
    this.model.refresh();
    this.draw();
  }

  dispose(): void {
    this.deps.area.removeEventListener('mousedown', this.onMouseDown);
    this.deps.area.removeEventListener('click', this.onClick, true);
    this.stopDragging();
    this.observer?.disconnect();
    this.observer = null;
    this.overlay?.remove();
    this.overlay = null;
  }

  private readonly onMouseDown = (e: MouseEvent): void => {
    const canvas = this.pageCanvas();
    if (e.button !== 0 || !canvas || !(e.target instanceof Node) || !canvas.contains(e.target)) return;
    const point = this.toPage(e.clientX, e.clientY, false);
    if (!point) { this.clear(); return; } // the margin around the bitmap
    this.model.refresh();
    const offset = this.model.caretAt(point.x, point.y);
    if (offset === null) { this.clear(); return; }

    canvas.style.userSelect = 'none';
    const focused = document.activeElement;
    if (focused instanceof HTMLElement && focused.matches('input, textarea, [contenteditable]')) focused.blur();

    if (e.shiftKey && !this.model.isEmpty) {
      this.model.extendTo(offset);
    } else if (e.detail === 2) {
      this.model.selectWord(offset);
    } else if (e.detail >= 3) {
      this.model.selectBlock(offset);
    } else {
      this.model.start(offset);
      document.addEventListener('mousemove', this.onMouseMove);
      document.addEventListener('mouseup', this.onMouseUp);
    }
    this.draw();
  };

  private readonly onMouseMove = (e: MouseEvent): void => {
    this.pointer = { x: e.clientX, y: e.clientY };
    this.extendToPointer();
    this.updateAutoScroll();
  };

  /** Extends the selection to the text under the pointer's last position (the page may have scrolled under it). */
  private extendToPointer(): void {
    if (!this.pointer) return;
    const point = this.toPage(this.pointer.x, this.pointer.y, true);
    const offset = point ? this.model.caretAt(point.x, point.y) : null;
    if (offset === null) return;
    this.model.extendTo(offset);
    this.draw();
  }

  /** While the pointer is held at the top or bottom edge, scroll the page and keep extending the selection. */
  private updateAutoScroll(): void {
    const direction = this.edgeDirection();
    if (direction === 0 || !this.deps.scrollBy) { this.stopAutoScroll(); return; }
    this.autoScrollTimer ??= setInterval(() => {
      const dir = this.edgeDirection();
      if (dir === 0) { this.stopAutoScroll(); return; }
      const canvas = this.pageCanvas();
      const scale = canvas ? this.screenPerPagePixel(canvas) : 1;
      this.deps.scrollBy?.((dir * this.autoScrollSpeed()) / scale);
      this.extendToPointer();
    }, AUTOSCROLL_INTERVAL_MS);
  }

  /** -1 near the top edge, +1 near the bottom edge, 0 elsewhere (past an edge counts as at it). */
  private edgeDirection(): -1 | 0 | 1 {
    if (!this.pointer) return 0;
    const rect = this.deps.area.getBoundingClientRect();
    if (this.pointer.y < rect.top + EDGE_PX) return -1;
    if (this.pointer.y > rect.bottom - EDGE_PX) return 1;
    return 0;
  }

  private autoScrollSpeed(): number {
    if (!this.pointer) return 0;
    const rect = this.deps.area.getBoundingClientRect();
    const into = this.pointer.y < rect.top + rect.height / 2 ? rect.top + EDGE_PX - this.pointer.y : this.pointer.y - (rect.bottom - EDGE_PX);
    return Math.min(AUTOSCROLL_MAX_PX, AUTOSCROLL_MIN_PX + into / 2);
  }

  private screenPerPagePixel(canvas: HTMLCanvasElement): number {
    const rect = canvas.getBoundingClientRect();
    return computeViewTransform({ width: rect.width, height: rect.height }, { width: canvas.width, height: canvas.height }).scale || 1;
  }

  private stopAutoScroll(): void {
    if (this.autoScrollTimer !== null) clearInterval(this.autoScrollTimer);
    this.autoScrollTimer = null;
  }

  private readonly onMouseUp = (): void => {
    this.stopDragging();
    if (this.model.isEmpty) this.clear();
    else { // a drag that ended on a link must not also follow it
      this.suppressClick = true;
      setTimeout(() => { this.suppressClick = false; }, 0);
    }
  };

  private readonly onClick = (e: MouseEvent): void => {
    if (!this.suppressClick) return;
    this.suppressClick = false;
    e.stopPropagation();
    e.preventDefault();
  };

  private stopDragging(): void {
    this.stopAutoScroll();
    this.pointer = null;
    document.removeEventListener('mousemove', this.onMouseMove);
    document.removeEventListener('mouseup', this.onMouseUp);
  }

  private pageCanvas(): HTMLCanvasElement | null {
    const canvas = this.deps.area.querySelector<HTMLCanvasElement>(PAGE_CANVAS);
    return canvas && canvas.width > 0 ? canvas : null;
  }

  /**
   * A client point in page coordinates (the page is taller than its bitmap: the bitmap shows it from `scrollY` down);
   * null outside the bitmap unless `clamp` pins it to the nearest edge of what is shown.
   */
  private toPage(clientX: number, clientY: number, clamp: boolean): { x: number; y: number } | null {
    const canvas = this.pageCanvas();
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    const frame = { width: canvas.width, height: canvas.height };
    const t = computeViewTransform({ width: rect.width, height: rect.height }, frame, this.deps.scrollY?.() ?? 0);
    let x = (clientX - rect.left - t.offsetX) / t.scale;
    let y = (clientY - rect.top - t.offsetY) / t.scale;
    if (clamp) {
      x = Math.min(frame.width - 1, Math.max(0, x));
      y = Math.min(frame.height - 1, Math.max(0, y));
    } else if (x < 0 || y < 0 || x >= frame.width || y >= frame.height) {
      return null;
    }
    return { x, y: y + (t.scrollY ?? 0) };
  }

  private draw(): void {
    const rects = this.model.rects();
    const canvas = this.pageCanvas();
    if (rects.length === 0 || !canvas) {
      this.overlay?.remove();
      this.overlay = null;
      this.observer?.disconnect();
      this.observer = null;
      return;
    }
    const overlay = this.ensureOverlay();
    const w = this.deps.area.clientWidth;
    const h = this.deps.area.clientHeight;
    const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
    overlay.width = Math.max(1, Math.round(w * dpr));
    overlay.height = Math.max(1, Math.round(h * dpr));
    const ctx = overlay.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = COLOR;
    const t = computeViewTransform({ width: w, height: h }, { width: canvas.width, height: canvas.height }, this.deps.scrollY?.() ?? 0);
    for (const rect of rects) {
      const r = mapRect(rect, t);
      ctx.fillRect(r.x, r.y, r.width, r.height);
    }
  }

  private ensureOverlay(): HTMLCanvasElement {
    if (this.overlay) return this.overlay;
    const canvas = document.createElement('canvas');
    canvas.className = OVERLAY_CLASS;
    canvas.setAttribute('aria-hidden', 'true');
    canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;pointer-events:none;z-index:4;';
    const position = getComputedStyle(this.deps.area).position;
    if (!position || position === 'static') this.deps.area.style.position = 'relative';
    this.deps.area.appendChild(canvas);
    this.overlay = canvas;
    if (typeof ResizeObserver !== 'undefined') {
      this.observer = new ResizeObserver(() => this.draw());
      this.observer.observe(this.deps.area);
    }
    return canvas;
  }
}

export { PageSelectionController };
