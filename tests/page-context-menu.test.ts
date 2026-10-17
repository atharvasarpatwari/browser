import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { buildPageContextMenu, PageContextMenuController } from '../src/ui/components/context-menu/page-context-menu';
import type { PageMenuActions, PageMenuContext, PageTarget } from '../src/ui/components/context-menu/page-context-menu';
import type { ContextMenuItem, IContextMenu } from '../src/ui/components/context-menu/context-menu';
import { computeViewTransform, pointToFrame } from '../src/ui/components/find-bar/find-overlay';

const context = (over: Partial<PageMenuContext> = {}): PageMenuContext => ({
  pageUrl: 'https://example.com/docs/', engineName: 'Nova', canGoBack: true, canGoForward: false, ...over,
});
const link = (over: Partial<PageTarget> = {}): PageTarget => ({
  linkUrl: 'https://example.com/about', linkText: 'About us', imageUrl: null, imageAlt: null, ...over,
});
const image = (over: Partial<PageTarget> = {}): PageTarget => ({
  linkUrl: null, linkText: null, imageUrl: 'https://cdn.example.com/cat.png', imageAlt: 'A cat', ...over,
});

function makeActions() {
  return {
    openInNewTab: vi.fn<(url: string) => void>(), copy: vi.fn<(text: string) => void>(),
    searchFor: vi.fn<(text: string) => void>(), askAi: vi.fn<(text: string) => void>(),
    back: vi.fn<() => void>(), forward: vi.fn<() => void>(), reload: vi.fn<() => void>(), find: vi.fn<() => void>(),
  } satisfies PageMenuActions;
}

const labels = (items: readonly ContextMenuItem[]) => items.map((i) => (i.separator ? '—' : i.label));
const item = (items: readonly ContextMenuItem[], label: string) => items.find((i) => i.label === label)!;

