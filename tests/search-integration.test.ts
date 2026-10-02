import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { Mock } from 'vitest';
import { AddressBar } from '../src/ui/components/address-bar/address-bar';
import { AddressBarView } from '../src/ui/components/address-bar/address-bar.view';
import { SearchIntegration, resolveDefaultEngine, HOST_ACTION_IDS, NOVA_ENGINE } from '../src/ui/pages/search-integration';
import type { SearchHost } from '../src/ui/pages/search-integration';
import { SearchPage } from '../src/ui/pages/search-page';
import { BrowserWindowPage } from '../src/ui/pages/browser-window';
import { FindInPage } from '../src/browser/navigation-controls/find-in-page';
import { NavigationController } from '../src/browser/navigation/navigation-controller';
import { RouteType } from '../src/browser/navigation/router';
import { UrlParser } from '../src/browser/navigation/url-parser';
import { HtmlParser } from '../src/browser/rendering/html-parser';
import { DomTree } from '../src/browser/rendering/dom-tree';

const TABS = [
  { id: 'tab-1', title: 'Docs home', url: 'https://example.com/docs', active: true },
  { id: 'tab-2', title: 'Inbox – Mail', url: 'https://mail.example.com/inbox', active: false },
];

/** A rendered page, as far as find-in-page can tell: a bitmap canvas in the content area. */
function addPageCanvas(area: HTMLElement): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = 1920;
  canvas.height = 1080;
  area.appendChild(canvas);
  return canvas;
}

function pressFind(init: KeyboardEventInit = { ctrlKey: true }): KeyboardEvent {
  const event = new KeyboardEvent('keydown', { key: 'f', bubbles: true, cancelable: true, ...init });
  document.body.dispatchEvent(event);
  return event;
}

describe('resolveDefaultEngine / HOST_ACTION_IDS', () => {
  it('is Nova unless Settings names another engine', () => {
    for (const id of ['nova', '', 'no-such-engine', 'constructor', '__proto__']) {
      expect(resolveDefaultEngine(id).name, id).toBe('Nova');
      expect(resolveDefaultEngine(id).searchUrl('a b&c'), id).toBe('nova://search?q=a%20b%26c');
    }
    expect(NOVA_ENGINE.searchUrl('x')).toBe('nova://search?q=x');
    expect(resolveDefaultEngine('google')).toMatchObject({ name: 'Google' });
    expect(resolveDefaultEngine('google').searchUrl('a b')).toMatch(/^https:\/\/www\.google\.com\/search\?q=a(%20|\+)b$/);
    expect(resolveDefaultEngine('duckduckgo').searchUrl('x')).toContain('duckduckgo.com');
    expect(resolveDefaultEngine('bing').searchUrl('x')).toContain('bing.com');
  });

  it('offers only commands the window can run', () => {
    expect([...HOST_ACTION_IDS].sort()).toEqual([
      'clear-browsing-data', 'close-tab', 'new-tab', 'open-bookmarks', 'open-downloads', 'open-history',
      'open-settings', 'reload-page',
    ]);
  });
});

