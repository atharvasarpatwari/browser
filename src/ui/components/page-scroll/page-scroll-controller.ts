import type { IDisposable } from '../../../app/dependency-container';
import { computeViewTransform } from '../find-bar/find-overlay';

const PAGE_CANVAS = 'canvas:not(.nova-find-overlay):not(.nova-selection-overlay)';
/** A wheel "line" and an arrow key step, in screen pixels (the page is scaled into the content area, so they are converted). */
const LINE_PX = 40;
const ARROW_PX = 40;
/** PageUp / PageDown / Space move by this share of the viewport, leaving a little context. */
const PAGE_SHARE = 0.9;
/** A finger must move this far (screen px) before a touch counts as a drag, so taps still click. */
const TOUCH_SLOP_PX = 8;
/** Pulling down this far (screen px) at the top of the page and letting go reloads it. */
const PULL_TRIGGER_PX = 72;
/** Fling: velocity (screen px/ms) kept per frame, and the speed below which it stops. */
const FLING_DECAY = 0.95;
const FLING_MIN = 0.02;

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
  /** Pull-to-refresh: called when a downward pull at the top of the page is released past the trigger. */
  readonly onPullRefresh?: () => void;
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
  private touch: { startY: number; lastY: number; lastT: number; velocity: number; pull: number; moved: boolean } | null = null;
  private flingVelocity = 0;
  private pullIndicator: HTMLDivElement | null = null;

  constructor(private readonly deps: PageScrollDeps) {}

  attach(): void {
    this.deps.area.addEventListener('wheel', this.onWheel, { passive: false });
    document.addEventListener('keydown', this.onKeyDown);
    this.deps.area.addEventListener('touchstart', this.onTouchStart, { passive: true });
    this.deps.area.addEventListener('touchmove', this.onTouchMove, { passive: false });
    this.deps.area.addEventListener('touchend', this.onTouchEnd, { passive: false });
    this.deps.area.addEventListener('touchcancel', this.onTouchEnd, { passive: false });
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
    this.deps.area.removeEventListener('touchstart', this.onTouchStart);
    this.deps.area.removeEventListener('touchmove', this.onTouchMove);
    this.deps.area.removeEventListener('touchend', this.onTouchEnd);
    this.deps.area.removeEventListener('touchcancel', this.onTouchEnd);
    this.flingVelocity = 0;
    this.setPull(0);
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

  // ── touch: drag to scroll, fling, pull-to-refresh ─────────────────────────

  private readonly onTouchStart = (e: TouchEvent): void => {
    this.flingVelocity = 0; // a new touch stops any fling
    const t = e.touches[0];
    if (e.touches.length !== 1 || !t || !this.pageCanvas()) { this.touch = null; return; }
    this.touch = { startY: t.clientY, lastY: t.clientY, lastT: e.timeStamp, velocity: 0, pull: 0, moved: false };
  };

  private readonly onTouchMove = (e: TouchEvent): void => {
    const touch = this.touch;
    const t = e.touches[0];
    const canvas = this.pageCanvas();
    if (!touch || e.touches.length !== 1 || !t || !canvas) return;
    if (!touch.moved && Math.abs(t.clientY - touch.startY) < TOUCH_SLOP_PX) return;
    touch.moved = true;
    e.preventDefault();
    const dy = t.clientY - touch.lastY; // screen px, positive = finger moving down
    const dt = Math.max(1, e.timeStamp - touch.lastT);
    touch.velocity = 0.8 * (dy / dt) + 0.2 * touch.velocity;
    touch.lastY = t.clientY;
    touch.lastT = e.timeStamp;
    const atTop = this.deps.scroll().y <= 0;
    if (this.deps.onPullRefresh && atTop && (dy > 0 || touch.pull > 0)) {
      touch.pull = Math.max(0, touch.pull + dy);
      this.setPull(touch.pull);
      return;
    }
    this.scrollBy(-dy / this.scaleOf(canvas));
  };

  private readonly onTouchEnd = (e: TouchEvent): void => {
    const touch = this.touch;
    this.touch = null;
    if (!touch?.moved) return; // a tap: leave it alone so links still click
    e.preventDefault(); // a drag is not a click
    if (touch.pull > 0) {
      const fire = touch.pull >= PULL_TRIGGER_PX;
      this.setPull(0);
      if (fire) this.deps.onPullRefresh?.();
      return;
    }
    if (Math.abs(touch.velocity) > 0.3) this.fling(touch.velocity);
  };

  /** Keeps scrolling after the finger lifts, slowing each frame. */
  private fling(velocity: number): void {
    this.flingVelocity = velocity;
    const schedule = this.deps.schedule ?? ((cb: () => void) => { requestAnimationFrame(cb); });
    const step = (): void => {
      const canvas = this.pageCanvas();
      if (Math.abs(this.flingVelocity) < FLING_MIN || !canvas) { this.flingVelocity = 0; return; }
      const before = this.deps.scroll().y;
      this.scrollBy((-this.flingVelocity * 16) / this.scaleOf(canvas));
      if (this.deps.scroll().y === before) { this.flingVelocity = 0; return; } // hit the top or bottom
      this.flingVelocity *= FLING_DECAY;
      schedule(step);
    };
    schedule(step);
  }

  /** The ↻ indicator that follows a pull-to-refresh; 0 removes it. */
  private setPull(distance: number): void {
    if (distance <= 0) {
      this.pullIndicator?.remove();
      this.pullIndicator = null;
      return;
    }
    if (!this.pullIndicator) {
      const el = document.createElement('div');
      el.className = 'nova-pull-refresh';
      el.setAttribute('aria-hidden', 'true');
      el.textContent = '\u21bb';
      el.style.cssText = 'position:absolute;left:50%;top:0;width:36px;height:36px;margin-left:-18px;border-radius:50%;'
        + 'background:#fff;color:#444;box-shadow:0 2px 6px rgba(0,0,0,.3);display:flex;align-items:center;'
        + 'justify-content:center;font:20px/1 system-ui,sans-serif;pointer-events:none;z-index:5;';
      if (getComputedStyle(this.deps.area).position === 'static') this.deps.area.style.position = 'relative';
      this.deps.area.appendChild(el);
      this.pullIndicator = el;
    }
    const progress = Math.min(1, distance / PULL_TRIGGER_PX);
    this.pullIndicator.style.transform = `translateY(${Math.min(distance, PULL_TRIGGER_PX * 1.5) / 2}px) rotate(${progress * 270}deg)`;
    this.pullIndicator.style.opacity = String(0.4 + 0.6 * progress);
  }

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