describe('buildPageContextMenu', () => {
  it('offers a link: open, copy, and search for its text', () => {
    const actions = makeActions();
    const items = buildPageContextMenu(link(), context(), actions);
    expect(labels(items)).toEqual([
      'Open link in new tab', 'Copy link address', 'Search Nova for “About us”', 'Ask Nova AI about “About us”',
    ]);
    item(items, 'Open link in new tab').action!();
    expect(actions.openInNewTab).toHaveBeenCalledWith('https://example.com/about');
    item(items, 'Copy link address').action!();
    expect(actions.copy).toHaveBeenCalledWith('https://example.com/about');
    item(items, 'Search Nova for “About us”').action!();
    expect(actions.searchFor).toHaveBeenCalledWith('About us');
    item(items, 'Ask Nova AI about “About us”').action!();
    expect(actions.askAi).toHaveBeenCalledWith('About us');
  });

  it('names the default engine, and offers no search for a link without text', () => {
    expect(labels(buildPageContextMenu(link(), context({ engineName: 'DuckDuckGo' }), makeActions()))).toContain('Search DuckDuckGo for “About us”');
    expect(labels(buildPageContextMenu(link({ linkText: null }), context(), makeActions()))).toEqual(['Open link in new tab', 'Copy link address']);
    expect(labels(buildPageContextMenu(link({ linkText: '  \n\t ' }), context(), makeActions()))).toEqual(['Open link in new tab', 'Copy link address']);
  });

  it('shows page text as one short quoted line in the label, but searches for all of it', () => {
    const long = `Read   the\nwhole ${'very '.repeat(30)}long story`;
    const actions = makeActions();
    const items = buildPageContextMenu(link({ linkText: long }), context(), actions);
    const search = items.find((i) => i.label?.startsWith('Search Nova for'))!;
    expect(search.label).toMatch(/^Search Nova for “Read the whole very very.*…”$/);
    expect(search.label!.length).toBeLessThan(70);
    search.action!();
    expect(actions.searchFor).toHaveBeenCalledWith(long.replace(/\s+/g, ' ').trim());
  });

  it('offers an image: open, copy, and three reverse lookups that open in a new tab', () => {
    const actions = makeActions();
    const items = buildPageContextMenu(image(), context(), actions);
    expect(labels(items)).toEqual([
      'Open image in new tab', 'Copy image address',
      'Search image with Google Lens', 'Search image with Bing Visual Search', 'Search image with TinEye',
    ]);
    item(items, 'Open image in new tab').action!();
    expect(actions.openInNewTab).toHaveBeenLastCalledWith('https://cdn.example.com/cat.png');
    item(items, 'Copy image address').action!();
    expect(actions.copy).toHaveBeenCalledWith('https://cdn.example.com/cat.png');
    item(items, 'Search image with Google Lens').action!();
    expect(actions.openInNewTab).toHaveBeenLastCalledWith(`https://lens.google.com/uploadbyurl?url=${encodeURIComponent('https://cdn.example.com/cat.png')}`);
  });

  it('greys out the reverse lookup for an image no outside service could fetch (and never offers its address to them)', () => {
    const items = buildPageContextMenu(image({ imageUrl: 'http://127.0.0.1:8080/cat.png' }), context(), makeActions());
    expect(labels(items)).toEqual(['Open image in new tab', 'Copy image address', 'Search the web for this image']);
    expect(item(items, 'Search the web for this image').disabled).toBe(true);
    expect(item(items, 'Search the web for this image').action).toBeUndefined();
  });

  it('gives an image inside a link both groups, link first, separated', () => {
    const items = buildPageContextMenu(link({ imageUrl: 'https://cdn.example.com/cat.png' }), context(), makeActions());
    expect(labels(items)).toEqual([
      'Open link in new tab', 'Copy link address', 'Search Nova for “About us”', 'Ask Nova AI about “About us”',
      '—',
      'Open image in new tab', 'Copy image address',
      'Search image with Google Lens', 'Search image with Bing Visual Search', 'Search image with TinEye',
    ]);
  });

  it('over plain page: back / forward / reload, then find and copy the address', () => {
    const actions = makeActions();
    for (const target of [null, link({ linkUrl: null, linkText: null })]) {
      const items = buildPageContextMenu(target, context(), actions);
      expect(labels(items)).toEqual(['Back', 'Forward', 'Reload', '—', 'Find in page…', 'Copy page address']);
    }
    const items = buildPageContextMenu(null, context(), actions);
    expect(item(items, 'Back').disabled).toBe(false);
    expect(item(items, 'Forward').disabled).toBe(true);
    for (const label of ['Back', 'Reload', 'Find in page…']) item(items, label).action!();
    item(items, 'Copy page address').action!();
    expect(actions.back).toHaveBeenCalledTimes(1);
    expect(actions.reload).toHaveBeenCalledTimes(1);
    expect(actions.find).toHaveBeenCalledTimes(1);
    expect(actions.copy).toHaveBeenCalledWith('https://example.com/docs/');
    expect(buildPageContextMenu(null, context({ pageUrl: '' }), actions).find((i) => i.label === 'Copy page address')!.disabled).toBe(true);
  });

  it('never starts, ends or doubles up on separators', () => {
    const targets: Array<PageTarget | null> = [null, link(), link({ linkText: null }), image(), image({ imageUrl: 'data:image/png;base64,AA' }), link({ imageUrl: 'https://c.example.com/a.png' })];
    for (const target of targets) {
      const l = labels(buildPageContextMenu(target, context(), makeActions()));
      expect(l[0]).not.toBe('—');
      expect(l[l.length - 1]).not.toBe('—');
      expect(l.join('|')).not.toContain('—|—');
    }
  });
});

describe('pointToFrame', () => {
  const frame = { width: 1920, height: 1080 };

  it('inverts the view transform, including the letterbox margins', () => {
    const t = computeViewTransform({ width: 960, height: 540 }, frame); // scale 0.5, no margins
    expect(pointToFrame({ x: 100, y: 50 }, t, frame)).toEqual({ x: 200, y: 100 });

    const boxed = computeViewTransform({ width: 1000, height: 1000 }, frame); // wide image in a square box: margins above and below
    const p = pointToFrame({ x: 500, y: 500 }, boxed, frame)!;
    expect(p.x).toBeCloseTo(960, 5);
    expect(p.y).toBeCloseTo(540, 5);
    expect(pointToFrame({ x: 500, y: 100 }, boxed, frame)).toBeNull(); // in the top margin
    expect(pointToFrame({ x: 500, y: 950 }, boxed, frame)).toBeNull(); // in the bottom margin
  });

  it('is null outside the image on every side, and maps its corners', () => {
    const t = computeViewTransform({ width: 960, height: 540 }, frame);
    expect(pointToFrame({ x: -1, y: 10 }, t, frame)).toBeNull();
    expect(pointToFrame({ x: 10, y: -1 }, t, frame)).toBeNull();
    expect(pointToFrame({ x: 960, y: 10 }, t, frame)).toBeNull();
    expect(pointToFrame({ x: 10, y: 540 }, t, frame)).toBeNull();
    expect(pointToFrame({ x: 0, y: 0 }, t, frame)).toEqual({ x: 0, y: 0 });
  });
});

