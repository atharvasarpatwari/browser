import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { FindBarView, describeResult } from '../src/ui/components/find-bar/find-bar.view';
import { FindHighlightOverlay, computeViewTransform, mapRect } from '../src/ui/components/find-bar/find-overlay';
import { FindInPage } from '../src/browser/navigation-controls/find-in-page';
import type { FindMatch, FindResult, FindTextSource } from '../src/browser/navigation-controls/find-in-page';

const source = (text: string): FindTextSource => ({
  getBlocks: () => [{ runs: [{ text, x: 0, y: 12.8, fontSize: 16, width: text.length * 8 }] }],
});

const result = (over: Partial<FindResult> = {}): FindResult => ({ matches: [], activeIndex: -1, total: 0, query: '', ...over });

describe('describeResult', () => {
  it('summarises the state for the counter', () => {
    expect(describeResult(result())).toBe('');
    expect(describeResult(result({ query: 'x' }))).toBe('No results');
    expect(describeResult(result({ query: 'x', total: 12, activeIndex: 2 }))).toBe('3/12');
    expect(describeResult(result({ query: 'x', total: 5000, activeIndex: 0, truncated: true }))).toBe('1/5000+');
    expect(describeResult(result({ query: '(', error: 'Invalid regular expression' }))).toBe('Invalid regex');
  });
});

describe('FindBarView', () => {
  let parent: HTMLElement;
  let engine: FindInPage;
  let bar: FindBarView;
  let onChange: ReturnType<typeof vi.fn<(r: FindResult) => void>>;
  let onClose: ReturnType<typeof vi.fn<() => void>>;

  const root = () => parent.querySelector<HTMLElement>('.nova-find-bar')!;
  const input = () => parent.querySelector<HTMLInputElement>('.nova-find-bar input')!;
  const count = () => parent.querySelector('.nova-find-bar-count')!.textContent;
  const type = (value: string) => { input().value = value; input().dispatchEvent(new Event('input', { bubbles: true })); };
  const key = (k: string, init: KeyboardEventInit = {}) =>
    input().dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...init }));
  const button = (title: string) => [...parent.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.title.startsWith(title))!;

  beforeEach(() => {
    parent = document.createElement('div');
    document.body.appendChild(parent);
    engine = new FindInPage(source('One two one TWO one'));
    onChange = vi.fn<(r: FindResult) => void>();
    onClose = vi.fn<() => void>();
    bar = new FindBarView(engine, { onChange, onClose });
    bar.mount(parent);
  });

  afterEach(() => {
    bar.dispose();
    parent.remove();
  });

  it('is hidden until opened, then focuses and selects the box', () => {
    expect(root().hidden).toBe(true);
    expect(bar.isOpen).toBe(false);
    bar.open();
    expect(root().hidden).toBe(false);
    expect(bar.isOpen).toBe(true);
    expect(document.activeElement).toBe(input());
  });

  it('searches as you type and shows the position', () => {
    bar.open();
    type('one');
    expect(count()).toBe('1/3');
    type('zzz');
    expect(count()).toBe('No results');
    expect(parent.querySelector('.nova-find-bar-count--empty')).not.toBeNull();
    type('');
    expect(count()).toBe('');
  });

  it('opens with a prefilled query (the current selection) and runs it', () => {
    bar.open('two');
    expect(input().value).toBe('two');
    expect(count()).toBe('1/2');
    bar.close();
    bar.open('  '); // blank prefill keeps the previous text
    expect(input().value).toBe('two');
  });

  it('Enter and Shift+Enter step forward and back with wrap-around', () => {
    bar.open('one');
    key('Enter');
    expect(count()).toBe('2/3');
    key('Enter');
    key('Enter');
    expect(count()).toBe('1/3');
    key('Enter', { shiftKey: true });
    expect(count()).toBe('3/3');
    button('Next').click();
    expect(count()).toBe('1/3');
    button('Previous').click();
    expect(count()).toBe('3/3');
  });

  it('Escape and the close button hide the bar, clear the engine and notify', () => {
    bar.open('one');
    key('Escape');
    expect(root().hidden).toBe(true);
    expect(engine.getMatchCount()).toBe(0);
    expect(onClose).toHaveBeenCalledTimes(1);
    bar.open('one');
    button('Close').click();
    expect(onClose).toHaveBeenCalledTimes(2);
    button('Close').click(); // already closed: nothing happens
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it('toggles case, whole-word and regex modes and re-runs the search', () => {
    bar.open('TWO');
    expect(count()).toBe('1/2'); // case-insensitive
    button('Match case').click();
    expect(button('Match case').getAttribute('aria-pressed')).toBe('true');
    expect(count()).toBe('1/1');
    button('Match case').click();
    expect(count()).toBe('1/2');

    type('on');
    expect(count()).toBe('1/3');
    button('Whole word').click();
    expect(count()).toBe('No results');
    button('Whole word').click();

    type('o.e');
    expect(count()).toBe('No results');
    button('Regular expression').click();
    expect(count()).toBe('1/3');
  });

  it('flags an invalid regular expression without throwing', () => {
    bar.open();
    button('Regular expression').click();
    type('(unclosed');
    expect(count()).toBe('Invalid regex');
    expect(input().hasAttribute('aria-invalid')).toBe(true);
    type('one');
    expect(input().hasAttribute('aria-invalid')).toBe(false);
  });

  it('reports every engine event through onChange', () => {
    bar.open('one');
    key('Enter');
    const calls = onChange.mock.calls;
    expect(calls.length).toBeGreaterThanOrEqual(2);
    expect(calls[calls.length - 1]![0].activeIndex).toBe(1);
  });

  it('refresh() re-runs the query only while open with text', () => {
    let text = 'one one';
    const dynamic = new FindInPage({ getBlocks: () => [{ runs: [{ text, x: 0, y: 12.8, fontSize: 16 }] }] });
    const b = new FindBarView(dynamic);
    const host = document.createElement('div');
    document.body.appendChild(host);
    b.mount(host);
    b.refresh(); // closed
    expect(dynamic.getMatchCount()).toBe(0);
    b.open('one');
    text = 'one one one';
    b.refresh();
    expect(dynamic.getMatchCount()).toBe(3);
    b.dispose();
    host.remove();
  });

  it('removes itself and stops listening on dispose', () => {
    bar.dispose();
    expect(parent.querySelector('.nova-find-bar')).toBeNull();
    onChange.mockClear();
    engine.find('one');
    expect(onChange).not.toHaveBeenCalled();
    expect(() => bar.open()).not.toThrow();
  });
});

