import type { IDisposable } from '../../../app/dependency-container';
import { computeViewTransform } from '../find-bar/find-overlay';

const PAGE_CANVAS = 'canvas:not(.nova-find-overlay):not(.nova-selection-overlay)';
/** A wheel "line" and an arrow key step, in screen pixels (the page is scaled into the content area, so they are converted). */
const LINE_PX = 40;
const ARROW_PX = 40;
/** PageUp / PageDown / Space move by this share of the viewport, leaving a little context. */
const PAGE_SHARE = 0.9;

interface PageScrollState {
  readonly y: number;
  /** The largest `y`. Zero: the page fits and does not scroll. */
  readonly max: number;
  readonly viewportHeight: number;
  readonly documentHeight: number;
}

interface PageScrollDeps {
  /** The content area; the page bitmap is a `<canvas>` inside it. */
  readonly area: HTMLElement;
  readonly scroll: () => PageScrollState;
  /** Scrolls the page to `y` (already clamped) and repaints. */
  readonly scrollTo: (y: number) => void;
  /** Runs `cb` before the next frame (wheel events are coalesced into one scroll per frame). Default: requestAnimationFrame. */
  readonly schedule?: (cb: () => void) => void;
}

/**
 * Scrolling a rendered page: the wheel, PageUp / PageDown / Home / End / Space / arrow keys, and a scrollbar drawn over
 * the right edge (drag the thumb, click the track). The page is a bitmap, so none of this is native: every route ends in
 * one clamped `scrollTo`. Built-in pages (real DOM) and anything with focus in a text field keep their own behaviour.
 */
class PageScrollController implements IDisposable {
  private bar: HTMLDivElement | null = null;
  private thumb: HTMLDivElement | null = null;
  private pendingWheel = 0;
  private scheduled = false;
  private dragging: { readonly startY: number; readonly startScroll: number } | null = null;

  constructor(private readonly deps: PageScrollDeps) {}

  attach(): void {
    this.deps.area.addEventListener('wheel', this.onWheel, { passive: false });
    document.addEventListener('keydown', this.onKeyDown);
  }

  /** The page scrolled, repainted or changed height: redraw the scrollbar. */
  update(): void {
    const s = this.deps.scroll();
    if (s.max <= 0 || !this.pageCanvas()) {
      this.removeBar();
      return;
    }
    const thumb = this.ensureBar();
    thumb.style.height = `${(s.viewportHeight / s.documentHeight) * 100}%`;
    thumb.style.top = `${(s.y / s.documentHeight) * 100}%`;
  }

  scrollBy(dy: number): void {
    const s = this.deps.scroll();
    const to = Math.max(0, Math.min(s.max, s.y + dy));
    if (to !== s.y) this.deps.scrollTo(to);
  }

  dispose(): void {
    this.deps.area.removeEventListener('wheel', this.onWheel);
    document.removeEventListener('keydown', this.onKeyDown);
    this.stopDrag();
    this.removeBar();
  }

  private readonly onWheel = (e: WheelEvent): void => {
    const canvas = this.pageCanvas();
    if (e.defaultPrevented || e.ctrlKey || !canvas || !(e.target instanceof Node) || !this.deps.area.contains(e.target)) return;
    const s = this.deps.scroll();
    if (s.max <= 0) return; // nothing to scroll: leave the event alone
    const scale = this.scaleOf(canvas);
    const screenPx = e.deltaMode === 1 ? e.deltaY * LINE_PX : e.deltaMode === 2 ? e.deltaY * s.viewportHeight * scale * PAGE_SHARE : e.deltaY;
    e.preventDefault();
    this.pendingWheel += screenPx / scale; // screen pixels → page pixels
    if (this.scheduled) return;
    this.scheduled = true;
    (this.deps.schedule ?? ((cb) => { requestAnimationFrame(cb); }))(() => {
      this.scheduled = false;
      const dy = this.pendingWheel;
      this.pendingWheel = 0;
      this.scrollBy(dy);
    });
  };