describe('PageContextMenuController', () => {
  let area: HTMLElement;
  let canvas: HTMLCanvasElement;
  let menu: IContextMenu & { show: ReturnType<typeof vi.fn<(x: number, y: number, items: readonly ContextMenuItem[]) => void>> };
  let resolveTarget: ReturnType<typeof vi.fn<(x: number, y: number) => PageTarget | null>>;
  let controller: PageContextMenuController;

  /** The canvas as the browser would lay it out: its on-screen box (the bitmap is 1920×1080 inside it). */
  const place = (box: { left: number; top: number; width: number; height: number }) => {
    canvas.getBoundingClientRect = () => ({
      ...box, x: box.left, y: box.top, right: box.left + box.width, bottom: box.top + box.height, toJSON: () => ({}),
    });
  };
  const rightClick = (x: number, y: number, on: Element = canvas) => {
    const event = new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: x, clientY: y });
    on.dispatchEvent(event);
    return event;
  };
  const shown = (): ContextMenuItem[] => menu.show.mock.calls[menu.show.mock.calls.length - 1]![2] as ContextMenuItem[];

  beforeEach(() => {
    area = document.createElement('div');
    canvas = document.createElement('canvas');
    canvas.width = 1920;
    canvas.height = 1080;
    area.appendChild(canvas);
    document.body.appendChild(area);
    place({ left: 10, top: 20, width: 960, height: 540 });
    menu = { show: vi.fn<(x: number, y: number, items: readonly ContextMenuItem[]) => void>(), hide: vi.fn(), isVisible: false, dispose: vi.fn() };
    resolveTarget = vi.fn(() => link());
    controller = new PageContextMenuController({
      area, menu: () => menu, resolveTarget, context: () => context(), actions: makeActions(),
    });
    controller.attach();
  });

  afterEach(() => {
    controller.dispose();
    area.remove();
  });

  it('hit-tests in page coordinates when the page is scrolled: the bitmap shows the page from scrollY down', () => {
    controller.dispose();
    controller = new PageContextMenuController({
      area, menu: () => menu, resolveTarget, context: () => context(), actions: makeActions(), scrollY: () => 2500,
    });
    controller.attach();
    rightClick(110, 70);
    expect(resolveTarget).toHaveBeenCalledWith(200, 100 + 2500);
  });

  it('hit-tests in bitmap coordinates (the canvas scales the page into the content area) and shows the menu at the pointer', () => {
    const event = rightClick(110, 70);
    expect(resolveTarget).toHaveBeenCalledWith(200, 100); // ((110 − 10) / 0.5, (70 − 20) / 0.5)
    expect(event.defaultPrevented).toBe(true);
    expect(menu.show).toHaveBeenCalledTimes(1);
    expect(menu.show.mock.calls[0]!.slice(0, 2)).toEqual([110, 70]);
    expect(labels(shown())[0]).toBe('Open link in new tab');
  });

  it('allows for the margins around a letterboxed page: a click in a margin is the page, not a link', () => {
    place({ left: 0, top: 0, width: 1000, height: 1000 });
    rightClick(100, 100); // above the image
    expect(resolveTarget).not.toHaveBeenCalled();
    expect(labels(shown())[0]).toBe('Back');

    rightClick(960, 500);
    const [x, y] = resolveTarget.mock.calls[0]!;
    expect(x).toBeCloseTo(1843.2, 1);
    expect(y).toBeCloseTo(540, 1);
  });

  it('shows the page menu when nothing is under the pointer, or when hit-testing fails', () => {
    resolveTarget.mockReturnValueOnce(null);
    rightClick(110, 70);
    expect(labels(shown())[0]).toBe('Back');

    resolveTarget.mockImplementationOnce(() => { throw new Error('layout gone'); });
    const event = rightClick(110, 70);
    expect(labels(shown())[0]).toBe('Back');
    expect(event.defaultPrevented).toBe(true);
  });

  it('leaves everything that is not the page bitmap alone', () => {
    const other = document.createElement('div');
    area.appendChild(other);
    expect(rightClick(50, 50, other).defaultPrevented).toBe(false); // built-in pages are DOM: the default stays

    const overlay = document.createElement('canvas');
    overlay.className = 'nova-find-overlay';
    area.appendChild(overlay);
    expect(rightClick(50, 50, overlay).defaultPrevented).toBe(false);

    const already = new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 50, clientY: 50 });
    already.preventDefault();
    canvas.dispatchEvent(already);

    const stray = document.createElement('canvas');
    document.body.appendChild(stray); // a canvas outside the content area
    expect(rightClick(50, 50, stray).defaultPrevented).toBe(false);
    stray.remove();

    expect(menu.show).not.toHaveBeenCalled();
    expect(resolveTarget).not.toHaveBeenCalled();
  });

  it('registers once, and stops when disposed', () => {
    controller.attach();
    rightClick(110, 70);
    expect(menu.show).toHaveBeenCalledTimes(1);
    controller.dispose();
    expect(rightClick(110, 70).defaultPrevented).toBe(false);
    expect(menu.show).toHaveBeenCalledTimes(1);
  });

  it('asks for the selection at the click, and puts it in the menu', () => {
    controller.dispose();
    const selectionAt = vi.fn((_x: number, _y: number) => 'quasar notes');
    controller = new PageContextMenuController({ area, menu: () => menu, resolveTarget: () => null, context: () => context(), actions: makeActions(), selectionAt });
    controller.attach();
    rightClick(110, 70);
    expect(selectionAt).toHaveBeenCalledWith(110, 70);
    expect(labels(shown()).slice(0, 3)).toEqual(['Copy', 'Search Nova for “quasar notes”', 'Ask Nova AI about “quasar notes”']);
  });
});