describe('computeViewTransform / mapRect', () => {
  it('letterboxes like object-fit: contain', () => {
    expect(computeViewTransform({ width: 400, height: 100 }, { width: 200, height: 100 })).toEqual({ scale: 1, offsetX: 100, offsetY: 0, scrollY: 0 });
    expect(computeViewTransform({ width: 100, height: 400 }, { width: 200, height: 100 })).toEqual({ scale: 0.5, offsetX: 0, offsetY: 175, scrollY: 0 });
    expect(computeViewTransform({ width: 200, height: 100 }, { width: 200, height: 100 })).toEqual({ scale: 1, offsetX: 0, offsetY: 0, scrollY: 0 });
  });

  it('falls back to identity for degenerate sizes', () => {
    const identity = { scale: 1, offsetX: 0, offsetY: 0, scrollY: 0 };
    expect(computeViewTransform({ width: 0, height: 100 }, { width: 200, height: 100 })).toEqual(identity);
    expect(computeViewTransform({ width: 100, height: 100 }, { width: 0, height: 0 })).toEqual(identity);
  });

  it('maps page rectangles into the box', () => {
    expect(mapRect({ x: 10, y: 20, width: 30, height: 40 }, { scale: 0.5, offsetX: 100, offsetY: 5 }))
      .toEqual({ x: 105, y: 15, width: 15, height: 20 });
  });
});