describe('SearchIntegration (fake host)', () => {
  let bar: HTMLElement;
  let area: HTMLElement;
  let model: AddressBar;
  let view: AddressBarView;
  let input: HTMLInputElement;
  let dropdown: HTMLElement;
  let flags: Record<string, boolean | string>;
  let host: SearchHost & {
    open: Mock<(url: string, newTab: boolean) => void>;
    switchTab: Mock<(id: string) => void>;
    reload: Mock<() => void>;
    closeActiveTab: Mock<() => void>;
  };
  let search: SearchIntegration;

  const settle = async (ms = 0) => { await vi.advanceTimersByTimeAsync(ms); };
  const type = async (value: string) => {
    input.value = value;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await settle();
  };
  const key = (k: string, init: KeyboardEventInit = {}) =>
    input.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...init }));
  const rowTypes = () => [...dropdown.querySelectorAll<HTMLElement>('.nova-dropdown-item')].map((r) => r.dataset.type);
  const submit = async (text: string) => { await type(text); key('Enter'); await settle(); };

  beforeEach(() => {
    vi.useFakeTimers();
    flags = { enableSearchSuggestions: false }; // no network in tests
    bar = document.createElement('div');
    area = document.createElement('div');
    document.body.append(bar, area);
    model = new AddressBar();
    view = new AddressBarView(model);
    view.attach(bar);
    input = bar.querySelector('input')!;
    dropdown = bar.querySelector('.nova-dropdown')!;
    input.focus();

    host = {
      addressBar: () => model,
      addressBarView: () => view,
      contentArea: () => area,
      settings: () => ({
        getBoolean: (k, f = false) => (typeof flags[k] === 'boolean' ? (flags[k] as boolean) : f),
        getString: (k, f = '') => (typeof flags[k] === 'string' ? (flags[k] as string) : f),
        setValue: (k, v) => { flags[k] = v as boolean | string; },
      }),
      history: () => null,
      bookmarks: () => null,
      listTabs: () => TABS,
      isIncognito: () => false,
      normalizeUrl: (raw) => (/^[a-z][a-z0-9+.-]*:/i.test(raw) ? raw : `https://${raw}`),
      open: vi.fn<(url: string, newTab: boolean) => void>(),
      switchTab: vi.fn<(id: string) => void>(),
      reload: vi.fn<() => void>(),
      closeActiveTab: vi.fn<() => void>(),
      fetchJson: async () => [],
    };
    search = new SearchIntegration(host);
    search.install();
  });

  afterEach(() => {
    search.dispose();
    view.dispose();
    bar.remove();
    area.remove();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  describe('address bar → window actions', () => {
    it('sends plain text to Nova search', async () => {
      await submit('hello world');
      expect(host.open).toHaveBeenCalledWith('nova://search?q=hello%20world', false);
    });

    it('uses the engine picked in Settings', async () => {
      flags.defaultSearchEngine = 'google';
      await submit('hello world');
      expect(host.open).toHaveBeenCalledTimes(1);
      expect(host.open.mock.calls[0]![0]).toMatch(/^https:\/\/www\.google\.com\/search\?q=hello(%20|\+)world$/);
    });

    it('opens typed addresses after normalising them', async () => {
      await submit('example.com');
      expect(host.open).toHaveBeenCalledWith('https://example.com', false);
    });

    it('hands "@ai" questions to the research page', async () => {
      await submit('@ai quantum computing');
      expect(host.open).toHaveBeenCalledWith('nova://research?q=quantum%20computing', false);
    });

    it.each([
      ['open settings', 'nova://settings', false],
      ['open downloads', 'nova://downloads', false],
      ['open history', 'nova://history', false],
      ['open bookmarks', 'nova://bookmarks', false],
      ['clear browsing data', 'nova://settings', false],
      ['new tab', 'about:newtab', true],
    ])('runs the "%s" command by opening %s', async (command, url, newTab) => {
      await submit(command);
      expect(host.open).toHaveBeenCalledWith(url, newTab);
    });

    it('closes and reloads the current tab on command', async () => {
      await submit('close tab');
      expect(host.closeActiveTab).toHaveBeenCalledTimes(1);
      await submit('reload page');
      expect(host.reload).toHaveBeenCalledTimes(1);
    });

    it('does not offer commands the window cannot run', async () => {
      for (const text of ['print page', 'new incognito window', 'toggle full screen', 'inspect element']) {
        await type(text);
        expect(rowTypes()).not.toContain('action');
      }
    });

    it('switches to an already-open tab from the dropdown', async () => {
      await type('inbox');
      const row = dropdown.querySelector<HTMLElement>('.nova-dropdown-item[data-type="tab"]')!;
      expect(row).not.toBeNull();
      row.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
      expect(host.switchTab).toHaveBeenCalledWith('tab-2');
      expect(host.open).not.toHaveBeenCalled();
    });
  });

  describe('find in page', () => {
    it('Ctrl+F opens the find bar over a rendered page and keeps the browser default away', () => {
      addPageCanvas(area);
      const event = pressFind();
      expect(event.defaultPrevented).toBe(true);
      const findBar = area.querySelector<HTMLElement>('.nova-find-bar')!;
      expect(findBar.hidden).toBe(false);
      expect(getComputedStyle(area).position).not.toBe('static');
    });

    it('Cmd+F works too, and Ctrl+Shift+F / Ctrl+Alt+F are left alone', () => {
      addPageCanvas(area);
      expect(pressFind({ metaKey: true }).defaultPrevented).toBe(true);
      search.onContentReplaced();
      expect(pressFind({ ctrlKey: true, shiftKey: true }).defaultPrevented).toBe(false);
      expect(pressFind({ ctrlKey: true, altKey: true }).defaultPrevented).toBe(false);
      expect(area.querySelector('.nova-find-bar')).toBeNull();
    });

    it('does nothing when no web page is rendered (built-in pages, loading, errors)', () => {
      const event = pressFind();
      expect(event.defaultPrevented).toBe(false);
      expect(search.openFindBar()).toBe(false);
      expect(area.querySelector('.nova-find-bar')).toBeNull();
    });

    it('ignores the highlight overlay when deciding whether a page is rendered', () => {
      const overlay = document.createElement('canvas');
      overlay.className = 'nova-find-overlay';
      overlay.width = 100;
      overlay.height = 100;
      area.appendChild(overlay);
      expect(search.openFindBar()).toBe(false);
    });

    it('drops the find bar when the page is replaced, and builds a fresh one on the next Ctrl+F', () => {
      addPageCanvas(area);
      pressFind();
      const first = area.querySelector('.nova-find-bar');
      expect(first).not.toBeNull();
      search.onContentReplaced();
      expect(area.querySelector('.nova-find-bar')).toBeNull();
      pressFind();
      const second = area.querySelector('.nova-find-bar');
      expect(second).not.toBeNull();
      expect(second).not.toBe(first);
    });

    it('re-runs the query after a repaint, but at most once per interval', () => {
      addPageCanvas(area);
      pressFind();
      const box = area.querySelector<HTMLInputElement>('.nova-find-bar input')!;
      box.value = 'nova';
      box.dispatchEvent(new Event('input', { bubbles: true }));

      const refresh = vi.spyOn(FindInPage.prototype, 'refresh');
      for (let i = 0; i < 5; i++) search.onPageRepainted(); // an animated page repaints every frame
      expect(refresh).not.toHaveBeenCalled();
      vi.advanceTimersByTime(150);
      expect(refresh).toHaveBeenCalledTimes(1);
      search.onPageRepainted();
      vi.advanceTimersByTime(150);
      expect(refresh).toHaveBeenCalledTimes(2);
    });

    it('does not schedule work for repaints while the bar is closed', () => {
      addPageCanvas(area);
      const refresh = vi.spyOn(FindInPage.prototype, 'refresh');
      search.onPageRepainted();
      vi.advanceTimersByTime(500);
      expect(refresh).not.toHaveBeenCalled();
    });

    it('F3 steps through matches only while the bar is open', () => {
      addPageCanvas(area);
      const next = vi.spyOn(FindInPage.prototype, 'findNext');
      const previous = vi.spyOn(FindInPage.prototype, 'findPrevious');
      document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'F3', bubbles: true, cancelable: true }));
      expect(next).not.toHaveBeenCalled();

      pressFind();
      const f3 = new KeyboardEvent('keydown', { key: 'F3', bubbles: true, cancelable: true });
      document.body.dispatchEvent(f3);
      expect(f3.defaultPrevented).toBe(true);
      expect(next).toHaveBeenCalledTimes(1);
      document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'F3', shiftKey: true, bubbles: true, cancelable: true }));
      expect(previous).toHaveBeenCalledTimes(1);
    });
  });

  describe('nova://search page', () => {
    it('mounts the search page with the query from the URL', () => {
      const panel = document.createElement('div');
      area.appendChild(panel);
      search.renderSearchPage(panel, 'nova://search?q=quasar%20nucleus');
      expect(panel.querySelector('h1')!.textContent).toBe('Nova Search');
      expect(panel.querySelector<HTMLInputElement>('input[type="search"]')!.value).toBe('quasar nucleus');
    });

    it('tolerates a missing or malformed query', () => {
      const panel = document.createElement('div');
      area.appendChild(panel);
      search.renderSearchPage(panel, 'nova://search');
      expect(panel.querySelector<HTMLInputElement>('input[type="search"]')!.value).toBe('');
      search.renderSearchPage(panel, 'not a url');
      expect(panel.querySelector<HTMLInputElement>('input[type="search"]')!.value).toBe('');
    });

    it('replaces the previous instance instead of stacking pages', () => {
      const panel = document.createElement('div');
      area.appendChild(panel);
      const dispose = vi.spyOn(SearchPage.prototype, 'dispose');
      search.renderSearchPage(panel, 'nova://search?q=one');
      search.renderSearchPage(panel, 'nova://search?q=two');
      expect(dispose).toHaveBeenCalledTimes(1);
      expect(panel.querySelectorAll('h1')).toHaveLength(1);
      expect(panel.querySelector<HTMLInputElement>('input[type="search"]')!.value).toBe('two');
    });

    it('searching from the page stays in Nova search', () => {
      const panel = document.createElement('div');
      area.appendChild(panel);
      search.renderSearchPage(panel, 'nova://search?q=one');
      const box = panel.querySelector<HTMLInputElement>('input[type="search"]')!;
      box.value = 'second query';
      box.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      expect(host.open).toHaveBeenCalledWith('nova://search?q=second%20query', false);
    });
  });

  it('indexes loaded pages only once the user opted in', async () => {
    const doc = new DomTree().buildFromHtml(new HtmlParser().parse(
      `<html><body><h1>Quasar notes</h1><p>${'The quasar is a luminous galactic nucleus. '.repeat(12)}</p></body></html>`,
    ).document);
    search.onPageDocumentReady('https://astro.example.com/quasars', doc);
    await settle(10);
    expect(search.search!.archive.stats().documents).toBe(0);

    flags.archiveEnabled = true;
    search.onPageDocumentReady('https://astro.example.com/quasars', doc);
    await settle(10);
    expect(search.search!.archive.stats().documents).toBe(1);
  });

  it('stops handling keys once disposed', () => {
    addPageCanvas(area);
    search.dispose();
    expect(pressFind().defaultPrevented).toBe(false);
    expect(area.querySelector('.nova-find-bar')).toBeNull();
  });

  it('does nothing without an address bar to attach to', () => {
    const lonely = new SearchIntegration({ ...host, addressBarView: () => null });
    lonely.install();
    expect(lonely.search).toBeNull();
    lonely.dispose();
  });
});