  private readonly onKeyDown = (e: KeyboardEvent): void => {
    if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey || !this.pageCanvas() || this.focusKeepsKeys()) return;
    const s = this.deps.scroll();
    if (s.max <= 0) return;
    const page = s.viewportHeight * PAGE_SHARE;
    const scale = this.scaleOf(this.pageCanvas()!);
    switch (e.key) {
      case 'PageDown': this.scrollBy(page); break;
      case 'PageUp': this.scrollBy(-page); break;
      case ' ': this.scrollBy(e.shiftKey ? -page : page); break;
      case 'ArrowDown': this.scrollBy(ARROW_PX / scale); break;
      case 'ArrowUp': this.scrollBy(-ARROW_PX / scale); break;
      case 'Home': this.deps.scrollTo(0); break;
      case 'End': this.deps.scrollTo(s.max); break;
      default: return;
    }
    e.preventDefault();
  };

  /** Focus is somewhere those keys already mean something (a text box, a button, a link). */
  private focusKeepsKeys(): boolean {
    const el = document.activeElement;
    return el instanceof HTMLElement && (el.matches('input, textarea, select, button, a[href], summary') || el.isContentEditable);
  }

  private pageCanvas(): HTMLCanvasElement | null {
    const canvas = this.deps.area.querySelector<HTMLCanvasElement>(PAGE_CANVAS);
    return canvas && canvas.width > 0 ? canvas : null;
  }

  /** Screen pixels per page pixel: the bitmap is scaled into the content area. */
  private scaleOf(canvas: HTMLCanvasElement): number {
    const rect = canvas.getBoundingClientRect();
    return computeViewTransform({ width: rect.width, height: rect.height }, { width: canvas.width, height: canvas.height }).scale || 1;
  }

  // ── scrollbar ──────────────────────────────────────────────────────────────

  private ensureBar(): HTMLDivElement {
    if (this.thumb && this.bar?.isConnected) return this.thumb;
    this.removeBar(); // a new page replaced the content area's children, taking the old bar with them
    const area = this.deps.area;
    if (getComputedStyle(area).position === 'static') area.style.position = 'relative';
    const bar = document.createElement('div');
    bar.className = 'nova-page-scrollbar';
    bar.setAttribute('aria-hidden', 'true');
    bar.style.cssText = 'position:absolute;top:0;right:0;bottom:0;width:12px;z-index:6;background:rgba(0,0,0,0.04);';
    const thumb = document.createElement('div');
    thumb.className = 'nova-page-scrollbar-thumb';
    thumb.style.cssText = 'position:absolute;left:2px;right:2px;min-height:24px;border-radius:4px;background:rgba(0,0,0,0.35);cursor:default;';
    bar.appendChild(thumb);
    bar.addEventListener('mousedown', this.onBarMouseDown);
    area.appendChild(bar);
    this.bar = bar;
    this.thumb = thumb;
    return thumb;
  }

  private removeBar(): void {
    this.bar?.removeEventListener('mousedown', this.onBarMouseDown);
    this.bar?.remove();
    this.bar = null;
    this.thumb = null;
  }

  private readonly onBarMouseDown = (e: MouseEvent): void => {
    if (e.button !== 0 || !this.bar || !this.thumb) return;
    e.preventDefault(); // no text selection while dragging
    const s = this.deps.scroll();
    if (e.target === this.thumb) {
      this.dragging = { startY: e.clientY, startScroll: s.y };
      document.addEventListener('mousemove', this.onDragMove);
      document.addEventListener('mouseup', this.stopDrag);
      return;
    }
    // The track: a page up or down, towards the click.
    const thumbTop = this.thumb.getBoundingClientRect().top;
    this.scrollBy(e.clientY < thumbTop ? -s.viewportHeight * PAGE_SHARE : s.viewportHeight * PAGE_SHARE);
  };

  private readonly onDragMove = (e: MouseEvent): void => {
    if (!this.dragging) return;
    const s = this.deps.scroll();
    const trackHeight = this.bar?.clientHeight || this.deps.area.clientHeight || 1;
    const to = this.dragging.startScroll + ((e.clientY - this.dragging.startY) / trackHeight) * s.documentHeight;
    this.scrollBy(Math.max(0, Math.min(s.max, to)) - s.y);
  };

  private readonly stopDrag = (): void => {
    this.dragging = null;
    document.removeEventListener('mousemove', this.onDragMove);
    document.removeEventListener('mouseup', this.stopDrag);
  };
}

export { PageScrollController };
export type { PageScrollState, PageScrollDeps };
