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
}

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
    const point = this.toPage(e.clientX, e.clientY, true);
    const offset = point ? this.model.caretAt(point.x, point.y) : null;
    if (offset === null) return;
    this.model.extendTo(offset);
    this.draw();
  };

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
    document.removeEventListener('mousemove', this.onMouseMove);
    document.removeEventListener('mouseup', this.onMouseUp);
  }

  private pageCanvas(): HTMLCanvasElement | null {
    const canvas = this.deps.area.querySelector<HTMLCanvasElement>(PAGE_CANVAS);
    return canvas && canvas.width > 0 ? canvas : null;
  }

  /** A client point in page-bitmap coordinates; null outside the bitmap unless `clamp` pins it to the nearest edge. */
  private toPage(clientX: number, clientY: number, clamp: boolean): { x: number; y: number } | null {
    const canvas = this.pageCanvas();
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    const frame = { width: canvas.width, height: canvas.height };
    const t = computeViewTransform({ width: rect.width, height: rect.height }, frame);
    let x = (clientX - rect.left - t.offsetX) / t.scale;
    let y = (clientY - rect.top - t.offsetY) / t.scale;
    if (clamp) {
      x = Math.min(frame.width - 1, Math.max(0, x));
      y = Math.min(frame.height - 1, Math.max(0, y));
    } else if (x < 0 || y < 0 || x >= frame.width || y >= frame.height) {
      return null;
    }
    return { x, y };
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
    const t = computeViewTransform({ width: w, height: h }, { width: canvas.width, height: canvas.height });
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
