import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { PageScrollController } from '../src/ui/components/page-scroll/page-scroll-controller';
import type { PageScrollState } from '../src/ui/components/page-scroll/page-scroll-controller';
import { computeViewTransform, mapRect, pointToFrame } from '../src/ui/components/find-bar/find-overlay';

// A 1920x1080 bitmap shown at half size (960x540) in the content area; the page is 5000 px tall.
const SCALE = 0.5;
const VIEWPORT = 1080;
const DOC = 5000;
const MAX = DOC - VIEWPORT;

describe('PageScrollController', () => {
  let area: HTMLElement;
  let page: HTMLCanvasElement;
  let state: { y: number; max: number; documentHeight: number };
  let scrollTo: ReturnType<typeof vi.fn<(y: number) => void>>;
  let controller: PageScrollController;
  let frames: Array<() => void>;

  const read = (): PageScrollState => ({ ...state, viewportHeight: VIEWPORT });
  const runFrames = (): void => { const run = frames.splice(0); run.forEach((f) => f()); };
  const wheel = (init: WheelEventInit, target: EventTarget = page): WheelEvent => {
    const event = new WheelEvent('wheel', { bubbles: true, cancelable: true, ...init });
    if (init.ctrlKey) Object.defineProperty(event, 'ctrlKey', { value: true }); // not every DOM implementation reads it from the init
    target.dispatchEvent(event);
    return event;
  };
  const key = (k: string, init: KeyboardEventInit = {}): KeyboardEvent => {
    const event = new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...init });
    document.dispatchEvent(event);
    return event;
  };

  beforeEach(() => {
    frames = [];
    area = document.createElement('div');
    page = document.createElement('canvas');
    page.width = 1920;
    page.height = 1080;
    page.getBoundingClientRect = () => ({ left: 0, top: 0, width: 960, height: 540, right: 960, bottom: 540, x: 0, y: 0, toJSON: () => ({}) });
    Object.defineProperty(area, 'clientHeight', { value: 540 });
    area.appendChild(page);
    document.body.appendChild(area);
    state = { y: 0, max: MAX, documentHeight: DOC };
    scrollTo = vi.fn((y: number) => { state.y = y; });
    controller = new PageScrollController({ area, scroll: read, scrollTo, schedule: (cb) => { frames.push(cb); } });
    controller.attach();
  });
  afterEach(() => { controller.dispose(); area.remove(); });

  describe('the wheel', () => {
    it('scrolls by the wheel distance converted from screen pixels to page pixels', () => {
      const event = wheel({ deltaY: 100 });
      runFrames();
      expect(event.defaultPrevented).toBe(true);
      expect(scrollTo).toHaveBeenCalledWith(100 / SCALE); // 100 screen px = 200 page px
    });

    it('coalesces a burst of wheel events into one scroll per frame', () => {
      wheel({ deltaY: 50 });
      wheel({ deltaY: 50 });
      wheel({ deltaY: 50 });
      expect(frames).toHaveLength(1);
      runFrames();
      expect(scrollTo).toHaveBeenCalledTimes(1);
      expect(scrollTo).toHaveBeenCalledWith(300);
    });

    it('understands lines and pages as well as pixels', () => {
      wheel({ deltaY: 3, deltaMode: 1 }); // three lines
      runFrames();
      expect(scrollTo).toHaveBeenLastCalledWith((3 * 40) / SCALE);
      state.y = 0;
      wheel({ deltaY: 1, deltaMode: 2 }); // one page
      runFrames();
      expect(scrollTo).toHaveBeenLastCalledWith(VIEWPORT * 0.9);
    });

    it('never scrolls past either end', () => {
      state.y = MAX - 50;
      wheel({ deltaY: 4000 });
      runFrames();
      expect(scrollTo).toHaveBeenLastCalledWith(MAX);
      wheel({ deltaY: -100000 });
      runFrames();
      expect(scrollTo).toHaveBeenLastCalledWith(0);
    });

    it('does nothing at the end it is pushed against (no repaint)', () => {
      wheel({ deltaY: -100 });
      runFrames();
      expect(scrollTo).not.toHaveBeenCalled();
    });

    it('leaves the event alone when the page cannot scroll, with Ctrl (zoom), or with no page bitmap', () => {
      state.max = 0;
      expect(wheel({ deltaY: 100 }).defaultPrevented).toBe(false);
      state.max = MAX;
      expect(wheel({ deltaY: 100, ctrlKey: true }).defaultPrevented).toBe(false);
      page.remove(); // a built-in page: real DOM, native scrolling
      expect(wheel({ deltaY: 100 }, area).defaultPrevented).toBe(false);
      runFrames();
      expect(scrollTo).not.toHaveBeenCalled();
    });
  });

  describe('the keyboard', () => {
    it.each([
      ['PageDown', {}, VIEWPORT * 0.9],
      ['PageUp', {}, -VIEWPORT * 0.9],
      [' ', {}, VIEWPORT * 0.9],
      [' ', { shiftKey: true }, -VIEWPORT * 0.9],
      ['ArrowDown', {}, 40 / SCALE],
      ['ArrowUp', {}, -40 / SCALE],
    ] as const)('%s %j scrolls by %d', (k, init, by) => {
      state.y = 2000;
      const event = key(k, init);
      expect(event.defaultPrevented).toBe(true);
      expect(scrollTo).toHaveBeenCalledWith(2000 + by);
    });

    it('Home and End go to the ends', () => {
      state.y = 2000;
      key('End');
      expect(scrollTo).toHaveBeenLastCalledWith(MAX);
      key('Home');
      expect(scrollTo).toHaveBeenLastCalledWith(0);
    });

    it('keeps its hands off shortcuts, other keys, text fields, buttons and pages that fit', () => {
      expect(key('PageDown', { ctrlKey: true }).defaultPrevented).toBe(false);
      expect(key('a').defaultPrevented).toBe(false);
      for (const tag of ['input', 'textarea', 'button']) {
        const el = document.createElement(tag);
        document.body.appendChild(el);
        el.focus();
        expect(key(' ').defaultPrevented, tag).toBe(false);
        el.remove();
      }
      state.max = 0;
      expect(key('PageDown').defaultPrevented).toBe(false);
      expect(scrollTo).not.toHaveBeenCalled();
    });

    it('stops listening when disposed', () => {
      controller.dispose();
      expect(key('PageDown').defaultPrevented).toBe(false);
      expect(wheel({ deltaY: 100 }).defaultPrevented).toBe(false);
    });
  });

  describe('the scrollbar', () => {
    const bar = () => area.querySelector<HTMLElement>('.nova-page-scrollbar');
    const thumb = () => area.querySelector<HTMLElement>('.nova-page-scrollbar-thumb')!;

    it('appears for a page that scrolls, sized and placed by how much of the page is in view', () => {
      state.y = 1250;
      controller.update();
      expect(bar()).not.toBeNull();
      expect(thumb().style.height).toBe(`${(VIEWPORT / DOC) * 100}%`);
      expect(thumb().style.top).toBe(`${(1250 / DOC) * 100}%`);
    });

    it('is gone for a page that fits and for built-in pages', () => {
      controller.update();
      state.max = 0;
      controller.update();
      expect(bar()).toBeNull();
      state.max = MAX;
      controller.update();
      page.remove();
      controller.update();
      expect(bar()).toBeNull();
    });

    it('dragging the thumb scrolls in proportion to the page', () => {
      controller.update();
      Object.defineProperty(bar()!, 'clientHeight', { value: 540 });
      thumb().dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, clientY: 100, button: 0 }));
      document.dispatchEvent(new MouseEvent('mousemove', { clientY: 154 })); // 54 px of a 540 px track = a tenth of the page
      expect(scrollTo).toHaveBeenLastCalledWith(0.1 * DOC);
      document.dispatchEvent(new MouseEvent('mouseup'));
      document.dispatchEvent(new MouseEvent('mousemove', { clientY: 300 }));
      expect(scrollTo).toHaveBeenCalledTimes(1); // released
    });

    it('clicking the track above or below the thumb pages up or down', () => {
      state.y = 2000;
      controller.update();
      thumb().getBoundingClientRect = () => ({ left: 0, top: 200, width: 8, height: 100, right: 8, bottom: 300, x: 0, y: 200, toJSON: () => ({}) });
      bar()!.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, clientY: 400, button: 0 }));
      expect(scrollTo).toHaveBeenLastCalledWith(2000 + VIEWPORT * 0.9);
      bar()!.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, clientY: 50, button: 0 }));
      expect(scrollTo).toHaveBeenLastCalledWith(2000 + VIEWPORT * 0.9 - VIEWPORT * 0.9);
    });

    it('comes back after a new page replaced the content area (the old bar went with it)', () => {
      controller.update();
      area.replaceChildren(page); // what showing another page does
      expect(bar()).toBeNull();
      controller.update();
      expect(bar()).not.toBeNull();
      expect(area.querySelectorAll('.nova-page-scrollbar')).toHaveLength(1);
    });

    it('is removed with the controller', () => {
      controller.update();
      controller.dispose();
      expect(bar()).toBeNull();
    });
  });
});