describe('BrowserWindowPage — search wiring', () => {
  let container: HTMLElement;
  let page: BrowserWindowPage;
  let flags: Record<string, boolean | string>;
  let setValue: Mock<(key: string, value: unknown) => void>;

  const settingsService = () => ({
    getString: (k: string, f = '') => (typeof flags[k] === 'string' ? (flags[k] as string) : f),
    getBoolean: (k: string, f = false) => (typeof flags[k] === 'boolean' ? (flags[k] as boolean) : f),
    getNumber: (_k: string, f = 0) => f,
    setValue,
    init: () => undefined,
  }) as unknown as Parameters<BrowserWindowPage['setSettingsService']>[0];

  const area = () => container.querySelector<HTMLElement>('.content-area')!;
  const heading = () => area().querySelector('h1')?.textContent ?? null;
  const searchBox = () => area().querySelector<HTMLInputElement>('input[type="search"]');
  const settle = async (ms = 0) => { await vi.advanceTimersByTimeAsync(ms); };

  beforeEach(async () => {
    vi.useFakeTimers();
    flags = { enableSearchSuggestions: false }; // no network in tests
    setValue = vi.fn<(key: string, value: unknown) => void>();
    container = document.createElement('div');
    document.body.appendChild(container);
    page = new BrowserWindowPage();
    page.setSettingsService(settingsService());
    await page.mount(container);
  });

  afterEach(async () => {
    await page.unmount();
    container.remove();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('draws nova://search with the query in the URL', async () => {
    await page.navigate('nova://search?q=hello');
    expect(heading()).toBe('Nova Search');
    expect(searchBox()!.value).toBe('hello');
  });

  it('draws it once per navigation and replaces the previous search', async () => {
    await page.navigate('nova://search?q=first');
    await page.navigate('nova://search?q=second');
    expect(area().querySelectorAll('h1')).toHaveLength(1);
    expect(searchBox()!.value).toBe('second');
  });

  it('does not stack the built-in page on top of the previous page', async () => {
    addPageCanvas(area());
    await page.navigate('nova://search?q=hello');
    expect(area().querySelector('canvas')).toBeNull();
  });

  it('typing a question in the address bar lands on Nova search', async () => {
    const box = container.querySelector<HTMLInputElement>('.nova-addressbar-input')!;
    box.focus();
    box.value = 'hello world';
    box.dispatchEvent(new Event('input', { bubbles: true }));
    await settle();
    box.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    await settle();
    expect(heading()).toBe('Nova Search');
    expect(searchBox()!.value).toBe('hello world');
    expect(box.value).toContain('nova://search?q=hello');
  });

  it('typing a built-in address renders that page (the address bar used to bypass page rendering)', async () => {
    const box = container.querySelector<HTMLInputElement>('.nova-addressbar-input')!;
    box.focus();
    box.value = 'nova://settings';
    box.dispatchEvent(new Event('input', { bubbles: true }));
    await settle();
    box.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    await settle();
    expect(area().querySelector('.settings-page')).not.toBeNull();
  });

  it('draws built-in pages for navigations that do not go through navigate() (tabs, back/forward, reload)', async () => {
    const controller = new NavigationController(new UrlParser());
    page.setNavigationController(controller);
    await controller.navigate('nova://search?q=alpha');
    expect(searchBox()!.value).toBe('alpha');

    await controller.navigate('nova://settings');
    expect(area().querySelector('.settings-page')).not.toBeNull();
    expect(heading()).not.toBe('Nova Search');

    page.goBack();
    expect(searchBox()!.value).toBe('alpha');
    expect(area().querySelector('.settings-page')).toBeNull();

    page.goForward();
    expect(area().querySelector('.settings-page')).not.toBeNull();

    page.goBack();
    page.reload();
    await settle();
    expect(area().querySelectorAll('h1')).toHaveLength(1);
    expect(searchBox()!.value).toBe('alpha');
  });

  it('a tab opened on nova://search shows it', async () => {
    page.createTab('nova://search?q=newtab');
    await settle();
    expect(searchBox()!.value).toBe('newtab');
  });

  describe('start screen and the engine', () => {
    type Handler = (event: unknown) => void;
    /** An engine + paint engine pair: enough for the window to build its real NavigationFetcher. */
    const withEngine = () => {
      const handlers: Record<string, Handler[]> = {};
      const engine = {
        on: (type: string, h: Handler) => { (handlers[type] ??= []).push(h); },
        off: (type: string, h: Handler) => { handlers[type] = (handlers[type] ?? []).filter((x) => x !== h); },
      } as unknown as Parameters<BrowserWindowPage['setBrowserEngine']>[0];
      const paint = { rasterize: () => ({ width: 4, height: 4, data: new Uint8ClampedArray(64) }) } as unknown as Parameters<BrowserWindowPage['setPaintEngine']>[0];
      page.setBrowserEngine(engine);
      page.setPaintEngine(paint);
      const ready = (type: RouteType, url: string) => {
        for (const h of handlers.pageLoadReady ?? []) h({ kind: 'pageLoadReady', elapsedMs: 1, session: { entry: { url }, routeResult: { type, pageId: 'p', title: 't' } } });
      };
      return { ready };
    };

    it('keeps the start screen when a tab commits its initial about:blank', async () => {
      await settle();
      expect(area().children.length).toBeGreaterThan(0);
      expect(area().textContent).toContain('Search the web or enter a URL');
    });

    it('an explicit navigation to about:blank clears the page', async () => {
      await page.navigate('nova://search?q=hello');
      await page.navigate('about:blank');
      expect(area().children).toHaveLength(0);
    });

    it('a built-in page survives the engine reporting its (empty) load as ready', async () => {
      const { ready } = withEngine();
      await page.navigate('nova://search?q=hello');
      ready(RouteType.InternalPage, 'nova://search?q=hello');
      expect(heading()).toBe('Nova Search');
      expect(area().querySelector('canvas')).toBeNull();

      await page.navigate('nova://settings');
      ready(RouteType.InternalPage, 'nova://settings');
      expect(area().querySelector('.settings-page')).not.toBeNull();
    });

    it('a web page replaces the built-in page when the engine has rendered it', async () => {
      const { ready } = withEngine();
      await page.navigate('nova://search?q=hello');
      ready(RouteType.WebContent, 'https://example.com/');
      expect(area().querySelector('canvas')).not.toBeNull();
      expect(heading()).toBeNull();
    });
  });

  it('releases the built-in page when navigating to a web page', async () => {
    const dispose = vi.spyOn(SearchPage.prototype, 'dispose');
    await page.navigate('nova://search?q=hello');
    await page.navigate('https://example.com/');
    expect(dispose).toHaveBeenCalled();
    expect(area().querySelector('h1')?.textContent).not.toBe('Nova Search');
  });

  describe('nova://research', () => {
    it('starts researching the query carried by the URL', async () => {
      const research = vi.fn(async () => undefined);
      page.setResearchService({
        state: { status: 'idle' }, research, cancel: () => undefined, on: () => undefined,
      } as unknown as Parameters<BrowserWindowPage['setResearchService']>[0]);
      await page.navigate('nova://research?q=quantum%20computing');
      expect(research).toHaveBeenCalledWith('quantum computing', expect.anything());
    });

    it('opens the research page empty when no query is given', async () => {
      const research = vi.fn(async () => undefined);
      page.setResearchService({
        state: { status: 'idle' }, research, cancel: () => undefined, on: () => undefined,
      } as unknown as Parameters<BrowserWindowPage['setResearchService']>[0]);
      await page.navigate('nova://research');
      expect(area().querySelector('.research-page')).not.toBeNull();
      expect(research).not.toHaveBeenCalled();
    });
  });

  describe('default search engine', () => {
    it('is Nova', () => {
      expect(page.getChromeState().searchTemplate).toBe('nova://search?q=%s');
    });

    it('follows the Settings value, falling back to Nova for unknown engines', () => {
      flags.defaultSearchEngine = 'bing';
      expect(page.getChromeState().searchTemplate).toBe('https://www.bing.com/search?q=%s');
      flags.defaultSearchEngine = 'nova';
      expect(page.getChromeState().searchTemplate).toBe('nova://search?q=%s');
      flags.defaultSearchEngine = 'gone';
      expect(page.getChromeState().searchTemplate).toBe('nova://search?q=%s');
    });

    it('is what the new tab page searches with', async () => {
      await page.navigate('about:newtab');
      const box = area().querySelector<HTMLInputElement>('input[type="text"]')!;
      box.value = 'cats';
      box.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      await settle();
      expect(heading()).toBe('Nova Search');
      expect(searchBox()!.value).toBe('cats');
    });
  });

  describe('find in page', () => {
    type Handler = (event: unknown) => void;
    const fakeEngine = () => {
      const handlers: Record<string, Handler[]> = {};
      const engine = {
        on: (type: string, h: Handler) => { (handlers[type] ??= []).push(h); },
        off: (type: string, h: Handler) => { handlers[type] = (handlers[type] ?? []).filter((x) => x !== h); },
      } as unknown as Parameters<BrowserWindowPage['setBrowserEngine']>[0];
      const emit = (kind: string) => { for (const h of handlers[kind] ?? []) h({ kind, session: { entry: { url: 'https://example.com/' } } }); };
      return { engine, emit, handlers };
    };

    it('Ctrl+F opens the find bar over the page and a new page closes it', () => {
      const { engine, emit } = fakeEngine();
      page.setBrowserEngine(engine);
      addPageCanvas(area());
      expect(pressFind().defaultPrevented).toBe(true);
      expect(area().querySelector<HTMLElement>('.nova-find-bar')!.hidden).toBe(false);

      emit('pageRepainted'); // an in-place repaint keeps the bar
      expect(area().querySelector('.nova-find-bar')).not.toBeNull();

      emit('pageLoadReady');
      expect(area().querySelector('.nova-find-bar')).toBeNull();
    });

    it('closes the bar when a navigation starts or the page fails to load', async () => {
      const { engine, emit } = fakeEngine();
      page.setBrowserEngine(engine);
      addPageCanvas(area());
      pressFind();
      expect(area().querySelector('.nova-find-bar')).not.toBeNull();
      emit('pageLoadError');
      expect(area().querySelector('.nova-find-bar')).toBeNull();

      addPageCanvas(area());
      pressFind();
      expect(area().querySelector('.nova-find-bar')).not.toBeNull();
      await page.navigate('https://example.com/other');
      expect(area().querySelector('.nova-find-bar')).toBeNull();
    });

    it('stops listening to a replaced engine', () => {
      const first = fakeEngine();
      page.setBrowserEngine(first.engine);
      const second = fakeEngine();
      page.setBrowserEngine(second.engine);
      expect(first.handlers.pageLoadReady).toEqual([]);
      expect(first.handlers.pageRepainted).toEqual([]);
      expect(second.handlers.pageLoadReady).toHaveLength(1);
      expect(second.handlers.pageRepainted).toHaveLength(1);
    });

    it('does not open on built-in pages', async () => {
      await page.navigate('nova://settings');
      expect(pressFind().defaultPrevented).toBe(false);
    });
  });

  describe('personal archive', () => {
    const doc = () => new DomTree().buildFromHtml(new HtmlParser().parse(
      `<html><head><title>Quasar notes</title></head><body><h1>Quasar notes</h1><p>${'The quasar is a luminous galactic nucleus. '.repeat(12)}</p></body></html>`,
    ).document);

    it('feeds pages the engine finished loading into the archive when the user opted in', async () => {
      flags.archiveEnabled = true;
      page.onPageDocumentReady('https://astro.example.com/quasars', doc());
      await settle(10);
      await page.navigate('nova://search?q=quasar');
      expect(area().querySelector('article a')?.textContent).toBe('Quasar notes');
    });

    it('is off by default', async () => {
      page.onPageDocumentReady('https://astro.example.com/quasars', doc());
      await settle(10);
      await page.navigate('nova://search?q=quasar');
      expect(area().querySelector('article')).toBeNull();
    });

    it('accepts a page-document provider before or after mount without throwing', async () => {
      const early = new BrowserWindowPage();
      early.setPageDocumentProvider(() => null);
      expect(() => early.onPageDocumentReady('https://a.example/', doc())).not.toThrow();
      const host = document.createElement('div');
      document.body.appendChild(host);
      await early.mount(host);
      early.setPageDocumentProvider(() => null);
      await early.unmount();
      host.remove();
    });
  });

  it('tears the search wiring down on unmount', async () => {
    const removeListener = vi.spyOn(document, 'removeEventListener');
    await page.unmount();
    expect(removeListener).toHaveBeenCalledWith('keydown', expect.any(Function));
    // the afterEach hook unmounts again; that must be harmless
  });
});