describe('page menu with selected text', () => {
  it('leads with copy, search and ask for the selection', () => {
    const actions = makeActions();
    const items = buildPageContextMenu(null, context({ selection: '  quasar\n  notes ' }), actions);
    expect(labels(items).slice(0, 3)).toEqual(['Copy', 'Search Nova for “quasar notes”', 'Ask Nova AI about “quasar notes”']);
    item(items, 'Copy').action!();
    expect(actions.copy).toHaveBeenCalledWith('quasar\n  notes'); // the text as selected, trimmed — not the one-line label
    item(items, 'Search Nova for “quasar notes”').action!();
    expect(actions.searchFor).toHaveBeenCalledWith('quasar notes');
    item(items, 'Ask Nova AI about “quasar notes”').action!();
    expect(actions.askAi).toHaveBeenCalledWith('quasar notes');
  });

  it('keeps the page navigation items below it when nothing else is under the pointer', () => {
    expect(labels(buildPageContextMenu(null, context({ selection: 'text' }), makeActions()))).toEqual([
      'Copy', 'Search Nova for “text”', 'Ask Nova AI about “text”',
      '—', 'Back', 'Forward', 'Reload', '—', 'Find in page…', 'Copy page address',
    ]);
  });

  it('comes first over a link too, with the link items after it', () => {
    const l = labels(buildPageContextMenu(link(), context({ selection: 'text' }), makeActions()));
    expect(l.slice(0, 4)).toEqual(['Copy', 'Search Nova for “text”', 'Ask Nova AI about “text”', '—']);
    expect(l).toContain('Open link in new tab');
    expect(l).not.toContain('Back');
  });

  it('is absent for an empty or blank selection', () => {
    for (const selection of [undefined, '', '  \n ']) {
      expect(labels(buildPageContextMenu(null, context({ selection }), makeActions()))[0]).toBe('Back');
    }
  });
});