describe('view transform with a scrolled page', () => {
  const box = { width: 960, height: 540 };
  const frame = { width: 1920, height: 1080 };

  it('maps page coordinates through the scroll: a rectangle 2000 px down shows at the top once scrolled there', () => {
    const t = computeViewTransform(box, frame, 2000);
    expect(mapRect({ x: 100, y: 2000, width: 200, height: 40 }, t)).toEqual({ x: 50, y: 0, width: 100, height: 20 });
    expect(mapRect({ x: 100, y: 2540, width: 200, height: 40 }, t).y).toBe(270);
  });

  it('maps a point on screen back to page coordinates, scroll included', () => {
    const t = computeViewTransform(box, frame, 2000);
    expect(pointToFrame({ x: 50, y: 270 }, t, frame)).toEqual({ x: 100, y: 2540 });
    expect(pointToFrame({ x: 50, y: 0 }, t, frame)).toEqual({ x: 100, y: 2000 });
  });

  it('still treats the letterbox margins as outside the page, however far it is scrolled', () => {
    const t = computeViewTransform({ width: 960, height: 1000 }, frame, 3000); // margins above and below the bitmap
    expect(pointToFrame({ x: 100, y: 10 }, t, frame)).toBeNull();
    expect(pointToFrame({ x: 100, y: 990 }, t, frame)).toBeNull();
  });

  it('is unchanged when the page is not scrolled', () => {
    const t = computeViewTransform(box, frame);
    expect(t.scrollY).toBe(0);
    expect(pointToFrame({ x: 50, y: 270 }, t, frame)).toEqual({ x: 100, y: 540 });
  });
});