describe('FindHighlightOverlay', () => {
  let host: HTMLElement;
  let calls: Array<[string, ...unknown[]]>;
  let original: typeof HTMLCanvasElement.prototype.getContext;
  let frame: { width: number; height: number } | null;

  const match = (index: number, rects: FindMatch['rects']): FindMatch => ({ index, text: 't', context: '', position: 0, rects });
  const setSize = (w: number, h: number) => {
    Object.defineProperty(host, 'clientWidth', { value: w, configurable: true });
    Object.defineProperty(host, 'clientHeight', { value: h, configurable: true });
  };

  beforeEach(() => {
    host = document.createElement('div');
    document.body.appendChild(host);
    setSize(400, 200);
    frame = { width: 400, height: 200 };
    calls = [];
    original = HTMLCanvasElement.prototype.getContext;
    const ctx = new Proxy({}, {
      get: (_t, prop: string) => (...args: unknown[]) => { calls.push([prop, ...args]); },
      set: (_t, prop: string, value: unknown) => { calls.push([`set:${prop}`, value]); return true; },
    });
    HTMLCanvasElement.prototype.getContext = (() => ctx) as unknown as typeof original;
  });

  afterEach(() => {
    HTMLCanvasElement.prototype.getContext = original;
    host.remove();
  });

  const fills = () => calls.filter((c) => c[0] === 'fillRect').map((c) => c.slice(1));

  it('draws nothing and adds no canvas without matches', () => {
    const o = new FindHighlightOverlay(host, () => frame);
    o.show([], -1);
    expect(host.querySelector('.nova-find-overlay')).toBeNull();
  });

  it('paints a rectangle per match rect, outlines the active one, and ticks the right edge', () => {
    const o = new FindHighlightOverlay(host, () => frame);
    o.show([
      match(0, [{ x: 10, y: 20, width: 30, height: 20 }]),
      match(1, [{ x: 50, y: 100, width: 30, height: 20 }, { x: 80, y: 100, width: 10, height: 20 }]),
    ], 1);
    const canvas = host.querySelector<HTMLCanvasElement>('.nova-find-overlay')!;
    expect(canvas).not.toBeNull();
    expect(canvas.getAttribute('aria-hidden')).toBe('true');
    expect(canvas.style.pointerEvents).toBe('none');
    expect(fills()).toEqual(expect.arrayContaining([
      [10, 20, 30, 20], [50, 100, 30, 20], [80, 100, 10, 20],
      [394, 20, 6, 2], [394, 100, 6, 2], // tick marks at the right edge: 20/200 and 100/200 of the height
    ]));
    expect(calls.filter((c) => c[0] === 'strokeRect')).toHaveLength(2); // only the active match's two rects
  });

  it('letterboxes the rectangles when the frame does not fill the box', () => {
    setSize(800, 200); // frame 400x200 → scale 1, centred horizontally by 200px
    const o = new FindHighlightOverlay(host, () => frame);
    o.show([match(0, [{ x: 10, y: 20, width: 30, height: 20 }])], 0);
    expect(fills()).toContainEqual([210, 20, 30, 20]);
  });

  it('scales with the frame size and redraws on request', () => {
    frame = { width: 800, height: 400 };
    const o = new FindHighlightOverlay(host, () => frame);
    o.show([match(0, [{ x: 100, y: 40, width: 80, height: 20 }])], 0);
    expect(fills()).toContainEqual([50, 20, 40, 10]);
    calls.length = 0;
    setSize(200, 100);
    o.redraw();
    expect(fills()).toContainEqual([25, 10, 20, 5]);
  });

  it('keeps its canvas but skips drawing while the page frame size is unknown', () => {
    frame = null;
    const o = new FindHighlightOverlay(host, () => frame);
    o.show([match(0, [{ x: 1, y: 1, width: 5, height: 5 }])], 0);
    expect(host.querySelector('.nova-find-overlay')).not.toBeNull();
    expect(fills()).toEqual([]);
  });

  it('skips matches without geometry for ticks and highlights', () => {
    const o = new FindHighlightOverlay(host, () => frame);
    o.show([match(0, [])], 0);
    expect(fills()).toEqual([]);
  });

  it('clear() and dispose() remove the canvas', () => {
    const o = new FindHighlightOverlay(host, () => frame);
    o.show([match(0, [{ x: 1, y: 1, width: 5, height: 5 }])], 0);
    o.clear();
    expect(host.querySelector('.nova-find-overlay')).toBeNull();
    o.show([match(0, [{ x: 1, y: 1, width: 5, height: 5 }])], 0);
    o.dispose();
    expect(host.querySelector('.nova-find-overlay')).toBeNull();
  });

  it('makes a statically positioned host a positioning context', () => {
    expect(['', 'static']).toContain(getComputedStyle(host).position);
    new FindHighlightOverlay(host, () => frame).show([match(0, [{ x: 1, y: 1, width: 5, height: 5 }])], 0);
    expect(host.style.position).toBe('relative');
  });
});
